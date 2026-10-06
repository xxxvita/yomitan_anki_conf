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

const CORE = 'http://127.0.0.1:8777';
const DIRECT = 'http://127.0.0.1:8765';

/** @typedef {'ok'|'down'|'http500'} Behaviour */

/**
 * @typedef {object} Call
 * @property {string} server
 * @property {string} action
 */

/** @type {Call[]} */
let calls = [];
/** @type {Map<string, Behaviour>} key = `${server} ${action}` or `${server} *` */
let behaviours = new Map();

/**
 * @param {string} server
 * @param {string} action
 * @param {Behaviour} behaviour
 */
function on(server, action, behaviour) {
    behaviours.set(`${server} ${action}`, behaviour);
}

/** @type {typeof fetch} */
const fakeFetch = async (input, init = {}) => {
    const server = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
    /** @type {{action: string}} */
    const body = parseJson(typeof init.body === 'string' ? init.body : '{}');
    const action = body.action;
    calls.push({server, action});
    const behaviour = behaviours.get(`${server} ${action}`) ?? behaviours.get(`${server} *`) ?? 'down';
    if (behaviour === 'down') { throw new TypeError('Failed to fetch'); }
    if (behaviour === 'http500') { return new Response('boom', {status: 500}); }
    /** @type {unknown} */
    let result = null;
    switch (action) {
        case 'version': result = 6; break;
        case 'deckNames': result = ['Default']; break;
        case 'addNote': result = 123; break;
    }
    // Yomitan sends version=2, so AnkiConnect (and Core's proxy) answer with the bare result.
    return new Response(JSON.stringify(result), {status: 200});
};

/**
 * @param {boolean} allowDuplicate
 * @returns {import('anki').Note}
 */
function note(allowDuplicate) {
    return {
        fields: {Front: 'x'},
        tags: [],
        deckName: 'Default',
        modelName: 'Basic',
        options: {
            allowDuplicate,
            duplicateScope: 'collection',
            duplicateScopeOptions: {deckName: null, checkChildren: false, checkAllModels: false},
        },
    };
}

/**
 * @param {?string} [switchTo] Server the handler routes to (null keeps the failed one).
 * @returns {{anki: AnkiConnect, handlerCalls: string[]}}
 */
function makeAnki(switchTo = DIRECT) {
    const anki = new AnkiConnect();
    anki.enabled = true;
    anki.server = CORE;
    /** @type {string[]} */
    const handlerCalls = [];
    anki.networkFailureHandler = async (failedServer) => {
        handlerCalls.push(failedServer);
        const next = switchTo ?? failedServer;
        anki.server = next;
        return next;
    };
    return {anki, handlerCalls};
}

beforeEach(() => {
    calls = [];
    behaviours = new Map();
    vi.stubGlobal('fetch', fakeFetch);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('AnkiConnect route fallback', () => {
    test('a read call that hits a dead Core is re-routed once and succeeds on AnkiConnect', async () => {
        on(DIRECT, '*', 'ok');
        const {anki, handlerCalls} = makeAnki();
        await expect(anki.getDeckNames()).resolves.toStrictEqual(['Default']);
        expect(handlerCalls).toStrictEqual([CORE]);
        expect(calls).toStrictEqual([
            {server: CORE, action: 'version'},
            {server: DIRECT, action: 'version'},
            {server: DIRECT, action: 'deckNames'},
        ]);
    });

    test('addNote (duplicates forbidden) whose Core died is retried once on the new route', async () => {
        on(CORE, 'version', 'ok');
        on(CORE, 'addNote', 'down');
        on(DIRECT, '*', 'ok');
        const {anki, handlerCalls} = makeAnki();
        await expect(anki.addNote(note(false))).resolves.toBe(123);
        expect(handlerCalls).toStrictEqual([CORE]);
        expect(calls.filter((c) => c.action === 'addNote')).toStrictEqual([
            {server: CORE, action: 'addNote'},
            {server: DIRECT, action: 'addNote'},
        ]);
    });

    test('addNote is retried at most once even when the new route is dead too', async () => {
        on(CORE, 'version', 'ok');
        const {anki, handlerCalls} = makeAnki();
        await expect(anki.addNote(note(false))).rejects.toThrow('Anki connection failure');
        expect(handlerCalls).toHaveLength(1);
        expect(calls.filter((c) => c.action === 'addNote')).toHaveLength(2);
    });

    test('addNote with allowDuplicate=true re-resolves the route but is NOT retried (a delivered first attempt would double the note)', async () => {
        on(CORE, 'version', 'ok');
        on(DIRECT, '*', 'ok');
        const {anki, handlerCalls} = makeAnki();
        await expect(anki.addNote(note(true))).rejects.toThrow('Anki connection failure');
        expect(handlerCalls).toStrictEqual([CORE]);
        expect(calls.filter((c) => c.action === 'addNote')).toHaveLength(1);
        expect(anki.server).toBe(DIRECT);
    });

    test('non-idempotent addNotes is not retried', async () => {
        on(CORE, 'version', 'ok');
        on(DIRECT, '*', 'ok');
        const {anki} = makeAnki();
        await expect(anki.addNotes([note(false)])).rejects.toThrow('Anki connection failure');
        expect(calls.filter((c) => c.action === 'addNotes')).toHaveLength(1);
    });

    test('no retry when the re-resolved route is the same server', async () => {
        const {anki, handlerCalls} = makeAnki(null);
        await expect(anki.getDeckNames()).rejects.toThrow('Anki connection failure');
        expect(handlerCalls).toStrictEqual([CORE]);
        expect(calls).toStrictEqual([{server: CORE, action: 'version'}]);
    });

    test('an HTTP error is not a network failure: no re-resolve, no retry', async () => {
        on(CORE, '*', 'http500');
        const {anki, handlerCalls} = makeAnki();
        await expect(anki.getDeckNames()).rejects.toThrow('Anki connection error: 500');
        expect(handlerCalls).toHaveLength(0);
        expect(calls).toHaveLength(1);
    });

    test('a handler that throws does not mask the original failure', async () => {
        const anki = new AnkiConnect();
        anki.enabled = true;
        anki.server = CORE;
        anki.networkFailureHandler = async () => { throw new Error('resolver exploded'); };
        await expect(anki.getDeckNames()).rejects.toThrow('Anki connection failure');
    });
});

describe('AnkiConnect server switch', () => {
    test('changing the server resets the cached remote version; re-assigning the same server does not', async () => {
        on(CORE, '*', 'ok');
        on(DIRECT, '*', 'ok');
        const anki = new AnkiConnect();
        anki.enabled = true;
        anki.server = CORE;
        await anki.getDeckNames();
        await anki.getDeckNames();
        expect(calls.filter((c) => c.action === 'version')).toHaveLength(1);

        anki.server = CORE;
        await anki.getDeckNames();
        expect(calls.filter((c) => c.action === 'version')).toHaveLength(1);

        anki.server = DIRECT;
        await anki.getDeckNames();
        expect(calls.filter((c) => c.action === 'version')).toStrictEqual([
            {server: CORE, action: 'version'},
            {server: DIRECT, action: 'version'},
        ]);
    });
});
