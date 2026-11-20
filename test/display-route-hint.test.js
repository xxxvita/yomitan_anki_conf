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

import {describe, expect, test, vi} from 'vitest';
import {EventDispatcher} from '../ext/js/core/event-dispatcher.js';
import {DisplayRouteHint} from '../ext/js/display/display-route-hint.js';

const ROUTE_URL = 'https://flib.club/player?v=abc&rp=youtube%3A%3AdQw4w9WgXcQ';

/**
 * @param {string} term
 * @returns {object}
 */
function termEntry(term) {
    return {type: 'term', headwords: [{term}]};
}

/**
 * @augments EventDispatcher<import('display').Events>
 */
class FakeDisplay extends EventDispatcher {
    /**
     * @param {string} url
     * @param {number} [depth]
     */
    constructor(url, depth = 0) {
        super();
        /** @type {object[]} */
        this.dictionaryEntries = [];
        /** @type {number} */
        this.selectedIndex = 0;
        /** @type {number} */
        this.depth = depth;
        /** @type {string} */
        this.url = url;
    }

    /** @returns {{url: string}} */
    getOptionsContext() { return {url: this.url}; }

    /** @param {object[]} entries */
    show(entries) {
        this.dictionaryEntries = entries;
        this.trigger('contentUpdateComplete', {type: 'terms'});
    }
}

/**
 * @param {string} url
 * @param {number} [depth]
 * @param {import('vitest').Mock} [record]
 * @returns {{display: FakeDisplay, record: import('vitest').Mock}}
 */
function setup(url, depth = 0, record = vi.fn(async () => ({}))) {
    const display = new FakeDisplay(url, depth);
    new DisplayRouteHint(/** @type {*} */ (display), {api: /** @type {*} */ ({flibRecordEvent: record})}).prepare();
    return {display, record};
}

describe('DisplayRouteHint', () => {
    test('route url plus term entry reports hint_requested', () => {
        const {display, record} = setup(ROUTE_URL);
        display.show([termEntry('book')]);
        expect(record).toHaveBeenCalledTimes(1);
        expect(record).toHaveBeenCalledWith('hint_requested', ['book']);
    });

    test('uses the selected entry', () => {
        const {display, record} = setup(ROUTE_URL);
        display.selectedIndex = 1;
        display.show([termEntry('a'), termEntry('b')]);
        expect(record).toHaveBeenCalledWith('hint_requested', ['b']);
    });

    test('non-route url sends nothing', () => {
        const {display, record} = setup('https://flib.club/player');
        display.show([termEntry('book')]);
        expect(record).not.toHaveBeenCalled();
    });

    test('depth 1 sends nothing', () => {
        const {display, record} = setup(ROUTE_URL, 1);
        display.show([termEntry('book')]);
        expect(record).not.toHaveBeenCalled();
    });

    test('no entries, kanji entry or blank term send nothing', () => {
        const {display, record} = setup(ROUTE_URL);
        display.show([]);
        display.show([{type: 'kanji', character: 'x'}]);
        display.show([termEntry('   ')]);
        expect(record).not.toHaveBeenCalled();
    });

    test('two updates send two calls', () => {
        const {display, record} = setup(ROUTE_URL);
        display.show([termEntry('book')]);
        display.show([termEntry('book')]);
        expect(record).toHaveBeenCalledTimes(2);
    });

    test('a rejected call is swallowed', async () => {
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        const {display, record} = setup(ROUTE_URL, 0, vi.fn(async () => { throw new Error('down'); }));
        expect(() => { display.show([termEntry('book')]); }).not.toThrow();
        await new Promise((resolve) => { setTimeout(resolve, 10); });
        process.off('unhandledRejection', unhandled);
        expect(record).toHaveBeenCalledTimes(1);
        expect(unhandled).not.toHaveBeenCalled();
    });
});
