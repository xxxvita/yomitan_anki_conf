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

import {describe, expect, test} from 'vitest';
import {createPhraseNoteFields} from '../ext/js/data/phrase-note-fields.js';

/**
 * @param {Record<string, string>} valueByName
 * @returns {import('settings').AnkiFields}
 */
function makeFields(valueByName) {
    /** @type {import('settings').AnkiFields} */
    const fields = {};
    for (const [name, value] of Object.entries(valueByName)) {
        fields[name] = {value, overwriteMode: 'coalesce'};
    }
    return fields;
}

describe('createPhraseNoteFields', () => {
    test('expression-family markers receive the phrase text', () => {
        const fields = makeFields({Front: '{expression}', Word: '{word}', Phrase: '{phrase}', Term: '{term}'});
        expect(createPhraseNoteFields(fields, 'hello', 'привет')).toEqual({
            Front: 'hello', Word: 'hello', Phrase: 'hello', Term: 'hello',
        });
    });
    test('Translate field name receives the translate text', () => {
        const fields = makeFields({Translate: ''});
        expect(createPhraseNoteFields(fields, 'hello', 'привет')).toEqual({Translate: 'привет'});
    });
    test('{translate} marker receives the translate text', () => {
        const fields = makeFields({Back: '{translate}'});
        expect(createPhraseNoteFields(fields, 'hello', 'привет')).toEqual({Back: 'привет'});
    });
    test('unmapped fields are empty strings', () => {
        const fields = makeFields({Notes: '{audio}', Extra: 'static'});
        expect(createPhraseNoteFields(fields, 'hello', 'привет')).toEqual({Notes: '', Extra: ''});
    });
    test('empty fields object yields empty result', () => {
        expect(createPhraseNoteFields(makeFields({}), 'hello', 'привет')).toEqual({});
    });
});
