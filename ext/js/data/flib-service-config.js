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

import {FLIB_GATEWAY_DEFAULT_BASE} from './flib-host.js';

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
 * Действующий базовый адрес шлюза по значению `flibService.gatewayUrl`.
 *
 * Пусто → {@link FLIB_GATEWAY_DEFAULT_BASE}. `wss://`/`ws://` принимаются и
 * переводятся в `https://`/`http://`: в старых настройках адрес хранился как
 * адрес WebSocket-канала. Хвостовые слэши срезаются, чтобы `base + '/v1/…'`
 * не давал `//v1`.
 *
 * ⚠️ Нераспознанная строка или чужая схема → адрес по умолчанию, а не «как есть»:
 * на этот адрес уходит личный ключ в Authorization, и `javascript:`/`ftp:` или
 * опечатка без схемы не должны превращаться в относительный запрос.
 * @param {string} raw
 * @returns {string}
 */
export function resolveFlibGatewayBase(raw) {
    if (typeof raw !== 'string') { return FLIB_GATEWAY_DEFAULT_BASE; }
    let value = raw.trim();
    if (value === '') { return FLIB_GATEWAY_DEFAULT_BASE; }
    value = value.replace(/^wss:\/\//i, 'https://').replace(/^ws:\/\//i, 'http://');
    /** @type {URL} */
    let url;
    try {
        url = new URL(value);
    } catch (e) {
        return FLIB_GATEWAY_DEFAULT_BASE;
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') { return FLIB_GATEWAY_DEFAULT_BASE; }
    return `${url.origin}${url.pathname}`.replace(/\/+$/, '');
}

/**
 * Проверка ввода `flibService.gatewayUrl` в настройках: пусто (= адрес по
 * умолчанию) или разбираемый адрес со схемой http/https/ws/wss и хостом.
 * Сохраняется срезанная строка как есть; перевод ws(s)→http(s) делает
 * {@link resolveFlibGatewayBase} при чтении.
 * @param {string} raw
 * @returns {{valid: boolean, value: string}}
 */
export function normalizeFlibGatewayUrl(raw) {
    if (typeof raw !== 'string') { return {valid: false, value: ''}; }
    const value = raw.trim();
    if (value === '') { return {valid: true, value}; }
    try {
        const url = new URL(value);
        const valid = ['http:', 'https:', 'ws:', 'wss:'].includes(url.protocol) && url.hostname !== '';
        return {valid, value};
    } catch (e) {
        return {valid: false, value};
    }
}

export {FLIB_GATEWAY_DEFAULT_BASE} from './flib-host.js';
