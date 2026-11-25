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

import {describe, expect, test, vi} from 'vitest';
import {Backend} from '../ext/js/background/backend.js';
import {AnkiConnect} from '../ext/js/comm/anki-connect.js';

/* eslint-disable no-underscore-dangle */

const CORE = 'http://127.0.0.1:8777';
const DIRECT = 'http://127.0.0.1:8765';

// Same technique as backend-mecab-parse.test.js: call prototype methods on a
// plain context carrying only the fields they touch.
// eslint-disable-next-line @typescript-eslint/unbound-method
const applyAnkiRoute = Backend.prototype._applyAnkiRoute;
// eslint-disable-next-line @typescript-eslint/unbound-method
const refreshAnkiRoute = Backend.prototype._refreshAnkiRoute;
// eslint-disable-next-line @typescript-eslint/unbound-method
const onApiGetAnkiRoute = Backend.prototype._onApiGetAnkiRoute;
// eslint-disable-next-line @typescript-eslint/unbound-method
const onAnkiNetworkFailure = Backend.prototype._onAnkiNetworkFailure;

/**
 * Backend-shaped context with only the fields the route methods touch.
 * @typedef {object} RouteContext
 * @property {AnkiConnect} _anki
 * @property {{setBaseUrl: import('vitest').Mock}} _ankiConf
 * @property {?string} _videoExamplesBootstrapSignature
 * @property {import('vitest').Mock} _maybeBootstrapVideoExamplesField
 * @property {{primary: string, peek: () => ?import('anki-route').AnkiRoute, getRoute: import('vitest').Mock}} _ankiRouteResolver
 * @property {unknown} _applyAnkiRoute
 * @property {unknown} _refreshAnkiRoute
 */

/**
 * @param {?import('anki-route').AnkiRoute} current Route the resolver holds (peek).
 * @returns {RouteContext}
 */
function makeContext(current) {
    const anki = new AnkiConnect();
    anki.server = CORE;
    // Simulate a previously verified remote version on the old server.
    anki._remoteVersion = 6;
    const held = current;
    return {
        _anki: anki,
        _ankiConf: {setBaseUrl: vi.fn()},
        _videoExamplesBootstrapSignature: /** @type {?string} */ (`${CORE}|1|`),
        _maybeBootstrapVideoExamplesField: vi.fn(async () => {}),
        _ankiRouteResolver: {
            primary: CORE,
            peek: () => held,
            getRoute: vi.fn(async () => held),
        },
        _applyAnkiRoute: applyAnkiRoute,
        _refreshAnkiRoute: refreshAnkiRoute,
    };
}

/** @type {import('anki-route').AnkiRoute} */
const coreRoute = {mode: 'core', ankiServer: CORE, coreBase: CORE, checkedAt: 1};
/** @type {import('anki-route').AnkiRoute} */
const directRoute = {mode: 'direct', ankiServer: DIRECT, coreBase: null, checkedAt: 1};

describe('Backend._applyAnkiRoute', () => {
    test('a server switch resets the remote version and the bootstrap signature, and re-runs the bootstrap', () => {
        const ctx = makeContext(directRoute);
        expect(applyAnkiRoute.call(ctx, directRoute)).toBe(true);
        expect(ctx._anki.server).toBe(DIRECT);
        expect(ctx._anki._remoteVersion).toBe(0);
        expect(ctx._videoExamplesBootstrapSignature).toBeNull();
        expect(ctx._maybeBootstrapVideoExamplesField).toHaveBeenCalledTimes(1);
        // No Core: the anki-conf client keeps the primary so its errors stay as before.
        expect(ctx._ankiConf.setBaseUrl).toHaveBeenCalledWith(CORE);
    });

    test('same server: nothing is reset', () => {
        const ctx = makeContext(coreRoute);
        applyAnkiRoute.call(ctx, coreRoute);
        expect(ctx._anki._remoteVersion).toBe(6);
        expect(ctx._videoExamplesBootstrapSignature).toBe(`${CORE}|1|`);
        expect(ctx._maybeBootstrapVideoExamplesField).not.toHaveBeenCalled();
        expect(ctx._ankiConf.setBaseUrl).toHaveBeenCalledWith(CORE);
    });

    test('a stale route (no longer the resolver\'s current one) is not applied', () => {
        const ctx = makeContext(coreRoute);
        expect(applyAnkiRoute.call(ctx, directRoute)).toBe(false);
        expect(ctx._anki.server).toBe(CORE);
        expect(ctx._ankiConf.setBaseUrl).not.toHaveBeenCalled();
    });
});

describe('Backend._onApiGetAnkiRoute', () => {
    test('returns the applied route and passes force through', async () => {
        const ctx = makeContext(directRoute);
        const route = await onApiGetAnkiRoute.call(ctx, {force: true}, /** @type {*} */ ({}));
        expect(route).toStrictEqual(directRoute);
        expect(ctx._ankiRouteResolver.getRoute).toHaveBeenCalledWith({force: true});
        expect(ctx._anki.server).toBe(DIRECT);
    });

    test('force defaults to false (cache respected)', async () => {
        const ctx = makeContext(coreRoute);
        await onApiGetAnkiRoute.call(ctx, {}, /** @type {*} */ ({}));
        expect(ctx._ankiRouteResolver.getRoute).toHaveBeenCalledWith({force: false});
    });
});

describe('Backend._applyAnkiRoute without a live Anki', () => {
    test('mode disabled: the memo is reset but the bootstrap does not hit a disabled server', () => {
        /** @type {import('anki-route').AnkiRoute} */
        const route = {mode: 'disabled', ankiServer: DIRECT, coreBase: DIRECT, checkedAt: 1};
        const ctx = makeContext(route);
        applyAnkiRoute.call(ctx, route);
        expect(ctx._anki.server).toBe(DIRECT);
        expect(ctx._videoExamplesBootstrapSignature).toBeNull();
        expect(ctx._maybeBootstrapVideoExamplesField).not.toHaveBeenCalled();
    });

    /** @type {import('anki-route').AnkiRoute} */
    const deadRoute = {mode: 'none', ankiServer: CORE, coreBase: null, checkedAt: 1};

    test('nobody answers: the address stays, the anki-conf client keeps the primary, no bootstrap', () => {
        const ctx = makeContext(deadRoute);
        ctx._anki.server = DIRECT;
        applyAnkiRoute.call(ctx, deadRoute);
        expect(ctx._anki.server).toBe(DIRECT);
        expect(ctx._anki._remoteVersion).toBe(0);
        expect(ctx._ankiConf.setBaseUrl).toHaveBeenCalledWith(CORE);
        expect(ctx._maybeBootstrapVideoExamplesField).not.toHaveBeenCalled();
    });

    test.each([[null], ['']])('nobody answers and there was no address yet (%j): the one of the settings', (server) => {
        const ctx = makeContext(deadRoute);
        ctx._anki.server = /** @type {string} */ (server);
        applyAnkiRoute.call(ctx, deadRoute);
        expect(ctx._anki.server).toBe(CORE);
    });

    test('somebody answers again at the same address: the memo is reset and the bootstrap re-runs, once', () => {
        const ctx = makeContext(deadRoute);
        ctx._anki.server = DIRECT;
        applyAnkiRoute.call(ctx, deadRoute);
        ctx._videoExamplesBootstrapSignature = `${DIRECT}|1|`;
        ctx._ankiRouteResolver.peek = () => directRoute;
        applyAnkiRoute.call(ctx, directRoute);
        expect(ctx._videoExamplesBootstrapSignature).toBeNull();
        applyAnkiRoute.call(ctx, directRoute);
        expect(ctx._maybeBootstrapVideoExamplesField).toHaveBeenCalledTimes(1);
    });
});

describe('Backend._onAnkiNetworkFailure', () => {
    const PRESS_PLUS = 'Flibooster остановлен — переключено на AnkiConnect, нажмите + ещё раз';
    const NEUTRAL = 'Связь с Anki переключена — повторите действие';

    test('Core → direct fallback on addNote: tells the user to press + again', async () => {
        const ctx = makeContext(directRoute);
        const result = await onAnkiNetworkFailure.call(ctx, CORE, 'addNote');
        expect(result).toStrictEqual({server: DIRECT, switchedMessage: PRESS_PLUS});
        expect(ctx._ankiRouteResolver.getRoute).toHaveBeenCalledWith({force: true});
    });

    test.each([['addNotes'], ['updateNoteFields'], ['storeMediaFile'], [void 0]])(
        'Core → direct fallback on %s: neutral message, no "+" (the user did not press +)',
        async (action) => {
            const ctx = makeContext(directRoute);
            const result = await onAnkiNetworkFailure.call(ctx, CORE, action);
            expect(result).toStrictEqual({server: DIRECT, switchedMessage: NEUTRAL});
        },
    );

    test('any other switch gets a neutral retry message, even for addNote', async () => {
        const ctx = makeContext(coreRoute);
        ctx._anki.server = DIRECT;
        const result = await onAnkiNetworkFailure.call(ctx, DIRECT, 'addNote');
        expect(result).toStrictEqual({server: CORE, switchedMessage: NEUTRAL});
    });

    test('nobody answers: not a switch, the request keeps its own message', async () => {
        const ctx = makeContext({mode: 'none', ankiServer: CORE, coreBase: null, checkedAt: 1});
        ctx._anki.server = DIRECT;
        expect(await onAnkiNetworkFailure.call(ctx, DIRECT, 'addNote')).toStrictEqual({server: DIRECT, switchedMessage: null});
    });
});

/* eslint-enable no-underscore-dangle */
