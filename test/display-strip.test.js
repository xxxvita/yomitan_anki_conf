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
import {DisplayStrip} from '../ext/js/display/display-strip.js';
import {setupDomTest} from './fixtures/dom-test.js';

/**
 * @augments EventDispatcher<import('display').Events>
 */
class FakeDisplay extends EventDispatcher {
    constructor() {
        super();
        /** @type {unknown[]} */
        this.dictionaryEntries = [];
        /** @type {number} */
        this.selectedIndex = 0;
        /**
         *
         */
        this.moveCurrentEntry = vi.fn((/** @type {number} */ offset) => {
            this.selectedIndex = Math.max(0, Math.min(this.dictionaryEntries.length - 1, this.selectedIndex + offset));
            this.trigger('currentEntryChanged', {index: this.selectedIndex});
        });
    }
}

describe('DisplayStrip', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    /** @type {FakeDisplay} */
    let display;
    /** @type {HTMLElement} */
    let top;
    beforeEach(async () => {
        env = await setupDomTest();
        top = document.createElement('div');
        top.className = 'content-sidebar-top';
        document.body.appendChild(top);
        display = new FakeDisplay();
        new DisplayStrip(/** @type {*} */ (display)).prepare();
    });
    afterEach(async () => { await env.teardown(global); });

    /** @param {number} n */
    const load = (n) => {
        display.dictionaryEntries = Array.from({length: n}, () => ({}));
        display.selectedIndex = 0;
        display.trigger('contentUpdateComplete', {type: 'terms'});
    };
    const prev = () => /** @type {HTMLButtonElement} */ (top.querySelector('.fc-strip-prev'));
    const next = () => /** @type {HTMLButtonElement} */ (top.querySelector('.fc-strip-next'));
    const count = () => /** @type {HTMLElement} */ (top.querySelector('.fc-strip-count'));

    test('кнопки статей встают в полосу один раз', () => {
        load(3);
        load(2);
        expect(top.querySelectorAll('.fc-strip-prev')).toHaveLength(1);
        expect(top.querySelectorAll('.fc-strip-count')).toHaveLength(1);
    });

    test('три статьи: «1/3», вверх недоступно, вниз доступно', () => {
        load(3);
        expect(count().textContent).toBe('1/3');
        expect(count().hidden).toBe(false);
        expect(prev().disabled).toBe(true);
        expect(next().disabled).toBe(false);
    });

    test('вниз двигает текущую статью, счётчик и кнопки следуют за ней', () => {
        load(3);
        next().click();
        next().click();
        expect(display.moveCurrentEntry).toHaveBeenCalledWith(1);
        expect(count().textContent).toBe('3/3');
        expect(next().disabled).toBe(true);
        expect(prev().disabled).toBe(false);
    });

    test('одна статья или ни одной — счётчик скрыт, обе кнопки недоступны', () => {
        load(1);
        expect(count().hidden).toBe(true);
        expect(prev().disabled).toBe(true);
        expect(next().disabled).toBe(true);
        load(0);
        expect(count().hidden).toBe(true);
        expect(next().disabled).toBe(true);
    });

    test('горячая клавиша (смена текущей статьи извне) тоже обновляет счётчик', () => {
        load(4);
        display.selectedIndex = 2;
        display.trigger('currentEntryChanged', {index: 2});
        expect(count().textContent).toBe('3/4');
    });
});
