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
import {Backend} from '../ext/js/background/backend.js';
import {API} from '../ext/js/comm/api.js';
import {parseJson} from '../ext/js/core/json.js';

/* eslint-disable no-underscore-dangle, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */

/*
 * Anki is closed and started again, with the settings of everybody: `anki.server` is 8777, AnkiConnect is on 8765.
 */

const CORE = 'http://127.0.0.1:8777';
const DIRECT = 'http://127.0.0.1:8765';
const PAGE = {id: 'x', url: 'chrome-extension://x/popup.html'};
const DECK = 'Flibooster';
const FILE = readFileSync(new URL('../ext/data/flib-anki-models.json', import.meta.url), 'utf8');
const {models: MODELS} = /** @type {import('flib-anki-models').FlibAnkiModelsFile} */ (parseJson(FILE));
const MODEL = /** @type {import('flib-anki-models').FlibAnkiModel} */ (MODELS.find(({name}) => name === 'Phrases'));
const NAME = `flib-${'0'.repeat(64)}.webm`;

/** @type {boolean} */
let isOpen = true;
/** Core answers its health check; with Anki closed it answers 502 to our requests. */
let isCoreUp = false;
/** @type {Map<number, {modelName: string, fields: Record<string, string>}>} */
let notes = new Map();
/** @type {{server: string, action: string}[]} Requests of AnkiConnect that somebody received, without the probes. */
let sent = [];

/**
 * @param {string} action
 * @param {any} params
 * @returns {unknown}
 * @throws {Error}
 */
function run(action, params) {
    switch (action) {
        case 'version': return 6;
        case 'modelNames': return ['Phrases', 'ReverseDeck', 'Yomitan Card Type'];
        case 'modelFieldNames': return MODEL.fields;
        case 'modelTemplates': return Object.fromEntries(MODEL.cardTemplates.map(({Name, Front, Back}) => [Name, {Front, Back}]));
        case 'modelStyling': return {css: MODEL.css};
        case 'deckNames': return [DECK];
        case 'canAddNotesWithErrorDetail': return params.notes.map(() => ({canAdd: true}));
        case 'findNotes': return [...notes.keys()];
        case 'notesInfo': return params.notes.map((/** @type {number} */ noteId) => {
            const note = notes.get(noteId);
            return typeof note === 'undefined' ? {} : {noteId, modelName: note.modelName, tags: [], cards: [1], fields: Object.fromEntries(Object.entries(note.fields).map(([key, value]) => [key, {value, order: 0}]))};
        });
        case 'addNote': {
            const noteId = 1000 + notes.size;
            notes.set(noteId, {modelName: params.note.modelName, fields: {...params.note.fields}});
            return noteId;
        }
        case 'updateNoteFields':
            Object.assign(/** @type {{fields: object}} */ (notes.get(params.note.id)).fields, params.note.fields);
            return null;
        case 'storeMediaFile': return params.filename;
        default: throw new Error(`unsupported action ${action}`);
    }
}

/** @type {typeof fetch} */
const fakeFetch = async (input, init = {}) => {
    const url = /** @type {string} */ (input);
    if (url.endsWith('flib-anki-models.json')) { return new Response(FILE); }
    if (url.startsWith('https://') || url.startsWith('http://gateway')) {
        return url.includes('chat') ?
            new Response(JSON.stringify({choices: [{message: {content: '{"tr":"перевод"}'}}]}), {headers: {'Content-Type': 'application/json'}}) :
            new Response(new Uint8Array([1, 2, 3]));
    }
    const server = url.startsWith(CORE) ? CORE : DIRECT;
    if (server === CORE ? !isCoreUp : !isOpen) { throw new TypeError('Failed to fetch'); }
    if (init.method === 'GET') { return server === CORE ? new Response('{"status":"healthy","service":"core"}') : new Response('', {status: 404}); }
    const {action, params, version} = /** @type {any} */ (parseJson(/** @type {string} */ (init.body)));
    if (version <= 4) { sent.push({server, action}); }
    if (!isOpen) { return new Response('', {status: 502}); }
    const result = run(action, params);
    return new Response(JSON.stringify(version > 4 ? {result, error: null} : result));
};

/**
 * @param {string} [primary] `anki.server`
 * @returns {{api: API, backend: Backend}} As the options are applied; the first probe is going on.
 */
