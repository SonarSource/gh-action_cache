import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@actions/core', () => ({
  getState: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
  setFailed: vi.fn(),
}));
const runRunsOnSave = vi.fn();
vi.mock('../src/runs-on-save', () => ({ runRunsOnSave }));
const computeContentDigest = vi.fn(async () => 'FINAL_DIGEST');
vi.mock('../src/content-manifest', () => ({ computeContentDigest }));

import * as core from '@actions/core';

function setState(state: Record<string, string>) {
  vi.mocked(core.getState).mockImplementation((n: string) => state[n] ?? '');
}

const FALLBACK = 'refs/heads/master/gradle-abc';
const KEY = 'refs/heads/feature/x/gradle-abc';

// State for a skip-candidate (fallback restored, content baseline recorded).
function candidateState(overrides: Record<string, string> = {}) {
  return {
    key: KEY,
    path: 'node_modules',
    'matched-key': FALLBACK,
    'fallback-exact-key': FALLBACK,
    'lookup-only': 'false',
    'skip-redundant-save': 'true',
    'enable-cross-os-archive': 'false',
    'baseline-digest': 'DIGEST_A',
    ...overrides,
  };
}

describe('cache-save-post', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    runRunsOnSave.mockReset();
    computeContentDigest.mockReset();
    computeContentDigest.mockResolvedValue('DIGEST_A'); // default: content unchanged
  });

  it('skips when fallback restored AND content unchanged (final digest == baseline)', async () => {
    setState(candidateState());
    computeContentDigest.mockResolvedValue('DIGEST_A');

    const { run } = await import('../src/cache-save-post');
    await run();

    expect(computeContentDigest).toHaveBeenCalledWith('node_modules');
    expect(runRunsOnSave).not.toHaveBeenCalled();
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('identical'));
  });

  it('SAVES when content changed since restore (drift under stable key)', async () => {
    setState(candidateState());
    computeContentDigest.mockResolvedValue('DIGEST_B'); // differs from baseline DIGEST_A

    const { run } = await import('../src/cache-save-post');
    await run();

    expect(runRunsOnSave).toHaveBeenCalledWith({ key: KEY, path: 'node_modules', enableCrossOsArchive: false });
    expect(core.info).toHaveBeenCalledWith(expect.stringContaining('changed since restore'));
  });

  it('SAVES when the baseline digest is absent, without walking', async () => {
    setState(candidateState({ 'baseline-digest': '' }));

    const { run } = await import('../src/cache-save-post');
    await run();

    expect(computeContentDigest).not.toHaveBeenCalled();
    expect(runRunsOnSave).toHaveBeenCalledOnce();
  });

  it('saves the branch cache on a real cache miss', async () => {
    setState(candidateState({ 'matched-key': '', 'baseline-digest': '' }));

    const { run } = await import('../src/cache-save-post');
    await run();

    expect(runRunsOnSave).toHaveBeenCalledWith({ key: KEY, path: 'node_modules', enableCrossOsArchive: false });
  });

  it('saves when the optimization is disabled even if content matches', async () => {
    setState(candidateState({ 'skip-redundant-save': 'false', 'baseline-digest': '' }));

    const { run } = await import('../src/cache-save-post');
    await run();

    expect(runRunsOnSave).toHaveBeenCalledOnce();
  });

  it('does not save when lookup-only was set', async () => {
    setState(candidateState({ 'matched-key': '', 'lookup-only': 'true', 'baseline-digest': '' }));

    const { run } = await import('../src/cache-save-post');
    await run();

    expect(runRunsOnSave).not.toHaveBeenCalled();
  });

  it('warns and does not save when no key is in state', async () => {
    setState({});

    const { run } = await import('../src/cache-save-post');
    await run();

    expect(core.warning).toHaveBeenCalledWith(expect.stringContaining('No cache key'));
    expect(runRunsOnSave).not.toHaveBeenCalled();
  });
});
