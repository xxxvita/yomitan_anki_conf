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


import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {describe, expect, test} from 'vitest';
import {ManifestUtil} from '../dev/manifest-util.js';
import {isFrameInsideExtensionPage} from '../ext/js/app/content-script-frame-guard.js';
import {parseJson} from '../ext/js/core/json.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const EXT = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop/';

/**
 * @param {string[]} origins
 * @returns {{length: number, [index: number]: string}}
 */
function ancestorOriginsOf(origins) {
    // DOMStringList: индексы + length, без методов массива.
    return {...Object.fromEntries(origins.map((o, i) => [i, o])), length: origins.length};
}

describe('isFrameInsideExtensionPage', () => {
    test('YouTube embed inside our popup.html on a web page → skip', () => {
        expect(isFrameInsideExtensionPage(ancestorOriginsOf(['chrome-extension://abcdefghijklmnopabcdefghijklmnop', 'https://news.example']), EXT)).toBe(true);
    });

    test('embed directly inside search.html → skip', () => {
        expect(isFrameInsideExtensionPage(ancestorOriginsOf(['chrome-extension://abcdefghijklmnopabcdefghijklmnop']), EXT)).toBe(true);
    });

    test('Firefox origin form (moz-extension UUID)', () => {
        const base = 'moz-extension://1b2c3d4e-0000-4000-8000-123456789abc/';
        expect(isFrameInsideExtensionPage(ancestorOriginsOf(['moz-extension://1b2c3d4e-0000-4000-8000-123456789abc']), base)).toBe(true);
    });

    test('top-level web page and ordinary nested frames still run', () => {
        expect(isFrameInsideExtensionPage(ancestorOriginsOf([]), EXT)).toBe(false);
        expect(isFrameInsideExtensionPage(ancestorOriginsOf(['https://www.youtube.com', 'https://news.example']), EXT)).toBe(false);
    });

    test('engine where URL.origin of the base is not "null" (Chrome path)', () => {
        // В Node origin у chrome-extension: — 'null' (ветка фолбэка); здесь
        // проверяется основная ветка на базе с настоящим origin.
        expect(isFrameInsideExtensionPage(ancestorOriginsOf(['https://ext.example']), 'https://ext.example/')).toBe(true);
        expect(isFrameInsideExtensionPage(ancestorOriginsOf(['https://other.example']), 'https://ext.example/')).toBe(false);
    });

    test('another extension\'s page is not ours', () => {
        expect(isFrameInsideExtensionPage(ancestorOriginsOf(['chrome-extension://zzzzzzzzzzzzzzzzzzzzzzzzzzzzzzzz']), EXT)).toBe(false);
    });

    test('our origin is not the first ancestor (nested deeper) → skip', () => {
        const ours = 'chrome-extension://abcdefghijklmnopabcdefghijklmnop';
        expect(isFrameInsideExtensionPage(ancestorOriginsOf(['https://www.youtube-nocookie.com', ours, 'https://site.example']), EXT)).toBe(true);
    });

    test('near-miss origin sharing a long prefix (last char differs) is not ours', () => {
        expect(isFrameInsideExtensionPage(ancestorOriginsOf(['chrome-extension://abcdefghijklmnopabcdefghijklmnoq']), EXT)).toBe(false);
        expect(isFrameInsideExtensionPage(ancestorOriginsOf(['chrome-extension://abcdefghijklmnopabcdefghijklmnopx']), EXT)).toBe(false);
    });

    test('no ancestorOrigins (Firefox) or unusable base URL → do not skip (manifest exclude_matches covers it)', () => {
        expect(isFrameInsideExtensionPage(void 0, EXT)).toBe(false);
        expect(isFrameInsideExtensionPage(null, EXT)).toBe(false);
        expect(isFrameInsideExtensionPage(ancestorOriginsOf(['chrome-extension://abcdefghijklmnopabcdefghijklmnop']), '')).toBe(false);
        expect(isFrameInsideExtensionPage(ancestorOriginsOf(['null']), 'not a url')).toBe(false);
    });
});

describe('wiring', () => {
    test('content-script-main.js runs Application.main only inside the guard', () => {
        const code = fs.readFileSync(path.join(root, 'ext', 'js', 'app', 'content-script-main.js'), {encoding: 'utf8'});
        expect(code).toMatch(/\nif \(!isFrameInsideExtensionPage\(globalThis\.location\?\.ancestorOrigins, chrome\.runtime\.getURL\('\/'\)\)\) \{\n {4}await Application\.main\(/);
        expect(code.split('Application.main(').length - 1).toBe(1);
        expect(code.trimEnd().endsWith('}')).toBe(true);
    });

    test('exclude_matches for the nocookie embed only in Firefox variants (no ancestorOrigins there)', () => {
        const util = new ManifestUtil();
        /**
         * @param {string} name
         * @returns {{matches: string[], exclude_matches?: string[]}[]}
         */
        const scriptsOf = (name) => {
            /** @type {{content_scripts?: {matches: string[], exclude_matches?: string[]}[]}} */
            const manifest = parseJson(JSON.stringify(util.getManifest(name)));
            return manifest.content_scripts ?? [];
        };
        const names = util.getVariants().map((v) => v.name);
        const firefox = ['firefox', 'firefox-dev', 'firefox-android'];
        // Chromium-сборки сканируют чужие nocookie-встраивания — их покрывает JS-проверка.
        const chromium = ['chrome', 'chrome-dev', 'chrome-playwright', 'edge'];
        for (const name of [...firefox, ...chromium]) { expect(names).toContain(name); }
        for (const name of firefox) {
            for (const entry of scriptsOf(name)) {
                expect(entry.exclude_matches).toStrictEqual(['*://www.youtube-nocookie.com/embed/*']);
                expect(entry.matches).toContain('https://*/*');
            }
        }
        for (const name of chromium) {
            const entries = scriptsOf(name);
            expect(entries.length).toBeGreaterThan(0);
            for (const entry of entries) { expect(entry.exclude_matches).toBeUndefined(); }
        }
    });
});
