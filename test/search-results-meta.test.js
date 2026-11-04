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
import {EventDispatcher} from '../ext/js/core/event-dispatcher.js';
import {SearchResultsMeta} from '../ext/js/display/search-results-meta.js';
import {setupDomTest} from './fixtures/dom-test.js';

/**
 * @augments EventDispatcher<import('display').Events>
 */
class FakeDisplay extends EventDispatcher {
    constructor() {
        super();
        /** @type {unknown[]} */
        this.dictionaryEntries = [];
        /** @type {string} */
        this.query = '';
        /** @type {string} */
        this.contentType = 'terms';
    }
}

describe('SearchResultsMeta — «Результаты для «x» · N статей»', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    /** @type {FakeDisplay} */
    let display;
    beforeEach(async () => {
        env = await setupDomTest();
        const entries = document.createElement('div');
        entries.id = 'dictionary-entries';
        document.body.appendChild(entries);
        display = new FakeDisplay();
        new SearchResultsMeta(/** @type {*} */ (display)).prepare();
    });
    afterEach(async () => { await env.teardown(global); });

    /** @returns {?HTMLElement} */
    const meta = () => document.querySelector('.fc-sp-meta');

    test('три статьи — строка перед результатами со склонением', () => {
        display.dictionaryEntries = [{}, {}, {}];
        display.query = 'googling';
        display.trigger('contentUpdateComplete', {type: 'terms'});
        expect(meta()?.textContent).toBe('Результаты для «googling» · 3 статьи');
        expect(meta()?.nextElementSibling?.id).toBe('dictionary-entries');
        expect(meta()?.hidden).toBe(false);
    });

    test('одна и пять статей', () => {
        display.query = 'run';
        display.dictionaryEntries = [{}];
        display.trigger('contentUpdateComplete', {type: 'terms'});
        expect(meta()?.textContent).toBe('Результаты для «run» · 1 статья');
        display.dictionaryEntries = [{}, {}, {}, {}, {}];
        display.trigger('contentUpdateComplete', {type: 'terms'});
        expect(meta()?.textContent).toBe('Результаты для «run» · 5 статей');
        expect(document.querySelectorAll('.fc-sp-meta')).toHaveLength(1);
    });

    test('ноль результатов, фраза, пустой запрос — строки нет', () => {
        display.query = 'zzz';
        display.trigger('contentUpdateComplete', {type: 'terms'});
        expect(meta()?.hidden ?? true).toBe(true);
        display.dictionaryEntries = [{}];
        display.contentType = 'phrase';
        display.trigger('contentUpdateComplete', {type: 'phrase'});
        expect(meta()?.hidden ?? true).toBe(true);
        display.contentType = 'terms';
        display.query = '  ';
        display.trigger('contentUpdateComplete', {type: 'terms'});
        expect(meta()?.hidden ?? true).toBe(true);
    });

    test('введена фраза — в строке слово найденной статьи', () => {
        display.dictionaryEntries = [{headwords: [{term: 'googling'}]}];
        display.query = 'I was googling all day';
        display.trigger('contentUpdateComplete', {type: 'terms'});
        expect(meta()?.textContent).toBe('Результаты для «googling» · 1 статья');
        expect(meta()?.classList.contains('scan-disable')).toBe(true);
    });

    test('пока ищется новое — прежняя строка спрятана', () => {
        display.dictionaryEntries = [{}];
        display.query = 'run';
        display.trigger('contentUpdateComplete', {type: 'terms'});
        display.trigger('contentClear', {});
        expect(meta()?.hidden).toBe(true);
    });
});
