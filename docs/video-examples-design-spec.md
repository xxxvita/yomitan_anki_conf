# Video Examples Panel — Design Migration Spec

**Source**: `/home/xxxvita/Work/English/services/anki_conf/temp/anki-conf/project/Video Examples.html` and its `src/video-examples/{theme.js,panel.jsx,frames.jsx,dictionary.jsx,data.jsx}`.

**Target**: this plugin — replace current ad-hoc styling in `ext/css/display.css` (`.entry-video-examples*`) + corresponding JS in `video-examples-{panel,modal,orchestrator}.js` with the design.

**Status**: draft for review.

---

## Goal

Replace the current "skeleton-grid + retry-button-at-bottom" panel with the design from `Video Examples.html` — a polished header with reel icon + gold word-pill, progressive arrival animation, real card variants (large hero / compact row), Send-N-to-Anki footer button, gold subtitle word highlight. Behaviour stays identical (states, persistence, F2 replay, density toggle, blob-URL thumbs).

## Non-goals (intentional cuts)

- **Yomitan core dictionary styling stays untouched.** The design shows a restyled dict-entry column too — left chips, headword typography, gloss layout. We do NOT touch that. Reason: too broad; risks breaking unrelated Yomitan features; not in the user's immediate ask.
- **Film-still placeholder NOT implemented as a fallback.** The design's `FilmStill` (tone-driven gradient art) is a mock for clips without thumbs. We have real `thumb_data_url` from Core (via blob URLs) and a `<video preload=metadata #t=0.1>` fallback in F2. Both already work — no need for procedural art.
- **No new color-theming UI**. The design has a Tweaks panel with accent swatches. We hardcode the green accent. (Hue swap can come later if user asks.)
- **Modal player UI stays current** (close button + native HTML5 controls + iframe `allow="fullscreen"` already wired). My custom ⛶ button is being deleted (separate atomic change). Only thing changing in modal: subtitle highlight via `::cue(.highlighted)` to match Core's VTT `<c.highlighted>` tags.

---

## Design tokens (from `theme.js`)

| Token        | Hex                            | Where used                                |
| ------------ | ------------------------------ | ----------------------------------------- |
| `appBg`      | `#14161b`                      | (n/a — Yomitan popup bg, untouched)       |
| `dictBg`     | `#191c22`                      | (n/a — Yomitan dict surface, untouched)   |
| `panelBg`    | `#1e222a`                      | `.entry-video-examples` background        |
| `panelBd`    | `rgba(255,255,255,0.08)`       | panel border                              |
| `hairline`   | `rgba(255,255,255,0.06)`       | separators inside panel                   |
| `cardBg`     | `#13161c`                      | clip card background (resting)            |
| `cardBg2`    | `#171b22`                      | clip card background (hover)              |
| `cardBd`     | `rgba(255,255,255,0.09)`       | card border                               |
| `fg`         | `#e8ebf1`                      | primary text                              |
| `fgMid`      | `#aab0bc`                      | secondary text                            |
| `fgDim`      | `#7d8593`                      | tertiary text / meta                      |
| `fgFaint`    | `#545b67`                      | quaternary (sep dots)                     |
| `gold`       | `#e3b54a`                      | searched-word highlight + CEFR pill bg/fg |
| `danger`     | `#e57f6d`                      | error icon + text                         |
| `dangerDim`  | `rgba(229,127,109,0.13)`       | error icon bg                             |
| `dangerBd`   | `rgba(229,127,109,0.45)`       | error icon border                         |
| `accent`     | `#46c48a` (green)              | select state + Send-to-Anki button        |
| `accentDim`  | `rgba(70,196,138,0.14)`        | reel-icon chip bg in header               |
| `accentSoft` | `rgba(70,196,138,0.07)`        | selected-card bg                          |
| `accentBd`   | `rgba(70,196,138,0.5)`         | accent border                             |
| `accentFg`   | `#0c130f`                      | text on accent bg                         |
| `radius`     | `13px`                         | base radius (panel + cards)               |
| `shadow`     | `0 18px 50px rgba(0,0,0,0.55)` | panel drop-shadow                         |

