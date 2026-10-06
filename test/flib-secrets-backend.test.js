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
import {afterEach, describe, expect, test, vi} from 'vitest';
import {Backend} from '../ext/js/background/backend.js';
import {FlibSecretStore} from '../ext/js/data/flib-secret-store.js';

/* eslint-disable no-underscore-dangle, @typescript-eslint/unbound-method */

// eslint-disable-next-line jsdoc/no-undefined-types
/** @typedef {chrome.runtime.MessageSender} Sender */

const KEY = `tpk_${'0'.repeat(28)}beef`;
const OTHER_KEY = `tpk_${'1'.repeat(32)}`;
const EXT_ID = 'abcdefghijklmnop';
const EXT_BASE = `chrome-extension://${EXT_ID}/`;

const settingsPage = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}settings.html`});
const contentScript = /** @type {Sender} */ ({id: EXT_ID, url: 'https://example.com/', tab: {id: 1}, frameId: 0});
const foreignExtension = /** @type {Sender} */ ({id: 'otherextension', url: `${EXT_BASE}settings.html`});

const onSecretsGet = Backend.prototype._onApiFlibSecretsGet;
const onSecretsSet = Backend.prototype._onApiFlibSecretsSet;
const onGatewayStatus = Backend.prototype._onApiFlibGatewayStatus;
const migrate = Backend.prototype._migrateFlibSecrets;
const restrictStorage = Backend.prototype._restrictStorageToTrustedContexts;

/**
 * @param {Array<{gatewayUrl: string, personalKey: string}>} services
 * @returns {import('settings').Options}
 */
function optionsFull(services) {
    return /** @type {import('settings').Options} */ (/** @type {unknown} */ ({
        version: 1,
        profileCurrent: 0,
        global: {},
        profiles: services.map((flibService) => ({name: 'p', conditionGroups: [], options: {general: {}, flibService}})),
    }));
}

/**
 * @param {{store?: FlibSecretStore, options?: ?import('settings').Options}} [details]
 * @returns {Record<string, any>}
 */
function makeContext({store, options = null} = {}) {
    return {
        _flibSecretStore: store ?? new FlibSecretStore({indexedDB: new IDBFactory()}),
        _options: options,
        _optionsUtil: {save: vi.fn(async () => {})},
        _getExtensionBaseUrl: () => EXT_BASE,
        _getExtensionId: () => EXT_ID,
        _canSenderReadFlibSecrets: Backend.prototype._canSenderReadFlibSecrets,
        _getFlibSecrets: Backend.prototype._getFlibSecrets,
        _createFlibSecretsView: Backend.prototype._createFlibSecretsView,
        _requireFlibPageSender: Backend.prototype._requireFlibPageSender,
        // Options still carry an (old/planted) key: the backend must NOT read it any more.
        _getProfileOptions: () => ({flibService: {gatewayUrl: 'https://evil.example', personalKey: OTHER_KEY}}),
    };
}

/**
 * @param {unknown} promise
 * @returns {Promise<unknown>} `data.code` of the rejection.
 */
async function rejectionCode(promise) {
    try {
        await promise;
    } catch (e) {
        return /** @type {{data?: {code?: unknown}}} */ (e).data?.code;
    }
    throw new Error('expected a rejection');
}

describe('flibSecretsGet / flibSecretsSet (C1: key out of chrome.storage.local)', () => {
    test('only extension pages of THIS extension may read or write', async () => {
        const ctx = makeContext();
        await ctx._flibSecretStore.set({personalKey: KEY});
        expect(await rejectionCode(onSecretsGet.call(ctx, void 0, contentScript))).toBe('flib_secret_forbidden');
        expect(await rejectionCode(onSecretsGet.call(ctx, void 0, foreignExtension))).toBe('flib_secret_forbidden');
        expect(await rejectionCode(onSecretsGet.call(ctx, void 0, /** @type {Sender} */ ({})))).toBe('flib_secret_forbidden');
        expect(await rejectionCode(onSecretsSet.call(ctx, {personalKey: OTHER_KEY}, contentScript))).toBe('flib_secret_forbidden');
        expect(await rejectionCode(onSecretsSet.call(ctx, {gatewayUrl: 'https://evil.example'}, foreignExtension))).toBe('flib_secret_forbidden');
        expect(await ctx._flibSecretStore.get()).toStrictEqual({personalKey: KEY, gatewayUrl: ''});
    });

    test('get returns a masked key and the URL, NEVER the full key', async () => {
        const ctx = makeContext();
        expect(await onSecretsGet.call(ctx, void 0, settingsPage)).toStrictEqual({hasKey: false, keyMasked: null, gatewayUrl: ''});
        await ctx._flibSecretStore.set({personalKey: KEY, gatewayUrl: 'https://cache.flib.club'});
        const view = await onSecretsGet.call(ctx, void 0, settingsPage);
        expect(view).toStrictEqual({hasKey: true, keyMasked: 'tpk_…beef', gatewayUrl: 'https://cache.flib.club'});
        expect(JSON.stringify(view)).not.toContain(KEY);
    });

    test('set validates and trims like the settings field; returns the masked view', async () => {
        const ctx = makeContext();
        const view = await onSecretsSet.call(ctx, {personalKey: ` ${KEY}\n`}, settingsPage);
        expect(view).toStrictEqual({hasKey: true, keyMasked: 'tpk_…beef', gatewayUrl: ''});
        expect(JSON.stringify(view)).not.toContain(KEY);
        await onSecretsSet.call(ctx, {gatewayUrl: ' https://cache.flib.club '}, settingsPage);
        expect(await ctx._flibSecretStore.get()).toStrictEqual({personalKey: KEY, gatewayUrl: 'https://cache.flib.club'});
    });

    test.each([
        [{personalKey: 'tpk_bad'}, 'flib_key_invalid'],
        [{personalKey: `tpk_${'A'.repeat(32)}`}, 'flib_key_invalid'],
        [{gatewayUrl: 'http://evil.example'}, 'flib_url_invalid'],
        [{gatewayUrl: 'javascript:alert(1)'}, 'flib_url_invalid'],
        [{personalKey: 42}, 'flib_bad_request'],
        [{personalKey: KEY, gatewayUrl: 'ftp://x'}, 'flib_url_invalid'],
    ])('invalid %j → %s, nothing written (all-or-nothing)', async (patch, code) => {
        const ctx = makeContext();
        await ctx._flibSecretStore.set({personalKey: OTHER_KEY, gatewayUrl: 'https://cache.flib.club'});
        expect(await rejectionCode(onSecretsSet.call(ctx, /** @type {any} */ (patch), settingsPage))).toBe(code);
        expect(await ctx._flibSecretStore.get()).toStrictEqual({personalKey: OTHER_KEY, gatewayUrl: 'https://cache.flib.club'});
    });

    test('an empty key clears it; an omitted field is left as is', async () => {
        const ctx = makeContext();
        await ctx._flibSecretStore.set({personalKey: KEY, gatewayUrl: 'https://cache.flib.club'});
        expect(await onSecretsSet.call(ctx, {personalKey: ''}, settingsPage)).toStrictEqual({hasKey: false, keyMasked: null, gatewayUrl: 'https://cache.flib.club'});
    });
});

describe('flibGatewayStatus and the gateway client read the store, not options', () => {
    test('status follows the store; a key planted in options is ignored', async () => {
        const ctx = makeContext();
        expect(await onGatewayStatus.call(ctx, void 0, settingsPage)).toStrictEqual({hasKey: false, base: 'https://cache.flib.club'});
        await ctx._flibSecretStore.set({personalKey: KEY, gatewayUrl: 'http://localhost:8080/'});
        expect(await onGatewayStatus.call(ctx, void 0, settingsPage)).toStrictEqual({hasKey: true, base: 'http://localhost:8080'});
    });

    test('a broken store reads as "no key" instead of throwing', async () => {
        const store = new FlibSecretStore({indexedDB: new IDBFactory()});
        vi.spyOn(store, 'get').mockRejectedValue(new Error('idb gone'));
        const ctx = makeContext({store});
        expect(await ctx._getFlibSecrets()).toStrictEqual({personalKey: '', gatewayUrl: ''});
    });
});

describe('Backend._migrateFlibSecrets (SW start)', () => {
    test('empty store: first valid key/URL moved in, ALL profiles blanked, options saved once', async () => {
        const options = optionsFull([
            {gatewayUrl: '', personalKey: 'tpk_bad'},
            {gatewayUrl: 'https://cache.flib.club', personalKey: KEY},
            {gatewayUrl: '', personalKey: OTHER_KEY},
        ]);
        const ctx = makeContext({options});
        await migrate.call(ctx);
        expect(await ctx._flibSecretStore.getRecord()).toStrictEqual({personalKey: KEY, gatewayUrl: 'https://cache.flib.club'});
        expect(options.profiles.map((p) => p.options.flibService)).toStrictEqual([
            {gatewayUrl: '', personalKey: ''},
            {gatewayUrl: '', personalKey: ''},
            {gatewayUrl: '', personalKey: ''},
        ]);
        expect(ctx._optionsUtil.save).toHaveBeenCalledTimes(1);
        expect(ctx._optionsUtil.save).toHaveBeenCalledWith(options);
    });

    test('idempotent: a second run changes nothing and does not save', async () => {
        const options = optionsFull([{gatewayUrl: '', personalKey: KEY}]);
        const ctx = makeContext({options});
        await migrate.call(ctx);
        await migrate.call(ctx);
        expect(ctx._optionsUtil.save).toHaveBeenCalledTimes(1);
        expect(await ctx._flibSecretStore.get()).toStrictEqual({personalKey: KEY, gatewayUrl: ''});
    });

    test('once migrated, values planted into options later never reach the store, and are wiped', async () => {
        const ctx = makeContext({options: optionsFull([{gatewayUrl: '', personalKey: ''}])});
        await migrate.call(ctx);
        // A content script wrote straight into chrome.storage.local:
        const planted = optionsFull([{gatewayUrl: 'https://evil.example', personalKey: OTHER_KEY}]);
        ctx._options = planted;
        await migrate.call(ctx);
        expect(await ctx._flibSecretStore.getRecord()).toStrictEqual({personalKey: '', gatewayUrl: ''});
        expect(planted.profiles[0].options.flibService).toStrictEqual({gatewayUrl: '', personalKey: ''});
        expect(ctx._optionsUtil.save).toHaveBeenCalledWith(planted);
    });

    test('nothing to migrate: the store still gets a record (marks the migration done), no options save', async () => {
        const ctx = makeContext({options: optionsFull([{gatewayUrl: '', personalKey: ''}])});
        await migrate.call(ctx);
        expect(await ctx._flibSecretStore.getRecord()).toStrictEqual({personalKey: '', gatewayUrl: ''});
        expect(ctx._optionsUtil.save).not.toHaveBeenCalled();
    });

    test('store write fails → options are NOT blanked (the key is not lost)', async () => {
        const store = new FlibSecretStore({indexedDB: new IDBFactory()});
        vi.spyOn(store, 'set').mockRejectedValue(new Error('quota'));
        const options = optionsFull([{gatewayUrl: '', personalKey: KEY}]);
        const ctx = makeContext({store, options});
        await expect(migrate.call(ctx)).rejects.toThrow('quota');
        expect(options.profiles[0].options.flibService.personalKey).toBe(KEY);
        expect(ctx._optionsUtil.save).not.toHaveBeenCalled();
    });
});

describe('Backend._restrictStorageToTrustedContexts (defense in depth)', () => {
    afterEach(() => { vi.unstubAllGlobals(); });

    test('calls storage.local.setAccessLevel(TRUSTED_CONTEXTS) when available', async () => {
        const setAccessLevel = vi.fn(async () => {});
        vi.stubGlobal('chrome', {storage: {local: {setAccessLevel}}});
        await restrictStorage.call({});
        expect(setAccessLevel).toHaveBeenCalledWith({accessLevel: 'TRUSTED_CONTEXTS'});
    });

    test('missing API (Firefox) or a failing call never throws', async () => {
        vi.stubGlobal('chrome', {storage: {local: {}}});
        await expect(restrictStorage.call({})).resolves.toBeUndefined();
        vi.stubGlobal('chrome', {storage: {local: {setAccessLevel: vi.fn(async () => { throw new Error('nope'); })}}});
        await expect(restrictStorage.call({})).resolves.toBeUndefined();
        vi.stubGlobal('chrome', {storage: {local: {setAccessLevel: vi.fn(() => { throw new Error('sync nope'); })}}});
        await expect(restrictStorage.call({})).resolves.toBeUndefined();
    });
});

describe('Backend._saveOptions keeps flibService blank (audit MED: invariant in code)', () => {
    test('a trusted page that still holds pre-migration options cannot write the key back into storage.local', async () => {
        const options = optionsFull([{gatewayUrl: 'https://cache.flib.club', personalKey: KEY}]);
        /** @type {unknown} */
        let saved = null;
        const ctx = {
            _clearProfileConditionsSchemaCache: vi.fn(),
            _getOptionsFull: () => options,
            _optionsUtil: {save: vi.fn(async (/** @type {import('settings').Options} */ value) => { saved = structuredClone(value); })},
            _applyOptions: vi.fn(),
        };
        await Backend.prototype._saveOptions.call(ctx, 'test');
        expect(/** @type {import('settings').Options} */ (saved).profiles[0].options.flibService).toStrictEqual({gatewayUrl: '', personalKey: ''});
    });
});

/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */
