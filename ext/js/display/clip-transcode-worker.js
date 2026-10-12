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
 * One-shot module worker: trims a gateway MP4 (H.264/AAC) to a window and transcodes it to WebM
 * (VP9|VP8 + Opus) with mediabunny + WebCodecs. Protocol: one ClipTranscodeWorkerRequest in, one
 * ClipTranscodeWorkerResponse out (WebM bytes transferred); the client terminates the worker afterwards.
 */

import {ALL_FORMATS, BlobSource, BufferSource, BufferTarget, Conversion, Input, Output, Quality, WebMOutputFormat} from '../../lib/mediabunny.js';
import {ClipTranscodeError} from './clip-transcode-util.js';

/** Discard reasons that mean "this browser cannot do it" rather than "user choice". */
const CODEC_DISCARD_REASONS = new Set(['unknown_source_codec', 'undecodable_source_codec', 'no_encodable_target_codec']);

/**
 * @param {import('clip-transcode').ClipTranscodeWorkerRequest} request
 * @returns {Promise<ArrayBuffer>}
 */
async function transcode({mp4, window: clipWindow, settings}) {
    const {startSec, endSec} = clipWindow;
    if (!(Number.isFinite(startSec) && Number.isFinite(endSec) && startSec >= 0 && endSec > startSec)) {
        throw new ClipTranscodeError('invalid-window', `Invalid clip window: ${startSec}..${endSec}`);
    }
    /** @type {BlobSource|InstanceType<typeof BufferSource>} */
    let source;
    if (mp4 instanceof Blob) {
        source = new BlobSource(mp4);
    } else if (mp4 instanceof ArrayBuffer) {
        source = new BufferSource(mp4);
    } else {
        throw new ClipTranscodeError('invalid-input', 'Clip input must be a Blob or an ArrayBuffer');
    }

    const input = new Input({source, formats: ALL_FORMATS});
    const target = new BufferTarget();
    const output = new Output({format: new WebMOutputFormat(), target});
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
        },
        audio: {
            codec: 'opus',
            quality: new Quality({bitrate: settings.audioBitrate}),
            forceTranscode: true,
        },
        showWarnings: false,
    });

    /** @type {{track: {type: string}, reason: string}[]} */
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
    return buffer;
}

/**
 * @param {unknown} error
 * @returns {import('clip-transcode').ClipTranscodeWorkerError}
 */
function toWorkerError(error) {
    if (error instanceof ClipTranscodeError) {
        return {code: error.code, message: error.message};
    }
    const message = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
    return {code: 'transcode-failed', message};
}

self.addEventListener('message', (event) => {
    /** @type {import('clip-transcode').ClipTranscodeWorkerRequest} */
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const request = event.data;
    void transcode(request).then(
        (webm) => {
            /** @type {import('clip-transcode').ClipTranscodeWorkerResponse} */
            const response = {ok: true, webm};
            self.postMessage(response, {transfer: [webm]});
        },
        (error) => {
            /** @type {import('clip-transcode').ClipTranscodeWorkerResponse} */
            const response = {ok: false, error: toWorkerError(error)};
            self.postMessage(response);
        },
    );
}, {once: true});
