import * as core from '@actions/core';
import * as glob from '@actions/glob';
import * as tar from 'tar';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';
import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

// Keep the backend's path/version identical across producers, consumers and operating systems.
const staging = '.ci-artifact';
const payload = path.resolve(staging, 'payload.tar');
const metadata = path.resolve(staging, 'metadata.json');
const DAY = 86400000;
const expand = (value: string) => value.replace(/^~(?=[/\\]|$)/, os.homedir());

function commonRoot(roots: string[]): string {
  let root = path.resolve(roots[0]);
  for (const item of roots.slice(1)) {
    while (path.relative(root, item).startsWith(`..${path.sep}`) || path.relative(root, item) === '..' || path.isAbsolute(path.relative(root, item))) {
      const parent = path.dirname(root);
      if (parent === root) throw new Error('Artifact paths must share one filesystem volume');
      root = parent;
    }
  }
  return root;
}

async function digest(): Promise<string> {
  const hash = createHash('sha256');
  for await (const chunk of createReadStream(payload)) hash.update(chunk);
  return hash.digest('hex');
}

async function prepare(upload: boolean, key: string) {
  await fs.rm(staging, { recursive: true, force: true });
  if (upload) {
    const matcher = await glob.create(core.getInput('path', { required: true }), {
      followSymbolicLinks: false, matchDirectories: true, implicitDescendants: true, excludeHiddenFiles: true,
    });
    const files = await matcher.glob();
    if (!files.length) {
      const policy = core.getInput('if-no-files-found') || 'warn';
      if (policy === 'error') throw new Error('No files found for the required artifact');
      if (policy === 'warn') core.warning('No files found for artifact');
      core.setOutput('ready', 'false');
      return;
    }
    const roots = matcher.getSearchPaths();
    const root = roots.length === 1 && !(await fs.lstat(roots[0])).isDirectory() ? path.dirname(roots[0]) : commonRoot(roots);
    await fs.mkdir(staging, { recursive: true });
    // A literal ./ prefix prevents scoped npm paths from being interpreted as tar directives.
    const entries = files.map(file => `./${path.relative(root, file).split(path.sep).join('/') || '.'}`);
    await tar.c({ cwd: root, file: payload, portable: true, noDirRecurse: true }, entries);
    await fs.writeFile(metadata, JSON.stringify({ key, createdAt: Date.now(), digest: await digest(), bytes: (await fs.stat(payload)).size }));
  }
  core.setOutput('path', staging);
  core.setOutput('key', key);
  core.setOutput('ready', 'true');
}

async function finish(upload: boolean, key: string) {
  if (!upload) {
    const m = JSON.parse(await fs.readFile(metadata, 'utf8'));
    if (m.key !== key || !Number.isFinite(m.createdAt) || Date.now() - m.createdAt > DAY) {
      throw new Error('Artifact identity mismatch or one-day availability expired');
    }
    if (m.bytes !== (await fs.stat(payload)).size || m.digest !== await digest()) throw new Error('Artifact integrity check failed');
    await tar.t({ file: payload, onReadEntry: entry => {
      if (path.posix.isAbsolute(entry.path) || /^[A-Za-z]:/.test(entry.path) || entry.path.replaceAll('\\', '/').split('/').includes('..')) {
        throw new Error('Unsafe artifact archive entry');
      }
    } });
    const destination = path.resolve(expand(core.getInput('path') || process.env.GITHUB_WORKSPACE!));
    await fs.mkdir(destination, { recursive: true });
    await tar.x({ file: payload, cwd: destination, strict: true, preservePaths: false });
  }
  await fs.rm(staging, { recursive: true, force: true });
}

export async function run() {
  try {
    const upload = core.getInput('operation') === 'upload';
    const name = core.getInput('key', { required: true });
    const run = `artifacts/${process.env.GITHUB_RUN_ID}/`;
    const key = upload ? `${run}${process.env.GITHUB_RUN_ATTEMPT}/${encodeURIComponent(name)}/` : name;
    if (!key.startsWith(run)) throw new Error('Artifacts must come from this workflow run');
    if (core.getInput('phase') === 'prepare') await prepare(upload, key);
    else await finish(upload, key);
  } catch (error) {
    core.setFailed(error instanceof Error ? error.message : String(error));
  }
}
if (!process.env.VITEST) void run();
