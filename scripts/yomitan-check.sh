#!/usr/bin/env bash
# Static-analysis check for the video-examples feature. Confirms that the
# source files on disk contain the patterns the runtime expects. Run from
# repo root.
#
# If this script says PASS but the browser shows old behaviour, the issue
# is browser-side: Chromium caches chrome-extension:// CSS/JS aggressively.
# Recovery:
#   1. Close ALL tabs that ever opened the extension popup.
#   2. chrome://extensions → Reload Flib-club.
#   3. Reopen tabs.
# Open the popup-iframe DevTools (right-click inside the popup → Inspect)
# and look for `BUILD_FINGERPRINT=…` in the console. That value must match
# the one in `ext/js/display/video-examples-panel.js` for the load to be
# considered fresh.

set -u

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
    if node "$SCRIPT_DIR/yomitan-check-injectvtt.mjs"; then :; else FAIL=$((FAIL+1)); fi
else
    no "node not on PATH — skipping injectVttHighlight smoke test"
fi

heading "Summary"
echo "  $PASS passed, $FAIL failed"
exit "$FAIL"
