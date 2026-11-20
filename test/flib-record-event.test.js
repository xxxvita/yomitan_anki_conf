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

import {describe, expect, test, vi} from 'vitest';
import {Backend} from '../ext/js/background/backend.js';
import {FlibEventsSender} from '../ext/js/background/flib-events-sender.js';
import {log} from '../ext/js/core/log.js';

// ⚠️ Счётчики открытий живут в vi.hoisted, потому что фабрику vi.mock
// поднимают выше импортов, и обычная переменная модуля тут ещё не создана.
const dbSpy = vi.hoisted(() => ({constructed: 0, prepared: 0, usable: true}));

vi.mock('../ext/js/data/flib-events-database.js', () => ({
    FlibEventsDatabase: class {
        constructor() {
            dbSpy.constructed += 1;
            /** @type {boolean} */
            this.isUsable = dbSpy.usable;
        }

        /** @returns {Promise<void>} */
        prepare() {
            dbSpy.prepared += 1;
            // Открытие базы асинхронно — именно этот await и открывает окно
            // гонки в бэкенде; мгновенный резолв её бы замаскировал.
            return new Promise((resolve) => { setTimeout(resolve, 5); });
        }

        /** @returns {Promise<boolean>} */
        recordEvent() {
            return Promise.resolve(true);
        }
    },
}));

const ROUTE_URL = 'https://flib.club/player?rp=route%20%231&x=2';

/**
 * Голый Backend с подменённой очередью, отправщиком и резолвом URL вкладки.
 * @param {?string} fallbackUrl адрес, который отдаст _getTabUrl
 * @param {{recordResult?: boolean, recordError?: ?Error}} [options]
 * @returns {{backend: Backend, recorded: import('flib-events').FlibOutboxRecord[], flush: import('vitest').Mock}}
 */
function makeBackend(fallbackUrl, {recordResult = true, recordError = null} = {}) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const backend = /** @type {Backend} */ (Object.create(Backend.prototype));
    /** @type {import('flib-events').FlibOutboxRecord[]} */
    const recorded = [];
    // @ts-expect-error - подменяем приватные поля ради изоляции обработчика
    // eslint-disable-next-line no-underscore-dangle
    backend._flibEventsPromise = Promise.resolve({
        isUsable: true,
        recordEvent: async (/** @type {import('flib-events').FlibOutboxRecord} */ event) => {
            if (recordError !== null) { throw recordError; }
            recorded.push(event);
            return recordResult;
        },
    });
    const flush = vi.fn(async () => {});
    // @ts-expect-error - подменяем приватное поле
    // eslint-disable-next-line no-underscore-dangle
    backend._flibEventsSender = {flush};
    // eslint-disable-next-line no-underscore-dangle
    backend._getTabUrl = async () => fallbackUrl;
    return {backend, recorded, flush};
}

/**
 * @param {Backend} backend
 * @param {unknown} payload
 * @param {unknown} sender
 * @returns {Promise<boolean>}
 */
async function call(backend, payload, sender) {
    // eslint-disable-next-line no-underscore-dangle
    return await backend._onApiFlibRecordEvent(/** @type {*} */ (payload), /** @type {*} */ (sender));
}

