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

/* eslint-disable no-underscore-dangle */

import {afterAll, afterEach, describe, expect, test, vi} from 'vitest';
import {ExtensionError} from '../ext/js/core/extension-error.js';
import {log} from '../ext/js/core/log.js';
import {DisplayAnki} from '../ext/js/display/display-anki.js';
import {setupDomTest} from './fixtures/dom-test.js';

const {window, teardown} = await setupDomTest();
afterAll(() => teardown(global));

/**
 * @param {?string} failCode Both sections fail with this gateway code (null — empty results).
 * @returns {{loadYouTube: import('vitest').Mock, loadFilms: import('vitest').Mock, loadClipMedia: import('vitest').Mock}}
 */
function makeLoader(failCode) {
    const fail = async () => {
        const error = new ExtensionError(/** @type {string} */ (failCode));
        error.data = {code: failCode};
        throw error;
    };
    return {
        loadYouTube: vi.fn(failCode === null ? async () => ({items: [], emptyReason: 'not_in_corpus'}) : fail),
        loadFilms: vi.fn(failCode === null ? async () => ({clips: [], emptyReason: 'not_in_corpus', lemma: null, matchedForms: []}) : fail),
        loadClipMedia: vi.fn(),
    };
}

// eslint-disable-next-line jsdoc/require-returns -- the inferred shape is what the tests use
/**
 * Mounts a gateway panel through the REAL DisplayAnki#_mountGatewayExamplesPanel and its hooks.
 * @param {?string} failCode
 */
async function mount(failCode = null) {
    vi.spyOn(log, 'log').mockImplementation(() => {});
    const entry = window.document.createElement('div');
    window.document.body.appendChild(entry);
    const context = {
        _gatewayExamplesLoader: makeLoader(failCode),
        /** @type {Map<HTMLElement, import('../ext/js/display/gateway-examples-panel.js').GatewayExamplesPanel>} */
        _videoExamplesPanels: new Map(),
        _hideVideoExamplesDensityToggleIfEmpty: vi.fn(),
        _display: {dictionaryEntries: []},
        _videoExamplesDensity: 'compact',
        _ankiRoute: {mode: 'core', ankiServer: 'http://127.0.0.1:8777', coreBase: 'http://127.0.0.1:8777', checkedAt: 0},
        _setVideoExamplesDragEnabled: vi.fn(),
        _showVideoExamplesForEntry: vi.fn(async () => {}),
    };
    DisplayAnki.prototype._mountGatewayExamplesPanel.call(context, entry, 'run', 'term', 0);
    const panel = /** @type {import('../ext/js/display/gateway-examples-panel.js').GatewayExamplesPanel} */ (context._videoExamplesPanels.get(entry));
    await panel.whenIdle();
    return {context, entry, panel};
}

afterEach(() => {
    vi.restoreAllMocks();
    window.document.body.replaceChildren();
});

describe('DisplayAnki#_mountGatewayExamplesPanel hooks destroy the panel as the USER', () => {
    test('× (onCancel) → destroyReason user, panel unmapped', async () => {
        const {context, entry, panel} = await mount();
        /** @type {HTMLButtonElement} */ (panel.root.querySelector('.entry-video-examples-icon-close')).click();
        expect(panel.destroyReason).toBe('user');
        expect(context._videoExamplesPanels.has(entry)).toBe(false);
    });

    test('↻ (onRetry) → destroyReason user, panel restarted', async () => {
        const {context, panel} = await mount();
        /** @type {HTMLButtonElement} */ (panel.root.querySelector('.entry-video-examples-icon-refresh')).click();
        expect(panel.destroyReason).toBe('user');
        expect(context._showVideoExamplesForEntry).toHaveBeenCalledTimes(1);
    });

    test('«Показать через anki_conf» (onCoreFallback) → destroyReason user, Core panel requested', async () => {
        const {context, panel} = await mount('flib_key_invalid');
        /** @type {HTMLButtonElement} */ (panel.root.querySelector('.ve-gw-core-fallback')).click();
        expect(panel.destroyReason).toBe('user');
        expect(context._showVideoExamplesForEntry).toHaveBeenCalledWith(expect.anything(), 'run', 'term', 0, 'core');
    });
});

/* eslint-enable no-underscore-dangle */
