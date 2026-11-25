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

import {JSDOM} from 'jsdom';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {Backend} from '../ext/js/background/backend.js';
import {FlibPhraseNotes} from '../ext/js/background/flib-phrase-notes.js';
import {Offscreen} from '../ext/js/background/offscreen.js';
import {AnkiConnect} from '../ext/js/comm/anki-connect.js';
import {API} from '../ext/js/comm/api.js';
import {parseJson} from '../ext/js/core/json.js';
import {buildPhraseNoteFields} from '../ext/js/data/flib-phrase-note.js';
import {buildFlibMediaFieldHtml, mergeFlibMediaFieldHtml} from '../ext/js/display/gateway-examples-util.js';

/* eslint-disable no-underscore-dangle, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */

const CORE = 'http://127.0.0.1:8777';
const DIRECT = 'http://127.0.0.1:8765';
const DECK = 'Flibooster';
const FIELDS = ['Front', 'Expression', 'EnglishWord', 'ExpressionTranslate', 'Audio_front', 'Audio_expression', 'flib_media'];
const TAGS = ['yomitan', 'flib_enriched'];
const TIMEOUT = 30;

/**
 * @typedef {object} FakeNote
 * @property {number} id
 * @property {string} modelName
 * @property {string} deck
 * @property {Record<string, string>} fields
 * @property {string[]} tags
 */

/**
 * A search pattern of Anki as a regular expression. `\x` is `x` itself.
 * @param {string} pattern
 * @param {string} [suffix]
 * @returns {RegExp}
 */
function glob(pattern, suffix = '') {
    const source = pattern.replace(/\\([\s\S])|([\s\S])/g, (_match, escaped, char) => {
        if (char === '*') { return '[\\s\\S]*'; }
        if (char === '_') { return '[\\s\\S]'; }
        return (escaped ?? char).replace(/[\\^$.*+?()[\]{}|/-]/g, '\\$&');
    });
    return new RegExp(`^${source}${suffix}$`, 'iu');
}

/**
 * AnkiConnect with an open Anki. The search was checked against Anki 26.05 (python library, a scratch collection).
 */
class FakeAnki {
    constructor() {
        /** @type {Map<string, string[]>} */
        this.types = new Map([['Basic', ['Front', 'Back']], ['Phrases', [...FIELDS]]]);
        /** @type {string[]} */
        this.decks = ['Default', DECK];
        /** @type {FakeNote[]} */
        this.notes = [];
        /** @type {number} */
        this.nextId = 1000;
        /** @type {Map<string, string>} */
        this.media = new Map();
    }

    /**
     * @param {string} front
     * @param {string} word
     * @param {Partial<FakeNote>} [change]
     * @returns {number}
     */
    put(front, word, change = {}) {
        const {deck = DECK, modelName = 'Phrases', fields = {}} = change;
        const id = this.nextId++;
        if (!this.decks.includes(deck)) { this.decks.push(deck); }
        const names = /** @type {string[]} */ (this.types.get(modelName));
        const all = /** @type {Record<string, string>} */ ({Front: front, EnglishWord: word, ...fields});
        this.notes.push({id, modelName, deck, tags: [], fields: Object.fromEntries(names.map((name) => [name, (all[name] ?? '').normalize('NFC')]))});
        return id;
    }

    /**
     * @param {number} id
     * @returns {FakeNote|undefined}
     */
    get(id) { return this.notes.find((note) => note.id === id); }

    /**
     * @param {string} query
     * @returns {number[]}
     */
    find(query) {
        const terms = [...query.matchAll(/"((?:\\[\s\S]|[^"\\])*)"|(\S+)/g)].map((match) => match[1] ?? match[2]);
        return this.notes.filter((note) => terms.every((term) => this._matches(note, term))).map(({id}) => id);
    }

    /**
     * @param {FakeNote} note
     * @param {string} term
     * @returns {boolean}
     */
    _matches(note, term) {
        const key = term.slice(0, term.indexOf(':'));
        const value = term.slice(key.length + 1).normalize('NFC');
        switch (key) {
            case 'nid': return value.split(',').includes(`${note.id}`);
            case 'note': return glob(value).test(note.modelName);
            case 'deck':
                if (value === 'current') { return note.deck === 'Default'; }
                if (value === 'filtered') { return false; }
                return glob(value, '(?:::.*)?').test(note.deck);
            default: {
                const name = Object.keys(note.fields).find((field) => field.toLowerCase() === key.toLowerCase());
                return typeof name !== 'undefined' && glob(value).test(note.fields[name]);
            }
        }
    }

    /**
     * @param {string} action
     * @param {Record<string, any>} params
     * @returns {unknown}
     * @throws {Error}
     */
    run(action, params) {
        switch (action) {
            case 'version': return 6;
            case 'modelNames': return [...this.types.keys()];
            case 'modelFieldNames': return [...this._type(params.modelName)];
            case 'deckNames': return [...this.decks];
            case 'createDeck':
                if (!this.decks.some((name) => name.toLowerCase() === params.deck.toLowerCase())) { this.decks.push(params.deck); }
                return 5;
            case 'findNotes': return this.find(params.query);
            case 'notesInfo': return params.notes.map((/** @type {number} */ id) => {
                const note = this.get(id);
                if (typeof note === 'undefined') { return {}; }
                return {noteId: id, modelName: note.modelName, tags: note.tags, cards: [id], fields: Object.fromEntries(Object.entries(note.fields).map(([name, value], order) => [name, {value, order}]))};
            });
            case 'addNote': {
                const {deckName, modelName, fields, tags, options} = params.note;
                const names = this._type(modelName);
                const deck = this.decks.find((name) => name.toLowerCase() === deckName.toLowerCase());
                if (typeof deck === 'undefined') { throw new Error(`deck was not found: ${deckName}`); }
                if (options.allowDuplicate !== true && this.notes.some((note) => note.fields.Front === fields.Front)) {
                    throw new Error('cannot create note because it is a duplicate');
                }
                // AnkiConnect drops the fields that the type does not have and says nothing.
                const id = this.put('', '', {deck, modelName, fields: Object.fromEntries(Object.entries(fields).filter(([name]) => names.includes(name)))});
                /** @type {FakeNote} */ (this.get(id)).tags = tags;
                return id;
            }
            case 'updateNoteFields': {
                const note = this.get(params.note.id);
                if (typeof note === 'undefined') { throw new Error(`Note was not found: ${params.note.id}`); }
                for (const [name, value] of Object.entries(params.note.fields)) {
                    if (Object.hasOwn(note.fields, name)) { note.fields[name] = /** @type {string} */ (value).normalize('NFC'); }
                }
                return null;
            }
            case 'storeMediaFile':
                this.media.set(params.filename, params.data);
                return params.filename;
            default:
                throw new Error('unsupported action');
        }
    }

    /**
     * @param {string} name
     * @returns {string[]}
     * @throws {Error}
     */
    _type(name) {
        const fields = this.types.get(name);
        if (typeof fields === 'undefined') { throw new Error(`model was not found: ${name}`); }
        return fields;
    }
}

/**
 * @typedef {object} Sent
 * @property {string} server
 * @property {string} action
 * @property {Record<string, any>} params
 * @property {number} number of the request without the version checks, from 0; -1 — a version check.
 * @property {boolean} noFallback
 */

const WRITES = new Set(['createDeck', 'addNote', 'updateNoteFields', 'storeMediaFile']);

/** @type {Record<string, FakeAnki>} */
let servers = {};
/** @type {Sent[]} */
let sent = [];
/**
 * What a server answers instead of Anki; undefined — Anki answers. May throw: the network.
 * @type {(request: Sent, run: () => unknown) => (Response|Promise<Response>|Promise<undefined>|undefined)}
 */
let answer = (_request, _run) => void 0;

