#!/bin/bash
set -euo pipefail

# Tests for scripts/cleanup-cache.sh
# Uses a mock aws CLI to capture arguments and verify correctness.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
CLEANUP_SCRIPT="$PROJECT_ROOT/scripts/cleanup-cache.sh"

PASS=0
FAIL=0

# ── helpers ──────────────────────────────────────────────────────────

assert_contains() {
  local label="$1" file="$2" expected="$3"
  if grep -qF -- "$expected" "$file"; then
    echo "PASS: ${label}"
    PASS=$((PASS + 1))
  else
    echo "FAIL: ${label}"
    echo "  Expected to find: ${expected}"
    echo "  In: $(cat "$file")"
    FAIL=$((FAIL + 1))
  fi
}

assert_not_contains() {
  local label="$1" file="$2" unexpected="$3"
  if grep -qF -- "$unexpected" "$file"; then
    echo "FAIL: ${label}"
    echo "  Did NOT expect to find: ${unexpected}"
    echo "  In: $(cat "$file")"
    FAIL=$((FAIL + 1))
  else
    echo "PASS: ${label}"
    PASS=$((PASS + 1))
  fi
}

# Create a temporary directory for mock and logs
TMPDIR="$(mktemp -d)"
trap 'rm -rf "$TMPDIR"' EXIT

MOCK_AWS="$TMPDIR/aws"
AWS_LOG="$TMPDIR/aws_args.log"

# Create mock aws CLI that logs all arguments
cat > "$MOCK_AWS" <<'MOCK'
#!/bin/bash
echo "$@" >> "${AWS_LOG}"
MOCK
chmod +x "$MOCK_AWS"

# Put mock first in PATH
export PATH="$TMPDIR:$PATH"

# Helper to run cleanup script with given env vars and capture aws args
run_cleanup() {
  # Clear log from previous run
  : > "$AWS_LOG"
  # Export the log path so the mock can find it
  export AWS_LOG
  # Run the script, capturing stdout (we don't assert on stdout here)
  bash "$CLEANUP_SCRIPT" >/dev/null 2>&1 || true
}

# ── Test 1: Branch-only cleanup (bare branch, no key) ───────────────

echo "--- Test 1: Branch-only cleanup (no key) ---"
export CLEANUP_BRANCH="feature/my-branch"
export S3_BUCKET="my-bucket"
export GITHUB_REPOSITORY="SonarSource/my-repo"
unset CLEANUP_KEY 2>/dev/null || true
unset DRY_RUN 2>/dev/null || true

run_cleanup

assert_contains "includes bare branch pattern" \
  "$AWS_LOG" "--include */feature/my-branch/*"
assert_contains "includes full ref pattern" \
  "$AWS_LOG" "--include */refs/heads/feature/my-branch/*"
assert_contains "uses correct S3 prefix" \
  "$AWS_LOG" "s3://my-bucket/cache/SonarSource/my-repo/"

# ── Test 2: Branch + key cleanup ────────────────────────────────────

echo ""
echo "--- Test 2: Branch + key cleanup ---"
export CLEANUP_BRANCH="develop"
export S3_BUCKET="my-bucket"
export GITHUB_REPOSITORY="SonarSource/my-repo"
export CLEANUP_KEY="sccache-Linux-"
unset DRY_RUN 2>/dev/null || true

run_cleanup

assert_contains "includes bare branch + key pattern" \
  "$AWS_LOG" "--include */develop/sccache-Linux-*"
assert_contains "includes full ref + key pattern" \
  "$AWS_LOG" "--include */refs/heads/develop/sccache-Linux-*"

# ── Test 3: Dry run mode ────────────────────────────────────────────

echo ""
echo "--- Test 3: Dry run mode ---"
export CLEANUP_BRANCH="main"
export S3_BUCKET="my-bucket"
export GITHUB_REPOSITORY="SonarSource/my-repo"
export DRY_RUN="true"
unset CLEANUP_KEY 2>/dev/null || true

run_cleanup

assert_contains "dryrun flag is present" \
  "$AWS_LOG" "--dryrun"

# ── Test 4: Bare branch input normalization ─────────────────────────

echo ""
echo "--- Test 4: Bare branch input normalization ---"
export CLEANUP_BRANCH="my-feature"
export S3_BUCKET="my-bucket"
export GITHUB_REPOSITORY="SonarSource/my-repo"
unset CLEANUP_KEY 2>/dev/null || true
unset DRY_RUN 2>/dev/null || true

run_cleanup

assert_contains "bare branch include pattern" \
  "$AWS_LOG" "--include */my-feature/*"
assert_contains "full ref include pattern derived from bare input" \
  "$AWS_LOG" "--include */refs/heads/my-feature/*"

# ── Test 5: Full ref input normalization ────────────────────────────

echo ""
echo "--- Test 5: Full ref input (refs/heads/main) ---"
export CLEANUP_BRANCH="refs/heads/main"
export S3_BUCKET="my-bucket"
export GITHUB_REPOSITORY="SonarSource/my-repo"
unset CLEANUP_KEY 2>/dev/null || true
unset DRY_RUN 2>/dev/null || true

run_cleanup

assert_contains "bare branch derived from full ref" \
  "$AWS_LOG" "--include */main/*"
assert_contains "full ref kept as-is" \
  "$AWS_LOG" "--include */refs/heads/main/*"

# ── Test 6: --exclude and --recursive always present ────────────────

echo ""
echo "--- Test 6: --exclude * and --recursive always present ---"

# Re-run a simple case to check structural flags
export CLEANUP_BRANCH="some-branch"
export S3_BUCKET="my-bucket"
export GITHUB_REPOSITORY="SonarSource/my-repo"
unset CLEANUP_KEY 2>/dev/null || true
unset DRY_RUN 2>/dev/null || true

run_cleanup

assert_contains "recursive flag present" \
  "$AWS_LOG" "--recursive"
assert_contains "exclude-all pattern present" \
  "$AWS_LOG" '--exclude *'

# Also verify dryrun is NOT present when DRY_RUN is not set
assert_not_contains "dryrun flag absent when DRY_RUN unset" \
  "$AWS_LOG" "--dryrun"

# ── Summary ─────────────────────────────────────────────────────────

echo ""
echo "=============================="
echo "Results: ${PASS} passed, ${FAIL} failed"
echo "=============================="

if (( FAIL > 0 )); then
  exit 1
fi
