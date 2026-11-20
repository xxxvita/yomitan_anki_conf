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
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {FlibSentenceCache} from '../ext/js/data/flib-sentence-cache.js';

vi.stubGlobal('IDBKeyRange', IDBKeyRange);

/**
 * @param {FlibSentenceCache} cache
 * @returns {*}
 */
function rawConnection(cache) {
    /* eslint-disable no-underscore-dangle */
    return /** @type {*} */ (cache._db)._db;
    /* eslint-enable no-underscore-dangle */
}

/**
 * @param {FlibSentenceCache} cache
 * @returns {Promise<number>}
 */
function countRecords(cache) {
    return new Promise((resolve, reject) => {
        const request = /** @type {IDBDatabase} */ (rawConnection(cache)).transaction(['translations'], 'readonly')
            .objectStore('translations')
            .count();
        request.onsuccess = () => { resolve(request.result); };
        request.onerror = () => { reject(request.error); };
    });
}

describe('FlibSentenceCache', () => {
    beforeEach(() => {
        vi.stubGlobal('indexedDB', new IDBFactory());
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    /**
     * @param {number} [maxRecords]
     * @returns {Promise<FlibSentenceCache>}
     */
    const make = async (maxRecords) => {
        const cache = new FlibSentenceCache(typeof maxRecords === 'number' ? {maxRecords} : {});
        await cache.prepare();
        return cache;
    };

    /**
     * @param {FlibSentenceCache} cache
     * @param {string} key
     * @param {string} value
     * @param {number} ts
     */
    const putAt = async (cache, key, value, ts) => {
        vi.spyOn(Date, 'now').mockReturnValue(ts);
        await cache.put(key, value);
    };

    test('get on an empty cache returns null', async () => {
        const cache = await make();
        expect(await cache.get('a')).toBeNull();
    });

    test('put then get returns the translation', async () => {
        const cache = await make();
        await cache.put('a', 'А');
        expect(await cache.get('a')).toBe('А');
    });

    test('overwrite keeps a single record', async () => {
        const cache = await make();
        await cache.put('a', 'А');
        await cache.put('a', 'Б');
        expect(await cache.get('a')).toBe('Б');
        expect(await countRecords(cache)).toBe(1);
    });

    test('the oldest record is evicted past maxRecords', async () => {
        const cache = await make(3);
        await putAt(cache, 'a', 'A', 1);
        await putAt(cache, 'b', 'B', 2);
        await putAt(cache, 'c', 'C', 3);
        await putAt(cache, 'd', 'D', 4);
        expect(await cache.get('a')).toBeNull();
        expect(await cache.get('b')).toBe('B');
        expect(await cache.get('c')).toBe('C');
        expect(await cache.get('d')).toBe('D');
        expect(await countRecords(cache)).toBe(3);
    });

    test('a read does not refresh the record', async () => {
        const cache = await make(3);
        await putAt(cache, 'a', 'A', 1);
        await putAt(cache, 'b', 'B', 2);
        await putAt(cache, 'c', 'C', 3);
        await cache.get('a');
        await putAt(cache, 'd', 'D', 4);
        expect(await cache.get('a')).toBeNull();
        expect(await cache.get('b')).toBe('B');
    });

    test('the just-written key survives even if the clock went backwards', async () => {
        const cache = await make(2);
        await putAt(cache, 'a', 'A', 100);
        await putAt(cache, 'b', 'B', 200);
        await putAt(cache, 'c', 'C', 50);
        expect(await cache.get('c')).toBe('C');
        expect(await cache.get('a')).toBeNull();
        expect(await cache.get('b')).toBe('B');
        expect(await countRecords(cache)).toBe(2);
    });

    test('closure by the browser makes the cache unusable', async () => {
        const cache = await make();
        expect(cache.isUsable).toBe(true);
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const connection = rawConnection(cache);
        expect(typeof connection.onclose).toBe('function');
        connection.onclose();
        expect(cache.isUsable).toBe(false);
    });

    test('eviction removes several records in one put', async () => {
        const cache = await make(5);
        for (const [i, k] of ['a', 'b', 'c', 'd', 'e'].entries()) {
            await putAt(cache, k, k.toUpperCase(), i + 1);
        }
        // Shrink the limit: the next put must drop all excess at once.
        // eslint-disable-next-line no-underscore-dangle
        /** @type {*} */ (cache)._maxRecords = 2;
        await putAt(cache, 'f', 'F', 6);
        expect(await countRecords(cache)).toBe(2);
        expect(await cache.get('e')).toBe('E');
        expect(await cache.get('f')).toBe('F');
        expect(await cache.get('a')).toBeNull();
    });

    test('put rejects with a real error when a request fails', async () => {
        await new Promise((resolve, reject) => {
            const open = indexedDB.open('flib-sentence-translations', 1);
            open.onupgradeneeded = () => {
                open.result.createObjectStore('translations', {keyPath: 'key'}).createIndex('ts', 'ts', {unique: true});
            };
            open.onsuccess = () => {
                open.result.close();
                resolve(true);
            };
            open.onerror = () => { reject(open.error); };
        });
        const cache = await make();
        vi.spyOn(Date, 'now').mockReturnValue(7);
        await cache.put('a', 'A');
        /** @type {unknown} */
        let reason = null;
        try {
            await cache.put('b', 'B');
        } catch (e) {
            reason = e;
        }
        expect(reason).not.toBeNull();
        expect(/** @type {{name?: string}} */ (reason).name).toBeTruthy();
    });
});
