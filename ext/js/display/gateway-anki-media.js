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

import {log} from '../core/log.js';
import {FLIB_MEDIA_FIELD_NAME, FLIB_MEDIA_MAX_BASE64_LENGTH} from '../data/flib-anki-media.js';
import {ClipTranscodeError, chooseOutputSettings, computeClipWindow, flibMediaFileName} from './clip-transcode-util.js';
import {probeEncoderSupport, transcodeClipToWebm} from './clip-transcoder.js';
import {buildFlibMediaFieldHtml, bytesToBase64} from './gateway-examples-util.js';

/*
 * Save path of the gateway examples (spec docs/gateway-clips-to-anki-spec.md §5, §6 T3): turns the panel's
 * selection into the `flib_media` field value — check the note type, wait for each ticked clip, transcode
 * everything, and only then store the WebM files in Anki. Any failure throws a {@link FlibMediaSaveError}
 * whose message is safe to show (Russian, never base64); the caller must then skip addNote/updateNote.
 */

/** Edge case 1: how long a ticked clip may still be loading when «+» is pressed. */
export const GATEWAY_CLIP_READY_TIMEOUT_MS = 20_000;

/** Longest AnkiConnect message quoted to the user. */
const MAX_QUOTED_ERROR_LENGTH = 200;

/** Runs of base64-looking characters that must never be quoted (edge case 8). */
const BASE64_RUN_PATTERN = /[A-Za-z0-9+/=]{48,}/g;

const ERROR_TEXT = Object.freeze({
    noField: 'В типе заметки нет поля flib_media — обновите шаблон в anki_conf',
    ankiUnavailable: 'Anki недоступен',
    modelUnknown: 'Тип заметки не найден в Anki',
    clipNotReady: 'Нарезка ещё не загрузилась',
    clipFailed: 'Нарезка не загрузилась — снимите отметку с этого фрагмента',
    aborted: 'Сохранение видео отменено: панель примеров закрыта или начат новый поиск',
    encoderUnsupported: 'Браузер не умеет кодировать видео WebM (VP9/VP8 + Opus) — клип не сохранить',
    badClip: 'Не удалось подготовить клип: некорректные данные нарезки',
    transcodeFailed: 'Не удалось перекодировать клип в WebM',
    transcodeTimeout: 'Перекодирование клипа заняло слишком много времени',
    tooLarge: 'Клип слишком большой для сохранения в Anki',
    notStored: 'Anki не сохранил видеофайл (ответил другим именем)',
    badData: 'Не удалось сохранить видео в Anki: некорректные данные',
    forbidden: 'Сохранять клипы можно только из окна расширения',
});

/** A save-blocking error; its message is meant for the user. */
export class FlibMediaSaveError extends Error {
    /**
     * @param {string} message
     */
    constructor(message) {
        super(message);
        /** @type {string} */
        this.name = 'FlibMediaSaveError';
    }
}

/** Why the panel could not hand over a ticked clip. */
export class GatewayClipWaitError extends Error {
    /**
     * @param {import('gateway-anki-media').GatewayClipWaitErrorCode} code
     * @param {string} message
     */
    constructor(code, message) {
        super(message);
        /** @type {string} */
        this.name = 'GatewayClipWaitError';
        /** @type {import('gateway-anki-media').GatewayClipWaitErrorCode} */
        this.code = code;
    }
}

/**
 * Firefox by its user agent. ⚠️ Not `Environment`'s browser: it reports "firefox" whenever a `browser`
 * global exists, and current Chromium exposes one to extensions — that would pick the VP8 path in Chrome.
 * @param {string} userAgent
 * @returns {boolean}
 */
export function isFirefoxUserAgent(userAgent) {
    return /\bFirefox\/\d/.test(userAgent);
}

/** @type {WeakMap<() => Promise<import('clip-transcode').EncoderSupport>, Promise<import('clip-transcode').EncoderSupport>>} */
const encoderSupportCache = new WeakMap();

/**
 * One encoder probe per page (per probe function).
 * @param {() => Promise<import('clip-transcode').EncoderSupport>} probe
 * @returns {Promise<import('clip-transcode').EncoderSupport>}
 */
function getEncoderSupport(probe) {
    let cached = encoderSupportCache.get(probe);
    if (typeof cached === 'undefined') {
        cached = probe();
        encoderSupportCache.set(probe, cached);
        // A rejected probe is not remembered.
        cached.catch(() => { encoderSupportCache.delete(probe); });
    }
    return cached;
}

/**
 * @param {unknown} error
 * @returns {?string}
 */
function getErrorCode(error) {
    if (typeof error !== 'object' || error === null) { return null; }
    const data = /** @type {{data?: unknown}} */ (error).data;
    if (typeof data !== 'object' || data === null) { return null; }
    const code = /** @type {{code?: unknown}} */ (data).code;
    return typeof code === 'string' ? code : null;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isAbortError(error) {
    return (error instanceof DOMException || error instanceof Error) && error.name === 'AbortError';
}

/**
 * A short, base64-free excerpt of an error message.
 * @param {unknown} error
 * @returns {string}
 */
function safeExcerpt(error) {
    const message = error instanceof Error ? error.message : String(error);
    const cleaned = message.replace(BASE64_RUN_PATTERN, '…');
    return cleaned.length > MAX_QUOTED_ERROR_LENGTH ? `${cleaned.slice(0, MAX_QUOTED_ERROR_LENGTH)}…` : cleaned;
}

/**
 * @param {AbortSignal} signal
 * @throws {FlibMediaSaveError}
 */
function throwIfAborted(signal) {
    if (signal.aborted) { throw new FlibMediaSaveError(ERROR_TEXT.aborted); }
}

/**
 * @param {unknown} error
 * @returns {FlibMediaSaveError}
 */
function describeHasFieldError(error) {
    switch (getErrorCode(error)) {
        case 'flib_anki_unavailable': return new FlibMediaSaveError(ERROR_TEXT.ankiUnavailable);
        case 'flib_anki_model_unknown': return new FlibMediaSaveError(ERROR_TEXT.modelUnknown);
        case 'flib_secret_forbidden': return new FlibMediaSaveError(ERROR_TEXT.forbidden);
        default: return new FlibMediaSaveError(`Не удалось проверить тип заметки в Anki: ${safeExcerpt(error)}`);
    }
}

/**
 * @param {unknown} error
 * @returns {FlibMediaSaveError}
 */
function describePrepareError(error) {
    if (error instanceof FlibMediaSaveError) { return error; }
    if (isAbortError(error)) { return new FlibMediaSaveError(ERROR_TEXT.aborted); }
    if (error instanceof GatewayClipWaitError) {
        switch (error.code) {
            case 'timeout': return new FlibMediaSaveError(ERROR_TEXT.clipNotReady);
            case 'aborted': return new FlibMediaSaveError(ERROR_TEXT.aborted);
            default: return new FlibMediaSaveError(ERROR_TEXT.clipFailed);
        }
    }
    if (error instanceof ClipTranscodeError) {
        switch (error.code) {
            case 'encoder-unsupported': return new FlibMediaSaveError(ERROR_TEXT.encoderUnsupported);
            case 'timeout': return new FlibMediaSaveError(ERROR_TEXT.transcodeTimeout);
            case 'invalid-source-size':
            case 'invalid-window':
            case 'invalid-input':
                return new FlibMediaSaveError(ERROR_TEXT.badClip);
            default: return new FlibMediaSaveError(ERROR_TEXT.transcodeFailed);
        }
    }
    return new FlibMediaSaveError(`${ERROR_TEXT.transcodeFailed}: ${safeExcerpt(error)}`);
}

/**
 * @param {unknown} error
 * @returns {FlibMediaSaveError}
 */
function describeStoreError(error) {
    if (error instanceof FlibMediaSaveError) { return error; }
    switch (getErrorCode(error)) {
        case 'flib_media_not_stored': return new FlibMediaSaveError(ERROR_TEXT.notStored);
        case 'flib_media_too_large': return new FlibMediaSaveError(ERROR_TEXT.tooLarge);
        case 'flib_media_bad_name':
        case 'flib_media_bad_data':
            return new FlibMediaSaveError(ERROR_TEXT.badData);
        case 'flib_secret_forbidden': return new FlibMediaSaveError(ERROR_TEXT.forbidden);
        default: return new FlibMediaSaveError(`Не удалось сохранить видео в Anki: ${safeExcerpt(error)}`);
    }
}

/**
 * Builds the `flib_media` field for the ticked gateway examples, storing the transcoded clips in Anki.
 * Order (edge cases 2, 3, 6, 11): nothing ticked → null with zero work; field check; then every film is
 * waited for and transcoded; only when ALL transcodes succeeded are the files stored; then the HTML is built.
 * @param {import('gateway-anki-media').PrepareFlibMediaFieldOptions} options
 * @returns {Promise<?string>} null — nothing ticked, leave the field alone.
 * @throws {FlibMediaSaveError}
 */
export async function prepareFlibMediaField({selection, modelName, api, waitForFilm, signal, isFirefox, onProgress, deps}) {
    const {films, youtube} = selection;
    if (films.length === 0 && youtube.length === 0) { return null; }
    const probe = deps?.probeEncoderSupport ?? probeEncoderSupport;
    const transcode = deps?.transcodeClipToWebm ?? transcodeClipToWebm;
    const progress = typeof onProgress === 'function' ? onProgress : () => {};

    throwIfAborted(signal);
    let hasField;
    try {
        hasField = await api.flibAnkiModelHasField(modelName, FLIB_MEDIA_FIELD_NAME);
    } catch (e) {
        throw describeHasFieldError(e);
    }
    if (!hasField) { throw new FlibMediaSaveError(ERROR_TEXT.noField); }

    /** @type {{media: import('gateway-anki-media').GatewayFilmMedia, bytes: Uint8Array, fileName: string}[]} */
    const prepared = [];
    if (films.length > 0) {
        try {
            const support = await getEncoderSupport(probe);
            for (let i = 0; i < films.length; ++i) {
                throwIfAborted(signal);
                progress({stage: 'waiting', index: i, total: films.length});
                const media = await waitForFilm(films[i].clipId, {timeoutMs: GATEWAY_CLIP_READY_TIMEOUT_MS, signal});
                const window = computeClipWindow({
                    leadTrimSec: media.leadTrimSec,
                    trimDurationSec: media.trimDurationSec,
                    mediaDurationSec: media.durationSec,
                });
                const settings = chooseOutputSettings({
                    sourceWidth: media.videoWidth,
                    sourceHeight: media.videoHeight,
                    ...support,
                    isFirefox,
                });
                throwIfAborted(signal);
                progress({stage: 'transcoding', index: i, total: films.length});
                const bytes = await transcode(media.blob, {window, settings, signal});
                const fileName = await flibMediaFileName(bytes);
                prepared.push({media, bytes, fileName});
            }
        } catch (e) {
            const error = describePrepareError(e);
            log.log(`[flib-media] clip not prepared: ${error.message}`);
            throw error;
        }
    }

    /** @type {import('flib-media-field').FlibMediaFieldFilm[]} */
    const fieldFilms = [];
    for (let i = 0; i < prepared.length; ++i) {
        const {media, bytes, fileName} = prepared[i];
        throwIfAborted(signal);
        // Check before encoding: never build (or send) an oversized payload.
        if (Math.ceil(bytes.byteLength / 3) * 4 > FLIB_MEDIA_MAX_BASE64_LENGTH) { throw new FlibMediaSaveError(ERROR_TEXT.tooLarge); }
        progress({stage: 'storing', index: i, total: prepared.length});
        try {
            const result = await api.flibStoreAnkiMedia(fileName, bytesToBase64(bytes));
            if (typeof result !== 'object' || result === null || result.fileName !== fileName) {
                throw new FlibMediaSaveError(ERROR_TEXT.notStored);
            }
        } catch (e) {
            const error = describeStoreError(e);
            log.log(`[flib-media] clip not stored: ${error.message}`);
            throw error;
        }
        fieldFilms.push({fileName, vttText: media.vttText, title: media.title, year: media.year, imdbUrl: media.imdbUrl});
    }
    throwIfAborted(signal);

    return buildFlibMediaFieldHtml({
        films: fieldFilms,
        youtube: youtube.map(({ref, startMs, text, words}) => ({ref, startMs, text, words})),
    });
}
