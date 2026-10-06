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

import {Uint8ArrayReader, Uint8ArrayWriter, ZipWriter} from '../../lib/zip.js';
import {anyAbortSignal, createTimeoutSignal} from '../core/abort-signal-util.js';
import {ExtensionError} from '../core/extension-error.js';
import {parseJson, readResponseJson} from '../core/json.js';
import {isLocalGatewayHost, normalizeFlibPersonalKey, resolveFlibGatewayBase} from '../data/flib-service-config.js';

/*
 * Клиент шлюза Flib (cache.flib.club) для сервис-воркера.
 *
 * Все ошибки — ExtensionError с `message === data.code` и `data = {code, status}`:
 * `data` переживает сериализацию через сообщения (ExtensionError.serialize),
 * а голое свойство `code` — нет.
 *
 * Коды: flib_key_missing, flib_key_invalid, flib_rate_limited,
 * flib_service_unavailable, flib_network, flib_aborted, flib_bad_request,
 * flib_bad_response, flib_http_error, flib_forbidden (403 без кода в теле),
 * <код из тела 403> (examples_forbidden, examples_quota_exhausted, demo_*…),
 * flib_word_empty, flib_word_too_long, flib_upload_failed, flib_job_failed,
 * flib_job_timeout, flib_clip_not_ready, flib_clip_too_large, flib_timeout
 * (собственный таймаут запроса; внутри опроса задания он транзиентный).
 */

const WORD_MAX_CODE_POINTS = 80;
/** M3: бюджет задания считается от начала create, а не от первого опроса. */
const DEFAULT_JOB_BUDGET_MS = 240000;
/** H2: потолок одного запроса — иначе зависший fetch переживает любой бюджет. */
const DEFAULT_REQUEST_TIMEOUT_MS = 20000;
/** Клип — видео до десятков МБ, ему нужно больше времени. */
const DEFAULT_CLIP_TIMEOUT_MS = 60000;
const EXAMPLE_KINDS = new Set(['youtube', 'film', 'any']);
const DEFAULT_EXAMPLES_LIMIT = 6;
const DEFAULT_PER_WORD = 3;
/** Первые опросы чаще: короткое задание не должно ждать лишние 3 с. */
const FAST_POLL_MS = 1500;
const FAST_POLL_COUNT = 4;
const SLOW_POLL_MS = 3000;
const CLIP_STATUSES = new Set(['queued', 'downloading', 'ready', 'failed']);
/** Коды из тела 403 пробрасываются только в этом виде — сырой текст в код не попадает. */
const ERROR_CODE_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
/** id клипа подставляется в путь: только то, что не может его сломать. */
const CLIP_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
const IMDB_URL_PREFIX = 'https://www.imdb.com/title/';

/**
 * @param {string} code
 * @param {?number} [status]
 * @param {Record<string, unknown>} [extra]
 * @returns {ExtensionError}
 */
export function createFlibError(code, status = null, extra = {}) {
    const error = new ExtensionError(code);
    error.data = {...extra, code, status};
    return error;
}

/**
 * @param {unknown} error
 * @returns {?string}
 */
function getFlibErrorCode(error) {
    if (!(error instanceof ExtensionError)) { return null; }
    const data = /** @type {{code?: unknown}} */ (error.data ?? {});
    return typeof data.code === 'string' ? data.code : null;
}

/**
 * @param {unknown} value
 * @returns {?Record<string, unknown>}
 */
function asRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value) ?
        /** @type {Record<string, unknown>} */ (value) :
        null;
}

/**
 * @param {unknown} value
 * @returns {value is number}
 */
