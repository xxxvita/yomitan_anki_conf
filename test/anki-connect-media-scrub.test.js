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
import {ExtensionError} from '../ext/js/core/extension-error.js';
import {parseJson} from '../ext/js/core/json.js';

const SERVER = 'http://127.0.0.1:8765';
const OTHER = 'http://127.0.0.1:8777';
// Recognisable payload: if any fragment of it leaks, the assertion finds it.
const BASE64 = 'QUJD'.repeat(64);

/** @typedef {'ok'|'down'|'http500'|'apiError'|'badJson'} Behaviour */

/** @type {Map<string, Behaviour>} */
let behaviours = new Map();
/** @type {Array<{server: string, body: Record<string, unknown>}>} */
let requests = [];

/** @type {typeof fetch} */
const fakeFetch = async (input, init = {}) => {
    const server = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
    /** @type {Record<string, unknown>} */
    const body = parseJson(typeof init.body === 'string' ? init.body : '{}');
    requests.push({server, body});
    const action = /** @type {string} */ (body.action);
    const behaviour = action === 'version' ? 'ok' : (behaviours.get(server) ?? 'down');
    switch (behaviour) {
        case 'down': throw new TypeError('Failed to fetch');
        case 'http500': return new Response('boom', {status: 500});
        case 'badJson': return new Response('{not json', {status: 200});
        case 'apiError': return new Response(JSON.stringify({result: null, error: 'disk full'}), {status: 200});
        default: return new Response(JSON.stringify(action === 'version' ? 6 : 'stored.webm'), {status: 200});
    }
};

/**
 * @returns {AnkiConnect}
 */
function makeAnki() {
    const anki = new AnkiConnect();
    anki.enabled = true;
    anki.server = SERVER;
    return anki;
}

/**
 * @param {Promise<unknown>} promise
 * @returns {Promise<ExtensionError>}
 */
async function caught(promise) {
    try {
        await promise;
    } catch (e) {
        expect(e).toBeInstanceOf(ExtensionError);
        return /** @type {ExtensionError} */ (e);
    }
    throw new Error('expected a rejection');
}

/**
 * @param {ExtensionError} error
 */
function expectNoBase64(error) {
    const serialized = JSON.stringify(ExtensionError.serialize(error));
    expect(serialized).not.toContain('QUJDQUJD');
    expect(error.message).not.toContain('QUJD');
}

beforeEach(() => {
    behaviours = new Map();
    requests = [];
    vi.stubGlobal('fetch', fakeFetch);
});

afterEach(() => {
    vi.unstubAllGlobals();
});

describe('AnkiConnect: base64 of storeMediaFile never reaches error.data (edge case 8)', () => {
    test.each(/** @type {Behaviour[]} */ (['down', 'http500', 'apiError', 'badJson']))('%s → data replaced by a size note, file name kept', async (behaviour) => {
        behaviours.set(SERVER, behaviour);
        const error = await caught(makeAnki().storeMediaFile('flib-x.webm', BASE64));
        expectNoBase64(error);
        const data = /** @type {{action: string, params: {filename: string, data: string}}} */ (error.data);
        expect(data.action).toBe('storeMediaFile');
        expect(data.params).toStrictEqual({filename: 'flib-x.webm', data: `<${BASE64.length} base64 chars omitted>`});
    });

    test('the request itself still carries the full payload', async () => {
        behaviours.set(SERVER, 'ok');
        await expect(makeAnki().storeMediaFile('flib-x.webm', BASE64)).resolves.toBe('stored.webm');
        const store = requests.find((r) => r.body.action === 'storeMediaFile');
        expect(store?.body.params).toStrictEqual({filename: 'flib-x.webm', data: BASE64});
    });

    test('route switch then failed retry: the final error is scrubbed too', async () => {
        const anki = makeAnki();
        anki.networkFailureHandler = async () => {
            anki.server = OTHER;
            return {server: OTHER, switchedMessage: 'switched'};
        };
        const error = await caught(anki.storeMediaFile('flib-x.webm', BASE64));
        expectNoBase64(error);
        // storeMediaFile is retryable: exactly one retry on the new route.
        expect(requests.filter((r) => r.body.action === 'storeMediaFile').map((r) => r.server)).toStrictEqual([SERVER, OTHER]);
    });

    test('storeMediaFile inside multi is scrubbed; other actions keep their params', async () => {
        behaviours.set(SERVER, 'http500');
        // eslint-disable-next-line no-underscore-dangle
        const error = await caught(makeAnki()._invokeMulti([
            {action: 'storeMediaFile', params: {filename: 'a.webm', data: BASE64}},
            {action: 'deckNames', params: {}},
        ]));
        expectNoBase64(error);
        const data = /** @type {{params: {actions: unknown[]}}} */ (error.data);
        expect(data.params.actions).toStrictEqual([
            {action: 'storeMediaFile', params: {filename: 'a.webm', data: `<${BASE64.length} base64 chars omitted>`}},
            {action: 'deckNames', params: {}},
        ]);
    });

    test('non-media actions keep their params unchanged', async () => {
        behaviours.set(SERVER, 'http500');
        const error = await caught(makeAnki().findNotes('deck:x'));
        const data = /** @type {{params: unknown}} */ (error.data);
        expect(data.params).toStrictEqual({query: 'deck:x'});
    });
});
