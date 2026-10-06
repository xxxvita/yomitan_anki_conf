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
        _flibSecretsMigrated: false,
        _flibSecretsMigration: null,
        _migrateFlibSecrets: Backend.prototype._migrateFlibSecrets,
        _ensureFlibSecretsMigrated: Backend.prototype._ensureFlibSecretsMigrated,
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
        expect(await onSecretsGet.call(ctx, void 0, settingsPage)).toStrictEqual({hasKey: false, keyMasked: null, gatewayUrl: '', migrationNote: null});
        await ctx._flibSecretStore.set({personalKey: KEY, gatewayUrl: 'https://cache.flib.club'});
        const view = await onSecretsGet.call(ctx, void 0, settingsPage);
        expect(view).toStrictEqual({hasKey: true, keyMasked: 'tpk_…beef', gatewayUrl: 'https://cache.flib.club', migrationNote: null});
        expect(JSON.stringify(view)).not.toContain(KEY);
    });

    test('set validates and trims like the settings field; returns the masked view', async () => {
        const ctx = makeContext();
        const view = await onSecretsSet.call(ctx, {personalKey: ` ${KEY}\n`}, settingsPage);
        expect(view).toStrictEqual({hasKey: true, keyMasked: 'tpk_…beef', gatewayUrl: '', migrationNote: null});
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

    test('the migration note is in the view; dismissing it or setting a key clears it', async () => {
        const ctx = makeContext();
        await ctx._flibSecretStore.set({personalKey: KEY});
        await ctx._flibSecretStore.setMigrationNote('Ключ из профиля 2 не перенесён: теперь ключ один на все профили');
        expect((await onSecretsGet.call(ctx, void 0, settingsPage)).migrationNote).toBe('Ключ из профиля 2 не перенесён: теперь ключ один на все профили');
        expect((await onSecretsSet.call(ctx, {dismissMigrationNote: true}, settingsPage)).migrationNote).toBeNull();
        await ctx._flibSecretStore.setMigrationNote('note');
        expect((await onSecretsSet.call(ctx, {personalKey: OTHER_KEY}, settingsPage)).migrationNote).toBeNull();
        await ctx._flibSecretStore.setMigrationNote('note');
        // Changing only the URL keeps the note.
        expect((await onSecretsSet.call(ctx, {gatewayUrl: ''}, settingsPage)).migrationNote).toBe('note');
    });

    test('an empty key clears it; an omitted field is left as is', async () => {
        const ctx = makeContext();
        await ctx._flibSecretStore.set({personalKey: KEY, gatewayUrl: 'https://cache.flib.club'});
        expect(await onSecretsSet.call(ctx, {personalKey: ''}, settingsPage)).toStrictEqual({hasKey: false, keyMasked: null, gatewayUrl: 'https://cache.flib.club', migrationNote: null});
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

    test('once migrated, a URL found in options later never reaches the store (the key would follow it), and is wiped', async () => {
        const ctx = makeContext({options: optionsFull([{gatewayUrl: '', personalKey: KEY}])});
        await migrate.call(ctx);
        // A content script (or an old version) wrote straight into chrome.storage.local:
        const planted = optionsFull([{gatewayUrl: 'https://evil.example', personalKey: ''}]);
        ctx._options = planted;
        await migrate.call(ctx);
        expect(await ctx._flibSecretStore.getRecord()).toStrictEqual({personalKey: KEY, gatewayUrl: ''});
        expect(planted.profiles[0].options.flibService).toStrictEqual({gatewayUrl: '', personalKey: ''});
        expect(ctx._optionsUtil.save).toHaveBeenCalledWith(planted);
    });

    test('rollback then re-upgrade: a key written back by an old version is migrated when the store key is empty', async () => {
        const ctx = makeContext({options: optionsFull([{gatewayUrl: '', personalKey: ''}])});
        await migrate.call(ctx);
        expect(await ctx._flibSecretStore.getRecord()).toStrictEqual({personalKey: '', gatewayUrl: ''});
        const afterRollback = optionsFull([{gatewayUrl: '', personalKey: KEY}]);
        ctx._options = afterRollback;
        await migrate.call(ctx);
        expect((await ctx._flibSecretStore.get()).personalKey).toBe(KEY);
        expect(afterRollback.profiles[0].options.flibService.personalKey).toBe('');
        expect(await ctx._flibSecretStore.getMigrationNote()).toBeNull();
    });

    test('rollback with a DIFFERENT key than the store: the store key is kept and a note names the profile', async () => {
        const ctx = makeContext({options: optionsFull([{gatewayUrl: '', personalKey: KEY}])});
        await migrate.call(ctx);
        ctx._options = optionsFull([{gatewayUrl: '', personalKey: ''}, {gatewayUrl: '', personalKey: OTHER_KEY}]);
        await migrate.call(ctx);
        expect((await ctx._flibSecretStore.get()).personalKey).toBe(KEY);
        expect(await ctx._flibSecretStore.getMigrationNote()).toBe('Ключ из профиля 2 не перенесён: теперь ключ один на все профили');
    });

    test('nothing to migrate: the store still gets a record (marks the migration done), no options save', async () => {
        const ctx = makeContext({options: optionsFull([{gatewayUrl: '', personalKey: ''}])});
        await migrate.call(ctx);
        expect(await ctx._flibSecretStore.getRecord()).toStrictEqual({personalKey: '', gatewayUrl: ''});
        expect(ctx._optionsUtil.save).not.toHaveBeenCalled();
    });

    test('profiles with DIFFERENT valid keys: the first wins, the rest are named in a note (no key values), and logged', async () => {
        const options = optionsFull([
            {gatewayUrl: '', personalKey: KEY},
            {gatewayUrl: '', personalKey: KEY},
            {gatewayUrl: '', personalKey: OTHER_KEY},
            {gatewayUrl: '', personalKey: 'tpk_bad'},
            {gatewayUrl: '', personalKey: `tpk_${'2'.repeat(32)}`},
        ]);
        const ctx = makeContext({options});
        const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
        try {
            await migrate.call(ctx);
            const note = /** @type {?string} */ (await /** @type {FlibSecretStore} */ (ctx._flibSecretStore).getMigrationNote());
            expect(note).toBe('Ключ из профилей 3, 5 не перенесён: теперь ключ один на все профили');
            expect(note).not.toContain('tpk_');
            expect((await ctx._flibSecretStore.get()).personalKey).toBe(KEY);
            const logged = warn.mock.calls.flat().map(String).join(' ');
            expect(logged).toContain('3, 5');
            expect(logged).not.toContain('tpk_');
        } finally {
            warn.mockRestore();
        }
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
            _flibSecretsMigrated: true,
            _clearProfileConditionsSchemaCache: vi.fn(),
            _getOptionsFull: () => options,
            _optionsUtil: {save: vi.fn(async (/** @type {import('settings').Options} */ value) => { saved = structuredClone(value); })},
            _applyOptions: vi.fn(),
        };
        await Backend.prototype._saveOptions.call(ctx, 'test');
        expect(/** @type {import('settings').Options} */ (saved).profiles[0].options.flibService).toStrictEqual({gatewayUrl: '', personalKey: ''});
    });
});

describe('a failed migration never loses the key (re-review HIGH)', () => {
    test('store.set rejects at start → saving ANY setting keeps the key in options; once the store recovers the migration completes', async () => {
        const store = new FlibSecretStore({indexedDB: new IDBFactory()});
        const failing = vi.spyOn(store, 'set').mockRejectedValue(new Error('idb unavailable'));
        const options = optionsFull([{gatewayUrl: '', personalKey: KEY}, {gatewayUrl: '', personalKey: ''}]);
        const ctx = makeContext({store, options});
        Object.assign(ctx, {
            _clearProfileConditionsSchemaCache: vi.fn(),
            _getOptionsFull: () => options,
            _applyOptions: vi.fn(),
        });
        // SW start: the migration fails (prepare catches and logs it).
        await expect(ctx._ensureFlibSecretsMigrated()).rejects.toThrow('idb unavailable');
        expect(ctx._flibSecretsMigrated).toBe(false);
        // The user changes some unrelated setting:
        await Backend.prototype._saveOptions.call(ctx, 'settings');
        expect(options.profiles[0].options.flibService.personalKey).toBe(KEY);
        // IndexedDB works again; the next flibSecrets* call retries the migration.
        failing.mockRestore();
        const view = await onSecretsGet.call(ctx, void 0, settingsPage);
        expect(view.hasKey).toBe(true);
        expect(ctx._flibSecretsMigrated).toBe(true);
        expect(options.profiles[0].options.flibService.personalKey).toBe('');
        // From now on saves blank again.
        options.profiles[1].options.flibService.personalKey = OTHER_KEY;
        await Backend.prototype._saveOptions.call(ctx, 'settings');
        expect(options.profiles[1].options.flibService.personalKey).toBe('');
    });

    test('the gateway client path retries the migration too', async () => {
        const options = optionsFull([{gatewayUrl: '', personalKey: KEY}]);
        const ctx = makeContext({options});
        expect((await ctx._getFlibSecrets()).personalKey).toBe(KEY);
        expect(ctx._flibSecretsMigrated).toBe(true);
    });

    test('concurrent callers share one migration run', async () => {
        const options = optionsFull([{gatewayUrl: '', personalKey: KEY}]);
        const ctx = makeContext({options});
        const spy = vi.spyOn(ctx._flibSecretStore, 'set');
        await Promise.all([ctx._ensureFlibSecretsMigrated(), ctx._ensureFlibSecretsMigrated(), ctx._getFlibSecrets()]);
        expect(spy).toHaveBeenCalledTimes(1);
        expect(ctx._optionsUtil.save).toHaveBeenCalledTimes(1);
    });
});

/* eslint-disable @typescript-eslint/no-unsafe-assignment -- the Backend-shaped test context is loosely typed */
describe('re-review of 2a5853dc', () => {
    /**
     * @param {Record<string, any>} ctx
     * @param {() => import('settings').Options} getOptions
     */
    function withSaveOptions(ctx, getOptions) {
        Object.assign(ctx, {
            _clearProfileConditionsSchemaCache: vi.fn(),
            _getOptionsFull: getOptions,
            _applyOptions: vi.fn(),
            _saveOptions: Backend.prototype._saveOptions,
        });
        ctx._optionsUtil.validate = vi.fn();
    }

    test('MED-a: while not migrated (IDB broken), setAllSettings (import/reset) keeps the current key; the URL never comes from the new value', async () => {
        const store = new FlibSecretStore({indexedDB: new IDBFactory()});
        vi.spyOn(store, 'set').mockRejectedValue(new Error('idb unavailable'));
        const ctx = makeContext({store, options: optionsFull([{gatewayUrl: 'https://cache.flib.club', personalKey: KEY}])});
        withSaveOptions(ctx, () => ctx._options);
        await expect(ctx._ensureFlibSecretsMigrated()).rejects.toThrow('idb unavailable');
        const imported = optionsFull([{gatewayUrl: 'https://evil.example', personalKey: ''}, {gatewayUrl: '', personalKey: ''}]);
        await Backend.prototype._onApiSetAllSettings.call(ctx, {value: imported, source: 'import'}, settingsPage);
        const saved = /** @type {import('settings').Options} */ (ctx._optionsUtil.save.mock.calls.at(-1)[0]);
        expect(saved.profiles.map((p) => p.options.flibService.personalKey)).toStrictEqual([KEY, KEY]);
        expect(saved.profiles.map((p) => p.options.flibService.gatewayUrl)).toStrictEqual(['', '']);
    });

    test('MED-a: once migrated, setAllSettings blanks flibService as before', async () => {
        const ctx = makeContext({options: optionsFull([{gatewayUrl: '', personalKey: KEY}])});
        withSaveOptions(ctx, () => ctx._options);
        await ctx._ensureFlibSecretsMigrated();
        await Backend.prototype._onApiSetAllSettings.call(ctx, {value: optionsFull([{gatewayUrl: 'https://cache.flib.club', personalKey: OTHER_KEY}]), source: 'import'}, settingsPage);
        const saved = /** @type {import('settings').Options} */ (ctx._optionsUtil.save.mock.calls.at(-1)[0]);
        expect(saved.profiles[0].options.flibService).toStrictEqual({gatewayUrl: '', personalKey: ''});
    });

    test('MED-b: a setAllSettings during a slow migration is not rolled back; the CURRENT options are blanked and saved', async () => {
        const store = new FlibSecretStore({indexedDB: new IDBFactory()});
        const realSet = store.set.bind(store);
        /** @type {() => void} */
        let release = () => {};
        const gate = new Promise((resolve) => { release = () => resolve(void 0); });
        vi.spyOn(store, 'set').mockImplementation(async (patch) => {
            await gate;
            return await realSet(patch);
        });
        const ctx = makeContext({store, options: optionsFull([{gatewayUrl: '', personalKey: KEY}])});
        withSaveOptions(ctx, () => ctx._options);
        const migration = ctx._ensureFlibSecretsMigrated();
        await vi.waitFor(() => { expect(store.set).toHaveBeenCalled(); });
        const next = optionsFull([{gatewayUrl: '', personalKey: ''}, {gatewayUrl: '', personalKey: ''}]);
        next.profileCurrent = 1;
        await Backend.prototype._onApiSetAllSettings.call(ctx, {value: next, source: 'settings'}, settingsPage);
        release();
        await migration;
        const persisted = /** @type {import('settings').Options} */ (ctx._optionsUtil.save.mock.calls.at(-1)[0]);
        expect(persisted.profileCurrent).toBe(1);
        expect(persisted.profiles).toHaveLength(2);
        expect(persisted.profiles.map((p) => p.options.flibService)).toStrictEqual([
            {gatewayUrl: '', personalKey: ''},
            {gatewayUrl: '', personalKey: ''},
        ]);
        expect((await store.get()).personalKey).toBe(KEY);
    });

    test.each([
        ['https://evil.example', ''],
        ['https://flib.club.evil.example', ''],
        ['https://cache.flib.club', 'https://cache.flib.club'],
        ['http://localhost:8080', 'http://localhost:8080'],
    ])('MED-c: first migration with URL %s → stored URL %j', async (url, expected) => {
        const ctx = makeContext({options: optionsFull([{gatewayUrl: url, personalKey: KEY}])});
        await migrate.call(ctx);
        expect(await ctx._flibSecretStore.get()).toStrictEqual({personalKey: KEY, gatewayUrl: expected});
        const note = await /** @type {FlibSecretStore} */ (ctx._flibSecretStore).getMigrationNote();
        expect(note).toBe(expected === '' ? 'Адрес шлюза из настроек не перенесён: используется адрес по умолчанию' : null);
    });

    test('MED-c: an untrusted URL and dropped profile keys → both notes', async () => {
        const ctx = makeContext({options: optionsFull([{gatewayUrl: 'https://evil.example', personalKey: KEY}, {gatewayUrl: '', personalKey: OTHER_KEY}])});
        await migrate.call(ctx);
        const note = await /** @type {FlibSecretStore} */ (ctx._flibSecretStore).getMigrationNote();
        expect(note).toContain('Ключ из профиля 2 не перенесён');
        expect(note).toContain('Адрес шлюза из настроек не перенесён');
    });

    test('Y3: record with an empty key and URL X + options with a valid key and an evil URL → key from options, URL stays X', async () => {
        const ctx = makeContext({options: optionsFull([{gatewayUrl: 'https://evil.example', personalKey: KEY}])});
        await ctx._flibSecretStore.set({personalKey: '', gatewayUrl: 'http://localhost:9000'});
        await migrate.call(ctx);
        expect(await ctx._flibSecretStore.get()).toStrictEqual({personalKey: KEY, gatewayUrl: 'http://localhost:9000'});
    });
});
/* eslint-enable @typescript-eslint/no-unsafe-assignment */

/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */
