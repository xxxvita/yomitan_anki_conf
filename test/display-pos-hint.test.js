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
import {FLIB_SENTENCE_MAX_CHARS} from '../ext/js/data/flib-pos.js';
import {DisplayPosHint} from '../ext/js/display/display-pos-hint.js';
import {messagesEn} from '../ext/js/i18n/messages-en.js';
import {messagesRu} from '../ext/js/i18n/messages-ru.js';
import {setUiLanguage, translate} from '../ext/js/i18n/ui-language.js';
import {setupDomTest} from './fixtures/dom-test.js';

const TRANSLATION = 'Я забронировал столик.';
const PHRASE = 'It was worth the wait.';
const PHRASE_RU = 'Ожидание того стоило.';

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
        /** @type {string} */
        this.contentType = 'clear';
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
        this.contentType = 'terms';
        this.trigger('contentUpdateComplete', {type: 'terms'});
    }

    /**
     * Окно фразы (phrase-entry-template, display.js _setContentPhrase).
     * @param {string} text
     * @returns {{english: HTMLTextAreaElement, translation: HTMLTextAreaElement, split: HTMLElement, node: HTMLElement}}
     */
    showPhrase(text) {
        // Порядок display.js: contentClear, затем смена типа, затем новая выдача.
        this.trigger('contentClear', {});
        this.dictionaryEntries = [];
        this.selectedIndex = 0;
        this.contentType = 'phrase';
        this.history.state = {};
        const container = /** @type {HTMLElement} */ (document.querySelector('#dictionary-entries'));
        container.replaceChildren();
        const node = document.createElement('div');
        node.className = 'entry';
        node.dataset.type = 'phrase';
        const split = document.createElement('div');
        split.className = 'phrase-split';
        const english = document.createElement('textarea');
        english.className = 'phrase-text phrase-expression-input';
        english.value = text;
        const translation = document.createElement('textarea');
        translation.className = 'phrase-translate-input';
        split.append(english, translation);
        node.appendChild(split);
        container.appendChild(node);
        this.trigger('contentUpdateComplete', {type: 'phrase'});
        return {english, translation, split, node};
    }
}

/**
 * Ввод пользователя в поле.
 * @param {HTMLTextAreaElement} field
 * @param {string} value
 */
