import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  getBooleanInput: vi.fn(),
  saveState: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn(),
}));

import * as core from '@actions/core';

describe('cache-save-main', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it('records key, path, matched-key, fallback-exact-key, and flags into state', async () => {
    vi.mocked(core.getInput).mockImplementation((n: string) => ({
      key: 'refs/heads/feature/x/gradle-abc',
      path: 'node_modules',
      'matched-key': 'refs/heads/master/gradle-abc',
      'fallback-exact-key': 'refs/heads/master/gradle-abc',
    }[n] ?? ''));
    vi.mocked(core.getBooleanInput).mockImplementation((n: string) => ({
      'lookup-only': false,
      'enable-cross-os-archive': false,
      'skip-redundant-save': true,
    }[n] ?? false));

    const { run } = await import('../src/cache-save-main');
    await run();

    expect(core.saveState).toHaveBeenCalledWith('key', 'refs/heads/feature/x/gradle-abc');
    expect(core.saveState).toHaveBeenCalledWith('path', 'node_modules');
    expect(core.saveState).toHaveBeenCalledWith('matched-key', 'refs/heads/master/gradle-abc');
    expect(core.saveState).toHaveBeenCalledWith('fallback-exact-key', 'refs/heads/master/gradle-abc');
    expect(core.saveState).toHaveBeenCalledWith('lookup-only', 'false');
    expect(core.saveState).toHaveBeenCalledWith('skip-redundant-save', 'true');
    expect(core.saveState).toHaveBeenCalledWith('enable-cross-os-archive', 'false');
  });

  it('calls setFailed when an input read throws', async () => {
    vi.mocked(core.getInput).mockImplementation(() => { throw new Error('boom'); });
    const { run } = await import('../src/cache-save-main');
    await run();
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('cache-save setup failed'));
  });
});
