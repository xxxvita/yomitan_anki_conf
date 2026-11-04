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

/*
 * Подсветка слова под мышью (макет flib-nest.jsx/flib.css: `.hw:hover` —
 * фон --bg3, курсор «рука»): подсказка, что щелчок по слову откроет карточку.
 * Рисуется CSS Custom Highlight API (`::highlight(fc-hw)` в flib-card.css),
 * без обёртки слов в span: DOM статьи (вывод словаря) не меняется, и
 * сканирование текста видит его как прежде. Подсвечиваются те же места,
 * где работает щелчок (display.js CONTENT_CLICK_INCLUDE / _EXCLUDE).
 * Без Highlight API (старый браузер) — просто без подсветки.
 */

/** Буква, цифра, апостроф, дефис — часть слова («don't», «well-known»). */
const WORD_CHAR = /[\p{L}\p{N}'’-]/u;

/**
 * @param {string} text
 * @param {number} offset Позиция каретки (между символами).
 * @returns {?[number, number]} [начало, конец) слова; null — каретка не у слова.
 */
export function getWordBounds(text, offset) {
    let index = offset;
    if (!(index < text.length && WORD_CHAR.test(text[index]))) {
        // Правая половина последней буквы ставит каретку ПОСЛЕ неё.
        index = offset - 1;
        if (!(index >= 0 && WORD_CHAR.test(text[index]))) { return null; }
    }
    let start = index;
    while (start > 0 && WORD_CHAR.test(text[start - 1])) { --start; }
    let end = index + 1;
    while (end < text.length && WORD_CHAR.test(text[end])) { ++end; }
    return [start, end];
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
     * @param {(x: number, y: number) => ?{node: Node, offset: number}} [details.caretAt]
     * @param {(range: Range, x: number, y: number) => boolean} [details.containsPoint]
     */
    constructor({include, exclude, isEnabled, caretAt = defaultCaretAt, containsPoint = defaultContainsPoint}) {
        /** @type {string} */
        this._include = include;
        /** @type {string} */
        this._exclude = exclude;
        /** @type {() => boolean} */
        this._isEnabled = isEnabled;
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
    }

    /** Снять подсветку (новая выдача, курсор ушёл). */
    clear() {
        if (DisplayWordHover.isSupported()) { CSS.highlights.delete('fc-hw'); }
        delete document.documentElement.dataset.fcWordHover;
    }

    /**
     * @param {MouseEvent} e
     */
    _onMouseMove(e) {
        const range = this._getWordRange(e);
        if (range === null) {
            this.clear();
            return;
        }
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
        const bounds = getWordBounds(/** @type {Text} */ (caret.node).data, caret.offset);
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
