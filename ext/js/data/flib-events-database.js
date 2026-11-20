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
import {outboxDedupKey} from './flib-event-envelope.js';

export const FLIB_EVENTS_DB_NAME = 'flib-events';

export const FLIB_EVENTS_DB_VERSION = 2;

/** Потолок числа записей в исходящей очереди. */
export const FLIB_OUTBOX_MAX_RECORDS = 300;

/** Максимальный возраст записи исходящей очереди: 7 суток. */
export const FLIB_OUTBOX_MAX_AGE_MS = 604800000;

/** Время жизни ключа дедупа: 12 часов. */
export const FLIB_DEDUP_TTL_MS = 43200000;

/**
 * Исходящая очередь событий маршрута (outbox) и ключи дедупа.
 *
 * ⚠️ ТЗ O-7 ПЕРЕСМОТРЕНО. Раньше возрастной предел был запрещён: читателя
 * очереди не существовало, и любая уборка уничтожала бы неотправленное.
 * Теперь отправщик есть, очередь сливается, и пределы вернулись: не более
 * 300 записей и не старше 7 суток (старше — шлюз такое событие уже не
 * примет осмысленно, а копить его бессмысленно).
 *
 * ⚠️ Версия 2 УДАЛЯЕТ прежние хранилища `events` и `dedup` и создаёт `outbox`
 * и `dedup` заново: прежние записи имели другую форму (url/host/ts), в
 * новый конверт они не преобразуются.
 *
 * ⚠️ Ключи дедупа живут В БАЗЕ, а не в памяти: сервис-воркер MV3 глушится по
 * простою. Снимаются они ТОЛЬКО по TTL (12 ч) — ни `deleteOutbox`, ни
 * пределы очереди их не трогают: отправленное или вытесненное событие не
 * должно позволять тут же записать то же самое раскрытие заново.
 */
export class FlibEventsDatabase {
    /**
     * @param {{maxRecords?: number, maxAgeMs?: number, dedupTtlMs?: number}} [options]
     */
    constructor({
        maxRecords = FLIB_OUTBOX_MAX_RECORDS,
        maxAgeMs = FLIB_OUTBOX_MAX_AGE_MS,
        dedupTtlMs = FLIB_DEDUP_TTL_MS,
    } = {}) {
        /** @type {Database<'outbox'|'dedup'>} */
        this._db = new Database();
        /** @type {number} */
        this._maxRecords = maxRecords;
        /** @type {number} */
        this._maxAgeMs = maxAgeMs;
        /** @type {number} */
        this._dedupTtlMs = dedupTtlMs;
        /**
         * Соединение закрыл БРАУЗЕР (очистка данных сайта, повреждение базы,
         * version-change из другой вкладки), а не мы. `Database._db` при этом
         * остаётся ненулевым, и `isOpen()` продолжал бы отвечать `true` —
         * поэтому состояние держим отдельным флагом.
         * @type {boolean}
         */
        this._closedByBrowser = false;
    }

    /**
     * Годна ли база к работе. Читает бэкенд: мемоизированный экземпляр с
     * умершим соединением обязан быть выброшен.
     * @returns {boolean}
     */
    get isUsable() {
        return this._db.isOpen() && !this._closedByBrowser;
    }

    /** @returns {Promise<void>} */
    async prepare() {
        await this._db.open(FLIB_EVENTS_DB_NAME, FLIB_EVENTS_DB_VERSION, [
            {
                version: 2,
                deleteStores: ['events', 'dedup'],
                stores: {
                    outbox: {
                        primaryKey: {keyPath: 'event_id'},
                        indices: ['created_at'],
                    },
                    dedup: {
                        primaryKey: {keyPath: 'key'},
                        indices: ['ts'],
                    },
                },
            },
        ]);
        this._db.setOnCloseListener(() => { this._closedByBrowser = true; });
    }

