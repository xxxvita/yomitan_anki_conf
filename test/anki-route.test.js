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

import {describe, expect, test} from 'vitest';
import {
    ANKI_DIRECT_SERVER,
    AnkiRouteResolver,
    isDirectAnkiConnectUrl,
    isRetryableAnkiAction,
    resolveAnkiRoute,
} from '../ext/js/comm/anki-route.js';
import {parseJson} from '../ext/js/core/json.js';

const CORE = 'http://127.0.0.1:8777';

/**
 * @typedef {object} Call
 * @property {string} url
 * @property {string} method
 * @property {unknown} body
 */

/**
 * @typedef {'ok'|'down'|'hang'|'html'|((call: Call) => Response)} Behaviour
 */

/**
 * Поддельная сеть: поведение подбирается по origin запроса.
 * 'down' — fetch отклоняется (как ECONNREFUSED), 'hang' — висит до abort.
 * @param {{core?: Behaviour, direct?: Behaviour}} behaviours
 * @returns {{fetch: typeof fetch, calls: Call[]}}
 */
function makeFetch({core = 'down', direct = 'down'}) {
    /** @type {Call[]} */
    const calls = [];
    /** @type {typeof fetch} */
    const fakeFetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
        const method = typeof init.method === 'string' ? init.method : 'GET';
        /** @type {unknown} */
        const body = typeof init.body === 'string' ? parseJson(init.body) : null;
        const call = {url, method, body};
        calls.push(call);
        const behaviour = url.startsWith(ANKI_DIRECT_SERVER) ? direct : core;
        if (typeof behaviour === 'function') { return behaviour(call); }
        switch (behaviour) {
            case 'down':
                throw new TypeError('Failed to fetch');
            case 'hang':
                return await new Promise((_resolve, reject) => {
                    const signal = init.signal;
                    if (signal) {
                        signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
                    }
                });
            case 'html':
                return new Response('<html><body>hello</body></html>', {status: 200, headers: {'Content-Type': 'text/html'}});
            case 'ok':
                if (url.startsWith(ANKI_DIRECT_SERVER)) {
                    return new Response(JSON.stringify({result: 6, error: null}), {status: 200});
                }
                return new Response(JSON.stringify({status: 'healthy', service: 'core'}), {status: 200});
        }
        throw new Error('unreachable');
    };
    return {fetch: fakeFetch, calls};
}

/**
 * @returns {{now: () => number, advance: (ms: number) => void}}
 */
function makeClock() {
    let t = 1_000_000;
    return {now: () => t, advance: (ms) => { t += ms; }};
}

