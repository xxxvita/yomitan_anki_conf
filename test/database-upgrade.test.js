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

import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import {Database} from '../ext/js/data/database.js';

vi.stubGlobal('IDBKeyRange', IDBKeyRange);

/**
 * @param {string} name
 * @param {number} version
 * @param {(db: IDBDatabase) => void} onUpgrade
 * @returns {Promise<IDBDatabase>}
 */
function openRaw(name, version, onUpgrade) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = () => { onUpgrade(request.result); };
        request.onsuccess = () => { resolve(request.result); };
        request.onerror = () => { reject(request.error); };
    });
}

/**
 * @param {Database<string>} database
 * @returns {IDBDatabase}
 */
function connectionOf(database) {
    // eslint-disable-next-line no-underscore-dangle
    return /** @type {IDBDatabase} */ (/** @type {*} */ (database)._db);
}

describe('Database._upgrade deleteStores', () => {
    beforeEach(() => {
        vi.stubGlobal('indexedDB', new IDBFactory());
    });

    test('deletes listed stores before creating, skips missing ones', async () => {
        const old = await openRaw('t', 1, (db) => {
            db.createObjectStore('old', {keyPath: 'id'});
            db.createObjectStore('same', {keyPath: 'id'});
        });
        old.close();

        /** @type {Database<'same'|'fresh'>} */
        const database = new Database();
        await database.open('t', 2, [
            {
                version: 2,
                deleteStores: ['old', 'same', 'never-existed'],
                stores: {
                    same: {primaryKey: {keyPath: 'key'}, indices: ['ts']},
                    fresh: {primaryKey: {keyPath: 'id'}, indices: []},
                },
            },
        ]);
        const connection = connectionOf(database);
        const names = [...connection.objectStoreNames].sort();
        expect(names).toEqual(['fresh', 'same']);
        const same = connection.transaction(['same'], 'readonly').objectStore('same');
        expect(same.keyPath).toBe('key');
        expect([...same.indexNames]).toEqual(['ts']);
        database.close();
    });

    test('is not applied when the database is already at that version', async () => {
        const structure = [
            {version: 1, stores: {a: {primaryKey: {keyPath: 'id'}, indices: []}}},
        ];
        /** @type {Database<'a'>} */
        const first = new Database();
        await first.open('u', 1, structure);
        first.close();
        /** @type {Database<'a'>} */
        const second = new Database();
        await second.open('u', 1, [{version: 1, deleteStores: ['a'], stores: structure[0].stores}]);
        expect([...connectionOf(second).objectStoreNames]).toEqual(['a']);
        second.close();
    });
});
