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
import {dedupKey} from './flib-event-envelope.js';

export const FLIB_EVENTS_DB_NAME = 'flib-events';

export const FLIB_EVENTS_DB_VERSION = 1;

export const FLIB_EVENTS_MAX_RECORDS = 10000;

export const FLIB_EVENTS_MAX_AGE_MS = 90 * 24 * 60 * 60 * 1000;

/**
 * Локальная очередь пользовательских событий. Читателя пока нет — отправщик
 * появится позже; наружу торчат listEvents/deleteEvents именно для него.
 *
 * ⚠️ Ключи дедупа лежат ЗДЕСЬ, а не в памяти: сервис-воркер MV3 глушится по
 * простою, и множество в памяти исчезло бы молча.
 */
export class FlibEventsDatabase {
    /**
     * @param {{maxRecords?: number, maxAgeMs?: number}} [options]
     */
    constructor({maxRecords = FLIB_EVENTS_MAX_RECORDS, maxAgeMs = FLIB_EVENTS_MAX_AGE_MS} = {}) {
        /** @type {Database<'events'|'dedup'>} */
        this._db = new Database();
        /** @type {number} */
        this._maxRecords = maxRecords;
        /** @type {number} */
        this._maxAgeMs = maxAgeMs;
    }

    /** @returns {Promise<void>} */
    async prepare() {
        await this._db.open(FLIB_EVENTS_DB_NAME, FLIB_EVENTS_DB_VERSION, [
            {
                version: 1,
                stores: {
                    events: {
                        primaryKey: {keyPath: 'event_id'},
                        indices: ['ts', 'host'],
                    },
                    dedup: {
                        primaryKey: {keyPath: 'key'},
                        indices: ['ts'],
                    },
                },
            },
        ]);
    }

    /**
     * ⚠️ ВСЁ В ОДНОЙ ТРАНЗАКЦИИ: проверка ключей, запись события и запись
     * ключей дедупа. Иначе два клика в полёте оба проходят проверку, оба
     * пишут событие, второй падает на ключе — дубль плюс исключение наружу.
     *
     * Ключ дедупа пишется в ТОЙ ЖЕ транзакции, что и событие: если вставка
     * события бросит (например, keyPath отсутствует), транзакция откатывает
     * ВСЁ, включая уже выполненные dedup.add — упавшая попытка не оставляет
     * следа, и следующая честная запись с той же леммой проходит.
     * @param {import('flib-events').FlibEvent} event
     * @returns {Promise<boolean>} true, если запись состоялась
     */
    async recordEvent(event) {
        const written = await (/** @type {Promise<boolean>} */ (new Promise((resolve, reject) => {
            const transaction = this._db.transaction(['events', 'dedup'], 'readwrite');
            const events = transaction.objectStore('events');
            const dedup = transaction.objectStore('dedup');
            /** @type {string[]} */
            const fresh = [];
            let pending = event.lemmas.length;
            let settled = false;

            // NB: no e.preventDefault() here — leaving the error event
            // un-prevented lets IndexedDB run its default action (abort the
            // transaction), which is exactly the atomicity we want: any
            // request failure rolls back every write made in this
            // transaction, including dedup keys already staged for other
            // lemmas of this same event.
            transaction.onerror = () => {
                if (settled) { return; }
                settled = true;
                reject(transaction.error);
            };
            transaction.onabort = () => {
                if (settled) { return; }
                settled = true;
                reject(transaction.error ?? new Error('Transaction aborted'));
            };

            const finish = () => {
                if (fresh.length === 0) {
                    settled = true;
                    resolve(false);
                    return;
                }
                // events.add/dedup.add can throw SYNCHRONOUSLY (e.g. event_id
                // missing its keyPath value). Catch it here rather than let it
                // escape the event-handler frame: we reject directly and abort
                // the transaction so it rolls back, instead of relying on an
                // onerror/onabort race that (per IndexedDB engines) can also
                // surface the same exception as an unhandled one.
                try {
                    events.add({...event, lemmas: fresh});
                    for (const lemma of fresh) {
                        dedup.add({key: dedupKey(event.url, event.type, lemma), ts: event.ts});
                    }
                } catch (e) {
                    if (!settled) {
                        settled = true;
                        reject(e);
                    }
                    try {
                        transaction.abort();
                    } catch (error2) {
                        // Already aborting/finished — nothing more to do.
                    }
                    return;
                }
                transaction.oncomplete = () => {
                    if (settled) { return; }
                    settled = true;
                    resolve(true);
                };
            };

            if (pending === 0) {
                settled = true;
                resolve(false);
                return;
            }
            for (const lemma of event.lemmas) {
                const request = dedup.get(dedupKey(event.url, event.type, lemma));
                request.onsuccess = () => {
                    if (typeof request.result === 'undefined') {
                        fresh.push(lemma);
                    }
                    if (--pending === 0) {
                        finish();
                    }
                };
            }
        })));
        if (written) {
            await this._rotate();
        }
        return written;
    }

    /**
     * @param {{since?: number, limit?: number}} details
     * @returns {Promise<import('flib-events').FlibEvent[]>}
     */
    async listEvents({since, limit}) {
        const all = await this._getAllEvents();
        const filtered = all
            .filter((e) => typeof since !== 'number' || e.ts > since)
            .sort((a, b) => a.ts - b.ts);
        return typeof limit === 'number' ? filtered.slice(0, limit) : filtered;
    }

    /**
     * @param {string[]} ids
     * @returns {Promise<void>}
     */
    async deleteEvents(ids) {
        for (const id of ids) {
            await this._db.delete('events', id);
        }
    }

    /** @returns {Promise<void>} */
    async _rotate() {
        const events = await this._getAllEvents();
        const cutoff = Date.now() - this._maxAgeMs;
        const doomed = events.filter((e) => e.ts < cutoff);
        const survivors = events
            .filter((e) => e.ts >= cutoff)
            .sort((a, b) => a.ts - b.ts);
        const excess = survivors.length - this._maxRecords;
        if (excess > 0) {
            doomed.push(...survivors.slice(0, excess));
        }
        for (const e of doomed) {
            await this._db.delete('events', e.event_id);
            for (const lemma of e.lemmas) {
                await this._db.delete('dedup', dedupKey(e.url, e.type, lemma));
            }
        }
    }

    /** @returns {Promise<import('flib-events').FlibEvent[]>} */
    _getAllEvents() {
        return new Promise((resolve, reject) => {
            const transaction = this._db.transaction(['events'], 'readonly');
            const request = transaction.objectStore('events').getAll();
            request.onsuccess = () => {
                resolve(/** @type {import('flib-events').FlibEvent[]} */ (request.result));
            };
            request.onerror = () => {
                reject(request.error);
            };
        });
    }
}
