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
// The copy's @font-face rules on youtube.com. A stylesheet injected as a content script resolves a
// relative url() against the page (youtube.com/fonts/… -> 404), so the build no longer ships a
// fonts.css: it puts the rules into panel.js (FLIB_YT_FONT_FACES, `url(fonts/<file>)` as written by
// dev/build-flib-youtube.js) and the layer rewrites each url to chrome.runtime.getURL of the file
// (chrome-extension:// or moz-extension://, web-accessible for https://www.youtube.com/*) and adds
// one <style> to the page on the first show. The faces only name the copy's own families.

declare const __FLIB_YT_FONT_FACES__: readonly string[] | undefined;

export const FONTS_STYLE_ID = 'flib-yt-fonts';

/** The rules the build embedded (empty under vitest, where nothing defines them). */
export const FONT_FACES: readonly string[] = typeof __FLIB_YT_FONT_FACES__ !== 'undefined' ? __FLIB_YT_FONT_FACES__ : [];

const RELATIVE_URL = /url\(\s*(['"]?)(fonts\/[\w.-]+)\1\s*\)/g;

/** `url(fonts/x.woff2)` -> `url("<getURL('lib/flib-youtube/fonts/x.woff2')>")`; other urls stay. */
export function fontFacesCss(faces: readonly string[], getURL: (path: string) => string): string {
    return faces.map((face) => face.replace(RELATIVE_URL, (_m, _q, file: string) => `url(${JSON.stringify(getURL(`lib/flib-youtube/${file}`))})`)).join('\n');
}

/**
 * Adds the font rules to `doc` once (an existing #flib-yt-fonts, e.g. from a dead instance of the
 * layer, is replaced). Returns the removal.
 */
export function installFonts(doc: Document, faces: readonly string[], getURL: (path: string) => string): () => void {
    doc.getElementById(FONTS_STYLE_ID)?.remove();
    if (faces.length === 0) { return () => { /* nothing added */ }; }
    const style = doc.createElement('style');
    style.id = FONTS_STYLE_ID;
    style.textContent = fontFacesCss(faces, getURL);
    (doc.head ?? doc.documentElement).append(style);
    return () => { style.remove(); };
}
