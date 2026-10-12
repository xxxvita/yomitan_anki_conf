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
import {Backend} from '../ext/js/background/backend.js';
import {FLIB_MEDIA_MAX_BASE64_LENGTH, getFlibAnkiMediaErrorCode} from '../ext/js/data/flib-anki-media.js';

/* eslint-disable no-underscore-dangle, @typescript-eslint/unbound-method */

// eslint-disable-next-line jsdoc/no-undefined-types
/** @typedef {chrome.runtime.MessageSender} Sender */

const EXT_ID = 'abcdefghijklmnop';
const EXT_BASE = `chrome-extension://${EXT_ID}/`;
const SHA = 'a'.repeat(64);
const NAME = `flib-${SHA}.webm`;
const B64 = 'GkXfo59ChoEBQveBAULygQRC84EIQoKEd2VibUKHgQRChYEC';

const popupPage = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}popup.html`});
const contentScript = /** @type {Sender} */ ({id: EXT_ID, url: 'https://example.com/', tab: {id: 1}, frameId: 0});
const foreignExtension = /** @type {Sender} */ ({id: 'otherextension', url: `${EXT_BASE}popup.html`});
const noUrl = /** @type {Sender} */ ({id: EXT_ID});

const onStore = Backend.prototype._onApiFlibStoreAnkiMedia;
const onHasField = Backend.prototype._onApiFlibAnkiModelHasField;

/**
 * @param {{fields?: string[], stored?: ?string}} [details]
 * @returns {Record<string, any>}
 */
function makeContext({fields = ['Front', 'Data', 'flib_media'], stored} = {}) {
    return {
        _anki: {
            server: 'http://127.0.0.1:8765',
            storeMediaFile: vi.fn(async (/** @type {string} */ fileName) => (typeof stored === 'undefined' ? fileName : stored)),
            getModelFieldNames: vi.fn(async () => [...fields]),
        },
        _flibModelFieldsCache: new Map(),
        _getExtensionBaseUrl: () => EXT_BASE,
        _getExtensionId: () => EXT_ID,
        _canSenderReadFlibSecrets: Backend.prototype._canSenderReadFlibSecrets,
        _requireFlibPageSender: Backend.prototype._requireFlibPageSender,
    };
}

/**
 * @param {unknown} promise
 * @returns {Promise<unknown>} `data.code` of the rejection.
 */
async function rejectionCode(promise) {
    try {
        await promise;
    } catch (e) {
        return /** @type {{data?: {code?: unknown}}} */ (e).data?.code;
    }
    throw new Error('expected a rejection');
}

afterEach(() => {
    vi.restoreAllMocks();
});

describe('getFlibAnkiMediaErrorCode (pure validation)', () => {
    test.each([
        ['../x.webm'],
        [`../flib-${SHA}.webm`],
        [`flib-${'A'.repeat(64)}.webm`],
        [`flib-${SHA}.mp4`],
        [`flib-${SHA}.WEBM`],
        [`flib-${'a'.repeat(63)}.webm`],
        [`flib-${'a'.repeat(65)}.webm`],
        [`flib-${SHA}.webm\n`],
        [`x/flib-${SHA}.webm`],
        [''],
        [42],
        [null],
    ])('bad file name %j → flib_media_bad_name', (fileName) => {
        expect(getFlibAnkiMediaErrorCode(fileName, B64)).toBe('flib_media_bad_name');
    });

    test.each([
        [''],
        ['abc'],
        ['ab$c'],
        ['QUJD\n'],
        ['QUJD===='],
        ['=QUJ'],
        [42],
        [null],
    ])('bad base64 %j → flib_media_bad_data', (base64) => {
        expect(getFlibAnkiMediaErrorCode(NAME, base64)).toBe('flib_media_bad_data');
    });

    test('limit is 20 MB of base64 characters, inclusive', () => {
        expect(FLIB_MEDIA_MAX_BASE64_LENGTH).toBe(20 * 1024 * 1024);
        expect(getFlibAnkiMediaErrorCode(NAME, 'A'.repeat(FLIB_MEDIA_MAX_BASE64_LENGTH))).toBeNull();
        expect(getFlibAnkiMediaErrorCode(NAME, 'A'.repeat(FLIB_MEDIA_MAX_BASE64_LENGTH + 4))).toBe('flib_media_too_large');
    });

    test.each([[B64], ['QUI='], ['QQ=='], ['a+/9']])('valid %j → null', (base64) => {
        expect(getFlibAnkiMediaErrorCode(NAME, base64)).toBeNull();
    });
});

describe('flibStoreAnkiMedia', () => {
    test.each([
        ['content script', contentScript],
        ['foreign extension id', foreignExtension],
        ['missing url', noUrl],
        ['no sender', /** @type {Sender} */ (/** @type {unknown} */ (void 0))],
    ])('%s → flib_secret_forbidden, nothing stored', async (_label, sender) => {
        const ctx = makeContext();
        expect(await rejectionCode(onStore.call(ctx, {fileName: NAME, base64: B64}, sender))).toBe('flib_secret_forbidden');
        expect(ctx._anki.storeMediaFile).not.toHaveBeenCalled();
    });

    test.each([
        [{fileName: '../x.webm', base64: B64}, 'flib_media_bad_name'],
        [{fileName: `flib-${'A'.repeat(64)}.webm`, base64: B64}, 'flib_media_bad_name'],
        [{fileName: `flib-${SHA}.mp4`, base64: B64}, 'flib_media_bad_name'],
        [{fileName: `flib-${'a'.repeat(63)}.webm`, base64: B64}, 'flib_media_bad_name'],
        [{fileName: NAME, base64: 'not base64!'}, 'flib_media_bad_data'],
        [{fileName: NAME, base64: ''}, 'flib_media_bad_data'],
    ])('%j → %s, nothing stored', async (params, code) => {
        const ctx = makeContext();
        expect(await rejectionCode(onStore.call(ctx, params, popupPage))).toBe(code);
        expect(ctx._anki.storeMediaFile).not.toHaveBeenCalled();
    });

    test('oversize → flib_media_too_large, nothing stored', async () => {
        const ctx = makeContext();
        const params = {fileName: NAME, base64: 'A'.repeat(FLIB_MEDIA_MAX_BASE64_LENGTH + 4)};
        expect(await rejectionCode(onStore.call(ctx, params, popupPage))).toBe('flib_media_too_large');
        expect(ctx._anki.storeMediaFile).not.toHaveBeenCalled();
    });

    test('success: storeMediaFile called once with the exact args; returns the stored name', async () => {
        const ctx = makeContext();
        expect(await onStore.call(ctx, {fileName: NAME, base64: B64}, popupPage)).toStrictEqual({fileName: NAME});
        expect(ctx._anki.storeMediaFile.mock.calls).toStrictEqual([[NAME, B64]]);
    });

    test('returns the name AnkiConnect reports, even if it differs', async () => {
        const ctx = makeContext({stored: 'renamed.webm'});
        expect(await onStore.call(ctx, {fileName: NAME, base64: B64}, popupPage)).toStrictEqual({fileName: 'renamed.webm'});
    });

    test('AnkiConnect returns null → flib_media_not_stored', async () => {
        const ctx = makeContext({stored: null});
        expect(await rejectionCode(onStore.call(ctx, {fileName: NAME, base64: B64}, popupPage))).toBe('flib_media_not_stored');
    });
});

describe('flibAnkiModelHasField', () => {
    test('content script → flib_secret_forbidden', async () => {
        const ctx = makeContext();
        expect(await rejectionCode(onHasField.call(ctx, {modelName: 'Yomitan Card Type', fieldName: 'flib_media'}, contentScript))).toBe('flib_secret_forbidden');
        expect(ctx._anki.getModelFieldNames).not.toHaveBeenCalled();
    });

    test.each([
        [{modelName: '', fieldName: 'flib_media'}],
        [{modelName: 'M', fieldName: ''}],
        [{modelName: 42, fieldName: 'flib_media'}],
    ])('bad params %j → flib_bad_request', async (params) => {
        const ctx = makeContext();
        expect(await rejectionCode(onHasField.call(ctx, /** @type {any} */ (params), popupPage))).toBe('flib_bad_request');
    });

    test('a case variant does not count: templates and note keys are case-sensitive', async () => {
        const ctx = makeContext({fields: ['Front', 'Flib_Media']});
        expect(await onHasField.call(ctx, {modelName: 'M', fieldName: 'flib_media'}, popupPage)).toBe(false);
    });

    test('exact match; a positive answer is cached per server+model', async () => {
        const ctx = makeContext({fields: ['Front', 'flib_media']});
        expect(await onHasField.call(ctx, {modelName: 'M', fieldName: 'flib_media'}, popupPage)).toBe(true);
        expect(await onHasField.call(ctx, {modelName: 'M', fieldName: 'flib_media'}, popupPage)).toBe(true);
        expect(ctx._anki.getModelFieldNames).toHaveBeenCalledTimes(1);
        // Another server → its own entry.
        ctx._anki.server = 'http://127.0.0.1:8777';
        expect(await onHasField.call(ctx, {modelName: 'M', fieldName: 'flib_media'}, popupPage)).toBe(true);
        expect(ctx._anki.getModelFieldNames).toHaveBeenCalledTimes(2);
    });

    test('a negative answer is not cached (the field may be added any moment)', async () => {
        const fields = ['Front'];
        const ctx = makeContext();
        ctx._anki.getModelFieldNames = vi.fn(async () => [...fields]);
        expect(await onHasField.call(ctx, {modelName: 'M', fieldName: 'flib_media'}, popupPage)).toBe(false);
        fields.push('flib_media');
        expect(await onHasField.call(ctx, {modelName: 'M', fieldName: 'flib_media'}, popupPage)).toBe(true);
        expect(ctx._anki.getModelFieldNames).toHaveBeenCalledTimes(2);
    });

    test('the cache expires', async () => {
        const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
        const ctx = makeContext();
        await onHasField.call(ctx, {modelName: 'M', fieldName: 'flib_media'}, popupPage);
        now.mockReturnValue(1_000_000 + 10 * 60 * 1000);
        await onHasField.call(ctx, {modelName: 'M', fieldName: 'flib_media'}, popupPage);
        expect(ctx._anki.getModelFieldNames).toHaveBeenCalledTimes(2);
    });

    test('AnkiConnect errors propagate (caller aborts the save)', async () => {
        const ctx = makeContext();
        ctx._anki.getModelFieldNames = vi.fn(async () => { throw new Error('model was not found: M'); });
        await expect(onHasField.call(ctx, {modelName: 'M', fieldName: 'flib_media'}, popupPage)).rejects.toThrow('model was not found');
    });
});

describe('bootstrap invalidates the model-fields cache', () => {
    test('_maybeBootstrapVideoExamplesField clears _flibModelFieldsCache', async () => {
        const ctx = makeContext();
        ctx._videoExamplesBootstrapSignature = null;
        ctx._anki = {server: 's', enabled: false, apiKey: null};
        ctx._flibModelFieldsCache.set('s\u0000M', {fields: ['flib_media'], expiresAt: Number.MAX_SAFE_INTEGER});
        await Backend.prototype._maybeBootstrapVideoExamplesField.call(ctx);
        expect(ctx._flibModelFieldsCache.size).toBe(0);
    });
});

/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */
