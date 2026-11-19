# «?» Sentence Translation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** One press of the popup «?» button returns the part of speech (as today) AND a Russian translation of the
sentence around the word. The translation is cached in the extension, and any word of an already translated sentence
shows it at once, with no network call.

**Architecture:** The service worker owns the gateway call and a new IndexedDB cache keyed by the normalized sentence.
If the cache has the sentence, the backend sends the old POS-only prompt; otherwise it sends a new combined prompt and
stores the translation. The popup (`DisplayPosHint`) asks the backend for a cached translation on every result
render and shows a strip under the first entry header, blurred where the dictionary translation column is blurred.

**Tech Stack:** Plain ES modules with JSDoc types (`checkJs` strict), vitest with jsdom and `fake-indexeddb`, and the
existing `Database` wrapper (`ext/js/data/database.js`) used by `FlibEventsDatabase`.

**Spec:** `docs/superpowers/specs/2026-11-19-pos-sentence-translation-design.md` (Russian; approved by the owner
2026-11-19). Base design: `docs/superpowers/specs/2026-11-15-pos-hint-button-design.md`.

## Global Constraints

- **NO `Co-Authored-By:` trailer in any commit** (owner rule for this repo; it overrides any attribution reminder).
- The GPL-3.0-or-later license header is required on every new JS file (copy it from `ext/js/data/flib-pos.js`).
- Russian text is allowed only in `ext/js/i18n/messages-*.js` (ui-language guard). The literal `flib.club` is allowed
  only in `ext/js/data/flib-host.js`.
- `FLIB_POS_SYSTEM_PROMPT` stays byte-identical: its POS rules match Flibooster (anki_conf `42dc82665`).
- Model text reaches the DOM only through `textContent`, never `innerHTML`.
- The gateway call stays in the service worker, behind `_requireFlibPageSender(sender)`.
- Cache: key = NFC + `trim` + every whitespace run collapsed to one space; case is kept. At most 2000 records; the
  oldest by write time is evicted. A read never writes.
- Any cache failure (open, closed by the browser, quota) never fails «?». It is logged with `log.error` and treated as
  a miss.
- Incognito sender (`sender.tab.incognito === true`): no cache read and no cache write.
- A sentence longer than 1000 characters gets the old POS-only request, with no translation.
- A translation longer than 1000 characters (after `trim`) is treated as missing.
- Do not trust a subagent's "green": the reviewer re-runs the suite and pastes the EXIT code.
- vitest must exclude stray worktrees: `npx vitest run --exclude '.claude/**' --exclude 'node_modules/**' --exclude 'test/playwright/**' <files>`.
- `npm run test:ts` stops at the first failing project. Run `test:ts:main`, `test:ts:dev` and `test:ts:test` separately.

**One deliberate deviation from the spec (§15, "params unchanged"):** `flibPosDetect` gains a `translate: boolean`
param. A nested popup must keep the old POS-only behaviour (spec §1), and only the page knows it is nested
(`display.depth > 0`). Without the flag, the backend would send the bigger prompt and cache gloss lines.

## Review Focus

1. **The strip is wiped or duplicated by a re-render.** The translation column (`display-translation.js`) rewrites
   `.definition-list` and the display re-renders on option changes. Expect exactly one strip, still present after the
   column toggles. Owned by Task 4 (unit test for "one strip") and Task 5 (live check).
2. **Model output with markup** (`<img src=x onerror=alert(1)>`) must show as literal text. Owned by Task 4.
3. **A late answer after the user moved to another word** must not paint the old sentence's strip. Covers both the
   cache lookup and the «?» response. Owned by Task 4.
4. **The IndexedDB is unavailable** (Firefox private mode, browser-cleared data): «?» still returns POS and the
   translation, and the strip simply never auto-shows. Owned by Task 3.
5. **The same sentence with different whitespace** (NBSP, a newline, double spaces from layout scanning) must hit the
   same cache record. Owned by Task 1 (key normalizer) and Task 3 (lookup through the normalizer).

---

### Task 1: Combined prompt, answer parser, sentence key, gateway call

**Files:**

