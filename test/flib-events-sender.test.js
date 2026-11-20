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

import {createHash} from 'node:crypto';
import {describe, expect, test, vi} from 'vitest';
import {
    FLIB_EVENTS_BACKOFF_MAX_MS,
    FLIB_EVENTS_BACKOFF_MIN_MS,
    FLIB_EVENTS_BATCH,
    FLIB_EVENTS_DEBOUNCE_MS,
    FLIB_EVENTS_PAUSE_401_MS,
    FLIB_EVENTS_PAUSE_403_MS,
    FLIB_EVENTS_PAUSE_404_MS,
    FLIB_EVENTS_PAUSE_KEY,
    FLIB_EVENTS_PAUSE_NO_ROUTE_MS,
    FLIB_EVENTS_RATE_DEFAULT_MS,
    FLIB_EVENTS_ROUTE_ID_TTL_MS,
    FlibEventsSender,
} from '../ext/js/background/flib-events-sender.js';
import {createFlibError} from '../ext/js/comm/flib-gateway-client.js';

const KEY_A = `tpk_${'a'.repeat(32)}`;
const KEY_B = `tpk_${'b'.repeat(32)}`;
const ROUTE_1 = '11111111-1111-4111-8111-111111111111';
const ROUTE_2 = '22222222-2222-4222-8222-222222222222';
const T0 = 1_800_000_000_000;

/**
 * @param {string} key
 * @returns {string}
 */
const fingerprint = (key) => createHash('sha256').update(key).digest('hex')
    .slice(0, 16);

/**
 * @param {number} i
 * @returns {import('flib-events').FlibOutboxRecord}
 */
const rec = (i) => ({
    event_id: `ext:yomitan:${String(i).padStart(4, '0')}`,
    type: 'translation_opened',
    puzzle_id: 'youtube::abc',
    lemmas: [`w${i}`],
    client_ts: T0 + i,
    created_at: T0 + i,
});

/** @typedef {import('flib-gateway').ExternalEventsResult} Result */

/**
 * @param {number} [accepted]
 * @param {string[]} [rejectedIds]
 * @returns {Result}
 */
const ok = (accepted = 1, rejectedIds = []) => ({kind: 'ok', accepted, duplicates: 0, rejectedIds});

/**
 * @param {number} status
 * @param {?string} [error]
 * @param {{routeId?: ?string, retryAfterSec?: ?number}} [extra]
 * @returns {Result}
 */
const http = (status, error = null, {routeId = null, retryAfterSec = null} = {}) => ({kind: 'http', status, error, routeId, retryAfterSec});

/**
 * @typedef {object} FakeTimer
 * @property {() => void} fn
 * @property {number} ms
 * @property {number} handle
 * @property {boolean} cleared
 */

/**
 * @typedef {object} SetupContext
 * @property {FlibEventsSender} sender
 * @property {{listOutbox: import('vitest').Mock<(limit: number) => Promise<import('flib-events').FlibOutboxRecord[]>>, deleteOutbox: import('vitest').Mock<(ids: string[]) => Promise<void>>, pruneOutbox: import('vitest').Mock<(now: number) => Promise<void>>}} db
 * @property {{getRouteId: import('vitest').Mock<() => Promise<?string>>, postExternalEvents: import('vitest').Mock<(routeId: string, events: import('flib-events').FlibWireEvent[]) => Promise<Result>>}} gateway
 * @property {{get: import('vitest').Mock<(k: string) => Promise<Record<string, unknown>>>, set: import('vitest').Mock<(items: Record<string, unknown>) => Promise<void>>}} storage
 * @property {Record<string, unknown>} store
 * @property {FakeTimer[]} timers
 * @property {import('vitest').Mock<(fn: () => void, ms: number) => number>} setTimer
 * @property {import('vitest').Mock<(handle: unknown) => void>} clearTimer
 * @property {import('vitest').Mock<() => Promise<string>>} getKey
 * @property {{key: string}} keyBox
 * @property {{log: import('vitest').Mock<(message: string) => void>, error: import('vitest').Mock<(error: unknown) => void>}} log
 * @property {import('vitest').Mock<() => Promise<SetupContext['db']>>} getDatabase
 * @property {{now: number}} clock
 * @property {() => Promise<void>} fireTimer
 * @property {import('flib-events').FlibOutboxRecord[]} outbox
 * @property {number} maxInFlight
 */

/**
 * @param {{
 *   records?: number,
 *   key?: string,
 *   routeIds?: Array<?string | Error>,
 *   posts?: Array<Result | Error | Promise<Result>>,
 *   pause?: unknown,
 * }} [options]
 * @returns {SetupContext}
 */
function setup({records = 0, key = KEY_A, routeIds = [ROUTE_1], posts = [], pause} = {}) {
    const clock = {now: T0};
    /** @type {import('flib-events').FlibOutboxRecord[]} */
    let outbox = [];
    for (let i = 0; i < records; ++i) { outbox.push(rec(i)); }
    /** @type {(limit: number) => Promise<import('flib-events').FlibOutboxRecord[]>} */
    const listOutbox = async (limit) => outbox.slice(0, limit);
    /** @type {(ids: string[]) => Promise<void>} */
    const deleteOutbox = async (ids) => {
        const set = new Set(ids);
        outbox = outbox.filter((r) => !set.has(r.event_id));
    };
    /** @type {(now: number) => Promise<void>} */
    const pruneOutbox = async () => {};
    const db = {listOutbox: vi.fn(listOutbox), deleteOutbox: vi.fn(deleteOutbox), pruneOutbox: vi.fn(pruneOutbox)};
    const routeQueue = [...routeIds];
    const postQueue = [...posts];
    let inFlight = 0;
    let maxInFlight = 0;
    /** @type {(routeId: string, events: import('flib-events').FlibWireEvent[]) => Promise<Result>} */
    const postExternalEvents = async (_routeId, events) => {
        ++inFlight;
        maxInFlight = Math.max(maxInFlight, inFlight);
        try {
            const next = postQueue.length > 0 ? postQueue.shift() : ok(events.length);
            if (next instanceof Error) { throw next; }
            return await /** @type {Result | Promise<Result>} */ (next);
        } finally {
            --inFlight;
        }
    };
    const gateway = {
        getRouteId: vi.fn(/** @type {() => Promise<?string>} */ async () => {
            const next = routeQueue.length > 1 ? routeQueue.shift() : routeQueue[0];
            if (next instanceof Error) { throw next; }
            return typeof next === 'undefined' ? null : next;
        }),
        postExternalEvents: vi.fn(postExternalEvents),
    };
    /** @type {Record<string, unknown>} */
    const store = {};
    if (typeof pause !== 'undefined') { store[FLIB_EVENTS_PAUSE_KEY] = pause; }
    /** @type {(k: string) => Promise<Record<string, unknown>>} */
    const storageGet = async (k) => (Object.prototype.hasOwnProperty.call(store, k) ? {[k]: store[k]} : {});
    /** @type {(items: Record<string, unknown>) => Promise<void>} */
    const storageSet = async (items) => {
        Object.assign(store, items);
    };
    const storage = {get: vi.fn(storageGet), set: vi.fn(storageSet)};
    /** @type {FakeTimer[]} */
    const timers = [];
    let nextHandle = 1;
    /** @type {(fn: () => void, ms: number) => number} */
    const setTimerImpl = (fn, ms) => {
        const timer = {fn, ms, handle: nextHandle++, cleared: false};
        timers.push(timer);
        return timer.handle;
    };
    /** @type {(handle: unknown) => void} */
    const clearTimerImpl = (handle) => {
        for (const timer of timers) {
            if (timer.handle === handle) { timer.cleared = true; }
        }
    };
    const setTimer = vi.fn(setTimerImpl);
    const clearTimer = vi.fn(clearTimerImpl);
    const keyBox = {key};
    const getKey = vi.fn(async () => keyBox.key);
    /** @type {(message: string) => void} */
    const logLog = () => {};
    /** @type {(error: unknown) => void} */
    const logError = () => {};
    const log = {log: vi.fn(logLog), error: vi.fn(logError)};
    /** @type {() => Promise<SetupContext['db']>} */
    const getDatabaseImpl = async () => db;
    const getDatabase = vi.fn(getDatabaseImpl);
    const sender = new FlibEventsSender({
        getDatabase,
        gateway,
        getKey,
        storage,
        now: () => clock.now,
        setTimer,
        clearTimer,
        log,
    });
    /** Fires the latest live timer and waits for the whole flush chain. */
    const fireTimer = async () => {
        const live = timers.filter((t) => !t.cleared);
        const timer = live[live.length - 1];
        if (typeof timer === 'undefined') { throw new Error('no live timer'); }
        timer.cleared = true;
        timer.fn();
        await sender.idle();
    };
    return {
        sender,
        db,
        gateway,
        storage,
        store,
        timers,
        setTimer,
        clearTimer,
        getKey,
        keyBox,
        log,
        getDatabase,
        clock,
        fireTimer,
        get outbox() { return outbox; },
        get maxInFlight() { return maxInFlight; },
    };
}

/**
 * @param {SetupContext} ctx
 * @returns {string[]}
 */
const sentIds = (ctx) => ctx.gateway.postExternalEvents.mock.calls.map((call) => call[1].map((e) => e.event_id).join(','));

describe('FlibEventsSender constants', () => {
    test('values', () => {
        expect(FLIB_EVENTS_BATCH).toBe(50);
        expect(FLIB_EVENTS_PAUSE_404_MS).toBe(3600000);
        expect(FLIB_EVENTS_PAUSE_401_MS).toBe(86400000);
        expect(FLIB_EVENTS_DEBOUNCE_MS).toBe(5000);
        expect(FLIB_EVENTS_PAUSE_403_MS).toBe(21600000);
        expect(FLIB_EVENTS_PAUSE_NO_ROUTE_MS).toBe(600000);
        expect(FLIB_EVENTS_ROUTE_ID_TTL_MS).toBe(600000);
        expect(FLIB_EVENTS_BACKOFF_MIN_MS).toBe(30000);
        expect(FLIB_EVENTS_BACKOFF_MAX_MS).toBe(1800000);
        expect(FLIB_EVENTS_RATE_DEFAULT_MS).toBe(60000);
        expect(FLIB_EVENTS_PAUSE_KEY).toBe('flibEventsPause');
    });
});

describe('FlibEventsSender preconditions', () => {
    test('no key → zero gateway calls, no database', async () => {
        const ctx = setup({records: 3, key: ''});
        await ctx.sender.flush();
        expect(ctx.gateway.getRouteId).not.toHaveBeenCalled();
        expect(ctx.gateway.postExternalEvents).not.toHaveBeenCalled();
        expect(ctx.getDatabase).not.toHaveBeenCalled();
    });

    test('invalid key → zero gateway calls', async () => {
        const ctx = setup({records: 3, key: 'tpk_nothex'});
        await ctx.sender.flush();
        expect(ctx.gateway.getRouteId).not.toHaveBeenCalled();
        expect(ctx.gateway.postExternalEvents).not.toHaveBeenCalled();
    });

    test('empty outbox → no route lookup', async () => {
        const ctx = setup({records: 0});
        await ctx.sender.flush();
        expect(ctx.gateway.getRouteId).not.toHaveBeenCalled();
        expect(ctx.gateway.postExternalEvents).not.toHaveBeenCalled();
    });

    test('a pause for the same key → zero calls', async () => {
        const ctx = setup({records: 3, pause: {until: T0 + 1000, keyFingerprint: fingerprint(KEY_A)}});
        await ctx.sender.flush();
        expect(ctx.gateway.getRouteId).not.toHaveBeenCalled();
        expect(ctx.gateway.postExternalEvents).not.toHaveBeenCalled();
        expect(ctx.outbox).toHaveLength(3);
    });

    test('key change clears the pause', async () => {
        const ctx = setup({records: 3, key: KEY_B, pause: {until: Number.MAX_SAFE_INTEGER, keyFingerprint: fingerprint(KEY_A)}});
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1);
        expect(ctx.store[FLIB_EVENTS_PAUSE_KEY]).toBeNull();
        expect(ctx.outbox).toHaveLength(0);
    });

    test('an expired pause for the same key is ignored', async () => {
        const ctx = setup({records: 1, pause: {until: T0, keyFingerprint: fingerprint(KEY_A)}});
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1);
    });

    test('a malformed pause record is ignored', async () => {
        const ctx = setup({records: 1, pause: {until: 'later', keyFingerprint: 7}});
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1);
    });

    test('each run prunes the outbox with now BEFORE listing it', async () => {
        const ctx = setup({records: 1});
        /** @type {string[]} */
        const order = [];
        ctx.db.pruneOutbox.mockImplementation(async () => { order.push('prune'); });
        ctx.db.listOutbox.mockImplementationOnce(async () => {
            order.push('list');
            return [rec(0)];
        });
        await ctx.sender.flush();
        expect(ctx.db.pruneOutbox).toHaveBeenCalledWith(T0);
        expect(order.slice(0, 2)).toStrictEqual(['prune', 'list']);
    });

    test('a pruneOutbox failure is logged and nothing is sent', async () => {
        const ctx = setup({records: 1});
        const failure = new Error('prune failed');
        ctx.db.pruneOutbox.mockRejectedValueOnce(failure);
        await ctx.sender.flush();
        expect(ctx.log.error).toHaveBeenCalledWith(failure);
        expect(ctx.gateway.postExternalEvents).not.toHaveBeenCalled();
    });

    test('posts toWireEvent(records) with the route id', async () => {
        const ctx = setup({records: 1});
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledWith(ROUTE_1, [{
            event_id: 'ext:yomitan:0000',
            type: 'translation_opened',
            puzzle_id: 'youtube::abc',
            lemmas: ['w0'],
            subs_source: 'yomitan_web',
            client_ts: new Date(T0).toISOString(),
        }]);
    });
});

