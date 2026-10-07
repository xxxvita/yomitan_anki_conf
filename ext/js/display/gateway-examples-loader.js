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

import {ExtensionError} from '../core/extension-error.js';
import {YOUTUBE_SECTION_MAX_ITEMS, base64ToBlob, getGatewayErrorCode, sanitizeYouTubeItems} from './gateway-examples-util.js';

/*
 * Сетевой сценарий панели примеров шлюза: всё идёт через backend API
 * (ключ живёт в сервис-воркере, страница его не видит).
 *
 * ⚠️ Задание word_examples НЕ ждётся одним сообщением: start + опрос
 * отсюда. Одно сообщение висело бы до бюджета задания (минуты) и упиралось
 * в лимит события MV3; опрос же каждые 1.5–3 с держит воркер живым.
 */

const JOB_FAST_POLL_MS = 1500;
const JOB_FAST_POLL_COUNT = 4;
const JOB_SLOW_POLL_MS = 3000;
const CLIP_POLL_MS = 2000;
const DEFAULT_CLIP_BUDGET_MS = 120000;
const FILMS_PER_WORD = 3;

/**
 * @param {string} code
 * @returns {ExtensionError}
 */
function gatewayError(code) {
    const error = new ExtensionError(code);
    error.data = {code, status: null};
    return error;
}

/**
 * @param {?AbortSignal | undefined} signal
 * @throws {ExtensionError}
 */
