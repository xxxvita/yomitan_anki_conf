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

import {describe, expect, test} from 'vitest';
import {BlobReader, TextWriter, ZipReader} from '@zip.js/zip.js';
import {FlibGatewayClient, encodeBase64Chunked} from '../ext/js/comm/flib-gateway-client.js';
import {parseJson} from '../ext/js/core/json.js';

const FAKE_KEY = `tpk_${'0'.repeat(32)}`;
const BASE = 'https://gw.test';
const UPLOAD_URL = 'https://bucket.test/upload?sig=abc';

/**
 * @typedef {object} RecordedCall
 * @property {string} url
 * @property {string} method
 * @property {Headers} headers
 * @property {unknown} body
 */

/**
 * @typedef {(call: RecordedCall) => (Response | Promise<Response>)} Route
 */

/**
 * @param {unknown} body
 * @param {number} [status]
 * @returns {Response}
 */
function json(body, status = 200) {
    return new Response(JSON.stringify(body), {status, headers: {'Content-Type': 'application/json'}});
}

/**
 * Поддельная сеть: маршрут подбирается по «МЕТОД путь», каждый вызов пишется в журнал.
 * @param {Record<string, Route | Route[]>} routes Массив — ответы по очереди (последний повторяется).
 * @returns {{fetch: typeof fetch, calls: RecordedCall[]}}
 */
function makeFetch(routes) {
    /** @type {RecordedCall[]} */
    const calls = [];
    /** @type {Map<string, number>} */
    const counters = new Map();
    /** @type {typeof fetch} */
    const fakeFetch = async (input, init = {}) => {
        const url = typeof input === 'string' ? input : (input instanceof URL ? input.href : input.url);
        const method = (init.method ?? 'GET').toUpperCase();
        const headers = new Headers(init.headers);
        const call = {url, method, headers, body: init.body};
        calls.push(call);
        if (init.signal?.aborted) {
            throw new DOMException('aborted', 'AbortError');
        }
        const path = url.startsWith(BASE) ? url.slice(BASE.length) : url;
        const routeKey = `${method} ${path}`;
        const route = routes[routeKey];
        if (typeof route === 'undefined') {
            throw new Error(`unexpected request: ${routeKey}`);
        }
        if (Array.isArray(route)) {
            const index = counters.get(routeKey) ?? 0;
            counters.set(routeKey, index + 1);
            return await route[Math.min(index, route.length - 1)](call);
        }
        return await route(call);
    };
    return {fetch: fakeFetch, calls};
}

/**
 * @param {typeof fetch} fetchImpl
 * @param {{key?: string, now?: () => number, sleep?: (ms: number, signal?: AbortSignal) => Promise<void>}} [options]
 * @returns {FlibGatewayClient}
 */
function makeClient(fetchImpl, {key = FAKE_KEY, now, sleep} = {}) {
    return new FlibGatewayClient({
        fetch: fetchImpl,
        getBase: () => BASE,
        getKey: () => key,
        now,
        sleep: sleep ?? (async () => {}),
    });
}

/**
 * @param {() => Promise<unknown>} fn
 * @returns {Promise<{code: unknown, status: unknown, data: Record<string, unknown>}>}
 */
async function catchCode(fn) {
    try {
        await fn();
    } catch (e) {
        const data = /** @type {Record<string, unknown>} */ (/** @type {{data?: unknown}} */ (e).data ?? {});
        return {code: data.code, status: data.status, data};
    }
    throw new Error('expected rejection');
}

const goodItem = {
    source: 'youtube',
    ref: 'dQw4w9WgXcQ',
    start_ms: 1000,
    end_ms: 2500,
    text_en: 'never gonna give you up',
    text_ru: null,
    thumbnail_url: null,
};

describe('ключ и заголовок Authorization', () => {
    test('нет ключа → flib_key_missing, запрос НЕ уходит', async () => {
        const {fetch, calls} = makeFetch({});
        const result = await catchCode(() => makeClient(fetch, {key: ''}).getExamples('run'));
        expect(result.code).toBe('flib_key_missing');
        expect(calls).toHaveLength(0);
    });
    test('ключ из пробелов → flib_key_missing', async () => {
        const {fetch, calls} = makeFetch({});
        expect((await catchCode(() => makeClient(fetch, {key: '   '}).getExamples('run'))).code).toBe('flib_key_missing');
        expect(calls).toHaveLength(0);
    });
    test('ключ неверного формата → flib_key_invalid без запроса', async () => {
        const {fetch, calls} = makeFetch({});
        expect((await catchCode(() => makeClient(fetch, {key: 'tpk_nope'}).getExamples('run'))).code).toBe('flib_key_invalid');
        expect(calls).toHaveLength(0);
    });
    test('ключ с пробелами вокруг уходит срезанным, в Bearer', async () => {
        const {fetch, calls} = makeFetch({'POST /v1/examples': () => json({word: 'run', items: [], empty_reason: 'not_in_corpus'})});
        await makeClient(fetch, {key: ` ${FAKE_KEY} `}).getExamples('run');
        expect(calls[0].headers.get('Authorization')).toBe(`Bearer ${FAKE_KEY}`);
    });
});

