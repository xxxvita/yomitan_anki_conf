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

import {translate} from '../i18n/ui-language.js';

/** @returns {string} Подсказка на выключенной кнопке Core-only функции (CheckWords). */
export function getCoreRequiredTitle() {
    return translate('route.coreRequired');
}

/** @returns {string} Сообщение панели примеров (сбор и повтор сохранённых клипов) без Core. */
export function getExamplesCoreUnavailableMessage() {
    return translate('route.examplesCoreUnavailable');
}

/** @returns {string} Сообщение панели примеров, когда нет ни ключа шлюза, ни Core. */
export function getExamplesUnavailableMessage() {
    return translate('route.examplesUnavailable');
}

/**
 * Откуда брать видеопримеры. Единственная точка решения.
 *
 * Годный личный ключ важнее Core (владелец: «напрямую через ключ»): с ключом
 * примеры идут со шлюза Flib, даже если anki_conf запущен. Без ключа — Core,
 * если он есть; иначе примеров нет.
 * @param {?import('anki-route').AnkiRoute} route null — маршрут узнать не удалось.
 * @param {?{hasKey: boolean}} [gatewayStatus] null — статус шлюза узнать не удалось.
 * @returns {'gateway'|'core'|'unavailable'}
 */
export function decideExamplesSource(route, gatewayStatus = null) {
    if (gatewayStatus !== null && gatewayStatus.hasKey === true) { return 'gateway'; }
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
