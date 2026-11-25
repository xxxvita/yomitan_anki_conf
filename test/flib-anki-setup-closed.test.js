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
import {Backend} from '../ext/js/background/backend.js';
import {parseJson} from '../ext/js/core/json.js';
import {setUiLanguage} from '../ext/js/i18n/ui-language.js';

/* eslint-disable no-underscore-dangle, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */

const CORE = 'http://127.0.0.1:8777';
const DIRECT = 'http://127.0.0.1:8765';
const PAGE = {id: 'x', url: 'chrome-extension://x/popup.html', origin: 'chrome-extension://x'};
const BASE = 'Yomitan Card Type';
const NAMES = ['Phrases', 'ReverseDeck', BASE];
const FILE = {source: 'test', models: NAMES.map((name) => ({name, fields: ['Front', 'data', 'flib_media'], css: '', isCloze: false, cardTemplates: [{Name: 'Card 1', Front: 'ours', Back: 'ours'}]}))};
const WRITES = new Set(['createModel', 'modelFieldAdd', 'modelFieldRename', 'createDeck', 'addNote', 'updateNoteFields']);

/**
 * @typedef {{server: string, action: string, noFallback: boolean}} Sent
 * @typedef {{open: boolean, models: Map<string, string[]>, decks: Set<string>}} Anki A collection; `open` — Anki runs.
 */

/** @type {Record<string, {anki: Anki, isCore: boolean}>} */
let servers = {};
/** @type {Sent[]} */
let sent = [];
/** What the fallback of Core would have written into the collection file. @type {string[]} */
let fallbackWrites = [];
/** @type {Record<string, unknown>} */
let stored = {};
/** Why a server refuses `addNote`; null — it does not. @type {?(server: string, anki: Anki, params: any) => ?string} */
let refusal = null;
/** Runs before a request is answered. @type {(request: Sent) => void|Promise<void>} */
let beforeAnswer = () => {};

/**
 * @param {boolean} [open]
 * @param {Record<string, string[]>} [models]
 * @returns {Anki}
 */
function createAnki(open = true, models = {}) {
    return {open, models: new Map([['Basic', ['Front', 'Back']], ...Object.entries(models)]), decks: new Set(['Default'])};
}

/**
 * @param {Anki} anki
 * @param {string} action
 * @param {any} params
 * @returns {unknown}
 * @throws {Error}
 */
function run({models, decks}, action, params) {
    switch (action) {
        case 'version': return 6;
        case 'modelNames': return [...models.keys()];
        case 'modelFieldNames': return models.get(params.modelName) ?? [];
        case 'apiReflect': return {scopes: ['actions'], actions: params.actions};
        case 'createModel':
            if (models.has(params.modelName)) { throw new Error('Model name already exists'); }
            models.set(params.modelName, params.inOrderFields);
            return {};
        case 'modelFieldAdd': {
            const fields = /** @type {string[]} */ (models.get(params.modelName));
            if (!fields.includes(params.fieldName)) { fields.push(params.fieldName); }
            return null;
        }
        case 'createDeck':
            decks.add(params.deck);
            return 5;
        case 'canAddNotesWithErrorDetail': return params.notes.map(() => ({canAdd: true}));
        case 'findNotes': return [];
        case 'addNote': return 1000;
        default: throw new Error(`unsupported action ${action}`);
    }
}

/** @type {typeof fetch} */
const fakeFetch = async (input, init = {}) => {
    const url = /** @type {string} */ (input);
    if (url.endsWith('flib-anki-models.json')) { return new Response(JSON.stringify(FILE)); }
    const server = Object.keys(servers).find((base) => url.startsWith(base));
    if (typeof server === 'undefined') { throw new TypeError('Failed to fetch'); }
    const {anki, isCore} = servers[server];
    if (init.method === 'GET') { return isCore ? new Response('{"status":"healthy","service":"core"}') : new Response('', {status: 404}); }
    const {action, params, version} = /** @type {any} */ (parseJson(/** @type {string} */ (init.body)));
    const noFallback = new Headers(init.headers).get('X-Anki-No-Fallback') === '1';
    const request = {server, action, noFallback};
    sent.push(request);
    await beforeAnswer(request);
    if (!anki.open) {
        if (!isCore) { throw new TypeError('Failed to fetch'); }
        if (noFallback) { return new Response('', {status: 502}); }
        // Core answers from its own store, and writes into the collection file.
        if (WRITES.has(action)) { fallbackWrites.push(action); }
    }
    let result;
    try {
        const reason = action === 'addNote' && refusal !== null ? refusal(server, anki, params) : null;
        if (reason !== null) { throw new Error(reason); }
        result = run(anki, action, params);
    } catch (e) {
        return new Response(JSON.stringify({result: null, error: /** @type {Error} */ (e).message}));
    }
    return new Response(JSON.stringify(version > 4 ? {result, error: null} : result));
};