- Modify: `ext/js/data/flib-pos.js`
- Modify: `ext/js/comm/flib-gateway-client.js` (next to `detectPartOfSpeech`, ~line 450)
- Modify: `types/ext/flib-gateway.d.ts` (next to `PosResult`, line 53)
- Test: `test/flib-pos.test.js`, `test/flib-gateway-client.test.js`

**Interfaces:**

- Produces (all exported from `ext/js/data/flib-pos.js`):
  - `FLIB_POS_TRANSLATE_SYSTEM_PROMPT: string`
  - `FLIB_SENTENCE_MAX_CHARS = 1000`, `FLIB_TRANSLATION_MAX_CHARS = 1000`
  - `buildPosTranslateRequestBody(word: string, sentence: string): object`: same model, temperature,
    `response_format` and `#DATA ${JSON.stringify({w, s})}` user message as `buildPosRequestBody`, with the new system
    prompt
  - `parsePosTranslateAnswer(content: unknown): {pos: ?string, translation: ?string}`
  - `normalizeSentenceKey(sentence: string): string`
- Produces (type `import('flib-gateway').PosTranslationResult = {pos: ?string, translation: ?string}`):

  - `FlibGatewayClient#detectPartOfSpeechWithTranslation(word: string, sentence: string, {signal}?: {signal?: AbortSignal}): Promise<PosTranslationResult>`.
    It throws `flib_word_empty` like `detectPartOfSpeech`, and throws `llm_bad_answer` (status 200) only when BOTH
    halves are null.

- [ ] **Step 1: Write the failing tests in `test/flib-pos.test.js`**

```js
describe("FLIB_POS_TRANSLATE_SYSTEM_PROMPT", () => {
  test("keeps the POS rules and asks for tr", () => {
    expect(FLIB_POS_TRANSLATE_SYSTEM_PROMPT).toContain(
      "AS USED IN THAT SENTENCE",
    );
    expect(FLIB_POS_TRANSLATE_SYSTEM_PROMPT).toContain(
      "exactly ONE of noun, verb, adjective, adverb, pronoun, preposition,\n  conjunction, determiner, interjection, numeral.",
    );
    expect(FLIB_POS_TRANSLATE_SYSTEM_PROMPT).toContain('"tr"');
    expect(FLIB_POS_TRANSLATE_SYSTEM_PROMPT).not.toContain("no translation");
  });
});
describe("parsePosTranslateAnswer", () => {
  test.each([
    [
      '{"pos":"verb","tr":"Я забронировал столик."}',
      { pos: "verb", translation: "Я забронировал столик." },
    ],
    ['{"pos":"vt","tr":"  Текст  "}', { pos: "verb", translation: "Текст" }],
    ['{"pos":"verb"}', { pos: "verb", translation: null }],
    ['{"pos":"verb","tr":"   "}', { pos: "verb", translation: null }],
    ['{"pos":"verb","tr":42}', { pos: "verb", translation: null }],
    ['{"pos":"blah","tr":"Текст"}', { pos: null, translation: "Текст" }],
    ["not json", { pos: null, translation: null }],
    [null, { pos: null, translation: null }],
  ])("%s", (content, expected) => {
    expect(parsePosTranslateAnswer(content)).toStrictEqual(expected);
  });
  test("translation over 1000 chars is missing", () => {
    expect(
      parsePosTranslateAnswer(
        JSON.stringify({ pos: "noun", tr: "я".repeat(1001) }),
      ),
    ).toStrictEqual({ pos: "noun", translation: null });
    expect(
      parsePosTranslateAnswer(
        JSON.stringify({ pos: "noun", tr: "я".repeat(1000) }),
      ).translation,
    ).toHaveLength(1000);
  });
});
describe("normalizeSentenceKey", () => {
  test("NFC, trim, whitespace runs collapse, case kept", () => {
    expect(normalizeSentenceKey("  Book a \n\t table.  ")).toBe(
      "Book a table.",
    );
    expect(normalizeSentenceKey("café")).toBe("café");
  });
});
```

Also add one test that `FLIB_POS_SYSTEM_PROMPT` equals its current literal (copy it verbatim into the test), so any
edit to it fails.

