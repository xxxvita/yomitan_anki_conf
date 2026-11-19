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
const incognitoPopup = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}popup.html`, tab: {id: 1, incognito: true}, frameId: 2});
const contentScript = /** @type {Sender} */ ({id: EXT_ID, url: 'https://example.com/', tab: {id: 1}, frameId: 0});

const onPosDetect = Backend.prototype._onApiFlibPosDetect;
const onTranslationGet = Backend.prototype._onApiFlibSentenceTranslationGet;

/**
 * @returns {{context: object, detect: import('vitest').Mock, combined: import('vitest').Mock, cache: {get: import('vitest').Mock, put: import('vitest').Mock}}}
 */
function makeContext() {
    const detect = vi.fn(async () => ({pos: 'verb'}));
    const combined = vi.fn(async () => ({pos: 'verb', translation: 'Перевод.'}));
    const cache = {get: vi.fn(async () => null), put: vi.fn(async () => {})};
    const context = {
        _flibGateway: {detectPartOfSpeech: detect, detectPartOfSpeechWithTranslation: combined},
        _getFlibSentenceCache: async () => cache,
        _readFlibSentenceCache: Backend.prototype._readFlibSentenceCache,
        _getExtensionBaseUrl: () => EXT_BASE,
        _getExtensionId: () => EXT_ID,
        _canSenderReadFlibSecrets: Backend.prototype._canSenderReadFlibSecrets,
        _requireFlibPageSender: Backend.prototype._requireFlibPageSender,
    };
    return {context, detect, combined, cache};
}

/**
 * @param {object} context
 * @param {object} params
 * @param {Sender} sender
 * @returns {Promise<*>}
 */
async function callPos(context, params, sender) {
    return await onPosDetect.call(/** @type {*} */ (context), /** @type {*} */ (params), sender);
}

/**
 * @param {object} context
 * @param {string} sentence
 * @param {Sender} sender
 * @returns {Promise<*>}
 */
async function callGet(context, sentence, sender) {
    return await onTranslationGet.call(/** @type {*} */ (context), {sentence}, sender);
}

describe('flibPosDetect', () => {
    test('forbidden sender: a web page content script cannot spend the key', async () => {
        const {context, detect, combined, cache} = makeContext();
        await expect(callPos(context, {word: 'book', sentence: 'book a table', translate: true}, contentScript)).rejects.toMatchObject({message: 'flib_secret_forbidden'});
        await expect(callGet(context, 'book a table', contentScript)).rejects.toMatchObject({message: 'flib_secret_forbidden'});
        expect(detect).not.toHaveBeenCalled();
        expect(combined).not.toHaveBeenCalled();
        expect(cache.get).not.toHaveBeenCalled();
        expect(cache.put).not.toHaveBeenCalled();
    });

    test('translate false: POS-only, no cache access', async () => {
        const {context, detect, combined, cache} = makeContext();
        expect(await callPos(context, {word: 'booked', sentence: 'I booked a table', translate: false}, popupPage)).toStrictEqual({pos: 'verb', translation: null});
        expect(detect).toHaveBeenCalledWith('booked', 'I booked a table');
        expect(combined).not.toHaveBeenCalled();
        expect(cache.get).not.toHaveBeenCalled();
    });

    test('missing translate flag is POS-only', async () => {
        const {context, detect, combined, cache} = makeContext();
        expect(await callPos(context, {word: 'booked', sentence: 'I booked a table'}, popupPage)).toStrictEqual({pos: 'verb', translation: null});
        expect(detect).toHaveBeenCalledTimes(1);
        expect(combined).not.toHaveBeenCalled();
        expect(cache.get).not.toHaveBeenCalled();
    });

    test('cache hit: old prompt, cached translation', async () => {
        const {context, detect, combined, cache} = makeContext();
        cache.get.mockResolvedValueOnce('Перевод.');
        expect(await callPos(context, {word: 'book', sentence: 'Book a table.', translate: true}, popupPage)).toStrictEqual({pos: 'verb', translation: 'Перевод.'});
        expect(detect).toHaveBeenCalledTimes(1);
        expect(combined).not.toHaveBeenCalled();
        expect(cache.put).not.toHaveBeenCalled();
    });

    test('cache miss: combined call, put under the normalized key', async () => {
        const {context, detect, combined, cache} = makeContext();
        expect(await callPos(context, {word: 'Book', sentence: '  Book a  table. ', translate: true}, popupPage)).toStrictEqual({pos: 'verb', translation: 'Перевод.'});
        expect(combined).toHaveBeenCalledTimes(1);
        expect(detect).not.toHaveBeenCalled();
        expect(cache.get).toHaveBeenCalledWith('Book a table.');
        expect(cache.put).toHaveBeenCalledWith('Book a table.', 'Перевод.');
    });

    test('miss with null translation: nothing stored', async () => {
        const {context, combined, cache} = makeContext();
        combined.mockResolvedValueOnce({pos: 'verb', translation: null});
        expect(await callPos(context, {word: 'book', sentence: 'Book a table.', translate: true}, popupPage)).toStrictEqual({pos: 'verb', translation: null});
        expect(cache.put).not.toHaveBeenCalled();
    });

    test('incognito: no cache read or write, translation still returned', async () => {
        const {context, combined, cache} = makeContext();
        expect(await callPos(context, {word: 'book', sentence: 'Book a table.', translate: true}, incognitoPopup)).toStrictEqual({pos: 'verb', translation: 'Перевод.'});
        expect(combined).toHaveBeenCalledTimes(1);
        expect(cache.get).not.toHaveBeenCalled();
        expect(cache.put).not.toHaveBeenCalled();
    });

    test('cache getter rejects: still answers from the combined call', async () => {
        const {context, combined} = makeContext();
        /** @type {*} */ (context)._getFlibSentenceCache = async () => { throw new Error('idb dead'); };
        expect(await callPos(context, {word: 'book', sentence: 'Book a table.', translate: true}, popupPage)).toStrictEqual({pos: 'verb', translation: 'Перевод.'});
        expect(combined).toHaveBeenCalledTimes(1);
    });

    test('cache get rejects: treated as a miss', async () => {
        const {context, combined, cache} = makeContext();
        cache.get.mockRejectedValueOnce(new Error('boom'));
        expect(await callPos(context, {word: 'book', sentence: 'Book a table.', translate: true}, popupPage)).toStrictEqual({pos: 'verb', translation: 'Перевод.'});
        expect(combined).toHaveBeenCalledTimes(1);
    });

    test('cache put rejects: result still returned', async () => {
        const {context, cache} = makeContext();
        cache.put.mockRejectedValueOnce(new Error('quota'));
        expect(await callPos(context, {word: 'book', sentence: 'Book a table.', translate: true}, popupPage)).toStrictEqual({pos: 'verb', translation: 'Перевод.'});
    });

    test('sentence over the limit: old path, no cache access', async () => {
        const {context, detect, combined, cache} = makeContext();
        const long = 'a'.repeat(1001);
        expect(await callPos(context, {word: 'a', sentence: long, translate: true}, popupPage)).toStrictEqual({pos: 'verb', translation: null});
        expect(detect).toHaveBeenCalledTimes(1);
        expect(combined).not.toHaveBeenCalled();
        expect(cache.get).not.toHaveBeenCalled();
    });
});

describe('flibSentenceTranslationGet', () => {
    test('hit via the normalized key; gateway never called', async () => {
        const {context, detect, combined, cache} = makeContext();
        cache.get.mockResolvedValueOnce('Перевод.');
        expect(await callGet(context, '  Book a  table. ', popupPage)).toStrictEqual({translation: 'Перевод.'});
        expect(cache.get).toHaveBeenCalledWith('Book a table.');
        expect(detect).not.toHaveBeenCalled();
        expect(combined).not.toHaveBeenCalled();
    });

    test('miss: null', async () => {
        const {context} = makeContext();
        expect(await callGet(context, 'Book a table.', popupPage)).toStrictEqual({translation: null});
    });

    test('incognito: null without get', async () => {
        const {context, cache} = makeContext();
        expect(await callGet(context, 'Book a table.', incognitoPopup)).toStrictEqual({translation: null});
        expect(cache.get).not.toHaveBeenCalled();
    });

    test('over the limit: null without get', async () => {
        const {context, cache} = makeContext();
        expect(await callGet(context, 'a'.repeat(1001), popupPage)).toStrictEqual({translation: null});
        expect(cache.get).not.toHaveBeenCalled();
    });

    test('cache failure: null', async () => {
        const {context, cache} = makeContext();
        cache.get.mockRejectedValueOnce(new Error('boom'));
        expect(await callGet(context, 'Book a table.', popupPage)).toStrictEqual({translation: null});
        /** @type {*} */ (context)._getFlibSentenceCache = async () => { throw new Error('dead'); };
        expect(await callGet(context, 'Book a table.', popupPage)).toStrictEqual({translation: null});
    });
});
/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */
