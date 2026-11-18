import { beforeEach, afterEach, describe, it, expect, vi } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { Readable } from 'node:stream';
import { S3Client, GetObjectCommand, PutObjectCommand, ListObjectsV2Command, DeleteObjectsCommand } from '@aws-sdk/client-s3';
import * as storage from '../src/s3-storage';
import { run } from '../src/s3-main';

const state = vi.hoisted(() => ({
  inputs: {} as Record<string, string>, states: {} as Record<string, string>, outputs: {} as Record<string, unknown>,
  errors: [] as string[], objects: new Map<string, { body: Buffer; date: Date }>(), downloads: 0, uploads: 0,
}));
vi.mock('@actions/core', () => ({
  getInput: (key: string, opts?: { required?: boolean }) => {
    const value = state.inputs[key] || '';
    if (opts?.required && !value) throw new Error(`Missing ${key}`);
    return value;
  },
  getState: (key: string) => state.states[key] || '',
  saveState: (key: string, value: string) => { state.states[key] = value; },
  setOutput: (key: string, value: unknown) => { state.outputs[key] = value; },
  setFailed: (value: string) => { state.errors.push(value); },
  info: vi.fn(), warning: vi.fn(), debug: vi.fn(), setSecret: vi.fn(),
}));
vi.mock('../src/auth', () => ({ getCognitoCredentials: vi.fn(async () => ({
  accessKeyId: 'test', secretAccessKey: 'secret', sessionToken: 'session', expiration: new Date(Date.now() + 3600000).toISOString(),
})) }));
vi.mock('@aws-sdk/lib-storage', () => ({ Upload: class {
  constructor(private options: { params: { Key: string; Body: AsyncIterable<Buffer> } }) {}
  async done() {
    const chunks: Buffer[] = [];
    for await (const chunk of this.options.params.Body) chunks.push(chunk);
    state.objects.set(this.options.params.Key, { body: Buffer.concat(chunks), date: new Date() });
    state.uploads++;
    return {};
  }
} }));

let temp: string;
let source: string;
function invocation(inputs: Record<string, string>, post = false) {
  state.inputs = { environment: 'dev', 'github-token': 'test-token', ...inputs };
  if (!post) state.states = {};
  if (!post) state.outputs = {};
  return run();
}
async function producer(key = 'exact') {
  const inputs = { operation: 'cache', path: source, key, save: 'true', 'lookup-only': 'true' };
  await invocation(inputs);
  await invocation(inputs, true);
}

beforeEach(async () => {
  temp = await fs.mkdtemp(path.join(os.tmpdir(), 's3-storage-test-'));
  source = path.join(temp, 'source');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, 'content'), 'producer-content');
  const event = path.join(temp, 'event.json');
  await fs.writeFile(event, JSON.stringify({ repository: { default_branch: 'master' }, pull_request: { base: { ref: 'branch-feature-base' } } }));
  vi.stubEnv('GITHUB_REPOSITORY', 'owner/repo');
  vi.stubEnv('GITHUB_REF', 'refs/pull/123/merge');
  vi.stubEnv('GITHUB_HEAD_REF', 'feature/test');
  vi.stubEnv('GITHUB_SHA', 'commit-sha');
  vi.stubEnv('GITHUB_RUN_ID', '12345');
  vi.stubEnv('GITHUB_RUN_ATTEMPT', '1');
  vi.stubEnv('GITHUB_JOB', 'producer');
  vi.stubEnv('GITHUB_EVENT_PATH', event);
  vi.stubEnv('GITHUB_WORKSPACE', temp);
  state.objects.clear(); state.uploads = 0; state.downloads = 0; state.errors = [];
  vi.spyOn(S3Client.prototype, 'send').mockImplementation(async (command: unknown) => {
    if (command instanceof GetObjectCommand) {
      const object = state.objects.get(command.input.Key!);
      if (!object) throw Object.assign(new Error('missing'), { name: 'NoSuchKey' });
      if (command.input.Key!.endsWith('.tgz')) state.downloads++;
      const body = Readable.from(object.body);
      Object.assign(body, { transformToString: async () => object.body.toString() });
      return { Body: body };
    }
    if (command instanceof PutObjectCommand) {
      if (command.input.IfNoneMatch === '*' && state.objects.has(command.input.Key!)) {
        throw Object.assign(new Error('conflict'), { name: 'PreconditionFailed' });
      }
      state.objects.set(command.input.Key!, { body: Buffer.from(command.input.Body as string), date: new Date() });
      return {};
    }
    if (command instanceof ListObjectsV2Command) {
      return { Contents: [...state.objects].filter(([key]) => key.startsWith(command.input.Prefix!)).map(([Key, o]) => ({ Key, LastModified: o.date })), IsTruncated: false };
    }
    if (command instanceof DeleteObjectsCommand) {
      command.input.Delete!.Objects!.forEach(o => state.objects.delete(o.Key!));
      return {};
    }
    throw new Error('Unexpected command');
  });
});
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllEnvs(); await fs.rm(temp, { recursive: true, force: true }); });