- [ ] **Step 2: Write the failing tests in `test/flib-gateway-client.test.js`** (mirror the `describe('detectPartOfSpeech')` block at line 817)

  - `detectPartOfSpeechWithTranslation('booked', 'I booked a table')`: fetch answers
    `{"pos":"verb","tr":"Я забронировал столик."}` → `{pos: 'verb', translation: 'Я забронировал столик.'}`. The
    request body's `messages[0].content` equals `FLIB_POS_TRANSLATE_SYSTEM_PROMPT`.
  - Answer `{"pos":"verb"}` → `{pos: 'verb', translation: null}` (no throw).
  - Answer `{"tr":"Текст"}` → `{pos: null, translation: 'Текст'}` (no throw).
  - Answer `{"x":1}` → throws code `llm_bad_answer`.
  - An empty word or sentence → throws `flib_word_empty` with zero fetch calls.

- [ ] **Step 3: Run both files and confirm they fail**

Run: `npx vitest run --exclude '.claude/**' --exclude 'node_modules/**' --exclude 'test/playwright/**' test/flib-pos.test.js test/flib-gateway-client.test.js`
Expected: FAIL (missing exports or method).

- [ ] **Step 4: Implement the Task 1 interfaces**

The new prompt's text:

- the Role and POS lines copied from `FLIB_POS_SYSTEM_PROMPT`;
- `Output: { "pos": "<part_of_speech>", "tr": "<translation>" }`;
- a rule: `tr` = a natural Russian translation of the WHOLE sentence `s`, with no comments and no surrounding quotes;
- the closing line becomes "No examples, no extra keys, no markdown, no text outside the JSON."

`parsePosTranslateAnswer` reuses the `{…}` slice and `parseJson` try of `parsePosAnswer`. Extract a private helper
rather than duplicating the slice. The POS half goes through the same `POS_ALIAS` and `ANSWER_POS` check.

- [ ] **Step 5: Run the tests and confirm they pass; also run `npm run test:ts:main` and `npm run test:ts:test`**

Expected: vitest exit 0; both tsc runs exit 0.

- [ ] **Step 6: Commit**

```bash
git add ext/js/data/flib-pos.js ext/js/comm/flib-gateway-client.js types/ext/flib-gateway.d.ts test/flib-pos.test.js test/flib-gateway-client.test.js
git commit -m "feat(pos): combined POS + sentence translation prompt and gateway call"
```

---

### Task 2: Sentence translation cache (IndexedDB)

**Files:**

- Create: `ext/js/data/flib-sentence-cache.js`
- Test: `test/flib-sentence-cache.test.js`

**Interfaces:**

- Produces: `export class FlibSentenceCache`
  - `constructor({maxRecords = FLIB_SENTENCE_CACHE_MAX_RECORDS}?: {maxRecords?: number})`, with
    `FLIB_SENTENCE_CACHE_MAX_RECORDS = 2000` exported
  - `prepare(): Promise<void>`: opens DB `flib-sentence-translations`, version 1, store `translations`
    (`primaryKey: {keyPath: 'key'}`, `indices: ['ts']`), and sets the on-close listener
  - `get isUsable(): boolean`: same semantics as `FlibEventsDatabase#isUsable` (`_closedByBrowser` flag)
  - `get(key: string): Promise<?string>`: read only, never touches `ts`
  - `put(key: string, translation: string): Promise<void>`: writes `{key, translation, ts: Date.now()}` (overwrite
    allowed), then deletes the oldest records by the `ts` index until count ≤ `maxRecords`, in ONE readwrite
    transaction
- Keys arrive already normalized (Task 1 `normalizeSentenceKey`). The cache does not normalize.

- [ ] **Step 1: Write the failing tests** (set up `fake-indexeddb` exactly as `test/flib-events-database.test.js:19-25`)

  - `get` on an empty cache → `null`.
  - `put('a', 'А')` then `get('a')` → `'А'`.
  - `put('a', 'А')`, `put('a', 'Б')` → `get('a') === 'Б'` and a count of 1.
  - With `maxRecords: 3`, use `vi.setSystemTime` to give increasing `ts` and put `a`, `b`, `c`, `d` → `get('a') === null`,
    and `b`, `c`, `d` are present.
  - **A read does not refresh:** with `maxRecords: 3`, put `a`, `b`, `c`, then `get('a')`, then put `d` → `a` is evicted.
  - After the browser closes the connection (trigger the on-close listener as the events DB test does), `isUsable` is
    `false`.

