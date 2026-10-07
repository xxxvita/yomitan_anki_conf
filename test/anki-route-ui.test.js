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
    EXAMPLES_UNAVAILABLE_MESSAGE,
    decideExamplesSource,
} from '../ext/js/display/anki-route-ui.js';
import {TestWordsController} from '../ext/js/display/test-words-panel.js';
import {DisplayAnki} from '../ext/js/display/display-anki.js';
import {parseJson} from '../ext/js/core/json.js';
import {VideoExamplesPanel} from '../ext/js/display/video-examples-panel.js';
import {GatewayExamplesLoader} from '../ext/js/display/gateway-examples-loader.js';

const {window, teardown} = await setupDomTest();
afterAll(() => teardown(global));

const CORE = 'http://127.0.0.1:8777';

/** @type {import('anki-route').AnkiRoute} */
const coreRoute = {mode: 'core', ankiServer: CORE, coreBase: CORE, checkedAt: 1};
/** @type {import('anki-route').AnkiRoute} */
const directRoute = {mode: 'direct', ankiServer: 'http://127.0.0.1:8765', coreBase: null, checkedAt: 1};
/** @type {import('anki-route').AnkiRoute} */
const noneRoute = {mode: 'none', ankiServer: CORE, coreBase: null, checkedAt: 1};
/** @type {import('anki-route').AnkiRoute} Anki integration off (P2): no probes, coreBase kept non-null. */
const disabledRoute = {mode: 'disabled', ankiServer: CORE, coreBase: CORE, checkedAt: 1};

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
    test('core only when Core is reachable (no gateway status)', () => {
        expect(decideExamplesSource(coreRoute)).toBe('core');
        expect(decideExamplesSource(directRoute)).toBe('unavailable');
        expect(decideExamplesSource(noneRoute)).toBe('unavailable');
        expect(decideExamplesSource(null)).toBe('unavailable');
    });

    const withKey = {hasKey: true};
    const withoutKey = {hasKey: false};
    test.each([
        // [route, gateway status, expected]
        [coreRoute, withKey, 'gateway'],
        [directRoute, withKey, 'gateway'],
        [noneRoute, withKey, 'gateway'],
        [null, withKey, 'gateway'],
        [disabledRoute, withKey, 'gateway'],
        [disabledRoute, withoutKey, 'core'],
        [disabledRoute, null, 'core'],
        [coreRoute, withoutKey, 'core'],
        [directRoute, withoutKey, 'unavailable'],
        [noneRoute, withoutKey, 'unavailable'],
        [null, withoutKey, 'unavailable'],
        [coreRoute, null, 'core'],
        [null, null, 'unavailable'],
    ])('matrix %#: key beats Core, Core beats nothing', (route, status, expected) => {
        expect(decideExamplesSource(route, status)).toBe(expected);
    });

    test('the unavailable message names both ways out', () => {
        expect(EXAMPLES_UNAVAILABLE_MESSAGE).toBe('Для примеров укажите личный ключ в настройках (Flib-club: сервер) или запустите anki_conf');
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
     * @returns {{_ankiRoute: ?import('anki-route').AnkiRoute, _confServer: string, _clipboardTestWordsPanel: TestWordsController, _phraseTestWordsPanels: Map<HTMLElement, TestWordsController>, host: HTMLElement}}
     */
    function makeContext() {
        const {controller, host} = makeTestWords(vi.fn());
        controller.render();
        return {_ankiRoute: null, _confServer: 'stale', _clipboardTestWordsPanel: controller, _phraseTestWordsPanels: new Map(), host};
    }

    test('phrase «Test words» follows route changes after creation (L5), detached ones are dropped', () => {
        const ctx = makeContext();
        const phrase = makeTestWords(vi.fn());
        phrase.controller.render();
        const gone = makeTestWords(vi.fn());
        gone.controller.render();
        gone.host.remove();
        // eslint-disable-next-line no-underscore-dangle
        ctx._phraseTestWordsPanels.set(phrase.host, phrase.controller);
        // eslint-disable-next-line no-underscore-dangle
        ctx._phraseTestWordsPanels.set(gone.host, gone.controller);

        applyAnkiRoute.call(ctx, directRoute);
        expect(trigger(phrase.host).disabled).toBe(true);
        expect(trigger(phrase.host).title).toBe(CORE_REQUIRED_TITLE);
        // eslint-disable-next-line no-underscore-dangle
        expect([...ctx._phraseTestWordsPanels.keys()]).toStrictEqual([phrase.host]);

        applyAnkiRoute.call(ctx, coreRoute);
        expect(trigger(phrase.host).disabled).toBe(false);
    });

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

describe('DisplayAnki._resolveExamplesSource', () => {
    /* eslint-disable no-underscore-dangle, @typescript-eslint/unbound-method */
    const resolveExamplesSource = DisplayAnki.prototype._resolveExamplesSource;
    const getFlibGatewayStatus = DisplayAnki.prototype._getFlibGatewayStatus;
    /* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */

    /**
     * @param {?import('anki-route').AnkiRoute} route
     * @param {() => Promise<{hasKey: boolean, base: string}>} flibGatewayStatus
     * @returns {object}
     */
    function makeContext(route, flibGatewayStatus) {
        return {
            _refreshAnkiRoute: async () => route,
            _getFlibGatewayStatus: getFlibGatewayStatus,
            _display: {application: {api: {flibGatewayStatus}}},
        };
    }

    test('a valid key wins over a running Core', async () => {
        const ctx = makeContext(coreRoute, async () => ({hasKey: true, base: 'https://gw.test'}));
        expect(await resolveExamplesSource.call(ctx)).toBe('gateway');
    });

    test('no key → Core', async () => {
        const ctx = makeContext(coreRoute, async () => ({hasKey: false, base: 'https://gw.test'}));
        expect(await resolveExamplesSource.call(ctx)).toBe('core');
    });

    test('status lookup failing degrades to the Core decision', async () => {
        const ctx = makeContext(directRoute, async () => { throw new Error('backend gone'); });
        expect(await resolveExamplesSource.call(ctx)).toBe('unavailable');
    });
});

/* eslint-disable no-underscore-dangle */
describe('DisplayAnki._claimVideoExamplesSlot (mount race after awaits)', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const claim = DisplayAnki.prototype._claimVideoExamplesSlot;

    test('a detached entry, or one that got a live panel meanwhile, is not mounted again', () => {
        const entry = window.document.createElement('div');
        const ctx = {_videoExamplesPanels: new Map()};
        expect(claim.call(ctx, entry)).toBe(false);
        window.document.body.appendChild(entry);
        expect(claim.call(ctx, entry)).toBe(true);
        const root = window.document.createElement('div');
        entry.appendChild(root);
        ctx._videoExamplesPanels.set(entry, {root, destroy: vi.fn()});
        expect(claim.call(ctx, entry)).toBe(false);
    });

    test('a stale panel whose root is gone is destroyed before the slot is reused', () => {
        const entry = window.document.createElement('div');
        window.document.body.appendChild(entry);
        const stale = {root: window.document.createElement('div'), destroy: vi.fn()};
        const ctx = {_videoExamplesPanels: new Map([[entry, stale]])};
        expect(claim.call(ctx, entry)).toBe(true);
        expect(stale.destroy).toHaveBeenCalledTimes(1);
        expect(ctx._videoExamplesPanels.has(entry)).toBe(false);
    });
});
/* eslint-enable no-underscore-dangle */

/* eslint-disable no-underscore-dangle */
describe('DisplayAnki._applySelectedClipsToNote server_origin (P2-review M3)', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const applySelectedClips = DisplayAnki.prototype._applySelectedClipsToNote;

    /** @type {import('anki-conf').ClipsPersistedItem[]} */
    const persisted = /** @type {import('anki-conf').ClipsPersistedItem[]} */ (/** @type {unknown} */ ([{
        cache_key: 'k1', duration_ms: 1000, subtitle_text: 'hi', recut: {token: 't', order_index: 0}, meta: {lemma: 'w', forms: []},
    }]));

    /**
     * @param {string} confServer
     * @param {?string} refreshedConfServer `_confServer` after a route refresh (null: refresh not expected to change it).
     * @returns {{ctx: Record<string, any>, entry: HTMLElement, persist: import('vitest').Mock, refresh: import('vitest').Mock}}
     */
    function makeContext(confServer, refreshedConfServer = null) {
        const entry = window.document.createElement('div');
        /** @type {Record<string, any>} */
        const ctx = {};
        const persist = vi.fn(async () => ({persisted, failed: []}));
        const refresh = vi.fn(async () => {
            if (refreshedConfServer !== null) { ctx._confServer = refreshedConfServer; }
            return null;
        });
        Object.assign(ctx, {
            _videoExamplesPanels: new Map([[entry, {getSelectedClipIds: () => ['c1']}]]),
            _videoExamplesOrchestrator: {getJobIdForEntry: () => 'job-1'},
            _confServer: confServer,
            _refreshAnkiRoute: refresh,
            _display: {application: {api: {lexiconClipsPersist: persist}}},
        });
        return {ctx, entry, persist, refresh};
    }

    /**
     * @param {import('anki').Note} note
     * @returns {unknown}
     */
    function origin(note) {
        /** @type {{videos: {server_origin: unknown}[]}} */
        const doc = parseJson(note.fields.data);
        return doc.videos[0].server_origin;
    }

    test('no Core base even after a route refresh: the save is blocked before persisting, no empty origin is written', async () => {
        const {ctx, entry, persist, refresh} = makeContext('', '');
        const note = /** @type {import('anki').Note} */ (/** @type {unknown} */ ({fields: {}}));
        const result = await applySelectedClips.call(ctx, note, entry);
        expect(result).toBeInstanceOf(Error);
        expect(/** @type {Error} */ (result).message).toContain('anki_conf');
        expect(refresh).toHaveBeenCalledTimes(1);
        expect(persist).not.toHaveBeenCalled();
        expect(note.fields.data).toBeUndefined();
    });

    test('a stale empty origin is re-checked: Core found on refresh → its base is the origin', async () => {
        const {ctx, entry, persist} = makeContext('', CORE);
        const note = /** @type {import('anki').Note} */ (/** @type {unknown} */ ({fields: {}}));
        expect(await applySelectedClips.call(ctx, note, entry)).toBeNull();
        expect(persist).toHaveBeenCalledTimes(1);
        expect(origin(note)).toBe(CORE);
    });

    test('the origin is taken before persisting: a route flip during the call cannot blank it', async () => {
        const {ctx, entry, persist, refresh} = makeContext(CORE);
        persist.mockImplementation(async () => {
            ctx._confServer = '';
            return {persisted, failed: []};
        });
        const note = /** @type {import('anki').Note} */ (/** @type {unknown} */ ({fields: {}}));
        expect(await applySelectedClips.call(ctx, note, entry)).toBeNull();
        expect(refresh).not.toHaveBeenCalled();
        expect(origin(note)).toBe(CORE);
    });
});