/**
 * A worker with the default card formats.
 * @param {string} [server]
 * @returns {Backend}
 */
function startWorker(server = CORE) {
    const backend = new Backend(/** @type {*} */ ({getUrl: (/** @type {string} */ path) => path}));
    backend._anki.enabled = true;
    backend._anki.server = server;
    backend._ankiRouteResolver.configure({primary: CORE, apiKey: null, enabled: true});
    vi.spyOn(backend, '_getProfileOptions').mockReturnValue(/** @type {*} */ ({anki: {cardFormats: [{model: BASE}]}}));
    return backend;
}

/**
 * @param {Backend} backend
 * @returns {Promise<boolean>}
 */
async function openWindow(backend) {
    return await backend._onApiIsAnkiConnected(void 0, /** @type {*} */ (PAGE));
}

/** @returns {string[]} */
const writes = () => sent.filter(({action}) => WRITES.has(action)).map(({action}) => action);

/**
 * @param {string} server
 * @returns {string}
 */
const doneKey = (server) => `flibAnkiSetupDone:${server}`;

beforeEach(() => {
    servers = {};
    sent = [];
    fallbackWrites = [];
    stored = {};
    refusal = null;
    beforeAnswer = () => {};
    setUiLanguage('ru');
    vi.stubGlobal('fetch', fakeFetch);
    vi.stubGlobal('chrome', {
        storage: {
            local: {
                get: async (/** @type {string} */ key) => (key in stored ? {[key]: stored[key]} : {}),
                set: async (/** @type {Record<string, unknown>} */ items) => { Object.assign(stored, items); },
            },
        },
        runtime: {id: 'x', getURL: (/** @type {string} */ path) => `chrome-extension://x${path}`, getPlatformInfo: () => {}},
        offscreen: {},
    });
});

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('note types with Core up and Anki closed', () => {
    test('a window opens: nothing is written, nothing remembered, no error', async () => {
        servers[CORE] = {anki: createAnki(false), isCore: true};
        const backend = startWorker();
        expect(await openWindow(backend)).toBe(true);
        expect(writes()).toStrictEqual([]);
        expect(fallbackWrites).toStrictEqual([]);
        expect(stored).toStrictEqual({});
    });

    test('a word is looked up: the same, and the lookup is answered by Core as before', async () => {
        servers[CORE] = {anki: createAnki(false), isCore: true};
        const backend = startWorker();
        /** @type {any} */
        const note = {modelName: BASE, deckName: 'D', fields: {Word: 'x'}, tags: [], options: {}};
        const infos = await backend._onApiGetAnkiNoteInfo({notes: [note], fetchAdditionalInfo: false}, /** @type {*} */ (PAGE));
        expect(infos).toMatchObject([{canAdd: true}]);
        expect(writes()).toStrictEqual([]);
        expect(stored).toStrictEqual({});
        expect(sent.at(-1)).toMatchObject({action: 'canAddNotesWithErrorDetail', noFallback: false});
    });

    test('the enricher gets «anki_closed»', async () => {
        servers[CORE] = {anki: createAnki(false), isCore: true};
        expect(await startWorker()._getFlibCardEnricher().ensureSetup({force: true})).toBe('anki_closed');
    });

    test('the next window with Anki open installs everything, through the view, and remembers it', async () => {
        const anki = createAnki(false);
        servers[CORE] = {anki, isCore: true};
        const backend = startWorker();
        await openWindow(backend);
        anki.open = true;
        await openWindow(backend);
        expect([...anki.models.keys()]).toStrictEqual(['Basic', ...NAMES]);
        expect([...anki.decks]).toContain('Flibooster');
        expect(stored).toStrictEqual({[doneKey(CORE)]: true});
        expect(sent.filter(({action}) => WRITES.has(action)).every(({noFallback}) => noFallback)).toBe(true);
        sent = [];
        await openWindow(backend);
        expect(sent.map(({action}) => action)).toStrictEqual(['version']);
    });

    test('Anki closes in the middle: nothing more is written, nothing remembered, finished later', async () => {
        const anki = createAnki();
        servers[CORE] = {anki, isCore: true};
        const backend = startWorker();
        beforeAnswer = ({action}) => {
            if (action === 'createModel') { anki.open = anki.models.size < 2; }
        };
        await openWindow(backend);
        expect(fallbackWrites).toStrictEqual([]);
        expect([...anki.models.keys()]).toStrictEqual(['Basic', 'Phrases']);
        expect(stored).toStrictEqual({});
        expect(await backend._getFlibCardEnricher().ensureSetup()).toBe('anki_closed');
        beforeAnswer = () => {};
        anki.open = true;
        expect(await backend._getFlibCardEnricher().ensureSetup()).toBeNull();
        expect(anki.models.size).toBe(4);
        expect(stored).toStrictEqual({[doneKey(CORE)]: true});
    });

    test('types that are there and remembered: nothing is asked, words go on through Core', async () => {
        servers[CORE] = {anki: createAnki(false), isCore: true};
        stored = {[doneKey(CORE)]: true};
        expect(await startWorker()._getFlibCardEnricher().ensureSetup({force: true})).toBeNull();
        expect(sent).toStrictEqual([]);
    });
});

