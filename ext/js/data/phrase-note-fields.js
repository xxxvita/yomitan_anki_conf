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
            value.includes('{expression}') ||
            value.includes('{phrase}') ||
            value.includes('{term}') ||
            value.includes('{word}')
        ) {
            noteFields[fieldName] = phraseText;
        } else if (fieldName === 'Translate' || value.includes('{translate}')) {
            noteFields[fieldName] = translateText;
        } else {
            noteFields[fieldName] = '';
        }
    }
    return noteFields;
}
