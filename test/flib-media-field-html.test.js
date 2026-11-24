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

import {afterAll, describe, expect, test} from 'vitest';
import {buildHighlightedVtt} from '../ext/js/display/example-subtitle-track.js';
import {buildFlibMediaFieldHtml, bytesToBase64, isStrictImdbTitleUrl} from '../ext/js/display/gateway-examples-util.js';
import {setupDomTest} from './fixtures/dom-test.js';

const {window, teardown} = await setupDomTest();
afterAll(() => teardown(global));

const REF = 'dQw4w9WgXcQ';
const NAME = `flib-${'a'.repeat(64)}.webm`;
const NAME2 = `flib-${'b'.repeat(64)}.webm`;

/** The stored form of one YouTube item, byte for byte: saved fields are compared with it later. */
const PLAYER_ITEM = '<li><div><iframe class="flib-yt-player" src="https://www.youtube-nocookie.com/embed/lRSA2tF0mkU?start=563&amp;end=569&amp;rel=0" title="YouTube" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="encrypted-media; picture-in-picture; fullscreen" allowfullscreen="" style="width:100%;max-width:480px;aspect-ratio:16/9;height:auto;border:0"></iframe></div><a href="https://www.youtube.com/watch?v=lRSA2tF0mkU&amp;t=563s">▶ sunroofs, for <b>lack</b> of use</a></li>';

/**
 * @param {string} html
 * @returns {HTMLElement}
 */
function parse(html) {
    return new window.DOMParser().parseFromString(`<!DOCTYPE html><body>${html}</body>`, 'text/html').body;
}

/**
 * @param {string} dataUrl
 * @returns {string}
 */
function decodeVttDataUrl(dataUrl) {
    const prefix = 'data:text/vtt;base64,';
    expect(dataUrl.startsWith(prefix)).toBe(true);
    const binary = atob(dataUrl.slice(prefix.length));
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0));
    return new TextDecoder().decode(bytes);
}

describe('bytesToBase64', () => {
    test('matches btoa for small inputs, including empty', () => {
        expect(bytesToBase64(new Uint8Array([]))).toBe('');
        expect(bytesToBase64(new Uint8Array([0, 1, 2, 250, 255]))).toBe(btoa('\u0000\u0001\u0002úÿ'));
    });

    test('large input (> chunk size, not a multiple of 3) round-trips', () => {
        const bytes = new Uint8Array(200_003);
        for (let i = 0; i < bytes.length; ++i) { bytes[i] = (i * 31 + 7) & 0xff; }
        const back = Uint8Array.from(atob(bytesToBase64(bytes)), (c) => c.charCodeAt(0));
        expect(back).toStrictEqual(bytes);
    });
});

describe('isStrictImdbTitleUrl', () => {
    test.each([
        ['https://www.imdb.com/title/tt0113277/', true],
        ['https://www.imdb.com/title/tt0113277', true],
        ['https://www.imdb.com/title/tt0113277/?ref=x', false],
        ['https://www.imdb.com/title/tt0113277/"onmouseover="x', false],
        ['http://www.imdb.com/title/tt0113277/', false],
        ['https://imdb.com/title/tt0113277/', false],
        ['https://www.imdb.com/title/', false],
        ['javascript:alert(1)', false],
        [null, false],
    ])('%s → %s', (url, expected) => {
        expect(isStrictImdbTitleUrl(url)).toBe(expected);
    });
});

