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

/**
 * Build identifier — bumped by `scripts/yomitan-check.sh` to the commit SHA
 * each commit. Logged once per panel mount so the user can confirm in the
 * popup-iframe DevTools console which build is actually loaded. Chromium
 * caches `chrome-extension://` stylesheets/scripts aggressively; if the
 * console shows an older fingerprint than `git rev-parse --short HEAD`,
 * the reload didn't take and the user needs to close all extension tabs +
 * Reload again (the file is served fresh but the iframe holds the old copy).
 */
export const BUILD_FINGERPRINT = 've-2026-06-20-vtthl-v10';
let _fingerprintLogged = false;
/** @returns {void} */
function logBuildFingerprintOnce() {
    if (_fingerprintLogged) { return; }
    _fingerprintLogged = true;
    log.log(`[video-examples] BUILD_FINGERPRINT=${BUILD_FINGERPRINT}`);
}

const PANEL_CLASS = 'entry-video-examples';
const TARGET_CLIP_COUNT = 3;

const EMPTY_REASON_TEXT = Object.freeze({
    no_examples: 'No video examples found for this word.',
    render_failed: 'Couldn’t render examples for this word.',
    needs_connection: 'Internet connection needed to fetch examples.',
    transient_error: 'Temporary error fetching examples — try again.',
});

const PHASE_ERROR_TEXT = Object.freeze({
    failed: 'Couldn’t fetch clips',
    expired: 'This examples session expired',
    timeout: 'Timed out waiting for clips',
    error: 'Couldn’t fetch clips',
});

// Inline SVG icons mirror the design's `VI.*` map. Embedded literally so the
// CSP `script-src 'self'` doesn't need any relaxation, and they paint without
// a network fetch on cold start.
// All entries MUST carry `xmlns="http://www.w3.org/2000/svg"` on the root
// <svg>. DOMParser('image/svg+xml') without an xmlns yields a root with
// `namespaceURI = null`, which prevents the element from rendering when
// inserted into an HTML document. (Symptom before the xmlns fix: every
// icon site logged `parseSvgIcon: parsing failed (got <svg>)` and the
// panel header/cards had blank gaps where icons should be.)
const ICONS = Object.freeze({
    reel: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><rect x="2.5" y="4" width="19" height="16" rx="2.4"/><path d="M2.5 9h19M8 4v16M16 4v16" stroke-width="1.4"/></svg>',
    spark: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l1.7 6.3L20 10l-6.3 1.7L12 18l-1.7-6.3L4 10l6.3-1.7z"/></svg>',
    scissor: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 16 16" fill="none"><circle cx="4" cy="4" r="2" stroke="currentColor" stroke-width="1.4"/><circle cx="4" cy="12" r="2" stroke="currentColor" stroke-width="1.4"/><path d="M5.6 5.6L14 13M5.6 10.4L14 3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
    refresh: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"><path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16m0 5v-5h5"/></svg>',
    x: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M4 4l8 8M12 4l-8 8" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
    check: '<svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 16 16" fill="none"><path d="M3 8.5l3.2 3L13 4.5" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
    play: '<svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.87l13-7.5a1 1 0 0 0 0-1.74l-13-7.5A1 1 0 0 0 7 4.5z"/></svg>',
    playS: '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15a1 1 0 0 0 1.5.87l13-7.5a1 1 0 0 0 0-1.74l-13-7.5A1 1 0 0 0 7 4.5z"/></svg>',
    plus: '<svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" stroke-width="1.9" stroke-linecap="round"/></svg>',
    anki: '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 16 16" fill="none"><rect x="2.5" y="3.5" width="8" height="9.5" rx="1.4" stroke="currentColor" stroke-width="1.3"/><path d="M5.6 3.5V2.6a.6.6 0 0 1 .6-.6h7a.6.6 0 0 1 .6.6v8.4a.6.6 0 0 1-.6.6h-1.1" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>',
    alert: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M10.3 4.3 2.6 18a2 2 0 0 0 1.7 3h15.4a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z"/><path d="M12 9v4M12 17h.01"/></svg>',
    empty: '<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><rect x="2.5" y="5" width="19" height="14" rx="2.2"/><path d="m2.5 7 19 10" opacity="0.5"/></svg>',
});

