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

/** @typedef {import('anki-conf').ClipStatus} ClipStatus */
/** @typedef {import('anki-conf').ClipsWordStatus} ClipsWordStatus */

const PANEL_CLASS = 'entry-video-examples';
const SKELETON_CARD_COUNT = 3;

const EMPTY_REASON_TEXT = Object.freeze({
    no_examples: 'No video examples found for this word.',
    render_failed: 'Couldn’t render examples for this word.',
    needs_connection: 'Internet connection needed to fetch examples.',
    transient_error: 'Temporary error fetching examples — try again.',
});

const PHASE_STATUS_TEXT = Object.freeze({
    queued: 'Queued…',
    polling: 'Searching…',
    ready: '',
    failed: 'Couldn’t fetch examples.',
    expired: 'This examples session expired — click Ex again to refresh.',
    timeout: 'Timed out waiting for Core to finish. Try again.',
});

/**
 * Inline `.entry-video-examples` panel attached as the last child of a
 * Yomitan entry. Skeletons during pending → cards as `word_done` arrives →
 * empty/error states on the relevant phases. Owns user selections (checkbox
 * state per clip) so P7 can read them on note-save.
 *
 * Lifecycle:
 *   ctor → DOM appended
 *   `onPhase('queued'|'polling')` → skeleton + status
 *   `onWordUpdate(word)` → replace cards with current `word.clips`, preserve
 *                          previously-checked clip_ids
 *   `onPhase('ready'|'failed'|'expired'|'timeout')` → terminal status; ready
 *                                                     with zero clips shows
 *                                                     the empty-reason text
 *   `onError(err)` → error banner + retry button
 *   `destroy()` → detach from DOM, clear state
 */
export class VideoExamplesPanel {
    /**
     * @param {HTMLElement} entry
     * @param {string} word
     * @param {{onCancel: () => void, onRetry: () => void, onClipOpen?: (clip: ClipStatus) => void}} hooks
     * @param {{mode?: 'collect'|'replay', initialClips?: ClipStatus[], density?: 'compact'|'large'}} [options]
     */
    constructor(entry, word, hooks, options = {}) {
        /** @type {HTMLElement} */
        this._entry = entry;
        /** @type {string} */
        this._word = word;
        /** @type {{onCancel: () => void, onRetry: () => void, onClipOpen?: (clip: ClipStatus) => void}} */
        this._hooks = hooks;
        /** @type {'collect'|'replay'} */
        this._mode = options.mode === 'replay' ? 'replay' : 'collect';
        /** @type {'compact'|'large'} */
        this._density = options.density === 'large' ? 'large' : 'compact';
        /** @type {Set<string>} */
        this._selectedClipIds = new Set();
        /** @type {ClipStatus[]} */
        this._currentClips = [];
        /** @type {'queued'|'polling'|'ready'|'failed'|'expired'|'timeout'|'error'} */
        this._phase = this._mode === 'replay' ? 'ready' : 'queued';
        /** @type {?string} */
        this._emptyReason = null;
        /**
         * Blob URLs we created from data: thumbnails. The extension manifest's
         * CSP `img-src 'self' blob:` permits blob: but not data: — so we
         * convert each data URL to a blob URL on render and revoke them all on
         * destroy() to avoid leaks.
         * @type {Set<string>}
         */
        this._blobUrls = new Set();

        /** @type {HTMLElement} */
        this._root = this._buildRoot();
        /** @type {HTMLElement} */
        this._statusEl = /** @type {HTMLElement} */ (this._root.querySelector('.entry-video-examples-status'));
        /** @type {HTMLElement} */
        this._gridEl = /** @type {HTMLElement} */ (this._root.querySelector('.entry-video-examples-grid'));
        /** @type {HTMLElement} */
        this._emptyEl = /** @type {HTMLElement} */ (this._root.querySelector('.entry-video-examples-empty'));
        /** @type {HTMLElement} */
        this._errorEl = /** @type {HTMLElement} */ (this._root.querySelector('.entry-video-examples-error'));
        /** @type {HTMLElement} */
        this._errorTextEl = /** @type {HTMLElement} */ (this._errorEl.querySelector('.entry-video-examples-error-text'));

        entry.appendChild(this._root);

        if (this._mode === 'replay') {
            const initial = Array.isArray(options.initialClips) ? options.initialClips : [];
            this._currentClips = initial;
            if (initial.length > 0) {
                this._renderClips(initial);
            } else {
                this._renderEmpty();
            }
        } else {
            this._renderSkeletons();
        }
        this._root.dataset.state = this._phase;
        this._updateStatus();
    }

