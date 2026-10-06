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

import {FLIB_GATEWAY_DEFAULT_BASE, isFlibHost} from './flib-host.js';

/**
 * Формат личного ключа. Совпадает с шлюзом БАЙТ-В-БАЙТ
 * (turmalin_getaway internal/auth/keys.go:15): только строчные hex.
 */
const FLIB_PERSONAL_KEY_PATTERN = /^tpk_[0-9a-f]{32}$/;

/**
 * Приводит введённый личный ключ к виду, в котором он хранится и уходит в шлюз.
 *
 * ⚠️ Пробелы срезаются ДО проверки: ключ копируют из письма/личного кабинета, и
 * хвостовой перевод строки — обычное дело. Заглавные hex НЕ приводятся к
 * строчным: шлюз сверяет ключ как есть, и молчаливое исправление спрятало бы
 * от человека, что он вставил что-то не то.
 * @param {string} raw
 * @returns {{valid: boolean, value: string}} `value` — срезанная строка; пустая
 *   строка допустима и означает «ключа нет».
 */
export function normalizeFlibPersonalKey(raw) {
    if (typeof raw !== 'string') { return {valid: false, value: ''}; }
    const value = raw.trim();
    return {valid: value === '' || FLIB_PERSONAL_KEY_PATTERN.test(value), value};
}

/**
 * Хосты, для которых допустимы открытые `http://`/`ws://` (H3): ключ по ним
 * не покидает машину. Единственный список — его же читает клиент шлюза.
 */
const LOCAL_GATEWAY_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * @param {string} hostname `URL.hostname` (IPv6 — в квадратных скобках).
 * @returns {boolean}
 */
export function isLocalGatewayHost(hostname) {
    return LOCAL_GATEWAY_HOSTS.has(hostname);
}

/**
 * Разбирает адрес шлюза в http(s)-URL, или null, если адрес не годится.
 *
 * `wss://`/`ws://` переводятся в `https://`/`http://`: в старых настройках адрес
 * хранился как адрес WebSocket-канала.
 *
 * ⚠️ H3: открытый http (и ws) — только для localhost/127.0.0.1/[::1]. На любой
 * другой хост личный ключ уходит в Authorization, и по открытому каналу его
 * прочтёт кто угодно по пути.
 * @param {string} value Уже срезанная непустая строка.
 * @returns {?URL}
 */
function parseGatewayUrl(value) {
    const converted = value.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
    /** @type {URL} */
    let url;
    try {
        url = new URL(converted);
    } catch (e) {
        return null;
    }
    if (url.hostname === '') { return null; }
    if (url.protocol === 'https:') { return url; }
    if (url.protocol === 'http:' && LOCAL_GATEWAY_HOSTS.has(url.hostname)) { return url; }
    return null;
}

/**
 * Действующий базовый адрес шлюза по значению `flibService.gatewayUrl`.
 *
 * Пусто → {@link FLIB_GATEWAY_DEFAULT_BASE}. Хвостовые слэши срезаются, чтобы
 * `base + '/v1/…'` не давал `//v1`.
 *
 * ⚠️ Негодный адрес (см. parseGatewayUrl) → адрес по умолчанию, а не «как есть»:
 * на этот адрес уходит личный ключ, и `javascript:`/`ftp:`, опечатка без схемы
 * или открытый http на чужой хост не должны получить его.
 * @param {string} raw
 * @returns {string}
 */
export function resolveFlibGatewayBase(raw) {
    if (typeof raw !== 'string') { return FLIB_GATEWAY_DEFAULT_BASE; }
    const value = raw.trim();
    if (value === '') { return FLIB_GATEWAY_DEFAULT_BASE; }
    const url = parseGatewayUrl(value);
    if (url === null) { return FLIB_GATEWAY_DEFAULT_BASE; }
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/**
 * Проверка `flibService.gatewayUrl` (ввод в настройках, импорт): пусто (= адрес
 * по умолчанию) или адрес, который принимает parseGatewayUrl. Сохраняется
 * срезанная строка как есть; перевод ws(s)→http(s) делает
 * {@link resolveFlibGatewayBase} при чтении.
 * @param {string} raw
 * @returns {{valid: boolean, value: string}}
 */
export function normalizeFlibGatewayUrl(raw) {
    if (typeof raw !== 'string') { return {valid: false, value: ''}; }
    const value = raw.trim();
    if (value === '') { return {valid: true, value}; }
    return {valid: parseGatewayUrl(value) !== null, value};
}

/**
 * Адрес ведёт на сервер Flib (`flib.club` и поддомены) или на эту машину.
 * Пусто — тоже да (это адрес по умолчанию). Чужой хост не запрещён в
 * настройках, но о нём предупреждают, и импорт без согласия его не принимает.
 * @param {string} raw
 * @returns {boolean}
 */
export function isTrustedFlibGatewayUrl(raw) {
    const {valid, value} = normalizeFlibGatewayUrl(raw);
    if (!valid) { return false; }
    if (value === '') { return true; }
    const url = /** @type {URL} */ (parseGatewayUrl(value));
    return LOCAL_GATEWAY_HOSTS.has(url.hostname) || isFlibHost(url.href);
}

export {FLIB_GATEWAY_DEFAULT_BASE} from './flib-host.js';
