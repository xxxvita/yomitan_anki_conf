# 0.5.2: card-type toggles, no-key hint, «Понятные» button — design

Status: approved by the owner in conversation on 2026-11-16. Short design (three small changes, one release).

## Why

The owner's 0.5.1 test produced no ReverseDeck/Phrases cards. Root cause (verified): the fresh 0.5.1 install had no personal key, and the popup silently skipped enrichment. There was no tag, no status line and no hint. Every new store user would hit the same silent skip.

The owner also wants users to choose which extra cards they get. And they want a visible placeholder for the coming "understandable videos" search.

## Goals

1. **Toggles.** Two settings, on by default:
   - «Обратная карточка» → ReverseDeck;
   - «Карточка-фраза» → Phrases.
     A toggle that is off means that card is not created. The base note is still enriched: ExampleLLM, translation, audio.
2. **No-key hint.** After a successful «+» of a «Yomitan Card Type» note, when enrichment is on but there is no valid key, show a status line that says why nothing more happened, with the existing key help (bot link and key paste).
3. **«Понятные».** A small inert button in the YouTube examples section. Its tooltip, verbatim from the owner: «Скоро: добавит сверху ролики, которые вам понятны — подобранные, как в рекомендациях для развития навыка 'понимать английский на слух', по вашим последним шагам и знакомым словам, с этим словом или выражением».

## Non-goals and anti-goals

- **No logic behind «Понятные».** No request, prepend or dedup now. The endpoint contract is unknown (sync or job, which fields). Code written now would have no reader and would need rework.
- **No re-enrichment** of notes added earlier. Turning a toggle on does not backfill.
- **Note types:** do not stop installing ReverseDeck/Phrases when the toggles are off. They are needed the moment a toggle is turned on, and Flibooster installs them too.
- **Anti-goal:** a toggle the user switched off must never silently come back on (see the overwrite sites below).

## Approaches

- **Chosen: the popup passes the flags in the request**, as `api.flibEnrichNote(noteId, userTags, {reverse, phrases})`. Options are per profile, and the popup's options context can differ from the backend's "current" one. The popup knows exactly which profile added the note, and the flags are a snapshot taken at the click.
- **Rejected: the backend reads the current profile options.** That risks the wrong profile, and the value can change between the click and the step.

## Design

### Options

Options version 84 adds `flibService.createReverseCard: boolean` and `flibService.createPhrasesCard: boolean`.

- Schema default is `true`.
- `_updateVersion84` sets both to `true` in every profile that has a `flibService` object (same pattern as v83).
- `types/ext/settings.d.ts` gets both fields. `ext/data/provisioning/default-options.json` is NOT touched: it is v75, has no `flibService`, and `options-util.js:1899-1903` forbids duplicating defaults there.

### State enumeration (D2): every write site of `flibService`

Verified by the independent review of 2026-11-16 (it grepped every write site, not this table).

| Site                                                                                                                                          | Today                                                                                                                                                                      | Change                                                                                                                                 |
| --------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `options-util.js:1913` (`_updateVersion78` adds the block)                                                                                    | `{gatewayUrl:'', personalKey:''}`                                                                                                                                          | none; v83/v84 run after it                                                                                                             |
| `options-util.js:2001` v83, new v84                                                                                                           | force `true`                                                                                                                                                               | intended                                                                                                                               |
| `options-util.js:111` schema normalisation on load and import                                                                                 | fills defaults, strips unknown keys                                                                                                                                        | none                                                                                                                                   |
| `options-util.js:497-512` downgrade                                                                                                           | strips newer keys; the re-upgrade replays v84 → `true`                                                                                                                     | accepted (downgrade only)                                                                                                              |
| `flib-secret-store.js` `carryFlibKeyIntoOptions` (called from `backend.js:1339`)                                                              | replaces the whole object: `enrichCards` becomes undefined in memory, read as OFF by `display-anki.js:2497` until the worker restarts, then the schema default makes it ON | keep other fields: `{...service, gatewayUrl:'', personalKey:key}`                                                                      |
| `flib-secret-store.js` `blankFlibServiceInOptions` (`backend.js:1831`, `3666`)                                                                | same as carry                                                                                                                                                              | keep other fields                                                                                                                      |
| `flib-secrets.js` `blankFlibServiceOnImport` (`backup-controller.js:501`, AFTER `update()` at `:484`)                                         | replaces the whole object, so `setAllSettings` → `validate` (`backend.js:1333`) throws `Missing property enrichCards`: **settings import is broken since 0.5.0**           | keep an allow-list of booleans (`enrichCards`, `createReverseCard`, `createPhrasesCard`) when they are booleans, blank the two secrets |
| `flib-options-redaction.js:58`                                                                                                                | `{...service, personalKey:''}`                                                                                                                                             | already keeps the fields; redacted copies cannot be saved back (`backend.js:1262`, `1332`)                                             |
| `backend.js:1341` `setAllSettings`; profile copy/duplicate/reset (`profile-controller.js:153-217`); `dictionary-import-controller.js:795-811` | whole options written by the user's own action                                                                                                                             | none (user-intended)                                                                                                                   |
| settings UI `data-setting`                                                                                                                    | writes the one field                                                                                                                                                       | new toggles use the same mechanism                                                                                                     |

A non-object `flibService` still becomes `{gatewayUrl:'', personalKey:''}`. That shape is schema-invalid, but it is reachable only before `update()` normalises it.

### Readers (D3)

- `createReverseCard` → display-anki `_decideEnrichment` → request `cards.reverse` → `FlibCardEnricher._run`.
- `createPhrasesCard` → display-anki `_decideEnrichment` → request `cards.phrases` → `FlibCardEnricher._run`.

### API

`flibEnrichNote({noteId, userTags, cards?: {reverse?: boolean, phrases?: boolean}})`.

- A flag counts as off only when it is exactly `false`. A missing or malformed flag counts as on, the safe default matching 0.5.1.
- The backend normalises `cards` before handing it to the enricher.
- `types/ext/api.d.ts` already references `EnrichRequest`; only `types/ext/flib-gateway.d.ts` changes.

### Enricher

- `_run` calls `_step(ctx, 'reverse', …)` / `_step(ctx, 'phrases', …)` ONLY when the flag is on. The catch loop leaves disabled keys as `skipped`. A disabled card is therefore never reported `failed` (budget timeout or an early error), and it makes no `_linkExists` or LLM call. Phrases off saves the phrases and find_form ChatGPT calls.
- The other steps are unchanged.
- The `flib_enriched` removal rule is unchanged. Known LOW: with a card off, Flibooster may later create that card if the tag is released. Accepted.

### Settings UI

- Two `toggle` rows bound with `data-setting`, nested inside the enrichCards `.settings-item` as `div.settings-item-children.settings-item-children-group#flib-enrich-cards-options`. They are hidden while enrichCards is off via the existing `data-transform` `setVisibility` pattern (`settings.html:751-760`, `778-784`; `generic-setting-controller.js:299-306`).
- Labels and hints go in `messages-{ru,en}.js` (the ui-language guard). The enrichCards hint text changes: it no longer promises two cards unconditionally. The English fallback text in `settings.html` changes to match.

### No-key hint

- `display-anki` gets ONE decision method, `_decideEnrichment(note)` → `{action: 'enrich'|'no-key'|'none', cards}`.
  - It reads the options once, before the add.
  - It calls `flibGatewayStatus()` only when `enrichCards` is on and the model is «Yomitan Card Type» (today's short-circuit).
  - A throw gives `none`.
- **In the Flibooster route** (`this._ankiRoute?.mode === 'core'`), `no-key` becomes `none`: Flibooster enriches untagged notes itself, so «не созданы» would be false there.
- After a successful add with `no-key`, render under «Сохранено в Anki»:
  - a `.fc-enrich-status[data-state=warn]` whose `.fc-enrich-head` says «Примеры и доп. карточки не созданы: ключа нет или он неверный»;
  - under it, `createFlibKeyHelp({variant:'need'})`.
- No tag is added and `flibEnrichNote` is not called.
- A missing key and an invalid key share one text, since `flibGatewayStatus` only returns `hasKey`.

### «Понятные» button

- In `gateway-examples-panel.js`, a `button.fc-btn.ve-gw-understandable` in a new row `div.ve-gw-section-tools`. The row is a direct child of the YouTube section root, before the list. It is NOT in `.ve-gw-section-title`, which is `display:none` (`flib-card.css:1205`). The button is shown only while the section state is `ready`.
- Attributes: `aria-disabled="true"`, `title` = the tooltip text, and `aria-describedby` → a hint element with the same text.
  - The hint element is hidden by default and shown while the button has focus or after a tap/click; a second tap hides it. This is the only behaviour, it does NOT search. It exists because a `title`-only hint never shows on touch (Firefox Android, Kiwi) or for keyboard users.
  - Precedent: `display-translation.js:300-311`.
- It uses `aria-disabled` rather than `disabled` because a disabled button leaves the tab order and its tooltip does not show everywhere.
- Styles go in `ext/css/flib-card.css`. Label and tooltip go in messages-ru/en.

## Edge cases (tests)

1. Both toggles off: only the base note is enriched. Status: «✓ Примеры и синонимы · озвучка». No phrases LLM call.
2. Both toggles off and the budget is exhausted: reverse and phrases are still `skipped`, never `failed`.
3. Only reverse off: Phrases is created, there is no `_reverse` link tag, and the status says «ещё 1 карточка».
4. A flag is missing or not a boolean in the request: treated as on.
5. Profile A has the toggles on, profile B has them off: each popup sends its own flags.
6. A toggle is changed while enrichment is running: the running enrichment keeps the click-time flags.
7. Old options (v83) migrate to v84 with both `true`; a v83 backup imports with both `true`.
8. Import of a file with `enrichCards:false` passes `validate()` and keeps `false`; carry/blank results pass `validate()` and keep `false`.
9. No key, direct route: status line plus key help, no `flib_enriched` tag, no `flibEnrichNote` call. Covered in `_saveAnkiNote`, not only in pure functions.
10. No key, Flibooster route: no line, no tag.
11. `flibGatewayStatus` throws: no hint line, the save succeeds, and the add event is still recorded.
12. Overwrite of an existing note: no hint and no enrichment (unchanged).
13. «Понятные»: visible only in the ready state and not inside the hidden title row; the click does no search; the tooltip text matches verbatim; focus or tap reveals the hint.

## Release

All changes ship as separate commits in 0.5.2, which replaces 0.5.1 for the stores. 0.5.1 stays tagged but is never uploaded. 0.5.2 also fixes settings import (broken since 0.5.0); the PR and the owner must be told. PRIVACY needs no change: no new data leaves the device.
