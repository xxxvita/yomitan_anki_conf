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
import {DisplayMoreEntries, groupMoreEntries} from '../ext/js/display/display-more-entries.js';
import {setupDomTest} from './fixtures/dom-test.js';

/**
 * @param {string} term
 * @returns {import('dictionary').DictionaryEntry}
 */
const termEntry = (term) => /** @type {import('dictionary').DictionaryEntry} */ (/** @type {unknown} */ ({type: 'term', headwords: [{term, reading: term}]}));

describe('groupMoreEntries', () => {
    test('главное слово — у первой статьи; остальные сгруппированы по слову, в порядке появления', () => {
        const r = groupMoreEntries([termEntry('call it a day'), termEntry('call it'), termEntry('call'), termEntry('Call'), termEntry('call')]);
        expect(r.more).toStrictEqual([1, 2, 3, 4]);
        expect(r.groups).toStrictEqual([{word: 'call it', count: 1}, {word: 'call', count: 3}]);
    });
    test('регистр не делает слово другим', () => {
        expect(groupMoreEntries([termEntry('Google'), termEntry('google')]).more).toStrictEqual([]);
    });
    test('одна статья, пусто, кандзи, фраза первой — нечего сворачивать', () => {
        expect(groupMoreEntries([termEntry('google')]).more).toStrictEqual([]);
        expect(groupMoreEntries([]).more).toStrictEqual([]);
        const kanji = /** @type {import('dictionary').DictionaryEntry} */ (/** @type {unknown} */ ({type: 'kanji', character: '字'}));
        expect(groupMoreEntries([kanji, termEntry('x')]).more).toStrictEqual([]);
    });
});

/**
 * @augments EventDispatcher<import('display').Events>
 */
class FakeDisplay extends EventDispatcher {
    /**
     * @param {import('dictionary').DictionaryEntry[]} entries
     * @param {HTMLElement[]} nodes
     */
    constructor(entries, nodes) {
        super();
        /** @type {import('dictionary').DictionaryEntry[]} */
        this.dictionaryEntries = entries;
        /** @type {HTMLElement[]} */
        this.dictionaryEntryNodes = nodes;
    }
}

describe('DisplayMoreEntries — «Ещё N статей» (макет flib-states.jsx)', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    /** @type {HTMLElement} */
    let container;
    beforeEach(async () => {
        env = await setupDomTest();
        container = document.createElement('div');
        container.id = 'dictionary-entries';
        document.body.appendChild(container);
    });
    afterEach(async () => { await env.teardown(global); });

    /**
     * @param {string[]} terms
     * @returns {{display: FakeDisplay, nodes: HTMLElement[]}}
     */
    const render = (terms) => {
        const nodes = terms.map(() => {
            const node = document.createElement('div');
            node.className = 'entry';
            container.appendChild(node);
            return node;
        });
        const display = new FakeDisplay(terms.map(termEntry), nodes);
        new DisplayMoreEntries(/** @type {*} */ (display), container).prepare();
        display.trigger('contentUpdateComplete', {type: 'terms'});
        return {display, nodes};
    };
    const more = () => /** @type {?HTMLElement} */ (container.querySelector('.fc-more'));
    /** @returns {HTMLButtonElement} */
    const moreButton = () => /** @type {HTMLButtonElement} */ (/** @type {HTMLElement} */ (more()).querySelector('button'));

    test('свёрнуто: прочие статьи скрыты, строка «Ещё 3 статьи: call it (1) · call (2)»', () => {
        const {nodes} = render(['call it a day', 'call it', 'call', 'call']);
        expect(nodes.map((n) => n.hidden)).toStrictEqual([false, true, true, true]);
        const line = more();
        expect(line?.textContent).toContain('Ещё 3 статьи');
        expect(line?.textContent).toContain('call it (1) · call (2)');
        expect(container.lastElementChild).toBe(line);
    });

    test('«Показать» раскрывает, «Свернуть» сворачивает обратно', () => {
        const {nodes} = render(['call it a day', 'call']);
        moreButton().click();
        expect(nodes[1].hidden).toBe(false);
        const collapse = moreButton();
        expect(collapse.textContent).toContain('Свернуть');
        collapse.click();
        expect(nodes[1].hidden).toBe(true);
        expect(more()?.textContent).toContain('Ещё 1 статья');
    });

    test('переход на свёрнутую статью (Alt+↓, полоса) раскрывает группу', () => {
        const {display, nodes} = render(['call it a day', 'call']);
        display.trigger('currentEntryChanged', {index: 1});
        expect(nodes[1].hidden).toBe(false);
    });

    test('все статьи про одно слово — ни строки, ни скрытых', () => {
        const {nodes} = render(['google', 'google']);
        expect(more()).toBeNull();
        expect(nodes.some((n) => n.hidden)).toBe(false);
    });

    test('новая выдача: строка от прошлой убрана', () => {
        const {display} = render(['call it a day', 'call']);
        display.trigger('contentClear', {});
        expect(more()).toBeNull();
    });

    test('фраза / кандзи — не сворачиваются, даже если статей несколько', () => {
        const nodes = ['call it a day', 'call'].map(() => {
            const node = document.createElement('div');
            container.appendChild(node);
            return node;
        });
        const display = new FakeDisplay(['call it a day', 'call'].map(termEntry), nodes);
        new DisplayMoreEntries(/** @type {*} */ (display), container).prepare();
        display.trigger('contentUpdateComplete', {type: 'phrase'});
        expect(more()).toBeNull();
        expect(nodes[1].hidden).toBe(false);
    });
});
