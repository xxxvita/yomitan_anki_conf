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

import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {DisplayTranslation} from '../ext/js/display/display-translation.js';
import {setupDomTest} from './fixtures/dom-test.js';

/**
 * Статья, где переводу не с чем сопоставиться (сирота) — ни одного
 * определения-хозяина в массиве вовсе.
 * @param {string} headword
 * @param {number} translationId
 * @returns {import('dictionary').TermDictionaryEntry}
 */
function makeOrphanEntry(headword, translationId) {
    return /** @type {import('dictionary').TermDictionaryEntry} */ (/** @type {unknown} */ ({
        type: 'term',
        headwords: [{term: headword}],
        definitions: [
            {dictionary: 'ru', sequences: [-1], id: translationId, entries: [`перевод ${headword}`]},
        ],
    }));
}

/** @returns {HTMLElement} */
function makeEntryElement() {
    const li = document.createElement('li');
    li.className = 'dictionary-entry';
    const list = document.createElement('ol');
    list.className = 'definition-list';
    li.appendChild(list);
    return li;
}

/**
 * @typedef {{
 *   addEntry: (element: HTMLElement, dictionaryEntry: import('dictionary').TermDictionaryEntry) => void,
 *   setStrict: (value: boolean) => void,
 *   open: () => void,
 *   render: () => void,
 *   clearRevealed: () => void,
 *   onContentUpdateEntry: (details: {dictionaryEntry: import('dictionary').TermDictionaryEntry, element: HTMLElement, index: number}) => void,
 * }} Harness
 */

/**
 * Голый DisplayTranslation с подменёнными _display/_entries: настоящий
 * конструктор требует живой Display, недоступный в юнит-тесте. Приватные
 * поля трогает ТОЛЬКО эта функция — тесты используют обёртку без
 * подчёркиваний, чтобы не тащить eslint-disable в каждую строку теста.
 * @param {(type: string, lemmas: string[]) => void} onEvent
 * @returns {Harness}
 */
function makeHarness(onEvent) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const instance = /** @type {import('../ext/js/display/display-translation.js').DisplayTranslation} */ (
        Object.create(DisplayTranslation.prototype)
    );
    // eslint-disable-next-line no-underscore-dangle
    instance._open = false;
    // eslint-disable-next-line no-underscore-dangle
    instance._revealed = new Set();
    // eslint-disable-next-line no-underscore-dangle
    instance._layout = 'stack';
    // eslint-disable-next-line no-underscore-dangle
    instance._strict = false;
    // eslint-disable-next-line no-underscore-dangle
    instance._button = null;
    // eslint-disable-next-line no-underscore-dangle
    instance._entries = new Map();
    // eslint-disable-next-line no-underscore-dangle
    instance._display = /** @type {*} */ ({
        getOptions() {
            return /** @type {import('settings').ProfileOptions} */ (/** @type {unknown} */ ({
                flibTranslation: {translationDictionary: 'ru', hostDictionary: 'en'},
            }));
        },
        getOptionsContext() {
            return /** @type {import('settings').OptionsContext} */ ({url: 'https://flib.club/b/1', depth: 0});
        },
        displayGenerator: {
            /**
             * @param {import('dictionary').TermDefinition} definition
             * @returns {HTMLElement}
             */
            createTermDefinitionContent(definition) {
                const ul = document.createElement('ul');
                ul.className = 'gloss-list translation-gloss';
                const [first] = definition.entries;
                ul.textContent = typeof first === 'string' ? first : '';
                return ul;
            },
        },
        application: {
            api: {
                /**
                 * @param {string} type
                 * @param {string[]} lemmas
                 * @returns {Promise<boolean>}
                 */
                flibRecordEvent(type, lemmas) {
                    onEvent(type, lemmas);
                    return Promise.resolve(true);
                },
            },
        },
    });

    return {
        addEntry: (element, dictionaryEntry) => {
            // eslint-disable-next-line no-underscore-dangle
            instance._entries.set(element, dictionaryEntry);
        },
        setStrict: (value) => {
            // eslint-disable-next-line no-underscore-dangle
            instance._strict = value;
        },
        open: () => {
            // eslint-disable-next-line no-underscore-dangle
            instance._open = true;
        },
        render: () => {
            // eslint-disable-next-line no-underscore-dangle
            instance._renderColumns();
        },
        clearRevealed: () => {
            // eslint-disable-next-line no-underscore-dangle
            instance._revealed.clear();
        },
        onContentUpdateEntry: (details) => {
            // eslint-disable-next-line no-underscore-dangle
            instance._onContentUpdateEntry(details);
        },
    };
}

