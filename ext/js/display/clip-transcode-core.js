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

/**
 * Core of clip-transcode-worker.js, split out so it can be tested without a Worker and without real codecs:
 * mediabunny is passed in as a dependency. Trims a gateway MP4 (H.264/AAC) to a window and transcodes it to
 * WebM (VP9|VP8 + Opus).
 */

import {ClipTranscodeError} from './clip-transcode-util.js';

/** Discard reasons that mean "this browser cannot do it" rather than "user choice". */
export const CODEC_DISCARD_REASONS = new Set(['unknown_source_codec', 'undecodable_source_codec', 'no_encodable_target_codec']);

/**
 * @param {import('clip-transcode').ClipTranscodeWorkerRequest} request
 * @param {import('clip-transcode').ClipTranscodeMediabunny} mediabunny
 * @returns {Promise<ArrayBuffer>} WebM bytes with at least one encoded video frame.
 * @throws {ClipTranscodeError|Error}
 */
export async function transcodeClip({mp4, window: clipWindow, settings}, mediabunny) {
    const {BlobSource, BufferSource, BufferTarget, Conversion, Input, MP4, Output, Quality, WebMOutputFormat} = mediabunny;
    const {startSec, endSec} = clipWindow;
    if (!(Number.isFinite(startSec) && Number.isFinite(endSec) && startSec >= 0 && endSec > startSec)) {
        throw new ClipTranscodeError('invalid-window', `Invalid clip window: ${startSec}..${endSec}`);
    }
    /** @type {import('mediabunny').Source} */
    let source;
    if (mp4 instanceof Blob) {
        source = new BlobSource(mp4);
    } else if (mp4 instanceof ArrayBuffer) {
        source = new BufferSource(mp4);
    } else {
        throw new ClipTranscodeError('invalid-input', 'Clip input must be a Blob or an ArrayBuffer');
    }

    const input = new Input({source, formats: [MP4]});
    const target = new BufferTarget();
    const output = new Output({format: new WebMOutputFormat(), target});
    // Frames that actually reach the video encoder: a window past the end of the video track (or an MP4
    // without video) converts "successfully" into a WebM with no picture.
    let videoFrameCount = 0;
    const conversion = await Conversion.init({
        input,
        output,
        trim: {start: startSec, end: endSec},
        video: {
            codec: settings.codec,
            width: settings.width,
            height: settings.height,
            fit: 'fill',
            // Explicit bitrate: mediabunny QUALITY_* presets give ~8 Mbit/s (D-4).
            quality: new Quality({bitrate: settings.videoBitrate}),
            forceTranscode: true,
            // Identity transform, only counts frames handed to the encoder.
            process: (sample) => {
                ++videoFrameCount;
                return sample;
            },
        },
        audio: {
            codec: 'opus',
            quality: new Quality({bitrate: settings.audioBitrate}),
            forceTranscode: true,
        },
        showWarnings: false,
    });

    const discarded = conversion.discardedTracks;
    const codecProblems = discarded.filter(({reason}) => CODEC_DISCARD_REASONS.has(reason));
    if (!conversion.isValid || codecProblems.length > 0) {
        const reasons = discarded.map(({track, reason}) => `${track.type}: ${reason}`).join(', ');
        throw new ClipTranscodeError('conversion-invalid', `Clip cannot be converted to WebM (${reasons || 'no tracks'})`);
    }

    await conversion.execute();

    const buffer = target.buffer;
    if (buffer === null || buffer.byteLength === 0) {
        throw new ClipTranscodeError('empty-output', 'Transcoded clip is empty');
    }
    if (videoFrameCount === 0) {
        throw new ClipTranscodeError('empty-output', `Transcoded clip has no video frames in ${startSec}..${endSec} s`);
    }
    return buffer;
}

/**
 * @param {unknown} error
 * @returns {import('clip-transcode').ClipTranscodeWorkerError}
 */
export function toWorkerError(error) {
    if (error instanceof ClipTranscodeError) {
        return {code: error.code, message: error.message};
    }
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return {code: 'transcode-failed', message};
}

/**
 * Runs one request and posts exactly one response. A failure to post the success response (e.g. the buffer
 * cannot be transferred) is reported as a structured error instead of being lost.
 * @param {import('clip-transcode').ClipTranscodeWorkerRequest} request
 * @param {import('clip-transcode').ClipTranscodeMediabunny} mediabunny
 * @param {import('clip-transcode').ClipTranscodeWorkerPost} post
 * @returns {Promise<void>}
 */
export async function handleTranscodeRequest(request, mediabunny, post) {
    try {
        const webm = await transcodeClip(request, mediabunny);
        post({ok: true, webm}, [webm]);
    } catch (error) {
        post({ok: false, error: toWorkerError(error)}, []);
    }
}
