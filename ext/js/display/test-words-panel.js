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
import {pluralRu} from './anki-card-ui.js';
import {createIcon} from './flib-icons.js';

/**
 * Toolbar element pair that drives the "test words against Anki-Conf" feature:
 *
 *   ┌───────────────────────────────────────────────────────────────────────┐
 *   │ [ Test words ]  [ 12 new ]    (rendered inside `hostElement`)         │
 *   └───────────────────────────────────────────────────────────────────────┘
 *
 *   - "Test words" calls the lexicon analyze endpoint with the text returned
 *     by `getTextSource()` and reveals the count badge.
 *   - The count badge is itself a button; clicking it opens the dialog
 *     «Отметьте знакомые слова» (card redesign stage 6, mock
 *     `flib-checkwords.jsx`): a checklist of new words. Ticks stay local until
 *     «Сохранить»; then each ticked word is POSTed to known-words one by one.
 *     «Отмена» / Esc / × write nothing. A failed write keeps that word (and
 *     the rest) ticked with an error line; written words leave the list, so a
 *     retry sends only the rest.
 */
export class TestWordsController {
    /**
     * @param {object} options
     * @param {import('./display.js').Display} options.display
     * @param {HTMLElement} options.hostElement
     * @param {() => (string | Promise<string>)} options.getTextSource
     * @param {string} [options.triggerLabel]
     * @param {string} [options.triggerTitle]
     * @param {string} [options.sourceLabel] Caption of the source block: «Фраза», «Текст из буфера обмена».
     */
    constructor({display, hostElement, getTextSource, triggerLabel, triggerTitle, sourceLabel}) {
        /** @type {import('./display.js').Display} */
        this._display = display;
        /** @type {HTMLElement} */
        this._hostElement = hostElement;
        /** @type {() => (string | Promise<string>)} */
        this._getTextSource = getTextSource;
        /** @type {string} */
        this._triggerLabel = typeof triggerLabel === 'string' ? triggerLabel : 'Test words';
        /** @type {string} */
        this._triggerTitle = typeof triggerTitle === 'string' ? triggerTitle : '';
        /** @type {string} */
        this._sourceLabel = typeof sourceLabel === 'string' ? sourceLabel : 'Текст';
        /** @type {string} Text of the last analysis (shown in the dialog). */
        this._lastText = '';
        /** @type {Map<string, string>} word → lemma, only where they differ. */
        this._lemmas = new Map();
        /** @type {boolean} A save is in flight. */
        this._saving = false;
        /** @type {?{written: number, left: number}} Set after a full save: the dialog shows «Готово». */
        this._doneSummary = null;
        /** @type {?HTMLElement} */
        this._modalDialogEl = null;
        /** @type {string[]} Words written by the last full save — «Вернуть в новые» revokes them. */
        this._lastWritten = [];
        /** @type {number} Bumped by every analysis: a save from an older one must not touch the new dialog. */
        this._analysisGeneration = 0;
        /** @type {?(ev: KeyboardEvent) => void} Tab stays inside the dialog. */
        this._modalTabHandler = null;
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
        /** @type {boolean} */
        this._available = true;
        /** @type {string} */
        this._unavailableTitle = '';
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
        if (this._triggerTitle.length > 0) { trigger.title = this._triggerTitle; }
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
        this._applyTriggerState();
    }

    /**
     * Enable/disable the trigger depending on whether the backing service
     * (anki_conf Core) is reachable. Safe to call before render().
     * @param {boolean} available
     * @param {string} [unavailableTitle] Tooltip explaining why it is disabled.
     */
    setAvailable(available, unavailableTitle = '') {
        this._available = available;
        this._unavailableTitle = unavailableTitle;
        this._applyTriggerState();
    }

    // Private

    /** */
    async _onTriggerClick() {
        // ⚠️ Not during a save: the save loop updates `_lastNewWords` / the summary.
        if (this._busy || this._saving || !this._available || this._triggerButton === null) { return; }
        let text = '';
        try {
            text = await this._getTextSource();
        } catch (e) {
            log.error(e);
            this._flashTrigger('Буфер не прочитать', true);
            return;
        }
        text = typeof text === 'string' ? text.trim() : '';
        if (text.length === 0) {
            this._flashTrigger('Буфер пуст', true);
            this._updateCountButton([], 'empty');
            return;
        }
        this._setBusy(true);
        const previousLabel = this._triggerButton.textContent;
        this._triggerButton.textContent = 'Проверяю…';
        try {
            const result = await this._display.application.api.lexiconAnalyzeText(text);
            this._lastNewWords = [...new Set(result.newWords)];
            this._lastSource = result.source;
            this._lastText = text;
            this._lemmas.clear();
            for (const entry of Array.isArray(result.entries) ? result.entries : []) {
                if (typeof entry?.word === 'string' && typeof entry.lemma === 'string' && entry.lemma !== '' && entry.lemma !== entry.word) {
                    this._lemmas.set(entry.word, entry.lemma);
                }
            }
            this._known.clear();
            this._doneSummary = null;
            this._lastWritten = [];
            ++this._analysisGeneration;
            this._updateCountButton(this._lastNewWords, result.source);
            if (this._modalOverlay !== null) {
                this._rebuildModalList();
            }
        } catch (e) {
            log.error(e);
            const status = this._readStatusCode(e);
            this._flashTrigger(status === 503 ? 'Flibooster не запущен' : 'Не получилось', true);
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
        // regex — анализ без Flibooster (грубее); это видно в подсказке, а не в подписи.
        this._countButton.textContent = `Новые слова ${words.length}`;
        this._countButton.title = source === 'regex' ? 'Без Flibooster: проверка по простым правилам' : 'Отметить знакомые слова';
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
        overlay.className = 'test-words-modal-overlay fc-cw-overlay';

        const dialog = document.createElement('div');
        dialog.className = 'fc-cw';
        dialog.setAttribute('role', 'dialog');
        dialog.setAttribute('aria-modal', 'true');
        dialog.setAttribute('aria-labelledby', 'fc-cw-title');
        dialog.tabIndex = -1;

        const header = document.createElement('div');
        header.className = 'fc-cw-h';
        const title = document.createElement('b');
        title.id = 'fc-cw-title';
        title.textContent = 'Отметьте знакомые слова';
        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'fc-btn fc-btn-ghost fc-btn-ico fc-cw-close';
        closeBtn.setAttribute('aria-label', 'Закрыть');
        closeBtn.title = 'Закрыть (Esc)';
        closeBtn.appendChild(createIcon('x'));
        header.append(title, closeBtn);

        const body = document.createElement('div');
        body.className = 'fc-cw-b';
        const footer = document.createElement('div');
        footer.className = 'fc-cw-f';

        dialog.append(header, body, footer);
        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        const onClose = () => this._closeModal();
        closeBtn.addEventListener('click', onClose);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) { onClose(); }
        });
        // ⚠️ Capture phase + stopPropagation: the popup's HotkeyHandler listens on
        // document too and maps Escape to «close popup» — Esc must close only the dialog.
        const escHandler = (/** @type {KeyboardEvent} */ ev) => {
            if (ev.key === 'Escape') {
                ev.preventDefault();
                ev.stopPropagation();
                onClose();
            } else if (ev.key === 'Tab') {
                this._trapTab(ev);
            }
        };
        document.addEventListener('keydown', escHandler, true);

        this._modalOverlay = overlay;
        this._modalDialogEl = dialog;
        this._modalEscHandler = escHandler;
        this._modalListEl = body;
        this._modalStatusEl = null;
        this._rebuildModalList();
        setTimeout(() => dialog.focus(), 0);
    }

    /** Ticks are discarded on close: «Отмена» writes nothing. */
    _closeModal() {
        if (this._modalOverlay === null) { return; }
        this._modalOverlay.remove();
        this._modalOverlay = null;
        this._modalDialogEl = null;
        this._modalListEl = null;
        this._modalStatusEl = null;
        if (!this._saving) { this._known.clear(); }
        this._doneSummary = null;
        if (typeof this._modalEscHandler === 'function') {
            document.removeEventListener('keydown', this._modalEscHandler, true);
            this._modalEscHandler = null;
        }
        const count = this._countButton;
        if (count !== null && count.isConnected && !count.hidden) {
            count.focus();
        } else if (this._triggerButton !== null && this._triggerButton.isConnected) {
            this._triggerButton.focus();
        }
    }

    /**
     * Keeps Tab / Shift+Tab inside the dialog (it is aria-modal).
     * @param {KeyboardEvent} ev
     */
    _trapTab(ev) {
        const dialog = this._modalDialogEl;
        if (dialog === null) { return; }
        const focusable = [...dialog.querySelectorAll('button:not([disabled])')].filter((e) => e instanceof HTMLElement);
        if (focusable.length === 0) { return; }
        const first = /** @type {HTMLElement} */ (focusable[0]);
        const last = /** @type {HTMLElement} */ (focusable[focusable.length - 1]);
        const active = document.activeElement;
        if (ev.shiftKey && (active === first || !dialog.contains(active))) {
            ev.preventDefault();
            last.focus();
        } else if (!ev.shiftKey && (active === last || !dialog.contains(active))) {
            ev.preventDefault();
            first.focus();
        }
    }

    /** Renders the dialog body and footer from `_lastNewWords` / `_known` / `_doneSummary`. */
    _rebuildModalList() {
        const body = this._modalListEl;
        const dialog = this._modalDialogEl;
        if (!(body instanceof HTMLElement) || !(dialog instanceof HTMLElement)) { return; }
        const footer = /** @type {?HTMLElement} */ (dialog.querySelector(':scope>.fc-cw-f'));
        body.replaceChildren();
        if (footer !== null) { footer.replaceChildren(); }

        if (this._doneSummary !== null) {
            body.appendChild(this._createDoneView(this._doneSummary));
            if (footer !== null) { footer.hidden = true; }
            return;
        }

        const words = this._lastNewWords;
        const src = document.createElement('div');
        src.className = 'fc-cw-src';
        const k = document.createElement('div');
        k.className = 'fc-cw-k';
        const length = this._lastText.length;
        k.textContent = `${this._sourceLabel} · ${length} ${pluralRu(length, 'символ', 'символа', 'символов')}`;
        const p = document.createElement('p');
        p.textContent = this._lastText;
        src.append(k, p);
        body.appendChild(src);

        const head = document.createElement('div');
        head.className = 'fc-cw-lh';
        const count = document.createElement('span');
        count.textContent = `Новые слова · ${words.length}`;
        const allOn = words.length > 0 && words.every((w) => this._known.has(w));
        const all = document.createElement('button');
        all.type = 'button';
        all.className = 'fc-cw-all';
        all.setAttribute('role', 'checkbox');
        all.setAttribute('aria-checked', allOn ? 'true' : 'false');
        all.append(this._createCheckbox(allOn), 'Знаю все');
        all.addEventListener('click', () => {
            if (this._saving) { return; }
            if (allOn) {
                this._known.clear();
            } else {
                for (const w of words) { this._known.add(w); }
            }
            this._rebuildModalList();
        });
        head.append(count, all);
        body.appendChild(head);

        const list = document.createElement('ul');
        list.className = 'fc-cw-list';
        for (const word of words) {
            const on = this._known.has(word);
            const li = document.createElement('li');
            li.classList.toggle('fc-on', on);
            const row = document.createElement('button');
            row.type = 'button';
            row.className = 'fc-cw-row';
            row.setAttribute('role', 'checkbox');
            row.setAttribute('aria-checked', on ? 'true' : 'false');
            row.dataset.word = word;
            row.disabled = this._saving;
            const text = document.createElement('span');
            text.className = 'fc-cw-w';
            const b = document.createElement('b');
            b.textContent = word;
            text.appendChild(b);
            const lemma = this._lemmas.get(word);
            if (typeof lemma === 'string') {
                const fm = document.createElement('span');
                fm.className = 'fc-cw-fm';
                fm.textContent = `${word} ← ${lemma}`;
                text.appendChild(fm);
            }
            const st = document.createElement('span');
            st.className = 'fc-cw-st';
            st.textContent = on ? 'знаю' : 'новое';
            row.append(this._createCheckbox(on), text, st);
            row.addEventListener('click', () => {
                if (this._saving) { return; }
                if (this._known.has(word)) {
                    this._known.delete(word);
                } else {
                    this._known.add(word);
                }
                this._rebuildModalList();
            });
            li.appendChild(row);
            list.appendChild(li);
        }
        body.appendChild(list);

        if (footer === null) { return; }
        footer.hidden = false;
        const hint = document.createElement('span');
        hint.className = 'fc-cw-t';
        hint.textContent = this._lastSource === 'regex' ?
            'Без Flibooster: слова найдены по простым правилам. Знакомые слова больше не будут показываться как новые.' :
            'Знакомые слова больше не будут показываться как новые.';
        const status = document.createElement('span');
        status.className = 'fc-cw-status';
        status.setAttribute('role', 'status');
        status.hidden = true;
        const buttons = document.createElement('div');
        buttons.className = 'fc-cw-row-btns';
        const cancel = document.createElement('button');
        cancel.type = 'button';
        cancel.className = 'fc-btn fc-cw-cancel';
        cancel.textContent = 'Отмена';
        cancel.addEventListener('click', () => this._closeModal());
        const save = document.createElement('button');
        save.type = 'button';
        save.className = 'fc-btn fc-btn-acc fc-cw-save';
        const n = this._known.size;
        save.textContent = n > 0 ? `Сохранить · ${n} ${pluralRu(n, 'знакомое', 'знакомых', 'знакомых')}` : 'Все новые — сохранить';
        save.disabled = this._saving;
        save.addEventListener('click', () => { void this._onSave(); });
        buttons.append(cancel, save);
        footer.append(hint, status, buttons);
        this._modalStatusEl = status;
    }

    /**
     * Writes the ticked words one by one. Stops at the first failure: the words
     * written so far leave the list, the failed one and the rest stay ticked.
     */
    async _onSave() {
        if (this._saving || this._busy) { return; }
        const generation = this._analysisGeneration;
        const ticked = this._lastNewWords.filter((w) => this._known.has(w));
        const leftAfter = this._lastNewWords.length - ticked.length;
        this._saving = true;
        this._rebuildModalList();
        /** @type {?unknown} */
        let failure = null;
        let failedWord = '';
        let written = 0;
        try {
            for (const word of ticked) {
                try {
                    await this._display.application.api.lexiconAddKnownWord(word, 'yomitan');
                } catch (e) {
                    failure = e;
                    failedWord = word;
                    break;
                }
                ++written;
                this._known.delete(word);
                this._lastNewWords = this._lastNewWords.filter((w) => w !== word);
            }
        } finally {
            this._saving = false;
        }
        this._updateCountButton(this._lastNewWords, this._lastSource);
        // Closed mid-save: «Отмена» promised no ticks left behind.
        if (this._modalOverlay === null) {
            this._known.clear();
            return;
        }
        if (generation !== this._analysisGeneration) { return; }
        if (failure !== null) {
            log.error(failure);
            this._rebuildModalList();
            const status = this._readStatusCode(failure);
            const prefix = written > 0 ? `Сохранено ${written} из ${ticked.length}. ` : '';
            this._setModalStatus(status === 503 ?
                `${prefix}Flibooster не отвечает — «${failedWord}» и остальные не сохранены.` :
                `${prefix}Не удалось сохранить «${failedWord}».`, true);
            return;
        }
        this._lastWritten = ticked;
        this._doneSummary = {written, left: leftAfter};
        this._rebuildModalList();
    }

    /**
     * «Вернуть в новые»: revokes the words written by the last save, one by one.
     * Revoked words go back to the list (in the analysis order is not kept —
     * they are appended); on a failure the rest stay known and an error shows.
     */
    async _onUndo() {
        if (this._saving || this._lastWritten.length === 0) { return; }
        const words = this._lastWritten;
        this._saving = true;
        /** @type {?unknown} */
        let failure = null;
        /** @type {string[]} */
        const revoked = [];
        try {
            for (const word of words) {
                try {
                    await this._display.application.api.lexiconRemoveKnownWord(word);
                } catch (e) {
                    failure = e;
                    break;
                }
                revoked.push(word);
                if (!this._lastNewWords.includes(word)) { this._lastNewWords = [...this._lastNewWords, word]; }
            }
        } finally {
            this._saving = false;
        }
        this._lastWritten = words.filter((w) => !revoked.includes(w));
        this._updateCountButton(this._lastNewWords, this._lastSource);
        if (this._modalOverlay === null) { return; }
        if (failure !== null) {
            log.error(failure);
            const status = this._readStatusCode(failure);
            const view = this._modalListEl?.querySelector('.fc-cw-done>p');
            if (view instanceof HTMLElement) {
                view.textContent = status === 503 ?
                    'Flibooster не отвечает — слова не вернулись в новые.' :
                    `Вернуть удалось ${revoked.length} из ${words.length}.`;
            }
            return;
        }
        this._doneSummary = null;
        this._rebuildModalList();
    }

    /**
     * @param {{written: number, left: number}} summary
     * @returns {HTMLElement}
     */
    _createDoneView({written, left}) {
        const view = document.createElement('div');
        view.className = 'fc-cw-done';
        view.setAttribute('role', 'status');
        const ic = document.createElement('span');
        ic.className = 'fc-cw-done-ic';
        ic.appendChild(createIcon('check', {strokeWidth: 2.4}));
        const b = document.createElement('b');
        b.textContent = 'Готово';
        const p = document.createElement('p');
        const parts = [];
        if (written > 0) { parts.push(`${written} ${pluralRu(written, 'слово отмечено знакомым', 'слова отмечены знакомыми', 'слов отмечено знакомыми')}.`); }
        parts.push(left > 0 ?
            `${left} ${pluralRu(left, 'слово осталось', 'слова остались', 'слов остались')} в списке новых во Flibooster.` :
            'Новых слов в тексте не осталось.');
        p.textContent = parts.join(' ');
        const row = document.createElement('div');
        row.className = 'fc-cw-row-btns';
        if (written > 0) {
            const undo = document.createElement('button');
            undo.type = 'button';
            undo.className = 'fc-btn fc-cw-undo';
            undo.textContent = 'Вернуть в новые';
            undo.title = 'Снять отметку «знакомое» с только что сохранённых слов';
            undo.addEventListener('click', () => { void this._onUndo(); });
            row.appendChild(undo);
        }
        const close = document.createElement('button');
        close.type = 'button';
        close.className = 'fc-btn fc-btn-acc';
        close.textContent = 'Закрыть';
        close.addEventListener('click', () => this._closeModal());
        row.appendChild(close);
        view.append(ic, b, p, row);
        return view;
    }

    /**
     * @param {boolean} on
     * @returns {HTMLElement}
     */
    _createCheckbox(on) {
        const cb = document.createElement('span');
        cb.className = on ? 'fc-cb fc-on' : 'fc-cb';
        cb.setAttribute('aria-hidden', 'true');
        if (on) { cb.appendChild(createIcon('check', {strokeWidth: 3})); }
        return cb;
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
        this._applyTriggerState();
    }

    /** */
    _applyTriggerState() {
        const trigger = this._triggerButton;
        if (trigger === null) { return; }
        trigger.disabled = this._busy || !this._available;
        const title = this._available ? this._triggerTitle : this._unavailableTitle;
        if (title.length > 0) {
            trigger.title = title;
        } else {
            trigger.removeAttribute('title');
        }
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
