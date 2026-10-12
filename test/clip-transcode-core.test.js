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
import {ClipTranscodeError} from '../ext/js/display/clip-transcode-util.js';
import {handleTranscodeRequest, toWorkerError, transcodeClip} from '../ext/js/display/clip-transcode-core.js';

/**
 * @typedef {object} FakeScenario
 * @property {boolean} [isValid]
 * @property {{track: {type: string}, reason: string}[]} [discardedTracks]
 * @property {number} [videoFrames] Frames pushed through `video.process` during execute().
 * @property {?ArrayBuffer} [buffer] What BufferTarget.buffer holds after execute().
 * @property {Error} [executeError]
 */

/**
 * Fake of the mediabunny subset: records Input/Conversion options, simulates execute().
 * @param {FakeScenario} scenario
 * @returns {{mediabunny: import('clip-transcode').ClipTranscodeMediabunny, log: {inputs: unknown[], conversionOptions: ?Record<string, unknown>, executed: number}, MP4: object}}
 */
function createFakeMediabunny(scenario) {
    const MP4 = {name: 'MP4'};
    /** @type {{inputs: unknown[], conversionOptions: ?Record<string, unknown>, executed: number}} */
    const log = {inputs: [], conversionOptions: null, executed: 0};
    /** @type {{buffer: ?ArrayBuffer}[]} */
    const targets = [];

    /** Records its constructor argument. */
    class Recorder {
        /** @param {unknown} options */
        constructor(options) {
            /** @type {unknown} */
            this.options = options;
        }
    }
    /** BufferTarget fake: execute() fills `buffer`. */
    class BufferTarget {
        /** */
        constructor() {
            /** @type {?ArrayBuffer} */
            this.buffer = null;
            targets.push(this);
        }
    }
    /** Input fake. */
    class Input extends Recorder {
        /** @param {unknown} options */
        constructor(options) {
            super(options);
            log.inputs.push(options);
        }
    }
    const Conversion = {
        /**
         * @param {Record<string, unknown>} options
         * @returns {Promise<unknown>}
         */
        init: async (options) => {
            log.conversionOptions = options;
            return {
                isValid: scenario.isValid ?? true,
                discardedTracks: scenario.discardedTracks ?? [],
                execute: async () => {
                    ++log.executed;
                    if (scenario.executeError) { throw scenario.executeError; }
                    const video = /** @type {{process?: (sample: unknown) => unknown}} */ (options.video);
                    for (let i = 0; i < (scenario.videoFrames ?? 3); ++i) {
                        const sample = {i};
                        expect(video.process?.(sample)).toBe(sample);
                    }
                    targets[targets.length - 1].buffer = scenario.buffer === void 0 ? new Uint8Array([0x1a, 0x45, 0xdf, 0xa3]).buffer : scenario.buffer;
                },
            };
        },
    };
    const mediabunny = /** @type {import('clip-transcode').ClipTranscodeMediabunny} */ (/** @type {unknown} */ ({
        BlobSource: Recorder,
        BufferSource: Recorder,
        BufferTarget,
        Conversion,
        Input,
        MP4,
        Output: Recorder,
        Quality: Recorder,
        WebMOutputFormat: Recorder,
    }));
    return {mediabunny, log, MP4};
}

/** @type {import('clip-transcode').ClipOutputSettings} */
const settings = {codec: 'vp9', width: 1280, height: 720, videoBitrate: 1_500_000, audioBitrate: 96_000};
/** @type {import('clip-transcode').ClipTranscodeWorkerRequest} */
const request = {mp4: new Blob([new Uint8Array([0, 0, 0, 24])], {type: 'video/mp4'}), window: {startSec: 9.5, endSec: 17.5}, settings};

/**
 * @param {Promise<unknown>} promise
 * @param {import('clip-transcode').ClipTranscodeErrorCode} code
 */
async function expectCode(promise, code) {
    await expect(promise).rejects.toBeInstanceOf(ClipTranscodeError);
    await expect(promise).rejects.toMatchObject({code});
}

