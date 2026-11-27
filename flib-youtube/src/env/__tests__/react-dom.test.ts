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
// @vitest-environment jsdom
// The react-dom wrapper (spec §3 item 6): the real react-dom with one change, the createPortal target.
import * as Real from 'react-dom';
import {afterEach, describe, expect, it} from 'vitest';
import * as Wrapper from '../react-dom';
import wrapperDefault from '../react-dom';

afterEach(() => { document.body.innerHTML = ''; });

describe('env/react-dom.ts', () => {
    it('exports every export of the real react-dom; all but createPortal are the real ones', () => {
        // Node adds a 'module.exports' name to the namespace of a CommonJS module; it is not an export of react-dom.
        const realKeys = Object.keys(Real).filter((k) => k !== 'default' && k !== 'module.exports').sort();
        const wrapperKeys = Object.keys(Wrapper).filter((k) => k !== 'default' && k !== 'portalTarget').sort();
        expect(wrapperKeys).toEqual(realKeys);
        const real = Real as unknown as Record<string, unknown>;
        const wrapped = Wrapper as unknown as Record<string, unknown>;
        for (const k of realKeys) {
            if (k === 'createPortal') { continue; }
            expect(wrapped[k], k).toBe(real[k]);
        }
        expect(Wrapper.createPortal).not.toBe(Real.createPortal);
        expect((wrapperDefault as unknown as Record<string, unknown>).createPortal).toBe(Wrapper.createPortal);
        expect((wrapperDefault as unknown as Record<string, unknown>).flushSync).toBe(Real.flushSync);
    });

    it('document.body and document.fullscreenElement become the portal node; other targets stay', () => {
        const host = document.createElement('div');
        host.id = 'flib-yt-portals';
        const other = document.createElement('div');
        document.body.append(other, host);
        expect(Wrapper.portalTarget(document.body)).toBe(host);
        expect(Wrapper.portalTarget(other)).toBe(other);
        Object.defineProperty(document, 'fullscreenElement', {configurable: true, get: () => other});
        try {
            expect(Wrapper.portalTarget(other)).toBe(host);
        } finally {
            delete (document as unknown as {fullscreenElement?: unknown}).fullscreenElement;
        }
        host.remove();
        expect(Wrapper.portalTarget(document.body)).toBe(document.body); // no portal node: unchanged
    });
});
