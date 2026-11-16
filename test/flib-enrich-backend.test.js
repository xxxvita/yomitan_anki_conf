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
const KEY = `tpk_${'0'.repeat(32)}`;
const REPORT = {enrich: {status: 'done'}, audio: {status: 'done'}, reverse: {status: 'done'}, phrases: {status: 'done'}, speechCode: null};

const onEnrich = Backend.prototype._onApiFlibEnrichNote;

/**
 * @param {string} key
 * @returns {{context: object, enrich: import('vitest').Mock}}
 */
function makeContext(key = KEY) {
    const enrich = vi.fn(async () => REPORT);
    const context = {
        _flibCardEnricher: {enrich},
        _getFlibCardEnricher() { return this._flibCardEnricher; },
        _getFlibSecrets: async () => ({personalKey: key, gatewayUrl: ''}),
        _getExtensionBaseUrl: () => EXT_BASE,
        _getExtensionId: () => EXT_ID,
        _canSenderReadFlibSecrets: Backend.prototype._canSenderReadFlibSecrets,
        _requireFlibPageSender: Backend.prototype._requireFlibPageSender,
    };
    return {context, enrich};
}

describe('flibEnrichNote', () => {
    test('forbidden sender: a web page cannot spend the quota', async () => {
        const {context, enrich} = makeContext();
        await expect(onEnrich.call(/** @type {*} */ (context), {noteId: 1, userTags: []}, contentScript)).rejects.toMatchObject({message: 'flib_secret_forbidden'});
        expect(enrich).not.toHaveBeenCalled();
    });

    test('no key → all skipped without requests', async () => {
        const {context, enrich} = makeContext('');
        expect(await onEnrich.call(/** @type {*} */ (context), {noteId: 1, userTags: []}, popupPage)).toStrictEqual({
            enrich: {status: 'skipped', code: 'flib_key_missing'},
            audio: {status: 'skipped', code: 'flib_key_missing'},
            reverse: {status: 'skipped', code: 'flib_key_missing'},
            phrases: {status: 'skipped', code: 'flib_key_missing'},
            speechCode: null,
        });
        expect(enrich).not.toHaveBeenCalled();
    });

    test('delegates with the note id and user tags', async () => {
        const {context, enrich} = makeContext();
        expect(await onEnrich.call(/** @type {*} */ (context), {noteId: 7, userTags: ['news']}, popupPage)).toStrictEqual(REPORT);
        expect(enrich).toHaveBeenCalledWith({noteId: 7, userTags: ['news'], cards: {reverse: true, phrases: true}});
    });

    test('passes a normalized cards flag', async () => {
        const {context, enrich} = makeContext();
        await onEnrich.call(/** @type {*} */ (context), {noteId: 7, userTags: [], cards: {reverse: false}}, popupPage);
        expect(enrich).toHaveBeenCalledWith({noteId: 7, userTags: [], cards: {reverse: false, phrases: true}});
    });
});
/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */
