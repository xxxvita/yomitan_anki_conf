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
import {log} from '../ext/js/core/log.js';
import {DisplayPosHint} from '../ext/js/display/display-pos-hint.js';
import {setUiLanguage, translate} from '../ext/js/i18n/ui-language.js';
import {setupDomTest} from './fixtures/dom-test.js';

const TRANSLATION = 'Я забронировал столик.';

/**
 * @param {string} wordClass
 * @param {string} [text]
 * @returns {object}
 */
function entry(wordClass, text = 'book') {
    return {type: 'term', headwords: [{term: 'book', wordClasses: [wordClass], sources: [{originalText: text}]}], definitions: [{tags: []}]};
}

/**
 * Статьи выдачи в DOM: `.entry` с шапкой и телом, как у term-entry-template.
 * @param {number} count
 */
function renderEntryNodes(count) {
    const container = /** @type {HTMLElement} */ (document.querySelector('#dictionary-entries'));
    container.replaceChildren();
    for (let i = 0; i < Math.max(1, count); ++i) {
        const node = document.createElement('div');
        node.className = 'entry';
        const header = document.createElement('div');
        header.className = 'entry-header';
        const body = document.createElement('div');
        body.className = 'entry-body';
        node.append(header, body);
        container.appendChild(node);
    }
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
        /** @type {number} */
        this.depth = 0;
        /** @type {{state: ?{sentence?: {text: string, offset: number}, url?: string}}} */
        this.history = {state: null};
        /** @type {import('vitest').Mock} */
        this.getOptions = vi.fn(() => ({flibTranslation: {blur: false}}));
        /** @type {import('vitest').Mock} */
        this.getOptionsContext = vi.fn(() => ({url: 'https://example.com/'}));
        /**
         *
         */
        this.focusEntryDefinition = vi.fn((/** @type {number} */ index, /** @type {number} */ _definitionIndex) => {
            this.selectedIndex = index;
            this.trigger('currentEntryChanged', {index: this.selectedIndex});
        });
    }

    /** @returns {HTMLElement[]} */
    get dictionaryEntryNodes() {
        return [...document.querySelectorAll('#dictionary-entries > .entry')].map((node) => /** @type {HTMLElement} */ (node));
    }

    /**
     * @param {object[]} entries
     * @param {string} sentence
     * @param {{url?: string}} [state]
     */
    show(entries, sentence, state = {}) {
        this.dictionaryEntries = entries;
        this.selectedIndex = 0;
        renderEntryNodes(entries.length);
        this.history.state = {sentence: {text: sentence, offset: 0}, ...state};
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

/** @returns {Element[]} */
const strips = () => [...document.querySelectorAll('.fc-sentence-tr')];

/**
 * @template T
 * @returns {{promise: Promise<T>, resolve: (value: T) => void, reject: (reason: unknown) => void}}
 */
function deferred() {
    /** @type {(value: T) => void} */
    let resolve = () => {};
    /** @type {(reason: unknown) => void} */
    let reject = () => {};
    /** @type {Promise<T>} */
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return {promise, resolve, reject};
}

describe('DisplayPosHint', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    /** @type {FakeDisplay} */
    let display;
    /** @type {import('vitest').Mock} */
    let detect;
    /** @type {import('vitest').Mock} */
    let lookup;
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
        const entries = document.createElement('div');
        entries.id = 'dictionary-entries';
        document.body.appendChild(entries);
        renderEntryNodes(1);
        display = new FakeDisplay();
        detect = vi.fn(async () => ({pos: 'verb', translation: TRANSLATION}));
        lookup = vi.fn(async () => ({translation: null}));
        new DisplayPosHint(/** @type {*} */ (display), {api: /** @type {*} */ ({flibPosDetect: detect, flibSentenceTranslationGet: lookup})}).prepare();
        button = /** @type {HTMLButtonElement} */ (top.querySelector('button.fc-strip-pos'));
        label = /** @type {HTMLElement} */ (top.querySelector('.fc-strip-pos-label'));
    });
    afterEach(async () => {
        vi.restoreAllMocks();
        await env.teardown(global);
    });

    test('disabled without a sentence of two words; one POS without a cached translation is enabled', () => {
        expect(button.disabled).toBe(true);
        display.show([entry('n')], 'book a table');
        expect(button.disabled).toBe(false);
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
    ])('enabled with %s while no translation is cached: the click is for the translation', async (_name, entries) => {
        display.show(entries, 'book a table');
        await flush();
        expect(button.disabled).toBe(false);
    });

    test('enabled with two entries and a sentence', () => {
        display.show([entry('n'), entry('v')], 'book a table');
        expect(button.disabled).toBe(false);
    });

    test('moves to matching entry and labels it', async () => {
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        await flush();
        expect(detect).toHaveBeenCalledWith('book', 'book a table', true);
        expect(display.focusEntryDefinition).toHaveBeenCalledWith(1, 0);
        expect(label.textContent).toBe('гл.');
        expect(label.dataset.miss).toBeUndefined();
        expect(button.title).toContain('глагол');
    });

    test('asks with the form from the text, not the headword', async () => {
        display.show([entry('n', 'booked'), entry('v', 'booked')], 'I booked a table');
        button.click();
        await flush();
        expect(detect).toHaveBeenCalledWith('booked', 'I booked a table', true);
    });

    test('current entry matches: focuses it from the top', async () => {
        display.show([entry('v'), entry('n')], 'book a table');
        button.click();
        await flush();
        expect(display.focusEntryDefinition).toHaveBeenCalledWith(0, 0);
        expect(label.textContent).toBe('гл.');
    });

    test('no entry: says so and stays', async () => {
        detect.mockResolvedValueOnce({pos: 'adverb', translation: TRANSLATION});
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
        /** @type {(value: {pos: string, translation: string}) => void} */
        let resolve = () => {};
        detect.mockImplementationOnce(() => new Promise((r) => { resolve = r; }));
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        display.show([entry('n'), entry('v')], 'a book on the table');
        resolve({pos: 'verb', translation: TRANSLATION});
        await flush();
        expect(display.focusEntryDefinition).not.toHaveBeenCalled();
        expect(label.textContent).toBe('');
        expect(strips()).toHaveLength(0);
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
    ])('error %s has its own text and shows no strip', async (code, text) => {
        detect.mockRejectedValueOnce(gatewayError(code));
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        await flush();
        expect(button.title).toContain(text);
        expect(label.textContent).toBe('!');
        expect(label.dataset.error).toBe('true');
        expect(strips()).toHaveLength(0);
    });

    test('content clear resets the label and removes the strip', async () => {
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        await flush();
        expect(strips()).toHaveLength(1);
        display.trigger('contentClear', {});
        expect(label.textContent).toBe('');
        expect(button.disabled).toBe(true);
        expect(strips()).toHaveLength(0);
    });

    test('one POS, no cached translation: the click translates, the strip stands right above the entry body', async () => {
        display.show([entry('n')], 'book a table');
        await flush();
        expect(button.disabled).toBe(false);
        button.click();
        await flush();
        expect(detect).toHaveBeenCalledWith('book', 'book a table', true);
        const [strip] = strips();
        expect(strips()).toHaveLength(1);
        expect(strip.parentElement).toBe(display.dictionaryEntryNodes[0]);
        expect(strip.nextElementSibling?.classList.contains('entry-body')).toBe(true);
        expect(strip.textContent).toBe(TRANSLATION);
        // Одна часть речи: «нет статьи» не говорится, метка пустая.
        expect(label.dataset.miss).toBeUndefined();
        expect(label.textContent).toBe('');
        // Перевод уже виден, а выбирать не из чего: второй платный запрос не нужен.
        expect(button.disabled).toBe(true);
        expect(button.title).toBe(translate('pos.button'));
    });

    test('Anki lines inserted after the header stay above the strip', async () => {
        lookup.mockResolvedValue({translation: 'Т.'});
        display.show([entry('n')], 'book a table');
        await flush();
        const node = display.dictionaryEntryNodes[0];
        const header = /** @type {Element} */ (node.querySelector('.entry-header'));
        const ankiLine = document.createElement('div');
        ankiLine.className = 'anki-line';
        header.after(ankiLine);
        display.trigger('contentUpdateComplete', {type: 'terms'});
        await flush();
        const [strip] = strips();
        expect(strip.previousElementSibling).toBe(ankiLine);
        expect(strip.nextElementSibling?.classList.contains('entry-body')).toBe(true);
    });

    test('one POS, translation cached: the strip shows without a click and the button is disabled', async () => {
        lookup.mockResolvedValue({translation: 'Т.'});
        display.show([entry('n')], 'book a table');
        await flush();
        expect(lookup).toHaveBeenCalledWith('book a table');
        expect(strips()).toHaveLength(1);
        expect(strips()[0].textContent).toBe('Т.');
        expect(button.disabled).toBe(true);
        expect(button.title).toBe(translate('pos.button'));
        expect(detect).not.toHaveBeenCalled();
    });

    test('two POS, translation cached: the button stays enabled', async () => {
        lookup.mockResolvedValue({translation: 'Т.'});
        display.show([entry('n'), entry('v')], 'book a table');
        await flush();
        expect(strips()).toHaveLength(1);
        expect(button.disabled).toBe(false);
    });

    test('nested popup: the old rules, POS only, no strip; a repeat is free', async () => {
        display.depth = 1;
        lookup.mockResolvedValue({translation: 'Т.'});
        display.show([entry('n')], 'book a table');
        await flush();
        expect(button.disabled).toBe(true);
        detect.mockResolvedValue({pos: 'verb', translation: null});
        display.show([entry('n'), entry('v')], 'book a table');
        await flush();
        button.click();
        await flush();
        expect(detect).toHaveBeenCalledWith('book', 'book a table', false);
        button.click();
        await flush();
        expect(detect).toHaveBeenCalledTimes(1);
        expect(display.focusEntryDefinition).toHaveBeenCalledTimes(2);
        expect(lookup).not.toHaveBeenCalled();
        expect(strips()).toHaveLength(0);
    });

    test('in-card lookup that replaced the root content (url of the popup page) behaves as nested', async () => {
        lookup.mockResolvedValue({translation: 'Т.'});
        display.show([entry('n')], 'book a table', {url: window.location.href});
        await flush();
        expect(button.disabled).toBe(true);
        expect(lookup).not.toHaveBeenCalled();
        display.show([entry('n'), entry('v')], 'book a table', {url: window.location.href});
        button.click();
        await flush();
        expect(detect).toHaveBeenCalledWith('book', 'book a table', false);
        expect(strips()).toHaveLength(0);
    });

    test('a page url on another origin is not nested', async () => {
        lookup.mockResolvedValue({translation: 'Т.'});
        display.show([entry('n')], 'book a table', {url: 'https://example.com/page'});
        await flush();
        expect(lookup).toHaveBeenCalledTimes(1);
        expect(strips()).toHaveLength(1);
    });

    test('late lookup for the previous sentence paints nothing', async () => {
        /** @type {ReturnType<typeof deferred<{translation: ?string}>>} */
        const first = deferred();
        lookup.mockImplementationOnce(() => first.promise);
        display.show([entry('n')], 'book a table');
        display.show([entry('n')], 'a book on the table');
        first.resolve({translation: 'Т.'});
        await flush();
        expect(strips()).toHaveLength(0);
    });

    test('late click answer for the previous sentence paints nothing', async () => {
        /** @type {ReturnType<typeof deferred<{pos: string, translation: string}>>} */
        const answer = deferred();
        detect.mockImplementationOnce(() => answer.promise);
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        display.show([entry('n'), entry('v')], 'a book on the table');
        answer.resolve({pos: 'verb', translation: TRANSLATION});
        await flush();
        expect(strips()).toHaveLength(0);
        expect(label.textContent).toBe('');
    });

    test('POS without translation: nothing is remembered, a second click asks again', async () => {
        detect.mockResolvedValue({pos: 'verb', translation: null});
        display.show([entry('n')], 'book a table');
        button.click();
        await flush();
        expect(strips()).toHaveLength(0);
        expect(button.disabled).toBe(false);
        button.click();
        await flush();
        expect(detect).toHaveBeenCalledTimes(2);
    });

    test('translation without POS: the strip shows, the label says llm_bad_answer', async () => {
        detect.mockResolvedValueOnce({pos: null, translation: 'Т.'});
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        await flush();
        expect(strips()).toHaveLength(1);
        expect(strips()[0].textContent).toBe('Т.');
        expect(label.textContent).toBe('!');
        expect(label.dataset.error).toBe('true');
        expect(button.title).toContain('непонятный ответ');
        // Часть речи не пришла: повтор идёт в фоновую часть, а не в кеш страницы.
        button.click();
        await flush();
        expect(detect).toHaveBeenCalledTimes(2);
    });

    test('translation without POS for a single-POS word: the strip shows, no dead-end error mark', async () => {
        detect.mockResolvedValueOnce({pos: null, translation: 'Т.'});
        display.show([entry('n')], 'book a table');
        button.click();
        await flush();
        expect(strips()).toHaveLength(1);
        expect(strips()[0].textContent).toBe('Т.');
        expect(label.textContent).toBe('');
        expect(label.dataset.error).toBeUndefined();
        expect(button.disabled).toBe(true);
        expect(button.title).toBe(translate('pos.button'));
    });

    test.each([
        ['empty', ''],
        ['blank', '   '],
    ])('an %s translation in the click answer paints no strip', async (_name, translation) => {
        detect.mockResolvedValueOnce({pos: 'verb', translation});
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        await flush();
        expect(strips()).toHaveLength(0);
        expect(label.textContent).toBe('гл.');
    });

    test('a blank translation from the lookup paints no strip', async () => {
        lookup.mockResolvedValue({translation: '  '});
        display.show([entry('n')], 'book a table');
        await flush();
        expect(strips()).toHaveLength(0);
        expect(button.disabled).toBe(false);
    });

    test('one POS, an earlier error, then a POS with no target: label and message are both reset', async () => {
        detect.mockRejectedValueOnce(gatewayError('flib_rate_limited'));
        detect.mockResolvedValueOnce({pos: 'verb', translation: null});
        display.show([entry('n')], 'book a table');
        button.click();
        await flush();
        expect(button.title).toContain('Слишком часто');
        button.click();
        await flush();
        expect(label.textContent).toBe('');
        expect(label.dataset.error).toBeUndefined();
        expect(button.title).toBe(translate('pos.button'));
    });

    test('blurred on a flib host: a click opens it, the phrase stays open for another word', async () => {
        display.getOptionsContext.mockReturnValue({url: 'https://flib.club/x'});
        lookup.mockResolvedValue({translation: 'Т.'});
        display.show([entry('n')], 'book a table');
        await flush();
        const blurredButton = /** @type {HTMLButtonElement} */ (document.querySelector('.fc-sentence-tr button.fc-sentence-tr-blurred'));
        expect(blurredButton).not.toBe(null);
        blurredButton.click();
        expect(document.querySelector('.fc-sentence-tr button')).toBe(null);
        expect(strips()).toHaveLength(1);
        expect(strips()[0].textContent).toBe('Т.');
        display.show([entry('n', 'table')], 'book a table');
        await flush();
        expect(strips()).toHaveLength(1);
        expect(document.querySelector('.fc-sentence-tr button')).toBe(null);
        expect(strips()[0].textContent).toBe('Т.');
    });

    test('blurred by the option, even right after the click', async () => {
        display.getOptions.mockReturnValue({flibTranslation: {blur: true}});
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        await flush();
        expect(document.querySelector('.fc-sentence-tr button.fc-sentence-tr-blurred')).not.toBe(null);
    });

    test('options not loaded yet: open on an ordinary page, blurred on a flib host', async () => {
        display.getOptions.mockReturnValue(null);
        lookup.mockResolvedValue({translation: 'Т.'});
        display.show([entry('n')], 'book a table');
        await flush();
        expect(document.querySelector('.fc-sentence-tr button')).toBe(null);
        display.getOptionsContext.mockReturnValue({url: 'https://flib.club/x'});
        display.show([entry('n')], 'a book on the table');
        await flush();
        expect(document.querySelector('.fc-sentence-tr button.fc-sentence-tr-blurred')).not.toBe(null);
    });

    test('exactly one strip after two updates in a row; none after clear', async () => {
        lookup.mockResolvedValue({translation: 'Т.'});
        display.show([entry('n')], 'book a table');
        await flush();
        display.trigger('contentUpdateComplete', {type: 'terms'});
        display.trigger('contentUpdateComplete', {type: 'terms'});
        await flush();
        expect(strips()).toHaveLength(1);
        display.trigger('contentClear', {});
        expect(strips()).toHaveLength(0);
    });

    test('a «?» answer that focuses another entry moves the strip into that entry first', async () => {
        /** @type {boolean[]} */
        const stripInTargetAtFocus = [];
        display.focusEntryDefinition.mockImplementation((/** @type {number} */ index) => {
            stripInTargetAtFocus.push(display.dictionaryEntryNodes[index].querySelector(':scope > .fc-sentence-tr') !== null);
        });
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        await flush();
        const [first, second] = display.dictionaryEntryNodes;
        expect(first.querySelector('.fc-sentence-tr')).toBe(null);
        expect(second.querySelector(':scope > .fc-sentence-tr')).not.toBe(null);
        expect(strips()).toHaveLength(1);
        expect(stripInTargetAtFocus).toEqual([true]);
    });

    test('page cache keeps the translation: a free repeat repaints the strip', async () => {
        display.show([entry('n')], 'book a table');
        button.click();
        await flush();
        display.show([entry('n')], 'a book on the table');
        await flush();
        display.show([entry('n')], 'book a table');
        await flush();
        expect(strips()).toHaveLength(0);
        button.click();
        await flush();
        expect(strips()).toHaveLength(1);
        expect(strips()[0].textContent).toBe(TRANSLATION);
        expect(detect).toHaveBeenCalledTimes(1);
    });

    test('a failed lookup paints nothing, is logged without the badge, and the button still works', async () => {
        const logError = vi.spyOn(log, 'error').mockImplementation(() => {});
        const logGeneric = vi.spyOn(log, 'logGenericError').mockImplementation(() => {});
        lookup.mockRejectedValueOnce(new Error('cache down'));
        display.show([entry('n')], 'book a table');
        await flush();
        expect(strips()).toHaveLength(0);
        // Level `log`: the backend does not light the red «!!» on the icon.
        expect(logGeneric).toHaveBeenCalledTimes(1);
        expect(logGeneric).toHaveBeenCalledWith(expect.objectContaining({message: 'cache down'}), 'log');
        expect(logError).not.toHaveBeenCalled();
        expect(button.disabled).toBe(false);
        button.click();
        await flush();
        expect(detect).toHaveBeenCalledTimes(1);
        expect(strips()).toHaveLength(1);
    });

    test('a lookup that answers null after the click painted the strip does not remove it', async () => {
        /** @type {ReturnType<typeof deferred<{translation: ?string}>>} */
        const pending = deferred();
        lookup.mockImplementationOnce(() => pending.promise);
        display.show([entry('n'), entry('v')], 'book a table');
        button.click();
        await flush();
        expect(strips()).toHaveLength(1);
        pending.resolve({translation: null});
        await flush();
        expect(strips()).toHaveLength(1);
        expect(strips()[0].textContent).toBe(TRANSLATION);
    });

    describe('sentence over the 1000-char limit (normalized): POS only, like a nested popup', () => {
        const longSentence = `book ${'a '.repeat(500)}table`;

        test('single POS: the button is disabled and nothing is looked up', async () => {
            expect(longSentence.length).toBeGreaterThan(1000);
            lookup.mockResolvedValue({translation: 'Т.'});
            display.show([entry('n')], longSentence);
            await flush();
            expect(button.disabled).toBe(true);
            expect(lookup).not.toHaveBeenCalled();
            expect(strips()).toHaveLength(0);
        });

        test('two POS: detect without translation, and a repeat is free', async () => {
            detect.mockResolvedValue({pos: 'verb', translation: null});
            display.show([entry('n'), entry('v')], longSentence);
            await flush();
            expect(lookup).not.toHaveBeenCalled();
            button.click();
            await flush();
            expect(detect).toHaveBeenCalledWith('book', longSentence, false);
            button.click();
            await flush();
            expect(detect).toHaveBeenCalledTimes(1);
            expect(display.focusEntryDefinition).toHaveBeenCalledTimes(2);
            expect(strips()).toHaveLength(0);
        });

        test('whitespace padding does not count: a short normalized sentence still translates', async () => {
            const padded = `book${' '.repeat(1200)}a table`;
            display.show([entry('n')], padded);
            await flush();
            expect(lookup).toHaveBeenCalledTimes(1);
            expect(button.disabled).toBe(false);
            button.click();
            await flush();
            expect(detect).toHaveBeenCalledWith('book', padded, true);
            expect(strips()).toHaveLength(1);
        });
    });

    test.each([
        ['a POS with no matching entry', {pos: 'adverb', translation: TRANSLATION}],
        ['no POS at all', {pos: null, translation: TRANSLATION}],
    ])('answer with %s: the strip goes into the entry the user is on, not entry 0', async (_name, answer) => {
        detect.mockResolvedValueOnce(answer);
        display.show([entry('n'), entry('v'), entry('n')], 'book a table');
        await flush();
        display.selectedIndex = 2;
        button.click();
        await flush();
        expect(strips()).toHaveLength(1);
        expect(display.dictionaryEntryNodes[2].querySelector(':scope > .fc-sentence-tr')).not.toBe(null);
    });

    test('auto-shown strip survives a click that fails at the gateway', async () => {
        lookup.mockResolvedValue({translation: 'Т.'});
        detect.mockRejectedValueOnce(gatewayError('flib_rate_limited'));
        display.show([entry('n'), entry('v')], 'book a table');
        await flush();
        expect(strips()).toHaveLength(1);
        button.click();
        await flush();
        expect(strips()).toHaveLength(1);
        expect(strips()[0].textContent).toBe('Т.');
        expect(label.textContent).toBe('!');
        expect(label.dataset.error).toBe('true');
    });
});
