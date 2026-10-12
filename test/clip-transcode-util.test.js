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

import {createHash} from 'node:crypto';
import {describe, expect, test} from 'vitest';
import {
    ClipTranscodeError,
    DEFAULT_CLIP_DURATION_SEC,
    MAX_CLIP_DURATION_SEC,
    chooseOutputSettings,
    computeClipWindow,
    flibMediaFileName,
} from '../ext/js/display/clip-transcode-util.js';

describe('computeClipWindow (edge case 4)', () => {
    test('normal window inside the file', () => {
        expect(computeClipWindow({leadTrimSec: 9.634, trimDurationSec: 8, mediaDurationSec: 20})).toStrictEqual({startSec: 9.634, endSec: 17.634});
    });

    test('end beyond the file duration is clamped to the duration', () => {
        expect(computeClipWindow({leadTrimSec: 12, trimDurationSec: 15, mediaDurationSec: 20})).toStrictEqual({startSec: 12, endSec: 20});
    });

    test.each([
        ['undefined', void 0],
        ['null', null],
        ['NaN', Number.NaN],
        ['zero', 0],
        ['negative', -4],
        ['Infinity', Number.POSITIVE_INFINITY],
    ])('trimDurationSec %s -> default 30 s, still clamped to duration', (_name, trimDurationSec) => {
        expect(computeClipWindow({leadTrimSec: 2, trimDurationSec, mediaDurationSec: 100})).toStrictEqual({startSec: 2, endSec: 2 + DEFAULT_CLIP_DURATION_SEC});
        expect(computeClipWindow({leadTrimSec: 2, trimDurationSec, mediaDurationSec: 20})).toStrictEqual({startSec: 2, endSec: 20});
    });

    test('window length is capped at 60 s', () => {
        expect(MAX_CLIP_DURATION_SEC).toBe(60);
        expect(computeClipWindow({leadTrimSec: 1, trimDurationSec: 500, mediaDurationSec: 1000})).toStrictEqual({startSec: 1, endSec: 61});
    });

    test.each([
        ['undefined', void 0],
        ['null', null],
        ['NaN', Number.NaN],
        ['negative', -0.5],
        ['Infinity', Number.POSITIVE_INFINITY],
    ])('leadTrimSec %s -> 0', (_name, leadTrimSec) => {
        expect(computeClipWindow({leadTrimSec, trimDurationSec: 10, mediaDurationSec: 20})).toStrictEqual({startSec: 0, endSec: 10});
    });

    test('unknown media duration (NaN/undefined/0) -> no clamping', () => {
        expect(computeClipWindow({leadTrimSec: 3, trimDurationSec: 10, mediaDurationSec: Number.NaN})).toStrictEqual({startSec: 3, endSec: 13});
        expect(computeClipWindow({leadTrimSec: 3, trimDurationSec: 10, mediaDurationSec: void 0})).toStrictEqual({startSec: 3, endSec: 13});
        expect(computeClipWindow({leadTrimSec: 3, trimDurationSec: 10, mediaDurationSec: 0})).toStrictEqual({startSec: 3, endSec: 13});
    });

    test('Infinity media duration (live/unknown) -> no clamping', () => {
        expect(computeClipWindow({leadTrimSec: 3, trimDurationSec: 10, mediaDurationSec: Number.POSITIVE_INFINITY})).toStrictEqual({startSec: 3, endSec: 13});
    });

    test('lead at/after the end of the file -> window restarts at 0 (never an empty window)', () => {
        expect(computeClipWindow({leadTrimSec: 25, trimDurationSec: 10, mediaDurationSec: 20})).toStrictEqual({startSec: 0, endSec: 10});
        expect(computeClipWindow({leadTrimSec: 20, trimDurationSec: 10, mediaDurationSec: 20})).toStrictEqual({startSec: 0, endSec: 10});
    });

    test('result is always a non-empty window', () => {
        for (const leadTrimSec of [void 0, -1, 0, 0.3, 19.99, 40]) {
            for (const trimDurationSec of [void 0, -1, 0.01, 30, 90]) {
                for (const mediaDurationSec of [void 0, Number.NaN, 0.5, 20, 3600]) {
                    const {startSec, endSec} = computeClipWindow({leadTrimSec, trimDurationSec, mediaDurationSec});
                    expect(startSec).toBeGreaterThanOrEqual(0);
                    expect(endSec).toBeGreaterThan(startSec);
                    expect(endSec - startSec).toBeLessThanOrEqual(MAX_CLIP_DURATION_SEC);
                }
            }
        }
    });
});

