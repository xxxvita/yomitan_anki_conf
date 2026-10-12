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
import {ExtensionError} from '../ext/js/core/extension-error.js';
import {log} from '../ext/js/core/log.js';
import {FLIB_MEDIA_MAX_BASE64_LENGTH} from '../ext/js/data/flib-anki-media.js';
import {ClipTranscodeError, flibMediaFileName} from '../ext/js/display/clip-transcode-util.js';
import {
    GATEWAY_CLIP_READY_TIMEOUT_MS,
    GatewayClipWaitError,
    isFirefoxUserAgent,
    prepareFlibMediaField,
} from '../ext/js/display/gateway-anki-media.js';

const REF = 'dQw4w9WgXcQ';
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 1, 2, 3]);

/**
 * @param {string} code
 * @param {string} [message]
 * @returns {ExtensionError}
 */
function codedError(code, message = code) {
    const error = new ExtensionError(message);
    error.data = {code};
    return error;
}

/**
 * @param {string} clipId
 * @returns {import('gateway-anki-media').GatewayFilmMedia}
 */
function filmMedia(clipId) {
    return {
        clipId,
        blob: new Blob(['mp4'], {type: 'video/mp4'}),
        leadTrimSec: 1.2,
        trimDurationSec: 4,
        videoWidth: 1920,
        videoHeight: 1080,
        durationSec: 20,
        vttText: 'WEBVTT\n\n00:00:00.000 --> 00:00:00.900\nYou <c.hl>run</c>\n\n',
        title: 'Heat',
        year: 1995,
        imdbUrl: 'https://www.imdb.com/title/tt0113277/',
    };
}

// eslint-disable-next-line jsdoc/require-returns -- the inferred shape is what the tests use
/**
 * @param {{films?: string[], youtube?: boolean, hasField?: boolean|Error, storeResult?: (name: string) => unknown, transcode?: import('vitest').Mock, waitForFilm?: import('vitest').Mock, support?: import('clip-transcode').EncoderSupport, isFirefox?: boolean, signal?: AbortSignal}} [options]
 */
function setup({films = ['c1'], youtube = true, hasField = true, storeResult, transcode, waitForFilm, support, isFirefox = false, signal} = {}) {
    /** @type {string[]} */
    const calls = [];
    const api = {
        flibAnkiModelHasField: vi.fn(async (/** @type {string} */ modelName, /** @type {string} */ fieldName) => {
            calls.push(`hasField:${modelName}:${fieldName}`);
            if (hasField instanceof Error) { throw hasField; }
            return hasField;
        }),
        flibStoreAnkiMedia: vi.fn(async (/** @type {string} */ fileName, /** @type {string} */ _base64) => {
            calls.push(`store:${fileName}`);
            return /** @type {{fileName: string}} */ (typeof storeResult === 'function' ? storeResult(fileName) : {fileName});
        }),
    };
    const probe = vi.fn(async () => {
        calls.push('probe');
        return support ?? {vp9Supported: true, vp8Supported: true, opusSupported: true};
    });
    const transcodeFn = transcode ?? vi.fn(async () => {
        calls.push('transcode');
        return WEBM;
    });
    const wait = waitForFilm ?? vi.fn(async (/** @type {string} */ clipId) => {
        calls.push(`wait:${clipId}`);
        return filmMedia(clipId);
    });
    const onProgress = vi.fn();
    const run = () => prepareFlibMediaField({
        selection: {
            films: films.map((clipId) => ({clipId})),
            youtube: youtube ? [{ref: REF, startMs: 12_500, text: 'I run daily', words: ['run']}] : [],
        },
        modelName: 'Yomitan Card Type',
        api,
        waitForFilm: wait,
        signal: signal ?? new AbortController().signal,
        isFirefox,
        onProgress,
        deps: {probeEncoderSupport: probe, transcodeClipToWebm: transcodeFn},
    });
    return {api, probe, transcode: transcodeFn, wait, calls, run, onProgress};
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

afterEach(() => {
    vi.restoreAllMocks();
});

describe('prepareFlibMediaField', () => {
    test('edge 11: nothing selected → null, no API call, no probe, no wait, no worker', async () => {
        const s = setup({films: [], youtube: false});
        expect(await s.run()).toBeNull();
        expect(s.api.flibAnkiModelHasField).not.toHaveBeenCalled();
        expect(s.api.flibStoreAnkiMedia).not.toHaveBeenCalled();
        expect(s.probe).not.toHaveBeenCalled();
        expect(s.transcode).not.toHaveBeenCalled();
        expect(s.wait).not.toHaveBeenCalled();
    });

    test('happy path: order is hasField → wait → transcode → store, HTML references the stored name', async () => {
        const s = setup();
        const html = await s.run();
        const name = await flibMediaFileName(WEBM);
        expect(s.calls).toStrictEqual(['hasField:Yomitan Card Type:flib_media', 'probe', 'wait:c1', 'transcode', `store:${name}`]);
        expect(s.api.flibStoreAnkiMedia).toHaveBeenCalledWith(name, btoa(String.fromCharCode(...WEBM)));
        expect(html).toContain(`<video controls preload="metadata" src="${name}">`);
        expect(html).toContain('data:text/vtt;base64,');
        expect(html).toContain(`https://www.youtube.com/watch?v=${REF}&amp;t=12s`);
        expect(html).toContain('<b>run</b>');
        expect(s.wait).toHaveBeenCalledWith('c1', expect.objectContaining({timeoutMs: GATEWAY_CLIP_READY_TIMEOUT_MS}));
        expect(GATEWAY_CLIP_READY_TIMEOUT_MS).toBe(20_000);
    });

    test('transcode gets the clip window (lead, lead+trim) and D-4 settings from the media size', async () => {
        const s = setup({youtube: false});
        await s.run();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- mock calls of a generic Mock
        const [blob, options] = /** @type {[Blob, {window: import('clip-transcode').ClipWindow, settings: import('clip-transcode').ClipOutputSettings, signal: AbortSignal}]} */ (s.transcode.mock.calls[0]);
        expect(blob).toBeInstanceOf(Blob);
        expect(options.window).toStrictEqual({startSec: 1.2, endSec: 5.2});
        expect(options.settings).toMatchObject({codec: 'vp9', width: 1280, height: 720});
        expect(options.signal).toBeInstanceOf(AbortSignal);
    });

    test('edge 12: Firefox → VP8', async () => {
        const s = setup({isFirefox: true, youtube: false});
        await s.run();
        expect(s.transcode.mock.calls[0][1].settings.codec).toBe('vp8');
    });

    test.each([
        ['Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0', true],
        ['Mozilla/5.0 (Android 14; Mobile; rv:131.0) Gecko/131.0 Firefox/131.0', true],
        ['Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36', false],
        ['Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36 Edg/142.0.0.0', false],
        ['', false],
    ])('isFirefoxUserAgent(%s) → %s', (ua, expected) => {
        expect(isFirefoxUserAgent(ua)).toBe(expected);
    });

    test('YouTube only: field checked, no probe/transcode/store', async () => {
        const s = setup({films: []});
        const html = await s.run();
        expect(s.calls).toStrictEqual(['hasField:Yomitan Card Type:flib_media']);
        expect(html).toContain('<ul class="flib-yt">');
    });

    test('edge 6: model has no flib_media → abort before any transcoding', async () => {
        const s = setup({hasField: false});
        const error = await rejection(s.run());
        expect(error.message).toBe('В типе заметки нет поля flib_media — обновите шаблон в anki_conf');
        expect(s.probe).not.toHaveBeenCalled();
        expect(s.wait).not.toHaveBeenCalled();
        expect(s.transcode).not.toHaveBeenCalled();
        expect(s.api.flibStoreAnkiMedia).not.toHaveBeenCalled();
    });

    test.each([
        ['flib_anki_unavailable', 'Anki недоступен'],
        ['flib_anki_model_unknown', 'Тип заметки не найден в Anki'],
    ])('edge 6: %s → «%s», nothing transcoded', async (code, message) => {
        const s = setup({hasField: codedError(code)});
        expect((await rejection(s.run())).message).toBe(message);
        expect(s.transcode).not.toHaveBeenCalled();
    });

    test('edge 1: clip not ready within the wait → «Нарезка ещё не загрузилась», nothing stored', async () => {
        const s = setup({waitForFilm: vi.fn(async () => { throw new GatewayClipWaitError('timeout', 'not ready'); })});
        expect((await rejection(s.run())).message).toBe('Нарезка ещё не загрузилась');
        expect(s.transcode).not.toHaveBeenCalled();
        expect(s.api.flibStoreAnkiMedia).not.toHaveBeenCalled();
    });

    test('edge 1: clip failed to load → clear message, nothing stored', async () => {
        const s = setup({waitForFilm: vi.fn(async () => { throw new GatewayClipWaitError('failed', 'failed'); })});
        expect((await rejection(s.run())).message).toContain('Нарезка не загрузилась');
        expect(s.api.flibStoreAnkiMedia).not.toHaveBeenCalled();
    });

    test('edge 2: no encoders → abort before spawning a worker', async () => {
        const s = setup({support: {vp9Supported: false, vp8Supported: false, opusSupported: true}});
        expect((await rejection(s.run())).message).toContain('WebM');
        expect(s.transcode).not.toHaveBeenCalled();
        expect(s.api.flibStoreAnkiMedia).not.toHaveBeenCalled();
    });

    test.each([
        ['timeout', 'слишком много времени'],
        ['worker-error', 'перекодировать'],
        ['transcode-failed', 'перекодировать'],
        ['encoder-unsupported', 'WebM'],
    ])('edge 2: transcode %s → message, nothing stored', async (code, fragment) => {
        const transcode = vi.fn(async () => { throw new ClipTranscodeError(/** @type {import('clip-transcode').ClipTranscodeErrorCode} */ (code), 'x'); });
        const s = setup({transcode});
        expect((await rejection(s.run())).message).toContain(fragment);
        expect(s.api.flibStoreAnkiMedia).not.toHaveBeenCalled();
    });

    test('edge 2: a failure on the second film stores nothing at all (all transcoded before any store)', async () => {
        let n = 0;
        const transcode = vi.fn(async () => {
            if (++n === 2) { throw new ClipTranscodeError('timeout', 'x'); }
            return WEBM;
        });
        const s = setup({films: ['c1', 'c2'], transcode});
        await rejection(s.run());
        expect(s.api.flibStoreAnkiMedia).not.toHaveBeenCalled();
    });

    test('edge 3: abort during transcode → «отменено», nothing stored', async () => {
        const controller = new AbortController();
        const transcode = vi.fn(async () => {
            controller.abort();
            throw new DOMException('aborted', 'AbortError');
        });
        const s = setup({transcode, signal: controller.signal});
        expect((await rejection(s.run())).message).toContain('отменено');
        expect(s.api.flibStoreAnkiMedia).not.toHaveBeenCalled();
    });

    test('edge 3: abort right after transcode (before store) → nothing stored', async () => {
        const controller = new AbortController();
        const transcode = vi.fn(async () => {
            controller.abort();
            return WEBM;
        });
        const s = setup({transcode, signal: controller.signal});
        expect((await rejection(s.run())).message).toContain('отменено');
        expect(s.api.flibStoreAnkiMedia).not.toHaveBeenCalled();
    });

    test('edge 3: already aborted → no API call at all', async () => {
        const controller = new AbortController();
        controller.abort();
        const s = setup({signal: controller.signal});
        await rejection(s.run());
        expect(s.api.flibAnkiModelHasField).not.toHaveBeenCalled();
    });

    test('edge 7: identical WebM bytes → identical file name for two clips', async () => {
        const s = setup({films: ['c1', 'c2'], youtube: false});
        await s.run();
        const names = s.api.flibStoreAnkiMedia.mock.calls.map((c) => c[0]);
        expect(names).toHaveLength(2);
        expect(names[0]).toBe(names[1]);
        expect(names[0]).toMatch(/^flib-[0-9a-f]{64}\.webm$/);
    });

    test('a stored name different from the requested one → abort', async () => {
        const s = setup({storeResult: () => ({fileName: 'flib-other.webm'})});
        expect((await rejection(s.run())).message).toContain('Anki не сохранил видеофайл');
    });

    test.each([
        ['flib_media_not_stored', 'Anki не сохранил видеофайл'],
        ['flib_media_too_large', 'слишком большой'],
        ['flib_media_bad_data', 'некорректные данные'],
        ['flib_secret_forbidden', 'окна расширения'],
    ])('store error %s → «…%s…»', async (code, fragment) => {
        const s = setup({storeResult: () => { throw codedError(code); }});
        expect((await rejection(s.run())).message).toContain(fragment);
    });

    test('edge 8: an AnkiConnect error carrying base64 never reaches the message or the log', async () => {
        const base64Blob = 'QUJD'.repeat(200);
        const logSpy = vi.spyOn(log, 'log').mockImplementation(() => {});
        const warnSpy = vi.spyOn(log, 'warn').mockImplementation(() => {});
        const errorSpy = vi.spyOn(log, 'error').mockImplementation(() => {});
        const s = setup({storeResult: () => { throw new ExtensionError(`AnkiConnect failed: params {"data":"${base64Blob}"}`); }});
        const error = await rejection(s.run());
        expect(error.message).toContain('Не удалось сохранить видео в Anki');
        expect(error.message).not.toContain(base64Blob.slice(0, 64));
        expect(error.message.length).toBeLessThan(400);
        const logged = JSON.stringify([...logSpy.mock.calls, ...warnSpy.mock.calls, ...errorSpy.mock.calls].map((c) => c.map(String)));
        expect(logged).not.toContain(base64Blob.slice(0, 64));
    });

    test('oversized WebM → abort before encoding/sending', async () => {
        const huge = new Uint8Array(Math.floor(FLIB_MEDIA_MAX_BASE64_LENGTH / 4) * 3 + 3);
        huge[0] = 1;
        const s = setup({transcode: vi.fn(async () => huge)});
        expect((await rejection(s.run())).message).toContain('слишком большой');
        expect(s.api.flibStoreAnkiMedia).not.toHaveBeenCalled();
    });

    test('the encoder probe runs once per probe function (cached per page)', async () => {
        const s = setup({youtube: false});
        await s.run();
        await s.run();
        expect(s.probe).toHaveBeenCalledTimes(1);
    });

    test('progress is reported while preparing films', async () => {
        const s = setup({youtube: false});
        await s.run();
        expect(s.onProgress).toHaveBeenCalled();
    });
});
