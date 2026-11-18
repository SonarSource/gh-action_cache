import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import * as core from '@actions/core';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { run } from '../src/artifact';

vi.mock('@actions/core', () => ({ getInput: vi.fn(), setOutput: vi.fn(), setFailed: vi.fn(), warning: vi.fn(), info: vi.fn(), debug: vi.fn() }));
let directory: string;
let inputs: Record<string, string>;
let outputs: Record<string, string>;
const staging = path.resolve('.ci-artifact');
beforeEach(async () => {
  vi.clearAllMocks();
  directory = await fs.mkdtemp(path.join(os.tmpdir(), 'artifact-policy-'));
  inputs = { operation: 'upload', phase: 'prepare', key: 'build-output' };
  outputs = {};
  vi.mocked(core.getInput).mockImplementation(name => inputs[name] ?? '');
  vi.mocked(core.setOutput).mockImplementation((name, value) => { outputs[name] = String(value); });
  vi.stubEnv('GITHUB_RUN_ID', '123');
  vi.stubEnv('GITHUB_RUN_ATTEMPT', '2');
  vi.stubEnv('GITHUB_WORKSPACE', directory);
});
afterEach(async () => {
  vi.unstubAllEnvs();
  await fs.rm(directory, { recursive: true, force: true });
  await fs.rm(staging, { recursive: true, force: true });
});

async function upload(pattern: string) {
  inputs.path = pattern;
  await run();
  expect(core.setFailed).not.toHaveBeenCalled();
}
async function download() {
  inputs = { operation: 'download', phase: 'finish', key: outputs.key, path: path.join(directory, 'restored') };
  await run();
}

it('restores directory contents at the requested destination using the original producer attempt', async () => {
  const source = path.join(directory, 'source');
  await fs.mkdir(path.join(source, '@scope'), { recursive: true });
  await fs.writeFile(path.join(source, '@scope', 'package.json'), 'scoped package');
  await fs.writeFile(path.join(source, '.hidden'), 'excluded');
  await upload(source);
  expect(outputs.key).toBe('artifacts/123/2/build-output/');
  expect(outputs.path).toBe('.ci-artifact');
  vi.stubEnv('GITHUB_RUN_ATTEMPT', '3');
  await download();
  expect(core.setFailed).not.toHaveBeenCalled();
  expect(await fs.readFile(path.join(inputs.path, '@scope', 'package.json'), 'utf8')).toBe('scoped package');
  await expect(fs.stat(path.join(inputs.path, '.hidden'))).rejects.toThrow();
});

it('preserves a single filename and excludes ignored subtrees from a multi-directory archive', async () => {
  for (const file of ['a/target/result', 'b/target/result', 'a/target/site/ignored']) {
    await fs.mkdir(path.dirname(path.join(directory, file)), { recursive: true });
    await fs.writeFile(path.join(directory, file), file);
  }
  await upload(`${directory}/**/target/\n!${directory}/**/target/site/`);
  await download();
  expect(core.setFailed).not.toHaveBeenCalled();
  expect(await fs.readFile(path.join(inputs.path, 'a/target/result'), 'utf8')).toBe('a/target/result');
  await expect(fs.stat(path.join(inputs.path, 'a/target/site/ignored'))).rejects.toThrow();
  await fs.writeFile(path.join(directory, 'single.tgz'), 'one file');
  inputs = { operation: 'upload', phase: 'prepare', key: 'single', path: path.join(directory, 'single.tgz') };
  await run();
  await download();
  expect(await fs.readFile(path.join(inputs.path, 'single.tgz'), 'utf8')).toBe('one file');
});

it.each(['error', 'warn', 'ignore'])('enforces the %s policy for empty uploads', async policy => {
  inputs.path = path.join(directory, 'missing');
  inputs['if-no-files-found'] = policy;
  await run();
  expect(core.setFailed).toHaveBeenCalledTimes(policy === 'error' ? 1 : 0);
  expect(core.warning).toHaveBeenCalledTimes(policy === 'warn' ? 1 : 0);
  expect(outputs.ready).not.toBe('true');
});

it.each(['digest', 'identity', 'expiry'])('rejects artifact %s violations before extraction', async violation => {
  await fs.writeFile(path.join(directory, 'payload'), 'content');
  await upload(path.join(directory, 'payload'));
  const file = path.join(staging, 'metadata.json');
  const metadata = JSON.parse(await fs.readFile(file, 'utf8'));
  if (violation === 'digest') metadata.digest = 'corrupted';
  if (violation === 'identity') metadata.key += 'different';
  if (violation === 'expiry') metadata.createdAt -= 86400001;
  await fs.writeFile(file, JSON.stringify(metadata));
  await download();
  expect(core.setFailed).toHaveBeenCalledOnce();
  await expect(fs.stat(inputs.path)).rejects.toThrow();
});

it('rejects a concrete key from another workflow run before any transfer', async () => {
  inputs = { operation: 'download', phase: 'prepare', key: 'artifacts/999/1/build-output/' };
  await run();
  expect(core.setFailed).toHaveBeenCalledWith('Artifacts must come from this workflow run');
  expect(outputs.ready).toBeUndefined();
});

it('stages a real helper directory for container loaders and runs it inside ESM callers', async () => {
  const { execFileSync } = await import('node:child_process');
  const { parse } = await import('yaml');
  const caller = path.join(directory, 'caller');
  await fs.mkdir(caller);
  await fs.writeFile(path.join(caller, 'package.json'), '{"type":"module"}');
  await fs.writeFile(path.join(caller, 'result'), 'content');
  const helper = path.join(caller, '.actions', 'cache-artifact');
  const action = parse(await fs.readFile('action.yml', 'utf8'));
  const prepare = action.runs.steps.find((step: { name: string }) => step.name === 'Prepare artifact helper');
  for (let attempt = 0; attempt < 2; attempt++) {
    execFileSync('bash', ['-e', '-c', prepare.run], { cwd: caller, env: {
      ...process.env, OPERATION: 'upload', ACTION_PATH_CACHE: path.resolve('.'), GITHUB_ENV: path.join(caller, 'environment'),
    }, stdio: 'pipe' });
  }
  expect((await fs.lstat(helper)).isSymbolicLink()).toBe(false);
  expect(await fs.readFile(path.join(helper, 'action.yml'), 'utf8')).toContain('using: node24');
  execFileSync(process.execPath, [path.join(helper, 'dist/index.js')], { cwd: caller, env: {
    ...process.env, VITEST: '', INPUT_OPERATION: 'upload', INPUT_PHASE: 'prepare', INPUT_KEY: 'fixture',
    INPUT_PATH: path.join(caller, 'result'), GITHUB_WORKSPACE: caller,
  }, stdio: 'pipe' });
  expect(JSON.parse(await fs.readFile(path.join(caller, '.ci-artifact', 'metadata.json'), 'utf8')).key)
    .toBe('artifacts/123/2/fixture/');
});
