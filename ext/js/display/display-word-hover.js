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

import {DOMTextScanner} from '../dom/dom-text-scanner.js';

/*
 * Подсветка слова под мышью (макет flib-nest.jsx/flib.css: `.hw:hover` —
 * фон --bg3, курсор «рука»): подсказка, что щелчок по слову откроет карточку.
 * Рисуется CSS Custom Highlight API (`::highlight(fc-hw)` в flib-card.css),
 * без обёртки слов в span: DOM статьи (вывод словаря) не меняется, и
 * сканирование текста видит его как прежде. Подсвечиваются те же места,
 * где работает щелчок (display.js CONTENT_CLICK_INCLUDE / _EXCLUDE).
 * Без Highlight API (старый браузер) — просто без подсветки.
 */

/**
 * @param {string} char
 * @returns {boolean}
 */
function isDelimiter(char) {
    return DOMTextScanner.isWordDelimiter(char);
}

/**
 * Слово, которое найдёт щелчок в этой точке. Начало — по тем же правилам, что
 * у сканера щелчка (DOMTextScanner, seek назад с stopAtWordBoundary): граница —
 * всё, кроме букв, цифр и «_»; апостроф — часть слова, если перед ним буква
 * («don't»), дефис — граница («well-known»: «known» ищется отдельно). Режим
 * «character» (scanResolution, японский/китайский): от буквы под курсором.
 * Конец — до следующей границы (апостроф между буквами остаётся внутри).
 * @param {string} text
 * @param {number} offset Позиция каретки (между символами).
 * @param {'word'|'character'} [resolution]
 * @returns {?[number, number]} [начало, конец) слова; null — каретка не у слова.
 */
export function getWordBounds(text, offset, resolution = 'word') {
    let start = offset;
    if (resolution === 'word') {
        while (start > 0) {
            const char = text[start - 1];
            if (isDelimiter(char) && !(DOMTextScanner.isSingleQuote(char) && start > 1 && !isDelimiter(text[start - 2]))) { break; }
            --start;
        }
    }
    let end = Math.max(start, offset);
    while (end < text.length) {
        const char = text[end];
        if (isDelimiter(char) && !(DOMTextScanner.isSingleQuote(char) && end > start && end + 1 < text.length && !isDelimiter(text[end + 1]))) { break; }
        ++end;
    }
    return end > start ? [start, end] : null;
}

/**
 * @param {number} x
 * @param {number} y
 * @returns {?{node: Node, offset: number}}
 */
function defaultCaretAt(x, y) {
    const doc = /** @type {Document & {caretPositionFromPoint?: (x: number, y: number) => ?{offsetNode: Node, offset: number}}} */ (document);
    if (typeof doc.caretPositionFromPoint === 'function') {
        const position = doc.caretPositionFromPoint(x, y);
        return position === null ? null : {node: position.offsetNode, offset: position.offset};
    }
    if (typeof document.caretRangeFromPoint === 'function') {
        const range = document.caretRangeFromPoint(x, y);
        return range === null ? null : {node: range.startContainer, offset: range.startOffset};
    }
    return null;
}

/**
 * @param {Range} range
 * @param {number} x
 * @param {number} y
 * @returns {boolean}
 */
function defaultContainsPoint(range, x, y) {
    for (const rect of range.getClientRects()) {
        if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) { return true; }
    }
    return false;
}

export class DisplayWordHover {
    /**
     * @param {object} details
     * @param {string} details.include Где щелчок ищет слово.
     * @param {string} details.exclude Где не ищет.
     * @param {() => boolean} details.isEnabled Щелчок по слову включён (scanning.enablePopupSearch).
     * @param {() => ('word'|'character')} details.getResolution Как щелчок ищет начало слова (scanResolution, язык).
     * @param {(x: number, y: number) => ?{node: Node, offset: number}} [details.caretAt]
     * @param {(range: Range, x: number, y: number) => boolean} [details.containsPoint]
     */
    constructor({include, exclude, isEnabled, getResolution, caretAt = defaultCaretAt, containsPoint = defaultContainsPoint}) {
        /** @type {string} */
        this._include = include;
        /** @type {string} */
        this._exclude = exclude;
        /** @type {() => boolean} */
        this._isEnabled = isEnabled;
        /** @type {() => ('word'|'character')} */
        this._getResolution = getResolution;
        /** @type {?{node: Node, start: number, end: number}} Подсвеченное сейчас — тот же диапазон не пересоздаётся. */
        this._current = null;
        /** @type {(x: number, y: number) => ?{node: Node, offset: number}} */
        this._caretAt = caretAt;
        /** @type {(range: Range, x: number, y: number) => boolean} */
        this._containsPoint = containsPoint;
    }

    /** @returns {boolean} */
    static isSupported() {
        return typeof CSS !== 'undefined' && typeof CSS.highlights !== 'undefined' && typeof Highlight === 'function';
    }

    /** */
    prepare() {
        if (!DisplayWordHover.isSupported()) { return; }
        document.addEventListener('mousemove', (e) => { this._onMouseMove(e); }, {passive: true});
        document.documentElement.addEventListener('mouseleave', () => { this.clear(); });
        // Scrolling moves another word under a still pointer: the lit one would lie.
        document.addEventListener('scroll', () => { this.clear(); }, {capture: true, passive: true});
    }

    /** Снять подсветку (новая выдача, курсор ушёл). */
    clear() {
        this._current = null;
        if (DisplayWordHover.isSupported()) { CSS.highlights.delete('fc-hw'); }
        delete document.documentElement.dataset.fcWordHover;
    }

    /**
     * @param {MouseEvent} e
     */
    _onMouseMove(e) {
        const range = this._getWordRange(e);
        if (range === null) {
            if (this._current !== null) { this.clear(); }
            return;
        }
        const current = this._current;
        if (current !== null && current.node === range.startContainer && current.start === range.startOffset && current.end === range.endOffset) { return; }
        this._current = {node: range.startContainer, start: range.startOffset, end: range.endOffset};
        CSS.highlights.set('fc-hw', new Highlight(range));
        document.documentElement.dataset.fcWordHover = 'true';
    }

    /**
     * @param {MouseEvent} e
     * @returns {?Range}
     */
    _getWordRange(e) {
        // A held button is a text selection, not a hover over a word.
        if (e.buttons !== 0 || !this._isEnabled()) { return null; }
        const target = e.target;
        if (!(target instanceof Element) || !this._isScannable(target)) { return null; }
        const caret = this._caretAt(e.clientX, e.clientY);
        if (caret === null || caret.node.nodeType !== Node.TEXT_NODE) { return null; }
        const parent = caret.node.parentElement;
        if (parent === null || !this._isScannable(parent)) { return null; }
        const bounds = getWordBounds(/** @type {Text} */ (caret.node).data, caret.offset, this._getResolution());
        if (bounds === null) { return null; }
        const range = document.createRange();
        range.setStart(caret.node, bounds[0]);
        range.setEnd(caret.node, bounds[1]);
        // The caret is the NEAREST position: over blank space it still lands
        // next to some word — only a point inside the word's box counts.
        return this._containsPoint(range, e.clientX, e.clientY) ? range : null;
    }

    /**
     * @param {Element} element
     * @returns {boolean}
     */
    _isScannable(element) {
        return element.matches(this._include) && !element.matches(this._exclude);
    }
}