describe('DisplayAnki._showVideoExamplesForEntry over an auto-mounted «anki_conf не запущен» panel (P3)', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const showForEntry = DisplayAnki.prototype._showVideoExamplesForEntry;
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const claim = DisplayAnki.prototype._claimVideoExamplesSlot;

    test('with a key, the first Ex click replaces the message with the gateway panel', async () => {
        const entry = window.document.createElement('div');
        window.document.body.appendChild(entry);
        const stale = new VideoExamplesPanel(entry, 'word', {onCancel: () => {}, onRetry: () => {}});
        stale.showUnavailable(EXAMPLES_CORE_UNAVAILABLE_MESSAGE);
        const mountGateway = vi.fn();
        const ctx = {
            _videoExamplesOrchestrator: {cancelEntry: vi.fn()},
            _videoExamplesPanels: new Map([[entry, stale]]),
            _hideVideoExamplesDensityToggleIfEmpty: vi.fn(),
            _ensureVideoExamplesDensityToggle: vi.fn(),
            _display: {invokeContentOrigin: vi.fn(async () => {})},
            _resolveExamplesSource: async () => 'gateway',
            _claimVideoExamplesSlot: claim,
            _ankiRoute: directRoute,
            _buildReplayClipsForEntry: vi.fn(async () => null),
            _mountGatewayExamplesPanel: mountGateway,
            _mountExamplesUnavailablePanel: vi.fn(),
        };
        await showForEntry.call(ctx, entry, 'word', 'click', 0);
        expect(stale.root.isConnected).toBe(false);
        expect(mountGateway).toHaveBeenCalledWith(entry, 'word', 'click', 0);
        expect(ctx._mountExamplesUnavailablePanel).not.toHaveBeenCalled();
        // No Core → no replay lookup that could hang the gateway panel.
        expect(ctx._buildReplayClipsForEntry).not.toHaveBeenCalled();
        entry.remove();
    });
});
/* eslint-enable no-underscore-dangle */

