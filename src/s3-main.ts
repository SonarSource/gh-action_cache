import * as core from '@actions/core';
import * as s from './s3-storage';
import type { S3Client } from '@aws-sdk/client-s3';

const input = (name: string) => core.getInput(name);
const required = (name: string) => core.getInput(name, { required: true });
const enabled = (name: string) => input(name) === 'true';

export async function fallbackRefs(current: string): Promise<string[]> {
  const event = process.env.GITHUB_EVENT_PATH ? JSON.parse(await (await import('node:fs/promises')).readFile(process.env.GITHUB_EVENT_PATH, 'utf8')) : {};
  let defaultBranch = event.repository?.default_branch;
  if (!defaultBranch) {
    const response = await fetch(`${process.env.GITHUB_API_URL || 'https://api.github.com'}/repos/${process.env.GITHUB_REPOSITORY}`, {
      headers: { Authorization: `Bearer ${required('github-token')}`, Accept: 'application/vnd.github+json' },
    });
    if (!response.ok) throw new Error(`Cannot resolve repository default branch: ${response.status}`);
    defaultBranch = ((await response.json()) as { default_branch: string }).default_branch;
  }
  const base = current.startsWith('refs/pull/') ? (event.pull_request?.base?.ref || process.env.GITHUB_BASE_REF) : undefined;
  return [...new Set([current, ...(base ? [`refs/heads/${base}`] : []), `refs/heads/${defaultBranch}`])];
}

async function findCache(client: S3Client, bucket: string, refs: string[], version: string, key: string, restoreKeys: string[]) {
  let selected: s.Manifest | undefined;
  for (const candidateRef of refs) {
    const root = `${s.prefix('cache', candidateRef)}${version}/`;
    const exactKey = root + `${encodeURIComponent(key)}.json`;
    // Prefix-scoped IAM can return 403 for a missing GET. List the exact name
    // first, and require equality so an extending key can never mask it.
    const exists = (await s.objects(client, bucket, exactKey)).some(object => object.Key === exactKey);
    const exact = exists ? await s.jsonObject(client, bucket, exactKey) : undefined;
    if (exact) {
      selected = s.validateManifest(exact, { kind: 'cache', ref: candidateRef, repository: process.env.GITHUB_REPOSITORY!, name: key });
      break;
    }
    for (const restoreKey of restoreKeys) {
      const candidates = (await s.objects(client, bucket, root + encodeURIComponent(restoreKey)))
        .filter(o => o.Key.endsWith('.json')).sort((a, b) => b.LastModified.getTime() - a.LastModified.getTime() || a.Key.localeCompare(b.Key));
      if (candidates.length) {
        const candidate = await s.jsonObject(client, bucket, candidates[0].Key) as s.Manifest;
        selected = s.validateManifest(candidate, { kind: 'cache', ref: candidateRef, repository: process.env.GITHUB_REPOSITORY!, name: candidate.name });
        break;
      }
    }
    if (selected) break;
  }
  return selected;
}

async function cache(post: boolean) {
  const paths = required('path');
  const key = required('key');
  const ref = s.storageRef();
  const version = s.cacheVersion(paths, enabled('enableCrossOsArchive'));
  const suffix = `${version}/${encodeURIComponent(key)}.json`;
  const environment = input('environment') || 'prod';
  const bucket = `sonarsource-s3-cache-${environment}-bucket`;
  const client = s.clientFor(environment);
  if (post) {
    if (core.getState('save') !== 'true') return;
    await s.temporary(async work => {
      const result = await s.archive(paths, work);
      if (!result) throw new Error('Cache producer succeeded without creating its declared paths');
      try {
        await s.publish(client, bucket, s.prefix('cache', ref) + suffix, s.manifestBase('cache', ref, key, result.rootIsFile, s.CACHE_RETENTION_DAYS), result.file);
        core.info(`Published S3 cache ${key}`);
      } catch (error) {
        if (!s.isConflict(error)) throw error;
        core.info('Another successful producer already published this cache key');
      }
    });
    return;
  }
  const selected = await findCache(client, bucket, await fallbackRefs(ref), version, key, s.lines(input('restore-keys')));
  const exact = selected?.name === key;
  core.setOutput('cache-hit', selected ? String(exact) : '');
  core.setOutput('cache-found', String(!!selected));
  core.setOutput('cache-restored', 'false');
  core.setOutput('cache-matched-key', selected?.name || '');
  if (enabled('save') && !exact && !ref.startsWith('refs/heads/gh-readonly-queue/')) core.saveState('save', 'true');
  if (!selected && enabled('fail-on-cache-miss')) throw new Error(`Required S3 cache not found: ${key}`);
  if (selected && !enabled('lookup-only')) {
    await s.temporary(async work => s.restore(client, bucket, selected!, await s.cacheDestination(paths, selected!.rootIsFile), work));
    core.setOutput('cache-restored', 'true');
  }
}

