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
import {KEYFRAMES_PREFIX, collectKeyframeNames, findUnprefixedAnimations, scopeCss} from '../dev/flib-css-scope.js';

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
    test('@keyframes get the prefix; their percentages and bodies are untouched', () => {
        expect(KEYFRAMES_PREFIX).toBe('flibyt-');
        expect(scope('@keyframes slideUp { from { opacity: 0 } 50% { opacity: .5 } to { opacity: 1 } }'))
            .toBe('@keyframes flibyt-slideUp { from { opacity: 0 } 50% { opacity: .5 } to { opacity: 1 } }');
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

describe('scopeCss: @keyframes names (spec §3 item 5)', () => {
    const KF = '@keyframes cab-spin { to { transform: rotate(1turn) } } ';
    test('animation shorthand: the name in any position', () => {
        expect(scope(`${KF}.a { animation: cab-spin .8s linear infinite }`)).toContain(`${S} .a { animation: flibyt-cab-spin .8s linear infinite }`);
        expect(scope(`${KF}.a { animation: .8s linear infinite cab-spin }`)).toContain(`${S} .a { animation: .8s linear infinite flibyt-cab-spin }`);
        expect(scope(`${KF}.a { animation: .8s cubic-bezier(.4, 0, .2, 1) cab-spin forwards }`))
            .toContain(`${S} .a { animation: .8s cubic-bezier(.4, 0, .2, 1) flibyt-cab-spin forwards }`);
    });
    test('comma lists: every defined name, keywords and other names left alone', () => {
        const css = `${KF}@keyframes mtIn { from { opacity: 0 } } .a { animation: mtIn .15s ease, cab-spin 1s infinite, fade 2s }`;
        expect(scope(css)).toContain(`${S} .a { animation: flibyt-mtIn .15s ease, flibyt-cab-spin 1s infinite, fade 2s }`);
    });
    test('animation-name, and none', () => {
        expect(scope(`${KF}.a { animation-name: cab-spin, none }`)).toContain(`${S} .a { animation-name: flibyt-cab-spin, none }`);
        expect(scope(`${KF}.a { animation: none }`)).toContain(`${S} .a { animation: none }`);
    });
    test('values that only resemble a name are not renamed', () => {
        const css = `${KF}.cab-spin { animation: cab-spinner 1s; content: "cab-spin"; transition: cab-spin 1s; grid-area: cab-spin; --x: cab-spin }`;
        expect(scope(css)).toContain(`${S} .cab-spin { animation: cab-spinner 1s; content: "cab-spin"; transition: cab-spin 1s; grid-area: cab-spin; --x: cab-spin }`);
    });
    test('names defined elsewhere (option `keyframes`) are renamed; names from no stylesheet are not (keyframes the copy adds at runtime)', () => {
        const opts = {scope: '#flib-yt-root', portal: '#flib-yt-portals', fontUrl: (/** @type {string} */ u) => u, keyframes: new Set(['site-spin'])};
        expect(scopeCss('.a { animation: site-spin 1s, slideUp .25s }', opts)).toBe(`${S} .a { animation: flibyt-site-spin 1s, slideUp .25s }`);
    });
    test('vendor prefixes: @-webkit-keyframes and -webkit-animation', () => {
        const css = '@-webkit-keyframes pulse { to { opacity: 0 } } .a { -webkit-animation: pulse 1s; -webkit-animation-name: pulse }';
        expect(scope(css)).toBe(`@-webkit-keyframes flibyt-pulse { to { opacity: 0 } } ${S} .a { -webkit-animation: flibyt-pulse 1s; -webkit-animation-name: flibyt-pulse }`);
    });
    test('collectKeyframeNames reads definitions only (not comments, not references)', () => {
        expect([...collectKeyframeNames('/* @keyframes spin */ @keyframes a { } @-webkit-keyframes b { } .x { animation: c 1s }')].sort()).toEqual(['a', 'b']);
    });
    test('findUnprefixedAnimations: unprefixed references to the given names and unprefixed definitions', () => {
        const names = new Set(['cab-spin', 'mtIn']);
        expect(findUnprefixedAnimations('.a { animation: flibyt-cab-spin 1s, slideUp 1s } @keyframes flibyt-mtIn { }', names)).toEqual([]);
        expect(findUnprefixedAnimations('.a { animation: .8s cab-spin } .b { animation-name: mtIn } @keyframes mtIn { }', names))
            .toEqual(['animation: .8s cab-spin', 'animation-name: mtIn', '@keyframes mtIn']);
    });
});
