# Video Examples Panel — Design Migration Spec **v2 / addenda**

This document supersedes v1 (`video-examples-design-spec.md`) where the two conflict. Original v1 is kept as the structural starting point; v2 here resolves all BLOCKER/MAJOR findings from two independent audit agents (design-vs-spec, code-vs-spec).

---

## Resolved open questions (from v1)

1. **Right-panel scope** — _out of scope_. We touch only `.entry-video-examples*` and the panel iframe placement. Yomitan dict-entry left side (chips, headword, glosses) and right side (+/Ex/sound buttons) stay untouched.
2. **Send-to-Anki button semantics** — _option C_ (new). Button does NOT call `_applySelectedClipsToNote()` directly (mismatched signature, requires `note` + `requirements` + `cardFormatIndex`). Instead the button delegates to the entry's existing save flow: `entry.querySelector('.action-button[data-action="save-note"]').click()`. The global save pipeline then sees the selected `clip_ids` from the panel via the existing `_videoExamplesPanels` registry. Zero changes to `_applySelectedClipsToNote`. F2 replay panels have no footer (saved already), no issue.
3. **IBM Plex font loading** — _bundle locally_. Current manifest CSP is `style-src 'self' 'unsafe-inline'; default-src 'self'` and has NO `font-src`. Loading from `fonts.googleapis.com` / `fonts.gstatic.com` would be silently blocked. We embed `IBMPlexSans-{Regular,Medium,SemiBold,Bold}.woff2` + `IBMPlexMono-{Regular,Medium,SemiBold}.woff2` under `ext/fonts/` and `@font-face` from `'self'`. Works offline too.
4. **`target` clip count for "N of 3"** — _hardcode 3 for MVP_. Tag with `// TODO(spec-v3): read from status.target_count once Core adds it`. Add to outstanding Core asks in handoff.

---

## BLOCKER resolutions

### B1. `:has()` grid layout — KEEP it (do NOT remove)

v1 §"Existing UX to remove" item 5 said to remove the `:has()` grid layout in favor of explicit panel width. **Wrong.** Width alone does not POSITION the panel. The grid rule is what places the panel to the right of the dict entry.

**Correct delta:**

- KEEP `.entry:has(.entry-video-examples) { display: grid; grid-template-columns: 1fr <panel-width>; }`
- Update column width: `clamp(320px, 32%, 348px)` (was `clamp(220px, 32%, 320px)`)
- KEEP the `.entry[data-type='phrase'] > .entry-video-examples { grid-area: auto; }` rule — phrase entries stack below.

---

## MAJOR resolutions (from both audits)

### M1. `src` (movie title) field — DROP from Meta row

Plugin has no `src` field (`ClipStatus` has `cefr, difficulty, year, recut`, no source/movie title). Design's Meta row "CEFR · diff N · source-title" cannot render.

**Decision:** Meta row becomes `CEFR · diff N · year` (when year > 0) or `CEFR · diff N` (when year is 0 or unset). Drop the orphan-separator risk.

**`tc` (timecode)** — design data has it but `panel.jsx` never renders it. Plugin doesn't need it. Not mentioned in spec going forward.

### M2. `diff` field naming

Design uses `clip.diff`, plugin uses `clip.difficulty`. **Decision:** render as `diff ${clip.difficulty}` (token "diff" preserved as label).

### M3. Saved-badge differs by density

| Density | Replay (saved) badge                                                               | Position                          |
| ------- | ---------------------------------------------------------------------------------- | --------------------------------- |
| Large   | Pill: `[✓ saved]` (`accent(0.9)` bg, `accentFg` icon+text, 7px radius, 10.5px/700) | Top-left of thumb, 9px from edges |
| Compact | Mini-check: 17×17 square, `accent(0.92)` bg, `accentFg` ✓ icon only, 5px radius    | Top-left of thumb, 4px from edges |

Two distinct visual treatments, NOT one shared badge.

### M4. Header — exact strings per state

Header title:

- Default: `"Examples"`
- `mode === 'replay'`: `"Saved examples"` (title swap is REQUIRED)

Status line (mono 12.5px, fgDim, padded 32px from left to align under title):

| Plugin state                                                  | Status text                                                                                | Color                             |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------ | --------------------------------- |
| `loading` (queued/polling, 0 clips)                           | `<scissor-wiggle>Searching & cutting clips<dots>`                                          | accent for icon, fgDim for text   |
| `loading` (partial, N clips arrived)                          | `${count} of 3 found`                                                                      | fgDim                             |
| `ready` AND replay                                            | `${count} attached to this note`                                                           | fgDim                             |
| `ready` AND collect                                           | `${count} clips<accent-frag> · ${N} selected</accent-frag>` (when N>0) OR `${count} clips` | fgDim + accent for selected count |
| `error` (`failed`/`expired`/`timeout` AND NOT `empty_reason`) | `Couldn't fetch clips`                                                                     | danger                            |

Refresh icon: hidden when state is `loading`. Visible otherwise. Always paired with close `×`.

### M5. Subtitle highlighting — regex + case preservation

**Use Unicode-aware regex** (Agent B finding): JavaScript's `\b` is ASCII-only; Yomitan is multilingual.

```js
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function splitSubtitle(text, word) {
  if (typeof text !== "string" || text.length === 0) {
    return null;
  }
  if (typeof word !== "string" || word.length === 0) {
    return null;
  }
  const pattern = `(?<![\\p{L}\\p{N}])(${escapeRegExp(word)})(?![\\p{L}\\p{N}])`;
  let re;
  try {
    re = new RegExp(pattern, "iu");
  } catch {
    return null;
  }
  const m = re.exec(text);
  if (m === null) {
    return null;
  }
  return {
    a: text.slice(0, m.index),
    w: m[1], // <-- preserve original casing from the subtitle
    b: text.slice(m.index + m[1].length),
  };
}
```

- Render `<mark class="entry-video-examples-mark">` around `w`.
- Falls back to plain text on: empty `word`, empty `text`, no match, regex throw.
- CSS:
  ```css
  .entry-video-examples-mark {
    background: transparent;
    color: var(--ve-gold, #e3b54a);
    font-weight: 700;
    border-bottom: 1.5px solid rgba(227, 181, 74, 0.5);
  }
  ```

### M6. Ghost "Play" button — Large card body, missing in v1

Large card body has a ghost Play button right of Meta row:

```
border: 1px cardBd, bg rgba(255,255,255,0.05), color fgMid,
radius 8, padding 5/10, fontSize 11.5/600,
<playS-icon> + "Play"
```

### M7. "Replay arrival" link — mock-only, NOT shipped

Design's "Replay arrival" footer link is a mock-flow artifact (replays the timed cadence `[850, 1750, 2650, 3300]ms`). In production Polling is real — no manual replay needed. **Cut from spec.**

Cadence array `[850, 1750, 2650, 3300]` is also mock-only. In production, clip cards arrive when `onWordUpdate` fires from orchestrator. No client-side timer.

### M8. Modal VTT highlighting — split into separate scope

v1 conflated panel subtitle highlight with modal VTT `<c.highlighted>` rewrite. The design source has ZERO modal work. **Decision:** modal VTT changes split into a follow-up task. Not part of this panel rewrite. (Original VTT rewrite implementation in `srtToVtt()` is still pending Core's `<c.highlighted>` adoption — handled separately.)

This panel rewrite does NOT change `video-examples-modal.js` (beyond v1's atomic ⛶ removal, already done).

### M9. `.ve-pop` diff strategy — only animate NEW cards

Without diff, every `onWordUpdate` poll pops every card → visually jittery.

**Implementation:**

```js
// In constructor
this._seenClipIds = new Set();

// In _renderClips (or wherever new design rebuilds)
for (const clip of clips) {
  const card = this._buildCard(clip);
  if (!this._seenClipIds.has(clip.clip_id)) {
    card.classList.add("entry-video-examples-pop");
    this._seenClipIds.add(clip.clip_id);
  }
  frag.appendChild(card);
}
```

Note: clipping IDs from F2 replay use `replay:<cache_key>` prefix — distinct from F1 collect IDs (`<job>:<word>:<idx>`). Switching mode (collect → save → re-open as replay) gives new IDs, so all-replay cards pop on first F2 mount. Acceptable.

### M10. `_renderClips` blob URL discipline — PRESERVE

v1 §Files-to-modify lists "Rewrite `_renderClips()` to use new card structure". **Restate:** the snapshot-clear-rebuild-revoke order MUST stay. Only the per-card builder changes.

```js
// PRESERVE this skeleton:
_renderClips(clips) {
    const oldUrls = [...this._blobUrls];
    this._blobUrls.clear();
    const frag = document.createDocumentFragment();
    for (const clip of clips) { frag.appendChild(this._buildCard(clip)); }  // <-- only this line's body changes
    this._gridEl.replaceChildren(frag);
    this._gridEl.hidden = false;
    this._emptyEl.hidden = true;
    this._errorEl.hidden = true;
    for (const u of oldUrls) { URL.revokeObjectURL(u); }
}
```

### M11. CSS class names — KEEP, restyle only

DO NOT rename:

- `.entry-video-examples-clip` (mount selector)
- `.entry-video-examples-clip-selected` (toggled by JS)
- `.entry-video-examples-grid` (queried by JS via `_gridEl`)
- `.entry-video-examples-empty` (queried via `_emptyEl`)
- `.entry-video-examples-error` (queried via `_errorEl`)
- `.entry-video-examples-status` (queried via `_statusEl`)
- `.popup-toolbar-density`, `.popup-toolbar-density-seg`, `.is-on` (density toggle, created by display-anki.js)
- `.entry-video-examples-mark` (new — to be added)

ONLY CSS rules change. JS class-toggle calls stay.

### M12. Modal `open()` signature — NOT changing

v1 said `open(clip, {word})`. **Reverted.** Modal VTT highlight scope split out (see M8); no need to pass `word`. Modal stays `open(clip)`. The 3 call sites in display-anki.js (`onClipOpen` hooks in F1 collect / F2 explicit / F2 auto-mount) stay untouched.

### M13. Partial-state empty slot — exact copy + icon

When `clips.length < 3` AND state has settled (ready/expired):

```
[dashed box, 1px hairline, fgDim text, fontSize 12, padding 9/11, radius 11]
[fgFaint film-strip icon (VI.empty SVG)]  Only ${count} of 3 clips were found.  [<linkBtn>Retry the missing</linkBtn> →]
```

NOT shown in `loading` state — only when polling resolves with fewer than 3.

### M14. Send-to-Anki primary button — exact dimensions

```
[plus-icon] [label: "Send N to Anki"] [anki-icon (marginLeft: auto)]
flex display, width 100%, padding 10/13, radius 10,
fontSize 13.5 / 700, accent bg, accentFg text,
box-shadow: 0 6px 18px rgba(70,196,138,0.32)
```

Click handler: `entry.querySelector('.action-button[data-action="save-note"]').click()` — delegates to global save (per Open Q2 resolution).

When `selectedCount === 0`: replaced with centered hint:
`[disabled checkbox glyph] Tick clips to attach them to your note`

---

## Missing tokens added to v1 table

| Token        | Hex                     | Used in                                                            |
| ------------ | ----------------------- | ------------------------------------------------------------------ |
| `accentDim2` | `rgba(70,196,138,0.22)` | (reserved — not used by current panel but exposed for consistency) |
| `accentRGB`  | `"70,196,138"`          | (reserved — for inline rgba() interpolation if needed)             |

---

## Pinned dimensions (Agent A MINORs)

- **Reel-icon chip**: 24×24 grid, `accentDim` bg, 7px radius. Inner SVG: 15×15.
- **Word pill**: padding `2px 9px`, radius 999, fontSize 12.5/700, sparkle icon + text inline.
- **Primary button**: see M14.
- **Icon button (refresh, close)**: 28×28, transparent bg, fgDim, 8px radius. No hover state in design — add `:hover { background: rgba(255,255,255,0.06); }` for affordance.
- **Card hover bg** (`cardBg2 = #171b22`): COMPACT only. Large card has no bg-shift on hover; only PlayOverlay opacity changes.
- **Selected card** (both densities): bg `accentSoft`, border `1.5px accent`, box-shadow `0 0 0 1px accent, 0 10px 28px accent(0.18)`.

---

## a11y additions (Agent B NIT)

- Refresh icon: `aria-label="Get clips again"`
- Close icon: `aria-label="Close panel"`
- Checkbox: `aria-label="Select for Anki"` / `aria-label="Selected"` based on state
- Density toggle: existing `aria-pressed` should stay
- Subtitle `<mark>`: no aria needed (visual emphasis only)

---

## Updated file modification list

### `ext/js/display/video-examples-panel.js`

- Add `_seenClipIds: Set<string>` to constructor
- Add `_splitSubtitle(text, word)` static helper
- Replace `_renderSkeletons` with `_renderLoading()` (no card skeletons in v2; just header status + dots)
- Replace `_buildClipCard(clip)` with mode×density dispatch:
  - `_buildLargeCard(clip, mode)` where mode ∈ {collect, replay}
  - `_buildCompactCard(clip, mode)`
- Add `_renderHeader()` building new header DOM (reel-chip + title + word-pill + icons + status line)
- Add `_renderFooter()` building Send-to-Anki button OR hint row
- Replace `_renderEmpty()` with two paths: empty-with-reason (no error chrome) and partial-slot (dashed, "Only N of 3 found")
- Replace `_renderError()` body with design's alert block ("No clips found" + Try again primary button)
- KEEP blob URL discipline in `_renderClips`
- ADD `entry-video-examples-pop` class only when clip_id is new

### `ext/css/display.css`

- Replace all `.entry-video-examples*` rules (~lines 2400-2700) with new tokens
- Add 4 animation keyframes
- Add `.entry-video-examples-mark` rule for subtitle highlight
- KEEP `:has()` grid rule (with updated column width)
- KEEP `.popup-toolbar-density*` rules (restyle to match design palette only)
- DELETE old `.entry-video-examples-modal-fullscreen` rules (already removed in atomic change)
- Add `@font-face` declarations for IBM Plex Sans + Mono pointing to `chrome-extension://…/fonts/IBMPlex*.woff2`

### `ext/js/display/display-anki.js`

- `_ensureVideoExamplesDensityToggle()` — keep, just verify segmented control matches design palette (CSS-side change)
- No changes to `_applySelectedClipsToNote()` (per Open Q2 resolution)
- No changes to F2 auto-mount logic

### `ext/js/display/video-examples-orchestrator.js`

- NO CHANGES.

### `ext/js/display/video-examples-modal.js`

- NO CHANGES (per M12 — VTT highlight scope split out).

### `ext/fonts/` (new directory)

- Add 7 woff2 files (≈250 KB total): `IBMPlexSans-{Regular,Medium,SemiBold,Bold}.woff2`, `IBMPlexMono-{Regular,Medium,SemiBold}.woff2`
- Source: https://github.com/IBM/plex/raw/master/packages/plex-sans/web/woff2/ — pinned to release tag

### `manifest.json`

- NO CHANGES (fonts are 'self' — already covered by CSP default-src).

---

## Items v1 promised that v2 cuts

- Modal `<c.highlighted>` VTT rewrite — _split to follow-up task_ (M8)
- Modal `open(clip, {word})` signature change — _reverted_ (M12)
- "Replay arrival" footer link — _mock-only, not shipped_ (M7)
- Empty skeleton grid up front — _replaced with header-only "Searching…" indicator_ (per user)
- Per-card progressive timing `[850, 1750, 2650, 3300]` — _mock-only_
- Movie title (`src`) in Meta row — _dropped, no source field_ (M1)

---

## Build & verification (unchanged from v1)

```
npm run test:js && npm run test:ts:main && npm run test:css && npm run test:build
./scripts/build-all.sh
rsync -a --delete builds/unpacked/yomitan-chrome/ builds/cu/
```

## Manual smoke tests

1. **Layout**: F1 collect for new word → panel renders to RIGHT of dict entry (grid still works), iframe widened to 820+px.
2. **Loading**: header shows scissor + dots ("Searching & cutting clips…"). NO card skeletons up front.
3. **Card arrival**: as polls land partial results, each new clip `.ve-pop`s in once. Existing cards do NOT re-animate.
4. **Selection**: tick 2 → footer shows `[+ Send 2 to Anki [anki-icon]]`. Status line shows `3 clips · 2 selected` (accent color on selected count).
5. **Save**: click Send → triggers global `+` flow → clips persist + Anki note created. Footer disappears (panel becomes saved/replay).
6. **F2 auto-mount**: saved word → panel auto-opens in replay mode → title `Saved examples`, gold `[✓ saved]` pill on Large cards (mini-check on Compact), no checkboxes, no footer.
7. **Partial**: Core returns 2 of 3 → footer Send button works, dashed slot at bottom says `Only 2 of 3 clips were found. [Retry the missing]`.
8. **Error**: Core actually fails (network drop) → header status `Couldn't fetch clips` (danger color), body shows alert + Try again button.
9. **Empty-with-reason** (e.g., `summing`): no error chrome, dashed slot says `No video examples found for this word`.
10. **Highlight**: subtitle shows `<word>` in gold with underline. Multilingual: Russian / Greek / Japanese also highlight (Unicode regex).
11. **Density swap**: Large → Compact preserves selection, smooth re-render, only new cards animate.
12. **Phrase entries**: still stack below (no grid).

---

## Audit-trail of resolved items

Resolved BLOCKER: 1 (B1 grid layout)
Resolved MAJOR: 14 (M1–M14)
Resolved MINOR: 6 (pinned dimensions + a11y)
Cut: 5 items v1 over-promised
Open: 0 (all open questions from v1 resolved)