async function uploadArtifact(client: S3Client, bucket: string, root: string, ref: string, name: string, work: string) {
  if ((input('retention-days') || '1') !== '1') throw new Error('Build artifact storage requires the one-day bucket lifecycle');
  const result = await s.archive(required('path'), work, false);
  if (!result) {
    const policy = input('if-no-files-found') || 'warn';
    if (policy === 'error') throw new Error('No files found for the required artifact');
    if (policy === 'warn') core.warning(`No files found for artifact ${name}`);
    return;
  }
  const m = s.manifestBase('artifact', ref, name, result.rootIsFile, 1);
  const saved = await s.publish(client, bucket, `${root}${m.attempt}.json`, m, result.file);
  core.setOutput('artifact-digest', saved.digest);
  core.setOutput('producer-attempt', saved.attempt);
  core.info(`Published ${saved.bytes} bytes for ${name} (producer attempt ${saved.attempt})`);
}

async function artifact(operation: string) {
  const name = required('name');
  const runId = process.env.GITHUB_RUN_ID!;
  const ref = s.storageRef();
  const environment = input('environment') || 'prod';
  const bucket = `sonarsource-s3-cache-${environment}-bucket`;
  const client = s.clientFor(environment);
  const root = `${s.prefix('artifact', ref)}runs/${runId}/${encodeURIComponent(name)}/`;
  await s.temporary(async work => {
    if (operation === 'upload') {
      await uploadArtifact(client, bucket, root, ref, name, work);
    } else {
      // A retried consumer resolves the successful producer's stored attempt, not its own attempt number.
      const candidates = (await s.objects(client, bucket, root)).filter(o => /^\d+\.json$/.test(o.Key.slice(root.length)))
        .sort((a, b) => Number(b.Key.slice(root.length, -'.json'.length)) - Number(a.Key.slice(root.length, -'.json'.length)));
      if (!candidates.length) throw new Error(`Required S3 artifact not found: ${name} in run ${runId}`);
      const m = s.validateManifest(await s.jsonObject(client, bucket, candidates[0].Key), { kind: 'artifact', ref, repository: process.env.GITHUB_REPOSITORY!, name });
      if (m.runId !== runId) throw new Error('Artifact run provenance mismatch');
      await s.restore(client, bucket, m, s.destination(input('path') || process.env.GITHUB_WORKSPACE!), work);
      core.setOutput('artifact-digest', m.digest);
      core.setOutput('producer-attempt', m.attempt);
      core.info(`Restored ${m.bytes} bytes for ${name} from producer attempt ${m.attempt}`);
    }
  });
}

export async function run() {
  const start = Date.now();
  try {
    const post = core.getState('main') === 'true';
    const operation = required('operation');
    if (post) {
      if (operation === 'cache') await cache(true);
      return;
    }
    core.saveState('main', 'true');
    if (operation === 'cache') await cache(false);
    else if (operation === 'upload' || operation === 'download') await artifact(operation);
    else throw new Error(`Unsupported S3 operation: ${operation}`);
    core.info(`S3 ${operation} completed in ${((Date.now() - start) / 1000).toFixed(1)}s`);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}
if (!process.env.VITEST) void run();
