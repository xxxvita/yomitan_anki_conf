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

import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {setupDomTest} from './fixtures/dom-test.js';
import {ExtensionError} from '../ext/js/core/extension-error.js';
import {
    mergeFlibMediaFieldHtml,
    YOUTUBE_SECTION_MAX_ITEMS,
    base64ToBlob,
    buildYouTubeEmbedUrl,
    buildYouTubeThumbUrl,
    buildYouTubeWatchUrl,
    computeClipWindow,
    describeEmptyReason,
    describeGatewayError,
    formatSourceTitle,
    formatTimeRange,
    getGatewayErrorCode,
    isSafeImdbUrl,
    isValidYouTubeRef,
    sanitizeYouTubeItems,
    subsToCues,
} from '../ext/js/display/gateway-examples-util.js';

const REF = 'dQw4w9WgXcQ';

/**
 * @param {Partial<import('flib-gateway').ExampleItem>} over
 * @returns {import('flib-gateway').ExampleItem}
 */
function item(over = {}) {
    return {source: 'youtube', ref: REF, start_ms: 61500, end_ms: 64200, text_en: 'I run fast', text_ru: null, thumbnail_url: null, ...over};
}

describe('YouTube refs and URLs', () => {
    test('ref must be exactly 11 url-safe characters', () => {
        expect(isValidYouTubeRef(REF)).toBe(true);
        expect(isValidYouTubeRef('a_b-c1234567'.slice(0, 11))).toBe(true);
        expect(isValidYouTubeRef('short')).toBe(false);
        expect(isValidYouTubeRef(`${REF}x`)).toBe(false);
        expect(isValidYouTubeRef('abc/def?g=h')).toBe(false);
        expect(isValidYouTubeRef('"><script>x')).toBe(false);
        expect(isValidYouTubeRef(null)).toBe(false);
    });

    test('embed URL floors start and ceils end, no-cookie host', () => {
        expect(buildYouTubeEmbedUrl(REF, 61500, 64200)).toBe(`https://www.youtube-nocookie.com/embed/${REF}?start=61&end=65&autoplay=1&rel=0`);
    });

    test('embed URL without a usable end omits it; missing start is 0', () => {
        expect(buildYouTubeEmbedUrl(REF, null, null)).toBe(`https://www.youtube-nocookie.com/embed/${REF}?start=0&autoplay=1&rel=0`);
        expect(buildYouTubeEmbedUrl(REF, 5000, 4000)).toBe(`https://www.youtube-nocookie.com/embed/${REF}?start=5&autoplay=1&rel=0`);
    });

    test('watch and thumbnail URLs', () => {
        expect(buildYouTubeWatchUrl(REF, 61500)).toBe(`https://www.youtube.com/watch?v=${REF}&t=61s`);
        expect(buildYouTubeWatchUrl(REF, null)).toBe(`https://www.youtube.com/watch?v=${REF}&t=0s`);
        expect(buildYouTubeThumbUrl(REF)).toBe(`https://i.ytimg.com/vi/${REF}/mqdefault.jpg`);
    });

    test('invalid refs never produce a URL', () => {
        expect(buildYouTubeEmbedUrl('bad', 0, 1000)).toBeNull();
        expect(buildYouTubeWatchUrl('bad', 0)).toBeNull();
        expect(buildYouTubeThumbUrl('bad')).toBeNull();
    });

    test('sanitizeYouTubeItems drops invalid refs and non-youtube sources and caps the count', () => {
        const items = [
            item(),
            item({ref: 'bad ref'}),
            item({source: 'film'}),
            ...Array.from({length: 10}, (_, i) => item({ref: `abcdefghij${i}`})),
        ];
        const result = sanitizeYouTubeItems(items);
        expect(result.length).toBe(YOUTUBE_SECTION_MAX_ITEMS);
        expect(YOUTUBE_SECTION_MAX_ITEMS).toBe(6);
        expect(result.every((i) => isValidYouTubeRef(i.ref) && i.source === 'youtube')).toBe(true);
        expect(result[0].ref).toBe(REF);
    });

    test('time range formatting', () => {
        expect(formatTimeRange(61500, 64200)).toBe('1:01–1:04');
        expect(formatTimeRange(3725000, null)).toBe('1:02:05');
        expect(formatTimeRange(null, null)).toBe('');
    });
});

describe('film clip source', () => {
    test('IMDb link only on https://www.imdb.com/title/', () => {
        expect(isSafeImdbUrl('https://www.imdb.com/title/tt0111161/')).toBe(true);
        expect(isSafeImdbUrl('http://www.imdb.com/title/tt0111161/')).toBe(false);
        expect(isSafeImdbUrl('https://evil.example/title/tt1')).toBe(false);
        expect(isSafeImdbUrl('https://www.imdb.com.evil.example/title/tt1')).toBe(false);
        expect(isSafeImdbUrl('javascript:alert(1)')).toBe(false);
        expect(isSafeImdbUrl(void 0)).toBe(false);
    });

    test('title with year, series with season and episode, missing title → null', () => {
        expect(formatSourceTitle({title: 'Heat', year: 1995})).toBe('Heat (1995)');
        expect(formatSourceTitle({title: 'Heat'})).toBe('Heat');
        expect(formatSourceTitle({title: 'Lost', year: 2004, season: 1, episode: 2})).toBe('Lost (2004), сезон 1, серия 2');
        expect(formatSourceTitle({title_ru: 'Жара', year: 1995})).toBe('Жара (1995)');
        expect(formatSourceTitle({year: 1995})).toBeNull();
        expect(formatSourceTitle(void 0)).toBeNull();
    });
});

describe('clip window and captions', () => {
    test('plays from lead_trim_sec for trim_duration_sec', () => {
        expect(computeClipWindow({lead_trim_sec: 1.5, duration_sec: 20}, 6)).toEqual({start: 1.5, end: 7.5});
    });

    test('end is clamped to the file duration; negative lead is 0', () => {
        expect(computeClipWindow({lead_trim_sec: 3, duration_sec: 5}, 6)).toEqual({start: 3, end: 5});
        expect(computeClipWindow({lead_trim_sec: -2, duration_sec: 10}, 4)).toEqual({start: 0, end: 4});
    });

    test('unknown trim duration plays to the end', () => {
        expect(computeClipWindow({lead_trim_sec: null, duration_sec: null}, null)).toEqual({start: 0, end: null});
        expect(computeClipWindow({lead_trim_sec: 2, duration_sec: 9}, null)).toEqual({start: 2, end: 9});
    });

    test('subs are relative to the trimmed start', () => {
        const cues = subsToCues([
            {rel_start_ms: 0, rel_end_ms: 1200, text: 'Run!'},
            {rel_start_ms: 1500, rel_end_ms: 1400, text: 'broken'},
            {rel_start_ms: 2000, rel_end_ms: 2500, text: '   '},
            {rel_start_ms: 3000, rel_end_ms: 4000, text: 'I ran'},
        ], 1.5);
        expect(cues).toEqual([
            {start: 1.5, end: 2.7, text: 'Run!'},
            {start: 4.5, end: 5.5, text: 'I ran'},
        ]);
    });
});

describe('error and empty messages', () => {
    test('error code comes from data.code, then from a code-shaped message', () => {
        const e = new ExtensionError('whatever');
        e.data = {code: 'flib_rate_limited', status: 429};
        expect(getGatewayErrorCode(e)).toBe('flib_rate_limited');
        expect(getGatewayErrorCode(new Error('flib_network'))).toBe('flib_network');
        expect(getGatewayErrorCode(new Error('Something broke'))).toBeNull();
        expect(getGatewayErrorCode('x')).toBeNull();
    });

    test('503 reads differently per section', () => {
        expect(describeGatewayError('flib_service_unavailable', 'youtube')).toBe('Сервис примеров YouTube временно недоступен');
        expect(describeGatewayError('flib_service_unavailable', 'films')).toContain('временно недоступен');
        expect(describeGatewayError('flib_service_unavailable', 'films')).not.toContain('YouTube');
    });

    test('every known code has a Russian message, unknown falls back', () => {
        const codes = [
            'flib_key_missing',
            'flib_key_invalid',
            'flib_forbidden',
            'examples_forbidden',
            'examples_quota_exhausted',
            'demo_quota_exhausted',
            'flib_rate_limited',
            'flib_network',
            'flib_job_failed',
            'flib_job_timeout',
            'flib_job_not_found',
            'flib_too_many_jobs',
            'flib_clip_not_ready',
            'flib_clip_timeout',
            'flib_clip_failed',
            'flib_clip_too_large',
            'flib_word_empty',
            'flib_word_too_long',
            'flib_bad_response',
        ];
        for (const code of codes) {
            const text = describeGatewayError(code, 'films');
            expect(text).toMatch(/[а-яА-Я]/);
            expect(text).not.toBe(describeGatewayError(null, 'films'));
        }
        expect(describeGatewayError('totally_new_code', 'youtube')).toBe(describeGatewayError(null, 'youtube'));
        expect(describeGatewayError(null, 'youtube')).toMatch(/[а-яА-Я]/);
    });

    test('empty reasons per section', () => {
        expect(describeEmptyReason('not_in_corpus', 'youtube')).toContain('YouTube');
        expect(describeEmptyReason('not_in_corpus', 'films')).toContain('фильм');
        expect(describeEmptyReason('no_usable_examples', 'films')).toMatch(/[а-я]/);
        expect(describeEmptyReason('kind_not_served', 'youtube')).toMatch(/[а-я]/);
        expect(describeEmptyReason(null, 'films')).toMatch(/[а-я]/);
        expect(describeEmptyReason('weird', 'films')).toBe(describeEmptyReason(null, 'films'));
    });
});

