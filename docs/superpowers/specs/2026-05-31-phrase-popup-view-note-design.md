# Phrase popup: single add button + view-note state

Date: 2026-05-31
Status: Approved (design)
Area: `ext/js/display/display-anki.js`, `ext/templates-display.html` (phrase-entry)

## Problem

The phrase-entry popup (opened with **Alt+Shift+A** on a text selection — action
`addPhraseToAnki` → `Frontend._showPhrasePopup`) currently has two UX defects:

1. **Two "+" buttons.** `DisplayAnki._updatePhraseEntryDetails` loops over every
   `cardFormat` whose `type === 'term'` and creates one action button per format.
   With two term formats configured the user sees two "+" buttons with differing
   tooltips (`Add phrase as <name> note`) and no clear meaning.
2. **The "+" never changes after adding.** `DisplayAnki._savePhraseNote` only calls
   `addAnkiNote` and shows/hides the error notification. Unlike the normal flow
   (`_addNewAnkiNote`), it does not capture the returned `noteId`, and never calls
   `_updateViewNoteButton` / `_updateSaveButtonForDuplicateBehavior`. So after a
   successful add the button stays a "+", giving no confirmation and no way to jump
   to the created note in Anki.

LLM translation is explicitly **out of scope**: translation happens downstream via
the bridge/Anki, the bottom `Translate` field stays a manual free-input.

## Goals

- Exactly **one** action button in the phrase popup, bound to the **first** term
  card format (lowest `cardFormatIndex` with `type === 'term'`).
- That single button has two states:
  - **add** — "+" icon; click adds the note.
  - **view** — Anki/view icon; click opens the note(s) in Anki (`viewNotes`).
- Transition `add → view` on **two** triggers:
  - **On open**: if the selected phrase already exists in Anki.
  - **After add**: once the user adds the note in this session.
- Transition `view → add` when the user **edits** the Expression text (the note
  identity changed, so the old link no longer applies).

## Non-goals

- No LLM / machine translation.
- No new settings or options-schema changes (reuse existing `cardFormats`).
- No change to the normal (dictionary) popup behavior.
- No debounced re-detection while typing — edit simply resets to `add`.

## Design

### Single button (was: one per term format)

In `_updatePhraseEntryDetails`, replace the per-format loop with a single lookup of
the first `cardFormat` with `type === 'term'`. If none exists, render no button
(nothing to add to). Create exactly one action button for that format, tagged with
its `cardFormatIndex` via `dataset.cardFormatIndex` (so the existing
`_saveButtonFind` / `_updateViewNoteButton` selectors keep working for entry 0).

### `_buildPhraseNote` (extract, DRY)

Extract the note-construction currently inside `_savePhraseNote` into:

```
_buildPhraseNote(cardFormatIndex, phraseText, translateText) -> import('anki').Note
```

It builds `noteFields` from `cardFormat.fields` (mapping `{expression}/{phrase}/
{term}/{word}` → phraseText, `Translate`/`{translate}` → translateText, else ""),
sets `deckName`/`modelName` from the format, and the existing duplicate options
(`allowDuplicate: true`). Both the save path and the on-open duplicate check call it,
guaranteeing the note shape used for detection matches the note that gets added.

### State machine — one visible button

Two underlying elements live in the same `.note-actions-container` slot
(`[data-card-format-index="N"]`), and exactly one is visible:

- the **save** button ("+") created in `_updatePhraseEntryDetails`;
- the **view-note** button created on demand by the existing
  `_createViewNoteButton` / `_updateViewNoteButton`.

`add → view`: show/refresh the view-note button via `_updateViewNoteButton(0,
cardFormatIndex, noteIds)`, then set `saveButton.hidden = true`. Visually one button.

`view → add`: hide/remove the view-note button, set `saveButton.hidden = false`.

A small private helper centralizes this, e.g. `_setPhraseButtonState(saveButton,
cardFormatIndex, noteIds | null)` so the three call sites (on-open, after-add,
on-edit) share one transition.

### On-open detection

After the button is created and `isAnkiConnected()` is true:

1. Build a note from the initial Expression text (selection) via `_buildPhraseNote`.
2. If the note is invalid (`isNoteDataValid` false → empty deck/model) → set the "+"
   `disabled = true` and stop (cannot add anyway). Mirrors the grey-"+" root cause.
3. Else call `api.getAnkiNoteInfo([note], false)`; read `noteIds` for index 0
   (backend's `partitionAddibleNotes` checks with `allowDuplicate:false`, so a
   matching first field yields ids). Filter out `INVALID_NOTE_ID`.
4. If valid ids exist → `add → view`. Otherwise stay in `add`.

### After-add

In `_savePhraseNote`, capture `noteId = await api.addAnkiNote(note)`. On success with
a non-null id → `add → view` with `[noteId]`. On `null`/throw → stay in `add`, show
the error notification (current behavior preserved).

### On-edit reset

Add an `input` listener on `.phrase-expression-input`. On input, if currently in
`view`, run `view → add`. (No re-detection; just reset so the button never points at
a note that no longer matches the edited text.)

### Concurrency / staleness guard

The on-open `getAnkiNoteInfo` is async and the popup content can change or close
before it resolves. Introduce a token (same pattern as
`_updateDictionaryEntryDetailsToken`), captured at the start of
`_updatePhraseEntryDetails` and re-checked before mutating the DOM. Clear it in
`_onContentClear`. Stale resolutions are dropped.

## Edge cases

| #   | Case                                | Behavior                                                              |
| --- | ----------------------------------- | --------------------------------------------------------------------- |
| 1   | Anki not connected                  | Hide the button (current behavior); skip detection, no console error. |
| 2   | No term card format                 | Render no button.                                                     |
| 3   | Invalid format (empty deck/model)   | Show "+" `disabled`.                                                  |
| 4   | Phrase already in Anki on open      | Start in `view`.                                                      |
| 5   | `addAnkiNote` returns null / throws | Stay in `add`, show error.                                            |
| 6   | Multiple matching notes             | view-note button shows the list + badge (existing machinery).         |
| 7   | Expression edited after view shown  | Reset to `add`.                                                       |
| 8   | Popup changed/closed mid-detection  | Token guard drops the stale update.                                   |

## Testing

- **Unit (vitest):** `_buildPhraseNote` field mapping — expression-family
  placeholders, `Translate` field, empty unmapped fields, deck/model propagation.
  This is the pure, isolatable unit; assert the produced `Note` shape.
- **Manual / integration:** the DOM state machine (add↔view, on-open detect, edit
  reset) is exercised against a live AnkiConnect; covered by manual verification
  since the phrase popup path has no existing automated DOM harness. Document the
  manual steps in the implementation plan.

## Files touched

- `ext/js/display/display-anki.js` — single-button creation, `_buildPhraseNote`,
  state helper, on-open detection, after-add transform, edit reset, token guard.
- Possibly `ext/templates-display.html` — only if the slot needs markup tweaks;
  preferred to reuse existing `.note-actions-container` + view-note template.
- Test file under `test/` for `_buildPhraseNote` (or exported helper).
