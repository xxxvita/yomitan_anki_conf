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
// @vitest-environment jsdom
import {describe, expect, it} from 'vitest';
import {FONTS_STYLE_ID, fontFacesCss, installFonts} from '../fonts';

const getURL = (p: string) => `moz-extension://abc/${p}`;
const FACE = "@font-face {\n  font-family: 'Inter Tight';\n  font-weight: 400;\n  src: url(fonts/inter-tight-latin-400-normal.woff2) format('woff2');\n  unicode-range: U+0000-00FF;\n}";

describe('env/fonts', () => {
    it('rewrites url(fonts/<file>) to the extension URL of lib/flib-youtube/fonts/<file>, quoted or not', () => {
        const css = fontFacesCss([FACE, "@font-face { font-family: X; src: url('fonts/a.woff2') format('woff2'), url(\"fonts/b-1.woff2\"); }"], getURL);
        expect(css).toContain('url("moz-extension://abc/lib/flib-youtube/fonts/inter-tight-latin-400-normal.woff2") format(\'woff2\')');
        expect(css).toContain('url("moz-extension://abc/lib/flib-youtube/fonts/a.woff2")');
        expect(css).toContain('url("moz-extension://abc/lib/flib-youtube/fonts/b-1.woff2")');
        expect(css).not.toMatch(/url\((['"]?)fonts\//);
        expect(css).toContain('unicode-range: U+0000-00FF;');
    });

    it('leaves other urls alone', () => {
        expect(fontFacesCss(['@font-face { src: url(/fonts/x.woff2), url(https://e.example/f.woff2) }'], getURL)).toBe('@font-face { src: url(/fonts/x.woff2), url(https://e.example/f.woff2) }');
    });

    it('installs one <style id="flib-yt-fonts"> in <head>, replaces a stale one, and removes it', () => {
        const stale = document.createElement('style');
        stale.id = FONTS_STYLE_ID;
        document.head.append(stale);
        const remove = installFonts(document, [FACE], getURL);
        const styles = document.querySelectorAll(`#${FONTS_STYLE_ID}`);
        expect(styles).toHaveLength(1);
        expect(styles[0]).not.toBe(stale);
        expect(styles[0].parentNode).toBe(document.head);
        expect(styles[0].textContent).toContain('moz-extension://abc/lib/flib-youtube/fonts/inter-tight-latin-400-normal.woff2');
        remove();
        expect(document.getElementById(FONTS_STYLE_ID)).toBe(null);
    });

    it('adds nothing without faces', () => {
        installFonts(document, [], getURL)();
        expect(document.getElementById(FONTS_STYLE_ID)).toBe(null);
    });
});
