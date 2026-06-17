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
 * A reusable inline panel that lets the user ask the local Anki-Conf Core
 * "which words in this text are still new to me?" and bulk-add the picked ones
 * to the known-words store.
 *
 * The panel renders into a caller-provided container and reads its source text
 * lazily through `getTextSource()` (so the caller can decide: live expression
 * textarea, clipboard via API, …).
 */
export class TestWordsPanel {
    /**
     * @param {object} options
     * @param {import('./display.js').Display} options.display
     * @param {HTMLElement} options.container
     * @param {() => (string | Promise<string>)} options.getTextSource
     * @param {string} [options.triggerLabel]
     * @param {string} [options.emptyLabel]
     * @param {string} [options.noTextLabel]
     */
    constructor({display, container, getTextSource, triggerLabel, emptyLabel, noTextLabel}) {
        /** @type {import('./display.js').Display} */
        this._display = display;
        /** @type {HTMLElement} */
        this._container = container;
        /** @type {() => (string | Promise<string>)} */
        this._getTextSource = getTextSource;
        /** @type {string} */
        this._triggerLabel = typeof triggerLabel === 'string' ? triggerLabel : 'Test words';
        /** @type {string} */
        this._emptyLabel = typeof emptyLabel === 'string' ? emptyLabel : 'No new words.';
        /** @type {string} */
        this._noTextLabel = typeof noTextLabel === 'string' ? noTextLabel : 'No text to check.';
        /** @type {?HTMLButtonElement} */
        this._triggerButton = null;
        /** @type {?HTMLElement} */
        this._badge = null;
        /** @type {?HTMLElement} */
        this._resultsBox = null;
        /** @type {?HTMLElement} */
        this._statusEl = null;
        /** @type {?HTMLElement} */
        this._listEl = null;
        /** @type {?HTMLButtonElement} */
        this._addSelectedButton = null;
        /** @type {boolean} */
        this._busy = false;
        /** @type {Set<string>} */
        this._addedWords = new Set();
    }

