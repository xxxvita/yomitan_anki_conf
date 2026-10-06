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
 * Контент-скрипт объявлен с all_frames, поэтому Chromium запускает его и во
 * фреймах с http(s)-адресом ВНУТРИ наших страниц — например, в плеере
 * youtube-nocookie в модалке примеров (popup.html на сайте или search.html).
 * Frontend такого фрейма на старте шлёт requestBackendReadySignal и
 * frontendReady на всю вкладку, а верхний Frontend в ответ повторяет
 * последний поиск: popup перерисовывается, панель примеров и модалка
 * пропадают через ~1 с. Внутри наших страниц сканировать нечего.
 *
 * Firefox ancestorOrigins не знает — там фрейм плеера отсекает
 * exclude_matches в firefox-вариантах манифеста
 * (dev/data/manifest-variants.json). В Chromium исключения нет: сторонние
 * nocookie-встраивания на сайтах остаются сканируемыми.
 * @param {?{length: number, [index: number]: string}|undefined} ancestorOrigins `location.ancestorOrigins` (DOMStringList).
 * @param {string} extensionBaseUrl runtime.getURL('/').
 * @returns {boolean} true — фрейм вложен в страницу ЭТОГО расширения; не запускаться.
 */
export function isFrameInsideExtensionPage(ancestorOrigins, extensionBaseUrl) {
    if (typeof ancestorOrigins !== 'object' || ancestorOrigins === null) { return false; }
    let origin;
    try {
        origin = new URL(extensionBaseUrl).origin;
    } catch (e) {
        return false;
    }
    // У chrome-extension:/moz-extension: URL.origin — «null» в части движков.
    if (origin === 'null' || origin.length === 0) {
        origin = extensionBaseUrl.replace(/\/+$/, '');
    }
    for (let i = 0; i < ancestorOrigins.length; ++i) {
        if (ancestorOrigins[i] === origin) { return true; }
    }
    return false;
}
