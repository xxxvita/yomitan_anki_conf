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

import {pluralRu} from './anki-card-ui.js';

/*
 * Страница поиска Flib-club (макет flib-search.jsx): строка «Результаты для
 * «googling» · 3 статьи» над статьями. Только для слов (terms) с результатами:
 * у пустой выдачи свой блок «Ничего не нашлось», у фразы — своя карточка.
 */
export class SearchResultsMeta {
    /**
     * @param {import('./display.js').Display} display
     */
    constructor(display) {
        /** @type {import('./display.js').Display} */
        this._display = display;
        /** @type {?HTMLElement} */
        this._element = null;
    }

    /** */
    prepare() {
        this._display.on('contentUpdateComplete', () => { this._update(); });
        // ⚠️ contentClear приходит ДО очистки dictionaryEntries — читать их нельзя.
        this._display.on('contentClear', () => { this._setText(null); });
    }

    /** */
    _update() {
        const count = this._display.dictionaryEntries.length;
        const query = this._display.query.trim();
        if (this._display.contentType !== 'terms' || count === 0 || query.length === 0) {
            this._setText(null);
            return;
        }
        this._setText(`Результаты для «${query}» · ${count} ${pluralRu(count, 'статья', 'статьи', 'статей')}`);
    }

    /**
     * @param {?string} text null — спрятать.
     */
    _setText(text) {
        if (text === null) {
            if (this._element !== null) { this._element.hidden = true; }
            return;
        }
        const element = this._ensureElement();
        if (element === null) { return; }
        element.textContent = text;
        element.title = text;
        element.hidden = false;
    }

    /**
     * @returns {?HTMLElement}
     */
    _ensureElement() {
        if (this._element !== null && this._element.isConnected) { return this._element; }
        const entries = document.getElementById('dictionary-entries');
        if (entries === null || entries.parentElement === null) { return null; }
        const element = document.createElement('div');
        element.className = 'fc-sp-meta';
        element.setAttribute('role', 'status');
        entries.parentElement.insertBefore(element, entries);
        this._element = element;
        return element;
    }
}