    /** @returns {HTMLElement} */
    get root() { return this._root; }

    /** @returns {string[]} */
    getSelectedClipIds() { return [...this._selectedClipIds]; }

    /** @returns {ClipStatus[]} */
    getSelectedClips() {
        return this._currentClips.filter((c) => this._selectedClipIds.has(c.clip_id));
    }

    /**
     * Replace cards with the latest server snapshot, preserving user-selected
     * clip_ids that are still present in the new payload.
     * @param {ClipsWordStatus} wordStatus
     */
    onWordUpdate(wordStatus) {
        if (!this._entry.isConnected) { return; }
        this._currentClips = wordStatus.clips;
        this._emptyReason = wordStatus.empty_reason ?? null;
        // Drop selections whose clip_ids are no longer in the payload.
        const stillPresent = new Set(wordStatus.clips.map((c) => c.clip_id));
        for (const id of this._selectedClipIds) {
            if (!stillPresent.has(id)) { this._selectedClipIds.delete(id); }
        }
        if (wordStatus.stage === 'empty' || wordStatus.clips.length === 0) {
            this._renderEmpty();
        } else {
            this._renderClips(wordStatus.clips);
        }
        this._updateStatus();
    }

    /**
     * @param {'queued'|'polling'|'ready'|'failed'|'expired'|'timeout'} phase
     */
    onPhase(phase) {
        if (!this._entry.isConnected) { return; }
        this._phase = phase;
        this._root.dataset.state = phase;
        this._updateStatus();
        if (phase === 'ready' && this._currentClips.length === 0) {
            this._renderEmpty();
        }
        if (phase === 'failed' || phase === 'expired' || phase === 'timeout') {
            this._renderRetryAffordance();
        }
    }

    /**
     * @param {unknown} error
     */
    onError(error) {
        if (!this._entry.isConnected) { return; }
        this._phase = 'error';
        this._root.dataset.state = 'error';
        const msg = error instanceof Error ? error.message : String(error);
        this._errorTextEl.textContent = `Couldn’t fetch examples: ${msg}`;
        this._errorEl.hidden = false;
        this._gridEl.hidden = true;
        this._emptyEl.hidden = true;
        // Clear the lingering "Queued…" / "Searching…" so the user can read
        // the error banner without a stale status next to it.
        this._statusEl.textContent = '';
    }

    /**
     * Hot-switch density without re-creating the panel. Re-renders the
     * currently visible cards so layout flips immediately.
     * @param {'compact'|'large'} density
     */
    setDensity(density) {
        if (density !== 'compact' && density !== 'large') { return; }
        if (this._density === density) { return; }
        this._density = density;
        this._root.dataset.density = density;
        if (this._currentClips.length > 0) { this._renderClips(this._currentClips); }
    }

    /**
     * @returns {boolean} true if the panel is in a state where re-opening
     *   should reset and try again (error / expired / timeout / failed).
     */
    isTerminal() {
        switch (this._phase) {
            case 'error':
            case 'failed':
            case 'expired':
            case 'timeout':
                return true;
            default:
                return false;
        }
    }

    /** Remove from DOM and zero out state. */
    destroy() {
        if (this._root.parentNode !== null) {
            this._root.parentNode.removeChild(this._root);
        }
        this._currentClips = [];
        this._selectedClipIds.clear();
        for (const u of this._blobUrls) { URL.revokeObjectURL(u); }
        this._blobUrls.clear();
    }

    // --- internals ---

