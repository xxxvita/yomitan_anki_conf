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
    buildOutboxRecord,
    FLIB_SUBS_SOURCE,
    FLIB_ROUTE_EVENT_ID_PREFIX,
    isFlibRouteEventType,
    outboxDedupKey,
    toWireEvent,
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

describe('route events envelope v2', () => {
    /** @type {Parameters<typeof buildOutboxRecord>[0]} */
    const base = {type: 'hint_requested', lemmas: ['Give Up'], puzzleId: 'youtube::abc', now: 1700000000000, uuid: 'ABC'};

    test('valid input gives exact fields', () => {
        expect(buildOutboxRecord(base)).toEqual({
            event_id: 'ext:yomitan:abc',
            type: 'hint_requested',
            puzzle_id: 'youtube::abc',
            lemmas: ['give up'],
            client_ts: 1700000000000,
            created_at: 1700000000000,
        });
        expect(FLIB_ROUTE_EVENT_ID_PREFIX).toBe('ext:yomitan:');
    });

    test('route event types', () => {
        expect(isFlibRouteEventType('hint_requested')).toBe(true);
        expect(isFlibRouteEventType('translation_opened')).toBe(true);
        expect(isFlibRouteEventType('word_added_to_dict')).toBe(false);
        expect(isFlibRouteEventType('toString')).toBe(false);
    });

    test.each([
        ['unknown type', {type: 'nope'}],
        ['empty lemmas', {lemmas: []}],
        ['control puzzleId', {puzzleId: '\u0001'}],
        ['DEL puzzleId', {puzzleId: 'a\u007fb'}],
        ['C1 puzzleId', {puzzleId: 'a\u0085b'}],
        ['empty puzzleId', {puzzleId: ''}],
        ['513 bytes', {puzzleId: 'a'.repeat(513)}],
        ['bad uuid', {uuid: 'a b'}],
        ['too long uuid', {uuid: 'a'.repeat(200)}],
    ])('null for %s', (_name, patch) => {
        // @ts-expect-error - deliberately invalid input
        expect(buildOutboxRecord({...base, ...patch})).toBeNull();
    });

    test('puzzleId byte limit is 512 UTF-8 bytes', () => {
        expect(buildOutboxRecord({...base, puzzleId: 'a'.repeat(512)})).not.toBeNull();
        expect(buildOutboxRecord({...base, puzzleId: '\u00e9'.repeat(256)})).not.toBeNull();
        expect(buildOutboxRecord({...base, puzzleId: '\u00e9'.repeat(257)})).toBeNull();
    });

    test('rejects lone surrogate in puzzleId', () => {
        expect(buildOutboxRecord({...base, puzzleId: 'a\ud800b'})).toBeNull();
        expect(buildOutboxRecord({...base, puzzleId: 'a\ud83d\ude00b'})).not.toBeNull();
    });

    test('drops lemmas with NUL (the dedup key separator) and keeps the rest', () => {
        expect(buildOutboxRecord({...base, lemmas: ['a\u0000b', 'ok']})?.lemmas).toEqual(['ok']);
        expect(buildOutboxRecord({...base, lemmas: ['\u0000']})).toBeNull();
        expect(buildOutboxRecord({...base, lemmas: ['a\u0000b']})).toBeNull();
    });

    test('drops lemmas with lone surrogates; a valid pair is kept', () => {
        expect(buildOutboxRecord({...base, lemmas: ['x\ud800', 'y\udc00z', 'ok']})?.lemmas).toEqual(['ok']);
        expect(buildOutboxRecord({...base, lemmas: ['x\ud800']})).toBeNull();
        expect(buildOutboxRecord({...base, lemmas: ['x\ud83d\ude00']})?.lemmas).toEqual(['x\ud83d\ude00']);
    });

    test('wire event JSON is at most 16384 UTF-8 bytes', () => {
        const small = buildOutboxRecord({...base, lemmas: ['a']});
        if (small === null) { throw new Error('null'); }
        const overhead = new TextEncoder().encode(JSON.stringify(toWireEvent(small))).length - 1;
        const fits = buildOutboxRecord({...base, lemmas: ['a'.repeat(16384 - overhead)]});
        if (fits === null) { throw new Error('the exact limit must fit'); }
        expect(new TextEncoder().encode(JSON.stringify(toWireEvent(fits))).length).toBe(16384);
        expect(buildOutboxRecord({...base, lemmas: ['a'.repeat(16385 - overhead)]})).toBeNull();
        // Байты, а не символы: «é» — два байта UTF-8.
        expect(buildOutboxRecord({...base, lemmas: ['\u00e9'.repeat(9000)]})).toBeNull();
    });

    test.each([Number.NaN, Infinity, 8.64e15 + 1, -8.64e15 - 1])('null for bad now %s', (now) => {
        expect(buildOutboxRecord({...base, now})).toBeNull();
    });

    test('toWireEvent omits client_ts for an invalid time and never throws', () => {
        const record = buildOutboxRecord(base);
        if (record === null) { throw new Error('null'); }
        for (const bad of [Number.NaN, Infinity, 8.64e15 + 1]) {
            const wire = toWireEvent({...record, client_ts: bad});
            expect(Object.keys(wire)).toEqual(['event_id', 'type', 'puzzle_id', 'lemmas', 'subs_source']);
        }
    });

    test('outboxDedupKey', () => {
        expect(outboxDedupKey('p', 'hint_requested', 'x')).toBe('p\0hint_requested\0x');
    });

    test('toWireEvent', () => {
        const record = buildOutboxRecord(base);
        if (record === null) { throw new Error('null'); }
        const wire = toWireEvent(record);
        expect(Object.keys(wire)).toEqual(['event_id', 'type', 'puzzle_id', 'lemmas', 'subs_source', 'client_ts']);
        expect(wire.subs_source).toBe('yomitan_web');
        expect(FLIB_SUBS_SOURCE).toBe('yomitan_web');
        expect(wire.client_ts).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/);
        expect(wire.client_ts).toBe('2023-11-14T22:13:20.000Z');
    });
});