describe('FlibEventsSender response table', () => {
    test('200 → whole batch deleted, next batch', async () => {
        const ctx = setup({records: 3});
        await ctx.sender.flush();
        expect(ctx.outbox).toHaveLength(0);
        expect(ctx.db.deleteOutbox).toHaveBeenCalledWith(['ext:yomitan:0000', 'ext:yomitan:0001', 'ext:yomitan:0002']);
        expect(ctx.setTimer).not.toHaveBeenCalled();
    });

    test('120 records → batches of 50, 50, 20 in order', async () => {
        const ctx = setup({records: 120});
        await ctx.sender.flush();
        const sizes = ctx.gateway.postExternalEvents.mock.calls.map((call) => call[1].length);
        expect(sizes).toStrictEqual([50, 50, 20]);
        const first = ctx.gateway.postExternalEvents.mock.calls.map((call) => call[1][0].event_id);
        expect(first).toStrictEqual(['ext:yomitan:0000', 'ext:yomitan:0050', 'ext:yomitan:0100']);
        expect(ctx.db.listOutbox).toHaveBeenCalledWith(50);
        expect(ctx.outbox).toHaveLength(0);
        expect(ctx.gateway.getRouteId).toHaveBeenCalledTimes(1);
    });

    test('200 with rejected → rejected ids deleted with the whole batch, rejected ids logged', async () => {
        const ctx = setup({records: 3, posts: [ok(1, ['ext:yomitan:0001', 'ext:yomitan:0002'])]});
        await ctx.sender.flush();
        const deleted = ctx.db.deleteOutbox.mock.calls.flatMap((call) => call[0]);
        expect(deleted).toEqual(expect.arrayContaining(['ext:yomitan:0000', 'ext:yomitan:0001', 'ext:yomitan:0002']));
        expect(ctx.outbox).toHaveLength(0);
        expect(ctx.log.log).toHaveBeenCalledWith(expect.stringContaining('ext:yomitan:0001'));
    });

    test('400 bad_request → batch deleted, "our bug" logged', async () => {
        const ctx = setup({records: 3, posts: [http(400, 'bad_request')]});
        await ctx.sender.flush();
        expect(ctx.outbox).toHaveLength(0);
        expect(ctx.log.error).toHaveBeenCalledWith(expect.stringMatching(/our bug/));
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1);
        expect(ctx.setTimer).not.toHaveBeenCalled();
    });

    test('400 without bad_request → kept, backoff', async () => {
        const ctx = setup({records: 3, posts: [http(400, 'field_placement')]});
        await ctx.sender.flush();
        expect(ctx.outbox).toHaveLength(3);
        expect(ctx.setTimer).toHaveBeenCalledWith(expect.any(Function), 30000);
    });

    test('413 → batch deleted and logged, no split', async () => {
        const ctx = setup({records: 4, posts: [http(413, 'too_large')]});
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1);
        expect(ctx.outbox).toHaveLength(0);
        expect(ctx.log.error).toHaveBeenCalledWith(expect.stringMatching(/413/));
    });

    test('401 → 24 h pause for the same key, kept; sends again after expiry; a key change clears it earlier', async () => {
        // 401 значит «ключ неизвестен» (сбой хранилища шлюз отвечает 503, отозванный ключ — 403),
        // но восстановленный ключ не должен молчать вечно, а повторный ввод того же ключа паузу не снимает.
        const ctx = setup({records: 3, posts: [http(401, 'unauthorized'), http(401, 'unauthorized')]});
        await ctx.sender.flush();
        expect(ctx.store[FLIB_EVENTS_PAUSE_KEY]).toStrictEqual({until: T0 + 86400000, keyFingerprint: fingerprint(KEY_A)});
        expect(ctx.outbox).toHaveLength(3);
        ctx.clock.now = T0 + 86400000 - 1;
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1);
        ctx.clock.now = T0 + 86400000;
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(2);
        expect(ctx.outbox).toHaveLength(3);
        ctx.keyBox.key = KEY_B;
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(3);
        expect(ctx.outbox).toHaveLength(0);
    });

    test('403 → 6 h pause for the same key, kept; sends again after expiry with the same key', async () => {
        const ctx = setup({records: 3, posts: [http(403, 'route_forbidden')]});
        await ctx.sender.flush();
        expect(ctx.store[FLIB_EVENTS_PAUSE_KEY]).toStrictEqual({until: T0 + 21600000, keyFingerprint: fingerprint(KEY_A)});
        expect(ctx.outbox).toHaveLength(3);
        ctx.clock.now = T0 + 21600000 - 1;
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1);
        ctx.clock.now = T0 + 21600000;
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(2);
        expect(ctx.outbox).toHaveLength(0);
    });

    test.each([[null], ['not_found'], ['feature_disabled']])('404 (%s) → 1 h pause, kept', async (code) => {
        const ctx = setup({records: 2, posts: [http(404, code)]});
        await ctx.sender.flush();
        expect(ctx.store[FLIB_EVENTS_PAUSE_KEY]).toStrictEqual({until: T0 + 3600000, keyFingerprint: fingerprint(KEY_A)});
        expect(ctx.outbox).toHaveLength(2);
        expect(ctx.setTimer).not.toHaveBeenCalled();
    });

    test('409 stale_route → cached route id updated, same batch retried once, then sent', async () => {
        const ctx = setup({records: 2, posts: [http(409, 'stale_route', {routeId: ROUTE_2}), ok(2)]});
        await ctx.sender.flush();
        const calls = ctx.gateway.postExternalEvents.mock.calls;
        expect(calls.map((call) => call[0])).toStrictEqual([ROUTE_1, ROUTE_2]);
        expect(sentIds(ctx)).toStrictEqual(['ext:yomitan:0000,ext:yomitan:0001', 'ext:yomitan:0000,ext:yomitan:0001']);
        expect(ctx.outbox).toHaveLength(0);
        ctx.db.listOutbox.mockImplementationOnce(async () => [rec(9)]);
        await ctx.sender.flush();
        expect(ctx.gateway.getRouteId).toHaveBeenCalledTimes(1);
        expect(calls[2][0]).toBe(ROUTE_2);
    });

    test('409 stale_route twice → 10 min pause, kept', async () => {
        const ctx = setup({records: 2, posts: [http(409, 'stale_route', {routeId: ROUTE_2}), http(409, 'stale_route', {routeId: ROUTE_1})]});
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(2);
        expect(ctx.store[FLIB_EVENTS_PAUSE_KEY]).toStrictEqual({until: T0 + 600000, keyFingerprint: fingerprint(KEY_A)});
        expect(ctx.outbox).toHaveLength(2);
    });

    test('409 stale_route, retry answers 5xx → backoff, kept', async () => {
        const ctx = setup({records: 2, posts: [http(409, 'stale_route', {routeId: ROUTE_2}), http(502)]});
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(2);
        expect(ctx.setTimer).toHaveBeenCalledWith(expect.any(Function), 30000);
        expect(ctx.outbox).toHaveLength(2);
    });

    test('409 stale_route without a route id → cache dropped, backoff', async () => {
        const ctx = setup({records: 2, posts: [http(409, 'stale_route')]});
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1);
        expect(ctx.setTimer).toHaveBeenCalledWith(expect.any(Function), 30000);
        await ctx.fireTimer();
        expect(ctx.gateway.getRouteId).toHaveBeenCalledTimes(2);
    });

    test('409 route_not_started → cached route id dropped, 10 min pause, kept', async () => {
        const ctx = setup({records: 2, posts: [http(409, 'route_not_started')]});
        await ctx.sender.flush();
        expect(ctx.store[FLIB_EVENTS_PAUSE_KEY]).toStrictEqual({until: T0 + 600000, keyFingerprint: fingerprint(KEY_A)});
        expect(ctx.outbox).toHaveLength(2);
        // Inside the route_id TTL: only a dropped cache makes the next run ask again.
        ctx.clock.now = T0 + 1;
        ctx.store[FLIB_EVENTS_PAUSE_KEY] = null;
        await ctx.sender.flush();
        expect(ctx.gateway.getRouteId).toHaveBeenCalledTimes(2);
        expect(ctx.outbox).toHaveLength(0);
    });

    test.each([
        [120, 120000],
        [null, 60000],
        [999999, 3600000],
        [0, 1000],
    ])('429 Retry-After %s → pause %s ms, kept', async (retryAfterSec, ms) => {
        const ctx = setup({records: 2, posts: [http(429, 'rate_limited', {retryAfterSec})]});
        await ctx.sender.flush();
        expect(ctx.store[FLIB_EVENTS_PAUSE_KEY]).toStrictEqual({until: T0 + ms, keyFingerprint: fingerprint(KEY_A)});
        expect(ctx.outbox).toHaveLength(2);
    });

    test.each([
        [http(408)],
        [http(405, 'method_not_allowed')],
        [http(411)],
        [http(499)],
        [http(409, 'something_else')],
        [http(200, 'bad_response')],
        [http(500)],
        [http(503, 'unavailable')],
    ])('%o → kept, backoff 30 s', async (result) => {
        const ctx = setup({records: 2, posts: [result]});
        await ctx.sender.flush();
        expect(ctx.outbox).toHaveLength(2);
        expect(ctx.setTimer).toHaveBeenCalledWith(expect.any(Function), 30000);
        expect(ctx.store[FLIB_EVENTS_PAUSE_KEY]).toBeUndefined();
    });

    test.each([['flib_network'], ['flib_timeout']])('thrown %s → kept, backoff', async (code) => {
        const ctx = setup({records: 2, posts: [createFlibError(code)]});
        await ctx.sender.flush();
        expect(ctx.outbox).toHaveLength(2);
        expect(ctx.setTimer).toHaveBeenCalledWith(expect.any(Function), 30000);
    });

    test('200 with an empty rejected id → empty id neither deleted nor logged', async () => {
        const ctx = setup({records: 2, posts: [ok(1, ['', 'ext:yomitan:0001'])]});
        await ctx.sender.flush();
        const deleted = ctx.db.deleteOutbox.mock.calls.flatMap((call) => call[0]);
        expect(deleted).not.toContain('');
        expect(ctx.outbox).toHaveLength(0);
        expect(ctx.log.log).toHaveBeenCalledTimes(1);
        expect(ctx.log.log).toHaveBeenCalledWith('flib events: 1 rejected by the server: ext:yomitan:0001');
    });

    test('thrown flib_aborted from post → kept, no backoff, no pause', async () => {
        const ctx = setup({records: 2, posts: [createFlibError('flib_aborted')]});
        await expect(ctx.sender.flush()).resolves.toBeUndefined();
        expect(ctx.outbox).toHaveLength(2);
        expect(ctx.setTimer).not.toHaveBeenCalled();
        expect(ctx.store[FLIB_EVENTS_PAUSE_KEY]).toBeUndefined();
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(2);
    });

    test('thrown flib_aborted from getRouteId → kept, no backoff, no pause', async () => {
        const ctx = setup({records: 2, routeIds: [createFlibError('flib_aborted')]});
        await ctx.sender.flush();
        expect(ctx.outbox).toHaveLength(2);
        expect(ctx.setTimer).not.toHaveBeenCalled();
        expect(ctx.store[FLIB_EVENTS_PAUSE_KEY]).toBeUndefined();
    });

    test('thrown flib_key_invalid from post → 24 h key pause', async () => {
        const ctx = setup({records: 2, posts: [createFlibError('flib_key_invalid')]});
        await ctx.sender.flush();
        expect(ctx.store[FLIB_EVENTS_PAUSE_KEY]).toStrictEqual({until: T0 + 86400000, keyFingerprint: fingerprint(KEY_A)});
    });
});

describe('FlibEventsSender backoff', () => {
    test('5xx → 30000, then 60000 on the next failure; success resets it', async () => {
        const ctx = setup({records: 2, posts: [http(500), http(502), ok(2), http(500)]});
        await ctx.sender.flush();
        expect(ctx.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 30000);
        await ctx.fireTimer();
        expect(ctx.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 60000);
        await ctx.fireTimer();
        expect(ctx.outbox).toHaveLength(0);
        ctx.db.listOutbox.mockImplementationOnce(async () => [rec(5)]);
        await ctx.sender.flush();
        expect(ctx.setTimer).toHaveBeenLastCalledWith(expect.any(Function), 30000);
        expect(ctx.setTimer).toHaveBeenCalledTimes(3);
    });

    test('backoff doubles and caps at 30 min', async () => {
        const ctx = setup({records: 1, posts: Array.from({length: 9}, () => http(500))});
        await ctx.sender.flush();
        for (let i = 0; i < 8; ++i) { await ctx.fireTimer(); }
        const delays = ctx.setTimer.mock.calls.map((call) => call[1]);
        expect(delays).toStrictEqual([30000, 60000, 120000, 240000, 480000, 960000, 1800000, 1800000, 1800000]);
    });

    test('a flush during a pending backoff does not hit the gateway', async () => {
        const ctx = setup({records: 1, posts: [http(500)]});
        await ctx.sender.flush();
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1);
        await ctx.fireTimer();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(2);
        expect(ctx.outbox).toHaveLength(0);
    });

    test('a pause does not start a backoff timer', async () => {
        const ctx = setup({records: 1, posts: [http(404)]});
        await ctx.sender.flush();
        expect(ctx.setTimer).not.toHaveBeenCalled();
    });
});

describe('FlibEventsSender debounce (flushSoon)', () => {
    test('10 records within 5 s → one 5000 ms timer, no POST until it fires, then ONE POST with all 10 events', async () => {
        const ctx = setup({records: 0});
        for (let i = 0; i < 10; ++i) {
            ctx.outbox.push(rec(i));
            ctx.clock.now = T0 + i * 400;
            ctx.sender.flushSoon();
        }
        await ctx.sender.idle();
        expect(ctx.setTimer).toHaveBeenCalledTimes(1);
        expect(ctx.setTimer).toHaveBeenCalledWith(expect.any(Function), 5000);
        expect(ctx.gateway.postExternalEvents).not.toHaveBeenCalled();
        await ctx.fireTimer();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1);
        expect(ctx.gateway.postExternalEvents.mock.calls[0][1]).toHaveLength(10);
        expect(ctx.outbox).toHaveLength(0);
    });

    test('after the debounced flush fired, the next flushSoon starts a new timer', async () => {
        const ctx = setup({records: 1});
        ctx.sender.flushSoon();
        await ctx.fireTimer();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1);
        ctx.outbox.push(rec(1));
        ctx.sender.flushSoon();
        expect(ctx.setTimer).toHaveBeenCalledTimes(2);
        await ctx.fireTimer();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(2);
    });

    test('flush() stays immediate and does not cancel a pending debounce', async () => {
        const ctx = setup({records: 1});
        ctx.sender.flushSoon();
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1);
        expect(ctx.timers.filter((t) => !t.cleared)).toHaveLength(1);
    });
});

describe('FlibEventsSender route id', () => {
    test('null route id → 10 min pause, no post', async () => {
        const ctx = setup({records: 2, routeIds: [null]});
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).not.toHaveBeenCalled();
        expect(ctx.store[FLIB_EVENTS_PAUSE_KEY]).toStrictEqual({until: T0 + 600000, keyFingerprint: fingerprint(KEY_A)});
    });

    test('getRouteId flib_key_invalid → 24 h key pause', async () => {
        const ctx = setup({records: 2, routeIds: [createFlibError('flib_key_invalid', 401)]});
        await ctx.sender.flush();
        expect(ctx.store[FLIB_EVENTS_PAUSE_KEY]).toStrictEqual({until: T0 + 86400000, keyFingerprint: fingerprint(KEY_A)});
        expect(ctx.gateway.postExternalEvents).not.toHaveBeenCalled();
    });

    test.each([['flib_forbidden'], ['route_forbidden']])('getRouteId 403 (%s) → 6 h pause', async (code) => {
        const ctx = setup({records: 2, routeIds: [createFlibError(code, 403)]});
        await ctx.sender.flush();
        expect(ctx.store[FLIB_EVENTS_PAUSE_KEY]).toStrictEqual({until: T0 + 21600000, keyFingerprint: fingerprint(KEY_A)});
    });

    test.each([['flib_http_error', 500], ['flib_network', null], ['flib_rate_limited', 429], ['flib_bad_response', 200]])(
        'getRouteId %s → backoff',
        async (code, status) => {
            const ctx = setup({records: 2, routeIds: [createFlibError(code, status)]});
            await ctx.sender.flush();
            expect(ctx.setTimer).toHaveBeenCalledWith(expect.any(Function), 30000);
            expect(ctx.store[FLIB_EVENTS_PAUSE_KEY]).toBeUndefined();
            expect(ctx.gateway.postExternalEvents).not.toHaveBeenCalled();
        },
    );

    test('getRouteId 404 (route axis disabled) → 1 h pause, no timer', async () => {
        const ctx = setup({records: 2, routeIds: [createFlibError('flib_http_error', 404)]});
        await ctx.sender.flush();
        expect(ctx.store[FLIB_EVENTS_PAUSE_KEY]).toStrictEqual({until: T0 + 3600000, keyFingerprint: fingerprint(KEY_A)});
        expect(ctx.setTimer).not.toHaveBeenCalled();
        expect(ctx.gateway.postExternalEvents).not.toHaveBeenCalled();
        expect(ctx.outbox).toHaveLength(2);
    });

    test('route id is cached for 10 min', async () => {
        const ctx = setup({routeIds: [ROUTE_1, ROUTE_2]});
        ctx.db.listOutbox.mockImplementationOnce(async () => [rec(1)]);
        await ctx.sender.flush();
        ctx.clock.now = T0 + 600000 - 1;
        ctx.db.listOutbox.mockImplementationOnce(async () => [rec(2)]);
        await ctx.sender.flush();
        expect(ctx.gateway.getRouteId).toHaveBeenCalledTimes(1);
        ctx.clock.now = T0 + 600000;
        ctx.db.listOutbox.mockImplementationOnce(async () => [rec(3)]);
        await ctx.sender.flush();
        expect(ctx.gateway.getRouteId).toHaveBeenCalledTimes(2);
        expect(ctx.gateway.postExternalEvents.mock.calls.map((call) => call[0])).toStrictEqual([ROUTE_1, ROUTE_1, ROUTE_2]);
    });

    test('route id cache is bound to the key', async () => {
        const ctx = setup({routeIds: [ROUTE_1, ROUTE_2]});
        ctx.db.listOutbox.mockImplementationOnce(async () => [rec(1)]);
        await ctx.sender.flush();
        ctx.keyBox.key = KEY_B;
        ctx.db.listOutbox.mockImplementationOnce(async () => [rec(2)]);
        await ctx.sender.flush();
        expect(ctx.gateway.getRouteId).toHaveBeenCalledTimes(2);
        expect(ctx.gateway.postExternalEvents.mock.calls.map((call) => call[0])).toStrictEqual([ROUTE_1, ROUTE_2]);
    });
});