    /** @returns {HTMLElement} */
    _buildRoot() {
        const root = document.createElement('div');
        root.className = PANEL_CLASS;
        root.dataset.state = 'queued';
        root.dataset.density = this._density;

        const header = document.createElement('div');
        header.className = 'entry-video-examples-header';

        const title = document.createElement('span');
        title.className = 'entry-video-examples-title';
        title.textContent = `${this._mode === 'replay' ? 'Saved examples' : 'Examples'} — ${this._word}`;
        header.appendChild(title);

        const status = document.createElement('span');
        status.className = 'entry-video-examples-status';
        header.appendChild(status);

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.className = 'entry-video-examples-cancel';
        cancelBtn.title = 'Close';
        cancelBtn.textContent = '×';
        cancelBtn.addEventListener('click', () => {
            this._hooks.onCancel();
        });
        header.appendChild(cancelBtn);

        root.appendChild(header);

        const grid = document.createElement('div');
        grid.className = 'entry-video-examples-grid';
        root.appendChild(grid);

        const empty = document.createElement('div');
        empty.className = 'entry-video-examples-empty';
        empty.hidden = true;
        root.appendChild(empty);

        const errorEl = document.createElement('div');
        errorEl.className = 'entry-video-examples-error';
        errorEl.hidden = true;
        const errorText = document.createElement('span');
        errorText.className = 'entry-video-examples-error-text';
        errorEl.appendChild(errorText);
        const retryBtn = document.createElement('button');
        retryBtn.type = 'button';
        retryBtn.className = 'entry-video-examples-retry';
        retryBtn.textContent = 'Retry';
        retryBtn.addEventListener('click', () => {
            this._errorEl.hidden = true;
            this._gridEl.hidden = false;
            this._hooks.onRetry();
        });
        errorEl.appendChild(retryBtn);
        root.appendChild(errorEl);

        return root;
    }

    /** */
    _renderSkeletons() {
        const frag = document.createDocumentFragment();
        for (let i = 0; i < SKELETON_CARD_COUNT; i++) {
            const card = document.createElement('div');
            card.className = 'entry-video-examples-clip entry-video-examples-clip-skeleton';
            frag.appendChild(card);
        }
        this._gridEl.replaceChildren(frag);
        this._gridEl.hidden = false;
        this._emptyEl.hidden = true;
        this._errorEl.hidden = true;
    }

    /** @param {ClipStatus[]} clips */
    _renderClips(clips) {
        // Each render rebuilds the card DOM from scratch. The previous render's
        // blob URLs (created by _dataUrlToBlobUrl per clip thumb) would leak
        // otherwise — every status poll for a 3-clip panel adds ~120 KB of
        // wire-decoded base64 to memory until destroy(). Snapshot the old set,
        // let _buildClipCard register fresh URLs into _blobUrls, then revoke
        // the snapshotted ones. The DOM swap via replaceChildren happens
        // BEFORE the revoke so live <img> elements never reference a freed URL.
        const oldUrls = [...this._blobUrls];
        this._blobUrls.clear();
        const frag = document.createDocumentFragment();
        for (const clip of clips) { frag.appendChild(this._buildClipCard(clip)); }
        this._gridEl.replaceChildren(frag);
        this._gridEl.hidden = false;
        this._emptyEl.hidden = true;
        this._errorEl.hidden = true;
        for (const u of oldUrls) { URL.revokeObjectURL(u); }
    }

    /** */
    _renderEmpty() {
        const reason = this._emptyReason !== null && Object.prototype.hasOwnProperty.call(EMPTY_REASON_TEXT, this._emptyReason) ?
            /** @type {Record<string, string>} */ (EMPTY_REASON_TEXT)[this._emptyReason] :
            EMPTY_REASON_TEXT.no_examples;
        this._emptyEl.textContent = reason;
        this._emptyEl.hidden = false;
        this._gridEl.hidden = true;
        this._errorEl.hidden = true;
    }

    /** */
    _renderRetryAffordance() {
        // For ready-but-empty we already show the empty-reason text; only show
        // the error banner for true failure phases.
        if (this._phase === 'ready') { return; }
        const text = /** @type {Record<string, string>} */ (PHASE_STATUS_TEXT)[this._phase] ?? 'Couldn’t fetch examples.';
        this._errorTextEl.textContent = text;
        this._errorEl.hidden = false;
        this._gridEl.hidden = true;
    }

    /** */
    _updateStatus() {
        const text = /** @type {Record<string, string>} */ (PHASE_STATUS_TEXT)[this._phase] ?? '';
        // Suppress the polling text once we have clips on screen — the cards
        // themselves are the affordance.
        if ((this._phase === 'polling' || this._phase === 'queued') && this._currentClips.length > 0) {
            this._statusEl.textContent = '';
        } else if (this._phase === 'ready' && this._currentClips.length > 0) {
            this._statusEl.textContent = `${this._currentClips.length} example${this._currentClips.length === 1 ? '' : 's'}`;
        } else {
            this._statusEl.textContent = text;
        }
    }

