import { describe, it, expect } from 'vitest';
import { shouldSkipSave } from '../src/cache-save-decision';

describe('shouldSkipSave', () => {
  const fallbackExact = 'refs/heads/master/gradle-abc';

  it('skips when matched key equals the fallback exact key (content identical)', () => {
    expect(shouldSkipSave({ matchedKey: fallbackExact, fallbackExactKey: fallbackExact, lookupOnly: false, enabled: true }))
      .toEqual({ skip: true, reason: 'restored-from-default-branch-fallback' });
  });

  it('saves when matched key is a prefix restore-key hit (different content)', () => {
    expect(shouldSkipSave({ matchedKey: 'refs/heads/master/gradle-OLDER', fallbackExactKey: fallbackExact, lookupOnly: false, enabled: true }).skip)
      .toBe(false);
  });

  it('saves on a cache miss (no matched key)', () => {
    expect(shouldSkipSave({ matchedKey: '', fallbackExactKey: fallbackExact, lookupOnly: false, enabled: true }).skip)
      .toBe(false);
  });

  it('skips (no-op) when lookup-only was set — nothing to save', () => {
    expect(shouldSkipSave({ matchedKey: '', fallbackExactKey: fallbackExact, lookupOnly: true, enabled: true }))
      .toEqual({ skip: true, reason: 'lookup-only' });
  });

  it('never skips when the optimization is disabled', () => {
    expect(shouldSkipSave({ matchedKey: fallbackExact, fallbackExactKey: fallbackExact, lookupOnly: false, enabled: false }).skip)
      .toBe(false);
  });

  it('saves when there is no fallback exact key configured', () => {
    expect(shouldSkipSave({ matchedKey: 'refs/heads/feature/x/gradle-abc', fallbackExactKey: '', lookupOnly: false, enabled: true }).skip)
      .toBe(false);
  });
});
