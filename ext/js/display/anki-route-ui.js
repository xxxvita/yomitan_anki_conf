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

/** Подсказка на выключенной кнопке Core-only функции (CheckWords). */
export const CORE_REQUIRED_TITLE = 'Нужен запущенный anki_conf';

/** Сообщение панели примеров (сбор и повтор сохранённых клипов) без Core. */
export const EXAMPLES_CORE_UNAVAILABLE_MESSAGE = 'Сбор примеров через anki_conf недоступен: anki_conf не запущен';

/**
 * Откуда брать видеопримеры. Единственная точка решения: P3 добавит сюда
 * 'gateway' (шлюз Flib) для случая, когда Core не запущен.
 * @param {?import('anki-route').AnkiRoute} route null — маршрут узнать не удалось.
 * @returns {'core'|'unavailable'}
 */
export function decideExamplesSource(route) {
    return route !== null && route.coreBase !== null ? 'core' : 'unavailable';
}

/**
 * Доступны ли Core-only функции (CheckWords, known-words, клипы).
 * @param {?import('anki-route').AnkiRoute} route
 * @returns {boolean}
 */
export function isCoreAvailable(route) {
    return route !== null && route.coreBase !== null;
}

/**
 * Строка статуса для раздела Anki в настройках; null — показывать прежний
 * статус/ошибку как есть.
 * @param {?import('anki-route').AnkiRoute} route
 * @returns {?string}
 */
export function describeAnkiRoute(route) {
    if (route === null) { return null; }
    switch (route.mode) {
        case 'core': return 'Подключено через anki_conf (Core)';
        case 'direct': return 'Подключено напрямую к AnkiConnect (anki_conf не запущен)';
        default: return null;
    }
}
