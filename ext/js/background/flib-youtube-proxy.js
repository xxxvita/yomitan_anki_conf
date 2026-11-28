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

import {FLIB_SITE_URL} from '../data/flib-host.js';

/*
 * Прокси /api копии плеера flib.club на youtube.com (бета «панель субтитров»).
 * Слой (flib-youtube/src/env/net.ts) шлёт сюда относительные запросы копии; здесь они проходят
 * проверки и уходят на FLIB_SITE_URL. handleFlibYoutubeProxy состояния не имеет; FlibYoutubeProxy
 * добавляет проверку беты.
 *
 * Порядок проверок (всё до сети):
 * 0. бета включена (FlibYoutubeProxy), иначе 403;
 * 1. отправитель — вкладка с origin ровно https://www.youtube.com, иначе 403;
 * 2. путь: начинается с /api/, без "..", "//", "\", "@", "#", ":" в пути, управляющих символов
 *    и пробелов; иначе 403;
 * 3. /api/video/* -> 404 (запасной путь сайта недоступен, п. 3.14 спеки);
 *    /api/telemetry/events -> 204 (аналитика после беты 1);
 * 4. точный pathname из белого списка и метод GET/POST/DELETE, иначе 403;
 * 5. тело — только строка или null, иначе 400 (слой сам превращает Blob в текст);
 * 6. /api/feedback/video — не больше 5 в минуту с вкладки (FlibYoutubeProxy), иначе 429.
 * Ответ: тело — текст, заголовки — все, парами. Сбой сети -> status 0 (слой превращает в TypeError).
 */

/**
 * @typedef {object} ProxyRequest
 * @property {'flibYoutubeFetch'} action
 * @property {string} path
 * @property {string} method
 * @property {Record<string, string>} headers
 * @property {string | null} body
 */

/**
 * @typedef {object} ProxyResponse
 * @property {number} status
 * @property {string} statusText
 * @property {Array<[string, string]>} headers
 * @property {string} body
 */

const ALLOWED_ORIGIN = 'https://www.youtube.com';

/** Точные pathname'ы, которые идут на сайт. */
const ALLOWED_PATHS = new Set([
    '/api/youtube/subtitles',
    '/api/youtube/subtitles/translate',
    '/api/examples',
    '/api/feedback/video',
    '/api/session',
]);

const ALLOWED_METHODS = new Set(['GET', 'POST', 'DELETE']);

/**
 * @param {number} status
 * @param {string} statusText
 * @returns {ProxyResponse}
 */
function makeResponse(status, statusText) {
    return {status, statusText, headers: [], body: ''};
}

/**
 * Отправитель — вкладка с origin ровно https://www.youtube.com (общая проверка прокси и хранилища слоя).
 * @param {string | undefined} url
 * @returns {boolean}
 */
export function isYoutubeSender(url) {
    if (typeof url !== 'string') { return false; }
    try {
        return new URL(url).origin === ALLOWED_ORIGIN;
    } catch (_) {
        return false;
    }
}

/**
 * @param {unknown} path
 * @returns {path is string}
 */
function isSafePath(path) {
    if (typeof path !== 'string' || !path.startsWith('/api/')) { return false; }
    if (path.includes('..') || path.includes('//') || path.includes('\\') || path.includes('@') || path.includes('#')) { return false; }
    // eslint-disable-next-line no-control-regex
    if (/[\u0000-\u0020\u007f]/.test(path)) { return false; }
    const pathname = path.split('?', 1)[0];
    // Схема или любой «:» в пути; допустимы только буквы, цифры и _ - . /
    return /^\/api\/[A-Za-z0-9_\-./]*$/.test(pathname);
}

/**
 * @param {ProxyRequest} msg
 * @param {{url?: string}} sender
 * @param {(url: string, init: RequestInit) => Promise<Response>} fetchImpl
 * @param {(pathname: string, method: string) => ?ProxyResponse} [beforeNetwork] Последняя проверка
 *   перед сетью (после всех остальных): ответ вместо запроса или null.
 * @returns {Promise<ProxyResponse>}
 */