describe('base64ToBlob', () => {
    test('decodes bytes and keeps the type', async () => {
        const blob = base64ToBlob(btoa('\u0000\u0001mp4'), 'video/mp4');
        expect(blob.type).toBe('video/mp4');
        expect([...new Uint8Array(await blob.arrayBuffer())]).toEqual([0, 1, 109, 112, 52]);
    });
});

describe('mergeFlibMediaFieldHtml', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => { env = await setupDomTest(); });
    afterEach(async () => { await env.teardown(global); });
    const film = (/** @type {string} */ src) => `<div class="flib-clip"><video controls preload="metadata" src="${src}"></video></div>`;
    const yt = (/** @type {string[]} */ hrefs) => `<ul class="flib-yt">${hrefs.map((h) => `<li><a href="${h}">▶ x</a></li>`).join('')}</ul>`;

    test('сохранённое остаётся побайтно, дописываются только новые клипы и ссылки', () => {
        const existing = film('a.webm') + film('b.webm') + yt(['https://y/1']);
        const merged = mergeFlibMediaFieldHtml(existing, film('b.webm') + film('c.webm') + yt(['https://y/1', 'https://y/2']));
        expect(merged.startsWith(existing)).toBe(true);
        const tail = merged.slice(existing.length);
        expect(tail).toContain('src="c.webm"');
        expect(tail).not.toContain('src="b.webm"');
        expect(tail).toContain('href="https://y/2"');
        expect(tail).not.toContain('href="https://y/1"');
    });

    test('дубль только в скрытом блоке не считается: новый клип дописывается', () => {
        const merged = mergeFlibMediaFieldHtml(`<div hidden>${film('c.webm')}</div>`, film('c.webm'));
        expect(merged.match(/src="c\.webm"/g)).toHaveLength(2);
    });

    test('всё новое уже есть — поле не меняется', () => {
        const existing = film('a.webm') + yt(['https://y/1']);
        expect(mergeFlibMediaFieldHtml(existing, film('a.webm') + yt(['https://y/1']))).toBe(existing);
    });

    test('пустое (ASCII-пробелы) — просто новое; &nbsp; — уже содержимое', () => {
        expect(mergeFlibMediaFieldHtml(' \n', film('a.webm'))).toBe(film('a.webm'));
        const withNbsp = mergeFlibMediaFieldHtml('\u00a0', film('a.webm'));
        expect(withNbsp.startsWith('\u00a0')).toBe(true);
        expect(withNbsp).toContain('src="a.webm"');
        expect(mergeFlibMediaFieldHtml(film('a.webm'), '')).toBe(film('a.webm'));
    });

    test('ручные правки любого вида не трогаются', () => {
        for (const edited of [
            `<!-- моё -->${film('a.webm')}`,
            `<style>b{}</style>${film('a.webm')}`,
            `${film('a.webm')}&nbsp;${film('b.webm')}`,
            `${film('a.webm')}</span><b>x`,
            '<div class="flib-clip" class="z" data-x="1"><video src="a.webm"></video></div>',
            '<ul class="flib-yt" style="color:red"><li><a href="https://y/1">▶ x</a></li>моя заметка</ul>',
        ]) {
            const merged = mergeFlibMediaFieldHtml(edited, film('c.webm'));
            expect(merged.includes(edited)).toBe(true);
            expect(merged).toContain('src="c.webm"');
        }
    });

    test('правка прячет дописанное (незакрытый комментарий, plaintext, video, hidden, details) — новое ставится в начало', () => {
        for (const edited of [
            `${film('a.webm')}<!-- note`,
            `${film('a.webm')}<plaintext>z`,
            `${film('a.webm')}<textarea>`,
            `${film('a.webm')}<video src="mine.mp4">`,
            '<div hidden>',
            '<details>',
            '<a href="x',
        ]) {
            const merged = mergeFlibMediaFieldHtml(edited, film('c.webm'));
            expect(merged.endsWith(edited)).toBe(true);
            expect(merged.startsWith('<div class="flib-clip">')).toBe(true);
            expect(merged).toContain('src="c.webm"');
        }
    });
});
