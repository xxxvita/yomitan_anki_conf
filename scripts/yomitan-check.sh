#!/usr/bin/env bash
# Static-analysis check for the video-examples feature. Confirms that the
# source files on disk contain the patterns the runtime expects. Run from
# repo root.
#
# Run with `--bump` to forcibly invalidate Chrome's extension cache:
# increments the patch digit of manifest version AND appends `-N` to the
# BUILD_FINGERPRINT constant. Chrome reinstalls the extension when the
# manifest version changes, which is the only fully-reliable way to flush
# its chrome-extension:// asset cache.
#
# Recovery if `./yomitan-check.sh` passes but browser still shows old code:
#   1. Run `./yomitan-check.sh --bump`
#   2. chrome://extensions → Reload Flib-club
#   3. Close ALL tabs that ever opened the popup, then reopen
#   4. Open popup-iframe DevTools (right-click inside popup → Inspect),
#      look for `BUILD_FINGERPRINT=…` in console — must match source.
#   5. If still stale, restart Chromium (`chrome://restart` in URL bar).

set -u

if [ "${1:-}" = "--bump" ]; then
    SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
    ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
    MANIFEST="$ROOT/ext/manifest.json"
    PANEL="$ROOT/ext/js/display/video-examples-panel.js"
    # Bump manifest version's last digit: a.b.c.d → a.b.c.(d+1)
    OLD_V=$(grep -oE '"version": "[0-9.]+"' "$MANIFEST" | head -1 | sed 's/.*"\([0-9.]*\)".*/\1/')
    LAST=${OLD_V##*.}
    BASE=${OLD_V%.*}
    NEW_V="${BASE}.$((LAST+1))"
    sed -i "s/\"version\": \"$OLD_V\"/\"version\": \"$NEW_V\"/" "$MANIFEST"
    # Bump fingerprint suffix: foo-vN → foo-v(N+1), or append -v2 if no suffix
    OLD_FP=$(grep -oE "BUILD_FINGERPRINT = '[^']+'" "$PANEL" | head -1 | sed "s/.*'\\(.*\\)'/\\1/")
    if [[ "$OLD_FP" =~ -v([0-9]+)$ ]]; then
        N=${BASH_REMATCH[1]}
        NEW_FP="${OLD_FP%-v*}-v$((N+1))"
    else
        NEW_FP="${OLD_FP}-v2"
    fi
    sed -i "s/BUILD_FINGERPRINT = '$OLD_FP'/BUILD_FINGERPRINT = '$NEW_FP'/" "$PANEL"
    echo "Bumped:"
    echo "  manifest version:    $OLD_V → $NEW_V"
    echo "  BUILD_FINGERPRINT:   $OLD_FP → $NEW_FP"
    echo ""
    echo "Now: chrome://extensions → Reload Flib-club → close all extension tabs → reopen."
    echo "Look for [video-examples] BUILD_FINGERPRINT=$NEW_FP in iframe console."
    exit 0
fi

SCRIPT_DIR="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd -- "$SCRIPT_DIR/.." && pwd)"
CSS="$ROOT/ext/css/display.css"
MODAL="$ROOT/ext/js/display/video-examples-modal.js"
PANEL="$ROOT/ext/js/display/video-examples-panel.js"
DISPLAY_ANKI="$ROOT/ext/js/display/display-anki.js"

PASS=0
FAIL=0

ok() { printf '  \033[32m✓\033[0m %s\n' "$1"; PASS=$((PASS+1)); }
no() { printf '  \033[31m✗\033[0m %s\n' "$1"; FAIL=$((FAIL+1)); }

check() {
    local name="$1"; shift
    if "$@" >/dev/null 2>&1; then ok "$name"; else no "$name"; fi
}

heading() { printf '\n\033[1m%s\033[0m\n' "$1"; }

heading "display.css — highlight rules"
check "panel <mark>: !important color #e3b54a" \
    grep -qE 'color:\s*#e3b54a\s*!important' "$CSS"
check "panel <mark>: !important font-weight bold" \
    grep -qE 'font-weight:\s*bold\s*!important' "$CSS"
check "modal video ::cue(c.hl) rule present" \
    grep -qE '::cue\(c\.hl\)' "$CSS"
check "::cue(c.hl) carries color #e3b54a" \
    bash -c "grep -B1 -A6 '::cue(c.hl)' '$CSS' | grep -q '#e3b54a'"

heading "video-examples-modal.js — VTT highlight wiring"
check "injectVttHighlight() function defined" \
    grep -qE 'function injectVttHighlight' "$MODAL"
check "_mountSubtitle calls injectVttHighlight before Blob" \
    bash -c "awk '/_mountSubtitle/,/^    \\}\$/' '$MODAL' | grep -q 'injectVttHighlight'"
check "_activeWords field (array) replaces _activeWord (string)" \
    bash -c "grep -q '_activeWords' '$MODAL' && ! grep -q '_activeWord[^s]' '$MODAL'"
check "track.mode forced to 'showing' (defends against user prefs)" \
    grep -q "tt\[i\]\.mode = 'showing'" "$MODAL"
check "highlightCueParts takes array (not single word)" \
    grep -qE 'function highlightCueParts\(text, words\)' "$MODAL"

heading "video-examples-panel.js — SVG + fingerprint"
ICON_COUNT=$(grep -c 'xmlns="http://www.w3.org/2000/svg"' "$PANEL")
if [ "$ICON_COUNT" -ge 12 ]; then ok "all 12 ICONS carry xmlns ($ICON_COUNT found)"
else no "only $ICON_COUNT/12 ICONS carry xmlns — DOMParser will return namespace-less roots"; fi
check "parseSvgIcon: localName-only check (no namespaceURI gate in code)" \
    bash -c "awk '/function parseSvgIcon/,/^\\}/' '$PANEL' | grep -v '^\\s*//\\|^\\s*\\*' | grep -q 'localName' && ! bash -c \"awk '/function parseSvgIcon/,/^\\}/' '$PANEL' | grep -v '^\\s*//\\|^\\s*\\*' | grep -q 'namespaceURI'\""
check "BUILD_FINGERPRINT constant exported" \
    grep -qE "export const BUILD_FINGERPRINT" "$PANEL"
check "fingerprint logged on first panel mount" \
    grep -q 'logBuildFingerprintOnce' "$PANEL"

heading "display-anki.js — modal opener passes words array"
check "_openVideoExamplesModal accepts words (string[])" \
    grep -qE '_openVideoExamplesModal\(clip, words\)' "$DISPLAY_ANKI"
check "modal.open invoked with {words}" \
    grep -q 'open(clip, {words})' "$DISPLAY_ANKI"

heading "Build identity"
FP=$(grep -oE "BUILD_FINGERPRINT = '[^']+'" "$PANEL" | head -1 | sed "s/.*'\\(.*\\)'/\\1/")
HEAD=$(cd "$ROOT" && git rev-parse --short HEAD 2>/dev/null || echo unknown)
echo "  Source BUILD_FINGERPRINT: $FP"
echo "  Source HEAD commit:       $HEAD"
echo "  In the popup-iframe DevTools console, you should see:"
echo "    [video-examples] BUILD_FINGERPRINT=$FP"
echo "  If you see an older value (or no log at all), the iframe is using"
echo "  a cached copy — close all extension tabs and reload."

heading "Functional smoke test — injectVttHighlight()"
if command -v node >/dev/null 2>&1; then
    NODE_OUT=$(node "$SCRIPT_DIR/yomitan-check-injectvtt.mjs" 2>&1)
    echo "$NODE_OUT"
    # Strip ANSI escapes before counting so the colour codes don't throw off
    # the ✓/✗ greps on terminals that pass them through.
    NODE_CLEAN=$(printf '%s\n' "$NODE_OUT" | sed -e 's/\x1b\[[0-9;]*m//g')
    NODE_PASS=$(printf '%s\n' "$NODE_CLEAN" | grep -c '✓' || true)
    NODE_FAIL=$(printf '%s\n' "$NODE_CLEAN" | grep -c '✗' || true)
    PASS=$((PASS + NODE_PASS))
    FAIL=$((FAIL + NODE_FAIL))
else
    no "node not on PATH — skipping injectVttHighlight smoke test"
fi

heading "Summary"
TOTAL=$((PASS + FAIL))
echo "  $PASS / $TOTAL passed"
[ "$FAIL" -eq 0 ] || echo "  $FAIL failed"
exit "$FAIL"
