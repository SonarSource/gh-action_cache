import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('@actions/core', () => ({
  getInput: vi.fn(),
  getBooleanInput: vi.fn(),
  saveState: vi.fn(),
  info: vi.fn(),
  setFailed: vi.fn(),
}));
const computeContentDigest = vi.fn(async () => 'BASELINE_DIGEST');
vi.mock('../src/content-manifest', () => ({ computeContentDigest }));

import * as core from '@actions/core';

type Inputs = Record<string, string>;
type Bools = Record<string, boolean>;

function mockInputs(inputs: Inputs, bools: Bools) {
  vi.mocked(core.getInput).mockImplementation((n: string) => inputs[n] ?? '');
  vi.mocked(core.getBooleanInput).mockImplementation((n: string) => bools[n] ?? false);
}

const CANDIDATE_INPUTS: Inputs = {
  key: 'refs/heads/feature/x/gradle-abc',
  path: 'node_modules',
  'matched-key': 'refs/heads/master/gradle-abc',
  'fallback-exact-key': 'refs/heads/master/gradle-abc',
};
const CANDIDATE_BOOLS: Bools = {
  'lookup-only': false,
  'enable-cross-os-archive': false,
  'skip-redundant-save': true,
};

describe('cache-save-main', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
    computeContentDigest.mockClear();
    computeContentDigest.mockResolvedValue('BASELINE_DIGEST');
  });

  it('records key, path, matched-key, fallback-exact-key, and flags into state', async () => {
    mockInputs(CANDIDATE_INPUTS, CANDIDATE_BOOLS);

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

  it('computes and stores a baseline digest when it is a skip candidate', async () => {
    mockInputs(CANDIDATE_INPUTS, CANDIDATE_BOOLS);

    const { run } = await import('../src/cache-save-main');
    await run();

    expect(computeContentDigest).toHaveBeenCalledWith('node_modules');
    expect(core.saveState).toHaveBeenCalledWith('baseline-digest', 'BASELINE_DIGEST');
  });

  it('does NOT walk and stores empty baseline on a cache miss (matched != fallback)', async () => {
    mockInputs({ ...CANDIDATE_INPUTS, 'matched-key': '' }, CANDIDATE_BOOLS);

    const { run } = await import('../src/cache-save-main');
    await run();

    expect(computeContentDigest).not.toHaveBeenCalled();
    expect(core.saveState).toHaveBeenCalledWith('baseline-digest', '');
  });

  it('does NOT walk when the optimization is disabled', async () => {
    mockInputs(CANDIDATE_INPUTS, { ...CANDIDATE_BOOLS, 'skip-redundant-save': false });

    const { run } = await import('../src/cache-save-main');
    await run();

    expect(computeContentDigest).not.toHaveBeenCalled();
    expect(core.saveState).toHaveBeenCalledWith('baseline-digest', '');
  });

  it('does NOT walk in lookup-only mode', async () => {
    mockInputs(CANDIDATE_INPUTS, { ...CANDIDATE_BOOLS, 'lookup-only': true });

    const { run } = await import('../src/cache-save-main');
    await run();

    expect(computeContentDigest).not.toHaveBeenCalled();
    expect(core.saveState).toHaveBeenCalledWith('baseline-digest', '');
  });

  it('does NOT walk when there is no fallback exact key', async () => {
    mockInputs({ ...CANDIDATE_INPUTS, 'fallback-exact-key': '' }, CANDIDATE_BOOLS);

    const { run } = await import('../src/cache-save-main');
    await run();

    expect(computeContentDigest).not.toHaveBeenCalled();
    expect(core.saveState).toHaveBeenCalledWith('baseline-digest', '');
  });

  it('calls setFailed when an input read throws', async () => {
    vi.mocked(core.getInput).mockImplementation(() => {
      throw new Error('boom');
    });
    const { run } = await import('../src/cache-save-main');
    await run();
    expect(core.setFailed).toHaveBeenCalledWith(expect.stringContaining('cache-save setup failed'));
  });
});
