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

import {describe, expect, test} from 'vitest';
import {API} from '../ext/js/comm/api.js';

const NAME = `flib-${'a'.repeat(64)}.webm`;
/** 1 MB of base64 — what a real clip payload looks like to the message bus. */
const BIG_B64 = 'QUJD'.repeat(256 * 1024);

/**
 * A WebExtension stub whose `sendMessage` answers with `response` and
 * optionally reports a `chrome.runtime.lastError`.
 * @param {unknown} response
 * @param {?Error} [lastError]
 * @returns {API}
 */
function makeApi(response, lastError = null) {
    const webExtension = /** @type {import('../ext/js/extension/web-extension.js').WebExtension} */ (/** @type {unknown} */ ({
        sendMessage: (/** @type {unknown} */ _data, /** @type {(response: unknown) => void} */ callback) => { callback(response); },
        getLastError: () => lastError,
    }));
    return new API(webExtension);
}

/**
 * @param {Promise<unknown>} promise
 * @returns {Promise<Error>}
 */
async function rejection(promise) {
    try {
        await promise;
    } catch (e) {
        return /** @type {Error} */ (e);
    }
    throw new Error('expected a rejection');
}

describe('API._invoke: a missing response never carries the params into the error', () => {
    test.each([
        ['undefined (SW restarted / port closed)', void 0, null],
        ['null', null, null],
        ['undefined with chrome.runtime.lastError', void 0, new Error('The message port closed before a response was received.')],
        ['a non-object', 'oops', null],
    ])('%s → short message with the action name, no base64', async (_label, response, lastError) => {
        const error = await rejection(makeApi(response, lastError).flibStoreAnkiMedia(NAME, BIG_B64));
        expect(error.message).toContain('flibStoreAnkiMedia');
        expect(error.message).not.toContain('QUJDQUJD');
        expect(error.message).not.toContain(NAME);
        expect(error.message.length).toBeLessThan(300);
        expect(JSON.stringify(/** @type {{data?: unknown}} */ (error).data ?? null).length).toBeLessThan(300);
    });

    test('a normal result still resolves; a serialized error still rejects with it', async () => {
        expect(await makeApi({result: {fileName: NAME}}).flibStoreAnkiMedia(NAME, BIG_B64)).toStrictEqual({fileName: NAME});
        const error = await rejection(makeApi({error: {name: 'Error', message: 'boom', stack: ''}}).flibStoreAnkiMedia(NAME, BIG_B64));
        expect(error.message).toBe('boom');
    });
});
