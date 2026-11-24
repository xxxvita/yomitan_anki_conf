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
- Anki templates, note types other than «Yomitan Card Type», the options schema and `ext/manifest.json` (generated) are not edited. The only manifest change is the Firefox category in Task 5.
- Commits: no `Co-Authored-By` trailer; end the message with `Claude-Session: https://claude.ai/code/session_01SB7EQ7SYtfvh46DQa89BsG`. Stage files by name, never `git add -A`.
- Colours: rounded percent >= 80 high, 60..79 mid, < 60 low. Saved fragment end = end of the line + 2 s. Player max width 480px.
- The player link carries `&t=<whole seconds>` (owner, 2026-11-24). The site does not read it yet; its reader is a separate task for the flib.club session.
- Unit run: `npx vitest run <file> --exclude '.claude/**' --exclude 'node_modules/**' --exclude 'test/playwright/**'`. Check the exit code. tsc in every task: `npx tsc --noEmit -p jsconfig.json` AND `npx tsc --noEmit -p test/jsconfig.json`.

## Review Focus

1. A card saved by 0.6.0 (link only), then the same video saved again: the player is added, old bytes stay (Task 1).
2. A user edits the field in Anki, whose editor normalises styles and joins list items: our player is still recognised, repeated saves do not pile up players, a foreign iframe is not trusted (Task 1).
3. The user ticks a «Понятные» card, then toggles «С учётом моих знаний» or asks for more «Понятные»: the tick and the footer count stay (Task 2).
4. A share of 0.796 shows 80 in the high colour; 0, 1, NaN and null behave (Task 3).
5. Keyboard: Enter on the player link or Space on the checkbox does not open the YouTube popup (Tasks 2 and 4).

---

### Task 1: YouTube player in the `flib_media` field

**Files:**

- Modify: `ext/js/display/gateway-examples-util.js`, `ext/js/display/gateway-anki-media.js:298`, `ext/js/display/gateway-examples-panel.js` (`YouTubeCard`, `_buildYouTubeCard`, `getSelectedGatewayMedia`: `endMs` only), `types/ext/flib-media-field.d.ts`, `types/ext/gateway-anki-media.d.ts`
- Test: `test/flib-media-field-html.test.js`, `test/gateway-examples-util.test.js`, `test/gateway-anki-media.test.js`, `test/gateway-examples-panel.test.js`

**Interfaces — Produces:** `endMs: number | null` on `GatewaySelectedYouTube`, `FlibMediaFieldYouTube` and `YouTubeCard` (from `item.end_ms`); `buildYouTubeCardEmbedUrl(ref: string, startMs: ?number, endMs: ?number): ?string`.

Exact markup of one item: ONE line, no whitespace or newlines between tags, attributes in this order, `SRC` escaped (`&amp;`):

```text
<li><div><iframe class="flib-yt-player" src="SRC" title="YouTube" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen="" style="width:100%;max-width:480px;aspect-ratio:16/9;height:auto;border:0"></iframe></div><a href="WATCH_URL">▶ TEXT</a></li>
```

`SRC` = `https://www.youtube-nocookie.com/embed/<ref>?start=<floor s>[&end=<ceil(endMs/1000)+2>]&rel=0`; `end` only when `endMs` is finite and `endMs > (startMs ?? 0)`. No `autoplay`. Blank `TEXT` (null or whitespace) becomes `YouTube`. Two items with the same watch URL produce one `<li>` (the first).