/** @type {typeof fetch} */
const fakeFetch = async (input, init = {}) => {
    /** @type {{action: string, params: Record<string, any>}} */
    const {action, params} = parseJson(typeof init.body === 'string' ? init.body : '{}');
    const isVersion = action === 'version';
    /** @type {Sent} */
    const request = {
        server: /** @type {string} */ (input),
        action,
        params,
        number: isVersion ? -1 : sent.filter(({number}) => number >= 0).length,
        noFallback: /** @type {Record<string, string>} */ (init.headers)['X-Anki-No-Fallback'] === '1',
    };
    sent.push(request);
    // What Anki does it does once, also when the answer is lost after that.
    const run = () => servers[request.server].run(action, params);
    const answered = await answer(request, run);
    if (typeof answered !== 'undefined') { return answered; }
    if (!(request.server in servers)) { throw new TypeError('Failed to fetch'); }
    try {
        return new Response(JSON.stringify(run()));
    } catch (e) {
        return new Response(JSON.stringify({result: null, error: /** @type {Error} */ (e).message}));
    }
};

beforeEach(() => {
    servers = {[DIRECT]: new FakeAnki()};
    sent = [];
    answer = () => void 0;
    vi.stubGlobal('fetch', fakeFetch);
});

afterEach(() => {
    // Rule: no request of a phrase may reach the fallback of Core.
    for (const {action, noFallback} of sent) { expect([action, noFallback]).toStrictEqual([action, true]); }
    vi.unstubAllGlobals();
});

/** @returns {FakeAnki} */
const anki = () => servers[DIRECT];

/** @returns {string[]} Without the version checks. */
const actions = () => sent.filter(({number}) => number >= 0).map(({action}) => action);

/** @returns {string[]} */
const writes = () => actions().filter((action) => WRITES.has(action));

/** @returns {string[]} */
const queries = () => sent.filter(({action}) => action === 'findNotes').map(({params}) => params.query);

/**
 * @param {string} [server]
 * @returns {AnkiConnect}
 */
function makeClient(server = DIRECT) {
    const client = new AnkiConnect();
    client.enabled = true;
    client.server = server;
    return client;
}

/**
 * One worker.
 * @param {{client?: AnkiConnect, mergeMedia?: (existing: string, added: string) => Promise<string>, timeoutMs?: number, keepAlive?: ?(() => void), keepAliveMs?: number}} [details]
 * @returns {{notes: FlibPhraseNotes, client: AnkiConnect}}
 */
function makeWorker({client = makeClient(), mergeMedia = async (existing, added) => existing + added, timeoutMs = TIMEOUT, ...rest} = {}) {
    return {notes: new FlibPhraseNotes({anki: client, mergeMedia, timeoutMs, ...rest}), client};
}

/**
 * @param {string} front
 * @param {string} englishWord
 * @param {string} [deckName]
 * @returns {Promise<number[]>}
 */
async function find(front, englishWord, deckName = DECK) {
    return (await makeWorker().notes.find({server: DIRECT, deckName, front, englishWord})).noteIds;
}

/**
 * @param {string} value The phrase; the part in square brackets is selected.
 * @param {string} [mediaHtml]
 * @returns {Record<string, string>}
 * @throws {Error}
 */
function phrase(value, mediaHtml = '') {
    const start = value.indexOf('[');
    const blank = start < 0 ? null : {start, end: value.indexOf(']') - 1};
    const fields = buildPhraseNoteFields({value: value.replace(/[[\]]/g, ''), blank, translation: 'перевод', mediaHtml});
    if (fields === null) { throw new Error('not a phrase'); }
    return /** @type {Record<string, string>} */ (/** @type {unknown} */ (fields));
}

/**
 * @param {Record<string, string>} [fields]
 * @param {string} [deckName]
 * @returns {{server: string, deckName: string, fields: Record<string, string>, tags: string[]}}
 */
const addParams = (fields = phrase('Well, I know.'), deckName = DECK) => ({server: DIRECT, deckName, fields, tags: TAGS});

/**
 * @param {Promise<unknown>} promise
 * @returns {Promise<{code: unknown, data: Record<string, unknown>, message: string}>}
 */
async function rejected(promise) {
    let result;
    try {
        result = await promise;
    } catch (e) {
        const {data, message} = /** @type {Error & {data: Record<string, unknown>}} */ (e);
        return {code: data?.code, data, message};
    }
    throw new Error(`expected a rejection, got ${JSON.stringify(result)}`);
}

/**
 * @param {Promise<unknown>} promise
 * @returns {Promise<unknown>}
 */
const codeOf = async (promise) => (await rejected(promise)).code;

const never = () => new Promise(() => {});

/** @type {[name: string, respond: () => Response, code: string][]} */
const FAILURES = [
    ['502 of Core: Anki is closed', () => new Response('', {status: 502}), 'anki_closed'],
    ['nobody at the address', () => { throw new TypeError('Failed to fetch'); }, 'anki_closed'],
    ['500', () => new Response('', {status: 500}), 'anki_note_failed'],
    ['an error of AnkiConnect', () => new Response(JSON.stringify({result: null, error: 'collection is not available'})), 'anki_note_failed'],
    ['not JSON', () => new Response('<html>'), 'anki_note_failed'],
    ['another type', () => new Response('"x"'), 'anki_note_failed'],
];

describe('find: the query', () => {
    test.each(/** @type {[front: string, pattern: string][]} */ ([
        ['Well, I know.', 'Well*I*know*'],
        ['x', 'x'],
        ['_____ it', '*it'],
        ['I _____ it', 'I*it'],
        ['50% of *this* is a_b', '50*of*this*is*a*b'],
        ['He said "no"', 'He*said*no*'],
        ['“Hi”', '*Hi*'],
        ['C:\\(x', 'C*x'],
        ['back\\', 'back*'],
        ['re:a|b', 're*a*b'],
        ['nc:x', 'nc*x'],
        ['front:x deck:y -z', 'front*x*deck*y*z'],
        ['(a) or (b)', '*a*or*b*'],
        ['It\'s', 'It*s'],
        ['café', 'caf*'],
        ['cafe\u0301 au lait', 'caf*au*lait'],
        ['Привет hello', '*hello'],
        ['é', '*'],
        ['👍 ok', '*ok'],
        ['a  \n b', 'a*b'],
    ]))('%j', async (front, pattern) => {
        expect(await find(front, 'w')).toStrictEqual([]);
        expect(queries()).toStrictEqual([`"note:Phrases" "deck:${DECK}" "front:${pattern}"`]);
        // Nothing to read.
        expect(actions()).toStrictEqual(['findNotes']);
    });

    test.each(/** @type {[deck: string, term: string][]} */ ([
        ['A::B c', '"deck:A::B c"'],
        ['st*r "q" a_b\\', String.raw`"deck:st\*r \"q\" a\_b\\"`],
        ['current', '"deck:CURRENT"'],
        ['filtered', '"deck:FILTERED"'],
        ['Current', '"deck:Current"'],
        ['co:lon', '"deck:co:lon"'],
    ]))('deck %j', async (deck, term) => {
        const id = anki().put('I know', 'know', {deck});
        anki().put('I know', 'know', {deck: 'Default'});
        anki().put('I know', 'know', {deck: 'stXr "q" aXb\\'});
        expect(await find('I know', 'know', deck)).toStrictEqual([id]);
        expect(queries()).toStrictEqual([`"note:Phrases" ${term} "front:I*know"`]);
    });
});

describe('find: the same card', () => {
    test.each(/** @type {[name: string, storedFront: string, storedWord: string, front: string, word: string][]} */ ([
        ['as it was written', 'I _____ it.', 'love', 'I _____ it.', 'love'],
        ['quotes, wildcards and a backslash', 'a_b *c* "d" 5% \\e', 'x', 'a_b *c* "d" 5% \\e', 'x'],
        ['entities of the editor', 'I&#39;m&nbsp;_____ &quot;now&quot;', 'I&#39;m', 'I\'m _____ "now"', 'I\'m'],
        ['entities of letters between ASCII ones', 'don&rsquo;t _____', 'go', 'don’t _____', 'go'],
        ['a tag of the editor inside', 'Well,<br>I know.', 'w', 'Well, I know.', 'w'],
        ['bold around a word', 'Well, <b>I</b> know.', 'w', 'Well, I know.', 'w'],
        ['NFD of the window, NFC of Anki', 'caf\u00E9 _____', 'na\u00EFve', 'cafe\u0301 _____', 'nai\u0308ve'],
    ]))('%s', async (_name, storedFront, storedWord, front, word) => {
        const id = anki().put(storedFront, storedWord);
        expect(await find(front, word)).toStrictEqual([id]);
    });

    test.each(/** @type {[name: string, front: string, word: string, change: Partial<FakeNote>][]} */ ([
        ['another word', 'I _____ it', 'hate', {}],
        ['a longer word', 'I _____ it', 'love it', {}],
        ['another Front that the wildcards match', 'I xxxxx it', 'love', {}],
        ['the same letters in another case', 'i _____ IT', 'love', {}],
        ['no blank', 'I love it', 'love', {}],
        ['a longer Front', 'I _____ it and it', 'love', {}],
        ['another deck', 'I _____ it', 'love', {deck: 'Default'}],
        ['a deck that begins the same', 'I _____ it', 'love', {deck: `${DECK}X`}],
        ['another type', 'I _____ it', 'love', {modelName: 'Other'}],
        ['an empty word', 'I _____ it', '', {}],
    ]))('not: %s', async (_name, front, word, change) => {
        anki().types.set('Other', [...FIELDS]);
        anki().put(front, word, change);
        expect(await find('I _____ it', 'love')).toStrictEqual([]);
    });

    test('a subdeck is this deck, as everywhere', async () => {
        const id = anki().put('I _____ it', 'love', {deck: `${DECK}::Sub`});
        anki().put('I _____ it', 'love', {deck: 'Other::Flibooster'});
        expect(await find('I _____ it', 'love')).toStrictEqual([id]);
    });

    test('all of them, the oldest first', async () => {
        const ids = [anki().put('It', 'It'), anki().put('it', 'It'), anki().put('It', 'It')];
        answer = ({action}) => (action === 'findNotes' ? new Response(JSON.stringify([...ids].reverse())) : void 0);
        expect(await find('It', 'It')).toStrictEqual([ids[0], ids[2]]);
    });

    test('more than 200 candidates: the first 200 by id are compared', async () => {
        const ids = Array.from({length: 205}, (_value, i) => anki().put(`é${i}`, 'x'));
        for (const i of [3, 199, 200]) { /** @type {FakeNote} */ (anki().get(ids[i])).fields.Front = 'é'; }
        answer = ({action}) => (action === 'findNotes' ? new Response(JSON.stringify([...ids].reverse())) : void 0);
        expect(await find('é', 'x')).toStrictEqual([ids[3], ids[199]]);
        expect(sent.at(-1)?.params.notes).toStrictEqual(ids.slice(0, 200));
    });

    test('a note deleted between the two requests, a note of another type, a note without the field', async () => {
        const id = anki().put('It', 'It');
        anki().types.set('Other', [...FIELDS]);
        const other = anki().put('It', 'It', {modelName: 'Other'});
        anki().types.set('phrases', ['Front']);
        const bare = anki().put('It', 'It', {modelName: 'phrases'});
        answer = ({action}) => (action === 'findNotes' ? new Response(JSON.stringify([5, other, bare, id])) : void 0);
        expect(await find('It', 'It')).toStrictEqual([id]);
    });
});

describe('find: failures', () => {
    test.each(FAILURES)('%s', async (_name, respond, code) => {
        anki().put('A secret phrase', 'secret');
        for (const action of ['findNotes', 'notesInfo']) {
            answer = (request) => (request.action === action ? respond() : void 0);
            const {code: actual, data, message} = await rejected(makeWorker().notes.find({server: DIRECT, deckName: DECK, front: 'A secret phrase', englishWord: 'secret'}));
            expect(actual).toBe(code);
            expect(message).toBe(code);
            expect(Object.keys(data).sort()).toStrictEqual(['code', 'detail', 'status']);
            // ⚠️ The error of AnkiConnect carries the request.
            expect(JSON.stringify(data)).not.toContain('secret');
        }
    });

    test('no answer at all', async () => {
        answer = /** @type {*} */ (never);
        expect(await codeOf(find('It', 'It'))).toBe('anki_note_failed');
    });

    test('AnkiConnect is off, also in the middle: not «no such card»', async () => {
        anki().put('It', 'It');
        const {notes, client} = makeWorker();
        client.enabled = false;
        const params = {server: DIRECT, deckName: DECK, front: 'It', englishWord: 'It'};
        expect(await codeOf(notes.find(params))).toBe('anki_note_failed');
        expect(sent).toStrictEqual([]);
        client.enabled = true;
        answer = ({action}) => {
            if (action === 'findNotes') { client.enabled = false; }
            return void 0;
        };
        expect(await codeOf(notes.find(params))).toBe('anki_note_failed');
    });

    test.each([[CORE], [''], [null], [void 0], [`${DIRECT}/`]])('server %j is not the current one', async (server) => {
        expect(await codeOf(makeWorker().notes.find({server: /** @type {string} */ (server), deckName: DECK, front: 'It', englishWord: 'It'}))).toBe('anki_route_switched');
        expect(sent).toStrictEqual([]);
    });

    test.each(['findNotes', 'notesInfo'])('the address changes during %s', async (action) => {
        anki().put('It', 'It');
        const {notes, client} = makeWorker();
        answer = (request) => {
            if (request.action === action) { client.server = CORE; }
            return void 0;
        };
        expect(await codeOf(notes.find({server: DIRECT, deckName: DECK, front: 'It', englishWord: 'It'}))).toBe('anki_route_switched');
    });

    test.each(['findNotes', 'notesInfo'])('the route switches at %s: the other Anki is not asked', async (action) => {
        anki().put('It', 'It');
        servers[CORE] = new FakeAnki();
        servers[CORE].put('It', 'It');
        const {notes, client} = makeWorker();
        client.networkFailureHandler = async () => {
            client.server = CORE;
            return {server: CORE, switchedMessage: null};
        };
        answer = (request) => {
            if (request.server === DIRECT && request.action === action) { throw new TypeError('Failed to fetch'); }
            return void 0;
        };
        expect(await codeOf(notes.find({server: DIRECT, deckName: DECK, front: 'It', englishWord: 'It'}))).toBe('anki_route_switched');
        expect(sent.filter(({server}) => server === CORE)).toStrictEqual([]);
    });

    test('an error of the other Anki says nothing about this one', async () => {
        const {notes, client} = makeWorker();
        answer = ({action}) => {
            if (action !== 'findNotes') { return void 0; }
            client.server = CORE;
            return new Response(JSON.stringify({result: null, error: 'model was not found'}));
        };
        expect(await codeOf(notes.find({server: DIRECT, deckName: DECK, front: 'It', englishWord: 'It'}))).toBe('anki_route_switched');
    });

    test('Anki closes and the route goes to another address: switched, the next time closed; nobody there is asked the first time', async () => {
        servers = {};
        const {notes, client} = makeWorker();
        client.networkFailureHandler = async () => {
            client.server = CORE;
            return {server: CORE, switchedMessage: null};
        };
        expect(await codeOf(notes.find({server: DIRECT, deckName: DECK, front: 'It', englishWord: 'It'}))).toBe('anki_route_switched');
        expect(sent.map(({server}) => server)).toStrictEqual([DIRECT]);
        expect(await codeOf(notes.find({server: CORE, deckName: DECK, front: 'It', englishWord: 'It'}))).toBe('anki_closed');
    });

    test.each(/** @type {[object][]} */ ([
        [{deckName: ''}],
        [{deckName: ' '}],
        [{deckName: 5}],
        [{front: ''}],
        [{front: null}],
        [{front: 'x'.repeat(20_001)}],
        [{englishWord: ''}],
        [{englishWord: ['x']}],
        [{englishWord: 'x'.repeat(20_001)}],
    ]))('%j is refused', async (change) => {
        expect(await codeOf(makeWorker().notes.find({server: DIRECT, deckName: DECK, front: 'It', englishWord: 'It', ...change}))).toBe('flib_bad_request');
        expect(sent).toStrictEqual([]);
    });
});

describe('add', () => {
    test('the note', async () => {
        const fields = phrase('Well, I [know] it’s "_" 5%.', '<ul class="flib-yt"></ul>');
        const {noteId, existed} = await makeWorker().notes.add(addParams(fields));
        expect(existed).toBe(false);
        expect(anki().notes).toStrictEqual([{id: noteId, modelName: 'Phrases', deck: DECK, fields: {...fields}, tags: TAGS}]);
        expect(fields.Front).toBe('Well, I _____ it’s "_" 5%.');
        expect(actions()).toStrictEqual(['findNotes', 'modelFieldNames', 'deckNames', 'addNote']);
        expect(sent.at(-1)?.params).toStrictEqual({note: {
            deckName: DECK,
            modelName: 'Phrases',
            fields,
            tags: TAGS,
            options: {allowDuplicate: true, duplicateScope: 'collection', duplicateScopeOptions: {deckName: null, checkChildren: false, checkAllModels: false}},
        }});
    });

    test('the same Front with another word, in another type and in another deck: added all the same', async () => {
        anki().types.set('Other', [...FIELDS]);
        anki().put('I _____ it', 'hate');
        anki().put('I _____ it', 'love', {deck: 'Default'});
        anki().put('I _____ it', 'love', {modelName: 'Other'});
        expect(await makeWorker().notes.add(addParams(phrase('I [love] it')))).toStrictEqual({noteId: 1003, existed: false});
        expect(anki().notes).toHaveLength(4);
    });

    test('it exists: nothing is written', async () => {
        const id = anki().put('It&#39;s _____', 'me', {fields: {ExpressionTranslate: 'моё', flib_media: 'x'}});
        anki().put('It\'s _____', 'me');
        const before = structuredClone(anki().notes);
        expect(await makeWorker().notes.add(addParams(phrase('It\'s [me]', 'y')))).toStrictEqual({noteId: id, existed: true});
        expect(anki().notes).toStrictEqual(before);
        expect(actions()).toStrictEqual(['findNotes', 'notesInfo']);
    });

    test('found by the next find and the next add', async () => {
        const {notes} = makeWorker();
        const fields = phrase('“Don’t [touch] a_b *c* 5% \\x: re:y” — cafe\u0301');
        const {noteId} = await notes.add(addParams(fields));
        expect(await find(fields.Front, fields.EnglishWord)).toStrictEqual([noteId]);
        expect(await notes.add(addParams(fields))).toStrictEqual({noteId, existed: true});
    });

    test.each([['New::Deck'], ['current'], ['a_b "q"']])('a missing deck %j is created', async (deckName) => {
        const {notes} = makeWorker();
        const {noteId} = await notes.add(addParams(phrase('It'), deckName));
        expect(writes()).toStrictEqual(['createDeck', 'addNote']);
        expect(anki().get(noteId)?.deck).toBe(deckName);
        expect(await notes.add(addParams(phrase('It'), deckName))).toStrictEqual({noteId, existed: true});
        sent = [];
        await notes.add(addParams(phrase('It too'), deckName));
        expect(writes()).toStrictEqual(['addNote']);
    });

    test('a deck in another letter case is not missing', async () => {
        await makeWorker().notes.add(addParams(phrase('It'), 'FLIBOOSTER'));
        expect(writes()).toStrictEqual(['addNote']);
    });

    test.each(FAILURES)('the deck is not created: %s', async (_name, respond, code) => {
        answer = ({action}) => (action === 'createDeck' ? respond() : void 0);
        expect(await codeOf(makeWorker().notes.add(addParams(phrase('It'), 'New')))).toBe(code === 'anki_note_failed' ? 'anki_deck_failed' : code);
        expect(anki().notes).toStrictEqual([]);
        expect(actions()).not.toContain('addNote');
    });

    test.each(/** @type {[name: string, fields: ?string[]][]} */ ([
        ['an old type', FIELDS.slice(0, -1)],
        ['a field in another letter case', [...FIELDS.slice(0, -1), 'Flib_Media']],
        ['a renamed Front', ['Face', ...FIELDS.slice(1)]],
        ['no type', null],
    ]))('%s → anki_model_outdated, nothing is written', async (_name, fields) => {
        anki().types.delete('Phrases');
        if (fields !== null) { anki().types.set('Phrases', fields); }
        expect(await codeOf(makeWorker().notes.add(addParams(phrase('It'), 'New')))).toBe('anki_model_outdated');
        expect(writes()).toStrictEqual([]);
    });

    test('the type or the deck goes right before addNote', async () => {
        answer = ({action}) => {
            if (action === 'addNote') { anki().types.delete('Phrases'); }
            return void 0;
        };
        expect(await codeOf(makeWorker().notes.add(addParams()))).toBe('anki_model_outdated');
        anki().types.set('Phrases', FIELDS);
        answer = ({action}) => {
            if (action === 'addNote') { anki().decks = []; }
            return void 0;
        };
        expect(await codeOf(makeWorker().notes.add(addParams()))).toBe('anki_deck_failed');
    });

    test.each(/** @type {[object][]} */ ([
        [{deckName: ''}],
        [{fields: null}],
        [{fields: []}],
        [{fields: {Front: 'It', EnglishWord: ''}}],
        [{fields: {Front: '', EnglishWord: 'It'}}],
        [{fields: {Front: 'It'}}],
        [{fields: {Front: 'It', EnglishWord: 'It', Expression: 5}}],
        [{fields: {Front: 'It', EnglishWord: 'It', flib_media: null}}],
        [{fields: {Front: 'It', EnglishWord: 'It', flib_media: {length: 1}}}],
        [{tags: 'x'}],
        [{tags: [5]}],
    ]))('%j is refused', async (change) => {
        expect(await codeOf(makeWorker().notes.add(/** @type {*} */ ({...addParams(), ...change})))).toBe('flib_bad_request');
        expect(sent).toStrictEqual([]);
    });

    test('the longest flib_media; one more character is refused', async () => {
        const limit = 2 * 1024 * 1024;
        expect(await codeOf(makeWorker().notes.add(addParams(phrase('It', 'x'.repeat(limit + 1)))))).toBe('flib_bad_request');
        expect(sent).toStrictEqual([]);
        expect((await makeWorker().notes.add(addParams(phrase('It', 'x'.repeat(limit))))).existed).toBe(false);
    });

    test('what the page changes in its object after the call is not written', async () => {
        const params = addParams(phrase('It'));
        const promise = makeWorker().notes.add(params);
        params.fields.Front = 'Changed';
        params.tags = [];
        await promise;
        expect(anki().notes[0]).toMatchObject({fields: {Front: 'It'}, tags: TAGS});
    });
});

