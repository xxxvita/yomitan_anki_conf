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
import {describe, expect, test, vi} from 'vitest';
import {
    FLIB_SECRETS_DB_NAME,
    FlibSecretStore,
    blankFlibServiceInOptions,
    findFlibSecretsInOptions,
    maskFlibPersonalKey,
} from '../ext/js/data/flib-secret-store.js';

const KEY_A = `tpk_${'a'.repeat(28)}abcd`;
const KEY_B = `tpk_${'b'.repeat(32)}`;

/**
 * @param {Array<?{gatewayUrl?: unknown, personalKey?: unknown} | 'none'>} services
 * @returns {import('settings').Options}
 */
function optionsWith(services) {
    return /** @type {import('settings').Options} */ (/** @type {unknown} */ ({
        profiles: services.map((service) => ({
            name: 'p',
            conditionGroups: [],
            options: service === 'none' ? {general: {}} : {general: {}, flibService: service},
        })),
    }));
}

describe('FlibSecretStore', () => {
    test('empty database: no record, defaults from get()', async () => {
        const store = new FlibSecretStore({indexedDB: new IDBFactory()});
        expect(await store.getRecord()).toBeNull();
        expect(await store.get()).toStrictEqual({personalKey: '', gatewayUrl: ''});
    });

    test('set merges a partial patch with the stored record', async () => {
        const store = new FlibSecretStore({indexedDB: new IDBFactory()});
        await store.set({personalKey: KEY_A});
        await store.set({gatewayUrl: 'https://cache.flib.club'});
        expect(await store.get()).toStrictEqual({personalKey: KEY_A, gatewayUrl: 'https://cache.flib.club'});
    });

    test('values persist in the named database across instances (SW restart)', async () => {
        const factory = new IDBFactory();
        await new FlibSecretStore({indexedDB: factory}).set({personalKey: KEY_A});
        const reopened = new FlibSecretStore({indexedDB: factory});
        expect(await reopened.getRecord()).toStrictEqual({personalKey: KEY_A, gatewayUrl: ''});
        const names = (await factory.databases()).map((d) => d.name);
        expect(names).toContain(FLIB_SECRETS_DB_NAME);
    });

    test('reads are cached; set invalidates the cache', async () => {
        const factory = new IDBFactory();
        const openSpy = vi.spyOn(factory, 'open');
        const store = new FlibSecretStore({indexedDB: factory});
        await store.get();
        await store.get();
        expect(openSpy).toHaveBeenCalledTimes(1);
        await store.set({personalKey: KEY_B});
        expect((await store.get()).personalKey).toBe(KEY_B);
    });

    test('concurrent partial sets do not lose each other (merge inside one transaction)', async () => {
        const factory = new IDBFactory();
        const store = new FlibSecretStore({indexedDB: factory});
        await Promise.all([store.set({personalKey: KEY_A}), store.set({gatewayUrl: 'https://cache.flib.club'})]);
        const fresh = new FlibSecretStore({indexedDB: factory});
        expect(await fresh.get()).toStrictEqual({personalKey: KEY_A, gatewayUrl: 'https://cache.flib.club'});
    });

    test('a failing open rejects, and the failure is not cached', async () => {
        const factory = new IDBFactory();
        const open = factory.open.bind(factory);
        let fail = true;
        vi.spyOn(factory, 'open').mockImplementation((name, version) => {
            if (fail) { throw new Error('blocked'); }
            return open(name, version);
        });
        const store = new FlibSecretStore({indexedDB: factory});
        await expect(store.get()).rejects.toThrow('blocked');
        fail = false;
        expect(await store.get()).toStrictEqual({personalKey: '', gatewayUrl: ''});
    });
});

describe('FlibSecretStore migration note', () => {
    test('absent → null; set, persisted, cleared with null; independent of the secrets record', async () => {
        const factory = new IDBFactory();
        const store = new FlibSecretStore({indexedDB: factory});
        expect(await store.getMigrationNote()).toBeNull();
        await store.setMigrationNote('note');
        expect(await new FlibSecretStore({indexedDB: factory}).getMigrationNote()).toBe('note');
        expect(await store.getRecord()).toBeNull();
        await store.setMigrationNote(null);
        expect(await store.getMigrationNote()).toBeNull();
    });
});

describe('maskFlibPersonalKey', () => {
    test('shows only the prefix and the last 4 characters', () => {
        expect(maskFlibPersonalKey(KEY_A)).toBe('tpk_…abcd');
        expect(maskFlibPersonalKey('')).toBeNull();
    });
});

describe('findFlibSecretsInOptions (migration source)', () => {
    test('first VALID non-empty key and URL, possibly from different profiles', () => {
        const options = optionsWith([
            'none',
            {gatewayUrl: 'ftp://bad', personalKey: 'tpk_bad'},
            {gatewayUrl: '', personalKey: KEY_A},
            {gatewayUrl: ' https://cache.flib.club ', personalKey: KEY_B},
        ]);
        expect(findFlibSecretsInOptions(options)).toStrictEqual({personalKey: KEY_A, gatewayUrl: 'https://cache.flib.club'});
    });

    test('nothing valid → empty values (a record is still written to mark the migration done)', () => {
        expect(findFlibSecretsInOptions(optionsWith([{gatewayUrl: 'x', personalKey: 'y'}, null]))).toStrictEqual({personalKey: '', gatewayUrl: ''});
    });
});

describe('blankFlibServiceInOptions', () => {
    test('blanks both fields in EVERY profile and reports a change', () => {
        const options = optionsWith([{gatewayUrl: 'https://x.flib.club', personalKey: KEY_A}, 'none', {gatewayUrl: '', personalKey: 'junk'}]);
        expect(blankFlibServiceInOptions(options)).toBe(true);
        expect(options.profiles[0].options.flibService).toStrictEqual({gatewayUrl: '', personalKey: ''});
        expect(options.profiles[2].options.flibService).toStrictEqual({gatewayUrl: '', personalKey: ''});
    });

    test('already blank → no change (idempotent, no needless save)', () => {
        const options = optionsWith([{gatewayUrl: '', personalKey: ''}, 'none']);
        expect(blankFlibServiceInOptions(options)).toBe(false);
    });

    test('a non-object flibService is replaced by the blank shape', () => {
        const options = optionsWith(/** @type {Array<?{gatewayUrl?: unknown, personalKey?: unknown}>} */ (/** @type {unknown} */ (['tpk_leak'])));
        expect(blankFlibServiceInOptions(options)).toBe(true);
        expect(options.profiles[0].options.flibService).toStrictEqual({gatewayUrl: '', personalKey: ''});
    });
});
