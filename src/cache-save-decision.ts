export interface SaveDecisionInput {
  /** The cache-matched-key reported by the restore step ('' if cache miss). */
  matchedKey: string;
  /** The fallback exact key from prepare-keys.sh ('' if none configured). */
  fallbackExactKey: string;
  /** Whether the action ran in lookup-only mode (no download, nothing to save). */
  lookupOnly: boolean;
  /** Whether the skip-redundant-save optimization is enabled. */
  enabled: boolean;
}

export interface SaveDecision {
  skip: boolean;
  reason: string;
}

export function shouldSkipSave(input: SaveDecisionInput): SaveDecision {
  if (input.lookupOnly) {
    return { skip: true, reason: 'lookup-only' };
  }
  if (!input.enabled) {
    return { skip: false, reason: 'optimization-disabled' };
  }
  if (input.fallbackExactKey && input.matchedKey === input.fallbackExactKey) {
    return { skip: true, reason: 'restored-from-default-branch-fallback' };
  }
  return { skip: false, reason: 'content-may-differ' };
}
