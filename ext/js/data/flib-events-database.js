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

import {log} from '../core/log.js';
import {Database} from './database.js';
import {dedupKey} from './flib-event-envelope.js';

export const FLIB_EVENTS_DB_NAME = 'flib-events';

export const FLIB_EVENTS_DB_VERSION = 1;

export const FLIB_EVENTS_MAX_RECORDS = 10000;

/**
 * Локальная очередь пользовательских событий. Читателя пока нет — отправщик
 * появится позже; наружу торчат listEvents/deleteEvents именно для него.
 *
 * ⚠️ Ключи дедупа лежат ЗДЕСЬ, а не в памяти: сервис-воркер MV3 глушится по
 * простою, и множество в памяти исчезло бы молча.
 *
 * ⚠️ РОТАЦИИ ПО ВОЗРАСТУ НЕТ, И ЭТО НАМЕРЕННО (ТЗ O-7, ревизия 6). Отправщика
 * ещё не существует, флага `sent` в записи нет — значит КАЖДОЕ событие,
 * которое уборка удалит, по построению не отправлено. Возрастной предел в 90
 * дней принимался в расчёте на очередь, которую кто-то ВЫЧЕРПЫВАЕТ; для
 * очереди без слива он превращается в таймер уничтожения улик: если
 * отправщик поедет позже, чем через 90 дней после того, как пользователи
 * встанут на эту сборку, первые 90 дней наблюдений просто исчезнут.
 * Ограничение по ЧИСЛУ записей остаётся — это настоящий предел хранилища,
 * которого не избежать. В день, когда появится отправщик, это решение
 * обязано быть пересмотрено вместе с O-7.
 */
export class FlibEventsDatabase {
    /**
     * @param {{maxRecords?: number}} [options]
     */
    constructor({maxRecords = FLIB_EVENTS_MAX_RECORDS} = {}) {
        /** @type {Database<'events'|'dedup'>} */
        this._db = new Database();
        /** @type {number} */
        this._maxRecords = maxRecords;
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
     * умершим соединением обязан быть выброшен, иначе КАЖДЫЙ следующий
     * recordEvent падает до конца жизни воркера.
     * @returns {boolean}
     */
    get isUsable() {
        return this._db.isOpen() && !this._closedByBrowser;
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
        this._db.setOnCloseListener(() => { this._closedByBrowser = true; });
    }

    /**
     * ⚠️ ВСЁ В ОДНОЙ ТРАНЗАКЦИИ: проверка ключей, запись ключей дедупа и
     * запись события. Иначе два клика в полёте оба проходят проверку, оба
     * пишут событие, второй падает на ключе — дубль плюс исключение наружу.
     *
     * ⚠️ Ключи дедупа ставятся ПЕРВЫМИ, событие — ПОСЛЕДНИМ. Порядок внутри
     * одной транзакции безразличен для атомарности (либо коммитится всё,
     * либо ничего), но именно такой порядок делает проверку отката
     * содержательной: падение записи события происходит уже ПОСЛЕ того, как
     * ключи фактически поставлены в очередь транзакции, так что тест обязан
     * убедиться, что транзакция реально откатывает уже выполненные dedup.add,
     * а не просто никогда до них не доходит.
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
                // dedup.add/events.add can throw SYNCHRONOUSLY (e.g. event_id
                // missing its keyPath value, or a forced failure in tests).
                // Catch it here rather than let it escape the event-handler
                // frame: we reject directly and abort the transaction so it
                // rolls back everything already queued in it — including
                // dedup keys staged for earlier lemmas before a later
                // operation (in either store) fails.
                try {
                    for (const lemma of fresh) {
                        dedup.add({key: dedupKey(event.url, event.type, lemma), ts: event.ts});
                    }
                    events.add({...event, lemmas: fresh});
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
            // ⚠️ Ротация — уборка ПОСЛЕ уже состоявшейся записи, а не часть
            // её результата: событие физически на месте и вызывающий обязан
            // узнать true, каким бы ни был исход уборки. Отказ здесь только
            // логируется.
            try {
                await this._rotate();
            } catch (error) {
                log.error(error);
            }
        }
        return written;
    }

    /**
     * ⚠️ ДЛЯ БУДУЩЕГО ОТПРАВЩИКА, ДВЕ ЛОВУШКИ (ТЗ §6, ревизия 6):
     *
     * 1. Фильтр строгий (`ts > since`), поэтому курсор по `ts` ТЕРЯЕТ соседа
     *    с РАВНЫМ `ts`. Это не теория: два раскрытия, зарезолвившиеся в одном
     *    `Promise.all`, дают ровно одинаковый `Date.now()`.
     * 2. `ts = Date.now()` не монотонен (перевод часов, NTP).
     *
     * Значит отправщик обязан удалять отправленное по `event_id`
     * (`deleteEvents`) и НЕ ВЕСТИ курсор по `ts`.
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

    /**
     * Уборка. Делает две вещи, но **одной транзакцией и одним полным проходом
     * по `events`**.
     *
     * 1. **Переполнение.** Обречены ТОЛЬКО события, не влезшие в `maxRecords`
     *    (возраст в приговоре не участвует — см. комментарий у класса), самые
     *    старые первыми. Событие снимается ВМЕСТЕ со своими ключами дедупа.
     *    Раздельные транзакции (сначала событие, потом ключи, или наоборот)
     *    оставляют окно: смерть воркера MV3 между двумя коммитами оставляет
     *    ключ без события (или наоборот) НАВСЕГДА.
     *
     * 2. **Осиротевшие ключи дедупа** — те, чьего события в `events` больше
     *    нет по ЛЮБОЙ причине (их событие убрал `deleteEvents`, который чистит
     *    только `events`; остались от прежних сборок). Без этого `dedup` растёт
     *    неограниченно, а лемма остаётся заглушённой навечно.
     *
     * ⚠️ Критерий второго прохода — СИРОТСТВО, а не возраст. Возрастной
     * вариант (был здесь раньше) имел два порока сразу: он молча отключался
     * целиком, когда `maxAgeMs` оказывался бесконечным (а именно такое
     * значение стояло умолчанием в тестах — доедь оно до продакшна, каждая
     * осиротевшая лемма была бы заглушена НАВЕЧНО), и он ничего не знал о том,
     * живо ли событие ключа. Сиротство свободно от обоих.
     *
     * ⚠️ **ЦЕНА, И ПОЧЕМУ ОНА ОГРАНИЧЕНА.** Уборка идёт после КАЖДОЙ
     * состоявшейся записи, внутри сервис-воркера MV3, при потолке в 10 000
     * записей. Промежуточная версия делала здесь ТРИ полных прохода
     * (`getAll` событий в `_rotate`, второй `getAll` внутри уборки сирот и
     * полный курсор по `dedup`) — это и было замечание проверки. Теперь:
     *
     * - `events.getAll()` ровно один, его результат обслуживает и приговор по
     *   переполнению, и построение множества живых ключей;
     * - курсор по `dedup` открывается ТОЛЬКО когда `dedup.count()` доказывает,
     *   что сирота существует. Доказательство точное, а не эвристика: ключи
     *   ставятся той же транзакцией, что и событие, поэтому живые ключи —
     *   подмножество `dedup`, и `count === live.size` означает совпадение
     *   множеств, то есть отсутствие сирот. В здоровом состоянии (а сегодня
     *   оно всегда здорово: `deleteEvents` никто не зовёт) второго прохода нет
     *   вовсе.
     *
     * ⚠️ Возрастную настройку сюда возвращать НЕЛЬЗЯ: она удаляла бы
     * неотправленное (см. комментарий у класса).
     *
     * ⚠️ `dedup.count()` ставится ПОСЛЕ удалений по переполнению: запросы
     * внутри транзакции исполняются по порядку, так что счёт уже учитывает
     * снятые ключи, и оценка остаётся точной.
     * ⚠️ Единственный случай, когда точность теряется, — внешне повреждённое
     * состояние, где живого ключа НЕТ в `dedup` (столько же, сколько лишних):
     * тогда счётчики сходятся и проход пропускается. Состояние самолечится:
     * следующая запись этой леммы ставит ключ обратно, счётчики расходятся, и
     * сирота убирается.
     * @returns {Promise<void>}
     */
    _rotate() {
        return new Promise((resolve, reject) => {
            const transaction = this._db.transaction(['events', 'dedup'], 'readwrite');
            const events = transaction.objectStore('events');
            const dedup = transaction.objectStore('dedup');
            let settled = false;

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
            transaction.oncomplete = () => {
                if (settled) { return; }
                settled = true;
                resolve();
            };

            const allRequest = events.getAll();
            allRequest.onsuccess = () => {
                // delete/count могут бросить СИНХРОННО (отказ самой операции,
                // форсированный сбой в тесте). Ловим здесь, а не выпускаем из
                // кадра обработчика: реджектим и прерываем транзакцию, чтобы
                // откатилось всё уже поставленное в неё.
                try {
                    const all = /** @type {import('flib-events').FlibEvent[]} */ (allRequest.result)
                        .sort((a, b) => a.ts - b.ts);
                    const excess = all.length - this._maxRecords;
                    const survivors = excess > 0 ? all.slice(excess) : all;
                    if (excess > 0) {
                        for (const event of all.slice(0, excess)) {
                            events.delete(event.event_id);
                            for (const lemma of event.lemmas) {
                                dedup.delete(dedupKey(event.url, event.type, lemma));
                            }
                        }
                    }
                    /** @type {Set<string>} */
                    const live = new Set();
                    for (const event of survivors) {
                        for (const lemma of event.lemmas) {
                            live.add(dedupKey(event.url, event.type, lemma));
                        }
                    }
                    const countRequest = dedup.count();
                    countRequest.onsuccess = () => {
                        if (countRequest.result <= live.size) { return; }
                        const cursorRequest = dedup.openKeyCursor();
                        cursorRequest.onsuccess = () => {
                            const cursor = cursorRequest.result;
                            if (cursor === null) { return; }
                            if (!live.has(/** @type {string} */ (cursor.key))) {
                                dedup.delete(cursor.key);
                            }
                            cursor.continue();
                        };
                    };
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
                }
            };
        });
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
