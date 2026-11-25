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
import {OffscreenProxy} from '../ext/js/background/offscreen-proxy.js';

const createDocument = vi.fn();
const getContexts = vi.fn();
const sendMessagePromise = vi.fn(async () => ({result: void 0}));

/**
 * @returns {OffscreenProxy}
 */
function createProxy() {
    return new OffscreenProxy(/** @type {import('../ext/js/extension/web-extension.js').WebExtension} */ (/** @type {unknown} */ ({sendMessagePromise})));
}

beforeEach(() => {
    createDocument.mockReset().mockResolvedValue(void 0);
    getContexts.mockReset().mockResolvedValue([]);
    sendMessagePromise.mockClear();
    vi.stubGlobal('chrome', {
        offscreen: {createDocument},
        runtime: {getURL: (/** @type {string} */ path) => `chrome-extension://x/${path}`, getContexts},
    });
});

afterEach(() => { vi.unstubAllGlobals(); });

describe('OffscreenProxy.prepare', () => {
    test('a failed document can be created again', async () => {
        const proxy = createProxy();
        createDocument.mockRejectedValueOnce(new Error('no document'));
        await expect(proxy.prepare()).rejects.toThrow('no document');
        await expect(proxy.prepare()).resolves.toBeUndefined();
        expect(createDocument).toHaveBeenCalledTimes(2);
    });

    test('calls at the same time share one document, also one that fails', async () => {
        const proxy = createProxy();
        createDocument.mockRejectedValueOnce(new Error('no document'));
        const results = await Promise.allSettled([proxy.prepare(), proxy.prepare()]);
        expect(results.map(({status}) => status)).toStrictEqual(['rejected', 'rejected']);
        expect(createDocument).toHaveBeenCalledTimes(1);
        await Promise.all([proxy.prepare(), proxy.prepare()]);
        expect(createDocument).toHaveBeenCalledTimes(2);
    });

    test('a document that is there is not created', async () => {
        getContexts.mockResolvedValue([{}]);
        await createProxy().prepare();
        expect(createDocument).not.toHaveBeenCalled();
        expect(sendMessagePromise).toHaveBeenCalledTimes(1);
    });
});
