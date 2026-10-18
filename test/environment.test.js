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

import {describe, expect, test} from 'vitest';
import {detectBrowser, isFirefoxUserAgent} from '../ext/js/extension/environment.js';

const UA = {
    chrome: 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36',
    edge: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0',
    firefox: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0',
    firefoxAndroid: 'Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0',
    safari: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15',
};

/**
 * @param {Partial<import('../ext/js/extension/environment.js').BrowserSignals>} overrides
 * @returns {import('../ext/js/extension/environment.js').BrowserSignals}
 */
function signals(overrides) {
    return {extensionUrl: 'chrome-extension://abc/', userAgent: UA.chrome, vendor: 'Google Inc.', hasBrowserGlobal: false, os: 'linux', ...overrides};
}

describe('detectBrowser', () => {
    test('Chromium that exposes a `browser` global is still chrome (Chromium 148)', () => {
        expect(detectBrowser(signals({hasBrowserGlobal: true}))).toBe('chrome');
    });
    test('plain chrome', () => {
        expect(detectBrowser(signals({}))).toBe('chrome');
    });
    test('edge', () => {
        expect(detectBrowser(signals({userAgent: UA.edge, hasBrowserGlobal: true}))).toBe('edge');
    });
    test('edge legacy by its extension URL', () => {
        expect(detectBrowser(signals({extensionUrl: 'ms-browser-extension://abc/', userAgent: UA.edge}))).toBe('edge-legacy');
    });
    test('firefox by moz-extension URL', () => {
        expect(detectBrowser(signals({extensionUrl: 'moz-extension://abc/', userAgent: UA.firefox, vendor: '', hasBrowserGlobal: true}))).toBe('firefox');
    });
    test('firefox with a spoofed Chrome user agent is still firefox (moz-extension URL)', () => {
        expect(detectBrowser(signals({extensionUrl: 'moz-extension://abc/', userAgent: UA.chrome, vendor: '', hasBrowserGlobal: true}))).toBe('firefox');
    });
    test('firefox by user agent when the extension URL is unavailable', () => {
        expect(detectBrowser(signals({extensionUrl: '', userAgent: UA.firefox, vendor: '', hasBrowserGlobal: true}))).toBe('firefox');
    });
    test('firefox for android', () => {
        expect(detectBrowser(signals({extensionUrl: 'moz-extension://abc/', userAgent: UA.firefoxAndroid, vendor: '', hasBrowserGlobal: true, os: 'android'}))).toBe('firefox-mobile');
    });
    test('safari', () => {
        expect(detectBrowser(signals({extensionUrl: 'safari-web-extension://abc/', userAgent: UA.safari, vendor: 'Apple Computer, Inc.', hasBrowserGlobal: true, os: 'mac'}))).toBe('safari');
    });
});

describe('isFirefoxUserAgent', () => {
    test.each([
        [UA.firefox, true],
        [UA.firefoxAndroid, true],
        [UA.chrome, false],
        [UA.edge, false],
        ['', false],
    ])('%s → %s', (ua, expected) => {
        expect(isFirefoxUserAgent(ua)).toBe(expected);
    });
});