function type(field, value) {
    field.value = value;
    field.dispatchEvent(new Event('input', {bubbles: true}));
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
    /** @type {import('vitest').Mock} */
    let translateSentence;
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
        translateSentence = vi.fn(async () => ({translation: PHRASE_RU}));
        new DisplayPosHint(/** @type {*} */ (display), {api: /** @type {*} */ ({flibPosDetect: detect, flibSentenceTranslationGet: lookup, flibSentenceTranslate: translateSentence})}).prepare();
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

    describe('phrase window', () => {
        /** @returns {HTMLElement[]} */
        const phraseStrips = () => [...document.querySelectorAll('.fc-phrase-tr')].map((node) => /** @type {HTMLElement} */ (node));
        /** @returns {?string} */
        const stripText = () => document.querySelector('.fc-phrase-tr-text')?.textContent ?? null;
        /** @returns {HTMLButtonElement} */
        const insertButton = () => /** @type {HTMLButtonElement} */ (document.querySelector('.fc-phrase-tr-insert'));
        /** @returns {HTMLButtonElement} */
        const closeButton = () => /** @type {HTMLButtonElement} */ (document.querySelector('.fc-phrase-tr-close'));

        /** @returns {Promise<void>} */
        async function press() {
            button.click();
            await flush();
        }

        test('opening the window asks nothing and fills nothing; the button is ready', async () => {
            const {translation} = display.showPhrase(PHRASE);
            await flush();
            expect(button.disabled).toBe(false);
            expect(button.title).toBe('Перевести фразу');
            expect(button.getAttribute('aria-label')).toBe('Перевести фразу');
            expect(translation.value).toBe('');
            expect(translateSentence).not.toHaveBeenCalled();
            expect(lookup).not.toHaveBeenCalled();
            expect(detect).not.toHaveBeenCalled();
        });

        test('English labels', () => {
            setUiLanguage('en');
            display.showPhrase(PHRASE);
            expect(button.title).toBe('Translate the phrase');
        });

        test.each([
            ['empty', ''],
            ['blank', '  \n '],
            ['no Latin letter', 'Привет, 123!'],
        ])('%s English field: disabled with its own tooltip, the press asks nothing', async (_name, text) => {
            display.showPhrase(text);
            expect(button.disabled).toBe(true);
            expect(button.title).toBe(translate('pos.phraseNoEnglish'));
            await press();
            expect(translateSentence).not.toHaveBeenCalled();
        });

        test('length after normalization: 1000 is fine, 1001 is too long', () => {
            display.showPhrase(`${'a'.repeat(499)}${' '.repeat(900)}${'b'.repeat(500)}`);
            expect(button.disabled).toBe(false);
            display.showPhrase('a'.repeat(1001));
            expect(button.disabled).toBe(true);
            expect(button.title).toBe(translate('pos.phraseTooLong', {max: FLIB_SENTENCE_MAX_CHARS}));
            expect(button.title).toBe('Фраза слишком длинная — не больше 1000 знаков');
            // Предел стоит в одном месте — в константе, не в тексте.
            for (const messages of [messagesRu, messagesEn]) {
                expect(messages['pos.phraseTooLong']).toContain('{max}');
                expect(messages['pos.phraseTooLong']).not.toMatch(/\d/);
            }
        });

        test('state follows every input in the English field', () => {
            const {english} = display.showPhrase('');
            expect(button.disabled).toBe(true);
            type(english, PHRASE);
            expect(button.disabled).toBe(false);
            expect(button.title).toBe(translate('pos.phraseButton'));
            type(english, 'a'.repeat(1001));
            expect(button.title).toBe(translate('pos.phraseTooLong', {max: FLIB_SENTENCE_MAX_CHARS}));
            type(english, '');
            expect(button.title).toBe(translate('pos.phraseNoEnglish'));
        });

        test('fills the empty field with the whole English field translated; the strip of words stays away', async () => {
            const {english, translation} = display.showPhrase(PHRASE);
            type(english, 'It was worth the long wait.');
            await press();
            expect(translateSentence.mock.calls).toStrictEqual([['It was worth the long wait.', true]]);
            expect(translation.value).toBe(PHRASE_RU);
            expect(phraseStrips()).toHaveLength(0);
            expect(strips()).toHaveLength(0);
            expect(label.textContent).toBe('');
            expect(detect).not.toHaveBeenCalled();
            // Перевод этой фразы уже в поле.
            expect(button.disabled).toBe(true);
            expect(button.title).toBe(translate('pos.phraseAlready'));
            expect(button.getAttribute('aria-busy')).toBe('false');
        });

        test('a blank field counts as empty', async () => {
            const {translation} = display.showPhrase(PHRASE);
            type(translation, ' \n ');
            await press();
            expect(translation.value).toBe(PHRASE_RU);
            expect(phraseStrips()).toHaveLength(0);
        });

        test('the write tells the page: one bubbling input event, the value already there, the state already right', async () => {
            const {translation} = display.showPhrase(PHRASE);
            /** @type {string[]} */
            const seen = [];
            document.body.addEventListener('input', (e) => {
                seen.push(/** @type {HTMLTextAreaElement} */ (e.target).value, button.title);
            });
            await press();
            expect(seen).toStrictEqual([PHRASE_RU, translate('pos.phraseAlready')]);
            expect(translation.value).toBe(PHRASE_RU);
            expect(button.title).toBe(translate('pos.phraseAlready'));
        });

        test('server text with line breaks is compared as the field keeps it', async () => {
            translateSentence.mockResolvedValue({translation: ' Раз.\r\nДва. '});
            const {english, translation} = display.showPhrase(PHRASE);
            await press();
            expect(translation.value).toBe('Раз.\nДва.');
            expect(button.title).toBe(translate('pos.phraseAlready'));
            type(english, 'Another phrase.');
            translateSentence.mockResolvedValue({translation: 'Другая фраза.'});
            await press();
            expect(translation.value).toBe('Другая фраза.');
            expect(phraseStrips()).toHaveLength(0);
        });

        test('busy: disabled, one request on a double click', async () => {
            /** @type {ReturnType<typeof deferred<{translation: string}>>} */
            const answer = deferred();
            translateSentence.mockImplementationOnce(() => answer.promise);
            const {english} = display.showPhrase(PHRASE);
            button.click();
            button.click();
            expect(button.disabled).toBe(true);
            expect(button.getAttribute('aria-busy')).toBe('true');
            // Ввод во время запроса не будит кнопку.
            type(english, `${PHRASE} `);
            expect(button.disabled).toBe(true);
            answer.resolve({translation: PHRASE_RU});
            await flush();
            expect(translateSentence).toHaveBeenCalledTimes(1);
            expect(button.getAttribute('aria-busy')).toBe('false');
        });

        test('the line «Пропуск: …» stays next to the fields, the strip is under it', async () => {
            const {translation, split} = display.showPhrase(PHRASE);
            const line = Object.assign(document.createElement('div'), {className: 'fc-ph-blank'});
            split.after(line);
            type(translation, 'Мой перевод');
            await press();
            expect(split.nextElementSibling).toBe(line);
            expect(line.nextElementSibling).toBe(phraseStrips()[0]);
        });

        test('the strip is brought into view when it appears, only as far as needed; the field and its focus stay', async () => {
            const {translation} = display.showPhrase(PHRASE);
            /** @type {[Element, unknown][]} */
            const scrolls = [];
            window.Element.prototype.scrollIntoView = function scrollIntoView(/** @type {unknown} */ options) { scrolls.push([this, options]); };
            try {
                type(translation, 'Мой перевод');
                await press();
                const [strip] = phraseStrips();
                expect(scrolls).toStrictEqual([[strip, {block: 'nearest', inline: 'nearest'}]]);
                expect(strip.isConnected).toBe(true);
                closeButton().click();
                expect(scrolls).toHaveLength(1);
                // Into an empty field: no strip, nothing is scrolled.
                type(translation, '');
                await press();
                expect(translation.value).toBe(PHRASE_RU);
                expect(scrolls).toHaveLength(1);
            } finally {
                Reflect.deleteProperty(window.Element.prototype, 'scrollIntoView');
            }
        });

        test('the user\'s own text stays: strip under the fields → insert', async () => {
            const {translation, split, node} = display.showPhrase(PHRASE);
            type(translation, 'Мой перевод');
            expect(button.disabled).toBe(false);
            await press();
            expect(translation.value).toBe('Мой перевод');
            expect(phraseStrips()).toHaveLength(1);
            expect(phraseStrips()[0].parentElement).toBe(node);
            expect(split.nextElementSibling).toBe(phraseStrips()[0]);
            expect(stripText()).toBe(PHRASE_RU);
            // Поле занято чужим текстом: просить снова можно.
            expect(button.disabled).toBe(false);
            const onInput = vi.fn();
            translation.addEventListener('input', onInput);
            insertButton().click();
            expect(translation.value).toBe(PHRASE_RU);
            expect(onInput).toHaveBeenCalledTimes(1);
            expect(phraseStrips()).toHaveLength(0);
            expect(button.disabled).toBe(true);
            expect(button.title).toBe(translate('pos.phraseAlready'));
            expect(document.activeElement).toBe(translation);
        });

        test('the user\'s own text stays: strip → close', async () => {
            const {translation} = display.showPhrase(PHRASE);
            type(translation, 'Мой перевод');
            await press();
            closeButton().click();
            expect(phraseStrips()).toHaveLength(0);
            expect(translation.value).toBe('Мой перевод');
            expect(button.disabled).toBe(false);
            await press();
            expect(phraseStrips()).toHaveLength(1);
        });

        test('asking again repaints one strip, never two', async () => {
            const {translation} = display.showPhrase(PHRASE);
            type(translation, 'Мой перевод');
            await press();
            translateSentence.mockResolvedValue({translation: 'Иначе.'});
            await press();
            expect(phraseStrips()).toHaveLength(1);
            expect(stripText()).toBe('Иначе.');
        });

        test('after the strip the user clears the field and asks: the field is filled, the strip goes', async () => {
            const {translation} = display.showPhrase(PHRASE);
            type(translation, 'Мой перевод');
            await press();
            type(translation, '');
            expect(phraseStrips()).toHaveLength(1);
            await press();
            expect(translation.value).toBe(PHRASE_RU);
            expect(phraseStrips()).toHaveLength(0);
        });

        test('the strip never writes the model answer as markup', async () => {
            translateSentence.mockResolvedValue({translation: '<b>Т.</b>'});
            const {translation} = display.showPhrase(PHRASE);
            type(translation, 'Мой перевод');
            await press();
            expect(stripText()).toBe('<b>Т.</b>');
            expect(document.querySelector('.fc-phrase-tr b')).toBe(null);
        });

        test('own automatic text is replaced after the English changes', async () => {
            const {english, translation} = display.showPhrase(PHRASE);
            await press();
            type(english, 'It was not worth the wait.');
            expect(button.disabled).toBe(false);
            translateSentence.mockResolvedValue({translation: 'Ожидание того не стоило.'});
            await press();
            expect(translation.value).toBe('Ожидание того не стоило.');
            expect(phraseStrips()).toHaveLength(0);
            expect(button.title).toBe(translate('pos.phraseAlready'));
            // Прежняя фраза: её перевода в поле уже нет.
            type(english, PHRASE);
            expect(button.disabled).toBe(false);
        });

        test('edited automatic text is the user\'s text', async () => {
            const {translation} = display.showPhrase(PHRASE);
            await press();
            type(translation, `${PHRASE_RU} Да.`);
            expect(button.disabled).toBe(false);
            expect(button.title).toBe(translate('pos.phraseButton'));
            await press();
            expect(translation.value).toBe(`${PHRASE_RU} Да.`);
            expect(phraseStrips()).toHaveLength(1);
            // Вернул автоперевод дословно — просить нечего.
            type(translation, PHRASE_RU);
            expect(button.title).toBe(translate('pos.phraseAlready'));
        });

        test('a strip that was never inserted does not become the automatic text', async () => {
            const {english, translation} = display.showPhrase(PHRASE);
            type(translation, 'Мой перевод');
            await press();
            type(translation, PHRASE_RU);
            type(english, 'Another phrase.');
            translateSentence.mockResolvedValue({translation: 'Другая фраза.'});
            await press();
            expect(translation.value).toBe(PHRASE_RU);
            expect(stripText()).toBe('Другая фраза.');
        });

        test('the user typed the answer word for word: no strip, nothing written, and the text stays the user\'s', async () => {
            translateSentence.mockResolvedValue({translation: 'Да.'});
            const {english, translation} = display.showPhrase('Yes.');
            type(translation, 'Да.');
            expect(button.disabled).toBe(false);
            const onInput = vi.fn();
            translation.addEventListener('input', onInput);
            await press();
            expect(translation.value).toBe('Да.');
            expect(onInput).not.toHaveBeenCalled();
            expect(phraseStrips()).toHaveLength(0);
            expect(button.disabled).toBe(true);
            expect(button.title).toBe(translate('pos.phraseAlready'));

            type(english, 'Yes, sure.');
            expect(button.disabled).toBe(false);
            translateSentence.mockResolvedValue({translation: 'Да, конечно.'});
            await press();
            expect(translation.value).toBe('Да.');
            expect(stripText()).toBe('Да, конечно.');
            expect(onInput).not.toHaveBeenCalled();
        });

        test('the user\'s text that repeats an answer of several lines: same, whatever line breaks the server sent', async () => {
            translateSentence.mockResolvedValue({translation: 'Раз.\r\nДва.\rТри.'});
            const {english, translation} = display.showPhrase(PHRASE);
            type(translation, 'Раз.\nДва.\nТри.');
            await press();
            expect(phraseStrips()).toHaveLength(0);
            expect(button.title).toBe(translate('pos.phraseAlready'));
            type(english, 'Another phrase.');
            translateSentence.mockResolvedValue({translation: 'Другая фраза.'});
            await press();
            expect(translation.value).toBe('Раз.\nДва.\nТри.');
            expect(stripText()).toBe('Другая фраза.');
        });

        test('our own text stays ours when another phrase has the same translation', async () => {
            const {english, translation} = display.showPhrase('Yes.');
            translateSentence.mockResolvedValue({translation: 'Да.'});
            await press();
            type(english, 'Yes!');
            await press();
            expect(button.title).toBe(translate('pos.phraseAlready'));
            type(english, 'Yes, sure.');
            translateSentence.mockResolvedValue({translation: 'Да, конечно.'});
            await press();
            expect(translation.value).toBe('Да, конечно.');
            expect(phraseStrips()).toHaveLength(0);
        });

        test('the user\'s matching text, then cleared and asked again: now it is ours', async () => {
            translateSentence.mockResolvedValue({translation: 'Да.'});
            const {english, translation} = display.showPhrase('Yes.');
            type(translation, 'Да.');
            await press();
            type(translation, '');
            await press();
            expect(translation.value).toBe('Да.');
            type(english, 'Yes, sure.');
            translateSentence.mockResolvedValue({translation: 'Да, конечно.'});
            await press();
            expect(translation.value).toBe('Да, конечно.');
        });

        describe('insert goes through the undo history', () => {
            /** @type {import('vitest').Mock} */
            let execCommand;
            /** @type {{translation: HTMLTextAreaElement, english: HTMLTextAreaElement}} */
            let fields;
            /** @type {[string, string][]} Значение поля и подсказка кнопки в каждом событии input. */
            let seen;

            /**
             * Вставка браузера: заменяет выделение и сама шлёт input.
             * @param {string} text
             */
            function browserInsert(text) {
                const field = /** @type {HTMLTextAreaElement} */ (document.activeElement);
                field.setRangeText(text, field.selectionStart, field.selectionEnd, 'end');
                field.dispatchEvent(new Event('input', {bubbles: true}));
            }

            beforeEach(async () => {
                execCommand = vi.fn((_name, _ui, /** @type {string} */ text) => {
                    browserInsert(text);
                    return true;
                });
                Object.assign(document, {execCommand});
                translateSentence.mockResolvedValue({translation: 'Раз.\r\nДва.'});
                fields = display.showPhrase(PHRASE);
                type(fields.translation, 'Мой перевод');
                await press();
                seen = [];
                document.body.addEventListener('input', (e) => {
                    const field = /** @type {HTMLTextAreaElement} */ (e.target);
                    seen.push([field.value, button.title]);
                });
            });

            test('one insertText over the whole field, no second input event, the state right inside it', () => {
                insertButton().click();
                expect(execCommand.mock.calls).toStrictEqual([['insertText', false, 'Раз.\nДва.']]);
                expect(fields.translation.value).toBe('Раз.\nДва.');
                expect(seen).toStrictEqual([['Раз.\nДва.', translate('pos.phraseAlready')]]);
                expect(phraseStrips()).toHaveLength(0);
                expect(document.activeElement).toBe(fields.translation);
                expect(button.title).toBe(translate('pos.phraseAlready'));
            });

            test('undo gives the user\'s text back, and it is the user\'s', async () => {
                insertButton().click();
                type(fields.translation, 'Мой перевод');
                expect(button.disabled).toBe(false);
                await press();
                expect(fields.translation.value).toBe('Мой перевод');
                expect(phraseStrips()).toHaveLength(1);
            });

            test('inserted text is ours: replaced after the English changes', async () => {
                insertButton().click();
                type(fields.english, 'Another phrase.');
                translateSentence.mockResolvedValue({translation: 'Другая фраза.'});
                await press();
                expect(fields.translation.value).toBe('Другая фраза.');
                // Автоматическая запись — не через execCommand: он требует фокуса.
                expect(execCommand).toHaveBeenCalledTimes(1);
            });

            test.each([
                ['is missing', null],
                ['returns false', () => false],
                ['claims success but changes nothing', () => true],
                ['returns false over a write without an event', (/** @type {unknown} */ _name, /** @type {unknown} */ _ui, /** @type {string} */ text) => {
                    /** @type {HTMLTextAreaElement} */ (document.activeElement).value = text;
                    return false;
                }],
                ['leaves other text', (/** @type {unknown} */ _name, /** @type {unknown} */ _ui, /** @type {string} */ text) => {
                    browserInsert(text.slice(0, 2));
                    return true;
                }],
            ])('execCommand %s: the plain write with its input event', (_name, implementation) => {
                Object.assign(document, {execCommand: implementation ?? void 0});
                insertButton().click();
                expect(fields.translation.value).toBe('Раз.\nДва.');
                expect(seen.at(-1)).toStrictEqual(['Раз.\nДва.', translate('pos.phraseAlready')]);
                expect(button.title).toBe(translate('pos.phraseAlready'));
                expect(document.activeElement).toBe(fields.translation);
            });
        });

        test('an automatic fill takes no focus and no execCommand', async () => {
            const execCommand = vi.fn(() => true);
            Object.assign(document, {execCommand});
            const {english, translation} = display.showPhrase(PHRASE);
            english.focus();
            await press();
            expect(translation.value).toBe(PHRASE_RU);
            expect(document.activeElement).toBe(english);
            expect(execCommand).not.toHaveBeenCalled();
        });

        test('close: focus goes to «?», and to the field when «?» is off', async () => {
            const {translation} = display.showPhrase(PHRASE);
            await press();
            type(translation, `${PHRASE_RU} Да.`);
            await press();
            closeButton().focus();
            closeButton().click();
            expect(document.activeElement).toBe(button);
            await press();
            type(translation, PHRASE_RU);
            expect(button.disabled).toBe(true);
            closeButton().focus();
            closeButton().click();
            expect(document.activeElement).toBe(translation);
        });

        test('the user clears the field → it fills again', async () => {
            const {translation} = display.showPhrase(PHRASE);
            await press();
            type(translation, '');
            expect(button.disabled).toBe(false);
            await press();
            expect(translation.value).toBe(PHRASE_RU);
            expect(translateSentence).toHaveBeenCalledTimes(2);
        });

        test('spaces around and inside do not make a new phrase', async () => {
            const {english} = display.showPhrase(PHRASE);
            await press();
            type(english, `  ${PHRASE.replace(' ', '  ')} \n`);
            expect(button.title).toBe(translate('pos.phraseAlready'));
        });

        test('typing while the request is in flight: decided when the answer arrives', async () => {
            /** @type {ReturnType<typeof deferred<{translation: string}>>} */
            const first = deferred();
            translateSentence.mockImplementationOnce(() => first.promise);
            const {translation} = display.showPhrase(PHRASE);
            button.click();
            type(translation, 'Печатаю');
            first.resolve({translation: PHRASE_RU});
            await flush();
            expect(translation.value).toBe('Печатаю');
            expect(stripText()).toBe(PHRASE_RU);

            /** @type {ReturnType<typeof deferred<{translation: string}>>} */
            const second = deferred();
            translateSentence.mockImplementationOnce(() => second.promise);
            button.click();
            type(translation, '');
            second.resolve({translation: PHRASE_RU});
            await flush();
            expect(translation.value).toBe(PHRASE_RU);
        });

        test('answer dropped: the English text was edited in flight', async () => {
            /** @type {ReturnType<typeof deferred<{translation: string}>>} */
            const answer = deferred();
            translateSentence.mockImplementationOnce(() => answer.promise);
            const {english, translation} = display.showPhrase(PHRASE);
            button.click();
            type(english, 'Another phrase.');
            answer.resolve({translation: PHRASE_RU});
            await flush();
            expect(translation.value).toBe('');
            expect(phraseStrips()).toHaveLength(0);
            expect(label.textContent).toBe('');
            expect(button.disabled).toBe(false);
            expect(button.getAttribute('aria-busy')).toBe('false');
        });

        test('error dropped: the English text was edited in flight', async () => {
            /** @type {ReturnType<typeof deferred<{translation: string}>>} */
            const answer = deferred();
            translateSentence.mockImplementationOnce(() => answer.promise);
            const {english} = display.showPhrase(PHRASE);
            button.click();
            type(english, '');
            answer.reject(gatewayError('llm_rejected'));
            await flush();
            expect(label.textContent).toBe('');
            expect(button.title).toBe(translate('pos.phraseNoEnglish'));
        });

        test.each([
            ['another phrase', () => { display.showPhrase('Another phrase.'); }],
            ['the same phrase opened again', () => { display.showPhrase(PHRASE); }],
            ['a word', () => { display.show([entry('n')], 'book a table'); }],
            ['cleared content', () => { display.trigger('contentClear', {}); }],
        ])('answer dropped: the result changed to %s', async (_name, change) => {
            /** @type {ReturnType<typeof deferred<{translation: string}>>} */
            const answer = deferred();
            translateSentence.mockImplementationOnce(() => answer.promise);
            const {translation} = display.showPhrase(PHRASE);
            button.click();
            change();
            answer.resolve({translation: PHRASE_RU});
            await flush();
            expect(translation.value).toBe('');
            for (const field of document.querySelectorAll('textarea.phrase-translate-input')) {
                expect(/** @type {HTMLTextAreaElement} */ (field).value).toBe('');
            }
            expect(phraseStrips()).toHaveLength(0);
        });

        test('editing the English takes the strip of the old phrase away; spaces do not', async () => {
            const {english, translation} = display.showPhrase(PHRASE);
            type(translation, 'Мой перевод');
            await press();
            type(english, ` ${PHRASE}`);
            expect(phraseStrips()).toHaveLength(1);
            type(english, 'Another phrase.');
            expect(phraseStrips()).toHaveLength(0);
            expect(translation.value).toBe('Мой перевод');
        });

        test.each([
            ['flib_key_missing', 'pos.keyMissing'],
            ['flib_key_invalid', 'pos.keyInvalid'],
            ['flib_rate_limited', 'pos.rateLimited'],
            ['llm_bad_answer', 'pos.badAnswer'],
            ['llm_rejected', 'enrich.rejected'],
            ['flib_sentence_too_long', 'pos.phraseTooLong'],
            ['flib_word_empty', 'pos.phraseNoEnglish'],
            ['flib_service_unavailable', 'pos.unavailable'],
            ['flib_timeout', 'pos.unavailable'],
        ])('error %s: «!» and its own text, the field untouched, a repeat possible', async (code, key) => {
            translateSentence.mockRejectedValueOnce(gatewayError(code));
            const {translation} = display.showPhrase(PHRASE);
            await press();
            expect(label.textContent).toBe('!');
            expect(label.dataset.error).toBe('true');
            expect(button.title).toBe(translate(key, {max: FLIB_SENTENCE_MAX_CHARS}));
            expect(translation.value).toBe('');
            expect(phraseStrips()).toHaveLength(0);
            expect(button.disabled).toBe(false);
            await press();
            expect(translation.value).toBe(PHRASE_RU);
            expect(label.textContent).toBe('');
            expect(label.dataset.error).toBeUndefined();
        });

        test('quota error shows its own text and link', async () => {
            translateSentence.mockRejectedValueOnce(gatewayError('llm_quota_exhausted'));
            display.showPhrase(PHRASE);
            await press();
            expect(button.title).toContain('Квота переводов');
            expect(button.title).toContain('Продлить квоту переводов');
        });

        test.each([[''], ['  '], [null], [7]])('an unusable translation %j is a bad answer', async (translation) => {
            translateSentence.mockResolvedValueOnce({translation});
            const fields = display.showPhrase(PHRASE);
            await press();
            expect(fields.translation.value).toBe('');
            expect(label.textContent).toBe('!');
            expect(button.title).toBe(translate('pos.badAnswer'));
        });

        test('the error mark goes when the English changes or the next request starts', async () => {
            translateSentence.mockRejectedValue(gatewayError('flib_rate_limited'));
            const {english} = display.showPhrase(PHRASE);
            await press();
            expect(label.textContent).toBe('!');
            type(english, 'Another phrase.');
            expect(label.textContent).toBe('');
            expect(button.title).toBe(translate('pos.phraseButton'));
            await press();
            expect(label.textContent).toBe('!');
            translateSentence.mockImplementationOnce(() => deferred().promise);
            button.click();
            expect(label.textContent).toBe('');
            expect(button.title).toBe(translate('pos.phraseButton'));
        });

        test('a failed repeat keeps the strip that is already there', async () => {
            const {translation} = display.showPhrase(PHRASE);
            type(translation, 'Мой перевод');
            await press();
            translateSentence.mockRejectedValueOnce(gatewayError('flib_rate_limited'));
            await press();
            expect(stripText()).toBe(PHRASE_RU);
            expect(label.textContent).toBe('!');
        });

        test.each([
            [0, true],
            [1, false],
            [2, false],
        ])('depth %d: useCache %j', async (depth, useCache) => {
            display.depth = depth;
            const {translation} = display.showPhrase(PHRASE);
            await press();
            expect(translateSentence).toHaveBeenCalledWith(PHRASE, useCache);
            expect(translation.value).toBe(PHRASE_RU);
        });

        test('never blurred: the press is an explicit request', async () => {
            display.getOptions.mockReturnValue({flibTranslation: {blur: true}});
            display.getOptionsContext.mockReturnValue({url: 'https://flib.club/x'});
            const {translation} = display.showPhrase(PHRASE);
            type(translation, 'Мой перевод');
            await press();
            expect(stripText()).toBe(PHRASE_RU);
            expect(document.querySelector('.is-blurred')).toBe(null);
        });

        test('contentClear while the type is still «phrase»: the button is off with the word tooltip, the strip is gone', async () => {
            const {translation} = display.showPhrase(PHRASE);
            type(translation, 'Мой перевод');
            await press();
            display.trigger('contentClear', {});
            expect(display.contentType).toBe('phrase');
            expect(button.disabled).toBe(true);
            expect(button.title).toBe(translate('pos.button'));
            expect(phraseStrips()).toHaveLength(0);
        });

        test('listeners go with the result', () => {
            const {english, translation} = display.showPhrase(PHRASE);
            const removed = [english, translation].map((field) => vi.spyOn(field, 'removeEventListener'));
            display.trigger('contentClear', {});
            for (const spy of removed) {
                expect(spy.mock.calls.filter(([name]) => name === 'input')).toHaveLength(1);
            }
            // Поле прошлой выдачи больше ничего не меняет.
            type(english, 'a'.repeat(1001));
            expect(button.title).toBe(translate('pos.button'));
            const next = display.showPhrase(PHRASE);
            type(english, '');
            type(translation, PHRASE_RU);
            expect(button.disabled).toBe(false);
            type(next.english, '');
            expect(button.disabled).toBe(true);
        });

        test('the automatic text belongs to its own result', async () => {
            display.showPhrase(PHRASE);
            await press();
            const {translation} = display.showPhrase(PHRASE);
            type(translation, PHRASE_RU);
            expect(button.disabled).toBe(false);
        });

        test('a word after a phrase works as before', async () => {
            display.showPhrase(PHRASE);
            await press();
            display.show([entry('n'), entry('v')], 'book a table');
            expect(button.disabled).toBe(false);
            expect(button.title).toBe(translate('pos.button'));
            await press();
            expect(detect).toHaveBeenCalledWith('book', 'book a table', true);
            expect(translateSentence).toHaveBeenCalledTimes(1);
        });

        test('a phrase entry without its fields: disabled, nothing thrown', () => {
            display.showPhrase(PHRASE);
            /** @type {HTMLElement} */ (document.querySelector('#dictionary-entries')).replaceChildren();
            display.trigger('contentUpdateComplete', {type: 'phrase'});
            expect(button.disabled).toBe(true);
        });
    });
});
