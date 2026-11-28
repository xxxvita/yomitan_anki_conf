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
import {KEYFRAMES_PREFIX} from '../dev/flib-css-scope.js';

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

    test('every @keyframes of panel.css carries the prefix, and every animation names a prefixed one or no stylesheet\'s', () => {
        const root = postcss.parse(fs.readFileSync(path.join(a, 'panel.css'), 'utf8'));
        /** @type {string[]} */
        const defined = [];
        root.walkAtRules(/keyframes$/i, (rule) => { defined.push(rule.params.trim()); });
        expect(defined.length).toBeGreaterThan(0);
        expect(defined.filter((n) => !n.startsWith(KEYFRAMES_PREFIX))).toEqual([]);
        /** @type {string[]} */
        const bad = [];
        root.walkDecls(/^(?:-[a-z]+-)?animation(?:-name)?$/i, (decl) => {
            for (const word of decl.value.replaceAll(/\([^)]*\)/g, '').split(/[\s,]+/)) {
                if (defined.includes(`${KEYFRAMES_PREFIX}${word}`)) { bad.push(`${decl.prop}: ${decl.value}`); }
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

    test('only the font files the panel references are shipped: no .woff, nothing unused (M5)', () => {
        const js = fs.readFileSync(path.join(a, 'panel.js'), 'utf8');
        const css = fs.readFileSync(path.join(a, 'panel.css'), 'utf8');
        const referenced = new Set([...`${js}\n${css}`.matchAll(/url\(\\?["']?(fonts\/[^)"'\\]+)/g)].map((m) => m[1]));
        const shipped = listFiles(a).filter((f) => f.startsWith('fonts/') && !f.endsWith('-OFL.txt'));
        expect(shipped.length).toBeGreaterThan(0);
        expect(shipped.filter((f) => !referenced.has(f)), 'shipped but never referenced').toEqual([]);
        expect(shipped.filter((f) => f.endsWith('.woff')), '.woff files').toEqual([]);
    });

    test('every font family ships with its SIL OFL text next to the fonts (I4)', () => {
        const files = listFiles(a).filter((f) => f.startsWith('fonts/'));
        const licenses = files.filter((f) => f.endsWith('-OFL.txt'));
        const fonts = files.filter((f) => !f.endsWith('-OFL.txt'));
        /**
         * @param {string} f
         * @returns {string}
         */
        const family = (f) => {
            const base = path.basename(f);
            for (const [re, name] of /** @type {Array<[RegExp, string]>} */ ([[/^inter-tight-/, 'InterTight'], [/^jetbrains-mono-/, 'JetBrainsMono'], [/^lora-/, 'Lora']])) {
                if (re.test(base)) { return name; }
            }
            return base.split('-')[0];
        };
        const families = [...new Set(fonts.map(family))].sort();
        expect(families).toEqual(['CrimsonPro', 'IBMPlexMono', 'IBMPlexSans', 'InterTight', 'JetBrainsMono', 'Lora', 'PTSerif', 'PlayfairDisplay']);
        expect(licenses.sort()).toEqual(families.map((n) => `fonts/${n}-OFL.txt`).sort());
        for (const f of licenses) {
            const text = fs.readFileSync(path.join(a, f), 'utf8');
            expect(text, f).toMatch(/^Copyright /);
            expect(text, f).toContain('SIL OPEN FONT LICENSE Version 1.1');
            expect(text, f).toContain('This Font Software is licensed under the SIL Open Font License, Version 1.1.');
        }
    });

    test('the bundled libraries keep their license comments (legalComments, I4)', () => {
        const js = fs.readFileSync(path.join(a, 'panel.js'), 'utf8');
        expect(js).toContain('@license React');
        expect(js).toMatch(/@license lucide-react/);
        expect(js).toMatch(/react-router[^\n]*\n(?:[^\n]*\n){0,6}[^\n]*@license MIT/);
    });

    test('keys.js is the key gate alone: it starts itself, no site code or React', () => {
        const js = fs.readFileSync(path.join(a, 'keys.js'), 'utf8');
        expect(js.length).toBeLessThan(20000);
        expect(js).toContain('installKeyGate(window)');
        expect(js).not.toMatch(/react|flib-site|__flibYt(?:Fetch|LocalStorage)/i);
    });
});
