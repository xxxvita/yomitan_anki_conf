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
import {GatewayExamplesPanel} from '../ext/js/display/gateway-examples-panel.js';
import {PhraseSelectionMemory} from '../ext/js/display/phrase-examples-target.js';
import {translate} from '../ext/js/i18n/ui-language.js';
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
    const stubs = {
        _gatewayExamplesLoader: makeLoader(failCode),
        /** @type {Map<HTMLElement, import('../ext/js/display/gateway-examples-panel.js').GatewayExamplesPanel>} */
        _videoExamplesPanels: new Map(),
        _hideVideoExamplesDensityToggleIfEmpty: vi.fn(),
        _display: {dictionaryEntries: [], application: {api: null}},
        _videoExamplesDensity: 'compact',
        _ankiRoute: {mode: 'core', ankiServer: 'http://127.0.0.1:8777', coreBase: 'http://127.0.0.1:8777', checkedAt: 0},
        _setVideoExamplesDragEnabled: vi.fn(),
        _examplesPanelSearch: new WeakMap(),
        _showVideoExamplesForEntry: vi.fn(async () => {}),
    };
    // Real prototype methods (the mount calls its sibling helpers), stubbed collaborators.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const anki = /** @type {DisplayAnki} */ (Object.create(DisplayAnki.prototype));
    Object.assign(anki, stubs);
    anki._mountGatewayExamplesPanel(entry, 'run', 'term', 0);
    const panel = /** @type {import('../ext/js/display/gateway-examples-panel.js').GatewayExamplesPanel} */ (stubs._videoExamplesPanels.get(entry));
    await panel.whenIdle();
    const context = stubs;
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
        expect(context._showVideoExamplesForEntry).toHaveBeenCalledWith(expect.anything(), 'run', 'term', 0, 'core', void 0);
    });
});

// ---------------------------------------------------------------------------
// Task 5: the phrase window searches the selection, with or without known words (C3, M3, M6).
// ---------------------------------------------------------------------------

/**
 * @param {string} value
 * @returns {{entry: HTMLElement, textarea: HTMLTextAreaElement, plain: HTMLButtonElement, known: HTMLButtonElement}}
 */
function makePhraseEntry(value) {
    const entry = window.document.createElement('div');
    entry.className = 'entry';
    entry.dataset.type = 'phrase';
    const textarea = window.document.createElement('textarea');
    textarea.className = 'phrase-expression-input';
    textarea.value = value;
    const plain = window.document.createElement('button');
    plain.dataset.action = 'show-examples';
    const known = window.document.createElement('button');
    known.dataset.action = 'show-examples-known';
    // An icon inside the button: the click target is a child, as in the real template.
    known.appendChild(window.document.createElement('span'));
    entry.append(plain, known, textarea);
    window.document.body.appendChild(entry);
    return {entry, textarea, plain, known};
}

/**
 * @param {{batchFailCode?: ?string}} [options]
 * @returns {{loadYouTube: import('vitest').Mock, loadFilms: import('vitest').Mock, loadClipMedia: import('vitest').Mock, loadBatch: import('vitest').Mock}}
 */
function makeBatchLoader({batchFailCode = null} = {}) {
    return {
        loadYouTube: vi.fn(async () => ({items: [], emptyReason: 'not_in_corpus'})),
        loadFilms: vi.fn(async () => ({clips: [], emptyReason: 'not_in_corpus', lemma: null, matchedForms: []})),
        loadClipMedia: vi.fn(),
        loadBatch: vi.fn(async () => {
            if (batchFailCode !== null) {
                const error = new ExtensionError(batchFailCode);
                error.data = {code: batchFailCode};
                throw error;
            }
            return {items: [], emptyReason: 'not_in_corpus', knownSource: 'route', partial: false};
        }),
    };
}

/**
 * @typedef {object} PhraseTestRig
 * @property {DisplayAnki} anki Real prototype methods, stubbed collaborators.
 * @property {ReturnType<typeof makeBatchLoader>} loader
 * @property {{cancelEntry: import('vitest').Mock, requestExamples: import('vitest').Mock}} orchestrator
 * @property {import('vitest').Mock} showNotice The stubbed _showExamplesNotice.
 */

/**
 * @param {{source?: 'gateway'|'core'|'unavailable', batchFailCode?: ?string}} [options]
 * @returns {PhraseTestRig}
 */
function makeDisplayAnki({source = 'gateway', batchFailCode = null} = {}) {
    vi.spyOn(log, 'log').mockImplementation(() => {});
    const loader = makeBatchLoader({batchFailCode});
    const orchestrator = {cancelEntry: vi.fn(), requestExamples: vi.fn()};
    const showNotice = vi.fn();
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const anki = /** @type {DisplayAnki} */ (Object.create(DisplayAnki.prototype));
    Object.assign(anki, {
        _gatewayExamplesLoader: loader,
        _videoExamplesOrchestrator: orchestrator,
        _videoExamplesPanels: new Map(),
        _examplesPanelSearch: new WeakMap(),
        _phraseSelection: new PhraseSelectionMemory(),
        _examplesNotification: null,
        _display: {dictionaryEntries: [], application: {api: null}, invokeContentOrigin: vi.fn(async () => {})},
        _videoExamplesDensity: 'compact',
        _ankiRoute: null,
        _hideVideoExamplesDensityToggleIfEmpty: vi.fn(),
        _ensureVideoExamplesDensityToggle: vi.fn(),
        _setVideoExamplesDragEnabled: vi.fn(),
        _resolveExamplesSource: vi.fn(async () => source),
        _refreshAnkiRoute: vi.fn(async () => null),
        _showExamplesNotice: showNotice,
    });
    return {anki, loader, orchestrator, showNotice};
}

/**
 * @param {DisplayAnki} anki
 * @param {HTMLElement} entry
 * @returns {import('../ext/js/display/video-examples-panel.js').VideoExamplesPanel|GatewayExamplesPanel}
 * @throws {Error} No panel is mounted on the entry.
 */
function panelOf(anki, entry) {
    const panel = anki._videoExamplesPanels.get(entry);
    if (typeof panel === 'undefined') { throw new Error('no panel mounted'); }
    return panel;
}

/**
 * @param {DisplayAnki} anki
 * @param {HTMLElement} entry
 * @returns {GatewayExamplesPanel}
 * @throws {Error} The entry's panel is not a gateway panel.
 */
function gatewayPanelOf(anki, entry) {
    const panel = panelOf(anki, entry);
    if (!(panel instanceof GatewayExamplesPanel)) { throw new Error('not a gateway panel'); }
    return panel;
}

/**
 * @param {Element} target
 * @returns {MouseEvent}
 */
function clickOn(target) {
    return /** @type {MouseEvent} */ (/** @type {unknown} */ ({target, preventDefault: vi.fn()}));
}

/**
 * @param {Element} target
 * @returns {FocusEvent}
 */
function focusOutOf(target) {
    return /** @type {FocusEvent} */ (/** @type {unknown} */ ({target}));
}

