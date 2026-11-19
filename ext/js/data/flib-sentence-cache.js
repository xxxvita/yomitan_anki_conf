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

import {Database} from './database.js';

export const FLIB_SENTENCE_CACHE_DB_NAME = 'flib-sentence-translations';

export const FLIB_SENTENCE_CACHE_DB_VERSION = 1;

export const FLIB_SENTENCE_CACHE_MAX_RECORDS = 2000;

/**
 * Cache of sentence translations keyed by an already normalized sentence.
 * The key is NOT normalized here. A read never touches `ts`, so eviction is
 * by write time only.
 */
export class FlibSentenceCache {
    /**
     * @param {{maxRecords?: number}} [options]
     */
    constructor({maxRecords = FLIB_SENTENCE_CACHE_MAX_RECORDS} = {}) {
        /** @type {Database<'translations'>} */
        this._db = new Database();
        /** @type {number} */
        this._maxRecords = maxRecords;
        /**
         * The browser (not us) closed the connection; `Database#isOpen`
         * cannot see that, so it is tracked by a separate flag.
         * @type {boolean}
         */
        this._closedByBrowser = false;
    }

    /** @returns {boolean} */
    get isUsable() {
        return this._db.isOpen() && !this._closedByBrowser;
    }

    /** @returns {Promise<void>} */
    async prepare() {
        await this._db.open(FLIB_SENTENCE_CACHE_DB_NAME, FLIB_SENTENCE_CACHE_DB_VERSION, [
            {
                version: 1,
                stores: {
                    translations: {
                        primaryKey: {keyPath: 'key'},
                        indices: ['ts'],
                    },
                },
            },
        ]);
        this._db.setOnCloseListener(() => { this._closedByBrowser = true; });
    }

    /**
     * @param {string} key
     * @returns {Promise<?string>}
     */
    get(key) {
        return new Promise((resolve, reject) => {
            const transaction = this._db.transaction(['translations'], 'readonly');
            const request = transaction.objectStore('translations').get(key);
            request.onsuccess = () => {
                // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
                const record = /** @type {?{translation?: string}} */ (request.result);
                resolve(typeof record?.translation === 'string' ? record.translation : null);
            };
            request.onerror = () => { reject(request.error ?? new Error('Sentence cache read failed')); };
        });
    }

    /**
     * Writes the record and evicts the oldest ones (never the key just
     * written) in ONE readwrite transaction.
     * @param {string} key
     * @param {string} translation
     * @returns {Promise<void>}
     */
    put(key, translation) {
        return new Promise((resolve, reject) => {
            const transaction = this._db.transaction(['translations'], 'readwrite');
            const store = transaction.objectStore('translations');
            let settled = false;
            /** @param {unknown} error */
            const fail = (error) => {
                if (!settled) {
                    settled = true;
                    reject(error ?? new Error('Sentence cache transaction failed'));
                }
                try {
                    transaction.abort();
                } catch (e) {
                    // Already aborting/finished.
                }
            };
            // No `onerror` handler: during error bubbling `transaction.error`
            // is still null. An unhandled request error aborts the
            // transaction, and `onabort` then sees the real error.
            transaction.onabort = () => {
                if (settled) { return; }
                settled = true;
                reject(transaction.error ?? new Error('Transaction aborted'));
            };
            transaction.oncomplete = () => {
                if (settled) { return; }
                settled = true;
                resolve();
            };
            try {
                store.put({key, translation, ts: Date.now()});
                const countRequest = store.count();
                countRequest.onsuccess = () => {
                    try {
                        let excess = countRequest.result - this._maxRecords;
                        if (excess <= 0) { return; }
                        const cursorRequest = store.index('ts').openCursor();
                        cursorRequest.onsuccess = () => {
                            try {
                                const cursor = cursorRequest.result;
                                if (cursor === null || excess <= 0) { return; }
                                if (cursor.primaryKey !== key) {
                                    cursor.delete();
                                    --excess;
                                }
                                cursor.continue();
                            } catch (e) {
                                fail(e);
                            }
                        };
                    } catch (e) {
                        fail(e);
                    }
                };
            } catch (e) {
                fail(e);
            }
        });
    }
}
