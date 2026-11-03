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
import {describeNoteState, formatExistingStatus, isCardFormatConfigured, normalizeNewTag, pluralRu} from '../ext/js/display/anki-card-ui.js';

describe('describeNoteState', () => {
    const base = {ankiError: null, canAdd: true, noteCount: 0, duplicateBehavior: /** @type {import('settings').AnkiDuplicateBehavior} */ ('new'), saving: false};
    test('можно добавить — add', () => {
        expect(describeNoteState(base)).toEqual({kind: 'add', addAgain: false, replace: false});
    });
    test('Anki не подключена — off, даже если есть заметки', () => {
        expect(describeNoteState({...base, ankiError: new Error('Anki not connected'), noteCount: 2}).kind).toBe('off');
    });
    test('другая ошибка Anki — hidden (как раньше: кнопка скрыта, ошибка в логе)', () => {
        expect(describeNoteState({...base, ankiError: new Error('Model not found')}).kind).toBe('hidden');
    });
    test('идёт сохранение — saving важнее всего, кроме off', () => {
        expect(describeNoteState({...base, saving: true, noteCount: 3}).kind).toBe('saving');
    });
    test('заметки есть, режим new — open с «добавить повторно» и «заменить»', () => {
        expect(describeNoteState({...base, noteCount: 2})).toEqual({kind: 'open', addAgain: true, replace: true});
    });
    test('заметки есть, режим prevent — повторно нельзя, заменить можно', () => {
        expect(describeNoteState({...base, noteCount: 1, duplicateBehavior: 'prevent'})).toEqual({kind: 'open', addAgain: false, replace: true});
    });
    test('заметок нет, добавить нельзя (не хватает полей) — disabled', () => {
        expect(describeNoteState({...base, canAdd: false}).kind).toBe('disabled');
    });
});

describe('normalizeNewTag', () => {
    test('пробелы внутри — подчёркивание, по краям — срез', () => {
        expect(normalizeNewTag('  my  news ')).toBe('my_news');
    });
    test('пусто или одни пробелы — null', () => {
        expect(normalizeNewTag('')).toBeNull();
        expect(normalizeNewTag('   ')).toBeNull();
    });
});

describe('isCardFormatConfigured', () => {
    test('без колоды или типа записи — не настроен', () => {
        expect(isCardFormatConfigured({deck: '', model: 'M'})).toBe(false);
        expect(isCardFormatConfigured({deck: 'D', model: ''})).toBe(false);
        expect(isCardFormatConfigured({deck: 'D', model: 'M'})).toBe(true);
    });
});

describe('pluralRu / formatExistingStatus', () => {
    test('1 карточка, 2 карточки, 5 карточек, 11 карточек, 21 карточка', () => {
        expect([1, 2, 5, 11, 21].map((n) => pluralRu(n, 'карточка', 'карточки', 'карточек'))).toEqual(['карточка', 'карточки', 'карточек', 'карточек', 'карточка']);
    });
    test('строка «уже в Anki»', () => {
        expect(formatExistingStatus(2)).toBe('Уже в Anki · 2 карточки с этим словом');
    });
});