function isFiniteNumber(value) {
    return typeof value === 'number' && Number.isFinite(value);
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function isNonEmptyString(value) {
    return typeof value === 'string' && value !== '';
}

/**
 * Значение «число или null»; `undefined` (поля нет) тоже null.
 * @param {unknown} value
 * @returns {number | null | undefined} undefined — значение есть, но не годится.
 */
function numberOrNull(value) {
    if (value === null || typeof value === 'undefined') { return null; }
    return isFiniteNumber(value) ? value : void 0;
}

/**
 * @param {unknown} value
 * @returns {string | null | undefined} undefined — значение есть, но не годится.
 */
function stringOrNull(value) {
    if (value === null || typeof value === 'undefined') { return null; }
    return typeof value === 'string' ? value : void 0;
}

/**
 * @param {unknown} value
 * @returns {?string}
 */
function httpUrlOrNull(value) {
    if (typeof value !== 'string') { return null; }
    try {
        const url = new URL(value);
        return (url.protocol === 'https:' || url.protocol === 'http:') ? value : null;
    } catch (e) {
        return null;
    }
}

/**
 * Presigned-адрес загрузки: https, а открытый http — только на эту машину (H3).
 * @param {unknown} value
 * @returns {?string}
 */
function secureUrlOrNull(value) {
    if (typeof value !== 'string') { return null; }
    try {
        const url = new URL(value);
        if (url.protocol === 'https:') { return value; }
        return (url.protocol === 'http:' && isLocalGatewayHost(url.hostname)) ? value : null;
    } catch (e) {
        return null;
    }
}

/**
 * Целое в [min, max]; нечисло → fallback.
 * @param {unknown} value
 * @param {number} min
 * @param {number} max
 * @param {number} fallback
 * @returns {number}
 */
function clampInt(value, min, max, fallback) {
    if (!isFiniteNumber(value)) { return fallback; }
    return Math.min(max, Math.max(min, Math.floor(value)));
}

/**
 * @param {?AbortSignal | undefined} signal
 * @throws {ExtensionError}
 */
function throwIfAborted(signal) {
    if (signal?.aborted) { throw createFlibError('flib_aborted'); }
}

/**
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
function defaultSleep(ms, signal) {
    return new Promise((resolve, reject) => {
        if (signal?.aborted) {
            reject(createFlibError('flib_aborted'));
            return;
        }
        /** @type {() => void} */
        const onAbort = () => {
            clearTimeout(timer);
            reject(createFlibError('flib_aborted'));
        };
        const timer = setTimeout(() => {
            signal?.removeEventListener('abort', onAbort);
            resolve();
        }, ms);
        signal?.addEventListener('abort', onAbort, {once: true});
    });
}

/**
 * base64 без `String.fromCharCode(...bytes)` на весь буфер (на десятках МБ
 * это переполняет стек аргументов) и без посимвольной склейки.
 * @param {ArrayBuffer} arrayBuffer
 * @returns {string}
 */
export function encodeBase64Chunked(arrayBuffer) {
    const bytes = new Uint8Array(arrayBuffer);
    const chunkSize = 0x8000;
    /** @type {string[]} */
    const parts = [];
    for (let i = 0; i < bytes.length; i += chunkSize) {
        parts.push(String.fromCharCode(...bytes.subarray(i, i + chunkSize)));
    }
    return btoa(parts.join(''));
}

/**
 * @param {unknown} value
 * @returns {?import('flib-gateway').ExampleItem}
 */
function sanitizeExampleItem(value) {
    const item = asRecord(value);
    if (item === null) { return null; }
    const {source, ref} = item;
    if (!isNonEmptyString(source) || !isNonEmptyString(ref)) { return null; }
    const startMs = numberOrNull(item.start_ms);
    const endMs = numberOrNull(item.end_ms);
    const textEn = stringOrNull(item.text_en);
    const textRu = stringOrNull(item.text_ru);
    const thumbnailUrl = stringOrNull(item.thumbnail_url);
    if (
        typeof startMs === 'undefined' || typeof endMs === 'undefined' ||
        typeof textEn === 'undefined' || typeof textRu === 'undefined' ||
        typeof thumbnailUrl === 'undefined'
    ) {
        return null;
    }
    return {
        source,
        ref,
        start_ms: startMs,
        end_ms: endMs,
        text_en: textEn,
        text_ru: textRu,
        thumbnail_url: thumbnailUrl === null ? null : httpUrlOrNull(thumbnailUrl),
    };
}

