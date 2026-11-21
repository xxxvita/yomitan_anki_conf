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

/**
 * What the phrase window's «Примеры» / «С учётом моих знаний» search for (spec items 6-9): the selected part of the
 * English field, else the whole field.
 */

import {truncateAtWordBoundary} from './gateway-examples-util.js';

/** Longest phrase target, in code points (spec item 6). */
export const PHRASE_TARGET_MAX_CODE_POINTS = 200;

/**
 * @typedef {object} PhraseFieldState
 * @property {string} value
 * @property {?number} selectionStart
 * @property {?number} selectionEnd
 */

/**
 * @typedef {object} PhraseExamplesTarget
 * @property {string} text Whitespace collapsed, trimmed, at most 200 code points.
 * @property {boolean} truncated The text was cut to 200 code points.
 * @property {boolean} noLatin No Latin letter: nothing English to search for (M3) — the caller asks for English text.
 */

/**
 * @param {string} text
 * @returns {string}
 */
function collapseWhitespace(text) {
    return text.replace(/\s+/g, ' ').trim();
}

/**
 * @param {PhraseFieldState} field
 * @returns {?PhraseExamplesTarget} null — nothing to search for (empty or whitespace-only field).
 */
export function pickPhraseExamplesTarget({value, selectionStart, selectionEnd}) {
    let text = '';
    if (typeof selectionStart === 'number' && typeof selectionEnd === 'number' && selectionEnd > selectionStart) {
        text = collapseWhitespace(value.slice(selectionStart, selectionEnd));
    }
    if (text.length === 0) { text = collapseWhitespace(value); }
    if (text.length === 0) { return null; }
    const cut = truncateAtWordBoundary(text, PHRASE_TARGET_MAX_CODE_POINTS);
    return {text: cut, truncated: cut !== text, noLatin: !/[A-Za-z]/.test(cut)};
}

/**
 * M6: the last known selection of a phrase field. A button press may move focus off the field, so the selection is
 * remembered on the button's mousedown (while the field still has focus) and on the field's blur; keyboard
 * activation reads what the blur stored. A stale record (the text changed since) is ignored.
 */
export class PhraseSelectionMemory {
    constructor() {
        /** @type {WeakMap<HTMLTextAreaElement, {value: string, selectionStart: number, selectionEnd: number}>} */
        this._saved = new WeakMap();
    }

    /**
     * @param {HTMLTextAreaElement} textarea
     */
    remember(textarea) {
        this._saved.set(textarea, {value: textarea.value, selectionStart: textarea.selectionStart, selectionEnd: textarea.selectionEnd});
    }

    /**
     * The focused field is read live; otherwise the remembered selection of the same text; otherwise no selection,
     * so the whole text is searched.
     * @param {HTMLTextAreaElement} textarea
     * @returns {{value: string, selectionStart: number, selectionEnd: number}}
     */
    read(textarea) {
        const {value} = textarea;
        if (textarea.ownerDocument.activeElement === textarea) {
            return {value, selectionStart: textarea.selectionStart, selectionEnd: textarea.selectionEnd};
        }
        const saved = this._saved.get(textarea);
        if (typeof saved !== 'undefined' && saved.value === value) { return {...saved}; }
        return {value, selectionStart: 0, selectionEnd: 0};
    }
}
