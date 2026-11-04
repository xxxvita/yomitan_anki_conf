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

import {PopupMenu} from '../dom/popup-menu.js';
import {querySelectorNotNull} from '../dom/query-selector.js';
import {createIcon} from './flib-icons.js';

/*
 * «Статья 1 из N ▾» в верхней панели карточки (макет flib-states.jsx,
 * EntryNav): какая статья текущая и меню всех статей выдачи — слово и часть
 * речи. Выбор делает статью текущей тем же путём, что Alt+↓ и полоса
 * (Display.moveCurrentEntry): свёрнутая «Ещё N статей» раскрывается сама.
 */

/**
 * @typedef {{index: number, word: string, detail: string, current: boolean}} EntryNavItem
 */

/**
 * @param {import('dictionary').DictionaryEntry[]} entries
 * @param {number} selectedIndex
 * @returns {EntryNavItem[]}
 */
export function getEntryNavItems(entries, selectedIndex) {
    return entries.map((entry, index) => {
        const current = index === selectedIndex;
        if (entry.type === 'kanji') { return {index, word: entry.character, detail: '', current}; }
        const headword = entry.headwords[0];
        return {index, word: headword?.term ?? '', detail: headword?.wordClasses?.[0] ?? '', current};
    });
}

export class DisplayEntryNav {
    /**
     * @param {import('./display.js').Display} display
     * @param {object} details
     * @param {() => ?HTMLElement} details.getToolbar The card's top toolbar (popup-toolbar.js).
     * @param {(anchor: HTMLElement, items: EntryNavItem[], onSelect: (index: number) => void) => void} details.openMenu
     */
    constructor(display, {getToolbar, openMenu}) {
        /** @type {import('./display.js').Display} */
        this._display = display;
        /** @type {() => ?HTMLElement} */
        this._getToolbar = getToolbar;
        /** @type {(anchor: HTMLElement, items: EntryNavItem[], onSelect: (index: number) => void) => void} */
        this._openMenu = openMenu;
        /** @type {?HTMLButtonElement} */
        this._button = null;
        /** @type {boolean} */
        this._active = false;
    }

    /** */
    prepare() {
        this._display.on('contentClear', () => { this._setActive(false); });
        this._display.on('contentUpdateComplete', ({type}) => {
            this._setActive(type === 'terms' && this._display.dictionaryEntries.length > 1);
        });
        this._display.on('currentEntryChanged', () => { this._updateLabel(); });
    }

    /**
     * @param {boolean} active
     */
    _setActive(active) {
        this._active = active;
        if (!active) {
            if (this._button !== null) { this._button.hidden = true; }
            return;
        }
        const button = this._ensureButton();
        if (button === null) { return; }
        button.hidden = false;
        // Open the bar ourselves (as DisplayTranslation does): its other buttons
        // (check-words) must not be what keeps the entry menu visible.
        const toolbar = button.parentElement;
        if (toolbar !== null) { toolbar.hidden = false; }
        this._updateLabel();
    }

    /** @returns {?HTMLButtonElement} */
    _ensureButton() {
        const toolbar = this._getToolbar();
        if (toolbar === null) { return null; }
        if (this._button === null) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'fc-btn fc-entry-nav';
            button.setAttribute('aria-haspopup', 'menu');
            button.title = 'Переход между статьями (Alt+↑/↓)';
            button.addEventListener('click', () => { this._onClick(); });
            this._button = button;
        }
        if (this._button.parentElement !== toolbar || toolbar.firstElementChild !== this._button) {
            toolbar.prepend(this._button);
        }
        return this._button;
    }

    /** */
    _updateLabel() {
        const button = this._button;
        if (button === null || !this._active) { return; }
        const n = this._display.dictionaryEntries.length;
        // «Статья » hides in a narrow card (flib-card.css), «1 из 3» stays.
        const kind = document.createElement('span');
        kind.className = 'fc-entry-nav-k';
        kind.textContent = 'Статья ';
        const label = document.createElement('span');
        label.textContent = `${this._display.selectedIndex + 1} из ${n}`;
        button.setAttribute('aria-label', `Статья ${this._display.selectedIndex + 1} из ${n}`);
        button.replaceChildren(kind, label, createIcon('chev'));
    }

    /** */
    _onClick() {
        const button = this._button;
        if (button === null) { return; }
        const items = getEntryNavItems(this._display.dictionaryEntries, this._display.selectedIndex);
        this._openMenu(button, items, (index) => {
            this._display.moveCurrentEntry(index - this._display.selectedIndex);
        });
    }
}

/**
 * The real menu: Yomitan's PopupMenu with the entry-menu templates (as the «⋯»
 * and «В Anki» menus), anchored to the button.
 * @param {import('./display.js').Display} display
 * @returns {(anchor: HTMLElement, items: EntryNavItem[], onSelect: (index: number) => void) => void}
 */
export function createEntryNavMenuOpener(display) {
    return (anchor, items, onSelect) => {
        /** @type {HTMLElement} */
        const container = display.displayGenerator.instantiateTemplate('dictionary-entry-popup-menu');
        container.classList.add('fc-entry-nav-menu');
        /** @type {HTMLElement} */
        const body = querySelectorNotNull(container, '.popup-menu-body');
        for (const {index, word, detail, current} of items) {
            /** @type {HTMLElement} */
            const item = display.displayGenerator.instantiateTemplate('dictionary-entry-popup-menu-item');
            /** @type {HTMLElement} */
            const label = querySelectorNotNull(item, '.popup-menu-item-label');
            label.textContent = word;
            if (detail.length > 0) {
                const tag = document.createElement('span');
                tag.className = 'fc-entry-nav-pos';
                tag.textContent = detail;
                label.append(' ', tag);
            }
            if (current) { item.setAttribute('aria-current', 'true'); }
            item.dataset.menuAction = `entry:${index}`;
            body.appendChild(item);
        }
        /** @param {import('popup-menu').MenuCloseEvent} e */
        const onClose = (e) => {
            anchor.removeEventListener('menuClose', /** @type {EventListener} */ (/** @type {unknown} */ (onClose)));
            const match = /^entry:(\d+)$/.exec(e.detail.action ?? '');
            if (match !== null) { onSelect(Number(match[1])); }
        };
        anchor.addEventListener('menuClose', /** @type {EventListener} */ (/** @type {unknown} */ (onClose)));
        querySelectorNotNull(document, '#popup-menus').appendChild(container);
        new PopupMenu(anchor, container).prepare();
    };
}
