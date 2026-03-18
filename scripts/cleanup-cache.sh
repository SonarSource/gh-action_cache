#!/bin/bash
set -euo pipefail

# Self-service S3 cache cleanup script.
#
# Two modes of operation:
#   LIST MODE  (no branch): Lists all cache entries for the repo, optionally filtered by key.
#   DELETE MODE (branch provided): Deletes cache entries matching branch and optional key.
#
# The branch name in S3 varies by GitHub event type:
#   - PR events use GITHUB_HEAD_REF (bare name, e.g., "feat/my-branch")
#   - Push events use GITHUB_REF (full ref, e.g., "refs/heads/master")
# In delete mode, the script searches for BOTH forms to cover all cached objects.
#
# Required environment variables:
#   - S3_BUCKET: S3 bucket name (e.g., "sonarsource-s3-cache-prod-bucket")
#   - GITHUB_REPOSITORY: Repository in org/repo format
#
# Optional environment variables:
#   - CLEANUP_BRANCH: Branch name. If empty, runs in list mode.
#   - CLEANUP_KEY: Cache key prefix to filter (e.g., "sccache-Linux-").
#   - DRY_RUN: Set to "true" to preview deletions without executing them (delete mode only).

# Escape a string for use in grep regex
escape_grep() {
  local input="$1"
  printf '%s' "$input" | sed 's/[.[\*^$()+?{|]/\\&/g'
  return $?
}

: "${S3_BUCKET:?}" "${GITHUB_REPOSITORY:?}"

S3_PREFIX="cache/${GITHUB_REPOSITORY}/"
INPUT_BRANCH="${CLEANUP_BRANCH:-}"
KEY_PATTERN="${CLEANUP_KEY:-}"

echo "Repository: ${GITHUB_REPOSITORY}"
echo "Bucket: ${S3_BUCKET}"

# --- Phase 1: List matching objects ---

ALL_KEYS=$(aws s3api list-objects-v2 \
  --bucket "${S3_BUCKET}" \
  --prefix "${S3_PREFIX}" \
  --query "Contents[].Key" \
  --output text 2>&1) || {
  echo "ERROR: Failed to list S3 objects" >&2
  echo "${ALL_KEYS}" >&2
  exit 1
}

if [[ -z "$ALL_KEYS" || "$ALL_KEYS" == "None" ]]; then
  echo "No cache entries found for ${GITHUB_REPOSITORY}."
  exit 0
fi

# Filter by branch and/or key pattern
if [[ -n "$INPUT_BRANCH" ]]; then
  # Derive both bare and full ref forms
  if [[ "$INPUT_BRANCH" == refs/heads/* ]]; then
    BARE_BRANCH="${INPUT_BRANCH#refs/heads/}"
    FULL_REF_BRANCH="$INPUT_BRANCH"
  elif [[ "$INPUT_BRANCH" == refs/pull/* ]]; then
    BARE_BRANCH="$INPUT_BRANCH"
    FULL_REF_BRANCH="$INPUT_BRANCH"
  else
    BARE_BRANCH="$INPUT_BRANCH"
    FULL_REF_BRANCH="refs/heads/${INPUT_BRANCH}"
  fi

  # Build grep pattern matching either branch form (escaped for grep -E)
  BARE_ESCAPED=$(escape_grep "$BARE_BRANCH")
  FULL_ESCAPED=$(escape_grep "$FULL_REF_BRANCH")
  BRANCH_PATTERN="/${BARE_ESCAPED}/|/${FULL_ESCAPED}/"

  if [[ -n "$KEY_PATTERN" ]]; then
    KEY_ESCAPED=$(escape_grep "$KEY_PATTERN")
    MATCHED_KEYS=$(echo "$ALL_KEYS" | tr '\t' '\n' | grep -E "$BRANCH_PATTERN" | grep "$KEY_ESCAPED" || true)
  else
    MATCHED_KEYS=$(echo "$ALL_KEYS" | tr '\t' '\n' | grep -E "$BRANCH_PATTERN" || true)
  fi
else
  # List mode: no branch filter
  if [[ -n "$KEY_PATTERN" ]]; then
    KEY_ESCAPED=$(escape_grep "$KEY_PATTERN")
    MATCHED_KEYS=$(echo "$ALL_KEYS" | tr '\t' '\n' | grep "$KEY_ESCAPED" || true)
  else
    MATCHED_KEYS=$(echo "$ALL_KEYS" | tr '\t' '\n')
  fi
fi

if [[ -z "$MATCHED_KEYS" ]]; then
  if [[ -n "$INPUT_BRANCH" ]]; then
    echo "No cache entries found for branch '${BARE_BRANCH:-$INPUT_BRANCH}'."
  else
    echo "No cache entries found."
  fi
  exit 0
fi

MATCH_COUNT=$(echo "$MATCHED_KEYS" | wc -l | tr -d ' ')

# --- List mode: display and exit ---

if [[ -z "$INPUT_BRANCH" ]]; then
  echo ""
  echo "=== Cache entries for ${GITHUB_REPOSITORY} ==="
  echo ""
  echo "$MATCHED_KEYS" | sed "s|^${S3_PREFIX}||"
  echo ""
  echo "Total: ${MATCH_COUNT} object(s)"
  exit 0
fi

# --- Phase 2: Delete matched objects ---

echo ""
if [[ -n "$KEY_PATTERN" ]]; then
  echo "Matched ${MATCH_COUNT} object(s) for branch='${BARE_BRANCH:-$INPUT_BRANCH}' key='${KEY_PATTERN}'"
else
  echo "Matched ${MATCH_COUNT} object(s) for branch='${BARE_BRANCH:-$INPUT_BRANCH}'"
fi

if [[ "${DRY_RUN:-false}" == "true" ]]; then
  echo ""
  echo "=== DRY RUN - the following objects would be deleted ==="
  echo ""
  echo "$MATCHED_KEYS" | sed "s|^${S3_PREFIX}||"
  echo ""
  echo "Total: ${MATCH_COUNT} object(s) would be deleted"
  exit 0
fi

# Batch delete (up to 1000 objects per API call)
echo "Deleting ${MATCH_COUNT} object(s)..."

BATCH_SIZE=1000
KEYS_FILE=$(mktemp)
echo "$MATCHED_KEYS" > "$KEYS_FILE"
trap 'rm -f "$KEYS_FILE"' EXIT

DELETED=0
while true; do
  BATCH=$(head -n "$BATCH_SIZE" "$KEYS_FILE")
  if [[ -z "$BATCH" ]]; then
    break
  fi

  DELETE_JSON=$(echo "$BATCH" | jq -R -s '
    split("\n") | map(select(length > 0)) |
    { Objects: map({ Key: . }), Quiet: true }
  ')

  aws s3api delete-objects \
    --bucket "${S3_BUCKET}" \
    --delete "$DELETE_JSON" > /dev/null || {
    echo "ERROR: Failed to delete batch of objects" >&2
    exit 1
  }

  BATCH_COUNT=$(echo "$BATCH" | wc -l | tr -d ' ')
  DELETED=$((DELETED + BATCH_COUNT))
  echo "  Deleted ${DELETED}/${MATCH_COUNT} objects..."

  REMAINING=$(tail -n +"$((BATCH_SIZE + 1))" "$KEYS_FILE")
  if [[ -z "$REMAINING" ]]; then
    break
  fi
  echo "$REMAINING" > "$KEYS_FILE"
done

echo ""
echo "Cache cleanup completed. ${DELETED} object(s) deleted."
