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

import {log} from '../core/log.js';

/**
 * Toolbar element pair that drives the "test words against Anki-Conf" feature:
 *
 *   ┌───────────────────────────────────────────────────────────────────────┐
 *   │ [ Test words ]  [ 12 new ]    (rendered inside `hostElement`)         │
 *   └───────────────────────────────────────────────────────────────────────┘
 *
 *   - "Test words" calls the lexicon analyze endpoint with the text returned
 *     by `getTextSource()` and reveals the count badge.
 *   - The count badge is itself a button; clicking it opens a modal with a
 *     checklist of new words. Toggling a checkbox is the action: check ->
 *     POST known-words (mark known), uncheck -> DELETE known-words (revoke).
 *     No "Save" button — every flip is committed.
 */
export class TestWordsController {
    /**
     * @param {object} options
     * @param {import('./display.js').Display} options.display
     * @param {HTMLElement} options.hostElement
     * @param {() => (string | Promise<string>)} options.getTextSource
     * @param {string} [options.triggerLabel]
     * @param {string} [options.modalTitle]
     */
    constructor({display, hostElement, getTextSource, triggerLabel, modalTitle}) {
        /** @type {import('./display.js').Display} */
        this._display = display;
        /** @type {HTMLElement} */
        this._hostElement = hostElement;
        /** @type {() => (string | Promise<string>)} */
        this._getTextSource = getTextSource;
        /** @type {string} */
        this._triggerLabel = typeof triggerLabel === 'string' ? triggerLabel : 'Test words';
        /** @type {string} */
        this._modalTitle = typeof modalTitle === 'string' ? modalTitle : 'Mark words you know';
        /** @type {?HTMLButtonElement} */
        this._triggerButton = null;
        /** @type {?HTMLButtonElement} */
        this._countButton = null;
        /** @type {string[]} */
        this._lastNewWords = [];
        /** @type {import('anki-conf').AnalyzeSource} */
        this._lastSource = 'unknown';
        /** @type {Set<string>} */
        this._known = new Set();
        /** @type {boolean} */
        this._busy = false;
        /** @type {?HTMLElement} */
        this._modalOverlay = null;
        /** @type {?HTMLElement} */
        this._modalListEl = null;
        /** @type {?HTMLElement} */
        this._modalStatusEl = null;
        /** @type {?(ev: KeyboardEvent) => void} */
        this._modalEscHandler = null;
    }

    /** Render trigger button + (hidden) count badge into the host element. */
    render() {
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'test-words-trigger';
        trigger.textContent = this._triggerLabel;
        trigger.addEventListener('click', () => { void this._onTriggerClick(); });

        const count = document.createElement('button');
        count.type = 'button';
        count.className = 'test-words-count';
        count.textContent = '0';
        count.hidden = true;
        count.addEventListener('click', () => { this._openModal(); });

        this._hostElement.appendChild(trigger);
        this._hostElement.appendChild(count);
        this._triggerButton = trigger;
        this._countButton = count;
    }

    // Private

    /** */
    async _onTriggerClick() {
        if (this._busy || this._triggerButton === null) { return; }
        let text = '';
        try {
            text = await this._getTextSource();
        } catch (e) {
            log.error(e);
            this._flashTrigger('Read failed', true);
            return;
        }
        text = typeof text === 'string' ? text.trim() : '';
        if (text.length === 0) {
            this._flashTrigger('No text', true);
            this._updateCountButton([], 'empty');
            return;
        }
        this._setBusy(true);
        const previousLabel = this._triggerButton.textContent;
        this._triggerButton.textContent = 'Checking…';
        try {
            const result = await this._display.application.api.lexiconAnalyzeText(text);
            this._lastNewWords = result.newWords;
            this._lastSource = result.source;
            this._known.clear();
            this._updateCountButton(result.newWords, result.source);
            if (this._modalOverlay !== null) {
                this._rebuildModalList();
            }
        } catch (e) {
            log.error(e);
            const status = this._readStatusCode(e);
            this._flashTrigger(status === 503 ? 'Core offline' : 'Request failed', true);
        } finally {
            this._setBusy(false);
            this._triggerButton.textContent = previousLabel;
        }
    }

    /**
     * @param {string[]} words
     * @param {import('anki-conf').AnalyzeSource | 'empty'} source
     */
    _updateCountButton(words, source) {
        if (this._countButton === null) { return; }
        if (words.length === 0) {
            this._countButton.hidden = true;
            this._countButton.textContent = '0';
            return;
        }
        const offline = source === 'regex' ? ' offline' : '';
        this._countButton.textContent = `${words.length} new${offline}`;
        this._countButton.hidden = false;
    }

    /**
     * Show the trigger button briefly highlighted with a short label.
     * @param {string} text
     * @param {boolean} isError
     */
    _flashTrigger(text, isError) {
        if (this._triggerButton === null) { return; }
        const original = this._triggerLabel;
        this._triggerButton.textContent = text;
        this._triggerButton.classList.toggle('error', isError);
        setTimeout(() => {
            if (this._triggerButton === null) { return; }
            this._triggerButton.textContent = original;
            this._triggerButton.classList.remove('error');
        }, 1800);
    }

