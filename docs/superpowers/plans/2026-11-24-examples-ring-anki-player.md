# Examples: share ring, «Понятные» in Anki, open in player — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** every example video can be saved to Anki, saved YouTube examples play inside the base card, the share is a ring, and each YouTube card opens the Flib site player.

**Architecture:** the Anki player is markup inside the existing `flib_media` field (no template change). «Понятные» cards become ordinary `YouTubeCard`s kept in their own list. The ring is a small DOM helper; the player link is an anchor on the card.

**Tech Stack:** plain ES modules, JSDoc types checked by tsc, vitest + jsdom, CSS.

**Spec:** `docs/superpowers/specs/2026-11-24-examples-ring-anki-player-design.md`

## Global Constraints

- Node >= 22.13. GPL header on every new JS file (copy from a neighbour). No CommonJS in `ext/`.
- Server text goes into the DOM only through `textContent`; into the Anki field only through `escapeHtml` or a validated pattern. Never weaken `cleanModelText`.
- Russian text in `ext/js` only in `messages-*.js`, same keys in ru and en. Host literals `flib.club` / `flibooster.ru` only in `ext/js/data/flib-host.js`.
- Never merge `isFlibClubHost` and `isFlibHost`. Do not touch `_createHttpError`.
- Anki templates, note types other than «Yomitan Card Type», the options schema and `ext/manifest.json` are not changed.
- Commits: no `Co-Authored-By` trailer; end the message with `Claude-Session: https://claude.ai/code/session_01SB7EQ7SYtfvh46DQa89BsG`. Stage files by name, never `git add -A`.
- Colours: rounded percent >= 80 high, 60..79 mid, < 60 low. Saved fragment end = end of the line + 2 s. Player max width 480px.
- `&t=` is out of scope.
- Unit run: `npx vitest run <file> --exclude '.claude/**' --exclude 'node_modules/**' --exclude 'test/playwright/**'`. Check the exit code.

## Review Focus

1. A card saved by 0.6.0 (link only), then the same video saved again: the player is added, old bytes stay (Task 1).
2. A user edits the field in Anki, which re-serializes it: our player is still recognised, a foreign iframe is not (Task 1).
3. The user ticks a «Понятные» card, then toggles «С учётом моих знаний» or asks for more «Понятные»: the tick and the footer count stay (Task 2).
4. A share of 0.796 shows 80 in the high colour; 0, 1, NaN and null behave (Task 3).
5. Keyboard: Enter on the player link or Space on the checkbox does not open the YouTube popup (Tasks 2 and 4).

---

### Task 1: YouTube player in the `flib_media` field

**Files:**

- Modify: `ext/js/display/gateway-examples-util.js`, `ext/js/display/gateway-anki-media.js:298`, `ext/js/display/gateway-examples-panel.js` (`YouTubeCard`, `_buildYouTubeCard`, `getSelectedGatewayMedia`: `endMs` only), `types/ext/flib-media-field.d.ts`, `types/ext/gateway-anki-media.d.ts`
- Test: `test/flib-media-field-html.test.js`, `test/gateway-examples-util.test.js`, `test/gateway-anki-media.test.js`, `test/gateway-examples-panel.test.js`

**Interfaces — Produces:** `endMs: number | null` on `GatewaySelectedYouTube`, `FlibMediaFieldYouTube` and `YouTubeCard` (from `item.end_ms`); `buildYouTubeCardEmbedUrl(ref: string, startMs: ?number, endMs: ?number): ?string`.

Exact markup of one item (attributes in this order; `SRC` is escaped, so `&amp;`):

```html
<li>
  <div class="flib-yt-frame">
    <iframe
      class="flib-yt-player"
      src="SRC"
      title="YouTube"
      loading="lazy"
      referrerpolicy="strict-origin-when-cross-origin"
      allow="encrypted-media; picture-in-picture; fullscreen"
      allowfullscreen=""
      style="width:100%;max-width:480px;aspect-ratio:16/9;height:auto;border:0"
    ></iframe>
  </div>
  <a href="WATCH_URL">▶ TEXT</a>
</li>
```

`SRC` = `https://www.youtube-nocookie.com/embed/<ref>?start=<floor s>[&end=<ceil(endMs/1000)+2>]&rel=0`; `end` only when `endMs` is finite and `endMs > (startMs ?? 0)`. No `autoplay`. Blank `TEXT` (null or whitespace) becomes `YouTube`. Two items with the same watch URL produce one `<li>` (the first).

- [ ] **Step 1: Failing tests**
  - `buildYouTubeCardEmbedUrl('lRSA2tF0mkU', 563200, 566100)` → `…/embed/lRSA2tF0mkU?start=563&end=569&rel=0`; `endMs` null, NaN, equal to or below `startMs` → no `end`; bad ref → null.
  - The field HTML for one item equals the markup above byte for byte; blank text → `▶ YouTube`; text `<img onerror>` stays escaped; same ref+start twice → one `<li>`; `parse(html)` then `outerHTML` of the `<li>` equals the emitted string.
  - `mergeFlibMediaFieldHtml`: (a) a field with our player + the same item → unchanged; (b) + a new item → appended, old bytes are a prefix; (c) our player with a foreign `<iframe src="https://x/">` beside it → new content goes first; (d) an old link-only `<li>` + the same item with a player → old bytes kept, player added; (e) a lookalike (`class="flib-yt-player"` with another host, an extra attribute, or a changed `style`) counts as foreign; (f) two players and one film clip keep dedup working.
  - `prepareFlibMediaField` passes `endMs` through; the panel selection carries `endMs: 64200` for the fixture item and `null` when `end_ms` is null.
- [ ] **Step 2:** run the four files, see the new tests fail for the right reason.
- [ ] **Step 3: Implement.** One anchored-free regex constant `FLIB_YT_PLAYER_MARKUP` (global) matching exactly the iframe above with `[\w-]{11}`, `\d+` and the optional `&amp;end=\d+`; also accept `allowfullscreen` without `=""`. In `mergeFlibMediaFieldHtml` run the `FLIB_MEDIA_RISKY_MARKUP` test and the hiding-attribute query on a copy of `existing` with that regex removed; every other check keeps using `existing`. In `buildFlibMediaFieldHtmlFromParsed` a known href drops a new `<li>` unless the new `<li>` holds `iframe.flib-yt-player` and no old `<li>` with that href does.
- [ ] **Step 4:** run the four files (pass), then `npx tsc --noEmit -p jsconfig.json` and eslint on the changed files.
- [ ] **Step 5:** commit `feat(anki): play saved YouTube examples inside the card`.

### Task 2: checkbox on «Понятные»

**Files:**

- Modify: `ext/js/display/gateway-examples-panel.js`, `ext/css/flib-card.css`
- Test: `test/gateway-examples-panel.test.js`

**Interfaces:** Consumes `YouTubeCard.endMs` (Task 1). Produces `_undCards: YouTubeCard[]`; `UnderstandableCard` is removed.

- [ ] **Step 1: Failing tests**
  - Every «Понятные» card has an unchecked `input[type=checkbox]`; ticking adds `ve-gw-selected`, does not call `onYouTubeOpen`, and the footer says «1 видео уйдёт в Anki вместе со словом».
  - Selection of the fixture: `{ref: REF4, startMs: 42000, endMs: null, text: 'You run so fast'}`; for `REF5` (no hits, no title) `{startMs: 0, endMs: null, text: null}`; no hits but a title → `text` = the title.
  - Order: ticked «Понятные» first, then the visible list. Keys of all sets are unique.
  - The tick survives known on/off and a second «Понятные» run that prepends cards.
  - `clearSelection(snapshot)` unticks «Понятные» of the snapshot; one ticked after the snapshot stays.
  - Space/Enter keydown on the label does not call `onYouTubeOpen`.
  - Phrase panel: the footer still says clips are not saved yet; the button stays hidden.
- [ ] **Step 2:** run, see them fail.
- [ ] **Step 3: Implement.** Extract the checkbox wiring shared with `_buildYouTubeCard` into `_attachYouTubeCheckbox(root: HTMLElement): {key: string, label: HTMLLabelElement, checkbox: HTMLInputElement}`. `getSelectedGatewayMedia` and `clearSelection` iterate `[...this._undCards, ...this._youTubeCards]`. Fix the stale class comment «no Anki checkbox».
- [ ] **Step 4:** run the file, tsc, eslint, stylelint.
- [ ] **Step 5:** commit `fix(examples): «Понятные» videos can be saved to Anki`.

### Task 3: share ring and tooltips

**Files:**

- Create: `ext/js/display/example-share-ring.js`, `test/example-share-ring.test.js`
- Modify: `ext/js/display/gateway-examples-panel.js`, `ext/css/flib-card.css`, `ext/js/i18n/messages-ru.js`, `ext/js/i18n/messages-en.js`
- Test: `test/gateway-examples-panel.test.js`

**Interfaces — Produces:** `getShareLevel(percent: number): 'high'|'mid'|'low'`; `createShareRing(share: unknown, describe: (percent: number) => string): ?HTMLElement` — null unless `share` is a finite number; percent = `Math.round(clamp(share, 0, 1) * 100)`.

DOM: `span.ve-gw-ring[data-level][role=img][aria-label][title]` > `svg[viewBox="0 0 36 36"][aria-hidden=true]` (track circle + arc circle with `pathLength="100"`, `stroke-dasharray="<percent> 100"`) + `span.ve-gw-ring-n[aria-hidden=true]` with the number. SVG through `createElementNS`.

Texts (ru / en): `video.knownBadge` «понятно {percent}% фрагмента» / «{percent}% of the fragment known»; `video.undCoverage` unchanged; new `video.knownTitle` «Фрагменты со словом, отсортированные по знакомым вам словам» / «Fragments with this word, sorted by the words you know»; new `video.knownTitlePhrase` «Фрагменты с этой фразой, отсортированные по знакомым вам словам» / «Fragments with this phrase, sorted by the words you know».

- [ ] **Step 1: Failing tests** — levels at 100, 80, 79, 60, 59, 0; 0.796 → `80`, high; 1 → `100`; -1 → `0`; 1.7 → `100`; NaN, Infinity, null, '0.9' → null; label and title equal `describe(percent)`; no `innerHTML` use. Panel: known cards show rings 91 (high) and 50 (low) with «понятно 91% фрагмента»; a `none`/`pending` answer has no ring; «Понятные» shows 93 with «понятно 93% ролика», no ring for `coverage: null`; `.ve-gw-known-badge` no longer exists; the known button has the title by target mode.
- [ ] **Step 2:** run, fail.
- [ ] **Step 3: Implement.** CSS: 34px circle at top 4px left 4px of the thumb, white backing in both themes, `--fc-share-high: #0d6b57`, `--fc-share-mid: #8a5a00`, `--fc-share-low: #b3261e` (contrast with white >= 4.5). Remove the `.ve-gw-known-badge` rules.
- [ ] **Step 4:** run both files, `test/ui-language-guard.test.js`, tsc, eslint, stylelint.
- [ ] **Step 5:** commit `feat(examples): share of known words as a ring`.

### Task 4: «Открыть в плеере»

**Files:**

- Modify: `ext/js/display/gateway-examples-util.js`, `ext/js/display/gateway-examples-panel.js`, `ext/css/flib-card.css`, both message files
- Test: `test/gateway-examples-util.test.js`, `test/gateway-examples-panel.test.js`

**Interfaces — Produces:** `buildFlibPlayerUrl(ref: unknown): ?string` → `${FLIB_SITE_URL}/player?v=<ref>`, null for a bad ref.

Text: `video.openInPlayer` «Открыть в плеере» / «Open in player».

- [ ] **Step 1: Failing tests** — URL for a good ref equals `https://flib.club/player?v=dQw4w9WgXcQ`, bad refs → null, no `rp`; `parseRoutePuzzleId(url)` of it is null. Panel: plain, known and «Понятные» cards each have one `a.ve-gw-player-link` with that href, `target=_blank`, `rel="noopener noreferrer"`; film cards have none; click and Enter/Space keydown on it do not call `onYouTubeOpen` and do not prevent the default of the click.
- [ ] **Step 2:** run, fail.
- [ ] **Step 3: Implement.** Always visible. Grid areas: default `'thumb' 'text' 'open' 'check'`, compact `'thumb text' 'thumb open' 'thumb check'`. Style as the existing small `fc-btn` with the accent fill and a ▶ icon; no layout shift on hover.
- [ ] **Step 4:** run both files, guard test, tsc, eslint, stylelint.
- [ ] **Step 5:** commit `feat(examples): open a YouTube example in the Flib player`.

### Task 5: texts for people

**Files:** Modify `PRIVACY.md`, `docs/AMO_SUBMISSION_NOTES.md`, `docs/gateway-clips-to-anki-spec.md`.

- [ ] **Step 1:** `PRIVACY.md`, the YouTube block and the Russian summary: a YouTube example saved to Anki carries an embedded youtube-nocookie.com player, so Anki itself contacts YouTube whenever it shows that card; «Открыть в плеере» opens flib.club with the video id, only on a click. Do not change the version line (release step).
- [ ] **Step 2:** the same two facts in `docs/AMO_SUBMISSION_NOTES.md`.
- [ ] **Step 3:** `docs/gateway-clips-to-anki-spec.md` D-3: superseded 2026-11-24, with a link to the spec.
- [ ] **Step 4:** `npx prettier --check` on the three files; `npm run test:md`.
- [ ] **Step 5:** commit `docs: YouTube player in saved cards and the Flib player link`.

### Task 6: live verification (controller, no product code)

- [ ] Clean export, full `npm test` parts (js, ts, css, html, unit, options, json, md, build) with exit codes.
- [ ] Copy of `dev/card-shot/`: screenshots of plain, known and «Понятные» cards — light/dark, compact/large, popup 400 px and >= 720 px, with and without a hit, 100% ring.
- [ ] Isolated Anki (memory 4507 method) with the real «Yomitan Card Type» template and the exact field HTML: player visible and plays the fragment, two players on one card, offline (link remains), narrow window 360 px, the note opens in the editor and the field bytes after an edit still match our regex.
- [ ] Whole-branch review and adversarial audit in parallel, one fix wave, one scoped re-review.
