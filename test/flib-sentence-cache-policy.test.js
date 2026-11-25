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
import {mayUseSentenceCache} from '../ext/js/background/flib-sentence-cache-policy.js';

const POPUP = 'chrome-extension://abcdefghijklmnop/popup.html';

describe('mayUseSentenceCache', () => {
    test.each([
        ['https page', {tab: {id: 1, url: 'https://example.com/a'}, url: POPUP}],
        ['http page', {tab: {id: 1, url: 'http://example.com/'}, url: POPUP}],
        ['file page', {tab: {id: 1, url: 'file:///tmp/a.html'}, url: POPUP}],
        ['unknown tab url, popup.html', {tab: {id: 1}, url: POPUP}],
        ['unknown tab url, popup.html with query', {tab: {id: 1}, url: `${POPUP}?depth=1#x`}],
        ['firefox popup.html', {tab: {id: 1}, url: 'moz-extension://uuid/popup.html'}],
    ])('allowed: %s', (_name, sender) => {
        expect(mayUseSentenceCache(true, /** @type {*} */ (sender))).toBe(true);
    });

    test.each([
        ['no tab', {url: POPUP}],
        ['incognito', {tab: {id: 1, incognito: true, url: 'https://example.com/'}, url: POPUP}],
        ['extension page tab', {tab: {id: 1, url: 'chrome-extension://abcdefghijklmnop/search.html'}, url: POPUP}],
        ['about:blank tab', {tab: {id: 1, url: 'about:blank'}, url: POPUP}],
        ['unknown tab url, search.html', {tab: {id: 1}, url: 'chrome-extension://abcdefghijklmnop/search.html'}],
        ['unknown tab url, no sender url', {tab: {id: 1}}],
        ['unknown tab url, web page sender', {tab: {id: 1}, url: 'https://evil.example/popup.html'}],
        ['unparsable sender url', {tab: {id: 1}, url: 'popup.html'}],
    ])('refused: %s', (_name, sender) => {
        expect(mayUseSentenceCache(true, /** @type {*} */ (sender))).toBe(false);
    });

    test.each([false, null, 'true', 1])('useCache %j is refused', (useCache) => {
        expect(mayUseSentenceCache(/** @type {*} */ (useCache), /** @type {*} */ ({tab: {id: 1, url: 'https://example.com/'}, url: POPUP}))).toBe(false);
    });

    test('undefined sender', () => {
        expect(mayUseSentenceCache(true, void 0)).toBe(false);
    });
});
