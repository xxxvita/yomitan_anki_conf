# 0.5.2 Card Toggles, No-Key Hint, «Понятные» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users switch the ReverseDeck and Phrases cards off. Tell users why «+» did nothing more when they have no key. Show an inert «Понятные» placeholder in the YouTube examples. Fix settings import, which is broken in 0.5.1.

**Architecture:** Two new profile options, `flibService.createReverseCard` and `flibService.createPhrasesCard` (options v84). The popup decides once per «+» with `_decideEnrichment` and passes the flags in the `flibEnrichNote` request. The enricher runs a card step only when its flag is on. The three `flibService` blanking sites keep the non-secret fields. The placeholder lives in a new tools row of the YouTube section.

**Tech Stack:** Plain ES modules with JSDoc + `checkJs`, vitest (+ jsdom where the existing tests use it), Playwright for the live check.

**Spec:** `docs/superpowers/specs/2026-11-16-card-toggles-key-hint-design.md` (revised after the independent review of 2026-11-16).

## Global Constraints

- A GPL-3.0-or-later license header on every new JS file (eslint-plugin-header).
- Russian text only in `ext/js/i18n/messages-ru.js`. Every key also goes in `messages-en.js` (ui-language guard).
- The literal `flib.club` is allowed only in `ext/js/data/flib-host.js` (A25).
- Never weaken `cleanModelText` in `ext/js/data/flib-enrich.js`.
- A flag counts as off ONLY when it is exactly `false`; missing or malformed means on.
- The «Понятные» tooltip, verbatim (ru): `Скоро: добавит сверху ролики, которые вам понятны — подобранные, как в рекомендациях для развития навыка 'понимать английский на слух', по вашим последним шагам и знакомым словам, с этим словом или выражением`
- No-key status text (ru): `Примеры и доп. карточки не созданы: ключа нет или он неверный`
- Unit dev loop: `npm run test:unit -- --exclude '.claude/**' --exclude 'node_modules/**' --exclude 'test/playwright/**'`. Without the excludes, vitest scans stray worktrees and reports false failures.
- Live harnesses may use the owner's TEST Anki on 127.0.0.1:8765 (the owner allowed it on 2026-11-16).
- Commits end with the attribution lines from the session's system reminder.

## Review Focus

1. **A user switched a toggle off, then imported a backup or migrated a key.** The toggle must stay off, and the import must not throw. Owned by Task 2: real-schema `validate()` tests.
2. **A disabled card must never show as failed** (budget timeout or an early error). Owned by Task 3: the both-off test with `budgetMs = 10`.
3. **Phrases off must spend no ChatGPT quota on phrases or find_form.** Owned by Task 3: `chatJson` is called once.
4. **No key, wired in the real `_saveAnkiNote`.** No `flib_enriched` tag, no `flibEnrichNote` call, and a hint line in the direct route only (not in the Flibooster `core` route). Owned by Task 4: `test/anki-add-event.test.js`.
5. **The «Понятные» button must actually be visible.** Its row must not be inside the `display:none` title. Owned by Task 6: `closest('.ve-gw-section-title') === null`, plus a screenshot in Task 7.

---

### Task 1: Options v84

**Files:**

- Modify: `ext/data/schemas/options-schema.json` (the `flibService` block near line 1409)
- Modify: `ext/js/data/options-util.js` (register `this._updateVersion84` after `this._updateVersion83` at line 604; add the method after `_updateVersion83`, ~line 2005)
- Modify: `types/ext/settings.d.ts` (`FlibServiceOptions`)
- Do NOT touch: `ext/data/provisioning/default-options.json` (v75, no `flibService`; see `options-util.js:1899-1903`)
- Test: `test/options-util.test.js`

**Interfaces:**

- Produces: `FlibServiceOptions.createReverseCard: boolean` and `FlibServiceOptions.createPhrasesCard: boolean`, both with schema default `true` and listed under `required`.

- [ ] **Step 1: Update the expected full options and the version in the test.** In `test/options-util.test.js`, add `createReverseCard: true, createPhrasesCard: true` next to `enrichCards: true` (~line 628) and change `version: 83` (~line 720) to `84`. Then add:

