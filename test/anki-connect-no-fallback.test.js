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
import {ANKI_ROUTE_SWITCHED_CODE, AnkiRouteResolver} from '../ext/js/comm/anki-route.js';
import {ExtensionError} from '../ext/js/core/extension-error.js';
import {parseJson} from '../ext/js/core/json.js';

const CORE = 'http://127.0.0.1:8777';
const DIRECT = 'http://127.0.0.1:8765';
const JSON_ONLY = {'Content-Type': 'application/json'};
const NO_FALLBACK = {'Content-Type': 'application/json', 'X-Anki-No-Fallback': '1'};

/**
 * @typedef {object} Sent
 * @property {string} server
 * @property {string} action
 * @property {Record<string, unknown>} body
 * @property {RequestInit} init
 */

/** @type {Sent[]} */
let sent = [];
/**
 * Что отвечает сервер; undefined — обычный ответ AnkiConnect на это действие.
 * @type {(request: Sent) => (Response|Promise<Response>|undefined)}
 */
let answer = (_request) => void 0;

/** @type {Record<string, unknown>} */
const RESULTS = {
    version: 6,
    deckNames: ['Default'],
    modelNames: ['Phrases'],
    modelFieldNames: ['Front'],
    modelTemplates: {'Card 1': {Front: 'f', Back: 'b'}},
    modelStyling: {css: '.card{}'},
    addNote: 1,
    addNotes: [1],
    createModel: {id: 1},
    createDeck: 5,
    canAddNotes: [true],
    canAddNotesWithErrorDetail: [{canAdd: true}],
    notesInfo: [],
    cardsInfo: [],
    guiBrowse: [],
    storeMediaFile: 'x.webm',
    findNotes: [5],
    findCards: [5],
    multi: [[5]],
    suspend: true,
    apiReflect: {scopes: ['actions'], actions: ['addNote']},
};

/** @type {typeof fetch} */
const fakeFetch = async (input, init = {}) => {
    /** @type {Record<string, unknown>} */
    const body = parseJson(typeof init.body === 'string' ? init.body : '{}');
    /** @type {Sent} */
    const request = {server: /** @type {string} */ (input), action: /** @type {string} */ (body.action), body, init};
    sent.push(request);
    return (await answer(request)) ?? new Response(JSON.stringify(RESULTS[request.action] ?? null), {status: 200});
};

