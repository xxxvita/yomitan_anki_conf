/*
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
// jsdom gaps the copied player needs, the same as the site's own vendor/flib-site/web/vitest.setup.ts
// (PointerEvent, ResizeObserver, URL.createObjectURL). Storage is not polyfilled here: in these
// tests, as in the bundle, the copy reads the layer's storage (build define -> __flibYtLocalStorage).
// Node-environment tests have no DOM; every polyfill is guarded.
import {vi} from 'vitest';

if (typeof globalThis.PointerEvent === 'undefined' && typeof MouseEvent !== 'undefined') {
    class PointerEventPolyfill extends MouseEvent {
        pointerId: number;
        constructor(type: string, params: PointerEventInit = {}) {
            super(type, params);
            this.pointerId = params.pointerId ?? 0;
        }
    }
    (globalThis as unknown as {PointerEvent: unknown}).PointerEvent = PointerEventPolyfill;
}

if (typeof globalThis.ResizeObserver === 'undefined' && typeof window !== 'undefined') {
    class ResizeObserverPolyfill {
        observe() { /* no-op in jsdom */ }
        unobserve() { /* no-op in jsdom */ }
        disconnect() { /* no-op in jsdom */ }
    }
    (globalThis as unknown as {ResizeObserver: unknown}).ResizeObserver = ResizeObserverPolyfill;
}

if (typeof window !== 'undefined' && typeof globalThis.URL.createObjectURL === 'undefined') {
    let counter = 0;
    globalThis.URL.createObjectURL = vi.fn(() => `blob:mock-${++counter}`);
    globalThis.URL.revokeObjectURL = vi.fn();
}