```js
test("миграция 84: обе доп. карточки включены, остальное не тронуто", async () => {
  const options = await optionsUtil.update(createOptionsTestData1(), 83);
  const service =
    /** @type {Partial<import('settings').FlibServiceOptions>} */ (
      options.profiles[0].options.flibService
    );
  delete service.createReverseCard;
  delete service.createPhrasesCard;
  service.enrichCards = false;
  const updated = await optionsUtil.update(options, 84);
  expect(updated.version).toBe(84);
  expect(updated.profiles[0].options.flibService).toMatchObject({
    createReverseCard: true,
    createPhrasesCard: true,
    enrichCards: false,
  });
});
```

- [ ] **Step 2: Run the tests and see them fail.** Run `npm run test:unit -- test/options-util.test.js`. Expected: FAIL (the version is 83, and the fields are missing).
- [ ] **Step 3: Implement.** Add the schema properties (`"type": "boolean", "default": true`) and append both to `required`. Add `_updateVersion84(options)`, mirroring `_updateVersion83`: set both fields to `true` where `flibService` is an object. Its JSDoc says "Added flibService.createReverseCard / createPhrasesCard". Update `settings.d.ts`.
- [ ] **Step 4: Run the tests and see them pass.** Run `npm run test:unit -- test/options-util.test.js test/provisioning-seed.test.js && npm run test:unit:options && npm run test:json && npm run test:ts`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(options): v84 toggles for the ReverseDeck and Phrases cards`.

### Task 2: Blanking keeps non-secret flibService fields (fixes settings import)

**Files:**

- Modify: `ext/js/data/flib-secret-store.js`, functions `carryFlibKeyIntoOptions` (~line 308) and `blankFlibServiceInOptions` (~line 350)
- Modify: `ext/js/data/flib-secrets.js`, function `blankFlibServiceOnImport` (~line 97)
- Test: `test/flib-secret-store.test.js` (widen the `optionsWith` helper type at ~line 33; import `carryFlibKeyIntoOptions`), `test/flib-secrets.test.js`, `test/options-util.test.js` (the real-schema test)

**Interfaces:**

- Consumes: Task 1's field names.
- Produces: no new API.

  - `carryFlibKeyIntoOptions` and `blankFlibServiceInOptions` keep every key of an object-shaped `flibService` and overwrite only `personalKey` and `gatewayUrl`.
  - `blankFlibServiceOnImport` writes `{gatewayUrl: '', personalKey: '', ...allowList}`, where `allowList` takes `enrichCards`, `createReverseCard` and `createPhrasesCard` from the file only when they are booleans.
  - A non-object `flibService` still becomes `{gatewayUrl: '', personalKey: ''}` (plus `personalKey: key` for carry). That shape is schema-invalid but reachable only before `update()`; say so in a JSDoc line.

- [ ] **Step 1: Write the failing tests.**
  - `test/flib-secret-store.test.js`, in `describe('blankFlibServiceInOptions')`: `test('toggles survive blanking')`.
    - Input: a profile with `flibService: {gatewayUrl: 'https://x', personalKey: 'tpk_' + 'a'.repeat(32), enrichCards: false, createReverseCard: false, createPhrasesCard: false}`.
    - Expect the function to return `true` and `flibService` to `toStrictEqual({gatewayUrl: '', personalKey: '', enrichCards: false, createReverseCard: false, createPhrasesCard: false})`.
  - Same file: `test('carryFlibKeyIntoOptions keeps the toggles')`. The same input with blank secrets plus key `K` gives `{gatewayUrl: '', personalKey: K, enrichCards: false, createReverseCard: false, createPhrasesCard: false}`.
  - `test/flib-secrets.test.js`, in `describe('blankFlibServiceOnImport (C1)')`: `test('imported toggles are kept, secrets blanked, junk dropped')`.
    - Input: `{gatewayUrl: 'https://evil', personalKey: 'tpk_…', enrichCards: false, createPhrasesCard: false, createReverseCard: 'yes', extra: 1}`.
    - Expect `{gatewayUrl: '', personalKey: '', enrichCards: false, createPhrasesCard: false}`.
  - `test/options-util.test.js`: `test('import path with the real schema: update → blankFlibServiceOnImport → validate keeps enrichCards:false')`.
    1. Build `const options = await optionsUtil.update(createOptionsTestData1())` and set `flibService.enrichCards = false, createReverseCard = false`.
    2. Call `blankFlibServiceOnImport(options)`, then `expect(() => optionsUtil.validate(options)).not.toThrow()`, and check that both stay `false`.
    3. Repeat for `blankFlibServiceInOptions` and `carryFlibKeyIntoOptions(options, 'tpk_' + 'b'.repeat(32))`.
- [ ] **Step 2: Run the tests and see them fail.** Run `npm run test:unit -- test/flib-secret-store.test.js test/flib-secrets.test.js test/options-util.test.js`. Expected: the new tests FAIL. The import test fails with `Missing property enrichCards`, which is the bug reproduced.
- [ ] **Step 3: Implement.** Object-shaped service → `{...service, gatewayUrl: '', personalKey: …}` (carry and blank) or the allow-list (import). Non-object → the old blank shape. Keep the "already blank → no change" early return in `blankFlibServiceInOptions`.
- [ ] **Step 4: Run the tests and see them pass.** Run the same command plus `npm run test:unit -- test/flib-secrets-backend.test.js test/backup-controller.test.js && npm run test:ts && npm run test:js`. Expected: PASS.
- [ ] **Step 5: Commit** with `fix(settings): import and key blanking keep the enrichment toggles` and a body saying import is broken in 0.5.1.

### Task 3: Enricher honours the card flags

**Files:**

- Modify: `ext/js/data/flib-enrich.js` (add `normalizeEnrichCards`)
- Modify: `ext/js/background/flib-card-enricher.js` (`enrich`, `_run` including its catch loop at ~line 249)
- Modify: `ext/js/background/backend.js` `_onApiFlibEnrichNote` (~line 1600)
- Modify: `ext/js/comm/api.js` `flibEnrichNote` (~line 574)
- Modify: `types/ext/flib-gateway.d.ts` (`EnrichRequest` and a new `EnrichCards`). `types/ext/api.d.ts:523-526` already references `EnrichRequest`; no change is needed there.
- Test: `test/flib-card-enricher.test.js`, `test/flib-enrich-backend.test.js`, `test/flib-enrich.test.js`

**Interfaces:**

- Produces:

  - `type EnrichCards = {reverse: boolean, phrases: boolean}`.
  - `EnrichRequest = {noteId: number, userTags: string[], cards?: Partial<EnrichCards>}`.
  - `normalizeEnrichCards(cards: unknown): EnrichCards` in `flib-enrich.js`.
  - `API.flibEnrichNote(noteId: number, userTags: string[], cards: EnrichCards)`.
  - The backend calls `enrich({noteId, userTags, cards: normalizeEnrichCards(cards)})`.

- [ ] **Step 1: Write the failing tests.**
  - `test/flib-enrich.test.js`: `test('normalizeEnrichCards: only an exact false turns a card off')`. Assert `normalizeEnrichCards(undefined)`, `(null)`, `({})` and `({reverse: 'no', phrases: 0})` are each `{reverse: true, phrases: true}`; `({reverse: false})` is `{reverse: false, phrases: true}`; `({reverse: false, phrases: false})` is both false.
  - `test/flib-card-enricher.test.js`:
    - `test('both cards off: base enriched, no derived notes, one chat call')`. Call `enrich({noteId: 100, userTags: [], cards: {reverse: false, phrases: false}})`.
      - The report is `{enrich: done, audio: done, reverse: skipped, phrases: skipped, speechCode: null}`.
      - There are no ReverseDeck or Phrases notes.
      - `gateway.chatJson` was called exactly once.
      - `anki.findNotes` was never called with a `_reverse` or `_phrases` query.
      - The base note keeps `flib_enriched`.
    - `test('both cards off and the budget is spent: they stay skipped, never failed')`. Use `budgetMs = 10` and an enrich override that awaits 30 ms. Expect `reverse` and `phrases` to equal `{status: 'skipped'}`.
    - `test('reverse off only: Phrases created, no reverse link, no Audio_Translate')`.
    - `test('phrases off only: ReverseDeck created, no phrases/find_form chat call')`.
  - `test/flib-enrich-backend.test.js`: update the assertion at ~line 76 so `enrich` receives `cards: {reverse: true, phrases: true}` when the request has none. Add a case where `cards: {reverse: false}` arrives as `{reverse: false, phrases: true}`.
- [ ] **Step 2: Run the tests and see them fail.** Run `npm run test:unit -- test/flib-enrich.test.js test/flib-card-enricher.test.js test/flib-enrich-backend.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - `enrich({noteId, userTags, cards})` normalizes the flags once (a missing `cards` means on).
  - `_run` calls `this._step(ctx, 'reverse', …)` only if the normalized `cards.reverse`, and likewise for phrases.
  - The catch loop skips keys whose flag is off.
  - The steps themselves are unchanged. The `_inFlight` key stays `noteId`.
- [ ] **Step 4: Run the tests and see them pass.** Run the same command plus `npm run test:ts`. Expected: PASS, and the existing enricher tests are unchanged (no `cards` means everything on).
- [ ] **Step 5: Commit** with `feat(enrich): skip ReverseDeck/Phrases when their toggle is off`.

### Task 4: Popup decides once, sends the flags, explains a missing key

**Files:**

- Modify: `ext/js/display/flib-enrich-flow.js` (replace `shouldEnrichNote` with `decideEnrichment`; add `enrichCardsFromOptions`; `startEnrichment` takes `cards`)
- Modify: `ext/js/display/flib-enrich-status.js` (add `renderNoKeyStatus`)
- Modify: `ext/js/display/display-anki.js`:
  - replace `_shouldEnrichNote` (~line 2496) with `_decideEnrichment`;
  - the new-note branch (~line 2994);
  - store `cards` beside `enrichNoteId` / `enrichTags` (~lines 2905-2908);
  - `_startEnrichment` (~line 2513) and its call (~line 3043).
- Modify: `ext/js/i18n/messages-ru.js`, `messages-en.js` (`enrich.noKey`)
- Test: `test/flib-enrich-flow.test.js`, `test/flib-enrich-status.test.js`, `test/anki-add-event.test.js`, `test/display-anki-flib-media.test.js`

**Interfaces:**

- Consumes: `EnrichCards`, `normalizeEnrichCards` and `API.flibEnrichNote(noteId, userTags, cards)` from Task 3.
- Produces:

  - `decideEnrichment(note: import('anki').Note, {enrichCards: boolean, hasKey: ?boolean}): 'enrich'|'no-key'|'none'` (pure, no route), plus `shouldShowNoKeyHint(routeMode: ?string): boolean`.
    - `hasKey === null` (the status call threw) → `'none'`.
    - A missing key → `'no-key'` candidate; `shouldShowNoKeyHint` is true only for `'direct'`; core, none, disabled and unknown → false.
  - `enrichCardsFromOptions(flibService: unknown): EnrichCards`, which reuses `normalizeEnrichCards({reverse: s?.createReverseCard, phrases: s?.createPhrasesCard})`.
  - `startEnrichment({api, noteId, tags, cards, isCurrent, render})`.
  - `renderNoKeyStatus(api: API, onSaved: () => void): HTMLElement`: a `.fc-enrich-status[data-state=warn]` with a `.fc-enrich-head` holding `translate('enrich.noKey')`, followed by `createFlibKeyHelp({api, variant: 'need', onSaved})`.
  - `DisplayAnki._decideEnrichment(note): Promise<{action: 'enrich'|'no-key'|'none', cards: EnrichCards}>`.
    - It reads `this._display.getOptions()` once.
    - It calls `flibGatewayStatus()` only when `enrichCards` is on and the model matches.
    - The route is NOT probed here. After a SUCCESSFUL add, only for the no-key candidate, `_saveAnkiNoteClaimed` calls a fresh `api.getAnkiRoute(true)` in try/catch (a throw gives `null`); the probe has side effects and must never run before or around the add.

- [ ] **Step 1: Write the failing tests.**
  - `test/flib-enrich-flow.test.js`:
    - Replace the `shouldEnrichNote` describe with `decideEnrichment`, covering this table:
      - option off → `'none'`;
      - another model → `'none'`;
      - `hasKey: true` → `'enrich'`;
      - `hasKey: false` → `'no-key'`;
      - `shouldShowNoKeyHint`: only `'direct'` is true;
      - `hasKey: null` → `'none'`;
      - `' yomitan card type '` → `'enrich'`.
    - `test('enrichCardsFromOptions reads only the given options')`. `{createReverseCard: false, createPhrasesCard: true}` → `{reverse: false, phrases: true}`; `undefined` → both true.
    - Extend `'renders pending, then the report…'` so that `api.flibEnrichNote` is called with `(noteId, userTagsWithoutMarker, {reverse: false, phrases: true})`.
  - `test/flib-enrich-status.test.js`: `test('no-key status: warn line with the text and the key help')`. Expect `data-state` to be `warn`, `.fc-enrich-head` text to equal `translate('enrich.noKey')`, and a `.fc-xp-help` child.
  - `test/anki-add-event.test.js` (use its `realAddNoteId` harness): change the stub at ~line 104 from `_shouldEnrichNote` to `_decideEnrichment: async () => ({action: 'none', cards: {reverse: true, phrases: true}})`. Add:
    - `test('no key: note added without flib_enriched, no flibEnrichNote, hint rendered')`. Stub `_decideEnrichment` to return `no-key`. Assert:
      - the note passed to `addAnkiNote` has no `flib_enriched` tag;
      - `api.flibEnrichNote` is not called;
      - one `.fc-enrich-status[data-state=warn]` is under the entry.
    - `test('enrich: flags reach flibEnrichNote')`. Stub `_decideEnrichment` to return `{action: 'enrich', cards: {reverse: false, phrases: true}}`. Assert `flibEnrichNote` gets these cards and the added note carries `flib_enriched`.
    - `test('status call throws: save succeeds, event recorded, no hint')`. Exercise the real `_decideEnrichment` with `getOptions` returning enrichCards on and `flibGatewayStatus` rejecting.
  - `test/display-anki-flib-media.test.js:178`: change the stub the same way as above.
- [ ] **Step 2: Run the tests and see them fail.** Run `npm run test:unit -- test/flib-enrich-flow.test.js test/flib-enrich-status.test.js test/anki-add-event.test.js test/display-anki-flib-media.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - In `_saveAnkiNote`'s new-note branch, call `const decision = await this._decideEnrichment(note)` before the add, and run `markNoteForEnrichment` only for `'enrich'`.
  - After a successful add:
    - `'enrich'` → keep `enrichNoteId`, `enrichTags` and `enrichCards = decision.cards` for the call after the finally block;
    - `'no-key'` → render `renderNoKeyStatus` at the anchor `_renderEnrichStatus` uses (replacing an old `.fc-enrich-status`). `onSaved` removes the line; there is no re-enrichment.
  - Add `enrich.noKey` to both message files. The ru text is from Global Constraints; en: `No examples or extra cards: the personal key is missing or invalid`.
- [ ] **Step 4: Run the tests and see them pass.** Run the same command plus `npm run test:ts && npm run test:js`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(enrich): send the card toggles; explain a skipped enrichment without a key`.

### Task 5: Settings toggles

**Files:**

- Modify: `ext/settings.html`, the enrichCards row (~lines 1895-1903). Nest the two new rows inside it, following the `setVisibility` pattern at `settings.html:751-760` and `778-784` (`generic-setting-controller.js:299-306`).
- Modify: `ext/js/i18n/messages-ru.js`, `messages-en.js`
- Test: the html, css and i18n suites

**Interfaces:**

- Consumes: the Task 1 option paths `flibService.createReverseCard` and `flibService.createPhrasesCard`. The binding throws `Property … not supported` without Task 1.

- [ ] **Step 1: Add the markup.**
  - Add a `data-transform` of type `setVisibility` to the enrichCards checkbox, targeting `#flib-enrich-cards-options`. Copy the exact attribute shape from `settings.html:751-760`.
  - Inside the enrichCards `.settings-item`, add `div.settings-item-children.settings-item-children-group#flib-enrich-cards-options` with `hidden`, containing two toggle rows:
    - `data-setting="flibService.createReverseCard"` with keys `settings.createReverseCard` / `settings.createReverseCardHint`;
    - `data-setting="flibService.createPhrasesCard"` with keys `settings.createPhrasesCard` / `settings.createPhrasesCardHint`.
  - ru labels: `Обратная карточка (русский → английский)`, `Карточка-фраза с пропуском`.
  - ru hints: `Отдельная карточка ReverseDeck: по переводу вспомнить английское слово.` and `Отдельная карточка Phrases: живая фраза со словом, слово пропущено. Тратит ещё один запрос к ChatGPT.`
  - New `settings.enrichCardsHint` (ru): `При «+» в Anki добавляются примеры, синонимы и озвучка, а также доп. карточки, включённые ниже. Тратит квоту личного ключа. Без галочки в Anki идёт только словарь.`
  - Matching en texts. Update the English fallback text at `settings.html:1898` to the new en hint.
- [ ] **Step 2: Verify.** Run `npm run test:html && npm run test:css && npm run test:js && npm run test:unit -- test/flib-service-controller.test.js test/ui-language.test.js test/ui-language-guard.test.js`. Expected: PASS.
- [ ] **Step 3: Commit** with `feat(settings): ReverseDeck and Phrases card toggles`.

### Task 6: «Понятные» placeholder button

**Files:**

- Modify: `ext/js/display/gateway-examples-panel.js` (`_buildSection` ~line 653: a tools row for YouTube only; `_setSection` ~line 678: visibility)
- Modify: `ext/css/flib-card.css` (NOT `display.css`), and `messages-ru.js` / `messages-en.js` (`video.understandable`, `video.understandableHint`)
- Test: `test/gateway-examples-panel.test.js`

**Interfaces:**

- Produces:

  - A row `div.ve-gw-section-tools`, a direct child of `section[data-section=youtube]` placed before the list, holding `button.fc-btn.ve-gw-understandable`. The button has:
    - `type="button"`, `aria-disabled="true"`;
    - `title` = `translate('video.understandableHint')`;
    - `aria-describedby` → `div.ve-gw-understandable-hint` (same text, `hidden` by default).
  - Focus or a click toggles the hint's `hidden`; blur hides it. Nothing else happens: no loader or api call.
  - The row is `hidden` unless the YouTube section state is `ready`.

- [ ] **Step 1: Write the failing test** `test('YouTube ready: an inert «Понятные» button, visible outside the hidden title, hint on tap')`, using the file's existing panel setup helpers.
  - The button exists only in `[data-section=youtube]`, and `button.closest('.ve-gw-section-title')` is `null`.
  - The row is `hidden` before the load resolves and visible after `ready`.
  - `aria-disabled` is `'true'`, and `title` equals the ru tooltip from Global Constraints (via `translate`).
  - A click shows the hint (`hidden === false`, its text equal to the tooltip), and a second click hides it.
  - Clicks make no extra loader or api call, and the list's item count is unchanged.
  - In the `empty` state the row stays hidden.
- [ ] **Step 2: Run the test and see it fail.** Run `npm run test:unit -- test/gateway-examples-panel.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Label ru `Понятные`, en `Understandable`. The ru hint is verbatim from Global Constraints; en: `Coming soon: adds on top videos you can understand, picked like the recommendations for the "understand spoken English" skill, from your latest steps and known words, with this word or phrase`.
  - Style it as a small low-emphasis pill with `cursor: help` and reduced opacity. The hint is small muted text under the row.
- [ ] **Step 4: Run the tests and see them pass.** Run `npm run test:unit -- test/gateway-examples-panel.test.js && npm run test:css && npm run test:ts && npm run test:js`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(examples): «Понятные» placeholder button in the YouTube examples`.

### Task 7: Full verification, live check, audit, PR

**Files:**

- Modify: the scratchpad harness `enrich/enrich.mjs` (not in the repo). Add env `CARDS=off|reverse-off|phrases-off`, which sets the options via `modifySettings`, and `NOKEY=1`, which skips the key fields.

- [ ] **Step 1: Run the full suite.** Run `npm run test:fast`, the unit dev loop from Global Constraints, `npm run test:html && npm run test:css && npm run test:unit:options && npm run test:build`. Expected: everything passes. Record the test counts.
- [ ] **Step 2: Live check against the test Anki** (harness via the logging proxy 192.168.122.1:18777 → 127.0.0.1:8765):
  - (a) `CARDS=off`: the status is `✓ Примеры и синонимы · озвучка`, no ReverseDeck/Phrases are added, and the gateway log shows one chat call.
  - (b) `CARDS=phrases-off`: only ReverseDeck is added, and the gateway log has no phrases chat.
  - (c) `NOKEY=1`: the no-key line plus the key help; the base note has NO `flib_enriched` tag.
  - (d) Settings: both toggles are on by default and hidden when «Обогащать» is off. Screenshot both states.
  - (e) The «Понятные» button is visible on the YouTube tab, and a click shows the hint. Screenshot it.
  - (f) Export the settings, then import them back: no error.
  - Delete the harness notes afterwards with `deleteNotes` on the ids it logged. The owner allowed this on the test Anki.
- [ ] **Step 3: Adversarial audit (P8 step 5).** Spawn a fresh agent with the spec, the plan and `git diff main...HEAD`. It may NOT edit code. Ask it to verify STRICTLY, and to rate each point CRIT/HIGH/MED/LOW/OK:
  - (1) a toggle switched off can never come back on through any `flibService` write site, and import validates. It must grep every write site;
  - (2) a disabled card is never `failed` and makes zero calls;
  - (3) no-key never tags the note and never calls `flibEnrichNote`, and shows no line in the core route;
  - (4) the popup's flags come from the popup's own options;
  - (5) `cleanModelText` is untouched.
    Fix HIGH and CRIT findings inline; add MED findings to the PR description.
- [ ] **Step 4: Open the PR.** Push the branch and run `gh pr create -R xxxvita/yomitan_anki_conf` with the title `0.5.2: card toggles, no-key hint, «Понятные» placeholder, settings import fix`. The body covers the root cause of the owner's 0.5.1 report, the import bug (broken in 0.5.1), the changes, the audit verdicts, the live-check results and the deferred MED findings.

### Task 8: Release 0.5.2 (gate: owner OK)

- [ ] **Step 1: Ask the owner before merging and tagging.** Both are outward-facing: R2 and a GitHub release.
- [ ] **Step 2: Merge and tag.** Merge the PR with a merge commit, then put tag `v0.5.2` on the merge commit. Its message must not contain `[skip ci]`. Find the `release.yml` run by `headBranch == v0.5.2` and wait for success.
- [ ] **Step 3: Collect the store files.** Put them in `/home/xxxvita/Downloads/flib-club-0.5.2/`:
  - `yomitan-chrome.zip` and `yomitan-firefox.zip` (version 0.5.2.0) from the release;
  - `flib-club-0.5.2-source.zip` via `git archive v0.5.2`;
  - an unpacked `chrome-unpacked/`.
    Verify the manifest versions.
- [ ] **Step 4: Tell the owner.** Loading the unpacked build from a NEW folder gives a new extension id, so the key must be re-entered (this is what broke the 0.5.1 test); replacing the files in the SAME folder and pressing "Reload" keeps it. Remind them of the §1.1 dashboard edits.
