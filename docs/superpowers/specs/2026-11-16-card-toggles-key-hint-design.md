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
- `default-options.json` gets updated, and `types/ext/settings.d.ts` gets both fields.

### State enumeration (D2): every write site of `flibService`

| Site                                               | Today                             | Change                                                            |
| -------------------------------------------------- | --------------------------------- | ----------------------------------------------------------------- |
| `options-util.js:1913` (v79 adds the block)        | `{gatewayUrl:'', personalKey:''}` | none; v83/v84 run after it                                        |
| `flib-secret-store.js` `carryFlibKeyIntoOptions`   | replaces the whole object         | keep other fields: `{...service, gatewayUrl:'', personalKey:key}` |
| `flib-secret-store.js` `blankFlibServiceInOptions` | replaces the whole object         | keep other fields                                                 |
| `flib-secrets.js` `blankFlibServiceOnImport`       | replaces the whole object         | keep boolean fields from the file, blank the two secrets          |
| `flib-options-redaction.js:58`                     | `{...service, personalKey:''}`    | already keeps the fields                                          |
| settings UI `data-setting`                         | writes the one field              | new toggles use the same mechanism                                |

Each replaced object would drop `enrichCards` today. Schema defaults would then turn it back on, so the same would happen to the new toggles. That bug ships fixed in this release.

### Readers (D3)

- `createReverseCard` → display-anki builds the request → `FlibCardEnricher._stepReverse`.
- `createPhrasesCard` → display-anki → `FlibCardEnricher._stepPhrases`.

### API

`flibEnrichNote({noteId, userTags, cards?: {reverse?: boolean, phrases?: boolean}})`.

- A flag counts as off only when it is exactly `false`. A missing or malformed flag counts as on, the safe default matching 0.5.1.
- `api.d.ts` gets updated.

### Enricher

- `_stepReverse` and `_stepPhrases` return `'skipped'` FIRST when their flag is off, before `_linkExists` and before any LLM call. Phrases off therefore saves the phrases and find_form ChatGPT calls.
- The other steps are unchanged.
- The `flib_enriched` removal rule is unchanged.

### Settings UI

- Two `toggle` rows directly under «Обогащать карточки через ChatGPT», bound with `data-setting`.
- Labels and hints go in `messages-{ru,en}.js` (the ui-language guard). The enrichCards hint text changes: it no longer promises two cards unconditionally.
- Builder's call: grey the rows out when enrichCards is off, if the settings page has an existing dependent-setting pattern. Otherwise the hint says they work only with enrichment on.

### No-key hint

- In `display-anki` `_saveAnkiNote`, the new-note branch: when `enrichCards` is on, the model is «Yomitan Card Type» and `flibGatewayStatus().hasKey === false`, then after a successful add render a status line under «Сохранено в Anki».
  - Text: «Примеры и доп. карточки не созданы: нет личного ключа».
  - Under it: `createFlibKeyHelp({variant:'need'})`.
- No tag is added, so Flibooster may still enrich.
- A missing key and an invalid key share the 'need' help. The text says «ключа нет или он неверный», since `flibGatewayStatus` only returns `hasKey`.
- If `flibGatewayStatus` throws, show nothing.

### «Понятные» button

- In `gateway-examples-panel.js`, a `button.fc-btn` in the YouTube section, shown only while the section state is `ready`.
- Attributes: `aria-disabled="true"`, `title` = the tooltip text, with the same text available to screen readers. There is no click handler.
- It uses `aria-disabled` rather than `disabled` because a disabled button's tooltip does not show in every browser, and the tooltip is the point.
- Label and tooltip go in messages-ru/en.

## Edge cases (tests)

1. Both toggles off: only the base note is enriched. Status: «✓ Примеры и синонимы · озвучка». No phrases LLM call.
2. Only reverse off: Phrases is created, there is no `_reverse` link tag, and the status says «ещё 1 карточка».
3. A flag is missing or not a boolean in the request: treated as on.
4. Profile A has the toggles on, profile B has them off: each popup sends its own flags.
5. A toggle is changed while enrichment is running: the running enrichment keeps the click-time flags.
6. Old options (v83) migrate to v84 with both `true`; a v83 backup imports with both `true`.
7. `carryFlibKeyIntoOptions` / `blankFlibServiceInOptions` / import blanking keep `enrichCards:false` and the toggles at `false`.
8. No key: status line plus key help, no `flib_enriched` tag, no `flibEnrichNote` call.
9. `flibGatewayStatus` throws: no hint line and no crash.
10. Overwrite of an existing note: no hint and no enrichment (unchanged).
11. «Понятные»: present only in the ready state, the click does nothing, and the tooltip text matches verbatim.

## Release

All three changes ship as separate commits in 0.5.2, which replaces 0.5.1 for the stores. 0.5.1 stays tagged but is never uploaded. PRIVACY needs no change: no new data leaves the device.
