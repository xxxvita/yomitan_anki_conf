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

// Строковая семантика Go, которую переносимое преобразование обязано повторить.
//
// ⚠️ JS `\s` и Go `unicode.IsSpace` РАСХОДЯТСЯ на двух символах: U+0085 для Go
// пробел, для JS нет; U+FEFF наоборот. clean() из anki_conf кладёт результат в
// журнал (`enrich_log.source`), и выкладка сверяет его с текстом статьи — любое
// расхождение здесь роняет сборку или молча меняет набор статей.
//
// Коды перечислены числами, а не литералами: невидимый символ в исходнике не
// видно на ревью.

/** Множество `unicode.IsSpace` из Go (свойство Unicode White_Space). */
const GO_SPACE_CODES = [
    0x09,
    0x0a,
    0x0b,
    0x0c,
    0x0d,
    0x20,
    0x85,
    0xa0,
    0x1680,
    0x2000,
    0x2001,
    0x2002,
    0x2003,
    0x2004,
    0x2005,
    0x2006,
    0x2007,
    0x2008,
    0x2009,
    0x200a,
    0x2028,
    0x2029,
    0x202f,
    0x205f,
    0x3000,
];

const GO_SPACE_SET = new Set(GO_SPACE_CODES);

/** Замены strings.NewReplacer из clean(): порядок вариантов = приоритет Go. */
const CLEAN_REPLACER = /\r\n\* |\n\* |\r\* |\r\n|\n|\r|\t/g;

const REPLACEMENT_CHARACTER = String.fromCodePoint(0xfffd);

/**
 * @param {number} code
 * @returns {boolean}
 */
function isGoSpace(code) {
    return GO_SPACE_SET.has(code);
}

/**
 * strings.Fields(s) + strings.Join(…, " ").
 * Все пробельные символы Go лежат в BMP, поэтому достаточно кодовых единиц UTF-16.
 * @param {string} s
 * @returns {string}
 */
function goFieldsJoin(s) {
    /** @type {string[]} */
    const words = [];
    let start = -1;
    for (let i = 0; i < s.length; ++i) {
        if (isGoSpace(s.charCodeAt(i))) {
            if (start >= 0) {
                words.push(s.slice(start, i));
                start = -1;
            }
        } else if (start < 0) {
            start = i;
        }
    }
    if (start >= 0) {
        words.push(s.slice(start));
    }
    return words.join(' ');
}

/**
 * Порт strings.TrimSpace.
 * @param {string} s
 * @returns {string}
 */
export function goTrimSpace(s) {
    let start = 0;
    let end = s.length;
    while (start < end && isGoSpace(s.charCodeAt(start))) { ++start; }
    while (end > start && isGoSpace(s.charCodeAt(end - 1))) { --end; }
    return s.slice(start, end);
}

/**
 * Порт clean() из anki_conf `cmd/lexicon-dict-enrich/glossary.go`:
 * буллет `\n* ` → ` — `, переносы и табы → пробел, затем Fields+Join и TrimSpace.
 * @param {string} s
 * @returns {string}
 */
export function goClean(s) {
    const replaced = s.replace(CLEAN_REPLACER, (match) => (match.endsWith('* ') ? ' — ' : ' '));
    return goTrimSpace(goFieldsJoin(replaced));
}

/**
 * Одиночные суррогаты → U+FFFD: так encoding/json декодирует `"\ud800"`.
 * JSON.parse оставил бы их как есть, и текст узла разошёлся бы с журналом.
 * @param {string} s
 * @returns {string}
 */
export function goWellFormed(s) {
    /** @type {string[]|null} */
    let parts = null;
    let last = 0;
    for (let i = 0; i < s.length; ++i) {
        const c = s.charCodeAt(i);
        if (c < 0xd800 || c > 0xdfff) { continue; }
        if (c <= 0xdbff && i + 1 < s.length) {
            const next = s.charCodeAt(i + 1);
            if (next >= 0xdc00 && next <= 0xdfff) {
                ++i;
                continue;
            }
        }
        if (parts === null) { parts = []; }
        parts.push(s.slice(last, i), REPLACEMENT_CHARACTER);
        last = i + 1;
    }
    if (parts === null) { return s; }
    parts.push(s.slice(last));
    return parts.join('');
}

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
