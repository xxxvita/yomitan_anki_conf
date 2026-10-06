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
