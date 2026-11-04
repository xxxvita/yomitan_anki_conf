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
import {createIcon} from './flib-icons.js';

/*
 * «Ещё N статей» карточки Flib-club (макет flib-states.jsx, MoreEntries).
 * Главное слово — у первой статьи (переводчик ставит самое длинное совпадение
 * первым: «call it a day» раньше «call it» и «call»). Сворачиваются только
 * БОЛЕЕ КОРОТКИЕ совпадения (maxOriginalTextLength меньше, чем у первой):
 * словоформа той же длины — «saw» → see, «left» → leave — это другое прочтение
 * того же текста, а не «ещё одно слово», и остаётся на виду. Свёрнутые
 * сворачиваются в строку «Ещё 2 статьи: call it (1) · call (1)» с «Показать»;
 * раскрытые — с «Свернуть». Переход на свёрнутую статью (Alt+↓, полоса)
 * раскрывает группу: счётчик полосы считает и свёрнутые.
 */

/**
 * @param {import('dictionary').DictionaryEntry|undefined} entry
 * @returns {?string} Слово статьи в нижнем регистре; null — не словарная статья.
 */
function getTermKey(entry) {
    if (typeof entry !== 'object' || entry === null || entry.type !== 'term') { return null; }
    const term = entry.headwords[0]?.term;
    return typeof term === 'string' ? term.toLowerCase() : null;
}

/**
 * @param {import('dictionary').DictionaryEntry|undefined} entry
 * @returns {number} How much of the scanned text the entry matched (NaN if unknown: never folded).
 */
function getMatchedLength(entry) {
    if (typeof entry !== 'object' || entry === null || entry.type !== 'term') { return Number.NaN; }
    return typeof entry.maxOriginalTextLength === 'number' ? entry.maxOriginalTextLength : Number.NaN;
}

/**
 * @param {import('dictionary').DictionaryEntry[]} entries
 * @returns {{more: number[], groups: {word: string, count: number}[]}} Индексы
 *   сворачиваемых статей и их слова в порядке появления.
 */
export function groupMoreEntries(entries) {
    /** @type {number[]} */
    const more = [];
    /** @type {Map<string, {word: string, count: number}>} */
    const groups = new Map();
    const primary = getTermKey(entries[0]);
    if (primary === null) { return {more, groups: []}; }
    const primaryLength = getMatchedLength(entries[0]);
    for (let i = 1; i < entries.length; ++i) {
        const key = getTermKey(entries[i]);
        const length = getMatchedLength(entries[i]);
        // Unknown lengths never fold; the same length is another reading, not a shorter match.
        if (key === null || key === primary || Number.isNaN(length) || Number.isNaN(primaryLength) || length >= primaryLength) { continue; }
        more.push(i);
        const group = groups.get(key);
        if (typeof group === 'undefined') {
            const term = /** @type {import('dictionary').TermDictionaryEntry} */ (entries[i]).headwords[0].term;
            groups.set(key, {word: term, count: 1});
        } else {
            ++group.count;
        }
    }
    return {more, groups: [...groups.values()]};
}

export class DisplayMoreEntries {
    /**
     * @param {import('./display.js').Display} display
     * @param {HTMLElement} container `#dictionary-entries`.
     */
    constructor(display, container) {
        /** @type {import('./display.js').Display} */
        this._display = display;
        /** @type {HTMLElement} */
        this._container = container;
        /** @type {HTMLElement[]} */
        this._hiddenNodes = [];
        /** @type {{word: string, count: number}[]} */
        this._groups = [];
        /** @type {?HTMLElement} */
        this._line = null;
        /** @type {boolean} */
        this._expanded = false;
    }

    /** */
    prepare() {
        this._display.on('contentClear', () => { this._reset(); });
        // Only word results: a phrase card or a kanji result is never folded.
        this._display.on('contentUpdateComplete', ({type}) => {
            if (type === 'terms') {
                this._apply();
            } else {
                this._reset();
            }
        });
        this._display.on('currentEntryChanged', ({index}) => {
            const node = this._display.dictionaryEntryNodes[index];
            if (!this._expanded && typeof node !== 'undefined' && this._hiddenNodes.includes(node)) { this._setExpanded(true); }
        });
    }

    /** */
    _reset() {
        this._line?.remove();
        this._line = null;
        this._hiddenNodes = [];
        this._groups = [];
        this._expanded = false;
    }

    /** */
    _apply() {
        this._reset();
        const nodes = this._display.dictionaryEntryNodes;
        const {more, groups} = groupMoreEntries(this._display.dictionaryEntries);
        this._hiddenNodes = more.map((i) => nodes[i]).filter((node) => typeof node !== 'undefined');
        if (this._hiddenNodes.length === 0) { return; }
        this._groups = groups;
        this._line = document.createElement('div');
        this._line.className = 'fc-more scan-disable';
        this._container.appendChild(this._line);
        // History restore («Назад») may already have made a folded entry current
        // (_focusEntry runs before contentUpdateComplete): then stay open.
        this._setExpanded(this._isCurrentFolded());
    }

    /** @returns {boolean} The current entry is one of the foldable ones. */
    _isCurrentFolded() {
        const node = this._display.dictionaryEntryNodes[this._display.selectedIndex];
        return typeof node !== 'undefined' && this._hiddenNodes.includes(node);
    }

    /**
     * @param {boolean} expanded
     */
    _setExpanded(expanded) {
        this._expanded = expanded;
        for (const node of this._hiddenNodes) { node.hidden = !expanded; }
        const line = this._line;
        if (line === null) { return; }
        line.replaceChildren();
        line.dataset.expanded = `${expanded}`;
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'fc-btn fc-btn-ghost fc-more-btn';
        if (expanded) {
            button.append(createIcon('up'), 'Свернуть');
        } else {
            const n = this._hiddenNodes.length;
            const text = document.createElement('span');
            text.className = 'fc-more-t';
            const head = document.createElement('b');
            head.textContent = `Ещё ${n} ${pluralRu(n, 'статья', 'статьи', 'статей')}`;
            const list = document.createElement('span');
            list.textContent = this._groups.map(({word, count}) => `${word} (${count})`).join(' · ');
            text.append(head, list);
            line.appendChild(text);
            button.textContent = 'Показать';
        }
        button.addEventListener('click', () => {
            this._setExpanded(!expanded);
            // Folding the current entry would leave hotkeys (Anki, audio) acting
            // on an entry the user cannot see: the first entry becomes current.
            if (expanded && this._isCurrentFolded()) { this._display.moveCurrentEntry(-this._display.selectedIndex); }
        });
        line.appendChild(button);
    }
}
