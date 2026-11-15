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

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {EventDispatcher} from '../ext/js/core/event-dispatcher.js';
import {ExtensionError} from '../ext/js/core/extension-error.js';
import {DisplayPosHint} from '../ext/js/display/display-pos-hint.js';
import {setUiLanguage} from '../ext/js/i18n/ui-language.js';
import {setupDomTest} from './fixtures/dom-test.js';

/**
 * @param {string} wordClass
 * @param {string} [text]
 * @returns {object}
 */
function entry(wordClass, text = 'book') {
    return {type: 'term', headwords: [{term: 'book', wordClasses: [wordClass], sources: [{originalText: text}]}], definitions: [{tags: []}]};
}

/**
 * @augments EventDispatcher<import('display').Events>
 */
class FakeDisplay extends EventDispatcher {
    constructor() {
        super();
        /** @type {object[]} */
        this.dictionaryEntries = [];
        /** @type {number} */
        this.selectedIndex = 0;
        /** @type {{state: ?{sentence?: {text: string, offset: number}}}} */
        this.history = {state: null};
        /**
         *
         */
        this.focusEntryDefinition = vi.fn((/** @type {number} */ index, /** @type {number} */ _definitionIndex) => {
            this.selectedIndex = index;
            this.trigger('currentEntryChanged', {index: this.selectedIndex});
        });
    }

    /**
     * @param {object[]} entries
     * @param {string} sentence
     */
    show(entries, sentence) {
        this.dictionaryEntries = entries;
        this.selectedIndex = 0;
        this.history.state = {sentence: {text: sentence, offset: 0}};
        this.trigger('contentUpdateComplete', {type: 'terms'});
    }
}

/**
 * @param {string} code
 * @returns {ExtensionError}
 */
function gatewayError(code) {
    const error = new ExtensionError(code);
    error.data = {code, status: null};
    return error;
}

/** @returns {Promise<void>} */
const flush = () => new Promise((resolve) => { setTimeout(resolve, 0); });

describe('DisplayPosHint', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    /** @type {FakeDisplay} */
    let display;
    /** @type {import('vitest').Mock} */
    let detect;
    /** @type {HTMLButtonElement} */
    let button;
    /** @type {HTMLElement} */
    let label;

    beforeEach(async () => {
        env = await setupDomTest();
        setUiLanguage('ru');
        const top = document.createElement('div');
        top.className = 'content-sidebar-top';
        document.body.appendChild(top);
        display = new FakeDisplay();
        detect = vi.fn(async () => ({pos: 'verb'}));
        new DisplayPosHint(/** @type {*} */ (display), {api: /** @type {*} */ ({flibPosDetect: detect})}).prepare();
        button = /** @type {HTMLButtonElement} */ (top.querySelector('button.fc-strip-pos'));
        label = /** @type {HTMLElement} */ (top.querySelector('.fc-strip-pos-label'));
    });
    afterEach(async () => { await env.teardown(global); });

    test('disabled with one entry or one-word sentence', () => {
        expect(button.disabled).toBe(true);
        display.show([entry('n')], 'book a table');
        expect(button.disabled).toBe(true);
        display.show([entry('n'), entry('v')], 'book');
        expect(button.disabled).toBe(true);
    });

    test('one grouped entry with two parts of speech: enabled, scrolls to the verb definition', async () => {
        const groupedEntry = {type: 'term', headwords: [{term: 'book', wordClasses: ['n', 'v'], sources: [{originalText: 'book'}]}], definitions: [{tags: [{name: 'n'}]}, {tags: [{name: 'n'}]}, {tags: [{name: 'v'}, {name: 'vt'}]}]};
        display.show([groupedEntry], 'book a table');
        expect(button.disabled).toBe(false);
        button.click();
        await flush();
        expect(display.focusEntryDefinition).toHaveBeenCalledWith(0, 2);
        expect(label.textContent).toBe('гл.');
    });

    test.each([
        ['two entries of one part of speech', [entry('n'), entry('n')]],
        ['two entries without part of speech', [entry(''), entry('')]],
    ])('disabled with %s: nothing to choose, no paid call', (_name, entries) => {
        display.show(entries, 'book a table');
        expect(button.disabled).toBe(true);
    });

    test('enabled with two entries and a sentence', () => {
        display.show([entry('n'), entry('v')], 'book a table');
        expect(button.disabled).toBe(false);
    });

    test('moves to matching entry and labels it', async () => {
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        await flush();
        expect(detect).toHaveBeenCalledWith('book', 'book a table');
        expect(display.focusEntryDefinition).toHaveBeenCalledWith(1, 0);
        expect(label.textContent).toBe('гл.');
        expect(label.dataset.miss).toBeUndefined();
        expect(button.title).toContain('глагол');
    });

    test('asks with the form from the text, not the headword', async () => {
        display.show([entry('n', 'booked'), entry('v', 'booked')], 'I booked a table');
        button.click();
        await flush();
        expect(detect).toHaveBeenCalledWith('booked', 'I booked a table');
    });

    test('current entry matches: focuses it from the top', async () => {
        display.show([entry('v'), entry('n')], 'book a table');
        button.click();
        await flush();
        expect(display.focusEntryDefinition).toHaveBeenCalledWith(0, 0);
        expect(label.textContent).toBe('гл.');
    });

    test('no entry: says so and stays', async () => {
        detect.mockResolvedValueOnce({pos: 'adverb'});
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        await flush();
        expect(display.focusEntryDefinition).not.toHaveBeenCalled();
        expect(button.title).toContain('такой статьи нет');
        expect(label.dataset.miss).toBe('true');
        expect(label.textContent).toBe('нар.');
    });

    test('one request on double click', async () => {
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        button.click();
        await flush();
        expect(detect).toHaveBeenCalledTimes(1);
    });

    test('stale answer is dropped', async () => {
        /** @type {(value: {pos: string}) => void} */
        let resolve = () => {};
        detect.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        display.show([entry('n'), entry('v')], 'a book on the table');
        resolve({pos: 'verb'});
        await flush();
        expect(display.focusEntryDefinition).not.toHaveBeenCalled();
        expect(label.textContent).toBe('');
    });

    test('cache avoids second request', async () => {
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        await flush();
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        await flush();
        expect(detect).toHaveBeenCalledTimes(1);
        expect(display.focusEntryDefinition).toHaveBeenCalledTimes(2);
    });

    test('quota error shows its own text and link', async () => {
        detect.mockRejectedValueOnce(gatewayError('llm_quota_exhausted'));
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        await flush();
        expect(button.title).toContain('Квота переводов');
        expect(button.title).toContain('Продлить квоту переводов');
        expect(button.title).not.toContain('такой статьи нет');
        expect(button.disabled).toBe(false);
    });

    test.each([
        ['flib_key_missing', 'Не указан личный ключ'],
        ['flib_key_invalid', 'Личный ключ не подходит'],
        ['flib_rate_limited', 'Слишком часто'],
        ['flib_service_unavailable', 'Сервер недоступен'],
        ['llm_bad_answer', 'непонятный ответ'],
    ])('error %s has its own text', async (code, text) => {
        detect.mockRejectedValueOnce(gatewayError(code));
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        await flush();
        expect(button.title).toContain(text);
        expect(label.textContent).toBe('!');
        expect(label.dataset.error).toBe('true');
    });

    test('content clear resets the label', async () => {
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        await flush();
        display.trigger('contentClear', {});
        expect(label.textContent).toBe('');
        expect(button.disabled).toBe(true);
    });
});
