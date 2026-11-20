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

import {getFlibErrorCode} from '../comm/flib-gateway-client.js';
import {ExtensionError} from '../core/extension-error.js';
import {toWireEvent} from '../data/flib-event-envelope.js';
import {normalizeFlibPersonalKey} from '../data/flib-service-config.js';

/*
 * Отправщик очереди событий маршрута (outbox → POST /v1/route/external-events).
 *
 * Состояние (D2):
 * - chrome.storage.local `flibEventsPause` = {until, keyFingerprint}: пишет и читает только этот класс;
 *   пауза чужого отпечатка (ключ сменился) снимается при первом чтении;
 * - память: `_active`/`_runAgain` (одна отправка за раз и не больше одного повтора), `_debouncePending`
 *   (таймер отложенной отправки после записи события уже стоит), `_backoffMs`,
 *   `_backoffTimer`/`_backoffPending` (ступень и таймер отсрочки), `_route` (route_id на 10 минут,
 *   привязан к отпечатку ключа). Всё это теряется при засыпании service worker'а — так и задумано.
 *
 * Пока ждёт таймер отсрочки, внешние flush() не ходят в сеть: иначе каждое новое событие
 * при лежащем шлюзе давало бы лишний запрос. Таймер снимает флаг ДО вызова flush(), поэтому
 * ранний срабатыватель не может застрять на проверке времени.
 */

/** Пачка outbox за один запрос. */
export const FLIB_EVENTS_BATCH = 50;

/** 404 с любым кодом (ось маршрута выключена). */
export const FLIB_EVENTS_PAUSE_404_MS = 3600000;

/** 403: право на маршрут может вернуться на том же ключе после покупки. */
export const FLIB_EVENTS_PAUSE_403_MS = 21600000;

/** Маршрута нет: route_id === null, 409 route_not_started, повторный 409. */
export const FLIB_EVENTS_PAUSE_NO_ROUTE_MS = 600000;

/** Сколько живёт route_id в памяти. */
export const FLIB_EVENTS_ROUTE_ID_TTL_MS = 600000;

/** Первая ступень отсрочки (5xx, сеть, таймаут, прочие 4xx); дальше удваивается. */
export const FLIB_EVENTS_BACKOFF_MIN_MS = 30000;

/** Потолок отсрочки. */
export const FLIB_EVENTS_BACKOFF_MAX_MS = 1800000;

/** 429 без Retry-After. */
export const FLIB_EVENTS_RATE_DEFAULT_MS = 60000;

/** Ключ паузы в chrome.storage.local. */
export const FLIB_EVENTS_PAUSE_KEY = 'flibEventsPause';

/**
 * 401 (и брошенный flib_key_invalid): сутки для того же ключа. 401 значит «ключ неизвестен»
 * (сбой хранилища шлюз отвечает 503, просроченный или отозванный ключ — 403), но восстановленный
 * ключ не должен молчать вечно, а повторный ввод того же ключа паузу не снимает. Смена ключа
 * снимает её сразу.
 */
export const FLIB_EVENTS_PAUSE_401_MS = 86400000;

/**
 * Окно отложенной отправки после записи события (flushSoon): серия наведений уходит одним
 * запросом, а не запросом на каждое событие, и не упирается в 429 шлюза.
 */
export const FLIB_EVENTS_DEBOUNCE_MS = 5000;

/** Запасной предохранитель цикла пачек (очередь ограничена 300 записями, то есть 6 пачками); основной — «первая запись пачки не сменилась». */
const MAX_BATCHES_PER_RUN = 20;
const RETRY_AFTER_MIN_SEC = 1;
const RETRY_AFTER_MAX_SEC = 3600;

/**
 * @typedef {object} FlibEventsSenderDetails
 * @property {() => Promise<Pick<import('../data/flib-events-database.js').FlibEventsDatabase, 'listOutbox' | 'deleteOutbox' | 'pruneOutbox'>>} getDatabase
 * @property {Pick<import('../comm/flib-gateway-client.js').FlibGatewayClient, 'getRouteId' | 'postExternalEvents'>} gateway
 * @property {() => Promise<string>} getKey Сырой личный ключ.
 * @property {{get: (key: string) => Promise<Record<string, unknown>>, set: (items: Record<string, unknown>) => Promise<void>}} storage
 * @property {() => number} now
 * @property {(callback: () => void, delay: number) => unknown} setTimer
 * @property {(handle: unknown) => void} clearTimer
 * @property {{log: (message: string) => void, error: (error: unknown) => void}} log
 */

/**
 * @typedef {object} CachedRoute
 * @property {string} fingerprint
 * @property {string} routeId
 * @property {number} expiresAt
 */

/**
 * Первые 16 шестнадцатеричных знаков SHA-256 ключа. Сам ключ никуда не пишется.
 * @param {string} key
 * @returns {Promise<string>}
 */