beforeEach(() => {
    sent = [];
    answer = () => void 0;
    vi.stubGlobal('fetch', fakeFetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

/**
 * @param {string} [server]
 * @returns {AnkiConnect}
 */
function makeAnki(server = CORE) {
    const anki = new AnkiConnect();
    anki.enabled = true;
    anki.server = server;
    return anki;
}

/** @returns {import('anki').Note} */
function note() {
    return {fields: {Front: 'x'}, tags: [], deckName: 'D', modelName: 'M', options: {allowDuplicate: true, duplicateScope: 'collection', duplicateScopeOptions: {deckName: null, checkChildren: false, checkAllModels: false}}};
}

/** @returns {Response} Core с заголовком, когда Anki закрыта. */
function badGateway() {
    return new Response('AnkiConnect error: dial tcp', {status: 502});
}

/**
 * @param {Promise<unknown>} promise
 * @returns {Promise<ExtensionError>}
 */
async function rejected(promise) {
    const e = await promise.then(() => null, (/** @type {unknown} */ error) => error);
    expect(e).toBeInstanceOf(ExtensionError);
    return /** @type {ExtensionError} */ (e);
}

/**
 * Каждый метод клиента, который ходит в сеть.
 * @type {Record<string, (anki: AnkiConnect) => Promise<unknown>>}
 */
const CALLS = {
    isConnected: (a) => a.isConnected(),
    getVersion: (a) => a.getVersion(),
    addNote: (a) => a.addNote(note()),
    addNotes: (a) => a.addNotes([note()]),
    updateNoteFields: (a) => a.updateNoteFields(note()),
    createModel: (a) => a.createModel({name: 'M', fields: ['Front'], css: '', isCloze: false, cardTemplates: []}),
    createDeck: (a) => a.createDeck('D'),
    addTags: (a) => a.addTags([1], ['t']),
    removeTags: (a) => a.removeTags([1], ['t']),
    canAddNotes: (a) => a.canAddNotes([note()]),
    canAddNotesWithErrorDetail: (a) => a.canAddNotesWithErrorDetail([note()]),
    notesInfo: (a) => a.notesInfo([1]),
    cardsInfo: (a) => a.cardsInfo([1]),
    getDeckNames: (a) => a.getDeckNames(),
    getModelNames: (a) => a.getModelNames(),
    getModelFieldNames: (a) => a.getModelFieldNames('M'),
    modelTemplates: (a) => a.modelTemplates('M'),
    modelStyling: (a) => a.modelStyling('M'),
    updateModelTemplates: (a) => a.updateModelTemplates('M', {'Card 1': {Front: 'f', Back: 'b'}}),
    updateModelStyling: (a) => a.updateModelStyling('M', '.card{}'),
    modelFieldAdd: (a) => a.modelFieldAdd('M', 'F', 1),
    modelFieldRename: (a) => a.modelFieldRename('M', 'F', 'G'),
    guiBrowse: (a) => a.guiBrowse('q'),
    guiBrowseNote: (a) => a.guiBrowseNote(1),
    guiBrowseNotes: (a) => a.guiBrowseNotes([1]),
    guiEditNote: (a) => a.guiEditNote(1),
    storeMediaFile: (a) => a.storeMediaFile('x.webm', 'AAAA'),
    findNotes: (a) => a.findNotes('q'),
    findNotesInDeck: (a) => a.findNotesInDeck([5], 'D', 'M'),
    findNoteIds: (a) => a.findNoteIds([note()]),
    suspendCards: (a) => a.suspendCards([1]),
    findCards: (a) => a.findCards('q'),
    findCardsForNote: (a) => a.findCardsForNote(1),
    apiReflect: (a) => a.apiReflect(['actions'], ['addNote']),
    apiExists: (a) => a.apiExists('addNote'),
    makeAnkiSync: (a) => a.makeAnkiSync(),
};

/** They do not check the version. */
const UNCHECKED = new Set(['guiEditNote', 'apiReflect', 'apiExists']);

describe('AnkiConnect.withoutFallback: the header', () => {
    test('the table below has every public method that talks to Anki', () => {
        const names = Object.entries(Object.getOwnPropertyDescriptors(AnkiConnect.prototype))
            .filter(([name, {value}]) => typeof value === 'function' && !name.startsWith('_') && name !== 'constructor')
            .map(([name]) => name)
            .filter((name) => !['withoutFallback', 'pinnedTo', 'withSignal', 'isErrorUnsupportedAction'].includes(name));
        expect(Object.keys(CALLS).sort()).toStrictEqual(names.sort());
    });

    test.each(Object.keys(CALLS))('%s: every request of the view has it, the normal client has none; nothing else differs', async (name) => {
        const base = makeAnki();
        base.apiKey = 'k';
        const normalResult = await CALLS[name](base);
        const normal = sent;
        sent = [];
        const viewResult = await CALLS[name](base.withoutFallback());

        expect(normal.length).toBeGreaterThan(0);
        expect(normal.map(({init}) => init.headers)).toStrictEqual(normal.map(() => JSON_ONLY));
        expect(sent.map(({init}) => init.headers)).toStrictEqual(normal.map(() => NO_FALLBACK));
        /**
         * @param {Sent} request
         * @returns {unknown}
         */
        const rest = ({server, init: {headers: _headers, ...init}}) => ({server, init});
        expect(sent.map(rest)).toStrictEqual(normal.map(rest));
        expect(viewResult).toStrictEqual(normalResult);
    });

    test('the whole request of the normal client is as it was, after the view worked too', async () => {
        const base = makeAnki();
        await base.withoutFallback().getDeckNames();
        sent = [];
        await base.getDeckNames();
        const init = (/** @type {string} */ body) => ({
            method: 'POST',
            mode: 'cors',
            cache: 'default',
            credentials: 'omit',
            headers: JSON_ONLY,
            redirect: 'follow',
            referrerPolicy: 'no-referrer',
            body,
        });
        expect(sent.map((request) => request.init)).toStrictEqual([
            init('{"action":"version","params":{},"version":2}'),
            init('{"action":"deckNames","params":{},"version":2}'),
        ]);
    });

    test('`version` and `multi` have it', async () => {
        await makeAnki().withoutFallback().findNoteIds([note()]);
        expect(sent.map(({action, init}) => [action, init.headers])).toStrictEqual([['version', NO_FALLBACK], ['multi', NO_FALLBACK]]);
    });

    // Core, который ответил медленно, расширение принимает за прямой AnkiConnect: режим ничего не говорит о сервере.
    test.each(/** @type {[string, string, (url: string) => boolean][]} */ ([
        ['core', CORE, (url) => url.startsWith(CORE)],
        ['direct', CORE, (url) => url === CORE],
        ['direct', DIRECT, (url) => url === DIRECT],
        ['none', CORE, () => false],
    ]))('route mode %s (server %s)', async (mode, server, isUp) => {
        const resolver = new AnkiRouteResolver({
            fetch: async (input) => {
                const url = /** @type {string} */ (input);
                if (!isUp(url)) { throw new TypeError('Failed to fetch'); }
                return new Response(JSON.stringify(url.endsWith('/health') ? {status: 'healthy', service: 'core'} : {result: 6, error: null}), {status: 200});
            },
            now: () => 1,
        });
        resolver.configure({primary: server, apiKey: null});
        const route = await resolver.getRoute();
        expect(route.mode).toBe(mode);
        const base = makeAnki(CORE);
        const view = base.withoutFallback();
        base.server = route.ankiServer;
        await view.addNote(note());
        expect(sent.map((request) => [request.server, request.action, request.init.headers])).toStrictEqual([
            [server, 'version', NO_FALLBACK],
            [server, 'addNote', NO_FALLBACK],
        ]);
    });

    test('before the first probe: the address of the options, the header is there', async () => {
        const view = new AnkiConnect().withoutFallback();
        view.enabled = true;
        view.server = CORE;
        await view.addNote(note());
        expect(sent.map(({init}) => init.headers)).toStrictEqual([NO_FALLBACK, NO_FALLBACK]);
    });
});

describe('AnkiConnect.withoutFallback: a route switch', () => {
    /**
     * @param {AnkiConnect} base
     * @returns {string[]}
     */
    function switchToDirect(base) {
        /** @type {string[]} */
        const failed = [];
        answer = ({server}) => {
            if (server === CORE) { throw new TypeError('Failed to fetch'); }
            return void 0;
        };
        base.networkFailureHandler = async (failedServer, action) => {
            failed.push(`${failedServer} ${action}`);
            base.server = DIRECT;
            return {server: DIRECT, switchedMessage: 'switched'};
        };
        return failed;
    }

    test.each(Object.keys(CALLS).filter((name) => name !== 'isConnected'))('%s: the view never goes to the new address; the handler still refreshes the route', async (name) => {
        for (const checked of [true, false]) {
            answer = () => void 0;
            const base = makeAnki();
            const view = base.withoutFallback();
            if (checked) { await view.getVersion(); }
            sent = [];
            const failed = switchToDirect(base);
            const error = await rejected(CALLS[name](view));
            const {action} = sent[0];
            expect(error.message).toBe('switched');
            expect(error.data).toMatchObject({code: ANKI_ROUTE_SWITCHED_CODE, action, fromServer: CORE, toServer: DIRECT});
            expect(sent.map((request) => [request.server, request.init.headers])).toStrictEqual([[CORE, NO_FALLBACK]]);
            if (!checked && !UNCHECKED.has(name)) { expect(action).toBe('version'); }
            expect(failed).toStrictEqual([`${CORE} ${action}`]);
            // The next call is for the new route.
            sent = [];
            await CALLS[name](view);
            expect([...new Set(sent.map(({server}) => server))]).toStrictEqual([DIRECT]);
        }
    });

    test('isConnected of the view: not connected, nothing is sent to the new address', async () => {
        const base = makeAnki();
        switchToDirect(base);
        expect(await base.withoutFallback().isConnected()).toBe(false);
        expect(sent.map(({server}) => server)).toStrictEqual([CORE]);
    });

    test('the address is the same after the handler, or there is none: the connection failure itself', async () => {
        for (const handler of [null, async () => null, async () => ({server: CORE, switchedMessage: null}), async () => { throw new Error('broken'); }]) {
            const base = makeAnki();
            base.networkFailureHandler = handler;
            answer = () => { throw new TypeError('Failed to fetch'); };
            sent = [];
            const error = await rejected(base.withoutFallback().modelTemplates('M'));
            expect(error.message).toBe('Anki connection failure');
            expect(error.data).toMatchObject({networkFailure: true});
            expect(sent).toHaveLength(1);
        }
    });

    test.each(Object.keys(CALLS).filter((name) => name !== 'isConnected' && !UNCHECKED.has(name)))('%s: the address changes during the version check → the request is not sent to the new one', async (name) => {
        const base = makeAnki();
        answer = ({action}) => {
            if (action === 'version') { base.server = DIRECT; }
            return void 0;
        };
        const error = await rejected(CALLS[name](base.withoutFallback()));
        expect(error.data).toMatchObject({code: ANKI_ROUTE_SWITCHED_CODE, action: 'version', fromServer: CORE, toServer: DIRECT});
        expect(sent.map((request) => [request.server, request.action])).toStrictEqual([[CORE, 'version']]);
    });

    test('the normal client: as it was', async () => {
        const base = makeAnki();
        switchToDirect(base);
        await base.modelStyling('M');
        expect(sent.map((request) => [request.server, request.action, request.init.headers])).toStrictEqual([
            [CORE, 'version', JSON_ONLY],
            [DIRECT, 'version', JSON_ONLY],
            [DIRECT, 'modelStyling', JSON_ONLY],
        ]);
        for (const [action, call] of /** @type {[string, (anki: AnkiConnect) => Promise<unknown>][]} */ ([
            ['modelTemplates', (a) => a.modelTemplates('M')],
            ['storeMediaFile', (a) => a.storeMediaFile('x', 'AAAA')],
            ['multi', (a) => a.findNoteIds([note()])],
        ])) {
            answer = () => void 0;
            const other = makeAnki();
            await other.getVersion();
            sent = [];
            switchToDirect(other);
            await call(other);
            expect(sent.map((request) => [request.server, request.action])).toStrictEqual([[CORE, action], [DIRECT, action]]);
        }
        // The address of the options changes during its version check: the request goes there, as before.
        const third = makeAnki();
        answer = ({action}) => {
            if (action === 'version') { third.server = DIRECT; }
            return void 0;
        };
        sent = [];
        await third.modelStyling('M');
        expect(sent.map((request) => [request.server, request.action])).toStrictEqual([[CORE, 'version'], [DIRECT, 'modelStyling']]);
    });

    test.each(/** @type {[string, (anki: AnkiConnect) => Promise<unknown>][]} */ ([
        ['updateModelTemplates', (a) => a.updateModelTemplates('M', {'Card 1': {Front: 'f', Back: 'b'}})],
        ['updateModelStyling', (a) => a.updateModelStyling('M', '.card{}')],
        ['addNote', (a) => a.addNote(note())],
        ['createModel', (a) => a.createModel({name: 'M', fields: [], css: '', isCloze: false, cardTemplates: []})],
    ]))('%s is not repeated: the route-switched error, one request', async (action, call) => {
        for (const viewOf of [(/** @type {AnkiConnect} */ a) => a, (/** @type {AnkiConnect} */ a) => a.withoutFallback()]) {
            answer = () => void 0;
            const base = makeAnki();
            const client = viewOf(base);
            await client.getVersion();
            sent = [];
            switchToDirect(base);
            const error = await rejected(call(client));
            expect(error.message).toBe('switched');
            expect(error.data).toMatchObject({code: ANKI_ROUTE_SWITCHED_CODE, action, fromServer: CORE, toServer: DIRECT});
            expect(sent.map((request) => [request.server, request.action])).toStrictEqual([[CORE, action]]);
        }
    });

    test('502 is the answer of Core: no handler, no retry, no route-switched error', async () => {
        const base = makeAnki();
        const failed = switchToDirect(base);
        answer = badGateway;
        const error = await rejected(base.withoutFallback().modelTemplates('M'));
        expect(error.message).toBe('Anki connection error: 502');
        expect(error.data).toMatchObject({status: 502});
        expect(failed).toStrictEqual([]);
        expect(sent).toHaveLength(1);
    });
});

describe('AnkiConnect.withoutFallback(server): pinned to an address', () => {
    /** @returns {Promise<void>} */
    const settle = async () => {
        for (let i = 0; i < 200; ++i) { await Promise.resolve(); }
    };

    /** @returns {string[]} */
    const servers = () => [...new Set(sent.map(({server}) => server))];

    test.each(Object.keys(CALLS))('%s: to its address with the header, as the view without one', async (name) => {
        const base = makeAnki();
        const result = await CALLS[name](base.withoutFallback());
        const expected = sent;
        sent = [];
        expect(await CALLS[name](base.withoutFallback(CORE))).toStrictEqual(result);
        expect(sent).toStrictEqual(expected);
    });

    test.each(Object.keys(CALLS))('%s: the address is another one → a coded error, nothing is sent, the route is not asked', async (name) => {
        const base = makeAnki();
        const handler = vi.fn(async () => null);
        base.networkFailureHandler = handler;
        const view = base.withoutFallback(CORE);
        for (const server of [DIRECT, `${CORE}/`, '', null]) {
            base.server = /** @type {string} */ (server);
            if (name === 'isConnected') {
                expect(await view.isConnected()).toBe(false);
            } else {
                const error = await rejected(CALLS[name](view));
                expect(error.data).toStrictEqual({code: ANKI_ROUTE_SWITCHED_CODE, action: UNCHECKED.has(name) ? name.replace('apiExists', 'apiReflect') : 'version', fromServer: CORE, toServer: server});
            }
        }
        // The same when the version is known.
        base.server = CORE;
        await view.getVersion();
        sent = [];
        base.server = DIRECT;
        if (name !== 'isConnected') { expect((await rejected(CALLS[name](view))).data).toMatchObject({code: ANKI_ROUTE_SWITCHED_CODE}); }
        expect(sent).toStrictEqual([]);
        expect(handler).not.toHaveBeenCalled();
    });

    test.each(Object.keys(CALLS))('%s: the address changes after any number of microtasks: nothing goes to the new one', async (name) => {
        for (const known of [true, false]) {
            for (let offset = 0; offset < 40; ++offset) {
                for (const back of [false, true]) {
                    answer = () => void 0;
                    const base = makeAnki();
                    const view = base.withoutFallback(CORE);
                    if (known) { await view.getVersion(); }
                    sent = [];
                    const outcome = CALLS[name](view).then(() => 'done', (/** @type {{data: {code: string}}} */ {data}) => data.code);
                    for (let i = 0; i < offset; ++i) { await Promise.resolve(); }
                    base.server = DIRECT;
                    if (back) {
                        await Promise.resolve();
                        base.server = CORE;
                    }
                    expect(['done', ANKI_ROUTE_SWITCHED_CODE]).toContain(await outcome);
                    expect(sent.filter(({server}) => server !== CORE)).toStrictEqual([]);
                }
            }
        }
    });

    test.each(Object.keys(CALLS).filter((name) => !UNCHECKED.has(name) && name !== 'isConnected'))('%s: the address changes during the version check', async (name) => {
        const base = makeAnki();
        answer = ({action}) => {
            if (action === 'version') { base.server = DIRECT; }
            return void 0;
        };
        expect((await rejected(CALLS[name](base.withoutFallback(CORE)))).data).toMatchObject({code: ANKI_ROUTE_SWITCHED_CODE, fromServer: CORE, toServer: DIRECT});
        expect(sent.map((request) => [request.server, request.action])).toStrictEqual([[CORE, 'version']]);
    });

    test('A → B → A during deckNames, then A → B at every point of the write behind it', async () => {
        for (const [action, call] of /** @type {[string, (anki: AnkiConnect) => Promise<unknown>][]} */ ([
            ['addNote', (a) => a.addNote(note())],
            ['updateNoteFields', (a) => a.updateNoteFields(note())],
            ['createDeck', (a) => a.createDeck('D')],
        ])) {
            for (let offset = 0; offset < 40; ++offset) {
                const base = makeAnki();
                const view = base.withoutFallback(CORE);
                answer = (request) => {
                    if (request.action === 'deckNames') {
                        base.server = DIRECT;
                        base.server = CORE;
                    }
                    return void 0;
                };
                await view.getDeckNames();
                expect(servers()).toStrictEqual([CORE]);
                sent = [];
                const outcome = call(view).then(() => 'done', (/** @type {{data: {code: string}}} */ {data}) => data.code);
                for (let i = 0; i < offset; ++i) { await Promise.resolve(); }
                base.server = DIRECT;
                expect(['done', ANKI_ROUTE_SWITCHED_CODE], action).toContain(await outcome);
                expect(sent.filter(({server}) => server !== CORE)).toStrictEqual([]);
                sent = [];
            }
        }
    });

    test('a lost connection: the route is refreshed, nothing is repeated', async () => {
        const base = makeAnki();
        answer = ({server}) => {
            if (server === CORE) { throw new TypeError('Failed to fetch'); }
            return void 0;
        };
        base.networkFailureHandler = async () => {
            base.server = DIRECT;
            return {server: DIRECT, switchedMessage: 'switched'};
        };
        const error = await rejected(base.withoutFallback(CORE).getDeckNames());
        expect(error.data).toMatchObject({code: ANKI_ROUTE_SWITCHED_CODE, fromServer: CORE, toServer: DIRECT});
        expect(servers()).toStrictEqual([CORE]);
        sent = [];
        expect(await base.withoutFallback(DIRECT).getDeckNames()).toStrictEqual(['Default']);
    });

    test('its version check is its own: not of the base, not of another view, not forgotten when the address comes back', async () => {
        const base = makeAnki();
        await base.getDeckNames();
        await base.withoutFallback().getDeckNames();
        const view = base.withoutFallback(CORE);
        sent = [];
        await view.getDeckNames();
        await view.getDeckNames();
        expect(sent.map(({action}) => action)).toStrictEqual(['version', 'deckNames', 'deckNames']);
        base.server = DIRECT;
        base.server = CORE;
        sent = [];
        await view.getDeckNames();
        expect(sent.map(({action}) => action)).toStrictEqual(['deckNames']);
        sent = [];
        await Promise.all([base.withoutFallback(CORE).getDeckNames(), base.withoutFallback(CORE).getDeckNames()]);
        expect(sent.map(({action}) => action).sort()).toStrictEqual(['deckNames', 'deckNames', 'version', 'version']);
    });

    test('a 502 of its check says nothing about the others', async () => {
        const base = makeAnki();
        answer = badGateway;
        await rejected(base.withoutFallback(CORE).getDeckNames());
        answer = () => void 0;
        expect(await base.getDeckNames()).toStrictEqual(['Default']);
    });

    test('the settings are shared; the view of the view; many views leave nothing behind', () => {
        const base = makeAnki();
        const view = base.withoutFallback(CORE);
        expect([view.enabled, view.server, base.withoutFallback().withoutFallback(CORE).server]).toStrictEqual([true, CORE, CORE]);
        base.apiKey = 'k';
        base.enabled = false;
        expect([view.apiKey, view.enabled]).toStrictEqual(['k', false]);
        expect(view.withoutFallback()).toBe(view);
        expect(view).not.toBe(base.withoutFallback());
        expect(base.withoutFallback()).toBe(base.withoutFallback());
        /* eslint-disable no-underscore-dangle */
        const before = base._settings.onServerChange.length;
        for (let i = 0; i < 50; ++i) {
            base.withoutFallback(CORE).withSignal(new AbortController().signal);
            base.withoutFallback().withSignal(new AbortController().signal);
        }
        expect(base._settings.onServerChange.length).toBe(before);
        /* eslint-enable no-underscore-dangle */
    });

    test('a view of a pinned view for another address is pinned to that one', async () => {
        const base = makeAnki();
        const other = base.withoutFallback(CORE).withoutFallback(DIRECT);
        await rejected(other.getDeckNames());
        base.server = DIRECT;
        sent = [];
        await other.getDeckNames();
        expect(servers()).toStrictEqual([DIRECT]);
    });

    describe('withSignal', () => {
        test.each([['pinned', CORE], ['not pinned', void 0]])('%s: the signal is in every request, the rest is the same', async (_name, server) => {
            const base = makeAnki();
            const view = base.withoutFallback(server);
            await view.getVersion();
            await base.withoutFallback().getVersion();
            sent = [];
            await view.getDeckNames();
            const [{init}] = sent;
            sent = [];
            const {signal} = new AbortController();
            await view.withSignal(signal).getDeckNames();
            expect(sent.map((request) => [request.action, request.init])).toStrictEqual([['deckNames', {...init, signal}]]);
            expect(Object.hasOwn(init, 'signal')).toBe(false);
        });

        test('the version is checked once for a view, with the signal of who asked', async () => {
            const view = makeAnki().withoutFallback(CORE);
            const first = new AbortController().signal;
            const second = new AbortController().signal;
            await view.withSignal(first).getDeckNames();
            await view.withSignal(second).getDeckNames();
            expect(sent.map(({action, init}) => [action, init.signal])).toStrictEqual([['version', first], ['deckNames', first], ['deckNames', second]]);
        });

        test.each(['version', 'deckNames'])('aborted during %s: an error that is neither a closed Anki nor a switch; the route is not asked', async (action) => {
            const base = makeAnki();
            const handler = vi.fn(async () => null);
            base.networkFailureHandler = handler;
            const controller = new AbortController();
            answer = (request) => {
                if (request.action !== action) { return void 0; }
                return new Promise((_resolve, reject) => {
                    /** @type {AbortSignal} */ (request.init.signal).addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); });
                });
            };
            const call = rejected(base.withoutFallback(CORE).withSignal(controller.signal).getDeckNames());
            await settle();
            expect(sent.at(-1)?.action).toBe(action);
            controller.abort();
            const error = await call;
            expect(error.message).toBe('Anki request aborted');
            expect(Object.keys(/** @type {object} */ (error.data)).sort()).toStrictEqual(['action', 'params']);
            expect(handler).not.toHaveBeenCalled();
        });

        test('aborted while the answer is read', async () => {
            const controller = new AbortController();
            answer = ({action}) => {
                if (action !== 'deckNames') { return void 0; }
                const response = new Response('[]');
                response.text = async () => {
                    controller.abort();
                    throw new DOMException('aborted', 'AbortError');
                };
                return response;
            };
            expect((await rejected(makeAnki().withoutFallback(CORE).withSignal(controller.signal)
                .getDeckNames())).message).toBe('Anki request aborted');
        });

        test('one aborted call does not take the version check of another with it', async () => {
            const view = makeAnki().withoutFallback(CORE);
            const controller = new AbortController();
            answer = ({action, init}) => {
                if (action !== 'version' || init.signal !== controller.signal) { return void 0; }
                return new Promise((_resolve, reject) => {
                    controller.signal.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); });
                });
            };
            const aborted = rejected(view.withSignal(controller.signal).getDeckNames());
            const other = view.withSignal(new AbortController().signal).getDeckNames();
            const plain = view.getDeckNames();
            await settle();
            controller.abort();
            expect(await other).toStrictEqual(['Default']);
            expect(await plain).toStrictEqual(['Default']);
            expect((await aborted).message).toBe('Anki request aborted');
        });

        test('a pinned view stays pinned', async () => {
            const base = makeAnki();
            const view = base.withoutFallback(CORE).withSignal(new AbortController().signal);
            base.server = DIRECT;
            expect((await rejected(view.getDeckNames())).data).toMatchObject({code: ANKI_ROUTE_SWITCHED_CODE});
            expect(sent).toStrictEqual([]);
        });

        test('a view that is not pinned forgets the version with the address', async () => {
            const base = makeAnki();
            const view = base.withoutFallback().withSignal(new AbortController().signal);
            await view.getDeckNames();
            base.server = DIRECT;
            sent = [];
            await view.getDeckNames();
            expect(sent.map(({action}) => action)).toStrictEqual(['version', 'deckNames']);
        });

        test('not for the normal client', () => {
            expect(() => makeAnki().withSignal(new AbortController().signal)).toThrow('withoutFallback');
        });
    });
});

