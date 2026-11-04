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
import {
    PHRASE_SPLIT_MAX,
    PHRASE_SPLIT_MIN,
    clampPhraseSplitRatio,
    clampPhraseTopHeight,
    getPhraseSplitStep,
    isPhraseSplitNarrow,
} from '../ext/js/display/phrase-split-util.js';

describe('clampPhraseSplitRatio', () => {
    test('в пределах — без изменений', () => { expect(clampPhraseSplitRatio(0.4)).toBe(0.4); });
    test('старое значение вне пределов обрезается', () => {
        expect(clampPhraseSplitRatio(0.05)).toBe(PHRASE_SPLIT_MIN);
        expect(clampPhraseSplitRatio(0.99)).toBe(PHRASE_SPLIT_MAX);
    });
    test('NaN и бесконечность — половина', () => {
        expect(clampPhraseSplitRatio(Number.NaN)).toBe(0.5);
        expect(clampPhraseSplitRatio(Number.POSITIVE_INFINITY)).toBe(0.5);
    });
});

describe('getPhraseSplitStep', () => {
    test('широкий режим: ←/→', () => {
        expect(getPhraseSplitStep('ArrowLeft', false)).toBe(-1);
        expect(getPhraseSplitStep('ArrowRight', false)).toBe(1);
        expect(getPhraseSplitStep('ArrowUp', false)).toBe(0);
    });
    test('узкий режим: ↑/↓', () => {
        expect(getPhraseSplitStep('ArrowUp', true)).toBe(-1);
        expect(getPhraseSplitStep('ArrowDown', true)).toBe(1);
        expect(getPhraseSplitStep('ArrowLeft', true)).toBe(0);
    });
    test('прочие клавиши — 0', () => { expect(getPhraseSplitStep('Enter', false)).toBe(0); });
});

describe('isPhraseSplitNarrow', () => {
    test('уже 26em — узкий', () => {
        expect(isPhraseSplitNarrow(363, 14)).toBe(true);
        expect(isPhraseSplitNarrow(364, 14)).toBe(false);
    });
    test('нулевая ширина (скрыто) — не узкий', () => { expect(isPhraseSplitNarrow(0, 14)).toBe(false); });
    test('битый размер шрифта — не узкий', () => {
        expect(isPhraseSplitNarrow(100, 0)).toBe(false);
        expect(isPhraseSplitNarrow(100, Number.NaN)).toBe(false);
    });
});

describe('clampPhraseTopHeight', () => {
    test('между 3.5em и 20em', () => {
        expect(clampPhraseTopHeight(10, 14)).toBe(49);
        expect(clampPhraseTopHeight(1000, 14)).toBe(280);
        expect(clampPhraseTopHeight(100, 14)).toBe(100);
    });
    test('NaN — нижняя граница', () => { expect(clampPhraseTopHeight(Number.NaN, 14)).toBe(49); });
});
