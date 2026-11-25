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
 * The fields of a Phrases note made from the phrase window (spec 2026-11-25-phrases-video-design.md, part B).
 *
 * ⚠️ The readers: the Phrases template (a blank is `_{2,}` in Front; a whole phrase is EnglishWord equal to Expression)
 * and the voice add-on, which compares EnglishWord as plain text. Both get Front, EnglishWord and Expression as raw
 * HTML, so none of them may keep `<`, `>` or `&`, and quotes must not be turned into entities.
 */

import {BLANK, cleanModelText, escapeHtml, frontSpeechText} from './flib-enrich.js';

/**
 * @typedef {{start: number, end: number}} PhraseBlank Offsets in the untouched value of the field.
 */

/**
 * @typedef {object} PhraseNoteFields
 * @property {string} Front
 * @property {string} Expression
 * @property {string} EnglishWord
 * @property {string} ExpressionTranslate
 * @property {string} flib_media
 * @property {string} Audio_front
 * @property {string} Audio_expression
 */

/** Soft hyphen, zero-width space, word joiner, BOM and direction marks. ZWJ and ZWNJ stay: emoji and words need them. */
const INVISIBLE = '\\u00AD\\u061C\\u200B\\u200E\\u200F\\u202A-\\u202E\\u2060\\u2066-\\u2069\\uFEFF';
/** Characters removed from the text: control (except whitespace), lone surrogates, invisible. */
const REMOVED = `(?:(?!\\s)\\p{Cc}|\\p{Cs}|[${INVISIBLE}])`;
const REMOVED_PATTERN = new RegExp(REMOVED, 'gu');
/** A word; the characters that will be removed do not split it. A mark or a joiner does not start it. */
const WORD_PART = `[\\p{L}\\p{N}](?:${REMOVED}*[\\p{L}\\p{N}\\p{M}])*`;
const WORD_PATTERN = new RegExp(`${WORD_PART}(?:${REMOVED}*['’-]${REMOVED}*${WORD_PART})*`, 'gu');
const LETTER_OR_DIGIT_PATTERN = /[\p{L}\p{N}]/u;
const LATIN_PATTERN = /\p{Script=Latin}/u;
/** Without the lookbehind a long run of brackets would be scanned from each of them. */
const SOUND_BRACKETS_PATTERN = /(?<!\[)\[+(?=sound:)/i;
const ALL_SOUND_BRACKETS_PATTERN = new RegExp(SOUND_BRACKETS_PATTERN, 'gi');

/**
 * One cleaning for all three texts; not trimmed, so that a segment keeps the space next to the blank.
 * @param {string} text
 * @returns {string}
 */
function cleanText(text) {
    // NFC first: cleanModelText would take the `<` of a decomposed `≮`; and last: the removals bring letters together.
    // The order matters: each step may reveal what the next one removes, never the reverse, so once is enough.
    return cleanModelText(text.normalize('NFC'))
        .replace(REMOVED_PATTERN, '')
        .replace(/\s+/g, ' ')
        .replace(ALL_SOUND_BRACKETS_PATTERN, '')
        .replace(/_{2,}/g, '_')
        .normalize('NFC');
}

/**
 * The widest run of whole words touched by the range.
 * @param {string} value
 * @param {number} start
 * @param {number} end
 * @returns {?PhraseBlank}
 */
function widenToWords(value, start, end) {
    /** @type {?PhraseBlank} */
    let result = null;
    for (const match of value.matchAll(WORD_PATTERN)) {
        const wordStart = match.index;
        const wordEnd = wordStart + match[0].length;
        if (wordEnd <= start) { continue; }
        if (wordStart >= end) { break; }
        result = {start: result === null ? wordStart : result.start, end: wordEnd};
    }
    return result;
}

/**
 * Cleans the three segments apart, so the blank is the selected place and not the first equal word, then repairs the
 * seams, so that the joined text is clean too.
 * @param {string} value
 * @param {PhraseBlank} blank
 * @returns {?{before: string, word: string, after: string}} null — no blank is left.
 */
function splitPhrase(value, {start, end}) {
    let before = cleanText(value.slice(0, start)).trimStart();
    let word = cleanText(value.slice(start, end));
    let after = cleanText(value.slice(end)).trimEnd();
    if (!LATIN_PATTERN.test(word) || !LETTER_OR_DIGIT_PATTERN.test(before + after)) { return null; }
    for (;;) {
        // An underscore would prolong the blank, a mark whose letter was cleaned away would join its last letter.
        before = before.replace(/_+$/, '').trimStart();
        after = after.replace(/^[_\p{M}]+/u, '').trimEnd();
        const match = SOUND_BRACKETS_PATTERN.exec(before + word + after);
        if (match === null) { break; }
        // The run of brackets is in one segment: the word starts and ends with a word character.
        const index = match.index;
        const count = match[0].length;
        if (index < before.length) {
            before = before.slice(0, index) + before.slice(index + count);
        } else if (index < before.length + word.length) {
            const i = index - before.length;
            word = word.slice(0, i) + word.slice(i + count);
        } else {
            const i = index - before.length - word.length;
            after = after.slice(0, i) + after.slice(i + count);
        }
    }
    // Letters that still merge across a seam (Hangul parts): no blank rather than a Front that differs from Expression.
    const joined = before + word + after;
    return cleanText(joined) === joined ? {before, word, after} : null;
}

/**
 * @param {{value: string, blank: ?PhraseBlank}} details
 * @returns {?{front: string, expression: string, word: string, blank: boolean}} null — nothing to save.
 */
function getPhraseTexts({value, blank}) {
    const range = blank === null ? null : pickPhraseBlank({value, selectionStart: blank.start, selectionEnd: blank.end});
    const parts = range === null ? null : splitPhrase(value, range);
    if (parts !== null) {
        const {before, word, after} = parts;
        return {front: before + BLANK + after, expression: before + word + after, word, blank: true};
    }
    const text = cleanText(value).trim();
    // The voice add-on ignores punctuation: an answer made only of it would be as bad as an empty one.
    return LETTER_OR_DIGIT_PATTERN.test(text) ? {front: text, expression: text, word: text, blank: false} : null;
}

/**
 * The part of the phrase that becomes the blank: the selection widened to whole words, without spaces and punctuation
 * at its edges. Every word of the phrase, only punctuation, nothing Latin — no blank.
 * @param {{value: string, selectionStart: ?number, selectionEnd: ?number}} field
 * @returns {?PhraseBlank}
 */
export function pickPhraseBlank({value, selectionStart, selectionEnd}) {
    if (!Number.isInteger(selectionStart) || !Number.isInteger(selectionEnd)) { return null; }
    const start = Math.max(0, /** @type {number} */ (selectionStart));
    const end = Math.min(value.length, /** @type {number} */ (selectionEnd));
    // A selected tag or apostrophe is not a word, though a word may be around it.
    if (start >= end || !LETTER_OR_DIGIT_PATTERN.test(cleanText(value.slice(start, end)))) { return null; }
    const blank = widenToWords(value, start, end);
    return blank !== null && splitPhrase(value, blank) !== null ? blank : null;
}

/**
 * @param {{value: string, blank: ?PhraseBlank, translation: string, mediaHtml: string}} details
 * @returns {?PhraseNoteFields} null — nothing to save.
 */
export function buildPhraseNoteFields({value, blank, translation, mediaHtml}) {
    const texts = getPhraseTexts({value, blank});
    if (texts === null) { return null; }
    return {
        Front: texts.front,
        Expression: texts.expression,
        EnglishWord: texts.word,
        ExpressionTranslate: escapeHtml(cleanModelText(translation).trim()).replace(/\r\n|\r|\n/g, '<br>'),
        flib_media: mediaHtml,
        Audio_front: '',
        Audio_expression: '',
    };
}

/**
 * What is read aloud. Without a blank there is no front: the card would read its answer twice.
 * @param {{value: string, blank: ?PhraseBlank}} details
 * @returns {{expression: string, front: ?string}}
 */
export function phraseSpeechTexts({value, blank}) {
    const texts = getPhraseTexts({value, blank});
    if (texts === null) { return {expression: '', front: null}; }
    return {expression: texts.expression, front: texts.blank ? frontSpeechText(texts.front) : null};
}

/** Entities that editors and Flibooster write into these fields. */
const ENTITIES = new Map([
    ['amp', '&'],
    ['lt', '<'],
    ['gt', '>'],
    ['quot', '"'],
    ['apos', '\''],
    ['nbsp', '\u00A0'],
    ['lsquo', '‘'],
    ['rsquo', '’'],
    ['ldquo', '“'],
    ['rdquo', '”'],
    ['laquo', '«'],
    ['raquo', '»'],
    ['ndash', '–'],
    ['mdash', '—'],
    ['hellip', '…'],
]);

/**
 * @param {string} entity
 * @param {string} name Without `&` and `;`.
 * @returns {string}
 */
function decodeEntity(entity, name) {
    if (!name.startsWith('#')) { return ENTITIES.get(name) ?? entity; }
    const code = /^#x/i.test(name) ? Number.parseInt(name.slice(2), 16) : Number.parseInt(name.slice(1), 10);
    const valid = code > 0 && code <= 0x10FFFF && (code < 0xD800 || code > 0xDFFF);
    return valid ? String.fromCodePoint(code) : entity;
}

/**
 * The text of a stored field. The service worker has no DOM; the text is only compared, never shown.
 * @param {string} html
 * @returns {string}
 */
function fieldText(html) {
    return html
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/<\/?(?:br|div|p|li)\b[^>]*>/gi, ' ')
        .replace(/<\/?[a-z][^>]*>/gi, '')
        .replace(/&(#\d+|#x[\da-f]+|[a-z]+);/gi, decodeEntity)
        .normalize('NFC')
        .replace(/\s+/g, ' ')
        .trim();
}

/**
 * The same card: both Front and EnglishWord (`I _____ it` of «love» and of «hate» are different cards).
 * @param {{Front: string, EnglishWord: string}} a
 * @param {{Front: string, EnglishWord: string}} b
 * @returns {boolean}
 */
export function samePhraseNote(a, b) {
    return fieldText(a.Front) === fieldText(b.Front) && fieldText(a.EnglishWord) === fieldText(b.EnglishWord);
}