describe('buildFlibMediaFieldHtml', () => {
    test('nothing → empty string', () => {
        expect(buildFlibMediaFieldHtml({films: [], youtube: []})).toBe('');
    });

    test('film block has the spec shape: no autoplay, preload=metadata, clean src, default EN track', () => {
        const vttText = 'WEBVTT\n\n00:00:00.000 --> 00:00:00.900\nYou <c.hl>run</c> fast\n\n';
        const html = buildFlibMediaFieldHtml({
            films: [{fileName: NAME, vttText, title: 'Heat', year: 1995, imdbUrl: 'https://www.imdb.com/title/tt0113277/'}],
            youtube: [],
        });
        expect(html).not.toContain('autoplay');
        expect(html).not.toContain('#t=');
        const root = parse(html);
        const clip = /** @type {HTMLElement} */ (root.querySelector('div.flib-clip'));
        const video = /** @type {HTMLVideoElement} */ (clip.querySelector('video'));
        expect(video.hasAttribute('controls')).toBe(true);
        expect(video.getAttribute('preload')).toBe('metadata');
        expect(video.getAttribute('src')).toBe(NAME);
        const track = /** @type {HTMLTrackElement} */ (video.querySelector('track'));
        expect(track.getAttribute('kind')).toBe('subtitles');
        expect(track.getAttribute('srclang')).toBe('en');
        expect(track.getAttribute('label')).toBe('EN');
        expect(track.hasAttribute('default')).toBe(true);
        expect(decodeVttDataUrl(/** @type {string} */ (track.getAttribute('src')))).toBe(vttText);
        const src = /** @type {HTMLElement} */ (clip.querySelector('.flib-clip-src'));
        const link = /** @type {HTMLAnchorElement} */ (src.querySelector('a'));
        expect(link.getAttribute('href')).toBe('https://www.imdb.com/title/tt0113277/');
        expect(link.textContent).toBe('Heat');
        expect(src.textContent).toBe('Heat (1995)');
        expect(root.querySelector('ul.flib-yt')).toBeNull();
    });

    test('VTT base64 goes through UTF-8 (non-Latin-1 text survives)', () => {
        const vttText = buildHighlightedVtt([{start: 0, end: 1, text: 'Ça va — ёлка 日本'}], []);
        const html = buildFlibMediaFieldHtml({films: [{fileName: NAME, vttText, title: null, year: null, imdbUrl: null}], youtube: []});
        const track = /** @type {HTMLTrackElement} */ (parse(html).querySelector('track'));
        expect(decodeVttDataUrl(/** @type {string} */ (track.getAttribute('src')))).toContain('Ça va — ёлка 日本');
    });

    test('hostile subtitle text stays escaped inside the VTT (built by buildHighlightedVtt)', () => {
        const vttText = buildHighlightedVtt([{start: 0, end: 1, text: 'a --> b <script>x</script> run'}], ['run']);
        const html = buildFlibMediaFieldHtml({films: [{fileName: NAME, vttText, title: null, year: null, imdbUrl: null}], youtube: []});
        expect(html).not.toContain('<script');
        const track = /** @type {HTMLTrackElement} */ (parse(html).querySelector('track'));
        const decoded = decodeVttDataUrl(/** @type {string} */ (track.getAttribute('src')));
        expect(decoded).toContain('a --&gt; b &lt;script&gt;x&lt;/script&gt; <c.hl>run</c>');
        // Exactly one timing arrow per cue: the hostile one is escaped.
        expect(decoded.match(/-->/g)).toHaveLength(1);
    });

    test('an empty VTT (no cues) → no <track>', () => {
        for (const vttText of ['', 'WEBVTT\n\n', null]) {
            const html = buildFlibMediaFieldHtml({films: [{fileName: NAME, vttText, title: 'X', year: null, imdbUrl: null}], youtube: []});
            const root = parse(html);
            expect(root.querySelector('video')).not.toBeNull();
            expect(root.querySelector('track')).toBeNull();
        }
    });

    test('hostile titles are escaped; an invalid IMDb URL drops the link but keeps the text', () => {
        const title = 'A <b>"bad"</b> & \'odd\' title';
        const html = buildFlibMediaFieldHtml({
            films: [{fileName: NAME, vttText: '', title, year: 2001, imdbUrl: 'https://evil.example/title/tt1" onclick="x'}],
            youtube: [],
        });
        expect(html).not.toContain('<b>"bad"');
        expect(html).not.toContain('evil.example');
        expect(html).not.toContain('onclick');
        const src = /** @type {HTMLElement} */ (parse(html).querySelector('.flib-clip-src'));
        expect(src.querySelector('a')).toBeNull();
        expect(src.textContent).toBe(`${title} (2001)`);
    });

    test('M8: a hostile title with a VALID IMDb URL is escaped inside the <a>', () => {
        const title = '<img src=x onerror=alert(1)> & "q"';
        const html = buildFlibMediaFieldHtml({
            films: [{fileName: NAME, vttText: '', title, year: null, imdbUrl: 'https://www.imdb.com/title/tt0113277/'}],
            youtube: [],
        });
        expect(html).not.toContain('<img');
        expect(html).toContain('&lt;img src=x onerror=alert(1)&gt; &amp; &quot;q&quot;</a>');
        const link = /** @type {HTMLAnchorElement} */ (parse(html).querySelector('.flib-clip-src a'));
        expect(link.textContent).toBe(title);
        expect(link.children).toHaveLength(0);
    });

    test('no title: an IMDb link is labelled «IMDb»; no title and no link → no caption', () => {
        const withLink = parse(buildFlibMediaFieldHtml({films: [{fileName: NAME, vttText: '', title: '', year: null, imdbUrl: 'https://www.imdb.com/title/tt1/'}], youtube: []}));
        expect(withLink.querySelector('.flib-clip-src a')?.textContent).toBe('IMDb');
        const bare = parse(buildFlibMediaFieldHtml({films: [{fileName: NAME, vttText: '', title: null, year: 1999, imdbUrl: null}], youtube: []}));
        expect(bare.querySelector('.flib-clip-src')?.textContent).toBe('(1999)');
        const none = parse(buildFlibMediaFieldHtml({films: [{fileName: NAME, vttText: '', title: null, year: null, imdbUrl: null}], youtube: []}));
        expect(none.querySelector('.flib-clip-src')).toBeNull();
    });

    test('a film whose file name is not a flib name is dropped (never injected into src)', () => {
        const html = buildFlibMediaFieldHtml({
            films: [
                {fileName: 'x.webm" onerror="alert(1)', vttText: '', title: 'A', year: null, imdbUrl: null},
                {fileName: NAME2, vttText: '', title: 'B', year: null, imdbUrl: null},
            ],
            youtube: [],
        });
        expect(html).not.toContain('onerror');
        const videos = parse(html).querySelectorAll('video');
        expect(videos).toHaveLength(1);
        expect(videos[0].getAttribute('src')).toBe(NAME2);
    });

    test('YouTube: watch link with &t=floor(s), &amp; in the raw href, highlighted word in <b>, text escaped', () => {
        const html = buildFlibMediaFieldHtml({
            films: [],
            youtube: [{ref: REF, startMs: 12_999, endMs: null, text: 'I <3 to run & "jump"', words: ['run']}],
        });
        expect(html).toContain(`href="https://www.youtube.com/watch?v=${REF}&amp;t=12s"`);
        const root = parse(html);
        const link = /** @type {HTMLAnchorElement} */ (root.querySelector('ul.flib-yt > li > a'));
        expect(link.getAttribute('href')).toBe(`https://www.youtube.com/watch?v=${REF}&t=12s`);
        expect(link.textContent).toBe('▶ I <3 to run & "jump"');
        expect(link.querySelector('b')?.textContent).toBe('run');
        expect(link.querySelectorAll('b')).toHaveLength(1);
    });

    test('M10: a hostile HIGHLIGHTED form is escaped inside the <b>', () => {
        const form = '<img src=x onerror=alert(1)>';
        const html = buildFlibMediaFieldHtml({films: [], youtube: [{ref: REF, startMs: 0, endMs: null, text: `say ${form} now`, words: [form]}]});
        expect(html).not.toContain('<img');
        expect(html).toContain('<b>&lt;img src=x onerror=alert(1)&gt;</b>');
        const bold = /** @type {HTMLElement} */ (parse(html).querySelector('ul.flib-yt b'));
        expect(bold.textContent).toBe(form);
        expect(bold.children).toHaveLength(0);
    });

    test('YouTube: invalid ref drops the item; missing start → t=0s; missing text → link still there', () => {
        const html = buildFlibMediaFieldHtml({
            films: [],
            youtube: [
                {ref: 'bad"ref', startMs: 1000, endMs: null, text: 'x', words: []},
                {ref: 'short', startMs: 1000, endMs: null, text: 'x', words: []},
                {ref: REF, startMs: null, endMs: null, text: null, words: []},
            ],
        });
        const items = parse(html).querySelectorAll('ul.flib-yt > li');
        expect(items).toHaveLength(1);
        expect(items[0].querySelector('a')?.getAttribute('href')).toBe(`https://www.youtube.com/watch?v=${REF}&t=0s`);
        expect(html).not.toContain('bad');
    });

    test('YouTube: the saved markup is exactly the player and the link under it, on one line', () => {
        const html = buildFlibMediaFieldHtml({
            films: [],
            youtube: [{ref: 'lRSA2tF0mkU', startMs: 563_200, endMs: 566_100, text: 'sunroofs, for lack of use', words: ['lack']}],
        });
        expect(html).toBe(`<ul class="flib-yt">${PLAYER_ITEM}</ul>`);
    });

    test('YouTube: no reliable end → the player has no end', () => {
        for (const endMs of [null, Number.NaN, 12_000, 11_000]) {
            const html = buildFlibMediaFieldHtml({films: [], youtube: [{ref: REF, startMs: 12_000, endMs, text: 'x', words: []}]});
            expect(html).toContain(`src="https://www.youtube-nocookie.com/embed/${REF}?start=12&amp;rel=0"`);
        }
    });

    test('YouTube: blank text (null, spaces) → the link says «YouTube», never highlighted', () => {
        for (const text of [null, '', ' \n\u00a0']) {
            const html = buildFlibMediaFieldHtml({films: [], youtube: [{ref: REF, startMs: 0, endMs: null, text, words: ['youtube']}]});
            expect(html).toContain('&amp;t=0s">▶ YouTube</a></li>');
        }
    });

    test('YouTube: hostile text stays escaped next to the player', () => {
        const text = '<img onerror>';
        const html = buildFlibMediaFieldHtml({films: [], youtube: [{ref: REF, startMs: 0, endMs: null, text, words: []}]});
        expect(html).not.toContain('<img');
        expect(html).toContain('▶ &lt;img onerror&gt;</a></li>');
        const root = parse(html);
        expect(root.querySelector('img')).toBeNull();
        expect(root.querySelector('a')?.textContent).toBe(`▶ ${text}`);
    });

    describe('YouTube: lines of one video starting in the same second are one <li>', () => {
        /**
         * @param {[startMs: ?number, endMs: ?number, text: ?string, words?: string[]][]} lines
         * @returns {[src: string, text: string, html: string][]}
         */
        const items = (lines) => {
            const html = buildFlibMediaFieldHtml({films: [], youtube: lines.map(([startMs, endMs, text, words = []]) => ({ref: REF, startMs, endMs, text, words}))});
            return [...parse(html).querySelectorAll('ul.flib-yt > li')].map((li) => {
                expect(li.querySelectorAll('iframe')).toHaveLength(1);
                expect(li.querySelectorAll('a')).toHaveLength(1);
                const src = li.querySelector('iframe')?.getAttribute('src') ?? '';
                return [src.slice(src.indexOf('?')), li.querySelector('a')?.textContent ?? '', li.querySelector('a')?.innerHTML ?? ''];
            });
        };

        test('1.0–1.4 s and 1.9–9 s: one player with the longest end, both texts in the one link, in order', () => {
            expect(items([[1000, 1400, 'Run!'], [1900, 9000, 'I run every day']])).toStrictEqual([['?start=1&end=11&rel=0', '▶ Run! … I run every day', '▶ Run! … I run every day']]);
            expect(items([[1900, 9000, 'I run every day'], [1000, 1400, 'Run!']])).toStrictEqual([['?start=1&end=11&rel=0', '▶ I run every day … Run!', '▶ I run every day … Run!']]);
        });

        test('three lines; another second and another video stay apart', () => {
            expect(items([[1000, 1400, 'a'], [1500, 4000, 'b'], [2000, 3000, 'd'], [1900, 3000, 'c']]).map((i) => i.slice(0, 2))).toStrictEqual([
                ['?start=1&end=6&rel=0', '▶ a … b … c'],
                ['?start=2&end=5&rel=0', '▶ d'],
            ]);
            const youtube = [
                {ref: REF, startMs: 1000, endMs: 2000, text: 'a', words: []},
                {ref: 'abcdefghijk', startMs: 1000, endMs: 2000, text: 'a', words: []},
            ];
            const html = buildFlibMediaFieldHtml({films: [], youtube});
            expect(parse(html).querySelectorAll('li')).toHaveLength(2);
        });

        test.each(/** @type {(?number)[]} */ ([null, Number.NaN, 1000, 1e300]))('a line without a usable end (%s) wins: the player plays on', (endMs) => {
            for (const lines of /** @type {[?number, ?number, string][][]} */ ([
                [[1000, endMs, 'a'], [1500, 9000, 'b']],
                [[1500, 9000, 'b'], [1000, endMs, 'a']],
            ])) {
                expect(items(lines).map((i) => i[0])).toStrictEqual(['?start=1&rel=0']);
            }
        });

        test('equal texts (after trim, whatever the highlighted words) once; blank ones never', () => {
            expect(items([[1000, 2000, 'I run', ['run']], [1500, 3000, ' I run\n', []], [1600, 3000, ' \u00a0'], [1700, 3000, null]])).toStrictEqual([
                ['?start=1&end=5&rel=0', '▶ I run', '▶ I <b>run</b>'],
            ]);
            expect(items([[1000, 2000, null], [1500, 3000, ' ']]).map((i) => i[1])).toStrictEqual(['▶ YouTube']);
            expect(items([[1000, 2000, ''], [1500, 3000, 'b']]).map((i) => i[1])).toStrictEqual(['▶ b']);
            // Not «equal»: the case differs.
            expect(items([[1000, 2000, 'a'], [1500, 3000, 'A']]).map((i) => i[1])).toStrictEqual(['▶ a … A']);
        });

        test('every text keeps its own highlighted words and is escaped', () => {
            expect(items([[1000, 2000, 'I run & jump', ['run']], [1500, 3000, '<img> run jump', ['jump']]]).map((i) => i[2])).toStrictEqual([
                '▶ I <b>run</b> &amp; jump … &lt;img&gt; run <b>jump</b>',
            ]);
        });

        test('a text is cut to 2000 code points, never inside a surrogate pair; each line on its own', () => {
            expect(items([[1000, 2000, 'a'.repeat(1_000_000)]]).map((i) => i[1])).toStrictEqual([`▶ ${'a'.repeat(2000)}`]);
            expect(items([[1000, 2000, `a${'😀'.repeat(500_000)}`]]).map((i) => i[1])).toStrictEqual([`▶ a${'😀'.repeat(1999)}`]);
            expect(items([[1000, 2000, 'a'.repeat(2000)], [1500, 2000, 'b'.repeat(3000)]]).map((i) => i[1])).toStrictEqual([`▶ ${'a'.repeat(2000)} … ${'b'.repeat(2000)}`]);
            // Equal after the cut — once.
            expect(items([[1000, 2000, `${'a'.repeat(2000)}b`], [1500, 2000, `${'a'.repeat(2000)}c`]]).map((i) => i[1])).toStrictEqual([`▶ ${'a'.repeat(2000)}`]);
        });

        test('10^6 characters of highlighted words: the field stays small', () => {
            const html = buildFlibMediaFieldHtml({films: [], youtube: [{ref: REF, startMs: 0, endMs: null, text: 'run '.repeat(250_000), words: ['run']}]});
            expect(html.length).toBeLessThan(10_000);
        });

        test('a bad ref is dropped and joins nothing', () => {
            const youtube = [
                {ref: 'bad', startMs: 1000, endMs: 2000, text: 'x', words: []},
                {ref: 'bad', startMs: 1000, endMs: 2000, text: 'y', words: []},
                {ref: REF, startMs: 1000, endMs: 2000, text: 'z', words: []},
            ];
            const html = buildFlibMediaFieldHtml({films: [], youtube});
            expect([...parse(html).querySelectorAll('a')].map((a) => a.textContent)).toStrictEqual(['▶ z']);
        });
    });

    test('YouTube: parsing and serializing gives back the emitted bytes (the merge re-emits parsed items)', () => {
        const plain = buildFlibMediaFieldHtml({films: [], youtube: [{ref: REF, startMs: 1000, endMs: 4000, text: 'to run & <jump> — ёлка', words: ['run']}]});
        expect(`<ul class="flib-yt">${parse(plain).querySelector('ul.flib-yt > li')?.outerHTML}</ul>`).toBe(plain);
        // With quotes only the player is byte-stable: escapeHtml emits &quot; and &#39;, a serializer does not.
        const quoted = buildFlibMediaFieldHtml({films: [], youtube: [{ref: REF, startMs: 1000, endMs: 4000, text: 'I\'m "fine"', words: []}]});
        const iframe = parse(quoted).querySelector('iframe')?.outerHTML;
        expect(iframe).toMatch(/^<iframe class="flib-yt-player" /);
        expect(quoted).toContain(`<div>${iframe}</div>`);
    });

    test('only invalid YouTube refs → empty string (no empty list)', () => {
        expect(buildFlibMediaFieldHtml({films: [], youtube: [{ref: 'nope', startMs: 0, endMs: null, text: 'x', words: []}]})).toBe('');
    });

    test('several films then one YouTube list, in the given order', () => {
        const html = buildFlibMediaFieldHtml({
            films: [
                {fileName: NAME, vttText: '', title: 'One', year: null, imdbUrl: null},
                {fileName: NAME2, vttText: '', title: 'Two', year: null, imdbUrl: null},
            ],
            youtube: [
                {ref: REF, startMs: 1000, endMs: null, text: 'first', words: []},
                {ref: 'abcdefghijk', startMs: 2000, endMs: null, text: 'second', words: []},
            ],
        });
        const root = parse(html);
        const children = [...root.children];
        expect(children.map((c) => c.className)).toStrictEqual(['flib-clip', 'flib-clip', 'flib-yt']);
        expect([...root.querySelectorAll('video')].map((v) => v.getAttribute('src'))).toStrictEqual([NAME, NAME2]);
        expect([...root.querySelectorAll('ul.flib-yt a')].map((a) => a.textContent)).toStrictEqual(['▶ first', '▶ second']);
    });
});