describe('the address', () => {
    test('changes in the middle: nothing is written to the new one by the old run, the old one is not remembered, the new one gets its own', async () => {
        const old = createAnki();
        const next = createAnki();
        servers[CORE] = {anki: old, isCore: true};
        servers[DIRECT] = {anki: next, isCore: false};
        const backend = startWorker();
        beforeAnswer = ({action, server}) => {
            if (action === 'createModel' && server === CORE) { backend._anki.server = DIRECT; }
        };
        expect(await backend._getFlibCardEnricher().ensureSetup()).toBeNull();
        expect([...old.models.keys()]).toStrictEqual(['Basic', 'Phrases']);
        expect([...next.models.keys()]).toStrictEqual(['Basic', ...NAMES]);
        expect(stored).toStrictEqual({[doneKey(DIRECT)]: true});
    });

    test('changes after the last request: the old one is not remembered', async () => {
        servers[CORE] = {anki: createAnki(), isCore: true};
        servers[DIRECT] = {anki: createAnki(false), isCore: false};
        const backend = startWorker();
        beforeAnswer = ({action, server}) => {
            if (action === 'createDeck' && server === CORE) { backend._anki.server = DIRECT; }
        };
        await backend._getFlibCardEnricher().ensureSetup();
        expect(stored).toStrictEqual({});
    });

    test('what is done at one address is not done at another', async () => {
        const other = createAnki();
        servers[CORE] = {anki: createAnki(), isCore: true};
        servers[DIRECT] = {anki: other, isCore: false};
        const backend = startWorker();
        await backend._getFlibCardEnricher().ensureSetup();
        backend._anki.server = DIRECT;
        await backend._getFlibCardEnricher().ensureSetup();
        expect(other.models.size).toBe(4);
        expect(stored).toStrictEqual({[doneKey(CORE)]: true, [doneKey(DIRECT)]: true});
    });

    test('a worker that has not found the route yet (no Core): installed at the address that answers', async () => {
        const anki = createAnki();
        servers[DIRECT] = {anki, isCore: false};
        const backend = startWorker();
        vi.spyOn(backend, '_maybeBootstrapVideoExamplesField').mockResolvedValue(void 0);
        expect(await backend._getFlibCardEnricher().ensureSetup()).toBeNull();
        expect(anki.models.size).toBe(4);
        expect(stored).toStrictEqual({[doneKey(DIRECT)]: true});
    });

    test('changes in the middle and back: the old one is not in the pause of a failure', async () => {
        const old = createAnki();
        servers[CORE] = {anki: old, isCore: true};
        servers[DIRECT] = {anki: createAnki(false), isCore: false};
        const backend = startWorker();
        beforeAnswer = ({action, server}) => {
            if (action === 'createModel' && server === CORE) { backend._anki.server = DIRECT; }
        };
        await backend._getFlibCardEnricher().ensureSetup();
        expect(stored).toStrictEqual({});
        beforeAnswer = () => {};
        backend._anki.server = CORE;
        expect(await backend._getFlibCardEnricher().ensureSetup()).toBeNull();
        expect(old.models.size).toBe(4);
        expect(stored).toStrictEqual({[doneKey(CORE)]: true});
    });

    test('there is none: nothing is sent, what an old version remembered for it is not believed', async () => {
        const backend = startWorker();
        backend._anki.server = '';
        stored = {[doneKey('')]: true};
        expect(await backend._getFlibCardEnricher().ensureSetup()).toBe('anki_closed');
        expect(sent).toStrictEqual([]);
        expect(stored).toStrictEqual({[doneKey('')]: true});
    });
});

describe('«+» of a word when its type is missing (M-2)', () => {
    /** @type {*} */
    const note = {modelName: BASE, deckName: 'Flibooster', fields: {Front: 'x'}, tags: [], options: {}};
    /** @type {Record<string, string>} */
    const MISSING = {[CORE]: 'model not found: Yomitan Card Type', [DIRECT]: 'model was not found: Yomitan Card Type'};

    /**
     * @param {Backend} backend
     * @param {*} [other]
     * @returns {Promise<unknown>}
     */
    async function plus(backend, other = note) {
        try {
            return await backend._onApiAddAnkiNote({note: other}, /** @type {*} */ (PAGE));
        } catch (e) {
            return /** @type {Error} */ (e).message;
        }
    }

    beforeEach(() => {
        refusal = (server, {models}, {note: {modelName}}) => (models.has(modelName) ? null : MISSING[server].replace(BASE, modelName));
    });

    /** @returns {number} */
    const addNotes = () => sent.filter(({action}) => action === 'addNote').length;

    test.each([
        ['ru', 'Откройте Anki и нажмите ещё раз: тип карточек ещё не установлен'],
        ['en', 'Open Anki and press again: the card type is not installed yet'],
    ])('Core up, Anki closed (%s): what to do, one request', async (language, text) => {
        setUiLanguage(/** @type {*} */ (language));
        servers[CORE] = {anki: createAnki(false), isCore: true};
        expect(await plus(startWorker())).toBe(text);
        expect(addNotes()).toBe(1);
        expect(fallbackWrites).toStrictEqual(['addNote']);
        expect(stored).toStrictEqual({});
    });

    test.each([
        ['ru', CORE, 'Тип карточек установлен. Нажмите ещё раз'],
        ['en', DIRECT, 'The card type is installed. Press again'],
    ])('Anki was opened since (%s): this press installs the types and says so, the next one saves', async (language, server, text) => {
        setUiLanguage(/** @type {*} */ (language));
        const anki = createAnki();
        servers[server] = {anki, isCore: server === CORE};
        const backend = startWorker(server);
        expect(await plus(backend)).toBe(text);
        expect(addNotes()).toBe(1);
        expect(anki.models.size).toBe(4);
        expect(stored).toStrictEqual({[doneKey(server)]: true});
        expect(await plus(backend)).toBe(1000);
        expect(addNotes()).toBe(2);
    });

    /** @throws {Error} */
    const fail = () => { throw new Error('no'); };

    // Core falls back to its file also on a timeout or a drop: the refusal says nothing about what Anki has done.
    /** @type {[name: string, prepare: (anki: Anki) => void][]} */
    const NOT_INSTALLED_NOW = [
        ['the set-up is remembered', () => { stored = {[doneKey(CORE)]: true}; }],
        ['the type is there', (anki) => { anki.models.set(BASE, [...FILE.models[0].fields]); }],
        ['somebody made the type first', (anki) => {
            beforeAnswer = ({action}) => {
                if (action === 'createModel') { anki.models.set(BASE, [...FILE.models[0].fields]); }
            };
        }],
        ['the set-up fails at the type', (anki) => {
            beforeAnswer = ({action}) => {
                // No `add` in Anki, whatever the reason.
                if (action === 'createModel') { vi.spyOn(anki.models, 'set').mockImplementation(fail); }
            };
        }],
        ['the set-up fails at the deck, after the types', (anki) => { vi.spyOn(anki.decks, 'add').mockImplementation(fail); }],
        ['the set-up is stopped by a switch, twice', () => {
            servers[DIRECT] = {anki: createAnki(), isCore: false};
            beforeAnswer = ({action}) => {
                if (action === 'createModel') { current._anki.server = current._anki.server === CORE ? DIRECT : CORE; }
            };
        }],
    ];
    /** @type {Backend} */
    let current;
    test.each(NOT_INSTALLED_NOW)('%s: the old text, one request', async (_name, prepare) => {
        const anki = createAnki();
        servers[CORE] = {anki, isCore: true};
        refusal = () => MISSING[CORE];
        current = startWorker();
        prepare(anki);
        expect(await plus(current)).toBe('Anki error: model not found: Yomitan Card Type');
        expect(addNotes()).toBe(1);
    });

    test('the note has been added all the same: one press, one note', async () => {
        const anki = createAnki(true, {[BASE]: [...FILE.models[0].fields]});
        servers[CORE] = {anki, isCore: true};
        let notes = 0;
        refusal = () => {
            notes += 1;
            return MISSING[CORE];
        };
        expect(await plus(startWorker())).toBe('Anki error: model not found: Yomitan Card Type');
        expect(notes).toBe(1);
    });

    test('another type of the user: the old text, no setup', async () => {
        servers[CORE] = {anki: createAnki(false), isCore: true};
        expect(await plus(startWorker(), {...note, modelName: 'Mine'})).toBe('Anki error: model not found: Mine');
        expect(addNotes()).toBe(1);
        expect(sent.map(({noFallback}) => noFallback)).not.toContain(true);
    });

    test('Anki is open and the user has deleted the type: the old text, it is not made again', async () => {
        const anki = createAnki();
        servers[DIRECT] = {anki, isCore: false};
        stored = {[doneKey(DIRECT)]: true};
        expect(await plus(startWorker(DIRECT))).toBe('Anki error: model was not found: Yomitan Card Type');
        expect(addNotes()).toBe(1);
        expect(anki.models.size).toBe(1);
    });

    test('another error: as it is, asked once', async () => {
        servers[CORE] = {anki: createAnki(false), isCore: true};
        refusal = () => 'cannot create note because it is empty';
        expect(await plus(startWorker())).toBe('Anki error: cannot create note because it is empty');
        expect(addNotes()).toBe(1);
        expect(sent.map(({noFallback}) => noFallback)).not.toContain(true);
    });
});

test('AnkiConnect is switched off in the middle: not remembered', async () => {
    servers[CORE] = {anki: createAnki(), isCore: true};
    const backend = startWorker();
    beforeAnswer = ({action}) => {
        if (action === 'createModel') { backend._anki.enabled = false; }
    };
    expect(await backend._getFlibCardEnricher().ensureSetup()).not.toBeNull();
    expect(stored).toStrictEqual({});
});

describe('two workers', () => {
    test('the first one met a closed Anki: the second one installs, the third one does nothing', async () => {
        const anki = createAnki(false);
        servers[CORE] = {anki, isCore: true};
        await openWindow(startWorker());
        expect(anki.models.size).toBe(1);
        anki.open = true;
        await openWindow(startWorker());
        expect(anki.models.size).toBe(4);
        sent = [];
        await openWindow(startWorker());
        expect(writes()).toStrictEqual([]);
        expect(sent.map(({action}) => action)).toStrictEqual(['version']);
    });

    test('at the same time: both succeed, every type is made once', async () => {
        const anki = createAnki();
        servers[CORE] = {anki, isCore: true};
        const [a, b] = [startWorker(), startWorker()];
        expect(await Promise.all([a._getFlibCardEnricher().ensureSetup(), b._getFlibCardEnricher().ensureSetup()])).toStrictEqual([null, null]);
        expect([...anki.models.keys()]).toStrictEqual(['Basic', ...NAMES]);
        expect(stored).toStrictEqual({[doneKey(CORE)]: true});
    });
});

describe('the fields of video examples', () => {
    test('Core up, Anki closed: no field is added; with Anki open — through the view', async () => {
        const anki = createAnki(false, {[BASE]: ['Word']});
        servers[CORE] = {anki, isCore: true};
        const backend = startWorker();
        await backend._maybeBootstrapVideoExamplesField();
        expect(writes()).toStrictEqual([]);
        expect(fallbackWrites).toStrictEqual([]);
        anki.open = true;
        await backend._maybeBootstrapVideoExamplesField();
        expect(anki.models.get(BASE)).toStrictEqual(['Word', 'data', 'flib_media']);
        expect(sent.every(({noFallback}) => noFallback)).toBe(true);
    });

    test('the address changes in the middle: the other Anki gets nothing from this run', async () => {
        const other = createAnki(true, {[BASE]: ['Word']});
        servers[CORE] = {anki: createAnki(true, {[BASE]: ['Word']}), isCore: true};
        servers[DIRECT] = {anki: other, isCore: false};
        const backend = startWorker();
        beforeAnswer = ({action}) => {
            if (action === 'modelFieldNames') { backend._anki.server = DIRECT; }
        };
        await backend._maybeBootstrapVideoExamplesField();
        expect(other.models.get(BASE)).toStrictEqual(['Word']);
        expect(sent.filter(({server}) => server === DIRECT)).toStrictEqual([]);
    });
});

/* eslint-enable no-underscore-dangle, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
