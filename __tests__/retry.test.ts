import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@actions/core', () => ({
  warning: vi.fn(),
  info: vi.fn(),
}));

import * as core from '@actions/core';
import { retryWithBackoff } from '../src/retry';

describe('retryWithBackoff', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns result on first success', async () => {
    const fn = vi.fn().mockResolvedValue('ok');
    const promise = retryWithBackoff(fn, { label: 'test-op' });
    const result = await promise;
    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(1);
  });

  it('retries on failure and succeeds', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('transient'))
      .mockResolvedValueOnce('recovered');

    const promise = retryWithBackoff(fn, { label: 'test-op' });
    // Advance past first retry delay (1000ms base)
    await vi.advanceTimersByTimeAsync(1100);
    const result = await promise;

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining('test-op failed (attempt 1/3)')
    );
  });

  it('throws after all retries exhausted', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('persistent'))
      .mockRejectedValueOnce(new Error('persistent'));

    const promise = retryWithBackoff(fn, { label: 'test-op', maxAttempts: 2 });
    // Attach rejection handler immediately to prevent unhandled rejection
    const resultPromise = promise.catch((e: Error) => e);
    // Advance past retry delay
    await vi.advanceTimersByTimeAsync(1100);
    const result = await resultPromise;

    expect(result).toBeInstanceOf(Error);
    expect((result as Error).message).toBe('persistent');
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it('respects custom maxAttempts and baseDelayMs', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('fail-1'))
      .mockRejectedValueOnce(new Error('fail-2'))
      .mockRejectedValueOnce(new Error('fail-3'))
      .mockResolvedValueOnce('ok');

    const promise = retryWithBackoff(fn, {
      label: 'custom',
      maxAttempts: 4,
      baseDelayMs: 500,
    });
    // Advance through 3 retry delays: 500 + 1000 + 2000 = 3500ms
    await vi.advanceTimersByTimeAsync(4000);
    const result = await promise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(4);
  });
});
