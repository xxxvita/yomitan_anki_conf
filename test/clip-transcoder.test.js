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

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {ClipTranscodeError} from '../ext/js/display/clip-transcode-util.js';
import {probeEncoderSupport, transcodeClipToWebm} from '../ext/js/display/clip-transcoder.js';

/**
 * Fake of the module worker: records posted messages and terminate() calls, lets the test
 * emit 'message' / 'error' events. Extends EventTarget like the real Worker.
 */
class FakeWorker extends EventTarget {
    /** */
    constructor() {
        super();
        /** @type {import('clip-transcode').ClipTranscodeWorkerRequest[]} */
        this.posted = [];
        /**
         *
         */
        this.terminated = 0;
    }

    /** @param {import('clip-transcode').ClipTranscodeWorkerRequest} message */
    postMessage(message) {
        this.posted.push(message);
    }

    /** */
    terminate() {
        ++this.terminated;
    }

    /** @param {unknown} data */
    emitMessage(data) {
        this.dispatchEvent(new MessageEvent('message', {data}));
    }

    /** @param {string} message */
    emitError(message) {
        const event = new Event('error');
        Object.defineProperty(event, 'message', {value: message});
        this.dispatchEvent(event);
    }
}

/** @type {FakeWorker[]} */
let workers = [];
const createWorker = () => {
    const worker = new FakeWorker();
    workers.push(worker);
    return worker;
};

/** @type {import('clip-transcode').ClipWindow} */
const clipWindow = {startSec: 9.634, endSec: 17.634};
/** @type {import('clip-transcode').ClipOutputSettings} */
const settings = {codec: 'vp9', width: 1280, height: 720, videoBitrate: 1_500_000, audioBitrate: 96_000};
const mp4 = new Blob([new Uint8Array([0, 0, 0, 24])], {type: 'video/mp4'});

/** @returns {Promise<void>} */
const flush = () => new Promise((resolve) => { setImmediate(resolve); });

beforeEach(() => {
    workers = [];
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
});

