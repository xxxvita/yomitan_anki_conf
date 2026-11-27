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
import {scopeCss} from '../dev/flib-css-scope.js';

const S = ':where(#flib-yt-root, #flib-yt-portals)';
/**
 * @param {string} css
 * @returns {string}
 */
const scope = (css) => scopeCss(css, {scope: '#flib-yt-root', portal: '#flib-yt-portals', fontUrl: (u) => 'F/' + u.split('/').pop()});

describe('scopeCss', () => {
    test('universal selector also matches the container', () => {
        expect(scope('* { box-sizing: border-box }')).toBe(`${S} *, ${S} { box-sizing: border-box }`);
    });
    test('html, body, #root and :root become the container', () => {
        expect(scope('html, body, #root { height:100% }')).toBe(`${S} { height:100% }`);
        expect(scope(':root { --fg: #fff }')).toBe(`${S} { --fg: #fff }`);
    });
    test('leading html/body/:root keeps the rest of the selector', () => {
        expect(scope('body.dark .x { color: red }')).toBe(`${S}.dark .x { color: red }`);
        expect(scope(':root[data-t="a"] .y { color: red }')).toBe(`${S}[data-t="a"] .y { color: red }`);
    });
    test('ordinary selectors get the prefix', () => {
        expect(scope('a { color: red }')).toBe(`${S} a { color: red }`);
        expect(scope('.player-stage iframe { top: 0 }')).toBe(`${S} .player-stage iframe { top: 0 }`);
        expect(scope('.a, .b { top: 0 }')).toBe(`${S} .a, ${S} .b { top: 0 }`);
    });
    test('rules inside @media and @supports are prefixed', () => {
        expect(scope('@media (min-width: 600px) { .a { top: 0 } }')).toBe(`@media (min-width: 600px) { ${S} .a { top: 0 } }`);
        expect(scope('@supports (display: grid) { .a { top: 0 } }')).toBe(`@supports (display: grid) { ${S} .a { top: 0 } }`);
    });
    test('@keyframes and their percentages are untouched', () => {
        const css = '@keyframes slideUp { from { opacity: 0 } 50% { opacity: .5 } to { opacity: 1 } }';
        expect(scope(css)).toBe(css);
    });
    test('rem is recomputed from 16px', () => {
        expect(scope('.a { margin: 1.5rem 0.25rem }')).toBe(`${S} .a { margin: 24px 4px }`);
    });
    test('@font-face is not prefixed and its urls go through fontUrl', () => {
        expect(scope('@font-face { font-family: X; src: url(/fonts/X.woff2) format("woff2") }'))
            .toBe('@font-face { font-family: X; src: url(F/X.woff2) format("woff2") }');
        expect(scope("@font-face { src: url('@fontsource/lora/files/a.woff2') format('woff2') }"))
            .toBe("@font-face { src: url(F/a.woff2) format('woff2') }");
    });
    test('an already scoped selector is not prefixed twice', () => {
        const css = `${S} .a { top: 0 }`;
        expect(scope(css)).toBe(css);
    });
});
