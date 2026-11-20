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
import {Backend} from '../ext/js/background/backend.js';
import {FlibEventsSender} from '../ext/js/background/flib-events-sender.js';
import {
    FLIB_DEDUP_TTL_MS,
    FLIB_EVENTS_DB_NAME,
    FLIB_OUTBOX_MAX_AGE_MS,
    FLIB_OUTBOX_MAX_RECORDS,
    FlibEventsDatabase,
} from '../ext/js/data/flib-events-database.js';

vi.stubGlobal('IDBKeyRange', IDBKeyRange);

/**
 * @param {string[]} lemmas
 * @param {number} createdAt
 * @param {{id?: string, puzzle?: string, type?: import('flib-events').FlibRouteEventType}} [options]
 * @returns {import('flib-events').FlibOutboxRecord}
 */
const rec = (lemmas, createdAt, {id, puzzle = 'p1', type = 'translation_opened'} = {}) => ({
    event_id: id ?? `ext:yomitan:${lemmas.join('+')}-${createdAt}-${puzzle}-${type}`,
    type,
    puzzle_id: puzzle,
    lemmas,
    client_ts: createdAt,
    created_at: createdAt,
});

/**
 * Живое соединение IndexedDB под обёрткой `Database`.
 *
 * ⚠️ fake-indexeddb не шлёт `close`, поэтому обработчик, поставленный
 * `setOnCloseListener`, дёргается напрямую, как это сделал бы браузер.
 * @param {FlibEventsDatabase} database
 * @returns {IDBDatabase}
 */
function rawConnection(database) {
    /* eslint-disable no-underscore-dangle */
    return /** @type {IDBDatabase} */ (/** @type {*} */ (database._db)._db);
    /* eslint-enable no-underscore-dangle */
}

/**
 * @param {string} name
 * @param {number} version
 * @param {(db: IDBDatabase) => void} onUpgrade
 * @returns {Promise<void>}
 */
function createRaw(name, version, onUpgrade) {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(name, version);
        request.onupgradeneeded = () => { onUpgrade(request.result); };
        request.onsuccess = () => {
            request.result.close();
            resolve();
        };
        request.onerror = () => { reject(request.error); };
    });
}

/**
 * @param {FlibEventsDatabase} database
 * @returns {Promise<string[]>}
 */
function dedupKeys(database) {
    return new Promise((resolve, reject) => {
        const connection = /** @type {IDBDatabase} */ (rawConnection(database));
        const store = connection.transaction(['dedup'], 'readonly').objectStore('dedup');
        const request = store.getAllKeys();
        request.onsuccess = () => { resolve(/** @type {string[]} */ (request.result)); };
        request.onerror = () => { reject(request.error); };
    });
}

describe('FlibEventsDatabase', () => {
    /** @type {FlibEventsDatabase} */
    let db;

    beforeEach(async () => {
        vi.stubGlobal('indexedDB', new IDBFactory());
        db = new FlibEventsDatabase();
        await db.prepare();
    });

    test('значения по умолчанию', () => {
        expect(FLIB_OUTBOX_MAX_RECORDS).toBe(300);
        expect(FLIB_OUTBOX_MAX_AGE_MS).toBe(604800000);
        expect(FLIB_DEDUP_TTL_MS).toBe(43200000);
    });

    test('запись, затем список — та же запись', async () => {
        const record = rec(['give up'], 1000);
        expect(await db.recordEvent(record, 1000)).toBe(true);
        expect(await db.listOutbox(10)).toEqual([record]);
        expect(await db.countOutbox()).toBe(1);
    });

    test('та же головоломка+вид+лемма в пределах 12 ч — false, запись одна', async () => {
        await db.recordEvent(rec(['give up'], 1000), 1000);
        expect(await db.recordEvent(rec(['give up'], 2000), 2000)).toBe(false);
        expect(await db.recordEvent(rec(['give up'], 1000 + FLIB_DEDUP_TTL_MS), 1000 + FLIB_DEDUP_TTL_MS)).toBe(false);
        expect(await db.countOutbox()).toBe(1);
    });

    test('через 12 ч + 1 мс — true', async () => {
        await db.recordEvent(rec(['give up'], 1000), 1000);
        const later = 1000 + FLIB_DEDUP_TTL_MS + 1;
        expect(await db.recordEvent(rec(['give up'], later), later)).toBe(true);
        expect(await db.countOutbox()).toBe(2);
    });

    test('другая головоломка — true', async () => {
        await db.recordEvent(rec(['give up'], 1000, {puzzle: 'p1'}), 1000);
        expect(await db.recordEvent(rec(['give up'], 1001, {puzzle: 'p2'}), 1001)).toBe(true);
    });

    test('другой вид — true', async () => {
        await db.recordEvent(rec(['give up'], 1000), 1000);
        expect(await db.recordEvent(rec(['give up'], 1001, {type: 'hint_requested'}), 1001)).toBe(true);
    });

    test('многолемная запись блокируется, если занят ключ ЛЮБОЙ леммы, и ничего не пишет', async () => {
        await db.recordEvent(rec(['give up'], 1000), 1000);
        expect(await db.recordEvent(rec(['book up', 'give up'], 1001), 1001)).toBe(false);
        expect(await db.countOutbox()).toBe(1);
        // ключ «book up» не поставлен
        expect(await db.recordEvent(rec(['book up'], 1002), 1002)).toBe(true);
    });

    test('предел по числу: самая старая уходит, новейшая остаётся', async () => {
        const small = new FlibEventsDatabase({maxRecords: 3});
        await small.prepare();
        for (let i = 1; i <= 4; ++i) {
            expect(await small.recordEvent(rec([`w${i}`], i * 10), i * 10)).toBe(true);
        }
        const ids = (await small.listOutbox(10)).map((r) => r.lemmas[0]);
        expect(ids).toEqual(['w2', 'w3', 'w4']);
    });

    test('предел по числу не удаляет только что записанную, даже если она самая старая по created_at', async () => {
        const small = new FlibEventsDatabase({maxRecords: 2});
        await small.prepare();
        await small.recordEvent(rec(['a'], 100), 100);
        await small.recordEvent(rec(['b'], 200), 200);
        expect(await small.recordEvent(rec(['c'], 50), 300)).toBe(true);
        const lemmas = (await small.listOutbox(10)).map((r) => r.lemmas[0]);
        expect(lemmas).toEqual(['c', 'b']);
    });

    test('предел по возрасту: старая запись убирается при следующей записи', async () => {
        const aged = new FlibEventsDatabase({maxAgeMs: 1000});
        await aged.prepare();
        await aged.recordEvent(rec(['old'], 100), 100);
        await aged.recordEvent(rec(['mid'], 1000), 1000);
        expect(await aged.countOutbox()).toBe(2);
        await aged.recordEvent(rec(['new'], 1101), 1101);
        expect((await aged.listOutbox(10)).map((r) => r.lemmas[0])).toEqual(['mid', 'new']);
    });

    test('deleteOutbox убирает только названные; listOutbox(2) — две самые старые', async () => {
        await db.recordEvent(rec(['a'], 10, {id: 'ida'}), 10);
        await db.recordEvent(rec(['b'], 20, {id: 'idb'}), 20);
        await db.recordEvent(rec(['c'], 30, {id: 'idc'}), 30);
        expect((await db.listOutbox(2)).map((r) => r.event_id)).toEqual(['ida', 'idb']);
        await db.deleteOutbox(['idb', 'missing']);
        expect((await db.listOutbox(10)).map((r) => r.event_id)).toEqual(['ida', 'idc']);
    });

    test('M4: deleteOutbox не снимает ключи дедупа — та же тройка в пределах 12 ч блокируется', async () => {
        await db.recordEvent(rec(['give up'], 1000, {id: 'ida'}), 1000);
        await db.deleteOutbox(['ida']);
        expect(await db.recordEvent(rec(['give up'], 2000), 2000)).toBe(false);
        expect(await db.countOutbox()).toBe(0);
    });

    test('M4: вытеснение по пределам не снимает ключи дедупа', async () => {
        const small = new FlibEventsDatabase({maxRecords: 1});
        await small.prepare();
        await small.recordEvent(rec(['a'], 10), 10);
        await small.recordEvent(rec(['b'], 20), 20);
        expect(await small.countOutbox()).toBe(1);
        expect((await dedupKeys(db)).length).toBe(2);
        expect(await small.recordEvent(rec(['a'], 30), 30)).toBe(false);
    });

    test('просроченные ключи дедупа сметаются при записи', async () => {
        await db.recordEvent(rec(['a'], 1000), 1000);
        await db.recordEvent(rec(['b'], 1000 + FLIB_DEDUP_TTL_MS + 1), 1000 + FLIB_DEDUP_TTL_MS + 1);
        expect((await dedupKeys(db)).length).toBe(1);
    });

    test('pruneOutbox: запись старше 7 суток удаляется, ровно 7 суток — остаётся', async () => {
        await db.recordEvent(rec(['old'], 1000), 1000);
        await db.recordEvent(rec(['edge'], 2000), 2000);
        await db.pruneOutbox(2000 + FLIB_OUTBOX_MAX_AGE_MS);
        expect((await db.listOutbox(10)).map((r) => r.lemmas[0])).toEqual(['edge']);
    });

    test('pruneOutbox: просроченные ключи дедупа сметаются, свежие остаются', async () => {
        await db.recordEvent(rec(['a'], 1000), 1000);
        await db.recordEvent(rec(['b'], 5000), 5000);
        await db.pruneOutbox(5000 + FLIB_DEDUP_TTL_MS);
        expect(await dedupKeys(db)).toEqual(['p1\0translation_opened\0b']);
    });

    test('pruneOutbox: сверх предела по числу уходят самые старые', async () => {
        for (let i = 1; i <= 5; ++i) {
            await db.recordEvent(rec([`w${i}`], i * 10), i * 10);
        }
        const small = new FlibEventsDatabase({maxRecords: 3});
        await small.prepare();
        await small.pruneOutbox(60);
        expect((await small.listOutbox(10)).map((r) => r.lemmas[0])).toEqual(['w3', 'w4', 'w5']);
    });

    test('pruneOutbox на пустой базе ничего не ломает', async () => {
        await db.pruneOutbox(1000);
        expect(await db.countOutbox()).toBe(0);
    });

    test('одновременные записи одной леммы дают ровно одну запись без исключения', async () => {
        const results = await Promise.all([
            db.recordEvent(rec(['x'], 1, {id: 'e1'}), 1),
            db.recordEvent(rec(['x'], 2, {id: 'e2'}), 2),
        ]);
        expect(results.filter(Boolean).length).toBe(1);
        expect(await db.countOutbox()).toBe(1);
    });

    test('дедуп переживает пересоздание объекта над той же базой (смерть воркера)', async () => {
        await db.recordEvent(rec(['a'], 1000), 1000);
        // eslint-disable-next-line no-underscore-dangle
        /** @type {*} */ (db)._db.close();
        const revived = new FlibEventsDatabase();
        await revived.prepare();
        expect(await revived.recordEvent(rec(['a'], 2000), 2000)).toBe(false);
        expect(await revived.countOutbox()).toBe(1);
    });

    test('отказ транзакции отклоняется с НЕ-null причиной и откатывает ключи дедупа', async () => {
        await db.recordEvent(rec(['a'], 10, {id: 'same-id'}), 10);
        // Другая лемма проходит дедуп, но outbox.add падает на дубликате
        // event_id уже ПОСЛЕ постановки ключа дедупа.
        const failure = await db.recordEvent(rec(['b'], 20, {id: 'same-id'}), 20).then(() => null, (/** @type {unknown} */ e) => e);
        expect(failure).not.toBeNull();
        expect(failure).toBeInstanceOf(Error);
        expect(await db.countOutbox()).toBe(1);
        expect((await dedupKeys(db)).length).toBe(1);
        expect(await db.recordEvent(rec(['b'], 30), 30)).toBe(true);
    });

    test('после нашего собственного close() база объявляет себя непригодной', () => {
        expect(db.isUsable).toBe(true);
        // eslint-disable-next-line no-underscore-dangle
        /** @type {*} */ (db)._db.close();
        expect(db.isUsable).toBe(false);
    });

    test('закрытие соединения БРАУЗЕРОМ делает базу непригодной — при живом `isOpen()`', () => {
        const connection = rawConnection(db);
        expect(typeof connection.onclose).toBe('function');
        /** @type {*} */ (connection).onclose();
        // eslint-disable-next-line no-underscore-dangle
        expect(/** @type {*} */ (db)._db.isOpen()).toBe(true);
        expect(db.isUsable).toBe(false);
    });
});

describe('FlibEventsDatabase: апгрейд с версии 1', () => {
    beforeEach(() => {
        vi.stubGlobal('indexedDB', new IDBFactory());
    });

    test('старые хранилища удаляются, outbox пуст, исключения нет', async () => {
        await createRaw(FLIB_EVENTS_DB_NAME, 1, (raw) => {
            const events = raw.createObjectStore('events', {keyPath: 'event_id'});
            events.createIndex('ts', 'ts');
            events.createIndex('host', 'host');
            events.add({event_id: 'old', ts: 1, host: 'flib.club', lemmas: ['x']});
            const dedup = raw.createObjectStore('dedup', {keyPath: 'key'});
            dedup.createIndex('ts', 'ts');
            dedup.add({key: 'https://flib.club/1\0translation_opened\0x', ts: 1});
        });
        const db = new FlibEventsDatabase();
        await db.prepare();
        expect([...(rawConnection(db)).objectStoreNames].sort()).toEqual(['dedup', 'outbox']);
        expect(await db.countOutbox()).toBe(0);
        expect(await dedupKeys(db)).toEqual([]);
        expect(await db.recordEvent(rec(['x'], 5), 5)).toBe(true);
    });
});

describe('Backend + живая очередь: соединение умерло под воркером', () => {
    beforeEach(() => {
        vi.stubGlobal('indexedDB', new IDBFactory());
    });

    /** @returns {Backend} */
    const bareBackend = () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const backend = /** @type {Backend} */ (Object.create(Backend.prototype));
        // eslint-disable-next-line no-underscore-dangle
        backend._flibEventsPromise = null;
        return backend;
    };

    test('умершее соединение выбрасывается, следующее событие пишется в свежую базу', async () => {
        const backend = bareBackend();
        // eslint-disable-next-line no-underscore-dangle
        const first = await backend._getFlibEventsDatabase();
        expect(await first.recordEvent(rec(['до смерти'], 1), 1)).toBe(true);

        /** @type {*} */ (rawConnection(first)).onclose();

        // eslint-disable-next-line no-underscore-dangle
        const second = await backend._getFlibEventsDatabase();
        expect(second).not.toBe(first);
        expect(second.isUsable).toBe(true);
        expect(await second.recordEvent(rec(['после смерти'], 2), 2)).toBe(true);
        expect((await second.listOutbox(10)).map((r) => r.lemmas[0])).toEqual(['до смерти', 'после смерти']);
    });
});

describe('Отправщик + живая очередь: пределы действуют и при отправке', () => {
    beforeEach(() => {
        vi.stubGlobal('indexedDB', new IDBFactory());
    });

    test('событие старше 7 суток удаляется при запуске отправки, а не уходит на шлюз', async () => {
        const db = new FlibEventsDatabase();
        await db.prepare();
        const t0 = 1_800_000_000_000;
        await db.recordEvent(rec(['stale'], t0), t0);
        const gateway = {
            getRouteId: vi.fn(async () => '11111111-1111-4111-8111-111111111111'),
            postExternalEvents: vi.fn(async () => /** @type {import('flib-gateway').ExternalEventsResult} */ ({kind: 'ok', accepted: 1, duplicates: 0, rejectedIds: []})),
        };
        const sender = new FlibEventsSender({
            getDatabase: async () => db,
            gateway,
            getKey: async () => `tpk_${'a'.repeat(32)}`,
            storage: {get: async () => ({}), set: async () => {}},
            now: () => t0 + FLIB_OUTBOX_MAX_AGE_MS + 1,
            setTimer: () => 0,
            clearTimer: () => {},
            log: {log: () => {}, error: () => {}},
        });
        await sender.flush();
        expect(gateway.postExternalEvents).not.toHaveBeenCalled();
        expect(await db.countOutbox()).toBe(0);
    });
});

describe('Backend: запуск открывает очередь и удаляет журнал v1', () => {
    beforeEach(() => {
        vi.stubGlobal('indexedDB', new IDBFactory());
    });

    test('после _startFlibEventsQueue хранилища events нет, хотя отправщик ничего не делал', async () => {
        await createRaw(FLIB_EVENTS_DB_NAME, 1, (raw) => {
            const events = raw.createObjectStore('events', {keyPath: 'event_id'});
            events.add({event_id: 'old', ts: 1, url: 'https://flib.club/book/1', lemmas: ['x']});
        });
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const backend = /** @type {Backend} */ (Object.create(Backend.prototype));
        // eslint-disable-next-line no-underscore-dangle
        backend._flibEventsPromise = null;
        // @ts-expect-error - отправщик без ключа: в базу не ходит
        // eslint-disable-next-line no-underscore-dangle
        backend._flibEventsSender = {flush: vi.fn(async () => {})};
        // eslint-disable-next-line no-underscore-dangle
        await backend._startFlibEventsQueue();
        // eslint-disable-next-line no-underscore-dangle
        const database = await backend._getFlibEventsDatabase();
        expect([...rawConnection(database).objectStoreNames].sort()).toEqual(['dedup', 'outbox']);
    });
});
