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

import {IDBFactory, IDBKeyRange} from 'fake-indexeddb';
import {beforeEach, describe, expect, test, vi} from 'vitest';
import {buildEvent} from '../ext/js/data/flib-event-envelope.js';
import {FlibEventsDatabase} from '../ext/js/data/flib-events-database.js';

vi.stubGlobal('IDBKeyRange', IDBKeyRange);

/**
 * @param {string} lemma
 * @param {number} ts
 * @param {string} [url]
 * @returns {import('flib-events').FlibEvent}
 */
const ev = (lemma, ts, url = 'https://flib.club/1') => /** @type {import('flib-events').FlibEvent} */ (buildEvent({
    type: 'translation_opened',
    lemmas: [lemma],
    url,
    ts,
    eventId: `${lemma}-${ts}-${url}`,
}));

describe('FlibEventsDatabase', () => {
    /** @type {FlibEventsDatabase} */
    let db;

    beforeEach(async () => {
        vi.stubGlobal('indexedDB', new IDBFactory());
        // Возраст отключён: фикстурные ts — 1970 год, дефолтная ротация снесла
        // бы каждую запись сразу после вставки.
        db = new FlibEventsDatabase({maxAgeMs: Number.POSITIVE_INFINITY});
        await db.prepare();
    });

    test('первая запись проходит', async () => {
        expect(await db.recordEvent(ev('give up', 1))).toBe(true);
        expect((await db.listEvents({})).length).toBe(1);
    });

    test('повтор той же леммы на той же странице отбрасывается', async () => {
        await db.recordEvent(ev('give up', 1));
        expect(await db.recordEvent(ev('give up', 2))).toBe(false);
        expect((await db.listEvents({})).length).toBe(1);
    });

    test('та же лемма на ДРУГОЙ странице пишется — второе свидетельство', async () => {
        await db.recordEvent(ev('give up', 1, 'https://flib.club/1'));
        expect(await db.recordEvent(ev('give up', 2, 'https://flib.club/2'))).toBe(true);
        expect((await db.listEvents({})).length).toBe(2);
    });

    test('в записи остаются только свежие леммы', async () => {
        await db.recordEvent(ev('give up', 1));
        const mixed = /** @type {import('flib-events').FlibEvent} */ (buildEvent({
            type: 'translation_opened',
            lemmas: ['give up', 'book up'],
            url: 'https://flib.club/1',
            ts: 3,
            eventId: 'mixed',
        }));
        expect(await db.recordEvent(mixed)).toBe(true);
        const stored = (await db.listEvents({})).find((e) => e.event_id === 'mixed');
        expect(stored?.lemmas).toEqual(['book up']);
    });

    test('дедуп переживает пересоздание объекта над той же базой (смерть воркера)', async () => {
        await db.recordEvent(ev('give up', 1));
        const revived = new FlibEventsDatabase({maxAgeMs: Number.POSITIVE_INFINITY});
        await revived.prepare();
        expect(await revived.recordEvent(ev('give up', 2))).toBe(false);
    });

    test('одновременные записи одной леммы дают ровно одну запись без исключения', async () => {
        const results = await Promise.all([
            db.recordEvent(ev('give up', 1)),
            db.recordEvent(ev('give up', 1)),
        ]);
        expect(results.filter(Boolean).length).toBe(1);
        expect((await db.listEvents({})).length).toBe(1);
    });

    test('deleteEvents убирает названные записи', async () => {
        await db.recordEvent(ev('give up', 1));
        await db.recordEvent(ev('book up', 2));
        await db.deleteEvents(['give up-1-https://flib.club/1']);
        expect((await db.listEvents({})).map((e) => e.lemmas[0])).toEqual(['book up']);
    });

    test('listEvents фильтрует по since и режет по limit', async () => {
        for (let i = 1; i <= 5; ++i) {
            await db.recordEvent(ev(`w${i}`, i * 10));
        }
        expect((await db.listEvents({since: 25})).map((e) => e.ts)).toEqual([30, 40, 50]);
        expect((await db.listEvents({limit: 2})).length).toBe(2);
    });

    test('ротация по числу оставляет самые свежие', async () => {
        const small = new FlibEventsDatabase({maxRecords: 3, maxAgeMs: Number.POSITIVE_INFINITY});
        await small.prepare();
        for (let i = 1; i <= 5; ++i) {
            await small.recordEvent(ev(`w${i}`, i));
        }
        const kept = (await small.listEvents({})).map((e) => e.ts).sort((a, b) => a - b);
        expect(kept).toEqual([3, 4, 5]);
    });

    test('ротация по возрасту выбрасывает записи старше предела', async () => {
        vi.stubGlobal('indexedDB', new IDBFactory());
        const aged = new FlibEventsDatabase();
        await aged.prepare();
        await aged.recordEvent(ev('старое', Date.now() - (91 * 24 * 60 * 60 * 1000)));
        await aged.recordEvent(ev('свежее', Date.now()));
        expect((await aged.listEvents({})).map((e) => e.lemmas[0])).toEqual(['свежее']);
    });

    test('упавшая запись не оставляет ключ дедупа — следующая попытка с той же леммой проходит', async () => {
        // event_id: undefined — keyPath отсутствует, IDBObjectStore.add() бросит
        // DataError внутри транзакции. Проверяем, что вся транзакция откатывается:
        // ни событие, ни ключ дедупа не остаются, и следующая честная запись проходит.
        const broken = /** @type {import('flib-events').FlibEvent} */ (buildEvent({
            type: 'translation_opened',
            lemmas: ['give up'],
            url: 'https://flib.club/1',
            ts: 1,
            eventId: /** @type {string} */ (/** @type {unknown} */ (void 0)),
        }));
        await expect(db.recordEvent(broken)).rejects.toBeDefined();
        expect(await db.recordEvent(ev('give up', 2))).toBe(true);
        expect((await db.listEvents({})).length).toBe(1);
    });
});
