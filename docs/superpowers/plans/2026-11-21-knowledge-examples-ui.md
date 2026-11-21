# Knowledge-ranked Examples & «Понятные» UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the buttons «С учётом моих знаний» (feature A, `POST /v1/examples/batch` with `rank:"known"`) and
«Понятные» (feature B, async `/v1/videos/understandable` with an exclude set) to the gateway examples panel. Also
add a selection-aware «Примеры» + «С учётом моих знаний» pair in the phrase window.

**Architecture:**

- **Gateway client** (service worker): `examplesBatch`, `understandableStart`, `understandableGet` and
  `understandableCancel`.
- **Backend:** API handlers, gated by `_requireFlibPageSender`. B job ids are bound to the starting tab/frame (L2).
- **Popup:** the loader gains `loadBatch`/`understandable*`. `GatewayExamplesPanel` gets a section-tools row with two
  buttons and per-card badges. The phrase window decides the search target from the textarea selection.

**Tech Stack:** Plain ES modules with JSDoc (strict checkJs), vitest + jsdom, the existing `FlibGatewayClient`,
`GatewayExamplesLoader` and `GatewayExamplesPanel`.

**Spec:** `docs/superpowers/specs/2026-11-21-knowledge-examples-ui-design.md` (Russian, owner-approved).

- Server contract (authoritative): gateway `docs/client-spec.md` sections «Примеры пачкой» and «Понятные видео».
- Read it with `git -C /home/xxxvita/Work/English/services/turmalin_getaway show origin/main:docs/client-spec.md`
  (lines ~3585-3720).

## Global Constraints

- NO `Co-Authored-By:` trailer and no other trailers in any commit (owner rule).
- GPL-3.0-or-later header on new JS files. Russian string literals only in `ext/js/i18n/messages-*.js` (add every new
  UI string to BOTH `messages-ru.js` and `messages-en.js`). The `flib.club` literal only in `ext/js/data/flib-host.js`.
- Server text (`text_en`, `title`, `channel`) reaches the DOM only through `textContent`. `ref`/`video_id` must match
  `^[A-Za-z0-9_-]{11}$`, the same check as the existing YouTube sanitizer.
- A and B are called ONLY on a button press. Ordinary «Примеры» behaviour is unchanged (`/v1/examples`).
- Never promise "same as your route" in any text.
- A: one target per press, `limit: 5`.
- B:
  - one target per press, `limit: 5`;
  - `exclude_video_ids` = unique refs already shown in this panel, max 1000;
  - poll at `max(poll_after_ms, 1000)` ms;
  - a hard client limit of 75 000 ms from the POST, after which the client DELETEs the job and shows a timeout;
  - DELETE when the panel is destroyed mid-job.
- Phrase-window target:
  - the trimmed selection of `.phrase-expression-input` if non-empty, else the trimmed whole value;
  - more than 200 code points → cut at the last whitespace before 200 code points (or hard at 200 if there is none),
    and show the "first 200 characters" note.
- vitest runs with `--exclude '.claude/**' --exclude 'node_modules/**' --exclude 'test/playwright/**'`. Run
  `test:ts:main`, `test:ts:dev` and `test:ts:test` separately.

## Review Focus

1. **The panel is closed (or the card changes) while a B job runs.** The job is DELETEd once, no further polls happen
   and no DOM is touched after destroy. Owned by Task 4.
2. **A 404 (axis off) on every new path.** "Скоро…" shows, nothing breaks, and phrase «Примеры» falls back to
   `/v1/examples`. Owned by Tasks 3 and 5.
3. **A double click on a button** sends one request. Owned by Tasks 3 and 4.
4. **Server text with markup** (`<img onerror>`) in `text_en` or `title` renders as text. Owned by Tasks 3 and 4.
5. **The phrase window with a selection made, then focus moved to the button** still uses the selection
   (`selectionStart/End` survive a blur). Owned by Task 5.

---

### Task 1: Gateway client — batch examples and understandable jobs

**Files:**

- Modify: `ext/js/comm/flib-gateway-client.js`, `types/ext/flib-gateway.d.ts`
- Test: `test/flib-gateway-client.test.js`

**Interfaces (Produces):**

- `examplesBatch({targets, limit, rank}, {signal}?): Promise<ExamplesBatchResponse>`. POST `/v1/examples/batch`.

  - `targets` are `{text: string, mode: 'lemma'|'quote'}[]` (1..30, else `flib_bad_request` before sending); `limit`
    is clamped to 1..5; `rank` is `'plain'|'known'`.
  - Each item goes through the existing `sanitizeExampleItem`, then keeps `title`/`channel` (string or null),
    `fragment {start_ms, end_ms}` (finite numbers or null) and `known_share` (number in [0,1] or null).
  - `known_source` is one of route/pending/none (anything else → `'none'`). `partial` is a boolean. Results are
    `{index, text, mode, items, empty_reason}`, with `empty_reason` a string or null.
  - Errors use the existing HTTP mapping (`_send` → `_createHttpError`), so the codes match the examples codes:

    - 403 `examples_quota_exhausted` / `examples_forbidden`;
    - 404 → `flib_http_error` with status 404;
    - 429 → `flib_rate_limited`;
    - 503 → `flib_service_unavailable`.

    Also attach `retryAfterSec` (header, clamped 1..3600) to the error data for 429/503, if `_createHttpError`'s data
    allows it. Otherwise add it minimally.

- `understandableStart({targets, limit, excludeVideoIds}, {signal}?): Promise<{jobId: string, pollAfterMs: number}>`.
  - POST `/v1/videos/understandable` with `{targets, limit, exclude_video_ids}`.
  - `excludeVideoIds` is filtered to valid 11-char ids, deduped and capped at 1000.
  - It throws coded errors as above, plus 409 → code from the body (`route_profile_missing`). Make sure the reason
    code survives the mapping: use `body.code` if a string, else `body.error`.
- `understandableGet(jobId, {signal}?): Promise<UnderstandableJob>`.
  - GET `/v1/videos/understandable/{encodeURIComponent(jobId)}`.
  - Returns `{status, partial, errorCode: ?string, results: ?UnderstandableResult[]}`.
  - Each item is `{video_id (validated), title, channel_id, duration_s, coverage ∈[0,1] or null, target_hits:
[{from_ms, to_ms, text_en}] (≤3, sanitized), target_hits_unavailable: boolean}`. Items with an invalid `video_id`
    are dropped.
- `understandableCancel(jobId, {signal}?): Promise<void>`. DELETE; ignores 404 `job_not_found`.
- Types in `types/ext/flib-gateway.d.ts`: `ExamplesBatchTarget`, `ExamplesBatchItem`, `ExamplesBatchResult`,
  `ExamplesBatchResponse`, `UnderstandableItem`, `UnderstandableResult` and `UnderstandableJob`.

- [ ] **Step 1: Failing tests** (fake fetch, in the existing style).
  - batch: body shape exact; known_share parsed; an invalid ref dropped; `known_source` 'weird' → 'none'; 404 → status
    404 code; 403 `examples_quota_exhausted` code; 429 with `Retry-After: 7` → `retryAfterSec` 7; 31 targets → throws
    before fetch.
  - start: body with `exclude_video_ids` filtered (an invalid id dropped, duplicates removed, 1001 → 1000); 202 →
    `{jobId, pollAfterMs}`; 409 `route_profile_missing` code; 403 `understandable_demo_forbidden` code.
  - get: `done` with items sanitized (`<img>` text kept as a literal string, invalid `video_id` dropped); `failed`
    with `error.code` → `errorCode`; 404 `job_not_found` → coded error.
  - cancel: 200 ok; 404 ignored.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement (reuse `_requestJson`/`_send`; no duplicated key handling).
- [ ] **Step 4:** Tests + tsc main/test + eslint → PASS.
- [ ] **Step 5:** Commit `feat(examples): gateway client for batch examples and understandable jobs`.

---

### Task 2: Backend handlers and API

**Files:**

- Modify: `ext/js/background/backend.js` (handler map ~355-365 next to `flibGatewayWordExamples*`; handlers next to
  `_onApiFlibGatewayWordExamplesStart` ~2037), `ext/js/comm/api.js`, `types/ext/api.d.ts`
- Test: `test/flib-examples-batch-backend.test.js` (new; pattern of `test/flib-pos-backend.test.js`)

**Interfaces (Produces):**

- API `flibGatewayExamplesBatch` params `{targets, limit, rank}`, return `ExamplesBatchResponse`.
- API `flibUnderstandableStart` params `{targets, limit, excludeVideoIds}`, return `{jobId, pollAfterMs}`.
- API `flibUnderstandablePoll` params `{jobId}`, return `UnderstandableJob`.
- API `flibUnderstandableCancel` params `{jobId}`, return `void`.
- Every handler calls `_requireFlibPageSender(sender)` first.
- Start records `jobId → this._getFlibJobOwner(sender)` in an in-memory `Map` (`this._flibUnderstandableJobs`,
  max 50 entries, oldest dropped). Poll and cancel throw `flib_job_forbidden` (new code) when the owner differs or
  the job is unknown. Cancel removes the entry. Poll removes it on a terminal status (done/failed/cancelled/expired).
- `API` methods in `ext/js/comm/api.js` with matching JSDoc.

- [ ] **Step 1: Failing tests:**
  - a forbidden sender → `flib_secret_forbidden` for all 4, with zero gateway calls;
  - batch delegates its args exactly;
  - start stores the owner;
  - poll from another tab → `flib_job_forbidden` with zero gateway calls;
  - poll with an unknown id → `flib_job_forbidden`;
  - poll `done` removes the entry (a second poll → forbidden);
  - cancel from the owner → the gateway cancel is called and the entry is removed;
  - cancel from another owner → forbidden.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests + `test/flib-backend-hygiene.test.js` + tsc ×3 + eslint → PASS.
- [ ] **Step 5:** Commit `feat(examples): backend API for batch examples and understandable jobs`.

---

### Task 3: Panel — «С учётом моих знаний» (feature A)

**Files:**

- Modify: `ext/js/display/gateway-examples-loader.js` (add `loadBatch(target, rank)`), `ext/js/display/gateway-examples-panel.js`,
  `ext/js/display/gateway-examples-util.js` (error/empty texts), `ext/js/i18n/messages-ru.js`, `ext/js/i18n/messages-en.js`,
  `ext/css/flib-card.css`
- Test: `test/gateway-examples-panel.test.js`, `test/gateway-examples-loader.test.js`

**Interfaces:**

- Consumes: Task 2 `api.flibGatewayExamplesBatch`.
- Produces:
  - `GatewayExamplesLoader#loadBatch(target: {text, mode}, rank: 'plain'|'known'): Promise<{items: ExamplesBatchItem[],
emptyReason: ?string, knownSource: 'route'|'pending'|'none', partial: boolean}>`. It takes `results[0]`; items
    pass `sanitizeYouTubeItems` (extra fields kept).
  - `GatewayExamplesPanel` gets an optional constructor option `search: {target: {text, mode}, initialRank: 'plain'|'known'}`.
    - Default `{target: {text: word, mode: 'lemma'}, initialRank: 'plain'}`.
    - `initialRank: 'known'` starts the YouTube section with the batch call instead of `loadYouTube` (used by Task 5).

**Behaviour** (spec items 1-2, 10-12):

- The YouTube section's tools row (rename/extend `_buildUnderstandableTools`) holds two buttons:

  - «С учётом моих знаний» (`fc-btn ve-gw-known`, `aria-pressed`);
  - «Понятные» (wired in Task 4; keep it inert in this task).

  It is visible when the YouTube section is ready/empty/error with a gateway source.

- Pressing «С учётом моих знаний»:
  - busy guard;
  - `loadBatch(target, 'known')`;
  - on items, keep the current plain list in memory, then replace the YouTube list with the ranked cards; each card
    gets a badge `ve-gw-known-badge` reading «понятно N%» (`Math.round(known_share*100)`) when `known_share` is a
    number;
  - `aria-pressed=true`;
  - pressing again restores the stored plain list (no request), `aria-pressed=false`.
- Messages in a `ve-gw-known-note` element under the tools (role="status"):
  - `pending` → «Знакомые слова ещё загружаются — попробуйте через минуту»;
  - `none` → «Нет данных о знакомых словах: постройте маршрут на flib.club с этим ключом». The site name comes from a
    message string; no `flib.club` literal in JS — if the guard forbids it, write «на сайте Flib»;
  - `partial`/`budget_exhausted` → «Сервер не успел» plus a «Попробовать ещё раз» button;
  - errors per spec item 10, via a new `describeKnowledgeError(code, status, retryAfterSec)` in gateway-examples-util.js
    (404 → «Скоро: сервер ещё не включил эту функцию»; others map to existing texts where they exist).
- Card building reuses `_buildYouTubeCard` (add an optional badge param). Selection/save keeps working on the
  replaced cards.

- [ ] **Step 1: Failing tests** (panel with fake loader/api, existing test style).
  - The button appears on the YouTube tab.
  - A press → the list is replaced by ranked cards with «понятно 91%»; a second press restores the plain cards with
    no extra loader call.
  - `pending` note; `none` note with no badge.
  - 404 → «Скоро…».
  - A double click → one `loadBatch` call.
  - `<img src=x onerror=1>` in `text_en` renders as text.
  - `partial` → the retry button calls `loadBatch` again.
  - Loader test: `loadBatch` sanitizes refs and keeps `known_share`.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement (+ CSS in the card style, light/dark).
- [ ] **Step 4:** Tests + tsc + eslint + stylelint + `test/ui-language-guard.test.js` → PASS.
- [ ] **Step 5:** Commit `feat(examples): «С учётом моих знаний» ranks the YouTube examples by known words`.

---

### Task 4: Panel — «Понятные» (feature B)

**Files:**

- Modify: `ext/js/display/gateway-examples-loader.js` (`understandableStart/Poll/Cancel` passthroughs),
  `ext/js/display/gateway-examples-panel.js`, `ext/js/display/gateway-examples-util.js`, messages ru/en,
  `ext/css/flib-card.css`
- Test: `test/gateway-examples-panel.test.js`

**Interfaces:** Consumes Task 2 `api.flibUnderstandableStart/Poll/Cancel` (through the loader, so tests fake the
loader).

**Behaviour** (spec item 3, 10-12):

- «Понятные» becomes active (drop `aria-disabled` and the placeholder hint; keep a short `title`).
- On press:
  - busy guard;
  - exclude list = unique refs of all YouTube cards currently or previously shown in this panel (plain, known, earlier
    understandable), ≤1000;
  - `understandableStart({targets:[target], limit:5, excludeVideoIds})`;
  - show a progress note «Ищу понятные ролики…» with a «Отменить» button.
- **Polling:**
  - a `setTimeout` loop at `max(pollAfterMs, 1000)`;
  - stop on a terminal status, on `destroy()`, or at 75 000 ms from the start; on timeout → cancel + «Сервер не
    успел»;
  - use injectable `now`/`setTimer`/`clearTimer` (constructor options with real defaults) so tests are deterministic;
  - «Отменить» → cancel → note cleared.
- **`done` with items:**
  - prepend «understandable» cards to the YouTube list: `ve-gw-und-card` with the thumbnail of `video_id`, `title`
    (textContent), «понятно N% ролика» from coverage, duration `m:ss`, and the first hit's `text_en` highlighted like
    other cards;
  - a click opens via the existing `onYouTubeOpen` with a synthetic ExampleItem `{source:'youtube', ref: video_id,
start_ms: hits[0]?.from_ms ?? 0, end_ms: hits[0]?.to_ms ?? null, text_en: hits[0]?.text_en ?? title, text_ru:
null, thumbnail_url: null}`;
  - these cards do not need Anki selection checkboxes; check that `_saveEntryWithSelection` ignores them.
- **Empty and failure texts:**
  - `all_excluded` → «Все подходящие ролики уже показаны»;
  - `none_eligible` → «Понятных роликов с этим словом не нашлось»;
  - others → `describeEmptyReason`;
  - `failed`/`expired` → «Сервер не успел».
- POST errors per spec item 10 (`403 understandable_demo_forbidden` → text + the buy link from flib-host
  `FLIB_BUY_URL`; `409 route_profile_missing` → «Нужен маршрут…»).
- `destroy()` with a running job → exactly one `understandableCancel(jobId)`, no more polls, no DOM writes.

- [ ] **Step 1: Failing tests** with fake loader and fake timers (only the injected ones; no IndexedDB here).
  - start sends `excludeVideoIds` = refs on screen;
  - polls `running` then `done` → understandable cards prepended with «понятно 93% ролика»;
  - a card click → `onYouTubeOpen` with `start_ms` = the first hit;
  - `all_excluded` text;
  - timeout at 75 s → cancel called once + text;
  - destroy mid-job → cancel once, then no further poll or DOM change (Review Focus 1);
  - a double click → one start;
  - 403 demo → text with a link;
  - 404 → «Скоро…»;
  - `title` with markup → text.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests + tsc + eslint + stylelint + ui-language guard → PASS.
- [ ] **Step 5:** Commit `feat(examples): «Понятные» finds whole videos the user understands`.

---

### Task 5: Phrase window — selection-aware «Примеры» and «С учётом моих знаний»

**Files:**

- Modify: `ext/templates-display.html` (phrase toolbar: add the button `data-action="show-examples-known"` next to
  `show-examples`), `ext/js/display/display-anki.js` (`_onShowExamples` ~487, `_mountGatewayExamplesPanel` ~1255),
  messages ru/en, `ext/css/flib-card.css` (if needed)
- Create: `ext/js/display/phrase-examples-target.js`, a pure helper:
  `pickPhraseExamplesTarget(textarea: {value, selectionStart, selectionEnd}): ?{text: string, truncated: boolean}`
- Test: `test/phrase-examples-target.test.js`, plus a display-anki test in the existing style (find the file that
  tests `_onShowExamples`, or `test/display-anki-*.test.js`)

**Behaviour** (spec items 5-9):

- `pickPhraseExamplesTarget`:
  - the selection trimmed if non-empty, else the whole value trimmed; empty → null;
  - over 200 code points → cut at the last whitespace before 200 code points, or hard at 200 if there is none;
  - `truncated: true` when cut.
- Phrase «Примеры» → `GatewayExamplesPanel` with `search: {target: {text, mode: 'quote'}, initialRank: 'plain'}`. The
  panel's plain YouTube load for a phrase search uses `loadBatch(target, 'plain')`. On a 404 from the batch it falls
  back to today's `loadYouTube(text)`.
- Phrase «С учётом моих знаний» → the same with `initialRank: 'known'`. On a 404 it shows «Скоро…» (no fallback).
- `truncated` → a note «Ищу по первым 200 символам» in the panel header area.
- The word pill shows the target text.
- The data-action button follows the gateway-source availability rules of the existing examples button. When it is
  not a gateway source (Core/unavailable), the known button is hidden.
- Clicking a button must not lose the textarea selection. Read `selectionStart/End` in the click handler: a button
  click does not clear the textarea selection range, though focus moves (Review Focus 5); verify it with a test.

- [ ] **Step 1: Failing tests.**
  - The helper: selection, whole text, whitespace-only → null, 250-char text cut at a word boundary with
    `truncated`, 250 chars with no spaces → hard 200.
  - Display: the known button mounts the panel with `initialRank 'known'` and the selected text.
  - Phrase plain with a batch 404 → `loadYouTube` fallback called with the text.
- [ ] **Step 2:** FAIL.
- [ ] **Step 3:** Implement.
- [ ] **Step 4:** Tests + tsc ×3 + eslint + html-validate on the template (`npm run test:html` on a clean export or
      `npx html-validate ext/templates-display.html`) → PASS.
- [ ] **Step 5:** Commit `feat(examples): phrase window searches the selection, with or without known words`.

---

### Task 6: Docs, full suite, live check

**Files:** `PRIVACY.md`, `docs/AMO_SUBMISSION_NOTES.md`

- [ ] **Step 1: PRIVACY** «Video examples»: per spec item 14.
  - «С учётом моих знаний» / «Понятные» send the word (or the selected text in the phrase window) and the key.
  - «Понятные» also sends the ids of YouTube videos already shown in the panel.
  - The server takes known words from this key's route profile on its side; the extension does not send them.
  - Update "In short" and the Russian summary.
- [ ] **Step 2: AMO notes:** the same facts in the DATA list.
- [ ] **Step 3:** Full suite + tsc ×3; paste the EXIT codes; `npx prettier --check` on the docs.
- [ ] **Step 4: Live check** in Playwright Chromium.
  - Reuse `/tmp/claude-1000/-home-xxxvita-Work-yomitan-phrases-src/a3b16ef6-2e96-439f-bacf-749838aab82a/scratchpad/task5/live.mjs`;
    put artifacts in `…/scratchpad/knowledge-live/`.
  - The gateway stub implements:
    - `POST /v1/examples` (plain);
    - `POST /v1/examples/batch` (returns known_share; a 404 mode switch);
    - `POST /v1/videos/understandable` → 202;
    - GET → running, then done;
    - DELETE.
  - Checks:
    - (a) «С учётом моих знаний» replaces the list with badges, and a second press restores it;
    - (b) «Понятные» prepends whole-video cards, and the exclude list sent equals the refs on screen;
    - (c) closing the panel mid-job sends DELETE;
    - (d) the phrase window with a selection sends the selected text as a quote target;
    - (e) with the stub in 404 mode: «Скоро…» on the known/understandable buttons, and phrase «Примеры» falls back to
      `/v1/examples`;
    - (f) light and dark screenshots.
  - Block every non-local host; Anki off.
- [ ] **Step 5:** Commit `docs(privacy): knowledge-ranked examples and «Понятные»`.