describe('chooseOutputSettings (D-4, edge case 12)', () => {
    const all = {vp9Supported: true, vp8Supported: true, isFirefox: false};

    test('720p source: kept as is, vp9, 1.5 Mbit/s', () => {
        expect(chooseOutputSettings({...all, sourceWidth: 1280, sourceHeight: 720})).toStrictEqual({
            codec: 'vp9', width: 1280, height: 720, videoBitrate: 1_500_000, audioBitrate: 96_000,
        });
    });

    test('1080p source: scaled to 720 keeping aspect', () => {
        const s = chooseOutputSettings({...all, sourceWidth: 1920, sourceHeight: 1080});
        expect([s.width, s.height, s.videoBitrate]).toStrictEqual([1280, 720, 1_500_000]);
    });

    test('scope 1920x1040: scaled to 720 with even width', () => {
        const s = chooseOutputSettings({...all, sourceWidth: 1920, sourceHeight: 1040});
        expect(s.height).toBe(720);
        expect(s.width % 2).toBe(0);
        expect(Math.abs(s.width - (1920 * 720 / 1040))).toBeLessThanOrEqual(2);
    });

    test('480p and smaller: never upscaled, 0.8 Mbit/s', () => {
        const s = chooseOutputSettings({...all, sourceWidth: 854, sourceHeight: 480});
        expect([s.width, s.height, s.videoBitrate]).toStrictEqual([854, 480, 800_000]);
        const t = chooseOutputSettings({...all, sourceWidth: 320, sourceHeight: 240});
        expect([t.width, t.height, t.videoBitrate]).toStrictEqual([320, 240, 800_000]);
    });

    test('between 480 and 720: kept, 1.5 Mbit/s', () => {
        const s = chooseOutputSettings({...all, sourceWidth: 1024, sourceHeight: 576});
        expect([s.width, s.height, s.videoBitrate]).toStrictEqual([1024, 576, 1_500_000]);
    });

    test('odd dimensions are rounded down to even (never upscaled)', () => {
        const s = chooseOutputSettings({...all, sourceWidth: 853, sourceHeight: 479});
        expect([s.width, s.height]).toStrictEqual([852, 478]);
    });

    test('portrait 1080x1920: height capped at 720, width floored to even', () => {
        const s = chooseOutputSettings({...all, sourceWidth: 1080, sourceHeight: 1920});
        expect(s.height).toBe(720);
        expect(s.width).toBe(404);
    });

    test('Firefox -> vp8 even if vp9 is supported', () => {
        expect(chooseOutputSettings({...all, isFirefox: true, sourceWidth: 1280, sourceHeight: 720}).codec).toBe('vp8');
    });

    test('Firefox without vp8 falls back to vp9', () => {
        expect(chooseOutputSettings({...all, isFirefox: true, vp8Supported: false, sourceWidth: 1280, sourceHeight: 720}).codec).toBe('vp9');
    });

    test('Chromium without vp9 -> vp8', () => {
        expect(chooseOutputSettings({...all, vp9Supported: false, sourceWidth: 1280, sourceHeight: 720}).codec).toBe('vp8');
    });

    test('no encoder at all -> ClipTranscodeError encoder-unsupported', () => {
        let error = null;
        try {
            chooseOutputSettings({sourceWidth: 1280, sourceHeight: 720, vp9Supported: false, vp8Supported: false, isFirefox: false});
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(ClipTranscodeError);
        expect(/** @type {ClipTranscodeError} */ (error).code).toBe('encoder-unsupported');
    });

    test('opus explicitly unsupported -> encoder-unsupported', () => {
        expect(() => chooseOutputSettings({...all, opusSupported: false, sourceWidth: 1280, sourceHeight: 720})).toThrow(ClipTranscodeError);
    });

    test.each([
        [0, 720], [1280, 0], [Number.NaN, 720], [1280, -1], [Number.POSITIVE_INFINITY, 720], [1, 1],
    ])('invalid source size %s x %s -> invalid-source-size', (sourceWidth, sourceHeight) => {
        let error = null;
        try {
            chooseOutputSettings({...all, sourceWidth, sourceHeight});
        } catch (e) {
            error = e;
        }
        expect(error).toBeInstanceOf(ClipTranscodeError);
        expect(/** @type {ClipTranscodeError} */ (error).code).toBe('invalid-source-size');
    });
});

describe('flibMediaFileName (edge case 7)', () => {
    test('flib-<sha256 hex>.webm, deterministic', async () => {
        const bytes = new TextEncoder().encode('webm bytes');
        const expected = 'flib-' + createHash('sha256').update(bytes).digest('hex') + '.webm';
        expect(await flibMediaFileName(bytes)).toBe(expected);
        expect(await flibMediaFileName(new Uint8Array(bytes))).toBe(expected);
        expect(expected).toMatch(/^flib-[0-9a-f]{64}\.webm$/);
    });

    test('different bytes -> different name', async () => {
        const a = await flibMediaFileName(new Uint8Array([1, 2, 3]));
        const b = await flibMediaFileName(new Uint8Array([1, 2, 4]));
        expect(a).not.toBe(b);
    });

    test('hashes only the view, not the whole underlying buffer', async () => {
        const buffer = new Uint8Array([9, 9, 1, 2, 3, 9]);
        expect(await flibMediaFileName(buffer.subarray(2, 5))).toBe(await flibMediaFileName(new Uint8Array([1, 2, 3])));
    });

    test('empty bytes -> empty-output error', async () => {
        await expect(flibMediaFileName(new Uint8Array(0))).rejects.toMatchObject({code: 'empty-output'});
    });
});