describe('_onApiFlibRecordEvent', () => {
    test('страница маршрута: пишет запись с puzzle_id из rp и будит отправщика', async () => {
        const {backend, recorded, flush} = makeBackend(null);
        const ok = await call(backend, {type: 'translation_opened', lemmas: ['Give Up']}, {tab: {id: 1, url: ROUTE_URL}});
        expect(ok).toBe(true);
        expect(recorded.length).toBe(1);
        expect(recorded[0].lemmas).toEqual(['give up']);
        expect(recorded[0].puzzle_id).toBe('route #1');
        expect(recorded[0].type).toBe('translation_opened');
        expect(recorded[0].event_id).toMatch(/^ext:yomitan:[a-f0-9-]{36}$/u);
        expect(flush).toHaveBeenCalledTimes(1);
    });

    test('hint_requested тоже принимается', async () => {
        const {backend, recorded} = makeBackend(null);
        expect(await call(backend, {type: 'hint_requested', lemmas: ['x']}, {tab: {id: 1, url: ROUTE_URL}})).toBe(true);
        expect(recorded[0].type).toBe('hint_requested');
    });

    test('не страница маршрута на flib.club — false, ничего не пишется', async () => {
        const {backend, recorded, flush} = makeBackend(null);
        for (const url of ['https://flib.club/1', 'https://flib.club/player', 'https://flib.club/read?rp=1']) {
            expect(await call(backend, {type: 'translation_opened', lemmas: ['x']}, {tab: {id: 1, url}})).toBe(false);
        }
        expect(recorded.length).toBe(0);
        expect(flush).not.toHaveBeenCalled();
    });

    test('чужой домен — false', async () => {
        const {backend, recorded} = makeBackend(null);
        expect(await call(backend, {type: 'translation_opened', lemmas: ['give up']}, {tab: {id: 1, url: 'https://example.com/player?rp=1'}})).toBe(false);
        expect(recorded.length).toBe(0);
    });

    test('пустой sender.tab.url — идём в фолбэк _getTabUrl (Firefox)', async () => {
        const {backend, recorded} = makeBackend('https://flib.club/player?rp=abc');
        expect(await call(backend, {type: 'hint_requested', lemmas: ['figure out']}, {tab: {id: 7}})).toBe(true);
        expect(recorded[0].puzzle_id).toBe('abc');
    });

    test('подделать адрес через полезную нагрузку нельзя', async () => {
        const {backend, recorded} = makeBackend(null);
        expect(await call(backend, {type: 'translation_opened', lemmas: ['https://flib.club/player?rp=1']}, {tab: {id: 1, url: 'https://example.com/1'}})).toBe(false);
        expect(recorded.length).toBe(0);
    });

    test('word_added_to_dict и прочие незнакомые виды — false, ничего не записано', async () => {
        const {backend, recorded, flush} = makeBackend(null);
        for (const type of ['word_added_to_dict', 'bogus x']) {
            expect(await call(backend, {type, lemmas: ['give up']}, {tab: {id: 1, url: ROUTE_URL}})).toBe(false);
        }
        expect(recorded.length).toBe(0);
        expect(flush).not.toHaveBeenCalled();
    });

    test('дубль (recordEvent вернул false) — false и без flush', async () => {
        const {backend, flush} = makeBackend(null, {recordResult: false});
        expect(await call(backend, {type: 'translation_opened', lemmas: ['x']}, {tab: {id: 1, url: ROUTE_URL}})).toBe(false);
        expect(flush).not.toHaveBeenCalled();
    });

    test('отказ базы — false и запись в лог, без flush', async () => {
        const spy = vi.spyOn(log, 'error').mockImplementation(() => {});
        try {
            const {backend, flush} = makeBackend(null, {recordError: new Error('db down')});
            expect(await call(backend, {type: 'translation_opened', lemmas: ['x']}, {tab: {id: 1, url: ROUTE_URL}})).toBe(false);
            expect(spy).toHaveBeenCalledTimes(1);
            expect(flush).not.toHaveBeenCalled();
        } finally {
            spy.mockRestore();
        }
    });

    test('пустые леммы — false', async () => {
        const {backend, recorded} = makeBackend(null);
        expect(await call(backend, {type: 'translation_opened', lemmas: ['  ']}, {tab: {id: 1, url: ROUTE_URL}})).toBe(false);
        expect(recorded.length).toBe(0);
    });

    test('приватное окно — false, ничего не пишется, отправщик не будится', async () => {
        // Решение: из приватных окон события не записываются и не уходят вовсе,
        // как и перевод предложений «не для приватных окон».
        const {backend, recorded, flush} = makeBackend('https://flib.club/player?rp=abc');
        expect(await call(backend, {type: 'translation_opened', lemmas: ['x']}, {tab: {id: 1, url: ROUTE_URL, incognito: true}})).toBe(false);
        expect(await call(backend, {type: 'hint_requested', lemmas: ['y']}, {tab: {id: 7, incognito: true}})).toBe(false);
        expect(recorded.length).toBe(0);
        expect(flush).not.toHaveBeenCalled();
    });

    test('incognito: false — обычное окно, пишется', async () => {
        const {backend, recorded} = makeBackend(null);
        expect(await call(backend, {type: 'translation_opened', lemmas: ['x']}, {tab: {id: 1, url: ROUTE_URL, incognito: false}})).toBe(true);
        expect(recorded.length).toBe(1);
    });

    test('нет вкладки и фолбэк пуст — не пишет', async () => {
        const {backend} = makeBackend(null);
        expect(await call(backend, {type: 'translation_opened', lemmas: ['x']}, {})).toBe(false);
    });
});