- [ ] **Step 1: Failing tests**
  - `buildYouTubeCardEmbedUrl('lRSA2tF0mkU', 563200, 566100)` → `…/embed/lRSA2tF0mkU?start=563&end=569&rel=0`; `endMs` null, NaN, equal to or below `startMs` → no `end`; bad ref → null.
  - The field HTML for one item equals the markup above byte for byte; blank text → `▶ YouTube`; text `<img onerror>` stays escaped; same ref+start twice → one `<li>` (the first); for quote-free text `parse(html)` then `outerHTML` of the `<li>` equals the emitted string (with quotes only the iframe's `outerHTML` is compared: `escapeHtml` emits `&#39;`/`&quot;`).
  - `mergeFlibMediaFieldHtml`:
    - (a) a field with our player + the same item → unchanged; (b) + a new item → old bytes are a prefix, the new player is there;
    - (c) a foreign `<iframe src="https://x/">` beside ours → new content first;
    - (d) an old link-only `<li>` + the same item → old bytes kept, the player added; saving again twice → unchanged; the player removed by hand → added once more;
    - (e) recognised as ours: the editor's style `width: 100%; max-width: 480px; aspect-ratio: 16 / 9; height: auto; border-width: 0px; border-style: none;`, `border: 0px;`, `&` instead of `&amp;`, `allowfullscreen` bare or `"true"`; foreign: `display:none`, `position:fixed`, an extra attribute (`onload`, `srcdoc`), another host, text inside the iframe;
    - (f) four saves in a row of the same item leave ONE player when the field was edited with Delete (two items joined in one `<li>`, style normalised) and with Backspace (the `<a>` moved into the player's `<div>`);
    - (g) attribute swallow: `<p title="` + OWN + `<ul class=flib-yt><li>` + OWN2 + `<a hidden href='WATCH2'>x</a></li></ul>` merged with item 2 → item 2 is added and visible;
    - (h) a field that already has a `ul.flib-yt` gets the fresh list wrapped: `<div class="flib-yt-more"><ul class="flib-yt">…</ul></div>`; the third save dedups against the wrapped list too; a field without a list gets a plain `ul.flib-yt`;
    - (i) films keep deduplicating next to players.
  - `prepareFlibMediaField` passes `endMs` through; the panel selection carries `endMs: 64200` for the fixture item and `null` when `end_ms` is null.
- [ ] **Step 2:** run the four files, see the new tests fail for the right reason.
- [ ] **Step 3: Implement** (no text stripping, no regex over the field to find players). `own` = `iframe.flib-yt-player` elements of the parsed old field with: empty `textContent`; `src` attribute matching `^https://www\.youtube-nocookie\.com/embed/([\w-]{11})\?start=(\d+)(?:&end=\d+)?&rel=0$`; attribute names within {class, src, title, loading, referrerpolicy, allow, allowfullscreen, style}; every style declaration (lower-cased, whitespace removed) within {width:100%, max-width:480px, aspect-ratio:16/9, height:auto, border:0, border:0px, border:none, border-width:0px, border-style:none}. The field is risky when ANY holds: `FLIB_MEDIA_RISKY_MARKUP` without `iframe` matches; the count of `/<\/?iframe\b/gi` in `existing` is not `2 * own.length`; any element matching `[hidden],[style],[popover],[inert]` is not in `own`.
      A player's dedup identity is ref + start from its OWN src, for players inside `body>ul.flib-yt>li` or `body>div.flib-yt-more>ul.flib-yt>li`; a new `<li>` with a player is dropped only on that identity, a new `<li>` without one on `href` as before (selectors extended with the wrapper). When `existing` has a `ul.flib-yt`, wrap the fresh list (test h). Code comment: a later markup change must keep accepting the old form; the wrapper exists because the template CSS puts every `.flib-yt` grid item in column 2 row 1 above 900 px.
      A reviewer's prototype that passed these cases in jsdom, Chromium and Firefox: `/tmp/claude-1000/-home-xxxvita-Work-yomitan-phrases-src/ce328f48-b46b-4a25-85d6-c6044c40712a/scratchpad/planreview/repo/ext/js2/display/gateway-examples-util.js` (reference only; write your own code and tests).
- [ ] **Step 4:** run the four files and `test/display-anki-flib-media.test.js` (pass), then tsc for both projects and eslint on the changed files. The required `endMs` breaks typed fixtures in `test/flib-media-field-html.test.js` (194, 207, 219-221, 231, 241, 242) and `test/gateway-anki-media.test.js:100`; update them.
- [ ] **Step 5:** commit `feat(anki): play saved YouTube examples inside the card`.

### Task 2: checkbox on «Понятные»

**Files:**

- Modify: `ext/js/display/gateway-examples-panel.js`, `ext/css/flib-card.css`
- Test: `test/gateway-examples-panel.test.js`

**Interfaces:** Consumes `YouTubeCard.endMs` (Task 1). Produces `_undCards: YouTubeCard[]`; `UnderstandableCard` is removed.

- [ ] **Step 1: Failing tests**
  - Every «Понятные» card has an unchecked `input[type=checkbox]`; ticking adds `ve-gw-selected`, does not call `onYouTubeOpen`, and the footer says «1 видео уйдёт в Anki вместе со словом».
  - Selection of the fixture: `{ref: REF4, startMs: 42000, endMs: null, text: 'You run so fast'}`; for `REF5` (no hits, no title) `{startMs: 0, endMs: null, text: null}`; no hits but a title → `text` = the title; a hit with an empty `text_en` → `startMs` = its `from_ms` (like a click) and `text` = the title or null.
  - Order: ticked «Понятные» first, then the visible list. Keys of all sets are unique.
  - The tick survives known on/off and a second «Понятные» run that prepends cards.
  - `clearSelection(snapshot)` unticks «Понятные» of the snapshot; one ticked after the snapshot stays.
  - Space/Enter keydown on the label does not call `onYouTubeOpen`.
  - Phrase panel: the footer still says clips are not saved yet; the button stays hidden.
  - Invert the old assertion at `test/gateway-examples-panel.test.js:1792-1793` («Not for Anki: no checkbox»).
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

- [ ] **Step 1: Failing tests** — levels at 100, 80, 79, 60, 59, 0; 0.796 → `80`, high; 1 → `100`; -1 → `0`; 1.7 → `100`; NaN, Infinity, null, '0.9' → null; label and title equal `describe(percent)`; no `innerHTML` use. Panel: known cards show rings 91 (high) and 50 (low) with «понятно 91% фрагмента»; a `none`/`pending` answer has no ring; «Понятные» shows 93 with «понятно 93% ролика», no ring for `coverage: null`; `.ve-gw-known-badge` no longer exists; the known button has the title by target mode. Switch to `.ve-gw-ring` every old badge assertion (1325-1326, 1391, 1585, 1615, 1648, 1783, 1788): `toBeNull` on a class that no longer exists cannot fail. The time label renders as two spans, start and `.ve-gw-yt-time-end` («–1:04»), with the same total `textContent`; a duration has one span.
- [ ] **Step 2:** run, fail.
- [ ] **Step 3: Implement.** CSS: 34px circle at top 4px left 4px of the thumb, white backing in both themes; in compact density 26px with a 10px number, `.ve-gw-yt-time-end` hidden and `.ve-gw-yt-time` `white-space: nowrap` (a 96×54 thumb has no room for both); `--fc-share-high: #0d6b57`, `--fc-share-mid: #8a5a00`, `--fc-share-low: #b3261e` (contrast with white >= 4.5). Remove the `.ve-gw-known-badge` rules.
- [ ] **Step 4:** run both files, `test/ui-language-guard.test.js`, tsc, eslint, stylelint.
- [ ] **Step 5:** commit `feat(examples): share of known words as a ring`.

### Task 4: «Открыть в плеере»

**Files:**

- Modify: `ext/js/display/gateway-examples-util.js`, `ext/js/display/gateway-examples-panel.js`, `ext/css/flib-card.css`, both message files
- Test: `test/gateway-examples-util.test.js`, `test/gateway-examples-panel.test.js`

**Interfaces — Produces:** `buildFlibPlayerUrl(ref: unknown, startMs: unknown): ?string` → `${FLIB_SITE_URL}/player?v=<ref>[&t=<floor seconds>]`, null for a bad ref. `t` only when `startMs` is a finite number, the floored second is > 0 and a safe integer.

Text: `video.openInPlayer` «Открыть в плеере» / «Open in player».

- [ ] **Step 1: Failing tests** — `buildFlibPlayerUrl('dQw4w9WgXcQ', 61500)` equals `https://flib.club/player?v=dQw4w9WgXcQ&t=61`; startMs 0, 999, -5, null, NaN, Infinity, 1e30, '61500' → no `t`; bad refs → null; no `rp`; `parseRoutePuzzleId(url)` of it is null. Panel: plain, known and «Понятные» cards each have one `a.ve-gw-player-link` with the start of its line (plain fixture 61500 → `t=61`, known 1000 → `t=1`, «Понятные» 42000 → `t=42`, no hit → no `t`), `target=_blank`, `rel="noopener noreferrer"`; film cards have none; click and Enter/Space keydown on it do not call `onYouTubeOpen` and do not prevent the default of the click.
- [ ] **Step 2:** run, fail.
- [ ] **Step 3: Implement.** Always visible. Grid areas: default `'thumb' 'text' 'open' 'check'`, compact `'thumb text' 'thumb open' 'thumb check'`. Style as the existing small `fc-btn` with the accent fill and a ▶ icon, `justify-self: start`; no layout shift on hover. `stopPropagation` on both `click` and `keydown`: the card's keydown handler calls `preventDefault` and would kill Enter on the link.
- [ ] **Step 4:** run both files, guard test, tsc, eslint, stylelint.
- [ ] **Step 5:** commit `feat(examples): open a YouTube example in the Flib player`.

### Task 5: Firefox category and texts for people

**Files:** Modify `dev/data/manifest-variants.json:270`, `PRIVACY.md`, `docs/AMO_SUBMISSION_NOTES.md`, `docs/gateway-clips-to-anki-spec.md`.

- [ ] **Step 0:** owner decision 2026-11-24: Firefox `data_collection_permissions.required` becomes `["websiteContent", "websiteActivity", "browsingActivity", "authenticationInfo"]`. `PRIVACY.md` «Firefox data consent» gets a **Website activity** bullet: on the Flib route player page, that a word's card was shown or its translation was opened (see «Route events»); the AMO notes' DATA line and the CHANGES wording say the same (route events are no longer explained by the other two categories alone). Verify with `npm run build -- --target firefox --version 0.6.1.0` in a clean export, then `npx addons-linter@<the exact current version, named in the report> builds/yomitan-firefox.zip`: 0 errors, and the built manifest has the four categories.
- [ ] **Step 1:** `PRIVACY.md`, the YouTube block and the Russian summary: a YouTube example saved to Anki carries an embedded youtube-nocookie.com player, so Anki itself contacts YouTube whenever it shows that card or opens the note in its editor or preview; «Открыть в плеере» opens flib.club with the video id, only on a click. Do not change the version line (release step).
- [ ] **Step 2:** the same two facts in `docs/AMO_SUBMISSION_NOTES.md`.
- [ ] **Step 3:** `docs/gateway-clips-to-anki-spec.md` D-3: superseded 2026-11-24, with a link to the spec.
- [ ] **Step 4:** `npx prettier --check` on the three files; `npm run test:md`.
- [ ] **Step 5:** two commits: `feat(firefox): declare websiteActivity` (manifest variants plus its PRIVACY/AMO lines) and `docs: YouTube player in saved cards and the Flib player link`.

### Task 6: live verification (controller, no product code)

- [ ] Clean export, full `npm test` parts (js, ts, css, html, unit, options, json, md, build) with exit codes.
- [ ] Copy of `dev/card-shot/`: screenshots of plain, known and «Понятные» cards — light/dark, compact/large, popup 400 px and >= 720 px, with and without a hit, 100% ring, an hour-long video (`1:12:01–1:12:09`).
- [ ] Isolated Anki (memory 4507 method) with the real «Yomitan Card Type» template and the exact field HTML: player visible and plays the fragment, two players on one card, film + old link list + new list at >= 1000 px in append and prepend order (nothing covered), offline (link remains), narrow window 360 px, the note opens in the editor and the field bytes after an edit still match our regex.
- [ ] Whole-branch review and adversarial audit in parallel, one fix wave, one scoped re-review.
