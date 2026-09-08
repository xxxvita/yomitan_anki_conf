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
    stripUrlFragment,
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
    test('двойной пробел внутри схлопывается в один', () => {
        expect(normalizeLemmas(['figure  out'])).toEqual(['figure out']);
    });
    test('неразрывный пробел внутри становится обычным', () => {
        expect(normalizeLemmas(['figure\u00a0out'])).toEqual(['figure out']);
    });
    test('узкий неразрывный и идеографический пробелы тоже нормализуются', () => {
        expect(normalizeLemmas(['figure\u202fout', 'give\u3000up'])).toEqual([
            'figure out',
            'give up',
        ]);
    });
    test('перевод строки и табуляция внутри не оставляют второй леммы', () => {
        expect(normalizeLemmas(['figure\n\tout'])).toEqual(['figure out']);
    });
    test('грязный и чистый вид одной леммы схлопываются в одну запись', () => {
        // ⚠️ Именно этот дубль и делает ключ дедупа бесполезным: без
        // нормализации внутренних пробелов «figure  out» и «figure out»
        // дают два разных ключа для одного и того же слова.
        expect(normalizeLemmas(['Figure  Out', 'figure out'])).toEqual([
            'figure out',
        ]);
    });
});

describe('stripUrlFragment', () => {
    test('фрагмент читалки убран', () => {
        expect(stripUrlFragment('https://flib.club/read/1#p=7')).toBe('https://flib.club/read/1');
    });
    test('две страницы одной книги дают ОДИН ключ дедупа', () => {
        // ⚠️ Ради этого фрагмент и снимается: иначе каждый переворот страницы
        // заводил бы новый ключ и защита от потока повторов не работала бы.
        expect(
            dedupKey(stripUrlFragment('https://flib.club/read/1#p=7'), 'translation_opened', 'give up'),
        ).toBe(
            dedupKey(stripUrlFragment('https://flib.club/read/1#p=8'), 'translation_opened', 'give up'),
        );
    });
    test('разные страницы по-прежнему разные ключи — второе свидетельство не глушится', () => {
        expect(
            dedupKey(stripUrlFragment('https://flib.club/read/1#p=7'), 'translation_opened', 'give up'),
        ).not.toBe(
            dedupKey(stripUrlFragment('https://flib.club/read/2#p=7'), 'translation_opened', 'give up'),
        );
    });
    test('запрос сохраняется, режется только фрагмент', () => {
        expect(stripUrlFragment('https://flib.club/read?b=1#p=7')).toBe('https://flib.club/read?b=1');
    });
    test('пустой фрагмент тоже снимается', () => {
        expect(stripUrlFragment('https://flib.club/read/1#')).toBe('https://flib.club/read/1');
    });
    test('адрес без фрагмента не меняется', () => {
        expect(stripUrlFragment('https://flib.club/read/1')).toBe('https://flib.club/read/1');
    });
    test('негодная строка не бросает — конверт не становится новым путём отказа', () => {
        expect(() => stripUrlFragment('не url#x')).not.toThrow();
        expect(stripUrlFragment('не url#x')).toBe('не url');
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
    test('в конверт кладётся адрес БЕЗ фрагмента', () => {
        const event = buildEvent({...base, url: 'https://flib.club/read/1#p=7', lemmas: ['x']});
        expect(event?.url).toBe('https://flib.club/read/1');
    });
    test('соседние страницы читалки дают один и тот же ключ дедупа', () => {
        // ⚠️ Ключ строится из event.url, поэтому проверяется именно то, что
        // положил конверт, а не то, что пришло от вызывающего.
        const a = buildEvent({...base, url: 'https://flib.club/read/1#p=7', lemmas: ['Give  Up']});
        const b = buildEvent({...base, url: 'https://flib.club/read/1#p=8', lemmas: ['give up']});
        expect(a).not.toBe(null);
        expect(b).not.toBe(null);
        expect(
            dedupKey(/** @type {import('flib-events').FlibEvent} */ (a).url, 'translation_opened', /** @type {import('flib-events').FlibEvent} */ (a).lemmas[0]),
        ).toBe(
            dedupKey(/** @type {import('flib-events').FlibEvent} */ (b).url, 'translation_opened', /** @type {import('flib-events').FlibEvent} */ (b).lemmas[0]),
        );
    });
    test('адрес из одного фрагмента события не даёт — хоста в нём нет', () => {
        expect(buildEvent({...base, url: '#p=7', lemmas: ['x']})).toBe(null);
    });
});
