import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@actions/core', () => ({
  getState: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  setFailed: vi.fn(),
}));
const runRunsOnSave = vi.fn();
vi.mock('../src/runs-on-save', () => ({ runRunsOnSave }));

import * as core from '@actions/core';

function setState(state: Record<string, string>) {
  vi.mocked(core.getState).mockImplementation((n: string) => state[n] ?? '');
}

describe('cache-save-post', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    runRunsOnSave.mockReset();
  });

  it('skips the save when content was restored from the default-branch fallback', async () => {
    setState({
      key: 'refs/heads/feature/x/gradle-abc',
      path: 'node_modules',
      'matched-key': 'refs/heads/master/gradle-abc',
      'fallback-exact-key': 'refs/heads/master/gradle-abc',
      'lookup-only': 'false',
      'skip-redundant-save': 'true',
      'enable-cross-os-archive': 'false',
    });

    const { run } = await import('../src/cache-save-post');
    await run();

    expect(runRunsOnSave).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('identical'));
  });

  it('saves the branch cache on a real cache miss', async () => {
    setState({
      key: 'refs/heads/feature/x/gradle-abc',
      path: 'node_modules',
      'matched-key': '',
      'fallback-exact-key': 'refs/heads/master/gradle-abc',
      'lookup-only': 'false',
      'skip-redundant-save': 'true',
      'enable-cross-os-archive': 'false',
    });

    const { run } = await import('../src/cache-save-post');
    await run();

    expect(runRunsOnSave).toHaveBeenCalledWith({
      key: 'refs/heads/feature/x/gradle-abc',
      path: 'node_modules',
      enableCrossOsArchive: false,
    });
  });

  it('saves when the optimization is disabled even if content matches', async () => {
    setState({
      key: 'refs/heads/feature/x/gradle-abc',
      path: 'node_modules',
      'matched-key': 'refs/heads/master/gradle-abc',
      'fallback-exact-key': 'refs/heads/master/gradle-abc',
      'lookup-only': 'false',
      'skip-redundant-save': 'false',
      'enable-cross-os-archive': 'false',
    });

    const { run } = await import('../src/cache-save-post');
    await run();

    expect(runRunsOnSave).toHaveBeenCalledOnce();
  });

  it('does not save when lookup-only was set', async () => {
    setState({
      key: 'refs/heads/feature/x/gradle-abc',
      path: 'node_modules',
      'matched-key': '',
      'fallback-exact-key': 'refs/heads/master/gradle-abc',
      'lookup-only': 'true',
      'skip-redundant-save': 'true',
      'enable-cross-os-archive': 'false',
    });
    const { run } = await import('../src/cache-save-post');
    await run();
    expect(runRunsOnSave).not.toHaveBeenCalled();
  });

  it('warns and does not save when no key is in state', async () => {
    setState({}); // all empty
    const { run } = await import('../src/cache-save-post');
    await run();
    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('No cache key'));
    expect(runRunsOnSave).not.toHaveBeenCalled();
  });
});