/* eslint-disable no-underscore-dangle, @typescript-eslint/unbound-method */
describe('DisplayAnki._showVideoExamplesForEntry double Ex click (review M1)', () => {
    test('two clicks while flibGatewayStatus is pending → exactly one panel and one word-examples start', async () => {
        const entry = window.document.createElement('div');
        window.document.body.appendChild(entry);
        /** @type {(value: {hasKey: boolean, base: string}) => void} */
        let releaseStatus = () => {};
        const statusPromise = new Promise((resolve) => { releaseStatus = resolve; });
        const api = {
            flibGatewayStatus: vi.fn(() => statusPromise),
            flibGatewayExamples: vi.fn(async () => ({word: 'run', items: [], empty_reason: 'not_in_corpus'})),
            flibGatewayWordExamplesStart: vi.fn(async () => ({jobId: 'wej-1'})),
            flibGatewayWordExamplesPoll: vi.fn(async () => ({done: true, result: {results: []}})),
            flibGatewayWordExamplesCancel: vi.fn(async () => true),
        };
        /** @type {Map<HTMLElement, unknown>} */
        const panels = new Map();
        const ctx = {
            _videoExamplesOrchestrator: {cancelEntry: vi.fn()},
            _videoExamplesPanels: panels,
            _videoExamplesDensity: 'compact',
            _gatewayExamplesLoader: new GatewayExamplesLoader(/** @type {any} */ (api), {sleep: async () => {}}),
            _hideVideoExamplesDensityToggleIfEmpty: vi.fn(),
            _ensureVideoExamplesDensityToggle: vi.fn(),
            _setVideoExamplesDragEnabled: vi.fn(),
            _display: {invokeContentOrigin: vi.fn(async () => {}), application: {api}},
            _ankiRoute: directRoute,
            _refreshAnkiRoute: async () => directRoute,
            _resolveExamplesSource: DisplayAnki.prototype._resolveExamplesSource,
            _getFlibGatewayStatus: DisplayAnki.prototype._getFlibGatewayStatus,
            _claimVideoExamplesSlot: DisplayAnki.prototype._claimVideoExamplesSlot,
            _mountGatewayExamplesPanel: DisplayAnki.prototype._mountGatewayExamplesPanel,
            _mountExamplesUnavailablePanel: vi.fn(),
            _buildReplayClipsForEntry: vi.fn(async () => null),
            _openYouTubeExample: vi.fn(),
        };
        const first = DisplayAnki.prototype._showVideoExamplesForEntry.call(ctx, entry, 'run', 'click', 0);
        const second = DisplayAnki.prototype._showVideoExamplesForEntry.call(ctx, entry, 'run', 'click', 0);
        releaseStatus({hasKey: true, base: 'https://cache.flib.club'});
        await Promise.all([first, second]);
        const panel = /** @type {import('../ext/js/display/gateway-examples-panel.js').GatewayExamplesPanel} */ (panels.get(entry));
        await panel.whenIdle();
        expect(panels.size).toBe(1);
        expect(entry.querySelectorAll('.ve-gw')).toHaveLength(1);
        expect(api.flibGatewayWordExamplesStart).toHaveBeenCalledTimes(1);
        panel.destroy();
        entry.remove();
    });
});
/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */

/* eslint-disable no-underscore-dangle, @typescript-eslint/unbound-method */
describe('DisplayAnki gateway → Core fallback (review M5)', () => {
    test('the panel hook destroys the gateway panel and re-opens examples forced to Core', () => {
        const entry = window.document.createElement('div');
        window.document.body.appendChild(entry);
        const show = vi.fn(async () => {});
        /** @type {Map<HTMLElement, unknown>} */
        const panels = new Map();
        const ctx = {
            _gatewayExamplesLoader: {loadYouTube: vi.fn(async () => ({items: [], emptyReason: null})), loadFilms: vi.fn(async () => ({clips: [], emptyReason: null}))},
            _videoExamplesPanels: panels,
            _videoExamplesDensity: 'compact',
            _ankiRoute: coreRoute,
            _hideVideoExamplesDensityToggleIfEmpty: vi.fn(),
            _setVideoExamplesDragEnabled: vi.fn(),
            _showVideoExamplesForEntry: show,
            _openYouTubeExample: vi.fn(),
            _display: {dictionaryEntries: [{type: 'term', headwords: [{term: 'run'}, {term: 'sprint'}]}]},
        };
        DisplayAnki.prototype._mountGatewayExamplesPanel.call(ctx, entry, 'run', 'click', 0);
        const gateway = /** @type {{_canFallbackToCore: () => boolean, _hooks: {onCoreFallback: () => void}, root: HTMLElement, _words: string[]}} */ (panels.get(entry));
        // All headwords of the entry feed the inflected highlight.
        expect(gateway._words).toEqual(expect.arrayContaining(['run', 'ran', 'sprint', 'sprinted']));
        expect(gateway._canFallbackToCore()).toBe(true);
        gateway._hooks.onCoreFallback();
        expect(gateway.root.isConnected).toBe(false);
        expect(panels.has(entry)).toBe(false);
        expect(show).toHaveBeenCalledWith(entry, 'run', 'click', 0, 'core');
        ctx._ankiRoute = directRoute;
        expect(gateway._canFallbackToCore()).toBe(false);
        entry.remove();
    });

    test('a forced Core open skips the key check and mounts the Core collect panel', async () => {
        const entry = window.document.createElement('div');
        window.document.body.appendChild(entry);
        const requestExamples = vi.fn();
        /** @type {Map<HTMLElement, any>} */
        const panels = new Map();
        const ctx = {
            _videoExamplesOrchestrator: {cancelEntry: vi.fn(), requestExamples},
            _videoExamplesPanels: panels,
            _videoExamplesDensity: 'compact',
            _hideVideoExamplesDensityToggleIfEmpty: vi.fn(),
            _ensureVideoExamplesDensityToggle: vi.fn(),
            _setVideoExamplesDragEnabled: vi.fn(),
            _display: {invokeContentOrigin: vi.fn(async () => {})},
            _refreshAnkiRoute: vi.fn(async () => coreRoute),
            _resolveExamplesSource: vi.fn(async () => 'gateway'),
            _claimVideoExamplesSlot: DisplayAnki.prototype._claimVideoExamplesSlot,
            _ankiRoute: coreRoute,
            _buildReplayClipsForEntry: vi.fn(async () => null),
            _mountGatewayExamplesPanel: vi.fn(),
            _mountExamplesUnavailablePanel: vi.fn(),
            _openVideoExamplesModal: vi.fn(),
        };
        await DisplayAnki.prototype._showVideoExamplesForEntry.call(ctx, entry, 'run', 'click', 0, 'core');
        expect(ctx._resolveExamplesSource).not.toHaveBeenCalled();
        expect(ctx._mountGatewayExamplesPanel).not.toHaveBeenCalled();
        expect(requestExamples).toHaveBeenCalledTimes(1);
        expect(panels.get(entry)).toBeInstanceOf(VideoExamplesPanel);
        panels.get(entry).destroy();
        entry.remove();
    });

    test('a forced Core open when Core went away shows the anki_conf message instead', async () => {
        const entry = window.document.createElement('div');
        window.document.body.appendChild(entry);
        const ctx = {
            _videoExamplesOrchestrator: {cancelEntry: vi.fn(), requestExamples: vi.fn()},
            _videoExamplesPanels: new Map(),
            _hideVideoExamplesDensityToggleIfEmpty: vi.fn(),
            _ensureVideoExamplesDensityToggle: vi.fn(),
            _display: {invokeContentOrigin: vi.fn(async () => {})},
            _refreshAnkiRoute: vi.fn(async () => directRoute),
            _resolveExamplesSource: vi.fn(async () => 'gateway'),
            _claimVideoExamplesSlot: DisplayAnki.prototype._claimVideoExamplesSlot,
            _ankiRoute: directRoute,
            _mountGatewayExamplesPanel: vi.fn(),
            _mountExamplesUnavailablePanel: vi.fn(),
        };
        await DisplayAnki.prototype._showVideoExamplesForEntry.call(ctx, entry, 'run', 'click', 0, 'core');
        expect(ctx._mountExamplesUnavailablePanel).toHaveBeenCalledWith(entry, 'run', 'click', 0, EXAMPLES_CORE_UNAVAILABLE_MESSAGE);
        expect(ctx._mountGatewayExamplesPanel).not.toHaveBeenCalled();
        entry.remove();
    });
});
/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */
