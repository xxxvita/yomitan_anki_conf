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
import {log} from '../core/log.js';
import {safePerformance} from '../core/safe-performance.js';

/** @typedef {import('../comm/api.js').API} API */
/** @typedef {import('anki-conf').ClipsWordStatus} ClipsWordStatus */
/** @typedef {import('anki-conf').ClipsJobState} ClipsJobState */

/**
 * @typedef {object} ExamplesCallbacks
 * @property {(phase: 'queued'|'polling'|'ready'|'failed'|'expired'|'timeout') => void} [onPhase]
 * @property {(word: ClipsWordStatus) => void} [onWordUpdate]
 * @property {(error: unknown) => void} [onError]
 */

/**
 * @typedef {object} JobEntry
 * @property {HTMLElement} entry
 * @property {string} word
 * @property {ExamplesCallbacks} callbacks
 * @property {'queued'|'polling'|'terminal'} state
 * @property {?string} jobId
 * @property {?ClipsWordStatus} lastStatus
 */

const BATCH_DELAY_MS = 250;
const MAX_WORDS_PER_JOB = 10;
const FAST_POLL_INTERVAL_MS = 1500;
const SLOW_POLL_INTERVAL_MS = 3000;
const POLL_COUNT_BEFORE_BACKOFF = 10;
const HARD_TIMEOUT_MS = 120000;
const MAX_CONSECUTIVE_POLL_FAILS = 3;

/**
 * Coordinates clip-collection jobs across the Yomitan popup. One instance per
 * `DisplayAnki`. The popup typically renders multiple entries side-by-side,
 * each with its own `Ex` button — this class:
 *
 *   1. **Debounces** clicks within {@link BATCH_DELAY_MS} into a single
 *      `lexiconClipsStart` call (capped at {@link MAX_WORDS_PER_JOB} words).
 *   2. **Polls** the status endpoint with a 1.5 s cadence that backs off to 3 s
 *      after {@link POLL_COUNT_BEFORE_BACKOFF} polls; gives up at
 *      {@link HARD_TIMEOUT_MS}.
 *   3. **Distributes** the per-word status sub-objects back to the entries
 *      that requested them, skipping any whose DOM node has been detached
 *      (Yomitan re-renders on content navigation).
 *   4. **Dedupes** double-clicks on the same entry — second `requestExamples`
 *      call replays the latest status to the new callbacks but doesn't start
 *      a new job.
 *
 * P4 surface: this class. P5 replaces the placeholder callbacks with DOM
 * rendering of the clip cards.
 */
export class VideoExamplesOrchestrator {
    /**
     * @param {API} api
     */
    constructor(api) {
        /** @type {API} */
        this._api = api;
        /** @type {Map<HTMLElement, JobEntry>} */
        this._jobs = new Map();
        /** @type {?{timer: ReturnType<typeof setTimeout>, items: JobEntry[]}} */
        this._batchBuffer = null;
    }

    /**
     * Subscribe to clip-collection results for an entry. If a job is already
     * in flight for this entry the new callbacks replace the old ones and the
     * last known status is replayed; no new HTTP is issued.
     * @param {HTMLElement} entry
     * @param {string} word
     * @param {ExamplesCallbacks} callbacks
     */
    requestExamples(entry, word, callbacks) {
        const trimmed = word.trim();
        if (trimmed.length === 0) { return; }

        const existing = this._jobs.get(entry);
        if (typeof existing !== 'undefined' && existing.state !== 'terminal') {
            existing.callbacks = callbacks;
            existing.word = trimmed;
            this._replayLastStatus(existing);
            return;
        }

        /** @type {JobEntry} */
        const item = {
            entry,
            word: trimmed,
            callbacks,
            state: 'queued',
            jobId: null,
            lastStatus: null,
        };
        this._jobs.set(entry, item);
        callbacks.onPhase?.('queued');

        let buffer = this._batchBuffer;
        if (buffer === null) {
            buffer = {
                timer: setTimeout(() => this._flushBatch(), BATCH_DELAY_MS),
                items: [],
            };
            this._batchBuffer = buffer;
        }
        buffer.items.push(item);
    }

    /**
     * Drop every in-flight or queued job. Yomitan fires `contentClear` when
     * the popup is about to swap entries; we hook that to release jobs whose
     * subscribers are about to vanish.
     */
    cancelAll() {
        if (this._batchBuffer !== null) {
            clearTimeout(this._batchBuffer.timer);
            this._batchBuffer = null;
        }
        for (const item of this._jobs.values()) {
            item.state = 'terminal';
        }
        this._jobs.clear();
    }

    /**
     * Drop the job (if any) tied to a specific entry. Used when an entry node
     * is detached individually rather than as part of a full content swap.
     * @param {HTMLElement} entry
     */
    cancelEntry(entry) {
        const job = this._jobs.get(entry);
        if (typeof job === 'undefined') { return; }
        job.state = 'terminal';
        this._jobs.delete(entry);
    }

    /**
     * Returns the Core job_id currently associated with the entry, or null if
     * no job has been kicked off yet (still in the batch buffer) or it has
     * been cancelled. P7 needs this to call `clips/persist`.
     * @param {HTMLElement} entry
     * @returns {?string}
     */
    getJobIdForEntry(entry) {
        const job = this._jobs.get(entry);
        if (typeof job === 'undefined') { return null; }
        return job.jobId;
    }

    /**
     * Flush the batch buffer: dedupe queued items by `word`, issue one
     * `lexiconClipsStart`, and hand the resulting `job_id` to the polling
     * loop. Errors here surface to every queued item's `onError`.
     */
    async _flushBatch() {
        const buffer = this._batchBuffer;
        if (buffer === null) { return; }
        this._batchBuffer = null;

        const items = buffer.items.filter((i) => i.state === 'queued');
        if (items.length === 0) { return; }

        const uniqueWords = [...new Set(items.map((i) => i.word))].slice(0, MAX_WORDS_PER_JOB);
        if (items.length > uniqueWords.length) {
            log.log(`[video-examples] batched ${items.length} requests → ${uniqueWords.length} unique words`);
        }

        let startResult;
        try {
            startResult = await this._api.lexiconClipsStart({words: uniqueWords});
        } catch (e) {
            this._fail(items, e);
            return;
        }

        const jobId = startResult.job_id;
        for (const item of items) {
            item.jobId = jobId;
            item.state = 'polling';
            item.callbacks.onPhase?.('polling');
        }
        void this._pollJob(jobId, items);
    }

    /**
     * Poll `/status/{jobId}` until either every word is terminal, the global
     * job state is `ready`/`failed`, the hard timeout fires, or every live
     * subscriber has detached. The loop self-cancels in the all-subscribers-
     * gone case to avoid wasted HTTP after popup close.
     * @param {string} jobId
     * @param {JobEntry[]} items
     */
    async _pollJob(jobId, items) {
        const startedAt = safePerformance.now();
        let pollCount = 0;
        let consecutiveFails = 0;

        while (true) {
            const live = items.filter((i) => i.state !== 'terminal' && i.entry.isConnected);
            if (live.length === 0) { return; }

            if (safePerformance.now() - startedAt > HARD_TIMEOUT_MS) {
                for (const item of live) {
                    item.state = 'terminal';
                    item.callbacks.onPhase?.('timeout');
                }
                return;
            }

            const intervalMs = pollCount < POLL_COUNT_BEFORE_BACKOFF ? FAST_POLL_INTERVAL_MS : SLOW_POLL_INTERVAL_MS;
            await this._sleep(intervalMs);
            pollCount++;

            let status;
            try {
                status = await this._api.lexiconClipsStatus(jobId);
                consecutiveFails = 0;
            } catch (e) {
                if (this._isJobNotFound(e)) {
                    for (const item of live) {
                        item.state = 'terminal';
                        item.callbacks.onPhase?.('expired');
                    }
                    return;
                }
                consecutiveFails++;
                if (consecutiveFails >= MAX_CONSECUTIVE_POLL_FAILS) {
                    this._fail(live, e);
                    return;
                }
                continue;
            }

            this._distributeStatus(status.words, live);

            if (status.state === 'ready' || status.state === 'failed') {
                // Core sometimes returns `state: failed` for the whole job when
                // it really means "this word doesn't appear in our corpus"
                // (every word stage=empty with empty_reason=no_examples). For
                // the user that's success-with-zero-results, not an error.
                // Translate per-item: if THIS item's word is empty-with-reason,
                // serve it 'ready' so the panel paints the friendly empty-state
                // text instead of the red "Couldn't fetch examples" + Retry UI.
                for (const item of live) {
                    item.state = 'terminal';
                    const itemWordLower = item.word.toLowerCase();
                    const ws = status.words.find((w) => {
                        const wl = w.word.toLowerCase();
                        const ll = w.lemma.toLowerCase();
                        return wl === itemWordLower || ll === itemWordLower;
                    });
                    const isOnlyEmpty = (
                        typeof ws !== 'undefined' &&
                        ws.stage === 'empty' &&
                        typeof ws.empty_reason === 'string' &&
                        ws.empty_reason.length > 0 &&
                        ws.clips.length === 0
                    );
                    item.callbacks.onPhase?.(isOnlyEmpty ? 'ready' : status.state);
                }
                return;
            }
        }
    }

    /**
     * Match each word from the status response to its requesting item(s) and
     * fire `onWordUpdate`. We dedupe by lowercase word + lemma so a phrase
     * lookup that produced lemma "be" still matches an entry typed as "is".
     * @param {ClipsWordStatus[]} wordStatuses
     * @param {JobEntry[]} live
     */
    _distributeStatus(wordStatuses, live) {
        for (const ws of wordStatuses) {
            const wsWordLower = ws.word.toLowerCase();
            const wsLemmaLower = ws.lemma.toLowerCase();
            for (const item of live) {
                const itemWordLower = item.word.toLowerCase();
                if (itemWordLower === wsWordLower || itemWordLower === wsLemmaLower) {
                    item.lastStatus = ws;
                    if (item.entry.isConnected) {
                        item.callbacks.onWordUpdate?.(ws);
                    }
                }
            }
        }
    }

    /**
     * Re-emit the most recent status to a freshly-subscribed entry so the UI
     * doesn't sit blank waiting for the next poll tick.
     * @param {JobEntry} item
     */
    _replayLastStatus(item) {
        item.callbacks.onPhase?.(item.state === 'queued' ? 'queued' : 'polling');
        if (item.lastStatus !== null && item.entry.isConnected) {
            item.callbacks.onWordUpdate?.(item.lastStatus);
        }
    }

    /**
     * @param {JobEntry[]} items
     * @param {unknown} error
     */
    _fail(items, error) {
        for (const item of items) {
            if (item.state === 'terminal') { continue; }
            item.state = 'terminal';
            item.callbacks.onError?.(error);
        }
    }

    /**
     * 404 with `error: "job_not_found"` is the documented Core signal that the
     * job's registry entry has TTL'd out — distinct from a transient network
     * 404 we'd want to retry. We treat any 404 from the status endpoint as
     * expired since the endpoint has no other 404 path.
     * @param {unknown} error
     * @returns {boolean}
     */
    _isJobNotFound(error) {
        if (!(error instanceof ExtensionError)) { return false; }
        const data = /** @type {{status?: unknown}} */ (error.data);
        return typeof data === 'object' && data !== null && data.status === 404;
    }

    /**
     * @param {number} ms
     * @returns {Promise<void>}
     */
    _sleep(ms) {
        return new Promise((resolve) => {
            setTimeout(resolve, ms);
        });
    }
}
