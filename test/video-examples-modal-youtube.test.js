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

import {afterAll, describe, expect, test} from 'vitest';
import {VideoExamplesModal} from '../ext/js/display/video-examples-modal.js';
import {setupDomTest} from './fixtures/dom-test.js';

const {window, teardown} = await setupDomTest();
afterAll(() => teardown(global));

const REF = 'dQw4w9WgXcQ';

/**
 * @param {Partial<import('flib-gateway').ExampleItem>} over
 * @returns {import('flib-gateway').ExampleItem}
 */
function item(over = {}) {
    return {source: 'youtube', ref: REF, start_ms: 61500, end_ms: 64200, text_en: 'I like to run', text_ru: null, thumbnail_url: null, ...over};
}

describe('VideoExamplesModal.openYouTube', () => {
    test('embeds the no-cookie player and always offers the YouTube link', () => {
        const modal = new VideoExamplesModal();
        expect(modal.openYouTube(item(), {words: ['run']})).toBe(true);
        const iframe = /** @type {HTMLIFrameElement} */ (window.document.querySelector('.entry-video-examples-modal iframe'));
        expect(iframe.getAttribute('src')).toBe(`https://www.youtube-nocookie.com/embed/${REF}?start=61&end=65&autoplay=1&rel=0`);
        const link = /** @type {HTMLAnchorElement} */ (window.document.querySelector('.entry-video-examples-modal a.ve-gw-youtube-link'));
        expect(link.textContent).toBe('Открыть на YouTube');
        expect(link.href).toBe(`https://www.youtube.com/watch?v=${REF}&t=61s`);
        expect(link.target).toBe('_blank');
        expect(link.rel).toContain('noopener');
        expect(window.document.querySelector('.entry-video-examples-modal mark')?.textContent).toBe('run');
        modal.close();
        expect(window.document.querySelector('.entry-video-examples-modal')).toBeNull();
    });

    test('an invalid ref opens nothing', () => {
        const modal = new VideoExamplesModal();
        expect(modal.openYouTube(item({ref: 'x" onload="'}))).toBe(false);
        expect(window.document.querySelector('.entry-video-examples-modal')).toBeNull();
    });
});

describe('VideoExamplesModal accessibility (review M6)', () => {
    window.HTMLMediaElement.prototype.pause = () => {};
    window.HTMLMediaElement.prototype.load = () => {};

    /**
     * @param {HTMLElement} target
     * @param {boolean} [shiftKey]
     * @returns {KeyboardEvent}
     */
    function tab(target, shiftKey = false) {
        const event = new window.KeyboardEvent('keydown', {key: 'Tab', shiftKey, bubbles: true, cancelable: true});
        target.dispatchEvent(event);
        return event;
    }

    /** @type {Array<[string, (modal: VideoExamplesModal) => void]>} */
    const openers = [
        ['openYouTube', (modal) => { modal.openYouTube(item(), {words: ['run']}); }],
        ['open (clip)', (modal) => {
            modal.open(/** @type {any} */ ({clip_id: 'c1', clip_url: 'http://127.0.0.1:8777/clip.mp4', subtitle_url: null, subtitle_text: '', order_index: 0}), {words: ['run']});
        }],
    ];

    test.each(openers)('%s: aria-modal dialog, labelled ×, focus on close button, focus returns on close', (_name, openIt) => {
        const opener = window.document.createElement('button');
        window.document.body.appendChild(opener);
        opener.focus();
        const modal = new VideoExamplesModal();
        openIt(modal);
        const overlay = /** @type {HTMLElement} */ (window.document.querySelector('.entry-video-examples-modal-overlay'));
        expect(overlay.getAttribute('role')).toBe('dialog');
        expect(overlay.getAttribute('aria-modal')).toBe('true');
        const close = /** @type {HTMLButtonElement} */ (overlay.querySelector('.entry-video-examples-modal-close'));
        expect(close.getAttribute('aria-label')).toBe('Закрыть');
        expect(window.document.activeElement).toBe(close);
        modal.close();
        expect(window.document.activeElement).toBe(opener);
        opener.remove();
    });

    test('Tab is trapped inside the YouTube dialog (wraps both ways)', () => {
        const modal = new VideoExamplesModal();
        modal.openYouTube(item());
        const overlay = /** @type {HTMLElement} */ (window.document.querySelector('.entry-video-examples-modal-overlay'));
        const close = /** @type {HTMLElement} */ (overlay.querySelector('.entry-video-examples-modal-close'));
        const link = /** @type {HTMLElement} */ (overlay.querySelector('a.ve-gw-youtube-link'));
        link.focus();
        const forward = tab(link);
        expect(forward.defaultPrevented).toBe(true);
        expect(window.document.activeElement).toBe(close);
        const backward = tab(close, true);
        expect(backward.defaultPrevented).toBe(true);
        expect(window.document.activeElement).toBe(link);
        // Tab in the middle is left to the browser.
        const iframe = /** @type {HTMLElement} */ (overlay.querySelector('iframe'));
        iframe.focus();
        expect(tab(iframe).defaultPrevented).toBe(false);
        modal.close();
    });

    test('after close, Tab is no longer intercepted', () => {
        const modal = new VideoExamplesModal();
        modal.openYouTube(item());
        modal.close();
        const outside = window.document.createElement('button');
        window.document.body.appendChild(outside);
        outside.focus();
        expect(tab(outside).defaultPrevented).toBe(false);
        outside.remove();
    });
});

describe('VideoExamplesModal clip: native-fullscreen subtitle track (Core path)', () => {
    test('adds a hidden English <track> with a highlighted blob VTT; close revokes it', async () => {
        window.HTMLMediaElement.prototype.pause = () => {};
        window.HTMLMediaElement.prototype.load = () => {};
        const savedFetch = globalThis.fetch;
        const savedCreate = Object.getOwnPropertyDescriptor(URL, 'createObjectURL');
        const savedRevoke = Object.getOwnPropertyDescriptor(URL, 'revokeObjectURL');
        /** @type {string[]} */
        const revoked = [];
        URL.createObjectURL = () => 'blob:vtt/1';
        URL.revokeObjectURL = (/** @type {string} */ url) => { revoked.push(url); };
        globalThis.fetch = /** @type {typeof fetch} */ (/** @type {unknown} */ (async () => ({ok: true, text: async () => 'WEBVTT\n\n00:00:01.000 --> 00:00:02.000\nShe fixed on it\n'})));
        try {
            const modal = new VideoExamplesModal();
            modal.open(/** @type {any} */ ({clip_id: 'c1', clip_url: 'http://127.0.0.1:8777/clip.mp4', subtitle_url: 'http://127.0.0.1:8777/clip.vtt', subtitle_text: '', order_index: 0}), {words: ['fixed on']});
            const video = /** @type {HTMLVideoElement} */ (window.document.querySelector('.entry-video-examples-modal video'));
            await new Promise((resolve) => { setTimeout(resolve, 0); });
            const track = /** @type {HTMLTrackElement} */ (video.querySelector('track'));
            expect(track).not.toBeNull();
            expect(track.kind).toBe('subtitles');
            expect(track.getAttribute('src')).toBe('blob:vtt/1');
            modal.close();
            expect(revoked).toContain('blob:vtt/1');
        } finally {
            globalThis.fetch = savedFetch;
            for (const [name, saved] of /** @type {const} */ ([['createObjectURL', savedCreate], ['revokeObjectURL', savedRevoke]])) {
                if (typeof saved === 'undefined') {
                    Reflect.deleteProperty(URL, name);
                } else {
                    Object.defineProperty(URL, name, saved);
                }
            }
        }
    });
});