describe('getExamples', () => {
    test('шлёт POST /v1/examples c {word, kind, limit} по умолчанию', async () => {
        const {fetch, calls} = makeFetch({'POST /v1/examples': () => json({word: 'run', items: [goodItem], empty_reason: null})});
        const result = await makeClient(fetch).getExamples('run');
        expect(calls[0].url).toBe(`${BASE}/v1/examples`);
        expect(parseJson(String(calls[0].body))).toEqual({word: 'run', kind: 'youtube', limit: 6});
        expect(calls[0].headers.get('Content-Type')).toBe('application/json');
        expect(result).toEqual({word: 'run', items: [goodItem], empty_reason: null});
    });
    test('пустое слово отвергается до запроса', async () => {
        const {fetch, calls} = makeFetch({});
        expect((await catchCode(() => makeClient(fetch).getExamples('  '))).code).toBe('flib_word_empty');
        expect(calls).toHaveLength(0);
    });
    test('слово длиннее 80 кодовых точек отвергается до запроса', async () => {
        const {fetch, calls} = makeFetch({});
        expect((await catchCode(() => makeClient(fetch).getExamples('я'.repeat(81)))).code).toBe('flib_word_too_long');
        expect(calls).toHaveLength(0);
    });
    test('80 кодовых точек (суррогатные пары) — допустимо', async () => {
        const {fetch} = makeFetch({'POST /v1/examples': () => json({word: 'x', items: [], empty_reason: 'not_in_corpus'})});
        await expect(makeClient(fetch).getExamples('😀'.repeat(80))).resolves.toBeTruthy();
    });
    test('503 → flib_service_unavailable со статусом', async () => {
        const {fetch} = makeFetch({'POST /v1/examples': () => json({error: 'daemon_unavailable'}, 503)});
        expect(await catchCode(() => makeClient(fetch).getExamples('run'))).toMatchObject({code: 'flib_service_unavailable', status: 503});
    });
    test('401 → flib_key_invalid', async () => {
        const {fetch} = makeFetch({'POST /v1/examples': () => json({error: 'unauthorized'}, 401)});
        expect(await catchCode(() => makeClient(fetch).getExamples('run'))).toMatchObject({code: 'flib_key_invalid', status: 401});
    });
    test('403 {error:"examples_quota_exhausted"} → этот же код', async () => {
        const {fetch} = makeFetch({'POST /v1/examples': () => json({error: 'examples_quota_exhausted', used: 10, limit: 10}, 403)});
        expect(await catchCode(() => makeClient(fetch).getExamples('run'))).toMatchObject({code: 'examples_quota_exhausted', status: 403});
    });
    test('403 без JSON → flib_forbidden', async () => {
        const {fetch} = makeFetch({'POST /v1/examples': () => new Response('nope', {status: 403})});
        expect(await catchCode(() => makeClient(fetch).getExamples('run'))).toMatchObject({code: 'flib_forbidden', status: 403});
    });
    test('403 с несловарным error → flib_forbidden (не тащим сырой текст в код)', async () => {
        const {fetch} = makeFetch({'POST /v1/examples': () => json({error: 'Some <b>html</b> text'}, 403)});
        expect((await catchCode(() => makeClient(fetch).getExamples('run'))).code).toBe('flib_forbidden');
    });
    test('429 → flib_rate_limited', async () => {
        const {fetch} = makeFetch({'POST /v1/examples': () => json({error: 'rate_limited'}, 429)});
        expect(await catchCode(() => makeClient(fetch).getExamples('run'))).toMatchObject({code: 'flib_rate_limited', status: 429});
    });
    test('сеть упала → flib_network', async () => {
        /** @type {typeof fetch} */
        const failing = async () => { throw new TypeError('Failed to fetch'); };
        expect((await catchCode(() => makeClient(failing).getExamples('run'))).code).toBe('flib_network');
    });
    test('битый элемент выброшен, годные сохранены', async () => {
        const bad = [
            {...goodItem, ref: ''},
            {...goodItem, source: 5},
            {...goodItem, start_ms: 'x'},
            {...goodItem, text_en: 7},
            null,
            'str',
        ];
        const {fetch} = makeFetch({'POST /v1/examples': () => json({word: 'run', items: [goodItem, ...bad], empty_reason: null})});
        const result = await makeClient(fetch).getExamples('run');
        expect(result.items).toEqual([goodItem]);
    });
    test('empty_reason передаётся как есть', async () => {
        const {fetch} = makeFetch({'POST /v1/examples': () => json({word: 'zzz', items: [], empty_reason: 'not_in_corpus'})});
        const result = await makeClient(fetch).getExamples('zzz');
        expect(result).toEqual({word: 'zzz', items: [], empty_reason: 'not_in_corpus'});
    });
    test('все элементы битые и причины нет → no_usable_examples', async () => {
        const {fetch} = makeFetch({'POST /v1/examples': () => json({word: 'run', items: [{...goodItem, ref: ''}], empty_reason: null})});
        expect((await makeClient(fetch).getExamples('run')).empty_reason).toBe('no_usable_examples');
    });
    test('ответ не той формы → flib_bad_response', async () => {
        const {fetch} = makeFetch({'POST /v1/examples': () => json({word: 'run', items: 'nope'})});
        expect((await catchCode(() => makeClient(fetch).getExamples('run'))).code).toBe('flib_bad_response');
    });
    test('ответ не JSON → flib_bad_response', async () => {
        const {fetch} = makeFetch({'POST /v1/examples': () => new Response('<html>', {status: 200})});
        expect((await catchCode(() => makeClient(fetch).getExamples('run'))).code).toBe('flib_bad_response');
    });
});

const jobResult = {
    results: [{
        word: 'run',
        lemma: 'run',
        token: 'tok_1',
        clips: [{
            order_index: 0,
            subs: [{rel_start_ms: 0, rel_end_ms: 900, text: 'Run!'}],
            trim_duration_sec: 3.5,
            year: 1994,
            cefr: 'A1',
            difficulty: 0.2,
        }],
        matched_forms: ['run', 'running'],
        empty_reason: null,
    }],
};

/**
 * @param {Partial<Record<string, Route | Route[]>>} overrides
 * @returns {Record<string, Route | Route[]>}
 */
function jobRoutes(overrides = {}) {
    /** @type {Record<string, Route | Route[]>} */
    const routes = {
        'POST /v1/route/jobs': () => json({job_id: 'job-1', input_upload_url: UPLOAD_URL}, 201),
        [`PUT ${UPLOAD_URL}`]: () => new Response(null, {status: 200}),
        'POST /v1/route/jobs/job-1/submit': () => json({status: 'waiting'}, 202),
        'GET /v1/route/jobs/job-1': [
            () => json({status: 'waiting'}),
            () => json({status: 'processing'}),
            () => json({status: 'done', response_content: JSON.stringify(jobResult)}),
        ],
    };
    for (const [key, value] of Object.entries(overrides)) {
        if (typeof value !== 'undefined') { routes[key] = value; }
    }
    return routes;
}

/**
 * @param {unknown} body
 * @returns {Promise<string>}
 */
async function readJobJson(body) {
    if (!(body instanceof Uint8Array)) { throw new Error('PUT body is not a Uint8Array'); }
    const blob = new Blob([body]);
    const reader = new ZipReader(new BlobReader(blob));
    const entries = await reader.getEntries();
    expect(entries.map((e) => e.filename)).toEqual(['job.json']);
    const entry = entries[0];
    if (typeof entry.getData === 'undefined') { throw new Error('no data'); }
    const text = await entry.getData(new TextWriter());
    await reader.close();
    return text;
}

describe('runWordExamplesJob', () => {
    test('полный цикл: create → PUT zip → submit → poll → результат (строкой)', async () => {
        const {fetch, calls} = makeFetch(jobRoutes());
        /** @type {string[]} */
        const phases = [];
        const result = await makeClient(fetch).runWordExamplesJob(['run'], {perWord: 2, onPhase: (p) => phases.push(p)});
        expect(result).toEqual(jobResult);
        expect(calls.map((c) => `${c.method} ${c.url.replace(BASE, '')}`)).toEqual([
            'POST /v1/route/jobs',
            `PUT ${UPLOAD_URL}`,
            'POST /v1/route/jobs/job-1/submit',
            'GET /v1/route/jobs/job-1',
            'GET /v1/route/jobs/job-1',
            'GET /v1/route/jobs/job-1',
        ]);
        expect(parseJson(String(calls[0].body))).toEqual({});
        expect(phases).toEqual(['submitted', 'waiting', 'processing', 'done']);
        const jobJson = parseJson(await readJobJson(calls[1].body));
        expect(jobJson).toEqual({
            type: 'word_examples',
            word_examples_request: {words: ['run'], lang: 'en', per_word: 2, kind: 'puzzle_movies'},
        });
    });
    test('PUT идёт БЕЗ Authorization и с Content-Type application/zip', async () => {
        const {fetch, calls} = makeFetch(jobRoutes());
        await makeClient(fetch).runWordExamplesJob(['run']);
        const put = calls[1];
        expect(put.method).toBe('PUT');
        expect(put.headers.has('Authorization')).toBe(false);
        expect(put.headers.get('Content-Type')).toBe('application/zip');
        for (const call of calls.filter((c) => c.url.startsWith(BASE))) {
            expect(call.headers.get('Authorization')).toBe(`Bearer ${FAKE_KEY}`);
        }
    });
    test('per_word по умолчанию 3', async () => {
        const {fetch, calls} = makeFetch(jobRoutes());
        await makeClient(fetch).runWordExamplesJob(['run']);
        expect(/** @type {{word_examples_request: {per_word: number}}} */ (parseJson(await readJobJson(calls[1].body))).word_examples_request.per_word).toBe(3);
    });
    test('response_content объектом — тоже принимается', async () => {
        const {fetch} = makeFetch(jobRoutes({'GET /v1/route/jobs/job-1': () => json({status: 'done', response_content: jobResult})}));
        expect(await makeClient(fetch).runWordExamplesJob(['run'])).toEqual(jobResult);
    });
    test('битый клип выброшен, результат сохранён', async () => {
        const content = {results: [{...jobResult.results[0], clips: [...jobResult.results[0].clips, {order_index: 'x', subs: []}]}]};
        const {fetch} = makeFetch(jobRoutes({'GET /v1/route/jobs/job-1': () => json({status: 'done', response_content: content})}));
        expect(await makeClient(fetch).runWordExamplesJob(['run'])).toEqual(jobResult);
    });
    test('response_content — невалидная строка → flib_bad_response', async () => {
        const {fetch} = makeFetch(jobRoutes({'GET /v1/route/jobs/job-1': () => json({status: 'done', response_content: '{oops'})}));
        expect((await catchCode(() => makeClient(fetch).runWordExamplesJob(['run']))).code).toBe('flib_bad_response');
    });
    test('status failed → flib_job_failed с текстом ошибки', async () => {
        const {fetch} = makeFetch(jobRoutes({'GET /v1/route/jobs/job-1': () => json({status: 'failed', error: 'daemon crashed'})}));
        const result = await catchCode(() => makeClient(fetch).runWordExamplesJob(['run']));
        expect(result.code).toBe('flib_job_failed');
        expect(result.data.error).toBe('daemon crashed');
    });
    test('status expired → flib_job_failed', async () => {
        const {fetch} = makeFetch(jobRoutes({'GET /v1/route/jobs/job-1': () => json({status: 'expired'})}));
        const result = await catchCode(() => makeClient(fetch).runWordExamplesJob(['run']));
        expect(result.code).toBe('flib_job_failed');
        expect(result.data.error).toBe('expired');
    });
    test('бюджет исчерпан → flib_job_timeout', async () => {
        let clock = 0;
        const {fetch, calls} = makeFetch(jobRoutes({'GET /v1/route/jobs/job-1': () => json({status: 'processing'})}));
        const client = makeClient(fetch, {
            now: () => clock,
            sleep: async (ms) => { clock += ms; },
        });
        const result = await catchCode(() => client.runWordExamplesJob(['run'], {budgetMs: 10000}));
        expect(result.code).toBe('flib_job_timeout');
        const polls = calls.filter((c) => c.method === 'GET').length;
        expect(polls).toBeGreaterThan(1);
        expect(polls).toBeLessThan(10);
    });
    test('интервалы опроса: сначала 1.5 с, потом 3 с', async () => {
        let clock = 0;
        /** @type {number[]} */
        const sleeps = [];
        const {fetch} = makeFetch(jobRoutes({'GET /v1/route/jobs/job-1': () => json({status: 'processing'})}));
        const client = makeClient(fetch, {
            now: () => clock,
            sleep: async (ms) => { sleeps.push(ms); clock += ms; },
        });
        await catchCode(() => client.runWordExamplesJob(['run'], {budgetMs: 30000}));
        expect(sleeps[0]).toBe(1500);
        expect(sleeps).toContain(3000);
        expect(sleeps.indexOf(3000)).toBeGreaterThan(0);
        expect(sleeps.slice(sleeps.indexOf(3000)).every((ms) => ms <= 3000)).toBe(true);
    });
    test('сигнал отмены → flib_aborted, опрос прекращается', async () => {
        const controller = new AbortController();
        let polls = 0;
        const {fetch} = makeFetch(jobRoutes({
            'GET /v1/route/jobs/job-1': () => {
                polls += 1;
                if (polls === 2) { controller.abort(); }
                return json({status: 'processing'});
            },
        }));
        const result = await catchCode(() => makeClient(fetch).runWordExamplesJob(['run'], {signal: controller.signal}));
        expect(result.code).toBe('flib_aborted');
        expect(polls).toBe(2);
    });
    test('уже отменённый сигнал → ни одного запроса', async () => {
        const controller = new AbortController();
        controller.abort();
        const {fetch, calls} = makeFetch(jobRoutes());
        expect((await catchCode(() => makeClient(fetch).runWordExamplesJob(['run'], {signal: controller.signal}))).code).toBe('flib_aborted');
        expect(calls).toHaveLength(0);
    });
    test('временный 503 при опросе не валит задание', async () => {
        const {fetch} = makeFetch(jobRoutes({
            'GET /v1/route/jobs/job-1': [
                () => json({error: 'saturated'}, 503),
                () => json({status: 'done', response_content: jobResult}),
            ],
        }));
        expect(await makeClient(fetch).runWordExamplesJob(['run'])).toEqual(jobResult);
    });
    test('401 при опросе — валит сразу', async () => {
        const {fetch} = makeFetch(jobRoutes({'GET /v1/route/jobs/job-1': () => json({error: 'unauthorized'}, 401)}));
        expect((await catchCode(() => makeClient(fetch).runWordExamplesJob(['run']))).code).toBe('flib_key_invalid');
    });
    test('429 на submit → flib_rate_limited', async () => {
        const {fetch} = makeFetch(jobRoutes({'POST /v1/route/jobs/job-1/submit': () => json({error: 'daily_limit'}, 429)}));
        expect((await catchCode(() => makeClient(fetch).runWordExamplesJob(['run']))).code).toBe('flib_rate_limited');
    });
    test('PUT вернул 403 → flib_upload_failed', async () => {
        const {fetch} = makeFetch(jobRoutes({[`PUT ${UPLOAD_URL}`]: () => new Response('denied', {status: 403})}));
        expect(await catchCode(() => makeClient(fetch).runWordExamplesJob(['run']))).toMatchObject({code: 'flib_upload_failed', status: 403});
    });
    test('create без job_id → flib_bad_response', async () => {
        const {fetch} = makeFetch(jobRoutes({'POST /v1/route/jobs': () => json({input_upload_url: UPLOAD_URL}, 201)}));
        expect((await catchCode(() => makeClient(fetch).runWordExamplesJob(['run']))).code).toBe('flib_bad_response');
    });
    test('пустой список слов отвергается до запроса', async () => {
        const {fetch, calls} = makeFetch({});
        expect((await catchCode(() => makeClient(fetch).runWordExamplesJob([]))).code).toBe('flib_bad_request');
        expect((await catchCode(() => makeClient(fetch).runWordExamplesJob(['  ']))).code).toBe('flib_bad_request');
        expect(calls).toHaveLength(0);
    });
});

