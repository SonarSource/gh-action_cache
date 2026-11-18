#!/bin/bash
set -euo pipefail

# Empty SAVE preserves the historical defaults, which differ between backends for lookup-only.
case "${SAVE:-}" in
  true|false|'') ;;
  *) echo "::error::save must be true or false when specified"; exit 1 ;;
esac
case "$LOOKUP_ONLY" in
  true|false) ;;
  *) echo "::error::lookup-only must be true or false"; exit 1 ;;
esac

SAVE_ENABLED="${SAVE:-true}"
if [[ "$CACHE_BACKEND" == s3 ]]; then
  if [[ -z "${SAVE:-}" && "$LOOKUP_ONLY" == true ]]; then
    SAVE_ENABLED=false
  fi
  # Never register a saver on merge-queue refs, even when explicitly requested.
  if [[ "$CACHE_REF" == refs/heads/gh-readonly-queue/* ]]; then
    SAVE_ENABLED=false
  fi
fi
echo "save-enabled=$SAVE_ENABLED" >> "$GITHUB_OUTPUT"
