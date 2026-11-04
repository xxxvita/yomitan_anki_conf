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
import {Frontend} from '../ext/js/app/frontend.js';
import {EventDispatcher} from '../ext/js/core/event-dispatcher.js';
import {DisplayCrumbs, nextCrumbs, sanitizeCrumbs} from '../ext/js/display/display-crumbs.js';
import {setupDomTest} from './fixtures/dom-test.js';

describe('sanitizeCrumbs', () => {
    test('не массив — пусто', () => {
        expect(sanitizeCrumbs(void 0)).toStrictEqual([]);
        expect(sanitizeCrumbs('google')).toStrictEqual([]);
    });
    test('только непустые строки, обрезка пробелов', () => {
        expect(sanitizeCrumbs([' google ', '', 3, null, 'search'])).toStrictEqual(['google', 'search']);
    });
    test('длинное слово — 40 символов с многоточием', () => {
        const [w] = sanitizeCrumbs(['a'.repeat(60)]);
        expect(w).toHaveLength(40);
        expect(w.endsWith('…')).toBe(true);
    });
    test('не больше 6 последних звеньев', () => {
        expect(sanitizeCrumbs(['1', '2', '3', '4', '5', '6', '7', '8'])).toStrictEqual(['3', '4', '5', '6', '7', '8']);
    });
});

describe('nextCrumbs', () => {
    test('добавляет текущий запрос', () => { expect(nextCrumbs(['google'], 'search')).toStrictEqual(['google', 'search']); });
    test('пустой запрос не добавляется', () => { expect(nextCrumbs(['google'], '  ')).toStrictEqual(['google']); });
    test('мусор на входе — только запрос', () => { expect(nextCrumbs(/** @type {*} */ (null), 'google')).toStrictEqual(['google']); });
});

/**
 * @augments EventDispatcher<import('display').Events>
 */
class FakeDisplay extends EventDispatcher {
    constructor() {
        super();
        /** @type {{state: ?import('display').HistoryState}} */
        this.history = {state: null};
        /** @type {string} */
        this.query = '';
    }
}

describe('DisplayCrumbs', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    /** @type {FakeDisplay} */
    let display;
    /** @type {HTMLElement} */
    let inner;
    beforeEach(async () => {
        env = await setupDomTest();
        inner = document.createElement('div');
        inner.className = 'content-body-inner';
        inner.appendChild(document.createElement('span'));
        document.body.appendChild(inner);
        display = new FakeDisplay();
        new DisplayCrumbs(/** @type {*} */ (display)).prepare();
    });
    afterEach(async () => { await env.teardown(global); });

    test('верхний уровень (нет crumbs) — шапки нет', () => {
        display.query = 'google';
        display.trigger('contentUpdateComplete', {type: 'terms'});
        expect(document.querySelector('.fc-nest-h')).toBeNull();
    });

    test('вложенная — цепочка, текущее слово выделено, шапка первая в content-body-inner', () => {
        display.history.state = {crumbs: ['google', 'search']};
        display.query = 'engine';
        display.trigger('contentUpdateComplete', {type: 'terms'});
        const h = /** @type {HTMLElement} */ (document.querySelector('.fc-nest-h'));
        expect(inner.firstElementChild).toBe(h);
        expect([...h.querySelectorAll('.fc-crumb')].map((e) => e.textContent)).toStrictEqual(['google', 'search', 'engine']);
        expect(h.querySelector('.fc-crumb.fc-cur')?.textContent).toBe('engine');
        expect(h.querySelector('.fc-crumb.fc-cur')?.getAttribute('aria-current')).toBe('page');
    });

    test('новая выдача без crumbs — шапка убрана; повтор не плодит шапки', () => {
        display.history.state = {crumbs: ['google']};
        display.query = 'search';
        display.trigger('contentUpdateComplete', {type: 'terms'});
        display.trigger('contentUpdateComplete', {type: 'terms'});
        expect(document.querySelectorAll('.fc-nest-h')).toHaveLength(1);
        display.history.state = {};
        display.trigger('contentUpdateComplete', {type: 'terms'});
        expect(document.querySelector('.fc-nest-h')).toBeNull();
    });

    test('пока ищется новое — старая цепочка не висит', () => {
        display.history.state = {crumbs: ['google']};
        display.query = 'search';
        display.trigger('contentUpdateComplete', {type: 'terms'});
        display.trigger('contentClear', {});
        expect(document.querySelector('.fc-nest-h')).toBeNull();
    });
});

describe('Frontend — цепочка для вложенного попапа', () => {
    /**
     * @param {?() => string[]} provider
     * @returns {import('display').ContentDetails}
     */
    const show = (provider) => {
        const showPopupContent = vi.fn();
        const context = {_crumbsProvider: provider, _application: {tabId: 1, frameId: 0}, _showPopupContent: showPopupContent};
        const textSource = {text: () => 'engine'};
        // eslint-disable-next-line no-underscore-dangle
        Frontend.prototype._showContent.call(/** @type {*} */ (context), /** @type {*} */ (textSource), false, null, 'terms', null, null, /** @type {*} */ ({url: 'u'}), 'light');
        return showPopupContent.mock.calls[0][2];
    };
    test('провайдер задан — crumbs в состоянии', () => {
        expect(show(() => ['google', 'search']).state?.crumbs).toStrictEqual(['google', 'search']);
    });
    test('провайдера нет (верхний уровень) — crumbs нет', () => {
        expect(show(null).state).not.toHaveProperty('crumbs');
    });
});
