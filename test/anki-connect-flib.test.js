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
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {AnkiConnect} from '../ext/js/comm/anki-connect.js';
import {ExtensionError} from '../ext/js/core/extension-error.js';
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
        const result = results[action];
        const answer = typeof result === 'function' ? /** @type {unknown} */ (result(body.params)) : result;
        return new Response(JSON.stringify(answer ?? null), {status: 200});
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

    test('createModel sends nothing about the previous revisions', async () => {
        const {models} = /** @type {import('flib-anki-models').FlibAnkiModelsFile} */ (parseJson(readFileSync(new URL('../ext/data/flib-anki-models.json', import.meta.url), 'utf8')));
        const phrases = /** @type {import('flib-anki-models').FlibAnkiModel} */ (models.find(({name}) => name === 'Phrases'));
        expect(phrases.previous?.front).toHaveLength(2);
        await makeAnki().createModel(phrases);
        expect(paramsOf('createModel')).toStrictEqual({modelName: 'Phrases', inOrderFields: phrases.fields, css: phrases.css, isCloze: false, cardTemplates: phrases.cardTemplates});
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

describe('AnkiConnect note type templates and styling', () => {
    const SIDES = {Front: '{{Front}}', Back: '{{FrontSide}}<hr>{{Back}}'};

    test('modelTemplates: the wire and the result', async () => {
        results.modelTemplates = {'Card 1': {...SIDES, extra: 1}, 'Карточка 2': {Front: '', Back: ''}};
        expect(await makeAnki().modelTemplates('Phrases')).toStrictEqual({'Card 1': SIDES, 'Карточка 2': {Front: '', Back: ''}});
        expect(requests).toStrictEqual([
            {action: 'version', params: {}, version: 2},
            {action: 'modelTemplates', params: {modelName: 'Phrases'}, version: 2},
        ]);
    });

    test('modelTemplates: a template with any name is an own property of the result', async () => {
        results.modelTemplates = parseJson('{"__proto__": {"Front": "f", "Back": "b"}}');
        const templates = await makeAnki().modelTemplates('Phrases');
        expect(Object.keys(templates)).toStrictEqual(['__proto__']);
        expect(Object.getPrototypeOf(templates)).toBe(Object.prototype);
    });

    test.each(/** @type {unknown[][]} */ ([
        [null],
        ['x'],
        [5],
        [true],
        [[]],
        [[SIDES]],
        [{'Card 1': null}],
        [{'Card 1': 'x'}],
        [{'Card 1': [SIDES]}],
        [{'Card 1': {}}],
        [{'Card 1': {Front: 'f'}}],
        [{'Card 1': {Back: 'b'}}],
        [{'Card 1': {Front: 'f', Back: null}}],
        [{'Card 1': {Front: 1, Back: 'b'}}],
        [{'Card 1': SIDES, 'Card 2': null}],
        [{result: null, error: 'model was not found: Phrases'}],
    ]))('modelTemplates: the answer %j → an error', async (answer) => {
        results.modelTemplates = answer;
        await expect(makeAnki().modelTemplates('Phrases')).rejects.toThrow(ExtensionError);
    });

    test('modelStyling: the wire and the result', async () => {
        results.modelStyling = {css: '/* ankimodels-rev:0 */\n.card{}'};
        expect(await makeAnki().modelStyling('Phrases')).toBe('/* ankimodels-rev:0 */\n.card{}');
        expect(requests.slice(1)).toStrictEqual([{action: 'modelStyling', params: {modelName: 'Phrases'}, version: 2}]);
        results.modelStyling = {css: ''};
        expect(await makeAnki().modelStyling('Phrases')).toBe('');
    });

    test.each(/** @type {unknown[][]} */ ([
        [null],
        ['.card{}'],
        [5],
        [[]],
        [['.card{}']],
        [{}],
        [{css: null}],
        [{css: 5}],
        [{css: ['x']}],
        [{result: null, error: 'model was not found: Phrases'}],
    ]))('modelStyling: the answer %j → an error', async (answer) => {
        results.modelStyling = answer;
        await expect(makeAnki().modelStyling('Phrases')).rejects.toThrow(ExtensionError);
    });

    test('updateModelTemplates: the wire', async () => {
        await expect(makeAnki().updateModelTemplates('Phrases', {'Card 1': SIDES})).resolves.toBeUndefined();
        expect(requests.slice(1)).toStrictEqual([{action: 'updateModelTemplates', params: {model: {name: 'Phrases', templates: {'Card 1': SIDES}}}, version: 2}]);
    });

    test('updateModelStyling: the wire', async () => {
        await expect(makeAnki().updateModelStyling('Phrases', '.card{}')).resolves.toBeUndefined();
        expect(requests.slice(1)).toStrictEqual([{action: 'updateModelStyling', params: {model: {name: 'Phrases', css: '.card{}'}}, version: 2}]);
    });

    test.each(/** @type {unknown[][]} */ ([[true], [{}], [5], ['ok'], [[]], [{result: null, error: 'model was not found: Phrases'}]]))('the writes: the answer %j → an error', async (answer) => {
        results.updateModelTemplates = answer;
        results.updateModelStyling = answer;
        await expect(makeAnki().updateModelTemplates('Phrases', {'Card 1': SIDES})).rejects.toThrow(ExtensionError);
        await expect(makeAnki().updateModelStyling('Phrases', '')).rejects.toThrow(ExtensionError);
    });

    test.each(/** @type {[string, (anki: AnkiConnect) => Promise<unknown>][]} */ ([
        ['modelTemplates', (a) => a.modelTemplates('Phrases')],
        ['modelStyling', (a) => a.modelStyling('Phrases')],
        ['updateModelTemplates', (a) => a.updateModelTemplates('Phrases', {'Card 1': SIDES})],
        ['updateModelStyling', (a) => a.updateModelStyling('Phrases', '')],
    ]))('%s: AnkiConnect is off → an error, not an empty type or a write that did not happen', async (_name, call) => {
        const anki = makeAnki();
        anki.enabled = false;
        await expect(call(anki)).rejects.toThrow('AnkiConnect not enabled');
        expect(requests).toStrictEqual([]);
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

    const FULL = '"deck:D" "note:M" nid:5,6';
    const BARE = 'nid:5,6';
    /** @returns {unknown[]} The queries sent, in order. */
    const queriesSent = () => requests.filter(({action}) => action === 'findNotes').map(({params}) => /** @type {{query: string}} */ (params).query);

    test('one note', async () => {
        results.findNotes = [5];
        expect(await makeAnki().findNotesInDeck([5], 'D', 'M')).toStrictEqual([5]);
        expect(queriesSent()).toStrictEqual(['"deck:D" "note:M" nid:5']);
    });

    test('none of them, and Anki knows the notes → an empty list, the second question is the bare one', async () => {
        results.findNotes = (/** @type {{query: string}} */ {query}) => (query === BARE ? [5] : []);
        expect(await makeAnki().findNotesInDeck([5, 6], 'D', 'M')).toStrictEqual([]);
        expect(queriesSent()).toStrictEqual([FULL, BARE]);
        expect(requests.map(({action}) => action)).toStrictEqual(['version', 'findNotes', 'findNotes']);
    });

    test('the local store of Core: every query is a «field:value» it does not have → it cannot tell', async () => {
        results.findNotes = (/** @type {{query: string}} */ {query}) => {
            /** @type {Record<string, number[]>} */
            const fields = {Front: [5, 6]};
            return fields[query.slice(0, query.indexOf(':'))] ?? [];
        };
        await expect(makeAnki().findNotesInDeck([5, 6], 'D', 'M')).rejects.toThrow('cannot search');
        expect(queriesSent()).toStrictEqual([FULL, BARE]);
    });

    test.each([[null], ['5'], [['5']], [{result: null, error: 'boom'}]])('none of them, then the second answer is %j → an error, not «none»', async (answer) => {
        results.findNotes = (/** @type {{query: string}} */ {query}) => (query === BARE ? answer : []);
        await expect(makeAnki().findNotesInDeck([5, 6], 'D', 'M')).rejects.toThrow(/./);
        expect(queriesSent()).toStrictEqual([FULL, BARE]);
    });

    test('none of them, then the connection is lost → an error, not «none»', async () => {
        results.findNotes = (/** @type {{query: string}} */ {query}) => {
            if (query === BARE) { throw new TypeError('Failed to fetch'); }
            return [];
        };
        await expect(makeAnki().findNotesInDeck([5, 6], 'D', 'M')).rejects.toThrow('Anki connection failure');
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
