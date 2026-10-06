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

/*
 * AbortSignal.timeout появился в Chrome 103 / Firefox 100, AbortSignal.any — в
 * Chrome 116 / Firefox 124, а минимумы манифеста — Chrome 102 / Firefox 115.
 * Здесь запасные реализации на AbortController + setTimeout и выбор между ними.
 */

/**
 * @param {number} ms
 * @returns {AbortSignal}
 */
export function createTimeoutSignalFallback(ms) {
    const controller = new AbortController();
    setTimeout(() => {
        controller.abort(new DOMException('The operation timed out.', 'TimeoutError'));
    }, ms);
    return controller.signal;
}

/**
 * @param {AbortSignal[]} signals
 * @returns {AbortSignal}
 */
export function anyAbortSignalFallback(signals) {
    const controller = new AbortController();
    for (const signal of signals) {
        if (signal.aborted) {
            controller.abort(signal.reason);
            return controller.signal;
        }
    }
    /** @type {(() => void)[]} */
    const cleanups = [];
    for (const signal of signals) {
        /** @type {() => void} */
        const onAbort = () => {
            for (const cleanup of cleanups) { cleanup(); }
            controller.abort(signal.reason);
        };
        signal.addEventListener('abort', onAbort, {once: true});
        cleanups.push(() => signal.removeEventListener('abort', onAbort));
    }
    return controller.signal;
}

/**
 * Сигнал, срабатывающий через `ms` (причина — TimeoutError).
 * @param {number} ms
 * @returns {AbortSignal}
 */
export function createTimeoutSignal(ms) {
    return typeof AbortSignal.timeout === 'function' ? AbortSignal.timeout(ms) : createTimeoutSignalFallback(ms);
}

/**
 * Сигнал, срабатывающий вместе с любым из `signals`.
 * @param {AbortSignal[]} signals
 * @returns {AbortSignal}
 */
export function anyAbortSignal(signals) {
    return typeof AbortSignal.any === 'function' ? AbortSignal.any(signals) : anyAbortSignalFallback(signals);
}