describe('transcodeClip', () => {
    test('success: MP4-only input, trim window, explicit bitrates, WebM bytes', async () => {
        const {mediabunny, log, MP4} = createFakeMediabunny({});
        const webm = await transcodeClip(request, mediabunny);
        expect([...new Uint8Array(webm)]).toStrictEqual([0x1a, 0x45, 0xdf, 0xa3]);
        expect(log.inputs).toHaveLength(1);
        expect(/** @type {{formats: unknown[]}} */ (log.inputs[0]).formats).toStrictEqual([MP4]);
        const options = /** @type {{trim: unknown, video: {quality: {options: unknown}}, audio: {quality: {options: unknown}}}} */ (log.conversionOptions);
        expect(options.trim).toStrictEqual({start: 9.5, end: 17.5});
        expect(options.video).toMatchObject({codec: 'vp9', width: 1280, height: 720, forceTranscode: true});
        expect(options.video.quality.options).toStrictEqual({bitrate: 1_500_000});
        expect(options.audio).toMatchObject({codec: 'opus', forceTranscode: true});
        expect(options.audio.quality.options).toStrictEqual({bitrate: 96_000});
    });

    test('ArrayBuffer input uses BufferSource', async () => {
        const {mediabunny} = createFakeMediabunny({});
        await expect(transcodeClip({...request, mp4: new ArrayBuffer(8)}, mediabunny)).resolves.toBeInstanceOf(ArrayBuffer);
    });

    test('non-Blob/ArrayBuffer input -> invalid-input', async () => {
        const {mediabunny} = createFakeMediabunny({});
        const bad = /** @type {import('clip-transcode').ClipTranscodeWorkerRequest} */ (/** @type {unknown} */ ({...request, mp4: 'nope'}));
        await expectCode(transcodeClip(bad, mediabunny), 'invalid-input');
    });

    test.each([
        [{startSec: 5, endSec: 5}],
        [{startSec: -1, endSec: 5}],
        [{startSec: Number.NaN, endSec: 5}],
    ])('invalid window %o -> invalid-window', async (clipWindow) => {
        const {mediabunny, log} = createFakeMediabunny({});
        await expectCode(transcodeClip({...request, window: clipWindow}, mediabunny), 'invalid-window');
        expect(log.conversionOptions).toBeNull();
    });

    test.each([
        ['undecodable_source_codec'],
        ['unknown_source_codec'],
        ['no_encodable_target_codec'],
    ])('discarded track with %s -> conversion-invalid, not executed', async (reason) => {
        const {mediabunny, log} = createFakeMediabunny({discardedTracks: [{track: {type: 'video'}, reason}]});
        const promise = transcodeClip(request, mediabunny);
        await expectCode(promise, 'conversion-invalid');
        await expect(promise).rejects.toThrow(reason);
        expect(log.executed).toBe(0);
    });

    test('isValid=false -> conversion-invalid', async () => {
        const {mediabunny, log} = createFakeMediabunny({isValid: false});
        await expectCode(transcodeClip(request, mediabunny), 'conversion-invalid');
        expect(log.executed).toBe(0);
    });

    test('a non-codec discard reason alone does not fail a valid conversion', async () => {
        const {mediabunny} = createFakeMediabunny({discardedTracks: [{track: {type: 'subtitle'}, reason: 'discarded_by_user'}]});
        await expect(transcodeClip(request, mediabunny)).resolves.toBeInstanceOf(ArrayBuffer);
    });

    test.each([
        ['null buffer', null],
        ['0-byte buffer', new ArrayBuffer(0)],
    ])('%s -> empty-output', async (_name, buffer) => {
        const {mediabunny} = createFakeMediabunny({buffer});
        await expectCode(transcodeClip(request, mediabunny), 'empty-output');
    });

    test('zero encoded video frames (window past the video track) -> empty-output', async () => {
        const {mediabunny} = createFakeMediabunny({videoFrames: 0});
        await expectCode(transcodeClip(request, mediabunny), 'empty-output');
    });

    test('execute() throwing propagates (becomes transcode-failed in the worker)', async () => {
        const {mediabunny} = createFakeMediabunny({executeError: new TypeError('decoder closed')});
        await expect(transcodeClip(request, mediabunny)).rejects.toThrow('decoder closed');
    });
});

describe('toWorkerError', () => {
    test('ClipTranscodeError keeps its code; other errors -> transcode-failed', () => {
        expect(toWorkerError(new ClipTranscodeError('empty-output', 'x'))).toStrictEqual({code: 'empty-output', message: 'x'});
        expect(toWorkerError(new TypeError('y'))).toStrictEqual({code: 'transcode-failed', message: 'TypeError: y'});
        expect(toWorkerError('z')).toStrictEqual({code: 'transcode-failed', message: 'z'});
    });
});

describe('handleTranscodeRequest', () => {
    test('success: posts {ok: true, webm} once, transferring the buffer', async () => {
        const {mediabunny} = createFakeMediabunny({});
        /** @type {[import('clip-transcode').ClipTranscodeWorkerResponse, Transferable[]][]} */
        const posted = [];
        await handleTranscodeRequest(request, mediabunny, (response, transfer) => { posted.push([response, transfer]); });
        expect(posted).toHaveLength(1);
        const [response, transfer] = posted[0];
        expect(response.ok).toBe(true);
        const {webm} = /** @type {{webm: ArrayBuffer}} */ (response);
        expect(transfer).toStrictEqual([webm]);
    });

    test('failure: posts one structured error', async () => {
        const {mediabunny} = createFakeMediabunny({isValid: false});
        /** @type {import('clip-transcode').ClipTranscodeWorkerResponse[]} */
        const posted = [];
        await handleTranscodeRequest(request, mediabunny, (response) => { posted.push(response); });
        expect(posted).toHaveLength(1);
        expect(posted[0]).toMatchObject({ok: false, error: {code: 'conversion-invalid'}});
    });

    test('posting the success response throws -> a structured error is posted instead', async () => {
        const {mediabunny} = createFakeMediabunny({});
        /** @type {import('clip-transcode').ClipTranscodeWorkerResponse[]} */
        const posted = [];
        /** @type {import('clip-transcode').ClipTranscodeWorkerPost} */
        const post = (response) => {
            if (response.ok) { throw new DOMException('cannot transfer', 'DataCloneError'); }
            posted.push(response);
        };
        await handleTranscodeRequest(request, mediabunny, post);
        expect(posted).toStrictEqual([{ok: false, error: {code: 'transcode-failed', message: 'DataCloneError: cannot transfer'}}]);
    });
});
