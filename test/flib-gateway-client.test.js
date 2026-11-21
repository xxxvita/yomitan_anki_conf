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
import {FLIB_POS_TRANSLATE_SYSTEM_PROMPT} from '../ext/js/data/flib-pos.js';
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
 * @property {RequestRedirect | undefined} redirect
 * @property {AbortSignal | null | undefined} signal
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

/** Предохранитель: столько вызовов fetch не делает ни один сценарий; регрессия-зацикливание падает, а не вешает воркер vitest. */
const FETCH_FUSE = 100;

/**
 * Запрос, который не отвечает никогда — пока его не отменят через signal.
 * @param {RecordedCall} call
 * @returns {Promise<Response>}
 */
function hang(call) {
    return new Promise((_resolve, reject) => {
        call.signal?.addEventListener('abort', () => reject(call.signal?.reason), {once: true});
    });
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
        const call = {url, method, headers, body: init.body, redirect: init.redirect, signal: init.signal};
        calls.push(call);
        if (calls.length > FETCH_FUSE) {
            // 418 — нетранзиентная ошибка: клиент обязан её пробросить, и тест упадёт.
            return new Response('fuse blown', {status: 418});
        }
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
 * @typedef {object} ClientOptions
 * @property {string} [key]
 * @property {string} [base]
 * @property {() => number} [now]
 * @property {(ms: number, signal?: AbortSignal) => Promise<void>} [sleep]
 * @property {number} [requestTimeoutMs]
 * @property {(ms: number) => AbortSignal} [timeoutSignal]
 */

/**
 * По умолчанию часы поддельные и двигаются только сном: опрос задания всегда
 * упирается в бюджет за конечное число шагов, а не ждёт настоящие 4 минуты.
 * @param {typeof fetch} fetchImpl
 * @param {ClientOptions} [options]
 * @returns {FlibGatewayClient}
 */
function makeClient(fetchImpl, {key = FAKE_KEY, base = BASE, now, sleep, requestTimeoutMs, timeoutSignal} = {}) {
    let clock = 0;
    return new FlibGatewayClient({
        fetch: fetchImpl,
        getBase: () => base,
        getKey: () => key,
        now: now ?? (() => clock),
        sleep: sleep ?? (async (ms) => { clock += ms; }),
        requestTimeoutMs,
        timeoutSignal,
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
    test('C1: ключ и адрес можно отдавать асинхронно (хранилище flib-secrets)', async () => {
        const {fetch, calls} = makeFetch({'POST /v1/examples': () => json({word: 'run', items: [], empty_reason: 'not_in_corpus'})});
        const client = new FlibGatewayClient({fetch, getBase: async () => BASE, getKey: async () => FAKE_KEY});
        await client.getExamples('run');
        expect(calls[0].url).toBe(`${BASE}/v1/examples`);
        expect(calls[0].headers.get('Authorization')).toBe(`Bearer ${FAKE_KEY}`);
        const missing = new FlibGatewayClient({fetch, getBase: async () => BASE, getKey: async () => ''});
        expect((await catchCode(() => missing.getExamples('run'))).code).toBe('flib_key_missing');
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
    test('getClip: concatenating — клип ещё нарезается, а не испорченный ответ', async () => {
        const {fetch} = makeFetch({'GET /v1/puzzle_movies/clips/c-1': () => json({clip_id: 'c-1', status: 'concatenating'})});
        expect((await makeClient(fetch).getClip('c-1')).status).toBe('concatenating');
    });
    test('redeemClipToken: concatenating сохраняется', async () => {
        const {fetch} = makeFetch({'POST /v1/puzzle_movies/clips': () => json({batch_id: 'b-1', clips: [{clip_id: 'c-1', status: 'concatenating', order_index: 0}]})});
        expect((await makeClient(fetch).redeemClipToken('tok')).clips[0].status).toBe('concatenating');
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

describe('H2: таймауты запросов', () => {
    test('зависший запрос → flib_timeout, а не вечное ожидание', async () => {
        const {fetch} = makeFetch({'POST /v1/examples': hang});
        const client = makeClient(fetch, {requestTimeoutMs: 20});
        expect((await catchCode(() => client.getExamples('run'))).code).toBe('flib_timeout');
    });
    test('у каждого запроса есть signal, у PUT тоже', async () => {
        const {fetch, calls} = makeFetch(jobRoutes());
        await makeClient(fetch).runWordExamplesJob(['run']);
        for (const call of calls) {
            expect(call.signal).toBeInstanceOf(AbortSignal);
        }
    });
    test('таймаут запроса — 20 с, клипа — 60 с, и не больше остатка бюджета', async () => {
        /** @type {number[]} */
        const timeouts = [];
        /** @type {(ms: number) => AbortSignal} */
        const timeoutSignal = (ms) => {
            timeouts.push(ms);
            return new AbortController().signal;
        };
        const {fetch} = makeFetch({
            ...jobRoutes(),
            'POST /v1/examples': () => json({word: 'run', items: [goodItem], empty_reason: null}),
            'GET /v1/puzzle_movies/clips/c-1/data': () => new Response(new Uint8Array(1), {status: 200}),
        });
        const client = makeClient(fetch, {timeoutSignal});
        await client.getExamples('run');
        await client.fetchClipData('c-1');
        expect(timeouts).toEqual([20000, 60000]);
        timeouts.length = 0;
        await client.runWordExamplesJob(['run'], {budgetMs: 5000});
        expect(timeouts[0]).toBe(5000);
        expect(Math.max(...timeouts)).toBeLessThanOrEqual(5000);
    });
    test('зависший опрос — транзиентный: следующий опрос продолжает задание', async () => {
        const {fetch} = makeFetch(jobRoutes({
            'GET /v1/route/jobs/job-1': [
                hang,
                () => json({status: 'done', response_content: jobResult}),
            ],
        }));
        const client = makeClient(fetch, {requestTimeoutMs: 20});
        expect(await client.runWordExamplesJob(['run'])).toEqual(jobResult);
    });
    test('зависший create → flib_timeout', async () => {
        const {fetch} = makeFetch(jobRoutes({'POST /v1/route/jobs': hang}));
        expect((await catchCode(() => makeClient(fetch, {requestTimeoutMs: 20}).runWordExamplesJob(['run']))).code).toBe('flib_timeout');
    });
    test('отмена вызывающим во время запроса → flib_aborted, не flib_timeout', async () => {
        const controller = new AbortController();
        const {fetch} = makeFetch({
            'POST /v1/examples': (call) => {
                setTimeout(() => controller.abort(), 0);
                return hang(call);
            },
        });
        expect((await catchCode(() => makeClient(fetch).getExamples('run', {signal: controller.signal}))).code).toBe('flib_aborted');
    });
});

describe('H3: только https и без редиректов', () => {
    test('все запросы к шлюзу и PUT идут с redirect: "error"', async () => {
        const {fetch, calls} = makeFetch(jobRoutes());
        await makeClient(fetch).runWordExamplesJob(['run']);
        for (const call of calls) {
            expect(call.redirect).toBe('error');
        }
    });
    test('открытый http на чужой хост не используется — уходит на сервер по умолчанию', async () => {
        const {fetch, calls} = makeFetch({
            'POST https://cache.flib.club/v1/examples': () => json({word: 'run', items: [goodItem], empty_reason: null}),
        });
        await makeClient(fetch, {base: 'http://gw.test'}).getExamples('run');
        expect(calls[0].url).toBe('https://cache.flib.club/v1/examples');
    });
    test('открытый http на localhost — разрешён', async () => {
        const {fetch, calls} = makeFetch({
            'POST http://localhost:8080/v1/examples': () => json({word: 'run', items: [goodItem], empty_reason: null}),
        });
        await makeClient(fetch, {base: 'ws://localhost:8080/'}).getExamples('run');
        expect(calls[0].url).toBe('http://localhost:8080/v1/examples');
    });
    test('presigned-адрес по открытому http на чужой хост → flib_bad_response, PUT не уходит', async () => {
        const {fetch, calls} = makeFetch(jobRoutes({'POST /v1/route/jobs': () => json({job_id: 'job-1', input_upload_url: 'http://bucket.test/u'}, 201)}));
        expect((await catchCode(() => makeClient(fetch).runWordExamplesJob(['run']))).code).toBe('flib_bad_response');
        expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    });
});

describe('M3: бюджет задания', () => {
    test('по умолчанию 240 с, считая от начала create', async () => {
        let clock = 0;
        const {fetch} = makeFetch(jobRoutes({'GET /v1/route/jobs/job-1': () => json({status: 'processing'})}));
        const client = makeClient(fetch, {now: () => clock, sleep: async (ms) => { clock += ms; }});
        expect((await catchCode(() => client.runWordExamplesJob(['run']))).code).toBe('flib_job_timeout');
        expect(clock).toBe(240000);
    });
    test('время create входит в бюджет: долгий create → таймаут задания до загрузки', async () => {
        let clock = 0;
        const {fetch, calls} = makeFetch(jobRoutes({
            'POST /v1/route/jobs': () => {
                clock += 250000;
                return json({job_id: 'job-1', input_upload_url: UPLOAD_URL}, 201);
            },
        }));
        const client = makeClient(fetch, {now: () => clock});
        expect((await catchCode(() => client.runWordExamplesJob(['run']))).code).toBe('flib_job_timeout');
        expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
    });
});

describe('M4: потолок клипа без Content-Length', () => {
    test('поток режется на потолке и отменяется, а не читается целиком', async () => {
        let pulled = 0;
        let cancelled = false;
        const stream = new ReadableStream({
            pull(controller) {
                pulled += 1;
                controller.enqueue(new Uint8Array(4));
            },
            cancel() { cancelled = true; },
        });
        const {fetch} = makeFetch({'GET /v1/puzzle_movies/clips/c-1/data': () => new Response(stream, {status: 200})});
        expect((await catchCode(() => makeClient(fetch).fetchClipData('c-1', {maxBytes: 10}))).code).toBe('flib_clip_too_large');
        expect(cancelled).toBe(true);
        expect(pulled).toBeLessThan(10);
    });
    test('поток в пределах потолка собирается целиком', async () => {
        const stream = new ReadableStream({
            start(controller) {
                controller.enqueue(new Uint8Array([1, 2]));
                controller.enqueue(new Uint8Array([3]));
                controller.close();
            },
        });
        const {fetch} = makeFetch({'GET /v1/puzzle_movies/clips/c-1/data': () => new Response(stream, {status: 200})});
        const result = await makeClient(fetch).fetchClipData('c-1', {maxBytes: 3});
        expect([...new Uint8Array(result.data)]).toEqual([1, 2, 3]);
    });
});

describe('LOW-6: границы параметров', () => {
    test('limit зажимается в 1..10', async () => {
        const {fetch, calls} = makeFetch({'POST /v1/examples': () => json({word: 'run', items: [goodItem], empty_reason: null})});
        const client = makeClient(fetch);
        await client.getExamples('run', {limit: 0});
        await client.getExamples('run', {limit: 99});
        await client.getExamples('run', {limit: Number.NaN});
        expect(calls.map((c) => /** @type {{limit: number}} */ (parseJson(String(c.body))).limit)).toEqual([1, 10, 6]);
    });
    test('kind только youtube|film|any', async () => {
        const {fetch, calls} = makeFetch({'POST /v1/examples': () => json({word: 'run', items: [goodItem], empty_reason: null})});
        const client = makeClient(fetch);
        expect((await catchCode(() => client.getExamples('run', {kind: 'evil'}))).code).toBe('flib_bad_request');
        expect(calls).toHaveLength(0);
        await client.getExamples('run', {kind: 'film'});
        expect(/** @type {{kind: string}} */ (parseJson(String(calls[0].body))).kind).toBe('film');
    });
    test('perWord зажимается в 1..10', async () => {
        for (const [perWord, expected] of [[0, 1], [50, 10], [2.7, 2], [Number.NaN, 3]]) {
            const {fetch, calls} = makeFetch(jobRoutes());
            await makeClient(fetch).runWordExamplesJob(['run'], {perWord});
            const job = /** @type {{word_examples_request: {per_word: number}}} */ (parseJson(await readJobJson(calls[1].body)));
            expect(job.word_examples_request.per_word).toBe(expected);
        }
    });
    test('review M2: больше 10 слов → flib_bad_request, запросов нет', async () => {
        const {fetch, calls} = makeFetch(jobRoutes());
        const words = Array.from({length: 11}, (_, i) => `w${i}`);
        expect((await catchCode(() => makeClient(fetch).runWordExamplesJob(words))).code).toBe('flib_bad_request');
        expect(calls).toHaveLength(0);
    });
    test('review M2: слово длиннее 80 кодовых точек → flib_word_too_long, запросов нет', async () => {
        const {fetch, calls} = makeFetch(jobRoutes());
        expect((await catchCode(() => makeClient(fetch).runWordExamplesJob(['run', '😀'.repeat(81)]))).code).toBe('flib_word_too_long');
        expect(calls).toHaveLength(0);
        // 80 кодовых точек (160 UTF-16) — ещё можно.
        const ok = makeFetch(jobRoutes());
        await makeClient(ok.fetch).runWordExamplesJob(['😀'.repeat(80)]);
        expect(ok.calls.length).toBeGreaterThan(0);
    });
});

describe('предохранитель поддельной сети', () => {
    test('после 100 вызовов fetch отвечает нетранзиентной ошибкой', async () => {
        const {fetch} = makeFetch(jobRoutes({'GET /v1/route/jobs/job-1': () => json({status: 'processing'})}));
        const client = makeClient(fetch, {sleep: async () => {}, now: () => 0});
        const result = await catchCode(() => client.runWordExamplesJob(['run']));
        expect(result).toMatchObject({code: 'flib_http_error', status: 418});
    });
});

describe('LOW: старые браузеры без AbortSignal.any/timeout', () => {
    test('зависший запрос с сигналом вызывающего всё равно обрывается по таймауту', async () => {
        const anyDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'any');
        const timeoutDescriptor = Object.getOwnPropertyDescriptor(AbortSignal, 'timeout');
        Object.defineProperty(AbortSignal, 'any', {value: void 0, configurable: true, writable: true});
        Object.defineProperty(AbortSignal, 'timeout', {value: void 0, configurable: true, writable: true});
        try {
            const {fetch} = makeFetch({'POST /v1/examples': hang});
            const client = makeClient(fetch, {requestTimeoutMs: 20});
            const controller = new AbortController();
            expect((await catchCode(() => client.getExamples('run', {signal: controller.signal}))).code).toBe('flib_timeout');
        } finally {
            if (typeof anyDescriptor !== 'undefined') { Object.defineProperty(AbortSignal, 'any', anyDescriptor); }
            if (typeof timeoutDescriptor !== 'undefined') { Object.defineProperty(AbortSignal, 'timeout', timeoutDescriptor); }
        }
    });
});

describe('detectPartOfSpeech', () => {
    const ROUTE = 'POST /v1/openai/chat/completions';
    /**
     * @param {string} content
     * @returns {Response}
     */
    const chat = (content) => json({choices: [{message: {role: 'assistant', content}}]});

    test('pos ok: asks the OpenAI proxy with the key and returns the canonical part of speech', async () => {
        const {fetch, calls} = makeFetch({[ROUTE]: () => chat('{"pos":"Verb"}')});
        expect(await makeClient(fetch).detectPartOfSpeech('booked', 'I booked a table')).toStrictEqual({pos: 'verb'});
        expect(calls).toHaveLength(1);
        expect(calls[0].url).toBe(`${BASE}/v1/openai/chat/completions`);
        expect(calls[0].headers.get('Authorization')).toBe(`Bearer ${FAKE_KEY}`);
        const body = /** @type {{messages: {content: string}[]}} */ (parseJson(String(calls[0].body)));
        expect(parseJson(body.messages[1].content.slice(6))).toStrictEqual({w: 'booked', s: 'I booked a table'});
    });

    test.each([
        ['401 text', () => new Response('unauthorized', {status: 401}), 'flib_key_invalid'],
        ['403 text', () => new Response('API key revoked', {status: 403}), 'flib_key_invalid'],
        ['429 quota', () => json({error: 'quota_exhausted', service: 'openai', used: 1, limit: 1}, 429), 'llm_quota_exhausted'],
        ['429 rate', () => json({error: {message: 'slow down', type: 'rate_limit_error', code: 'rpm_exceeded'}}, 429), 'flib_rate_limited'],
        ['404', () => new Response('not found', {status: 404}), 'flib_service_unavailable'],
        ['502', () => json({error: {type: 'upstream_error', code: 'openai_error'}}, 502), 'flib_service_unavailable'],
        ['503', () => json({error: {type: 'server_error'}}, 503), 'flib_service_unavailable'],
        ['bad answer text', () => chat('hello'), 'llm_bad_answer'],
        ['bad answer shape', () => json({id: 'x'}), 'llm_bad_answer'],
    ])('pos %s', async (_name, respond, code) => {
        const {fetch} = makeFetch({[ROUTE]: respond});
        expect((await catchCode(() => makeClient(fetch).detectPartOfSpeech('book', 'book a table'))).code).toBe(code);
    });

    test('pos network failure → flib_service_unavailable', async () => {
        /** @type {typeof fetch} */
        const failing = async () => { throw new TypeError('Failed to fetch'); };
        expect((await catchCode(() => makeClient(failing).detectPartOfSpeech('book', 'book a table'))).code).toBe('flib_service_unavailable');
    });

    test.each([['', 'book a table'], ['book', '   ']])('pos empty input (%j, %j) → flib_word_empty without a request', async (word, sentence) => {
        const {fetch, calls} = makeFetch({});
        expect((await catchCode(() => makeClient(fetch).detectPartOfSpeech(word, sentence))).code).toBe('flib_word_empty');
        expect(calls).toHaveLength(0);
    });

    test('pos without a key → flib_key_missing', async () => {
        const {fetch, calls} = makeFetch({});
        expect((await catchCode(() => makeClient(fetch, {key: ''}).detectPartOfSpeech('book', 'book a table'))).code).toBe('flib_key_missing');
        expect(calls).toHaveLength(0);
    });
});

test('detectPartOfSpeech: 200 with a non-JSON body → llm_bad_answer', async () => {
    const {fetch} = makeFetch({'POST /v1/openai/chat/completions': () => new Response('<html>', {status: 200})});
    expect((await catchCode(() => makeClient(fetch).detectPartOfSpeech('book', 'book a table'))).code).toBe('llm_bad_answer');
});

describe('detectPartOfSpeechWithTranslation', () => {
    const ROUTE = 'POST /v1/openai/chat/completions';
    /**
     * @param {string} content
     * @returns {Response}
     */
    const chat = (content) => json({choices: [{message: {role: 'assistant', content}}]});
    const TR = '\u042f \u0437\u0430\u0431\u0440\u043e\u043d\u0438\u0440\u043e\u0432\u0430\u043b \u0441\u0442\u043e\u043b\u0438\u043a.';

    test('pos and translation: uses the combined prompt', async () => {
        const {fetch, calls} = makeFetch({[ROUTE]: () => chat(JSON.stringify({pos: 'verb', tr: TR}))});
        expect(await makeClient(fetch).detectPartOfSpeechWithTranslation('booked', 'I booked a table')).toStrictEqual({pos: 'verb', translation: TR});
        expect(calls).toHaveLength(1);
        const body = /** @type {{messages: {content: string}[]}} */ (parseJson(String(calls[0].body)));
        expect(body.messages[0].content).toBe(FLIB_POS_TRANSLATE_SYSTEM_PROMPT);
        expect(parseJson(body.messages[1].content.slice(6))).toStrictEqual({w: 'booked', s: 'I booked a table'});
    });

    test('missing tr → translation null, no throw', async () => {
        const {fetch} = makeFetch({[ROUTE]: () => chat('{"pos":"verb"}')});
        expect(await makeClient(fetch).detectPartOfSpeechWithTranslation('booked', 'I booked a table')).toStrictEqual({pos: 'verb', translation: null});
    });

    test('missing pos → pos null, no throw', async () => {
        const {fetch} = makeFetch({[ROUTE]: () => chat('{"tr":"X"}')});
        expect(await makeClient(fetch).detectPartOfSpeechWithTranslation('booked', 'I booked a table')).toStrictEqual({pos: null, translation: 'X'});
    });

    test('both halves missing → llm_bad_answer', async () => {
        const {fetch} = makeFetch({[ROUTE]: () => chat('{"x":1}')});
        expect((await catchCode(() => makeClient(fetch).detectPartOfSpeechWithTranslation('booked', 'I booked a table'))).code).toBe('llm_bad_answer');
    });

    test.each([['', 'book a table'], ['book', '   ']])('empty input (%j, %j) → flib_word_empty without a request', async (word, sentence) => {
        const {fetch, calls} = makeFetch({});
        expect((await catchCode(() => makeClient(fetch).detectPartOfSpeechWithTranslation(word, sentence))).code).toBe('flib_word_empty');
        expect(calls).toHaveLength(0);
    });
});

describe('synthesizeSpeech', () => {
    const ROUTE = 'POST /v1/text-to-speech/HCfhOrkFKTGCSl4c8rjs';
    /**
     * @param {string} cache
     * @returns {Response}
     */
    const mp3 = (cache) => new Response(new Uint8Array([0x49, 0x44, 0x33, 1, 2, 3]), {status: 200, headers: {'Content-Type': 'audio/mpeg', 'X-TTS-Cache': cache}});

    test('speech ok: exact body without query, base64 and cache flag', async () => {
        const {fetch, calls} = makeFetch({[ROUTE]: () => mp3('hit')});
        expect(await makeClient(fetch).synthesizeSpeech(' live ')).toStrictEqual({base64: 'SUQzAQID', cached: true});
        expect(calls[0].url).toBe(`${BASE}/v1/text-to-speech/HCfhOrkFKTGCSl4c8rjs`);
        expect(String(calls[0].body)).toBe('{"text":"live","model_id":"eleven_multilingual_v2"}');
        expect(calls[0].headers.get('Authorization')).toBe(`Bearer ${FAKE_KEY}`);
    });

    test('speech miss → cached false', async () => {
        const {fetch} = makeFetch({[ROUTE]: () => mp3('miss')});
        expect((await makeClient(fetch).synthesizeSpeech('live')).cached).toBe(false);
    });

    test.each([
        ['quota', () => json({error: 'quota_exhausted', service: 'elevenlabs_tts', used: 1, limit: 1}, 429), 'tts_quota_exhausted'],
        ['403 text', () => new Response('API key expired', {status: 403}), 'flib_key_invalid'],
        ['401', () => new Response('unauthorized', {status: 401}), 'flib_key_invalid'],
        ['400 provider', () => json({detail: {status: 'invalid'}}, 400), 'tts_failed'],
        ['empty body', () => new Response(new Uint8Array(0), {status: 200, headers: {'Content-Type': 'audio/mpeg'}}), 'tts_failed'],
        ['503', () => new Response('busy', {status: 503}), 'flib_service_unavailable'],
    ])('speech %s', async (_name, respond, code) => {
        const {fetch} = makeFetch({[ROUTE]: respond});
        expect((await catchCode(() => makeClient(fetch).synthesizeSpeech('live'))).code).toBe(code);
    });

    test('speech empty text → tts_failed without a request', async () => {
        const {fetch, calls} = makeFetch({});
        expect((await catchCode(() => makeClient(fetch).synthesizeSpeech('  '))).code).toBe('tts_failed');
        expect(calls).toHaveLength(0);
    });
});

describe('chatJson', () => {
    test('chat content: returns the first choice text', async () => {
        const {fetch} = makeFetch({'POST /v1/openai/chat/completions': () => json({choices: [{message: {content: '{"tr":"жить"}'}}]})});
        expect(await makeClient(fetch).chatJson({messages: []})).toBe('{"tr":"жить"}');
    });

    test('chat without content → llm_bad_answer', async () => {
        const {fetch} = makeFetch({'POST /v1/openai/chat/completions': () => json({choices: []})});
        expect((await catchCode(() => makeClient(fetch).chatJson({messages: []}))).code).toBe('llm_bad_answer');
    });
});

test('chatJson: a 400 from the proxy is a rejection, not "server unavailable" (no retry)', async () => {
    const {fetch} = makeFetch({'POST /v1/openai/chat/completions': () => json({error: {type: 'invalid_request_error'}}, 400)});
    expect((await catchCode(() => makeClient(fetch).chatJson({messages: []}))).code).toBe('llm_rejected');
});

describe('route events', () => {
    const ROUTE_ID = '123e4567-e89b-42d3-a456-426614174000';
    const STATE = 'GET /v1/route/state';
    const EVENTS = 'POST /v1/route/external-events';
    /** @type {import('flib-events').FlibWireEvent[]} */
    const events = [{event_id: 'ext:yomitan:a', type: 'hint_requested', puzzle_id: 'p1', lemmas: ['run'], subs_source: 'yomitan_web'}];

    test('getRouteId: uuid, GET without query and with Bearer', async () => {
        const {fetch, calls} = makeFetch({[STATE]: () => json({route_id: ROUTE_ID})});
        expect(await makeClient(fetch).getRouteId()).toBe(ROUTE_ID);
        expect(calls[0].url).toBe(`${BASE}/v1/route/state`);
        expect(calls[0].headers.get('Authorization')).toBe(`Bearer ${FAKE_KEY}`);
    });
    test('getRouteId: null and absent route_id → null', async () => {
        expect(await makeClient(makeFetch({[STATE]: () => json({route_id: null})}).fetch).getRouteId()).toBeNull();
        expect(await makeClient(makeFetch({[STATE]: () => json({})}).fetch).getRouteId()).toBeNull();
    });
    test('getRouteId: non-uuid route_id → flib_bad_response', async () => {
        const {fetch} = makeFetch({[STATE]: () => json({route_id: 'nope'})});
        expect((await catchCode(() => makeClient(fetch).getRouteId())).code).toBe('flib_bad_response');
    });
    test('getRouteId: 401 → flib_key_invalid', async () => {
        const {fetch} = makeFetch({[STATE]: () => json({error: 'unauthorized'}, 401)});
        expect((await catchCode(() => makeClient(fetch).getRouteId())).code).toBe('flib_key_invalid');
    });

    test('postExternalEvents: 200 with rejected → counts and rejectedIds; exact request', async () => {
        const {fetch, calls} = makeFetch({[EVENTS]: () => json({accepted: 2, duplicates: 1, rejected: [{index: 1, event_id: 'ext:yomitan:b', reason: 'bad'}], evicted_external: 0})});
        const result = await makeClient(fetch).postExternalEvents(ROUTE_ID, events);
        expect(result).toEqual({kind: 'ok', accepted: 2, duplicates: 1, rejectedIds: ['ext:yomitan:b']});
        expect(calls[0].method).toBe('POST');
        expect(calls[0].headers.get('Authorization')).toBe(`Bearer ${FAKE_KEY}`);
        expect(parseJson(/** @type {string} */ (calls[0].body))).toEqual({route_id: ROUTE_ID, events});
    });
    test('postExternalEvents: 409 stale_route → routeId from top level', async () => {
        const {fetch} = makeFetch({[EVENTS]: () => json({error: 'stale_route', code: 'stale_route', route_id: ROUTE_ID}, 409)});
        expect(await makeClient(fetch).postExternalEvents('x', events)).toEqual({kind: 'http', status: 409, error: 'stale_route', routeId: ROUTE_ID, retryAfterSec: null});
    });
    test('postExternalEvents: error = body.code when it is a string', async () => {
        const {fetch} = makeFetch({[EVENTS]: () => json({error: 'route_forbidden: no', code: 'route_forbidden'}, 403)});
        expect(await makeClient(fetch).postExternalEvents(ROUTE_ID, events)).toMatchObject({kind: 'http', status: 403, error: 'route_forbidden'});
    });
    test('postExternalEvents: 429 Retry-After 7 → 7; clamped to [1, 3600]', async () => {
        /**
         * @param {string} value
         * @returns {typeof fetch}
         */
        const withRetry = (value) => makeFetch({[EVENTS]: () => new Response('{"error":"rate_limited"}', {status: 429, headers: {'Retry-After': value}})}).fetch;
        expect(await makeClient(withRetry('7')).postExternalEvents(ROUTE_ID, events)).toMatchObject({status: 429, retryAfterSec: 7});
        expect(await makeClient(withRetry('0')).postExternalEvents(ROUTE_ID, events)).toMatchObject({retryAfterSec: 1});
        expect(await makeClient(withRetry('999999')).postExternalEvents(ROUTE_ID, events)).toMatchObject({retryAfterSec: 3600});
        expect(await makeClient(withRetry('soon')).postExternalEvents(ROUTE_ID, events)).toMatchObject({retryAfterSec: null});
    });
    test('postExternalEvents: 404 not_found, 413, 500 are results, not throws', async () => {
        expect(await makeClient(makeFetch({[EVENTS]: () => json({error: 'not_found', code: 'not_found'}, 404)}).fetch).postExternalEvents(ROUTE_ID, events))
            .toEqual({kind: 'http', status: 404, error: 'not_found', routeId: null, retryAfterSec: null});
        expect(await makeClient(makeFetch({[EVENTS]: () => json({error: 'too_large'}, 413)}).fetch).postExternalEvents(ROUTE_ID, events))
            .toMatchObject({kind: 'http', status: 413, error: 'too_large'});
        expect(await makeClient(makeFetch({[EVENTS]: () => new Response('boom', {status: 500})}).fetch).postExternalEvents(ROUTE_ID, events))
            .toEqual({kind: 'http', status: 500, error: null, routeId: null, retryAfterSec: null});
    });
    test('postExternalEvents: 200 with non-JSON body → http bad_response', async () => {
        const {fetch} = makeFetch({[EVENTS]: () => new Response('<html>', {status: 200})});
        expect(await makeClient(fetch).postExternalEvents(ROUTE_ID, events))
            .toEqual({kind: 'http', status: 200, error: 'bad_response', routeId: null, retryAfterSec: null});
    });
    test('postExternalEvents: network failure → flib_network; bad key → no request', async () => {
        const failing = /** @type {typeof fetch} */ (async () => { throw new TypeError('Failed to fetch'); });
        expect((await catchCode(() => makeClient(failing).postExternalEvents(ROUTE_ID, events))).code).toBe('flib_network');
        const {fetch, calls} = makeFetch({});
        expect((await catchCode(() => makeClient(fetch, {key: ''}).postExternalEvents(ROUTE_ID, events))).code).toBe('flib_key_missing');
        expect((await catchCode(() => makeClient(fetch, {key: 'bad'}).postExternalEvents(ROUTE_ID, events))).code).toBe('flib_key_invalid');
        expect(calls).toHaveLength(0);
    });
    test('regression: getExamples still throws a coded error on non-2xx after the _send split', async () => {
        const {fetch} = makeFetch({'POST /v1/examples': () => json({error: 'examples_quota_exhausted'}, 403)});
        expect(await catchCode(() => makeClient(fetch).getExamples('run'))).toMatchObject({code: 'examples_quota_exhausted', status: 403});
    });
});

describe('examplesBatch', () => {
    const batchItem = {...goodItem, title: 'Cooking', channel: 'Kitchen', fragment: {start_ms: 500, end_ms: 4000}, known_share: 0.91};
    const batchBody = (/** @type {Record<string, unknown>} */ extra = {}) => ({
        known_source: 'route',
        known_rev: 42,
        partial: false,
        results: [{index: 0, text: 'give up', mode: 'lemma', items: [batchItem], empty_reason: null}],
        ...extra,
    });
    const targets = [{text: 'give up', mode: /** @type {'lemma'} */ ('lemma')}];

    test('тело запроса точное, known_share и поля разобраны', async () => {
        const {fetch, calls} = makeFetch({'POST /v1/examples/batch': () => json(batchBody())});
        const result = await makeClient(fetch).examplesBatch({targets, limit: 9, rank: 'known'});
        expect(calls[0].url).toBe(`${BASE}/v1/examples/batch`);
        expect(parseJson(String(calls[0].body))).toEqual({targets, limit: 5, rank: 'known'});
        expect(result.known_source).toBe('route');
        expect(result.partial).toBe(false);
        expect(result.results[0]).toEqual({index: 0, text: 'give up', mode: 'lemma', items: [batchItem], empty_reason: null});
    });
    test('элемент с негодным ref выброшен; known_source "weird" → none', async () => {
        const {fetch} = makeFetch({'POST /v1/examples/batch': () => json(batchBody({
            known_source: 'weird',
            results: [{index: 0, text: 'x', mode: 'quote', items: [{...batchItem, ref: 'bad ref'}, batchItem, {...batchItem, known_share: 7, fragment: {start_ms: 'a', end_ms: 2}}], empty_reason: null}],
        }))});
        const result = await makeClient(fetch).examplesBatch({targets, rank: 'plain'});
        expect(result.known_source).toBe('none');
        expect(result.results[0].items).toHaveLength(2);
        expect(result.results[0].items[1].known_share).toBeNull();
        expect(result.results[0].items[1].fragment).toEqual({start_ms: null, end_ms: 2});
    });
    test('пустой results допустим', async () => {
        const {fetch} = makeFetch({'POST /v1/examples/batch': () => json(batchBody({results: []}))});
        expect((await makeClient(fetch).examplesBatch({targets, rank: 'plain'})).results).toEqual([]);
    });
    test('31 цель и пустой список → flib_bad_request до запроса', async () => {
        const {fetch, calls} = makeFetch({});
        const many = Array.from({length: 31}, () => targets[0]);
        expect((await catchCode(() => makeClient(fetch).examplesBatch({targets: many, rank: 'plain'}))).code).toBe('flib_bad_request');
        expect((await catchCode(() => makeClient(fetch).examplesBatch({targets: [], rank: 'plain'}))).code).toBe('flib_bad_request');
        expect(calls).toHaveLength(0);
    });
    test('K10: элементов не больше запрошенного limit, результатов не больше целей', async () => {
        const many = Array.from({length: 4}, (_, i) => ({...batchItem, start_ms: i}));
        const result0 = {index: 0, text: 'give up', mode: 'lemma', items: many, empty_reason: null};
        const {fetch} = makeFetch({'POST /v1/examples/batch': () => json(batchBody({results: [result0, {...result0, index: 1}, {...result0, index: 2}]}))});
        const result = await makeClient(fetch).examplesBatch({targets, limit: 2, rank: 'plain'});
        expect(result.results).toHaveLength(1);
        expect(result.results[0].items.map((i) => i.start_ms)).toEqual([0, 1]);
    });
    test('404 text/plain → flib_axis_off со статусом 404', async () => {
        const {fetch} = makeFetch({'POST /v1/examples/batch': () => new Response('404 page not found', {status: 404, headers: {'Content-Type': 'text/plain'}})});
        expect(await catchCode(() => makeClient(fetch).examplesBatch({targets, rank: 'plain'}))).toMatchObject({code: 'flib_axis_off', status: 404});
    });
    test('404 {"error":"not found"} → flib_axis_off', async () => {
        const {fetch} = makeFetch({'POST /v1/examples/batch': () => json({error: 'not found'}, 404)});
        expect((await catchCode(() => makeClient(fetch).examplesBatch({targets, rank: 'plain'}))).code).toBe('flib_axis_off');
    });
    test('403 examples_quota_exhausted и examples_forbidden', async () => {
        const quota = makeFetch({'POST /v1/examples/batch': () => json({error: 'examples_quota_exhausted', used: 10, limit: 10}, 403)});
        expect((await catchCode(() => makeClient(quota.fetch).examplesBatch({targets, rank: 'plain'}))).code).toBe('examples_quota_exhausted');
        const forb = makeFetch({'POST /v1/examples/batch': () => json({error: 'examples_forbidden'}, 403)});
        expect((await catchCode(() => makeClient(forb.fetch).examplesBatch({targets, rank: 'plain'}))).code).toBe('examples_forbidden');
    });
    test('429 Retry-After: 7 → flib_rate_limited, retryAfterSec 7', async () => {
        const {fetch} = makeFetch({'POST /v1/examples/batch': () => new Response(JSON.stringify({error: 'rate_limited'}), {status: 429, headers: {'Retry-After': '7'}})});
        expect(await catchCode(() => makeClient(fetch).examplesBatch({targets, rank: 'plain'}))).toMatchObject({code: 'flib_rate_limited', status: 429, data: {retryAfterSec: 7}});
    });
    test('503 → flib_service_unavailable, retryAfterSec из заголовка', async () => {
        const {fetch} = makeFetch({'POST /v1/examples/batch': () => new Response(JSON.stringify({error: 'daemon_unavailable'}), {status: 503, headers: {'Retry-After': '99999'}})});
        expect(await catchCode(() => makeClient(fetch).examplesBatch({targets, rank: 'plain'}))).toMatchObject({code: 'flib_service_unavailable', data: {retryAfterSec: 3600}});
    });
});

describe('understandable*', () => {
    const targets = [{text: 'give up', mode: /** @type {'lemma'} */ ('lemma')}];
    const id = (/** @type {number} */ n) => String(n).padStart(11, 'a');

    test('start: exclude_video_ids фильтруется, дедуп, максимум 1000; 202 → {jobId, pollAfterMs}', async () => {
        const {fetch, calls} = makeFetch({'POST /v1/videos/understandable': () => json({job_id: 'j-1', status: 'queued', poll_after_ms: 2000}, 202)});
        const exclude = ['dQw4w9WgXcQ', 'dQw4w9WgXcQ', 'bad', ...Array.from({length: 1100}, (_, i) => id(i))];
        const result = await makeClient(fetch).understandableStart({targets, limit: 5, excludeVideoIds: exclude});
        expect(result).toEqual({jobId: 'j-1', pollAfterMs: 2000});
        const sent = /** @type {{targets: unknown, limit: number, exclude_video_ids: string[]}} */ (parseJson(String(calls[0].body)));
        expect(sent.targets).toEqual(targets);
        expect(sent.limit).toBe(5);
        expect(sent.exclude_video_ids).toHaveLength(1000);
        expect(sent.exclude_video_ids.filter((v) => v === 'dQw4w9WgXcQ')).toHaveLength(1);
        expect(sent.exclude_video_ids).not.toContain('bad');
    });
    test('start: 409 route_profile_missing', async () => {
        const {fetch} = makeFetch({'POST /v1/videos/understandable': () => json({error: 'route_profile_missing', code: 'route_profile_missing'}, 409)});
        expect(await catchCode(() => makeClient(fetch).understandableStart({targets}))).toMatchObject({code: 'route_profile_missing', status: 409});
    });
    test('start: 403 route_forbidden с человеческим error и code', async () => {
        const {fetch} = makeFetch({'POST /v1/videos/understandable': () => json({error: 'route_forbidden: key lacks allow_route permission', code: 'route_forbidden'}, 403)});
        expect((await catchCode(() => makeClient(fetch).understandableStart({targets}))).code).toBe('route_forbidden');
    });
    test('start: 403 understandable_demo_forbidden', async () => {
        const {fetch} = makeFetch({'POST /v1/videos/understandable': () => json({error: 'understandable_demo_forbidden'}, 403)});
        expect((await catchCode(() => makeClient(fetch).understandableStart({targets}))).code).toBe('understandable_demo_forbidden');
    });
    test('start: 404 text/plain → flib_axis_off; 429 с Retry-After', async () => {
        const off = makeFetch({'POST /v1/videos/understandable': () => new Response('404 page not found', {status: 404})});
        expect((await catchCode(() => makeClient(off.fetch).understandableStart({targets}))).code).toBe('flib_axis_off');
        const busy = makeFetch({'POST /v1/videos/understandable': () => new Response(JSON.stringify({error: 'too_many_open_jobs'}), {status: 429, headers: {'Retry-After': '5'}})});
        expect(await catchCode(() => makeClient(busy.fetch).understandableStart({targets}))).toMatchObject({code: 'flib_rate_limited', data: {retryAfterSec: 5}});
    });
    test('start: 31 цель → flib_bad_request без запроса; пустой job_id → flib_bad_response', async () => {
        const {fetch, calls} = makeFetch({'POST /v1/videos/understandable': () => json({status: 'queued'}, 202)});
        const many = Array.from({length: 31}, () => targets[0]);
        expect((await catchCode(() => makeClient(fetch).understandableStart({targets: many}))).code).toBe('flib_bad_request');
        expect(calls).toHaveLength(0);
        expect((await catchCode(() => makeClient(fetch).understandableStart({targets}))).code).toBe('flib_bad_response');
    });
    test('poll: done — элементы очищены, <img> остаётся строкой, негодный video_id выброшен', async () => {
        const hit = (/** @type {unknown} */ t) => ({from_ms: 1, to_ms: 2, text_en: t});
        const {fetch, calls} = makeFetch({'GET /v1/videos/understandable/a%2Fb': () => json({
            job_id: 'a/b',
            status: 'done',
            partial: true,
            error: null,
            results: [{index: 0,
                text: 'give up',
                mode: 'lemma',
                empty_reason: null,
                items: [
                    {video_id: 'dQw4w9WgXcQ', title: 'T', channel_id: 'UC1', duration_s: 312.4, coverage: 0.93, target_hits: [hit('<img src=x onerror=1>'), hit('b'), hit('c'), hit('d'), {from_ms: 'x', to_ms: 2, text_en: 'z'}]},
                    {video_id: 'bad id', title: 'X', coverage: 0.5, target_hits: []},
                    {video_id: 'aaaaaaaaaaa', coverage: 5, target_hits: [], target_hits_unavailable: true},
                ]}],
        })});
        const job = await makeClient(fetch).understandablePoll('a/b');
        expect(calls[0].method).toBe('GET');
        expect(job.status).toBe('done');
        expect(job.partial).toBe(true);
        expect(job.errorCode).toBeNull();
        const items = job.results?.[0].items ?? [];
        expect(items).toHaveLength(2);
        expect(items[0]).toEqual({video_id: 'dQw4w9WgXcQ', title: 'T', channel_id: 'UC1', duration_s: 312.4, coverage: 0.93, target_hits: [hit('<img src=x onerror=1>'), hit('b'), hit('c')], target_hits_unavailable: false});
        expect(items[1]).toMatchObject({video_id: 'aaaaaaaaaaa', coverage: null, target_hits: [], target_hits_unavailable: true, title: null});
    });
    test.each(['../etc', 'a b', 'a'.repeat(129), 'job/1', 'джоб'])('K10: start с job_id %j → flib_bad_response', async (jobId) => {
        const {fetch} = makeFetch({'POST /v1/videos/understandable': () => json({job_id: jobId, status: 'queued', poll_after_ms: 2000}, 202)});
        expect((await catchCode(() => makeClient(fetch).understandableStart({targets}))).code).toBe('flib_bad_response');
    });
    test('K10: start с job_id из [A-Za-z0-9_-] до 128 знаков принимается', async () => {
        const jobId = `Ab_9-${'x'.repeat(123)}`;
        const {fetch} = makeFetch({'POST /v1/videos/understandable': () => json({job_id: jobId, status: 'queued', poll_after_ms: 2000}, 202)});
        expect((await makeClient(fetch).understandableStart({targets})).jobId).toBe(jobId);
    });
    test('K10: poll — duration_s < 0 → null; не больше 5 элементов на цель и 30 результатов', async () => {
        const item = (/** @type {number} */ n) => ({video_id: id(n), title: null, channel_id: null, duration_s: n === 0 ? -5 : 60, coverage: 0.5, target_hits: []});
        const result = (/** @type {number} */ index) => ({index, text: 'x', mode: 'lemma', empty_reason: null, items: Array.from({length: 7}, (_, i) => item(i))});
        const {fetch} = makeFetch({'GET /v1/videos/understandable/j1': () => json({status: 'done', results: Array.from({length: 31}, (_, i) => result(i))})});
        const job = await makeClient(fetch).understandablePoll('j1');
        expect(job.results).toHaveLength(30);
        expect(job.results?.[0].items).toHaveLength(5);
        expect(job.results?.[0].items[0].duration_s).toBeNull();
        expect(job.results?.[0].items[1].duration_s).toBe(60);
    });
    test('poll: failed с error.code → errorCode, results null', async () => {
        const {fetch} = makeFetch({'GET /v1/videos/understandable/j1': () => json({status: 'failed', error: {code: 'daemon_busy'}})});
        expect(await makeClient(fetch).understandablePoll('j1')).toEqual({status: 'failed', partial: false, errorCode: 'daemon_busy', results: null});
    });
    test('poll: 404 job_not_found → flib_job_not_found; чужой 404 → flib_axis_off', async () => {
        const nf = makeFetch({'GET /v1/videos/understandable/j1': () => json({error: 'job_not_found', code: 'job_not_found'}, 404)});
        expect(await catchCode(() => makeClient(nf.fetch).understandablePoll('j1'))).toMatchObject({code: 'flib_job_not_found', status: 404});
        const off = makeFetch({'GET /v1/videos/understandable/j1': () => new Response('404 page not found', {status: 404})});
        expect((await catchCode(() => makeClient(off.fetch).understandablePoll('j1'))).code).toBe('flib_axis_off');
    });
    test('cancel: 200 ок, 404 job_not_found проглочен, прочее бросает', async () => {
        const ok = makeFetch({'DELETE /v1/videos/understandable/j1': () => json({status: 'cancelled', was: 'running'})});
        await expect(makeClient(ok.fetch).understandableCancel('j1')).resolves.toBeUndefined();
        expect(ok.calls[0].method).toBe('DELETE');
        const nf = makeFetch({'DELETE /v1/videos/understandable/j1': () => json({error: 'job_not_found', code: 'job_not_found'}, 404)});
        await expect(makeClient(nf.fetch).understandableCancel('j1')).resolves.toBeUndefined();
        const down = makeFetch({'DELETE /v1/videos/understandable/j1': () => json({error: 'x'}, 503)});
        expect((await catchCode(() => makeClient(down.fetch).understandableCancel('j1'))).code).toBe('flib_service_unavailable');
    });
});