function throwIfAborted(signal) {
    if (signal?.aborted) { throw gatewayError('flib_aborted'); }
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
function defaultSleep(ms) {
    return new Promise((resolve) => { setTimeout(resolve, ms); });
}

export class GatewayExamplesLoader {
    /**
     * @param {import('../comm/api.js').API} api
     * @param {{now?: () => number, sleep?: (ms: number) => Promise<void>, clipBudgetMs?: number}} [options]
     */
    constructor(api, {now, sleep, clipBudgetMs} = {}) {
        /** @type {import('../comm/api.js').API} */
        this._api = api;
        /** @type {() => number} */
        this._now = now ?? (() => Date.now());
        /** @type {(ms: number) => Promise<void>} */
        this._sleep = sleep ?? defaultSleep;
        /** @type {number} */
        this._clipBudgetMs = typeof clipBudgetMs === 'number' ? clipBudgetMs : DEFAULT_CLIP_BUDGET_MS;
    }

    /**
     * @param {string} word
     * @returns {Promise<import('flib-gateway-examples').YouTubeSectionResult>}
     */
    async loadYouTube(word) {
        const response = await this._api.flibGatewayExamples(word, {kind: 'youtube', limit: YOUTUBE_SECTION_MAX_ITEMS});
        const items = sanitizeYouTubeItems(response.items);
        if (items.length > 0) { return {items, emptyReason: null}; }
        // Элементы пришли, но ни один не прошёл проверку ref — это не «нет в корпусе».
        const emptyReason = Array.isArray(response.items) && response.items.length > 0 ?
            'no_usable_examples' :
            (typeof response.empty_reason === 'string' ? response.empty_reason : null);
        return {items: [], emptyReason};
    }

    /**
     * @param {string} word
     * @param {{onPhase?: (phase: import('flib-gateway-examples').FilmsPhase) => void, signal?: AbortSignal}} [options]
     * @returns {Promise<import('flib-gateway-examples').FilmsSectionResult>}
     */
    async loadFilms(word, {onPhase, signal} = {}) {
        throwIfAborted(signal);
        onPhase?.('searching');
        const result = await this._runWordExamplesJob(word, signal);
        const set = result.results.find((s) => s.word === word) ?? result.results[0];
        if (typeof set === 'undefined') { return {clips: [], emptyReason: null, lemma: null, matchedForms: []}; }
        // Лемма и найденные формы — для подсветки (строки YouTube, субтитры клипов).
        const lemma = typeof set.lemma === 'string' && set.lemma.length > 0 ? set.lemma : null;
        const matchedForms = Array.isArray(set.matched_forms) ? set.matched_forms.filter((f) => typeof f === 'string' && f.length > 0) : [];
        if (set.token === null || set.clips.length === 0) {
            return {clips: [], emptyReason: set.empty_reason ?? 'no_usable_examples', lemma, matchedForms};
        }

        throwIfAborted(signal);
        onPhase?.('cutting');
        const redeemed = await this._api.flibGatewayRedeemClips(set.token);
        throwIfAborted(signal);
        /** @type {import('flib-gateway-examples').FilmClip[]} */
        const clips = redeemed.clips.map((rc, i) => {
            const source = (rc.order_index !== null ? set.clips.find((c) => c.order_index === rc.order_index) : void 0) ?? set.clips[i];
            return {
                clipId: rc.clip_id,
                orderIndex: rc.order_index,
                status: rc.status,
                error: typeof rc.error === 'string' ? rc.error : null,
                subs: typeof source !== 'undefined' ? source.subs : [],
                trimDurationSec: typeof source !== 'undefined' ? source.trim_duration_sec : null,
                year: typeof source !== 'undefined' ? source.year : null,
                cefr: typeof source !== 'undefined' ? source.cefr : null,
            };
        });
        return {clips, emptyReason: clips.length > 0 ? null : 'no_usable_examples', lemma, matchedForms};
    }

    /**
     * Ждёт готовности клипа и забирает его байты.
     * @param {import('flib-gateway-examples').FilmClip} clip
     * @param {{signal?: AbortSignal, onStage?: (stage: 'cutting'|'loading') => void}} [options]
     * @returns {Promise<import('flib-gateway-examples').ClipMedia>}
     */
    async loadClipMedia(clip, {signal, onStage} = {}) {
        if (clip.status === 'failed') { throw gatewayError('flib_clip_failed'); }
        onStage?.('cutting');
        const deadline = this._now() + this._clipBudgetMs;
        /** @type {?import('flib-gateway').ClipInfo} */
        let info = null;
        for (;;) {
            throwIfAborted(signal);
            try {
                const current = await this._api.flibGatewayGetClip(clip.clipId);
                if (current.status === 'failed') { throw gatewayError('flib_clip_failed'); }
                if (current.status === 'ready') {
                    info = current;
                    break;
                }
            } catch (e) {
                if (getGatewayErrorCode(e) !== 'flib_clip_not_ready') { throw e; }
            }
            if (this._now() >= deadline) { throw gatewayError('flib_clip_timeout'); }
            await this._sleep(CLIP_POLL_MS);
        }
        throwIfAborted(signal);
        onStage?.('loading');
        const data = await this._api.flibGatewayClipData(clip.clipId);
        throwIfAborted(signal);
        // ⚠️ Тип из ответа сервера в blob не идёт как есть: blob-URL расширения с
        // text/html открылся бы в его origin. Только video/*.
        const type = typeof data.contentType === 'string' && /^video\/[\w.+-]+$/i.test(data.contentType) ? data.contentType : 'video/mp4';
        return {info, blob: base64ToBlob(data.base64, type)};
    }

    // Private

    /**
     * @param {string} word
     * @param {AbortSignal | undefined} signal
     * @returns {Promise<import('flib-gateway').WordExamplesResult>}
     */
    async _runWordExamplesJob(word, signal) {
        const {jobId} = await this._api.flibGatewayWordExamplesStart([word], FILMS_PER_WORD);
        let pollCount = 0;
        try {
            for (;;) {
                throwIfAborted(signal);
                const state = await this._api.flibGatewayWordExamplesPoll(jobId);
                if (state.done) { return state.result; }
                throwIfAborted(signal);
                ++pollCount;
                await this._sleep(pollCount <= JOB_FAST_POLL_COUNT ? JOB_FAST_POLL_MS : JOB_SLOW_POLL_MS);
            }
        } catch (e) {
            if (getGatewayErrorCode(e) === 'flib_aborted') {
                // Задание в воркере больше никому не нужно — не жжём квоту зря.
                void this._api.flibGatewayWordExamplesCancel(jobId).catch(() => {});
            }
            throw e;
        }
    }
}
