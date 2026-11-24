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
import {parseRoutePuzzleId} from '../ext/js/data/flib-host.js';
import {
    mergeFlibMediaFieldHtml,
    YOUTUBE_SECTION_MAX_ITEMS,
    base64ToBlob,
    buildFlibMediaFieldHtml,
    buildFlibPlayerUrl,
    buildYouTubeCardEmbedUrl,
    buildYouTubeEmbedUrl,
    buildYouTubeThumbUrl,
    buildYouTubeWatchUrl,
    computeClipWindow,
    describeEmptyReason,
    describeGatewayError,
    describeKnowledgeError,
    describeUnderstandableEmpty,
    formatSourceTitle,
    formatTimeRange,
    getGatewayErrorCode,
    getGatewayErrorDetails,
    isSafeImdbUrl,
    isTransientGatewayError,
    isValidYouTubeRef,
    sanitizeYouTubeItems,
    subsToCues,
    truncateAtWordBoundary,
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

    test('card player URL: start floored, end = ceil + 2 s, no autoplay; unusable end or ref', () => {
        const base = 'https://www.youtube-nocookie.com/embed/lRSA2tF0mkU';
        expect(buildYouTubeCardEmbedUrl('lRSA2tF0mkU', 563_200, 566_100)).toBe(`${base}?start=563&end=569&rel=0`);
        expect(buildYouTubeCardEmbedUrl('lRSA2tF0mkU', null, 1)).toBe(`${base}?start=0&end=3&rel=0`);
        for (const endMs of [null, Number.NaN, Number.POSITIVE_INFINITY, 563_200, 563_199, 0]) {
            expect(buildYouTubeCardEmbedUrl('lRSA2tF0mkU', 563_200, endMs)).toBe(`${base}?start=563&rel=0`);
        }
        expect(buildYouTubeCardEmbedUrl('lRSA2tF0mkU', null, null)).toBe(`${base}?start=0&rel=0`);
        expect(buildYouTubeCardEmbedUrl('javascript:', 0, 1000)).toBeNull();
        expect(buildYouTubeCardEmbedUrl('bad"ref1234', 0, 1000)).toBeNull();
    });

    test('odd times: the card player URL is always one the merge recognizes, the watch URL has no exponent', () => {
        const base = `https://www.youtube-nocookie.com/embed/${REF}`;
        const odd = [null, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -10_000, -5000, -0, 0.4, 999.9, 5000, Number.MAX_SAFE_INTEGER, 1e19, 1e25, 1e30, Number.MAX_VALUE];
        for (const startMs of odd) {
            expect(buildYouTubeWatchUrl(REF, startMs)).toMatch(/^https:\/\/www\.youtube\.com\/watch\?v=dQw4w9WgXcQ&t=\d+s$/);
            for (const endMs of odd) {
                expect(buildYouTubeCardEmbedUrl(REF, startMs, endMs)).toMatch(/^https:\/\/www\.youtube-nocookie\.com\/embed\/[\w-]{11}\?start=\d+(?:&end=\d+)?&rel=0$/);
            }
        }
        expect(buildYouTubeCardEmbedUrl(REF, -10_000, -5000)).toBe(`${base}?start=0&rel=0`);
        expect(buildYouTubeCardEmbedUrl(REF, -10_000, 5000)).toBe(`${base}?start=0&end=7&rel=0`);
        expect(buildYouTubeCardEmbedUrl(REF, 0, 1e30)).toBe(`${base}?start=0&rel=0`);
        expect(buildYouTubeCardEmbedUrl(REF, 1e25, 1e30)).toBe(`${base}?start=0&rel=0`);
        expect(buildYouTubeWatchUrl(REF, 1e25)).toBe(`https://www.youtube.com/watch?v=${REF}&t=0s`);
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

describe('Flib player link', () => {
    test('player URL: v and the floored start second', () => {
        expect(buildFlibPlayerUrl(REF, 61500)).toBe(`https://flib.club/player?v=${REF}&t=61`);
        expect(buildFlibPlayerUrl(REF, 1000)).toBe(`https://flib.club/player?v=${REF}&t=1`);
    });

    test.each([0, 999, -5, null, Number.NaN, Number.POSITIVE_INFINITY, 1e30, '61500'])('start %s gives no t', (startMs) => {
        expect(buildFlibPlayerUrl(REF, startMs)).toBe(`https://flib.club/player?v=${REF}`);
    });

    test.each([null, '', 'short', `${REF}x`, 'abc/def?g=h', 42])('bad ref %s gives null', (ref) => {
        expect(buildFlibPlayerUrl(ref, 1000)).toBeNull();
    });

    test('no rp, and it is not a route-puzzle URL', () => {
        const url = /** @type {string} */ (buildFlibPlayerUrl(REF, 61500));
        expect(new URL(url).searchParams.has('rp')).toBe(false);
        expect(parseRoutePuzzleId(url)).toBeNull();
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

    test('только ссылки: комментарий, незакрытый скрытый ul, <li><div hidden> — новое в начало, видно', () => {
        for (const edited of [
            `${yt(['https://y/1'])}<!--`,
            '<ul class="flib-yt" hidden><li><a href="https://y/1">x</a></li><li><a href="https://y/3">x</a></li>',
            '<ul class="flib-yt"><li><a href="https://y/1">x</a></li><li><div hidden>',
        ]) {
            const merged = mergeFlibMediaFieldHtml(edited, yt(['https://y/2']));
            expect(merged).toBe(`<div class="flib-yt-more">${yt(['https://y/2'])}</div>${edited}`);
        }
    });

    test('скрытый клип или ссылка с тем же адресом — не дубль; повторы внутри нового убираются', () => {
        const hiddenClip = '<div class="flib-clip" hidden><video src="b.webm"></video></div>';
        expect(mergeFlibMediaFieldHtml(hiddenClip, film('b.webm')).match(/src="b\.webm"/g)).toHaveLength(2);
        const hiddenLink = '<ul class="flib-yt"><li hidden><a href="https://y/2">x</a></li></ul>';
        expect(mergeFlibMediaFieldHtml(hiddenLink, yt(['https://y/2'])).match(/href="https:\/\/y\/2"/g)).toHaveLength(2);
        const doubled = mergeFlibMediaFieldHtml(film('a.webm'), film('b.webm') + film('b.webm'));
        expect(doubled.match(/src="b\.webm"/g)).toHaveLength(1);
    });

    test('дубль только в скрытом блоке не считается: новый клип дописывается', () => {
        const merged = mergeFlibMediaFieldHtml(`<div hidden>${film('c.webm')}</div>`, film('c.webm'));
        expect(merged.match(/src="c\.webm"/g)).toHaveLength(2);
    });

    test('поле с прячущей разметкой (noscript, DISPLAY:none, hidden на video/a, popover) — новое в начало, без поиска дублей', () => {
        for (const edited of [
            '<noscript>',
            `<noscript>${film('a.webm')}</noscript>`,
            '<div class="flib-clip" style="DISPLAY:none"><video src="a.webm"></video></div>',
            '<div class="flib-clip"><video hidden src="a.webm"></video></div>',
            '<ul class="flib-yt"><li><a hidden href="https://y/1">x</a></li></ul>',
            '<div class="flib-clip" popover><video src="a.webm"></video></div>',
        ]) {
            const merged = mergeFlibMediaFieldHtml(edited, film('a.webm') + yt(['https://y/1']));
            expect(merged.endsWith(edited)).toBe(true);
            expect(merged.startsWith('<div class="flib-clip"><video')).toBe(true);
        }
    });

    test('слова hidden / style = / popover в тексте (название, реплика) — не повод отключать поиск дублей', () => {
        const titled = '<div class="flib-clip"><video controls preload="metadata" src="a.webm"></video><div class="flib-clip-src">Hidden Figures, style = popover</div></div>';
        expect(mergeFlibMediaFieldHtml(titled, film('a.webm'))).toBe(titled);
        const line = '<ul class="flib-yt"><li><a href="https://y/1">▶ it was hidden there</a></li></ul>';
        expect(mergeFlibMediaFieldHtml(line, yt(['https://y/1']))).toBe(line);
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

describe('knowledge examples texts (spec item 10)', () => {
    test.each([
        ['flib_axis_off', 404, null, 'Скоро: сервер ещё не включил эту функцию'],
        ['flib_rate_limited', 429, 30, 'Слишком часто — попробуйте через 30 с'],
        ['flib_rate_limited', 429, null, 'Слишком часто — попробуйте чуть позже'],
        ['flib_service_unavailable', 503, 5, 'Сервер недоступен — попробуйте позже'],
        ['flib_network', null, null, 'Сервер недоступен — попробуйте позже'],
        ['flib_timeout', null, null, 'Сервер недоступен — попробуйте позже'],
        ['flib_http_error', 500, null, 'Сервер недоступен — попробуйте позже'],
        ['examples_forbidden', 403, null, 'Ваш ключ не даёт доступа к примерам'],
        ['examples_quota_exhausted', 403, null, 'Лимит примеров этого ключа исчерпан'],
        ['flib_key_invalid', 401, null, 'Личный ключ не принят сервером — проверьте его в настройках'],
    ])('%s (%s, Retry-After %s) → %s', (code, status, retryAfterSec, text) => {
        expect(describeKnowledgeError(code, status, retryAfterSec)).toBe(text);
    });

    test('an unknown code falls back to the YouTube failure text', () => {
        expect(describeKnowledgeError(null, null, null)).toBe(describeGatewayError(null, 'youtube'));
    });

    test('getGatewayErrorDetails reads code, status and Retry-After from the error data', () => {
        const error = new ExtensionError('flib_rate_limited');
        error.data = {code: 'flib_rate_limited', status: 429, retryAfterSec: 12};
        expect(getGatewayErrorDetails(error)).toStrictEqual({code: 'flib_rate_limited', status: 429, retryAfterSec: 12});
        expect(getGatewayErrorDetails(new Error('Boom!'))).toStrictEqual({code: null, status: null, retryAfterSec: null});
        const bad = new ExtensionError('flib_rate_limited');
        bad.data = {code: 'flib_rate_limited', status: '429', retryAfterSec: -1};
        expect(getGatewayErrorDetails(bad)).toStrictEqual({code: 'flib_rate_limited', status: null, retryAfterSec: null});
    });

    test('budget_exhausted and quota_exhausted empty reasons have their own texts', () => {
        expect(describeEmptyReason('budget_exhausted', 'youtube')).toBe('Сервер не успел');
        expect(describeEmptyReason('quota_exhausted', 'youtube')).toBe('Лимит примеров этого ключа исчерпан');
    });
});

describe('truncateAtWordBoundary', () => {
    test('short text is kept as is', () => {
        expect(truncateAtWordBoundary('call it a day', 80)).toBe('call it a day');
    });

    test('cut at the last whitespace within the limit, counted in code points', () => {
        const text = `${'word '.repeat(20)}tail`;
        const cut = truncateAtWordBoundary(text, 80);
        expect([...cut].length).toBeLessThanOrEqual(80);
        expect(cut.endsWith('word')).toBe(true);
        const emoji = `${'😀'.repeat(79)} next`;
        expect(truncateAtWordBoundary(emoji, 80)).toBe('😀'.repeat(79));
    });

    test('a boundary right at the limit keeps the whole head; no whitespace → hard cut', () => {
        expect(truncateAtWordBoundary('abcd efgh', 4)).toBe('abcd');
        expect(truncateAtWordBoundary('abcdefgh', 4)).toBe('abcd');
    });
});

describe('«Понятные» helpers', () => {
    /**
     * @param {string} code
     * @param {?number} status
     * @returns {ExtensionError}
     */
    const error = (code, status) => {
        const e = new ExtensionError(code);
        e.data = {code, status};
        return e;
    };

    test('isTransientGatewayError: network, timeout, 503, 429, bad body and any 5xx; nothing else', () => {
        for (const code of ['flib_network', 'flib_timeout', 'flib_service_unavailable', 'flib_rate_limited', 'flib_bad_response']) {
            expect(isTransientGatewayError(error(code, null))).toBe(true);
        }
        expect(isTransientGatewayError(error('flib_http_error', 500))).toBe(true);
        expect(isTransientGatewayError(error('flib_http_error', 409))).toBe(false);
        expect(isTransientGatewayError(error('flib_job_not_found', 404))).toBe(false);
        expect(isTransientGatewayError(error('flib_key_invalid', 401))).toBe(false);
        expect(isTransientGatewayError(new Error('boom'))).toBe(false);
        expect(isTransientGatewayError('flib_network')).toBe(false);
    });

    test('describeUnderstandableEmpty: own texts, the phrase-unchecked text for a quote, the common reasons otherwise', () => {
        expect(describeUnderstandableEmpty('all_excluded', false, 'lemma')).toBe('Все подходящие ролики уже показаны');
        expect(describeUnderstandableEmpty('none_eligible', false, 'lemma')).toBe('Понятных роликов с этим словом не нашлось');
        // K9: a phrase target is not «this word».
        expect(describeUnderstandableEmpty('none_eligible', false, 'quote')).toBe('Понятных роликов с этой фразой не нашлось');
        expect(describeUnderstandableEmpty('budget_exhausted', false, 'lemma')).toBe('Сервер не успел');
        expect(describeUnderstandableEmpty(null, true, 'lemma')).toBe('Сервер не успел');
        expect(describeUnderstandableEmpty('budget_exhausted', false, 'quote')).toBe('Не удалось проверить фразу в роликах');
        expect(describeUnderstandableEmpty(null, true, 'quote')).toBe('Не удалось проверить фразу в роликах');
        expect(describeUnderstandableEmpty('not_in_corpus', false, 'lemma')).toBe(describeEmptyReason('not_in_corpus', 'youtube'));
        expect(describeUnderstandableEmpty(null, false, 'lemma')).toBe(describeEmptyReason(null, 'youtube'));
    });
});

describe('mergeFlibMediaFieldHtml: плеер YouTube', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => { env = await setupDomTest(); });
    afterEach(async () => { await env.teardown(global); });

    const REF2 = 'lRSA2tF0mkU';
    const STYLE = 'width:100%;max-width:480px;aspect-ratio:16/9;height:auto;border:0';
    /** Вид, в который редактор Anki приводит наш style. */
    const EDITOR_STYLE = 'width: 100%; max-width: 480px; aspect-ratio: 16 / 9; height: auto; border-width: 0px; border-style: none;';
    const item1 = {ref: REF, startMs: 1000, endMs: null, text: 'I run', words: ['run']};
    const item2 = {ref: REF2, startMs: 563_200, endMs: 566_100, text: 'for lack', words: ['lack']};
    const item3 = {ref: 'abcdefghijk', startMs: 7000, endMs: 9000, text: 'third', words: []};
    /**
     * @param {import('flib-media-field').FlibMediaFieldYouTube[]} youtube
     * @param {string[]} [fileNames]
     * @returns {string}
     */
    const build = (youtube, fileNames = []) => buildFlibMediaFieldHtml({
        films: fileNames.map((fileName) => ({fileName, vttText: null, title: null, year: null, imdbUrl: null})),
        youtube,
    });
    /** @type {(html: string) => string} */
    const wrap = (html) => `<div class="flib-yt-more">${html}</div>`;
    /** @type {(html: string) => string} */
    const iframeOf = (html) => /** @type {RegExpExecArray} */ (/<iframe .*?<\/iframe>/.exec(html))[0];
    /** @type {(html: string) => string} */
    const liOf = (html) => /** @type {RegExpExecArray} */ (/<li>.*?<\/li>/.exec(html))[0];
    /** @type {(example: import('flib-media-field').FlibMediaFieldYouTube) => string} */
    const linkOnly = (example) => build([example]).replace(/<div>.*?<\/div>/, '');

    /**
     * Плееры, которые увидит карточка: поле вставлено фрагментом (как в Anki), без скрытых предков.
     * @param {string} html
     * @returns {string[]}
     */
    function visiblePlayers(html) {
        const card = document.createElement('div');
        // eslint-disable-next-line no-unsanitized/property
        card.innerHTML = html;
        return [...card.querySelectorAll('iframe')]
            .filter((el) => el.closest('[hidden]') === null)
            .map((el) => `${el.getAttribute('src')}`);
    }
    /** @type {(html: string, item: {ref: string}) => number} */
    const countPlayers = (html, {ref}) => visiblePlayers(html).filter((src) => src.startsWith(`https://www.youtube-nocookie.com/embed/${ref}?`)).length;
    /** @type {(existing: string, added: string, times: number) => string} */
    const saveTimes = (existing, added, times) => {
        for (let i = 0; i < times; ++i) { existing = mergeFlibMediaFieldHtml(existing, added); }
        return existing;
    };

    test('(a) тот же ролик уже есть с плеером — поле не меняется', () => {
        const field = build([item1, item2]);
        expect(mergeFlibMediaFieldHtml(field, build([item2]))).toBe(field);
        expect(mergeFlibMediaFieldHtml(field, build([item1, item2]))).toBe(field);
        // Повтор — по id и секунде: другой конец того же фрагмента не новый ролик, другая секунда — новый.
        expect(mergeFlibMediaFieldHtml(field, build([{...item2, endMs: null}]))).toBe(field);
        expect(countPlayers(mergeFlibMediaFieldHtml(field, build([{...item2, startMs: 564_000}])), item2)).toBe(2);
    });

    test('(b) новый ролик: прежние байты — начало поля, новый плеер виден', () => {
        const field = build([item1]);
        const merged = mergeFlibMediaFieldHtml(field, build([item1, item2]));
        expect(merged).toBe(field + wrap(build([item2])));
        expect(countPlayers(merged, item1)).toBe(1);
        expect(countPlayers(merged, item2)).toBe(1);
    });

    test('(c) чужой iframe рядом с нашим — новое в начало', () => {
        const field = `${build([item1])}<iframe src="https://x/"></iframe>`;
        expect(mergeFlibMediaFieldHtml(field, build([item2]))).toBe(wrap(build([item2])) + field);
        for (const unclosed of [`${build([item1])}<iframe src="https://x/">`, build([item1]).replace('</iframe>', '')]) {
            expect(mergeFlibMediaFieldHtml(unclosed, build([item2]))).toBe(wrap(build([item2])) + unclosed);
        }
    });

    test('(d) прежняя ссылка без плеера: байты целы, плеер добавлен один раз; удалённый руками — добавлен снова', () => {
        const old = linkOnly(item1);
        expect(old).toBe(`<ul class="flib-yt"><li><a href="https://www.youtube.com/watch?v=${REF}&amp;t=1s">▶ I <b>run</b></a></li></ul>`);
        const added = build([item1]);
        const saved = mergeFlibMediaFieldHtml(old, added);
        expect(saved).toBe(old + wrap(added));
        expect(saveTimes(saved, added, 2)).toBe(saved);

        const removed = saved.replace(iframeOf(saved), '');
        expect(countPlayers(removed, item1)).toBe(0);
        const again = saveTimes(removed, added, 3);
        expect(again).toBe(removed + wrap(added));
    });

    describe('(e) узнавание нашего плеера', () => {
        const own = build([item1]);
        test.each([
            ['стиль редактора', own.replace(STYLE, EDITOR_STYLE)],
            ['border: 0px;', own.replace('border:0"', 'border: 0px;"')],
            ['border: none', own.replace('border:0"', 'border: none"')],
            ['& вместо &amp;', own.replaceAll('&amp;', '&')],
            ['allowfullscreen без значения', own.replace('allowfullscreen=""', 'allowfullscreen')],
            ['allowfullscreen="true"', own.replace('allowfullscreen=""', 'allowfullscreen="true"')],
            ['без referrerpolicy', own.replace('referrerpolicy="strict-origin-when-cross-origin" ', '')],
        ])('наш: %s', (_name, field) => {
            expect(field).not.toBe(own);
            expect(mergeFlibMediaFieldHtml(field, build([item1]))).toBe(field);
            expect(mergeFlibMediaFieldHtml(field, build([item2]))).toBe(field + wrap(build([item2])));
        });

        test.each([
            ['display:none', own.replace('border:0"', 'border:0;display:none"')],
            ['position:fixed', own.replace('border:0"', 'border:0;position:fixed"')],
            ['height:100%', own.replace('height:auto', 'height:100%')],
            ['onload', own.replace('<iframe ', '<iframe onload="x()" ')],
            ['srcdoc', own.replace('<iframe ', '<iframe srcdoc="x" ')],
            ['hidden', own.replace('<iframe ', '<iframe hidden ')],
            ['без класса', own.replace('class="flib-yt-player" ', '')],
            ['лишний класс', own.replace('class="flib-yt-player"', 'class="flib-yt-player hidden"')],
            ['referrerpolicy="no-referrer" (YouTube не играет)', own.replace('strict-origin-when-cross-origin', 'no-referrer')],
            ['пустой referrerpolicy', own.replace('strict-origin-when-cross-origin', '')],
            ['другой хост', own.replace('www.youtube-nocookie.com', 'www.youtube-nocookie.com.evil.io')],
            ['точка хоста — не любой символ', own.replace('www.youtube-nocookie', 'wwwxyoutube-nocookie')],
            ['http', own.replace('https://www.youtube-nocookie', 'http://www.youtube-nocookie')],
            ['autoplay', own.replace('&amp;rel=0', '&amp;rel=0&amp;autoplay=1')],
            ['текст внутри', own.replace('></iframe>', '>x</iframe>')],
        ])('чужой: %s', (_name, field) => {
            expect(field).not.toBe(own);
            for (const example of [item1, item2]) {
                expect(mergeFlibMediaFieldHtml(field, build([example]))).toBe(wrap(build([example])) + field);
            }
        });
    });

    test('(f) Delete в редакторе (два ролика в одном <li>, стиль нормализован): четыре сохранения — один плеер', () => {
        const field = build([item1, item2]).replace('</li><li>', '').replaceAll(STYLE, EDITOR_STYLE);
        expect(field.match(/<li>/g)).toHaveLength(1);
        for (const example of [item1, item2]) {
            const merged = saveTimes(field, build([example]), 4);
            expect(merged).toBe(field);
            expect(countPlayers(merged, example)).toBe(1);
        }
    });

    test('(f) Delete в Chromium: второй плеер без <div> стоит после первой ссылки, вторая ссылка — в своём <li>', () => {
        const [li1, li2] = [liOf(build([item1])), liOf(build([item2]))];
        const moved = iframeOf(li2).replace(STYLE, EDITOR_STYLE);
        const field = `<ul class="flib-yt">${li1.replace('</li>', `${moved}</li>`)}${li2.replace(/<div>.*?<\/div>/, '')}</ul>`;
        expect(field).toContain(`</a>${moved}</li><li><a href="https://www.youtube.com/watch?v=${REF2}&amp;`);
        for (const example of [item1, item2]) {
            const merged = saveTimes(field, build([example]), 4);
            expect(merged).toBe(field);
            expect(countPlayers(merged, example)).toBe(1);
        }
    });

    test('(f) Backspace в редакторе (ссылка попала в <div> плеера): четыре сохранения — один плеер', () => {
        const field = build([item1, item2])
            .replaceAll('</iframe></div>', '</iframe>')
            .replaceAll('</a></li>', '</a></div></li>')
            .replaceAll(STYLE, EDITOR_STYLE);
        expect(field).toContain('</iframe><a ');
        for (const example of [item1, item2]) {
            const merged = saveTimes(field, build([example]), 4);
            expect(merged).toBe(field);
            expect(countPlayers(merged, example)).toBe(1);
        }
    });

    test('(g) плеер, проглоченный атрибутом: похожее на наш ролик не глушит новый', () => {
        const own1 = build([item1]);
        const own2 = build([item2]);
        const watch2 = `https://www.youtube.com/watch?v=${REF2}&amp;t=563s`;
        const tail = `<ul class=flib-yt><li>${iframeOf(own2)}<a hidden href='${watch2}'>x</a></li></ul>`;
        const tailPlain = `<ul class=flib-yt><li><div>${iframeOf(own2)}</div></li></ul>`;
        for (const field of [
            `<p title="${iframeOf(own1)}${tail}`,
            `<p title="${liOf(own1)}${tail}`,
            `<p title='${iframeOf(own1)}${tailPlain}`,
            `<p title='${iframeOf(own1)}'>x</p>${tailPlain}`,
        ]) {
            const merged = mergeFlibMediaFieldHtml(field, own2);
            expect(merged.endsWith(field)).toBe(true);
            const fresh = merged.slice(0, merged.length - field.length);
            expect(visiblePlayers(fresh)).toStrictEqual([`https://www.youtube-nocookie.com/embed/${REF2}?start=563&end=569&rel=0`]);
            expect(visiblePlayers(merged)[0]).toBe(visiblePlayers(fresh)[0]);
        }
    });

    test('(h) в поле уже есть список — новый обёрнут; третье сохранение видит и обёрнутый; без списка — без обёртки', () => {
        const clip = build([], [`flib-${'a'.repeat(64)}.webm`]);
        expect(mergeFlibMediaFieldHtml(clip, build([item1]))).toBe(clip + build([item1]));
        expect(mergeFlibMediaFieldHtml('моя заметка', build([item1]))).toBe(`моя заметка${build([item1])}`);
        expect(mergeFlibMediaFieldHtml('', build([item1]))).toBe(build([item1]));

        const first = clip + build([item1]);
        const second = mergeFlibMediaFieldHtml(first, build([item2]));
        expect(second).toBe(`${first}<div class="flib-yt-more">${build([item2])}</div>`);
        expect(mergeFlibMediaFieldHtml(second, build([item2]))).toBe(second);
        expect(mergeFlibMediaFieldHtml(second, build([item1, item2, item3]))).toBe(second + wrap(build([item3])));
        // Ссылка без плеера сверяется по адресу и в обёрнутом списке.
        expect(mergeFlibMediaFieldHtml(second, linkOnly(item2))).toBe(second);
    });

    describe('правка оставила в поле чужой style: новое добавляется в начало один раз', () => {
        const own = build([item1]);
        const note = '<p style="color:red">моё</p>';
        const richFilm = {
            fileName: `flib-${'c'.repeat(64)}.webm`,
            vttText: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nrun\n\n',
            title: 'It\'s "Heat" & <co>',
            year: 1995,
            imdbUrl: 'https://www.imdb.com/title/tt0113277/',
        };
        const film = buildFlibMediaFieldHtml({films: [richFilm], youtube: []});
        const quoted = {...item2, text: 'I\'m "fine" & <ok>\u00a0now'};
        const edits = [
            ['цвет текста', own.replace('▶ I <b>run</b>', '<span style="color: rgb(255, 0, 0);">▶ I <b>run</b></span>')],
            ['центрирование', own.replace('<li><div>', '<li><div style="text-align: center;">')],
            ['отступ', own.replace('<iframe', '<div style="display: inline !important;"><iframe').replace('</iframe>', '</iframe></div>')],
        ];

        test.each(edits)('%s: четыре сохранения одного ролика — добавлен один', (_name, field) => {
            expect(field).not.toBe(own);
            const merged = saveTimes(field, own, 4);
            expect(merged).toBe(wrap(own) + field);
            expect(countPlayers(merged, item1)).toBe(2);
        });

        test.each(edits)('%s: два ролика попеременно — по одному', (_name, field) => {
            let merged = field;
            for (const example of [item1, quoted, item1, quoted]) { merged = mergeFlibMediaFieldHtml(merged, build([example])); }
            expect(countPlayers(merged, item1)).toBe(2);
            expect(countPlayers(merged, quoted)).toBe(1);
            expect(merged.endsWith(wrap(own) + field)).toBe(true);
            // Оба сразу и вместе с третьим: дописывается только третий.
            expect(mergeFlibMediaFieldHtml(merged, build([quoted, item1]))).toBe(merged);
            expect(mergeFlibMediaFieldHtml(merged, build([item1, item3, quoted]))).toBe(wrap(build([item3])) + merged);
        });

        test('фильм: четыре сохранения — добавлен один; ролик рядом не мешает', () => {
            const field = `${film.replace('<div class="flib-clip-src">', '<div class="flib-clip-src" style="color: red;">')}`;
            expect(field).not.toBe(film);
            const merged = saveTimes(field, film, 4);
            expect(merged.endsWith(field)).toBe(true);
            expect(merged.match(/<video /g)).toHaveLength(2);
            const both = saveTimes(merged, film + own, 4);
            expect(both).toBe(own + merged);
            expect(saveTimes(both, film, 2)).toBe(both);
        });

        test('первое сохранение не тронуто, заметка со стилем после него — ничего не добавляется', () => {
            for (const added of [own, film, build([quoted]), film + build([item1, quoted])]) {
                expect(saveTimes(added + note, added, 4)).toBe(added + note);
            }
            const field = film + linkOnly(item3) + wrap(own) + note;
            expect(mergeFlibMediaFieldHtml(field, film + own)).toBe(field);
            // Ссылка без плеера — не повтор ролика с плеером.
            expect(mergeFlibMediaFieldHtml(field, build([item3]))).toBe(wrap(build([item3])) + field);
        });

        test('после чужой разметки наши блоки уже не в счёт', () => {
            for (const foreign of [note, 'текст<p style="color:red">x</p>', '\n<b style="color:red">x</b>', '<div hidden>']) {
                const field = own + foreign + build([item2]);
                expect(saveTimes(field, own, 4)).toBe(field);
                expect(saveTimes(field, build([item2]), 4)).toBe(wrap(build([item2])) + field);
            }
        });

        test.each([
            ['пробел впереди', ` ${own}`],
            ['комментарий впереди', `<!-- -->${own}`],
            ['скрытый список', own.replace('<ul class="flib-yt">', '<ul class="flib-yt" hidden>')],
            ['другой класс списка', own.replace('"flib-yt"', '"flib-yt x"')],
            ['скрытый элемент', own.replace('<li>', '<li style="display:none">')],
            ['текст в списке', own.replace('<li>', 'x<li>')],
            ['незакрытый список', own.replace('</ul>', '')],
            ['скрытая обёртка', wrap(own).replace('"flib-yt-more"', '"flib-yt-more" hidden')],
            ['незакрытая обёртка', wrap(own).replace('</ul></div>', '</ul>')],
            ['скрытый плеер', own.replace('border:0"', 'border:0;display:none"')],
            ['другой хост', own.replace('www.youtube-nocookie.com', 'www.youtube-nocookie.com.evil.io')],
            ['чужой тег в тексте', own.replace('<b>', '<b hidden>')],
            ['чужая ссылка', own.replace('https://www.youtube.com/', 'javascript:')],
            ['без закрытия ссылки', own.replace('</a>', '')],
        ])('похожее начало — не наш блок: %s', (_name, start) => {
            const field = start + note;
            const merged = saveTimes(field, own, 4);
            expect(merged.endsWith(field)).toBe(true);
            expect(merged.slice(0, merged.length - field.length)).toMatch(/^(?:<div class="flib-yt-more">)?<ul class="flib-yt"><li><div><iframe [^>]*><\/iframe><\/div><a [^>]*>▶ I <b>run<\/b><\/a><\/li><\/ul>(?:<\/div>)?$/);
        });

        test.each([
            ['скрытый клип', film.replace('<div class="flib-clip">', '<div class="flib-clip" hidden>')],
            ['чужое имя файла', film.replace(/flib-c+/, 'mine')],
            ['подпись не закрыта', film.replace(/<\/div><\/div>$/, '</div>')],
            ['чужая ссылка', film.replace('www.imdb.com', 'x.example')],
        ])('похожее начало — не наш клип: %s', (_name, start) => {
            const field = start + note;
            const merged = saveTimes(field, film, 4);
            expect(merged.endsWith(field)).toBe(true);
            expect(merged.slice(0, merged.length - field.length).match(/<video /g)).toHaveLength(1);
        });
    });

    test.each(['video', 'audio', 'canvas', 'datalist', 'meter', 'progress', 'rp', 'option', 'optgroup', 'select'])('плеер внутри <%s> не виден — повтором не считается', (tag) => {
        for (const field of [
            build([item1]).replace('<li><div>', `<li><${tag}><div>`).replace('</iframe></div>', `</iframe></div></${tag}>`),
            build([item1]).replace('<div><iframe', `<div><${tag}><iframe`).replace('</iframe>', `</iframe></${tag}>`),
        ]) {
            const merged = mergeFlibMediaFieldHtml(field, build([item1]));
            expect(merged.length - field.length).toBe(wrap(build([item1])).length);
            expect([field + wrap(build([item1])), wrap(build([item1])) + field]).toContain(merged);
        }
    });

    test('плеер вне нашего списка повтором не считается', () => {
        const field = `<p>${iframeOf(build([item1]))}</p>`;
        expect(mergeFlibMediaFieldHtml(field, build([item1]))).toBe(field + build([item1]));
    });

    test('(i) фильмы рядом с плеерами по-прежнему без повторов', () => {
        const a = `flib-${'a'.repeat(64)}.webm`;
        const b = `flib-${'b'.repeat(64)}.webm`;
        const field = build([item1], [a]);
        expect(mergeFlibMediaFieldHtml(field, build([item1], [a]))).toBe(field);
        const merged = mergeFlibMediaFieldHtml(field, build([item2], [a, b]));
        expect(merged.startsWith(field)).toBe(true);
        expect(merged.endsWith(wrap(build([item2])))).toBe(true);
        expect(merged.match(/<video [^>]*>/g)?.map((tag) => /src="([^"]*)"/.exec(tag)?.[1])).toStrictEqual([a, b]);
    });
});