    /** */
    _openModal() {
        if (this._modalOverlay !== null) { return; }
        if (this._lastNewWords.length === 0) { return; }

        const overlay = document.createElement('div');
        overlay.className = 'test-words-modal-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'test-words-modal';
        dialog.setAttribute('role', 'dialog');
        dialog.tabIndex = -1;

        const header = document.createElement('div');
        header.className = 'test-words-modal-header';

        const title = document.createElement('div');
        title.className = 'test-words-modal-title';
        title.textContent = this._modalTitle;

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'test-words-modal-close';
        closeBtn.setAttribute('aria-label', 'Close');
        closeBtn.textContent = '×';

        header.appendChild(title);
        header.appendChild(closeBtn);

        const hint = document.createElement('div');
        hint.className = 'test-words-modal-hint';
        hint.textContent = 'Check a word to mark it as known. Uncheck to revoke.';
        if (this._lastSource === 'regex') {
            hint.textContent += ' (offline fallback — results are approximate)';
        }

        const list = document.createElement('div');
        list.className = 'test-words-modal-list';

        const status = document.createElement('div');
        status.className = 'test-words-modal-status';
        status.hidden = true;

        dialog.appendChild(header);
        dialog.appendChild(hint);
        dialog.appendChild(list);
        dialog.appendChild(status);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const onClose = () => this._closeModal();
        closeBtn.addEventListener('click', onClose);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) { onClose(); }
        });
        const escHandler = (/** @type {KeyboardEvent} */ ev) => {
            if (ev.key === 'Escape') { onClose(); }
        };
        document.addEventListener('keydown', escHandler);

        this._modalOverlay = overlay;
        this._modalEscHandler = escHandler;
        this._modalListEl = list;
        this._modalStatusEl = status;
        this._rebuildModalList();
        setTimeout(() => dialog.focus(), 0);
    }

    /** */
    _closeModal() {
        if (this._modalOverlay === null) { return; }
        this._modalOverlay.remove();
        this._modalOverlay = null;
        this._modalListEl = null;
        this._modalStatusEl = null;
        if (typeof this._modalEscHandler === 'function') {
            document.removeEventListener('keydown', this._modalEscHandler);
            this._modalEscHandler = null;
        }
    }

    /** Populate the modal list from `_lastNewWords` / `_known`. */
    _rebuildModalList() {
        const list = this._modalListEl;
        if (!(list instanceof HTMLElement)) { return; }
        list.replaceChildren();
        for (const word of this._lastNewWords) {
            const row = document.createElement('label');
            row.className = 'test-words-modal-item';
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'test-words-modal-checkbox';
            cb.dataset.word = word;
            cb.checked = this._known.has(word);
            cb.addEventListener('change', () => { void this._onCheckboxChange(cb, word); });
            const label = document.createElement('span');
            label.className = 'test-words-modal-word';
            label.textContent = word;
            row.appendChild(cb);
            row.appendChild(label);
            list.appendChild(row);
        }
        this._setModalStatus('', false);
    }

    /**
     * @param {HTMLInputElement} cb
     * @param {string} word
     */
    async _onCheckboxChange(cb, word) {
        cb.disabled = true;
        const target = cb.checked;
        try {
            if (target) {
                await this._display.application.api.lexiconAddKnownWord(word, 'yomitan');
                this._known.add(word);
                this._setModalStatus(`Marked "${word}" as known.`, false);
            } else {
                await this._display.application.api.lexiconRemoveKnownWord(word);
                this._known.delete(word);
                this._setModalStatus(`Revoked "${word}".`, false);
            }
        } catch (e) {
            log.error(e);
            cb.checked = !target;
            const status = this._readStatusCode(e);
            const msg = status === 503 ? 'Core offline — change reverted.' : `Failed to update "${word}".`;
            this._setModalStatus(msg, true);
        } finally {
            cb.disabled = false;
        }
    }

    /**
     * @param {string} text
     * @param {boolean} isError
     */
    _setModalStatus(text, isError) {
        const el = this._modalStatusEl;
        if (!(el instanceof HTMLElement)) { return; }
        el.textContent = text;
        el.classList.toggle('error', isError);
        el.hidden = text.length === 0;
    }

    /**
     * @param {boolean} busy
     */
    _setBusy(busy) {
        this._busy = busy;
        if (this._triggerButton !== null) { this._triggerButton.disabled = busy; }
    }

    /**
     * @param {unknown} error
     * @returns {?number}
     */
    _readStatusCode(error) {
        if (typeof error !== 'object' || error === null) { return null; }
        const e = /** @type {{data?: {status?: unknown}}} */ (error);
        if (typeof e.data === 'object' && e.data !== null && typeof e.data.status === 'number') {
            return e.data.status;
        }
        return null;
    }
}
