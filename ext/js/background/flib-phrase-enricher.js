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

import {createFlibError, getFlibErrorCode} from '../comm/flib-gateway-client.js';
import {isObjectNotArray} from '../core/object-utilities.js';
import {BLANK, frontSpeechText, mediaFileName} from '../data/flib-enrich.js';
import {cleanTranslation, PHRASE_MAX_LENGTH} from '../data/flib-phrase-note.js';
import {FLIB_SENTENCE_MAX_CHARS, normalizeSentenceKey} from '../data/flib-pos.js';
import {ENRICH_BUDGET_MS, ENRICH_KEEP_ALIVE_MS, getEnrichErrorCode, runKeptAlive, speakToAnkiMedia, updateEnrichedFields} from './flib-enrich-steps.js';
import {PHRASE_REQUEST_TIMEOUT_MS} from './flib-phrase-model.js';
import {createPhraseRun, isText, readPhraseField} from './flib-phrase-notes.js';

/*
 * Audio and translation of a phrase note that has just been saved, through the gateway.
 *
 * ⚠️ Not a transaction: each step is independent, the note stays whatever fails, and its tag `flib_enriched` is never
 * removed (without it Core would enrich the phrase as a word). What is in a field already is never replaced, so a
 * repeated call pays only for what is missing.
 * ⚠️ Every request goes to the address that was prepared or nowhere: at another one the same id may be another note.
 *
 * Known limits: a field that the user edits in Anki between the last read and the write is overwritten; a write that
 * gave no answer in time may still be done by Anki afterwards (a busy Anki: much later than that read), though its step
 * is anki_note_failed; a file whose note was deleted meanwhile stays in the media folder.
 */

/** NFC makes at most three characters of one: what was saved is told «too long» by `FLIB_SENTENCE_MAX_CHARS`, not refused. */
const EXPRESSION_MAX_LENGTH = 3 * PHRASE_MAX_LENGTH;
/** The pause that is read instead of the blank may be longer than the word it replaces. */
const FRONT_MAX_LENGTH = EXPRESSION_MAX_LENGTH + frontSpeechText(BLANK).length;

/**
 * @typedef {import('flib-gateway').EnrichStep} EnrichStep
 * @typedef {import('api').ApiParams<'flibPhraseEnrich'>} EnrichParams
 * @typedef {{run: import('flib-phrase-notes').Run, noteId: number, signal: AbortSignal, report: import('flib-gateway').PhraseEnrichReport}} Context
 */

/**
 * @typedef {object} SentenceCache A failure of the cache is a miss: neither method throws.
 * @property {(key: string) => Promise<?string>} read
 * @property {(key: string, translation: string) => Promise<void>} write
 */

export class FlibPhraseEnricher {
    /**
     * @param {object} details
     * @param {import('../comm/anki-connect.js').AnkiConnect} details.anki Any client: the work goes through pinned views of it.
     * @param {Pick<import('../comm/flib-gateway-client.js').FlibGatewayClient, 'synthesizeSpeech'|'translateSentence'>} details.gateway
     * @param {SentenceCache} details.cache
     * @param {number} [details.budgetMs] Of one enrichment.
     * @param {?(() => void)} [details.keepAlive]
     * @param {number} [details.keepAliveMs]
     * @param {number} [details.timeoutMs] Of one request to Anki.
     */
    constructor({anki, gateway, cache, budgetMs = ENRICH_BUDGET_MS, keepAlive = null, keepAliveMs = ENRICH_KEEP_ALIVE_MS, timeoutMs = PHRASE_REQUEST_TIMEOUT_MS}) {
        /** @type {import('../comm/anki-connect.js').AnkiConnect} */
        this._anki = anki;
        /** @type {Pick<import('../comm/flib-gateway-client.js').FlibGatewayClient, 'synthesizeSpeech'|'translateSentence'>} */
        this._gateway = gateway;
        /** @type {SentenceCache} */
        this._cache = cache;
        /** @type {number} */
        this._budgetMs = budgetMs;
        /** @type {?(() => void)} */
        this._keepAlive = keepAlive;
        /** @type {number} */
        this._keepAliveMs = keepAliveMs;
        /** @type {number} */
        this._timeoutMs = timeoutMs;
        /** @type {Map<string, Promise<import('flib-gateway').PhraseEnrichReport>>} */
        this._inFlight = new Map();
    }

    /**
     * Calls for one note at the same time are one run, with the texts and the cache of the first.
     * @param {EnrichParams} params
     * @param {{cacheAllowed: boolean}} details What `mayUseSentenceCache` said about the sender.
     * @returns {Promise<import('flib-gateway').PhraseEnrichReport>}
     * @throws {Error} flib_bad_request, the only one: the rest is in the report.
     */
    async enrich(params, {cacheAllowed}) {
        if (!isObjectNotArray(params)) { throw createFlibError('flib_bad_request'); }
        const {server, noteId, expression, front} = params;
        const valid = Number.isSafeInteger(noteId) && noteId > 0 && isText(expression, EXPRESSION_MAX_LENGTH) && (front === null || isText(front, FRONT_MAX_LENGTH));
        if (!valid) { throw createFlibError('flib_bad_request'); }
        const key = JSON.stringify([server, noteId]);
        let promise = this._inFlight.get(key);
        if (typeof promise === 'undefined') {
            const keepAliveDetails = {keepAlive: this._keepAlive, keepAliveMs: this._keepAliveMs};
            promise = runKeptAlive(() => this._run({server, noteId, expression, front, cacheAllowed}), keepAliveDetails)
                .finally(() => { this._inFlight.delete(key); });
            this._inFlight.set(key, promise);
        }
        return await promise;
    }

    // Private

    /**
     * @param {{server: string, noteId: number, expression: string, front: ?string, cacheAllowed: boolean}} details
     * @returns {Promise<import('flib-gateway').PhraseEnrichReport>}
     */
    async _run({server, noteId, expression, front, cacheAllowed}) {
        /** @type {import('flib-gateway').PhraseEnrichReport} */
        const report = {audio: {status: 'skipped'}, translation: {status: 'skipped'}, speechCode: null};
        const key = normalizeSentenceKey(expression);
        if (key.length > FLIB_SENTENCE_MAX_CHARS) {
            const code = 'flib_sentence_too_long';
            report.audio.code = code;
            report.translation.code = code;
            return report;
        }
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(); }, this._budgetMs);
        try {
            const run = createPhraseRun(this._anki, server, this._timeoutMs);
            /** @type {Context} */
            const ctx = {run, noteId, signal: controller.signal, report};
            report.audio = await this._step(() => this._stepAudio(ctx, expression, front));
            report.translation = await this._step(() => this._stepTranslation(ctx, key, cacheAllowed));
        } catch (e) {
            // The address is another one: nothing was sent.
            const code = getEnrichErrorCode(e);
            report.audio = {status: 'failed', code};
            report.translation = {status: 'failed', code};
        } finally {
            clearTimeout(timer);
        }
        return report;
    }

    /**
     * @param {() => Promise<EnrichStep>} step
     * @returns {Promise<EnrichStep>}
     */
    async _step(step) {
        try {
            return await step();
        } catch (e) {
            return {status: 'failed', code: getEnrichErrorCode(e)};
        }
    }

    /**
     * Each clip is tried whatever happened to the other; the code is of the first one that failed.
     * @param {Context} ctx
     * @param {string} expression
     * @param {?string} front
     * @returns {Promise<EnrichStep>}
     */
    async _stepAudio(ctx, expression, front) {
        const steps = [await this._step(() => this._speak(ctx, 'Audio_expression', expression, 'phr_exp'))];
        if (front !== null) { steps.push(await this._step(() => this._speak(ctx, 'Audio_front', front, 'phr_front'))); }
        return (
            steps.find(({status}) => status === 'failed') ??
            steps.find(({status}) => status === 'done') ??
            {status: 'skipped'}
        );
    }

    /**
     * @param {Context} ctx
     * @param {string} fieldName
     * @param {string} text
     * @param {'phr_exp'|'phr_front'} kind
     * @returns {Promise<EnrichStep>}
     */
    async _speak(ctx, fieldName, text, kind) {
        return await this._fill(ctx, fieldName, () => speakToAnkiMedia(ctx.report, mediaFileName(kind, '', ctx.noteId), {
            // A sound whose reading was aborted has this code: the client does not know why the body failed.
            synthesize: () => this._request(ctx, () => this._gateway.synthesizeSpeech(text, {signal: ctx.signal}), ['flib_service_unavailable']),
            store: async (fileName, base64) => {
                const stored = await ctx.run((anki) => anki.storeMediaFile(fileName, base64));
                if (stored !== fileName) { throw createFlibError('flib_media_not_stored'); }
            },
        }));
    }

    /**
     * @param {Context} ctx
     * @param {string} key
     * @param {boolean} cacheAllowed
     * @returns {Promise<EnrichStep>}
     */
    async _stepTranslation(ctx, key, cacheAllowed) {
        return await this._fill(ctx, 'ExpressionTranslate', async () => {
            const html = cleanTranslation(await this._translate(ctx, key, cacheAllowed));
            if (html === '') { throw createFlibError('llm_bad_answer'); }
            return html;
        });
    }

    /**
     * The same request and cache as `flibSentenceTranslate`. ⚠️ Once: the gateway may have charged for a request whose
     * answer was lost.
     * @param {Context} ctx
     * @param {string} key
     * @param {boolean} cacheAllowed
     * @returns {Promise<string>}
     */
    async _translate(ctx, key, cacheAllowed) {
        const cached = cacheAllowed ? await this._cache.read(key) : null;
        if (cached !== null) { return cached; }
        const {translation} = await this._request(ctx, () => this._gateway.translateSentence(key, {signal: ctx.signal}));
        // An answer of which nothing is left would be the answer of every later save.
        if (cacheAllowed && cleanTranslation(translation) !== '') { await this._cache.write(key, translation); }
        return translation;
    }

    /**
     * Fills an empty field. The note is read before the value is paid for and again before it is written: the gateway
     * takes seconds, the note may be edited or deleted meanwhile.
     * @param {Context} ctx
     * @param {string} fieldName
     * @param {() => Promise<string>} createValue
     * @returns {Promise<EnrichStep>}
     */
    async _fill({run, noteId, signal}, fieldName, createValue) {
        if (signal.aborted) { throw createFlibError('flib_timeout'); }
        const isEmpty = async () => (await readPhraseField(run, noteId, fieldName)).trim() === '';
        if (!await isEmpty()) { return {status: 'skipped'}; }
        const value = await createValue();
        if (!await isEmpty()) { return {status: 'skipped'}; }
        await run((anki) => updateEnrichedFields(anki, noteId, {[fieldName]: value}));
        return {status: 'done'};
    }

    /**
     * A request to the gateway. The budget aborts it, the user did not: it is a timeout.
     * @template [T=unknown]
     * @param {Context} ctx
     * @param {() => Promise<T>} request
     * @param {string[]} [abortCodes] Of an aborted request besides flib_aborted.
     * @returns {Promise<T>}
     */
    async _request({signal}, request, abortCodes = []) {
        try {
            return await request();
        } catch (e) {
            const code = getFlibErrorCode(e);
            if (signal.aborted && code !== null && ['flib_aborted', ...abortCodes].includes(code)) { throw createFlibError('flib_timeout'); }
            throw e;
        }
    }
}