async function getKeyFingerprint(key) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(key));
    return Array.from(new Uint8Array(digest).subarray(0, 8), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {unknown} value
 * @returns {value is {until: number, keyFingerprint: string}}
 */
function isPauseRecord(value) {
    if (typeof value !== 'object' || value === null) { return false; }
    const record = /** @type {{until?: unknown, keyFingerprint?: unknown}} */ (value);
    return typeof record.until === 'number' && typeof record.keyFingerprint === 'string';
}

/**
 * @param {unknown} error
 * @returns {?number}
 */
function getFlibErrorStatus(error) {
    if (!(error instanceof ExtensionError)) { return null; }
    const data = /** @type {{status?: unknown}} */ (error.data ?? {});
    return typeof data.status === 'number' ? data.status : null;
}

export class FlibEventsSender {
    /**
     * @param {FlibEventsSenderDetails} details
     */
    constructor({getDatabase, gateway, getKey, storage, now, setTimer, clearTimer, log}) {
        /** @type {FlibEventsSenderDetails['getDatabase']} */
        this._getDatabase = getDatabase;
        /** @type {FlibEventsSenderDetails['gateway']} */
        this._gateway = gateway;
        /** @type {FlibEventsSenderDetails['getKey']} */
        this._getKey = getKey;
        /** @type {FlibEventsSenderDetails['storage']} */
        this._storage = storage;
        /** @type {FlibEventsSenderDetails['now']} */
        this._now = now;
        /** @type {FlibEventsSenderDetails['setTimer']} */
        this._setTimer = setTimer;
        /** @type {FlibEventsSenderDetails['clearTimer']} */
        this._clearTimer = clearTimer;
        /** @type {FlibEventsSenderDetails['log']} */
        this._log = log;
        /** @type {?Promise<void>} */
        this._active = null;
        /** @type {boolean} */
        this._runAgain = false;
        /** @type {number} */
        this._backoffMs = FLIB_EVENTS_BACKOFF_MIN_MS;
        /** @type {unknown} */
        this._backoffTimer = null;
        /** @type {boolean} */
        this._backoffPending = false;
        /** @type {?CachedRoute} */
        this._route = null;
        /** @type {boolean} */
        this._debouncePending = false;
    }

    /**
     * Отложенная отправка: её зовёт запись события. Первый вызов ставит один таймер на
     * FLIB_EVENTS_DEBOUNCE_MS, следующие в пределах окна к нему присоединяются (таймер не
     * переставляется, поэтому непрерывная серия событий не откладывает отправку бесконечно).
     * Запуск фоновой части зовёт flush() напрямую, без задержки.
     */
    flushSoon() {
        if (this._debouncePending) { return; }
        this._debouncePending = true;
        this._setTimer(() => {
            this._debouncePending = false;
            void this.flush();
        }, FLIB_EVENTS_DEBOUNCE_MS);
    }

    /**
     * Отправить очередь. Вызов во время отправки ставит один флаг «ещё раз» и возвращает
     * текущую цепочку: после неё будет не больше одного дополнительного прогона.
     * Никогда не отклоняется: все ошибки уходят в лог.
     * @returns {Promise<void>}
     */
    flush() {
        if (this._active !== null) {
            this._runAgain = true;
            return this._active;
        }
        const active = this._drive();
        this._active = active;
        return active;
    }

    /**
     * Завершение текущей цепочки отправки (или сразу, если её нет).
     * @returns {Promise<void>}
     */
    idle() {
        return this._active ?? Promise.resolve();
    }

    // Private

    /**
     * @returns {Promise<void>}
     */
    async _drive() {
        try {
            do {
                this._runAgain = false;
                try {
                    await this._run();
                } catch (e) {
                    this._log.error(e);
                }
            } while (this._runAgain);
        } finally {
            this._active = null;
        }
    }

    /**
     * @returns {Promise<void>}
     */
    async _run() {
        if (this._backoffPending) { return; }
        const {valid, value: key} = normalizeFlibPersonalKey(await this._getKey());
        if (!valid || key === '') { return; }
        const fingerprint = await getKeyFingerprint(key);
        if (await this._isPaused(fingerprint)) { return; }
        const database = await this._getDatabase();
        // Пределы 7 суток / 300 и срок ключей дедупа действуют и здесь, а не
        // только при записи: иначе старое событие ушло бы на шлюз при старте.
        await database.pruneOutbox(this._now());
        /** @type {?string} */
        let previousFirstId = null;
        for (let i = 0; i < MAX_BATCHES_PER_RUN; ++i) {
            const records = await database.listOutbox(FLIB_EVENTS_BATCH);
            if (records.length === 0) { return; }
            const firstId = records[0].event_id;
            if (firstId === previousFirstId) {
                // Удаление после 200 молча ничего не сделало: та же пачка ушла бы снова.
                this._log.error(new Error(`flib events: the outbox did not shrink after a sent batch (first event ${firstId}); stopping the run`));
                return;
            }
            previousFirstId = firstId;
            if (!(await this._sendBatch(database, fingerprint, records))) { return; }
        }
        this._log.error(new Error(`flib events: ${MAX_BATCHES_PER_RUN} batches in one run, the outbox does not shrink`));
    }

    /**
     * @param {string} fingerprint
     * @returns {Promise<boolean>}
     */
    async _isPaused(fingerprint) {
        const items = await this._storage.get(FLIB_EVENTS_PAUSE_KEY);
        const pause = items[FLIB_EVENTS_PAUSE_KEY];
        if (typeof pause === 'undefined' || pause === null) { return false; }
        if (isPauseRecord(pause) && pause.keyFingerprint === fingerprint) {
            return pause.until > this._now();
        }
        // Пауза другого ключа (или мусор): смена ключа снимает паузу.
        await this._storage.set({[FLIB_EVENTS_PAUSE_KEY]: null});
        return false;
    }

    /**
     * Одна пачка. true — пачка удалена после 200, можно брать следующую.
     * @param {Pick<import('../data/flib-events-database.js').FlibEventsDatabase, 'listOutbox' | 'deleteOutbox' | 'pruneOutbox'>} database
     * @param {string} fingerprint
     * @param {import('flib-events').FlibOutboxRecord[]} records
     * @returns {Promise<boolean>}
     */
    async _sendBatch(database, fingerprint, records) {
        const routeId = await this._resolveRouteId(fingerprint);
        if (routeId === null) { return false; }
        const events = records.map(toWireEvent);
        let result = await this._post(fingerprint, routeId, events);
        if (result === null) { return false; }
        if (result.kind === 'http' && result.status === 409 && result.error === 'stale_route' && result.routeId !== null) {
            this._setRoute(fingerprint, result.routeId);
            result = await this._post(fingerprint, result.routeId, events);
            if (result === null) { return false; }
            if (result.kind === 'http' && result.status === 409) {
                if (result.error === 'stale_route' && result.routeId !== null) {
                    this._setRoute(fingerprint, result.routeId);
                } else {
                    this._route = null;
                }
                await this._pause(fingerprint, this._now() + FLIB_EVENTS_PAUSE_NO_ROUTE_MS, `409 ${result.error} after a stale_route retry`);
                return false;
            }
        }
        return await this._applyResult(database, fingerprint, records, result);
    }

    /**
     * @param {Pick<import('../data/flib-events-database.js').FlibEventsDatabase, 'listOutbox' | 'deleteOutbox' | 'pruneOutbox'>} database
     * @param {string} fingerprint
     * @param {import('flib-events').FlibOutboxRecord[]} records
     * @param {import('flib-gateway').ExternalEventsResult} result
     * @returns {Promise<boolean>}
     */
    async _applyResult(database, fingerprint, records, result) {
        const ids = records.map((record) => record.event_id);
        if (result.kind === 'ok') {
            // Принятые ответ не перечисляет: 200 закрывает всю пачку (принятые, дубликаты, отклонённые).
            const rejected = result.rejectedIds.filter((id) => id !== '');
            if (rejected.length > 0) {
                this._log.log(`flib events: ${rejected.length} rejected by the server: ${rejected.join(', ')}`);
            }
            await database.deleteOutbox(ids);
            this._resetBackoff();
            return true;
        }
        const {status, error} = result;
        const now = this._now();
        if (status === 400 && error === 'bad_request') {
            this._log.error(`flib events: 400 bad_request, our bug; dropping ${ids.length} events`);
            await database.deleteOutbox(ids);
            return false;
        }
        if (status === 413) {
            // 50 событий не превышают лимит тела 4 MiB; размер одного события сервер отклоняет внутри 200.
            this._log.error(`flib events: 413 for a batch of ${ids.length}, our bug; dropping it`);
            await database.deleteOutbox(ids);
            return false;
        }
        switch (status) {
            case 401:
                await this._pause(fingerprint, now + FLIB_EVENTS_PAUSE_401_MS, '401');
                return false;
            case 403:
                await this._pause(fingerprint, now + FLIB_EVENTS_PAUSE_403_MS, `403 ${error}`);
                return false;
            case 404:
                await this._pause(fingerprint, now + FLIB_EVENTS_PAUSE_404_MS, `404 ${error}`);
                return false;
            case 409:
                if (error === 'route_not_started') {
                    this._route = null;
                    await this._pause(fingerprint, now + FLIB_EVENTS_PAUSE_NO_ROUTE_MS, '409 route_not_started');
                    return false;
                }
                if (error === 'stale_route') {
                    // stale_route без нового номера: кешированный route_id точно устарел.
                    this._route = null;
                }
                break;
            case 429:
            {
                const seconds = result.retryAfterSec === null ?
                    FLIB_EVENTS_RATE_DEFAULT_MS / 1000 :
                    Math.min(RETRY_AFTER_MAX_SEC, Math.max(RETRY_AFTER_MIN_SEC, result.retryAfterSec));
                await this._pause(fingerprint, now + seconds * 1000, '429');
                return false;
            }
        }
        // ≥500, прочие 4xx и 200 с телом не той формы.
        this._scheduleBackoff(`HTTP ${status} ${error}`);
        return false;
    }

    /**
     * route_id из памяти или из GET /v1/route/state. null — исход уже обработан (пауза/отсрочка).
     * @param {string} fingerprint
     * @returns {Promise<?string>}
     */
    async _resolveRouteId(fingerprint) {
        const cached = this._route;
        if (cached !== null && cached.fingerprint === fingerprint && cached.expiresAt > this._now()) {
            return cached.routeId;
        }
        this._route = null;
        /** @type {?string} */
        let routeId;
        try {
            routeId = await this._gateway.getRouteId();
        } catch (e) {
            await this._onThrown(fingerprint, e);
            return null;
        }
        if (routeId === null) {
            await this._pause(fingerprint, this._now() + FLIB_EVENTS_PAUSE_NO_ROUTE_MS, 'no route');
            return null;
        }
        this._setRoute(fingerprint, routeId);
        return routeId;
    }

    /**
     * @param {string} fingerprint
     * @param {string} routeId
     * @param {import('flib-events').FlibWireEvent[]} events
     * @returns {Promise<?import('flib-gateway').ExternalEventsResult>}
     */
    async _post(fingerprint, routeId, events) {
        try {
            return await this._gateway.postExternalEvents(routeId, events);
        } catch (e) {
            await this._onThrown(fingerprint, e);
            return null;
        }
    }

    /**
     * Брошенная клиентом шлюза ошибка. Пачка всегда остаётся в очереди.
     * @param {string} fingerprint
     * @param {unknown} error
     * @returns {Promise<void>}
     */
    async _onThrown(fingerprint, error) {
        const code = getFlibErrorCode(error);
        // Отмена — не исход: ни паузы, ни отсрочки. Ключ пропал посреди прогона — следующий прогон сам выйдет.
        if (code === 'flib_aborted' || code === 'flib_key_missing') { return; }
        if (code === 'flib_key_invalid') {
            await this._pause(fingerprint, this._now() + FLIB_EVENTS_PAUSE_401_MS, code);
            return;
        }
        const status = getFlibErrorStatus(error);
        if (code === 'flib_forbidden' || status === 403) {
            await this._pause(fingerprint, this._now() + FLIB_EVENTS_PAUSE_403_MS, `403 ${code}`);
            return;
        }
        // Выключенная ось маршрута отвечает 404 not_found уже на GET /v1/route/state (до проверки ключа).
        if (status === 404) {
            await this._pause(fingerprint, this._now() + FLIB_EVENTS_PAUSE_404_MS, `404 ${code}`);
            return;
        }
        if (code === null) { this._log.error(error); }
        this._scheduleBackoff(code ?? 'unexpected error');
    }

    /**
     * @param {string} fingerprint
     * @param {string} routeId
     */
    _setRoute(fingerprint, routeId) {
        this._route = {fingerprint, routeId, expiresAt: this._now() + FLIB_EVENTS_ROUTE_ID_TTL_MS};
    }

    /**
     * @param {string} fingerprint
     * @param {number} until
     * @param {string} reason
     * @returns {Promise<void>}
     */
    async _pause(fingerprint, until, reason) {
        this._log.log(`flib events: paused (${reason}) until ${new Date(until).toISOString()}`);
        await this._storage.set({[FLIB_EVENTS_PAUSE_KEY]: {until, keyFingerprint: fingerprint}});
    }

    /**
     * @param {string} reason
     */
    _scheduleBackoff(reason) {
        const delay = this._backoffMs;
        this._backoffMs = Math.min(delay * 2, FLIB_EVENTS_BACKOFF_MAX_MS);
        if (this._backoffTimer !== null) { this._clearTimer(this._backoffTimer); }
        this._backoffPending = true;
        this._log.log(`flib events: ${reason}, retry in ${delay} ms`);
        this._backoffTimer = this._setTimer(() => {
            this._backoffTimer = null;
            this._backoffPending = false;
            void this.flush();
        }, delay);
    }

    /** Успех: ступень отсрочки — снова 30 с, таймер снят. */
    _resetBackoff() {
        this._backoffMs = FLIB_EVENTS_BACKOFF_MIN_MS;
        if (this._backoffTimer !== null) {
            this._clearTimer(this._backoffTimer);
            this._backoffTimer = null;
        }
        this._backoffPending = false;
    }
}
