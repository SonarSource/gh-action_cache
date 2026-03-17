#!/bin/bash
set -euo pipefail

# Self-service S3 cache cleanup script.
# Deletes cache objects matching a branch and optional key pattern.
#
# The branch name in S3 varies by event type:
#   - PR events use GITHUB_HEAD_REF (bare name, e.g., "feat/my-branch")
#   - Push events use GITHUB_REF (full ref, e.g., "refs/heads/master")
# This script searches for BOTH forms to cover all cached objects.
#
# Required environment variables:
#   - CLEANUP_BRANCH: Branch name (e.g., "feature/my-branch" or "refs/heads/feature/my-branch")
#   - S3_BUCKET: S3 bucket name (e.g., "sonarsource-s3-cache-prod-bucket")
#   - GITHUB_REPOSITORY: Repository in org/repo format
#
# Optional environment variables:
#   - CLEANUP_KEY: Cache key prefix to match (e.g., "sccache-Linux-"). If empty, deletes all cache for the branch.
#   - DRY_RUN: Set to "true" to preview deletions without executing them.

: "${CLEANUP_BRANCH:?}" "${S3_BUCKET:?}" "${GITHUB_REPOSITORY:?}"

# Derive both bare and full ref forms of the branch name
INPUT_BRANCH="${CLEANUP_BRANCH}"
if [[ "$INPUT_BRANCH" == refs/heads/* ]]; then
  BARE_BRANCH="${INPUT_BRANCH#refs/heads/}"
  FULL_REF_BRANCH="$INPUT_BRANCH"
elif [[ "$INPUT_BRANCH" == refs/pull/* ]]; then
  # PR ref - use as-is, no bare form
  BARE_BRANCH="$INPUT_BRANCH"
  FULL_REF_BRANCH="$INPUT_BRANCH"
else
  BARE_BRANCH="$INPUT_BRANCH"
  FULL_REF_BRANCH="refs/heads/${INPUT_BRANCH}"
fi

S3_PREFIX="s3://${S3_BUCKET}/cache/${GITHUB_REPOSITORY}/"
KEY_PATTERN="${CLEANUP_KEY:-}"

# Build include patterns for both bare (PR) and full ref (push) forms
if [[ -n "$KEY_PATTERN" ]]; then
  INCLUDE_BARE="*/${BARE_BRANCH}/${KEY_PATTERN}*"
  INCLUDE_FULL="*/${FULL_REF_BRANCH}/${KEY_PATTERN}*"
  echo "Deleting cache entries matching branch='${BARE_BRANCH}' key='${KEY_PATTERN}*'"
else
  INCLUDE_BARE="*/${BARE_BRANCH}/*"
  INCLUDE_FULL="*/${FULL_REF_BRANCH}/*"
  echo "Deleting ALL cache entries for branch='${BARE_BRANCH}'"
fi

echo "Repository: ${GITHUB_REPOSITORY}"
echo "Bucket: ${S3_BUCKET}"

CMD=(aws s3 rm "${S3_PREFIX}" --recursive --exclude "*" --include "${INCLUDE_BARE}" --include "${INCLUDE_FULL}")
if [[ "${DRY_RUN:-false}" == "true" ]]; then
  CMD+=(--dryrun)
  echo ""
  echo "=== DRY RUN MODE - no objects will be deleted ==="
  echo ""
fi

EXIT_CODE=0
OUTPUT=$("${CMD[@]}" 2>&1) || EXIT_CODE=$?
echo "$OUTPUT"

if [[ $EXIT_CODE -ne 0 ]]; then
  echo "" >&2
  echo "ERROR: aws s3 rm failed with exit code ${EXIT_CODE}" >&2
  exit $EXIT_CODE
fi

if [[ -z "$OUTPUT" ]]; then
  echo "No matching cache entries found."
else
  MATCH_COUNT=$(echo "$OUTPUT" | grep -c "delete:" || true)
  echo ""
  echo "Cache cleanup completed. ${MATCH_COUNT} object(s) matched."
fi