/**
 * @param {unknown} value
 * @returns {?import('flib-gateway').WordExampleClip}
 */
function sanitizeWordExampleClip(value) {
    const clip = asRecord(value);
    if (clip === null || !isFiniteNumber(clip.order_index) || !Array.isArray(clip.subs)) { return null; }
    /** @type {import('flib-gateway').WordExampleSub[]} */
    const subs = [];
    for (const subValue of /** @type {unknown[]} */ (clip.subs)) {
        const sub = asRecord(subValue);
        if (sub === null) { continue; }
        const {rel_start_ms: relStartMs, rel_end_ms: relEndMs, text} = sub;
        if (!isFiniteNumber(relStartMs) || !isFiniteNumber(relEndMs) || typeof text !== 'string') { continue; }
        subs.push({rel_start_ms: relStartMs, rel_end_ms: relEndMs, text});
    }
    const difficulty = clip.difficulty;
    return {
        order_index: clip.order_index,
        subs,
        trim_duration_sec: numberOrNull(clip.trim_duration_sec) ?? null,
        year: numberOrNull(clip.year) ?? null,
        cefr: stringOrNull(clip.cefr) ?? null,
        difficulty: (isFiniteNumber(difficulty) || typeof difficulty === 'string') ? difficulty : null,
    };
}

/**
 * @param {unknown} value
 * @returns {?import('flib-gateway').WordExampleSet}
 */
function sanitizeWordExampleSet(value) {
    const set = asRecord(value);
    if (set === null || typeof set.word !== 'string') { return null; }
    /** @type {import('flib-gateway').WordExampleClip[]} */
    const clips = [];
    if (Array.isArray(set.clips)) {
        for (const clipValue of /** @type {unknown[]} */ (set.clips)) {
            const clip = sanitizeWordExampleClip(clipValue);
            if (clip !== null) { clips.push(clip); }
        }
    }
    const matchedForms = Array.isArray(set.matched_forms) ?
        /** @type {unknown[]} */ (set.matched_forms).filter((form) => typeof form === 'string') :
        [];
    return {
        word: set.word,
        lemma: typeof set.lemma === 'string' ? set.lemma : '',
        token: isNonEmptyString(set.token) ? set.token : null,
        clips,
        matched_forms: /** @type {string[]} */ (matchedForms),
        empty_reason: stringOrNull(set.empty_reason) ?? null,
    };
}

/**
 * @param {unknown} value
 * @returns {import('flib-gateway').ClipSource | undefined}
 */
function sanitizeClipSource(value) {
    const source = asRecord(value);
    if (source === null) { return void 0; }
    /** @type {import('flib-gateway').ClipSource} */
    const result = {};
    if (isNonEmptyString(source.title)) { result.title = source.title; }
    if (isNonEmptyString(source.title_ru)) { result.title_ru = source.title_ru; }
    if (Number.isInteger(source.year)) { result.year = /** @type {number} */ (source.year); }
    if (Number.isInteger(source.media_type)) { result.media_type = /** @type {number} */ (source.media_type); }
    if (Number.isInteger(source.season)) { result.season = /** @type {number} */ (source.season); }
    if (Number.isInteger(source.episode)) { result.episode = /** @type {number} */ (source.episode); }
    if (typeof source.imdb_id === 'string' && /^tt\d{1,12}$/.test(source.imdb_id)) { result.imdb_id = source.imdb_id; }
    // ⚠️ Ссылка уйдёт в интерфейс кликабельной: только IMDb, только https.
    if (typeof source.imdb_url === 'string' && source.imdb_url.startsWith(IMDB_URL_PREFIX)) { result.imdb_url = source.imdb_url; }
    return Object.keys(result).length > 0 ? result : void 0;
}

