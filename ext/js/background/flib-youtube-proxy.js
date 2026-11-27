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
 * проверки и уходят на FLIB_SITE_URL. Состояния нет: каждый вызов независим.
 *
 * Порядок проверок (всё до сети):
 * 1. отправитель — вкладка с origin ровно https://www.youtube.com, иначе 403;
 * 2. путь: начинается с /api/, без "..", "//", "\", "@", "#", ":" в пути, управляющих символов
 *    и пробелов; иначе 403;
 * 3. /api/video/* -> 404 (запасной путь сайта недоступен, п. 3.14 спеки);
 *    /api/telemetry/events -> 204 (аналитика после беты 1);
 * 4. точный pathname из белого списка и метод GET/POST/DELETE, иначе 403;
 * 5. тело — только строка или null, иначе 400 (слой сам превращает Blob в текст).
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
 * @returns {Promise<ProxyResponse>}
 */
export async function handleFlibYoutubeProxy(msg, sender, fetchImpl) {
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