describe('ленивое открытие очереди событий', () => {
    /**
     * Бэкенд БЕЗ подменённой очереди: тут проверяется именно то, как она
     * открывается.
     * @returns {Backend}
     */
    const bareBackend = () => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const backend = /** @type {Backend} */ (Object.create(Backend.prototype));
        // eslint-disable-next-line no-underscore-dangle
        backend._flibEventsPromise = null;
        return backend;
    };

    test('два одновременных вызова открывают базу ОДИН раз', async () => {
        // ⚠️ Дефект, который тут ловится: между проверкой `=== null` и
        // присваиванием готового экземпляра стоял await prepare(). Два вызова,
        // попавшие в это окно, строили ДВА объекта, открывали ДВА соединения
        // IndexedDB, и одно оставалось висеть ничьим — deleteDatabase и смена
        // версии на нём блокируются.
        dbSpy.constructed = 0;
        dbSpy.prepared = 0;
        const backend = bareBackend();

        const [a, b] = await Promise.all([
            // eslint-disable-next-line no-underscore-dangle
            backend._getFlibEventsDatabase(),
            // eslint-disable-next-line no-underscore-dangle
            backend._getFlibEventsDatabase(),
        ]);

        expect(dbSpy.constructed).toBe(1);
        expect(dbSpy.prepared).toBe(1);
        expect(a).toBe(b);
    });

    test('последовательные вызовы базу не переоткрывают', async () => {
        dbSpy.constructed = 0;
        const backend = bareBackend();
        // eslint-disable-next-line no-underscore-dangle
        const a = await backend._getFlibEventsDatabase();
        // eslint-disable-next-line no-underscore-dangle
        const b = await backend._getFlibEventsDatabase();
        expect(dbSpy.constructed).toBe(1);
        expect(a).toBe(b);
    });

    test('умершее соединение выбрасывается из мемо, а не отдаётся снова', async () => {
        // ⚠️ Дефект, который тут ловится: браузер закрывает соединение под
        // живым воркером (пользователь очистил данные сайта, база
        // повреждена), а мемо продолжало отдавать труп — каждый следующий
        // recordEvent падал до конца жизни воркера. Во время чтения воркер
        // жив постоянно за счёт трафика сообщений, так что очередь молча
        // умирала на всю сессию.
        dbSpy.constructed = 0;
        dbSpy.usable = true;
        const backend = bareBackend();
        // eslint-disable-next-line no-underscore-dangle
        const dead = await backend._getFlibEventsDatabase();
        /** @type {*} */ (dead).isUsable = false;

        // eslint-disable-next-line no-underscore-dangle
        const fresh = await backend._getFlibEventsDatabase();
        expect(fresh).not.toBe(dead);
        expect(dbSpy.constructed).toBe(2);
    });

    test('если и переоткрытая база непригодна — отказ, а не бесконечные попытки', async () => {
        dbSpy.constructed = 0;
        dbSpy.usable = false;
        const backend = bareBackend();
        try {
            // eslint-disable-next-line no-underscore-dangle
            await expect(backend._getFlibEventsDatabase()).rejects.toBeDefined();
        } finally {
            dbSpy.usable = true;
        }
        expect(dbSpy.constructed).toBe(2);
    });

    test('свежий воркер (новый Backend) открывает свою базу — мемо не переживает перезапуск', async () => {
        // ⚠️ MV3 глушит воркер по простою: мемо обязано быть корректным на
        // ПУСТОМ поле, а не рассчитывать на непрерывность.
        dbSpy.constructed = 0;
        // eslint-disable-next-line no-underscore-dangle
        await bareBackend()._getFlibEventsDatabase();
        // eslint-disable-next-line no-underscore-dangle
        await bareBackend()._getFlibEventsDatabase();
        expect(dbSpy.constructed).toBe(2);
    });
});

describe('очередь событий при запуске фоновой части', () => {
    /**
     * @param {{flush: () => Promise<void>}} sender
     * @returns {Backend}
     */
    const startupBackend = (sender) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const backend = /** @type {Backend} */ (Object.create(Backend.prototype));
        // eslint-disable-next-line no-underscore-dangle
        backend._flibEventsPromise = null;
        // @ts-expect-error - подменяем приватное поле
        // eslint-disable-next-line no-underscore-dangle
        backend._flibEventsSender = sender;
        return backend;
    };

    test('база открывается при старте даже без ключа: иначе журнал v1 с адресами страниц не удаляется', async () => {
        // ⚠️ Дефект, который тут ловится: старое хранилище `events` (полные
        // адреса страниц flib.club) удаляет только открытие базы v2, а
        // отправщик без ключа возвращается до getDatabase(). Пользователь без
        // ключа и без визитов на страницу маршрута носил журнал вечно.
        dbSpy.constructed = 0;
        dbSpy.prepared = 0;
        const backend = startupBackend({flush: async () => {}});
        const sender = new FlibEventsSender({
            // eslint-disable-next-line no-underscore-dangle
            getDatabase: () => backend._getFlibEventsDatabase(),
            gateway: {getRouteId: vi.fn(), postExternalEvents: vi.fn()},
            getKey: async () => '',
            storage: {get: async () => ({}), set: async () => {}},
            now: () => 1_800_000_000_000,
            setTimer: () => 0,
            clearTimer: () => {},
            log: {log: () => {}, error: () => {}},
        });
        const flush = vi.spyOn(sender, 'flush');
        // eslint-disable-next-line no-underscore-dangle
        backend._flibEventsSender = sender;
        // eslint-disable-next-line no-underscore-dangle
        await backend._startFlibEventsQueue();
        expect(dbSpy.constructed).toBe(1);
        expect(dbSpy.prepared).toBe(1);
        expect(flush).toHaveBeenCalledTimes(1);
    });

    test('сбой открытия при старте — лог без значка (уровень log), запуск не падает', async () => {
        const errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
        const genericSpy = vi.spyOn(log, 'logGenericError').mockImplementation(() => {});
        try {
            const backend = startupBackend({flush: vi.fn(async () => {})});
            const failure = new Error('open failed');
            // eslint-disable-next-line no-underscore-dangle
            backend._getFlibEventsDatabase = async () => { throw failure; };
            // eslint-disable-next-line no-underscore-dangle
            await expect(backend._startFlibEventsQueue()).resolves.toBeUndefined();
            expect(genericSpy).toHaveBeenCalledWith(failure, 'log');
            expect(errorSpy).not.toHaveBeenCalled();
        } finally {
            errorSpy.mockRestore();
            genericSpy.mockRestore();
        }
    });

    test('_prepareInternal запускает очередь через _startFlibEventsQueue', () => {
        // Весь _prepareInternal в jsdom не поднять (chrome.*, offscreen, словари),
        // поэтому проводка проверяется по исходнику метода.
        // eslint-disable-next-line no-underscore-dangle
        const source = Backend.prototype._prepareInternal.toString();
        expect(source).toContain('this._startFlibEventsQueue()');
        expect(source).not.toContain('this._flibEventsSender.flush()');
    });
});
