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
import {ExtensionError} from '../ext/js/core/extension-error.js';
import {GatewayExamplesLoader} from '../ext/js/display/gateway-examples-loader.js';
import {getGatewayErrorCode} from '../ext/js/display/gateway-examples-util.js';

/**
 * @param {string} code
 * @returns {ExtensionError}
 */
function flibError(code) {
    const error = new ExtensionError(code);
    error.data = {code, status: null};
    return error;
}

/** @type {import('flib-gateway').WordExampleSet} */
const SET = {
    word: 'run',
    lemma: 'run',
    token: 'tok-1',
    clips: [
        {order_index: 0, subs: [{rel_start_ms: 0, rel_end_ms: 900, text: 'Run!'}], trim_duration_sec: 4, year: 1995, cefr: 'B1', difficulty: null},
        {order_index: 1, subs: [], trim_duration_sec: 3, year: null, cefr: null, difficulty: null},
    ],
    matched_forms: ['run'],
    empty_reason: null,
};

/**
 * @param {Promise<unknown>} promise
 * @returns {Promise<unknown>} The rejection reason, or null when it resolved.
 */
async function rejectionOf(promise) {
    try {
        await promise;
    } catch (e) {
        return e;
    }
    return null;
}

/**
 * @param {Record<string, unknown>} overrides
 * @returns {Record<string, import('vitest').Mock>}
 */
function makeApi(overrides = {}) {
    let polls = 0;
    return {
        flibGatewayExamples: vi.fn(async () => ({word: 'run', items: [], empty_reason: 'not_in_corpus'})),
        flibGatewayWordExamplesStart: vi.fn(async () => ({jobId: 'job-1'})),
        flibGatewayWordExamplesPoll: vi.fn(async () => {
            ++polls;
            return polls < 3 ? {done: false, phase: 'running'} : {done: true, result: {results: [SET]}};
        }),
        flibGatewayWordExamplesCancel: vi.fn(async () => true),
        flibGatewayRedeemClips: vi.fn(async () => ({
            batch_id: 'b1',
            clips: [
                {clip_id: 'c1', status: 'queued', order_index: 0},
                {clip_id: 'c2', status: 'failed', order_index: 1, error: 'cut failed'},
            ],
        })),
        flibGatewayGetClip: vi.fn(async (/** @type {string} */ clipId) => ({clip_id: clipId, status: 'ready', duration_sec: 10, lead_trim_sec: 1, size_bytes: 3, download_url: null})),
        flibGatewayClipData: vi.fn(async () => ({contentType: 'video/mp4', byteLength: 3, base64: btoa('abc')})),
        ...overrides,
    };
}

/**
 * @param {Record<string, unknown>} api
 * @param {{budgetMs?: number}} [options]
 * @returns {GatewayExamplesLoader}
 */
function makeLoader(api, {budgetMs} = {}) {
    let t = 0;
    return new GatewayExamplesLoader(/** @type {import('../ext/js/comm/api.js').API} */ (/** @type {unknown} */ (api)), {
        now: () => t,
        sleep: async (ms) => { t += ms; },
        clipBudgetMs: budgetMs,
    });
}

describe('GatewayExamplesLoader.loadYouTube', () => {
    test('asks for youtube examples and sanitizes them', async () => {
        const api = makeApi({
            flibGatewayExamples: vi.fn(async () => ({
                word: 'run',
                items: [
                    {source: 'youtube', ref: 'dQw4w9WgXcQ', start_ms: 0, end_ms: 1000, text_en: 'run', text_ru: null, thumbnail_url: null},
                    {source: 'youtube', ref: '../../etc', start_ms: 0, end_ms: 1000, text_en: 'run', text_ru: null, thumbnail_url: null},
                ],
                empty_reason: null,
            })),
        });
        const result = await makeLoader(api).loadYouTube('run');
        expect(api.flibGatewayExamples).toHaveBeenCalledWith('run', {kind: 'youtube', limit: 6});
        expect(result.items.map((i) => i.ref)).toEqual(['dQw4w9WgXcQ']);
        expect(result.emptyReason).toBeNull();
    });

    test('all refs invalid → no_usable_examples', async () => {
        const api = makeApi({
            flibGatewayExamples: vi.fn(async () => ({
                word: 'run',
                items: [{source: 'youtube', ref: 'x', start_ms: 0, end_ms: 1, text_en: 'run', text_ru: null, thumbnail_url: null}],
                empty_reason: null,
            })),
        });
        expect((await makeLoader(api).loadYouTube('run')).emptyReason).toBe('no_usable_examples');
    });

    test('gateway empty_reason passes through', async () => {
        const result = await makeLoader(makeApi()).loadYouTube('run');
        expect(result).toEqual({items: [], emptyReason: 'not_in_corpus'});
    });
});

describe('GatewayExamplesLoader.loadFilms', () => {
    test('start → poll → redeem, phases searching then cutting, clips merged by order_index', async () => {
        const api = makeApi();
        /** @type {string[]} */
        const phases = [];
        const result = await makeLoader(api).loadFilms('run', {onPhase: (p) => phases.push(p)});
        expect(phases).toEqual(['searching', 'cutting']);
        expect(api.flibGatewayWordExamplesStart).toHaveBeenCalledWith(['run'], 3);
        expect(api.flibGatewayWordExamplesPoll).toHaveBeenCalledTimes(3);
        expect(api.flibGatewayRedeemClips).toHaveBeenCalledWith('tok-1');
        expect(result.emptyReason).toBeNull();
        expect(result.lemma).toBe('run');
        expect(result.matchedForms).toEqual(['run']);
        expect(result.clips).toEqual([
            {clipId: 'c1', orderIndex: 0, status: 'queued', error: null, subs: SET.clips[0].subs, trimDurationSec: 4, year: 1995, cefr: 'B1'},
            {clipId: 'c2', orderIndex: 1, status: 'failed', error: 'cut failed', subs: [], trimDurationSec: 3, year: null, cefr: null},
        ]);
    });

    test('empty_reason without a token: no redeem', async () => {
        const api = makeApi({
            flibGatewayWordExamplesPoll: vi.fn(async () => ({done: true, result: {results: [{...SET, token: null, clips: [], empty_reason: 'not_in_corpus', lemma: 'run', matched_forms: ['ran']}]}})),
        });
        const result = await makeLoader(api).loadFilms('run');
        expect(result).toEqual({clips: [], emptyReason: 'not_in_corpus', lemma: 'run', matchedForms: ['ran']});
        expect(api.flibGatewayRedeemClips).not.toHaveBeenCalled();
    });

    test('job timeout surfaces flib_job_timeout', async () => {
        const api = makeApi({flibGatewayWordExamplesPoll: vi.fn(async () => { throw flibError('flib_job_timeout'); })});
        const error = await rejectionOf(makeLoader(api).loadFilms('run'));
        expect(getGatewayErrorCode(error)).toBe('flib_job_timeout');
    });

    test('abort cancels the backend job', async () => {
        const controller = new AbortController();
        const api = makeApi({
            flibGatewayWordExamplesPoll: vi.fn(async () => {
                controller.abort();
                return {done: false, phase: 'running'};
            }),
        });
        const error = await rejectionOf(makeLoader(api).loadFilms('run', {signal: controller.signal}));
        expect(getGatewayErrorCode(error)).toBe('flib_aborted');
        expect(api.flibGatewayWordExamplesCancel).toHaveBeenCalledWith('job-1');
    });
});

describe('GatewayExamplesLoader.loadClipMedia', () => {
    /** @type {import('flib-gateway-examples').FilmClip} */
    const clip = {clipId: 'c1', orderIndex: 0, status: 'queued', error: null, subs: [], trimDurationSec: 4, year: null, cefr: null};

    test('waits for ready (clip_not_ready is transient), then fetches the bytes', async () => {
        let n = 0;
        const api = makeApi({
            flibGatewayGetClip: vi.fn(async () => {
                ++n;
                if (n === 1) { throw flibError('flib_clip_not_ready'); }
                if (n === 2) { return {clip_id: 'c1', status: 'downloading', duration_sec: null, lead_trim_sec: null, size_bytes: null, download_url: null}; }
                return {clip_id: 'c1', status: 'ready', duration_sec: 10, lead_trim_sec: 1, size_bytes: 3, download_url: null};
            }),
        });
        const {info, blob} = await makeLoader(api).loadClipMedia(clip);
        expect(info.lead_trim_sec).toBe(1);
        expect(blob.type).toBe('video/mp4');
        expect(blob.size).toBe(3);
    });

    test('a non-video content type from the server is not trusted for the blob', async () => {
        const api = makeApi({flibGatewayClipData: vi.fn(async () => ({contentType: 'text/html', byteLength: 3, base64: btoa('abc')}))});
        const {blob} = await makeLoader(api).loadClipMedia(clip);
        expect(blob.type).toBe('video/mp4');
    });

    test('a failed clip is flib_clip_failed, without fetching data', async () => {
        const api = makeApi({flibGatewayGetClip: vi.fn(async () => ({clip_id: 'c1', status: 'failed', duration_sec: null, lead_trim_sec: null, size_bytes: null, download_url: null}))});
        const error = await rejectionOf(makeLoader(api).loadClipMedia(clip));
        expect(getGatewayErrorCode(error)).toBe('flib_clip_failed');
        expect(api.flibGatewayClipData).not.toHaveBeenCalled();
        const error2 = await rejectionOf(makeLoader(api).loadClipMedia({...clip, status: 'failed'}));
        expect(getGatewayErrorCode(error2)).toBe('flib_clip_failed');
    });

    test('never-ready clip times out with flib_clip_timeout', async () => {
        const api = makeApi({flibGatewayGetClip: vi.fn(async () => ({clip_id: 'c1', status: 'queued', duration_sec: null, lead_trim_sec: null, size_bytes: null, download_url: null}))});
        const error = await rejectionOf(makeLoader(api, {budgetMs: 10000}).loadClipMedia(clip));
        expect(getGatewayErrorCode(error)).toBe('flib_clip_timeout');
    });
});
