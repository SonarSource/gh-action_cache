#!/bin/bash
set -euo pipefail
# Re-vendor the runs-on/cache save-only bundle for a given SHA.
# Usage: scripts/refresh-runs-on-save.sh <git-sha>
# Run this whenever the runs-on/cache pin in action.yml is bumped, then commit the result
# and update PROVENANCE.md (SHA + checksum table + retrieved date).
SHA="${1:?usage: refresh-runs-on-save.sh <git-sha>}"
DEST="$(cd "$(dirname "$0")/.." && pwd)/cache-save/vendor/runs-on-save-only"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT
git clone --quiet https://github.com/runs-on/cache.git "$TMP/cache"
git -C "$TMP/cache" checkout --quiet "$SHA"
rm -f "$DEST"/*.js
cp "$TMP/cache/dist/save-only/"*.js "$DEST/"
cp "$TMP/cache/LICENSE" "$DEST/LICENSE"
echo "Vendored runs-on/cache dist/save-only @ $SHA into $DEST"
echo "Now update PROVENANCE.md (SHA, retrieved date, checksum table):"
( cd "$DEST" && shasum -a 256 ./*.js )
