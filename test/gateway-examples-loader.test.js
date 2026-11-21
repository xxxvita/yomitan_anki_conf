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

describe('GatewayExamplesLoader.loadBatch', () => {
    const KNOWN_ITEM = {source: 'youtube', ref: 'dQw4w9WgXcQ', start_ms: 0, end_ms: 1000, text_en: 'run', text_ru: null, thumbnail_url: null, title: 'T', channel: 'C', fragment: {start_ms: 0, end_ms: 1000}, known_share: 0.91};

    test('one target, limit 5, the rank; refs sanitized, known_share and known_source kept', async () => {
        const api = makeApi({
            flibGatewayExamplesBatch: vi.fn(async () => ({
                known_source: 'route',
                partial: false,
                results: [{index: 0, text: 'run', mode: 'lemma', items: [KNOWN_ITEM, {...KNOWN_ITEM, ref: '../../etc'}], empty_reason: null}],
            })),
        });
        const result = await makeLoader(api).loadBatch({text: 'run', mode: 'lemma'}, 'known');
        expect(api.flibGatewayExamplesBatch).toHaveBeenCalledWith([{text: 'run', mode: 'lemma'}], 5, 'known');
        expect(result.items.map((i) => i.ref)).toEqual(['dQw4w9WgXcQ']);
        expect(result.items[0].known_share).toBe(0.91);
        expect(result.items[0].title).toBe('T');
        expect(result).toMatchObject({emptyReason: null, knownSource: 'route', partial: false});
    });

    test('all refs invalid → no_usable_examples; empty_reason and partial pass through; unknown known_source → none', async () => {
        const invalid = makeApi({
            flibGatewayExamplesBatch: vi.fn(async () => ({known_source: 'route', partial: false, results: [{index: 0, text: 'run', mode: 'lemma', items: [{...KNOWN_ITEM, ref: 'x'}], empty_reason: null}]})),
        });
        expect((await makeLoader(invalid).loadBatch({text: 'run', mode: 'lemma'}, 'known')).emptyReason).toBe('no_usable_examples');
        const budget = makeApi({
            flibGatewayExamplesBatch: vi.fn(async () => ({known_source: 'weird', partial: true, results: [{index: 0, text: 'run', mode: 'quote', items: [], empty_reason: 'budget_exhausted'}]})),
        });
        expect(await makeLoader(budget).loadBatch({text: 'run', mode: 'quote'}, 'plain')).toStrictEqual({items: [], emptyReason: 'budget_exhausted', knownSource: 'none', partial: true});
        const none = makeApi({flibGatewayExamplesBatch: vi.fn(async () => ({known_source: 'pending', partial: false, results: []}))});
        expect(await makeLoader(none).loadBatch({text: 'run', mode: 'lemma'}, 'known')).toStrictEqual({items: [], emptyReason: null, knownSource: 'pending', partial: false});
    });

    test('errors keep their code', async () => {
        const api = makeApi({flibGatewayExamplesBatch: vi.fn(async () => { throw flibError('flib_axis_off'); })});
        expect(getGatewayErrorCode(await rejectionOf(makeLoader(api).loadBatch({text: 'run', mode: 'lemma'}, 'known')))).toBe('flib_axis_off');
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

    test('waits for ready through downloading and concatenating, then fetches the bytes', async () => {
        let n = 0;
        const api = makeApi({
            flibGatewayGetClip: vi.fn(async () => {
                ++n;
                if (n === 1) { throw flibError('flib_clip_not_ready'); }
                if (n === 2) { return {clip_id: 'c1', status: 'downloading', duration_sec: null, lead_trim_sec: null, size_bytes: null, download_url: null}; }
                if (n === 3) { return {clip_id: 'c1', status: 'concatenating', duration_sec: null, lead_trim_sec: null, size_bytes: null, download_url: null}; }
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

describe('GatewayExamplesLoader.runUnderstandable', () => {
    const VID = 'dQw4w9WgXcQ';
    /** @type {import('flib-gateway').UnderstandableItem} */
    const ITEM = {video_id: VID, title: 'T', channel_id: null, duration_s: 125, coverage: 0.93, target_hits: [{from_ms: 42000, to_ms: 45000, text_en: 'run'}], target_hits_unavailable: false};
    const TARGET = /** @type {import('flib-gateway').ExamplesBatchTarget} */ ({text: 'run', mode: 'lemma'});

    /**
     * @param {Partial<import('flib-gateway').UnderstandableJob>} job
     * @returns {import('flib-gateway').UnderstandableJob}
     */
    const jobState = (job) => ({status: 'running', partial: false, errorCode: null, results: null, ...job});
    /**
     * @param {import('flib-gateway').UnderstandableItem[]} items
     * @param {?string} [emptyReason]
     * @returns {import('flib-gateway').UnderstandableJob}
     */
    const doneState = (items, emptyReason = null) => jobState({status: 'done', results: [{index: 0, text: 'run', mode: 'lemma', items, empty_reason: emptyReason}]});

    /**
     * @param {Record<string, unknown>} overrides
     * @returns {Record<string, import('vitest').Mock>}
     */
    const makeUndApi = (overrides = {}) => makeApi({
        flibGatewayUnderstandableStart: vi.fn(async () => ({jobId: 'und-1', pollAfterMs: 1500})),
        flibGatewayUnderstandablePoll: vi.fn(async () => doneState([ITEM])),
        flibGatewayUnderstandableCancel: vi.fn(async () => {}),
        ...overrides,
    });

    /**
     * A loader on a fake clock: `sleep` advances it; `onSleep` runs after each advance.
     * @param {Record<string, unknown>} api
     * @param {(t: number) => void} [onSleep]
     * @returns {{loader: GatewayExamplesLoader, sleeps: number[], now: () => number}}
     */
    const makeClockLoader = (api, onSleep) => {
        let t = 0;
        /** @type {number[]} */
        const sleeps = [];
        const loader = new GatewayExamplesLoader(/** @type {import('../ext/js/comm/api.js').API} */ (/** @type {unknown} */ (api)), {
            now: () => t,
            sleep: async (ms) => {
                sleeps.push(ms);
                t += ms;
                onSleep?.(t);
            },
        });
        return {loader, sleeps, now: () => t};
    };

    test('one target, limit 5, the exclude list deduplicated and validated; polls at max(pollAfterMs, 1 s) until done', async () => {
        let polls = 0;
        const api = makeUndApi({
            flibGatewayUnderstandableStart: vi.fn(async () => ({jobId: 'und-1', pollAfterMs: 400})),
            flibGatewayUnderstandablePoll: vi.fn(async () => (++polls < 3 ? jobState({status: polls === 1 ? 'queued' : 'mystery'}) : doneState([ITEM, {...ITEM, video_id: '../../etc'}]))),
        });
        const {loader, sleeps} = makeClockLoader(api);
        const result = await loader.runUnderstandable({target: TARGET, excludeVideoIds: [VID, VID, 'bad', 'aaaaaaaaaa1']});
        expect(api.flibGatewayUnderstandableStart).toHaveBeenCalledWith([{text: 'run', mode: 'lemma'}], 5, [VID, 'aaaaaaaaaa1']);
        expect(api.flibGatewayUnderstandablePoll).toHaveBeenCalledTimes(3);
        expect(api.flibGatewayUnderstandablePoll).toHaveBeenCalledWith('und-1');
        expect(sleeps).toEqual([1000, 1000, 1000]);
        expect(result).toStrictEqual({status: 'done', items: [ITEM], emptyReason: null, partial: false, errorCode: null});
        expect(api.flibGatewayUnderstandableCancel).not.toHaveBeenCalled();
    });

    test('a longer poll_after_ms is kept; at most 1000 excluded ids reach the start', async () => {
        const api = makeUndApi({flibGatewayUnderstandableStart: vi.fn(async () => ({jobId: 'und-1', pollAfterMs: 2500}))});
        const many = Array.from({length: 1100}, (_v, i) => `v${String(i).padStart(10, '0')}`);
        const {loader, sleeps} = makeClockLoader(api);
        await loader.runUnderstandable({target: TARGET, excludeVideoIds: many});
        expect(sleeps).toEqual([2500]);
        expect(api.flibGatewayUnderstandableStart.mock.calls[0][2]).toHaveLength(1000);
    });

    test('empty answers: the reason passes through; all-invalid ids → no_usable_examples; partial and the error code are kept', async () => {
        const empty = makeUndApi({flibGatewayUnderstandablePoll: vi.fn(async () => doneState([], 'all_excluded'))});
        expect(await makeClockLoader(empty).loader.runUnderstandable({target: TARGET, excludeVideoIds: []})).toStrictEqual({status: 'done', items: [], emptyReason: 'all_excluded', partial: false, errorCode: null});
        const invalid = makeUndApi({flibGatewayUnderstandablePoll: vi.fn(async () => doneState([{...ITEM, video_id: 'x'}]))});
        expect((await makeClockLoader(invalid).loader.runUnderstandable({target: TARGET, excludeVideoIds: []})).emptyReason).toBe('no_usable_examples');
        const partial = makeUndApi({flibGatewayUnderstandablePoll: vi.fn(async () => ({...doneState([], null), partial: true}))});
        expect(await makeClockLoader(partial).loader.runUnderstandable({target: TARGET, excludeVideoIds: []})).toMatchObject({status: 'done', partial: true, emptyReason: null});
        const noResults = makeUndApi({flibGatewayUnderstandablePoll: vi.fn(async () => jobState({status: 'done', results: null}))});
        expect(await makeClockLoader(noResults).loader.runUnderstandable({target: TARGET, excludeVideoIds: []})).toMatchObject({status: 'done', items: [], emptyReason: null});
    });

    test.each(['failed', 'expired', 'cancelled'])('terminal %s is returned without a cancel', async (status) => {
        const api = makeUndApi({flibGatewayUnderstandablePoll: vi.fn(async () => jobState({status, errorCode: 'budget_exhausted'}))});
        const result = await makeClockLoader(api).loader.runUnderstandable({target: TARGET, excludeVideoIds: []});
        expect(result).toStrictEqual({status, items: [], emptyReason: null, partial: false, errorCode: 'budget_exhausted'});
        expect(api.flibGatewayUnderstandableCancel).not.toHaveBeenCalled();
    });

    test('75 s from the start: one cancel, a timeout result, no poll past the limit', async () => {
        const api = makeUndApi({flibGatewayUnderstandablePoll: vi.fn(async () => jobState({status: 'running'}))});
        const {loader, now} = makeClockLoader(api);
        const result = await loader.runUnderstandable({target: TARGET, excludeVideoIds: []});
        expect(result).toStrictEqual({status: 'timeout', items: [], emptyReason: null, partial: false, errorCode: null});
        expect(api.flibGatewayUnderstandableCancel).toHaveBeenCalledTimes(1);
        expect(api.flibGatewayUnderstandableCancel).toHaveBeenCalledWith('und-1');
        expect(now()).toBe(75000);
        // Polls at 1.5, 3, …, 73.5 s; the 75 s wake-up is the limit, not a poll.
        expect(api.flibGatewayUnderstandablePoll).toHaveBeenCalledTimes(49);
    });

    test('transient poll errors keep polling (H3)', async () => {
        /**
         * @param {string} code
         * @param {?number} status
         * @returns {ExtensionError}
         */
        const httpError = (code, status) => {
            const error = flibError(code);
            error.data = {code, status};
            return error;
        };
        const errors = [flibError('flib_network'), flibError('flib_timeout'), flibError('flib_service_unavailable'), flibError('flib_rate_limited'), flibError('flib_bad_response'), httpError('flib_http_error', 502)];
        const api = makeUndApi({
            flibGatewayUnderstandablePoll: vi.fn(async () => {
                const error = errors.shift();
                if (typeof error !== 'undefined') { throw error; }
                return doneState([ITEM]);
            }),
        });
        const result = await makeClockLoader(api).loader.runUnderstandable({target: TARGET, excludeVideoIds: []});
        expect(result.status).toBe('done');
        expect(api.flibGatewayUnderstandablePoll).toHaveBeenCalledTimes(7);
        expect(api.flibGatewayUnderstandableCancel).not.toHaveBeenCalled();
    });

    test('flib_job_not_found while polling is terminal and needs no cancel', async () => {
        const api = makeUndApi({flibGatewayUnderstandablePoll: vi.fn(async () => { throw flibError('flib_job_not_found'); })});
        const error = await rejectionOf(makeClockLoader(api).loader.runUnderstandable({target: TARGET, excludeVideoIds: []}));
        expect(getGatewayErrorCode(error)).toBe('flib_job_not_found');
        expect(api.flibGatewayUnderstandablePoll).toHaveBeenCalledTimes(1);
        expect(api.flibGatewayUnderstandableCancel).not.toHaveBeenCalled();
    });

    test('a non-transient poll error (4xx) ends the job with one cancel and keeps its code', async () => {
        const error = flibError('flib_http_error');
        error.data = {code: 'flib_http_error', status: 400};
        const api = makeUndApi({flibGatewayUnderstandablePoll: vi.fn(async () => { throw error; })});
        const rejection = await rejectionOf(makeClockLoader(api).loader.runUnderstandable({target: TARGET, excludeVideoIds: []}));
        expect(getGatewayErrorCode(rejection)).toBe('flib_http_error');
        expect(api.flibGatewayUnderstandableCancel).toHaveBeenCalledTimes(1);
    });

    test('start errors keep their code; nothing to cancel', async () => {
        const api = makeUndApi({flibGatewayUnderstandableStart: vi.fn(async () => { throw flibError('understandable_demo_forbidden'); })});
        const error = await rejectionOf(makeClockLoader(api).loader.runUnderstandable({target: TARGET, excludeVideoIds: []}));
        expect(getGatewayErrorCode(error)).toBe('understandable_demo_forbidden');
        expect(api.flibGatewayUnderstandableCancel).not.toHaveBeenCalled();
    });

    test('already aborted: no start at all', async () => {
        const controller = new AbortController();
        controller.abort();
        const api = makeUndApi();
        const error = await rejectionOf(makeClockLoader(api).loader.runUnderstandable({target: TARGET, excludeVideoIds: []}, {signal: controller.signal}));
        expect(getGatewayErrorCode(error)).toBe('flib_aborted');
        expect(api.flibGatewayUnderstandableStart).not.toHaveBeenCalled();
    });

    test('abort while the start is in flight: the late job id is cancelled once, never with the aborted signal; no poll', async () => {
        const controller = new AbortController();
        /** @type {(value: {jobId: string, pollAfterMs: number}) => void} */
        let resolveStart = () => {};
        const api = makeUndApi({flibGatewayUnderstandableStart: vi.fn(() => new Promise((r) => { resolveStart = r; }))});
        const run = rejectionOf(makeClockLoader(api).loader.runUnderstandable({target: TARGET, excludeVideoIds: []}, {signal: controller.signal}));
        controller.abort();
        resolveStart({jobId: 'late-1', pollAfterMs: 1000});
        expect(getGatewayErrorCode(await run)).toBe('flib_aborted');
        expect(api.flibGatewayUnderstandableCancel.mock.calls).toStrictEqual([['late-1']]);
        expect(api.flibGatewayUnderstandablePoll).not.toHaveBeenCalled();
    });

    test('abort while polling: exactly one cancel, no further poll, even if the cancel itself fails', async () => {
        const controller = new AbortController();
        const api = makeUndApi({
            flibGatewayUnderstandablePoll: vi.fn(async () => jobState({status: 'running'})),
            flibGatewayUnderstandableCancel: vi.fn(async () => { throw flibError('flib_network'); }),
        });
        const {loader} = makeClockLoader(api, (t) => {
            if (t >= 4500) { controller.abort(); }
        });
        const error = await rejectionOf(loader.runUnderstandable({target: TARGET, excludeVideoIds: []}, {signal: controller.signal}));
        expect(getGatewayErrorCode(error)).toBe('flib_aborted');
        expect(api.flibGatewayUnderstandablePoll).toHaveBeenCalledTimes(2);
        expect(api.flibGatewayUnderstandableCancel.mock.calls).toStrictEqual([['und-1']]);
    });

    test('abort during a sleep that never ends: the cancel is immediate and the run settles', async () => {
        const controller = new AbortController();
        const api = makeUndApi({flibGatewayUnderstandablePoll: vi.fn(async () => jobState({status: 'running'}))});
        const loader = new GatewayExamplesLoader(/** @type {import('../ext/js/comm/api.js').API} */ (/** @type {unknown} */ (api)), {
            now: () => 0,
            sleep: () => new Promise(() => {}),
        });
        const run = rejectionOf(loader.runUnderstandable({target: TARGET, excludeVideoIds: []}, {signal: controller.signal}));
        await vi.waitFor(() => { expect(api.flibGatewayUnderstandableStart).toHaveBeenCalled(); });
        await Promise.resolve();
        controller.abort();
        expect(api.flibGatewayUnderstandableCancel.mock.calls).toStrictEqual([['und-1']]);
        expect(getGatewayErrorCode(await run)).toBe('flib_aborted');
        expect(api.flibGatewayUnderstandablePoll).not.toHaveBeenCalled();
    });
});
