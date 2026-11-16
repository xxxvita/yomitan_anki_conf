# 0.5.2 Card Toggles, No-Key Hint, «Понятные» — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let users switch the ReverseDeck and Phrases cards off. Tell users why «+» did nothing more when they have no key. Show an inert «Понятные» placeholder button in the YouTube examples.

**Architecture:** Two new profile options (`flibService.createReverseCard`, `flibService.createPhrasesCard`, options v84). The popup reads them and passes them in the `flibEnrichNote` request; the enricher skips a disabled step before any network call. The popup decides between three cases (enrich, no-key hint, nothing) with a pure function in `flib-enrich-flow.js`. The placeholder button lives in the YouTube section of `gateway-examples-panel.js`.

**Tech Stack:** Plain ES modules with JSDoc + `checkJs`, vitest (+ jsdom where the existing tests use it), Playwright for the live check.

**Spec:** `docs/superpowers/specs/2026-11-16-card-toggles-key-hint-design.md`

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

1. **A user switched a toggle off, then restored a backup or migrated a key.** The toggle must stay off. Owned by Task 2: `carryFlibKeyIntoOptions` and the two blanking functions keep non-secret fields.
2. **Phrases off must spend no ChatGPT quota on phrases or find_form.** Owned by Task 3: assert that `chatJson` was called once (enrichment only).
3. **Two profiles with different toggles.** The popup must send ITS profile's flags, not the backend's. Owned by Task 4: `enrichCardsFromOptions` reads only the options object it is given; the request carries the flags.
4. **No key with Flibooster in the route.** The note must stay untagged so Flibooster can still enrich it. Owned by Task 4: `decideEnrichment(...) === 'no-key'` and no `markNoteForEnrichment`.
5. **`flibGatewayStatus` throws.** No hint line and no enrichment, and the save itself still succeeds. Owned by Task 4: `decideEnrichment` with `hasKey: null` returns `'none'`.

---

### Task 1: Options v84

**Files:**

- Modify: `ext/data/schemas/options-schema.json` (the `flibService` block near line 1409)
- Modify: `ext/js/data/options-util.js` (register `this._updateVersion84` after `_updateVersion83` at line 604; add the method after line ~2005)
- Modify: `ext/data/provisioning/default-options.json` (only if it carries a `flibService` block; add both fields `true` there)
- Modify: `types/ext/settings.d.ts` (`FlibServiceOptions`)
- Test: `test/options-util.test.js`

**Interfaces:**

- Produces: `FlibServiceOptions.createReverseCard: boolean` and `FlibServiceOptions.createPhrasesCard: boolean`, both with schema default `true` and listed under `required`.

- [ ] **Step 1: Update the expected full options and the version in the test.** In `test/options-util.test.js`, add `createReverseCard: true, createPhrasesCard: true` next to `enrichCards: true` (~line 628) and change `version: 83` (~line 720) to `84`. Then add:

```js
test('миграция 84: обе доп. карточки включены', async () => {
    const options = /* same v83 fixture construction as the migration-83 test at ~line 769 */;
    const service = /** @type {Partial<import('settings').FlibServiceOptions>} */ (options.profiles[0].options.flibService);
    delete service.createReverseCard;
    delete service.createPhrasesCard;
    service.enrichCards = false;
    const updated = await optionsUtil.update(options, 84);
    expect(updated.profiles[0].options.flibService).toMatchObject({createReverseCard: true, createPhrasesCard: true, enrichCards: false});
});
```

- [ ] **Step 2: Run the tests and see them fail.** Run `npm run test:unit -- test/options-util.test.js`. Expected: FAIL (the version is 83, and the fields are missing).
- [ ] **Step 3: Implement.** Add the schema properties (`"type": "boolean", "default": true`) and append both to `required`. Add `_updateVersion84(options)`, mirroring `_updateVersion83`: set both fields to `true` where `flibService` is an object. Its JSDoc says "Added flibService.createReverseCard / createPhrasesCard". Update `settings.d.ts` and default-options.
- [ ] **Step 4: Run the tests and see them pass.** Run `npm run test:unit -- test/options-util.test.js && npm run test:unit:options && npm run test:ts`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(options): v84 toggles for the ReverseDeck and Phrases cards`.

### Task 2: Overwrite sites keep non-secret flibService fields

**Files:**

- Modify: `ext/js/data/flib-secret-store.js`, functions `carryFlibKeyIntoOptions` (~line 308) and `blankFlibServiceInOptions` (~line 350)
- Modify: `ext/js/data/flib-secrets.js`, function `blankFlibServiceOnImport` (~line 97)
- Test: `test/flib-secret-store.test.js`, `test/flib-secrets.test.js`

**Interfaces:**

- Consumes: Task 1's field names.
- Produces: no new API. The three functions keep every key of an object-shaped `flibService` except that `personalKey` and `gatewayUrl` are overwritten. A non-object `flibService` still becomes exactly `{gatewayUrl: '', personalKey: ''}` (plus `personalKey: key` for carry).

- [ ] **Step 1: Write the failing tests.**
  - `test/flib-secret-store.test.js`, in `describe('blankFlibServiceInOptions')`: `test('toggles survive blanking (enrichCards/createReverseCard/createPhrasesCard false stay false)')`.
    - Input: a profile with `flibService: {gatewayUrl: 'https://x', personalKey: 'tpk_…32hex', enrichCards: false, createReverseCard: false, createPhrasesCard: false}`.
    - Expect the function to return `true` and `flibService` to `toStrictEqual({gatewayUrl: '', personalKey: '', enrichCards: false, createReverseCard: false, createPhrasesCard: false})`.
  - `test('carryFlibKeyIntoOptions keeps the toggles')`: the same input with blank secrets plus key `K`. Expect `{gatewayUrl: '', personalKey: K, enrichCards: false, createReverseCard: false, createPhrasesCard: false}`.
  - `test/flib-secrets.test.js`, in `describe('blankFlibServiceOnImport (C1)')`: `test('imported toggles are kept, secrets blanked')`. Input `{gatewayUrl: 'https://evil', personalKey: 'tpk_…', enrichCards: false, createPhrasesCard: false}`; expect `{gatewayUrl: '', personalKey: '', enrichCards: false, createPhrasesCard: false}`.
  - Keep the existing non-object test unchanged.
- [ ] **Step 2: Run the tests and see them fail.** Run `npm run test:unit -- test/flib-secret-store.test.js test/flib-secrets.test.js`. Expected: the 3 new tests FAIL (the fields are dropped).
- [ ] **Step 3: Implement.** For an object-shaped service use `{...service, gatewayUrl: '', personalKey: …}`; for a non-object, use the old blank shape. In `blankFlibServiceInOptions`, keep the "already blank → no change" early return.
- [ ] **Step 4: Run the tests and see them pass.** Run the same command plus `npm run test:unit -- test/flib-secrets-backend.test.js test/backup-controller.test.js`. Expected: PASS.
- [ ] **Step 5: Commit** with `fix(secrets): blanking the key no longer resets the card toggles`.

### Task 3: Enricher honours the card flags

**Files:**

- Modify: `ext/js/data/flib-enrich.js` (add `normalizeEnrichCards`)
- Modify: `ext/js/background/flib-card-enricher.js` (`enrich`, `_run` ctx, `_stepReverse`, `_stepPhrases`)
- Modify: `ext/js/background/backend.js` `_onApiFlibEnrichNote` (~line 1600)
- Modify: `ext/js/comm/api.js` `flibEnrichNote` (~line 574)
- Modify: `types/ext/api.d.ts` (the `flibEnrichNote` params), `types/ext/flib-gateway.d.ts` (`EnrichRequest`, new `EnrichCards`)
- Test: `test/flib-card-enricher.test.js`, `test/flib-enrich-backend.test.js`, `test/flib-enrich.test.js`

**Interfaces:**

- Produces:

  - `type EnrichCards = {reverse: boolean, phrases: boolean}` in `flib-gateway.d.ts`.
  - `EnrichRequest = {noteId: number, userTags: string[], cards?: Partial<EnrichCards>}`.
  - `normalizeEnrichCards(cards: unknown): EnrichCards` in `flib-enrich.js`.
  - `API.flibEnrichNote(noteId: number, userTags: string[], cards: EnrichCards)`.
  - API params `{noteId, userTags, cards?}`.

- [ ] **Step 1: Write the failing tests.**
  - `test/flib-enrich.test.js`: `test('normalizeEnrichCards: only an exact false turns a card off')`. Assert `normalizeEnrichCards(undefined)`, `(null)`, `({})` and `({reverse: 'no', phrases: 0})` are each `{reverse: true, phrases: true}`; `({reverse: false})` is `{reverse: false, phrases: true}`; `({reverse: false, phrases: false})` is both false.
  - `test/flib-card-enricher.test.js`:
    - `test('both cards off: base enriched, no derived notes, one chat call')`. Call `enrich({noteId: 100, userTags: [], cards: {reverse: false, phrases: false}})`.
      - The report is `{enrich: done, audio: done, reverse: skipped, phrases: skipped, speechCode: null}`.
      - `derived(anki, 'ReverseDeck')` and `derived(anki, 'Phrases')` are empty.
      - `gateway.chatJson` was called exactly once.
      - `anki.findNotes` was never called with a `_reverse` or `_phrases` query.
      - The base note keeps `flib_enriched`.
    - `test('reverse off only: Phrases created, no reverse link, no Audio_Translate')`.
    - `test('phrases off only: ReverseDeck created, no phrases/find_form chat call')`.
  - `test/flib-enrich-backend.test.js`: extend `'delegates with the note id and user tags'` (or add a sibling) so that `cards: {reverse: false}` reaches `enrich` as `{reverse: false, phrases: true}`.
- [ ] **Step 2: Run the tests and see them fail.** Run `npm run test:unit -- test/flib-enrich.test.js test/flib-card-enricher.test.js test/flib-enrich-backend.test.js`. Expected: the new tests FAIL.
- [ ] **Step 3: Implement.**
  - `enrich({noteId, userTags, cards})` normalizes the flags once and puts them in `ctx.cards`.
  - `_stepReverse` and `_stepPhrases` return `'skipped'` as their FIRST statement when their flag is off, before the `setupCode` check, `_linkExists` and any chat call.
  - The backend passes `cards` through. The `api.js` method sends `{noteId, userTags, cards}`.
  - The `_inFlight` key stays `noteId`.
- [ ] **Step 4: Run the tests and see them pass.** Run the same command plus `npm run test:ts`. Expected: PASS, and the existing enricher tests are unchanged (no `cards` means everything on).
- [ ] **Step 5: Commit** with `feat(enrich): skip ReverseDeck/Phrases when their toggle is off`.

### Task 4: Popup sends the flags and shows the no-key hint

**Files:**

- Modify: `ext/js/display/flib-enrich-flow.js` (add `decideEnrichment`, `enrichCardsFromOptions`; `startEnrichment` takes `cards`)
- Modify: `ext/js/display/flib-enrich-status.js` (add `renderNoKeyStatus`)
- Modify: `ext/js/display/display-anki.js` (`_shouldEnrichNote` ~line 2496 becomes the decision; the new-note branch ~line 2994; `_startEnrichment` ~line 2513; render site `_renderEnrichStatus`)
- Modify: `ext/js/i18n/messages-ru.js`, `messages-en.js` (`enrich.noKey`)
- Test: `test/flib-enrich-flow.test.js`, `test/flib-enrich-status.test.js`

**Interfaces:**

- Consumes: `EnrichCards` and `API.flibEnrichNote(noteId, userTags, cards)` from Task 3.
- Produces:

  - `decideEnrichment(note: import('anki').Note, {enrichCards: boolean, hasKey: ?boolean}): 'enrich'|'no-key'|'none'`. `hasKey === null` means the status call failed.
  - `enrichCardsFromOptions(flibService: unknown): EnrichCards`, which reuses `normalizeEnrichCards` with `{reverse: s.createReverseCard, phrases: s.createPhrasesCard}`.
  - `startEnrichment({api, noteId, tags, cards, isCurrent, render})`.
  - `renderNoKeyStatus(api: API, onSaved: () => void): HTMLElement`: a `.fc-enrich-status[data-state=warn]` holding the `enrich.noKey` line plus `createFlibKeyHelp({api, variant: 'need', onSaved})`.
  - The existing `shouldEnrichNote` is replaced by `decideEnrichment`. Update its tests and its single caller.

- [ ] **Step 1: Write the failing tests.**
  - `test/flib-enrich-flow.test.js`:
    - `test('decideEnrichment: enrich / no-key / none')`. The table: option off → `'none'`; another model → `'none'`; `hasKey: true` → `'enrich'`; `hasKey: false` → `'no-key'`; `hasKey: null` → `'none'`; model name case- and space-insensitive (`' yomitan card type '` → `'enrich'`).
    - `test('enrichCardsFromOptions reads only the given options')`. `{createReverseCard: false, createPhrasesCard: true}` → `{reverse: false, phrases: true}`; `undefined` → both true.
    - Extend `'renders pending, then the report…'` to assert `api.flibEnrichNote` was called with `(noteId, userTagsWithoutMarker, {reverse: false, phrases: true})`.
  - `test/flib-enrich-status.test.js`: `test('no-key status: warn line with the text and the key help')`. Expect `data-state` to be `warn`, the text to contain `translate('enrich.noKey')`, and a `.fc-xp-help` child.
- [ ] **Step 2: Run the tests and see them fail.** Run `npm run test:unit -- test/flib-enrich-flow.test.js test/flib-enrich-status.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - `display-anki`'s new-note branch:
    - Get `hasKey` from `flibGatewayStatus()`; on a throw, use `null`.
    - Call `decideEnrichment`.
    - Mark the note only for `'enrich'`.
    - After a successful add:
      - `'enrich'` → `_startEnrichment(entry, id, tags, enrichCardsFromOptions(options.flibService))`;
      - `'no-key'` → render `renderNoKeyStatus` at the same anchor `_renderEnrichStatus` uses. On `onSaved`, remove the line (no re-enrichment).
  - The flags come from `this._display.getOptions()` at click time.
  - Add `enrich.noKey` to both message files. The ru text is from Global Constraints; en: `No examples or extra cards: the personal key is missing or invalid`.
- [ ] **Step 4: Run the tests and see them pass.** Run the same command plus `npm run test:unit -- test/display-anki-flib-media.test.js && npm run test:ts && npm run test:js`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(enrich): send the card toggles; explain a skipped enrichment without a key`.

### Task 5: Settings toggles

**Files:**

- Modify: `ext/settings.html` (after the `flibService.enrichCards` row, ~line 1903)
- Modify: `ext/js/i18n/messages-ru.js`, `messages-en.js`
- Test: `npm run test:html`, `npm run test:css`; plus a jsdom test only if `test/flib-service-controller.test.js` already loads settings.html rows (otherwise the html validator and the live check cover it).

**Interfaces:**

- Consumes: the Task 1 option paths `flibService.createReverseCard` and `flibService.createPhrasesCard`.

- [ ] **Step 1: Add two `settings-item` rows,** copying the enrichCards row markup. Use `data-setting="flibService.createReverseCard"` / `"flibService.createPhrasesCard"` and the i18n keys `settings.createReverseCard`, `settings.createReverseCardHint`, `settings.createPhrasesCard`, `settings.createPhrasesCardHint`.
  - ru labels: `Обратная карточка (русский → английский)`, `Карточка-фраза с пропуском`.
  - ru hints: `Отдельная карточка ReverseDeck: по переводу вспомнить английское слово. Работает при включённом обогащении.` and `Отдельная карточка Phrases: живая фраза со словом, слово пропущено. Тратит ещё один запрос к ChatGPT. Работает при включённом обогащении.`
  - New `settings.enrichCardsHint`: `При «+» в Anki добавляются примеры, синонимы и озвучка, а также доп. карточки, включённые ниже. Тратит квоту личного ключа. Без галочки в Anki идёт только словарь.`
  - Matching en texts.
  - If `settings.html` already has a dependent-row pattern for a parent toggle (grep `data-parent` / `data-depends` / `data-hide-for`), use it with the parent `flibService.enrichCards`; otherwise rely on the hint text.
- [ ] **Step 2: Verify.** Run `npm run test:html && npm run test:css && npm run test:js && npm run test:unit -- test/flib-service-controller.test.js`. Expected: PASS, and the i18n parity / ui-language guard tests (whichever the unit suite has) pass.
- [ ] **Step 3: Commit** with `feat(settings): ReverseDeck and Phrases card toggles`.

### Task 6: «Понятные» placeholder button

**Files:**

- Modify: `ext/js/display/gateway-examples-panel.js` (`_buildSection` ~line 653: YouTube only; `_setSection` ~line 678: visibility)
- Modify: the CSS file that styles `.ve-gw-section-title` (find it with grep), and `messages-ru.js` / `messages-en.js` (`video.understandable`, `video.understandableHint`)
- Test: `test/gateway-examples-panel.test.js`

**Interfaces:**

- Produces: `button.ve-gw-understandable` inside the YouTube section title row. It has:

  - `type="button"`, `aria-disabled="true"`;
  - `title` = `translate('video.understandableHint')`;
  - `aria-description` = the same text;
  - no click listener;
  - `hidden` unless the YouTube section state is `ready`.

- [ ] **Step 1: Write the failing test** `test('YouTube ready: an inert «Понятные» button with the tooltip; hidden while loading or empty')`, using the file's existing panel setup helpers.
  - The button exists only in `[data-section=youtube]`.
  - It is `hidden` before the load resolves and visible after `ready`.
  - `aria-disabled` is `'true'`; `title` equals `translate('video.understandableHint')`.
  - Clicking it makes no extra loader/api call and changes nothing in the list (the item count is unchanged).
  - In the `empty` state it stays hidden.
- [ ] **Step 2: Run the test and see it fail.** Run `npm run test:unit -- test/gateway-examples-panel.test.js`. Expected: FAIL.
- [ ] **Step 3: Implement.**
  - Label ru `Понятные`, en `Understandable`. The ru hint is verbatim from Global Constraints; en: `Coming soon: adds on top videos you can understand, picked like the recommendations for the "understand spoken English" skill, from your latest steps and known words, with this word or phrase`.
  - Style it as a small low-emphasis pill with a `cursor: help` and reduced opacity; it must not look clickable as a primary action.
- [ ] **Step 4: Run the tests and see them pass.** Run `npm run test:unit -- test/gateway-examples-panel.test.js && npm run test:css && npm run test:ts`. Expected: PASS.
- [ ] **Step 5: Commit** with `feat(examples): «Понятные» placeholder button in the YouTube examples`.

### Task 7: Full verification, live check, audit, PR

**Files:**

- Modify: the scratchpad harness `enrich/enrich.mjs` (not in the repo): env `CARDS=off|reverse-off|phrases-off` sets the options; env `NOKEY=1` skips the key fields.
- Modify: `PRIVACY.md` only if it states a version number that must read 0.5.2 (check; no content change is needed per the spec).

- [ ] **Step 1: Run the full suite.** Run `npm run test:fast` plus the unit dev loop from Global Constraints, then `npm run test:html && npm run test:css && npm run test:unit:options && npm run build -- --dry-run`. Expected: everything passes. Record the test counts.
- [ ] **Step 2: Live check against the test Anki** (harness via the logging proxy 192.168.122.1:18777 → 127.0.0.1:8765):
  - (a) `CARDS=off`: the status is `✓ Примеры и синонимы · озвучка`, no ReverseDeck/Phrases are added, and the gateway log has one chat call.
  - (b) `CARDS=phrases-off`: only ReverseDeck is added.
  - (c) `NOKEY=1`: the no-key line plus the key help; the base note has NO `flib_enriched` tag.
  - (d) The settings page shows both toggles on by default; screenshot it.
  - (e) The «Понятные» button is visible on the YouTube tab, and its tooltip text matches; screenshot it.
  - Delete the harness notes afterwards with `deleteNotes` on the ids it logged. The owner allowed this on the test Anki.
- [ ] **Step 3: Adversarial audit (P8 step 5).** Spawn a fresh agent with the spec, the plan and `git diff main...HEAD`. It may NOT edit code. Ask it to verify STRICTLY, and to rate each point CRIT/HIGH/MED/LOW/OK:
  - (1) a toggle switched off can never come back on through any `flibService` write site. It must grep every write site, not trust the spec table;
  - (2) phrases off makes zero phrases/find_form calls;
  - (3) no-key never tags the note and never calls `flibEnrichNote`;
  - (4) the popup's flags come from the popup's own options;
  - (5) `cleanModelText` is untouched.
    Fix HIGH and CRIT findings inline; add MED findings to the PR description.
- [ ] **Step 4: Open the PR.** Push the branch and run `gh pr create -R xxxvita/yomitan_anki_conf` with the title `0.5.2: card toggles, no-key hint, «Понятные» placeholder`. The body covers the root cause of the owner's 0.5.1 report, the three changes, the audit verdicts, the live-check results and the deferred MED findings.

### Task 8: Release 0.5.2 (gate: owner OK)

- [ ] **Step 1: Ask the owner before merging and tagging.** Both are outward-facing: R2 and a GitHub release.
- [ ] **Step 2: Merge and tag.** Merge the PR with a merge commit, then put tag `v0.5.2` on the merge commit. Its message must not contain `[skip ci]`. Find the `release.yml` run by `headBranch == v0.5.2` and wait for success.
- [ ] **Step 3: Collect the store files.** Put them in `/home/xxxvita/Downloads/flib-club-0.5.2/`:
  - `yomitan-chrome.zip` and `yomitan-firefox.zip` (version 0.5.2.0) from the release;
  - `flib-club-0.5.2-source.zip` via `git archive v0.5.2`;
  - an unpacked `chrome-unpacked/`.
    Verify the manifest versions.
- [ ] **Step 4: Tell the owner.** Uploading the unpacked build as a NEW folder gives a new extension id again, so the key must be re-entered (this is what broke the 0.5.1 test); "Reload" on the existing unpacked entry keeps it. Remind them of the §1.1 dashboard edits.