describe('S3-only cache lifecycle', () => {
  it('probes without payload extraction and publishes only in the successful post phase', async () => {
    const inputs = { operation: 'cache', path: source, key: 'exact', save: 'true', 'lookup-only': 'true' };
    await invocation(inputs);
    expect(state.outputs['cache-found']).toBe('false');
    expect(state.uploads).toBe(0); expect(state.downloads).toBe(0);
    await invocation(inputs, true);
    expect(state.uploads).toBe(1); expect(state.errors).toEqual([]);
    expect([...state.objects.keys()].some(k => k.includes('/refs/pull/123/merge/'))).toBe(true);
  });
  it('uses the existing branch-authorized paths while isolating canonical PR refs', () => {
    for (const kind of ['cache', 'artifact'] as const) {
      const first = storage.prefix(kind, 'refs/pull/123/merge');
      expect(first).toBe(`cache/owner/repo/native-v1/feature/test/${kind}/refs/pull/123/merge/`);
      vi.stubEnv('GITHUB_REF', 'refs/pull/456/merge');
      expect(storage.prefix(kind, 'refs/pull/456/merge')).not.toBe(first);
      vi.stubEnv('GITHUB_REF', 'refs/pull/123/merge');
      expect(storage.prefix(kind, 'refs/heads/master')).toBe(`cache/owner/repo/native-v1/refs/heads/master/${kind}/refs/heads/master/`);
    }
  });
  it('requires the signed PR head scope instead of requesting an unauthorized canonical prefix', () => {
    vi.stubEnv('GITHUB_HEAD_REF', '');
    expect(() => storage.prefix('cache', storage.storageRef())).toThrow('GITHUB_HEAD_REF');
  });
  it('skips unsupported feature-base fallback reads under the existing credentials', async () => {
    const event = process.env.GITHUB_EVENT_PATH!;
    await fs.writeFile(event, JSON.stringify({ repository: { default_branch: 'master' }, pull_request: { base: { ref: 'feature-base' } } }));
    const send = vi.mocked(S3Client.prototype.send);
    await invocation({ operation: 'cache', path: source, key: 'missing', 'lookup-only': 'true' });
    const prefixes = send.mock.calls.map(([command]) => (command as ListObjectsV2Command).input.Prefix).filter(Boolean);
    expect(prefixes.some(prefix => prefix!.includes('/refs/heads/feature-base/'))).toBe(false);
    expect(state.errors).toEqual([]);
  });
  it('restores exactly once and never saves a read-only consumer', async () => {
    await producer(); await fs.rm(source, { recursive: true });
    const inputs = { operation: 'cache', path: source, key: 'exact', 'fail-on-cache-miss': 'true' };
    await invocation(inputs); await invocation(inputs, true);
    expect(state.outputs['cache-hit']).toBe('true'); expect(state.outputs['cache-restored']).toBe('true');
    expect(await fs.readFile(path.join(source, 'content'), 'utf8')).toBe('producer-content');
    expect(state.downloads).toBe(1); expect(state.uploads).toBe(1); expect(state.errors).toEqual([]);
  });
  it('round-trips scoped npm packages as literal paths instead of tar include directives', async () => {
    const scoped = path.join(source, '@angular-eslint', 'eslint-plugin');
    await fs.mkdir(scoped, { recursive: true });
    await fs.writeFile(path.join(scoped, 'index.js'), 'export default {}');
    await producer();
    expect(state.errors).toEqual([]);
    await fs.rm(source, { recursive: true });
    await invocation({ operation: 'cache', path: source, key: 'exact', 'fail-on-cache-miss': 'true' });
    expect(await fs.readFile(path.join(scoped, 'index.js'), 'utf8')).toBe('export default {}');
    expect(state.errors).toEqual([]);
  });
  it('keeps pure probes and read-only misses from publishing', async () => {
    const inputs = { operation: 'cache', path: source, key: 'missing', 'lookup-only': 'true' };
    await invocation(inputs); await invocation(inputs, true);
    expect(state.objects.size).toBe(0);
  });
  it('fails required misses', async () => {
    await invocation({ operation: 'cache', path: source, key: 'missing', 'fail-on-cache-miss': 'true' });
    expect(state.errors).toEqual(['Required S3 cache not found: missing']);
  });
  it('prefers an exact key to a newer extending key', async () => {
    await producer('key'); await producer('key-extension');
    await invocation({ operation: 'cache', path: source, key: 'key', 'lookup-only': 'true' });
    expect(state.outputs['cache-hit']).toBe('true'); expect(state.outputs['cache-matched-key']).toBe('key');
  });
  it('prefers current-ref partial matches to default-ref exact matches', async () => {
    await producer('prefix-old');
    vi.stubEnv('GITHUB_REF', 'refs/heads/master'); await producer('prefix-new');
    vi.stubEnv('GITHUB_REF', 'refs/pull/123/merge');
    await invocation({ operation: 'cache', path: source, key: 'prefix-new', 'restore-keys': 'prefix-', 'lookup-only': 'true' });
    expect(state.outputs['cache-hit']).toBe('false'); expect(state.outputs['cache-matched-key']).toBe('prefix-old');
  });
  it('reads the nondefault PR base before the repository default', async () => {
    vi.stubEnv('GITHUB_REF', 'refs/heads/branch-feature-base'); await producer();
    vi.stubEnv('GITHUB_REF', 'refs/heads/master'); await producer();
    vi.stubEnv('GITHUB_REF', 'refs/pull/123/merge');
    const get = vi.spyOn(storage, 'restore');
    await invocation({ operation: 'cache', path: source, key: 'exact' });
    expect(get.mock.calls[0][2].ref).toBe('refs/heads/branch-feature-base');
  });
  it('does not save an exact fallback hit or a merge-queue miss', async () => {
    vi.stubEnv('GITHUB_REF', 'refs/heads/master'); await producer();
    vi.stubEnv('GITHUB_REF', 'refs/pull/123/merge'); await producer();
    expect(state.uploads).toBe(1);
    vi.stubEnv('GITHUB_REF', 'refs/heads/gh-readonly-queue/master/pr-1'); await producer('new');
    expect(state.uploads).toBe(1);
  });
  it('does not treat an unresolved S3 conditional-write conflict as a successful competing producer', () => {
    expect(storage.isConflict({ name: 'ConditionalRequestConflict' })).toBe(false);
    expect(storage.isConflict({ name: 'PreconditionFailed' })).toBe(true);
  });
  it('keeps a committed payload when the conditional PUT retry conflicts with itself', async () => {
    const send = vi.mocked(S3Client.prototype.send);
    const original = send.getMockImplementation()!;
    send.mockImplementation(async (command: unknown) => {
      const result = await original(command);
      if (command instanceof PutObjectCommand) {
        // S3 accepted the first request; the SDK retried after losing its response.
        throw Object.assign(new Error('conflict'), { name: 'PreconditionFailed' });
      }
      return result;
    });
    await producer();
    expect(state.errors).toEqual([]);
    await fs.rm(source, { recursive: true });
    await invocation({ operation: 'cache', key: 'exact', path: source, 'fail-on-cache-miss': 'true' });
    expect(state.errors).toEqual([]);
    expect(await fs.readFile(path.join(source, 'content'), 'utf8')).toBe('producer-content');
    expect(state.objects.size).toBe(2);
  });
  it('keeps the payload when a manifest PUT fails with an uncertain outcome', async () => {
    const send = vi.mocked(S3Client.prototype.send);
    const original = send.getMockImplementation()!;
    send.mockImplementation(async (command: unknown) => {
      const result = await original(command);
      if (command instanceof PutObjectCommand) throw new Error('response timed out');
      return result;
    });
    await producer();
    expect(state.errors).toEqual(['response timed out']);
    expect(state.objects.size).toBe(2);
    state.errors = [];
    await fs.rm(source, { recursive: true });
    await invocation({ operation: 'cache', key: 'exact', path: source, 'fail-on-cache-miss': 'true' });
    expect(state.errors).toEqual([]);
    expect(await fs.readFile(path.join(source, 'content'), 'utf8')).toBe('producer-content');
  });
  it('commits manifests first-writer-wins and removes a losing payload', async () => {
    const client = await storage.clientFor('dev');
    const packed = await storage.archive(source, temp);
    const manifest = storage.manifestBase('cache', storage.storageRef(), 'x', false, 30);
    const key = storage.prefix('cache', storage.storageRef()) + 'x.json';
    await storage.publish(client, 'bucket', key, manifest, packed!.file);
    const first = state.objects.get(key)!.body.toString();
    await expect(storage.publish(client, 'bucket', key, manifest, packed!.file)).rejects.toThrow('conflict');
    expect(state.objects.get(key)!.body.toString()).toBe(first); expect(state.objects.size).toBe(2);
  });
});

describe('run artifacts', () => {
  const upload = () => invocation({ operation: 'upload', path: source, name: 'artifact', 'retention-days': '1' });
  const download = (destination: string) => invocation({ operation: 'download', path: destination, name: 'artifact' });
  it('restores the original producer after only a consumer is retried', async () => {
    await upload(); vi.stubEnv('GITHUB_RUN_ATTEMPT', '2');
    const target = path.join(temp, 'consumer'); await download(target);
    expect(state.outputs['producer-attempt']).toBe(1);
    expect(await fs.readFile(path.join(target, 'content'), 'utf8')).toBe('producer-content');
    expect(state.downloads).toBe(1); expect(state.errors).toEqual([]);
  });
  it('selects a successful producer rerun without replacing attempt one', async () => {
    await upload(); vi.stubEnv('GITHUB_RUN_ATTEMPT', '2');
    await fs.writeFile(path.join(source, 'content'), 'new'); await upload();
    const target = path.join(temp, 'consumer'); await download(target);
    expect(state.outputs['producer-attempt']).toBe(2);
    expect(await fs.readFile(path.join(target, 'content'), 'utf8')).toBe('new');
    expect([...state.objects.keys()].filter(k => k.endsWith('.json'))).toHaveLength(2);
  });
  it('rejects duplicate publication within one producer attempt', async () => {
    await upload(); await upload(); expect(state.errors).toEqual(['conflict']);
  });


  it('fails missing artifacts', async () => {
    await download(path.join(temp, 'consumer')); expect(state.errors[0]).toContain('Required S3 artifact not found');
  });
  it('rejects expired artifacts before fetching or extracting their payload', async () => {
    await upload();
    for (const [key, object] of state.objects) if (key.endsWith('.json')) {
      const m = JSON.parse(object.body.toString()); m.expiresAt = '2020-01-01'; object.body = Buffer.from(JSON.stringify(m));
    }
    await download(path.join(temp, 'consumer'));
    expect(state.errors[0]).toContain('expired'); expect(state.downloads).toBe(0);
  });
  it('verifies integrity before extracting anything', async () => {
    await upload();
    for (const [key, object] of state.objects) if (key.endsWith('.tgz')) object.body = Buffer.from('corrupt');
    const target = path.join(temp, 'consumer'); await download(target);
    expect(state.errors).toEqual(['S3 archive integrity check failed']);
    await expect(fs.stat(target)).rejects.toThrow();
  });

  it('preserves the root before wildcards and honors excluded directories', async () => {
    await fs.mkdir(path.join(source, 'module/target/site'), { recursive: true });
    await fs.writeFile(path.join(source, 'module/target/a.jar'), 'jar');
    await fs.writeFile(path.join(source, 'module/target/site/report'), 'report');
    await invocation({ operation: 'upload', name: 'artifact', path: `${source}/**/target/\n!${source}/**/target/site/`, 'retention-days': '1' });
    const target = path.join(temp, 'consumer'); await download(target);
    expect(await fs.readFile(path.join(target, 'module/target/a.jar'), 'utf8')).toBe('jar');
    await expect(fs.stat(path.join(target, 'module/target/site'))).rejects.toThrow();
  });
  it('omits hidden artifact files but retains hidden cache files and symlinks', async () => {
    await fs.writeFile(path.join(source, '.hidden'), 'hidden');
    if (process.platform !== 'win32') await fs.symlink('content', path.join(source, 'link'));
    await upload(); const target = path.join(temp, 'consumer'); await download(target);
    await expect(fs.stat(path.join(target, '.hidden'))).rejects.toThrow();
    await producer(); await fs.rm(source, { recursive: true });
    await invocation({ operation: 'cache', key: 'exact', path: source });
    expect(await fs.readFile(path.join(source, '.hidden'), 'utf8')).toBe('hidden');
    if (process.platform !== 'win32') expect(await fs.readlink(path.join(source, 'link'))).toBe('content');
  });

  it.each(['/absolute', '../escape', 'dir/../../escape', 'C:/escape', 'dir\\..\\escape'])('rejects unsafe archive entry %s', entry => {
    expect(storage.safeEntry(entry)).toBe(false);
  });
});
