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
check "modal cue overlay (.entry-video-examples-modal-cue) rule present" \
    grep -qE '\.entry-video-examples-modal-cue\b' "$CSS"
check "modal cue HL class (.entry-video-examples-modal-cue-hl) rule present" \
    grep -qE '\.entry-video-examples-modal-cue-hl\b' "$CSS"
check "modal cue HL carries #e3b54a" \
    bash -c "grep -B1 -A6 'entry-video-examples-modal-cue-hl' '$CSS' | grep -q '#e3b54a'"

heading "video-examples-modal.js — JS-driven caption overlay"
check "parseVttCues() function defined" \
    grep -qE 'function parseVttCues' "$MODAL"
check "highlightCueParts takes array (not single word)" \
    grep -qE 'function highlightCueParts\(text, words\)' "$MODAL"
check "no leftover <track> element (replaced by JS overlay)" \
    bash -c "! grep -qE \"document\\.createElement\\('track'\\)\" '$MODAL'"
check "no leftover Blob([...], {type: text/vtt})" \
    bash -c "! grep -qE \"new Blob\\(.*type:.*text/vtt\" '$MODAL'"
check "no leftover ::cue() selectors in code (comments OK)" \
    bash -c "if grep -v '^[[:space:]]*//' '$MODAL' | grep -v '^[[:space:]]*\\*' | grep -qE '[\"\\x27].*::cue\\('; then exit 1; else exit 0; fi"
check "no leftover makeHighlightWrapper (no <c.hl> tags needed)" \
    bash -c "! grep -q 'makeHighlightWrapper' '$MODAL'"
check "modal-cue overlay element created in _build" \
    bash -c "awk '/_build\\(clip\\)/,/^    \\}\$/' '$MODAL' | grep -q 'entry-video-examples-modal-cue'"
check "_mountSubtitle attaches timeupdate handler" \
    bash -c "awk '/_mountSubtitle/,/^    \\}\$/' '$MODAL' | grep -q 'timeupdate'"
check "_openInNewTab uses opener-side timeupdate handler" \
    bash -c "awk '/_openInNewTab/,/^    \\}\$/' '$MODAL' | grep -q 'timeupdate'"
check "_activeWords field (array) replaces _activeWord (string)" \
    bash -c "grep -q '_activeWords' '$MODAL' && ! grep -q '_activeWord[^s]' '$MODAL'"

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

heading "Built artifacts (builds/unpacked/ + builds/cu)"
# CRITICAL — these are the paths Chrome actually loads from. The user loads
# unpacked from builds/cu/ (a symlink to one of builds/unpacked/yomitan-*/
# after `./scripts/build-all.sh`). If we forget to rebuild, the unpacked dir
# stays stale and no amount of extension reloading will pick up source
# changes. Compare BUILD_FINGERPRINT across every artifact + cu vs source.
SRC_FP=$(grep -oE "BUILD_FINGERPRINT = '[^']+'" "$PANEL" | head -1 | sed "s/.*'\\(.*\\)'/\\1/")
UNPACK_BASE="$ROOT/builds/unpacked"
BUILD_MISMATCH=0
if [ -d "$UNPACK_BASE" ]; then
    for variant in "$UNPACK_BASE"/*/; do
        name=$(basename "$variant")
        built_panel="$variant/js/display/video-examples-panel.js"
        if [ ! -f "$built_panel" ]; then
            no "$name: video-examples-panel.js missing — rerun ./scripts/build-all.sh"
            BUILD_MISMATCH=1
            continue
        fi
        built_fp=$(grep -oE "BUILD_FINGERPRINT = '[^']+'" "$built_panel" | head -1 | sed "s/.*'\\(.*\\)'/\\1/")
        if [ "$built_fp" = "$SRC_FP" ]; then
            ok "$name: fingerprint matches source ($built_fp)"
        else
            no "$name: fingerprint $built_fp ≠ source $SRC_FP — rerun ./scripts/build-all.sh"
            BUILD_MISMATCH=1
        fi
    done
else
    no "builds/unpacked/ does not exist — run ./scripts/build-all.sh first"
    BUILD_MISMATCH=1
fi
# builds/cu — the load-unpacked path the user actually points Chrome at.
# Should be a symlink to one of the variants above; warn loudly if it's
# anything else (a copy, missing, or pointing somewhere outside builds/).
CU="$ROOT/builds/cu"
if [ -L "$CU" ]; then
    target=$(readlink "$CU")
    cu_panel="$CU/js/display/video-examples-panel.js"
    cu_fp=$(grep -oE "BUILD_FINGERPRINT = '[^']+'" "$cu_panel" 2>/dev/null | head -1 | sed "s/.*'\\(.*\\)'/\\1/")
    if [ "$cu_fp" = "$SRC_FP" ]; then
        ok "builds/cu → $target (fingerprint matches source)"
    else
        no "builds/cu → $target (fingerprint $cu_fp ≠ source $SRC_FP)"
        BUILD_MISMATCH=1
    fi
elif [ -d "$CU" ]; then
    no "builds/cu is a real directory (not a symlink) — Chrome loads from here but build-all.sh won't update it. Run: rm -rf builds/cu && ln -s unpacked/yomitan-chrome-dev builds/cu"
    BUILD_MISMATCH=1
else
    no "builds/cu does not exist — run: ln -s unpacked/yomitan-chrome-dev builds/cu"
    BUILD_MISMATCH=1
fi
if [ "$BUILD_MISMATCH" -eq 1 ]; then
    echo ""
    echo "  ⚠  Chrome loads from builds/cu/. Source edits don't reach the"
    echo "     browser until you run:"
    echo "       ./scripts/build-all.sh 0.0.0.N      # bump N each time"
    echo "     and then chrome://extensions → Reload Flib-club."
fi


heading "Summary"
TOTAL=$((PASS + FAIL))
echo "  $PASS / $TOTAL passed"
[ "$FAIL" -eq 0 ] || echo "  $FAIL failed"
exit "$FAIL"
