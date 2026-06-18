import { describe, it, expect, vi, beforeEach } from 'vitest';

// vi.mock is hoisted above module-level declarations, so the shared mock state it
// closes over must be created via vi.hoisted() to avoid a temporal-dead-zone error.
const { onHandlers, fakeChild, fork } = vi.hoisted(() => {
  const onHandlers: Record<string, (...a: any[]) => void> = {};
  const fakeChild: any = {
    on: vi.fn((evt: string, cb: (...a: any[]) => void) => { onHandlers[evt] = cb; return fakeChild; }),
  };
  const fork = vi.fn(() => fakeChild);
  return { onHandlers, fakeChild, fork };
});
vi.mock('child_process', () => ({ fork }));

import { runRunsOnSave } from '../src/runs-on-save';

describe('runRunsOnSave', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    for (const k of Object.keys(onHandlers)) delete onHandlers[k];
  });

  it('forks the vendored bundle with INPUT_* env and resolves on exit 0', async () => {
    const p = runRunsOnSave({ key: 'refs/heads/feature/x/gradle-abc', path: 'node_modules', enableCrossOsArchive: false });
    // simulate successful child exit
    onHandlers['exit'](0, null);
    await expect(p).resolves.toBeUndefined();

    expect(fork).toHaveBeenCalledTimes(1);
    const [scriptPath, args, opts] = fork.mock.calls[0] as any[];
    expect(scriptPath).toContain('runs-on-save-only');
    expect(scriptPath).toContain('index.js');
    expect(opts.env.INPUT_KEY).toBe('refs/heads/feature/x/gradle-abc');
    expect(opts.env.INPUT_PATH).toBe('node_modules');
    expect(opts.env.INPUT_ENABLECROSSOSARCHIVE).toBe('false');
  });

  it('resolves the vendored bundle outside the dist/post dir', () => {
    const p = runRunsOnSave({ key: 'k', path: 'p', enableCrossOsArchive: false });
    onHandlers['exit'](0, null);
    const [scriptPath] = fork.mock.calls[0] as any[];
    const norm = scriptPath.replace(/\\/g, '/');
    expect(norm.endsWith('/vendor/runs-on-save-only/index.js')).toBe(true);
    expect(norm.includes('/dist/')).toBe(false);
    return p;
  });

  it('rejects when the child exits non-zero', async () => {
    const p = runRunsOnSave({ key: 'k', path: 'p', enableCrossOsArchive: false });
    onHandlers['exit'](1, null);
    await expect(p).rejects.toThrow(/exit code 1/);
  });
});
