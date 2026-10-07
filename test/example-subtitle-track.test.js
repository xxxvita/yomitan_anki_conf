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

import {afterAll, afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {attachSubtitleTrack, buildHighlightedVtt, escapeVttText, formatVttTime} from '../ext/js/display/example-subtitle-track.js';
import {setupDomTest} from './fixtures/dom-test.js';

const {window, teardown} = await setupDomTest();
afterAll(() => teardown(global));

/**
 * jsdom's Blob has no text().
 * @param {Blob} blob
 * @returns {Promise<string>}
 */
function readBlobText(blob) {
    return new Promise((resolve) => {
        const reader = new window.FileReader();
        reader.onload = () => { resolve(typeof reader.result === 'string' ? reader.result : ''); };
        reader.readAsText(blob);
    });
}

describe('VTT text', () => {
    test('formatVttTime', () => {
        expect(formatVttTime(0)).toBe('00:00:00.000');
        expect(formatVttTime(61.5)).toBe('00:01:01.500');
        expect(formatVttTime(3725.0049)).toBe('01:02:05.005');
        expect(formatVttTime(-3)).toBe('00:00:00.000');
        expect(formatVttTime(Number.NaN)).toBe('00:00:00.000');
    });

    test('escapeVttText escapes &, <, > (so «-->» cannot end a cue line)', () => {
        expect(escapeVttText('a & b <i>x</i> --> y')).toBe('a &amp; b &lt;i&gt;x&lt;/i&gt; --&gt; y');
    });

    test('buildHighlightedVtt: header, file-timeline times, <c.hl> around matched forms, escaping', () => {
        const vtt = buildHighlightedVtt([
            {start: 1, end: 1.9, text: 'You run & I <ran>'},
            {start: 2.25, end: 3, text: 'line one\n\n\nline two'},
        ], ['run', 'ran']);
        expect(vtt).toBe(
            'WEBVTT\n\n' +
            '00:00:01.000 --> 00:00:01.900\nYou <c.hl>run</c> &amp; I &lt;<c.hl>ran</c>&gt;\n\n' +
            '00:00:02.250 --> 00:00:03.000\nline one\nline two\n\n',
        );
    });

    test('highlighted text is escaped too', () => {
        expect(buildHighlightedVtt([{start: 0, end: 1, text: 'R&D rocks'}], ['r&d'])).toContain('<c.hl>R&amp;D</c> rocks');
    });

    test('cues with no text or a non-positive span are dropped', () => {
        const vtt = buildHighlightedVtt([{start: 0, end: 1, text: '   '}, {start: 2, end: 2, text: 'x'}], []);
        expect(vtt).toBe('WEBVTT\n\n');
    });
});

describe('attachSubtitleTrack', () => {
    /** @type {WeakMap<HTMLTrackElement, {mode: string}>} */
    let tracks;
    /** @type {?Element} */
    let fullscreen = null;
    let n = 0;
    const createObjectURL = vi.fn(() => `blob:vtt/${++n}`);
    /** @type {?Blob} */
    let lastBlob = null;

    beforeEach(() => {
        tracks = new WeakMap();
        fullscreen = null;
        n = 0;
        createObjectURL.mockClear();
        URL.createObjectURL = /** @type {typeof URL.createObjectURL} */ ((/** @type {Blob} */ blob) => {
            lastBlob = blob;
            return createObjectURL();
        });
        Object.defineProperty(window.HTMLTrackElement.prototype, 'track', {
            configurable: true,
            /**
             * @this {HTMLTrackElement}
             * @returns {{mode: string}}
             */
            get() {
                let t = tracks.get(this);
                if (typeof t === 'undefined') {
                    t = {mode: 'disabled'};
                    tracks.set(this, t);
                }
                return t;
            },
        });
        Object.defineProperty(window.document, 'fullscreenElement', {configurable: true, get: () => fullscreen});
    });
    afterEach(() => {
        window.document.body.replaceChildren();
    });

    /** @returns {{video: HTMLVideoElement, overlay: HTMLElement}} */
    function mount() {
        const video = window.document.createElement('video');
        // jsdom's TextTrackList is no EventTarget; the real one fires 'change' on mode changes.
        Object.defineProperty(video, 'textTracks', {configurable: true, value: new window.EventTarget()});
        const overlay = window.document.createElement('div');
        window.document.body.append(video, overlay);
        return {video, overlay};
    }

    test('adds an English subtitles <track> with a blob: VTT; hidden inline, showing in fullscreen; overlay hidden in fullscreen', async () => {
        const {video, overlay} = mount();
        const handle = attachSubtitleTrack(video, {cues: [{start: 1, end: 2, text: 'I run'}], words: ['run'], overlay});
        expect(handle).not.toBeNull();
        expect(handle?.url).toBe('blob:vtt/1');
        const track = /** @type {HTMLTrackElement} */ (video.querySelector('track'));
        expect(track.kind).toBe('subtitles');
        expect(track.srclang).toBe('en');
        expect(track.label).toBe('English');
        expect(track.getAttribute('src')).toBe('blob:vtt/1');
        expect(lastBlob?.type).toBe('text/vtt');
        expect(await readBlobText(/** @type {Blob} */ (lastBlob))).toContain('I <c.hl>run</c>');
        expect(track.track.mode).toBe('hidden');
        expect(overlay.hidden).toBe(false);

        fullscreen = video;
        window.document.dispatchEvent(new window.Event('fullscreenchange'));
        expect(track.track.mode).toBe('showing');
        expect(overlay.hidden).toBe(true);

        fullscreen = null;
        window.document.dispatchEvent(new window.Event('fullscreenchange'));
        expect(track.track.mode).toBe('hidden');
        expect(overlay.hidden).toBe(false);
        handle?.dispose();
    });

    test('another element in fullscreen (e.g. the popup itself) keeps the track hidden', () => {
        const {video, overlay} = mount();
        const handle = attachSubtitleTrack(video, {cues: [{start: 0, end: 1, text: 'x'}], words: [], overlay});
        fullscreen = window.document.body;
        window.document.dispatchEvent(new window.Event('fullscreenchange'));
        const track = /** @type {HTMLTrackElement} */ (video.querySelector('track'));
        expect(track.track.mode).toBe('hidden');
        expect(overlay.hidden).toBe(false);
        handle?.dispose();
    });

    test('dispose stops following fullscreen; no cues → no track and no blob', () => {
        const {video, overlay} = mount();
        const handle = attachSubtitleTrack(video, {cues: [{start: 0, end: 1, text: 'x'}], words: [], overlay});
        handle?.dispose();
        fullscreen = video;
        window.document.dispatchEvent(new window.Event('fullscreenchange'));
        expect(/** @type {HTMLTrackElement} */ (video.querySelector('track')).track.mode).toBe('hidden');

        // the textTracks 'change' listener is gone too
        /** @type {HTMLTrackElement} */ (video.querySelector('track')).track.mode = 'showing';
        video.textTracks.dispatchEvent(new window.Event('change'));
        expect(overlay.hidden).toBe(false);

        const other = mount();
        createObjectURL.mockClear();
        expect(attachSubtitleTrack(other.video, {cues: [], words: [], overlay: other.overlay})).toBeNull();
        expect(other.video.querySelector('track')).toBeNull();
        expect(createObjectURL).not.toHaveBeenCalled();
    });

    test('CC turned on inline via the player menu hides the overlay; off shows it again (review M1)', () => {
        const {video, overlay} = mount();
        const handle = attachSubtitleTrack(video, {cues: [{start: 0, end: 1, text: 'x'}], words: [], overlay});
        const track = /** @type {HTMLTrackElement} */ (video.querySelector('track'));
        track.track.mode = 'showing';
        video.textTracks.dispatchEvent(new window.Event('change'));
        expect(overlay.hidden).toBe(true);
        track.track.mode = 'hidden';
        video.textTracks.dispatchEvent(new window.Event('change'));
        expect(overlay.hidden).toBe(false);
        handle?.dispose();
    });

    test('CC the user had on before fullscreen stays on after exit (review M1)', () => {
        const {video, overlay} = mount();
        const handle = attachSubtitleTrack(video, {cues: [{start: 0, end: 1, text: 'x'}], words: [], overlay});
        const track = /** @type {HTMLTrackElement} */ (video.querySelector('track'));
        track.track.mode = 'showing';
        video.textTracks.dispatchEvent(new window.Event('change'));
        fullscreen = video;
        window.document.dispatchEvent(new window.Event('fullscreenchange'));
        expect(track.track.mode).toBe('showing');
        fullscreen = null;
        window.document.dispatchEvent(new window.Event('fullscreenchange'));
        expect(track.track.mode).toBe('showing');
        expect(overlay.hidden).toBe(true);
        handle?.dispose();
    });
});
