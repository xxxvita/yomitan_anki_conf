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
 * Pure helpers of the gateway clip → WebM pipeline (spec docs/gateway-clips-to-anki-spec.md, D-1/D-4,
 * edge cases 4, 7, 12). No DOM, no WebCodecs: the encoder probe lives in clip-transcoder.js.
 */

/** Window length when `trim_duration_sec` is missing/invalid. */
export const DEFAULT_CLIP_DURATION_SEC = 30;

/** Hard cap of a saved clip. */
export const MAX_CLIP_DURATION_SEC = 60;

/** Output height cap (D-4). */
export const MAX_OUTPUT_HEIGHT = 720;

/** Output heights up to this use the low bitrate (D-4). */
const LOW_BITRATE_MAX_HEIGHT = 480;
const LOW_VIDEO_BITRATE = 800_000;
const HIGH_VIDEO_BITRATE = 1_500_000;
const AUDIO_BITRATE = 96_000;

export class ClipTranscodeError extends Error {
    /**
     * @param {import('clip-transcode').ClipTranscodeErrorCode} code
     * @param {string} message
     */
    constructor(code, message) {
        super(message);
        /** @type {string} */
        this.name = 'ClipTranscodeError';
        /** @type {import('clip-transcode').ClipTranscodeErrorCode} */
        this.code = code;
    }
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Trim window inside the gateway MP4 (edge case 4):
 * lead missing/NaN/<0 → 0; duration missing/NaN/≤0 → 30 s; length capped at 60 s; end clamped to the
 * file duration when it is known. A lead at/after the end of the file (broken metadata) restarts the window
 * at 0 so the result is never empty.
 * @param {import('clip-transcode').ClipWindowInput} input
 * @returns {import('clip-transcode').ClipWindow}
 */
export function computeClipWindow({leadTrimSec, trimDurationSec, mediaDurationSec}) {
    let startSec = isFiniteNumber(leadTrimSec) && leadTrimSec >= 0 ? leadTrimSec : 0;
    const lengthSec = Math.min(
        isFiniteNumber(trimDurationSec) && trimDurationSec > 0 ? trimDurationSec : DEFAULT_CLIP_DURATION_SEC,
        MAX_CLIP_DURATION_SEC,
    );
    const mediaKnown = isFiniteNumber(mediaDurationSec) && mediaDurationSec > 0;
    if (mediaKnown && startSec >= mediaDurationSec) {
        startSec = 0;
    }
    let endSec = startSec + lengthSec;
    if (mediaKnown) {
        endSec = Math.min(endSec, mediaDurationSec);
    }
    return {startSec, endSec};
}

/**
 * @param {number} value
 * @returns {number}
 */
function floorEven(value) {
    return Math.max(2, Math.floor(value / 2) * 2);
}

/**
 * Output codec, size and bitrates (D-4): never upscale, height > 720 → 720 keeping aspect, even dimensions
 * (rounded down), video bitrate by output height. Firefox prefers VP8 (VP9 encode is ~4x slower there).
 * @param {import('clip-transcode').ChooseOutputSettingsInput} input
 * @returns {import('clip-transcode').ClipOutputSettings}
 * @throws {ClipTranscodeError} `invalid-source-size` or `encoder-unsupported`.
 */
export function chooseOutputSettings({sourceWidth, sourceHeight, vp9Supported, vp8Supported, opusSupported, isFirefox}) {
    if (!isFiniteNumber(sourceWidth) || !isFiniteNumber(sourceHeight) || sourceWidth < 2 || sourceHeight < 2) {
        throw new ClipTranscodeError('invalid-source-size', `Invalid source video size: ${sourceWidth}x${sourceHeight}`);
    }
    if (opusSupported === false) {
        throw new ClipTranscodeError('encoder-unsupported', 'Opus audio encoder is not available');
    }
    /** @type {import('clip-transcode').ClipVideoCodec} */
    let codec;
    if (isFirefox ? vp8Supported : vp9Supported) {
        codec = isFirefox ? 'vp8' : 'vp9';
    } else if (isFirefox ? vp9Supported : vp8Supported) {
        codec = isFirefox ? 'vp9' : 'vp8';
    } else {
        throw new ClipTranscodeError('encoder-unsupported', 'Neither VP9 nor VP8 video encoder is available');
    }

    let width = sourceWidth;
    let height = sourceHeight;
    if (height > MAX_OUTPUT_HEIGHT) {
        width = (sourceWidth * MAX_OUTPUT_HEIGHT) / sourceHeight;
        height = MAX_OUTPUT_HEIGHT;
    }
    width = floorEven(width);
    height = floorEven(height);

    return {
        codec,
        width,
        height,
        videoBitrate: height <= LOW_BITRATE_MAX_HEIGHT ? LOW_VIDEO_BITRATE : HIGH_VIDEO_BITRATE,
        audioBitrate: AUDIO_BITRATE,
    };
}

/**
 * Content-addressed Anki media name (edge case 7): the same WebM bytes always get the same name.
 * @param {Uint8Array} bytes
 * @returns {Promise<string>} `flib-<sha256 hex>.webm`
 * @throws {ClipTranscodeError} `empty-output` for zero bytes.
 */
export async function flibMediaFileName(bytes) {
    if (bytes.byteLength === 0) {
        throw new ClipTranscodeError('empty-output', 'Transcoded clip is empty');
    }
    const digest = await crypto.subtle.digest('SHA-256', bytes);
    let hex = '';
    for (const byte of new Uint8Array(digest)) {
        hex += byte.toString(16).padStart(2, '0');
    }
    return `flib-${hex}.webm`;
}
