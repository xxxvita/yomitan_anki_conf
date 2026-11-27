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
import * as acorn from 'acorn';
import fs from 'fs';
import os from 'os';
import path from 'path';
import postcss from 'postcss';
import {afterAll, beforeAll, describe, expect, test} from 'vitest';
import {buildFlibYoutube} from '../dev/build-flib-youtube.js';

const S = ':where(#flib-yt-root, #flib-yt-portals)';

/**
 * @param {string} dir
 * @returns {string[]}
 */
function listFiles(dir) {
    const out = [];
    for (const e of fs.readdirSync(dir, {withFileTypes: true, recursive: true})) {
        if (e.isFile()) { out.push(path.relative(dir, path.join(e.parentPath, e.name))); }
    }
    return out.sort();
}

describe('buildFlibYoutube', () => {
    /** @type {string} */
    let tmp;
    /** @type {string} */
    let a;
    /** @type {string} */
    let b;
    beforeAll(async () => {
        tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flib-yt-build-'));
        a = path.join(tmp, 'a');
        b = path.join(tmp, 'b');
        await buildFlibYoutube({outdir: a});
        await buildFlibYoutube({outdir: b});
    }, 120000);
    afterAll(() => { fs.rmSync(tmp, {recursive: true, force: true}); });

    test('two builds are byte-identical', () => {
        const files = listFiles(a);
        expect(files).toEqual(listFiles(b));
        for (const f of files) {
            expect(fs.readFileSync(path.join(a, f)).equals(fs.readFileSync(path.join(b, f))), f).toBe(true);
        }
    });

    test('produces the expected outputs', () => {
        const files = listFiles(a);
        for (const f of ['panel.js', 'panel.css', 'bridge.js', 'keys.js']) { expect(files).toContain(f); }
        // No fonts.css: content-script CSS resolves relative url() against youtube.com (stand, Task 11).
        expect(files).not.toContain('fonts.css');
        expect(files.some((f) => f.startsWith('fonts/') && f.endsWith('.woff2'))).toBe(true);
        expect(files.some((f) => f.startsWith('assets/'))).toBe(true);
    });

    test('panel.js has no storage identifiers, import.meta or stray iframe_api', () => {
        const js = fs.readFileSync(path.join(a, 'panel.js'), 'utf8');
        // Tokens, not text: comments and message strings may mention the names.
        const names = [...acorn.tokenizer(js, {ecmaVersion: 'latest'})]
            .filter((t) => t.type === acorn.tokTypes.name)
            .map((t) => String(/** @type {{value?: unknown}} */ (/** @type {unknown} */ (t)).value));
        expect(names).not.toContain('localStorage');
        expect(names).not.toContain('sessionStorage');
        expect(names).toContain('__flibYtLocalStorage');
        const tokens = [...acorn.tokenizer(js, {ecmaVersion: 'latest'})];
        const importMeta = tokens.some((t, i) => t.type.keyword === 'import' && tokens[i + 1]?.type === acorn.tokTypes.dot);
        expect(importMeta).toBe(false);
        expect(js.split('iframe_api').length - 1).toBe(1);
        expect(js).toContain('chrome.runtime.getURL("lib/flib-youtube/assets/');
    });

    test('panel.css is fully scoped and has no absolute font urls', () => {
        const css = fs.readFileSync(path.join(a, 'panel.css'), 'utf8');
        expect(css).not.toContain('/fonts/');
        expect(css).not.toContain('@font-face');
        /** @type {string[]} */
        const bad = [];
        postcss.parse(css).walkRules((rule) => {
            const parent = /** @type {import('postcss').AtRule} */ (rule.parent);
            if (parent.type === 'atrule' && /keyframes$/i.test(parent.name)) { return; }
            for (const sel of rule.selectors) {
                if (!sel.trim().startsWith(S)) { bad.push(sel.trim()); }
            }
        });
        expect(bad).toEqual([]);
    });

    test('panel.js carries the @font-face rules with fonts/<file> urls of files that exist', () => {
        const js = fs.readFileSync(path.join(a, 'panel.js'), 'utf8');
        expect(js).not.toContain('@@FLIB_YT_FONT_FACES@@');
        const urls = [...js.matchAll(/@font-face[^}]*?url\(([^)]+)\)/g)].map((m) => m[1]);
        expect(urls.length).toBeGreaterThan(0);
        for (const u of urls) {
            expect(u.startsWith('fonts/'), u).toBe(true);
            expect(u.endsWith('.woff2'), u).toBe(true);
            expect(fs.existsSync(path.join(a, u)), u).toBe(true);
        }
    });

    test('keys.js is the key gate alone: it starts itself, no site code or React', () => {
        const js = fs.readFileSync(path.join(a, 'keys.js'), 'utf8');
        expect(js.length).toBeLessThan(20000);
        expect(js).toContain('installKeyGate(window)');
        expect(js).not.toMatch(/react|flib-site|__flibYt(?:Fetch|LocalStorage)/i);
    });
});