**Fonts**: `IBM Plex Sans` for text, `IBM Plex Mono` for meta/timecodes/status line. Will be loaded via Google Fonts in `display.css` (already CSP-allowed via `style-src 'self' 'unsafe-inline'` + `connect-src *`).

**Sizes**: panel width 348px (large) / 320px (compact), max-height 560px.

---

## State machine mapping

Design states ↔ plugin orchestrator phase ↔ panel `_phase`:

| Design state | Plugin trigger                                                        | Panel renders                                                                                                                                                                                                                                           |
| ------------ | --------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `loading`    | `phase: queued` or `polling` AND no clips yet                         | Animated scissor icon + "Searching & cutting clips…" with `.ve-dots`. NO empty skeleton grid up front (per user). When `partial` status arrives → first clip pops in (`.ve-pop`), counter shows `1 of N found`, remaining slots show 1-2 dim skeletons. |
| `results`    | `phase: ready` AND `clips.length >= expected` (or simply all-arrived) | All cards rendered, checkboxes shown (collect mode)                                                                                                                                                                                                     |
| `partial`    | `phase: ready` AND `clips.length < target`                            | Cards + dashed empty slot at bottom "Only N of 3 found. [Retry the missing]"                                                                                                                                                                            |
| `saved`      | `mode === 'replay'` (F2 auto-mount, post-save)                        | Cards in view mode, no checkboxes, gold "✓ saved" badge on each thumb                                                                                                                                                                                   |
| `error`      | `phase: failed/expired/timeout` AND no usable clips                   | Big alert icon + "No clips found" + "Try again" primary button. NOT shown when `empty_reason` indicates "no examples in corpus" — that's handled per Core-empty fix already in place.                                                                   |

**`empty` (no-examples-in-corpus) state**: stay in `results` shape but show the design's `partial` empty hint with "No video examples found for this word" copy. NO error chrome.

---

## Component mapping (current ↔ design)

| Current (`video-examples-panel.js`)             | New (per design `panel.jsx`)                                                                         | Notes                                                                       |
| ----------------------------------------------- | ---------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| `_buildRoot()` → panel skeleton                 | `<div>` with `panelBg + panelBd + radius+2 + shadow`, max-height 560px                               | Replace inline styles via CSS class                                         |
| `_statusEl` (single line)                       | `Header` block: reel chip + title + word pill + icon buttons + status line                           | Bigger refactor                                                             |
| `_renderSkeletons`                              | Replaced by `loading` state body                                                                     | Remove blanket skeleton grid; replace with `ve-spin` scissor + "Searching…" |
| `_renderClips` → cards                          | `CardLarge` or `CardCompact` per density                                                             | Cards get `.ve-pop` arrival animation                                       |
| `_buildClipCard()`                              | `CardLarge`/`CardCompact` (separate templates)                                                       | Subtitle `<mark class="ve-mark">` wraps the searched-word slice             |
| `_renderEmpty`                                  | `partial`-state dashed slot OR `error`-state alert block                                             | Two distinct empty paths                                                    |
| Footer counter (`N selected · click + to save`) | Sticky footer: primary `Send N to Anki` button when `selected > 0`, else hint with disabled checkbox | New element `entry-video-examples-footer`                                   |
| Bottom Retry button                             | Refresh icon in header right + "Try again" button inside `ErrorState` body                           | Move out of footer                                                          |

---

## Subtitle highlighting

Design splits subtitle into `{a: before, w: searched-word, b: after}`. Plugin gets only `subtitle_text` string.

**Splitting strategy** (plugin-side):

1. Take `word` from panel's constructor arg (already there).
2. Build regex: `/\b(${escapedWord})\b/i` — first match, case-insensitive, word-boundary.
3. If match → split into `a/w/b`. Render `<span>{a}<mark class="entry-video-examples-mark">{w}</mark>{b}</span>`.
4. If no match → render as plain `<span>{subtitle_text}</span>` (no highlight).

`escapedWord = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')`.

