#!/bin/bash
set -euo pipefail

# Explicit lifecycle: a metadata probe is not evidence of a successful payload restore.
# Omitted save retains the released output aggregation for existing callers.
CACHE_HIT=""
MATCHED_KEY=""
if [[ -z "$SAVE" ]]; then
  # Preserve the released output precedence, including physical fallback hit values.
  CACHE_HIT="${HIT_GITHUB:-${HIT_S3:-${HIT_S3_RESTORE:-${HIT_S3_PROBE:-${HIT_IMPORT:-}}}}}"
  MATCHED_KEY="${MATCHED_GITHUB:-${MATCHED_S3:-${MATCHED_S3_RESTORE:-${MATCHED_S3_PROBE:-${MATCHED_IMPORT:-}}}}}"
elif [[ "$CACHE_BACKEND" == github ]]; then
  MATCHED_KEY="$MATCHED_GITHUB"
  CACHE_HIT="$HIT_GITHUB"
elif [[ -n "$MATCHED_S3_PROBE" ]]; then
  if [[ "$LOOKUP_ONLY" == true ]]; then
    MATCHED_KEY="$MATCHED_S3_PROBE"
  else
    MATCHED_KEY="$MATCHED_S3_RESTORE"
  fi
  if [[ -n "$MATCHED_KEY" ]]; then
    CACHE_HIT=false
    if [[ "$MATCHED_KEY" == "$BRANCH_KEY" ||
          ( -n "$FALLBACK_EXACT_KEY" && "$MATCHED_KEY" == "$FALLBACK_EXACT_KEY" ) ]]; then
      CACHE_HIT=true
    fi
  fi
else
  MATCHED_KEY="$MATCHED_IMPORT"
  CACHE_HIT="$HIT_IMPORT"
fi

CACHE_FOUND=""
CACHE_RESTORED=""
if [[ -n "$SAVE" ]]; then
  CACHE_FOUND=false
  CACHE_RESTORED=false
fi
if [[ -n "$SAVE" && -n "$MATCHED_KEY" ]]; then
  CACHE_FOUND=true
  if [[ "$LOOKUP_ONLY" != true ]]; then
    CACHE_RESTORED=true
  fi
elif [[ -n "$SAVE" ]]; then
  CACHE_HIT=""
fi
{
  echo "cache-hit=$CACHE_HIT"
  echo "matched-key=$MATCHED_KEY"
  echo "cache-found=$CACHE_FOUND"
  echo "cache-restored=$CACHE_RESTORED"
} >> "$GITHUB_OUTPUT"
