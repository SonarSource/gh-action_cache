import { describe, it, expect } from 'vitest';
import { shouldSkipDuplicateCacheSave } from '../src/cache-save-skip';

describe('shouldSkipDuplicateCacheSave', () => {
  const userKey = 'gradle-f51e0ba06f511cb5d0f8558fb2506ea9';

  it('skips when fallback restore has the same user key suffix', () => {
    expect(
      shouldSkipDuplicateCacheSave(
        false,
        `lj/checking-if-dependencies-will-be-cache-hit/${userKey}`,
        `refs/heads/master/${userKey}`,
        userKey
      )
    ).toBe(true);
  });

  it('does not skip on exact cache hit', () => {
    const branchKey = `feature/${userKey}`;
    expect(
      shouldSkipDuplicateCacheSave(true, branchKey, branchKey, userKey)
    ).toBe(false);
  });

  it('does not skip when user key suffix changed', () => {
    expect(
      shouldSkipDuplicateCacheSave(
        false,
        `feature/gradle-newhash`,
        `refs/heads/master/gradle-oldhash`,
        'gradle-oldhash'
      )
    ).toBe(false);
  });

  it('does not skip when GitHub import matched a non-prefixed key (migration save)', () => {
    expect(
      shouldSkipDuplicateCacheSave(
        false,
        `feature/${userKey}`,
        userKey,
        userKey
      )
    ).toBe(false);
  });

  it('does not skip on full cache miss', () => {
    expect(
      shouldSkipDuplicateCacheSave(false, `feature/${userKey}`, '', userKey)
    ).toBe(false);
  });
});
