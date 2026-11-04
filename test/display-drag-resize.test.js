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
import {DisplayDrag} from '../ext/js/display/display-drag.js';
import {DisplayResizer} from '../ext/js/display/display-resizer.js';
import {getResizeKeyDelta, stepPopupSize} from '../ext/js/display/popup-size-util.js';
import {setupDomTest} from './fixtures/dom-test.js';

/** @returns {Promise<void>} */
const flush = async () => {
    for (let i = 0; i < 5; ++i) {
        await new Promise((resolve) => { setTimeout(resolve, 0); });
    }
};

describe('stepPopupSize', () => {
    test('меняется только ось шага', () => {
        expect(stepPopupSize({width: 1500, height: 300}, [0, -20])).toStrictEqual({width: 1500, height: 280});
    });
    test('рост упирается в верх, уменьшение — в низ', () => {
        expect(stepPopupSize({width: 1190, height: 300}, [20, 0])).toStrictEqual({width: 1200, height: 300});
        expect(stepPopupSize({width: 330, height: 300}, [-20, 0])).toStrictEqual({width: 320, height: 300});
    });
    test('уже за пределом — шаг к пределу не перепрыгивает назад', () => {
        expect(stepPopupSize({width: 1500, height: 300}, [20, 0])).toStrictEqual({width: 1500, height: 300});
        expect(stepPopupSize({width: 1500, height: 300}, [-20, 0])).toStrictEqual({width: 1480, height: 300});
        expect(stepPopupSize({width: 200, height: 300}, [-20, 0])).toStrictEqual({width: 200, height: 300});
    });
});

describe('getResizeKeyDelta', () => {
    /**
     * @param {string} name
     * @param {boolean} [altKey]
     * @returns {KeyboardEvent}
     */
    const key = (name, altKey = false) => /** @type {KeyboardEvent} */ (/** @type {unknown} */ ({key: name, altKey, ctrlKey: false, metaKey: false, shiftKey: false}));
    test('стрелки — ±20 по оси', () => {
        expect(getResizeKeyDelta(key('ArrowRight'))).toStrictEqual([20, 0]);
        expect(getResizeKeyDelta(key('ArrowUp'))).toStrictEqual([0, -20]);
    });
    test('с модификатором и прочие клавиши — null', () => {
        expect(getResizeKeyDelta(key('ArrowRight', true))).toBeNull();
        expect(getResizeKeyDelta(key('Enter'))).toBeNull();
    });
});

describe('DisplayResizer — клавиатура, сброс, подсказка', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    /** @type {HTMLElement} */
    let handle;
    /** @type {import('vitest').Mock} */
    let setSize;
    beforeEach(async () => {
        env = await setupDomTest();
        handle = document.createElement('div');
        handle.id = 'frame-resizer-handle';
        document.body.appendChild(handle);
        setSize = vi.fn().mockResolvedValue(void 0);
        const display = {
            parentPopupId: 'popup-1',
            invokeParentFrame: vi.fn().mockResolvedValue({width: 400, height: 300, valid: true}),
            invokeContentOrigin: setSize,
            getOptions: () => ({general: {popupWidth: 420, popupHeight: 260}}),
        };
        new DisplayResizer(/** @type {*} */ (display)).prepare();
    });
    afterEach(async () => { await env.teardown(global); });

    test('уголок фокусируемый, role=slider с подписью', () => {
        expect(handle.getAttribute('tabindex')).toBe('0');
        expect(handle.getAttribute('role')).toBe('slider');
        expect(handle.getAttribute('aria-label')).toContain('Размер');
    });

    test('→ шире на 20, ↓ выше на 20; подсказка «W × H»', async () => {
        handle.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', bubbles: true}));
        await flush();
        expect(setSize).toHaveBeenLastCalledWith('frontendSetPopupSize', {width: 420, height: 300});
        expect(document.querySelector('.fc-rz-tip')?.textContent).toBe('420 × 300');
        handle.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowDown', bubbles: true}));
        await flush();
        expect(setSize).toHaveBeenLastCalledWith('frontendSetPopupSize', {width: 400, height: 320});
        expect(handle.getAttribute('aria-valuetext')).toBe('400 × 320');
    });

    test('Alt+стрелка — не наша', async () => {
        handle.dispatchEvent(new KeyboardEvent('keydown', {key: 'ArrowRight', altKey: true, bubbles: true}));
        await flush();
        expect(setSize).not.toHaveBeenCalled();
    });

    test('двойной щелчок — размер из настроек, подрезанный под окно (fit)', async () => {
        handle.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
        await flush();
        expect(setSize).toHaveBeenLastCalledWith('frontendSetPopupSize', {width: 420, height: 260, fit: true});
        expect(handle.getAttribute('aria-valuetext')).toBe('420 × 260');
    });

    test('двойной щелчок: подсказка показывает размер, который встал на самом деле', async () => {
        setSize.mockResolvedValueOnce({width: 420, height: 230});
        handle.dispatchEvent(new MouseEvent('dblclick', {bubbles: true}));
        await flush();
        expect(handle.getAttribute('aria-valuetext')).toBe('420 × 230');
    });
});

describe('DisplayDrag — карточку тащат за пустое место панели', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    /** @type {import('vitest').Mock} */
    let invoke;
    /** @type {HTMLElement} */
    let toolbar;
    /** @type {boolean} */
    let canDrag;
    /** @type {Map<string, () => void>} */
    let listeners;
    /** @returns {unknown[][]} */
    const dragCalls = () => invoke.mock.calls.filter((c) => c[0] === 'frontendBeginPopupDrag');
    beforeEach(async () => {
        env = await setupDomTest();
        toolbar = document.createElement('div');
        toolbar.className = 'popup-toolbar';
        const button = document.createElement('button');
        button.className = 'tb';
        toolbar.appendChild(button);
        document.body.appendChild(toolbar);
        const body = document.createElement('div');
        body.className = 'entry';
        document.body.appendChild(body);
        canDrag = true;
        invoke = vi.fn(async (/** @type {string} */ action) => (action === 'frontendCanDragPopup' ? canDrag : void 0));
        listeners = new Map();
        const display = {
            invokeContentOrigin: invoke,
            on: (/** @type {string} */ name, /** @type {() => void} */ callback) => { listeners.set(name, callback); },
        };
        new DisplayDrag(/** @type {*} */ (display)).prepare();
    });
    afterEach(async () => { await env.teardown(global); });

    /**
     * @param {Element} target
     * @param {number} [button]
     */
    const down = (target, button = 0) => {
        // jsdom has no PointerEvent: a MouseEvent of type pointerdown with pointerId.
        const event = new MouseEvent('pointerdown', {bubbles: true, cancelable: true, button, clientX: 10, clientY: 5});
        Object.defineProperty(event, 'pointerId', {value: 1});
        target.dispatchEvent(event);
    };

    test('пустое место панели — перетаскивание', () => {
        down(toolbar);
        expect(invoke).toHaveBeenCalledWith('frontendBeginPopupDrag', {pointerId: 1, clientX: 10, clientY: 5});
    });
    test('кнопка в панели, статья, правая кнопка — нет', () => {
        down(/** @type {Element} */ (toolbar.querySelector('button')));
        down(/** @type {Element} */ (document.querySelector('.entry')));
        down(toolbar, 2);
        expect(dragCalls()).toHaveLength(0);
    });
    test('режим окна (вызов отклонён) — тихо', async () => {
        invoke.mockRejectedValue(new Error('no iframe'));
        down(toolbar);
        await flush();
        expect(dragCalls()).toHaveLength(1);
    });

    test('«рука» только там, где фронтенд умеет тащить: спрашивает при старте и на каждой выдаче', async () => {
        await flush();
        expect(document.documentElement.dataset.fcDrag).toBe('on');
        // Новая выдача пришла от вложенной карточки / окна: тащить нечем.
        canDrag = false;
        listeners.get('contentUpdateComplete')?.();
        await flush();
        expect(document.documentElement.dataset.fcDrag).toBeUndefined();
        // Фронтенд недоступен (вызов отклонён) — тоже без «руки».
        canDrag = true;
        listeners.get('contentUpdateComplete')?.();
        await flush();
        expect(document.documentElement.dataset.fcDrag).toBe('on');
        invoke.mockRejectedValue(new Error('gone'));
        listeners.get('contentUpdateComplete')?.();
        await flush();
        expect(document.documentElement.dataset.fcDrag).toBeUndefined();
    });
});