describe('phrase window: _onShowExamples builds the search from the selection', () => {
    test('«С учётом моих знаний» → known rank, quote target = the selection captured on mousedown', () => {
        const {anki} = makeDisplayAnki();
        const show = vi.spyOn(anki, '_showVideoExamplesForEntry').mockImplementation(async () => {});
        const {entry, textarea, known} = makePhraseEntry('I would rather stay at home');
        textarea.focus();
        textarea.setSelectionRange(8, 19);
        anki._onExamplesMouseDown(clickOn(known));
        // Focus moves to the button; a browser may drop the live range — the captured one must win.
        known.focus();
        textarea.setSelectionRange(0, 0);
        anki._onShowExamples(clickOn(/** @type {Element} */ (known.firstElementChild)));
        expect(show).toHaveBeenCalledWith(entry, 'rather stay', 'phrase', -1, void 0, {target: {text: 'rather stay', mode: 'quote'}, initialRank: 'known', truncated: false});
    });

    test('«Примеры» → plain rank, quote target', () => {
        const {anki} = makeDisplayAnki();
        const show = vi.spyOn(anki, '_showVideoExamplesForEntry').mockImplementation(async () => {});
        const {entry, plain} = makePhraseEntry('  break\n the ice ');
        anki._onShowExamples(clickOn(plain));
        expect(show).toHaveBeenCalledWith(entry, 'break the ice', 'phrase', -1, void 0, {target: {text: 'break the ice', mode: 'quote'}, initialRank: 'plain', truncated: false});
    });

    test('keyboard activation: the selection stored on the field\'s blur is used', () => {
        const {anki} = makeDisplayAnki();
        const show = vi.spyOn(anki, '_showVideoExamplesForEntry').mockImplementation(async () => {});
        const {textarea, known} = makePhraseEntry('break the ice');
        textarea.focus();
        textarea.setSelectionRange(6, 13);
        anki._onPhraseInputFocusOut(focusOutOf(textarea));
        known.focus();
        textarea.setSelectionRange(0, 0);
        anki._onShowExamples(clickOn(known));
        expect(show.mock.calls[0][1]).toBe('the ice');
    });

    test('nothing captured → the whole text', () => {
        const {anki} = makeDisplayAnki();
        const show = vi.spyOn(anki, '_showVideoExamplesForEntry').mockImplementation(async () => {});
        const {textarea, known} = makePhraseEntry('break the ice');
        textarea.setSelectionRange(6, 13);
        anki._onShowExamples(clickOn(known));
        expect(show.mock.calls[0][1]).toBe('break the ice');
    });

    test('over 200 characters → truncated in the search', () => {
        const {anki} = makeDisplayAnki();
        const show = vi.spyOn(anki, '_showVideoExamplesForEntry').mockImplementation(async () => {});
        const {known} = makePhraseEntry('word '.repeat(60));
        anki._onShowExamples(clickOn(known));
        const search = show.mock.calls[0][5];
        expect(search?.truncated).toBe(true);
        expect([...search?.target.text ?? ''].length).toBeLessThanOrEqual(200);
    });

    test('M3: no Latin letter → «Выделите английский текст», no request', () => {
        const {anki, showNotice} = makeDisplayAnki();
        const show = vi.spyOn(anki, '_showVideoExamplesForEntry').mockImplementation(async () => {});
        const {known} = makePhraseEntry('привет, мир');
        anki._onShowExamples(clickOn(known));
        expect(show).not.toHaveBeenCalled();
        expect(showNotice).toHaveBeenCalledWith(translate('examples.selectEnglish'));
    });

    test('empty text → nothing happens', () => {
        const {anki, showNotice} = makeDisplayAnki();
        const show = vi.spyOn(anki, '_showVideoExamplesForEntry').mockImplementation(async () => {});
        const {known} = makePhraseEntry('   ');
        anki._onShowExamples(clickOn(known));
        expect(show).not.toHaveBeenCalled();
        expect(showNotice).not.toHaveBeenCalled();
    });

    test('mousedown with the field NOT focused does not overwrite the stored blur selection', () => {
        const {anki} = makeDisplayAnki();
        const show = vi.spyOn(anki, '_showVideoExamplesForEntry').mockImplementation(async () => {});
        const {textarea, known} = makePhraseEntry('break the ice');
        textarea.focus();
        textarea.setSelectionRange(0, 5);
        anki._onPhraseInputFocusOut(focusOutOf(textarea));
        known.focus();
        anki._onExamplesMouseDown(clickOn(known));
        anki._onShowExamples(clickOn(known));
        expect(show.mock.calls[0][1]).toBe('break');
    });
});

