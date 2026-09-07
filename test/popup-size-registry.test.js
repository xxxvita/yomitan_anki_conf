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
import {computeAppliedSize, PopupSizeRegistry} from '../ext/js/app/popup-size-registry.js';

describe('PopupSizeRegistry', () => {
    test('пустой реестр не требует размера', () => {
        expect(new PopupSizeRegistry().target()).toBe(null);
    });
    test('один владелец — его требование и есть цель', () => {
        const r = new PopupSizeRegistry();
        r.request('video-examples', 820, 900);
        expect(r.target()).toEqual({minWidth: 820, minHeight: 900});
    });
    test('два владельца — максимум по каждой оси независимо', () => {
        const r = new PopupSizeRegistry();
        r.request('video-examples', 820, 900);
        r.request('translation-column', 1000, 0);
        expect(r.target()).toEqual({minWidth: 1000, minHeight: 900});
    });
    test('снятие одного владельца не обнуляет требование другого', () => {
        const r = new PopupSizeRegistry();
        r.request('video-examples', 820, 900);
        r.request('translation-column', 1000, 0);
        r.release('video-examples');
        expect(r.target()).toEqual({minWidth: 1000, minHeight: 0});
    });
    test('повторный request того же владельца заменяет требование', () => {
        const r = new PopupSizeRegistry();
        r.request('translation-column', 800, 0);
        r.request('translation-column', 1000, 0);
        expect(r.size).toBe(1);
        expect(r.target()).toEqual({minWidth: 1000, minHeight: 0});
    });
    test('после снятия последнего владельца цели нет', () => {
        const r = new PopupSizeRegistry();
        r.request('translation-column', 1000, 0);
        r.release('translation-column');
        expect(r.target()).toBe(null);
    });
    test('снятие незарегистрированного владельца безвредно', () => {
        const r = new PopupSizeRegistry();
        r.release('нет такого');
        expect(r.target()).toBe(null);
    });
});

describe('computeAppliedSize', () => {
    const base = {width: 400, height: 250};
    const caps = {width: 1536, height: 900};

    test('нет владельцев — возвращаемся к базе', () => {
        expect(computeAppliedSize({base, target: null, caps})).toEqual({
            width: 400,
            height: 250,
        });
    });
    test('один владелец — его требование', () => {
        expect(
            computeAppliedSize({
                base,
                target: {minWidth: 800, minHeight: 0},
                caps,
            }),
        ).toEqual({width: 800, height: 250});
    });
    test('СЖИМАЕТСЯ при снятии одного из двух владельцев', () => {
        // Было 1000 (Ru) + 820 (Ex); Ru снят -> цель 820, попап обязан сжаться.
        expect(
            computeAppliedSize({
                base,
                target: {minWidth: 820, minHeight: 900},
                caps,
            }),
        ).toEqual({width: 820, height: 900});
    });
    test('потолок экрана не превышается', () => {
        expect(
            computeAppliedSize({
                base,
                target: {minWidth: 5000, minHeight: 5000},
                caps,
            }),
        ).toEqual({width: 1536, height: 900});
    });
    test('требование меньше базы базу не уменьшает', () => {
        expect(
            computeAppliedSize({
                base,
                target: {minWidth: 100, minHeight: 0},
                caps,
            }),
        ).toEqual({width: 400, height: 250});
    });
});
