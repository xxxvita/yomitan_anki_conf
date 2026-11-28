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
import {describe, expect, it, vi} from 'vitest';
import {createFlibFetch, createFlibSendBeacon, type ProxyRequest, type ProxyResponse} from '../net';

function setup(response?: Partial<ProxyResponse>) {
    const sent: ProxyRequest[] = [];
    const send = vi.fn(async (msg: ProxyRequest): Promise<ProxyResponse> => {
        sent.push(msg);
        return {status: 200, statusText: 'OK', headers: [], body: '', ...response};
    });
    const realFetch = vi.fn(async () => new Response('real'));
    const flibFetch = createFlibFetch(send, realFetch as unknown as typeof fetch);
    return {sent, send, realFetch, flibFetch};
}

describe('createFlibFetch', () => {
    it('sends relative /api requests to the background and builds a real Response', async () => {
        const {sent, flibFetch} = setup({
            status: 429,
            statusText: 'Too Many Requests',
            headers: [['Retry-After', '7'], ['X-Subtitle-Source', 'cache'], ['Content-Type', 'application/json']],
            body: '{"a":1}',
        });
        const res = await flibFetch('/api/youtube/subtitles?v=x');
        expect(sent).toEqual([{action: 'flibYoutubeFetch', path: '/api/youtube/subtitles?v=x', method: 'GET', headers: {}, body: null}]);
        expect(res).toBeInstanceOf(Response);
        expect(res.status).toBe(429);
        expect(res.ok).toBe(false);
        expect(res.headers.get('Retry-After')).toBe('7');
        expect(res.headers.get('X-Subtitle-Source')).toBe('cache');
        expect(await res.json()).toEqual({a: 1});
    });

    it('passes method, headers and a string body; keepalive does not break the call', async () => {
        const {sent, flibFetch} = setup();
        await flibFetch('/api/youtube/subtitles/translate', {
            method: 'post',
            headers: {'Content-Type': 'application/json'},
            body: '{"x":1}',
            keepalive: true,
        });
        expect(sent[0]).toMatchObject({method: 'POST', headers: {'content-type': 'application/json'}, body: '{"x":1}'});
    });

    it('converts a Blob body to text', async () => {
        const {sent, flibFetch} = setup();
        await flibFetch('/api/feedback/video', {method: 'POST', body: new Blob(['hello'])});
        expect(sent[0].body).toBe('hello');
    });

    it('rejects other non-string bodies with 400 and no message', async () => {
        const {send, flibFetch} = setup();
        const res = await flibFetch('/api/feedback/video', {method: 'POST', body: new FormData()});
        expect(res.status).toBe(400);
        expect(send).not.toHaveBeenCalled();
    });

    it('answers 204 for telemetry without a message', async () => {
        const {send, flibFetch} = setup();
        const res = await flibFetch('/api/telemetry/events', {method: 'POST', body: '[]', keepalive: true});
        expect(res.status).toBe(204);
        expect(send).not.toHaveBeenCalled();
    });

    it('sends other URLs to the real fetch', async () => {
        const {send, realFetch, flibFetch} = setup();
        const res = await flibFetch('https://i.ytimg.com/vi/x/hq.jpg');
        expect(await res.text()).toBe('real');
        expect(realFetch).toHaveBeenCalledTimes(1);
        await flibFetch('//evil.example/api/x');
        expect(realFetch).toHaveBeenCalledTimes(2);
        expect(send).not.toHaveBeenCalled();
    });

    it('aborts before the answer with AbortError', async () => {
        const send = vi.fn(() => new Promise<ProxyResponse>(() => {}));
        const flibFetch = createFlibFetch(send, vi.fn() as unknown as typeof fetch);
        const ac = new AbortController();
        const p = flibFetch('/api/examples?word=a&kind=b', {signal: ac.signal});
        ac.abort();
        await expect(p).rejects.toMatchObject({name: 'AbortError'});
        const pre = AbortSignal.abort();
        await expect(flibFetch('/api/examples', {signal: pre})).rejects.toMatchObject({name: 'AbortError'});
    });

    it('rejects with TypeError when the background reports a network error (status 0) or send fails', async () => {
        const a = setup({status: 0, statusText: 'network error'});
        await expect(a.flibFetch('/api/session')).rejects.toBeInstanceOf(TypeError);
        const flibFetch = createFlibFetch(async () => { throw new Error('no receiver'); }, vi.fn() as unknown as typeof fetch);
        await expect(flibFetch('/api/session')).rejects.toBeInstanceOf(TypeError);
    });

    it('builds null-body statuses without a body', async () => {
        const {flibFetch} = setup({status: 204, statusText: 'No Content', body: ''});
        const res = await flibFetch('/api/session', {method: 'DELETE'});
        expect(res.status).toBe(204);
    });
});

describe('createFlibSendBeacon', () => {
    it('returns true without any message', () => {
        const beacon = createFlibSendBeacon();
        expect(beacon('/api/telemetry/events', new Blob(['x']))).toBe(true);
    });
});