describe('AnkiConnect.withoutFallback: settings and the version check', () => {
    test('it is one view; the view of the view is itself; the base is not it', () => {
        const base = makeAnki();
        const view = base.withoutFallback();
        expect(view).toBeInstanceOf(AnkiConnect);
        expect(view).not.toBe(base);
        expect(base.withoutFallback()).toBe(view);
        expect(view.withoutFallback()).toBe(view);
        expect(makeAnki().withoutFallback()).not.toBe(view);
    });

    test('all four settings are shared live, both ways', () => {
        const base = new AnkiConnect();
        const view = base.withoutFallback();
        const handler = async () => null;
        base.enabled = true;
        base.server = DIRECT;
        base.apiKey = 'k';
        base.networkFailureHandler = handler;
        expect([view.enabled, view.server, view.apiKey, view.networkFailureHandler]).toStrictEqual([true, DIRECT, 'k', handler]);
        view.enabled = false;
        view.server = CORE;
        view.apiKey = null;
        view.networkFailureHandler = null;
        expect([base.enabled, base.server, base.apiKey, base.networkFailureHandler]).toStrictEqual([false, CORE, null, null]);
    });

    test('two clients do not share settings', () => {
        const other = makeAnki(DIRECT);
        makeAnki(CORE).withoutFallback().enabled = false;
        expect([other.enabled, other.server, other.withoutFallback().server]).toStrictEqual([true, DIRECT, DIRECT]);
    });

    test('the base is switched off → the view sends nothing', async () => {
        const base = makeAnki();
        const view = base.withoutFallback();
        base.enabled = false;
        expect(await view.addNote(note())).toBeNull();
        await expect(view.storeMediaFile('x', 'A')).rejects.toThrow('AnkiConnect not enabled');
        expect(sent).toStrictEqual([]);
    });

    test('a changed API key is in the next request of the view', async () => {
        const base = makeAnki();
        const view = base.withoutFallback();
        await view.getDeckNames();
        base.apiKey = 'new';
        sent = [];
        await view.getDeckNames();
        expect(sent.map(({body}) => body.key)).toStrictEqual(['new']);
    });

    test.each(['base', 'view'])('a new server, set on the %s: both use it and check its version again', async (where) => {
        const base = makeAnki();
        const view = base.withoutFallback();
        await base.getDeckNames();
        await view.getDeckNames();
        sent = [];
        (where === 'base' ? base : view).server = DIRECT;
        await view.getDeckNames();
        await base.getDeckNames();
        expect(sent.map((request) => [request.server, request.action])).toStrictEqual([
            [DIRECT, 'version'],
            [DIRECT, 'deckNames'],
            [DIRECT, 'version'],
            [DIRECT, 'deckNames'],
        ]);
        sent = [];
        base.server = DIRECT;
        await view.getDeckNames();
        expect(sent.map(({action}) => action)).toStrictEqual(['deckNames']);
    });

    test('the version that the fallback of Core gave to the normal client does not count for the view', async () => {
        answer = ({init}) => (/** @type {Record<string, string>} */ (init.headers)['X-Anki-No-Fallback'] === '1' ? badGateway() : void 0);
        const base = makeAnki();
        const view = base.withoutFallback();
        expect(await base.getDeckNames()).toStrictEqual(['Default']);
        sent = [];
        await expect(view.addNote(note())).rejects.toThrow('Anki connection error: 502');
        expect(sent.map(({action}) => action)).toStrictEqual(['version']);
    });

    test('a 502 of the view, in flight and after, does not reach the check of the normal client', async () => {
        /** @type {(response: Response) => void} */
        let release = () => {};
        answer = ({init}) => {
            if (/** @type {Record<string, string>} */ (init.headers)['X-Anki-No-Fallback'] !== '1') { return void 0; }
            return new Promise((resolve) => { release = resolve; });
        };
        const base = makeAnki();
        const view = base.withoutFallback();
        const failing = rejected(view.addNote(note()));
        // Проверка вида ещё не ответила: обычный клиент спрашивает свою и её не ждёт.
        expect(await base.getDeckNames()).toStrictEqual(['Default']);
        release(badGateway());
        expect((await failing).message).toBe('Anki connection error: 502');
        sent = [];
        expect(await base.getDeckNames()).toStrictEqual(['Default']);
        expect(sent.map(({action}) => action)).toStrictEqual(['deckNames']);
        expect(await base.isConnected()).toBe(true);
    });

    test('a check of the normal client in flight does not answer for the view', async () => {
        /** @type {(response: Response) => void} */
        let release = () => {};
        answer = ({init}) => {
            if (/** @type {Record<string, string>} */ (init.headers)['X-Anki-No-Fallback'] === '1') { return badGateway(); }
            return sent.length === 1 ? new Promise((resolve) => { release = resolve; }) : void 0;
        };
        const base = makeAnki();
        const normal = base.getDeckNames();
        await expect(base.withoutFallback().addNote(note())).rejects.toThrow('Anki connection error: 502');
        release(new Response('6', {status: 200}));
        expect(await normal).toStrictEqual(['Default']);
    });

    test('the view recovers: Anki is open again → its next request checks and works; two at once ask the version once', async () => {
        const base = makeAnki();
        const view = base.withoutFallback();
        answer = badGateway;
        await expect(view.addNote(note())).rejects.toThrow('502');
        answer = () => void 0;
        sent = [];
        expect(await Promise.all([view.addNote(note()), view.getDeckNames()])).toStrictEqual([1, ['Default']]);
        expect(sent.map(({action}) => action)).toStrictEqual(['version', 'addNote', 'deckNames']);
    });

    test('Anki is closed after the version check of the view: the write gets 502, not the fallback', async () => {
        const view = makeAnki().withoutFallback();
        await view.getVersion();
        answer = badGateway;
        sent = [];
        await expect(view.updateModelTemplates('M', {'Card 1': {Front: 'f', Back: 'b'}})).rejects.toThrow('502');
        expect(sent.map(({action, init}) => [action, init.headers])).toStrictEqual([['updateModelTemplates', NO_FALLBACK]]);
    });
});

