export interface SaveDecisionInput {
  /** The cache-matched-key reported by the restore step ('' if cache miss). */
  matchedKey: string;
  /** The fallback exact key from prepare-keys.sh ('' if none configured). */
  fallbackExactKey: string;
  /** Whether the action ran in lookup-only mode (no download, nothing to save). */
  lookupOnly: boolean;
  /** Whether the skip-redundant-save optimization is enabled. */
  enabled: boolean;
  /**
   * Content digest of the cached path captured at restore time (main step).
   * '' / undefined when not computed (not a skip-candidate) or the walk failed.
   */
  baselineDigest?: string;
  /**
   * Content digest of the cached path captured at save time (post step).
   * '' / undefined when not computed or the walk failed.
   */
  finalDigest?: string;
}

export interface SaveDecision {
  skip: boolean;
  reason: string;
}

/**
 * Decide whether to skip the branch-scoped cache save. The content digests can only ever
 * DOWNGRADE a key-based skip to a save — they never authorise a skip the key check wouldn't.
 * So this is strictly a safety tightening over the key-only rule: it can cause more saves,
 * never fewer, and cannot introduce a false skip relative to key equality alone.
 */
export function shouldSkipSave(input: SaveDecisionInput): SaveDecision {
  if (input.lookupOnly) {
    return { skip: true, reason: 'lookup-only' };
  }
  if (!input.enabled) {
    return { skip: false, reason: 'optimization-disabled' };
  }
  // Not even a key-level skip candidate: the restore did not match the default-branch fallback.
  if (!input.fallbackExactKey || input.matchedKey !== input.fallbackExactKey) {
    return { skip: false, reason: 'content-may-differ' };
  }
  // Key matched the fallback. Now require proof the content is unchanged since restore.
  // Missing/empty digests (walk skipped or failed) must err toward SAVE — this guard MUST
  // precede the equality check, else '' === '' would wrongly skip.
  if (!input.baselineDigest || !input.finalDigest) {
    return { skip: false, reason: 'digest-unavailable' };
  }
  if (input.baselineDigest !== input.finalDigest) {
    return { skip: false, reason: 'content-changed-since-restore' };
  }
  return { skip: true, reason: 'restored-from-default-branch-fallback' };
}