describe('resolveAnkiRoute', () => {
    test('Core alive → mode core, both URLs point at Core', async () => {
        const {fetch, calls} = makeFetch({core: 'ok', direct: 'ok'});
        const route = await resolveAnkiRoute({primary: CORE, apiKey: null, fetch, now: () => 42, timeoutMs: 100});
        expect(route).toStrictEqual({mode: 'core', ankiServer: CORE, coreBase: CORE, checkedAt: 42});
        expect(calls.map((c) => `${c.method} ${c.url}`)).toStrictEqual([`GET ${CORE}/api/v1/health`]);
    });

    test('primary is trimmed and its trailing slash does not double in the health URL', async () => {
        const {fetch, calls} = makeFetch({core: 'ok'});
        const route = await resolveAnkiRoute({primary: `  ${CORE}/  `, apiKey: null, fetch, now: () => 1, timeoutMs: 100});
        expect(route.mode).toBe('core');
        expect(route.ankiServer).toBe(`${CORE}/`);
        expect(calls[0].url).toBe(`${CORE}/api/v1/health`);
    });

    test('Core down, AnkiConnect alive → mode direct on 8765', async () => {
        const {fetch, calls} = makeFetch({core: 'down', direct: 'ok'});
        const route = await resolveAnkiRoute({primary: CORE, apiKey: 'k', fetch, now: () => 7, timeoutMs: 100});
        expect(route).toStrictEqual({mode: 'direct', ankiServer: ANKI_DIRECT_SERVER, coreBase: null, checkedAt: 7});
        expect(calls).toHaveLength(2);
        expect(calls[1].method).toBe('POST');
        expect(calls[1].body).toStrictEqual({action: 'version', version: 6, key: 'k'});
    });

    test('both down → mode none, ankiServer stays the primary so the existing errors stay as they are', async () => {
        const {fetch} = makeFetch({core: 'down', direct: 'down'});
        const route = await resolveAnkiRoute({primary: CORE, apiKey: null, fetch, now: () => 1, timeoutMs: 100});
        expect(route).toStrictEqual({mode: 'none', ankiServer: CORE, coreBase: null, checkedAt: 1});
    });

    test('primary is 8765 → direct without probing Core', async () => {
        const {fetch, calls} = makeFetch({core: 'ok', direct: 'ok'});
        const route = await resolveAnkiRoute({primary: 'http://127.0.0.1:8765', apiKey: null, fetch, now: () => 1, timeoutMs: 100});
        expect(route.mode).toBe('direct');
        expect(route.ankiServer).toBe('http://127.0.0.1:8765');
        expect(route.coreBase).toBeNull();
        expect(calls.some((c) => c.url.includes('/api/v1/health'))).toBe(false);
    });

    test('primary is localhost:8765 → also treated as the direct AnkiConnect, no Core probe', async () => {
        /** @type {string[]} */
        const urls = [];
        /** @type {typeof fetch} */
        const fetchFn = async (input) => {
            urls.push(typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url));
            return new Response(JSON.stringify({result: 6, error: null}), {status: 200});
        };
        const route = await resolveAnkiRoute({primary: 'http://localhost:8765/', apiKey: null, fetch: fetchFn, now: () => 1, timeoutMs: 100});
        expect(route.mode).toBe('direct');
        expect(route.ankiServer).toBe('http://localhost:8765/');
        expect(urls).toStrictEqual(['http://localhost:8765/']);
    });

    test('primary is 8765 and it is down → none (the user chose direct, nothing answers)', async () => {
        const {fetch} = makeFetch({direct: 'down'});
        const route = await resolveAnkiRoute({primary: ANKI_DIRECT_SERVER, apiKey: null, fetch, now: () => 1, timeoutMs: 100});
        expect(route).toStrictEqual({mode: 'none', ankiServer: ANKI_DIRECT_SERVER, coreBase: null, checkedAt: 1});
    });

    test('health 200 with an HTML body is NOT Core (some other service on that port) → falls back', async () => {
        const {fetch} = makeFetch({core: 'html', direct: 'ok'});
        const route = await resolveAnkiRoute({primary: CORE, apiKey: null, fetch, now: () => 1, timeoutMs: 100});
        expect(route.mode).toBe('direct');
    });

    test('health 503 is not alive', async () => {
        const {fetch} = makeFetch({core: () => new Response('{"status":"down"}', {status: 503}), direct: 'down'});
        const route = await resolveAnkiRoute({primary: CORE, apiKey: null, fetch, now: () => 1, timeoutMs: 100});
        expect(route.mode).toBe('none');
    });

    test('health that hangs is cut by the timeout and the fallback is still probed', async () => {
        const {fetch} = makeFetch({core: 'hang', direct: 'ok'});
        const started = Date.now();
        const route = await resolveAnkiRoute({primary: CORE, apiKey: null, fetch, now: () => 1, timeoutMs: 30});
        expect(route.mode).toBe('direct');
        expect(Date.now() - started).toBeLessThan(1000);
    });

    test('AnkiConnect that answers with an api-key error is still alive (wrong key is reported later)', async () => {
        const {fetch} = makeFetch({direct: () => new Response(JSON.stringify({result: null, error: 'valid api key must be provided'}), {status: 200})});
        const route = await resolveAnkiRoute({primary: CORE, apiKey: null, fetch, now: () => 1, timeoutMs: 100});
        expect(route.mode).toBe('direct');
    });

    test('a non-AnkiConnect answer on 8765 is not alive', async () => {
        const {fetch} = makeFetch({direct: 'html'});
        const route = await resolveAnkiRoute({primary: CORE, apiKey: null, fetch, now: () => 1, timeoutMs: 100});
        expect(route.mode).toBe('none');
    });

    test('empty primary → none without any network', async () => {
        const {fetch, calls} = makeFetch({});
        const route = await resolveAnkiRoute({primary: '   ', apiKey: null, fetch, now: () => 1, timeoutMs: 100});
        expect(route.mode).toBe('none');
        expect(calls.length).toBeLessThanOrEqual(1);
    });
});

describe('isDirectAnkiConnectUrl', () => {
    test.each([
        ['http://127.0.0.1:8765', true],
        ['http://127.0.0.1:8765/', true],
        ['http://localhost:8765', true],
        ['http://127.0.0.1:8777', false],
        ['http://192.168.1.5:8765', false],
        ['not a url', false],
        ['', false],
    ])('%s → %s', (url, expected) => {
        expect(isDirectAnkiConnectUrl(url)).toBe(expected);
    });
});

