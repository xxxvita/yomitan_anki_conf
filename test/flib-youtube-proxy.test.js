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

import {describe, expect, test, vi} from 'vitest';
import {handleFlibYoutubeProxy} from '../ext/js/background/flib-youtube-proxy.js';
import {FLIB_SITE_URL} from '../ext/js/data/flib-host.js';

const YT = {url: 'https://www.youtube.com/watch?v=abc'};

/**
 * @param {string} path
 * @param {Partial<import('../ext/js/background/flib-youtube-proxy.js').ProxyRequest>} [extra]
 * @returns {import('../ext/js/background/flib-youtube-proxy.js').ProxyRequest}
 */
const req = (path, extra = {}) => ({action: 'flibYoutubeFetch', path, method: 'GET', headers: {}, body: null, ...extra});

/** @returns {import('vitest').Mock} */
const okFetch = () => vi.fn(async () => new Response('{"ok":true}', {status: 202, statusText: 'Accepted', headers: {'Retry-After': '3', 'X-Subtitle-Source': 'yt'}}));

describe('handleFlibYoutubeProxy', () => {
    test.each([
        null,
        '',
        'https://www.youtube.com.evil.example/',
        'http://www.youtube.com/',
        'https://music.youtube.com/',
        'https://evil.example/https://www.youtube.com/',
        'chrome-extension://abc/popup.html',
    ])('sender %s -> 403, no network', async (url) => {
        const f = okFetch();
        const res = await handleFlibYoutubeProxy(req('/api/session'), {url: /** @type {string | undefined} */ (url)}, f);
        expect(res.status).toBe(403);
        expect(f).not.toHaveBeenCalled();
    });

    test.each([
        '/api/access',
        '/api/me/route/start',
        '/api/other',
        '/api/youtube/subtitles/extra',
        '/api/youtube',
        '/api/examplesX',
        '/api/session/x',
        '/api/',
        '/other',
        'api/session',
    ])('path %s outside the allowlist -> 403, no network', async (path) => {
        const f = okFetch();
        const res = await handleFlibYoutubeProxy(req(path), YT, f);
        expect(res.status).toBe(403);
        expect(f).not.toHaveBeenCalled();
    });

    test.each([
        '/api/video/abc',
        '/api/video/abc?probe=1',
    ])('%s -> 404, no network', async (path) => {
        const f = okFetch();
        const res = await handleFlibYoutubeProxy(req(path), YT, f);
        expect(res.status).toBe(404);
        expect(f).not.toHaveBeenCalled();
    });

    test('telemetry -> 204, no network', async () => {
        const f = okFetch();
        const res = await handleFlibYoutubeProxy(req('/api/telemetry/events', {method: 'POST', body: '[]'}), YT, f);
        expect(res.status).toBe(204);
        expect(f).not.toHaveBeenCalled();
    });

    test.each([
        '/api/youtube/subtitles/../session',
        '/api/session/..',
        '/api//session',
        '/api/session?x=//a',
        '/api/session\\x',
        '/api/session?u=https://x',
        '/api/session@evil.example',
        '/api/session?a=b@c',
        '/api/session#frag',
        '/api/session?a=\r',
        '/api/session\n',
        '/api/https://evil.example/',
        '//evil.example/api/session',
        'https://evil.example/api/session',
    ])('malformed path %j -> 403, no network', async (path) => {
        const f = okFetch();
        const res = await handleFlibYoutubeProxy(req(path), YT, f);
        expect(res.status).toBe(403);
        expect(f).not.toHaveBeenCalled();
    });

    test.each([
        ['/api/youtube/subtitles?v=abc', 'GET'],
        ['/api/youtube/subtitles/translate', 'POST'],
        ['/api/examples?word=a%20b&kind=x', 'GET'],
        ['/api/feedback/video', 'POST'],
        ['/api/session', 'DELETE'],
    ])('allowed %s %s goes to flib.club with credentials omit', async (path, method) => {
        const f = okFetch();
        const headers = {'content-type': 'application/json'};
        const body = method === 'POST' ? '{"a":1}' : null;
        const res = await handleFlibYoutubeProxy(req(path, {method, headers, body}), YT, f);
        expect(f).toHaveBeenCalledTimes(1);
        expect(f).toHaveBeenCalledWith(FLIB_SITE_URL + path, {method, headers, body, credentials: 'omit'});
        expect(res.status).toBe(202);
        expect(res.statusText).toBe('Accepted');
        expect(res.body).toBe('{"ok":true}');
        const map = new Map(res.headers.map(([k, v]) => [k.toLowerCase(), v]));
        expect(map.get('retry-after')).toBe('3');
        expect(map.get('x-subtitle-source')).toBe('yt');
        expect(map.get('content-type')).toContain('text/plain');
    });

    test('non-string body -> 400, no network', async () => {
        const f = okFetch();
        const bad = /** @type {import('../ext/js/background/flib-youtube-proxy.js').ProxyRequest} */ (/** @type {unknown} */ ({...req('/api/feedback/video', {method: 'POST'}), body: {a: 1}}));
        const res = await handleFlibYoutubeProxy(bad, YT, f);
        expect(res.status).toBe(400);
        expect(f).not.toHaveBeenCalled();
    });

    test('unsupported method -> 403, no network', async () => {
        const f = okFetch();
        const res = await handleFlibYoutubeProxy(req('/api/session', {method: 'PATCH'}), YT, f);
        expect(res.status).toBe(403);
        expect(f).not.toHaveBeenCalled();
    });

    test('network failure -> status 0', async () => {
        const f = vi.fn(async () => { throw new TypeError('fail'); });
        const res = await handleFlibYoutubeProxy(req('/api/session'), YT, f);
        expect(res.status).toBe(0);
    });
});