function startWorker(primary = CORE) {
    const backend = new Backend(/** @type {*} */ ({getUrl: (/** @type {string} */ path) => path}));
    vi.spyOn(backend, '_maybeBootstrapVideoExamplesField').mockResolvedValue(void 0);
    vi.spyOn(backend, '_getFlibSecrets').mockResolvedValue(/** @type {*} */ ({personalKey: `tpk_${'0'.repeat(32)}`, gatewayUrl: 'http://gateway.invalid'}));
    vi.spyOn(backend, '_getProfileOptions').mockReturnValue(/** @type {*} */ ({anki: {cardFormats: []}}));
    vi.spyOn(backend._flibGateway, 'translateSentence').mockResolvedValue({translation: 'перевод'});
    vi.spyOn(backend._flibGateway, 'synthesizeSpeech').mockResolvedValue({base64: 'QUJD', cached: false});
    backend._anki.enabled = true;
    backend._ankiRouteResolver.configure({primary, apiKey: null, enabled: true});
    backend._anki.server = primary;
    void backend._refreshAnkiRoute(true);
    const api = new API(/** @type {*} */ ({
        sendMessage: (/** @type {import('api').ApiMessageAny} */ message, /** @type {(response: unknown) => void} */ callback) => {
            if (!backend._onMessage(message, /** @type {*} */ (PAGE), callback)) { callback(void 0); }
        },
        getLastError: () => null,
    }));
    return {api, backend};
}

/**
 * @param {Promise<unknown>} promise
 * @returns {Promise<unknown>} What it answered, or the code of its error.
 */
async function outcome(promise) {
    try {
        return await promise;
    } catch (e) {
        const {data, message} = /** @type {{data?: {code?: string}, message: string}} */ (e);
        return data?.code ?? message;
    }
}

const FIELDS = {Front: 'I love it', EnglishWord: 'I love it', Expression: 'I love it', ExpressionTranslate: '', Audio_front: '', Audio_expression: '', flib_media: ''};
const CARD = {deckName: DECK, front: FIELDS.Front, englishWord: FIELDS.EnglishWord};

/**
 * «В Anki», as display-anki.js does it.
 * @param {API} api
 * @returns {Promise<string>}
 */
async function press(api) {
    return /** @type {string} */ (await outcome((async () => {
        const {server} = await api.flibPhrasePrepare();
        const {noteIds} = await api.flibPhraseFind({server, ...CARD});
        if (noteIds.length > 0) { return 'found'; }
        await api.flibStoreAnkiMedia(NAME, 'QUJD', true, server);
        await api.flibPhraseAdd({server, deckName: DECK, fields: FIELDS, tags: []});
        return 'saved';
    })()));
}

/**
 * The window looks for the notes, as display-anki.js does it.
 * @param {API} api
 * @returns {Promise<unknown>}
 */
async function look(api) {
    if (!await api.isAnkiConnected()) { return 'no Anki'; }
    let route = await api.getAnkiRoute();
    if (route.mode === 'none') { route = await api.getAnkiRoute(true); }
    return await outcome(api.flibPhraseFind({server: route.ankiServer, ...CARD}));
}

/**
 * @param {Backend} backend
 * @param {number} ms
 */
function wait(backend, ms) {
    const now = backend._ankiRouteResolver._now;
    backend._ankiRouteResolver._now = () => now() + ms;
}

