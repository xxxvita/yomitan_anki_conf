#!/usr/bin/env bash
# Upload an AMO-signed Firefox XPI to R2 at the URL referenced by
# releases/firefox-updates.json. Run AFTER you submit the v{X} zip to
# addons.mozilla.org Unlisted and AMO returns a signed .xpi file.
#
# Flow:
#   1. Tag v{X} → CI builds yomitan-firefox.zip → R2 has unsigned zip.
#   2. Maintainer: upload yomitan-firefox.zip to AMO Developer Hub
#      → AMO signs it → download flib-club-{X}.xpi.
#   3. Run this script: ./scripts/firefox-publish-signed.sh {X} ~/Downloads/flib-club-{X}.xpi
#      → uploads signed XPI to R2 at the path Firefox expects.
#   4. Installed users start auto-updating to v{X} on next poll
#      (Firefox polls roughly daily; force-check via about:addons).
#
# Required env (set once in ~/.config/anki-conf-yomitan/r2.env or shell):
#   AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY  — R2 access keys
#   R2_ACCOUNT_ID                              — Cloudflare R2 account id
#   R2_BUCKET                                  — bucket name
#   R2_PUBLIC_BASE_URL                         — e.g. https://pub-XXX.r2.dev
#
# Idempotent: re-running with the same XPI is a no-op overwrite.

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

# Two forms of the version coexist:
#   • TAG_VERSION (3-segment, e.g. "0.3.1") — used in R2 path
#     `releases/v{TAG_VERSION}/yomitan-firefox.xpi`. Mirrors how
#     release.yml builds prefix from the git tag.
#   • MANIFEST_VERSION (4-segment, e.g. "0.3.1.0") — what Chrome/Gecko
#     write into manifest.json after build-all.sh's pad-to-4 step. The
#     `version` field in firefox-updates.json must match this 4-segment
#     form (Firefox compares to the installed XPI's manifest version).
# Caller may pass either form — normalize both directions.
DOTS=$(printf '%s' "$VERSION_RAW" | tr -cd '.' | wc -c)
TAG_VERSION="$VERSION_RAW"
MANIFEST_VERSION="$VERSION_RAW"
if [ "$DOTS" -eq 2 ]; then
    # 3-segment in → pad to 4 for manifest
    MANIFEST_VERSION="${VERSION_RAW}.0"
elif [ "$DOTS" -eq 3 ]; then
    # 4-segment in → strip trailing .0 for tag path (release.yml uses bare tag)
    TAG_VERSION="${VERSION_RAW%.0}"
fi
VERSION="$TAG_VERSION"

if [ ! -f "$XPI_PATH" ]; then
    echo "✗ XPI file not found: $XPI_PATH" >&2
    exit 1
fi

for var in AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY R2_ACCOUNT_ID R2_BUCKET R2_PUBLIC_BASE_URL; do
    if [ -z "${!var:-}" ]; then
        echo "✗ Missing env var: $var" >&2
        echo "  Source your R2 credentials env file first." >&2
        exit 1
    fi
done

R2_ENDPOINT_URL="https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
KEY="releases/v${VERSION}/yomitan-firefox.xpi"

# Sanity-check that this version is referenced in firefox-updates.json —
# otherwise we'd upload an XPI that no Firefox install would ever fetch.
SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
UPDATES_JSON="$ROOT/releases/firefox-updates.json"
if [ -f "$UPDATES_JSON" ]; then
    EXPECTED_URL="${R2_PUBLIC_BASE_URL}/${KEY}"
    if ! grep -q "\"${MANIFEST_VERSION}\"" "$UPDATES_JSON"; then
        echo "⚠  Version ${MANIFEST_VERSION} is not in $UPDATES_JSON updates[]." >&2
        echo "   Firefox users polling won't see this version." >&2
        echo "   Edit firefox-updates.json + commit + retag/push before running this." >&2
        exit 1
    fi
    if ! grep -qF "$EXPECTED_URL" "$UPDATES_JSON"; then
        echo "⚠  update_link for v${VERSION} in firefox-updates.json doesn't match" >&2
        echo "   the path I'm about to upload to:" >&2
        echo "     expected: $EXPECTED_URL" >&2
        echo "   Fix the JSON or run with the matching version." >&2
        exit 1
    fi
fi

SIZE=$(stat -c '%s' "$XPI_PATH")
SHA=$(sha256sum "$XPI_PATH" | awk '{print $1}')
echo "Uploading signed XPI:"
echo "  file:   $XPI_PATH"
echo "  size:   $SIZE bytes"
echo "  sha256: $SHA"
echo "  to:     s3://${R2_BUCKET}/${KEY}"
echo "  url:    ${R2_PUBLIC_BASE_URL}/${KEY}"

aws s3 cp "$XPI_PATH" "s3://${R2_BUCKET}/${KEY}" \
    --endpoint-url "$R2_ENDPOINT_URL" \
    --content-type application/x-xpinstall \
    --cache-control "public, max-age=86400, immutable" \
    --no-progress

echo
echo "✓ Done. Firefox users with v${VERSION} preinstalled will see the update on next poll."
echo "  Force-check from about:addons → Manage Extensions → ⚙ → Check for Updates."