/**
 * Inline `.entry-video-examples` panel rendered next to a Yomitan dict entry.
 * Public API stays compatible with the orchestrator's callbacks: `onPhase`,
 * `onWordUpdate`, `onError`, plus density hot-swap, terminal-state check,
 * destroy + blob URL revoke. The structural rewrite (header chip + word pill
 * + state-specific bodies + sticky footer) is the design from
 * `docs/video-examples-design-spec.v2.md`.
 */
export class VideoExamplesPanel {
    /**
     * @param {HTMLElement} entry
     * @param {string} word
     * @param {{onCancel: () => void, onRetry: () => void, onClipOpen?: (clip: ClipStatus, words: string[]) => void}} hooks
     * @param {{mode?: 'collect'|'replay', initialClips?: ClipStatus[], density?: 'compact'|'large', highlightForms?: string[]}} [options]
     */
    constructor(entry, word, hooks, options = {}) {
        logBuildFingerprintOnce();
        /** @type {HTMLElement} */
        this._entry = entry;
        /** @type {string} */
        this._word = word;
        /**
         * Word forms to feed the modal's caption highlight. Falls back to
         * `[word]` so callers that don't know about deinflection get the
         * pre-existing single-form behaviour.
         * @type {string[]}
         */
        this._highlightForms = Array.isArray(options.highlightForms) && options.highlightForms.length > 0
            ? options.highlightForms.filter((s) => typeof s === 'string' && s.length > 0)
            : [word];
        /** @type {{onCancel: () => void, onRetry: () => void, onClipOpen?: (clip: ClipStatus, words: string[]) => void}} */
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
         * Clip IDs we've already painted at least once. The `.ve-pop` arrival
         * animation only applies when a card is newly-added — re-rendering an
         * existing card on a subsequent status poll must NOT re-trigger the
         * animation, or the panel jitters on every poll.
         * @type {Set<string>}
         */
        this._seenClipIds = new Set();
        /** Set by setDensity() to disable .ve-pop on the next re-render. */
        this._suppressNextPop = false;
        /**
         * Blob URLs created from data: thumbnails. The extension manifest's
         * CSP `img-src 'self' blob:` permits blob: but not data: — so we
         * convert each data URL to a blob URL on render. Revoked in
         * `_renderClips` (snapshot-clear-rebuild-revoke order) and on destroy.
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
        this._footerEl = /** @type {HTMLElement} */ (this._root.querySelector('.entry-video-examples-footer'));
        /** @type {HTMLElement} */
        this._refreshBtn = /** @type {HTMLElement} */ (this._root.querySelector('.entry-video-examples-icon-refresh'));

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
            this._renderLoading();
        }
        this._root.dataset.state = this._phase;
        this._updateStatus();
        this._updateFooter();
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
        const stillPresent = new Set(wordStatus.clips.map((c) => c.clip_id));
        for (const id of this._selectedClipIds) {
            if (!stillPresent.has(id)) { this._selectedClipIds.delete(id); }
        }
        // Prune _seenClipIds the same way: if Core drops a clip and later
        // re-emits the same ID (job retry / re-promote), the re-arrival
        // should pop again.
        for (const id of this._seenClipIds) {
            if (!stillPresent.has(id)) { this._seenClipIds.delete(id); }
        }
        const polling = this._phase === 'queued' || this._phase === 'polling';
        if (wordStatus.clips.length > 0) {
            this._renderClips(wordStatus.clips);
        } else if (polling) {
            // Mid-search empty payload — Core is still working, just hasn't
            // delivered any clips yet. Keep the loading state (header status
            // already shows "Searching & cutting clips…"); painting the
            // "No video examples found" placeholder here would be a lie.
            this._renderLoading();
        } else {
            // Search is over (ready / failed / timeout / etc.) AND no clips.
            // Now it's correct to show the empty-state placeholder.
            this._renderEmpty();
        }
        this._updateStatus();
        this._updateFooter();
    }

    /**
     * @param {'queued'|'polling'|'ready'|'failed'|'expired'|'timeout'} phase
     */
    onPhase(phase) {
        if (!this._entry.isConnected) { return; }
        this._phase = phase;
        this._root.dataset.state = phase;
        this._updateStatus();
        this._updateRefreshVisibility();
        if (phase === 'ready' && this._currentClips.length === 0) {
            this._renderEmpty();
        }
        // Render the error block only on a hard fail AND zero clips AND no
        // empty_reason from Core — the orchestrator already translates
        // `failed + empty_reason` into 'ready' for the panel, but if that
        // ever leaks through we honour spec M4: empty_reason path stays
        // friendly (no error chrome).
        const failed = phase === 'failed' || phase === 'expired' || phase === 'timeout';
        if (failed && this._currentClips.length === 0 && this._emptyReason === null) {
            this._renderError();
        }
        this._updateFooter();
    }

    /**
     * @param {unknown} error
     */
    onError(error) {
        if (!this._entry.isConnected) { return; }
        this._phase = 'error';
        this._root.dataset.state = 'error';
        const msg = error instanceof Error ? error.message : String(error);
        log.log(`[video-examples] panel error: ${msg}`);
        // Mirror onPhase's guard: don't hide already-painted clips behind the
        // error chrome. The status line carries the danger-coloured "Couldn't
        // fetch clips" text in that case (see _updateStatus error branch).
        if (this._currentClips.length === 0) {
            this._renderError();
        }
        this._updateStatus();
        this._updateRefreshVisibility();
        this._updateFooter();
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
        // Density swap is a re-layout, not new content arrival — suppress
        // the `.ve-pop` animation in the next `_renderClips` to avoid the
        // jitter of all N cards animating at once.
        this._suppressNextPop = true;
        if (this._currentClips.length > 0) { this._renderClips(this._currentClips); }
        this._suppressNextPop = false;
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
        this._seenClipIds.clear();
        for (const u of this._blobUrls) { URL.revokeObjectURL(u); }
        this._blobUrls.clear();
    }

    // --- internals ---

    /** @returns {HTMLElement} */
    _buildRoot() {
        const root = document.createElement('div');
        root.className = PANEL_CLASS;
        root.dataset.state = this._phase;
        root.dataset.density = this._density;
        root.dataset.mode = this._mode;

        root.appendChild(this._buildHeader());

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
        root.appendChild(errorEl);

        const footer = document.createElement('div');
        footer.className = 'entry-video-examples-footer';
        footer.hidden = true;
        root.appendChild(footer);

        return root;
    }

    /** @returns {HTMLElement} */
    _buildHeader() {
        const header = document.createElement('div');
        header.className = 'entry-video-examples-header';

        const top = document.createElement('div');
        top.className = 'entry-video-examples-header-top';

        const reel = document.createElement('span');
        reel.className = 'entry-video-examples-reel';
        appendIcon(reel, ICONS.reel);
        top.appendChild(reel);

        const title = document.createElement('span');
        title.className = 'entry-video-examples-title';
        title.textContent = this._mode === 'replay' ? 'Saved examples' : 'Examples';
        top.appendChild(title);

        const wordPill = document.createElement('span');
        wordPill.className = 'entry-video-examples-word-pill';
        appendIcon(wordPill, ICONS.spark);
        const wordSpan = document.createElement('span');
        wordSpan.className = 'entry-video-examples-word-text';
        wordSpan.textContent = this._word;
        wordPill.appendChild(wordSpan);
        top.appendChild(wordPill);

        const spacer = document.createElement('span');
        spacer.className = 'entry-video-examples-header-spacer';
        top.appendChild(spacer);

        const refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'entry-video-examples-icon-btn entry-video-examples-icon-refresh';
        refreshBtn.title = 'Get clips again';
        refreshBtn.setAttribute('aria-label', 'Get clips again');
        appendIcon(refreshBtn, ICONS.refresh);
        refreshBtn.addEventListener('click', () => { this._hooks.onRetry(); });
        // Hidden in the initial loading state — see _updateRefreshVisibility.
        refreshBtn.hidden = this._phase === 'queued' || this._phase === 'polling';
        top.appendChild(refreshBtn);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'entry-video-examples-icon-btn entry-video-examples-icon-close';
        closeBtn.title = 'Close panel';
        closeBtn.setAttribute('aria-label', 'Close panel');
        appendIcon(closeBtn, ICONS.x);
        closeBtn.addEventListener('click', () => { this._hooks.onCancel(); });
        top.appendChild(closeBtn);

        header.appendChild(top);

        const status = document.createElement('div');
        status.className = 'entry-video-examples-status';
        header.appendChild(status);

        return header;
    }

    /** Loading state body — header status carries the affordance, body empty. */
    _renderLoading() {
        this._gridEl.replaceChildren();
        this._gridEl.hidden = true;
        this._emptyEl.hidden = true;
        this._errorEl.hidden = true;
    }

    /** @param {ClipStatus[]} clips */
    _renderClips(clips) {
        // Snapshot-clear-rebuild-revoke order preserves invariants:
        //   (a) every live <img> always references a still-valid blob URL,
        //   (b) old URLs from the previous render are revoked after the DOM
        //       swap so the browser can free their backing memory,
        //   (c) `.ve-pop` is only applied to clip_ids we haven't painted yet.
        const oldUrls = [...this._blobUrls];
        this._blobUrls.clear();
        const frag = document.createDocumentFragment();
        for (const clip of clips) {
            const card = this._density === 'large' ? this._buildLargeCard(clip) : this._buildCompactCard(clip);
            const isNew = !this._seenClipIds.has(clip.clip_id);
            if (isNew) { this._seenClipIds.add(clip.clip_id); }
            if (isNew && !this._suppressNextPop) {
                card.classList.add('entry-video-examples-pop');
            }
            frag.appendChild(card);
        }
        this._gridEl.replaceChildren(frag);
        this._gridEl.hidden = false;
        this._emptyEl.hidden = true;
        this._errorEl.hidden = true;
        for (const u of oldUrls) { URL.revokeObjectURL(u); }
    }

    /** */
    _renderEmpty() {
        // Friendly empty-state with the design's filmstrip icon. Used for both
        // the F2 path (saved word with zero clips — rare) and the Core
        // empty_reason path (e.g., word doesn't appear in corpus). Never has
        // error chrome.
        const reason = this._emptyReason !== null && Object.prototype.hasOwnProperty.call(EMPTY_REASON_TEXT, this._emptyReason) ?
            /** @type {Record<string, string>} */ (EMPTY_REASON_TEXT)[this._emptyReason] :
            EMPTY_REASON_TEXT.no_examples;
        this._emptyEl.replaceChildren();
        this._emptyEl.appendChild(buildIcon(ICONS.empty, 'entry-video-examples-empty-icon'));
        const text = document.createElement('span');
        text.className = 'entry-video-examples-empty-text';
        text.textContent = reason;
        this._emptyEl.appendChild(text);
        this._emptyEl.hidden = false;
        this._gridEl.hidden = true;
        this._errorEl.hidden = true;
    }

    /** */
    _renderError() {
        this._errorEl.replaceChildren();
        const iconWrap = document.createElement('span');
        iconWrap.className = 'entry-video-examples-error-icon';
        appendIcon(iconWrap, ICONS.alert);
        this._errorEl.appendChild(iconWrap);

        const heading = document.createElement('div');
        heading.className = 'entry-video-examples-error-heading';
        heading.textContent = 'No clips found';
        this._errorEl.appendChild(heading);

        const body = document.createElement('div');
        body.className = 'entry-video-examples-error-body';
        body.textContent = `We couldn’t cut video examples for «${this._word}» right now.`;
        this._errorEl.appendChild(body);

        const retry = document.createElement('button');
        retry.type = 'button';
        retry.className = 'entry-video-examples-error-retry';
        appendIcon(retry, ICONS.refresh);
        const retryLabel = document.createElement('span');
        retryLabel.textContent = 'Try again';
        retry.appendChild(retryLabel);
        retry.addEventListener('click', () => {
            this._errorEl.hidden = true;
            this._gridEl.hidden = false;
            this._hooks.onRetry();
        });
        this._errorEl.appendChild(retry);

        this._errorEl.hidden = false;
        this._gridEl.hidden = true;
        this._emptyEl.hidden = true;
    }

    /** Refresh icon is shown unless we're still actively polling. */
    _updateRefreshVisibility() {
        if (this._refreshBtn === null) { return; }
        const polling = this._phase === 'queued' || this._phase === 'polling';
        this._refreshBtn.hidden = polling;
    }

    /** Build the status-line content under the title — varies per state. */
    _updateStatus() {
        this._statusEl.replaceChildren();
        const polling = this._phase === 'queued' || this._phase === 'polling';
        const count = this._currentClips.length;
        const selected = this._selectedClipIds.size;

        // Error phases — keep the danger text visible whether or not we have
        // partial clips on screen. Body-level error chrome is gated by
        // count===0 in onPhase/onError; the header-status danger chip is
        // shown either way so the user can see that the fetch failed even
        // when some cards arrived before the failure.
        const isErrorPhase = Object.prototype.hasOwnProperty.call(PHASE_ERROR_TEXT, this._phase);
        if (isErrorPhase) {
            const errorSpan = document.createElement('span');
            errorSpan.className = 'entry-video-examples-status-danger';
            errorSpan.textContent = /** @type {Record<string, string>} */ (PHASE_ERROR_TEXT)[this._phase];
            this._statusEl.appendChild(errorSpan);
            if (count > 0) {
                const tail = document.createElement('span');
                tail.className = 'entry-video-examples-status-tail';
                tail.textContent = ` · ${count} ${count === 1 ? 'clip' : 'clips'} loaded`;
                this._statusEl.appendChild(tail);
            }
            return;
        }

        if (polling && count === 0) {
            // "[scissor wiggle] Searching & cutting clips[...]"
            const scissor = document.createElement('span');
            scissor.className = 'entry-video-examples-spin entry-video-examples-status-accent';
            appendIcon(scissor, ICONS.scissor);
            this._statusEl.appendChild(scissor);

            const label = document.createElement('span');
            label.textContent = 'Searching & cutting clips';
            this._statusEl.appendChild(label);

            const dots = document.createElement('span');
            dots.className = 'entry-video-examples-dots';
            this._statusEl.appendChild(dots);
            return;
        }

        if (polling && count > 0 && count < TARGET_CLIP_COUNT) {
            // "1 of 3 found"
            const span = document.createElement('span');
            span.textContent = `${count} of ${TARGET_CLIP_COUNT} found`;
            this._statusEl.appendChild(span);
            return;
        }

        if (this._mode === 'replay') {
            // "N attached to this note"
            const span = document.createElement('span');
            span.textContent = `${count} attached to this note`;
            this._statusEl.appendChild(span);
            return;
        }

        // Collect mode ready: "N clips" + optional accent " · M selected"
        const total = document.createElement('span');
        total.textContent = `${count} ${count === 1 ? 'clip' : 'clips'}`;
        this._statusEl.appendChild(total);
        if (selected > 0) {
            const sel = document.createElement('span');
            sel.className = 'entry-video-examples-status-accent';
            sel.textContent = ` · ${selected} selected`;
            this._statusEl.appendChild(sel);
        }
    }

    /** Footer carries the Send-to-Anki affordance in collect mode only. */
    _updateFooter() {
        if (this._mode !== 'collect') {
            this._footerEl.hidden = true;
            return;
        }
        // Footer hidden until at least one card is on screen — there's nothing
        // to send before that.
        if (this._currentClips.length === 0) {
            this._footerEl.hidden = true;
            return;
        }
        const selected = this._selectedClipIds.size;
        this._footerEl.replaceChildren();
        if (selected > 0) {
            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'entry-video-examples-send-btn';
            appendIcon(btn, ICONS.plus);
            const label = document.createElement('span');
            label.className = 'entry-video-examples-send-label';
            label.textContent = `Send ${selected} to Anki`;
            btn.appendChild(label);
            const ankiWrap = document.createElement('span');
            ankiWrap.className = 'entry-video-examples-send-anki';
            appendIcon(ankiWrap, ICONS.anki);
            btn.appendChild(ankiWrap);
            btn.addEventListener('click', () => { this._triggerGlobalSave(); });
            this._footerEl.appendChild(btn);
        } else {
            const hint = document.createElement('div');
            hint.className = 'entry-video-examples-footer-hint';
            const box = document.createElement('span');
            box.className = 'entry-video-examples-footer-hint-box';
            hint.appendChild(box);
            const text = document.createElement('span');
            text.textContent = 'Tick clips to attach them to your note';
            hint.appendChild(text);
            this._footerEl.appendChild(hint);
        }
        this._footerEl.hidden = false;
    }

    /**
     * Send-to-Anki click handler delegates to the entry's existing save
     * button so the full save pipeline (duplicate check, addNote/updateFields,
     * persist of selected clips) runs as if the user clicked the global `+`
     * — zero changes to `_applySelectedClipsToNote` required.
     *
     * Picks the first non-disabled, non-hidden save button. In multi-format
     * entries each card format has its own button; we currently can't know
     * which format the user actually wants from the panel — defer to "first
     * actionable" to avoid silently no-op'ing. Future spec-v3 task: thread a
     * `cardFormatIndex` option through the panel constructor.
     */
    _triggerGlobalSave() {
        const buttons = /** @type {NodeListOf<HTMLElement>} */ (
            this._entry.querySelectorAll('.action-button[data-action="save-note"]')
        );
        for (const btn of buttons) {
            const isDisabled = (
                btn.hasAttribute('disabled') ||
                btn.getAttribute('aria-disabled') === 'true' ||
                /** @type {HTMLButtonElement} */ (btn).disabled === true
            );
            if (btn.hidden || isDisabled) { continue; }
            btn.click();
            return;
        }
        // Nothing actionable. Most common cause: the note is already saved
        // (every save button disabled / hidden) — surface that so the user
        // sees a console line instead of a dead button.
        log.log(`[video-examples] Send-to-Anki: no actionable save button (${buttons.length} found, all hidden/disabled). Note may already be saved.`);
    }

    /**
     * Decode `data:image/...;base64,...` URL into a blob URL. RFC 2397
     * compliant (case-insensitive header tokens, whitespace tolerant). Returns
     * null on any failure; caller falls back to <video> poster.
     * @param {string} dataUrl
     * @returns {?string}
     */
    _dataUrlToBlobUrl(dataUrl) {
        try {
            if (dataUrl.slice(0, 5).toLowerCase() !== 'data:') { return null; }
            const commaIdx = dataUrl.indexOf(',');
            if (commaIdx < 0) { return null; }
            const headerRaw = dataUrl.slice(5, commaIdx);
            const headerLc = headerRaw.toLowerCase();
            const semiIdx = headerRaw.indexOf(';');
            const mime = (semiIdx > 0 ? headerRaw.slice(0, semiIdx) : headerRaw).toLowerCase();
            const isBase64 = headerLc.endsWith(';base64');
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
    _buildLargeCard(clip) {
        const card = this._buildCardShell(clip);

        // Thumb (16:9, hero size) sits on top.
        const thumb = this._buildThumb(clip, 'large');
        card.appendChild(thumb);

        // Body: subtitle + meta row + ghost Play button on the right.
        const body = document.createElement('div');
        body.className = 'entry-video-examples-clip-body';

        const subtitle = this._buildSubtitle(clip);
        body.appendChild(subtitle);

        const bottomRow = document.createElement('div');
        bottomRow.className = 'entry-video-examples-clip-bottom';

        const meta = this._buildMeta(clip);
        bottomRow.appendChild(meta);

        const play = document.createElement('button');
        play.type = 'button';
        play.className = 'entry-video-examples-clip-play';
        appendIcon(play, ICONS.playS);
        const playLabel = document.createElement('span');
        playLabel.textContent = 'Play';
        play.appendChild(playLabel);
        play.addEventListener('click', (e) => {
            e.stopPropagation();
            this._hooks.onClipOpen?.(clip, this._highlightForms);
        });
        bottomRow.appendChild(play);

        body.appendChild(bottomRow);
        card.appendChild(body);

        this._maybeAddCheckbox(card, clip, 'large');
        return card;
    }

    /**
     * @param {ClipStatus} clip
     * @returns {HTMLElement}
     */
    _buildCompactCard(clip) {
        const card = this._buildCardShell(clip);

        // Compact mode puts the checkbox inline on the LEFT, before the thumb.
        this._maybeAddCheckbox(card, clip, 'compact');

        const thumb = this._buildThumb(clip, 'compact');
        card.appendChild(thumb);

        const body = document.createElement('div');
        body.className = 'entry-video-examples-clip-body';
        body.appendChild(this._buildSubtitle(clip));
        body.appendChild(this._buildMeta(clip));
        // Compact has no dedicated Play button; the thumb click opens the
        // modal (set up in _buildThumb). Body is informational only —
        // clicking the subtitle text shouldn't fire the player; that's the
        // same convention as the design (which puts the click target only on
        // the thumb / Play overlay).
        card.appendChild(body);

        return card;
    }

    /**
     * @param {ClipStatus} clip
     * @returns {HTMLElement}
     */
    _buildCardShell(clip) {
        const card = document.createElement('div');
        card.className = 'entry-video-examples-clip';
        card.dataset.clipId = clip.clip_id;
        if (this._selectedClipIds.has(clip.clip_id)) {
            card.classList.add('entry-video-examples-clip-selected');
        }
        return card;
    }

    /**
     * @param {ClipStatus} clip
     * @param {'large'|'compact'} density
     * @returns {HTMLElement}
     */
    _buildThumb(clip, density) {
        const thumb = document.createElement('div');
        thumb.className = 'entry-video-examples-clip-thumb';

        const blobThumbUrl = (typeof clip.thumb_data_url === 'string' && clip.thumb_data_url.length > 0) ?
            this._dataUrlToBlobUrl(clip.thumb_data_url) :
            null;
        if (blobThumbUrl !== null) {
            const img = document.createElement('img');
            img.src = blobThumbUrl;
            img.alt = '';
            thumb.appendChild(img);
        } else if (typeof clip.clip_url === 'string' && clip.clip_url.length > 0) {
            // Browser-poster fallback. `#t=0.1` forces Chromium to actually
            // paint frame 0 instead of leaving the canvas grey.
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

        // Hover-revealed play overlay (CSS-driven; element is always present).
        const overlay = document.createElement('span');
        overlay.className = 'entry-video-examples-clip-play-overlay';
        appendIcon(overlay, density === 'large' ? ICONS.play : ICONS.playS);
        thumb.appendChild(overlay);

        if (typeof clip.duration_ms === 'number' && clip.duration_ms > 0) {
            const duration = document.createElement('span');
            duration.className = 'entry-video-examples-clip-duration';
            duration.textContent = formatDuration(clip.duration_ms);
            thumb.appendChild(duration);
        }

        // No top-left badge in replay mode. The header title "Saved examples"
        // + status "N attached to this note" already signal that the panel is
        // read-only — putting a green tile on every thumb confuses users into
        // thinking it's a checkbox (and there's nothing to uncheck anyway).
        thumb.addEventListener('click', () => { this._hooks.onClipOpen?.(clip, this._highlightForms); });
        return thumb;
    }

    /**
     * @param {ClipStatus} clip
     * @returns {HTMLElement}
     */
    _buildSubtitle(clip) {
        const subtitle = document.createElement('div');
        subtitle.className = 'entry-video-examples-clip-subtitle';
        const text = typeof clip.subtitle_text === 'string' ? clip.subtitle_text : '';
        const parts = splitSubtitle(text, this._word);
        if (parts === null) {
            subtitle.textContent = text;
            return subtitle;
        }
        if (parts.a.length > 0) { subtitle.appendChild(document.createTextNode(parts.a)); }
        const mark = document.createElement('mark');
        mark.className = 'entry-video-examples-mark';
        mark.textContent = parts.w;
        subtitle.appendChild(mark);
        if (parts.b.length > 0) { subtitle.appendChild(document.createTextNode(parts.b)); }
        return subtitle;
    }

    /**
     * @param {ClipStatus} clip
     * @returns {HTMLElement}
     */
    _buildMeta(clip) {
        const meta = document.createElement('div');
        meta.className = 'entry-video-examples-clip-meta';

        let prev = false;
        const sep = () => {
            if (!prev) { return; }
            const dot = document.createElement('span');
            dot.className = 'entry-video-examples-clip-meta-sep';
            dot.textContent = '·';
            meta.appendChild(dot);
        };

        if (typeof clip.cefr === 'string' && clip.cefr.length > 0) {
            const cefr = document.createElement('span');
            cefr.className = 'entry-video-examples-clip-cefr';
            cefr.textContent = clip.cefr;
            meta.appendChild(cefr);
            prev = true;
        }
        if (typeof clip.difficulty === 'number') {
            sep();
            const diff = document.createElement('span');
            diff.className = 'entry-video-examples-clip-diff';
            diff.textContent = `diff ${clip.difficulty}`;
            meta.appendChild(diff);
            prev = true;
        }
        if (typeof clip.year === 'number' && clip.year > 0) {
            sep();
            const year = document.createElement('span');
            year.className = 'entry-video-examples-clip-year';
            year.textContent = String(clip.year);
            meta.appendChild(year);
        }
        return meta;
    }

    /**
     * Add the per-clip selection checkbox if we're in collect mode.
     * @param {HTMLElement} card
     * @param {ClipStatus} clip
     * @param {'large'|'compact'} density
     */
    _maybeAddCheckbox(card, clip, density) {
        if (this._mode !== 'collect') { return; }
        const checkLabel = document.createElement('label');
        checkLabel.className = density === 'large' ?
            'entry-video-examples-check entry-video-examples-check-floating' :
            'entry-video-examples-check entry-video-examples-check-inline';
        checkLabel.title = 'Select for Anki';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = this._selectedClipIds.has(clip.clip_id);
        input.setAttribute('aria-label', 'Select for Anki');
        const box = document.createElement('span');
        box.className = 'entry-video-examples-check-box';
        appendIcon(box, ICONS.check);
        checkLabel.appendChild(input);
        checkLabel.appendChild(box);

        const apply = () => {
            if (input.checked) {
                this._selectedClipIds.add(clip.clip_id);
                card.classList.add('entry-video-examples-clip-selected');
                input.setAttribute('aria-label', 'Selected');
            } else {
                this._selectedClipIds.delete(clip.clip_id);
                card.classList.remove('entry-video-examples-clip-selected');
                input.setAttribute('aria-label', 'Select for Anki');
            }
            this._updateStatus();
            this._updateFooter();
        };
        apply();
        input.addEventListener('change', apply);
        // Stop label click from also reaching the thumb/body click handlers
        // — checkbox is its own thing.
        checkLabel.addEventListener('click', (e) => { e.stopPropagation(); });

        if (density === 'large') {
            // Place the floating checkbox inside the thumb (top-left corner).
            // The thumb is already appended; insert checkbox there.
            const thumb = card.querySelector('.entry-video-examples-clip-thumb');
            if (thumb !== null) { thumb.appendChild(checkLabel); }
            return;
        }
        // Compact: prepend so it sits before the thumb on the row.
        card.appendChild(checkLabel);
    }
}

/**
 * Split subtitle text around the first whole-word match of `word`, returning
 * the chunks before / matched / after — null on no match or empty input. The
 * regex uses Unicode property escapes (`\p{L}`, `\p{N}`) for cross-script
 * word boundaries, since JS's `\b` is ASCII-only and Yomitan is multilingual.
 * `match[1]` is returned for `w` so the original casing in the subtitle is
 * preserved (the regex match itself is case-insensitive).
 * @param {string} text
 * @param {string} word
 * @returns {?{a: string, w: string, b: string}}
 */
function splitSubtitle(text, word) {
    if (typeof text !== 'string' || text.length === 0) { return null; }
    if (typeof word !== 'string' || word.length === 0) { return null; }
    const escaped = word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    let re;
    try {
        re = new RegExp(`(?<![\\p{L}\\p{N}])(${escaped})(?![\\p{L}\\p{N}])`, 'iu');
    } catch (e) {
        return null;
    }
    const m = re.exec(text);
    if (m === null) { return null; }
    return {
        a: text.slice(0, m.index),
        w: m[1],
        b: text.slice(m.index + m[1].length),
    };
}

/**
 * SVG parser used for every inline icon in this module. All callers pass
 * string literals from the `ICONS` map — no user input ever reaches this
 * function — but using DOMParser instead of `innerHTML` keeps the
 * `no-unsanitized` lint rule happy AND defends against any future caller
 * who forgets the invariant.
 * @param {string} svgMarkup
 * @returns {?SVGElement}
 */
function parseSvgIcon(svgMarkup) {
    const doc = new DOMParser().parseFromString(svgMarkup, 'image/svg+xml');
    const root = doc.documentElement;
    // Parser-error documents have a <parsererror> root, not <svg>. Tag-name
    // check alone catches that AND any non-SVG content. We intentionally do
    // NOT check namespaceURI: across realms it can be null or unexpected
    // even for legitimate SVG (and `instanceof SVGElement` has the same
    // problem). The ICONS literals carry an explicit xmlns so the imported
    // node still renders correctly in the host HTML document.
    if (root === null || root.localName !== 'svg') {
        log.warn(new Error(`[video-examples] parseSvgIcon: parsing failed (got <${root?.tagName ?? 'null'}>)`));
        return null;
    }
    return /** @type {SVGElement} */ (/** @type {unknown} */ (document.importNode(root, true)));
}

/**
 * @param {Element} el
 * @param {string} svgMarkup
 */
function appendIcon(el, svgMarkup) {
    const svg = parseSvgIcon(svgMarkup);
    if (svg !== null) { el.appendChild(svg); }
}

/**
 * @param {string} svgMarkup
 * @param {string} className
 * @returns {HTMLElement}
 */
function buildIcon(svgMarkup, className) {
    const wrap = document.createElement('span');
    wrap.className = className;
    appendIcon(wrap, svgMarkup);
    return wrap;
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