describe('AnkiConnect.pinnedTo: the address without the header', () => {
    test.each(Object.keys(CALLS))('%s: the same requests as of the normal client, with the version check of its own', async (name) => {
        const base = makeAnki();
        await CALLS[name](base.pinnedTo(CORE));
        const pinned = sent;
        sent = [];
        await CALLS[name](makeAnki());
        expect(pinned.map(({server, body, init: {headers}}) => [server, body, headers])).toStrictEqual(sent.map(({server, body, init: {headers}}) => [server, body, headers]));
        for (const {init: {headers}} of pinned) { expect(headers).toStrictEqual(JSON_ONLY); }
    });

    test.each(Object.keys(CALLS).filter((name) => name !== 'isConnected'))('%s: another current address → anki_route_switched, nothing is sent', async (name) => {
        const base = makeAnki();
        const view = base.pinnedTo(CORE);
        base.server = DIRECT;
        expect((await rejected(CALLS[name](view))).data).toMatchObject({code: ANKI_ROUTE_SWITCHED_CODE});
        expect(sent).toStrictEqual([]);
    });

    test('the address changes during the version check: the note is not sent', async () => {
        const base = makeAnki();
        answer = ({action}) => {
            if (action === 'version') { base.server = DIRECT; }
            return void 0;
        };
        expect((await rejected(base.pinnedTo(CORE).addNote(note()))).data).toMatchObject({code: ANKI_ROUTE_SWITCHED_CODE});
        expect(sent.map(({action}) => action)).toStrictEqual(['version']);
    });

    test('the connection is lost and the route is another one: nothing is repeated, also a read', async () => {
        const base = makeAnki();
        base.networkFailureHandler = async () => {
            base.server = DIRECT;
            return {server: DIRECT, switchedMessage: null};
        };
        answer = ({server}) => {
            if (server === CORE) { throw new TypeError('Failed to fetch'); }
            return void 0;
        };
        expect((await rejected(base.pinnedTo(CORE).findNotes('q'))).data).toMatchObject({code: ANKI_ROUTE_SWITCHED_CODE});
        expect(sent.map(({server}) => server)).toStrictEqual([CORE]);
    });

    test('its views keep what it is', async () => {
        const base = makeAnki();
        await base.pinnedTo(CORE).withSignal(new AbortController().signal).getDeckNames();
        for (const {init: {headers}} of sent) { expect(headers).toStrictEqual(JSON_ONLY); }
        sent = [];
        const strict = base.pinnedTo(CORE).withoutFallback();
        await strict.getDeckNames();
        for (const {init: {headers}} of sent) { expect(headers).toStrictEqual(NO_FALLBACK); }
        base.server = DIRECT;
        expect((await rejected(strict.getDeckNames())).data).toMatchObject({code: ANKI_ROUTE_SWITCHED_CODE});
    });
});