describe('AnkiRouteResolver', () => {
    test('caches for the TTL and re-probes after it', async () => {
        const {fetch, calls} = makeFetch({core: 'ok'});
        const clock = makeClock();
        const resolver = new AnkiRouteResolver({fetch, now: clock.now, ttlMs: 30_000, timeoutMs: 100});
        resolver.configure({primary: CORE, apiKey: null});
        await resolver.getRoute();
        clock.advance(29_999);
        await resolver.getRoute();
        expect(calls).toHaveLength(1);
        clock.advance(2);
        await resolver.getRoute();
        expect(calls).toHaveLength(2);
    });

    test('force bypasses the cache', async () => {
        const {fetch, calls} = makeFetch({core: 'ok'});
        const resolver = new AnkiRouteResolver({fetch, now: () => 5, timeoutMs: 100});
        resolver.configure({primary: CORE, apiKey: null});
        await resolver.getRoute();
        await resolver.getRoute({force: true});
        expect(calls).toHaveLength(2);
    });

    test('concurrent callers share one in-flight probe', async () => {
        const {fetch, calls} = makeFetch({core: 'ok'});
        const resolver = new AnkiRouteResolver({fetch, now: () => 5, timeoutMs: 100});
        resolver.configure({primary: CORE, apiKey: null});
        const [a, b, c] = await Promise.all([resolver.getRoute({force: true}), resolver.getRoute({force: true}), resolver.getRoute()]);
        expect(calls).toHaveLength(1);
        expect(a).toStrictEqual(b);
        expect(b).toStrictEqual(c);
    });

    test('configure with a new primary invalidates the cache; the same primary does not', async () => {
        const {fetch, calls} = makeFetch({core: 'ok'});
        const resolver = new AnkiRouteResolver({fetch, now: () => 5, timeoutMs: 100});
        resolver.configure({primary: CORE, apiKey: null});
        await resolver.getRoute();
        resolver.configure({primary: CORE, apiKey: null});
        await resolver.getRoute();
        expect(calls).toHaveLength(1);
        resolver.configure({primary: 'http://127.0.0.1:9999', apiKey: null});
        const route = await resolver.getRoute();
        expect(calls).toHaveLength(2);
        expect(route.ankiServer).toBe('http://127.0.0.1:9999');
    });

    test('a probe that was in flight when the primary changed does not poison the cache', async () => {
        /** @type {(value: Response) => void} */
        let releaseFirst = () => {};
        let n = 0;
        /** @type {typeof fetch} */
        const fetchFn = async (input) => {
            ++n;
            if (n === 1) {
                return await new Promise((resolve) => { releaseFirst = resolve; });
            }
            void input;
            return new Response(JSON.stringify({status: 'healthy'}), {status: 200});
        };
        const resolver = new AnkiRouteResolver({fetch: fetchFn, now: () => 5, timeoutMs: 10_000});
        resolver.configure({primary: CORE, apiKey: null});
        const stale = resolver.getRoute();
        resolver.configure({primary: 'http://127.0.0.1:9999', apiKey: null});
        const fresh = await resolver.getRoute();
        releaseFirst(new Response(JSON.stringify({status: 'healthy'}), {status: 200}));
        await stale;
        expect(fresh.ankiServer).toBe('http://127.0.0.1:9999');
        expect(resolver.peek()?.ankiServer).toBe('http://127.0.0.1:9999');
    });

    test('peek is null before the first resolve', () => {
        const {fetch} = makeFetch({});
        const resolver = new AnkiRouteResolver({fetch, now: () => 5});
        expect(resolver.peek()).toBeNull();
    });
});

describe('isRetryableAnkiAction', () => {
    /**
     * @param {boolean} allowDuplicate
     * @returns {import('core').SerializableObject}
     */
    const addNoteParams = (allowDuplicate) => ({note: {fields: {}, tags: [], deckName: 'd', modelName: 'm', options: {allowDuplicate}}});

    test.each([
        'version',
        'deckNames',
        'modelNames',
        'modelFieldNames',
        'canAddNotes',
        'canAddNotesWithErrorDetail',
        'notesInfo',
        'cardsInfo',
        'findNotes',
        'findCards',
        'apiReflect',
        'updateNoteFields',
        'storeMediaFile',
    ])('read/idempotent %s is retryable', (action) => {
        expect(isRetryableAnkiAction(action, {})).toBe(true);
    });

    test.each(['addNotes', 'modelFieldAdd', 'sync', 'suspend', 'guiEditNote', 'guiBrowse', 'somethingNew'])('%s is not retryable', (action) => {
        expect(isRetryableAnkiAction(action, {})).toBe(false);
    });

    test('addNote is retryable only while the duplicate check protects against a double add', () => {
        expect(isRetryableAnkiAction('addNote', addNoteParams(false))).toBe(true);
        expect(isRetryableAnkiAction('addNote', addNoteParams(true))).toBe(false);
        expect(isRetryableAnkiAction('addNote', {})).toBe(false);
    });

    test('multi is retryable only when every inner action is', () => {
        expect(isRetryableAnkiAction('multi', {actions: [{action: 'deckNames', params: {}}, {action: 'findNotes', params: {}}]})).toBe(true);
        expect(isRetryableAnkiAction('multi', {actions: [{action: 'deckNames', params: {}}, {action: 'addNotes', params: {}}]})).toBe(false);
        expect(isRetryableAnkiAction('multi', {actions: 'junk'})).toBe(false);
    });
});
