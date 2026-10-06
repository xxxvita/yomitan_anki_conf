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
const CORE_HEALTH = {status: 'healthy', service: 'core'};

/**
 * @typedef {object} Call
 * @property {string} url
 * @property {string} method
 * @property {unknown} body
 */

/**
 * 'ok' — живой сервис, 'down' — fetch отклоняется (как ECONNREFUSED),
 * 'hang' — висит до abort, 'html' — 200 с HTML-страницей, функция — свой ответ.
 * @typedef {'ok'|'down'|'hang'|'html'|((call: Call) => Response)} Behaviour
 */

/**
 * @typedef {object} HostSpec
 * @property {Behaviour} [health] GET /api/v1/health.
 * @property {Behaviour} [anki] POST / (AnkiConnect `version`).
 */

/**
 * Поддельная сеть: поведение по origin, отдельно для health Core и для
 * AnkiConnect POST. Неописанный хост — 'down'.
 * @param {Record<string, HostSpec>} hosts Ключ — origin, например 'http://127.0.0.1:8777'.
 * @returns {{fetch: typeof fetch, calls: Call[]}}
 */
function makeNet(hosts) {
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
        const host = hosts[new URL(url).origin] ?? {};
        const isHealth = method === 'GET' && url.endsWith('/api/v1/health');
        const behaviour = (isHealth ? host.health : host.anki) ?? 'down';
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
                return new Response(JSON.stringify(isHealth ? CORE_HEALTH : {result: 6, error: null}), {status: 200});
        }
        throw new Error('unreachable');
    };
    return {fetch: fakeFetch, calls};
}

/**
 * @param {Call[]} calls
 * @returns {string[]}
 */
function describeCalls(calls) {
    return calls.map((c) => `${c.method} ${c.url}`);
}

/**
 * @returns {{now: () => number, advance: (ms: number) => void}}
 */
function makeClock() {
    let t = 1_000_000;
    return {now: () => t, advance: (ms) => { t += ms; }};
}

/**
 * @param {Partial<{primary: string, apiKey: ?string, enabled: boolean, timeoutMs: number}>} over
 * @param {typeof fetch} fetchFn
 * @returns {Promise<import('anki-route').AnkiRoute>}
 */
function resolveWith(over, fetchFn) {
    return resolveAnkiRoute({primary: CORE, apiKey: null, enabled: true, fetch: fetchFn, now: () => 1, timeoutMs: 100, ...over});
}

