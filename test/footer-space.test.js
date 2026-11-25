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
import {builtinEnvironments} from 'vitest/environments';
import {FooterSpace} from '../ext/js/display/footer-space.js';

/** @type {() => Promise<void>} */
let teardown = async () => {};

/** Everything in pixels of the frame. @type {{view: number, notices: number, foot: {top: number, height: number}, scroll: number}} */
let layout;
/** @type {HTMLElement} */
let footer;
/** @type {HTMLElement} */
let scroll;
/** @type {?() => void} */
let onResize = null;

/**
 * @param {number} top
 * @param {number} height
 * @returns {DOMRect}
 */
const rect = (top, height) => /** @type {DOMRect} */ ({top, height, bottom: top + height});

beforeEach(async () => {
    const environment = await builtinEnvironments.jsdom.setup(globalThis, {jsdom: {html: `
        <div id="scroll"><div class="entry" data-type="phrase"><div class="ve-gw"><div class="fc-xp-foot"></div></div></div></div>
        <div id="footer"></div>
    `}});
    teardown = async () => { await environment.teardown(globalThis); };
    vi.stubGlobal('ResizeObserver', class {
        /** @param {() => void} callback */
        constructor(callback) { onResize = callback; }

        /** @param {Element} target */
        observe(target) { expect(target).toBe(footer); }
    });
    footer = /** @type {HTMLElement} */ (document.querySelector('#footer'));
    scroll = /** @type {HTMLElement} */ (document.querySelector('#scroll'));
    layout = {view: 600, notices: 0, foot: {top: 520, height: 80}, scroll: 100};
    footer.getBoundingClientRect = () => rect(layout.view - layout.notices, layout.notices);
    scroll.getBoundingClientRect = () => rect(0, layout.view);
    Object.defineProperty(scroll, 'scrollTop', {get: () => layout.scroll, set: (/** @type {number} */ value) => { layout.scroll = value; }});
    const foot = /** @type {HTMLElement} */ (document.querySelector('.fc-xp-foot'));
    foot.getBoundingClientRect = () => (foot.hidden ? rect(0, 0) : rect(layout.foot.top, layout.foot.height));
    new FooterSpace(footer, scroll).prepare();
});

afterEach(async () => {
    vi.unstubAllGlobals();
    await teardown();
});

/** @param {number} height */
function setNotices(height) {
    layout.notices = height;
    onResize?.();
}

/** @returns {string} */
const variable = () => document.documentElement.style.getPropertyValue('--footer-notifications-height');

describe('FooterSpace', () => {
    test('a notice over the bottom of the panel: the space is made, the results are scrolled by what was covered', () => {
        setNotices(70);
        expect(variable()).toBe('70px');
        expect(layout.scroll).toBe(170);
    });

    test('a second notice: by the rest', () => {
        setNotices(70);
        layout.foot.top -= 70;
        setNotices(110);
        expect(variable()).toBe('110px');
        expect(layout.scroll).toBe(210);
    });

    test('the results are not full: the panel goes up by itself, nothing is scrolled', () => {
        layout.foot.top = 440;
        setNotices(70);
        expect(variable()).toBe('70px');
        expect(layout.scroll).toBe(100);
    });

    test('the bottom of the panel is further down: no jump', () => {
        layout.foot.top = 600;
        setNotices(70);
        expect(layout.scroll).toBe(100);
    });

    test('only a part of it is seen: all of it', () => {
        layout.foot.top = 560;
        setNotices(70);
        expect(layout.scroll).toBe(210);
    });

    test('the bottom is hidden (nothing ticked), another kind of content: nothing is scrolled', () => {
        const foot = /** @type {HTMLElement} */ (document.querySelector('.fc-xp-foot'));
        foot.hidden = true;
        setNotices(70);
        foot.hidden = false;
        setNotices(0);
        /** @type {HTMLElement} */ (document.querySelector('.entry')).dataset.type = 'term';
        setNotices(70);
        expect(layout.scroll).toBe(100);
    });

    test('closed: the space is given back, nothing is scrolled', () => {
        setNotices(70);
        setNotices(0);
        expect(variable()).toBe('0px');
        expect(layout.scroll).toBe(170);
        // The same again.
        const set = vi.spyOn(document.documentElement.style, 'setProperty');
        setNotices(0);
        expect(set).not.toHaveBeenCalled();
    });

    test('no ResizeObserver: as before', () => {
        vi.stubGlobal('ResizeObserver', void 0);
        expect(() => { new FooterSpace(footer, scroll).prepare(); }).not.toThrow();
    });
});
