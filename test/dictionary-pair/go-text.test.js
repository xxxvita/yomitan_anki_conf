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
import {compareUtf8} from '../../dev/dictionary-pair/go-text.js';

/**
 * @param {number} code
 * @returns {string}
 */
const u = (code) => String.fromCodePoint(code);

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
