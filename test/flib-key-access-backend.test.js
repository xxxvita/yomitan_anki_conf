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

import {IDBFactory} from 'fake-indexeddb';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {Backend} from '../ext/js/background/backend.js';
import {API} from '../ext/js/comm/api.js';
import {FlibGatewayClient, createFlibError} from '../ext/js/comm/flib-gateway-client.js';
import {FlibSecretStore} from '../ext/js/data/flib-secret-store.js';
import {log} from '../ext/js/core/log.js';

/* eslint-disable no-underscore-dangle, @typescript-eslint/unbound-method */

// eslint-disable-next-line jsdoc/no-undefined-types
/** @typedef {chrome.runtime.MessageSender} Sender */

const KEY_A = `tpk_${'a'.repeat(32)}`;
const KEY_B = `tpk_${'b'.repeat(32)}`;
const KEY_C = `tpk_${'c'.repeat(32)}`;
const MASK_A = 'tpk_…aaaa';
const MASK_B = 'tpk_…bbbb';
const URL_A = 'https://gw-a.test';
const URL_B = 'https://gw-b.test';
const READ_A = {keyMasked: MASK_A, gatewayUrl: URL_A};
const EXT_ID = 'abcdefghijklmnop';
const EXT_BASE = `chrome-extension://${EXT_ID}/`;
const settingsPage = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}settings.html`, tab: {id: 1}, frameId: 0});
const contentScript = /** @type {Sender} */ ({id: EXT_ID, url: 'https://example.com/', tab: {id: 1}, frameId: 0});
const foreignExtension = /** @type {Sender} */ ({id: 'otherextension', url: `${EXT_BASE}settings.html`});

/** @type {import('vitest').MockInstance[]} */
let logSpies = [];
beforeEach(() => {
    logSpies = [
        vi.spyOn(log, 'logGenericError').mockImplementation(() => {}),
        vi.spyOn(log, 'log').mockImplementation(() => {}),
        vi.spyOn(log, 'warn').mockImplementation(() => {}),
        vi.spyOn(log, 'error').mockImplementation(() => {}),
        ...(/** @type {const} */ (['log', 'info', 'warn', 'error', 'debug'])).map((name) => vi.spyOn(console, name).mockImplementation(() => {})),
    ];
});
afterEach(() => {
    for (const spy of logSpies) { expect(spy).not.toHaveBeenCalled(); }
    vi.restoreAllMocks();
});

/**
 * @param {string} key
 * @returns {Response}
 */
function accessOf(key) {
    return new Response(JSON.stringify({key_prefix: key.slice(0, 8), demo: false, capabilities: []}), {status: 200});
}

/**
 * The real client over a fake network; `answer` may change `secrets` while a request is in flight.
 * @param {{personalKey: string, gatewayUrl: string}} secrets
 * @param {(call: {index: number, key: string, url: string}) => (Response | Promise<Response>)} answer
 * @returns {{context: Record<string, any>, calls: {index: number, key: string, url: string}[]}}
 */
function makeContext(secrets, answer) {
    /** @type {{index: number, key: string, url: string}[]} */
    const calls = [];
    const getSecrets = vi.fn(async () => ({...secrets}));
    /** @type {typeof fetch} */
    const fakeFetch = async (input, init = {}) => {
        const key = (new Headers(init.headers).get('Authorization') ?? '').replace('Bearer ', '');
        const request = {index: calls.length, key, url: /** @type {string} */ (input)};
        calls.push(request);
        return await answer(request);
    };
    const context = {
        _getFlibSecrets: getSecrets,
        _flibGateway: new FlibGatewayClient({
            fetch: fakeFetch,
            getBase: async () => (await getSecrets()).gatewayUrl,
            getKey: async () => (await getSecrets()).personalKey,
        }),
        _getExtensionBaseUrl: () => EXT_BASE,
        _getExtensionId: () => EXT_ID,
        _canSenderReadFlibSecrets: Backend.prototype._canSenderReadFlibSecrets,
        _requireFlibPageSender: Backend.prototype._requireFlibPageSender,
    };
    return {context, calls};
}

/**
 * @param {Record<string, any>} context
 * @param {Sender} [sender]
 * @param {import('flib-secret-store').FlibSecretsIdentity} [expected] What the page read before the call.
 * @returns {Promise<import('flib-gateway').KeyAccessAnswer>}
 */
async function ask(context, sender = settingsPage, expected = READ_A) {
    return await Backend.prototype._onApiFlibKeyAccess.call(/** @type {any} */ (context), expected, sender);
}

/**
 * @param {Record<string, any>} context
 * @param {Sender} [sender]
 * @returns {Promise<import('flib-gateway').KeyAccess>}
 */
async function call(context, sender = settingsPage) {
    return (await ask(context, sender)).access;
}

describe('flibKeyAccess', () => {
    test('one request with the stored key to the stored address', async () => {
        const {context, calls} = makeContext({personalKey: KEY_A, gatewayUrl: URL_A}, ({key}) => accessOf(key));
        expect(await call(context)).toMatchObject({keyPrefix: 'tpk_aaaa', demo: false});
        expect(calls).toStrictEqual([{index: 0, key: KEY_A, url: `${URL_A}/v1/me/access`}]);
    });

    test.each([['content script', contentScript], ['another extension', foreignExtension], ['unknown', /** @type {Sender} */ ({})]])('%s is refused before the key is read', async (_name, sender) => {
        const {context, calls} = makeContext({personalKey: KEY_A, gatewayUrl: URL_A}, ({key}) => accessOf(key));
        await expect(call(context, sender)).rejects.toMatchObject({message: 'flib_secret_forbidden'});
        expect(calls).toHaveLength(0);
        expect(context._getFlibSecrets).not.toHaveBeenCalled();
    });

    test('a content script without parameters is refused, not a TypeError about them', async () => {
        const {context} = makeContext({personalKey: KEY_A, gatewayUrl: URL_A}, ({key}) => accessOf(key));
        const handler = /** @type {(params: unknown, sender: Sender) => Promise<unknown>} */ (/** @type {unknown} */ (Backend.prototype._onApiFlibKeyAccess));
        await expect(handler.call(context, void 0, contentScript)).rejects.toMatchObject({message: 'flib_secret_forbidden'});
    });

    test.each([['', 'flib_key_missing'], ['tpk_bad', 'flib_key_invalid']])('key %j → %s without a request', async (personalKey, code) => {
        const {context, calls} = makeContext({personalKey, gatewayUrl: ''}, ({key}) => accessOf(key));
        await expect(call(context)).rejects.toMatchObject({data: {code}});
        expect(calls).toHaveLength(0);
    });

    test('key replaced in flight: the old answer is dropped, the new key is asked', async () => {
        const secrets = {personalKey: KEY_A, gatewayUrl: URL_A};
        const {context, calls} = makeContext(secrets, ({key}) => {
            secrets.personalKey = KEY_B;
            return accessOf(key);
        });
        expect((await call(context)).keyPrefix).toBe('tpk_bbbb');
        expect(calls.map(({key}) => key)).toStrictEqual([KEY_A, KEY_B]);
    });

    test('address replaced in flight: the new address is asked', async () => {
        const secrets = {personalKey: KEY_A, gatewayUrl: URL_A};
        const {context, calls} = makeContext(secrets, ({key}) => {
            secrets.gatewayUrl = URL_B;
            return accessOf(key);
        });
        expect((await call(context)).keyPrefix).toBe('tpk_aaaa');
        expect(calls.map(({url}) => url)).toStrictEqual([`${URL_A}/v1/me/access`, `${URL_B}/v1/me/access`]);
    });

    test('an ERROR of the old key is dropped too: «invalid» must not be said of the new key', async () => {
        const secrets = {personalKey: KEY_A, gatewayUrl: URL_A};
        const {context, calls} = makeContext(secrets, ({key}) => {
            secrets.personalKey = KEY_B;
            return key === KEY_A ? new Response('unknown API key\n', {status: 401}) : accessOf(key);
        });
        expect((await call(context)).keyPrefix).toBe('tpk_bbbb');
        expect(calls).toHaveLength(2);
    });

    test('key deleted in flight → flib_key_missing, no second request', async () => {
        const secrets = {personalKey: KEY_A, gatewayUrl: URL_A};
        const {context, calls} = makeContext(secrets, ({key}) => {
            secrets.personalKey = '';
            return accessOf(key);
        });
        await expect(call(context)).rejects.toMatchObject({data: {code: 'flib_key_missing'}});
        expect(calls).toHaveLength(1);
    });

    test.each([['answer', 200], ['error', 401]])('changed again during the repeat (%s) → flib_key_changed, two requests at most', async (_name, status) => {
        const secrets = {personalKey: KEY_A, gatewayUrl: URL_A};
        const {context, calls} = makeContext(secrets, ({index, key}) => {
            secrets.personalKey = [KEY_B, KEY_C][index];
            return status === 200 ? accessOf(key) : new Response('unknown API key\n', {status});
        });
        await expect(call(context)).rejects.toMatchObject({message: 'flib_key_changed', data: {code: 'flib_key_changed'}});
        expect(calls).toHaveLength(2);
    });

    /**
     * The secrets are `during` from just after the handler's first read until the gateway answers, then back as they were.
     * @param {{personalKey?: string, gatewayUrl?: string}} during
     * @returns {{context: Record<string, any>, calls: {index: number, key: string, url: string}[]}}
     */
    function makeThereAndBack(during) {
        const original = {personalKey: KEY_A, gatewayUrl: URL_A};
        const secrets = {...original};
        const made = makeContext(secrets, ({key}) => {
            Object.assign(secrets, original);
            return accessOf(key);
        });
        made.context._getFlibSecrets.mockImplementationOnce(async () => {
            Object.assign(secrets, during);
            return {...original};
        });
        return made;
    }

    test('key A → B → A: the answer is the one of A, B is not asked', async () => {
        const {context, calls} = makeThereAndBack({personalKey: KEY_B});
        expect((await call(context)).keyPrefix).toBe('tpk_aaaa');
        expect(calls).toStrictEqual([{index: 0, key: KEY_A, url: `${URL_A}/v1/me/access`}]);
    });

    test('address A → B → A: the key goes to A only', async () => {
        const {context, calls} = makeThereAndBack({gatewayUrl: URL_B});
        expect((await call(context)).keyPrefix).toBe('tpk_aaaa');
        expect(calls).toStrictEqual([{index: 0, key: KEY_A, url: `${URL_A}/v1/me/access`}]);
    });

    test('key and address replaced together: never one of the old with one of the new', async () => {
        const {context, calls} = makeThereAndBack({personalKey: KEY_B, gatewayUrl: URL_B});
        await call(context);
        expect(calls).toStrictEqual([{index: 0, key: KEY_A, url: `${URL_A}/v1/me/access`}]);
    });

    test('key deleted and pasted back while the request is in flight: no «key missing»', async () => {
        const {context, calls} = makeThereAndBack({personalKey: ''});
        expect((await call(context)).keyPrefix).toBe('tpk_aaaa');
        expect(calls).toHaveLength(1);
    });

    test.each([0, 1, 2, 3, 4, 5, 6])('storage fails on read %d: the key never goes to the default host', async (failing) => {
        const {context, calls} = makeContext({personalKey: KEY_A, gatewayUrl: URL_A}, ({key}) => accessOf(key));
        let reads = 0;
        const get = async () => {
            if (reads++ === failing) { throw new Error('idb gone'); }
            return {personalKey: KEY_A, gatewayUrl: URL_A};
        };
        context._flibSecretStore = {get};
        context._ensureFlibSecretsMigrated = async () => {};
        const read = async () => await Backend.prototype._getFlibSecrets.call(/** @type {any} */ (context));
        context._getFlibSecrets.mockImplementation(read);
        const error = await call(context).then(() => null, (/** @type {{data: {code: string}}} */ e) => e.data.code);
        expect(error === null || error === 'flib_key_missing' || error === 'flib_key_changed').toBe(true);
        for (const {key, url} of calls) { expect({key, url}).toStrictEqual({key: KEY_A, url: `${URL_A}/v1/me/access`}); }
        // The storage failure itself is logged, the key is not.
        expect(JSON.stringify(vi.mocked(log.error).mock.calls)).not.toContain(KEY_A);
        vi.mocked(log.error).mockClear();
    });

    test('with the real store: a key saved in flight is noticed', async () => {
        const store = new FlibSecretStore({indexedDB: new IDBFactory()});
        await store.set({personalKey: KEY_A, gatewayUrl: URL_A});
        const {context, calls} = makeContext({personalKey: '', gatewayUrl: ''}, async ({key}) => {
            await store.set({personalKey: KEY_B});
            return accessOf(key);
        });
        context._getFlibSecrets.mockImplementation(async () => await store.get());
        expect((await call(context)).keyPrefix).toBe('tpk_bbbb');
        expect(calls.map(({key}) => key)).toStrictEqual([KEY_A, KEY_B]);
    });

    test('a failure without a key change is not repeated', async () => {
        const {context, calls} = makeContext({personalKey: KEY_A, gatewayUrl: URL_A}, () => new Response('x', {status: 503}));
        await expect(call(context)).rejects.toMatchObject({data: {code: 'flib_service_unavailable', status: 503}});
        expect(calls).toHaveLength(1);
    });

    test('a non-flib failure passes through as is', async () => {
        const {context} = makeContext({personalKey: KEY_A, gatewayUrl: URL_A}, ({key}) => accessOf(key));
        const failure = new Error('boom');
        context._flibGateway = {getKeyAccess: vi.fn(async () => { throw failure; })};
        await expect(call(context)).rejects.toBe(failure);
    });

    test('no error carries the key', async () => {
        const {context} = makeContext({personalKey: KEY_A, gatewayUrl: URL_A}, ({key}) => new Response(`API key ${key}`, {status: 403}));
        const error = await call(context).catch((/** @type {unknown} */ e) => e);
        expect(error).toMatchObject({message: createFlibError('flib_service_unavailable').message});
        expect(JSON.stringify(/** @type {{data: unknown}} */ (error).data)).not.toContain(KEY_A);
    });
});

describe('flibKeyAccess: whose answer it is', () => {
    const unavailable = () => new Response('x', {status: 503});

    test('the answer carries the mask and the address it was got with, never the key', async () => {
        const {context} = makeContext({personalKey: KEY_A, gatewayUrl: URL_A}, ({key}) => accessOf(key));
        const answer = await ask(context);
        expect(answer).toStrictEqual({access: /** @type {unknown} */ (expect.any(Object)), keyMasked: MASK_A, gatewayUrl: URL_A, changed: false});
        expect(JSON.stringify(answer)).not.toContain(KEY_A);
    });

    test('the error carries them too, with its own code and status', async () => {
        const {context} = makeContext({personalKey: KEY_A, gatewayUrl: URL_A}, unavailable);
        await expect(ask(context)).rejects.toMatchObject({message: 'flib_service_unavailable'});
        const error = /** @type {{data: unknown}} */ (await ask(context).catch((/** @type {unknown} */ e) => e));
        expect(error.data).toStrictEqual({code: 'flib_service_unavailable', status: 503, keyMasked: MASK_A, gatewayUrl: URL_A, changed: false});
    });

    test.each([['answer', accessOf], ['error', unavailable]])('replaced in flight: the %s is of B and says so', async (_name, respond) => {
        const secrets = {personalKey: KEY_A, gatewayUrl: URL_A};
        const {context} = makeContext(secrets, ({key}) => {
            secrets.personalKey = KEY_B;
            secrets.gatewayUrl = URL_B;
            return respond(key);
        });
        const result = await ask(context).catch((/** @type {{data: object}} */ e) => e.data);
        expect(result).toMatchObject({keyMasked: MASK_B, gatewayUrl: URL_B, changed: true});
    });

    test.each([['answer', accessOf], ['error', unavailable]])('replaced by a key with the same tail: the %s says «changed»', async (_name, respond) => {
        const secrets = {personalKey: KEY_A, gatewayUrl: URL_A};
        const {context, calls} = makeContext(secrets, ({key}) => {
            secrets.personalKey = `tpk_${'b'.repeat(28)}aaaa`;
            return respond(key);
        });
        const result = await ask(context).catch((/** @type {{data: object}} */ e) => e.data);
        expect(result).toMatchObject({keyMasked: MASK_A, changed: true});
        expect(calls).toHaveLength(2);
    });

    test.each([
        ['key', {keyMasked: MASK_B, gatewayUrl: URL_A}],
        ['address', {keyMasked: MASK_A, gatewayUrl: URL_B}],
        ['no key', {keyMasked: null, gatewayUrl: URL_A}],
    ])('changed between the two calls of the page (%s): the stored key is asked once and the answer says «changed»', async (_name, expected) => {
        const {context, calls} = makeContext({personalKey: KEY_A, gatewayUrl: URL_A}, ({key}) => accessOf(key));
        expect(await ask(context, settingsPage, expected)).toMatchObject({keyMasked: MASK_A, gatewayUrl: URL_A, changed: true});
        expect(calls).toHaveLength(1);
        const failing = makeContext({personalKey: KEY_A, gatewayUrl: URL_A}, unavailable);
        await expect(ask(failing.context, settingsPage, expected)).rejects.toMatchObject({data: {keyMasked: MASK_A, changed: true}});
    });

    test('A → B → A around the request: the answer is of A and is not «changed»', async () => {
        const secrets = {personalKey: KEY_A, gatewayUrl: URL_A};
        const {context} = makeContext(secrets, ({key}) => {
            secrets.personalKey = KEY_B;
            secrets.personalKey = KEY_A;
            return accessOf(key);
        });
        expect(await ask(context)).toMatchObject({keyMasked: MASK_A, changed: false, access: {keyPrefix: 'tpk_aaaa'}});
    });

    test('deleted in flight: flib_key_missing with no mask', async () => {
        const secrets = {personalKey: KEY_A, gatewayUrl: URL_A};
        const {context} = makeContext(secrets, ({key}) => {
            secrets.personalKey = '';
            return accessOf(key);
        });
        await expect(ask(context)).rejects.toMatchObject({data: {code: 'flib_key_missing', keyMasked: null, gatewayUrl: URL_A, changed: true}});
    });

    test('flib_key_changed names the key stored by then', async () => {
        const secrets = {personalKey: KEY_A, gatewayUrl: URL_A};
        const {context} = makeContext(secrets, ({index, key}) => {
            secrets.personalKey = [KEY_B, KEY_C][index];
            return accessOf(key);
        });
        await expect(ask(context)).rejects.toMatchObject({data: {code: 'flib_key_changed', keyMasked: 'tpk_…cccc', gatewayUrl: URL_A, changed: true}});
    });
});

describe('api.flibKeyAccess', () => {
    test('sends what the page read and returns the answer', async () => {
        const sendMessage = vi.fn((_message, callback) => { callback({result: {access: {demo: true}}}); });
        const api = new API(/** @type {any} */ ({sendMessage, getLastError: () => null}));
        expect(await api.flibKeyAccess(READ_A)).toStrictEqual({access: {demo: true}});
        expect(sendMessage.mock.calls[0][0]).toStrictEqual({action: 'flibKeyAccess', params: READ_A});
    });
});

/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */
