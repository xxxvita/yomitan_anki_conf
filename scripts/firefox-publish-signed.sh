#!/usr/bin/env bash
# Upload an AMO-signed Firefox XPI to R2 at the URL referenced by
# releases/firefox-updates.json. Since v0.4.2 AMO lists and updates the add-on;
# R2 only moves copies installed before v0.4.2 onto AMO. Run AFTER AMO has
# signed the v{X} submission (see docs/development/releasing.md).
#
# Flow:
#   1. Tag v{X} → CI builds yomitan-firefox.zip → R2 has unsigned zip.
#   2. Maintainer: upload yomitan-firefox.zip to AMO Developer Hub
#      → AMO signs it → download flib-club-{X}.xpi.
#   3. Run this script: ./scripts/firefox-publish-signed.sh {X} ~/Downloads/flib-club-{X}.xpi
#      → uploads the signed XPI, the floating releases/latest copy and
#        releases/firefox-updates.json (last).
#   4. Copies with the old update_url start updating to v{X} on next poll
#      (Firefox polls roughly daily; force-check via about:addons).
#
# This is a thin wrapper around `r2-publish-release-assets.sh firefox-xpi`,
# the same code publish-assets.yml runs, so the checks are identical
# (signature, version, gecko id, exact update_link, no rollback of the
# published manifest, releases/latest only for the newest version).
# Difference: firefox-updates.json is read from the working tree, not the tag.
#
# Required env (set once in ~/.config/anki-conf-yomitan/r2.env or shell):
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  — R2 access keys
#   R2_ACCOUNT_ID                              — Cloudflare R2 account id
#   R2_BUCKET                                  — bucket name
#   R2_PUBLIC_BASE_URL                         — e.g. https://pub-XXX.r2.dev
# DRY_RUN=1 runs the checks and prints the uploads without credentials.
#
# Without local credentials use .github/workflows/publish-assets.yml
# (kind=firefox-xpi) instead; see docs/development/releasing.md.

set -euo pipefail

if [ "$#" -lt 2 ]; then
    cat <<'USAGE'
Usage: firefox-publish-signed.sh <version> <path-to-signed.xpi>
Example: firefox-publish-signed.sh 0.3.1 ~/Downloads/flib-club-0.3.1.xpi
USAGE
    exit 2
fi

VERSION_RAW="$1"
XPI_PATH="$2"

# Accept 0.4.0 or 0.4.0.0; the tag (and R2 path) uses 3 segments.
if [[ "$VERSION_RAW" =~ ^([0-9]+\.[0-9]+\.[0-9]+)(\.0)?$ ]]; then
    TAG="v${BASH_REMATCH[1]}"
else
    echo "✗ version must be X.Y.Z or X.Y.Z.0, got: $VERSION_RAW" >&2
    exit 2
fi

if [ ! -f "$XPI_PATH" ]; then
    echo "✗ XPI file not found: $XPI_PATH" >&2
    exit 1
fi

for var in R2_ACCOUNT_ID R2_BUCKET R2_PUBLIC_BASE_URL; do
    if [ -z "${!var:-}" ]; then
        echo "✗ Missing env var: $var" >&2
        echo "  Source your R2 credentials env file first." >&2
        exit 1
    fi
done
export R2_ENDPOINT_URL="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"

# The publisher wants a directory holding exactly one *.xpi.
ASSETS="$(mktemp -d)"
trap 'rm -rf "$ASSETS"' EXIT
cp -- "$XPI_PATH" "$ASSETS/yomitan-firefox.xpi"

"$SCRIPT_DIR/r2-publish-release-assets.sh" firefox-xpi "$TAG" "$ASSETS" "$ROOT/releases/firefox-updates.json"

echo
echo "✓ Done. Firefox users with an older version will see ${TAG} on next poll."
echo "  Force-check from about:addons → Manage Extensions → ⚙ → Check for Updates."
