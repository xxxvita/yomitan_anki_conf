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
import {Backend} from '../ext/js/background/backend.js';

/* eslint-disable no-underscore-dangle, @typescript-eslint/unbound-method */

// eslint-disable-next-line jsdoc/no-undefined-types
/** @typedef {chrome.runtime.MessageSender} Sender */
const EXT_ID = 'abcdefghijklmnop';
const EXT_BASE = `chrome-extension://${EXT_ID}/`;
const popupPage = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}popup.html`, tab: {id: 1}, frameId: 2});
const contentScript = /** @type {Sender} */ ({id: EXT_ID, url: 'https://example.com/', tab: {id: 1}, frameId: 0});

const onPosDetect = Backend.prototype._onApiFlibPosDetect;

/**
 * @returns {{context: object, detect: import('vitest').Mock}}
 */
function makeContext() {
    const detect = vi.fn(async () => ({pos: 'verb'}));
    const context = {
        _flibGateway: {detectPartOfSpeech: detect},
        _getExtensionBaseUrl: () => EXT_BASE,
        _getExtensionId: () => EXT_ID,
        _canSenderReadFlibSecrets: Backend.prototype._canSenderReadFlibSecrets,
        _requireFlibPageSender: Backend.prototype._requireFlibPageSender,
    };
    return {context, detect};
}

describe('flibPosDetect', () => {
    test('forbidden sender: a web page content script cannot spend the key', async () => {
        const {context, detect} = makeContext();
        await expect(onPosDetect.call(/** @type {*} */ (context), {word: 'book', sentence: 'book a table'}, contentScript)).rejects.toMatchObject({message: 'flib_secret_forbidden'});
        expect(detect).not.toHaveBeenCalled();
    });

    test('delegates: the popup page gets the gateway answer', async () => {
        const {context, detect} = makeContext();
        expect(await onPosDetect.call(/** @type {*} */ (context), {word: 'booked', sentence: 'I booked a table'}, popupPage)).toStrictEqual({pos: 'verb'});
        expect(detect).toHaveBeenCalledWith('booked', 'I booked a table');
    });
});
/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */
