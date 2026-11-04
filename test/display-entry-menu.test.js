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

/* eslint-disable no-underscore-dangle -- the menu is driven through Display's private seams */
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {Display, getEntryMenuItems} from '../ext/js/display/display.js';
import {setupDomTest} from './fixtures/dom-test.js';

describe('меню «⋯» у статьи (макет: Озвучка, Скопировать слово, Отладочная информация)', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => { env = await setupDomTest(); });
    afterEach(async () => { await env.teardown(global); });

    test('пункты по-русски, в порядке макета; отладочный — только в режиме отладки', () => {
        expect(getEntryMenuItems(false).map(([, label]) => label)).toStrictEqual(['Озвучка…', 'Скопировать слово']);
        expect(getEntryMenuItems(true).map(([, label]) => label)).toStrictEqual(['Озвучка…', 'Скопировать слово', 'Отладочная информация']);
    });

    /**
     * @param {unknown} dictionaryEntry
     * @returns {{display: Display, entry: HTMLElement, menuButton: HTMLElement, copy: import('vitest').Mock, log: import('vitest').Mock}}
     */
    const setup = (dictionaryEntry) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const display = /** @type {Display} */ (Object.create(Display.prototype));
        const entry = document.createElement('div');
        entry.className = 'entry';
        const play = document.createElement('button');
        play.dataset.action = 'play-audio';
        const menuButton = document.createElement('button');
        menuButton.dataset.action = 'menu';
        entry.append(play, menuButton);
        document.body.appendChild(entry);
        const copy = vi.fn();
        const log = vi.fn(() => Promise.resolve());
        /** @type {*} */ (display)._dictionaryEntries = [dictionaryEntry];
        /** @type {*} */ (display)._copyText = copy;
        /** @type {*} */ (display)._logDictionaryEntryData = log;
        display.getElementDictionaryEntryIndex = () => 0;
        return {display, entry, menuButton, copy, log};
    };
    /**
     * @param {HTMLElement} node
     * @param {string} action
     * @returns {import('popup-menu').MenuCloseEvent}
     */
    const closeEvent = (node, action) => /** @type {import('popup-menu').MenuCloseEvent} */ (/** @type {unknown} */ ({currentTarget: node, detail: {action}}));

    test('«Скопировать слово» — заглавное слово статьи; у кандзи — иероглиф', () => {
        const term = setup({type: 'term', headwords: [{term: 'google', reading: 'google'}]});
        term.display._onMenuButtonMenuClose(closeEvent(term.menuButton, 'fc-copy-word'));
        expect(term.copy).toHaveBeenCalledWith('google');
        const kanji = setup({type: 'kanji', character: '字'});
        kanji.display._onMenuButtonMenuClose(closeEvent(kanji.menuButton, 'fc-copy-word'));
        expect(kanji.copy).toHaveBeenCalledWith('字');
    });

    test('«Озвучка…» открывает список источников у кнопки динамика этой статьи', () => {
        const {display, entry, menuButton} = setup({type: 'term', headwords: [{term: 'google', reading: 'google'}]});
        const seen = vi.fn();
        /** @type {HTMLElement} */ (entry.querySelector('[data-action=play-audio]')).addEventListener('contextmenu', seen);
        display._onMenuButtonMenuClose(closeEvent(menuButton, 'fc-audio-sources'));
        expect(seen).toHaveBeenCalledTimes(1);
    });

    test('«Отладочная информация» — прежний log-debug-info', () => {
        const {display, menuButton, log} = setup({type: 'term', headwords: [{term: 'google', reading: 'google'}]});
        display._onMenuButtonMenuClose(closeEvent(menuButton, 'log-debug-info'));
        expect(log).toHaveBeenCalledWith(0);
    });

    test('статьи нет (выдача сменилась) — ничего не копируется', () => {
        const {display, menuButton, copy} = setup(void 0);
        expect(() => display._onMenuButtonMenuClose(closeEvent(menuButton, 'fc-copy-word'))).not.toThrow();
        expect(copy).not.toHaveBeenCalled();
    });
});
/* eslint-enable no-underscore-dangle */
