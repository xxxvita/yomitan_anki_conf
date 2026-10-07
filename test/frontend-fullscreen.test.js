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


import {afterAll, describe, expect, test, vi} from 'vitest';
import {setupDomTest} from './fixtures/dom-test.js';
import {Frontend} from '../ext/js/app/frontend.js';

const {window, teardown} = await setupDomTest();
const {document} = window;

/** @type {?Element} */
let currentFullscreenElement = null;
Object.defineProperty(document, 'fullscreenElement', {configurable: true, get: () => currentFullscreenElement});

// Как в popup-size-target.test.js: метод с прототипа, `this` — простой объект
// только с теми полями, которые метод трогает.
/* eslint-disable no-underscore-dangle */
// eslint-disable-next-line @typescript-eslint/unbound-method
const onFullscreenChanged = Frontend.prototype._onFullscreenChanged;

/**
 * @param {?{container: ?Element}} popup
 * @returns {{_popup: ?{container: ?Element}, _ownPopupFullscreen: boolean, _updatePopup: import('vitest').Mock}}
 */
function createContext(popup) {
    return {_popup: popup, _ownPopupFullscreen: false, _updatePopup: vi.fn(async () => {})};
}

/**
 * @param {ReturnType<typeof createContext>} context
 * @param {?Element} element
 */
function fire(context, element) {
    currentFullscreenElement = element;
    onFullscreenChanged.call(context);
}

describe('Frontend._onFullscreenChanged', () => {
    afterAll(() => teardown(global));

    test('our popup iframe enters fullscreen (video inside it) → skip; exit → skip', () => {
        const iframe = document.createElement('iframe');
        const context = createContext({container: iframe});
        fire(context, iframe);
        expect(context._updatePopup).not.toHaveBeenCalled();
        expect(context._ownPopupFullscreen).toBe(true);
        fire(context, null);
        expect(context._updatePopup).not.toHaveBeenCalled();
        expect(context._ownPopupFullscreen).toBe(false);
    });

    test('shadow-DOM popup: the fullscreen element is the shadow host container → skip', () => {
        const host = document.createElement('div');
        host.attachShadow({mode: 'closed'}).appendChild(document.createElement('iframe'));
        const context = createContext({container: host});
        fire(context, host);
        fire(context, null);
        expect(context._updatePopup).not.toHaveBeenCalled();
    });

    test('a page element (its own <video>) goes fullscreen and back → _updatePopup both times', () => {
        const context = createContext({container: document.createElement('iframe')});
        fire(context, document.createElement('video'));
        expect(context._updatePopup).toHaveBeenCalledTimes(1);
        fire(context, null);
        expect(context._updatePopup).toHaveBeenCalledTimes(2);
        expect(context._ownPopupFullscreen).toBe(false);
    });

    test('a foreign iframe with the same class is not ours', () => {
        const ours = document.createElement('iframe');
        const foreign = document.createElement('iframe');
        foreign.className = ours.className = 'yomitan-popup';
        const context = createContext({container: ours});
        fire(context, foreign);
        expect(context._updatePopup).toHaveBeenCalledTimes(1);
    });

    test('proxy/window popup (container is null) or no popup yet → unchanged behaviour', () => {
        for (const popup of [{container: null}, null]) {
            const context = createContext(popup);
            fire(context, document.createElement('iframe'));
            fire(context, null);
            expect(context._updatePopup).toHaveBeenCalledTimes(2);
        }
    });

    test('own → page element directly (no null in between) → skip the own exit, then update for the page', () => {
        const iframe = document.createElement('iframe');
        const context = createContext({container: iframe});
        fire(context, iframe);
        fire(context, document.createElement('video'));
        // wasOwn was true on this change: the switch away from our frame is ours too.
        expect(context._updatePopup).not.toHaveBeenCalled();
        fire(context, null);
        expect(context._updatePopup).toHaveBeenCalledTimes(1);
    });
});
/* eslint-enable no-underscore-dangle */