export async function handleFlibYoutubeProxy(msg, sender, fetchImpl, beforeNetwork) {
    if (!isYoutubeSender(sender?.url)) { return makeResponse(403, 'Forbidden'); }
    const path = msg?.path;
    if (!isSafePath(path)) { return makeResponse(403, 'Forbidden'); }
    const pathname = path.split('?', 1)[0];
    if (pathname.startsWith('/api/video/')) { return makeResponse(404, 'Not Found'); }
    if (pathname === '/api/telemetry/events') { return makeResponse(204, 'No Content'); }
    const method = typeof msg.method === 'string' ? msg.method.toUpperCase() : '';
    if (!ALLOWED_PATHS.has(pathname) || !ALLOWED_METHODS.has(method)) { return makeResponse(403, 'Forbidden'); }
    const body = msg.body;
    if (body !== null && typeof body !== 'string') { return makeResponse(400, 'Bad Request'); }
    const headers = (typeof msg.headers === 'object' && msg.headers !== null) ? msg.headers : {};
    const local = typeof beforeNetwork === 'function' ? beforeNetwork(pathname, method) : null;
    if (local !== null) { return local; }
    let response;
    try {
        response = await fetchImpl(FLIB_SITE_URL + path, {method, headers, body, credentials: 'omit'});
    } catch (_) {
        return makeResponse(0, 'network error');
    }
    let text = '';
    try {
        text = await response.text();
    } catch (_) {
        return makeResponse(0, 'network error');
    }
    return {
        status: response.status,
        statusText: response.statusText,
        headers: [...response.headers.entries()],
        body: text,
    };
}

const FEEDBACK_PATH = '/api/feedback/video';
const FEEDBACK_LIMIT = 5;
const FEEDBACK_WINDOW_MS = 60 * 1000;

/**
 * Прокси с состоянием фоновой части:
 * - работает только при включённой бете (I1), иначе 403;
 * - /api/feedback/video — не больше FEEDBACK_LIMIT запросов за FEEDBACK_WINDOW_MS с одной вкладки (I2):
 *   страница может подделать события моста, и каждое onError копии шлёт такой POST с anon_id
 *   пользователя. Сверх лимита — местный 429, в сеть ничего; отказанный запрос не считается.
 * Состояние: `_feedback` — вкладка -> времена пропущенных запросов за последнее окно (в памяти;
 * засыпание service worker'а лимит сбрасывает). Старые записи вычищаются при каждом запросе.
 */
export class FlibYoutubeProxy {
    /**
     * @param {{fetchImpl: (url: string, init: RequestInit) => Promise<Response>, isEnabled: () => boolean, now?: () => number}} deps
     */
    constructor({fetchImpl, isEnabled, now = () => Date.now()}) {
        /** @type {(url: string, init: RequestInit) => Promise<Response>} */
        this._fetch = fetchImpl;
        /** @type {() => boolean} */
        this._isEnabled = isEnabled;
        /** @type {() => number} */
        this._now = now;
        /** @type {Map<number, number[]>} */
        this._feedback = new Map();
    }

    /**
     * @param {ProxyRequest} msg
     * @param {{url?: string, tabId?: number}} sender
     * @returns {Promise<ProxyResponse>}
     */
    async handle(msg, sender) {
        if (!this._isEnabled()) { return makeResponse(403, 'Forbidden'); }
        const tabId = typeof sender?.tabId === 'number' ? sender.tabId : -1;
        return await handleFlibYoutubeProxy(msg, {url: sender?.url}, this._fetch, (pathname) => (pathname === FEEDBACK_PATH ? this._takeFeedbackSlot(tabId) : null));
    }

    /**
     * @param {number} tabId
     * @returns {?ProxyResponse} 429 — лимит исчерпан; null — запрос записан и идёт в сеть.
     */
    _takeFeedbackSlot(tabId) {
        const now = this._now();
        const since = now - FEEDBACK_WINDOW_MS;
        for (const [id, times] of this._feedback) {
            const fresh = times.filter((t) => t > since);
            if (fresh.length === 0) {
                this._feedback.delete(id);
            } else {
                this._feedback.set(id, fresh);
            }
        }
        const times = this._feedback.get(tabId) ?? [];
        if (times.length >= FEEDBACK_LIMIT) { return makeResponse(429, 'Too Many Requests'); }
        times.push(now);
        this._feedback.set(tabId, times);
        return null;
    }
}