    /** Render the panel scaffolding (button + collapsible results). */
    render() {
        const wrapper = document.createElement('div');
        wrapper.className = 'test-words-panel';

        const triggerRow = document.createElement('div');
        triggerRow.className = 'test-words-trigger-row';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'test-words-trigger';
        trigger.textContent = this._triggerLabel;

        const badge = document.createElement('span');
        badge.className = 'test-words-badge';
        badge.hidden = true;
        trigger.appendChild(badge);

        trigger.addEventListener('click', () => { void this._onTriggerClick(); });

        triggerRow.appendChild(trigger);

        const resultsBox = document.createElement('div');
        resultsBox.className = 'test-words-results';
        resultsBox.hidden = true;

        const status = document.createElement('div');
        status.className = 'test-words-status';
        status.hidden = true;

        const list = document.createElement('div');
        list.className = 'test-words-list';

        const actions = document.createElement('div');
        actions.className = 'test-words-actions';

        const addBtn = document.createElement('button');
        addBtn.type = 'button';
        addBtn.className = 'test-words-add-selected';
        addBtn.textContent = 'Add selected';
        addBtn.disabled = true;
        addBtn.addEventListener('click', () => { void this._onAddSelectedClick(); });
        actions.appendChild(addBtn);

        resultsBox.appendChild(status);
        resultsBox.appendChild(list);
        resultsBox.appendChild(actions);

        wrapper.appendChild(triggerRow);
        wrapper.appendChild(resultsBox);

        this._container.appendChild(wrapper);

        this._triggerButton = trigger;
        this._badge = badge;
        this._resultsBox = resultsBox;
        this._statusEl = status;
        this._listEl = list;
        this._addSelectedButton = addBtn;
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
            this._setStatus('Failed to read source text.', true);
            return;
        }
        text = (text || '').trim();
        if (text.length === 0) {
            this._setStatus(this._noTextLabel, true);
            this._showResults(true);
            return;
        }
        this._setBusy(true);
        this._setStatus('Checking…', false);
        this._showResults(true);
        this._clearList();
        try {
            const result = await this._display.application.api.lexiconAnalyzeText(text);
            this._renderWords(result.newWords);
            this._setBadge(result.newWords.length);
            if (result.newWords.length === 0) {
                this._setStatus(this._emptyLabel, false);
            } else {
                this._setStatus(this._formatSourceLabel(result.source, result.newWords.length), false);
            }
        } catch (e) {
            log.error(e);
            const status = this._readStatusCode(e);
            if (status === 503) {
                this._setStatus('Anki-Conf has no connection to the language server. Try again later.', true);
            } else {
                this._setStatus('Anki-Conf request failed.', true);
            }
        } finally {
            this._setBusy(false);
        }
    }

    /**
     * @param {string[]} words
     */
    _renderWords(words) {
        const list = this._listEl;
        if (list === null) { return; }
        list.replaceChildren();
        for (const word of words) {
            const row = document.createElement('label');
            row.className = 'test-words-item';
            if (this._addedWords.has(word)) { row.classList.add('added'); }
            const cb = document.createElement('input');
            cb.type = 'checkbox';
            cb.className = 'test-words-checkbox';
            cb.dataset.word = word;
            cb.disabled = this._addedWords.has(word);
            cb.addEventListener('change', () => this._updateAddSelectedEnabled());
            const label = document.createElement('span');
            label.className = 'test-words-word';
            label.textContent = word;
            row.appendChild(cb);
            row.appendChild(label);
            list.appendChild(row);
        }
        this._updateAddSelectedEnabled();
    }

    /** */
    async _onAddSelectedClick() {
        if (this._busy || this._listEl === null) { return; }
        const selected = [];
        for (const cb of this._listEl.querySelectorAll('input.test-words-checkbox:checked')) {
            const word = /** @type {HTMLInputElement} */ (cb).dataset.word;
            if (typeof word === 'string' && word.length > 0 && !this._addedWords.has(word)) {
                selected.push(word);
            }
        }
        if (selected.length === 0) { return; }

        this._setBusy(true);
        this._setStatus(`Adding ${selected.length}…`, false);
        let added = 0;
        let failed = 0;
        for (const word of selected) {
            try {
                await this._display.application.api.lexiconAddKnownWord(word, 'yomitan');
                this._addedWords.add(word);
                added++;
                this._markAddedInList(word);
            } catch (e) {
                log.error(e);
                failed++;
            }
        }
        if (failed === 0) {
            this._setStatus(`Added ${added}.`, false);
        } else {
            this._setStatus(`Added ${added}, failed ${failed}.`, true);
        }
        this._updateAddSelectedEnabled();
        this._setBusy(false);
    }

    /**
     * @param {string} word
     */
    _markAddedInList(word) {
        if (this._listEl === null) { return; }
        const escaped = word.replace(/"/g, '\\"');
        const cb = /** @type {HTMLInputElement | null} */ (this._listEl.querySelector(`input.test-words-checkbox[data-word="${escaped}"]`));
        if (cb === null) { return; }
        cb.checked = false;
        cb.disabled = true;
        const row = cb.closest('.test-words-item');
        if (row !== null) { row.classList.add('added'); }
    }

    /** */
    _updateAddSelectedEnabled() {
        if (this._addSelectedButton === null || this._listEl === null) { return; }
        const anyChecked = this._listEl.querySelector('input.test-words-checkbox:checked') !== null;
        this._addSelectedButton.disabled = this._busy || !anyChecked;
    }

    /** */
    _clearList() {
        if (this._listEl !== null) { this._listEl.replaceChildren(); }
        this._updateAddSelectedEnabled();
    }

    /**
     * @param {boolean} visible
     */
    _showResults(visible) {
        if (this._resultsBox !== null) { this._resultsBox.hidden = !visible; }
    }

    /**
     * @param {string} text
     * @param {boolean} isError
     */
    _setStatus(text, isError) {
        if (this._statusEl === null) { return; }
        this._statusEl.textContent = text;
        this._statusEl.classList.toggle('error', isError);
        this._statusEl.hidden = text.length === 0;
    }

    /**
     * @param {number} count
     */
    _setBadge(count) {
        if (this._badge === null) { return; }
        if (count > 0) {
            this._badge.textContent = String(count);
            this._badge.hidden = false;
        } else {
            this._badge.textContent = '';
            this._badge.hidden = true;
        }
    }

    /**
     * @param {boolean} busy
     */
    _setBusy(busy) {
        this._busy = busy;
        if (this._triggerButton !== null) { this._triggerButton.disabled = busy; }
        this._updateAddSelectedEnabled();
    }

    /**
     * @param {string} source
     * @param {number} count
     * @returns {string}
     */
    _formatSourceLabel(source, count) {
        const base = `${count} new word${count === 1 ? '' : 's'}`;
        if (source === 'regex') { return `${base} (offline fallback)`; }
        return base;
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
