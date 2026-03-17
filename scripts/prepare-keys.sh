#!/bin/bash
set -euo pipefail

# This script prepares cache keys with branch-specific paths and fallback logic.
# All inputs are passed through environment variables for security (sanitization).
#
# Required environment variables:
#   - INPUT_KEY: The primary cache key
#   - GITHUB_OUTPUT: File path for GitHub Actions output
#
# Optional environment variables:
#   - INPUT_RESTORE_KEYS: Multi-line list of restore key prefixes
#   - INPUT_FALLBACK_BRANCH: Maintenance branch for fallback restore keys (pattern: branch-*)
#   - INPUT_FALLBACK_TO_DEFAULT_BRANCH: When 'true', add fallback restore key on the default branch (default: true)
#   - GITHUB_HEAD_REF: Branch name for PR events
#   - GITHUB_REF: Branch ref for push events
#   - GITHUB_TOKEN: GitHub token for API authentication
#   - GITHUB_REPOSITORY: Repository in owner/repo format
# This script prepares cache keys with branch-specific paths and fallback logic (for the S3 backend only).
#
# Required inputs (must be explicitly provided):
#   - INPUT_KEY: The primary cache key
#
# GitHub Actions auto-provided:
#   - GITHUB_OUTPUT: File path for GitHub Actions output
#   - GITHUB_HEAD_REF: Branch name for PR events
#   - GITHUB_REF: Branch ref for push events
#   - GITHUB_TOKEN: GitHub token for API authentication
#
# Optional user customization:
#   - INPUT_RESTORE_KEYS: Multi-line list of restore key prefixes
#   - INPUT_FALLBACK_BRANCH: Maintenance branch for fallback restore keys (pattern: branch-*)
#   - INPUT_FALLBACK_TO_DEFAULT_BRANCH: Whether to add fallback restore key on the default branch (default: true)

: "${INPUT_KEY:?}" "${GITHUB_OUTPUT:?}" "${GITHUB_REF:?}" "${GITHUB_TOKEN:?}" "${GITHUB_REPOSITORY:?}"
: "${INPUT_RESTORE_KEYS:=}" "${INPUT_FALLBACK_BRANCH:=}" "${INPUT_FALLBACK_TO_DEFAULT_BRANCH:=true}"

# Use GITHUB_HEAD_REF for PR events, GITHUB_REF for push events
BRANCH_NAME="${GITHUB_HEAD_REF:-$GITHUB_REF}"
BRANCH_KEY="${BRANCH_NAME}/${INPUT_KEY}"
echo "branch-key=${BRANCH_KEY}" >> "$GITHUB_OUTPUT"

RESTORE_KEYS=""

# Process restore keys: add branch-specific keys
if [[ -n $INPUT_RESTORE_KEYS ]]; then
  while IFS= read -r line; do
    if [ -n "$line" ]; then
      if [ -n "$RESTORE_KEYS" ]; then
        RESTORE_KEYS="${RESTORE_KEYS}"$'\n'"${BRANCH_NAME}/${line}"
      else
        RESTORE_KEYS="${BRANCH_NAME}/${line}"
      fi
    fi
  done <<< "$INPUT_RESTORE_KEYS"
fi

# Determine the fallback branch
if [[ -n "$INPUT_FALLBACK_BRANCH" ]]; then
  # Explicit fallback-branch is always honoured, regardless of fallback-to-default-branch
  FALLBACK_BRANCH="${INPUT_FALLBACK_BRANCH#refs/heads/}"
elif [[ $INPUT_FALLBACK_TO_DEFAULT_BRANCH == "true" ]]; then
  # Query GitHub API to get the default branch
  FALLBACK_BRANCH=$(curl -s -H "Authorization: token ${GITHUB_TOKEN}" \
    "https://api.github.com/repos/${GITHUB_REPOSITORY}" | \
    jq -r '.default_branch')
fi

if [[ -n "${FALLBACK_BRANCH:-}" && "$FALLBACK_BRANCH" != "null" ]]; then
  # Skip fallback if we're already on the fallback branch
  CURRENT_BRANCH="${BRANCH_NAME#refs/heads/}"
  if [[ "$CURRENT_BRANCH" != "$FALLBACK_BRANCH" ]]; then
    case "$FALLBACK_BRANCH" in
      main|master|branch-*)
        if [[ -n $INPUT_RESTORE_KEYS ]]; then
          # Add fallback branch restore keys for each user-provided restore key
          while IFS= read -r line; do
            if [[ -n "$line" ]]; then
              RESTORE_KEYS="${RESTORE_KEYS}"$'\n'"refs/heads/${FALLBACK_BRANCH}/${line}"
            fi
          done <<< "$INPUT_RESTORE_KEYS"
        else
          # No restore keys provided: add exact-match fallback using the primary key
          RESTORE_KEYS="refs/heads/${FALLBACK_BRANCH}/${INPUT_KEY}"
        fi
        ;;
      *)
        echo "::warning::Fallback branch '$FALLBACK_BRANCH' is not supported for cache fallback. Supported branches: main, master, branch-*"
        ;;
    esac
  fi
elif [[ -n "$INPUT_FALLBACK_BRANCH" || $INPUT_FALLBACK_TO_DEFAULT_BRANCH == "true" ]]; then
  echo "::warning::Unable to determine fallback branch; skipping fallback restore keys."
fi

if [[ -n "$RESTORE_KEYS" ]]; then
  {
    echo "branch-restore-keys<<EOF"
    echo "$RESTORE_KEYS"
    echo "EOF"
  } >> "$GITHUB_OUTPUT"
fi
