#!/bin/bash
set -euo pipefail

# Choose the outputs of the selected operation. A metadata probe is never evidence of a successful payload restore.
CACHE_HIT=""
MATCHED_KEY=""
if [[ "$CACHE_BACKEND" == github ]]; then
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

CACHE_FOUND=false
CACHE_RESTORED=false
if [[ -n "$MATCHED_KEY" ]]; then
  CACHE_FOUND=true
  if [[ "$LOOKUP_ONLY" != true ]]; then
    CACHE_RESTORED=true
  fi
else
  CACHE_HIT=""
fi
{
  echo "cache-hit=$CACHE_HIT"
  echo "matched-key=$MATCHED_KEY"
  echo "cache-found=$CACHE_FOUND"
  echo "cache-restored=$CACHE_RESTORED"
} >> "$GITHUB_OUTPUT"
