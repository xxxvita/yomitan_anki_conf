/*
 * Copyright (C) 2026  Flib-club Authors (fork of Yomitan)
 * Copyright (C) 2023-2025  Yomitan Authors
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

import {readFileSync} from 'node:fs';
import {describe, expect, test} from 'vitest';
import {modelRevision, stampRevMarker, stripRevMarker} from '../dev/anki-models/revision.js';
import {FLIB_PRODUCT_DECK} from '../ext/js/data/flib-anki-models.js';
import {parseJson} from '../ext/js/core/json.js';

/**
 * @param {string} name
 * @returns {import('../dev/anki-models/revision.js').SourceModel}
 */
function source(name) {
    return /** @type {import('../dev/anki-models/revision.js').SourceModel} */ (parseJson(readFileSync(new URL(`../dev/data/anki-models/${name}.json`, import.meta.url), 'utf8')));
}

describe('modelRevision', () => {
    test.each([
        ['Yomitan Card Type', 'fc38edc91863cf3d'],
        ['ReverseDeck', 'eb902e8263b4dbcf'],
        ['Phrases', '242a8c70246f3a95'],
    ])('golden revision of %s matches the Go installer', (name, revision) => {
        expect(modelRevision(source(name))).toBe(revision);
    });

    test('a marker in the CSS does not change the revision', () => {
        const model = source('Phrases');
        expect(modelRevision({...model, css: stampRevMarker(model.css, '0123456789abcdef')})).toBe('242a8c70246f3a95');
    });
});

describe('stampRevMarker', () => {
    test('marker replaces, never stacks', () => {
        const once = stampRevMarker('a{}', '0123456789abcdef');
        const twice = stampRevMarker(once, 'fedcba9876543210');
        expect(twice).toBe('/* ankimodels-rev:fedcba9876543210 */\na{}');
        expect(stripRevMarker(twice)).toBe('a{}');
    });
});

describe('ext/data/flib-anki-models.json', () => {
    test('generated data matches sources', () => {
        const file = /** @type {import('flib-anki-models').FlibAnkiModelsFile} */ (parseJson(readFileSync(new URL('../ext/data/flib-anki-models.json', import.meta.url), 'utf8')));
        expect(FLIB_PRODUCT_DECK).toBe('Flibooster');
        expect(file.source).toBe('anki_conf b112f6648');
        expect(file.models.map(({name}) => name)).toStrictEqual(['Phrases', 'ReverseDeck', 'Yomitan Card Type']);
        for (const model of file.models) {
            const src = source(model.name);
            expect(model.fields).toStrictEqual(src.fields);
            expect(model.isCloze).toBe(false);
            expect(model.css).toBe(stampRevMarker(src.css, modelRevision(src)));
            expect(model.cardTemplates).toStrictEqual(Object.keys(src.templates).sort().map((templateName) => ({Name: templateName, Front: src.templates[templateName].Front, Back: src.templates[templateName].Back})));
        }
    });
});
