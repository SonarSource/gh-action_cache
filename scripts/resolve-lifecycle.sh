#!/bin/bash
set -euo pipefail

# This script only runs after an explicit save input opts into the new lifecycle.
case "${SAVE:-}" in
  true|false) ;;
  *) echo "::error::save must be true or false when specified"; exit 1 ;;
esac
case "$LOOKUP_ONLY" in
  true|false) ;;
  *) echo "::error::lookup-only must be true or false"; exit 1 ;;
esac

SAVE_ENABLED="$SAVE"
# Never register a saver on merge-queue refs, even when explicitly requested.
if [[ "$CACHE_BACKEND" == s3 && "$CACHE_REF" == refs/heads/gh-readonly-queue/* ]]; then
  SAVE_ENABLED=false
fi
echo "save-enabled=$SAVE_ENABLED" >> "$GITHUB_OUTPUT"
