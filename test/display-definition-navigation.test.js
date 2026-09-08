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
import {Display} from '../ext/js/display/display.js';
import {setupDomTest} from './fixtures/dom-test.js';

/**
 * Голый Display с ровно тем состоянием, которое читает
 * `_getDictionaryEntryVisibleDefinitionIndex`: настоящий конструктор тянет
 * Application/CrossFrameAPI и в юнит-тесте не нужен.
 * @param {{dictionary: string}[]} definitions
 * @param {HTMLElement} entryNode
 * @returns {Display}
 */
function makeDisplay(definitions, entryNode) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const display = /** @type {Display} */ (Object.create(Display.prototype));
    // eslint-disable-next-line no-underscore-dangle
    display._windowScroll = /** @type {*} */ ({getRect: () => ({top: 0, bottom: 0})});
    // eslint-disable-next-line no-underscore-dangle
    display._dictionaryEntries = /** @type {*} */ ([{type: 'term', definitions}]);
    // eslint-disable-next-line no-underscore-dangle
    display._dictionaryEntryNodes = [entryNode];
    return display;
}

/**
 * Список определений в том виде, в каком его оставляет колонка перевода:
 * узлы удалённых русских строк отсутствуют, строка-сирота дописана в конец и
 * `data-index` не имеет вовсе.
 * @param {{index: ?number}[]} items
 * @returns {HTMLElement}
 */
function makeEntryNode(items) {
    const entry = document.createElement('div');
    entry.className = 'entry';
    const list = document.createElement('ol');
    list.className = 'definition-list';
    for (const {index} of items) {
        const li = document.createElement('li');
        li.className = index === null ? 'definition-item translation-orphan' : 'definition-item';
        if (index !== null) { li.dataset.index = `${index}`; }
        list.appendChild(li);
    }
    entry.appendChild(list);
    return entry;
}

describe('_getDictionaryEntryVisibleDefinitionIndex после уборки RU-строк', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => { env = await setupDomTest(); });
    afterEach(async () => { await env.teardown(global); });

    /**
     * @param {Display} display
     * @param {number} sign
     * @returns {?number}
     */
    const visibleIndex = (display, sign) => (
        // eslint-disable-next-line no-underscore-dangle
        display._getDictionaryEntryVisibleDefinitionIndex(0, sign)
    );

    test('удалённая RU-строка НЕ в хвосте: индекс берётся из data-index, а не из позиции', () => {
        // ⚠️ Порядок определений задаёт _sortTermDictionaryEntryDefinitions по
        // frequencyOrder и dictionaryIndex (порядок словарей в настройках), так
        // что русская строка может стоять ПЕРВОЙ. Позиционное сопоставление
        // definitions[i] ↔ nodes[i] после её удаления указывает не на то
        // определение.
        const definitions = [{dictionary: 'ru'}, {dictionary: 'en'}, {dictionary: 'en2'}];
        const display = makeDisplay(definitions, makeEntryNode([{index: 1}, {index: 2}]));

        const index = visibleIndex(display, 1);
        expect(index).not.toBe(null);
        expect(definitions[/** @type {number} */ (index)].dictionary).not.toBe('ru');
        expect(index).toBe(2);
    });

    test('обход снизу вверх тоже не проваливается на удалённую строку', () => {
        const definitions = [{dictionary: 'ru'}, {dictionary: 'en'}, {dictionary: 'en2'}];
        const display = makeDisplay(definitions, makeEntryNode([{index: 1}, {index: 2}]));

        const index = visibleIndex(display, -1);
        expect(definitions[/** @type {number} */ (index)].dictionary).not.toBe('ru');
        expect(index).toBe(1);
    });

    test('строка-сирота (узел без определения) в счёт не идёт', () => {
        const definitions = [{dictionary: 'en'}, {dictionary: 'ru'}];
        const display = makeDisplay(definitions, makeEntryNode([{index: 0}, {index: null}]));

        expect(visibleIndex(display, 1)).toBe(0);
        expect(visibleIndex(display, -1)).toBe(0);
    });

    test('без уборки поведение прежнее', () => {
        const definitions = [{dictionary: 'en'}, {dictionary: 'en2'}, {dictionary: 'en3'}];
        const display = makeDisplay(definitions, makeEntryNode([{index: 0}, {index: 1}, {index: 2}]));

        expect(visibleIndex(display, 1)).toBe(2);
        expect(visibleIndex(display, -1)).toBe(0);
    });

    test('узлов определений нет вовсе — null, как и раньше', () => {
        const display = makeDisplay([{dictionary: 'en'}], makeEntryNode([]));
        expect(visibleIndex(display, 1)).toBe(null);
    });

    test('_getDictionaryEntryDefinitionNode находит узел по data-index, а не по позиции', () => {
        const display = makeDisplay(
            [{dictionary: 'ru'}, {dictionary: 'en'}, {dictionary: 'en2'}],
            makeEntryNode([{index: 1}, {index: 2}]),
        );
        // eslint-disable-next-line no-underscore-dangle
        const node = display._getDictionaryEntryDefinitionNode(0, 2);
        expect(node?.dataset.index).toBe('2');
        // Удалённое определение узла не имеет — и подменять его соседом нельзя.
        // eslint-disable-next-line no-underscore-dangle
        expect(display._getDictionaryEntryDefinitionNode(0, 0)).toBe(null);
    });
});
