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

import {countWords, pickEntryByPos} from '../data/flib-pos.js';
import {translate} from '../i18n/ui-language.js';
import {getGatewayErrorCode} from './gateway-examples-util.js';

/*
 * Кнопка «?» в левой полосе карточки, под стрелками «статья ↑/↓» (spec
 * docs/superpowers/specs/2026-11-15-pos-hint-button-design.md): часть речи
 * слова в предложении через ChatGPT шлюза и переход на подходящую статью.
 *
 * ⚠️ Ответ, пришедший после смены выдачи, ВЫБРАСЫВАЕТСЯ (`_requestId`):
 * иначе карточка нового слова прыгнула бы на статью по ответу про старое.
 * ⚠️ Ошибка шлюза НИКОГДА не выглядит как «такой статьи нет» — у Flibooster
 * выглядит, и пользователь не отличает сбой от промаха (anki_conf #388).
 */

/** @type {Readonly<Record<string, string>>} */
const ERROR_TEXT = Object.freeze({
    flib_key_missing: 'pos.keyMissing',
    flib_key_invalid: 'pos.keyInvalid',
    flib_rate_limited: 'pos.rateLimited',
    llm_bad_answer: 'pos.badAnswer',
});

export class DisplayPosHint {
    /**
     * @param {import('./display.js').Display} display
     * @param {{api: import('../comm/api.js').API}} details
     */
    constructor(display, {api}) {
        /** @type {import('./display.js').Display} */
        this._display = display;
        /** @type {import('../comm/api.js').API} */
        this._api = api;
        /** @type {?HTMLButtonElement} */
        this._button = null;
        /** @type {?HTMLElement} */
        this._label = null;
        /** @type {boolean} */
        this._busy = false;
        /** Растёт при каждой смене выдачи; ответ со старым номером выбрасывается. */
        this._requestId = 0;
        /** @type {Map<string, string>} слово + "\0" + предложение → часть речи; живёт, пока жив popup. */
        this._cache = new Map();
        /** Текст подсказки по умолчанию; результат и ошибки его заменяют до смены выдачи. */
        this._message = '';
        /**
         * ⚠️ contentClear приходит ДО очистки dictionaryEntries (как в DisplayStrip):
         * читать выдачу в этот момент нельзя, поэтому кнопка гасится флагом.
         */
        this._cleared = true;
    }

    /** */
    prepare() {
        const top = document.querySelector('.content-sidebar-top');
        if (top === null) { return; }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sidebar-button fc-strip-pos';
        button.textContent = '?';
        button.addEventListener('click', () => { void this._onClick(); });
        const label = document.createElement('span');
        label.className = 'fc-strip-pos-label';
        label.setAttribute('role', 'status');
        top.append(button, label);
        this._button = button;
        this._label = label;
        this._display.on('contentUpdateComplete', () => { this._reset(false); });
        this._display.on('contentClear', () => { this._reset(true); });
        this._display.on('optionsUpdated', () => { this._render(); });
        this._reset(true);
    }

    /**
     * Новая выдача (или её очистка): прежний ответ и запрос в полёте больше не про неё.
     * @param {boolean} cleared
     */
    _reset(cleared) {
        this._cleared = cleared;
        this._requestId += 1;
        this._busy = false;
        this._message = '';
        if (this._label !== null) { this._label.textContent = ''; }
        this._render();
    }

    /** @returns {?{word: string, sentence: string}} */
    _getQuery() {
        if (this._cleared) { return null; }
        const {dictionaryEntries, selectedIndex} = this._display;
        if (dictionaryEntries.length <= 1) { return null; }
        const state = /** @type {{sentence?: unknown} | null | undefined} */ (this._display.history.state);
        const sentenceData = state?.sentence;
        const sentence = typeof sentenceData === 'object' && sentenceData !== null ? /** @type {{text?: unknown}} */ (sentenceData).text : null;
        if (typeof sentence !== 'string' || countWords(sentence) <= 1) { return null; }
        const entry = dictionaryEntries[selectedIndex] ?? dictionaryEntries[0];
        if (entry.type !== 'term') { return null; }
        const headword = entry.headwords[0];
        // Спрашиваем ту форму, что стоит в тексте («booked»), а не заголовок статьи.
        const original = headword?.sources[0]?.originalText;
        const word = typeof original === 'string' && original.trim() !== '' ? original.trim() : (headword?.term ?? '');
        return word === '' ? null : {word, sentence: sentence.trim()};
    }

    /** */
    _render() {
        const button = this._button;
        if (button === null) { return; }
        button.disabled = this._busy || this._getQuery() === null;
        button.setAttribute('aria-busy', this._busy ? 'true' : 'false');
        const title = this._message === '' ? translate('pos.button') : this._message;
        button.title = title;
        button.setAttribute('aria-label', title);
    }

    /** */
    async _onClick() {
        if (this._busy) { return; }
        const query = this._getQuery();
        if (query === null) { return; }
        const key = `${query.word}\0${query.sentence}`;
        const cached = this._cache.get(key);
        if (typeof cached === 'string') {
            this._apply(cached);
            return;
        }
        const requestId = this._requestId;
        this._busy = true;
        this._render();
        try {
            const {pos} = await this._api.flibPosDetect(query.word, query.sentence);
            if (requestId !== this._requestId) { return; }
            this._cache.set(key, pos);
            this._apply(pos);
        } catch (e) {
            if (requestId !== this._requestId) { return; }
            this._showError(getGatewayErrorCode(e));
        } finally {
            if (requestId === this._requestId) {
                this._busy = false;
                this._render();
            }
        }
    }

    /**
     * @param {string} pos
     */
    _apply(pos) {
        const {dictionaryEntries, selectedIndex} = this._display;
        const full = translate(`pos.full.${pos}`);
        if (this._label !== null) { this._label.textContent = translate(`pos.short.${pos}`); }
        const index = pickEntryByPos(dictionaryEntries, pos, selectedIndex);
        this._message = index < 0 ? translate('pos.noEntry', {pos: full}) : full;
        this._render();
        if (index >= 0 && index !== selectedIndex) {
            this._display.moveCurrentEntry(index - selectedIndex);
        }
    }

    /**
     * @param {?string} code
     */
    _showError(code) {
        if (this._label !== null) { this._label.textContent = ''; }
        if (code === 'llm_quota_exhausted') {
            this._message = `${translate('pos.quota')}. ${translate('pos.quotaLink')}`;
        } else {
            const key = code !== null && Object.hasOwn(ERROR_TEXT, code) ? ERROR_TEXT[code] : 'pos.unavailable';
            this._message = translate(key);
        }
        this._render();
    }
}