describe('add: the lock', () => {
    test('two at once → one note', async () => {
        const {notes} = makeWorker();
        const results = await Promise.all([notes.add(addParams()), notes.add(addParams()), notes.add(addParams())]);
        expect(results).toStrictEqual([{noteId: 1000, existed: false}, {noteId: 1000, existed: true}, {noteId: 1000, existed: true}]);
        expect(anki().notes).toHaveLength(1);
        expect(writes()).toStrictEqual(['addNote']);
    });

    test('NFD and NFC, another letter case of the deck: the same lock', async () => {
        const {notes} = makeWorker();
        const nfc = {...phrase('caf\u00E9')};
        const nfd = Object.fromEntries(Object.entries(nfc).map(([name, value]) => [name, value.normalize('NFD')]));
        const results = await Promise.all([notes.add(addParams(nfc)), notes.add(addParams(nfd, 'FLIBOOSTER'))]);
        expect(results.map(({existed}) => existed)).toStrictEqual([false, true]);
        expect(anki().notes).toHaveLength(1);
    });

    test('different cards at once → each is added', async () => {
        const {notes} = makeWorker();
        const results = await Promise.all([
            notes.add(addParams(phrase('I [love] it'))),
            notes.add(addParams({...phrase('I [love] it'), EnglishWord: 'hate'})),
            notes.add(addParams(phrase('I [love] it'), 'Default')),
            notes.add(addParams(phrase('We [love] it'))),
        ]);
        expect(results.every(({existed}) => !existed)).toBe(true);
        expect(anki().notes).toHaveLength(4);
    });

    test('one that hangs does not hold another card, nor the same one for ever', async () => {
        const {notes} = makeWorker({timeoutMs: 200});
        let hangs = 1;
        answer = ({action}) => (action === 'findNotes' && hangs-- > 0 ? /** @type {*} */ (never()) : void 0);
        const fields = phrase('I [love] it');
        let isFirstDone = false;
        const first = codeOf(notes.add(addParams(fields))).finally(() => { isFirstDone = true; });
        const second = notes.add(addParams(fields));
        const others = await Promise.all([
            notes.add(addParams({...fields, EnglishWord: 'hate'})),
            notes.add(addParams({...fields, Front: 'We _____ it'})),
            notes.add(addParams(fields, 'Default')),
        ]);
        expect(others.map(({existed}) => existed)).toStrictEqual([false, false, false]);
        expect(isFirstDone).toBe(false);
        expect(await first).toBe('anki_note_failed');
        expect((await second).existed).toBe(false);
        expect(anki().notes).toHaveLength(4);
    });

    test('after a failure the next one adds', async () => {
        const {notes} = makeWorker();
        answer = ({number}) => (number === 0 ? new Response('', {status: 502}) : void 0);
        const [first, second, third] = await Promise.allSettled([notes.add(addParams()), notes.add(addParams()), notes.add(addParams())]);
        expect(first.status).toBe('rejected');
        expect(second).toStrictEqual({status: 'fulfilled', value: {noteId: 1000, existed: false}});
        expect(third).toStrictEqual({status: 'fulfilled', value: {noteId: 1000, existed: true}});
        expect(notes._locks.size).toBe(0);
    });

    test('nothing is kept after a success and after a refusal', async () => {
        const {notes} = makeWorker();
        await notes.add(addParams());
        await codeOf(notes.add({...addParams(), server: CORE}));
        await codeOf(notes.add({...addParams(), deckName: ''}));
        expect(notes._locks.size).toBe(0);
    });
});

describe('add: an answer that did not come', () => {
    /** @type {[name: string, respond: () => (Response|Promise<Response>), code: string][]} */
    const LOST = [
        ...FAILURES,
        ['504 of Core', () => new Response('', {status: 504}), 'anki_note_failed'],
        ['null', () => new Response('null'), 'anki_note_failed'],
        ['no answer', /** @type {*} */ (never), 'anki_note_failed'],
        ['the answer breaks off', () => new Response(new ReadableStream({start: (controller) => { controller.error(new TypeError('network')); }})), 'anki_note_failed'],
    ];

    test.each(LOST)('landed, then %s: it is our note', async (_name, respond) => {
        answer = ({action}, run) => {
            if (action !== 'addNote') { return void 0; }
            run();
            return respond();
        };
        expect(await makeWorker().notes.add(addParams())).toStrictEqual({noteId: 1000, existed: false});
        expect(anki().notes).toHaveLength(1);
        expect(actions()).toStrictEqual(['findNotes', 'modelFieldNames', 'deckNames', 'addNote', 'findNotes', 'notesInfo']);
    });

    test.each(LOST)('did not land, %s: the error after one more find, no second addNote', async (_name, respond, code) => {
        answer = ({action}) => (action === 'addNote' ? respond() : void 0);
        const {code: actual, data} = await rejected(makeWorker().notes.add(addParams(phrase('A secret phrase'))));
        expect(actual).toBe(code);
        expect(JSON.stringify(data)).not.toContain('secret');
        expect(anki().notes).toStrictEqual([]);
        expect(actions()).toStrictEqual(['findNotes', 'modelFieldNames', 'deckNames', 'addNote', 'findNotes']);
    });

    test.each(LOST)('nobody answers the second find either (%s): the first error', async (_name, respond, code) => {
        let failed = false;
        answer = ({action}) => {
            if (action === 'addNote') {
                failed = true;
                return respond();
            }
            return failed ? new Response('', {status: 500}) : void 0;
        };
        expect(await codeOf(makeWorker().notes.add(addParams()))).toBe(code);
        expect(writes()).toStrictEqual(['addNote']);
    });

    test('landed later than the second find: the next press finds it', async () => {
        const {notes} = makeWorker();
        let land = () => /** @type {unknown} */ (void 0);
        answer = ({action}, run) => {
            if (action !== 'addNote') { return void 0; }
            land = run;
            return /** @type {*} */ (never());
        };
        expect(await codeOf(notes.add(addParams()))).toBe('anki_note_failed');
        land();
        expect(await notes.add(addParams())).toStrictEqual({noteId: 1000, existed: true});
    });
});

describe('add: between the requests', () => {
    test('another worker (a restart) adds between find and add', async () => {
        const fields = phrase('I [love] it');
        expect(await find(fields.Front, fields.EnglishWord)).toStrictEqual([]);
        const first = await makeWorker().notes.add(addParams(fields));
        expect(await makeWorker().notes.add(addParams(fields))).toStrictEqual({noteId: first.noteId, existed: true});
        expect(anki().notes).toHaveLength(1);
    });

    test('the server is not the current one', async () => {
        const {notes, client} = makeWorker();
        client.server = CORE;
        servers[CORE] = new FakeAnki();
        expect(await codeOf(notes.add(addParams()))).toBe('anki_route_switched');
        expect(sent).toStrictEqual([]);
    });

    test.each([0, 1, 2, 3])('the address changes during request %i: no note at the other Anki', async (number) => {
        const {notes, client} = makeWorker();
        servers[CORE] = new FakeAnki();
        answer = (request) => {
            if (request.number === number) { client.server = CORE; }
            return void 0;
        };
        // With a missing deck: findNotes, modelFieldNames, deckNames, createDeck.
        expect(await codeOf(notes.add(addParams(phrase('It'), 'New')))).toBe('anki_route_switched');
        expect(anki().notes).toStrictEqual([]);
        expect(servers[CORE].notes).toStrictEqual([]);
        expect(sent.filter(({server}) => server === CORE)).toStrictEqual([]);
    });

    test.each([0, 1, 2, 3, 4])('the client moves to another Anki at request %i: no note there', async (number) => {
        const {notes, client} = makeWorker();
        servers[CORE] = new FakeAnki();
        client.networkFailureHandler = async () => {
            client.server = CORE;
            return {server: CORE, switchedMessage: 'press again'};
        };
        answer = (request) => {
            if (request.number === number && request.server === DIRECT) { throw new TypeError('Failed to fetch'); }
            return void 0;
        };
        expect(await codeOf(notes.add(addParams(phrase('It'), 'New')))).toBe('anki_route_switched');
        expect(anki().notes).toStrictEqual([]);
        expect(servers[CORE].notes).toStrictEqual([]);
        expect(sent.filter(({server}) => server === CORE)).toStrictEqual([]);
    });

    test('the address changes while addNote answers: the note is there, it is a success', async () => {
        const {notes, client} = makeWorker();
        answer = ({action}) => {
            if (action === 'addNote') { client.server = CORE; }
            return void 0;
        };
        expect(await notes.add(addParams())).toStrictEqual({noteId: 1000, existed: false});
    });

    test.each([0, 1, 2, 3, 4])('Anki closes before request %i, Flibooster runs → anki_closed, no note', async (number) => {
        answer = (request) => (request.number >= number ? new Response('', {status: 502}) : void 0);
        expect(await codeOf(makeWorker().notes.add(addParams(phrase('It'), 'New')))).toBe('anki_closed');
        expect(anki().notes).toStrictEqual([]);
    });

    test.each([0, 1, 2, 3, 4])('AnkiConnect is switched off during request %i', async (number) => {
        const {notes, client} = makeWorker();
        answer = (request) => {
            if (request.number === number) {
                client.enabled = false;
                if (request.action === 'addNote') { throw new TypeError('Failed to fetch'); }
            }
            return void 0;
        };
        expect(await codeOf(notes.add(addParams(phrase('It'), 'New')))).toBe(number === 4 ? 'anki_closed' : 'anki_note_failed');
        expect(anki().notes).toStrictEqual([]);
    });
});

