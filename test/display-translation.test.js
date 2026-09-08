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
import {chooseLayout, MIN_COLUMN_WIDTH} from '../ext/js/display/display-translation.js';

describe('chooseLayout', () => {
    test('достигнутой ширины хватает на две колонки', () => {
        expect(chooseLayout({achievedWidth: 800, valid: true, minColumnWidth: MIN_COLUMN_WIDTH})).toBe('columns');
    });
    test('ровно на границе — ещё колонки', () => {
        expect(chooseLayout({achievedWidth: 480, valid: true, minColumnWidth: 240})).toBe('columns');
    });
    test('колонка уже порога — стопка', () => {
        expect(chooseLayout({achievedWidth: 470, valid: true, minColumnWidth: 240})).toBe('stack');
    });
    test('фронтенд размер менять не умеет (popup-window) — стопка', () => {
        expect(chooseLayout({achievedWidth: 0, valid: false, minColumnWidth: 240})).toBe('stack');
    });
});
