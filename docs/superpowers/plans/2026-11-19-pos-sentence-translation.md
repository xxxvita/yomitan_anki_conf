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

**Amendments after the independent plan review (2026-11-20, binding; they override the text above where they conflict):**

- The new system prompt is EXACTLY this literal (L4: `pos` rules scoped so `tr` is not pushed into English). Keep temperature 0.4 like the POS request; it was not measured (the spec allowed a measurement; none was done):

```
Role: English part-of-speech tagger and translator. You receive a target word and the
sentence it appears in. Determine the part of speech of the TARGET word
AS USED IN THAT SENTENCE — by its role in the sentence, not the word's
most common use (e.g. "book" in "book a table" = verb). Also translate the
WHOLE sentence into natural Russian.

Input: JSON after #DATA tag. Keys: w=target word, s=sentence.

Output: strictly valid JSON, nothing else:
{ "pos": "<part_of_speech>", "tr": "<translation>" }

Rules:
- pos: exactly ONE of noun, verb, adjective, adverb, pronoun, preposition,
  conjunction, determiner, interjection, numeral.
- pos: lowercase English word only.
- tr: a natural Russian translation of the WHOLE sentence s, as a reader would
  understand it. No comments, no transliteration, no quotes around it.
- No examples, no extra keys, no markdown, no text outside the JSON.
```

Adjust the Step 1 prompt test so its substrings match this literal (the POS-list substring already does).

- M5: replace the `normalizeSentenceKey` test inputs so they prove something: `normalizeSentenceKey('cafe\u0301')` → `'caf\u00e9'` (decomposed input, composed output), `'a\u00a0\u00a0b\r\nc'` → `'a b c'`, `'  x  '` → `'x'`, `'Book'` stays `'Book'` (case kept). Write the escapes exactly so; do not paste literal composed characters.

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

**Amendments after the independent plan review (2026-11-20, binding; they override the text above where they conflict):**

- M6 test setup: copy the `fake-indexeddb` imports and the `vi.stubGlobal('IDBKeyRange', IDBKeyRange)` line from `test/flib-events-database.test.js:19-25`, AND the per-test `vi.stubGlobal('indexedDB', new IDBFactory())` that file does in its `beforeEach` (~line 160). For time use `vi.spyOn(Date, 'now').mockReturnValue(n)`; do NOT call `vi.useFakeTimers()` or `vi.setSystemTime` (fake-indexeddb schedules on real timers and hangs). For the closed-by-browser test, reuse the approach of the `rawConnection` helper in that file (~lines 417-424).
- L6: eviction must never delete the key that `put` just wrote, even if `Date.now()` went backwards (exclude it explicitly). Test: with `maxRecords: 2`, put `a` at ts 100, `b` at ts 200, then `c` at ts 50 → `get('c') === 'C'`, and `a` is evicted.

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

**Amendments after the independent plan review (2026-11-20, binding; they override the text above where they conflict):**

- L3: the POS-only branch fires when `translate !== true` (a missing flag must never reach the paid translate-and-cache path). Update the existing "delegates" test (`test/flib-pos-backend.test.js` ~54-58), which passes no flag, accordingly.
- L5: the new handler is named `_onApiFlibSentenceTranslationGet`. The incognito sender fixture is literally `{id: EXT_ID, url: `${EXT_BASE}popup.html`, tab: {id: 1, incognito: true}, frameId: 2}` with the file's own `EXT_ID`/`EXT_BASE` constants (adapt names to what the file defines).
- L5: measure the 1000-char limit the same way in BOTH handlers: on `normalizeSentenceKey(sentence).length`.
- If `test/flib-backend-hygiene.test.js` changes, add it to the commit.

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

**Amendments after the independent plan review (2026-11-20, binding; they override the text above where they conflict):**

- **H1 (scan-disable).** The strip root is `div.fc-sentence-tr.scan-disable`, and `display.js` `CONTENT_CLICK_EXCLUDE` gains `.fc-sentence-tr,.fc-sentence-tr *`, so clicking or hovering Russian words in the open strip never starts a nested lookup. Test: `strip.matches(CONTENT_CLICK_EXCLUDE)` and `strip.firstElementChild.matches(CONTENT_CLICK_EXCLUDE)` are both true (import the constant from `ext/js/display/display.js`). Add `ext/js/display/display.js` to the files and the commit.
- **H2 (ruling by the controller while the owner sleeps: the strip stays visible after the jump).** The strip is `position: sticky; top: 0` with an opaque card background and a z-index above entry content. It lives in the HOST entry: entry 0 by default; when a «?» answer focuses another entry (`pickPosTarget(...).entryIndex !== 0`), the strip moves into that entry. In `display.js` `_focusEntry`, when `target !== 0`, subtract the height of the `.fc-sentence-tr` inside the target entry node (if any) so the focused definition lands just below the sticky strip, not under it. Unit test (display-pos-hint): after a click whose target is entry 1, the strip is inside entry 1 and entry 0 has none. The visual part is checked live in Task 5.
- **M1 (placement).** Insert the strip as the previous sibling of `:scope > .entry-body` of `display.dictionaryEntryNodes[hostIndex]` (not after `.entry-header`): `display-anki.js` inserts its status/callout nodes after the header asynchronously, so this keeps the order fixed (Anki lines above, strip right above the body). FakeDisplay in the tests gets `dictionaryEntryNodes` and the test DOM gets `.entry-body` inside each `.entry`.
- **M4 (query split).** Split `_getQuery` into: a query getter WITHOUT the POS gate (term entry, sentence of ≥2 words, word) used by the click and the auto-show, and a separate known-POS count used only by `_render`'s disable rules. Auto-show must work for single-POS words.
- **M2 + M3 (page cache).** The page cache (`word\0sentence`) stores `{pos, translation}` (translation may be the one received or the one already shown). A hit re-applies POS AND re-paints the strip when a translation is stored. Cache a result when a translation exists, OR when the request was `translate: false` (nested popups keep today's free repeats). Tests: (a) nested popup, two clicks → one `detect` call; (b) click (translation received), `show` another sentence, `show` the first again with the lookup returning `null`, click → strip shown, and `detect` was called once in total.
- **L1 (nested).** `nested = this._display.depth > 0 || <history.state.url is on the popup's own origin>`; compare with `new URL(url).origin === window.location.origin` in a try (an in-card lookup with nesting off replaces the root content and sets `url` to the popup page, `display.js` ~2522). Test: depth 0 with `history.state.url = window.location.href` behaves as nested.
- **L2.** Besides "disabled with one entry", the `test.each` "two entries of one POS / without POS → disabled" (`test/display-pos-hint.test.js` ~112-118) also flips to ENABLED when no translation is cached; update it.
- **L5.** `getOptions()` may be `null` before options load: treat as not blurred unless the host is a flib host. When `known < 2` and the target is null, reset `_message` too (not only the label). When the button is disabled because the strip is shown, its title is the new `'pos.button'` text (no stale message).
- **L6 tests.** (a) `flibSentenceTranslationGet` rejects → no strip, no unhandled rejection, button still works; (b) a gateway error from `detect` → no strip (spec §5) and the error label as today; (c) an auto-show lookup that resolves to `null` AFTER a click painted the strip must not remove it.

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

**Amendments after the independent plan review (2026-11-20, binding; they override the text above where they conflict):**

- **Live check additions.** (e) after «?» on a word whose verb sense sits below several noun senses (e.g. `book` in `I want to book a table.`), the strip's bounding box is inside the viewport and the focused definition's top is at or below the strip's bottom; (f) clicking a word inside the open strip opens no nested popup.
- Incognito (`sender.tab.incognito`) is not checked live (Playwright with the extension in incognito is awkward): record it as an accepted risk in the PR description; it is covered by unit tests only.

After Task 5: whole-branch review plus an adversarial audit by fable agents, run in parallel (owner process). The
`STORE-TEXTS.md` CWS data-usage wording is updated at the next store submission. It is outside the repo and not part
of this branch.
