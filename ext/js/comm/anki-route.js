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

/**
 * Выбор пути к Anki: через anki_conf Core (он проксирует протокол AnkiConnect
 * на POST /) или, если Core не запущен, напрямую в AnkiConnect на 8765.
 *
 * Почему Core определяется по GET /api/v1/health, а не по action `version`:
 * Core отвечает version=6 из read-only запасного хранилища даже когда Anki
 * лежит, и по ответу `version` его не отличить от настоящего AnkiConnect.
 */

import {parseJson} from '../core/json.js';

/** Адрес AnkiConnect по умолчанию — запасной путь, когда Core не отвечает. */
export const ANKI_DIRECT_SERVER = 'http://127.0.0.1:8765';

/** Сколько живёт результат проверки маршрута. */
export const ANKI_ROUTE_TTL_MS = 30_000;

/** Таймаут одной пробы (health Core или version AnkiConnect). */
export const ANKI_ROUTE_PROBE_TIMEOUT_MS = 1500;

/**
 * Действия, которые можно безопасно повторить на новом маршруте после сетевой
 * ошибки: чтение и идемпотентная запись (повтор даёт тот же итог).
 * addNote и multi решаются отдельно в {@link isRetryableAnkiAction}.
 */
const RETRYABLE_ACTIONS = new Set([
    'version',
    'deckNames',
    'modelNames',
    'modelFieldNames',
    'canAddNotes',
    'canAddNotesWithErrorDetail',
    'notesInfo',
    'cardsInfo',
    'findNotes',
    'findCards',
    'apiReflect',
    'updateNoteFields',
    'storeMediaFile',
]);

/**
 * Можно ли повторить действие AnkiConnect на новом маршруте после того, как
 * fetch отклонился на сетевом уровне.
 *
 * addNote: fetch() отклоняется одинаково и при «соединение отклонено» (запрос
 * не ушёл), и при обрыве уже после доставки (Core упал, успев передать заметку
 * в Anki). Различить эти случаи из браузера нельзя. Поэтому addNote повторяется
 * только при `allowDuplicate === false`: оба маршрута ведут в одну коллекцию,
 * и если первая попытка всё же дошла, повтор упрётся в проверку дубликатов
 * AnkiConnect («cannot create note because it is a duplicate»), а не создаст
 * вторую карточку. При allowDuplicate=true (duplicateBehavior «new») повтора
 * нет — пусть лучше пользователь нажмёт «+» ещё раз сам.
 * addNotes не повторяется: частичный успех пачки не отличить от провала.
 * @param {string} action
 * @param {import('core').SerializableObject} params
 * @returns {boolean}
 */
export function isRetryableAnkiAction(action, params) {
    if (RETRYABLE_ACTIONS.has(action)) { return true; }
    if (action === 'addNote') {
        const note = params.note;
        if (typeof note !== 'object' || note === null || Array.isArray(note)) { return false; }
        const options = /** @type {import('core').SerializableObject} */ (note).options;
        if (typeof options !== 'object' || options === null || Array.isArray(options)) { return false; }
        return /** @type {import('core').SerializableObject} */ (options).allowDuplicate === false;
    }
    if (action === 'multi') {
        const actions = params.actions;
        if (!Array.isArray(actions)) { return false; }
        return /** @type {unknown[]} */ (actions).every((item) => {
            if (typeof item !== 'object' || item === null || Array.isArray(item)) { return false; }
            const {action: innerAction, params: innerParams} = /** @type {{action?: unknown, params?: unknown}} */ (item);
            if (typeof innerAction !== 'string' || innerAction === 'multi') { return false; }
            const p = (typeof innerParams === 'object' && innerParams !== null && !Array.isArray(innerParams)) ? /** @type {import('core').SerializableObject} */ (innerParams) : {};
            return isRetryableAnkiAction(innerAction, p);
        });
    }
    return false;
}

/**
 * Указывает ли адрес на прямой AnkiConnect (localhost/127.0.0.1, порт 8765).
 * @param {string} url
 * @returns {boolean}
 */
export function isDirectAnkiConnectUrl(url) {
    let parsed;
    try {
        parsed = new URL(url.trim());
    } catch (e) {
        return false;
    }
    return (parsed.hostname === '127.0.0.1' || parsed.hostname === 'localhost') && parsed.port === '8765';
}

/**
 * @param {typeof fetch} fetchFn
 * @param {string} url
 * @param {RequestInit} init
 * @param {number} timeoutMs
 * @returns {Promise<?unknown>} Разобранный JSON при 2xx, иначе null.
 */
async function fetchJsonWithTimeout(fetchFn, url, init, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
        const response = await fetchFn(url, {...init, signal: controller.signal, cache: 'no-store', credentials: 'omit'});
        if (!response.ok) { return null; }
        const text = await response.text();
        return /** @type {unknown} */ (parseJson(text));
    } catch (e) {
        return null;
    } finally {
        clearTimeout(timer);
    }
}

/**
 * Жив ли anki_conf Core. 2xx с HTML или чем-то не-JSON — это не Core
 * (на порту сидит чужой сервис), поэтому требуется JSON-объект со строковым
 * `status` (Core отвечает `{"status":"healthy","service":"core"}`).
 * @param {string} base
 * @param {{fetch: typeof fetch, timeoutMs: number}} deps
 * @returns {Promise<boolean>}
 */
export async function probeCoreHealth(base, {fetch: fetchFn, timeoutMs}) {
    const url = `${base.replace(/\/+$/, '')}/api/v1/health`;
    const body = await fetchJsonWithTimeout(fetchFn, url, {method: 'GET'}, timeoutMs);
    return typeof body === 'object' && body !== null && !Array.isArray(body) &&
    typeof /** @type {Record<string, unknown>} */ (body).status === 'string';
}

/**
 * Жив ли AnkiConnect. Любой ответ в форме протокола AnkiConnect (v6:
 * `{result, error}`) считается «жив» — даже ошибка ключа API: сервер отвечает,
 * а неверный ключ покажут обычные сообщения об ошибке.
 * @param {string} server
 * @param {{fetch: typeof fetch, timeoutMs: number, apiKey: ?string}} deps
 * @returns {Promise<boolean>}
 */
export async function probeAnkiConnect(server, {fetch: fetchFn, timeoutMs, apiKey}) {
    /** @type {{action: string, version: number, key?: string}} */
    const body = {action: 'version', version: 6};
    if (apiKey !== null) { body.key = apiKey; }
    const result = await fetchJsonWithTimeout(fetchFn, server, {
        method: 'POST',
        headers: {'Content-Type': 'application/json'},
        body: JSON.stringify(body),
    }, timeoutMs);
    return typeof result === 'object' && result !== null && !Array.isArray(result) &&
    ('result' in result || 'error' in result);
}

/**
 * @param {object} details
 * @param {string} details.primary Значение `anki.server` (обрезается).
 * @param {?string} details.apiKey Ключ AnkiConnect для пробы version.
 * @param {typeof fetch} details.fetch
 * @param {() => number} details.now
 * @param {number} [details.timeoutMs]
 * @returns {Promise<import('anki-route').AnkiRoute>}
 */
export async function resolveAnkiRoute({primary: rawPrimary, apiKey, fetch: fetchFn, now, timeoutMs = ANKI_ROUTE_PROBE_TIMEOUT_MS}) {
    const primary = rawPrimary.trim();
    const deps = {fetch: fetchFn, timeoutMs, apiKey};
    if (primary.length > 0 && isDirectAnkiConnectUrl(primary)) {
        // Пользователь сам выбрал прямой AnkiConnect — Core не спрашиваем.
        const alive = await probeAnkiConnect(primary, deps);
        return {mode: alive ? 'direct' : 'none', ankiServer: primary, coreBase: null, checkedAt: now()};
    }
    if (primary.length > 0 && await probeCoreHealth(primary, deps)) {
        return {mode: 'core', ankiServer: primary, coreBase: primary, checkedAt: now()};
    }
    if (await probeAnkiConnect(ANKI_DIRECT_SERVER, deps)) {
        return {mode: 'direct', ankiServer: ANKI_DIRECT_SERVER, coreBase: null, checkedAt: now()};
    }
    return {mode: 'none', ankiServer: primary, coreBase: null, checkedAt: now()};
}

/**
 * Кэширует маршрут на TTL, сводит одновременные запросы в одну пробу и не даёт
 * пробе, начатой для старого адреса, записать результат после смены адреса.
 */
export class AnkiRouteResolver {
    /**
     * @param {object} details
     * @param {typeof fetch} details.fetch
     * @param {() => number} details.now
     * @param {number} [details.ttlMs]
     * @param {number} [details.timeoutMs]
     */
    constructor({fetch: fetchFn, now, ttlMs = ANKI_ROUTE_TTL_MS, timeoutMs = ANKI_ROUTE_PROBE_TIMEOUT_MS}) {
        /** @type {typeof fetch} */
        this._fetch = fetchFn;
        /** @type {() => number} */
        this._now = now;
        /** @type {number} */
        this._ttlMs = ttlMs;
        /** @type {number} */
        this._timeoutMs = timeoutMs;
        /** @type {string} */
        this._primary = '';
        /** @type {?string} */
        this._apiKey = null;
        /** @type {?import('anki-route').AnkiRoute} */
        this._route = null;
        /** @type {?Promise<import('anki-route').AnkiRoute>} */
        this._inFlight = null;
        /** Растёт при смене адреса/ключа; проба старого поколения не кэшируется. */
        this._generation = 0;
    }

    /** @type {string} */
    get primary() {
        return this._primary;
    }

    /**
     * @param {{primary: string, apiKey: ?string}} details
     */
    configure({primary, apiKey}) {
        const trimmed = primary.trim();
        if (trimmed === this._primary && apiKey === this._apiKey) { return; }
        this._primary = trimmed;
        this._apiKey = apiKey;
        this.invalidate();
    }

    /** Забыть кэш и отвязать текущую пробу (её результат не запишется). */
    invalidate() {
        ++this._generation;
        this._route = null;
        this._inFlight = null;
    }

    /**
     * Последний принятый маршрут без сети (null — ещё не проверяли).
     * @returns {?import('anki-route').AnkiRoute}
     */
    peek() {
        return this._route;
    }

    /**
     * @param {{force?: boolean}} [options]
     * @returns {Promise<import('anki-route').AnkiRoute>}
     */
    async getRoute({force = false} = {}) {
        if (this._inFlight !== null) { return await this._inFlight; }
        const cached = this._route;
        if (!force && cached !== null && this._now() - cached.checkedAt < this._ttlMs) {
            return cached;
        }
        const generation = this._generation;
        const promise = resolveAnkiRoute({
            primary: this._primary,
            apiKey: this._apiKey,
            fetch: this._fetch,
            now: this._now,
            timeoutMs: this._timeoutMs,
        }).then((route) => {
            if (generation === this._generation) {
                this._route = route;
            }
            return route;
        }).finally(() => {
            if (this._inFlight === promise) { this._inFlight = null; }
        });
        this._inFlight = promise;
        return await promise;
    }
}