**For lemma matching** (when search word is "summing" but transcript has "sum"): later improvement. MVP: only the exact word from `headwords[0].term`.

**In modal video subtitles**: Core needs to switch from `<span>` to `<c.highlighted>` (per WebVTT spec — already explained to user). Plugin's `srtToVtt()` should also normalize: if it sees `<span class="...">...</span>` in the cue text, rewrite to `<c.highlighted>...</c>`. CSS: `::cue(.highlighted) { color: #e3b54a; font-weight: 700; }`.

---

## Animations (CSS keyframes)

Port these from design `<style>` block to `display.css`:

```css
/* card arrival */
.entry-video-examples-pop {
  animation: entry-video-examples-pop 320ms cubic-bezier(0.2, 0.8, 0.2, 1) both;
}
@keyframes entry-video-examples-pop {
  from {
    opacity: 0;
    transform: translateY(9px) scale(0.985);
  }
  to {
    opacity: 1;
    transform: none;
  }
}

/* fly-to-anki on save */
.entry-video-examples-fly {
  animation: entry-video-examples-fly 620ms cubic-bezier(0.3, 0.7, 0.2, 1) both;
}
@keyframes entry-video-examples-fly {
  0% {
    transform: none;
  }
  35% {
    transform: translate(10px, -7px) scale(1.015);
  }
  65% {
    transform: translate(3px, -2px) scale(1.005);
  }
  100% {
    transform: none;
  }
}

/* scissor wiggle (loading status indicator) */
.entry-video-examples-spin {
  animation: entry-video-examples-spin 1.1s ease-in-out infinite;
  transform-origin: 50% 50%;
}
@keyframes entry-video-examples-spin {
  0%,
  100% {
    transform: rotate(-9deg);
  }
  50% {
    transform: rotate(9deg);
  }
}

/* "..." in "Searching…" */
.entry-video-examples-dots::after {
  content: "";
  animation: entry-video-examples-dots 1.4s steps(1) infinite;
}
@keyframes entry-video-examples-dots {
  0% {
    content: "";
  }
  25% {
    content: ".";
  }
  50% {
    content: "..";
  }
  75% {
    content: "...";
  }
}

/* skeleton shimmer (kept for partial-state slot) */
.entry-video-examples-shimmer {
  background: linear-gradient(
    90deg,
    rgba(255, 255, 255, 0.05) 25%,
    rgba(255, 255, 255, 0.11) 37%,
    rgba(255, 255, 255, 0.05) 63%
  );
  background-size: 400% 100%;
  animation: entry-video-examples-shimmer 1.4s ease infinite;
}
@keyframes entry-video-examples-shimmer {
  0% {
    background-position: 100% 0;
  }
  100% {
    background-position: 0 0;
  }
}
```

---

## Header layout (new)

```
[reel-chip (accent dim, 24x24 grid, accent fg)]  Examples  [gold-pill: ✨ {word}]   [↻] [×]
                                                            (refresh + close icons)

  [status line]   ← mono, fgDim, 12.5px, padded 32px from left to align with title
```

- Reel-chip: `accentDim` bg, accent-fg fill, 7px radius
- Title: 15px / weight 700 / `fg`
- Word pill: `gold(0.13)` bg, `gold` text, sparkle icon
- Icon buttons: 28x28, `iconBtn()` style (transparent bg, fgDim, 8px radius)
- Status line (below title): mono 12.5px, `fgDim`, min-height 16px

Refresh icon **hidden** in `loading` state.

---

## Card layouts

### LARGE

- Border: 1.5px `cardBd` (or `accent` when selected), `radius=13`
- Box-shadow: `0 0 0 1px accent, 0 10px 28px accent(0.18)` when selected
- Thumb area (16:9 aspect):
  - `<img>` with blob URL or `<video metadata #t=0.1>` fallback
  - Hover: `PlayOverlay` (circle with play icon, blur backdrop)
  - Bottom-right: duration pill (rgba bg, mono font)
  - Top-left: floating checkbox (`floating` style: black backdrop, blur) — `collect` mode only
  - Top-left: `SavedBadge` "✓ saved" — `replay` mode only
- Body (10/12/11px padding):
  - Subtitle: 14px, `fg`, line-clamp 2, gold `<mark>` around searched word
  - Meta row: CEFR pill (gold) + "diff N" + "·" + source title, all mono 11.5px

### COMPACT

- Border: 1.5px `cardBd` / `accent` selected, `radius-2=11`
- Display: flex row, 8px padding, gap 10
- Left: small checkbox (22x22) — `collect` mode only (NOT floating, inline)
- Thumb: 104px wide, 16:9 ratio, 8px radius, same overlay/badge logic
- Right: subtitle (13px) + meta row stacked

---

## Footer

Only shown in `collect` mode AND (`results` OR `partial` OR loading-done).

- `flex-shrink: 0`, padding 11px, border-top `hairline`, bg `rgba(0,0,0,0.18)`
- If `selectedCount > 0`:
  - Primary button "Send N to Anki" (accent bg, accent-fg text, plus icon, anki icon at right)
- Else:
  - Centered hint row: dim checkbox + "Tick clips to attach them to your note"

Not shown in `saved` (replay) state.

---

## Existing UX to remove

1. **Empty skeleton grid up front** (current `_renderSkeletons` SKELETON_CARD_COUNT=3) — per user, replace with animated "Searching…" indicator.
2. **Counter chip in title** (current `_setStatusCount` "N selected") — moved into footer button label.
3. **Bottom retry button always** — only in error state body, and only via header icon for non-error.
4. **Custom ⛶ fullscreen button in modal** — already removed in atomic change above (iframe permission policy now allows native HTML5 fullscreen).
5. **Conditional `:has()` grid layout** — replaced by panel having explicit width 348/320px in design, leverages the iframe-widening to 820px.

---

## Files to modify

### `ext/js/display/video-examples-panel.js`

- Add `_renderHeader()` building the new header DOM
- Add `_renderFooter()` building the footer
- Replace `_renderSkeletons()` with `_renderLoading()` (scissor + dots only, no card grid)
- Rewrite `_renderClips()` to use new card structure + `.ve-pop` animation on first-add
- Split `_buildClipCard()` into `_buildLargeCard()` + `_buildCompactCard()`
- Add `_renderError()` using new alert block + "Try again" body
- Add `_renderPartial()` dashed slot for partial state
- Add subtitle-split helper `_splitSubtitle(text, word) → {a,w,b}`
- Add `_onSavePressed()` calling `_hooks.onSaveSelected?.(selectedClipIds)` for the new footer button
- Plumbing: new constructor option `target` (default 3) for "N of M found" copy

### `ext/css/display.css`

- Replace entire `.entry-video-examples*` block (~lines 2400-2700) with new tokens
- Add new animation keyframes (4 above)
- Add `::cue(.highlighted)` rule for modal subtitle highlight
- Import IBM Plex Sans + Mono from Google Fonts at top (`@import` or `<link>` in manifest)
- Delete now-unused `.entry-video-examples-modal-fullscreen` rules

### `ext/js/display/display-anki.js`

- Already exposes `_setVideoExamplesDensity` — keep, but the density toggle CSS moves into the panel header (not popup-toolbar). UPDATE: keep density toggle in popup-toolbar — it's a global preference toggle. Just restyle to match.
- Pass `target` (clip count) to panel via options when known (post-MVP, defaults to 3)
- Wire new `onSaveSelected` hook to call `_applySelectedClipsToNote()` directly instead of waiting for global save button. (Cleaner separation; user can still hit `+` to save the whole note.)
- Subtitle for highlight in modal: pass `word` to `VideoExamplesModal.open(clip, {word})` so modal CSS can render `::cue` with the right text.

### `ext/js/display/video-examples-modal.js`

- Accept `word` in `open()` for VTT cue highlighting
- In `srtToVtt()`: if Core sends `<span class="...">w</span>`, rewrite to `<c.highlighted>w</c>` — single regex pass

### `ext/js/display/video-examples-orchestrator.js`

- No behaviour change. Already supports `partial` state semantics (per Core-empty fix).

---

## Files to add

NONE. All design changes fit in existing modules.

---

## Edge cases

| Case                                                             | Handling                                                                                            |
| ---------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `subtitle_text` has no match for `word` (e.g., conjugation only) | render plain subtitle, no `<mark>`                                                                  |
| `subtitle_text` empty                                            | render no subtitle row; thumb + meta only                                                           |
| `word` contains regex special chars                              | `escapeRegExp()` before building pattern                                                            |
| `thumb_data_url` blocked / parse fails                           | `<video preload=metadata #t=0.1>` fallback already in place                                         |
| Core sends `state=failed` with `empty_reason`                    | shows the design's "No video examples found" hint, NOT error chrome (already fixed in orchestrator) |
| F2 replay (mode=replay)                                          | no checkboxes, no footer, `SavedBadge` on each card                                                 |
| Density toggle hot-swap                                          | `setDensity()` re-renders cards (already supported); preserve selection                             |
| Multiple polls deliver more clips                                | each new clip `.ve-pop`s in; old cards stay put                                                     |
| User clicks save while clips still arriving                      | footer button enabled as soon as `selected > 0` (don't wait for `ready` state)                      |
| Panel destroyed mid-animation                                    | `destroy()` removes from DOM; CSS animations stop with element removal                              |

---

## Build & verification steps

1. Implementation per files above.
2. `npm run test:js && npm run test:ts:main && npm run test:css && npm run test:build`
3. `./scripts/build-all.sh`
4. `rsync -a --delete builds/unpacked/yomitan-chrome/ builds/cu/`
5. Reload extension, close old tabs, test:
   - F1 collect for unknown word → see scissor + "Searching…" → cards pop in → tick 1-2 → "Send 2 to Anki" footer button → click → cards animate-fly + dim
   - F1 partial (Core returns 2 of 3) → dashed slot at bottom
   - F1 ready zero clips with `empty_reason` → no-error "No video examples" hint, no Retry button
   - F1 actual fail → error block in body, header refresh icon visible
   - F2 saved word auto-mount → cards in view mode, gold "saved" badge on each thumb
   - Density toggle hot-swap preserves selection
   - Modal subtitle: when Core sends `<c.highlighted>` (or `<span class>` after plugin rewrite), word renders in gold

---

## Open questions (to confirm before coding)

1. **Right-panel scope.** User mentioned "right part" of dict to be styled. I think this means our video panel (which IS on the right). Not the Yomitan dict-entry buttons (+/Ex/sound — the right side of each headword row). Confirm before any wider change.
2. **Send-to-Anki button creates Anki note OR just attaches clips to existing note?** Design implies "Send N to Anki" = create+save now. Current plugin attaches via the global `+` save button (one save call covers the whole note including selected clips). Need to decide:
   - A: keep current — footer button is just visual emphasis but still requires user to hit global `+`
   - B: footer button itself triggers `_applySelectedClipsToNote()` + global save flow inline (auto-clicks `+` under the hood)
     Recommendation: B (matches design intent), but flag for confirmation.
3. **IBM Plex Sans loading**: from Google Fonts (`fonts.googleapis.com`) — requires CSP relaxation in manifest (`connect-src` already `*`, but `style-src` and `font-src` need to include the host). Alternative: bundle the font as woff2 inside the extension (~50KB per weight). Confirm preferred path.
4. **`target` clip count** for "N of 3" copy: Core currently doesn't tell us how many it tried for. Hardcode 3 for now? Or wait for Core to add `target_count` to status response (spec'd in handoff outstanding asks)?

---

## Out of scope (deferred to later iteration)

- Tweaks/Accent-swatch panel (design has it, we don't need yet)
- FilmStill procedural placeholder (we have real thumbs)
- "Reopen tab" vertical button for closed panel (design feature; current plugin has no close-then-reopen — user just clicks Ex again)
- Cinematic letterbox on thumbs (design adds 6-8px black bars; we use raw thumb)
- Right-side action-bar restyling for Yomitan dict entries
- Multi-accent theming