describe('resolveAnkiRoute', () => {
    test('Core alive → mode core, both URLs point at Core', async () => {
        const {fetch, calls} = makeNet({[CORE]: {health: 'ok'}, [ANKI_DIRECT_SERVER]: {anki: 'ok'}});
        const route = await resolveAnkiRoute({primary: CORE, apiKey: null, enabled: true, fetch, now: () => 42, timeoutMs: 100});
        expect(route).toStrictEqual({mode: 'core', ankiServer: CORE, coreBase: CORE, checkedAt: 42});
        expect(describeCalls(calls)).toStrictEqual([`GET ${CORE}/api/v1/health`]);
    });

    test('primary is trimmed and its trailing slash does not double in the health URL', async () => {
        const {fetch, calls} = makeNet({[CORE]: {health: 'ok'}});
        const route = await resolveWith({primary: `  ${CORE}/  `}, fetch);
        expect(route.mode).toBe('core');
        expect(route.ankiServer).toBe(`${CORE}/`);
        expect(calls[0].url).toBe(`${CORE}/api/v1/health`);
    });

    test('loopback Core down, AnkiConnect on 8765 alive → direct on 8765 (after asking the primary itself)', async () => {
        const {fetch, calls} = makeNet({[ANKI_DIRECT_SERVER]: {anki: 'ok'}});
        const route = await resolveAnkiRoute({primary: CORE, apiKey: 'k', enabled: true, fetch, now: () => 7, timeoutMs: 100});
        expect(route).toStrictEqual({mode: 'direct', ankiServer: ANKI_DIRECT_SERVER, coreBase: null, checkedAt: 7});
        expect(describeCalls(calls)).toStrictEqual([
            `GET ${CORE}/api/v1/health`,
            `POST ${CORE}`,
            `POST ${ANKI_DIRECT_SERVER}`,
        ]);
        expect(calls[2].body).toStrictEqual({action: 'version', version: 6, key: 'k'});
    });

    test('primary that is a plain AnkiConnect (no Core) → direct on the primary itself', async () => {
        const primary = 'http://127.0.0.1:8766';
        const {fetch, calls} = makeNet({[primary]: {anki: 'ok'}, [ANKI_DIRECT_SERVER]: {anki: 'ok'}});
        const route = await resolveWith({primary}, fetch);
        expect(route).toStrictEqual({mode: 'direct', ankiServer: primary, coreBase: null, checkedAt: 1});
        expect(calls.some((c) => c.url.startsWith(ANKI_DIRECT_SERVER))).toBe(false);
    });

    test('a loopback custom port (:8766) that is down may still fall back to the local 8765', async () => {
        const {fetch} = makeNet({[ANKI_DIRECT_SERVER]: {anki: 'ok'}});
        const route = await resolveWith({primary: 'http://localhost:8766'}, fetch);
        expect(route.mode).toBe('direct');
        expect(route.ankiServer).toBe(ANKI_DIRECT_SERVER);
    });

    test('[::1] counts as loopback', async () => {
        const {fetch} = makeNet({[ANKI_DIRECT_SERVER]: {anki: 'ok'}});
        const route = await resolveWith({primary: 'http://[::1]:8777'}, fetch);
        expect(route.ankiServer).toBe(ANKI_DIRECT_SERVER);
    });

    test.each([
        'http://192.168.1.5:8765',
        'http://192.168.1.5:8777',
        'https://anki.example.com',
    ])('remote primary %s that is down is NEVER redirected to the local 8765 (other collection, key leak) → none', async (primary) => {
        const {fetch, calls} = makeNet({[ANKI_DIRECT_SERVER]: {anki: 'ok'}});
        const route = await resolveWith({primary, apiKey: 'secret'}, fetch);
        expect(route).toStrictEqual({mode: 'none', ankiServer: primary, coreBase: null, checkedAt: 1});
        expect(calls.some((c) => c.url.startsWith(ANKI_DIRECT_SERVER))).toBe(false);
    });

    test('remote primary that answers as AnkiConnect → direct on that remote host', async () => {
        const primary = 'https://anki.example.com';
        const {fetch} = makeNet({[primary]: {anki: 'ok'}});
        const route = await resolveWith({primary}, fetch);
        expect(route).toStrictEqual({mode: 'direct', ankiServer: primary, coreBase: null, checkedAt: 1});
    });

    test('both down → mode none, ankiServer stays the primary so the existing errors stay as they are', async () => {
        const {fetch} = makeNet({});
        const route = await resolveWith({}, fetch);
        expect(route).toStrictEqual({mode: 'none', ankiServer: CORE, coreBase: null, checkedAt: 1});
    });

    test('primary is 8765 → direct without probing Core', async () => {
        const {fetch, calls} = makeNet({[ANKI_DIRECT_SERVER]: {health: 'ok', anki: 'ok'}});
        const route = await resolveWith({primary: ANKI_DIRECT_SERVER}, fetch);
        expect(route).toStrictEqual({mode: 'direct', ankiServer: ANKI_DIRECT_SERVER, coreBase: null, checkedAt: 1});
        expect(describeCalls(calls)).toStrictEqual([`POST ${ANKI_DIRECT_SERVER}`]);
    });

    test('primary is localhost:8765 → also the direct AnkiConnect, no Core probe', async () => {
        const {fetch, calls} = makeNet({'http://localhost:8765': {anki: 'ok'}});
        const route = await resolveWith({primary: 'http://localhost:8765/'}, fetch);
        expect(route.mode).toBe('direct');
        expect(route.ankiServer).toBe('http://localhost:8765/');
        expect(describeCalls(calls)).toStrictEqual(['POST http://localhost:8765/']);
    });

    test('primary is 8765 and it is down → none (the user chose direct, nothing answers)', async () => {
        const {fetch} = makeNet({});
        const route = await resolveWith({primary: ANKI_DIRECT_SERVER}, fetch);
        expect(route).toStrictEqual({mode: 'none', ankiServer: ANKI_DIRECT_SERVER, coreBase: null, checkedAt: 1});
    });

    test('anki disabled → no network at all; Core-only features keep the configured address unverified', async () => {
        const {fetch, calls} = makeNet({[CORE]: {health: 'ok'}});
        const route = await resolveWith({enabled: false}, fetch);
        expect(route).toStrictEqual({mode: 'disabled', ankiServer: CORE, coreBase: CORE, checkedAt: 1});
        expect(calls).toHaveLength(0);
    });

    test('health 200 with an HTML body is NOT Core (some other service on that port) → falls back', async () => {
        const {fetch} = makeNet({[CORE]: {health: 'html'}, [ANKI_DIRECT_SERVER]: {anki: 'ok'}});
        const route = await resolveWith({}, fetch);
        expect(route.mode).toBe('direct');
    });

    test.each([
        [{status: 'healthy', service: 'core'}, true],
        [{status: 'ok', version: '1.0.0-core', uptime: '1s', bus: {}}, true],
        [{status: 'healthy'}, false],
        [{status: 'ok', version: '2.0.0'}, false],
        [{status: 'ok', service: 'gateway'}, false],
        [{service: 'core'}, false],
        [{}, false],
    ])('health body %j counts as Core: %s', async (healthBody, isCore) => {
        const {fetch} = makeNet({[CORE]: {health: () => new Response(JSON.stringify(healthBody), {status: 200})}});
        const route = await resolveWith({}, fetch);
        expect(route.mode === 'core').toBe(isCore);
    });

    test('health 503 is not alive', async () => {
        const {fetch} = makeNet({[CORE]: {health: () => new Response(JSON.stringify(CORE_HEALTH), {status: 503})}});
        const route = await resolveWith({}, fetch);
        expect(route.mode).toBe('none');
    });

    test('health that hangs is cut by the timeout and the fallback is still probed', async () => {
        const {fetch} = makeNet({[CORE]: {health: 'hang'}, [ANKI_DIRECT_SERVER]: {anki: 'ok'}});
        const started = Date.now();
        const route = await resolveWith({timeoutMs: 30}, fetch);
        expect(route.mode).toBe('direct');
        expect(Date.now() - started).toBeLessThan(1000);
    });

    test('AnkiConnect that answers with an api-key error is still alive (wrong key is reported later)', async () => {
        const {fetch} = makeNet({[ANKI_DIRECT_SERVER]: {anki: () => new Response(JSON.stringify({result: null, error: 'valid api key must be provided'}), {status: 200})}});
        const route = await resolveWith({}, fetch);
        expect(route.mode).toBe('direct');
    });

    test('a non-AnkiConnect answer on 8765 is not alive', async () => {
        const {fetch} = makeNet({[ANKI_DIRECT_SERVER]: {anki: 'html'}});
        const route = await resolveWith({}, fetch);
        expect(route.mode).toBe('none');
    });

    test('empty primary → none without any network', async () => {
        const {fetch, calls} = makeNet({[ANKI_DIRECT_SERVER]: {anki: 'ok'}});
        const route = await resolveWith({primary: '   '}, fetch);
        expect(route.mode).toBe('none');
        expect(calls).toHaveLength(0);
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
        const {fetch, calls} = makeNet({[CORE]: {health: 'ok'}});
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
        const {fetch, calls} = makeNet({[CORE]: {health: 'ok'}});
        const resolver = new AnkiRouteResolver({fetch, now: () => 5, timeoutMs: 100});
        resolver.configure({primary: CORE, apiKey: null});
        await resolver.getRoute();
        await resolver.getRoute({force: true});
        expect(calls).toHaveLength(2);
    });

    test('non-forced callers share the in-flight probe', async () => {
        const {fetch, calls} = makeNet({[CORE]: {health: 'ok'}});
        const resolver = new AnkiRouteResolver({fetch, now: () => 5, timeoutMs: 100});
        resolver.configure({primary: CORE, apiKey: null});
        const [a, b, c] = await Promise.all([resolver.getRoute({force: true}), resolver.getRoute(), resolver.getRoute()]);
        expect(calls).toHaveLength(1);
        expect(a).toStrictEqual(b);
        expect(b).toStrictEqual(c);
    });

    test('force during an in-flight probe runs ONE fresh probe after it (the old one may predate the failure)', async () => {
        /** @type {Array<(value: Response) => void>} */
        const releases = [];
        /** @type {typeof fetch} */
        const fetchFn = async () => await new Promise((resolve) => { releases.push(resolve); });
        const healthy = () => new Response(JSON.stringify(CORE_HEALTH), {status: 200});
        const resolver = new AnkiRouteResolver({fetch: fetchFn, now: () => 5, timeoutMs: 10_000});
        resolver.configure({primary: CORE, apiKey: null});
        const first = resolver.getRoute();
        await Promise.resolve();
        const forcedA = resolver.getRoute({force: true});
        const forcedB = resolver.getRoute({force: true});
        expect(releases).toHaveLength(1);
        releases[0](healthy());
        await first;
        await new Promise((r) => { setTimeout(r, 0); });
        expect(releases).toHaveLength(2);
        releases[1](healthy());
        const [a, b] = await Promise.all([forcedA, forcedB]);
        expect(a).toBe(b);
        expect(releases).toHaveLength(2);
    });

    test('configure with enabled=false → no probe; flipping enabled invalidates the cache', async () => {
        const {fetch, calls} = makeNet({[CORE]: {health: 'ok'}});
        const resolver = new AnkiRouteResolver({fetch, now: () => 5, timeoutMs: 100});
        resolver.configure({primary: CORE, apiKey: null, enabled: false});
        expect((await resolver.getRoute({force: true})).mode).toBe('disabled');
        expect(calls).toHaveLength(0);
        resolver.configure({primary: CORE, apiKey: null, enabled: true});
        expect(resolver.peek()).toBeNull();
        expect((await resolver.getRoute()).mode).toBe('core');
        expect(calls).toHaveLength(1);
    });

    test('configure with a new primary invalidates the cache; the same primary does not', async () => {
        const {fetch, calls} = makeNet({[CORE]: {health: 'ok'}, 'http://127.0.0.1:9999': {health: 'ok'}});
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
            return new Response(JSON.stringify(CORE_HEALTH), {status: 200});
        };
        const resolver = new AnkiRouteResolver({fetch: fetchFn, now: () => 5, timeoutMs: 10_000});
        resolver.configure({primary: CORE, apiKey: null});
        const stale = resolver.getRoute();
        resolver.configure({primary: 'http://127.0.0.1:9999', apiKey: null});
        const fresh = await resolver.getRoute();
        releaseFirst(new Response(JSON.stringify(CORE_HEALTH), {status: 200}));
        await stale;
        expect(fresh.ankiServer).toBe('http://127.0.0.1:9999');
        expect(resolver.peek()?.ankiServer).toBe('http://127.0.0.1:9999');
    });

    test('peek is null before the first resolve', () => {
        const {fetch} = makeNet({});
        const resolver = new AnkiRouteResolver({fetch, now: () => 5});
        expect(resolver.peek()).toBeNull();
    });
});

describe('isRetryableAnkiAction', () => {
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

    test.each(['addNote', 'addNotes', 'modelFieldAdd', 'sync', 'suspend', 'guiEditNote', 'guiBrowse', 'somethingNew'])('%s is not retryable', (action) => {
        expect(isRetryableAnkiAction(action, {})).toBe(false);
    });

    test('addNote is never retried, whatever allowDuplicate says (Yomitan always sends true)', () => {
        for (const allowDuplicate of [true, false]) {
            expect(isRetryableAnkiAction('addNote', {note: {fields: {}, tags: [], deckName: 'd', modelName: 'm', options: {allowDuplicate}}})).toBe(false);
        }
    });

    test('multi is retryable only when every inner action is', () => {
        expect(isRetryableAnkiAction('multi', {actions: [{action: 'deckNames', params: {}}, {action: 'findNotes', params: {}}]})).toBe(true);
        expect(isRetryableAnkiAction('multi', {actions: [{action: 'deckNames', params: {}}, {action: 'addNotes', params: {}}]})).toBe(false);
        expect(isRetryableAnkiAction('multi', {actions: [{action: 'addNote', params: {}}]})).toBe(false);
        expect(isRetryableAnkiAction('multi', {actions: 'junk'})).toBe(false);
    });
});
