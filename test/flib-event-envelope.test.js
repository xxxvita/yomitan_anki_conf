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
    buildEvent,
    dedupKey,
    normalizeLemmas,
} from '../ext/js/data/flib-event-envelope.js';

describe('normalizeLemmas', () => {
    test('обрезает и опускает регистр', () => {
        expect(normalizeLemmas(['  Figure Out ', 'GIVE UP'])).toEqual([
            'figure out',
            'give up',
        ]);
    });
    test('выбрасывает пустые и не-строки', () => {
        expect(normalizeLemmas(['a', '', '   ', null, 7, 'b'])).toEqual(['a', 'b']);
    });
    test('схлопывает дубли после нормализации', () => {
        expect(normalizeLemmas(['Give Up', 'give up'])).toEqual(['give up']);
    });
    test('не-массив даёт пустой список', () => {
        expect(normalizeLemmas(null)).toEqual([]);
    });
});

describe('dedupKey', () => {
    test('включает url, род и лемму', () => {
        expect(
            dedupKey('https://flib.club/1', 'translation_opened', 'give up'),
        ).toBe('https://flib.club/1\0translation_opened\0give up');
    });
    test('разные страницы дают разные ключи — второе свидетельство глушить нельзя', () => {
        expect(
            dedupKey('https://flib.club/1', 'translation_opened', 'give up'),
        ).not.toBe(
            dedupKey('https://flib.club/2', 'translation_opened', 'give up'),
        );
    });
    test('разные рода на одной странице не глушат друг друга', () => {
        expect(
            dedupKey('https://flib.club/1', 'translation_opened', 'give up'),
        ).not.toBe(
            dedupKey('https://flib.club/1', 'word_added_to_dict', 'give up'),
        );
    });
    test('разделитель NUL не подделывается содержимым полей', () => {
        expect(
            dedupKey('https://a.com/x|translation_opened|b', 'translation_opened', 'c'),
        ).not.toBe(
            dedupKey('https://a.com/x', 'translation_opened', 'b|translation_opened|c'),
        );
    });
});

describe('buildEvent', () => {
    /** @type {{type: import('flib-events').FlibEventType, url: string, ts: number, eventId: string}} */
    const base = {
        type: 'translation_opened',
        url: 'https://Flib.Club/book/1',
        ts: 1000,
        eventId: 'id-1',
    };
    test('собирает конверт с нормализованными леммами и хостом', () => {
        expect(buildEvent({...base, lemmas: [' Give Up ']})).toEqual({
            event_id: 'id-1',
            type: 'translation_opened',
            lemmas: ['give up'],
            host: 'flib.club',
            url: 'https://Flib.Club/book/1',
            ts: 1000,
            schema_version: 1,
        });
    });
    test('пустой список лемм события не даёт', () => {
        expect(buildEvent({...base, lemmas: ['  ']})).toBe(null);
    });
    test('негодный url события не даёт', () => {
        expect(buildEvent({...base, url: 'не url', lemmas: ['x']})).toBe(null);
    });
});
