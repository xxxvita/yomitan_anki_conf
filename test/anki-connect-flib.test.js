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

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {AnkiConnect} from '../ext/js/comm/anki-connect.js';
import {parseJson} from '../ext/js/core/json.js';

/** @type {Array<Record<string, unknown>>} */
let requests = [];
/** @type {Record<string, unknown>} */
let results = {};

beforeEach(() => {
    requests = [];
    results = {version: 6, createModel: {id: 1}, createDeck: 123, removeTags: null, addTags: null};
    vi.stubGlobal('fetch', /** @type {typeof fetch} */ (async (_input, init = {}) => {
        /** @type {Record<string, unknown>} */
        const body = parseJson(typeof init.body === 'string' ? init.body : '{}');
        requests.push(body);
        const action = /** @type {string} */ (body.action);
        // Клиент шлёт запрос без version: AnkiConnect отвечает голым результатом.
        return new Response(JSON.stringify(results[action] ?? null), {status: 200});
    }));
});
afterEach(() => { vi.unstubAllGlobals(); });

/** @returns {AnkiConnect} */
function makeAnki() {
    const anki = new AnkiConnect();
    anki.enabled = true;
    anki.server = 'http://127.0.0.1:8765';
    return anki;
}

/**
 * @param {string} action
 * @returns {Record<string, unknown>|undefined}
 */
function paramsOf(action) {
    return /** @type {Record<string, unknown>|undefined} */ (requests.find((r) => r.action === action)?.params);
}

describe('AnkiConnect Flib helpers', () => {
    test('createModel sends the AnkiConnect v6 parameters', async () => {
        await makeAnki().createModel({name: 'Phrases', fields: ['Front', 'Expression'], css: '/* ankimodels-rev:0123456789abcdef */\n.x{}', isCloze: false, cardTemplates: [{Name: 'Card 1', Front: '{{Front}}', Back: '{{Expression}}'}]});
        expect(paramsOf('createModel')).toStrictEqual({
            modelName: 'Phrases',
            inOrderFields: ['Front', 'Expression'],
            css: '/* ankimodels-rev:0123456789abcdef */\n.x{}',
            isCloze: false,
            cardTemplates: [{Name: 'Card 1', Front: '{{Front}}', Back: '{{Expression}}'}],
        });
    });

    test('createDeck returns the deck id', async () => {
        expect(await makeAnki().createDeck('Flibooster')).toBe(123);
        expect(paramsOf('createDeck')).toStrictEqual({deck: 'Flibooster'});
    });

    test('removeTags and addTags join tags with spaces', async () => {
        const anki = makeAnki();
        await anki.removeTags([5, 6], ['flib_enriched', 'x']);
        await anki.addTags([5], ['a']);
        expect(paramsOf('removeTags')).toStrictEqual({notes: [5, 6], tags: 'flib_enriched x'});
        expect(paramsOf('addTags')).toStrictEqual({notes: [5], tags: 'a'});
    });
});
