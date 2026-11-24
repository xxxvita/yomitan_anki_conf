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

// Names like these were run with Anki's own search engine (26.05): each query finds the notes of exactly that deck (with
// its subdecks) and note type, though the collection has decks and types that the unescaped names match too.
describe('AnkiConnect.findNotesInDeck', () => {
    test.each(/** @type {[string, string, string][]} */ ([
        ['Flibooster', 'Yomitan Card Type', '"deck:Flibooster" "note:Yomitan Card Type" nid:5,6'],
        ['Моя колода', 'Тип Ёж', '"deck:Моя колода" "note:Тип Ёж" nid:5,6'],
        ['A::B c::D', 'x::y', '"deck:A::B c::D" "note:x::y" nid:5,6'],
        ['co:lon', 'a:b', '"deck:co:lon" "note:a:b" nid:5,6'],
        ['a "q" b', '"', String.raw`"deck:a \"q\" b" "note:\"" nid:5,6`],
        ['back\\slash\\', '\\', String.raw`"deck:back\\slash\\" "note:\\" nid:5,6`],
        ['st*r', '*', String.raw`"deck:st\*r" "note:\*" nid:5,6`],
        ['under_score', '_*', String.raw`"deck:under\_score" "note:\_\*" nid:5,6`],
        ['\\"*_:', '\\_', String.raw`"deck:\\\"\*\_:" "note:\\\_" nid:5,6`],
        ['a and (b) -c', 're:x', '"deck:a and (b) -c" "note:re:x" nid:5,6'],
        // ⚠️ To Anki `deck:current` is the selected deck and `deck:filtered` every filtered one, whatever their names.
        ['current', 'current', '"deck:CURRENT" "note:current" nid:5,6'],
        ['filtered', 'filtered', '"deck:FILTERED" "note:filtered" nid:5,6'],
        ['Current', 'x', '"deck:Current" "note:x" nid:5,6'],
        ['current::sub', 'x', '"deck:current::sub" "note:x" nid:5,6'],
    ]))('deck %s, type %s', async (deckName, modelName, query) => {
        results.findNotes = [6];
        expect(await makeAnki().findNotesInDeck([5, 6], deckName, modelName)).toStrictEqual([6]);
        expect(requests.filter(({action}) => action === 'findNotes').map(({params}) => params)).toStrictEqual([{query}]);
        // The version is asked once per server; no other call.
        expect(requests.map(({action}) => action)).toStrictEqual(['version', 'findNotes']);
    });

    test('one note', async () => {
        results.findNotes = [];
        expect(await makeAnki().findNotesInDeck([5], 'D', 'M')).toStrictEqual([]);
        expect(paramsOf('findNotes')).toStrictEqual({query: '"deck:D" "note:M" nid:5'});
    });

    test('no notes: Anki is not asked', async () => {
        expect(await makeAnki().findNotesInDeck([], 'D', 'M')).toStrictEqual([]);
        expect(requests).toStrictEqual([]);
    });

    test('AnkiConnect is off → an error, not «none»', async () => {
        const anki = makeAnki();
        anki.enabled = false;
        await expect(anki.findNotesInDeck([5], 'D', 'M')).rejects.toThrow('AnkiConnect not enabled');
        expect(requests).toStrictEqual([]);
    });

    test.each([[null], ['5'], [{5: true}], [['5']], [[5, null]], [{result: null, error: 'invalid search'}]])('the answer %j → an error', async (answer) => {
        results.findNotes = answer;
        await expect(makeAnki().findNotesInDeck([5], 'D', 'M')).rejects.toThrow(/./);
    });

    test('the duplicate check: its queries are as they were', async () => {
        results.multi = [[5]];
        /** @type {import('anki').Note} */
        const note = {deckName: 'a "q" _*\\', modelName: 'M', fields: {Front: 'x "y" _*\\'}, tags: [], options: {allowDuplicate: false, duplicateScope: 'deck', duplicateScopeOptions: {deckName: null, checkChildren: false, checkAllModels: false}}};
        await makeAnki().findNoteIds([note]);
        expect(paramsOf('multi')).toStrictEqual({actions: [{action: 'findNotes', params: {query: '"deck:a q _*\\" "front:x y _*\\"'}}]});
    });
});
