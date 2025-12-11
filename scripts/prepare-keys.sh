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
#   - GITHUB_HEAD_REF: Branch name for PR events
#   - GITHUB_REF: Branch ref for push events
#   - GITHUB_TOKEN: GitHub token for API authentication
#   - GITHUB_REPOSITORY: Repository in owner/repo format

# Use GITHUB_HEAD_REF for PR events, GITHUB_REF for push events
BRANCH_NAME="${GITHUB_HEAD_REF:-$GITHUB_REF}"
BRANCH_KEY="${BRANCH_NAME}/${INPUT_KEY}"
echo "branch-key=${BRANCH_KEY}" >> "$GITHUB_OUTPUT"

# Process restore keys: keep branch-specific keys and add fallback to default branch
if [[ -n "${INPUT_RESTORE_KEYS:-}" ]]; then
  RESTORE_KEYS=""
  # First, add branch-specific restore keys
  while IFS= read -r line; do
    if [ -n "$line" ]; then
      if [ -n "$RESTORE_KEYS" ]; then
        RESTORE_KEYS="${RESTORE_KEYS}"$'\n'"${BRANCH_NAME}/${line}"
      else
        RESTORE_KEYS="${BRANCH_NAME}/${line}"
      fi
    fi
  done <<< "$INPUT_RESTORE_KEYS"

  FALLBACK_BRANCH_INPUT="${INPUT_FALLBACK_BRANCH:-}"

  if [[ -n "$FALLBACK_BRANCH_INPUT" ]]; then
    FALLBACK_BRANCH="${FALLBACK_BRANCH_INPUT#refs/heads/}"
  else
    # Query GitHub API to get the default branch
    FALLBACK_BRANCH=$(curl -s -H "Authorization: token ${GITHUB_TOKEN}" \
      "https://api.github.com/repos/${GITHUB_REPOSITORY}" | \
      jq -r '.default_branch')
  fi

  if [[ -n "$FALLBACK_BRANCH" && "$FALLBACK_BRANCH" != "null" ]]; then
    case "$FALLBACK_BRANCH" in
      main|master|branch-*)
        # Add fallback branch restore keys
        while IFS= read -r line; do
          if [[ -n "$line" ]]; then
            RESTORE_KEYS="${RESTORE_KEYS}"$'\n'"refs/heads/${FALLBACK_BRANCH}/${line}"
          fi
        done <<< "$INPUT_RESTORE_KEYS"
        ;;
      *)
        echo "::warning::Fallback branch '$FALLBACK_BRANCH' is not supported for cache fallback. Supported branches: main, master, branch-*"
        ;;
    esac
  else
    echo "::warning::Unable to determine fallback branch; skipping fallback restore keys."
  fi

  {
    echo "branch-restore-keys<<EOF"
    echo "$RESTORE_KEYS"
    echo "EOF"
  } >> "$GITHUB_OUTPUT"
fi
