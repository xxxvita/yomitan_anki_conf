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

import {afterAll, afterEach, describe, expect, test} from 'vitest';
import {PHRASE_TARGET_MAX_CODE_POINTS, PhraseSelectionMemory, pickPhraseExamplesTarget} from '../ext/js/display/phrase-examples-target.js';
import {setupDomTest} from './fixtures/dom-test.js';

const {window, teardown} = await setupDomTest();
afterAll(() => teardown(global));
afterEach(() => { window.document.body.replaceChildren(); });

/**
 * @param {string} value
 * @param {number} [selectionStart]
 * @param {number} [selectionEnd]
 * @returns {{value: string, selectionStart: number, selectionEnd: number}}
 */
function field(value, selectionStart = 0, selectionEnd = 0) {
    return {value, selectionStart, selectionEnd};
}

describe('pickPhraseExamplesTarget', () => {
    test('the trimmed selection wins over the whole text', () => {
        const value = 'I would rather stay at home tonight';
        const start = value.indexOf('rather');
        expect(pickPhraseExamplesTarget(field(value, start - 1, start + 'rather stay'.length + 1))).toEqual({text: 'rather stay', truncated: false, noLatin: false});
    });

    test('no selection → the whole text, trimmed', () => {
        expect(pickPhraseExamplesTarget(field('  break the ice  ', 3, 3))).toEqual({text: 'break the ice', truncated: false, noLatin: false});
    });

    test('a whitespace-only selection → the whole text', () => {
        expect(pickPhraseExamplesTarget(field('break the ice', 5, 6))).toEqual({text: 'break the ice', truncated: false, noLatin: false});
    });

    test('whitespace-only or empty text → null', () => {
        expect(pickPhraseExamplesTarget(field('   \n\t  ', 0, 7))).toBeNull();
        expect(pickPhraseExamplesTarget(field(''))).toBeNull();
    });

    test('M3: newlines and runs of whitespace collapse to single spaces', () => {
        expect(pickPhraseExamplesTarget(field('break\n\n the   ice\t now'))).toEqual({text: 'break the ice now', truncated: false, noLatin: false});
    });

    test('null selection offsets (not a text control) → the whole text', () => {
        expect(pickPhraseExamplesTarget({value: 'take off', selectionStart: null, selectionEnd: null})).toEqual({text: 'take off', truncated: false, noLatin: false});
    });

    test('250 characters with spaces → cut at the last word boundary before 200, truncated', () => {
        const words = [];
        while (words.join(' ').length < 250) { words.push('word'); }
        const text = words.join(' ');
        const result = pickPhraseExamplesTarget(field(text));
        expect(result).not.toBeNull();
        const {text: cut, truncated} = /** @type {{text: string, truncated: boolean}} */ (result);
        expect(truncated).toBe(true);
        expect([...cut].length).toBeLessThanOrEqual(PHRASE_TARGET_MAX_CODE_POINTS);
        expect(cut.endsWith('word')).toBe(true);
        expect(text.startsWith(cut)).toBe(true);
        expect(text[cut.length]).toBe(' ');
    });

    test('250 characters with no spaces → a hard cut at 200 code points', () => {
        const result = pickPhraseExamplesTarget(field('a'.repeat(250)));
        expect(result).toEqual({text: 'a'.repeat(200), truncated: true, noLatin: false});
    });

    test('the cut counts code points, not UTF-16 units', () => {
        const text = `a${'😀'.repeat(250)}`;
        const result = pickPhraseExamplesTarget(field(text));
        expect([...result?.text ?? ''].length).toBe(200);
    });

    test('exactly 200 code points → not truncated', () => {
        expect(pickPhraseExamplesTarget(field('b'.repeat(200)))).toEqual({text: 'b'.repeat(200), truncated: false, noLatin: false});
    });

    test('M3: no Latin letter → noLatin', () => {
        expect(pickPhraseExamplesTarget(field('привет, мир'))).toEqual({text: 'привет, мир', truncated: false, noLatin: true});
        expect(pickPhraseExamplesTarget(field('Hello привет', 6, 12))).toEqual({text: 'привет', truncated: false, noLatin: true});
        expect(pickPhraseExamplesTarget(field('123 !?'))).toMatchObject({noLatin: true});
    });
});

describe('PhraseSelectionMemory (M6)', () => {
    /**
     * @param {string} value
     * @returns {{textarea: HTMLTextAreaElement, button: HTMLButtonElement}}
     */
    function setup(value) {
        const textarea = window.document.createElement('textarea');
        textarea.value = value;
        const button = window.document.createElement('button');
        window.document.body.append(textarea, button);
        return {textarea, button};
    }

    test('nothing remembered and the field is not focused → the whole text', () => {
        const {textarea} = setup('break the ice');
        textarea.setSelectionRange(0, 5);
        expect(new PhraseSelectionMemory().read(textarea)).toEqual({value: 'break the ice', selectionStart: 0, selectionEnd: 0});
    });

    test('the focused field is read live', () => {
        const {textarea} = setup('break the ice');
        textarea.focus();
        textarea.setSelectionRange(6, 9);
        expect(new PhraseSelectionMemory().read(textarea)).toEqual({value: 'break the ice', selectionStart: 6, selectionEnd: 9});
    });

    test('a remembered selection outlives a later change of the live range', () => {
        const {textarea, button} = setup('break the ice');
        const memory = new PhraseSelectionMemory();
        textarea.focus();
        textarea.setSelectionRange(6, 13);
        memory.remember(textarea);
        button.focus();
        textarea.setSelectionRange(0, 0);
        expect(memory.read(textarea)).toEqual({value: 'break the ice', selectionStart: 6, selectionEnd: 13});
    });

    test('a remembered selection of an older text is ignored → the whole text', () => {
        const {textarea} = setup('break the ice');
        const memory = new PhraseSelectionMemory();
        textarea.setSelectionRange(6, 13);
        memory.remember(textarea);
        textarea.value = 'something else';
        expect(memory.read(textarea)).toEqual({value: 'something else', selectionStart: 0, selectionEnd: 0});
    });
});
