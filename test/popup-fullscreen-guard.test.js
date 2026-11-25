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

import {afterAll, afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {setupDomTest} from './fixtures/dom-test.js';
import {ENTER_LOOKBACK, PopupFullscreenGuard, SETTLE_TIMEOUT, registerPopupContainer} from '../ext/js/app/popup-fullscreen-guard.js';

const {window, teardown} = await setupDomTest();
const {document} = window;

/** @type {?Element} */
let fullscreenElement = null;
Object.defineProperty(document, 'fullscreenElement', {configurable: true, get: () => fullscreenElement});

const ours = document.createElement('iframe');
const ours2 = document.createElement('div');
registerPopupContainer(ours);
registerPopupContainer(ours2);

/**
 * @param {number} width
 * @param {number} height
 * @param {boolean} [event]
 */
function resize(width, height, event = true) {
    Object.defineProperty(window, 'innerWidth', {configurable: true, value: width});
    Object.defineProperty(window, 'innerHeight', {configurable: true, value: height});
    if (event) { window.dispatchEvent(new window.Event('resize')); }
}

/** @param {?Element} element */
function change(element) {
    fullscreenElement = element;
    document.dispatchEvent(new window.Event('fullscreenchange'));
}

/** @type {PopupFullscreenGuard} */
let guard;
/** @type {import('vitest').Mock} */
let onOwnFullscreenEnter;
/** @type {import('vitest').Mock} */
let onOwnFullscreenSettled;

/** @returns {[number, number]} */
function viewport() {
    const {innerWidth, innerHeight} = guard.getViewport();
    return [innerWidth, innerHeight];
}

beforeEach(() => {
    vi.useFakeTimers();
    fullscreenElement = null;
    resize(1248, 615);
    onOwnFullscreenEnter = vi.fn();
    onOwnFullscreenSettled = vi.fn();
    guard = new PopupFullscreenGuard();
    guard.prepare();
    guard.addListener({onOwnFullscreenEnter, onOwnFullscreenSettled});
});

afterEach(() => {
    change(null);
    vi.advanceTimersByTime(5000);
    vi.useRealTimers();
});

afterAll(() => teardown(global));

describe('PopupFullscreenGuard', () => {
    test('Chrome: active from the entry until SETTLE_TIMEOUT after the exit; the viewport before stays known', () => {
        expect(guard.isActive()).toBe(false);
        fullscreenElement = ours;
        resize(1248, 702);
        expect([guard.isActive(), viewport()]).toEqual([true, [1248, 615]]);
        change(ours);
        resize(1600, 944);
        vi.advanceTimersByTime(60000);
        expect([guard.isActive(), viewport()]).toEqual([true, [1248, 615]]);
        fullscreenElement = null;
        resize(1600, 857);
        change(null);
        resize(1248, 615);
        vi.advanceTimersByTime(SETTLE_TIMEOUT - 1);
        expect([guard.isActive(), viewport()]).toEqual([true, [1248, 615]]);
        expect(onOwnFullscreenSettled).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onOwnFullscreenSettled.mock.calls).toEqual([[true]]);
        expect(onOwnFullscreenEnter.mock.calls).toEqual([[false]]);
        expect(guard.isActive()).toBe(false);
    });

    test('no event at all: the state is read at the query', () => {
        fullscreenElement = ours;
        resize(1600, 944, false);
        expect([guard.isActive(), viewport()]).toEqual([true, [1248, 615]]);
        fullscreenElement = null;
        resize(1600, 857, false);
        expect([guard.isActive(), viewport()]).toEqual([true, [1248, 615]]);
        resize(1248, 615, false);
        vi.advanceTimersByTime(SETTLE_TIMEOUT);
        expect(onOwnFullscreenSettled.mock.calls).toEqual([[true]]);
    });

    test('Firefox: fullscreenchange first on the exit, a smaller window in between', () => {
        fullscreenElement = ours;
        resize(1600, 1000);
        change(ours);
        resize(1196, 563, false);
        change(null);
        resize(1196, 563);
        expect(viewport()).toEqual([1248, 615]);
        resize(1248, 615);
        vi.advanceTimersByTime(SETTLE_TIMEOUT);
        expect(onOwnFullscreenSettled.mock.calls).toEqual([[true]]);
    });

    test('the window is back before the element is cleared', () => {
        change(ours);
        resize(1600, 944);
        resize(1248, 615);
        expect(guard.isActive()).toBe(true);
        change(null);
        vi.advanceTimersByTime(SETTLE_TIMEOUT);
        expect(onOwnFullscreenSettled.mock.calls).toEqual([[true]]);
    });

    test('a window which never changed (F11 mode)', () => {
        change(ours);
        change(null);
        vi.advanceTimersByTime(SETTLE_TIMEOUT);
        expect(onOwnFullscreenSettled.mock.calls).toEqual([[true]]);
    });

    test('another window after the exit → not back; the new one is the base of the next round', () => {
        change(ours);
        resize(1600, 944);
        change(null);
        resize(1000, 700);
        vi.advanceTimersByTime(SETTLE_TIMEOUT);
        expect(onOwnFullscreenSettled.mock.calls).toEqual([[false]]);
        expect(guard.isActive()).toBe(false);
        change(ours);
        resize(1600, 944);
        expect(viewport()).toEqual([1000, 700]);
        change(null);
        resize(1000, 700);
        vi.advanceTimersByTime(SETTLE_TIMEOUT);
        expect(onOwnFullscreenSettled.mock.calls).toEqual([[false], [true]]);
    });

    test('fullscreen again while waiting, and from one of our containers to another: one round', () => {
        change(ours);
        resize(1600, 944);
        change(null);
        resize(1600, 857);
        vi.advanceTimersByTime(SETTLE_TIMEOUT - 100);
        change(ours2);
        vi.advanceTimersByTime(60000);
        expect(onOwnFullscreenSettled).not.toHaveBeenCalled();
        expect(viewport()).toEqual([1248, 615]);
        change(ours);
        change(null);
        resize(1248, 615);
        vi.advanceTimersByTime(SETTLE_TIMEOUT);
        expect(onOwnFullscreenSettled.mock.calls).toEqual([[true]]);
        expect(onOwnFullscreenEnter).toHaveBeenCalledTimes(1);
    });

    test('the second exit waits its own full time', () => {
        change(ours);
        change(null);
        vi.advanceTimersByTime(300);
        change(ours);
        vi.advanceTimersByTime(300);
        change(null);
        vi.advanceTimersByTime(SETTLE_TIMEOUT - 1);
        expect(onOwnFullscreenSettled).not.toHaveBeenCalled();
        vi.advanceTimersByTime(1);
        expect(onOwnFullscreenSettled).toHaveBeenCalledTimes(1);
    });

    test('a fullscreen element of the page is not ours', () => {
        fullscreenElement = document.createElement('video');
        resize(1600, 944);
        change(fullscreenElement);
        expect([guard.isActive(), viewport()]).toEqual([false, [1600, 944]]);
        change(null);
        resize(1248, 615);
        expect([guard.isActive(), viewport()]).toEqual([false, [1248, 615]]);
        expect(onOwnFullscreenEnter).not.toHaveBeenCalled();
        vi.advanceTimersByTime(5000);
        expect(onOwnFullscreenSettled).not.toHaveBeenCalled();
    });

    test('resizes before the element is set belong to the entry; older ones do not', () => {
        resize(1000, 615);
        vi.advanceTimersByTime(ENTER_LOOKBACK + 1);
        resize(1000, 702);
        vi.advanceTimersByTime(100);
        resize(1600, 944);
        change(ours);
        expect(viewport()).toEqual([1000, 615]);
        expect(onOwnFullscreenEnter.mock.calls).toEqual([[true]]);
    });

    test('resizes older than ENTER_LOOKBACK are the user\'s', () => {
        resize(1000, 615);
        vi.advanceTimersByTime(ENTER_LOOKBACK + 1);
        change(ours);
        expect(viewport()).toEqual([1000, 615]);
        expect(onOwnFullscreenEnter.mock.calls).toEqual([[false]]);
    });

    test('the snapshot keeps the visual viewport', () => {
        const visualViewport = {offsetLeft: 20, offsetTop: 5, width: 600, height: 400, scale: 2};
        Object.defineProperty(window, 'visualViewport', {configurable: true, value: visualViewport});
        try {
            resize(1248, 615);
            fullscreenElement = ours;
            Object.assign(visualViewport, {offsetLeft: 0, offsetTop: 0, width: 1600, height: 944, scale: 1});
            resize(1600, 944);
            expect(guard.getViewport().visualViewport).toEqual({offsetLeft: 20, offsetTop: 5, width: 600, height: 400, scale: 2});
        } finally {
            // @ts-expect-error - test-only property
            delete window.visualViewport;
        }
    });
});
