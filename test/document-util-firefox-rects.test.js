/*
 * Copyright (C) 2025  Yomitan Authors
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

import {afterEach, describe, expect, test, vi} from 'vitest';
import {isPointInAnyRect} from '../ext/js/dom/document-util.js';

const CHROME_UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';
const FIREFOX_UA = 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0';
const RECT = /** @type {DOMRect} */ (/** @type {unknown} */ ({left: 0, right: 10, top: 0, bottom: 10}));

afterEach(() => { vi.unstubAllGlobals(); });

describe('isPointInAnyRect Firefox workaround (Thai)', () => {
    test('Chromium with a `browser` global still checks the rects', () => {
        vi.stubGlobal('browser', {});
        vi.stubGlobal('navigator', {userAgent: CHROME_UA});
        vi.stubGlobal('chrome', {runtime: {getURL: () => 'chrome-extension://abc/'}});
        expect(isPointInAnyRect(50, 50, [RECT], 'th')).toBe(false);
        expect(isPointInAnyRect(5, 5, [RECT], 'th')).toBe(true);
    });
    test('Firefox skips the rect check for Thai', () => {
        vi.stubGlobal('browser', {});
        vi.stubGlobal('navigator', {userAgent: FIREFOX_UA});
        vi.stubGlobal('chrome', {runtime: {getURL: () => 'moz-extension://abc/'}});
        expect(isPointInAnyRect(50, 50, [RECT], 'th')).toBe(true);
    });
    test('Firefox with a spoofed user agent is still recognised by its extension URL', () => {
        vi.stubGlobal('navigator', {userAgent: CHROME_UA});
        vi.stubGlobal('chrome', {runtime: {getURL: () => 'moz-extension://abc/'}});
        expect(isPointInAnyRect(50, 50, [RECT], 'th')).toBe(true);
    });
    test('Firefox still checks the rects for other languages', () => {
        vi.stubGlobal('navigator', {userAgent: FIREFOX_UA});
        vi.stubGlobal('chrome', {runtime: {getURL: () => 'moz-extension://abc/'}});
        expect(isPointInAnyRect(50, 50, [RECT], 'ja')).toBe(false);
    });
});