describe('phrase window: routing threads the search to the panel (C3)', () => {
    test('known on a gateway source → the panel opens in the known mode with the target in the pill', async () => {
        const {anki, loader} = makeDisplayAnki();
        const {entry} = makePhraseEntry('break the ice');
        await anki._showVideoExamplesForEntry(entry, 'the ice', 'phrase', -1, void 0, {target: {text: 'the ice', mode: 'quote'}, initialRank: 'known'});
        const panel = gatewayPanelOf(anki, entry);
        await panel.whenIdle();
        expect(loader.loadBatch).toHaveBeenCalledWith({text: 'the ice', mode: 'quote'}, 'known');
        expect(loader.loadYouTube).not.toHaveBeenCalled();
        expect(panel.root.querySelector('.entry-video-examples-word-text')?.textContent).toBe('the ice');
        expect(panel.root.dataset.examplesRank).toBe('known');
    });

    test('plain with the batch axis off (404) → loadYouTube fallback with the text', async () => {
        const {anki, loader} = makeDisplayAnki({batchFailCode: 'flib_axis_off'});
        const {entry} = makePhraseEntry('break the ice');
        await anki._showVideoExamplesForEntry(entry, 'break the ice', 'phrase', -1, void 0, {target: {text: 'break the ice', mode: 'quote'}, initialRank: 'plain'});
        const panel = gatewayPanelOf(anki, entry);
        await panel.whenIdle();
        expect(loader.loadBatch).toHaveBeenCalledWith({text: 'break the ice', mode: 'quote'}, 'plain');
        expect(loader.loadYouTube).toHaveBeenCalledWith('break the ice');
        expect(panel.root.dataset.examplesRank).toBe('plain');
    });

    test('truncated → the 200-character note in the panel', async () => {
        const {anki} = makeDisplayAnki();
        const {entry} = makePhraseEntry('x');
        await anki._showVideoExamplesForEntry(entry, 'word', 'phrase', -1, void 0, {target: {text: 'word', mode: 'quote'}, initialRank: 'plain', truncated: true});
        const panel = gatewayPanelOf(anki, entry);
        await panel.whenIdle();
        expect(panel.root.querySelector('.ve-gw-truncated-note')?.textContent).toBe(translate('video.truncatedQuery'));
    });

    test('«Показать через anki_conf» keeps the search', async () => {
        const {anki} = makeDisplayAnki({batchFailCode: 'flib_key_invalid'});
        anki._ankiRoute = {mode: 'core', ankiServer: 'http://127.0.0.1:8777', coreBase: 'http://127.0.0.1:8777', checkedAt: 0};
        const search = /** @type {const} */ ({target: {text: 'the ice', mode: 'quote'}, initialRank: 'plain'});
        const {entry} = makePhraseEntry('break the ice');
        await anki._showVideoExamplesForEntry(entry, 'the ice', 'phrase', -1, void 0, search);
        const panel = gatewayPanelOf(anki, entry);
        await panel.whenIdle();
        const show = vi.spyOn(anki, '_showVideoExamplesForEntry').mockImplementation(async () => {});
        /** @type {HTMLButtonElement} */ (panel.root.querySelector('.ve-gw-core-fallback')).click();
        expect(show).toHaveBeenLastCalledWith(entry, 'the ice', 'phrase', -1, 'core', search);
    });

    test('↻ keeps the search', async () => {
        const {anki} = makeDisplayAnki();
        const search = /** @type {const} */ ({target: {text: 'the ice', mode: 'quote'}, initialRank: 'known'});
        const {entry} = makePhraseEntry('break the ice');
        await anki._showVideoExamplesForEntry(entry, 'the ice', 'phrase', -1, void 0, search);
        const panel = gatewayPanelOf(anki, entry);
        await panel.whenIdle();
        const show = vi.spyOn(anki, '_showVideoExamplesForEntry').mockImplementation(async () => {});
        /** @type {HTMLButtonElement} */ (panel.root.querySelector('.entry-video-examples-icon-refresh')).click();
        expect(show).toHaveBeenLastCalledWith(entry, 'the ice', 'phrase', -1, void 0, search);
    });

    test('the same search on a live panel → refocus, no remount', async () => {
        const {anki, loader} = makeDisplayAnki();
        const search = /** @type {const} */ ({target: {text: 'the ice', mode: 'quote'}, initialRank: 'known'});
        // Not terminal: keep the section loading.
        loader.loadBatch.mockImplementation(() => new Promise(() => {}));
        const {entry} = makePhraseEntry('break the ice');
        await anki._showVideoExamplesForEntry(entry, 'the ice', 'phrase', -1, void 0, search);
        const first = panelOf(anki, entry);
        const scroll = vi.fn();
        first.root.scrollIntoView = scroll;
        await anki._showVideoExamplesForEntry(entry, 'the ice', 'phrase', -1, void 0, {...search});
        expect(panelOf(anki, entry)).toBe(first);
        expect(scroll).toHaveBeenCalled();
    });

    test('another rank or target on a live phrase panel → destroy and remount', async () => {
        const {anki, loader} = makeDisplayAnki();
        // Keep the panels non-terminal so only the search decides.
        loader.loadBatch.mockImplementation(() => new Promise(() => {}));
        const {entry} = makePhraseEntry('break the ice');
        await anki._showVideoExamplesForEntry(entry, 'the ice', 'phrase', -1, void 0, {target: {text: 'the ice', mode: 'quote'}, initialRank: 'plain'});
        const first = panelOf(anki, entry);
        await anki._showVideoExamplesForEntry(entry, 'the ice', 'phrase', -1, void 0, {target: {text: 'the ice', mode: 'quote'}, initialRank: 'known'});
        const second = panelOf(anki, entry);
        expect(second).not.toBe(first);
        expect(first.root.isConnected).toBe(false);
        expect(second.root.dataset.examplesRank).toBe('known');
        await anki._showVideoExamplesForEntry(entry, 'break', 'phrase', -1, void 0, {target: {text: 'break', mode: 'quote'}, initialRank: 'known'});
        const third = panelOf(anki, entry);
        expect(third).not.toBe(second);
        expect(third.root.querySelector('.entry-video-examples-word-text')?.textContent).toBe('break');
        expect(entry.querySelectorAll('.entry-video-examples').length).toBe(1);
    });

    test('two quick presses with different ranks → the later press wins the slot', async () => {
        const {anki, loader} = makeDisplayAnki();
        loader.loadBatch.mockImplementation(() => new Promise(() => {}));
        const {entry} = makePhraseEntry('break the ice');
        const first = anki._showVideoExamplesForEntry(entry, 'the ice', 'phrase', -1, void 0, {target: {text: 'the ice', mode: 'quote'}, initialRank: 'plain'});
        const second = anki._showVideoExamplesForEntry(entry, 'the ice', 'phrase', -1, void 0, {target: {text: 'the ice', mode: 'quote'}, initialRank: 'known'});
        await Promise.all([first, second]);
        expect(panelOf(anki, entry).root.dataset.examplesRank).toBe('known');
        expect(entry.querySelectorAll('.entry-video-examples').length).toBe(1);
    });

    test('known on a Core source → the ordinary Core panel with the target and the key note', async () => {
        const {anki, loader, orchestrator} = makeDisplayAnki({source: 'core'});
        const {entry} = makePhraseEntry('break the ice');
        await anki._showVideoExamplesForEntry(entry, 'the ice', 'phrase', -1, void 0, {target: {text: 'the ice', mode: 'quote'}, initialRank: 'known'});
        const panel = panelOf(anki, entry);
        expect(orchestrator.requestExamples).toHaveBeenCalledWith(entry, 'the ice', expect.anything());
        expect(loader.loadBatch).not.toHaveBeenCalled();
        expect(panel.root.querySelector('.entry-video-examples-known-note')?.textContent).toBe(translate('examples.knownNeedsKey'));
    });

    test('plain on a Core source → no key note', async () => {
        const {anki} = makeDisplayAnki({source: 'core'});
        const {entry} = makePhraseEntry('break the ice');
        await anki._showVideoExamplesForEntry(entry, 'the ice', 'phrase', -1, void 0, {target: {text: 'the ice', mode: 'quote'}, initialRank: 'plain'});
        const panel = panelOf(anki, entry);
        expect(panel.root.querySelector('.entry-video-examples-known-note')).toBeNull();
    });

    test('known with no source → the unavailable panel with the key note; ↻ keeps the search', async () => {
        const {anki} = makeDisplayAnki({source: 'unavailable'});
        const search = /** @type {const} */ ({target: {text: 'the ice', mode: 'quote'}, initialRank: 'known'});
        const {entry} = makePhraseEntry('break the ice');
        await anki._showVideoExamplesForEntry(entry, 'the ice', 'phrase', -1, void 0, search);
        const panel = panelOf(anki, entry);
        expect(panel.root.querySelector('.entry-video-examples-known-note')?.textContent).toBe(translate('examples.knownNeedsKey'));
        const show = vi.spyOn(anki, '_showVideoExamplesForEntry').mockImplementation(async () => {});
        /** @type {HTMLButtonElement} */ (panel.root.querySelector('.entry-video-examples-icon-refresh')).click();
        expect(show).toHaveBeenLastCalledWith(entry, 'the ice', 'phrase', -1, void 0, search);
    });
});

/* eslint-enable no-underscore-dangle */
