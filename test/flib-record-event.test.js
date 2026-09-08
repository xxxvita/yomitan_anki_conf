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
import {Backend} from '../ext/js/background/backend.js';

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
    backend._flibEvents = {
        recordEvent: async (event) => {
            recorded.push(event);
            return true;
        },
    };
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
