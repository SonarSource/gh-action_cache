#!/bin/bash
set -euo pipefail

# Self-service S3 cache cleanup script.
# Deletes cache objects matching a branch and optional key pattern.
#
# Required environment variables:
#   - CLEANUP_BRANCH: Branch name (e.g., "refs/heads/feature/my-branch" or "feature/my-branch")
#   - S3_BUCKET: S3 bucket name (e.g., "sonarsource-s3-cache-prod-bucket")
#   - GITHUB_REPOSITORY: Repository in org/repo format
#
# Optional environment variables:
#   - CLEANUP_KEY: Cache key prefix to match (e.g., "sccache-Linux-"). If empty, deletes all cache for the branch.
#   - DRY_RUN: Set to "true" to preview deletions without executing them.

# Normalize branch name: ensure it has refs/heads/ prefix
BRANCH="${CLEANUP_BRANCH}"
if [[ "$BRANCH" != refs/heads/* && "$BRANCH" != refs/pull/* ]]; then
  BRANCH="refs/heads/${BRANCH}"
fi

S3_PREFIX="s3://${S3_BUCKET}/cache/${GITHUB_REPOSITORY}/"
KEY_PATTERN="${CLEANUP_KEY:-}"

if [[ -n "$KEY_PATTERN" ]]; then
  INCLUDE_PATTERN="*/${BRANCH}/${KEY_PATTERN}*"
  echo "Deleting cache entries matching branch='${BRANCH}' key='${KEY_PATTERN}*'"
else
  INCLUDE_PATTERN="*/${BRANCH}/*"
  echo "Deleting ALL cache entries for branch='${BRANCH}'"
fi

echo "S3 prefix: ${S3_PREFIX}"
echo "Include pattern: ${INCLUDE_PATTERN}"

DRYRUN_FLAG=""
if [[ "${DRY_RUN:-false}" == "true" ]]; then
  DRYRUN_FLAG="--dryrun"
  echo ""
  echo "=== DRY RUN MODE - no objects will be deleted ==="
  echo ""
fi

aws s3 rm "${S3_PREFIX}" \
  --recursive \
  --exclude "*" \
  --include "${INCLUDE_PATTERN}" \
  ${DRYRUN_FLAG}

echo ""
echo "Cache cleanup completed."
