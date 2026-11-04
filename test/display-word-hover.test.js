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
import {DisplayWordHover, getWordBounds} from '../ext/js/display/display-word-hover.js';
import {setupDomTest} from './fixtures/dom-test.js';

describe('getWordBounds — слово целиком вокруг позиции', () => {
    test('середина слова → всё слово', () => {
        expect(getWordBounds('To bowl a ball', 5)).toStrictEqual([3, 7]);
    });
    test('апостроф и дефис — часть слова', () => {
        expect(getWordBounds("I don't know", 4)).toStrictEqual([2, 7]);
        expect(getWordBounds('a well-known fact', 8)).toStrictEqual([2, 12]);
    });
    test('каретка после последней буквы — слово слева (правая половина буквы); между знаками — слова нет', () => {
        // Пробел за словом отсекает уже проверка «точка внутри рамки слова» (containsPoint).
        expect(getWordBounds('To bowl', 2)).toStrictEqual([0, 2]);
        expect(getWordBounds('ball.', 4)).toStrictEqual([0, 4]);
        expect(getWordBounds('ball. Next', 5)).toBeNull();
    });
    test('позиция у самого конца слова — это ещё слово (курсор на последней букве)', () => {
        expect(getWordBounds('bowl', 4)).toStrictEqual([0, 4]);
    });
});

describe('DisplayWordHover — подсветка слова под мышью (макет .hw:hover)', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    /** @type {Map<string, unknown>} */
    let highlights;
    /** @type {Text} */
    let text;
    /** @type {HTMLElement} */
    let button;
    /** @type {boolean} */
    let enabled;
    beforeEach(async () => {
        env = await setupDomTest();
        highlights = new Map();
        // Highlight API: jsdom has none — a minimal registry stands in for it.
        vi.stubGlobal('CSS', {highlights});
        vi.stubGlobal('Highlight', class {
            /**
             * @param {Range} range
             */
            constructor(range) {
                /** @type {Range} */
                this.range = range;
            }
        });
        document.body.innerHTML = '<div class="entry"><span id="t">To bowl a ball</span><button>Примеры</button></div>';
        text = /** @type {Text} */ (/** @type {HTMLElement} */ (document.querySelector('#t')).firstChild);
        button = /** @type {HTMLElement} */ (document.querySelector('button'));
        enabled = true;
        const hover = new DisplayWordHover({
            include: '.entry,.entry *',
            exclude: 'button,button *',
            isEnabled: () => enabled,
            // jsdom has no layout: the caret and the word's box are injected.
            caretAt: () => ({node: text, offset: 5}),
            containsPoint: () => true,
        });
        hover.prepare();
    });
    afterEach(async () => {
        vi.unstubAllGlobals();
        await env.teardown(global);
    });

    /**
     * @param {Element} target
     * @param {{buttons?: number}} [init]
     */
    const move = (target, init = {}) => {
        target.dispatchEvent(new MouseEvent('mousemove', {bubbles: true, clientX: 10, clientY: 10, ...init}));
    };
    /** @returns {?string} */
    const lit = () => {
        const h = /** @type {?{range: Range}} */ (highlights.get('fc-hw') ?? null);
        return h === null ? null : h.range.toString();
    };

    test('наведение на слово — подсвечено слово целиком, курсор «рука»', () => {
        move(/** @type {Element} */ (text.parentElement));
        expect(lit()).toBe('bowl');
        expect(document.documentElement.dataset.fcWordHover).toBe('true');
    });
    test('кнопка — не подсвечивается', () => {
        move(/** @type {Element} */ (text.parentElement));
        move(button);
        expect(lit()).toBeNull();
        expect(document.documentElement.dataset.fcWordHover).toBeUndefined();
    });
    test('зажата кнопка мыши (выделение) — без подсветки', () => {
        move(/** @type {Element} */ (text.parentElement), {buttons: 1});
        expect(lit()).toBeNull();
    });
    test('клик-поиск выключен в настройках — без подсветки', () => {
        enabled = false;
        move(/** @type {Element} */ (text.parentElement));
        expect(lit()).toBeNull();
    });
    test('курсор ушёл из карточки — подсветка снята', () => {
        move(/** @type {Element} */ (text.parentElement));
        document.documentElement.dispatchEvent(new MouseEvent('mouseleave'));
        expect(lit()).toBeNull();
    });
});