/**
 * @param {unknown} value
 * @returns {?import('flib-gateway').ClipStatus}
 */
function asClipStatus(value) {
    return typeof value === 'string' && CLIP_STATUSES.has(value) ?
        /** @type {import('flib-gateway').ClipStatus} */ (value) :
        null;
}

/**
 * @typedef {object} RequestOptions
 * @property {unknown} [body] JSON-тело.
 * @property {AbortSignal} [signal] Отмена вызывающим.
 * @property {number} [timeoutMs] Потолок этого запроса.
 */

export class FlibGatewayClient {
    /**
     * @param {import('flib-gateway').GatewayClientDetails} details
     */
    constructor({fetch, getBase, getKey, now, sleep, requestTimeoutMs, clipTimeoutMs, timeoutSignal}) {
        /** @type {typeof fetch} */
        this._fetch = fetch;
        /** @type {() => (string | Promise<string>)} */
        this._getBase = getBase;
        /** @type {() => (string | Promise<string>)} */
        this._getKey = getKey;
        /** @type {() => number} */
        this._now = now ?? (() => Date.now());
        /** @type {(ms: number, signal?: AbortSignal) => Promise<void>} */
        this._sleep = sleep ?? defaultSleep;
        /** @type {number} */
        this._requestTimeoutMs = requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
        /** @type {number} */
        this._clipTimeoutMs = clipTimeoutMs ?? DEFAULT_CLIP_TIMEOUT_MS;
        /** @type {(ms: number) => AbortSignal} */
        this._timeoutSignal = timeoutSignal ?? createTimeoutSignal;
    }

    /**
     * @param {string} word
     * @param {import('flib-gateway').ExamplesOptions} [options]
     * @returns {Promise<import('flib-gateway').ExamplesResponse>}
     */
    async getExamples(word, {kind = 'youtube', limit = DEFAULT_EXAMPLES_LIMIT, signal} = {}) {
        const trimmed = typeof word === 'string' ? word.trim() : '';
        if (trimmed === '') { throw createFlibError('flib_word_empty'); }
        if ([...trimmed].length > WORD_MAX_CODE_POINTS) { throw createFlibError('flib_word_too_long'); }
        if (!EXAMPLE_KINDS.has(kind)) { throw createFlibError('flib_bad_request'); }
        const requestBody = {word: trimmed, kind, limit: clampInt(limit, 1, 10, DEFAULT_EXAMPLES_LIMIT)};
        const body = asRecord(await this._requestJson('POST', '/v1/examples', {body: requestBody, signal}));
        if (body === null || !Array.isArray(body.items)) { throw createFlibError('flib_bad_response', 200); }
        /** @type {import('flib-gateway').ExampleItem[]} */
        const items = [];
        for (const value of /** @type {unknown[]} */ (body.items)) {
            const item = sanitizeExampleItem(value);
            if (item !== null) { items.push(item); }
        }
        let emptyReason = items.length > 0 ? null : (stringOrNull(body.empty_reason) ?? null);
        // Шлюз прислал элементы, а годных нет — та же ситуация, что его собственная
        // причина no_usable_examples; не выдаём пустоту без причины.
        if (items.length === 0 && emptyReason === null) { emptyReason = 'no_usable_examples'; }
        return {
            word: typeof body.word === 'string' ? body.word : trimmed,
            items,
            empty_reason: emptyReason,
        };
    }

