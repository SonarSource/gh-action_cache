/**
 * Detects when cache save should be skipped because restore used a fallback key
 * but the user key suffix (typically a content hash) is unchanged.
 */
export function shouldSkipDuplicateCacheSave(
  cacheHit: boolean,
  cachePrimaryKey: string,
  cacheMatchedKey: string,
  cacheUserKey: string
): boolean {
  if (cacheHit || !cacheMatchedKey || !cachePrimaryKey || !cacheUserKey) {
    return false;
  }
  if (cacheMatchedKey === cachePrimaryKey) {
    return false;
  }
  const suffix = `/${cacheUserKey}`;
  return (
    cacheMatchedKey.endsWith(suffix) && cachePrimaryKey.endsWith(suffix)
  );
}