describe('transcodeClipToWebm', () => {
    test('success: posts {mp4, window, settings}, resolves bytes, terminates the worker', async () => {
        const promise = transcodeClipToWebm(mp4, {window: clipWindow, settings, createWorker});
        expect(workers).toHaveLength(1);
        const [worker] = workers;
        expect(worker.posted).toStrictEqual([{mp4, window: clipWindow, settings}]);
        worker.emitMessage({ok: true, webm: new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]).buffer});
        const bytes = await promise;
        expect(bytes).toBeInstanceOf(Uint8Array);
        expect([...bytes]).toStrictEqual([0x1a, 0x45, 0xdf, 0xa3]);
        expect(worker.terminated).toBe(1);
    });

    test('structured worker error -> ClipTranscodeError with the code, worker terminated', async () => {
        const promise = transcodeClipToWebm(mp4, {window: clipWindow, settings, createWorker});
        workers[0].emitMessage({ok: false, error: {code: 'conversion-invalid', message: 'video: no_encodable_target_codec'}});
        await expect(promise).rejects.toMatchObject({name: 'ClipTranscodeError', code: 'conversion-invalid'});
        expect(workers[0].terminated).toBe(1);
    });

    test('worker error event -> rejects with worker-error, worker terminated', async () => {
        const promise = transcodeClipToWebm(mp4, {window: clipWindow, settings, createWorker});
        workers[0].emitError('boom');
        await expect(promise).rejects.toMatchObject({code: 'worker-error'});
        await expect(promise).rejects.toBeInstanceOf(ClipTranscodeError);
        expect(workers[0].terminated).toBe(1);
    });

    test('messageerror -> rejects with worker-error', async () => {
        const promise = transcodeClipToWebm(mp4, {window: clipWindow, settings, createWorker});
        workers[0].dispatchEvent(new Event('messageerror'));
        await expect(promise).rejects.toMatchObject({code: 'worker-error'});
        expect(workers[0].terminated).toBe(1);
    });

    test('malformed / empty success payload -> rejects, worker terminated', async () => {
        const p1 = transcodeClipToWebm(mp4, {window: clipWindow, settings, createWorker});
        workers[0].emitMessage({ok: true, webm: 'nope'});
        await expect(p1).rejects.toMatchObject({code: 'worker-error'});
        const p2 = transcodeClipToWebm(mp4, {window: clipWindow, settings, createWorker});
        workers[1].emitMessage({ok: true, webm: new ArrayBuffer(0)});
        await expect(p2).rejects.toMatchObject({code: 'empty-output'});
        const p3 = transcodeClipToWebm(mp4, {window: clipWindow, settings, createWorker});
        workers[2].emitMessage(null);
        await expect(p3).rejects.toMatchObject({code: 'worker-error'});
        expect(workers.map((w) => w.terminated)).toStrictEqual([1, 1, 1]);
    });

    test('timeout (default 30 s) -> rejects with timeout, worker terminated', async () => {
        vi.useFakeTimers();
        const promise = transcodeClipToWebm(mp4, {window: clipWindow, settings, createWorker});
        const assertion = expect(promise).rejects.toMatchObject({code: 'timeout'});
        vi.advanceTimersByTime(29_999);
        expect(workers[0].terminated).toBe(0);
        vi.advanceTimersByTime(1);
        await assertion;
        expect(workers[0].terminated).toBe(1);
    });

    test('custom timeoutMs', async () => {
        vi.useFakeTimers();
        const promise = transcodeClipToWebm(mp4, {window: clipWindow, settings, createWorker, timeoutMs: 500});
        const assertion = expect(promise).rejects.toMatchObject({code: 'timeout'});
        vi.advanceTimersByTime(500);
        await assertion;
        expect(workers[0].terminated).toBe(1);
    });

    test('late message after timeout is ignored (settles once, terminate once)', async () => {
        vi.useFakeTimers();
        const promise = transcodeClipToWebm(mp4, {window: clipWindow, settings, createWorker, timeoutMs: 100});
        const assertion = expect(promise).rejects.toMatchObject({code: 'timeout'});
        vi.advanceTimersByTime(100);
        await assertion;
        workers[0].emitMessage({ok: true, webm: new Uint8Array([1]).buffer});
        workers[0].emitError('late');
        expect(workers[0].terminated).toBe(1);
    });

    test('abort mid-transcode -> AbortError, worker terminated, timer cleared', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const promise = transcodeClipToWebm(mp4, {window: clipWindow, settings, createWorker, signal: controller.signal});
        controller.abort();
        await expect(promise).rejects.toMatchObject({name: 'AbortError'});
        expect(workers[0].terminated).toBe(1);
        expect(vi.getTimerCount()).toBe(0);
    });

    test('success clears the timeout and detaches the abort listener', async () => {
        vi.useFakeTimers();
        const controller = new AbortController();
        const removeSpy = vi.spyOn(controller.signal, 'removeEventListener');
        const promise = transcodeClipToWebm(mp4, {window: clipWindow, settings, createWorker, signal: controller.signal});
        workers[0].emitMessage({ok: true, webm: new Uint8Array([1]).buffer});
        await promise;
        expect(vi.getTimerCount()).toBe(0);
        expect(removeSpy).toHaveBeenCalledWith('abort', expect.any(Function));
        controller.abort();
        expect(workers[0].terminated).toBe(1);
    });

    test('signal already aborted -> rejects with AbortError and spawns no worker', async () => {
        const controller = new AbortController();
        controller.abort();
        await expect(transcodeClipToWebm(mp4, {window: clipWindow, settings, createWorker, signal: controller.signal})).rejects.toMatchObject({name: 'AbortError'});
        expect(workers).toHaveLength(0);
    });

    test('invalid window -> rejects with invalid-window and spawns no worker', async () => {
        await expect(transcodeClipToWebm(mp4, {window: {startSec: 5, endSec: 5}, settings, createWorker})).rejects.toMatchObject({code: 'invalid-window'});
        await expect(transcodeClipToWebm(mp4, {window: {startSec: Number.NaN, endSec: 5}, settings, createWorker})).rejects.toMatchObject({code: 'invalid-window'});
        expect(workers).toHaveLength(0);
    });

    test('createWorker throws (e.g. CSP) -> worker-error', async () => {
        const failing = () => { throw new Error('blocked'); };
        await expect(transcodeClipToWebm(mp4, {window: clipWindow, settings, createWorker: failing})).rejects.toMatchObject({code: 'worker-error'});
    });

    test('postMessage throws (DataCloneError) -> worker-error, worker terminated', async () => {
        const worker = new FakeWorker();
        worker.postMessage = () => { throw new Error('DataCloneError'); };
        await expect(transcodeClipToWebm(mp4, {window: clipWindow, settings, createWorker: () => worker})).rejects.toMatchObject({code: 'worker-error'});
        expect(worker.terminated).toBe(1);
    });

    test('nothing leaks between calls: every spawned worker is terminated exactly once', async () => {
        const p = [];
        for (let i = 0; i < 3; ++i) {
            p.push(transcodeClipToWebm(mp4, {window: clipWindow, settings, createWorker}).catch(() => null));
        }
        workers[0].emitMessage({ok: true, webm: new Uint8Array([1]).buffer});
        workers[1].emitError('x');
        workers[2].emitMessage({ok: false, error: {code: 'transcode-failed', message: 'x'}});
        await Promise.all(p);
        await flush();
        expect(workers.map((w) => w.terminated)).toStrictEqual([1, 1, 1]);
    });
});

describe('probeEncoderSupport (edge case 2)', () => {
    test('no WebCodecs -> everything false', async () => {
        vi.stubGlobal('VideoEncoder', void 0);
        vi.stubGlobal('AudioEncoder', void 0);
        expect(await probeEncoderSupport()).toStrictEqual({vp9Supported: false, vp8Supported: false, opusSupported: false});
    });

    test('reads isConfigSupported for vp9, vp8 and opus; exceptions count as unsupported', async () => {
        /** @type {string[]} */
        const asked = [];
        vi.stubGlobal('VideoEncoder', {
            /**
             * @param {VideoEncoderConfig} config
             * @returns {Promise<{supported: boolean}>}
             */
            isConfigSupported: async (config) => {
                asked.push(config.codec);
                if (config.codec === 'vp8') { throw new TypeError('bad config'); }
                return {supported: true};
            },
        });
        vi.stubGlobal('AudioEncoder', {
            /**
             * @param {AudioEncoderConfig} config
             * @returns {Promise<{supported: boolean}>}
             */
            isConfigSupported: async (config) => {
                asked.push(config.codec);
                return {supported: config.codec === 'opus'};
            },
        });
        expect(await probeEncoderSupport()).toStrictEqual({vp9Supported: true, vp8Supported: false, opusSupported: true});
        expect(asked).toContain('opus');
        expect(asked.some((c) => c.startsWith('vp09'))).toBe(true);
        expect(asked).toContain('vp8');
    });
});