describe('DisplayTranslation — раскрытие колонки и событие translation_opened', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    /** @type {Harness} */
    let harness;
    /** @type {[string, string[]][]} */
    let calls;

    beforeEach(async () => {
        env = await setupDomTest();
        calls = [];
        harness = makeHarness((type, lemmas) => { calls.push([type, lemmas]); });
    });

    afterEach(async () => {
        await env.teardown(global);
    });

    test('открытие колонки — ноль событий; клик по ячейке в том же прогоне — ровно одно', () => {
        const el = makeEntryElement();
        harness.addEntry(el, makeOrphanEntry('give up', 1));

        // «Нажатие Ru» само по себе не должно фиксировать ничего.
        harness.open();
        harness.render();
        expect(calls.length).toBe(0);

        const button = /** @type {?HTMLButtonElement} */ (el.querySelector('.translation-cell-blurred'));
        expect(button).not.toBe(null);
        (/** @type {HTMLButtonElement} */ (button)).click();
        expect(calls.length).toBe(1);
    });

    test('клик по ячейке даёт РОВНО одно событие с леммой этой статьи', () => {
        const el = makeEntryElement();
        harness.addEntry(el, makeOrphanEntry('give up', 1));
        harness.open();
        harness.render();

        const button = /** @type {HTMLButtonElement} */ (el.querySelector('.translation-cell-blurred'));
        button.click();

        expect(calls).toEqual([['translation_opened', ['give up']]]);
    });

    test('две статьи одного слова — два независимых события со своими леммами', () => {
        const elBook = makeEntryElement();
        const elGive = makeEntryElement();
        harness.addEntry(elBook, makeOrphanEntry('book up', 1));
        harness.addEntry(elGive, makeOrphanEntry('give up', 2));
        harness.open();
        harness.render();

        /** @type {HTMLButtonElement} */ (elBook.querySelector('.translation-cell-blurred')).click();
        /** @type {HTMLButtonElement} */ (elGive.querySelector('.translation-cell-blurred')).click();

        expect(calls).toEqual([
            ['translation_opened', ['book up']],
            ['translation_opened', ['give up']],
        ]);
    });

    test('повторный рендер событие заново не шлёт', () => {
        const el = makeEntryElement();
        harness.addEntry(el, makeOrphanEntry('give up', 1));
        harness.open();
        harness.render();
        /** @type {HTMLButtonElement} */ (el.querySelector('.translation-cell-blurred')).click();
        expect(calls.length).toBe(1);

        harness.render();
        harness.render();
        expect(calls.length).toBe(1);
    });

    test('раскрытая ячейка остаётся открытой до contentClear', () => {
        const el = makeEntryElement();
        harness.addEntry(el, makeOrphanEntry('give up', 1));
        harness.open();
        harness.render();
        /** @type {HTMLButtonElement} */ (el.querySelector('.translation-cell-blurred')).click();

        expect(el.querySelector('.translation-cell-blurred')).toBe(null);
        expect(el.querySelector('.translation-cell')).not.toBe(null);
    });

    test('сброс раскрытых ячеек на новой выдаче возвращает блюр', () => {
        const el = makeEntryElement();
        harness.addEntry(el, makeOrphanEntry('give up', 1));
        harness.open();
        harness.render();
        /** @type {HTMLButtonElement} */ (el.querySelector('.translation-cell-blurred')).click();
        expect(el.querySelector('.translation-cell-blurred')).toBe(null);

        // Имитация contentClear: revealed сбрасывается, приходит новая выдача.
        harness.clearRevealed();
        harness.render();

        expect(el.querySelector('.translation-cell-blurred')).not.toBe(null);
    });

    test('EN и RU одной статьи — потомки одного .definition-item', () => {
        const el = makeEntryElement();
        const list = /** @type {HTMLElement} */ (el.querySelector('.definition-list'));
        const item = document.createElement('li');
        item.className = 'definition-item';
        item.dataset.index = '0';
        item.dataset.dictionary = 'en';
        const inner = document.createElement('div');
        inner.className = 'definition-item-inner';
        const content = document.createElement('div');
        content.className = 'definition-item-content';
        const gloss = document.createElement('ul');
        gloss.className = 'gloss-list';
        gloss.textContent = 'give up (en)';
        content.appendChild(gloss);
        inner.appendChild(content);
        item.appendChild(inner);
        list.appendChild(item);

        const dictionaryEntry = /** @type {import('dictionary').TermDictionaryEntry} */ (/** @type {unknown} */ ({
            type: 'term',
            headwords: [{term: 'give up'}],
            definitions: [
                {dictionary: 'en', sequences: [42], id: 10, entries: ['give up (en)']},
                {dictionary: 'ru', sequences: [42], id: 11, entries: ['сдаться']},
            ],
        }));

        harness.setStrict(true);
        harness.onContentUpdateEntry({dictionaryEntry, element: el, index: 0});
        harness.open();
        harness.render();

        expect(item.querySelector('.gloss-list')).not.toBe(null);
        expect(item.querySelector('.translation-cell')).not.toBe(null);
    });

    test('строки словаря переводов убраны из обычного потока, а английские на месте', () => {
        const el = makeEntryElement();
        const list = /** @type {HTMLElement} */ (el.querySelector('.definition-list'));

        /**
         * @param {string} index
         * @param {string} dictionary
         * @returns {HTMLElement}
         */
        const item = (index, dictionary) => {
            const li = document.createElement('li');
            li.className = 'definition-item';
            li.dataset.index = index;
            li.dataset.dictionary = dictionary;
            const inner = document.createElement('div');
            inner.className = 'definition-item-inner';
            li.appendChild(inner);
            list.appendChild(li);
            return li;
        };
        const enItem = item('0', 'en');
        item('1', 'ru');
        const otherEnItem = item('2', 'en2');

        const dictionaryEntry = /** @type {import('dictionary').TermDictionaryEntry} */ (/** @type {unknown} */ ({
            type: 'term',
            headwords: [{term: 'x'}],
            definitions: [
                {dictionary: 'en', sequences: [-1], id: 1, entries: []},
                {dictionary: 'ru', sequences: [-1], id: 2, entries: []},
                {dictionary: 'en2', sequences: [-1], id: 3, entries: []},
            ],
        }));

        // Гейт снят намеренно: скрытие обязано срабатывать независимо от
        // того, раскрыта ли колонка (Ru не нажимался вовсе).
        harness.onContentUpdateEntry({dictionaryEntry, element: el, index: 0});

        expect(list.querySelectorAll('.definition-item[data-dictionary="ru"]').length).toBe(0);
        expect(list.querySelectorAll('.definition-item').length).toBe(2);
        expect(list.contains(enItem)).toBe(true);
        expect(list.contains(otherEnItem)).toBe(true);
    });
});
