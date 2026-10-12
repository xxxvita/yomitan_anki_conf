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

import {ClipTranscodeError} from './clip-transcode-util.js';

/**
 * Main-thread client of clip-transcode-worker.js (spec edge cases 2, 3, 11): one worker per clip, spawned only
 * when a clip is actually transcoded, terminated on success, error, timeout and abort.
 */

/** Minimum transcode timeout (edge case 2). */
export const DEFAULT_TRANSCODE_TIMEOUT_MS = 30_000;

/** Timeout budget per second of clip window: a 60 s window gets 240 s. */
export const TIMEOUT_MS_PER_CLIP_SEC = 4000;

/** Probe configs: the largest output D-4 allows. */
const VP9_PROBE_CODEC = 'vp09.00.31.08';
const PROBE_WIDTH = 1280;
const PROBE_HEIGHT = 720;
const PROBE_BITRATE = 1_500_000;

/** @type {import('clip-transcode').ClipTranscodeErrorCode[]} */
const WORKER_ERROR_CODES = [
    'encoder-unsupported',
    'invalid-source-size',
    'invalid-window',
    'invalid-input',
    'conversion-invalid',
    'transcode-failed',
    'empty-output',
    'worker-error',
    'timeout',
];

/**
 * @returns {import('clip-transcode').ClipTranscodeWorkerLike}
 */
function createDefaultWorker() {
    return new Worker(new URL('clip-transcode-worker.js', import.meta.url), {type: 'module'});
}

/**
 * Default timeout for a window: `max(30 s, 4 s per window second)`.
 * @param {import('clip-transcode').ClipWindow} clipWindow
 * @returns {number}
 */
export function computeTranscodeTimeoutMs({startSec, endSec}) {
    return Math.max(DEFAULT_TRANSCODE_TIMEOUT_MS, TIMEOUT_MS_PER_CLIP_SEC * (endSec - startSec));
}

/**
 * The signal's own reason when it is an Error/DOMException, otherwise a generic AbortError.
 * @param {AbortSignal} signal
 * @returns {Error|DOMException}
 */
function getAbortReason(signal) {
    /** @type {unknown} */
    const reason = signal.reason;
    if (reason instanceof Error || reason instanceof DOMException) {
        return reason;
    }
    return new DOMException('Clip transcode aborted', 'AbortError');
}

/**
 * @param {import('clip-transcode').ClipWindow} clipWindow
 * @returns {boolean}
 */
function isValidWindow(clipWindow) {
    const {startSec, endSec} = clipWindow;
    return Number.isFinite(startSec) && Number.isFinite(endSec) && startSec >= 0 && endSec > startSec;
}

/**
 * @param {unknown} data
 * @returns {Uint8Array}
 * @throws {ClipTranscodeError}
 */
function parseResponse(data) {
    if (typeof data !== 'object' || data === null) {
        throw new ClipTranscodeError('worker-error', 'Malformed transcode worker response');
    }
    const response = /** @type {{ok?: unknown, webm?: unknown, error?: unknown}} */ (data);
    if (response.ok === true) {
        if (!(response.webm instanceof ArrayBuffer)) {
            throw new ClipTranscodeError('worker-error', 'Transcode worker returned no WebM buffer');
        }
        if (response.webm.byteLength === 0) {
            throw new ClipTranscodeError('empty-output', 'Transcoded clip is empty');
        }
        return new Uint8Array(response.webm);
    }
    const error = /** @type {{code?: unknown, message?: unknown}} */ (typeof response.error === 'object' && response.error !== null ? response.error : {});
    const code = WORKER_ERROR_CODES.find((c) => c === error.code) ?? 'transcode-failed';
    const message = typeof error.message === 'string' && error.message.length > 0 ? error.message : 'Clip transcode failed';
    throw new ClipTranscodeError(code, message);
}

/**
 * Trims the MP4 to `window` and transcodes it to WebM in a dedicated module worker.
 * @param {Blob} mp4
 * @param {import('clip-transcode').TranscodeClipOptions} options
 * @returns {Promise<Uint8Array>} WebM bytes.
 * @throws {ClipTranscodeError|Error|DOMException} `ClipTranscodeError` with a code, or on abort the signal's
 *   reason (when it is an Error/DOMException) else an `AbortError` DOMException.
 */
export function transcodeClipToWebm(mp4, {window: clipWindow, settings, signal, timeoutMs, createWorker = createDefaultWorker}) {
    return new Promise((resolve, reject) => {
        if (typeof signal !== 'undefined' && signal.aborted) {
            reject(getAbortReason(signal));
            return;
        }
        if (!isValidWindow(clipWindow)) {
            reject(new ClipTranscodeError('invalid-window', `Invalid clip window: ${clipWindow.startSec}..${clipWindow.endSec}`));
            return;
        }
        const effectiveTimeoutMs = typeof timeoutMs === 'number' ? timeoutMs : computeTranscodeTimeoutMs(clipWindow);

        /** @type {import('clip-transcode').ClipTranscodeWorkerLike} */
        let worker;
        try {
            worker = createWorker();
        } catch (e) {
            reject(new ClipTranscodeError('worker-error', `Cannot start transcode worker: ${e instanceof Error ? e.message : String(e)}`));
            return;
        }

        let settled = false;
        /** @type {?ReturnType<typeof setTimeout>} */
        let timer = null;

        const onAbort = () => {
            finish(() => { reject(getAbortReason(/** @type {AbortSignal} */ (signal))); });
        };

        /**
         * Settles exactly once and releases everything: timer, abort listener, worker.
         * @param {() => void} settle
         */
        const finish = (settle) => {
            if (settled) { return; }
            settled = true;
            if (timer !== null) {
                clearTimeout(timer);
                timer = null;
            }
            if (typeof signal !== 'undefined') {
                signal.removeEventListener('abort', onAbort);
            }
            try {
                worker.terminate();
            } catch (e) {
                // A throwing terminate must not leave the promise pending nor escape into an event listener.
            } finally {
                settle();
            }
        };

        worker.addEventListener('message', (event) => {
            finish(() => {
                try {
                    resolve(parseResponse(/** @type {MessageEvent} */ (event).data));
                } catch (e) {
                    reject(e);
                }
            });
        });
        worker.addEventListener('error', (event) => {
            const {message} = /** @type {{message?: unknown}} */ (event);
            finish(() => { reject(new ClipTranscodeError('worker-error', `Transcode worker failed: ${typeof message === 'string' && message.length > 0 ? message : 'unknown error'}`)); });
        });
        worker.addEventListener('messageerror', () => {
            finish(() => { reject(new ClipTranscodeError('worker-error', 'Transcode worker response could not be deserialized')); });
        });

        if (typeof signal !== 'undefined') {
            signal.addEventListener('abort', onAbort, {once: true});
        }
        timer = setTimeout(() => {
            finish(() => { reject(new ClipTranscodeError('timeout', `Clip transcode exceeded ${effectiveTimeoutMs} ms`)); });
        }, effectiveTimeoutMs);

        try {
            worker.postMessage({mp4, window: clipWindow, settings});
        } catch (e) {
            finish(() => { reject(new ClipTranscodeError('worker-error', `Cannot send clip to transcode worker: ${e instanceof Error ? e.message : String(e)}`)); });
        }
    });
}

/**
 * @param {() => Promise<{supported?: boolean}>} probe
 * @returns {Promise<boolean>}
 */
async function isSupported(probe) {
    try {
        const {supported} = await probe();
        return supported === true;
    } catch (e) {
        return false;
    }
}

/**
 * Which WebCodecs encoders the save path can use (edge case 2). Missing WebCodecs → all false.
 * @returns {Promise<import('clip-transcode').EncoderSupport>}
 */
export async function probeEncoderSupport() {
    const videoEncoder = typeof VideoEncoder === 'undefined' ? null : VideoEncoder;
    const audioEncoder = typeof AudioEncoder === 'undefined' ? null : AudioEncoder;
    /**
     * @param {string} codec
     * @returns {Promise<boolean>}
     */
    const probeVideo = (codec) => (
        videoEncoder === null ?
            Promise.resolve(false) :
            isSupported(() => videoEncoder.isConfigSupported({codec, width: PROBE_WIDTH, height: PROBE_HEIGHT, bitrate: PROBE_BITRATE, framerate: 30}))
    );
    const [vp9Supported, vp8Supported, opusSupported] = await Promise.all([
        probeVideo(VP9_PROBE_CODEC),
        probeVideo('vp8'),
        audioEncoder === null ?
            Promise.resolve(false) :
            isSupported(() => audioEncoder.isConfigSupported({codec: 'opus', sampleRate: 48_000, numberOfChannels: 2, bitrate: 96_000})),
    ]);
    return {vp9Supported, vp8Supported, opusSupported};
}
