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
import {DisplayEntryNav, getEntryNavItems} from '../ext/js/display/display-entry-nav.js';
import {setupDomTest} from './fixtures/dom-test.js';

/**
 * @param {string} term
 * @param {string[]} [wordClasses]
 * @returns {import('dictionary').DictionaryEntry}
 */
const termEntry = (term, wordClasses = []) => /** @type {import('dictionary').DictionaryEntry} */ (/** @type {unknown} */ ({type: 'term', headwords: [{term, reading: term, wordClasses}]}));

describe('getEntryNavItems — пункты «Статья 1 из N ▾» (макет EntryNav)', () => {
    test('слово и часть речи; текущая отмечена', () => {
        expect(getEntryNavItems([termEntry('google', ['v']), termEntry('Google', ['n']), termEntry('googler')], 1)).toStrictEqual([
            {index: 0, word: 'google', detail: 'v', current: false},
            {index: 1, word: 'Google', detail: 'n', current: true},
            {index: 2, word: 'googler', detail: '', current: false},
        ]);
    });
    test('кандзи — иероглиф', () => {
        const kanji = /** @type {import('dictionary').DictionaryEntry} */ (/** @type {unknown} */ ({type: 'kanji', character: '字'}));
        expect(getEntryNavItems([kanji], 0)[0].word).toBe('字');
    });
});

/**
 * @augments EventDispatcher<import('display').Events>
 */
class FakeDisplay extends EventDispatcher {
    /**
     * @param {import('dictionary').DictionaryEntry[]} entries
     */
    constructor(entries) {
        super();
        /** @type {import('dictionary').DictionaryEntry[]} */
        this.dictionaryEntries = entries;
        /** @type {number} */
        this.selectedIndex = 0;
        /** @type {import('vitest').Mock} */
        this.moveCurrentEntry = vi.fn((/** @type {number} */ offset) => {
            this.selectedIndex += offset;
            this.trigger('currentEntryChanged', {index: this.selectedIndex});
        });
    }
}

describe('DisplayEntryNav — кнопка «Статья i из N ▾» в верхней панели', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    /** @type {HTMLElement} */
    let toolbar;
    /** @type {import('vitest').Mock} */
    let openMenu;
    beforeEach(async () => {
        env = await setupDomTest();
        toolbar = document.createElement('div');
        toolbar.className = 'popup-toolbar';
        document.body.appendChild(toolbar);
        openMenu = vi.fn();
    });
    afterEach(async () => { await env.teardown(global); });

    /**
     * @param {string[]} terms
     * @returns {{display: FakeDisplay, nav: DisplayEntryNav}}
     */
    const setup = (terms) => {
        const display = new FakeDisplay(terms.map((t) => termEntry(t, ['v'])));
        const nav = new DisplayEntryNav(/** @type {*} */ (display), {getToolbar: () => toolbar, openMenu});
        nav.prepare();
        display.trigger('contentUpdateComplete', {type: 'terms'});
        return {display, nav};
    };
    /** @returns {?HTMLButtonElement} */
    const button = () => toolbar.querySelector('.fc-entry-nav');

    test('одна статья — кнопки нет', () => {
        setup(['google']);
        expect(button()?.hidden ?? true).toBe(true);
    });
    test('три статьи — «Статья 1 из 3», первой в панели, с меню', () => {
        setup(['google', 'Google', 'googler']);
        const b = /** @type {HTMLButtonElement} */ (button());
        expect(b.hidden).toBe(false);
        expect(b.textContent).toContain('Статья 1 из 3');
        expect(b.getAttribute('aria-haspopup')).toBe('menu');
        expect(toolbar.firstElementChild).toBe(b);
    });
    test('смена текущей статьи (Alt+↓, полоса) — подпись следует', () => {
        const {display} = setup(['google', 'Google', 'googler']);
        display.moveCurrentEntry(2);
        expect(button()?.textContent).toContain('Статья 3 из 3');
    });
    test('щелчок открывает меню; выбор пункта делает статью текущей', () => {
        const {display} = setup(['google', 'Google', 'googler']);
        /** @type {HTMLButtonElement} */ (button()).click();
        expect(openMenu).toHaveBeenCalledTimes(1);
        const call = /** @type {unknown[]} */ (openMenu.mock.calls[0]);
        const anchor = /** @type {HTMLElement} */ (call[0]);
        const items = /** @type {ReturnType<typeof getEntryNavItems>} */ (call[1]);
        const onSelect = /** @type {(index: number) => void} */ (call[2]);
        expect(anchor).toBe(button());
        expect(items.map((i) => i.word)).toStrictEqual(['google', 'Google', 'googler']);
        onSelect(2);
        expect(display.moveCurrentEntry).toHaveBeenCalledWith(2);
        expect(display.selectedIndex).toBe(2);
    });
    test('фраза / новая выдача без статей — кнопка спрятана', () => {
        const {display} = setup(['google', 'Google']);
        display.trigger('contentUpdateComplete', {type: 'phrase'});
        expect(button()?.hidden).toBe(true);
        display.trigger('contentUpdateComplete', {type: 'terms'});
        display.trigger('contentClear', {});
        expect(button()?.hidden).toBe(true);
    });
});
