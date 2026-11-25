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
import {Backend} from '../ext/js/background/backend.js';
import {FLIB_SENTENCE_MAX_CHARS} from '../ext/js/data/flib-pos.js';
import {log} from '../ext/js/core/log.js';

/* eslint-disable no-underscore-dangle, @typescript-eslint/unbound-method */

// eslint-disable-next-line jsdoc/no-undefined-types
/** @typedef {chrome.runtime.MessageSender} Sender */
const EXT_ID = 'abcdefghijklmnop';
const EXT_BASE = `chrome-extension://${EXT_ID}/`;
const popupPage = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}popup.html`, tab: {id: 1}, frameId: 2});
const incognitoPopup = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}popup.html`, tab: {id: 1, incognito: true}, frameId: 2});
const contentScript = /** @type {Sender} */ ({id: EXT_ID, url: 'https://example.com/', tab: {id: 1}, frameId: 0});

const onPosDetect = Backend.prototype._onApiFlibPosDetect;
const onTranslate = Backend.prototype._onApiFlibSentenceTranslate;
const onTranslationGet = Backend.prototype._onApiFlibSentenceTranslationGet;

/**
 * Открытие или запрос IndexedDB, которые так и не ответили.
 * @returns {Promise<never>}
 */
const never = () => new Promise(() => {});

/** @type {import('vitest').MockInstance} */
let logGeneric;
/** @type {import('vitest').MockInstance} */
let logError;
beforeEach(() => {
    // Сбой кэша — тихий уровень `log` (без красного «!!» на значке), а не log.error.
    logGeneric = vi.spyOn(log, 'logGenericError').mockImplementation(() => {});
    logError = vi.spyOn(log, 'error').mockImplementation(() => {});
});
afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

/**
 * @returns {{context: object, detect: import('vitest').Mock, combined: import('vitest').Mock, translateSentence: import('vitest').Mock, cache: {get: import('vitest').Mock, put: import('vitest').Mock}}}
 */
function makeContext() {
    const detect = vi.fn(async () => ({pos: 'verb'}));
    const combined = vi.fn(async () => ({pos: 'verb', translation: 'Перевод.'}));
    const translateSentence = vi.fn(async () => ({translation: 'Свежий.'}));
    const cache = {get: vi.fn(async () => null), put: vi.fn(async () => {})};
    const context = {
        _flibGateway: {detectPartOfSpeech: detect, detectPartOfSpeechWithTranslation: combined, translateSentence},
        _flibSentenceCachePromise: null,
        _flibSentenceCacheFailureLogged: false,
        _getFlibSentenceCache: async () => cache,
        _withFlibSentenceCache: Backend.prototype._withFlibSentenceCache,
        _readFlibSentenceCache: Backend.prototype._readFlibSentenceCache,
        _writeFlibSentenceCache: Backend.prototype._writeFlibSentenceCache,
        _logFlibSentenceCacheFailure: Backend.prototype._logFlibSentenceCacheFailure,
        _getExtensionBaseUrl: () => EXT_BASE,
        _getExtensionId: () => EXT_ID,
        _canSenderReadFlibSecrets: Backend.prototype._canSenderReadFlibSecrets,
        _requireFlibPageSender: Backend.prototype._requireFlibPageSender,
    };
    return {context, detect, combined, cache, translateSentence};
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
        // F10: the gateway gets the normalized sentence the length guard measured.
        expect(combined).toHaveBeenCalledWith('Book', 'Book a table.');
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

    test('cache getter rejects: still answers from the combined call, logged once without the badge', async () => {
        const {context, combined} = makeContext();
        /** @type {*} */ (context)._getFlibSentenceCache = async () => { throw new Error('idb dead'); };
        expect(await callPos(context, {word: 'book', sentence: 'Book a table.', translate: true}, popupPage)).toStrictEqual({pos: 'verb', translation: 'Перевод.'});
        expect(combined).toHaveBeenCalledTimes(1);
        // The read and the write both failed: one log line per worker, level `log`.
        expect(logGeneric).toHaveBeenCalledTimes(1);
        expect(logGeneric).toHaveBeenCalledWith(expect.objectContaining({message: 'idb dead'}), 'log');
        expect(logError).not.toHaveBeenCalled();
    });

    test('POS-only path sends the sentence unchanged (Flibooster parity)', async () => {
        const {context, detect} = makeContext();
        await callPos(context, {word: 'booked', sentence: '  I booked  a table ', translate: false}, popupPage);
        expect(detect).toHaveBeenCalledWith('booked', '  I booked  a table ');
    });

    test.each([
        ['sentence', {word: 'book', sentence: 42, translate: true}],
        ['sentence (POS-only)', {word: 'book', sentence: null, translate: false}],
        ['word', {word: {}, sentence: 'Book a table.', translate: true}],
    ])('non-string %s: the coded flib_word_empty error, nothing sent or read', async (_name, params) => {
        const {context, detect, combined, cache} = makeContext();
        await expect(callPos(context, params, popupPage)).rejects.toMatchObject({message: 'flib_word_empty'});
        expect(detect).not.toHaveBeenCalled();
        expect(combined).not.toHaveBeenCalled();
        expect(cache.get).not.toHaveBeenCalled();
    });

    test('cache open never settles: the answer comes from the gateway, each cache wait capped at 1500 ms', async () => {
        vi.useFakeTimers();
        const {context, combined} = makeContext();
        Object.assign(context, {_getFlibSentenceCache: never});
        /** @type {unknown} */
        let result = null;
        void callPos(context, {word: 'book', sentence: 'Book a table.', translate: true}, popupPage).then((/** @type {unknown} */ value) => { result = value; });
        await vi.advanceTimersByTimeAsync(1499);
        expect(combined).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(combined).toHaveBeenCalledTimes(1);
        await vi.advanceTimersByTimeAsync(1500);
        expect(result).toStrictEqual({pos: 'verb', translation: 'Перевод.'});
        expect(logGeneric).toHaveBeenCalledTimes(1);
        expect(logError).not.toHaveBeenCalled();
    });

    test('cache put never settles: the answer is still returned after the cap', async () => {
        vi.useFakeTimers();
        const {context, cache} = makeContext();
        cache.put.mockImplementationOnce(never);
        /** @type {unknown} */
        let result = null;
        void callPos(context, {word: 'book', sentence: 'Book a table.', translate: true}, popupPage).then((/** @type {unknown} */ value) => { result = value; });
        await vi.advanceTimersByTimeAsync(1499);
        expect(cache.put).toHaveBeenCalledTimes(1);
        expect(result).toBe(null);
        await vi.advanceTimersByTimeAsync(1);
        expect(result).toStrictEqual({pos: 'verb', translation: 'Перевод.'});
    });

    test('cache get never settles: treated as a miss after the cap', async () => {
        vi.useFakeTimers();
        const {context, combined, cache} = makeContext();
        cache.get.mockImplementationOnce(never);
        /** @type {unknown} */
        let result = null;
        void callPos(context, {word: 'book', sentence: 'Book a table.', translate: true}, popupPage).then((/** @type {unknown} */ value) => { result = value; });
        await vi.advanceTimersByTimeAsync(1500);
        expect(combined).toHaveBeenCalledTimes(1);
        expect(result).toStrictEqual({pos: 'verb', translation: 'Перевод.'});
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

    test('cache failure: null, logged once per worker without the badge', async () => {
        const {context, cache} = makeContext();
        cache.get.mockRejectedValueOnce(new Error('boom'));
        expect(await callGet(context, 'Book a table.', popupPage)).toStrictEqual({translation: null});
        /** @type {*} */ (context)._getFlibSentenceCache = async () => { throw new Error('dead'); };
        expect(await callGet(context, 'Book a table.', popupPage)).toStrictEqual({translation: null});
        expect(logGeneric).toHaveBeenCalledTimes(1);
        expect(logGeneric).toHaveBeenCalledWith(expect.objectContaining({message: 'boom'}), 'log');
        expect(logError).not.toHaveBeenCalled();
    });

    test('non-string sentence: null without get', async () => {
        const {context, cache} = makeContext();
        expect(await onTranslationGet.call(/** @type {*} */ (context), /** @type {*} */ ({sentence: 7}), popupPage)).toStrictEqual({translation: null});
        expect(cache.get).not.toHaveBeenCalled();
    });

    test('a hung open: null after 1500 ms, and the memo is dropped so the next call opens afresh', async () => {
        vi.useFakeTimers();
        const {context} = makeContext();
        const hung = never();
        Object.assign(context, {_flibSentenceCachePromise: hung, _getFlibSentenceCache: Backend.prototype._getFlibSentenceCache});
        /** @type {unknown} */
        let result = null;
        void callGet(context, 'Book a table.', popupPage).then((/** @type {unknown} */ value) => { result = value; });
        await vi.advanceTimersByTimeAsync(1499);
        expect(result).toBe(null);
        expect(/** @type {*} */ (context)._flibSentenceCachePromise).toBe(hung);
        await vi.advanceTimersByTimeAsync(1);
        expect(result).toStrictEqual({translation: null});
        expect(/** @type {*} */ (context)._flibSentenceCachePromise).toBe(null);
    });
});
/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */

const webTabPopup = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}popup.html`, tab: {id: 1, url: 'https://example.com/a'}, frameId: 2});
const extTabPopup = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}popup.html`, tab: {id: 1, url: `${EXT_BASE}search.html`}, frameId: 2});
const searchPage = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}search.html`, tab: {id: 1}, frameId: 0});

/**
 * @param {object} context
 * @param {*} params
 * @param {Sender} sender
 * @returns {Promise<*>}
 */
async function callTranslate(context, params, sender) {
    return await onTranslate.call(/** @type {*} */ (context), params, sender);
}

describe('flibSentenceTranslate', () => {
    test('forbidden sender: content script cannot spend the key', async () => {
        const {context, translateSentence, cache} = makeContext();
        await expect(callTranslate(context, {sentence: 'Hello.', useCache: true}, contentScript)).rejects.toMatchObject({message: 'flib_secret_forbidden'});
        expect(translateSentence).not.toHaveBeenCalled();
        expect(cache.get).not.toHaveBeenCalled();
    });

    test('cache hit → no network', async () => {
        const {context, translateSentence, cache} = makeContext();
        cache.get.mockResolvedValue('Из кэша.');
        expect(await callTranslate(context, {sentence: '  Hello   there. ', useCache: true}, webTabPopup)).toStrictEqual({translation: 'Из кэша.'});
        expect(cache.get).toHaveBeenCalledWith('Hello there.');
        expect(translateSentence).not.toHaveBeenCalled();
        expect(cache.put).not.toHaveBeenCalled();
    });

    test('miss → network with the normalized key, then put', async () => {
        const {context, translateSentence, cache} = makeContext();
        expect(await callTranslate(context, {sentence: 'Hello   there.', useCache: true}, webTabPopup)).toStrictEqual({translation: 'Свежий.'});
        expect(translateSentence).toHaveBeenCalledWith('Hello there.');
        expect(cache.put).toHaveBeenCalledWith('Hello there.', 'Свежий.');
    });

    test('popup with unknown tab url may use the cache', async () => {
        const {context, cache} = makeContext();
        await callTranslate(context, {sentence: 'Hello.', useCache: true}, popupPage);
        expect(cache.get).toHaveBeenCalled();
        expect(cache.put).toHaveBeenCalled();
    });

    test.each([
        ['useCache false', {sentence: 'Hello.', useCache: false}, webTabPopup],
        ['useCache missing', {sentence: 'Hello.'}, webTabPopup],
        ['incognito sender tab', {sentence: 'Hello.', useCache: true}, incognitoPopup],
        ['tab with an extension page url', {sentence: 'Hello.', useCache: true}, extTabPopup],
        ['sender without a tab', {sentence: 'Hello.', useCache: true}, searchPage],
    ])('%s → neither read nor written, still translates', async (_name, params, sender) => {
        const {context, translateSentence, cache} = makeContext();
        expect(await callTranslate(context, params, sender)).toStrictEqual({translation: 'Свежий.'});
        expect(translateSentence).toHaveBeenCalledTimes(1);
        expect(cache.get).not.toHaveBeenCalled();
        expect(cache.put).not.toHaveBeenCalled();
    });

    test('cache read failure → still translates and writes', async () => {
        const {context, translateSentence, cache} = makeContext();
        cache.get.mockRejectedValue(new Error('idb broke'));
        expect(await callTranslate(context, {sentence: 'Hello.', useCache: true}, webTabPopup)).toStrictEqual({translation: 'Свежий.'});
        expect(translateSentence).toHaveBeenCalledTimes(1);
        expect(logError).not.toHaveBeenCalled();
    });

    test('cache write failure → translation still returned', async () => {
        const {context, cache} = makeContext();
        cache.put.mockRejectedValue(new Error('idb broke'));
        expect(await callTranslate(context, {sentence: 'Hello.', useCache: true}, webTabPopup)).toStrictEqual({translation: 'Свежий.'});
    });

    test('cache that never answers → times out and still translates', async () => {
        vi.useFakeTimers();
        const {context, translateSentence} = makeContext();
        Object.assign(context, {_getFlibSentenceCache: never});
        const promise = callTranslate(context, {sentence: 'Hello.', useCache: true}, webTabPopup);
        await vi.advanceTimersByTimeAsync(60000);
        expect(await promise).toStrictEqual({translation: 'Свежий.'});
        expect(translateSentence).toHaveBeenCalledTimes(1);
    });

    test('too long after normalization → flib_sentence_too_long before the network', async () => {
        const {context, translateSentence, cache} = makeContext();
        const sentence = `${'a '.repeat(FLIB_SENTENCE_MAX_CHARS)}b`;
        await expect(callTranslate(context, {sentence, useCache: true}, webTabPopup)).rejects.toMatchObject({message: 'flib_sentence_too_long'});
        expect(translateSentence).not.toHaveBeenCalled();
        expect(cache.get).not.toHaveBeenCalled();
    });

    test('exactly at the limit is translated; surrounding whitespace does not count', async () => {
        const {context, translateSentence} = makeContext();
        await callTranslate(context, {sentence: ` ${'a'.repeat(FLIB_SENTENCE_MAX_CHARS)}  `, useCache: false}, webTabPopup);
        expect(translateSentence).toHaveBeenCalledTimes(1);
    });

    test.each([[5], [null], [void 0], [{}], [['a']]])('non-string sentence %j → flib_word_empty', async (sentence) => {
        const {context, translateSentence} = makeContext();
        await expect(callTranslate(context, {sentence, useCache: true}, webTabPopup)).rejects.toMatchObject({message: 'flib_word_empty'});
        expect(translateSentence).not.toHaveBeenCalled();
    });

    test('empty sentence is not sent', async () => {
        const {context, translateSentence} = makeContext();
        translateSentence.mockRejectedValue(new Error('flib_word_empty'));
        await expect(callTranslate(context, {sentence: '   ', useCache: false}, webTabPopup)).rejects.toMatchObject({message: 'flib_word_empty'});
    });
});
