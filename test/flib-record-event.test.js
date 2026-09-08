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

/**
 * Голый Backend с подменённой очередью и резолвом URL вкладки.
 * @param {?string} fallbackUrl адрес, который отдаст _getTabUrl
 * @returns {{backend: Backend, recorded: import('flib-events').FlibEvent[]}}
 */
function makeBackend(fallbackUrl) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const backend = /** @type {Backend} */ (Object.create(Backend.prototype));
    /** @type {import('flib-events').FlibEvent[]} */
    const recorded = [];
    // @ts-expect-error - подменяем приватные поля ради изоляции обработчика
    // eslint-disable-next-line no-underscore-dangle
    backend._flibEventsPromise = Promise.resolve({
        isUsable: true,
        recordEvent: async (event) => {
            recorded.push(event);
            return true;
        },
    });
    // eslint-disable-next-line no-underscore-dangle
    backend._getTabUrl = async () => fallbackUrl;
    return {backend, recorded};
}

describe('_onApiFlibRecordEvent', () => {
    test('на flib.club пишет событие с нормализованной леммой', async () => {
        const {backend, recorded} = makeBackend(null);
        // eslint-disable-next-line no-underscore-dangle
        const ok = await backend._onApiFlibRecordEvent(
            {type: 'translation_opened', lemmas: ['Give Up']},
            /** @type {*} */ ({tab: {id: 1, url: 'https://flib.club/1'}}),
        );
        expect(ok).toBe(true);
        expect(recorded[0].lemmas).toEqual(['give up']);
        expect(recorded[0].host).toBe('flib.club');
    });

    test('на чужом домене не пишет', async () => {
        const {backend, recorded} = makeBackend(null);
        // eslint-disable-next-line no-underscore-dangle
        const ok = await backend._onApiFlibRecordEvent(
            {type: 'translation_opened', lemmas: ['give up']},
            /** @type {*} */ ({tab: {id: 1, url: 'https://example.com/1'}}),
        );
        expect(ok).toBe(false);
        expect(recorded.length).toBe(0);
    });

    test('пустой sender.tab.url — идём в фолбэк _getTabUrl (Firefox)', async () => {
        const {backend, recorded} = makeBackend('https://flib.club/2');
        // eslint-disable-next-line no-underscore-dangle
        const ok = await backend._onApiFlibRecordEvent(
            {type: 'word_added_to_dict', lemmas: ['figure out']},
            /** @type {*} */ ({tab: {id: 7}}),
        );
        expect(ok).toBe(true);
        expect(recorded[0].url).toBe('https://flib.club/2');
    });

    test('подделать адрес через полезную нагрузку нельзя', async () => {
        const {backend, recorded} = makeBackend(null);
        // eslint-disable-next-line no-underscore-dangle
        const ok = await backend._onApiFlibRecordEvent(
            {type: 'translation_opened', lemmas: ['https://flib.club/']},
            /** @type {*} */ ({tab: {id: 1, url: 'https://example.com/1'}}),
        );
        expect(ok).toBe(false);
        expect(recorded.length).toBe(0);
    });

    test('незнакомый вид события отбрасывается, хотя адрес свой', async () => {
        // ⚠️ `type` типизирован, но типизация — это обещание вызывающего, а
        // не проверка. Сегодня до обработчика добирается только код
        // расширения, так что это защита в глубину; но записанный в очередь
        // незнакомый вид шлюз позже прочитать не сможет, а изъять его оттуда
        // будет некому.
        const {backend, recorded} = makeBackend(null);
        // eslint-disable-next-line no-underscore-dangle
        const ok = await backend._onApiFlibRecordEvent(
            /** @type {*} */ ({type: 'bogus x', lemmas: ['give up']}),
            /** @type {*} */ ({tab: {id: 1, url: 'https://flib.club/1'}}),
        );
        expect(ok).toBe(false);
        expect(recorded.length).toBe(0);
    });

    test('нет вкладки и фолбэк пуст — не пишет', async () => {
        const {backend} = makeBackend(null);
        // eslint-disable-next-line no-underscore-dangle
        const ok = await backend._onApiFlibRecordEvent(
            {type: 'translation_opened', lemmas: ['x']},
            /** @type {*} */ ({}),
        );
        expect(ok).toBe(false);
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