    /**
     * ⚠️ ВСЁ В ОДНОЙ ТРАНЗАКЦИИ: уборка просроченных ключей, проверка ключей,
     * запись ключей и записи, уборка очереди по возрасту и по числу. Иначе два
     * клика в полёте оба проходят проверку и оба пишут событие.
     *
     * Только что записанная запись не удаляется ни по возрасту, ни по числу.
     * @param {import('flib-events').FlibOutboxRecord} record
     * @param {number} now
     * @returns {Promise<boolean>} true, если запись состоялась
     */
    recordEvent(record, now) {
        if (record.lemmas.length === 0) { return Promise.resolve(false); }
        return this._transact(['outbox', 'dedup'], 'readwrite', (transaction, setResult, guard) => {
            const outbox = transaction.objectStore('outbox');
            const dedup = transaction.objectStore('dedup');
            const keys = record.lemmas.map((lemma) => outboxDedupKey(record.puzzle_id, record.type, lemma));
            setResult(false);

            this._sweepDedup(dedup, now, guard, () => {
                let pending = keys.length;
                let blocked = false;
                for (const key of keys) {
                    const request = dedup.get(key);
                    request.onsuccess = guard(() => {
                        if (typeof request.result !== 'undefined') { blocked = true; }
                        if (--pending > 0 || blocked) { return; }
                        write();
                    });
                }
            });

            const write = () => {
                for (const key of keys) { dedup.add({key, ts: now}); }
                outbox.add(record);
                setResult(true);
                this._trimOutbox(outbox, now, record.event_id, guard);
            };
        });
    }

    /**
     * Те же пределы, что у `recordEvent`, без новой записи: ключи дедупа старше
     * 12 ч, записи старше 7 суток и сверх 300 (самые старые). Зовёт отправщик
     * в начале каждого прогона, ДО чтения очереди: без этого событие, к
     * которому давно не добавлялось новых, ушло бы на шлюз и через месяц.
     * Одна транзакция readwrite.
     * @param {number} now
     * @returns {Promise<void>}
     */
    pruneOutbox(now) {
        return this._transact(['outbox', 'dedup'], 'readwrite', (transaction, _setResult, guard) => {
            const outbox = transaction.objectStore('outbox');
            const dedup = transaction.objectStore('dedup');
            this._sweepDedup(dedup, now, guard, () => {
                this._trimOutbox(outbox, now, null, guard);
            });
        });
    }

    /**
     * Удаляет ключи дедупа старше срока (`ts < now - ttl`), затем зовёт `next`.
     * @param {IDBObjectStore} dedup
     * @param {number} now
     * @param {(callback: () => void) => (() => void)} guard
     * @param {() => void} next
     */
    _sweepDedup(dedup, now, guard, next) {
        const expired = dedup.index('ts').getAllKeys(IDBKeyRange.upperBound(now - this._dedupTtlMs, true));
        expired.onsuccess = guard(() => {
            for (const key of expired.result) { dedup.delete(key); }
            next();
        });
    }

    /**
     * Пределы очереди: записи старше `maxAgeMs` (`created_at < now - maxAge`),
     * затем сверх `maxRecords`, начиная с самых старых. `keepId` — запись,
     * которую трогать нельзя (только что записанная), или null.
     * @param {IDBObjectStore} outbox
     * @param {number} now
     * @param {?string} keepId
     * @param {(callback: () => void) => (() => void)} guard
     */
    _trimOutbox(outbox, now, keepId, guard) {
        const old = outbox.index('created_at').getAllKeys(IDBKeyRange.upperBound(now - this._maxAgeMs, true));
        old.onsuccess = guard(() => {
            for (const id of /** @type {IDBValidKey[]} */ (old.result)) {
                if (id !== keepId) { outbox.delete(id); }
            }
            const count = outbox.count();
            count.onsuccess = guard(() => {
                let excess = count.result - this._maxRecords;
                if (excess <= 0) { return; }
                const cursorRequest = outbox.index('created_at').openKeyCursor();
                cursorRequest.onsuccess = guard(() => {
                    const cursor = cursorRequest.result;
                    if (cursor === null || excess <= 0) { return; }
                    if (cursor.primaryKey !== keepId) {
                        outbox.delete(cursor.primaryKey);
                        --excess;
                    }
                    cursor.continue();
                });
            });
        });
    }

    /**
     * Самые старые записи первыми (по `created_at`).
     * @param {number} limit
     * @returns {Promise<import('flib-events').FlibOutboxRecord[]>}
     */
    listOutbox(limit) {
        return this._transact(['outbox'], 'readonly', (transaction, setResult, guard) => {
            /** @type {import('flib-events').FlibOutboxRecord[]} */
            const records = [];
            setResult(records);
            if (limit <= 0 || Number.isNaN(limit)) { return; }
            const request = transaction.objectStore('outbox').index('created_at').openCursor();
            request.onsuccess = guard(() => {
                const cursor = request.result;
                if (cursor === null) { return; }
                /** @type {unknown} */
                const value = cursor.value;
                records.push(/** @type {import('flib-events').FlibOutboxRecord} */ (value));
                if (records.length < limit) { cursor.continue(); }
            });
        });
    }

    /**
     * ⚠️ Ключи дедупа НЕ трогает (см. комментарий у класса).
     * @param {string[]} eventIds
     * @returns {Promise<void>}
     */
    deleteOutbox(eventIds) {
        return this._transact(['outbox'], 'readwrite', (transaction) => {
            const outbox = transaction.objectStore('outbox');
            for (const id of eventIds) { outbox.delete(id); }
        });
    }

    /**
     * ⚠️ Крючок для тестов: в коде расширения читателя нет. Число записей в очереди.
     * @returns {Promise<number>}
     */
    countOutbox() {
        return this._transact(['outbox'], 'readonly', (transaction, setResult, guard) => {
            const request = transaction.objectStore('outbox').count();
            request.onsuccess = guard(() => { setResult(request.result); });
        });
    }

    /**
     * Общая обвязка транзакции. Результат отдаётся по `complete`; при отказе
     * отклоняется РЕАЛЬНОЙ причиной.
     *
     * ⚠️ `transaction.onerror` с `reject(transaction.error)` тут нельзя:
     * во время всплытия ошибки `transaction.error` равен null. Ошибка запроса
     * без preventDefault прерывает транзакцию (откат всего), а причину несёт
     * `onabort`, с запасным `new Error(...)`.
     * @template T
     * @param {string[]} storeNames
     * @param {IDBTransactionMode} mode
     * @param {(
     *     transaction: IDBTransaction,
     *     setResult: (value: T) => void,
     *     guard: (callback: () => void) => (() => void)
     * ) => void} body
     * @returns {Promise<T>}
     */
    _transact(storeNames, mode, body) {
        return new Promise((resolve, reject) => {
            const transaction = this._db.transaction(storeNames, mode);
            /** @type {T|undefined} */
            let result = void 0;
            transaction.oncomplete = () => { resolve(/** @type {T} */ (result)); };
            transaction.onabort = () => {
                reject(transaction.error ?? new Error('Transaction aborted'));
            };
            /** @param {unknown} e */
            const fail = (e) => {
                reject(e);
                try {
                    transaction.abort();
                } catch (error) {
                    // Уже прерывается или завершена.
                }
            };
            /**
             * Операции хранилища могут бросить СИНХРОННО из обработчика —
             * ловим, реджектим и откатываем всё.
             * @param {() => void} callback
             * @returns {() => void}
             */
            const guard = (callback) => () => {
                try {
                    callback();
                } catch (e) {
                    fail(e);
                }
            };
            try {
                body(transaction, (value) => { result = value; }, guard);
            } catch (e) {
                fail(e);
            }
        });
    }
}
