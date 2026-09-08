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
import {buildEvent, dedupKey} from '../ext/js/data/flib-event-envelope.js';
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

/**
 * Тесты ниже намеренно заходят за публичный API FlibEventsDatabase — это
 * единственный способ проверить парный откат при уборке (_rotate — приватный
 * метод, вызывается только изнутри recordEvent) и форсировать асинхронный
 * отказ конкретной вставки/удаления ключа дедупа (dedupKey() всегда
 * возвращает валидную строку, так что естественным путём такой отказ не
 * получить). Доступ к приватным полям сосредоточен в этих трёх помощниках,
 * а не разбросан по телам тестов.
 * @param {FlibEventsDatabase} database
 * @param {string[]} storeNames
 * @param {IDBTransactionMode} mode
 * @returns {IDBTransaction}
 */
function rawTransaction(database, storeNames, mode) {
    // eslint-disable-next-line no-underscore-dangle
    return database._db.transaction(storeNames, mode);
}

/**
 * @param {FlibEventsDatabase} database
 * @returns {Promise<void>}
 */
function rotateNow(database) {
    // eslint-disable-next-line no-underscore-dangle
    return database._rotate();
}

/**
 * @param {FlibEventsDatabase} database
 * @param {number} maxRecords
 * @returns {void}
 */
function forceMaxRecords(database, maxRecords) {
    // eslint-disable-next-line no-underscore-dangle
    database._maxRecords = maxRecords;
}

/**
 * Временно подменяет метод объект-стора на его ОБЩЕМ прототипе (все инстансы
 * стора одного типа его разделяют), чтобы он бросал исключение для одного
 * конкретного вызова — единственный способ форсировать асинхронный отказ
 * ВНУТРИ уже открытой транзакции. Настоящую гонку (конфликтующая запись из
 * другой, отдельной транзакции) так не смоделировать — и не нужно: IndexedDB
 * сериализует транзакции с пересекающимся scope, так что описанный тут сбой
 * в реальности возможен только как отказ САМОЙ операции (диск, квота и т.п.),
 * не как гонка с другим клиентом.
 * @param {IDBTransaction} transaction
 * @param {string} storeName
 * @param {'add'|'delete'} methodName
 * @param {(...args: *[]) => boolean} shouldThrow
 * @returns {() => void} restore
 */
function poisonStoreMethod(transaction, storeName, methodName, shouldThrow) {
    const store = /** @type {*} */ (transaction.objectStore(storeName));
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const proto = Object.getPrototypeOf(store);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const original = proto[methodName];

    /**
     * @this {*}
     * @param {...*} args
     * @returns {*}
     * @throws {DOMException} Always, by construction, when shouldThrow(...args) is true.
     */
    function poisoned(...args) {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-argument
        if (shouldThrow(...args)) {
            throw new DOMException('forced failure for test', 'ConstraintError');
        }
        return original.apply(this, args);
    }

    proto[methodName] = poisoned;
    return () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        proto[methodName] = original;
    };
}

describe('FlibEventsDatabase', () => {
    /** @type {FlibEventsDatabase} */
    let db;

    beforeEach(async () => {
        vi.stubGlobal('indexedDB', new IDBFactory());
        // ⚠️ Никаких maxAgeMs: ротации по возрасту больше нет вовсе, и
        // фикстурные ts из 1970 года теперь безобидны сами по себе.
        db = new FlibEventsDatabase();
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
        const revived = new FlibEventsDatabase();
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
        const small = new FlibEventsDatabase({maxRecords: 3});
        await small.prepare();
        for (let i = 1; i <= 5; ++i) {
            await small.recordEvent(ev(`w${i}`, i));
        }
        const kept = (await small.listEvents({})).map((e) => e.ts).sort((a, b) => a - b);
        expect(kept).toEqual([3, 4, 5]);
    });

    test('ротации по возрасту НЕТ: пока нет отправщика, старое событие — неотправленная улика', async () => {
        // ⚠️ Гвоздь решения O-7 (ревизия 6): флага `sent` нет и
        // отправщика нет, значит всякое удалённое по возрасту событие по
        // построению не отправлено. Возврат возрастной ротации обязан
        // уронить этот тест.
        vi.stubGlobal('indexedDB', new IDBFactory());
        const aged = new FlibEventsDatabase();
        await aged.prepare();
        await aged.recordEvent(ev('очень старое', Date.now() - (400 * 24 * 60 * 60 * 1000)));
        await aged.recordEvent(ev('свежее', Date.now()));
        expect((await aged.listEvents({})).map((e) => e.lemmas[0]).sort()).toEqual(['очень старое', 'свежее']);
    });

    test('упавшая запись не оставляет ключ дедупа — следующая попытка с той же леммой проходит', async () => {
        // event_id: undefined — keyPath отсутствует, IDBObjectStore.add()
        // бросит DataError внутри транзакции. Ключ дедупа для 'give up' к
        // этому моменту уже ПОСТАВЛЕН в очередь транзакции (dedup.add идёт
        // раньше events.add в recordEvent), так что тест действительно
        // проверяет откат, а не «до записи события просто не дошли»:
        // реализация с двумя раздельными транзакциями (сперва ключ, потом
        // событие) этот тест бы НЕ прошла — ключ остался бы закоммиченным
        // навсегда, и повторная запись ниже была бы неверно отброшена как
        // дубль.
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

    test('падение вставки ключа для ОДНОЙ леммы из нескольких откатывает уже поставленные ключи и не пишет событие', async () => {
        // Обратное направление предыдущего теста: там падал events.add,
        // здесь — dedup.add. Событие содержит ДВЕ леммы: 'safe' (её dedup.add
        // успевает выполниться первым и остаётся в очереди транзакции) и
        // 'poison' (её dedup.add форсированно бросает). Проверяем, что откат
        // забирает с собой и уже «успешно» поставленный ключ 'safe' —
        // раздельные транзакции на ключ (например, отдельный commit на
        // каждую лемму внутри цикла) оставили бы 'safe' закоммиченным
        // навсегда.
        const poisonedKey = dedupKey('https://flib.club/1', 'translation_opened', 'poison');
        const transaction = rawTransaction(db, ['dedup'], 'readonly');
        const restore = poisonStoreMethod(
            transaction,
            'dedup',
            'add',
            (value) => Boolean(value) && /** @type {{key?: unknown}} */ (value).key === poisonedKey,
        );
        const mixed = /** @type {import('flib-events').FlibEvent} */ (buildEvent({
            type: 'translation_opened',
            lemmas: ['safe', 'poison'],
            url: 'https://flib.club/1',
            ts: 1,
            eventId: 'mixed-poison',
        }));
        try {
            await expect(db.recordEvent(mixed)).rejects.toBeDefined();
        } finally {
            restore();
        }
        expect((await db.listEvents({})).length).toBe(0);
        // 'safe' не осталась поставленной — честная повторная запись проходит.
        expect(await db.recordEvent(ev('safe', 2, 'https://flib.club/1'))).toBe(true);
    });

    test('отказ уборки не оставляет ключ дедупа без события — обе стороны откатываются вместе', async () => {
        const small = new FlibEventsDatabase();
        await small.prepare();
        await small.recordEvent(ev('обречённое', 1));
        await small.recordEvent(ev('уцелевшее', 2));
        // Опускаем предел ТОЛЬКО теперь, вручную: оба события успели
        // записаться до того, как первое стало «обречённым» для
        // авто-ротации внутри recordEvent.
        forceMaxRecords(small, 1);

        const doomedKey = dedupKey('https://flib.club/1', 'translation_opened', 'обречённое');
        const transaction = rawTransaction(small, ['dedup'], 'readonly');
        const restore = poisonStoreMethod(
            transaction,
            'dedup',
            'delete',
            (key) => key === doomedKey,
        );
        try {
            await expect(rotateNow(small)).rejects.toBeDefined();
        } finally {
            restore();
        }

        // Раздельные транзакции (сперва событие, потом ключ, или наоборот)
        // к этому моменту уже успели бы убрать одну из сторон безвозвратно.
        // Одна транзакция откатывает ОБЕ: событие всё ещё на месте, и ключ
        // дедупа — тоже (проверяем напрямую, в обход listEvents).
        expect((await small.listEvents({})).length).toBe(2);
        const keyStillThere = await (/** @type {Promise<boolean>} */ (new Promise((resolve, reject) => {
            const readTransaction = rawTransaction(small, ['dedup'], 'readonly');
            const request = readTransaction.objectStore('dedup').get(doomedKey);
            request.onsuccess = () => resolve(typeof request.result !== 'undefined');
            request.onerror = () => reject(request.error);
        })));
        expect(keyStillThere).toBe(true);
    });

    test('осиротевший ключ дедупа подметается НЕЗАВИСИМО ОТ ВОЗРАСТА', async () => {
        // Ключ без события — реалистичный сценарий уже сегодня: deleteEvents
        // убирает событие, но не трогает dedup (задача 5 будет вызывать
        // deleteEvents на выгруженных событиях).
        //
        // ⚠️ ts у ключа СЕГОДНЯШНИЙ. Прежняя уборка сирот шла по возрасту и
        // такой ключ не тронула бы вовсе, а при бесконечном пределе (именно
        // так были настроены тесты) отключалась целиком — и каждая
        // осиротевшая лемма оказывалась заглушена НАВЕЧНО.
        const aged = new FlibEventsDatabase();
        await aged.prepare();
        const orphanKey = dedupKey('https://flib.club/1', 'translation_opened', 'сирота');
        await (/** @type {Promise<void>} */ (new Promise((resolve, reject) => {
            const transaction = rawTransaction(aged, ['dedup'], 'readwrite');
            transaction.objectStore('dedup').add({key: orphanKey, ts: Date.now()});
            transaction.oncomplete = () => resolve();
            transaction.onerror = () => reject(transaction.error);
        })));
        await rotateNow(aged);
        expect(await aged.recordEvent(ev('сирота', Date.now(), 'https://flib.club/1'))).toBe(true);
    });

    test('уборка сирот НЕ трогает ключ, чьё событие ещё лежит в очереди', async () => {
        // Обратная сторона теста выше: критерий — сиротство, и он обязан
        // отличать «события нет» от «событие есть». Снятый по ошибке живой
        // ключ означал бы второе свидетельство на ту же пару «страница+лемма»,
        // то есть ложь о том, что слово открывали дважды.
        await db.recordEvent(ev('живое', 1));
        await rotateNow(db);
        expect(await db.recordEvent(ev('живое', 2))).toBe(false);
        expect((await db.listEvents({})).length).toBe(1);
    });

    test('отказ ротации не топит recordEvent — событие уже физически записано', async () => {
        const rotateSpy = vi.spyOn(db, '_rotate').mockRejectedValue(new Error('rotation boom'));
        await expect(db.recordEvent(ev('give up', 1))).resolves.toBe(true);
        expect((await db.listEvents({})).length).toBe(1);
        rotateSpy.mockRestore();
    });
});
