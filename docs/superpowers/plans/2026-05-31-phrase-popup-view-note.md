# Phrase popup: single add button + view-note state — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the phrase-entry popup, show exactly one action button (first term card format) that flips between an "add" state and a "view note in Anki" state — on open if the phrase already exists, and after a successful add — and resets to "add" when the Expression text is edited.

**Architecture:** Extract the phrase note-field mapping into a small pure module (`phrase-note-fields.js`) that is unit-tested. `DisplayAnki` builds a full phrase note via a new `_buildPhraseNote` helper, renders a single save button, and shares one state-transition helper (`_setPhraseButtonState`) across three call sites (on-open detection, after-add, on-edit reset). The view state reuses the existing `_updateViewNoteButton` machinery. A token guards the async on-open detection against stale popup content.

**Tech Stack:** Vanilla ES modules, JSDoc + TypeScript `checkJs`, Vitest. Spec: `docs/superpowers/specs/2026-05-31-phrase-popup-view-note-design.md`.

---

## File Structure

- **Create** `ext/js/data/phrase-note-fields.js` — pure `createPhraseNoteFields(fields, phraseText, translateText)` → `NoteFields`. Single responsibility: map a card format's fields to note field values.
- **Create** `test/phrase-note-fields.test.js` — unit tests for the pure mapper.
- **Modify** `ext/js/display/display-anki.js` — use the mapper, add `_buildPhraseNote`, `_setPhraseButtonState`, single-button rendering, on-open detection, after-add transform, on-edit reset, token guard + clear.

No template (`templates-display.html`) changes are needed: the existing `.note-actions-container`, `action-button-container-template`, and `note-action-button-view-note-template` are reused.

---

## Task 1: Pure phrase-field mapper (TDD)

**Files:**

- Create: `ext/js/data/phrase-note-fields.js`
- Test: `test/phrase-note-fields.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/phrase-note-fields.test.js`:

```javascript
/*
 * Copyright (C) 2024-2025  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

import { describe, expect, test } from "vitest";
import { createPhraseNoteFields } from "../ext/js/data/phrase-note-fields.js";

/**
 * @param {Record<string, string>} valueByName
 * @returns {import('settings').AnkiFields}
 */
function makeFields(valueByName) {
  /** @type {import('settings').AnkiFields} */
  const fields = {};
  for (const [name, value] of Object.entries(valueByName)) {
    fields[name] = { value, overwriteMode: "coalesce" };
  }
  return fields;
}

describe("createPhraseNoteFields", () => {
  test("expression-family markers receive the phrase text", () => {
    const fields = makeFields({
      Front: "{expression}",
      Word: "{word}",
      Phrase: "{phrase}",
      Term: "{term}",
    });
    expect(createPhraseNoteFields(fields, "hello", "привет")).toEqual({
      Front: "hello",
      Word: "hello",
      Phrase: "hello",
      Term: "hello",
    });
  });
  test("Translate field name receives the translate text", () => {
    const fields = makeFields({ Translate: "" });
    expect(createPhraseNoteFields(fields, "hello", "привет")).toEqual({
      Translate: "привет",
    });
  });
  test("{translate} marker receives the translate text", () => {
    const fields = makeFields({ Back: "{translate}" });
    expect(createPhraseNoteFields(fields, "hello", "привет")).toEqual({
      Back: "привет",
    });
  });
  test("unmapped fields are empty strings", () => {
    const fields = makeFields({ Notes: "{audio}", Extra: "static" });
    expect(createPhraseNoteFields(fields, "hello", "привет")).toEqual({
      Notes: "",
      Extra: "",
    });
  });
  test("empty fields object yields empty result", () => {
    expect(createPhraseNoteFields(makeFields({}), "hello", "привет")).toEqual(
      {},
    );
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run test/phrase-note-fields.test.js`
Expected: FAIL — cannot resolve `../ext/js/data/phrase-note-fields.js`.

- [ ] **Step 3: Write minimal implementation**

Create `ext/js/data/phrase-note-fields.js`:

```javascript
/*
 * Copyright (C) 2024-2025  Yomitan Authors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
 */

/**
 * Map a card format's fields to note field values for a phrase note. A field whose
 * value template references the expression family (`{expression}`/`{phrase}`/
 * `{term}`/`{word}`) gets the phrase text; a field literally named `Translate` or
 * whose template references `{translate}` gets the translate text; everything else
 * is left empty. Pure: no DOM, no options/instance state.
 * @param {import('settings').AnkiFields} fields
 * @param {string} phraseText
 * @param {string} translateText
 * @returns {import('anki').NoteFields}
 */
export function createPhraseNoteFields(fields, phraseText, translateText) {
  /** @type {import('anki').NoteFields} */
  const noteFields = {};
  for (const [fieldName, fieldSetting] of Object.entries(fields)) {
    const value = fieldSetting.value;
    if (
      value.includes("{expression}") ||
      value.includes("{phrase}") ||
      value.includes("{term}") ||
      value.includes("{word}")
    ) {
      noteFields[fieldName] = phraseText;
    } else if (fieldName === "Translate" || value.includes("{translate}")) {
      noteFields[fieldName] = translateText;
    } else {
      noteFields[fieldName] = "";
    }
  }
  return noteFields;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run test/phrase-note-fields.test.js`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add ext/js/data/phrase-note-fields.js test/phrase-note-fields.test.js
git commit -m "feat(phrase-popup): pure createPhraseNoteFields mapper + tests"
```

---

## Task 2: `_buildPhraseNote` helper; refactor `_savePhraseNote` to use it

**Files:**

- Modify: `ext/js/display/display-anki.js` (import; `_savePhraseNote` ~482-557; add `_buildPhraseNote`)

This is a behavior-preserving refactor: `_savePhraseNote` keeps doing exactly what it does today, but the note is built by the new helper (which uses Task 1's mapper).

- [ ] **Step 1: Add the import**

At the top of `ext/js/display/display-anki.js`, next to the other `../data/` imports, add:

```javascript
import { createPhraseNoteFields } from "../data/phrase-note-fields.js";
```

(Place it alphabetically near `import {computeAutoTags} from '../data/url-tags.js';`.)

- [ ] **Step 2: Add `_buildPhraseNote` method**

Insert this method immediately before `_savePhraseNote` in `display-anki.js`:

```javascript
    /**
     * Build a phrase note from the chosen card format and the popup's text inputs.
     * Single source of the phrase-note shape, used both to add the note and to
     * detect a pre-existing duplicate on open.
     * @param {number} cardFormatIndex
     * @param {string} phraseText
     * @param {string} translateText
     * @returns {?import('anki').Note}
     */
    _buildPhraseNote(cardFormatIndex, phraseText, translateText) {
        const cardFormat = this._cardFormats[cardFormatIndex];
        if (!cardFormat) { return null; }
        const {deck: deckName, model: modelName, fields: fieldsSettings} = cardFormat;
        const noteFields = createPhraseNoteFields(fieldsSettings, phraseText, translateText);
        /** @type {import('anki').Note} */
        const note = {
            fields: noteFields,
            tags: [...this._noteTags],
            deckName,
            modelName,
            options: {
                allowDuplicate: true,
                duplicateScope: this._duplicateScope,
                duplicateScopeOptions: {
                    deckName: null,
                    checkChildren: false,
                    checkAllModels: this._duplicateScopeCheckAllModels,
                },
            },
        };
        return note;
    }
```

- [ ] **Step 3: Rewrite the body of `_savePhraseNote` to use `_buildPhraseNote`**

Replace the current note-building block in `_savePhraseNote` (from `const cardFormat = this._cardFormats[cardFormatIndex];` through the construction of the `note` object, i.e. the lines that compute `noteFields` and assemble `note`) with:

```javascript
const note = this._buildPhraseNote(cardFormatIndex, phraseText, translateText);
if (note === null) {
  return;
}
```

The remainder of `_savePhraseNote` (the `_applyExtraTagsToNote(note)` call, the progress-indicator override, the `addAnkiNote` call, error handling) stays unchanged in this task.

- [ ] **Step 4: Verify types, lint, and existing tests**

Run: `npm run test:fast`
Expected: PASS (eslint clean, tsc clean, all unit tests green including the new `phrase-note-fields` tests).

- [ ] **Step 5: Commit**

```bash
git add ext/js/display/display-anki.js
git commit -m "refactor(phrase-popup): build phrase note via _buildPhraseNote helper"
```

---

## Task 3: Render a single button (first term format only)

**Files:**

- Modify: `ext/js/display/display-anki.js` — `_updatePhraseEntryDetails` (~429-477)

Replace the per-format loop with a single first-term-format button. Keep the connection check.

- [ ] **Step 1: Rewrite `_updatePhraseEntryDetails`**

Replace the entire current `_updatePhraseEntryDetails` method with:

```javascript
    /** */
    async _updatePhraseEntryDetails() {
        if (!this._display.getOptions()?.anki.enable) { return; }

        const phraseText = this._display.query;
        if (!phraseText) { return; }

        const cardFormatIndex = this._cardFormats.findIndex((cardFormat) => cardFormat.type === 'term');
        if (cardFormatIndex < 0) { return; }
        const cardFormat = this._cardFormats[cardFormatIndex];

        const entry = this._getEntry(0);
        if (entry === null) { return; }

        const container = entry.querySelector('.note-actions-container');
        if (container === null) { return; }

        const singleNoteActionButtons = /** @type {HTMLElement} */ (this._display.displayGenerator.instantiateTemplate('action-button-container'));
        /** @type {HTMLButtonElement} */
        const saveButton = querySelectorNotNull(singleNoteActionButtons, '.action-button');
        /** @type {HTMLElement} */
        const iconSpan = querySelectorNotNull(saveButton, '.action-icon');

        singleNoteActionButtons.dataset.cardFormatIndex = cardFormatIndex.toString();
        saveButton.title = `Add phrase as ${cardFormat.name} note`;
        saveButton.dataset.cardFormatIndex = cardFormatIndex.toString();
        iconSpan.dataset.icon = cardFormat.icon;

        this._eventListeners.addEventListener(saveButton, 'click', (/** @type {Event} */ e) => {
            e.preventDefault();
            void this._savePhraseNote(cardFormatIndex);
        });

        container.appendChild(singleNoteActionButtons);

        let isConnected = false;
        try {
            isConnected = await this._display.application.api.isAnkiConnected();
        } catch (e) {
            isConnected = false;
        }

        if (!isConnected) {
            saveButton.disabled = true;
            saveButton.hidden = true;
        }
    }
```

- [ ] **Step 2: Verify types, lint, tests**

Run: `npm run test:fast`
Expected: PASS.

- [ ] **Step 3: Manual smoke check**

Load the unpacked extension (Chrome `chrome://extensions` → reload). On any page, select text → **Alt+Shift+A**. Expected: the phrase popup shows exactly **one** "+" button (was two).

- [ ] **Step 4: Commit**

```bash
git add ext/js/display/display-anki.js
git commit -m "feat(phrase-popup): render a single add button for the first term format"
```

---

## Task 4: State helper + after-add transform

**Files:**

- Modify: `ext/js/display/display-anki.js` — add `_setPhraseButtonState`; update `_savePhraseNote` success path.

- [ ] **Step 1: Add `_setPhraseButtonState`**

Insert this method immediately after `_buildPhraseNote`:

```javascript
    /**
     * Flip the phrase popup's single action slot between add ("+") and view-note.
     * Passing valid note ids → show the view-note button and hide "+";
     * passing null/empty → hide and clear the view-note button and show "+".
     * @param {number} cardFormatIndex
     * @param {?number[]} noteIds
     */
    _setPhraseButtonState(cardFormatIndex, noteIds) {
        const saveButton = this._saveButtonFind(0, cardFormatIndex);
        const validIds = Array.isArray(noteIds) ? noteIds.filter((id) => id !== INVALID_NOTE_ID) : [];
        if (validIds.length > 0) {
            this._updateViewNoteButton(0, cardFormatIndex, validIds);
            if (saveButton !== null) { saveButton.hidden = true; }
        } else {
            const entry = this._getEntry(0);
            const viewNoteButton = entry === null ?
                null :
                /** @type {HTMLButtonElement | null} */ (entry.querySelector(`[data-card-format-index="${cardFormatIndex}"] .action-button[data-action=view-note]`));
            if (viewNoteButton !== null) {
                viewNoteButton.dataset.noteIds = '';
                viewNoteButton.hidden = true;
            }
            if (saveButton !== null) { saveButton.hidden = false; }
        }
    }
```

- [ ] **Step 2: Capture the note id in `_savePhraseNote` and transform on success**

In `_savePhraseNote`, the current success path is:

```javascript
try {
  const noteId = await this._display.application.api.addAnkiNote(note);
  if (noteId === null) {
    allErrors.push(new Error("Note could not be added"));
  }
} catch (e) {
  allErrors.push(toError(e));
} finally {
  progressIndicatorVisible.clearOverride(overrideToken);
}
```

Replace it with:

```javascript
try {
  const noteId = await this._display.application.api.addAnkiNote(note);
  if (noteId === null) {
    allErrors.push(new Error("Note could not be added"));
  } else {
    this._setPhraseButtonState(cardFormatIndex, [noteId]);
  }
} catch (e) {
  allErrors.push(toError(e));
} finally {
  progressIndicatorVisible.clearOverride(overrideToken);
}
```

(`cardFormatIndex` is already a parameter of `_savePhraseNote`.)

- [ ] **Step 3: Verify types, lint, tests**

Run: `npm run test:fast`
Expected: PASS.

- [ ] **Step 4: Manual check**

Select text → Alt+Shift+A → click "+". Expected: note is added in Anki, the "+" disappears and a view-note (Anki) button appears; clicking it opens the note in Anki.

- [ ] **Step 5: Commit**

```bash
git add ext/js/display/display-anki.js
git commit -m "feat(phrase-popup): switch to view-note button after a successful add"
```

---

## Task 5: On-open duplicate detection with token guard

**Files:**

- Modify: `ext/js/display/display-anki.js` — constructor (add token field ~line 59), `_onContentClear` (~258), `_updatePhraseEntryDetails`.

- [ ] **Step 1: Add the token field to the constructor**

In the constructor, immediately after the line:

```javascript
/** @type {?import('core').TokenObject} */
this._updateDictionaryEntryDetailsToken = null;
```

add:

```javascript
/** @type {?import('core').TokenObject} */
this._updatePhraseEntryDetailsToken = null;
```

- [ ] **Step 2: Clear the token in `_onContentClear`**

In `_onContentClear`, after `this._updateDictionaryEntryDetailsToken = null;` add:

```javascript
this._updatePhraseEntryDetailsToken = null;
```

- [ ] **Step 3: Add detection to `_updatePhraseEntryDetails`**

In the method from Task 3, replace the connection block (from `let isConnected = false;` to the end of the method) with:

```javascript
/** @type {?import('core').TokenObject} */
const token = {};
this._updatePhraseEntryDetailsToken = token;

let isConnected = false;
try {
  isConnected = await this._display.application.api.isAnkiConnected();
} catch (e) {
  isConnected = false;
}
if (this._updatePhraseEntryDetailsToken !== token) {
  return;
}

if (!isConnected) {
  saveButton.disabled = true;
  saveButton.hidden = true;
  return;
}

const note = this._buildPhraseNote(cardFormatIndex, phraseText, "");
if (note === null || !isNoteDataValid(note)) {
  saveButton.disabled = true;
  return;
}

try {
  const infos = await this._display.application.api.getAnkiNoteInfo(
    [note],
    false,
  );
  if (this._updatePhraseEntryDetailsToken !== token) {
    return;
  }
  const noteIds = infos.length > 0 ? infos[0].noteIds : null;
  this._setPhraseButtonState(cardFormatIndex, noteIds);
} catch (e) {
  // Detection is best-effort; leave the button in its default add state.
}
```

(`isNoteDataValid` and `INVALID_NOTE_ID` are already imported at the top of the file.)

- [ ] **Step 4: Verify types, lint, tests**

Run: `npm run test:fast`
Expected: PASS.

- [ ] **Step 5: Manual check**

Add a phrase (e.g. "Signed Distance Functions") so it exists in Anki. Close the popup, re-select the same text → Alt+Shift+A. Expected: the popup opens directly in the view-note state (Anki button, no "+"). Select a never-added phrase → "+" shown.

- [ ] **Step 6: Commit**

```bash
git add ext/js/display/display-anki.js
git commit -m "feat(phrase-popup): detect existing note on open and start in view state"
```

---

## Task 6: Reset to "add" when Expression text is edited

**Files:**

- Modify: `ext/js/display/display-anki.js` — `_updatePhraseEntryDetails` (add input listener).

- [ ] **Step 1: Attach an input listener to the Expression textarea**

In `_updatePhraseEntryDetails`, immediately after `container.appendChild(singleNoteActionButtons);` (i.e. before the token/connection block), add:

```javascript
/** @type {HTMLTextAreaElement | null} */
const expressionInput = entry.querySelector(".phrase-expression-input");
if (expressionInput !== null) {
  this._eventListeners.addEventListener(expressionInput, "input", () => {
    this._setPhraseButtonState(cardFormatIndex, null);
  });
}
```

- [ ] **Step 2: Verify types, lint, tests**

Run: `npm run test:fast`
Expected: PASS.

- [ ] **Step 3: Manual check**

Open the popup on an already-added phrase (view state shown). Edit the Expression text. Expected: button reverts to "+". Clear edits / it stays "+" (no re-detection by design).

- [ ] **Step 4: Commit**

```bash
git add ext/js/display/display-anki.js
git commit -m "feat(phrase-popup): reset to add state when expression is edited"
```

---

## Task 7: Full verification

- [ ] **Step 1: Run the full fast pipeline**

Run: `npm run test:fast`
Expected: PASS (eslint, tsc on all jsconfigs, all unit tests, JSON format).

- [ ] **Step 2: Manual end-to-end matrix**

Reload the unpacked extension, then verify each row:

| Scenario                            | Expected                                    |
| ----------------------------------- | ------------------------------------------- |
| Select new phrase → Alt+Shift+A     | one "+" button                              |
| Click "+"                           | note added; button becomes view-note (Anki) |
| Click view-note                     | opens note in Anki                          |
| Re-open same (existing) phrase      | starts in view state                        |
| Open never-added phrase             | "+" shown                                   |
| Edit Expression while in view state | reverts to "+"                              |
| Anki bridge stopped → open popup    | button hidden, no console error             |
| Card format with empty deck/model   | "+" disabled                                |

- [ ] **Step 3: Final commit (if any cleanup)**

```bash
git add -A
git commit -m "test(phrase-popup): verify view-note state machine end-to-end"
```

---

## Notes for the implementer

- The phrase popup is the only entry in its display (`entry index 0`), so all `_updateViewNoteButton` / `_saveButtonFind` calls use index `0`.
- `_updateViewNoteButton` unions note ids with the button's existing `dataset.noteIds`; `_setPhraseButtonState` clears that dataset on reset so a later add starts fresh.
- Do not add LLM/translation — out of scope per the spec.
- Service-worker vs page reload: changes to `ext/js/display/**` reload on page reload; no service-worker reload needed for these files.