describe('updateMedia', () => {
    const OWN = {flib_media: 'old', ExpressionTranslate: 'моё', Audio_front: '[sound:a.mp3]'};

    /**
     * @param {number} noteId
     * @param {string} [html]
     * @returns {{server: string, noteId: number, deckName: string, html: string}}
     */
    const params = (noteId, html = '+new') => ({server: DIRECT, noteId, deckName: DECK, html});

    test('only flib_media is written, merged with what is in Anki now', async () => {
        const id = anki().put('It', 'It', {fields: OWN});
        const {notes} = makeWorker();
        expect(await notes.updateMedia(params(id))).toStrictEqual({});
        expect(anki().get(id)?.fields).toMatchObject({...OWN, Front: 'It', flib_media: 'old+new'});
        expect(sent.at(-1)?.params).toStrictEqual({note: {id, fields: {flib_media: 'old+new'}}});
        expect(actions()).toStrictEqual(['findNotes', 'notesInfo', 'updateNoteFields']);
        expect(queries()).toStrictEqual([`"deck:${DECK}" "note:Phrases" nid:${id}`]);
    });

    test('the merge says that all of it is there: nothing is written', async () => {
        const id = anki().put('It', 'It', {fields: OWN});
        expect(await makeWorker({mergeMedia: async (existing) => existing}).notes.updateMedia(params(id))).toStrictEqual({});
        expect(writes()).toStrictEqual([]);
    });

    test('a note of a subdeck', async () => {
        const id = anki().put('It', 'It', {deck: `${DECK}::Sub`});
        await makeWorker().notes.updateMedia(params(id));
        expect(anki().get(id)?.fields.flib_media).toBe('+new');
    });

    test('two at once: both are kept', async () => {
        const id = anki().put('It', 'It', {fields: OWN});
        const {notes} = makeWorker();
        await Promise.all([notes.updateMedia(params(id, '+a')), notes.updateMedia(params(id, '+b'))]);
        expect(anki().get(id)?.fields.flib_media).toBe('old+a+b');
        expect(notes._locks.size).toBe(0);
    });

    test.each(/** @type {[name: string, change: Partial<FakeNote>][]} */ ([
        ['another deck', {deck: 'Default'}],
        ['another type', {modelName: 'Other'}],
    ]))('%s → anki_note_gone', async (_name, change) => {
        anki().types.set('Other', [...FIELDS]);
        const id = anki().put('It', 'It', {fields: OWN, ...change});
        expect(await codeOf(makeWorker().notes.updateMedia(params(id)))).toBe('anki_note_gone');
        expect(writes()).toStrictEqual([]);
    });

    test('a deleted note → anki_note_gone, at any moment', async () => {
        expect(await codeOf(makeWorker().notes.updateMedia(params(5)))).toBe('anki_note_gone');
        const id = anki().put('It', 'It', {fields: OWN});
        answer = ({action}) => {
            if (action === 'notesInfo') { anki().notes = []; }
            return void 0;
        };
        expect(await codeOf(makeWorker().notes.updateMedia(params(id)))).toBe('anki_note_gone');
        expect(writes()).toStrictEqual([]);
    });

    test('deleted right before the write → an error', async () => {
        const id = anki().put('It', 'It', {fields: OWN});
        answer = ({action}) => {
            if (action === 'updateNoteFields') { anki().notes = []; }
            return void 0;
        };
        expect(await codeOf(makeWorker().notes.updateMedia(params(id)))).toBe('anki_note_failed');
    });

    test('a server that does not understand the search and has the note: not «gone», nothing is written', async () => {
        const id = anki().put('It', 'It', {fields: OWN});
        answer = ({action}) => (action === 'findNotes' ? new Response('[]') : void 0);
        expect(await codeOf(makeWorker().notes.updateMedia(params(id)))).toBe('anki_note_failed');
        expect(writes()).toStrictEqual([]);
    });

    test('a server that ignores the conditions: the type is checked again', async () => {
        anki().types.set('Other', [...FIELDS]);
        const id = anki().put('It', 'It', {modelName: 'Other'});
        answer = ({action}) => (action === 'findNotes' ? new Response(JSON.stringify([5, id])) : void 0);
        expect(await codeOf(makeWorker().notes.updateMedia(params(id)))).toBe('anki_note_gone');
        answer = ({action}) => (action === 'findNotes' ? new Response('[5]') : void 0);
        expect(await codeOf(makeWorker().notes.updateMedia(params(anki().put('It', 'It'))))).toBe('anki_note_gone');
        const asked = anki().put('It', 'It');
        answer = ({action}) => (action === 'notesInfo' ? new Response(JSON.stringify(anki().run('notesInfo', {notes: [asked - 1]}))) : void 0);
        expect(await codeOf(makeWorker().notes.updateMedia(params(asked)))).toBe('anki_note_gone');
        expect(writes()).toStrictEqual([]);
    });

    test.each([['Flib_Media'], ['media']])('the field is %s now → anki_model_outdated: AnkiConnect would drop it', async (name) => {
        anki().types.set('Phrases', [...FIELDS.slice(0, -1), name]);
        const id = anki().put('It', 'It');
        expect(await codeOf(makeWorker().notes.updateMedia(params(id)))).toBe('anki_model_outdated');
        expect(writes()).toStrictEqual([]);
    });

    test.each(FAILURES)('a failed read writes nothing: %s', async (_name, respond, code) => {
        const id = anki().put('It', 'It', {fields: OWN});
        for (const failing of ['findNotes', 'notesInfo']) {
            answer = ({action}) => (action === failing ? respond() : void 0);
            const {code: actual, data} = await rejected(makeWorker().notes.updateMedia(params(id, 'secret')));
            expect(actual).toBe(code);
            expect(JSON.stringify(data)).not.toContain('secret');
        }
        expect(writes()).toStrictEqual([]);
    });

    test.each(FAILURES)('a failed write is an error: %s', async (_name, respond, code) => {
        const id = anki().put('It', 'It', {fields: OWN});
        answer = ({action}) => (action === 'updateNoteFields' ? respond() : void 0);
        const {code: actual, data} = await rejected(makeWorker().notes.updateMedia(params(id, 'secret')));
        expect(actual).toBe(code);
        expect(JSON.stringify(data)).not.toContain('secret');
    });

    test.each(/** @type {[name: string, mergeMedia: () => Promise<any>][]} */ ([
        ['fails', async () => { throw new Error('Offscreen document did not respond'); }],
        ['gives no text', async () => void 0],
        ['hangs', /** @type {*} */ (never)],
    ]))('the merge %s: nothing is written, the next one goes on', async (_name, mergeMedia) => {
        const id = anki().put('It', 'It', {fields: OWN});
        const {notes} = makeWorker({mergeMedia});
        const results = await Promise.all([codeOf(notes.updateMedia(params(id))), codeOf(notes.updateMedia(params(id)))]);
        expect(results).toStrictEqual(['anki_note_failed', 'anki_note_failed']);
        expect(writes()).toStrictEqual([]);
    });

    test('AnkiConnect is off, also right before the write', async () => {
        const id = anki().put('It', 'It', {fields: OWN});
        const client = makeClient();
        const {notes} = makeWorker({client,
            mergeMedia: async (existing, added) => {
                client.enabled = false;
                return existing + added;
            }});
        expect(await codeOf(notes.updateMedia(params(id)))).toBe('anki_note_failed');
        expect(writes()).toStrictEqual([]);
        sent = [];
        expect(await codeOf(notes.updateMedia(params(id)))).toBe('anki_note_failed');
        expect(sent).toStrictEqual([]);
    });

    test.each(['before', 'findNotes', 'notesInfo', 'merge', 'updateNoteFields'])('the address changes (%s) → anki_route_switched, the other Anki is not touched', async (moment) => {
        const id = anki().put('It', 'It', {fields: OWN});
        servers[CORE] = new FakeAnki();
        servers[CORE].nextId = id;
        servers[CORE].put('Other', 'Other', {fields: {flib_media: 'theirs'}});
        const client = makeClient();
        const {notes} = makeWorker({client,
            mergeMedia: async (existing, added) => {
                if (moment === 'merge') { client.server = CORE; }
                return existing + added;
            }});
        if (moment === 'before') { client.server = CORE; }
        answer = ({action}) => {
            if (action === moment) { client.server = CORE; }
            return void 0;
        };
        expect(await codeOf(notes.updateMedia(params(id)))).toBe('anki_route_switched');
        expect(servers[CORE].notes[0].fields.flib_media).toBe('theirs');
        expect(writes()).toStrictEqual(moment === 'updateNoteFields' ? ['updateNoteFields'] : []);
    });

    test.each(/** @type {[object][]} */ ([
        [{noteId: 0}],
        [{noteId: -1}],
        [{noteId: 1.5}],
        [{noteId: '5'}],
        [{noteId: Number.MAX_VALUE}],
        [{noteId: null}],
        [{deckName: ''}],
        [{html: ''}],
        [{html: ' \n'}],
        [{html: 5}],
        [{html: null}],
        [{html: ['x']}],
        [{html: 'x'.repeat(2 * 1024 * 1024 + 1)}],
    ]).map(([change]) => [JSON.stringify(change).slice(0, 40), change]))('%s is refused', async (_name, change) => {
        const id = anki().put('It', 'It');
        expect(await codeOf(makeWorker().notes.updateMedia(/** @type {*} */ ({...params(id), ...change})))).toBe('flib_bad_request');
        expect(sent).toStrictEqual([]);
    });
});