    /**
     * Задание word_examples через маршрутную очередь шлюза:
     * create → PUT zip (presigned, без ключа) → submit → опрос.
     * Повторяет anki_conf lexicon/routeclient.go runJobBudgetPhased.
     *
     * Бюджет (M3) отсчитывается от начала create и ограничивает и каждый запрос
     * (H2): ни один шаг не может пережить его, даже зависнув.
     * @param {string[]} words
     * @param {import('flib-gateway').WordExamplesJobOptions} [options]
     * @returns {Promise<import('flib-gateway').WordExamplesResult>}
     */
    async runWordExamplesJob(words, {perWord = DEFAULT_PER_WORD, onPhase, signal, budgetMs = DEFAULT_JOB_BUDGET_MS} = {}) {
        const cleanWords = Array.isArray(words) ?
            words.filter((w) => typeof w === 'string').map((w) => w.trim()).filter((w) => w !== '') :
            [];
        if (cleanWords.length === 0 || cleanWords.length !== words.length) { throw createFlibError('flib_bad_request'); }
        throwIfAborted(signal);
        const deadline = this._now() + budgetMs;
        /**
         * @returns {number}
         * @throws {ExtensionError} flib_job_timeout, если бюджет исчерпан.
         */
        const stepTimeout = () => {
            const remaining = deadline - this._now();
            if (remaining <= 0) { throw createFlibError('flib_job_timeout', null, {budgetMs}); }
            return Math.min(remaining, this._requestTimeoutMs);
        };
        /** @type {(phase: string) => void} */
        const emitPhase = (phase) => {
            if (typeof onPhase !== 'function') { return; }
            try {
                onPhase(phase);
            } catch (e) {
                // Сбой наблюдателя не должен ронять задание.
            }
        };

        // 1. create
        const created = asRecord(await this._requestJson('POST', '/v1/route/jobs', {body: {}, signal, timeoutMs: stepTimeout()}));
        const jobId = created?.job_id;
        const uploadUrl = secureUrlOrNull(created?.input_upload_url);
        if (!isNonEmptyString(jobId) || uploadUrl === null) { throw createFlibError('flib_bad_response'); }
        const jobPath = `/v1/route/jobs/${encodeURIComponent(jobId)}`;

        // 2. zip + upload
        const jobJson = JSON.stringify({
            type: 'word_examples',
            word_examples_request: {
                words: cleanWords,
                lang: 'en',
                per_word: clampInt(perWord, 1, 10, DEFAULT_PER_WORD),
                kind: 'puzzle_movies',
            },
        });
        const zipBytes = await this._buildJobZip(jobJson);
        await this._upload(uploadUrl, zipBytes, signal, stepTimeout());

        // 3. submit
        await this._send('POST', `${jobPath}/submit`, {signal, timeoutMs: stepTimeout()});
        emitPhase('submitted');

        // 4. poll
        let pollCount = 0;
        for (;;) {
            throwIfAborted(signal);
            /** @type {?Record<string, unknown>} */
            let state = null;
            try {
                state = asRecord(await this._requestJson('GET', jobPath, {signal, timeoutMs: stepTimeout()}));
            } catch (e) {
                if (!this._isTransientError(e)) { throw e; }
            }
            if (state !== null) {
                const status = typeof state.status === 'string' ? state.status : '';
                if (status !== '') { emitPhase(status); }
                switch (status) {
                    case 'done':
                        return this._parseWordExamplesContent(state.response_content);
                    case 'failed':
                        throw createFlibError('flib_job_failed', null, {error: typeof state.error === 'string' ? state.error : ''});
                    case 'expired':
                        throw createFlibError('flib_job_failed', null, {error: typeof state.error === 'string' && state.error !== '' ? state.error : 'expired'});
                }
            }
            ++pollCount;
            const remaining = deadline - this._now();
            if (remaining <= 0) { throw createFlibError('flib_job_timeout', null, {budgetMs}); }
            await this._sleep(Math.min(pollCount <= FAST_POLL_COUNT ? FAST_POLL_MS : SLOW_POLL_MS, remaining), signal);
        }
    }

    /**
     * @param {string} token
     * @returns {Promise<import('flib-gateway').RedeemResult>}
     */
    async redeemClipToken(token) {
        if (!isNonEmptyString(token)) { throw createFlibError('flib_bad_request'); }
        const body = asRecord(await this._requestJson('POST', '/v1/puzzle_movies/clips', {body: {token}}));
        if (body === null || !isNonEmptyString(body.batch_id) || !Array.isArray(body.clips)) {
            throw createFlibError('flib_bad_response');
        }
        /** @type {import('flib-gateway').RedeemedClip[]} */
        const clips = [];
        for (const value of /** @type {unknown[]} */ (body.clips)) {
            const clip = asRecord(value);
            if (clip === null || !isNonEmptyString(clip.clip_id)) { continue; }
            /** @type {import('flib-gateway').RedeemedClip} */
            const item = {
                clip_id: clip.clip_id,
                status: asClipStatus(clip.status) ?? 'queued',
                order_index: isFiniteNumber(clip.order_index) ? clip.order_index : null,
            };
            if (typeof clip.error === 'string' && clip.error !== '') { item.error = clip.error; }
            clips.push(item);
        }
        return {batch_id: body.batch_id, clips};
    }

    /**
     * @param {string} clipId
     * @returns {Promise<import('flib-gateway').ClipInfo>}
     */
    async getClip(clipId) {
        const path = this._clipPath(clipId);
        const body = asRecord(await this._requestJson('GET', path));
        const status = asClipStatus(body?.status);
        if (body === null || !isNonEmptyString(body.clip_id) || status === null) {
            throw createFlibError('flib_bad_response');
        }
        /** @type {import('flib-gateway').ClipInfo} */
        const result = {
            clip_id: body.clip_id,
            status,
            duration_sec: numberOrNull(body.duration_sec) ?? null,
            lead_trim_sec: numberOrNull(body.lead_trim_sec) ?? null,
            size_bytes: numberOrNull(body.size_bytes) ?? null,
            download_url: httpUrlOrNull(body.download_url),
        };
        if (typeof body.error === 'string' && body.error !== '') { result.error = body.error; }
        const source = sanitizeClipSource(body.source);
        if (typeof source !== 'undefined') { result.source = source; }
        return result;
    }

    /**
     * Байты клипа. M4: тело читается потоком со счётчиком, и поток отменяется,
     * как только счётчик перешёл потолок, — Content-Length может не прийти
     * вовсе, и без счётчика потолок держался бы только на честности сервера.
     * @param {string} clipId
     * @param {{maxBytes?: number}} [options]
     * @returns {Promise<import('flib-gateway').ClipData>}
     */
    async fetchClipData(clipId, {maxBytes = Number.POSITIVE_INFINITY} = {}) {
        const path = `${this._clipPath(clipId)}/data`;
        const {response, timeout} = await this._send('GET', path, {timeoutMs: this._clipTimeoutMs});
        const tooLarge = (/** @type {number} */ size) => createFlibError('flib_clip_too_large', response.status, {size, maxBytes});
        const contentLength = Number.parseInt(response.headers.get('Content-Length') ?? '', 10);
        if (Number.isFinite(contentLength) && contentLength > maxBytes) {
            void response.body?.cancel().catch(() => {});
            throw tooLarge(contentLength);
        }
        const contentType = response.headers.get('Content-Type') ?? 'application/octet-stream';
        const stream = response.body;
        if (stream === null) {
            return {data: new ArrayBuffer(0), contentType};
        }
        const reader = stream.getReader();
        /** @type {Uint8Array[]} */
        const chunks = [];
        let total = 0;
        try {
            for (;;) {
                const {done, value} = await reader.read();
                if (done) { break; }
                total += value.byteLength;
                if (total > maxBytes) {
                    void reader.cancel().catch(() => {});
                    throw tooLarge(total);
                }
                chunks.push(value);
            }
        } catch (e) {
            if (getFlibErrorCode(e) !== null) { throw e; }
            throw this._createTransportError(e, void 0, timeout);
        }
        const data = new Uint8Array(total);
        let offset = 0;
        for (const chunk of chunks) {
            data.set(chunk, offset);
            offset += chunk.byteLength;
        }
        return {data: data.buffer, contentType};
    }

    // Private

    /**
     * @param {string} clipId
     * @returns {string}
     * @throws {ExtensionError}
     */
    _clipPath(clipId) {
        if (typeof clipId !== 'string' || !CLIP_ID_PATTERN.test(clipId)) { throw createFlibError('flib_bad_request'); }
        return `/v1/puzzle_movies/clips/${clipId}`;
    }

    /**
     * @returns {Promise<string>}
     * @throws {ExtensionError}
     */
    async _requireKey() {
        const {valid, value} = normalizeFlibPersonalKey(await this._getKey());
        if (valid && value === '') { throw createFlibError('flib_key_missing'); }
        // Ключ не того формата шлюз всё равно отвергнет 401 — не отправляем его вовсе.
        if (!valid) { throw createFlibError('flib_key_invalid'); }
        return value;
    }

    /**
     * Сигнал запроса: отмена вызывающего ИЛИ собственный таймаут (H2).
     * @param {AbortSignal | undefined} signal
     * @param {number} timeoutMs
     * @returns {{combined: AbortSignal, timeout: AbortSignal}}
     */
    _createRequestSignal(signal, timeoutMs) {
        const timeout = this._timeoutSignal(Math.max(1, Math.ceil(timeoutMs)));
        const combined = typeof signal !== 'undefined' ? anyAbortSignal([signal, timeout]) : timeout;
        return {combined, timeout};
    }

    /**
     * Сбой транспорта → код: отмена вызывающим, собственный таймаут или сеть.
     * @param {unknown} error
     * @param {AbortSignal | undefined} signal
     * @param {AbortSignal} timeout
     * @returns {ExtensionError}
     */
    _createTransportError(error, signal, timeout) {
        if (signal?.aborted) { return createFlibError('flib_aborted'); }
        if (timeout.aborted) { return createFlibError('flib_timeout'); }
        return createFlibError('flib_network', null, {message: error instanceof Error ? error.message : String(error)});
    }

    /**
     * Запрос к шлюзу с ключом. Не-2xx превращается в ошибку с кодом.
     *
     * ⚠️ H3: `redirect: 'error'` — шлюз не редиректит, а следование редиректу
     * могло бы унести запрос (и тело) на другой адрес.
     * @param {string} method
     * @param {string} path
     * @param {RequestOptions} [options]
     * @returns {Promise<{response: Response, timeout: AbortSignal}>}
     */
    async _send(method, path, {body, signal, timeoutMs} = {}) {
        const key = await this._requireKey();
        throwIfAborted(signal);
        const {combined, timeout} = this._createRequestSignal(signal, timeoutMs ?? this._requestTimeoutMs);
        /** @type {Record<string, string>} */
        const headers = {Authorization: `Bearer ${key}`};
        /** @type {RequestInit} */
        const init = {method, headers, cache: 'no-store', credentials: 'omit', redirect: 'error', signal: combined};
        if (typeof body !== 'undefined') {
            headers['Content-Type'] = 'application/json';
            init.body = JSON.stringify(body);
        }
        const url = `${resolveFlibGatewayBase(await this._getBase())}${path}`;
        /** @type {Response} */
        let response;
        try {
            response = await this._fetch(url, init);
        } catch (e) {
            throw this._createTransportError(e, signal, timeout);
        }
        if (!response.ok) { throw await this._createHttpError(response); }
        return {response, timeout};
    }

    /**
     * @param {string} method
     * @param {string} path
     * @param {RequestOptions} [options]
     * @returns {Promise<unknown>}
     */
    async _requestJson(method, path, options = {}) {
        const {response, timeout} = await this._send(method, path, options);
        try {
            return await readResponseJson(response);
        } catch (e) {
            if (options.signal?.aborted || timeout.aborted) { throw this._createTransportError(e, options.signal, timeout); }
            throw createFlibError('flib_bad_response', response.status);
        }
    }

