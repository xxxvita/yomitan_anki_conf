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

import {afterEach, describe, expect, test} from 'vitest';
import {messagesEn} from '../ext/js/i18n/messages-en.js';
import {messagesRu} from '../ext/js/i18n/messages-ru.js';
import {getUiLanguage, resolveUiLanguage, setUiLanguage, translate, translatePlural} from '../ext/js/i18n/ui-language.js';

afterEach(() => { setUiLanguage('ru'); });

describe('resolveUiLanguage', () => {
    test.each([
        ['auto', 'ru', 'ru'],
        ['auto', 'ru-RU', 'ru'],
        ['auto', 'RU', 'ru'],
        ['auto', 'en-US', 'en'],
        ['auto', 'uz', 'en'],
        ['auto', 'rus', 'en'],
        ['auto', '', 'en'],
        ['ru', 'en-US', 'ru'],
        ['en', 'ru-RU', 'en'],
        ['de', 'ru-RU', 'ru'],
        [void 0, 'en-US', 'en'],
    ])('%s при языке браузера %s: %s', (setting, browser, expected) => {
        expect(resolveUiLanguage(/** @type {string} */ (setting), browser)).toBe(expected);
    });
});

describe('translate', () => {
    test('берёт строку текущего языка', () => {
        expect(translate('more.collapse')).toBe('Свернуть');
        setUiLanguage('en');
        expect(getUiLanguage()).toBe('en');
        expect(translate('more.collapse')).toBe('Collapse');
    });

    test('неизвестный ключ возвращается как есть', () => {
        expect(translate('no.such.key')).toBe('no.such.key');
    });

    test('подставляет значения один раз и оставляет неизвестные метки', () => {
        expect(translate('test.params', {a: '{b}', b: 'X'}, {}, {'test.params': '{a} {b} {c}'})).toBe('{b} X {c}');
    });

    test('без строки в английском берётся русская', () => {
        setUiLanguage('en');
        expect(translate('only.ru', {}, {}, {'only.ru': 'Только русская'})).toBe('Только русская');
    });
});

describe('translatePlural', () => {
    test.each([[1, 'Ещё 1 статья'], [2, 'Ещё 2 статьи'], [5, 'Ещё 5 статей'], [11, 'Ещё 11 статей'], [21, 'Ещё 21 статья']])('русский: %i', (n, expected) => {
        expect(translatePlural('more.count', n)).toBe(expected);
    });

    test.each([[1, '1 more entry'], [2, '2 more entries'], [21, '21 more entries']])('английский: %i', (n, expected) => {
        setUiLanguage('en');
        expect(translatePlural('more.count', n)).toBe(expected);
    });

    test('строка без форм множественного числа не ломает вызов', () => {
        expect(translatePlural('more.collapse', 2)).toBe('Свернуть');
    });
});

describe('файлы переводов', () => {
    const shape = (/** @type {import('ui-language').Message} */ value) => (typeof value === 'string' ? 'text' : 'plural');
    const marks = (/** @type {string} */ text) => [...text.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();

    test('одинаковые ключи', () => {
        expect(Object.keys(messagesEn).sort()).toStrictEqual(Object.keys(messagesRu).sort());
    });

    test.each(Object.keys(messagesRu))('%s: тот же вид и те же метки', (key) => {
        const ru = messagesRu[key];
        const en = messagesEn[key];
        expect(shape(en)).toBe(shape(ru));
        const textsRu = typeof ru === 'string' ? [ru] : Object.values(ru);
        const textsEn = typeof en === 'string' ? [en] : Object.values(en);
        for (const text of [...textsRu, ...textsEn]) { expect(marks(text)).toStrictEqual(marks(textsRu[0])); }
    });

    test('формы: русский one/few/many, английский one/other', () => {
        for (const value of Object.values(messagesRu)) {
            if (typeof value !== 'string') { expect(Object.keys(value).sort()).toStrictEqual(['few', 'many', 'one']); }
        }
        for (const value of Object.values(messagesEn)) {
            if (typeof value !== 'string') { expect(Object.keys(value).sort()).toStrictEqual(['one', 'other']); }
        }
    });
});
