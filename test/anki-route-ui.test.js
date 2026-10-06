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

import {afterAll, describe, expect, test, vi} from 'vitest';
import {setupDomTest} from './fixtures/dom-test.js';
import {
    CORE_REQUIRED_TITLE,
    EXAMPLES_CORE_UNAVAILABLE_MESSAGE,
    decideExamplesSource,
    describeAnkiRoute,
} from '../ext/js/display/anki-route-ui.js';
import {TestWordsController} from '../ext/js/display/test-words-panel.js';
import {DisplayAnki} from '../ext/js/display/display-anki.js';
import {VideoExamplesPanel} from '../ext/js/display/video-examples-panel.js';

const {window, teardown} = await setupDomTest();
afterAll(() => teardown(global));

const CORE = 'http://127.0.0.1:8777';

/** @type {import('anki-route').AnkiRoute} */
const coreRoute = {mode: 'core', ankiServer: CORE, coreBase: CORE, checkedAt: 1};
/** @type {import('anki-route').AnkiRoute} */
const directRoute = {mode: 'direct', ankiServer: 'http://127.0.0.1:8765', coreBase: null, checkedAt: 1};
/** @type {import('anki-route').AnkiRoute} */
const noneRoute = {mode: 'none', ankiServer: CORE, coreBase: null, checkedAt: 1};

/**
 * @param {ReturnType<typeof vi.fn>} analyze
 * @returns {{controller: TestWordsController, host: HTMLElement}}
 */
function makeTestWords(analyze) {
    const host = window.document.createElement('div');
    window.document.body.appendChild(host);
    const display = /** @type {import('../ext/js/display/display.js').Display} */ (/** @type {unknown} */ ({
        application: {api: {lexiconAnalyzeText: analyze}},
    }));
    const controller = new TestWordsController({
        display,
        hostElement: host,
        getTextSource: () => 'some text',
        triggerLabel: 'CheckWords',
        triggerTitle: 'Check the clipboard for new words',
    });
    return {controller, host};
}

/**
 * @param {HTMLElement} host
 * @returns {HTMLButtonElement}
 */
function trigger(host) {
    return /** @type {HTMLButtonElement} */ (host.querySelector('.test-words-trigger'));
}

describe('decideExamplesSource', () => {
    test('core only when Core is reachable', () => {
        expect(decideExamplesSource(coreRoute)).toBe('core');
        expect(decideExamplesSource(directRoute)).toBe('unavailable');
        expect(decideExamplesSource(noneRoute)).toBe('unavailable');
        expect(decideExamplesSource(null)).toBe('unavailable');
    });
});

describe('describeAnkiRoute', () => {
    test('settings status lines', () => {
        expect(describeAnkiRoute(coreRoute)).toBe('Подключено через anki_conf (Core)');
        expect(describeAnkiRoute(directRoute)).toBe('Подключено напрямую к AnkiConnect (anki_conf не запущен)');
        expect(describeAnkiRoute(noneRoute)).toBeNull();
        expect(describeAnkiRoute(null)).toBeNull();
    });
});

describe('TestWordsController availability', () => {
    test('unavailable disables the trigger with the explanatory title and ignores clicks', async () => {
        const analyze = vi.fn(async () => ({newWords: [], source: 'unknown'}));
        const {controller, host} = makeTestWords(analyze);
        controller.render();
        controller.setAvailable(false, CORE_REQUIRED_TITLE);
        expect(trigger(host).disabled).toBe(true);
        expect(trigger(host).title).toBe(CORE_REQUIRED_TITLE);
        trigger(host).click();
        await Promise.resolve();
        expect(analyze).not.toHaveBeenCalled();
    });

    test('becoming available again restores the original title', () => {
        const {controller, host} = makeTestWords(vi.fn());
        controller.render();
        controller.setAvailable(false, CORE_REQUIRED_TITLE);
        controller.setAvailable(true);
        expect(trigger(host).disabled).toBe(false);
        expect(trigger(host).title).toBe('Check the clipboard for new words');
    });

    test('availability set before render is applied on render', () => {
        const {controller, host} = makeTestWords(vi.fn());
        controller.setAvailable(false, CORE_REQUIRED_TITLE);
        controller.render();
        expect(trigger(host).disabled).toBe(true);
    });
});

describe('DisplayAnki route application', () => {
    // eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
    const applyAnkiRoute = DisplayAnki.prototype._applyAnkiRoute;

    /**
     * @returns {{_ankiRoute: ?import('anki-route').AnkiRoute, _confServer: string, _clipboardTestWordsPanel: TestWordsController, host: HTMLElement}}
     */
    function makeContext() {
        const {controller, host} = makeTestWords(vi.fn());
        controller.render();
        return {_ankiRoute: null, _confServer: 'stale', _clipboardTestWordsPanel: controller, host};
    }

    test('without coreBase the CheckWords button is disabled and the clip origin is cleared', () => {
        const ctx = makeContext();
        applyAnkiRoute.call(ctx, directRoute);
        expect(trigger(ctx.host).disabled).toBe(true);
        expect(trigger(ctx.host).title).toBe(CORE_REQUIRED_TITLE);
        // eslint-disable-next-line no-underscore-dangle
        expect(ctx._confServer).toBe('');
    });

    test('a failed route lookup (null) degrades the same way', () => {
        const ctx = makeContext();
        applyAnkiRoute.call(ctx, null);
        expect(trigger(ctx.host).disabled).toBe(true);
    });

    test('with coreBase the clip origin comes from the route and CheckWords is enabled', () => {
        const ctx = makeContext();
        applyAnkiRoute.call(ctx, directRoute);
        applyAnkiRoute.call(ctx, coreRoute);
        expect(trigger(ctx.host).disabled).toBe(false);
        // eslint-disable-next-line no-underscore-dangle
        expect(ctx._confServer).toBe(CORE);
    });
});

describe('VideoExamplesPanel.showUnavailable', () => {
    test('renders the anki_conf message instead of clips', () => {
        const entry = window.document.createElement('div');
        window.document.body.appendChild(entry);
        const panel = new VideoExamplesPanel(entry, 'word', {onCancel: () => {}, onRetry: () => {}});
        panel.showUnavailable(EXAMPLES_CORE_UNAVAILABLE_MESSAGE);
        expect(panel.root.textContent).toContain(EXAMPLES_CORE_UNAVAILABLE_MESSAGE);
        expect(panel.isTerminal()).toBe(true);
        panel.destroy();
    });
});
