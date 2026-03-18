#!/bin/bash
set -euo pipefail

# Self-service S3 cache cleanup script.
#
# Two modes of operation:
#   LIST MODE  (no branch or key): Lists all cache entries for the repo.
#   DELETE MODE (branch and/or key provided): Deletes matching cache entries.
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
#   - CLEANUP_BRANCH: Branch name to filter by.
#   - CLEANUP_KEY: Cache key prefix to filter (e.g., "sccache-Linux-").
#   If both are empty, runs in list mode.
#   - DRY_RUN: Set to "true" to preview deletions without executing them (delete mode only).

# Escape a string for use in grep regex
escape_grep() {
  local input="$1"
  printf '%s' "$input" | sed 's/[.[\*^$()+?{|]/\\&/g'
  return $?
}

# Format bytes to human-readable size
format_size() {
  local bytes="$1"
  if [[ "$bytes" -ge 1073741824 ]]; then
    echo "$(( bytes / 1073741824 ))G"
  elif [[ "$bytes" -ge 1048576 ]]; then
    echo "$(( bytes / 1048576 ))M"
  elif [[ "$bytes" -ge 1024 ]]; then
    echo "$(( bytes / 1024 ))K"
  else
    echo "${bytes}B"
  fi
  return 0
}

# Extract object rows as TSV: size_bytes \t date \t key (shared by print_table and write_summary)
extract_rows() {
  local objects="$1"
  echo "$objects" | jq -r --arg prefix "$S3_PREFIX" \
    '[.Size, (.LastModified | split("T") | .[0]), (.Key | ltrimstr($prefix))] | @tsv'
  return $?
}

# Print a formatted table of S3 objects (size, date, key) to stdout
print_table() {
  local objects="$1"
  printf "%-8s  %-20s  %s\n" "SIZE" "LAST MODIFIED" "KEY"
  printf "%-8s  %-20s  %s\n" "--------" "--------------------" "---"
  extract_rows "$objects" | while IFS=$'\t' read -r size date key; do
    printf "%-8s  %-20s  %s\n" "$(format_size "$size")" "$date" "$key"
  done
  return 0
}

# Write GitHub Actions job summary (markdown with collapsible object list)
write_summary() {
  local title="$1"
  local objects="$2"
  local count="$3"
  local total_size="$4"

  if [[ -z "${GITHUB_STEP_SUMMARY:-}" ]]; then
    return 0
  fi

  {
    echo "### $title"
    echo ""
    echo "**${count} object(s)**, $(format_size "$total_size") total"
    echo ""
    echo "<details>"
    echo "<summary>Show objects</summary>"
    echo ""
    echo "| Size | Last Modified | Key |"
    echo "|------|--------------|-----|"
    extract_rows "$objects" | while IFS=$'\t' read -r size date key; do
      echo "| $(format_size "$size") | $date | $key |"
    done
    echo ""
    echo "</details>"
  } >> "$GITHUB_STEP_SUMMARY"
  return 0
}

: "${S3_BUCKET:?}" "${GITHUB_REPOSITORY:?}"

S3_PREFIX="cache/${GITHUB_REPOSITORY}/"
INPUT_BRANCH="${CLEANUP_BRANCH:-}"
KEY_PATTERN="${CLEANUP_KEY:-}"

echo "Repository: ${GITHUB_REPOSITORY}"
echo "Bucket: ${S3_BUCKET}"

# --- Phase 1: List all objects with pagination ---

ALL_OBJECTS='[]'
NEXT_TOKEN=""
while true; do
  ARGS=(--bucket "${S3_BUCKET}" --prefix "${S3_PREFIX}" --output json)
  if [[ -n "$NEXT_TOKEN" ]]; then
    ARGS+=(--continuation-token "$NEXT_TOKEN")
  fi

  PAGE=$(aws s3api list-objects-v2 "${ARGS[@]}" 2>&1) || {
    echo "ERROR: Failed to list S3 objects" >&2
    echo "${PAGE}" >&2
    exit 1
  }

  ALL_OBJECTS=$(echo "$ALL_OBJECTS" "$PAGE" | jq -s '.[0] + (.[1].Contents // [])')
  NEXT_TOKEN=$(echo "$PAGE" | jq -r '.NextContinuationToken // empty')
  if [[ -z "$NEXT_TOKEN" ]]; then
    break
  fi
done

OBJECT_COUNT=$(echo "$ALL_OBJECTS" | jq 'length')
if [[ "$OBJECT_COUNT" -eq 0 ]]; then
  echo "No cache entries found for ${GITHUB_REPOSITORY}."
  exit 0
fi

# --- Filter by branch and/or key pattern ---

MATCHED_OBJECTS=$(echo "$ALL_OBJECTS" | jq -c '.[]')

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

  BARE_ESCAPED=$(escape_grep "$BARE_BRANCH")
  FULL_ESCAPED=$(escape_grep "$FULL_REF_BRANCH")
  BRANCH_PATTERN="/${BARE_ESCAPED}/|/${FULL_ESCAPED}/"
  MATCHED_OBJECTS=$(echo "$MATCHED_OBJECTS" | grep -E "$BRANCH_PATTERN" || true)
fi

if [[ -n "$KEY_PATTERN" ]]; then
  KEY_ESCAPED=$(escape_grep "$KEY_PATTERN")
  MATCHED_OBJECTS=$(echo "$MATCHED_OBJECTS" | grep "$KEY_ESCAPED" || true)
fi

if [[ -z "$MATCHED_OBJECTS" ]]; then
  if [[ -n "$INPUT_BRANCH" ]]; then
    echo "No cache entries found for branch '${BARE_BRANCH:-$INPUT_BRANCH}'."
  else
    echo "No cache entries found."
  fi
  exit 0
fi

MATCH_COUNT=$(echo "$MATCHED_OBJECTS" | wc -l | tr -d ' ')
TOTAL_SIZE=$(echo "$MATCHED_OBJECTS" | jq -s '[.[].Size] | add // 0')
MATCHED_KEYS=$(echo "$MATCHED_OBJECTS" | jq -r '.Key')

# --- List mode: display with details and exit (only when no branch AND no key) ---

if [[ -z "$INPUT_BRANCH" && -z "$KEY_PATTERN" ]]; then
  echo ""
  echo "=== Cache entries for ${GITHUB_REPOSITORY} ==="
  echo ""
  print_table "$MATCHED_OBJECTS"
  echo ""
  echo "Total: ${MATCH_COUNT} object(s), $(format_size "$TOTAL_SIZE")"
  write_summary "Cache entries for ${GITHUB_REPOSITORY}" "$MATCHED_OBJECTS" "$MATCH_COUNT" "$TOTAL_SIZE"
  exit 0
fi

# --- Phase 2: Delete matched objects ---

echo ""
if [[ -n "$INPUT_BRANCH" && -n "$KEY_PATTERN" ]]; then
  echo "Matched ${MATCH_COUNT} object(s) for branch='${BARE_BRANCH:-$INPUT_BRANCH}' key='${KEY_PATTERN}' ($(format_size "$TOTAL_SIZE"))"
elif [[ -n "$INPUT_BRANCH" ]]; then
  echo "Matched ${MATCH_COUNT} object(s) for branch='${BARE_BRANCH:-$INPUT_BRANCH}' ($(format_size "$TOTAL_SIZE"))"
else
  echo "Matched ${MATCH_COUNT} object(s) for key='${KEY_PATTERN}' across all branches ($(format_size "$TOTAL_SIZE"))"
fi

if [[ "${DRY_RUN:-false}" == "true" ]]; then
  echo ""
  echo "=== DRY RUN - the following objects would be deleted ==="
  echo ""
  print_table "$MATCHED_OBJECTS"
  echo ""
  echo "Total: ${MATCH_COUNT} object(s) would be deleted ($(format_size "$TOTAL_SIZE"))"
  write_summary "DRY RUN - objects that would be deleted" "$MATCHED_OBJECTS" "$MATCH_COUNT" "$TOTAL_SIZE"
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
echo "Cache cleanup completed. ${DELETED} object(s) deleted ($(format_size "$TOTAL_SIZE"))."
write_summary "Deleted cache entries" "$MATCHED_OBJECTS" "$DELETED" "$TOTAL_SIZE"
