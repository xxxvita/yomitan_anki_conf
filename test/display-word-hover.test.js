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
import {DisplayWordHover, getWordEnd} from '../ext/js/display/display-word-hover.js';
import {setupDomTest} from './fixtures/dom-test.js';

describe('getWordEnd — конец слова под курсором (начало даёт сам щелчок)', () => {
    test('до границы слова', () => {
        expect(getWordEnd('To bowl a ball', 5)).toBe(7);
        expect(getWordEnd('bowl', 4)).toBe(4);
    });
    test('апостроф между буквами — внутри; дефис, точка и апостроф в конце — граница', () => {
        expect(getWordEnd("I don't know", 4)).toBe(7);
        expect(getWordEnd('a well-known fact', 3)).toBe(6);
        expect(getWordEnd("dogs' bowl", 2)).toBe(4);
        expect(getWordEnd('ball. Next', 2)).toBe(4);
    });
});

describe('DisplayWordHover — подсветка слова под мышью (макет .hw:hover)', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    /** @type {Map<string, unknown>} */
    let highlights;
    /** @type {HTMLElement} */
    let span;
    /** @type {HTMLElement} */
    let button;
    /** @type {boolean} */
    let enabled;
    /** @type {?{start: {node: Node, offset: number}, caret: {node: Node, offset: number}}} */
    let scan;
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
        document.body.innerHTML = '<div class="entry"><span id="t">To bowl a ball</span><span id="w">wo<b>rd</b> end</span><button>Примеры</button></div>';
        span = /** @type {HTMLElement} */ (document.querySelector('#t'));
        button = /** @type {HTMLElement} */ (document.querySelector('button'));
        const text = /** @type {Text} */ (span.firstChild);
        // jsdom has no layout: what the click's own scan returns is injected.
        scan = {start: {node: text, offset: 3}, caret: {node: text, offset: 5}};
        enabled = true;
        const hover = new DisplayWordHover({
            include: '.entry,.entry *',
            exclude: 'button,button *',
            isEnabled: () => enabled,
            scanAt: () => scan,
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

    test('подсвечено от начала, где щелчок начнёт поиск, до конца слова; курсор «рука»', () => {
        move(span);
        expect(lit()).toBe('bowl');
        expect(document.documentElement.dataset.fcWordHover).toBe('true');
    });
    test('режим «по символам»: щелчок начинает с буквы — подсвечено с неё же', () => {
        const text = /** @type {Text} */ (span.firstChild);
        scan = {start: {node: text, offset: 5}, caret: {node: text, offset: 5}};
        move(span);
        expect(lit()).toBe('wl');
    });
    test('слово разбито разметкой (wo<b>rd</b>): щелчок по «rd» ищет «word» — подсвечено «word»', () => {
        const w = /** @type {HTMLElement} */ (document.querySelector('#w'));
        const rd = /** @type {Text} */ (/** @type {HTMLElement} */ (w.querySelector('b')).firstChild);
        scan = {start: {node: /** @type {Text} */ (w.firstChild), offset: 0}, caret: {node: rd, offset: 1}};
        move(/** @type {Element} */ (rd.parentElement));
        expect(lit()).toBe('word');
    });
    test('точка вне слова (щелчок ничего не нашёл бы) — без подсветки', () => {
        scan = null;
        move(span);
        expect(lit()).toBeNull();
    });
    test('кнопка — не подсвечивается', () => {
        move(span);
        move(button);
        expect(lit()).toBeNull();
        expect(document.documentElement.dataset.fcWordHover).toBeUndefined();
    });
    test('зажата кнопка мыши (выделение) — без подсветки', () => {
        move(span, {buttons: 1});
        expect(lit()).toBeNull();
    });
    test('клик-поиск выключен в настройках — без подсветки', () => {
        enabled = false;
        move(span);
        expect(lit()).toBeNull();
    });
    test('курсор ушёл из карточки — подсветка снята', () => {
        move(span);
        document.documentElement.dispatchEvent(new MouseEvent('mouseleave'));
        expect(lit()).toBeNull();
    });
    test('прокрутка снимает подсветку: под курсором уже другое слово', () => {
        move(span);
        document.dispatchEvent(new Event('scroll'));
        expect(lit()).toBeNull();
    });
    test('переход между узлами одного слова с тем же смещением не залипает на старом диапазоне', () => {
        const w = /** @type {HTMLElement} */ (document.querySelector('#w'));
        const wo = /** @type {Text} */ (w.firstChild);
        const rd = /** @type {Text} */ (/** @type {HTMLElement} */ (w.querySelector('b')).firstChild);
        scan = {start: {node: wo, offset: 0}, caret: {node: wo, offset: 1}};
        move(w);
        expect(lit()).toBe('word');
        // Тот же диапазон с другой стороны — без пересоздания, всё ещё «word».
        scan = {start: {node: wo, offset: 0}, caret: {node: rd, offset: 1}};
        move(/** @type {Element} */ (rd.parentElement));
        expect(lit()).toBe('word');
    });
    test('курсор на «wo» в wo<b>rd</b>: подсвечено всё «word» (конец идёт через разметку до границы слова)', () => {
        const w = /** @type {HTMLElement} */ (document.querySelector('#w'));
        const wo = /** @type {Text} */ (w.firstChild);
        scan = {start: {node: wo, offset: 0}, caret: {node: wo, offset: 1}};
        move(w);
        expect(lit()).toBe('word');
    });
    test('блочная граница — конец слова: <div>wo</div><div>rd</div> не склеиваются', () => {
        document.body.insertAdjacentHTML('beforeend', '<div class="entry" id="blk"><div>wo</div><div>rd</div></div>');
        const blk = /** @type {HTMLElement} */ (document.querySelector('#blk'));
        const wo = /** @type {Text} */ (/** @type {HTMLElement} */ (blk.firstElementChild).firstChild);
        scan = {start: {node: wo, offset: 0}, caret: {node: wo, offset: 1}};
        move(/** @type {Element} */ (wo.parentElement));
        expect(lit()).toBe('wo');
    });
});
