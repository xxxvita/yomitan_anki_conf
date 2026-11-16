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

// Строковая семантика Go, которую сборщик пары обязан повторить: порядок
// русских строк тот же, что у выкладки anki_conf (Go сравнивает строки
// побайтно в UTF-8).

/**
 * Сравнение строк в порядке Go (побайтно UTF-8 = по кодовым точкам).
 * JS `<` сравнивает кодовые единицы UTF-16 и ставит астральные символы
 * раньше U+E000–U+FFFF.
 * @param {string} a
 * @param {string} b
 * @returns {number}
 */
export function compareUtf8(a, b) {
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; ++i) {
        const x = a.charCodeAt(i);
        const y = b.charCodeAt(i);
        if (x === y) { continue; }
        const xSurrogate = x >= 0xd800 && x <= 0xdfff;
        const ySurrogate = y >= 0xd800 && y <= 0xdfff;
        if (xSurrogate === ySurrogate) { return x - y; }
        return xSurrogate ? 1 : -1;
    }
    return a.length - b.length;
}