    /**
     * @param {Response} response
     * @returns {Promise<ExtensionError>}
     */
    async _createHttpError(response) {
        const {status} = response;
        /** @type {?string} */
        let reason = null;
        try {
            const body = asRecord(await readResponseJson(response));
            if (body !== null && typeof body.error === 'string' && ERROR_CODE_PATTERN.test(body.error)) {
                reason = body.error;
            }
        } catch (e) {
            // Тело не JSON — код определяется одним статусом.
        }
        const extra = reason !== null ? {reason} : {};
        switch (status) {
            case 401: return createFlibError('flib_key_invalid', status, extra);
            case 403: return createFlibError(reason ?? 'flib_forbidden', status, extra);
            case 425: return createFlibError('flib_clip_not_ready', status, extra);
            case 429: return createFlibError('flib_rate_limited', status, extra);
            case 503: return createFlibError('flib_service_unavailable', status, extra);
            default: return createFlibError('flib_http_error', status, extra);
        }
    }

    /**
     * Сбой опроса, после которого стоит спросить ещё раз, а не бросать задание.
     * @param {unknown} error
     * @returns {boolean}
     */
    _isTransientError(error) {
        const code = getFlibErrorCode(error);
        if (code === 'flib_network' || code === 'flib_timeout' || code === 'flib_service_unavailable' || code === 'flib_rate_limited' || code === 'flib_bad_response') { return true; }
        if (code === 'flib_http_error') {
            const status = /** @type {{status?: unknown}} */ (/** @type {ExtensionError} */ (error).data).status;
            return typeof status === 'number' && status >= 500;
        }
        return false;
    }

    /**
     * @param {string} jobJson
     * @returns {Promise<Uint8Array>}
     */
    async _buildJobZip(jobJson) {
        // ⚠️ useWebWorkers: false — в сервис-воркере нельзя порождать Worker.
        // level 0 — несжатая запись: job.json крошечный, а сжатие тянуло бы
        // CompressionStream, которого может не оказаться.
        const writer = new ZipWriter(new Uint8ArrayWriter(), {useWebWorkers: false, level: 0});
        await writer.add('job.json', new Uint8ArrayReader(new TextEncoder().encode(jobJson)));
        return await writer.close();
    }

    /**
     * ⚠️ Presigned PUT идёт БЕЗ Authorization: адрес ведёт в хранилище, не в
     * шлюз, и личный ключ туда утекать не должен (подпись уже в адресе).
     * @param {string} url
     * @param {Uint8Array} bytes
     * @param {AbortSignal | undefined} signal
     * @param {number} timeoutMs
     */
    async _upload(url, bytes, signal, timeoutMs) {
        throwIfAborted(signal);
        const {combined, timeout} = this._createRequestSignal(signal, timeoutMs);
        /** @type {RequestInit} */
        const init = {
            method: 'PUT',
            headers: {'Content-Type': 'application/zip'},
            body: bytes,
            cache: 'no-store',
            credentials: 'omit',
            redirect: 'error',
            signal: combined,
        };
        /** @type {Response} */
        let response;
        try {
            response = await this._fetch(url, init);
        } catch (e) {
            throw this._createTransportError(e, signal, timeout);
        }
        if (!response.ok) { throw createFlibError('flib_upload_failed', response.status); }
    }

    /**
     * `response_content` приходит то JSON-строкой, то уже объектом.
     * @param {unknown} content
     * @returns {import('flib-gateway').WordExamplesResult}
     * @throws {ExtensionError} flib_bad_response, если форма не та.
     */
    _parseWordExamplesContent(content) {
        let value = content;
        if (typeof value === 'string') {
            try {
                value = parseJson(value);
            } catch (e) {
                throw createFlibError('flib_bad_response');
            }
        }
        const body = asRecord(value);
        if (body === null || !Array.isArray(body.results)) { throw createFlibError('flib_bad_response'); }
        /** @type {import('flib-gateway').WordExampleSet[]} */
        const results = [];
        for (const item of /** @type {unknown[]} */ (body.results)) {
            const set = sanitizeWordExampleSet(item);
            if (set !== null) { results.push(set); }
        }
        return {results};
    }
}