- [ ] **Step 2: Run the file and confirm it fails**

Run: `npx vitest run --exclude '.claude/**' --exclude 'node_modules/**' --exclude 'test/playwright/**' test/flib-sentence-cache.test.js`
Expected: FAIL (module missing).

- [ ] **Step 3: Implement `FlibSentenceCache` in `ext/js/data/flib-sentence-cache.js`, modelled on `ext/js/data/flib-events-database.js`**

- [ ] **Step 4: Run the tests and confirm they pass; run `npm run test:ts:main` and `npm run test:ts:test`**

Expected: exit 0 on all three.

- [ ] **Step 5: Commit**

```bash
git add ext/js/data/flib-sentence-cache.js test/flib-sentence-cache.test.js
git commit -m "feat(pos): IndexedDB cache for sentence translations"
```

---

### Task 3: Backend: cache-aware `flibPosDetect` and `flibSentenceTranslationGet`

**Files:**

- Modify: `ext/js/background/backend.js`:
  - the handler map near line 330;
  - `_onApiFlibPosDetect` at ~1589;
  - a new memo field next to `_flibEventsPromise` (~261);
  - a new getter next to `_getFlibEventsDatabase` (~2020).
- Modify: `types/ext/api.d.ts` (`flibPosDetect` at line 516, plus the new entry)
- Modify: `ext/js/comm/api.js` (`flibPosDetect` at ~564, plus the new method)
- Test: `test/flib-pos-backend.test.js`

**Interfaces:**

- Consumes:
  - Task 1: `normalizeSentenceKey`, `FLIB_SENTENCE_MAX_CHARS`, `detectPartOfSpeech`,
    `detectPartOfSpeechWithTranslation`;
  - Task 2: `FlibSentenceCache`.
- Produces:
  - API `flibPosDetect`: params `{word: string, sentence: string, translate: boolean}`, return
    `import('flib-gateway').PosTranslationResult`;
  - API `flibSentenceTranslationGet`: params `{sentence: string}`, return `{translation: ?string}`;
  - `API#flibPosDetect(word: string, sentence: string, translate: boolean)` and
    `API#flibSentenceTranslationGet(sentence: string)` in `ext/js/comm/api.js`;
  - `Backend#_getFlibSentenceCache(): Promise<FlibSentenceCache>`: same memo-and-retry-once shape as
    `_getFlibEventsDatabase`.

`_onApiFlibPosDetect` decision order, after `_requireFlibPageSender(sender)`:

1. `translate === false`, OR `sentence.length > FLIB_SENTENCE_MAX_CHARS` → `detectPartOfSpeech`, return
   `{pos, translation: null}`. No cache access.
2. If the sender is not incognito, read the cache by `normalizeSentenceKey(sentence)`; a failure counts as a miss.
3. Hit → `detectPartOfSpeech` (the old prompt), return `{pos, translation: <cached>}`.
4. Miss → `detectPartOfSpeechWithTranslation`. If `translation !== null` and the sender is not incognito, `put`. A
   failed put is logged and the result is still returned.

`flibSentenceTranslationGet`, after the sender check:

- returns `{translation: null}` for an incognito sender, a sentence over the limit, or a cache failure;
- never calls the gateway.

- [ ] **Step 1: Write the failing tests in `test/flib-pos-backend.test.js`** (extend its fake context with `_flibGateway.detectPartOfSpeechWithTranslation` and `_getFlibSentenceCache: async () => fakeCache`, where `fakeCache = {get: vi.fn(), put: vi.fn()}`)

  - forbidden sender → `flib_secret_forbidden` for BOTH handlers, with zero gateway and cache calls;
  - `translate: false` → only `detectPartOfSpeech` is called; `cache.get` is not called; result
    `{pos: 'verb', translation: null}`;
  - cache hit (`get` → `'Перевод.'`) → `detectPartOfSpeech` is called and the combined call is not; result
    `{pos: 'verb', translation: 'Перевод.'}`;
  - cache miss → the combined call happens; `put` is called with `('Book a table.', 'Перевод.')` when the sentence
    passed was `'  Book a  table. '`;
  - miss, and the combined call returns `translation: null` → `put` is not called;
  - incognito sender (`{tab: {incognito: true}, ...}` plus whatever makes `_canSenderReadFlibSecrets` pass) → neither
    `get` nor `put` is called, and the result still carries the translation from the combined call;
  - `_getFlibSentenceCache` rejects → «?» still returns `{pos, translation}` from the combined call (Review Focus 4);
  - `cache.put` rejects → the result is still returned;
  - a sentence of 1001 chars → the old path, `translation: null`, no cache access;
  - `flibSentenceTranslationGet`: hit → `{translation: 'Перевод.'}` (looked up via the normalized key); miss →
    `{translation: null}`; incognito → `null` without `get`; cache failure → `null`; gateway mocks never called.

- [ ] **Step 2: Run the file and confirm it fails**

Run: `npx vitest run --exclude '.claude/**' --exclude 'node_modules/**' --exclude 'test/playwright/**' test/flib-pos-backend.test.js`
Expected: FAIL.

- [ ] **Step 3: Implement the backend handlers, API types and `API` methods; register `flibSentenceTranslationGet` in the handler map**

Grep for every other place that lists API names, for example a permission or hygiene list checked by
`test/flib-backend-hygiene.test.js`. Update them so the new name is treated like `flibPosDetect`.

- [ ] **Step 4: Run the file plus `test/flib-backend-hygiene.test.js`, then `test:ts:main` and `test:ts:test`**

Expected: exit 0 on all.

- [ ] **Step 5: Commit**

```bash
git add ext/js/background/backend.js ext/js/comm/api.js types/ext/api.d.ts test/flib-pos-backend.test.js
git commit -m "feat(pos): backend caches sentence translations and serves them to the popup"
```

---

### Task 4: Popup: button rules, translation strip, auto-show, blur

**Files:**

- Create: `ext/js/display/sentence-translation-strip.js` (a pure DOM builder)
- Modify: `ext/js/display/display-pos-hint.js`
- Modify: `ext/js/i18n/messages-ru.js`, `ext/js/i18n/messages-en.js`
- Modify: `ext/css/flib-card.css` (next to the `.translation-cell-blurred` rules, ~line 551)
- Test: `test/display-pos-hint.test.js`, `test/sentence-translation-strip.test.js`

**Interfaces:**

- Consumes:
  - Task 3: `api.flibPosDetect(word, sentence, translate)` → `{pos: ?string, translation: ?string}`;
  - Task 3: `api.flibSentenceTranslationGet(sentence)` → `{translation: ?string}`;
  - Task 1: `normalizeSentenceKey`;
  - `isFlibHost` from `ext/js/data/flib-host.js`.
- Produces: `createSentenceTranslationStrip(text: string, {blurred: boolean, revealed: boolean, onReveal: () => void}): HTMLElement`
  - Root: `div.fc-sentence-tr` with `role="note"` and `aria-label` = `translate('sentence.label')`.
  - Open state: the text goes into a child via `textContent`.
  - Blurred and not revealed: the child is a `button.fc-sentence-tr-blurred` (`title` = `translate('translation.blurHint')`,
    `aria-label` = `translate('sentence.show')`) holding an `inert`, `aria-hidden` `.is-blurred` span. A click calls
    `onReveal`.

Copy to add (both files; RU shown, EN in kind):

- `'sentence.label': 'Перевод фразы'`
- `'sentence.show': 'Показать перевод фразы'`
- `'pos.button'` becomes `'Перевести фразу и определить часть речи здесь'`

Behaviour in `DisplayPosHint` (spec §1–7, §17–18a):

- `nested = this._display.depth > 0`. A nested popup keeps the exact old rules: `known < 2` → disabled,
  `translate: false`, no strip, no auto-show.
- Not nested:
  - enabled whenever a term entry and a sentence of ≥2 words exist;
  - EXCEPT when `known < 2` and a strip translation is already shown → disabled.
- **Auto-show:** on `contentUpdateComplete`, when not nested and the query is valid, call `flibSentenceTranslationGet`.
  Drop the answer if `_requestId` changed meanwhile. A rejection is swallowed and logged.
- **Click result:**
  - a non-null `translation` → show the strip;
  - a non-null `pos` → `_apply(pos)`;
  - a null `pos` → `_showError('llm_bad_answer')`; the strip still shows if a translation came.
- **Page POS cache** (`word\0sentence`): set only when a translation was received OR a strip is already shown (spec
  §4).
- **`_apply` when `known < 2`:** if `pickPosTarget` returns null, set an empty label with no `miss` state.
- **Blur:** `blurred = options.flibTranslation.blur === true || isFlibHost(this._display.getOptionsContext().url ?? '')`.
  The revealed set holds normalized sentence keys and lives for the `DisplayPosHint` instance.
- **Placement:** insert the strip as the next sibling of the first `#dictionary-entries .entry > .entry-header`. On
  `contentClear` and before every insert, remove every existing `.fc-sentence-tr`.

- [ ] **Step 1: Write the failing tests in `test/sentence-translation-strip.test.js`**

  - open: `createSentenceTranslationStrip('<img src=x onerror=alert(1)>', {blurred: false, revealed: false, onReveal})`
    → `strip.querySelector('img') === null` and `strip.textContent` contains the literal markup (Review Focus 2);
  - blurred: a button with `title` = `translate('translation.blurHint')`; the `.is-blurred` span is `inert`; a click
    calls `onReveal` once;
  - blurred and revealed → open state, no button.

- [ ] **Step 2: Write the failing tests in `test/display-pos-hint.test.js`**

Extend `FakeDisplay` with:

- `depth = 0`;
- `getOptions()` returning `{flibTranslation: {blur: false}}`;
- `getOptionsContext()` returning `{url: 'https://example.com/'}`.

In `beforeEach`, insert `<div id="dictionary-entries"><div class="entry"><div class="entry-header"></div></div></div>`.
The api fake gets `flibSentenceTranslationGet: vi.fn(async () => ({translation: null}))`, and
`detect` returns `{pos: 'verb', translation: 'Я забронировал столик.'}`.

Tests:

- **one POS, no cached translation:** `show([entry('n')], 'book a table')` → button enabled. A click calls
  `detect('book', 'book a table', true)`; the strip appears right after `.entry-header` with that text; the label has
  no `data-miss`.
- **one POS, translation cached:** `flibSentenceTranslationGet` → `{translation: 'Т.'}`. After `show` + `flush`, the
  strip shows `'Т.'` and the button is disabled.
- **two POS, translation cached:** the button stays enabled.
- **nested popup:** `display.depth = 1`; with one POS the button is disabled. With two POS a click calls
  `detect(..., false)`. `flibSentenceTranslationGet` is never called and no strip appears.
- **late lookup (Review Focus 3):** `flibSentenceTranslationGet` resolves only after a second `show(...)` with another
  sentence → no strip for the first sentence.
- **late click answer (Review Focus 3):** `detect` resolves after a second `show` → no strip and no label.
- **POS without translation:** `detect` → `{pos: 'verb', translation: null}`. A second click calls `detect` again (2
  calls).
- **translation without POS:** `detect` → `{pos: null, translation: 'Т.'}` → the strip shows `'Т.'` and the label is
  `'!'` with `data-error`.
- **blurred on a flib host:** `getOptionsContext` → `{url: 'https://flib.club/x'}` → the strip has
  `button.fc-sentence-tr-blurred`. After a click on it, the open text shows. A second `show` with the same sentence
  (different word) shows it open.
- **exactly one strip (Review Focus 1):** two `contentUpdateComplete` in a row with a cached translation leave exactly
  one `.fc-sentence-tr`; `contentClear` leaves none.
- **existing tests:** update every existing `detect` expectation to the new 3-argument call and the
  `{pos, translation}` result. "Disabled with one entry" changes per spec §1: one POS and no cached translation now
  means ENABLED.

- [ ] **Step 3: Run both files and confirm the new tests fail**

Run: `npx vitest run --exclude '.claude/**' --exclude 'node_modules/**' --exclude 'test/playwright/**' test/display-pos-hint.test.js test/sentence-translation-strip.test.js`
Expected: FAIL.

- [ ] **Step 4: Implement the strip builder, the `DisplayPosHint` changes, the copy and the CSS**

For CSS, use the existing card tokens (`--fc-ink2`, `--fc-acc-line`, `--fc-line`), with a left border like
`.definition-item-inner[data-translation-layout=stack]>.translation-cell`. Blur uses the same filter values as
`.translation-cell-blurred>.is-blurred`: 5px, and 4px on hover. It must look right in the light and dark themes.

- [ ] **Step 5: Run the two files and confirm they pass; run `npm run test:ts:main`, `npm run test:ts:test`, and eslint and stylelint on the changed files**

Run: `npx eslint ext/js/display/display-pos-hint.js ext/js/display/sentence-translation-strip.js ext/js/i18n/messages-ru.js ext/js/i18n/messages-en.js test/display-pos-hint.test.js test/sentence-translation-strip.test.js && npx stylelint ext/css/flib-card.css`
Expected: exit 0 on each.

- [ ] **Step 6: Commit**

```bash
git add ext/js/display/sentence-translation-strip.js ext/js/display/display-pos-hint.js ext/js/i18n/messages-ru.js ext/js/i18n/messages-en.js ext/css/flib-card.css test/display-pos-hint.test.js test/sentence-translation-strip.test.js
git commit -m "feat(pos): sentence translation strip with auto-show from cache and blur"
```

---

### Task 5: PRIVACY text, full suite, live check in Chromium

**Files:**

- Modify: `PRIVACY.md` (the «Part of speech» paragraph, lines 50–55)

- [ ] **Step 1: Rewrite the «Part of speech» paragraph**

Keep the existing facts: «?» only, the word, the sentence and the key go to `cache.flib.club`, then to OpenAI, and
the quota is spent. Then:

- add: "and to translate the sentence into Russian";
- replace "the answer is kept only while the card is open" with: the translation of the sentence is stored on your
  device inside the extension (the last 2000 sentences you pressed «?» on, not kept for private windows) so that other
  words of the same sentence show it without a new request; nothing is sent until you press the button;
- no new hosts and no analytics.

- [ ] **Step 2: Run the full unit suite and all three tsc projects; paste the exit codes**

Run: `npx vitest run --exclude '.claude/**' --exclude 'node_modules/**' --exclude 'test/playwright/**'; echo EXIT=$?` then `npm run test:ts:main; echo EXIT=$?`, `npm run test:ts:dev; echo EXIT=$?`, `npm run test:ts:test; echo EXIT=$?`
Expected: every EXIT=0. The baseline on `main` is 140 files, 6302 passed, 46 skipped, plus the new tests.

- [ ] **Step 3: Live check in Chromium**

Drive the unpacked `ext/` with Playwright, using a gateway stub on 127.0.0.1 that answers `/v1/openai/chat/completions`
by prompt: the combined prompt → `{"pos":"verb","tr":"…"}`, the POS prompt → `{"pos":"verb"}`. Confirm:

- (a) «?» on a word shows the strip under the header, and the card jumps to the verb definition;
- (b) hovering a second word of the same sentence shows the strip with zero stub requests;
- (c) toggling the translation column keeps exactly one strip;
- (d) with `flibTranslation.blur` on, the strip is blurred and a click reveals it.

Screenshots go to the scratchpad. Report the stub's request count for (b).

- [ ] **Step 4: Commit**

```bash
git add PRIVACY.md
git commit -m "docs(privacy): «?» translates the sentence and keeps it on the device"
```

After Task 5: whole-branch review plus an adversarial audit by fable agents, run in parallel (owner process). The
`STORE-TEXTS.md` CWS data-usage wording is updated at the next store submission. It is outside the repo and not part
of this branch.
