import { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectsCommand, paginateListObjectsV2 } from '@aws-sdk/client-s3';
import { Upload } from '@aws-sdk/lib-storage';
import { createHash, randomUUID } from 'node:crypto';
import { createReadStream, createWriteStream } from 'node:fs';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { pipeline } from 'node:stream/promises';
import { Readable } from 'node:stream';
import * as glob from '@actions/glob';
import * as tar from 'tar';
import { getCognitoCredentials } from './auth';
import { POOL_IDS, ACCOUNT_IDS, AWS_REGION } from './environment';

const HTTP_NOT_FOUND = 404;
const HTTP_PRECONDITION_FAILED = 412;
const MILLISECONDS_PER_DAY = 86400000;

export const CACHE_RETENTION_DAYS = 30;

export interface Manifest {
  schema: 1;
  kind: 'cache' | 'artifact';
  repository: string;
  ref: string;
  name: string;
  runId: string;
  attempt: number;
  sha: string;
  job: string;
  object: string;
  digest: string;
  bytes: number;
  rootIsFile: boolean;
  expiresAt: string;
}

export const hash = (value: string) => createHash('sha256').update(value).digest('hex');
export const lines = (value: string) => value.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
export function storageRef(env = process.env): string {
  const ref = env.GITHUB_REF || '';
  if (!/^refs\/(heads|pull|tags)\//.test(ref) || ref.split('/').some(p => p === '..' || p === '.')) {
    throw new Error(`Unsupported storage ref: ${ref}`);
  }
  return ref;
}
export function prefix(kind: 'cache' | 'artifact', ref: string, repository = process.env.GITHUB_REPOSITORY!): string {
  // Reuse the deployed role's cache/<repository>/<version>/<head_ref-or-ref> scope.
  // Keep the canonical ref inside it so separate PRs from the same branch never share results.
  const scope = ref.startsWith('refs/pull/') && ref === storageRef() ? process.env.GITHUB_HEAD_REF : ref;
  if (!scope || scope.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new Error('A pull-request storage scope requires GITHUB_HEAD_REF');
  }
  return `cache/${repository}/native-v1/${scope}/${kind}/${ref}/`;
}
export function cacheVersion(paths: string, crossOs: boolean): string {
  return hash(JSON.stringify([lines(paths), crossOs ? 'cross-os' : process.platform, 'tar-gzip-v1']));
}
export function commonRoot(roots: string[]): string {
  let root = path.resolve(roots[0]);
  for (const item of roots.slice(1)) {
    while (path.relative(root, item).startsWith(`..${path.sep}`) || path.relative(root, item) === '..' || path.isAbsolute(path.relative(root, item))) {
      const parent = path.dirname(root);
      if (parent === root) throw new Error('Paths on different filesystem volumes cannot share one archive');
      root = parent;
    }
  }
  return root;
}
export function safeEntry(entry: string): boolean {
  return !path.posix.isAbsolute(entry) && !/^[A-Za-z]:/.test(entry) && !entry.replaceAll('\\', '/').split('/').includes('..');
}
export function validateManifest(value: unknown, expected: Pick<Manifest, 'kind' | 'repository' | 'ref' | 'name'>, now = Date.now()): Manifest {
  const m = value as Manifest;
  if (m?.schema !== 1 || Object.entries(expected).some(([k, v]) => m[k as keyof Manifest] !== v) ||
      !Number.isSafeInteger(m.attempt) || m.attempt < 1 || !Number.isSafeInteger(m.bytes) || m.bytes < 0 ||
      !/^[a-f0-9]{64}$/.test(m.digest) || typeof m.rootIsFile !== 'boolean' ||
      !m.object?.startsWith(`${prefix(expected.kind, expected.ref, expected.repository)}objects/`) ||
      !Number.isFinite(Date.parse(m.expiresAt)) || (expected.kind === 'artifact' && Date.parse(m.expiresAt) <= now)) {
    throw new Error('Invalid, mismatched, or expired S3 manifest');
  }
  return m;
}
export function isMissing(error: unknown): boolean {
  return ['NoSuchKey', 'NotFound'].includes((error as Error)?.name) ||
    (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === HTTP_NOT_FOUND;
}
export function isConflict(error: unknown): boolean {
  return (error as Error)?.name === 'PreconditionFailed' ||
    (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode === HTTP_PRECONDITION_FAILED;
}
export function clientFor(environment: string): S3Client {
  if (!POOL_IDS[environment]) throw new Error(`Unknown environment: ${environment}`);
  return new S3Client({
    region: AWS_REGION,
    // An explicit refreshing provider never consults or exports the caller's AWS credentials.
    credentials: async () => {
      const credentials = await getCognitoCredentials({ poolId: POOL_IDS[environment], accountId: ACCOUNT_IDS[environment], region: AWS_REGION });
      return { ...credentials, expiration: new Date(credentials.expiration) };
    },
  });
}
export async function jsonObject(client: S3Client, bucket: string, key: string): Promise<unknown> {
  try {
    const { Body } = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!Body) throw new Error(`Empty S3 response for ${key}`);
    return JSON.parse(await Body.transformToString());
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}
export async function objects(client: S3Client, bucket: string, objectPrefix: string) {
  const result: { Key: string; LastModified: Date }[] = [];
  for await (const page of paginateListObjectsV2({ client }, { Bucket: bucket, Prefix: objectPrefix })) {
    for (const object of page.Contents || []) {
      if (object.Key && object.LastModified) result.push({ Key: object.Key, LastModified: object.LastModified });
    }
  }
  return result;
}
export async function archive(paths: string, work: string, includeHidden = true): Promise<{ file: string; rootIsFile: boolean } | undefined> {
  const matcher = await glob.create(paths, { followSymbolicLinks: false, matchDirectories: true, implicitDescendants: true, excludeHiddenFiles: !includeHidden });
  const files = await matcher.glob();
  if (!files.length) return undefined;
  const roots = matcher.getSearchPaths();
  const rootIsFile = roots.length === 1 && !(await fs.lstat(roots[0])).isDirectory();
  const root = rootIsFile ? path.dirname(roots[0]) : commonRoot(roots);
  // tar treats a leading @ as an instruction to read another archive. Prefix literal paths.
  const entries = files.map(file => `./${path.relative(root, file).split(path.sep).join('/') || '.'}`);
  if (entries.some(entry => !safeEntry(entry))) throw new Error('Archive path escapes its root');
  const file = path.join(work, 'payload.tgz');
  await tar.c({ cwd: root, file, gzip: { level: 1 }, portable: true, noDirRecurse: true }, entries);
  return { file, rootIsFile };
}
export async function digestFile(file: string): Promise<string> {
  const digest = createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
export async function publish(client: S3Client, bucket: string, manifestKey: string, m: Omit<Manifest, 'digest' | 'bytes' | 'object'>, file: string): Promise<Manifest> {
  const object = `${prefix(m.kind, m.ref, m.repository)}objects/${randomUUID()}.tgz`;
  const digest = await digestFile(file);
  const bytes = (await fs.stat(file)).size;
  await new Upload({ client, params: { Bucket: bucket, Key: object, Body: createReadStream(file), ContentLength: bytes }, partSize: 16 * 1024 * 1024, queueSize: 4 }).done();
  const manifest = { ...m, object, digest, bytes };
  try {
    // Commit only a complete payload, atomically. Concurrent producers cannot replace an existing result.
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: manifestKey, Body: JSON.stringify(manifest), ContentType: 'application/json', IfNoneMatch: '*' }));
  } catch (error) {
    await client.send(new DeleteObjectsCommand({ Bucket: bucket, Delete: { Objects: [{ Key: object }] } }));
    throw error;
  }
  return manifest;
}
export function destination(value: string): string {
  return path.resolve(value.replace(/^~(?=[/\\]|$)/, os.homedir()));
}
export async function restore(client: S3Client, bucket: string, m: Manifest, destination: string, work: string) {
  const file = path.join(work, 'download.tgz');
  const { Body } = await client.send(new GetObjectCommand({ Bucket: bucket, Key: m.object }));
  if (!Body) throw new Error('S3 payload has no body');
  await pipeline(Body as Readable, createWriteStream(file));
  if ((await fs.stat(file)).size !== m.bytes || await digestFile(file) !== m.digest) throw new Error('S3 archive integrity check failed');
  // Validate every entry before writing anything. tar also blocks extraction through symlink parents.
  await tar.t({ file, onReadEntry: entry => { if (!safeEntry(entry.path)) throw new Error('Unsafe archive entry'); } });
  await fs.mkdir(destination, { recursive: true });
  await tar.x({ file, cwd: destination, strict: true, preservePaths: false });
}
export async function cacheDestination(paths: string, rootIsFile: boolean): Promise<string> {
  const matcher = await glob.create(paths, { followSymbolicLinks: false });
  const roots = matcher.getSearchPaths();
  return rootIsFile ? path.dirname(roots[0]) : commonRoot(roots);
}
export async function temporary<T>(fn: (work: string) => Promise<T>): Promise<T> {
  const work = await fs.mkdtemp(path.join(os.tmpdir(), 's3-ci-'));
  try { return await fn(work); } finally { await fs.rm(work, { recursive: true, force: true }); }
}
export function manifestBase(kind: Manifest['kind'], ref: string, name: string, rootIsFile: boolean, days: number): Omit<Manifest, 'digest' | 'bytes' | 'object'> {
  return {
    schema: 1, kind, repository: process.env.GITHUB_REPOSITORY!, ref, name, rootIsFile,
    runId: process.env.GITHUB_RUN_ID!, attempt: Number(process.env.GITHUB_RUN_ATTEMPT || '1'),
    sha: process.env.GITHUB_SHA!, job: process.env.GITHUB_JOB!,
    expiresAt: new Date(Date.now() + days * MILLISECONDS_PER_DAY).toISOString(),
  };
}