    /**
     * Decode a `data:image/...;base64,...` URL into a Blob, return a fresh
     * blob URL, and register it for later revocation in destroy(). Returns
     * null for malformed input (any throw is swallowed; the caller falls
     * back to the <video> poster path).
     * @param {string} dataUrl
     * @returns {?string}
     */
    _dataUrlToBlobUrl(dataUrl) {
        try {
            // RFC 2397: scheme + media-type tokens + `;base64` param are all
            // case-insensitive. Normalising the header lets servers that emit
            // `Data:image/JPEG;BASE64,…` (PIL, some Go libs) round-trip cleanly.
            if (dataUrl.slice(0, 5).toLowerCase() !== 'data:') { return null; }
            const commaIdx = dataUrl.indexOf(',');
            if (commaIdx < 0) { return null; }
            const headerRaw = dataUrl.slice(5, commaIdx);
            const headerLc = headerRaw.toLowerCase();
            const semiIdx = headerRaw.indexOf(';');
            const mime = (semiIdx > 0 ? headerRaw.slice(0, semiIdx) : headerRaw).toLowerCase();
            const isBase64 = headerLc.endsWith(';base64');
            // Strip whitespace/newlines from the base64 body — some encoders
            // wrap at 76 chars (RFC 2045 inheritance) which atob rejects.
            const rawBody = dataUrl.slice(commaIdx + 1);
            const body = isBase64 ? rawBody.replace(/\s+/g, '') : rawBody;
            let bytes;
            if (isBase64) {
                const bin = atob(body);
                bytes = new Uint8Array(bin.length);
                for (let i = 0, ii = bin.length; i < ii; ++i) { bytes[i] = bin.charCodeAt(i); }
            } else {
                bytes = new TextEncoder().encode(decodeURIComponent(body));
            }
            const url = URL.createObjectURL(new Blob([bytes], {type: mime || 'application/octet-stream'}));
            this._blobUrls.add(url);
            return url;
        } catch (e) {
            log.log(`[video-examples] _dataUrlToBlobUrl failed: ${e instanceof Error ? e.message : String(e)}`);
            return null;
        }
    }

    /**
     * @param {ClipStatus} clip
     * @returns {HTMLElement}
     */
    _buildClipCard(clip) {
        const card = document.createElement('div');
        card.className = 'entry-video-examples-clip';
        card.dataset.clipId = clip.clip_id;

        const thumb = document.createElement('div');
        thumb.className = 'entry-video-examples-clip-thumb';
        // Try to render a thumbnail image first. Core ships them as
        // `data:image/jpeg;base64,…` data URLs (~30-50 KB). The extension
        // manifest CSP is `img-src 'self' blob:` — data: is NOT in that
        // allowlist — so we must transcode to a blob URL or the <img> stays
        // broken. dataUrlToBlob can return null on malformed input; on that
        // (or any conversion failure) we fall through to the <video> poster.
        const blobThumbUrl = (typeof clip.thumb_data_url === 'string' && clip.thumb_data_url.length > 0) ?
            this._dataUrlToBlobUrl(clip.thumb_data_url) :
            null;
        if (blobThumbUrl !== null) {
            const img = document.createElement('img');
            img.src = blobThumbUrl;
            img.alt = '';
            // Note: deliberately no `loading="lazy"` — blob URLs are local and
            // we want them painted immediately on first render, not deferred
            // by the visibility heuristic (the entry is below the fold of
            // most popups and would never load otherwise).
            thumb.appendChild(img);
        } else if (typeof clip.clip_url === 'string' && clip.clip_url.length > 0) {
            // Core didn't ship a thumbnail data-URL (typical of the F2 replay
            // path — we don't store the base64 blob in the Anki note). Mount a
            // metadata-only <video> and force a seek to 0.1s so Chromium
            // actually paints the first frame as a poster. Without the time-
            // fragment the canvas stays gray on most platforms — `preload=
            // "metadata"` alone is not enough.
            // muted + playsInline keep autoplay-prevention out of our way;
            // pointer-events:none routes clicks to the parent thumb element.
            const sep = clip.clip_url.includes('#') ? '&' : '#';
            const video = document.createElement('video');
            video.src = `${clip.clip_url}${sep}t=0.1`;
            video.preload = 'metadata';
            video.muted = true;
            video.playsInline = true;
            video.controls = false;
            video.style.pointerEvents = 'none';
            thumb.appendChild(video);
        }
        if (typeof clip.duration_ms === 'number' && clip.duration_ms > 0) {
            const duration = document.createElement('span');
            duration.className = 'entry-video-examples-clip-duration';
            duration.textContent = formatDuration(clip.duration_ms);
            thumb.appendChild(duration);
        }
        thumb.addEventListener('click', () => {
            this._hooks.onClipOpen?.(clip);
        });
        card.appendChild(thumb);

        const body = document.createElement('div');
        body.className = 'entry-video-examples-clip-body';

        const subtitle = document.createElement('div');
        subtitle.className = 'entry-video-examples-clip-subtitle';
        subtitle.textContent = clip.subtitle_text;
        body.appendChild(subtitle);

        const meta = document.createElement('div');
        meta.className = 'entry-video-examples-clip-meta';
        if (typeof clip.cefr === 'string' && clip.cefr.length > 0) {
            const cefr = document.createElement('span');
            cefr.className = 'entry-video-examples-clip-cefr';
            cefr.textContent = clip.cefr;
            meta.appendChild(cefr);
        }
        if (typeof clip.year === 'number' && clip.year > 0) {
            const year = document.createElement('span');
            year.className = 'entry-video-examples-clip-year';
            year.textContent = String(clip.year);
            meta.appendChild(year);
        }
        if (typeof clip.difficulty === 'number') {
            const diff = document.createElement('span');
            diff.className = 'entry-video-examples-clip-difficulty';
            diff.textContent = `diff ${clip.difficulty}`;
            meta.appendChild(diff);
        }
        body.appendChild(meta);
        card.appendChild(body);

        // Checkboxes are a collect-mode affordance ("which clips to persist on
        // save"). In replay mode the clips are already saved to Anki, so the
        // card is read-only — clicking the thumbnail plays the modal.
        if (this._mode === 'collect') {
            const checkLabel = document.createElement('label');
            checkLabel.className = 'entry-video-examples-clip-checkbox';
            checkLabel.title = 'Attach this clip to the Anki card';
            const checkInput = document.createElement('input');
            checkInput.type = 'checkbox';
            checkInput.checked = this._selectedClipIds.has(clip.clip_id);
            const applySelection = () => {
                if (checkInput.checked) {
                    this._selectedClipIds.add(clip.clip_id);
                    card.classList.add('entry-video-examples-clip-selected');
                } else {
                    this._selectedClipIds.delete(clip.clip_id);
                    card.classList.remove('entry-video-examples-clip-selected');
                }
                this._updateSelectionCount();
            };
            applySelection();
            checkInput.addEventListener('change', applySelection);
            const checkBox = document.createElement('span');
            checkBox.className = 'entry-video-examples-clip-checkbox-box';
            checkLabel.appendChild(checkInput);
            checkLabel.appendChild(checkBox);
            card.appendChild(checkLabel);

            // Make the body area (subtitle + meta) act as a bigger hit-zone
            // for toggling selection. Clicking the subtitle / meta toggles
            // the checkbox; clicking the thumbnail still opens the modal.
            body.style.cursor = 'pointer';
            body.title = 'Click to attach to Anki card';
            body.addEventListener('click', (e) => {
                if (e.target === checkInput) { return; }
                checkInput.checked = !checkInput.checked;
                applySelection();
            });
        }

        return card;
    }

    /** */
    _updateSelectionCount() {
        if (this._mode !== 'collect') { return; }
        const n = this._selectedClipIds.size;
        if (n === 0) {
            this._updateStatus();
            return;
        }
        this._statusEl.textContent = `${n} selected · click + to save`;
    }
}

/**
 * @param {number} ms
 * @returns {string}
 */
function formatDuration(ms) {
    const seconds = ms / 1000;
    if (seconds < 60) { return `${seconds.toFixed(1)}s`; }
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s < 10 ? '0' : ''}${s}`;
}