describe('FlibEventsSender single flight and errors', () => {
    test('two concurrent flush() → one post in flight, then a second run', async () => {
        /** @type {(value: Result) => void} */
        let resolvePost = () => {};
        /** @type {Promise<Result>} */
        const pending = new Promise((resolve) => { resolvePost = resolve; });
        const ctx = setup({records: 2, posts: [pending]});
        const first = ctx.sender.flush();
        await vi.waitFor(() => { expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1); });
        const second = ctx.sender.flush();
        await Promise.resolve();
        expect(ctx.getKey).toHaveBeenCalledTimes(1);
        resolvePost(ok(2));
        await Promise.all([first, second]);
        expect(ctx.maxInFlight).toBe(1);
        expect(ctx.getKey).toHaveBeenCalledTimes(2);
        expect(ctx.outbox).toHaveLength(0);
    });

    test('five concurrent flush() → exactly two runs', async () => {
        const ctx = setup({records: 2});
        await Promise.all([ctx.sender.flush(), ctx.sender.flush(), ctx.sender.flush(), ctx.sender.flush(), ctx.sender.flush()]);
        expect(ctx.getKey).toHaveBeenCalledTimes(2);
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1);
        await ctx.sender.flush();
        expect(ctx.getKey).toHaveBeenCalledTimes(3);
    });

    test('getDatabase throws → logged, no rejection', async () => {
        const ctx = setup({records: 2});
        const error = new Error('idb broken');
        ctx.getDatabase.mockRejectedValueOnce(error);
        await expect(ctx.sender.flush()).resolves.toBeUndefined();
        expect(ctx.log.error).toHaveBeenCalledWith(error);
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1);
    });

    test('getKey throws → logged, no rejection', async () => {
        const ctx = setup({records: 2});
        ctx.getKey.mockRejectedValueOnce(new Error('secrets'));
        await expect(ctx.sender.flush()).resolves.toBeUndefined();
        expect(ctx.log.error).toHaveBeenCalledTimes(1);
    });

    test('deleteOutbox throws after 200 → logged, run stops', async () => {
        const ctx = setup({records: 2});
        ctx.db.deleteOutbox.mockRejectedValueOnce(new Error('tx abort'));
        await expect(ctx.sender.flush()).resolves.toBeUndefined();
        expect(ctx.log.error).toHaveBeenCalledTimes(1);
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1);
    });

    test('storage.get throws → logged, no rejection, no gateway call', async () => {
        const ctx = setup({records: 2});
        ctx.storage.get.mockRejectedValueOnce(new Error('storage'));
        await expect(ctx.sender.flush()).resolves.toBeUndefined();
        expect(ctx.log.error).toHaveBeenCalledTimes(1);
        expect(ctx.gateway.postExternalEvents).not.toHaveBeenCalled();
    });

    test('deletes that do nothing → exactly one POST per run, logged', async () => {
        const ctx = setup({records: 60});
        ctx.db.deleteOutbox.mockImplementation(async () => {});
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(1);
        expect(ctx.log.error).toHaveBeenCalledTimes(1);
        const logged = ctx.log.error.mock.calls[0][0];
        expect(logged instanceof Error ? logged.message : '').toContain('ext:yomitan:0000');
        await ctx.sender.flush();
        expect(ctx.gateway.postExternalEvents).toHaveBeenCalledTimes(2);
    });
});
