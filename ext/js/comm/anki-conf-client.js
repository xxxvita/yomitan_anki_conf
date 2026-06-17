/*
 * Copyright (C) 2024-2025  Yomitan Authors
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
import {readResponseJson} from '../core/json.js';

const DEFAULT_BASE = 'http://127.0.0.1:8777';
const DEFAULT_ANALYZE_TIMEOUT_MS = 30000;

/**
 * HTTP client for the local Anki-Conf "Core" service. Speaks the lexicon API:
 *   POST /api/v1/lexicon/analyze-text   — return words from `text` that the
 *                                         user does not yet know.
 *   POST /api/v1/lexicon/known-words    — mark one word as known.
 *
 * The Core listens on plaintext 127.0.0.1 and does not require auth from the
 * extension (it forwards to the gateway with its own credentials).
 */
export class AnkiConfClient {
    /**
     * @param {string} [base]
     */
    constructor(base = DEFAULT_BASE) {
        /** @type {string} */
        this._base = base;
    }

    /**
     * @param {string} text
     * @returns {Promise<import('anki-conf').AnalyzeTextResult>}
     */
    async analyzeText(text) {
        const url = `${this._base}/api/v1/lexicon/analyze-text`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), DEFAULT_ANALYZE_TIMEOUT_MS);
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                mode: 'cors',
                cache: 'no-store',
                credentials: 'omit',
                headers: {'Content-Type': 'application/json'},
                redirect: 'follow',
                referrerPolicy: 'no-referrer',
                body: JSON.stringify({text}),
                signal: controller.signal,
            });
        } catch (e) {
            clearTimeout(timeoutId);
            throw this._wrapNetworkError(e, 'analyze-text');
        }
        clearTimeout(timeoutId);

        if (!response.ok) {
            throw await this._wrapHttpError(response, 'analyze-text');
        }

        /** @type {unknown} */
        let result;
        try {
            result = await readResponseJson(response);
        } catch (e) {
            throw this._wrapNetworkError(e, 'analyze-text');
        }

        return this._normalizeAnalyzeResult(result);
    }

    /**
     * @param {string} word
     * @param {{source?: string, note?: string, context?: string}} [options]
     * @returns {Promise<boolean>} true if the word was newly added
     */
    async addKnownWord(word, options = {}) {
        const url = `${this._base}/api/v1/lexicon/known-words`;
        const {source = 'yomitan', note = '', context = ''} = options;
        let response;
        try {
            response = await fetch(url, {
                method: 'POST',
                mode: 'cors',
                cache: 'no-store',
                credentials: 'omit',
                headers: {'Content-Type': 'application/json'},
                redirect: 'follow',
                referrerPolicy: 'no-referrer',
                body: JSON.stringify({word, source, note, context}),
            });
        } catch (e) {
            throw this._wrapNetworkError(e, 'known-words');
        }

        if (!response.ok) {
            throw await this._wrapHttpError(response, 'known-words');
        }

        try {
            /** @type {{added?: unknown}} */
            const body = await readResponseJson(response);
            return body.added === true;
        } catch {
            return true;
        }
    }

    // Private

    /**
     * @param {unknown} raw
     * @returns {import('anki-conf').AnalyzeTextResult}
     */
    _normalizeAnalyzeResult(raw) {
        const r = (typeof raw === 'object' && raw !== null) ? /** @type {Record<string, unknown>} */ (raw) : {};
        /** @type {string[]} */
        const newWords = [];
        if (Array.isArray(r.new_words)) {
            for (const w of r.new_words) {
                if (typeof w === 'string' && w.length > 0) { newWords.push(w); }
            }
        }
        const source = (r.source === 'lemma' || r.source === 'regex' || r.source === 'empty') ? r.source : 'unknown';
        /** @type {import('anki-conf').AnalyzeEntry[]} */
        const entries = [];
        if (Array.isArray(r.entries)) {
            for (const item of /** @type {unknown[]} */ (r.entries)) {
                if (typeof item !== 'object' || item === null) { continue; }
                const e = /** @type {Record<string, unknown>} */ (item);
                if (typeof e.word !== 'string') { continue; }
                /** @type {string[]} */
                const forms = [];
                if (Array.isArray(e.forms)) {
                    for (const f of e.forms) {
                        if (typeof f === 'string') { forms.push(f); }
                    }
                }
                entries.push({
                    word: e.word,
                    lemma: typeof e.lemma === 'string' ? e.lemma : '',
                    forms,
                    kind: typeof e.kind === 'string' ? e.kind : '',
                });
            }
        }
        return {newWords, source, entries};
    }

    /**
     * @param {unknown} cause
     * @param {string} op
     * @returns {ExtensionError}
     */
    _wrapNetworkError(cause, op) {
        const error = new ExtensionError(`Anki-Conf connection failure (${op})`);
        error.data = {op, cause};
        return error;
    }

    /**
     * @param {Response} response
     * @param {string} op
     * @returns {Promise<ExtensionError>}
     */
    async _wrapHttpError(response, op) {
        /** @type {unknown} */
        let body = null;
        try {
            body = await readResponseJson(response);
        } catch {
            // no body
        }
        const error = new ExtensionError(`Anki-Conf ${op} HTTP ${response.status}`);
        error.data = {op, status: response.status, body};
        return error;
    }
}
