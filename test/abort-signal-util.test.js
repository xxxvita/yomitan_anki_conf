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

import {afterEach, describe, expect, test, vi} from 'vitest';
import {
    anyAbortSignal,
    anyAbortSignalFallback,
    createTimeoutSignal,
    createTimeoutSignalFallback,
} from '../ext/js/core/abort-signal-util.js';

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** @type {(() => void)[]} */
const restores = [];
afterEach(() => {
    for (const restore of restores.splice(0)) { restore(); }
});

/**
 * Временно убирает статический метод AbortSignal, как в Chrome 102 / Firefox 115.
 * @param {'any' | 'timeout'} name
 */
function removeNative(name) {
    const descriptor = Object.getOwnPropertyDescriptor(AbortSignal, name);
    Object.defineProperty(AbortSignal, name, {value: void 0, configurable: true, writable: true});
    restores.push(() => {
        if (typeof descriptor !== 'undefined') { Object.defineProperty(AbortSignal, name, descriptor); }
    });
}

describe('createTimeoutSignalFallback', () => {
    test('срабатывает по времени с причиной TimeoutError', async () => {
        const signal = createTimeoutSignalFallback(5);
        expect(signal.aborted).toBe(false);
        await wait(30);
        expect(signal.aborted).toBe(true);
        expect(/** @type {{name?: unknown}} */ (signal.reason).name).toBe('TimeoutError');
    });
});

describe('anyAbortSignalFallback', () => {
    test('срабатывает, когда сработал любой из сигналов, с его причиной', () => {
        const a = new AbortController();
        const b = new AbortController();
        const combined = anyAbortSignalFallback([a.signal, b.signal]);
        expect(combined.aborted).toBe(false);
        b.abort('why');
        expect(combined.aborted).toBe(true);
        expect(combined.reason).toBe('why');
    });
    test('уже сработавший сигнал на входе → сразу сработавший результат', () => {
        const a = new AbortController();
        a.abort('early');
        const combined = anyAbortSignalFallback([new AbortController().signal, a.signal]);
        expect(combined.aborted).toBe(true);
        expect(combined.reason).toBe('early');
    });
});

describe('anyAbortSignalFallback: уборка', () => {
    test('после срабатывания одного сигнала слушатели с остальных сняты', () => {
        const a = new AbortController();
        const b = new AbortController();
        const c = new AbortController();
        const removeB = vi.spyOn(b.signal, 'removeEventListener');
        const removeC = vi.spyOn(c.signal, 'removeEventListener');
        const addB = vi.spyOn(b.signal, 'addEventListener');
        anyAbortSignalFallback([a.signal, b.signal, c.signal]);
        a.abort();
        expect(removeB).toHaveBeenCalledWith('abort', addB.mock.calls[0][1]);
        expect(removeC).toHaveBeenCalledTimes(1);
        expect(removeC.mock.calls[0][0]).toBe('abort');
    });
});

describe('выбор реализации', () => {
    test('без AbortSignal.timeout работает запасная', async () => {
        removeNative('timeout');
        const signal = createTimeoutSignal(5);
        await wait(30);
        expect(signal.aborted).toBe(true);
    });
    test('без AbortSignal.any работает запасная', () => {
        removeNative('any');
        const a = new AbortController();
        const combined = anyAbortSignal([a.signal, new AbortController().signal]);
        a.abort();
        expect(combined.aborted).toBe(true);
    });
    test('родные есть — используются родные', async () => {
        const a = new AbortController();
        const combined = anyAbortSignal([a.signal]);
        a.abort();
        expect(combined.aborted).toBe(true);
        const signal = createTimeoutSignal(5);
        await wait(30);
        expect(signal.aborted).toBe(true);
    });
});