describe('клипы по токену', () => {
    test('redeemClipToken → POST {token}, нормализованные клипы', async () => {
        const {fetch, calls} = makeFetch({
            'POST /v1/puzzle_movies/clips': () => json({
                batch_id: 'b-1',
                clips: [{clip_id: 'c-1', status: 'queued', order_index: 0}, {status: 'queued'}],
            }, 202),
        });
        const result = await makeClient(fetch).redeemClipToken('tok_1');
        expect(parseJson(String(calls[0].body))).toEqual({token: 'tok_1'});
        expect(result).toEqual({batch_id: 'b-1', clips: [{clip_id: 'c-1', status: 'queued', order_index: 0}]});
    });
    test('redeemClipToken без токена → flib_bad_request', async () => {
        const {fetch, calls} = makeFetch({});
        expect((await catchCode(() => makeClient(fetch).redeemClipToken(''))).code).toBe('flib_bad_request');
        expect(calls).toHaveLength(0);
    });
    test('403 demo_clip_limit_reached пробрасывается кодом', async () => {
        const {fetch} = makeFetch({'POST /v1/puzzle_movies/clips': () => json({error: 'demo_clip_limit_reached'}, 403)});
        expect((await catchCode(() => makeClient(fetch).redeemClipToken('tok'))).code).toBe('demo_clip_limit_reached');
    });
    test('getClip: поля и source; imdb_url только с https://www.imdb.com/title/', async () => {
        const {fetch} = makeFetch({
            'GET /v1/puzzle_movies/clips/c-1': () => json({
                clip_id: 'c-1',
                status: 'ready',
                duration_sec: 4.2,
                lead_trim_sec: 0.3,
                size_bytes: 12345,
                download_url: 'https://cdn.test/c-1.mp4',
                slug: 'secret-slug',
                source: {
                    title: 'Movie',
                    title_ru: 'Фильм',
                    year: 1999,
                    media_type: 1,
                    season: null,
                    episode: 2,
                    imdb_id: 'tt0133093',
                    imdb_url: 'https://www.imdb.com/title/tt0133093/',
                    director: 'X',
                },
            }),
            'GET /v1/puzzle_movies/clips/c-2': () => json({
                clip_id: 'c-2',
                status: 'queued',
                source: {title: 'Evil', imdb_url: 'javascript:alert(1)'},
            }),
        });
        const client = makeClient(fetch);
        expect(await client.getClip('c-1')).toEqual({
            clip_id: 'c-1',
            status: 'ready',
            duration_sec: 4.2,
            lead_trim_sec: 0.3,
            size_bytes: 12345,
            download_url: 'https://cdn.test/c-1.mp4',
            source: {
                title: 'Movie',
                title_ru: 'Фильм',
                year: 1999,
                media_type: 1,
                episode: 2,
                imdb_id: 'tt0133093',
                imdb_url: 'https://www.imdb.com/title/tt0133093/',
            },
        });
        const second = await client.getClip('c-2');
        expect(second.source).toEqual({title: 'Evil'});
        expect(second.download_url).toBeNull();
    });
    test('getClip: id с «/» отвергается до запроса', async () => {
        const {fetch, calls} = makeFetch({});
        expect((await catchCode(() => makeClient(fetch).getClip('../admin'))).code).toBe('flib_bad_request');
        expect(calls).toHaveLength(0);
    });
    test('getClip: неизвестный status → flib_bad_response', async () => {
        const {fetch} = makeFetch({'GET /v1/puzzle_movies/clips/c-1': () => json({clip_id: 'c-1', status: 'weird'})});
        expect((await catchCode(() => makeClient(fetch).getClip('c-1'))).code).toBe('flib_bad_response');
    });
    test('fetchClipData: байты и тип, Bearer', async () => {
        const bytes = new Uint8Array([0, 1, 2, 250]);
        const {fetch, calls} = makeFetch({
            'GET /v1/puzzle_movies/clips/c-1/data': () => new Response(bytes, {status: 200, headers: {'Content-Type': 'video/mp4'}}),
        });
        const result = await makeClient(fetch).fetchClipData('c-1');
        expect(new Uint8Array(result.data)).toEqual(bytes);
        expect(result.contentType).toBe('video/mp4');
        expect(calls[0].headers.get('Authorization')).toBe(`Bearer ${FAKE_KEY}`);
    });
    test('fetchClipData: 425 → flib_clip_not_ready', async () => {
        const {fetch} = makeFetch({'GET /v1/puzzle_movies/clips/c-1/data': () => json({error: 'not_ready', current_status: 'queued'}, 425)});
        expect(await catchCode(() => makeClient(fetch).fetchClipData('c-1'))).toMatchObject({code: 'flib_clip_not_ready', status: 425});
    });
    test('fetchClipData: больше maxBytes по Content-Length → flib_clip_too_large', async () => {
        const {fetch} = makeFetch({
            'GET /v1/puzzle_movies/clips/c-1/data': () => new Response(new Uint8Array(10), {status: 200, headers: {'Content-Length': '10'}}),
        });
        expect((await catchCode(() => makeClient(fetch).fetchClipData('c-1', {maxBytes: 5}))).code).toBe('flib_clip_too_large');
    });
    test('fetchClipData: больше maxBytes по факту → flib_clip_too_large', async () => {
        const {fetch} = makeFetch({
            'GET /v1/puzzle_movies/clips/c-1/data': () => new Response(new Uint8Array(10), {status: 200}),
        });
        expect((await catchCode(() => makeClient(fetch).fetchClipData('c-1', {maxBytes: 5}))).code).toBe('flib_clip_too_large');
    });
});

describe('encodeBase64Chunked', () => {
    test('совпадает с Buffer.toString("base64") на большом буфере', () => {
        const bytes = new Uint8Array(200001);
        for (let i = 0; i < bytes.length; ++i) { bytes[i] = (i * 31) & 0xff; }
        expect(encodeBase64Chunked(bytes.buffer)).toBe(Buffer.from(bytes).toString('base64'));
    });
    test('пустой буфер', () => {
        expect(encodeBase64Chunked(new ArrayBuffer(0))).toBe('');
    });
});
