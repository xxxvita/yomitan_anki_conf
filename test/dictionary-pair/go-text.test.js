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

import {describe, expect, test} from 'vitest';
import {compareUtf8, goClean, goTrimSpace, goWellFormed} from '../../dev/dictionary-pair/go-text.js';

// Невидимые символы собираются по коду: литерал в исходнике не виден глазом и
// легко теряется при правке.
/**
 * @param {number} code
 * @returns {string}
 */
const u = (code) => String.fromCodePoint(code);
/**
 * @param {number} code
 * @returns {string}
 */
const u16 = (code) => String.fromCharCode(code);
const NEL = u(0x85);
const BOM = u(0xfeff);

// Ожидаемые значения получены прогоном исходного Go-кода clean() (go1.24.5), а не выведены.
describe('goClean — порт clean() из anki_conf с пробельной семантикой Go', () => {
    test('U+0085 — пробел для Go: разделяет слова (в JS \\s его нет)', () => {
        expect(goClean(`a${NEL}b`)).toBe('a b');
        expect(goClean(`${NEL}a${NEL}`)).toBe('a');
    });

    test('U+FEFF — НЕ пробел для Go: остаётся в тексте (в JS \\s он есть)', () => {
        const input = `${BOM}a${BOM} b${BOM}`;
        expect(goClean(input)).toBe(input);
    });

    test('буллет списка становится тире, переносы и табы — пробелом', () => {
        expect(goClean('x\r\n* y\n* z\r* w')).toBe('x — y — z — w');
        expect(goClean('a\r\nb\nc\rd\te')).toBe('a b c d e');
        expect(goClean('a\r\n\r\n* b')).toBe('a — b');
    });

    test('звёздочка реконструкции, приклеенная к слову, не тронута', () => {
        expect(goClean('*frijaz\n*y')).toBe('*frijaz *y');
    });

    test('прочие пробелы Unicode схлопываются, U+180E и U+200B — нет', () => {
        expect(goClean(`  ${u(0xa0)}lead${u(0x3000)}trail${u(0x2028)} `)).toBe('lead trail');
        const keep = `${u(0x180e)}a${u(0x200b)}b`;
        expect(goClean(keep)).toBe(keep);
    });
});

describe('goTrimSpace', () => {
    test('срезает U+0085, но не U+FEFF', () => {
        expect(goTrimSpace(`${NEL} Etymology tree`)).toBe('Etymology tree');
        expect(goTrimSpace(`${BOM}PIE word`)).toBe(`${BOM}PIE word`);
    });
});

describe('goWellFormed — одиночный суррогат становится U+FFFD, как в encoding/json', () => {
    test('пара сохраняется, одиночки заменяются', () => {
        const input = `a${u16(0xd800)}b${u16(0xdc00)}c${u(0x1f600)}`;
        expect(goWellFormed(input)).toBe(`a${u(0xfffd)}b${u(0xfffd)}c${u(0x1f600)}`);
    });
});

describe('compareUtf8 — порядок строк Go (побайтно UTF-8), а не UTF-16', () => {
    test('астральный символ идёт ПОСЛЕ U+FFFD, хотя в UTF-16 он раньше', () => {
        const astral = u(0x1f600);
        const replacement = u(0xfffd);
        expect(astral < replacement).toBe(true);
        expect(compareUtf8(astral, replacement)).toBeGreaterThan(0);
        expect(compareUtf8(replacement, astral)).toBeLessThan(0);
        expect(compareUtf8('abc', 'abc')).toBe(0);
        expect(compareUtf8('ab', 'abc')).toBeLessThan(0);
    });
});
