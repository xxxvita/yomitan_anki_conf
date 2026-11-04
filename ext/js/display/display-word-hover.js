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
 * где работает щелчок (display.js CONTENT_CLICK_INCLUDE / _EXCLUDE), и ровно
 * то слово, с которого щелчок начнёт поиск (Display.getScanStartAt).
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
 * Конец слова под курсором: от каретки вперёд до границы (DOMTextScanner:
 * всё, кроме букв, цифр, «_»; апостроф между буквами — внутри слова: «don't»).
 * Начало слова считает не эта функция, а сам щелчок (Display.getScanStartAt).
 * @param {string} text
 * @param {number} offset
 * @returns {number}
 */
export function getWordEnd(text, offset) {
    let end = offset;
    while (end < text.length) {
        const char = text[end];
        if (isDelimiter(char) && !(DOMTextScanner.isSingleQuote(char) && end > 0 && !isDelimiter(text[end - 1]) && end + 1 < text.length && !isDelimiter(text[end + 1]))) { break; }
        ++end;
    }
    return end;
}

export class DisplayWordHover {
    /**
     * @param {object} details
     * @param {string} details.include Где щелчок ищет слово.
     * @param {string} details.exclude Где не ищет.
     * @param {() => boolean} details.isEnabled Щелчок по слову включён (scanning.enablePopupSearch).
     * @param {(x: number, y: number) => ?{start: {node: Node, offset: number}, caret: {node: Node, offset: number}}} details.scanAt
     *   Где щелчок в этой точке начнёт поиск (Display.getScanStartAt — тот же код, что у щелчка).
     */
    constructor({include, exclude, isEnabled, scanAt}) {
        /** @type {string} */
        this._include = include;
        /** @type {string} */
        this._exclude = exclude;
        /** @type {() => boolean} */
        this._isEnabled = isEnabled;
        /** @type {(x: number, y: number) => ?{start: {node: Node, offset: number}, caret: {node: Node, offset: number}}} */
        this._scanAt = scanAt;
        /** @type {?{node: Node, start: number, endNode: Node, end: number}} Подсвеченное сейчас — тот же диапазон не пересоздаётся. */
        this._current = null;
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
        if (
            current !== null && current.node === range.startContainer && current.start === range.startOffset &&
            current.endNode === range.endContainer && current.end === range.endOffset
        ) { return; }
        this._current = {node: range.startContainer, start: range.startOffset, endNode: range.endContainer, end: range.endOffset};
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
        const scan = this._scanAt(e.clientX, e.clientY);
        if (scan === null) { return null; }
        const {start, caret} = scan;
        if (caret.node.nodeType !== Node.TEXT_NODE) { return null; }
        const parent = caret.node.parentElement;
        if (parent === null || !this._isScannable(parent)) { return null; }
        const end = getWordEnd(/** @type {Text} */ (caret.node).data, caret.offset);
        const range = document.createRange();
        try {
            range.setStart(start.node, start.offset);
            range.setEnd(caret.node, end);
        } catch (error) {
            return null;
        }
        return range.collapsed ? null : range;
    }

    /**
     * @param {Element} element
     * @returns {boolean}
     */
    _isScannable(element) {
        return element.matches(this._include) && !element.matches(this._exclude);
    }
}
