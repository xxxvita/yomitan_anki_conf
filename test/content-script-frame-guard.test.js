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

    test('every content_scripts entry excludes the youtube-nocookie embed path, and only it', () => {
        /** @type {{manifest: {content_scripts: {matches: string[], exclude_matches?: string[]}[]}, variants: {modifications?: {path?: unknown[]}[]}[]}} */
        const data = parseJson(fs.readFileSync(path.join(root, 'dev', 'data', 'manifest-variants.json'), {encoding: 'utf8'}));
        expect(data.manifest.content_scripts.length).toBeGreaterThan(0);
        for (const entry of data.manifest.content_scripts) {
            expect(entry.exclude_matches).toStrictEqual(['*://www.youtube-nocookie.com/embed/*']);
        }
        // Ни один вариант не переопределяет content_scripts целиком или exclude_matches.
        for (const variant of data.variants) {
            for (const m of variant.modifications ?? []) {
                const p = Array.isArray(m.path) ? m.path : [];
                if (p[0] !== 'content_scripts') { continue; }
                expect(p.length).toBeGreaterThan(2);
                expect(p).not.toContain('exclude_matches');
            }
        }
    });
});
