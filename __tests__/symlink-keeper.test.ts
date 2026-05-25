import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import * as os from 'node:os';

vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  saveState: vi.fn(),
  getState: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}));

import * as core from '@actions/core';

describe('symlink-keeper-main', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('saves cache-metrics-action-path to GITHUB_STATE when provided', async () => {
    const metricsPath = path.join(os.tmpdir(), 'action', 'cache-metrics');
    vi.mocked(core.getInput).mockReturnValue(metricsPath);

    const { run } = await import('../src/symlink-keeper-main');
    await run();

    expect(core.saveState).toHaveBeenCalledWith('cache-metrics-action-path', metricsPath);
  });

  it('does not save state when input is empty', async () => {
    vi.mocked(core.getInput).mockReturnValue('');

    const { run } = await import('../src/symlink-keeper-main');
    await run();

    expect(core.saveState).not.toHaveBeenCalled();
  });
});

describe('symlink-keeper-post', () => {
  let tmpDir: string;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'keeper-test-'));
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  it('skips when target is empty (CI_METRICS_ENABLED unset)', async () => {
    const { ensureCacheMetricsSymlink } = await import('../src/symlink-keeper-post');
    await ensureCacheMetricsSymlink('');

    expect(core.warning).not.toHaveBeenCalled();
    expect(core.info).not.toHaveBeenCalled();
  });

  it('leaves existing symlink alone when target action.yml is reachable', async () => {
    // Layout: <tmp>/source/cache-metrics/action.yml is the canonical target.
    //         <tmp>/workspace/.actions/cache-metrics is an existing symlink to it.
    const source = path.join(tmpDir, 'source', 'cache-metrics');
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, 'action.yml'), 'name: dummy\n');
    const workspace = path.join(tmpDir, 'workspace');
    await fs.mkdir(path.join(workspace, '.actions'), { recursive: true });
    await fs.symlink(source, path.join(workspace, '.actions', 'cache-metrics'));

    const prevCwd = process.cwd();
    process.chdir(workspace);
    try {
      const { ensureCacheMetricsSymlink } = await import('../src/symlink-keeper-post');
      await ensureCacheMetricsSymlink(source);
    } finally {
      process.chdir(prevCwd);
    }

    // No recreation log fired — the existing symlink was left untouched.
    expect(core.info).not.toHaveBeenCalledWith(expect.stringContaining('recreated'));
    // Sanity: still a symlink pointing at source.
    const linkTarget = await fs.readlink(path.join(workspace, '.actions', 'cache-metrics'));
    expect(linkTarget).toBe(source);
  });

  it('recreates the symlink when missing', async () => {
    const source = path.join(tmpDir, 'source', 'cache-metrics');
    await fs.mkdir(source, { recursive: true });
    await fs.writeFile(path.join(source, 'action.yml'), 'name: dummy\n');
    const workspace = path.join(tmpDir, 'workspace');
    await fs.mkdir(workspace, { recursive: true });

    const prevCwd = process.cwd();
    process.chdir(workspace);
    try {
      const { ensureCacheMetricsSymlink } = await import('../src/symlink-keeper-post');
      await ensureCacheMetricsSymlink(source);
    } finally {
      process.chdir(prevCwd);
    }

    const linkTarget = await fs.readlink(path.join(workspace, '.actions', 'cache-metrics'));
    expect(linkTarget).toBe(source);
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('recreated'));
  });

  it('warns and skips when target action.yml is missing', async () => {
    const missingSource = path.join(tmpDir, 'no-such-source', 'cache-metrics');
    const workspace = path.join(tmpDir, 'workspace');
    await fs.mkdir(workspace, { recursive: true });

    const prevCwd = process.cwd();
    process.chdir(workspace);
    try {
      const { ensureCacheMetricsSymlink } = await import('../src/symlink-keeper-post');
      await ensureCacheMetricsSymlink(missingSource);
    } finally {
      process.chdir(prevCwd);
    }

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('target action.yml missing'));
    const linkExists = await fs
      .access(path.join(workspace, '.actions', 'cache-metrics'))
      .then(() => true)
      .catch(() => false);
    expect(linkExists).toBe(false);
  });
});
