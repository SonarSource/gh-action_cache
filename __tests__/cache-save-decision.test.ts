import { describe, it, expect } from 'vitest';
import { shouldSkipSave } from '../src/cache-save-decision';

describe('shouldSkipSave', () => {
  const KEY = 'refs/heads/feature/x/gradle-abc';
  const fallbackExact = 'refs/heads/master/gradle-abc';
  const D1 = 'digest-aaa';
  const D2 = 'digest-bbb';

  it('skips on an exact primary-key hit, regardless of digests (upstream parity)', () => {
    expect(
      shouldSkipSave({
        key: KEY,
        matchedKey: KEY,
        fallbackExactKey: fallbackExact,
        lookupOnly: false,
        enabled: true,
      })
    ).toEqual({ skip: true, reason: 'exact-key-hit' });
  });

  it('skips on an exact primary-key hit even when the optimization is disabled', () => {
    expect(
      shouldSkipSave({
        key: KEY,
        matchedKey: KEY,
        fallbackExactKey: fallbackExact,
        lookupOnly: false,
        enabled: false,
      }).skip
    ).toBe(true);
  });

  it('skips when key matches the fallback AND content is unchanged', () => {
    expect(
      shouldSkipSave({
        key: KEY,
        matchedKey: fallbackExact,
        fallbackExactKey: fallbackExact,
        lookupOnly: false,
        enabled: true,
        baselineDigest: D1,
        finalDigest: D1,
      })
    ).toEqual({ skip: true, reason: 'restored-from-default-branch-fallback' });
  });

  it('saves when key matches the fallback but content changed since restore', () => {
    expect(
      shouldSkipSave({
        key: KEY,
        matchedKey: fallbackExact,
        fallbackExactKey: fallbackExact,
        lookupOnly: false,
        enabled: true,
        baselineDigest: D1,
        finalDigest: D2,
      })
    ).toEqual({ skip: false, reason: 'content-changed-since-restore' });
  });

  it('saves when the baseline digest is unavailable (walk skipped/failed)', () => {
    expect(
      shouldSkipSave({
        key: KEY,
        matchedKey: fallbackExact,
        fallbackExactKey: fallbackExact,
        lookupOnly: false,
        enabled: true,
        baselineDigest: '',
        finalDigest: D1,
      })
    ).toEqual({ skip: false, reason: 'digest-unavailable' });
  });

  it('saves when the final digest is unavailable', () => {
    expect(
      shouldSkipSave({
        key: KEY,
        matchedKey: fallbackExact,
        fallbackExactKey: fallbackExact,
        lookupOnly: false,
        enabled: true,
        baselineDigest: D1,
        finalDigest: '',
      })
    ).toEqual({ skip: false, reason: 'digest-unavailable' });
  });

  it('saves (NOT skips) when BOTH digests are empty — the empty-equality trap', () => {
    expect(
      shouldSkipSave({
        key: KEY,
        matchedKey: fallbackExact,
        fallbackExactKey: fallbackExact,
        lookupOnly: false,
        enabled: true,
        baselineDigest: '',
        finalDigest: '',
      }).skip
    ).toBe(false);
  });

  it('saves when matched key is a prefix restore-key hit (different content), regardless of digests', () => {
    expect(
      shouldSkipSave({
        key: KEY,
        matchedKey: 'refs/heads/master/gradle-OLDER',
        fallbackExactKey: fallbackExact,
        lookupOnly: false,
        enabled: true,
        baselineDigest: D1,
        finalDigest: D1,
      })
    ).toEqual({ skip: false, reason: 'content-may-differ' });
  });

  it('saves on a cache miss (no matched key)', () => {
    expect(
      shouldSkipSave({ matchedKey: '', fallbackExactKey: fallbackExact, lookupOnly: false, enabled: true }).skip
    ).toBe(false);
  });

  it('skips (no-op) when lookup-only was set — nothing to save', () => {
    expect(
      shouldSkipSave({ matchedKey: '', fallbackExactKey: fallbackExact, lookupOnly: true, enabled: true })
    ).toEqual({ skip: true, reason: 'lookup-only' });
  });

  it('never skips when the optimization is disabled, even with matching digests', () => {
    expect(
      shouldSkipSave({
        key: KEY,
        matchedKey: fallbackExact,
        fallbackExactKey: fallbackExact,
        lookupOnly: false,
        enabled: false,
        baselineDigest: D1,
        finalDigest: D1,
      }).skip
    ).toBe(false);
  });

  it('saves when there is no fallback exact key configured (and no exact primary hit)', () => {
    expect(
      shouldSkipSave({
        key: KEY,
        matchedKey: 'refs/heads/master/gradle-OLDER',
        fallbackExactKey: '',
        lookupOnly: false,
        enabled: true,
        baselineDigest: D1,
        finalDigest: D1,
      }).skip
    ).toBe(false);
  });
});
