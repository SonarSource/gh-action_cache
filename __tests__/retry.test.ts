import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@actions/core', () => ({
  warning: vi.fn(),
}));

import * as core from '@actions/core';
import { retryWithBackoff, DEFAULT_BASE_DELAY_MS, DEFAULT_MAX_ATTEMPTS } from '../src/retry';

const TIMER_MARGIN_MS = 100;

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
    await vi.advanceTimersByTimeAsync(DEFAULT_BASE_DELAY_MS + TIMER_MARGIN_MS);
    const result = await promise;

    expect(result).toBe('recovered');
    expect(fn).toHaveBeenCalledTimes(2);
    expect(core.warning).toHaveBeenCalledWith(
      expect.stringContaining(`test-op failed (attempt 1/${DEFAULT_MAX_ATTEMPTS})`)
    );
  });

  it('throws after all retries exhausted', async () => {
    const fn = vi.fn()
      .mockRejectedValueOnce(new Error('persistent'))
      .mockRejectedValueOnce(new Error('persistent'));

    const promise = retryWithBackoff(fn, { label: 'test-op', maxAttempts: 2 });
    const resultPromise = promise.catch((e: Error) => e);
    await vi.advanceTimersByTimeAsync(DEFAULT_BASE_DELAY_MS + TIMER_MARGIN_MS);
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

    const customBaseDelay = 500;
    const customMaxAttempts = 4;
    const promise = retryWithBackoff(fn, {
      label: 'custom',
      maxAttempts: customMaxAttempts,
      baseDelayMs: customBaseDelay,
    });
    // Max total delay: 500 + 1000 + 2000 = 3500ms
    const maxTotalDelay = customBaseDelay + customBaseDelay * 2 + customBaseDelay * 4;
    await vi.advanceTimersByTimeAsync(maxTotalDelay + TIMER_MARGIN_MS);
    const result = await promise;

    expect(result).toBe('ok');
    expect(fn).toHaveBeenCalledTimes(customMaxAttempts);
  });
});
