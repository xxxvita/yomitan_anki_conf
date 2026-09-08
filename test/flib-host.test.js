/*
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
import {isFlibHost, pickSenderUrl} from '../ext/js/data/flib-host.js';

describe('isFlibHost', () => {
    test.each([
        ['https://flib.club/book/1', true],
        ['http://flib.club/', true],
        ['https://www.flib.club/x', true],
        ['https://a.b.flib.club/x', true],
        ['https://FLIB.CLUB/x', true],
        ['https://flib.club./x', true],
        ['https://example.com/', false],
        ['https://notflib.club/', false],
        ['https://xflib.club/', false],
        ['https://flib.club.evil.com/', false],
        ['https://evil.com/?x=flib.club', false],
        ['about:blank', false],
        ['', false],
        ['не url', false],
    ])('%s -> %s', (url, expected) => {
        expect(isFlibHost(url)).toBe(expected);
    });
    test('не бросает на не-строке', () => {
    // @ts-expect-error - проверяем защиту от мусора на проводе
        expect(isFlibHost(null)).toBe(false);
    });
});

describe('pickSenderUrl', () => {
    test('берёт адрес вкладки, а не данные клиента', () => {
        expect(pickSenderUrl({tab: {url: 'https://flib.club/1'}})).toBe(
            'https://flib.club/1',
        );
    });
    test('нет вкладки — нет адреса', () => {
        expect(pickSenderUrl({})).toBe(null);
    });
    test('вкладка без url — нет адреса (Firefox без выданных host-permissions)', () => {
        expect(pickSenderUrl({tab: {}})).toBe(null);
    });
});
