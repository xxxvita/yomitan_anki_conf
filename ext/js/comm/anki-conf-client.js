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
// Clip rendering may need to fetch + transcode video — give it room.
const DEFAULT_CLIPS_START_TIMEOUT_MS = 30000;
const DEFAULT_CLIPS_STATUS_TIMEOUT_MS = 10000;
const DEFAULT_CLIPS_PERSIST_TIMEOUT_MS = 60000;
const DEFAULT_CLIPS_RECUT_TIMEOUT_MS = 60000;
const DEFAULT_CLIPS_STATS_TIMEOUT_MS = 5000;
const DEFAULT_CLIPS_PRUNE_TIMEOUT_MS = 30000;

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
        this._base = this._normalizeBase(base);
    }

    /**
     * Update the base URL of the Core service. Trailing slashes are stripped.
     * Empty or non-http(s) values fall back to the default.
     * @param {string} url
     */
    setBaseUrl(url) {
        this._base = this._normalizeBase(url);
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

    /**
     * Kick off a video-examples collect job. Words array capped at 10 server-side.
     * Returns a job_id which the caller then polls via `pollCollectExamplesStatus`.
     * @param {import('anki-conf').ClipsStartParams} params
     * @returns {Promise<import('anki-conf').ClipsStartResult>}
     */
    async startCollectExamples(params) {
        const url = `${this._base}/api/v1/lexicon/collect-examples/start`;
        return /** @type {import('anki-conf').ClipsStartResult} */ (
            await this._postJson(url, params, 'collect-examples/start', DEFAULT_CLIPS_START_TIMEOUT_MS)
        );
    }

    /**
     * Poll the status of an in-flight collect job. Returns `state: ready|partial|
     * pending|failed` plus the per-word breakdown. Caller is responsible for
     * cadence — orchestrator caps at ~1.5s.
     * @param {string} jobId
     * @returns {Promise<import('anki-conf').ClipsStatusResult>}
     */
    async pollCollectExamplesStatus(jobId) {
        const url = `${this._base}/api/v1/lexicon/collect-examples/status/${encodeURIComponent(jobId)}`;
        return /** @type {import('anki-conf').ClipsStatusResult} */ (
            await this._getJson(url, 'collect-examples/status', DEFAULT_CLIPS_STATUS_TIMEOUT_MS)
        );
    }

    /**
     * Persist selected clips from a scratch job into Core's durable clip cache.
     * The returned `persisted[]` entries are the canonical payload to write into
     * the Anki note's `data` field.
     * @param {import('anki-conf').ClipsPersistParams} params
     * @returns {Promise<import('anki-conf').ClipsPersistResult>}
     */
    async persistClips(params) {
        const url = `${this._base}/api/v1/lexicon/clips/persist`;
        return /** @type {import('anki-conf').ClipsPersistResult} */ (
            await this._postJson(url, params, 'clips/persist', DEFAULT_CLIPS_PERSIST_TIMEOUT_MS)
        );
    }

    /**
     * Re-render a previously persisted clip from its opaque §7-gateway token —
     * the F2-replay tier-1 fallback when the durable cache file is missing.
     * Caller should fall through to `startCollectExamples` on 410.
     * @param {import('anki-conf').ClipsRecutParams} params
     * @returns {Promise<import('anki-conf').ClipsRecutResult>}
     */
    async recutClip(params) {
        const url = `${this._base}/api/v1/lexicon/clips/recut`;
        return /** @type {import('anki-conf').ClipsRecutResult} */ (
            await this._postJson(url, params, 'clips/recut', DEFAULT_CLIPS_RECUT_TIMEOUT_MS)
        );
    }

    /**
     * Returns Core's clip-cache usage. The plugin uses this both to gate the Ex
     * button (presence of `service: "anki-conf-core"` confirms we're talking to
     * the right server) and to power the cache-stats UI.
     * @returns {Promise<import('anki-conf').ClipsStatsResult>}
     */
    async getClipsStats() {
        const url = `${this._base}/api/v1/lexicon/clips/stats`;
        return /** @type {import('anki-conf').ClipsStatsResult} */ (
            await this._getJson(url, 'clips/stats', DEFAULT_CLIPS_STATS_TIMEOUT_MS)
        );
    }

    /**
     * Trigger Core to drop scratch / unreferenced clips. The `unreferenced` scope
     * MUST include `keep_cache_keys` — the plugin builds that list from the
     * Anki note collection so Core knows what's still in use.
     * @param {import('anki-conf').ClipsPruneParams} params
     * @returns {Promise<import('anki-conf').ClipsPruneResult>}
     */
    async pruneClips(params) {
        const url = `${this._base}/api/v1/lexicon/clips/prune`;
        return /** @type {import('anki-conf').ClipsPruneResult} */ (
            await this._postJson(url, params, 'clips/prune', DEFAULT_CLIPS_PRUNE_TIMEOUT_MS)
        );
    }

    /**
     * Mirror of `addKnownWord`: removes the word from the Core's known-words
     * store. Idempotent: Core returns 200 also when the word was not present.
     * @param {string} word
     * @returns {Promise<boolean>} true if Core reported `removed: true`
     */
    async removeKnownWord(word) {
        const url = `${this._base}/api/v1/lexicon/known-words/${encodeURIComponent(word)}`;
        let response;
        try {
            response = await fetch(url, {
                method: 'DELETE',
                mode: 'cors',
                cache: 'no-store',
                credentials: 'omit',
                redirect: 'follow',
                referrerPolicy: 'no-referrer',
            });
        } catch (e) {
            throw this._wrapNetworkError(e, 'known-words-delete');
        }

        if (!response.ok) {
            throw await this._wrapHttpError(response, 'known-words-delete');
        }

        try {
            /** @type {{removed?: unknown}} */
            const body = await readResponseJson(response);
            return body.removed === true;
        } catch {
            return true;
        }
    }

    // Private

    /**
     * @param {string} url
     * @returns {string}
     */
    _normalizeBase(url) {
        if (typeof url !== 'string') { return DEFAULT_BASE; }
        let trimmed = url.trim();
        if (trimmed.length === 0) { return DEFAULT_BASE; }
        if (!/^https?:\/\//i.test(trimmed)) { return DEFAULT_BASE; }
        while (trimmed.endsWith('/')) { trimmed = trimmed.slice(0, -1); }
        return trimmed.length > 0 ? trimmed : DEFAULT_BASE;
    }

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
     * Shared POST-with-JSON helper for the clips endpoints. Handles abort/
     * timeout, error wrapping, and JSON parsing.
     * @param {string} url
     * @param {unknown} body
     * @param {string} op
     * @param {number} timeoutMs
     * @returns {Promise<unknown>}
     */
    async _postJson(url, body, op, timeoutMs) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
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
                body: JSON.stringify(body),
                signal: controller.signal,
            });
        } catch (e) {
            clearTimeout(timeoutId);
            throw this._wrapNetworkError(e, op);
        }
        clearTimeout(timeoutId);
        if (!response.ok) {
            throw await this._wrapHttpError(response, op);
        }
        try {
            return await readResponseJson(response);
        } catch (e) {
            throw this._wrapNetworkError(e, op);
        }
    }

    /**
     * Shared GET-as-JSON helper for the clips endpoints.
     * @param {string} url
     * @param {string} op
     * @param {number} timeoutMs
     * @returns {Promise<unknown>}
     */
    async _getJson(url, op, timeoutMs) {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
        let response;
        try {
            response = await fetch(url, {
                method: 'GET',
                mode: 'cors',
                cache: 'no-store',
                credentials: 'omit',
                redirect: 'follow',
                referrerPolicy: 'no-referrer',
                signal: controller.signal,
            });
        } catch (e) {
            clearTimeout(timeoutId);
            throw this._wrapNetworkError(e, op);
        }
        clearTimeout(timeoutId);
        if (!response.ok) {
            throw await this._wrapHttpError(response, op);
        }
        try {
            return await readResponseJson(response);
        } catch (e) {
            throw this._wrapNetworkError(e, op);
        }
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
