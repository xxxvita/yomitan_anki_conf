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
 * Строка статуса раздела Anki в настройках по маршруту из backend.
 * null — оставить прежний статус («Connected» / «Not enabled» / ошибку).
 * Живёт здесь, а не в ext/js/display/anki-route-ui.js: настройкам нужен ещё
 * и адрес из настроек, чтобы отличить «пользователь выбрал AnkiConnect» от
 * «anki_conf не запущен, сработал запасной путь».
 * @param {?import('anki-route').AnkiRoute} route
 * @param {string} configuredServer Значение `anki.server`.
 * @returns {?string}
 */
export function describeAnkiRouteStatus(route, configuredServer) {
    if (route === null) { return null; }
    switch (route.mode) {
        case 'core':
            return 'Подключено через anki_conf (Core)';
        case 'direct':
            return normalizeServer(route.ankiServer) === normalizeServer(configuredServer) ?
                'Подключено напрямую к AnkiConnect (выбрано в настройках)' :
                'Подключено напрямую к AnkiConnect (anki_conf не запущен)';
        default:
            return null;
    }
}

/**
 * @param {string} url
 * @returns {string}
 */
function normalizeServer(url) {
    return url.trim().replace(/\/+$/, '');
}