describe('the worker is kept alive', () => {
    test('while a phrase is written, not after', async () => {
        const keepAlive = vi.fn();
        answer = async () => {
            await new Promise((resolve) => { setTimeout(resolve, 5); });
            return /** @type {*} */ (void 0);
        };
        await makeWorker({keepAlive, keepAliveMs: 1, timeoutMs: 1000}).notes.add(addParams());
        const {length} = keepAlive.mock.calls;
        expect(length).toBeGreaterThan(0);
        await new Promise((resolve) => { setTimeout(resolve, 10); });
        expect(keepAlive.mock.calls).toHaveLength(length);
    });
});

describe('the API', () => {
    const PAGE = {id: 'x', url: 'chrome-extension://x/popup.html'};
    const CONTENT = {id: 'x', url: 'https://example.com/', tab: {id: 1}, frameId: 0};
    const NAME = `flib-${'a'.repeat(64)}.webm`;

    /** @type {{action: string, params: any}[]} Messages to the offscreen document. */
    let offscreenMessages = [];

    /**
     * @returns {{api: (sender?: object) => API, backend: Backend}}
     */
    function wire() {
        offscreenMessages = [];
        vi.stubGlobal('chrome', {storage: {local: {}}, runtime: {id: 'x', getURL: (/** @type {string} */ path) => `chrome-extension://x${path}`, getPlatformInfo: () => {}}, offscreen: {}});
        const backend = new Backend(/** @type {*} */ ({
            getUrl: (/** @type {string} */ path) => path,
            sendMessagePromise: async (/** @type {{action: string, params: any}} */ message) => {
                offscreenMessages.push(message);
                return {result: `merged:${message.params.existing}|${message.params.added}`};
            },
        }));
        backend._anki.enabled = true;
        backend._anki.server = DIRECT;
        const api = (/** @type {object} */ sender = PAGE) => new API(/** @type {*} */ ({
            sendMessage: (/** @type {import('api').ApiMessageAny} */ message, /** @type {(response: unknown) => void} */ callback) => {
                if (!backend._onMessage(message, /** @type {*} */ (sender), callback)) { callback(void 0); }
            },
            getLastError: () => null,
        }));
        return {api, backend};
    }

    test('find → add → find → update', async () => {
        const {api} = wire();
        const fields = phrase('I [love] it');
        const card = {server: DIRECT, deckName: DECK, front: fields.Front, englishWord: fields.EnglishWord};
        expect(await api().flibPhraseFind(card)).toStrictEqual({noteIds: []});
        expect(await Promise.all([api().flibPhraseAdd(addParams(fields)), api().flibPhraseAdd(addParams(fields))])).toStrictEqual([{noteId: 1000, existed: false}, {noteId: 1000, existed: true}]);
        expect(await api().flibPhraseFind(card)).toStrictEqual({noteIds: [1000]});
        expect(await api().flibPhraseUpdateMedia({server: DIRECT, noteId: 1000, deckName: DECK, html: 'new'})).toStrictEqual({});
        // The service worker has no DOM, so it cannot tell what is in the field already.
        expect(offscreenMessages).toStrictEqual([{action: 'mergeFlibMediaOffscreen', params: {existing: '', added: 'new'}}]);
        expect(anki().get(1000)?.fields.flib_media).toBe('merged:|new');
    });

    test('the offscreen document merges as the word window does', () => {
        vi.stubGlobal('DOMParser', new JSDOM().window.DOMParser);
        const youtube = (/** @type {string} */ ref) => buildFlibMediaFieldHtml({films: [], youtube: [{ref, startMs: 1000, endMs: 2000, text: 'x', words: []}]});
        const existing = youtube('aaaaaaaaaaa');
        const merge = Offscreen.prototype._mergeFlibMediaHandler;
        expect(merge({existing, added: existing})).toBe(existing);
        const added = youtube('bbbbbbbbbbb');
        const merged = merge({existing, added});
        expect(merged).toBe(mergeFlibMediaFieldHtml(existing, added));
        // Two lists side by side would lie on each other.
        expect(merged).toContain('<div class="flib-yt-more">');
    });

    test('a background page with a DOM (Firefox) merges itself', async () => {
        vi.stubGlobal('DOMParser', new JSDOM().window.DOMParser);
        const {api} = wire();
        const html = buildFlibMediaFieldHtml({films: [], youtube: [{ref: 'aaaaaaaaaaa', startMs: 1000, endMs: 2000, text: 'x', words: []}]});
        const id = anki().put('It', 'It');
        await api().flibPhraseUpdateMedia({server: DIRECT, noteId: id, deckName: DECK, html});
        await api().flibPhraseUpdateMedia({server: DIRECT, noteId: id, deckName: DECK, html});
        expect(anki().get(id)?.fields.flib_media).toBe(html);
        expect(offscreenMessages).toStrictEqual([]);
        expect(writes()).toStrictEqual(['updateNoteFields']);
    });

    test('a failed add makes the next prepare look again; a success and a failed find do not', async () => {
        const {api, backend} = wire();
        const forget = vi.spyOn(backend._getFlibPhraseModelPreparer(), 'forget');
        await api().flibPhraseAdd(addParams());
        await api().flibPhraseAdd(addParams());
        expect(await codeOf(api().flibPhraseFind({server: CORE, deckName: DECK, front: 'x', englishWord: 'x'}))).toBe('anki_route_switched');
        expect(forget).not.toHaveBeenCalled();
        expect(await codeOf(api().flibPhraseAdd({...addParams(), server: CORE}))).toBe('anki_route_switched');
        expect(forget).toHaveBeenCalledTimes(1);
        answer = () => new Response('', {status: 502});
        expect(await codeOf(api().flibPhraseAdd(addParams()))).toBe('anki_closed');
        expect(forget).toHaveBeenCalledTimes(2);
        expect(await codeOf(api().flibPhraseUpdateMedia({server: DIRECT, noteId: 5, deckName: DECK, html: 'x'}))).toBe('anki_closed');
        expect(forget).toHaveBeenCalledTimes(3);
    });

    test.each([
        ['a content script', CONTENT],
        ['another extension', {id: 'y', url: PAGE.url}],
        ['nobody', {}],
    ])('%s is refused', async (_name, sender) => {
        const {api, backend} = wire();
        const forget = vi.spyOn(backend._getFlibPhraseModelPreparer(), 'forget');
        const id = anki().put('It', 'It');
        expect(await codeOf(api(sender).flibPhraseFind({server: DIRECT, deckName: DECK, front: 'It', englishWord: 'It'}))).toBe('flib_secret_forbidden');
        expect(await codeOf(api(sender).flibPhraseAdd(addParams()))).toBe('flib_secret_forbidden');
        expect(await codeOf(api(sender).flibPhraseUpdateMedia({server: DIRECT, noteId: id, deckName: DECK, html: 'x'}))).toBe('flib_secret_forbidden');
        expect(await codeOf(api(sender).flibStoreAnkiMedia(NAME, 'QUJD', true))).toBe('flib_secret_forbidden');
        expect(await codeOf(api(sender).flibAnkiModelHasField('Phrases', 'flib_media', true))).toBe('flib_secret_forbidden');
        expect(sent).toStrictEqual([]);
        expect(forget).not.toHaveBeenCalled();
    });

    describe('noFallback of media and of the field check', () => {
        test('a running Anki', async () => {
            const {api} = wire();
            expect(await api().flibAnkiModelHasField('Phrases', 'flib_media', true)).toBe(true);
            expect(await api().flibAnkiModelHasField('Phrases', 'nope', true)).toBe(false);
            expect(await api().flibStoreAnkiMedia(NAME, 'QUJD', true)).toStrictEqual({fileName: NAME});
            expect(anki().media.get(NAME)).toBe('QUJD');
        });

        test('Anki closes between prepare, the media and the add: anki_closed each time, nothing is written', async () => {
            const {api} = wire();
            await api().flibAnkiModelHasField('Phrases', 'flib_media', true);
            answer = () => new Response('', {status: 502});
            // ⚠️ Not from the cache.
            const errors = [
                await rejected(api().flibAnkiModelHasField('Phrases', 'flib_media', true)),
                await rejected(api().flibStoreAnkiMedia(NAME, 'QUJD', true)),
                await rejected(api().flibPhraseAdd(addParams())),
            ];
            for (const {code, data} of errors) {
                expect(code).toBe('anki_closed');
                expect(JSON.stringify(data)).not.toContain('QUJD');
            }
            expect(anki().notes).toStrictEqual([]);
            expect(anki().media.size).toBe(0);
        });

        test.each([['a connection lost', true], ['the address of the options', false]])('the route switches (%s): anki_route_switched, the other Anki is not asked, the bytes are not in the error', async (_name, lost) => {
            servers[CORE] = new FakeAnki();
            for (const call of [
                (/** @type {API} */ api) => api.flibAnkiModelHasField('Phrases', 'flib_media', true),
                (/** @type {API} */ api) => api.flibStoreAnkiMedia(NAME, 'QUJD', true),
            ]) {
                const {api, backend} = wire();
                backend._anki.networkFailureHandler = async () => {
                    backend._anki.server = CORE;
                    return {server: CORE, switchedMessage: 'press again'};
                };
                answer = ({server, action}) => {
                    if (lost && server === DIRECT) { throw new TypeError('Failed to fetch'); }
                    if (action === 'version') { backend._anki.server = CORE; }
                    return void 0;
                };
                sent = [];
                const {code, data} = await rejected(call(api()));
                expect(code).toBe('anki_route_switched');
                expect(JSON.stringify(data)).not.toContain('QUJD');
                expect(sent.filter(({server}) => server === CORE)).toStrictEqual([]);
            }
            expect(servers[CORE].media.size).toBe(0);
        });

        test('other errors are as for a word', async () => {
            const {api, backend} = wire();
            answer = ({action}) => (action === 'storeMediaFile' ? new Response('', {status: 500}) : void 0);
            expect((await rejected(api().flibStoreAnkiMedia(NAME, 'QUJD', true))).message).toBe('Anki connection error: 500');
            expect(await codeOf(api().flibAnkiModelHasField('Nope', 'flib_media', true))).toBe('flib_anki_model_unknown');
            backend._anki.enabled = false;
            expect(await codeOf(api().flibAnkiModelHasField('Phrases', 'flib_media', true))).toBe('flib_anki_unavailable');
        });

        test('what was answered for a word is not taken', async () => {
            const {api} = wire();
            await api().flibAnkiModelHasField('Phrases', 'flib_media');
            sent = [];
            answer = () => new Response('', {status: 502});
            expect(await codeOf(api().flibAnkiModelHasField('Phrases', 'flib_media', true))).toBe('anki_closed');
        });

        test('its answers are not kept for words', async () => {
            const {api, backend} = wire();
            await api().flibAnkiModelHasField('Phrases', 'flib_media', true);
            expect(backend._flibModelFieldsCache.size).toBe(0);
        });

        test.each([[void 0], [false]])('a word (%j): the request and the message as before', async (noFallback) => {
            const {backend} = wire();
            /** @type {object[]} */
            const messages = [];
            const api = new API(/** @type {*} */ ({
                sendMessage: (/** @type {import('api').ApiMessageAny} */ message, /** @type {(response: unknown) => void} */ callback) => {
                    messages.push(message);
                    backend._onMessage(message, /** @type {*} */ (PAGE), callback);
                },
                getLastError: () => null,
            }));
            await api.flibAnkiModelHasField('Phrases', 'flib_media', noFallback);
            await api.flibAnkiModelHasField('Phrases', 'flib_media', noFallback);
            await api.flibStoreAnkiMedia(NAME, 'QUJD', noFallback);
            expect(messages.slice(1)).toStrictEqual([
                {action: 'flibAnkiModelHasField', params: {modelName: 'Phrases', fieldName: 'flib_media'}},
                {action: 'flibStoreAnkiMedia', params: {fileName: NAME, base64: 'QUJD'}},
            ]);
            expect(sent.map(({action, noFallback: header}) => [action, header])).toStrictEqual([['version', false], ['modelFieldNames', false], ['storeMediaFile', false]]);
            answer = () => new Response('', {status: 502});
            expect(await codeOf(api.flibStoreAnkiMedia(NAME, 'QUJD', noFallback))).toBeUndefined();
            expect(await codeOf(api.flibAnkiModelHasField('Basic', 'Front', noFallback))).toBe('flib_anki_unavailable');
            sent = [];
        });
    });

    describe('a worker that has just started', () => {
        /**
         * The options are applied, the address is not known yet: Core is not running, AnkiConnect is.
         * @returns {{api: (sender?: object) => API, backend: Backend}}
         */
        function wireStarting() {
            const {api, backend} = wire();
            backend._anki.server = CORE;
            vi.spyOn(backend, '_maybeBootstrapVideoExamplesField').mockResolvedValue(void 0);
            const resolver = backend._ankiRouteResolver;
            resolver._fetch = async (input, init = {}) => {
                await new Promise((resolve) => { setTimeout(resolve, 5); });
                if (/** @type {string} */ (input).startsWith(CORE)) { throw new TypeError('Failed to fetch'); }
                expect(init.method).toBe('POST');
                return new Response('{"result":6,"error":null}');
            };
            resolver.configure({primary: CORE, apiKey: null, enabled: true});
            void backend._refreshAnkiRoute(true);
            return {api, backend};
        }

        test.each(/** @type {[name: string, call: (api: API) => Promise<unknown>][]} */ ([
            ['find', (api) => api.flibPhraseFind({server: DIRECT, deckName: DECK, front: 'It', englishWord: 'It'})],
            ['add', (api) => api.flibPhraseAdd(addParams())],
            ['update', (api) => api.flibPhraseUpdateMedia({server: DIRECT, noteId: 1000, deckName: DECK, html: 'x'})],
        ]))('%s waits for the address, it is not a switch', async (_name, call) => {
            anki().put('It', 'It');
            const {api} = wireStarting();
            await call(api());
            expect([...new Set(sent.map(({server}) => server))]).toStrictEqual([DIRECT]);
        });

        test('prepare too: it answers with the final address', async () => {
            const {api, backend} = wireStarting();
            const prepare = vi.spyOn(backend._getFlibPhraseModelPreparer(), 'prepare').mockImplementation(async () => ({server: backend._anki.server ?? '', templateCustomised: false, modelRevision: ''}));
            expect((await api().flibPhrasePrepare()).server).toBe(DIRECT);
            expect(prepare).toHaveBeenCalledTimes(1);
        });
    });
});
/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