beforeEach(() => {
    isOpen = true;
    isCoreUp = false;
    notes = new Map();
    sent = [];
    vi.stubGlobal('fetch', fakeFetch);
    vi.stubGlobal('chrome', {
        storage: {local: {get: async () => ({}), set: async () => {}}},
        runtime: {id: 'x', getURL: (/** @type {string} */ path) => `chrome-extension://x${path}`, getPlatformInfo: () => {}},
        offscreen: {},
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('a phrase', () => {
    test.each([['at once', 0], ['after the route cache expired', 33_000]])('Anki is closed with the window open and started again (%s): «anki_closed» until then, the first press after that saves', async (_name, ms) => {
        const {api, backend} = startWorker();
        expect(await look(api)).toStrictEqual({noteIds: []});
        isOpen = false;
        wait(backend, ms);
        expect(await press(api)).toBe('anki_closed');
        expect(await press(api)).toBe('anki_closed');
        wait(backend, ms);
        expect(await press(api)).toBe('anki_closed');
        isOpen = true;
        wait(backend, ms);
        expect(await press(api)).toBe('saved');
        expect(await press(api)).toBe('found');
        expect(notes.size).toBe(1);
    });

    test('also after a press that had prepared everything', async () => {
        const {api} = startWorker();
        expect(await press(api)).toBe('saved');
        notes.clear();
        isOpen = false;
        expect(await press(api)).toBe('anki_closed');
        isOpen = true;
        expect(await press(api)).toBe('saved');
    });

    test.each([['at once', 0], ['after the route cache expired', 33_000]])('the window looks for notes while Anki is closed (%s): it changes nothing', async (_name, ms) => {
        const {api, backend} = startWorker();
        expect(await press(api)).toBe('saved');
        isOpen = false;
        expect(await look(api)).toBe('no Anki');
        wait(backend, ms);
        expect(await api.getAnkiRoute()).toMatchObject({mode: 'none'});
        expect(await press(api)).toBe('anki_closed');
        isOpen = true;
        expect(await look(api)).toStrictEqual({noteIds: [1000]});
        notes.clear();
        expect(await press(api)).toBe('saved');
    });

    test('a worker that starts with Anki closed', async () => {
        isOpen = false;
        const {api} = startWorker();
        expect(await press(api)).toBe('anki_closed');
        expect(await look(api)).toBe('no Anki');
        isOpen = true;
        expect(await press(api)).toBe('saved');
    });

    test('a worker that starts with Anki closed, the window looks first', async () => {
        isOpen = false;
        const {api} = startWorker();
        expect(await look(api)).toBe('no Anki');
        isOpen = true;
        expect(await look(api)).toStrictEqual({noteIds: []});
        expect(await press(api)).toBe('saved');
    });

    test('a worker that starts during the pause', async () => {
        const {api} = startWorker();
        expect(await look(api)).toStrictEqual({noteIds: []});
        isOpen = false;
        expect(await press(api)).toBe('anki_closed');
        const next = startWorker();
        expect(await press(next.api)).toBe('anki_closed');
        isOpen = true;
        expect(await press(next.api)).toBe('saved');
    });

    test('with `anki.server` 8765 itself', async () => {
        const {api} = startWorker(DIRECT);
        expect(await press(api)).toBe('saved');
        notes.clear();
        isOpen = false;
        expect(await press(api)).toBe('anki_closed');
        isOpen = true;
        expect(await press(api)).toBe('saved');
    });

    /** @type {[name: string, call: (api: API, server: string) => Promise<unknown>][]} */
    const STEPS = [
        ['find', (api, server) => api.flibPhraseFind({server, ...CARD})],
        ['the field check', (api, server) => api.flibAnkiModelHasField('Phrases', 'flib_media', true, server)],
        ['media', (api, server) => api.flibStoreAnkiMedia(NAME, 'QUJD', true, server)],
        ['add', (api, server) => api.flibPhraseAdd({server, deckName: DECK, fields: FIELDS, tags: []})],
        ['update', (api, server) => api.flibPhraseUpdateMedia({server, noteId: 1000, deckName: DECK, html: 'x'})],
    ];

    test.each(STEPS)('Anki closes before %s of a press: «anki_closed», every time; opened again, the step goes on', async (_name, call) => {
        const {api, backend} = startWorker();
        vi.spyOn(backend, '_mergeFlibMedia').mockResolvedValue('x');
        notes.set(1000, {modelName: 'Phrases', fields: {...FIELDS}});
        const {server} = await api.flibPhrasePrepare();
        expect(server).toBe(DIRECT);
        isOpen = false;
        expect(await outcome(call(api, server))).toBe('anki_closed');
        expect(await outcome(call(api, server))).toBe('anki_closed');
        // Somebody else looks at the route meanwhile.
        await api.getAnkiRoute(true);
        expect(await outcome(call(api, server))).toBe('anki_closed');
        isOpen = true;
        expect(typeof await outcome(call(api, server))).not.toBe('string');
    });

    test('the same of the enrichment: its report', async () => {
        const {api} = startWorker();
        notes.set(1000, {modelName: 'Phrases', fields: {...FIELDS}});
        const {server} = await api.flibPhrasePrepare();
        const params = {server, noteId: 1000, expression: 'I love it', front: null, useCache: false};
        isOpen = false;
        for (let i = 0; i < 2; ++i) {
            expect(await api.flibPhraseEnrich(params)).toMatchObject({audio: {code: 'anki_closed'}, translation: {code: 'anki_closed'}});
        }
        isOpen = true;
        expect(await api.flibPhraseEnrich(params)).toMatchObject({audio: {status: 'done'}, translation: {status: 'done'}});
    });

    test('a real switch stays a switch: Core was started in the middle of a press', async () => {
        const {api} = startWorker();
        const {server} = await api.flibPhrasePrepare();
        isOpen = false;
        isCoreUp = true;
        expect(await outcome(api.flibPhraseFind({server, ...CARD}))).toBe('anki_route_switched');
        isOpen = true;
        expect(await outcome(api.flibPhraseAdd({server, deckName: DECK, fields: FIELDS, tags: []}))).toBe('anki_route_switched');
        expect(notes.size).toBe(0);
        expect(await press(api)).toBe('saved');
        expect(sent.at(-1)?.server).toBe(CORE);
    });

    test('a real switch: Core was stopped in the middle of a press', async () => {
        isCoreUp = true;
        const {api} = startWorker();
        const {server} = await api.flibPhrasePrepare();
        expect(server).toBe(CORE);
        isCoreUp = false;
        expect(await outcome(api.flibPhraseFind({server, ...CARD}))).toBe('anki_route_switched');
        expect(await press(api)).toBe('saved');
    });

    test('Core was stopped long ago: the press starts at the address that answers', async () => {
        isCoreUp = true;
        const {api, backend} = startWorker();
        expect(await press(api)).toBe('saved');
        notes.clear();
        isCoreUp = false;
        wait(backend, 33_000);
        expect(await press(api)).toBe('saved');
    });

    test('Core and Anki are closed, Core is started first, then Anki', async () => {
        const {api} = startWorker();
        expect(await press(api)).toBe('saved');
        notes.clear();
        isOpen = false;
        expect(await press(api)).toBe('anki_closed');
        isCoreUp = true;
        expect(await press(api)).toBe('anki_closed');
        isOpen = true;
        expect(await press(api)).toBe('saved');
        expect(sent.at(-1)?.server).toBe(CORE);
    });

    /** @type {[name: string, call: (api: API, server: string|undefined) => Promise<unknown>, action: string][]} */
    const MEDIA = [
        ['media', (api, server) => api.flibStoreAnkiMedia(NAME, 'QUJD', true, server), 'storeMediaFile'],
        ['the field check', (api, server) => api.flibAnkiModelHasField('Phrases', 'flib_media', true, server), 'modelFieldNames'],
    ];

    test.each(MEDIA)('%s with a server, in the middle of a press: a stale living route is not asked again', async (_name, call) => {
        const {api, backend} = startWorker();
        const {server} = await api.flibPhrasePrepare();
        wait(backend, 33_000);
        const refresh = vi.spyOn(backend, '_refreshAnkiRoute');
        await call(api, server);
        expect(refresh).not.toHaveBeenCalled();
    });

    test.each(MEDIA)('%s without a server starts fresh: Core was stopped long ago', async (_name, call, action) => {
        isCoreUp = true;
        const {api, backend} = startWorker();
        await api.flibPhrasePrepare();
        isCoreUp = false;
        wait(backend, 33_000);
        sent = [];
        expect(typeof await outcome(call(api, void 0))).not.toBe('string');
        expect(sent.at(-1)).toStrictEqual({server: DIRECT, action});
    });

    test('whoever answers after a closed Anki may have another collection: the type is looked at again', async () => {
        const {api} = startWorker();
        expect(await press(api)).toBe('saved');
        sent = [];
        expect(await press(api)).toBe('found');
        expect(sent.map(({action}) => action)).not.toContain('modelTemplates');
        // The window finds out that Anki is closed, no write fails.
        isOpen = false;
        expect(await look(api)).toBe('no Anki');
        isOpen = true;
        sent = [];
        expect(await press(api)).toBe('found');
        expect(sent.map(({action}) => action)).toContain('modelTemplates');
    });

    test('a known living route is not asked again in the middle of a press', async () => {
        const {api, backend} = startWorker();
        const {server} = await api.flibPhrasePrepare();
        wait(backend, 33_000);
        const refresh = vi.spyOn(backend, '_refreshAnkiRoute');
        await api.flibPhraseFind({server, ...CARD});
        await api.flibPhraseAdd({server, deckName: DECK, fields: FIELDS, tags: []});
        expect(refresh).not.toHaveBeenCalled();
    });
});

describe('a word', () => {
    /** @type {*} */
    const note = {modelName: 'Basic', deckName: DECK, fields: {Front: 'word'}, tags: [], options: {}};

    test('Anki is closed and started again: the connection failure, not a switch; the first «+» after that saves', async () => {
        const {api} = startWorker();
        expect(await api.addAnkiNote(note)).toBe(1000);
        isOpen = false;
        expect(await outcome(api.addAnkiNote(note))).toBe('Anki connection failure');
        expect(await outcome(api.addAnkiNote(note))).toBe('Anki connection failure');
        isOpen = true;
        expect(await api.addAnkiNote(note)).toBe(1001);
    });

    test('Core is started meanwhile: the next «+» goes to it, as before', async () => {
        const {api} = startWorker();
        expect(await api.addAnkiNote(note)).toBe(1000);
        isOpen = false;
        await outcome(api.addAnkiNote(note));
        isCoreUp = true;
        sent = [];
        expect(await outcome(api.addAnkiNote(note))).toBe('Anki connection error: 502');
        expect([...new Set(sent.map(({server}) => server))]).toStrictEqual([CORE]);
        isOpen = true;
        expect(await api.addAnkiNote(note)).toBe(1001);
        expect(sent.at(-1)).toStrictEqual({server: CORE, action: 'addNote'});
    });

    test('a living route is not asked again by «+»', async () => {
        const {api, backend} = startWorker();
        await api.addAnkiNote(note);
        const refresh = vi.spyOn(backend, '_refreshAnkiRoute');
        wait(backend, 33_000);
        await api.addAnkiNote(note);
        expect(refresh).not.toHaveBeenCalled();
    });
});
/* eslint-enable no-underscore-dangle, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
