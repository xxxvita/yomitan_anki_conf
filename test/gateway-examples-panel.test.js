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
import {ExtensionError} from '../ext/js/core/extension-error.js';
import {log} from '../ext/js/core/log.js';
import {GatewayClipWaitError, prepareFlibMediaField} from '../ext/js/display/gateway-anki-media.js';
import {FLIB_BUY_URL} from '../ext/js/data/flib-host.js';
import {GatewayExamplesLoader} from '../ext/js/display/gateway-examples-loader.js';
import {GatewayExamplesPanel} from '../ext/js/display/gateway-examples-panel.js';
import {setUiLanguage} from '../ext/js/i18n/ui-language.js';
import {setupDomTest} from './fixtures/dom-test.js';
import {installMediaTrackStubs} from './fixtures/media-track-stubs.js';

const {window, teardown} = await setupDomTest();
afterAll(() => teardown(global));
// jsdom has no media pipeline; keep its "Not implemented" noise out of the log.
window.HTMLMediaElement.prototype.pause = () => {};
window.HTMLMediaElement.prototype.load = () => {};

const REF = 'dQw4w9WgXcQ';

/**
 * @param {string} code
 * @returns {ExtensionError}
 */
function flibError(code) {
    const error = new ExtensionError(code);
    error.data = {code, status: null};
    return error;
}

/**
 * @param {string} code
 * @param {Record<string, unknown>} [data]
 * @returns {ExtensionError}
 */
function httpError(code, data = {}) {
    const error = new ExtensionError(code);
    error.data = {code, status: null, ...data};
    return error;
}

/** @type {import('flib-gateway-examples').FilmClip[]} */
const FILM_CLIPS = [
    {clipId: 'c1', orderIndex: 0, status: 'queued', error: null, subs: [{rel_start_ms: 0, rel_end_ms: 900, text: 'You run fast'}], trimDurationSec: 4, year: 1995, cefr: 'B1'},
    {clipId: 'c2', orderIndex: 1, status: 'failed', error: 'x', subs: [], trimDurationSec: 3, year: null, cefr: null},
];

/** @type {import('flib-gateway').ClipInfo} */
const READY_INFO = {clip_id: 'c1', status: 'ready', duration_sec: 10, lead_trim_sec: 1, size_bytes: 3, download_url: null};

const REF2 = 'aaaaaaaaaa1';
const REF3 = 'bbbbbbbbbb2';

/** @type {import('flib-gateway').ExamplesBatchItem[]} */
const KNOWN_ITEMS = [
    {source: 'youtube', ref: REF2, start_ms: 1000, end_ms: 2000, text_en: 'You run the show', text_ru: null, thumbnail_url: null, title: 'Show', channel: 'Ch', fragment: null, known_share: 0.912},
    {source: 'youtube', ref: REF3, start_ms: 3000, end_ms: 4000, text_en: 'They run away', text_ru: null, thumbnail_url: null, title: null, channel: null, fragment: null, known_share: 0.5},
];

const REF4 = 'cccccccccc3';
const REF5 = 'dddddddddd4';
const REF6 = 'eeeeeeeeee5';
const REF7 = 'gggggggggg7';
const REF8 = 'ffffffffff6';

/** @type {import('flib-gateway').UnderstandableItem[]} */
const UND_ITEMS = [
    {video_id: REF4, title: 'Running <b>fast</b>', channel_id: 'ch', duration_s: 125, coverage: 0.934, target_hits: [{from_ms: 42000, to_ms: 45000, text_en: 'You run so fast'}], target_hits_unavailable: false},
    {video_id: REF5, title: null, channel_id: null, duration_s: null, coverage: null, target_hits: [], target_hits_unavailable: true},
];

/**
 * @param {import('flib-gateway').UnderstandableItem[]} items
 * @returns {import('flib-gateway-examples').UnderstandableRunResult}
 */
function undDone(items) {
    return {status: 'done', items, emptyReason: null, partial: false, errorCode: null};
}

/** @typedef {'loadYouTube'|'loadFilms'|'loadClipMedia'|'loadBatch'|'runUnderstandable'} LoaderMethod */

/**
 * @param {Partial<Record<LoaderMethod, import('vitest').Mock>>} overrides
 * @returns {Record<LoaderMethod, import('vitest').Mock>}
 */
function makeLoader(overrides = {}) {
    return {
        loadYouTube: vi.fn(async () => ({
            items: [
                {source: 'youtube', ref: REF, start_ms: 61500, end_ms: 64200, text_en: 'I like to run every day', text_ru: null, thumbnail_url: null},
            ],
            emptyReason: null,
        })),
        loadFilms: vi.fn(async (_word, {onPhase} = {}) => {
            onPhase?.('searching');
            onPhase?.('cutting');
            return {clips: FILM_CLIPS, emptyReason: null};
        }),
        loadClipMedia: vi.fn(async () => ({info: READY_INFO, blob: new Blob(['abc'], {type: 'video/mp4'})})),
        loadBatch: vi.fn(async () => ({items: KNOWN_ITEMS, emptyReason: null, knownSource: 'route', partial: false})),
        runUnderstandable: vi.fn(async () => undDone(UND_ITEMS)),
        ...overrides,
    };
}

/**
 * @param {ReturnType<typeof makeLoader>} loader
 * @param {{coreFallback?: boolean, canFallbackToCore?: boolean, word?: string, highlightForms?: string[], search?: import('../ext/js/display/gateway-examples-panel.js').GatewayPanelSearch}} [options]
 * @returns {{panel: GatewayExamplesPanel, hooks: {onCancel: import('vitest').Mock, onRetry: import('vitest').Mock, onYouTubeOpen: import('vitest').Mock, onCoreFallback?: import('vitest').Mock}}}
 */
function makePanel(loader, {coreFallback = false, canFallbackToCore = true, word = 'run', highlightForms, search} = {}) {
    const entry = window.document.createElement('div');
    window.document.body.appendChild(entry);
    /** @type {{onCancel: import('vitest').Mock, onRetry: import('vitest').Mock, onYouTubeOpen: import('vitest').Mock, onCoreFallback?: import('vitest').Mock}} */
    const hooks = {onCancel: vi.fn(), onRetry: vi.fn(), onYouTubeOpen: vi.fn()};
    if (coreFallback) { hooks.onCoreFallback = vi.fn(); }
    const panel = new GatewayExamplesPanel(entry, word, hooks, {
        loader: /** @type {import('../ext/js/display/gateway-examples-loader.js').GatewayExamplesLoader} */ (/** @type {unknown} */ (loader)),
        highlightForms,
        canFallbackToCore: () => canFallbackToCore,
        search,
    });
    return {panel, hooks};
}

/**
 * @param {GatewayExamplesPanel} panel
 * @param {'youtube'|'films'} name
 * @returns {HTMLElement}
 */
function section(panel, name) {
    return /** @type {HTMLElement} */ (panel.root.querySelector(`[data-section="${name}"]`));
}

/** @type {?import('vitest').MockInstance} */
let logSpy = null;
let blobCounter = 0;
const createObjectURL = vi.fn(() => `blob:test/${++blobCounter}`);
const revokeObjectURL = vi.fn();
beforeEach(() => {
    // Expected gateway failures are logged by the panel; keep them out of the test output.
    logSpy = vi.spyOn(log, 'log').mockImplementation(() => {});
    blobCounter = 0;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
});
afterEach(() => {
    logSpy?.mockRestore();
    window.document.body.replaceChildren();
});

describe('GatewayExamplesPanel sections', () => {
    test('YouTube 503 shows its own message and does not hide films', async () => {
        const loader = makeLoader({loadYouTube: vi.fn(async () => { throw flibError('flib_service_unavailable'); })});
        const {panel} = makePanel(loader);
        await panel.start();
        expect(section(panel, 'youtube').textContent).toContain('Сервис примеров YouTube временно недоступен');
        expect(section(panel, 'films').querySelectorAll('.ve-gw-film-card').length).toBe(2);
        expect(panel.isTerminal()).toBe(false);
        panel.destroy();
    });

    test('film job timeout does not hide YouTube', async () => {
        const loader = makeLoader({loadFilms: vi.fn(async () => { throw flibError('flib_job_timeout'); })});
        const {panel} = makePanel(loader);
        await panel.start();
        expect(section(panel, 'youtube').querySelectorAll('.ve-gw-yt-card').length).toBe(1);
        expect(section(panel, 'films').textContent).toContain('не успел');
        panel.destroy();
    });

    test('empty_reason per section', async () => {
        const loader = makeLoader({
            loadYouTube: vi.fn(async () => ({items: [], emptyReason: 'not_in_corpus'})),
            loadFilms: vi.fn(async () => ({clips: [], emptyReason: 'no_usable_examples'})),
        });
        const {panel} = makePanel(loader);
        await panel.start();
        expect(section(panel, 'youtube').textContent).toContain('YouTube');
        expect(section(panel, 'youtube').querySelector('.ve-gw-section-message')?.textContent).toMatch(/корпус/);
        expect(section(panel, 'films').querySelector('.ve-gw-section-message')?.textContent).toMatch(/[а-я]/);
        expect(panel.isTerminal()).toBe(true);
        panel.destroy();
    });

    test('both sections failing makes the panel terminal (Ex retries)', async () => {
        const loader = makeLoader({
            loadYouTube: vi.fn(async () => { throw flibError('flib_key_invalid'); }),
            loadFilms: vi.fn(async () => { throw flibError('flib_key_invalid'); }),
        });
        const {panel} = makePanel(loader);
        await panel.start();
        expect(panel.isTerminal()).toBe(true);
    });
});

describe('YouTube tools row', () => {
    test('hidden while loading; then «С учётом моих знаний» and an active «Понятные»; below: both notes, the «Понятные» list, the ordinary list', async () => {
        let resolve = /** @type {(v: unknown) => void} */ (() => {});
        const loader = makeLoader({loadYouTube: vi.fn(() => new Promise((r) => { resolve = r; }))});
        const {panel} = makePanel(loader);
        const started = panel.start();
        const yt = section(panel, 'youtube');
        const tools = /** @type {HTMLElement} */ (yt.querySelector(':scope>.ve-gw-section-tools'));
        expect(tools).not.toBeNull();
        expect(tools.hidden).toBe(true);
        expect(section(panel, 'films').querySelector('.ve-gw-understandable')).toBeNull();
        resolve({items: [{source: 'youtube', ref: REF, start_ms: 61500, end_ms: 64200, text_en: 'I like to run every day', text_ru: null, thumbnail_url: null}], emptyReason: null});
        await started;
        expect(tools.hidden).toBe(false);
        expect(tools.classList.contains('scan-disable')).toBe(true);
        const order = [yt.querySelector('.ve-gw-known-note'), yt.querySelector('.ve-gw-und-note'), yt.querySelector('div.ve-gw-und-list'), yt.querySelector('.ve-gw-yt-list')];
        let sibling = tools.nextElementSibling;
        for (const element of order) {
            expect(element).not.toBeNull();
            expect(sibling).toBe(element);
            sibling = /** @type {HTMLElement} */ (sibling).nextElementSibling;
        }
        const button = /** @type {HTMLButtonElement} */ (tools.querySelector('button.fc-btn.ve-gw-understandable'));
        expect(button.closest('.ve-gw-section-title')).toBeNull();
        expect(button.hasAttribute('aria-disabled')).toBe(false);
        expect(button.hasAttribute('aria-describedby')).toBe(false);
        expect(button.textContent).toBe('Понятные');
        expect(button.title).toBe('Ролики с этим словом, понятные вам целиком');
        expect(tools.querySelector('.ve-gw-understandable-hint')).toBeNull();
        expect(yt.querySelector('.ve-gw-und-note')?.getAttribute('role')).toBe('status');
        expect(loader.runUnderstandable).not.toHaveBeenCalled();
        panel.destroy();
    });

    test('empty and error YouTube states keep the row visible (only loading hides it)', async () => {
        for (const loadYouTube of [vi.fn(async () => ({items: [], emptyReason: 'not_in_corpus'})), vi.fn(async () => { throw flibError('flib_service_unavailable'); })]) {
            const {panel} = makePanel(makeLoader({loadYouTube}));
            await panel.start();
            expect(/** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('.ve-gw-section-tools')).hidden).toBe(false);
            panel.destroy();
        }
    });
});

describe('YouTube cards', () => {
    test('thumbnail, highlighted line, time range; click opens the player hook', async () => {
        const {panel, hooks} = makePanel(makeLoader());
        await panel.start();
        const card = /** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('.ve-gw-yt-card'));
        expect(card.querySelector('img')?.getAttribute('src')).toBe(`https://i.ytimg.com/vi/${REF}/mqdefault.jpg`);
        expect(card.querySelector('mark')?.textContent).toBe('run');
        expect(card.textContent).toContain('1:01–1:04');
        card.click();
        expect(hooks.onYouTubeOpen).toHaveBeenCalledTimes(1);
        expect(hooks.onYouTubeOpen.mock.calls[0][0].ref).toBe(REF);
        panel.destroy();
    });

    test('an invalid ref that slipped through is not rendered', async () => {
        const loader = makeLoader({
            loadYouTube: vi.fn(async () => ({
                items: [{source: 'youtube', ref: 'javascript:', start_ms: 0, end_ms: 1, text_en: 'run', text_ru: null, thumbnail_url: null}],
                emptyReason: null,
            })),
        });
        const {panel} = makePanel(loader);
        await panel.start();
        expect(section(panel, 'youtube').querySelectorAll('.ve-gw-yt-card').length).toBe(0);
        panel.destroy();
    });
});

describe('film cards', () => {
    test('no save note; nothing preselected; film checkboxes disabled until the clip is ready', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        expect(panel.root.querySelector('.ve-gw-note')).toBeNull();
        expect(panel.root.textContent).not.toContain('только для примеров через anki_conf');
        const filmBoxes = /** @type {HTMLInputElement[]} */ ([...panel.root.querySelectorAll('.ve-gw-film-card input[type="checkbox"]')]);
        expect(filmBoxes).toHaveLength(2);
        expect(filmBoxes.every((b) => b.disabled && !b.checked)).toBe(true);
        expect(panel.getSelectedClipIds()).toEqual([]);
        expect(panel.getSelectedGatewayMedia()).toStrictEqual({films: [], youtube: []});
        panel.destroy();
    });

    test('a failed clip shows a message and never loads', async () => {
        const loader = makeLoader();
        const {panel} = makePanel(loader);
        await panel.start();
        const failed = /** @type {HTMLElement} */ (panel.root.querySelector('.ve-gw-film-card[data-clip-id="c2"]'));
        expect(failed.dataset.state).toBe('failed');
        failed.querySelector('.ve-gw-film-media')?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
        await panel.whenIdle();
        expect(loader.loadClipMedia).not.toHaveBeenCalled();
        panel.destroy();
    });

    test('clips load lazily on click; missing source → no title, no IMDb, year/cefr meta', async () => {
        const loader = makeLoader();
        const {panel} = makePanel(loader);
        await panel.start();
        expect(loader.loadClipMedia).not.toHaveBeenCalled();
        const card = /** @type {HTMLElement} */ (panel.root.querySelector('.ve-gw-film-card[data-clip-id="c1"]'));
        card.querySelector('.ve-gw-film-media')?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
        await panel.whenIdle();
        expect(loader.loadClipMedia).toHaveBeenCalledTimes(1);
        const video = card.querySelector('video');
        expect(video?.getAttribute('src')).toBe('blob:test/1');
        expect(card.dataset.state).toBe('ready');
        expect(card.querySelector('.ve-gw-film-title')).toBeNull();
        expect(card.querySelector('a.ve-gw-imdb')).toBeNull();
        expect(card.textContent).toContain('1995');
        expect(card.textContent).toContain('B1');
        expect(card.querySelector('mark')?.textContent).toBe('run');
        panel.destroy();
    });

    test('source title and a valid IMDb link; a non-IMDb link is dropped', async () => {
        const loader = makeLoader({
            loadClipMedia: vi.fn(async (/** @type {import('flib-gateway-examples').FilmClip} */ clip) => ({
                info: {
                    ...READY_INFO,
                    clip_id: clip.clipId,
                    source: clip.clipId === 'c1' ?
                        {title: 'Heat', year: 1995, imdb_url: 'https://www.imdb.com/title/tt0113277/'} :
                        {title: 'Lost', year: 2004, season: 1, episode: 2, imdb_url: 'https://evil.example/title/tt1'},
                },
                blob: new Blob(['abc'], {type: 'video/mp4'}),
            })),
            loadFilms: vi.fn(async () => ({clips: [FILM_CLIPS[0], {...FILM_CLIPS[0], clipId: 'c3', orderIndex: 1}], emptyReason: null})),
        });
        const {panel} = makePanel(loader);
        await panel.start();
        for (const media of panel.root.querySelectorAll('.ve-gw-film-media')) {
            media.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
        }
        await panel.whenIdle();
        const c1 = /** @type {HTMLElement} */ (panel.root.querySelector('[data-clip-id="c1"]'));
        const c3 = /** @type {HTMLElement} */ (panel.root.querySelector('[data-clip-id="c3"]'));
        expect(c1.querySelector('.ve-gw-film-title')?.textContent).toBe('Heat (1995)');
        const link = /** @type {HTMLAnchorElement} */ (c1.querySelector('a.ve-gw-imdb'));
        expect(link.href).toBe('https://www.imdb.com/title/tt0113277/');
        expect(link.target).toBe('_blank');
        expect(link.rel).toBe('noopener noreferrer');
        expect(link.textContent).toBe('IMDb');
        expect(c3.querySelector('.ve-gw-film-title')?.textContent).toBe('Lost (2004), сезон 1, серия 2');
        expect(c3.querySelector('a.ve-gw-imdb')).toBeNull();
        panel.destroy();
    });

    test('a clip that fails to load shows the Russian error on its card', async () => {
        const loader = makeLoader({loadClipMedia: vi.fn(async () => { throw flibError('flib_clip_failed'); })});
        const {panel} = makePanel(loader);
        await panel.start();
        const card = /** @type {HTMLElement} */ (panel.root.querySelector('[data-clip-id="c1"]'));
        card.querySelector('.ve-gw-film-media')?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
        await panel.whenIdle();
        expect(card.dataset.state).toBe('failed');
        expect(card.textContent).toContain('Не удалось нарезать');
        panel.destroy();
    });

    test('destroy revokes every blob URL and media arriving later is not leaked', async () => {
        /** @type {(value: unknown) => void} */
        let release = () => {};
        const late = new Promise((resolve) => { release = resolve; });
        let n = 0;
        const loader = makeLoader({
            loadFilms: vi.fn(async () => ({clips: [FILM_CLIPS[0], {...FILM_CLIPS[0], clipId: 'c3', orderIndex: 1}], emptyReason: null})),
            loadClipMedia: vi.fn(async () => {
                ++n;
                if (n === 2) { await late; }
                return {info: READY_INFO, blob: new Blob(['abc'], {type: 'video/mp4'})};
            }),
        });
        const {panel} = makePanel(loader);
        await panel.start();
        const medias = [...panel.root.querySelectorAll('.ve-gw-film-media')];
        medias[0].dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
        await vi.waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2)); // video + VTT
        medias[1].dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
        await vi.waitFor(() => expect(loader.loadClipMedia).toHaveBeenCalledTimes(2));
        panel.destroy();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/2');
        expect(panel.root.isConnected).toBe(false);
        release(null);
        await panel.whenIdle();
        // Either never created, or created and immediately revoked.
        const created = createObjectURL.mock.results.map((r) => r.value);
        for (const url of created) { expect(revokeObjectURL).toHaveBeenCalledWith(url); }
    });
});

/**
 * @param {GatewayExamplesPanel} panel
 * @param {string} clipId
 * @returns {HTMLElement}
 */
function filmCard(panel, clipId) {
    return /** @type {HTMLElement} */ (panel.root.querySelector(`.ve-gw-film-card[data-clip-id="${clipId}"]`));
}

/**
 * @param {HTMLElement} card
 * @returns {HTMLInputElement}
 */
function checkboxOf(card) {
    return /** @type {HTMLInputElement} */ (card.querySelector('input[type="checkbox"]'));
}

/**
 * @param {HTMLInputElement} input
 */
function tick(input) {
    input.checked = !input.checked;
    input.dispatchEvent(new window.Event('change', {bubbles: true}));
}

/**
 * @param {HTMLElement} card
 * @param {{width?: number, height?: number, duration?: number}} [meta]
 */
function fireLoadedMetadata(card, meta) {
    fireVideoMetadata(/** @type {HTMLVideoElement} */ (card.querySelector('video')), meta);
}

/**
 * @param {HTMLVideoElement} video
 * @param {{width?: number, height?: number, duration?: number}} [meta]
 */
function fireVideoMetadata(video, {width = 1920, height = 1080, duration = 10} = {}) {
    Object.defineProperty(video, 'videoWidth', {configurable: true, value: width});
    Object.defineProperty(video, 'videoHeight', {configurable: true, value: height});
    Object.defineProperty(video, 'duration', {configurable: true, value: duration});
    video.dispatchEvent(new window.Event('loadedmetadata'));
}

/**
 * @param {GatewayExamplesPanel} panel
 * @param {string} clipId
 * @returns {Promise<HTMLElement>}
 */
async function loadFilmCard(panel, clipId) {
    const card = filmCard(panel, clipId);
    card.querySelector('.ve-gw-film-media')?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
    await panel.whenIdle();
    return card;
}

/**
 * @param {Promise<unknown>} promise
 * @returns {Promise<unknown>}
 */
async function rejectionOf(promise) {
    try {
        await promise;
    } catch (e) {
        return e;
    }
    throw new Error('expected a rejection');
}

describe('selection for Anki (T3)', () => {
    test('YouTube checkbox toggles the selection without opening the player', async () => {
        const {panel, hooks} = makePanel(makeLoader());
        await panel.start();
        const card = /** @type {HTMLElement} */ (panel.root.querySelector('.ve-gw-yt-card'));
        const box = checkboxOf(card);
        expect(box.checked).toBe(false);
        expect(box.disabled).toBe(false);
        // A click on the label toggles the box (label activation) but never reaches the card.
        box.closest('label')?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
        box.dispatchEvent(new window.KeyboardEvent('keydown', {key: ' ', bubbles: true}));
        expect(hooks.onYouTubeOpen).not.toHaveBeenCalled();
        expect(box.checked).toBe(true);
        expect(card.classList.contains('ve-gw-selected')).toBe(true);
        const selected = panel.getSelectedGatewayMedia();
        expect(selected.films).toStrictEqual([]);
        expect(selected.youtube).toHaveLength(1);
        expect(selected.youtube[0]).toMatchObject({ref: REF, startMs: 61500, endMs: 64200, text: 'I like to run every day'});
        expect(selected.youtube[0].words).toContain('run');
        // A copy: what a save changes or keeps is not the panel's own list, nor that of another save.
        selected.youtube[0].words.length = 0;
        expect(panel.getSelectedGatewayMedia().youtube[0].words).toContain('run');
        tick(box);
        expect(panel.getSelectedGatewayMedia().youtube).toStrictEqual([]);
        expect(card.classList.contains('ve-gw-selected')).toBe(false);
        panel.destroy();
    });

    test('YouTube selection: an example without end_ms carries endMs null', async () => {
        const {panel} = makePanel(makeLoader({
            loadYouTube: vi.fn(async () => ({
                items: [{source: 'youtube', ref: REF, start_ms: 61500, end_ms: null, text_en: 'run', text_ru: null, thumbnail_url: null}],
                emptyReason: null,
            })),
        }));
        await panel.start();
        tick(checkboxOf(/** @type {HTMLElement} */ (panel.root.querySelector('.ve-gw-yt-card'))));
        const {youtube} = panel.getSelectedGatewayMedia();
        expect(youtube).toHaveLength(1);
        expect(youtube[0].endMs).toBeNull();
        panel.destroy();
    });

    /** @type {boolean[]} Calls of load() on the last probe: whether it still had a source. */
    let loads = [];

    /**
     * The `<video>` elements a capture makes to read the metadata on its own (apart from the panel's players).
     * @param {() => void} action
     * @returns {HTMLVideoElement[]}
     */
    function probesOf(action) {
        const create = vi.spyOn(window.document, 'createElement');
        try {
            action();
            return /** @type {HTMLVideoElement[]} */ (create.mock.results.map(({value}) => /** @type {unknown} */ (value)).filter((value) => value instanceof window.HTMLVideoElement));
        } finally {
            create.mockRestore();
        }
    }

    /**
     * @param {GatewayExamplesPanel} panel
     * @param {AbortSignal} [signal]
     * @returns {{probe: HTMLVideoElement, url: string, media: Promise<import('gateway-anki-media').GatewayFilmMedia>}}
     */
    function captureWithoutMetadata(panel, signal) {
        /** @type {import('gateway-anki-media').GatewaySelectedFilm[]} */
        let films = [];
        const probes = probesOf(() => { ({films} = panel.getSelectedGatewayMedia({signal})); });
        expect(films).toHaveLength(1);
        expect(films[0].media).toBeInstanceOf(Promise);
        expect(probes).toHaveLength(1);
        const [probe] = probes;
        loads = [];
        probe.load = () => { loads.push(probe.hasAttribute('src')); };
        return {probe, url: probe.getAttribute('src') ?? '', media: /** @type {Promise<import('gateway-anki-media').GatewayFilmMedia>} */ (films[0].media)};
    }

    /**
     * The probe holds nothing any more.
     * @param {HTMLVideoElement} probe
     * @param {string} url
     */
    function expectReleased(probe, url) {
        // load() after the source is gone: without it the player keeps the file.
        expect(probe.hasAttribute('src')).toBe(false);
        expect(loads).toStrictEqual([false]);
        expect(revokeObjectURL).toHaveBeenCalledWith(url);
    }

    /** @returns {Promise<{panel: GatewayExamplesPanel, card: HTMLElement}>} A panel with the ready film c1 ticked. */
    async function tickedFilm() {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        const card = await loadFilmCard(panel, 'c1');
        tick(checkboxOf(card));
        return {panel, card};
    }

    test('a ready film can be ticked; its capture is the value itself, with window-relative VTT', async () => {
        const loader = makeLoader({
            loadClipMedia: vi.fn(async () => ({
                info: {...READY_INFO, source: {title: 'Heat', year: 1995, imdb_url: 'https://www.imdb.com/title/tt0113277/'}},
                blob: new Blob(['abc'], {type: 'video/mp4'}),
            })),
        });
        const {panel} = makePanel(loader);
        await panel.start();
        const card = await loadFilmCard(panel, 'c1');
        const box = checkboxOf(card);
        expect(box.disabled).toBe(false);
        fireLoadedMetadata(card, {width: 1280, height: 534, duration: 9.5});
        tick(box);
        /** @type {import('gateway-anki-media').GatewaySelectedFilm[]} */
        let films = [];
        expect(probesOf(() => { ({films} = panel.getSelectedGatewayMedia()); })).toStrictEqual([]);
        expect(films.map(({clipId}) => clipId)).toStrictEqual(['c1']);
        const media = /** @type {import('gateway-anki-media').GatewayFilmMedia} */ (films[0].media);
        expect(media).not.toBeInstanceOf(Promise);
        expect(media.clipId).toBe('c1');
        expect(media.blob).toBeInstanceOf(Blob);
        expect(media.leadTrimSec).toBe(1);
        expect(media.trimDurationSec).toBe(4);
        expect(media.videoWidth).toBe(1280);
        expect(media.videoHeight).toBe(534);
        expect(media.durationSec).toBe(9.5);
        expect(media.title).toBe('Heat');
        expect(media.year).toBe(1995);
        expect(media.imdbUrl).toBe('https://www.imdb.com/title/tt0113277/');
        // rel_ms are relative to the window: no lead_trim offset in the saved track.
        expect(media.vttText).toContain('00:00:00.000 --> 00:00:00.900');
        expect(media.vttText).toContain('<c.hl>run</c>');
        // Destroying the panel drops its own references only: the capture keeps the Blob.
        const {blob} = media;
        panel.destroy();
        expect(media.blob).toBe(blob);
    });

    test('series: the title carries season/episode, the year comes from the source', async () => {
        const loader = makeLoader({
            loadClipMedia: vi.fn(async () => ({
                info: {...READY_INFO, source: {title_ru: 'Остаться в живых', year: 2004, season: 1, episode: 2}},
                blob: new Blob(['abc'], {type: 'video/mp4'}),
            })),
        });
        const {panel} = makePanel(loader);
        await panel.start();
        const card = await loadFilmCard(panel, 'c1');
        fireLoadedMetadata(card);
        tick(checkboxOf(card));
        const media = /** @type {import('gateway-anki-media').GatewayFilmMedia} */ (panel.getSelectedGatewayMedia().films[0].media);
        expect(media.title).toBe('Остаться в живых, сезон 1, серия 2');
        expect(media.year).toBe(2004);
        expect(media.imdbUrl).toBeNull();
        panel.destroy();
    });

    test.each(['user', 'content', null])('only the metadata is missing: the wait survives destroy (%s)', async (reason) => {
        const {panel} = await tickedFilm();
        const {probe, url, media} = captureWithoutMetadata(panel, new AbortController().signal);
        expect(probe.preload).toBe('metadata');
        expect(probe.muted).toBe(true);
        expect(url).toMatch(/^blob:/);
        if (reason !== null) { panel.destroy(/** @type {'user'|'content'} */ (reason)); }
        // The panel's own URL is revoked, the probe's is not.
        expect(revokeObjectURL).not.toHaveBeenCalledWith(url);
        fireVideoMetadata(probe, {width: 640, height: 360, duration: 7});
        expect(await media).toMatchObject({clipId: 'c1', videoWidth: 640, videoHeight: 360, durationSec: 7, leadTrimSec: 1, trimDurationSec: 4});
        expect((await media).blob).toBeInstanceOf(Blob);
        expectReleased(probe, url);
        panel.destroy();
    });

    test('the field is built from the capture alone, after the panel is gone', async () => {
        const {panel} = await tickedFilm();
        const {signal} = new AbortController();
        /** @type {import('gateway-anki-media').GatewaySelectedMedia} */
        let selection = {films: [], youtube: []};
        const [probe] = probesOf(() => { selection = panel.getSelectedGatewayMedia({signal}); });
        panel.destroy();
        const transcode = vi.fn(async () => new Uint8Array([1, 2, 3]));
        const field = prepareFlibMediaField({
            selection,
            modelName: 'Yomitan Card Type',
            api: {flibAnkiModelHasField: async () => true, flibStoreAnkiMedia: async (fileName) => ({fileName})},
            signal,
            isFirefox: false,
            deps: {probeEncoderSupport: async () => ({vp9Supported: true, vp8Supported: true, opusSupported: true}), transcodeClipToWebm: transcode},
        });
        fireVideoMetadata(probe, {width: 640, height: 360, duration: 7});
        expect(await field).toContain('<video controls');
        expect(/** @type {unknown[]} */ (transcode.mock.calls[0])[0]).toBeInstanceOf(Blob);
    });

    test('edge 1: metadata never arrives → timeout after 20 s, panel destroyed or not', async () => {
        for (const destroyed of [false, true]) {
            vi.useFakeTimers();
            try {
                revokeObjectURL.mockClear();
                const {panel} = await tickedFilm();
                const {probe, url, media} = captureWithoutMetadata(panel);
                const rejected = rejectionOf(media);
                if (destroyed) { panel.destroy(); }
                /** @type {unknown} */
                let error = null;
                void rejected.then((e) => { error = e; });
                await vi.advanceTimersByTimeAsync(19_900);
                expect(error).toBeNull();
                await vi.advanceTimersByTimeAsync(200);
                expect(error).toBeInstanceOf(GatewayClipWaitError);
                expect(/** @type {GatewayClipWaitError} */ (/** @type {unknown} */ (error)).code).toBe('timeout');
                expectReleased(probe, url);
                expect(vi.getTimerCount()).toBe(0);
                panel.destroy();
            } finally {
                vi.useRealTimers();
            }
        }
    });

    test('the metadata arrives → no timer and no listener on the save\'s signal is left', async () => {
        vi.useFakeTimers();
        try {
            const {panel} = await tickedFilm();
            const {signal} = new AbortController();
            const add = vi.spyOn(signal, 'addEventListener');
            const remove = vi.spyOn(signal, 'removeEventListener');
            const timersBefore = vi.getTimerCount();
            const {probe, media} = captureWithoutMetadata(panel, signal);
            expect(vi.getTimerCount()).toBe(timersBefore + 1);
            fireVideoMetadata(probe);
            await media;
            expect(vi.getTimerCount()).toBe(timersBefore);
            expect(add.mock.calls.map(([type]) => type)).toStrictEqual(['abort']);
            expect(remove.mock.calls.map(([type, listener]) => [type, listener])).toStrictEqual(add.mock.calls.map(([type, listener]) => [type, listener]));
            panel.destroy();
        } finally {
            vi.useRealTimers();
        }
    });

    test('a ticked clip whose file is gone → the capture fails at once, with no probe', async () => {
        const {panel, card} = await tickedFilm();
        fireLoadedMetadata(card);
        // eslint-disable-next-line no-underscore-dangle
        panel._filmCards[0].blob = null;
        /** @type {import('gateway-anki-media').GatewaySelectedFilm[]} */
        let films = [];
        expect(probesOf(() => { ({films} = panel.getSelectedGatewayMedia()); })).toStrictEqual([]);
        expect(/** @type {GatewayClipWaitError} */ (await rejectionOf(Promise.resolve(films[0].media))).code).toBe('missing');
        panel.destroy();
    });

    test('hasSelection: a film or a YouTube example is ticked; nothing after destroy', async () => {
        const {panel, card} = await tickedFilm();
        expect(panel.hasSelection).toBe(true);
        tick(checkboxOf(card));
        expect(panel.hasSelection).toBe(false);
        tick(checkboxOf(/** @type {HTMLElement} */ (panel.root.querySelector('.ve-gw-yt-card'))));
        expect(panel.hasSelection).toBe(true);
        panel.destroy();
        expect(panel.hasSelection).toBe(false);
    });

    test('a file whose metadata cannot be read fails the wait', async () => {
        const {panel} = await tickedFilm();
        const {probe, url, media} = captureWithoutMetadata(panel);
        probe.dispatchEvent(new window.Event('error'));
        expect(/** @type {GatewayClipWaitError} */ (await rejectionOf(media)).code).toBe('failed');
        expectReleased(probe, url);
        panel.destroy();
    });

    test('a player that already failed to read the file → the capture fails at once, with no probe', async () => {
        const {panel, card} = await tickedFilm();
        card.querySelector('video')?.dispatchEvent(new window.Event('error'));
        /** @type {import('gateway-anki-media').GatewaySelectedFilm[]} */
        let films = [];
        expect(probesOf(() => { ({films} = panel.getSelectedGatewayMedia()); })).toStrictEqual([]);
        expect(/** @type {GatewayClipWaitError} */ (await rejectionOf(Promise.resolve(films[0].media))).code).toBe('failed');
        panel.destroy();
    });

    test('the save\'s abort signal ends the wait; an aborted signal starts none', async () => {
        const {panel} = await tickedFilm();
        const controller = new AbortController();
        const {probe, url, media} = captureWithoutMetadata(panel, controller.signal);
        controller.abort();
        expect(/** @type {GatewayClipWaitError} */ (await rejectionOf(media)).code).toBe('aborted');
        expectReleased(probe, url);
        /** @type {import('gateway-anki-media').GatewaySelectedFilm[]} */
        let films = [];
        expect(probesOf(() => { ({films} = panel.getSelectedGatewayMedia({signal: controller.signal})); })).toStrictEqual([]);
        expect(/** @type {GatewayClipWaitError} */ (await rejectionOf(Promise.resolve(films[0].media))).code).toBe('aborted');
        panel.destroy();
    });

    test('a wait nobody collects is not an unhandled rejection', async () => {
        const {panel} = await tickedFilm();
        const unhandled = vi.fn();
        process.on('unhandledRejection', unhandled);
        try {
            const {probe} = captureWithoutMetadata(panel);
            probe.dispatchEvent(new window.Event('error'));
            await new Promise((resolve) => { setTimeout(resolve, 10); });
            expect(unhandled).not.toHaveBeenCalled();
        } finally {
            process.off('unhandledRejection', unhandled);
        }
        panel.destroy();
    });

    test('a failed clip cannot be ticked', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        expect(checkboxOf(filmCard(panel, 'c2')).disabled).toBe(true);
        panel.destroy();
    });

    test('the reason of destroy is remembered', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        panel.destroy('user');
        expect(panel.destroyReason).toBe('user');
        panel.destroy('content');
        expect(panel.destroyReason).toBe('user');
    });

    test('M16: destroy drops the kept MP4 Blob and ClipInfo of every card', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        await loadFilmCard(panel, 'c1');
        // eslint-disable-next-line no-underscore-dangle
        const card = panel._filmCards[0];
        expect(card.blob).toBeInstanceOf(Blob);
        expect(card.info).not.toBeNull();
        panel.destroy();
        expect(card.blob).toBeNull();
        expect(card.info).toBeNull();
    });

    test('M18: a ticked card leaving «ready» drops its selection and unticks', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        const el = await loadFilmCard(panel, 'c1');
        const box = checkboxOf(el);
        tick(box);
        fireLoadedMetadata(el);
        expect(panel.getSelectedGatewayMedia().films.map(({clipId}) => clipId)).toStrictEqual(['c1']);
        // eslint-disable-next-line no-underscore-dangle
        panel._setCardState(panel._filmCards[0], 'failed', 'x');
        expect(panel.getSelectedGatewayMedia().films).toStrictEqual([]);
        expect(box.checked).toBe(false);
        expect(box.disabled).toBe(true);
        expect(el.classList.contains('ve-gw-selected')).toBe(false);
        panel.destroy();
    });

    test('destroy: selection cleared, blobs released', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        const card = await loadFilmCard(panel, 'c1');
        tick(checkboxOf(card));
        tick(checkboxOf(/** @type {HTMLElement} */ (panel.root.querySelector('.ve-gw-yt-card'))));
        expect(panel.destroyReason).toBeNull();
        panel.destroy();
        expect(panel.destroyReason).toBe('content');
        // Nothing can be captured from a destroyed panel, even after a late metadata event.
        fireLoadedMetadata(card);
        expect(panel.getSelectedGatewayMedia()).toStrictEqual({films: [], youtube: []});
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
    });
});

describe('«Показать через Flibooster» fallback (review M5)', () => {
    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {HTMLButtonElement[]}
     */
    const fallbackButtons = (panel) => /** @type {HTMLButtonElement[]} */ ([...panel.root.querySelectorAll('.ve-gw-core-fallback')]);

    test.each(['flib_key_invalid', 'flib_key_missing', 'flib_forbidden', 'examples_forbidden', 'examples_quota_exhausted', 'demo_limit', 'flib_service_unavailable', 'flib_rate_limited', 'flib_network', 'flib_timeout'])('%s with Core available → one button that mounts the Core panel', async (code) => {
        const loader = makeLoader({
            loadYouTube: vi.fn(async () => { throw flibError(code); }),
            loadFilms: vi.fn(async () => { throw flibError(code); }),
        });
        const {panel, hooks} = makePanel(loader, {coreFallback: true});
        await panel.start();
        const buttons = fallbackButtons(panel);
        expect(buttons).toHaveLength(1);
        expect(buttons[0].textContent).toBe('Показать через Flibooster');
        buttons[0].click();
        expect(hooks.onCoreFallback).toHaveBeenCalledTimes(1);
        panel.destroy();
    });

    test('no Core (route without coreBase) → no button', async () => {
        const loader = makeLoader({loadYouTube: vi.fn(async () => { throw flibError('flib_key_invalid'); })});
        const {panel} = makePanel(loader, {coreFallback: true, canFallbackToCore: false});
        await panel.start();
        expect(fallbackButtons(panel)).toHaveLength(0);
        panel.destroy();
    });

    test('errors Core cannot help with (bad input, clip errors) → no button', async () => {
        const loader = makeLoader({
            loadYouTube: vi.fn(async () => { throw flibError('flib_word_too_long'); }),
            loadFilms: vi.fn(async () => ({clips: [], emptyReason: 'not_in_corpus'})),
        });
        const {panel} = makePanel(loader, {coreFallback: true});
        await panel.start();
        expect(fallbackButtons(panel)).toHaveLength(0);
        panel.destroy();
    });

    test('no hook → no button', async () => {
        const loader = makeLoader({loadYouTube: vi.fn(async () => { throw flibError('flib_key_invalid'); })});
        const {panel} = makePanel(loader);
        await panel.start();
        expect(fallbackButtons(panel)).toHaveLength(0);
        panel.destroy();
    });
});

describe('film tiles are keyboard-accessible and retryable (review L4)', () => {
    /**
     * @param {HTMLElement} target
     * @param {string} key
     */
    const press = (target, key) => { target.dispatchEvent(new window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true})); };

    test('an idle tile is a focusable button; Enter and Space load it; a ready tile is no longer a button', async () => {
        const loader = makeLoader({loadFilms: vi.fn(async () => ({clips: [FILM_CLIPS[0], {...FILM_CLIPS[0], clipId: 'c3', orderIndex: 1}], emptyReason: null}))});
        const {panel} = makePanel(loader);
        await panel.start();
        const medias = /** @type {HTMLElement[]} */ ([...panel.root.querySelectorAll('.ve-gw-film-media')]);
        for (const media of medias) {
            expect(media.getAttribute('role')).toBe('button');
            expect(media.tabIndex).toBe(0);
            expect(media.getAttribute('aria-label')).toBeTruthy();
        }
        press(medias[0], 'Enter');
        press(medias[1], ' ');
        await panel.whenIdle();
        expect(loader.loadClipMedia).toHaveBeenCalledTimes(2);
        expect(medias[0].hasAttribute('role')).toBe(false);
        expect(medias[0].hasAttribute('tabindex')).toBe(false);
        panel.destroy();
    });

    test('a tile whose load failed can be retried (click or Enter)', async () => {
        let attempt = 0;
        const loader = makeLoader({
            loadClipMedia: vi.fn(async () => {
                if (++attempt === 1) { throw flibError('flib_network'); }
                return {info: READY_INFO, blob: new Blob(['abc'], {type: 'video/mp4'})};
            }),
        });
        const {panel} = makePanel(loader);
        await panel.start();
        const card = /** @type {HTMLElement} */ (panel.root.querySelector('[data-clip-id="c1"]'));
        const media = /** @type {HTMLElement} */ (card.querySelector('.ve-gw-film-media'));
        media.click();
        await panel.whenIdle();
        expect(card.dataset.state).toBe('failed');
        expect(media.getAttribute('role')).toBe('button');
        expect(card.textContent).toContain('повторить');
        press(media, 'Enter');
        await panel.whenIdle();
        expect(loader.loadClipMedia).toHaveBeenCalledTimes(2);
        expect(card.dataset.state).toBe('ready');
        panel.destroy();
    });

    test('a clip the server marked failed is not a button and is not retried', async () => {
        const loader = makeLoader();
        const {panel} = makePanel(loader);
        await panel.start();
        const media = /** @type {HTMLElement} */ (panel.root.querySelector('[data-clip-id="c2"] .ve-gw-film-media'));
        expect(media.hasAttribute('role')).toBe(false);
        press(media, 'Enter');
        await panel.whenIdle();
        expect(loader.loadClipMedia).not.toHaveBeenCalled();
        panel.destroy();
    });

    test('section status messages are announced politely', async () => {
        const {panel} = makePanel(makeLoader());
        for (const name of /** @type {const} */ (['youtube', 'films'])) {
            expect(section(panel, name).querySelector('.ve-gw-section-message')?.getAttribute('aria-live')).toBe('polite');
        }
        await panel.start();
        panel.destroy();
    });
});

describe('films loading text (review L5)', () => {
    test('says it usually takes up to a minute, sometimes longer', () => {
        const loader = makeLoader({loadFilms: vi.fn(() => new Promise(() => {}))});
        const {panel} = makePanel(loader);
        void panel.start();
        const message = section(panel, 'films').querySelector('.ve-gw-section-message')?.textContent ?? '';
        expect(message).toBe('Ищем нарезки… (обычно до минуты, иногда дольше)');
        panel.destroy();
    });
});

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

/**
 * @param {HTMLElement} root
 * @returns {string[]}
 */
function marks(root) {
    return [...root.querySelectorAll('mark')].map((m) => m.textContent ?? '');
}

describe('native-fullscreen subtitles on film clips', () => {
    test('a mounted clip gets an English <track> with a blob VTT on the file timeline (lead_trim) and highlighted forms', async () => {
        /** @type {Blob[]} */
        const blobs = [];
        URL.createObjectURL = /** @type {typeof URL.createObjectURL} */ ((/** @type {Blob} */ blob) => {
            blobs.push(blob);
            return createObjectURL();
        });
        const {panel} = makePanel(makeLoader());
        await panel.start();
        const card = /** @type {HTMLElement} */ (panel.root.querySelector('.ve-gw-film-card[data-clip-id="c1"]'));
        card.querySelector('.ve-gw-film-media')?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
        await panel.whenIdle();
        const track = /** @type {HTMLTrackElement} */ (card.querySelector('video > track'));
        expect(track).not.toBeNull();
        expect(track.kind).toBe('subtitles');
        expect(track.srclang).toBe('en');
        expect(track.getAttribute('src')).toBe('blob:test/2');
        expect(blobs[1].type).toBe('text/vtt');
        // READY_INFO.lead_trim_sec = 1; sub rel 0–900 ms → 1.000–1.900 in the file.
        expect(await readBlobText(blobs[1])).toBe('WEBVTT\n\n00:00:01.000 --> 00:00:01.900\nYou <c.hl>run</c> fast\n\n');
        panel.destroy();
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/1');
        expect(revokeObjectURL).toHaveBeenCalledWith('blob:test/2');
    });

    test('destroy unhooks the track from fullscreenchange and textTracks change (review M2)', async () => {
        const stubs = installMediaTrackStubs(window);
        try {
            const {panel} = makePanel(makeLoader());
            await panel.start();
            const card = /** @type {HTMLElement} */ (panel.root.querySelector('.ve-gw-film-card[data-clip-id="c1"]'));
            card.querySelector('.ve-gw-film-media')?.dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
            await panel.whenIdle();
            const video = /** @type {HTMLVideoElement} */ (card.querySelector('video'));
            const track = /** @type {HTMLTrackElement} */ (video.querySelector('track'));
            const overlay = /** @type {HTMLElement} */ (card.querySelector('.ve-gw-film-cue'));
            stubs.setFullscreen(video);
            expect(track.track.mode).toBe('showing');
            expect(overlay.hidden).toBe(true);
            stubs.setFullscreen(null);
            expect(track.track.mode).toBe('hidden');
            expect(overlay.hidden).toBe(false);

            panel.destroy();
            stubs.setFullscreen(video);
            expect(track.track.mode).toBe('hidden');
            expect(overlay.hidden).toBe(false);
            track.track.mode = 'showing';
            video.textTracks.dispatchEvent(new window.Event('change'));
            expect(overlay.hidden).toBe(false);
        } finally {
            stubs.restore();
        }
    });
});

describe('inflected forms are highlighted', () => {
    test('owner recording: «fix on» lights up fixed/fixing/fixes on in YouTube lines', async () => {
        const lines = ['being fixed on the target', 'the fixing on the wall', 'camera fixes on her', "they're fixed on it", 'fix on one thing'];
        const loader = makeLoader({
            loadYouTube: vi.fn(async () => ({
                items: lines.map((text_en, i) => ({source: 'youtube', ref: REF, start_ms: i * 1000, end_ms: i * 1000 + 900, text_en, text_ru: null, thumbnail_url: null})),
                emptyReason: null,
            })),
        });
        const {panel} = makePanel(loader, {word: 'fix on'});
        await panel.start();
        expect(marks(section(panel, 'youtube'))).toEqual(['fixed on', 'fixing on', 'fixes on', 'fixed on', 'fix on']);
        panel.destroy();
    });

    test('headwords (highlightForms) are inflected; gateway lemma + matched_forms extend lines already shown', async () => {
        /** @type {(value: unknown) => void} */
        let releaseFilms = () => {};
        const filmsGate = new Promise((resolve) => { releaseFilms = resolve; });
        const loader = makeLoader({
            loadYouTube: vi.fn(async () => ({
                items: [{source: 'youtube', ref: REF, start_ms: 0, end_ms: 1, text_en: 'She went, I goes, we gonna, kids running', text_ru: null, thumbnail_url: null}],
                emptyReason: null,
            })),
            loadFilms: vi.fn(async () => {
                await filmsGate;
                return {clips: [], emptyReason: 'not_in_corpus', lemma: 'go', matchedForms: ['gonna']};
            }),
        });
        const {panel, hooks} = makePanel(loader, {word: 'went', highlightForms: ['run']});
        const started = panel.start();
        await vi.waitFor(() => expect(section(panel, 'youtube').dataset.state).toBe('ready'));
        expect(marks(section(panel, 'youtube'))).toEqual(['went', 'running']);
        releaseFilms(null);
        await started;
        expect(marks(section(panel, 'youtube'))).toEqual(['went', 'goes', 'gonna', 'running']);
        /** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('.ve-gw-yt-card')).click();
        expect(hooks.onYouTubeOpen.mock.calls[0][1]).toEqual(expect.arrayContaining(['went', 'goes', 'gonna', 'running']));
        panel.destroy();
    });
});

describe('clear the saved ticks after a successful save (UX follow-up)', () => {
    /** @returns {ReturnType<typeof makeLoader>} Two YouTube lines, one loadable film. */
    const twoLineLoader = () => makeLoader({
        loadYouTube: vi.fn(async () => ({
            items: [
                {source: 'youtube', ref: REF, start_ms: 1000, end_ms: 2000, text_en: 'we run', text_ru: null, thumbnail_url: null},
                {source: 'youtube', ref: REF, start_ms: 5000, end_ms: 6000, text_en: 'they run', text_ru: null, thumbnail_url: null},
            ],
            emptyReason: null,
        })),
    });

    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {HTMLElement[]}
     */
    const ytCards = (panel) => /** @type {HTMLElement[]} */ ([...panel.root.querySelectorAll('.ve-gw-yt-card')]);

    test('the snapshot items are unticked (state, checkbox, class); items ticked during the save stay ticked', async () => {
        const {panel} = makePanel(twoLineLoader());
        await panel.start();
        const film = await loadFilmCard(panel, 'c1');
        fireLoadedMetadata(film);
        const [yt0, yt1] = ytCards(panel);
        tick(checkboxOf(film));
        tick(checkboxOf(yt0));
        const snapshot = panel.getSelectedGatewayMedia();
        expect(snapshot.youtube.map((y) => y.key)).toStrictEqual(['0']);
        // Ticked while the save runs: not in the snapshot.
        tick(checkboxOf(yt1));
        panel.clearSelection(snapshot);
        expect(checkboxOf(film).checked).toBe(false);
        expect(film.classList.contains('ve-gw-selected')).toBe(false);
        expect(checkboxOf(yt0).checked).toBe(false);
        expect(yt0.classList.contains('ve-gw-selected')).toBe(false);
        expect(checkboxOf(yt1).checked).toBe(true);
        expect(yt1.classList.contains('ve-gw-selected')).toBe(true);
        const left = panel.getSelectedGatewayMedia();
        expect(left.films).toStrictEqual([]);
        expect(left.youtube.map((y) => y.key)).toStrictEqual(['1']);
        // The film checkbox stays usable for the next save.
        expect(checkboxOf(film).disabled).toBe(false);
        panel.destroy();
    });

    test('two card formats in parallel: each clear removes only its own snapshot', async () => {
        const {panel} = makePanel(twoLineLoader());
        await panel.start();
        const [yt0, yt1] = ytCards(panel);
        tick(checkboxOf(yt0));
        const formatA = panel.getSelectedGatewayMedia();
        tick(checkboxOf(yt1));
        const formatB = panel.getSelectedGatewayMedia();
        panel.clearSelection(formatA);
        expect(panel.getSelectedGatewayMedia().youtube.map((y) => y.key)).toStrictEqual(['1']);
        expect(checkboxOf(yt1).checked).toBe(true);
        panel.clearSelection(formatB);
        expect(panel.getSelectedGatewayMedia().youtube).toStrictEqual([]);
        expect(checkboxOf(yt1).checked).toBe(false);
        panel.destroy();
    });

    test('an item unticked by the user during the save stays unticked; unknown ids are ignored', async () => {
        const {panel} = makePanel(twoLineLoader());
        await panel.start();
        const [yt0] = ytCards(panel);
        tick(checkboxOf(yt0));
        const snapshot = panel.getSelectedGatewayMedia();
        tick(checkboxOf(yt0));
        expect(() => panel.clearSelection({films: [{clipId: 'nope'}], youtube: [...snapshot.youtube, {...snapshot.youtube[0], key: '99'}]})).not.toThrow();
        expect(checkboxOf(yt0).checked).toBe(false);
        panel.destroy();
    });

    test('after destroy: no throw, nothing touched', async () => {
        const {panel} = makePanel(twoLineLoader());
        await panel.start();
        const [yt0] = ytCards(panel);
        tick(checkboxOf(yt0));
        const snapshot = panel.getSelectedGatewayMedia();
        panel.destroy();
        expect(() => { panel.clearSelection(snapshot); }).not.toThrow();
    });
});

describe('visible save status line (UX follow-up)', () => {
    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {HTMLElement}
     */
    const statusOf = (panel) => /** @type {HTMLElement} */ (panel.root.querySelector('.ve-gw-save-status'));

    /**
     * Idle = still rendered (not `hidden`: a live region that appears together with its text is often not announced),
     * just empty.
     * @param {HTMLElement} el
     */
    const expectIdle = (el) => {
        expect(el.hidden).toBe(false);
        expect(el.textContent).toBe('');
        expect(el.dataset.state).toBeUndefined();
    };

    test('always rendered (never hidden, so the first phase is announced); role=status only; text only (no markup)', () => {
        const {panel} = makePanel(makeLoader());
        const el = statusOf(panel);
        expect(el.getAttribute('role')).toBe('status');
        // role="status" implies aria-live="polite"; an explicit one is redundant.
        expect(el.hasAttribute('aria-live')).toBe(false);
        expectIdle(el);
        const status = panel.beginSaveStatus();
        expectIdle(el);
        status.update('<b>Готовлю видео…</b>');
        expect(el.hidden).toBe(false);
        expect(el.textContent).toBe('<b>Готовлю видео…</b>');
        expect(el.querySelector('b')).toBeNull();
        expect(el.dataset.state).toBe('busy');
        status.finish(false);
        expectIdle(el);
        expect(el.textContent).toBe('');
        panel.destroy();
    });

    test('success shows «Сохранено» for a couple of seconds, then clears', () => {
        vi.useFakeTimers();
        try {
            const {panel} = makePanel(makeLoader());
            const el = statusOf(panel);
            const status = panel.beginSaveStatus();
            status.update('Сохраняю видео в Anki…');
            status.finish(true);
            expect(el.textContent).toBe('Сохранено');
            expect(el.dataset.state).toBe('done');
            expect(el.hidden).toBe(false);
            vi.advanceTimersByTime(2500);
            expectIdle(el);
            expect(el.textContent).toBe('');
            // A second finish is ignored.
            status.finish(true);
            expectIdle(el);
            panel.destroy();
        } finally {
            vi.useRealTimers();
        }
    });

    test('two saves in parallel: finishing one keeps the other\'s phase; «Сохранено» only when none is busy', () => {
        vi.useFakeTimers();
        try {
            const {panel} = makePanel(makeLoader());
            const el = statusOf(panel);
            const a = panel.beginSaveStatus();
            const b = panel.beginSaveStatus();
            a.update('Готовлю видео…');
            b.update('Сохраняю видео в Anki…');
            expect(el.textContent).toBe('Сохраняю видео в Anki…');
            b.finish(true);
            expect(el.textContent).toBe('Готовлю видео…');
            a.update('Сохраняю карточку в Anki…');
            a.finish(true);
            expect(el.textContent).toBe('Сохранено');
            // A new save during «Сохранено» replaces it and is not cleared by the old timer.
            const c = panel.beginSaveStatus();
            c.update('Готовлю видео…');
            // The pending «Сохранено» timer is cancelled, not left to fire.
            expect(vi.getTimerCount()).toBe(0);
            vi.advanceTimersByTime(5000);
            expect(el.textContent).toBe('Готовлю видео…');
            c.finish(false);
            expectIdle(el);
            panel.destroy();
        } finally {
            vi.useRealTimers();
        }
    });

    test('destroy mid-save: late update/finish are no-ops; a status begun after destroy is inert', () => {
        vi.useFakeTimers();
        try {
            const {panel} = makePanel(makeLoader());
            const el = statusOf(panel);
            const status = panel.beginSaveStatus();
            status.update('Готовлю видео…');
            panel.destroy();
            expect(() => {
                status.update('Сохраняю видео в Anki…');
                status.finish(true);
                const late = panel.beginSaveStatus();
                late.update('x');
                late.finish(true);
            }).not.toThrow();
            expect(el.textContent).not.toBe('Сохранено');
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    test('destroy while «Сохранено» is shown cancels its timer', () => {
        vi.useFakeTimers();
        try {
            const {panel} = makePanel(makeLoader());
            const status = panel.beginSaveStatus();
            status.update('Готовлю видео…');
            status.finish(true);
            expect(vi.getTimerCount()).toBe(1);
            panel.destroy();
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('GatewayExamplesPanel — вкладки и низ панели (карточка Flib-club)', () => {
    /**
     * @param {GatewayExamplesPanel} panel
     * @param {'youtube'|'films'} name
     * @returns {HTMLButtonElement}
     */
    const tab = (panel, name) => /** @type {HTMLButtonElement} */ (panel.root.querySelector(`.fc-tab[data-tab="${name}"]`));

    test('по умолчанию открыт YouTube, счётчики вкладок — по числу карточек', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        expect(tab(panel, 'youtube').getAttribute('aria-selected')).toBe('true');
        expect(section(panel, 'youtube').hidden).toBe(false);
        expect(section(panel, 'films').hidden).toBe(true);
        expect(tab(panel, 'youtube').querySelector('.fc-tab-n')?.textContent).toBe(`${panel.root.querySelectorAll('.ve-gw-yt-card').length}`);
        expect(tab(panel, 'films').querySelector('.fc-tab-n')?.textContent).toBe(`${FILM_CLIPS.length}`);
        panel.destroy();
    });

    test('щелчок по вкладке переключает секции', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        tab(panel, 'films').click();
        expect(section(panel, 'films').hidden).toBe(false);
        expect(section(panel, 'youtube').hidden).toBe(true);
        panel.destroy();
    });

    test('на YouTube пусто — сама открывается вкладка «Фильмы»; выбор пользователя не перебивается', async () => {
        const empty = makeLoader({loadYouTube: vi.fn(async () => ({items: [], emptyReason: 'not_in_corpus'}))});
        const {panel} = makePanel(empty);
        await panel.start();
        expect(tab(panel, 'films').getAttribute('aria-selected')).toBe('true');
        panel.destroy();

        /** @type {(value: {items: never[], emptyReason: string}) => void} */
        let resolveYouTube = () => {};
        const slow = makeLoader({loadYouTube: vi.fn(() => new Promise((resolve) => { resolveYouTube = resolve; }))});
        const second = makePanel(slow).panel;
        const started = second.start();
        tab(second, 'youtube').click();
        resolveYouTube({items: [], emptyReason: 'not_in_corpus'});
        await started;
        expect(tab(second, 'youtube').getAttribute('aria-selected')).toBe('true');
        second.destroy();
    });

    test('ошибка ключа — ссылка на сайт за ключом; другие ошибки — без неё', async () => {
        const keyLoader = makeLoader({loadYouTube: vi.fn(async () => { throw flibError('flib_key_missing'); })});
        const {panel} = makePanel(keyLoader);
        await panel.start();
        const help = section(panel, 'youtube').querySelector('.fc-xp-help a[target="_blank"]');
        expect(help?.getAttribute('href')).toMatch(/^https:\/\//);
        expect(help?.getAttribute('rel')).toContain('noopener');
        panel.destroy();

        const down = makePanel(makeLoader({loadYouTube: vi.fn(async () => { throw flibError('flib_service_unavailable'); })})).panel;
        await down.start();
        expect(section(down, 'youtube').querySelector('.fc-xp-help')).toBeNull();
        down.destroy();
    });

    test.each(['examples_quota_exhausted', 'demo_catalog_restricted'])('%s ведёт на страницу покупки полного ключа', async (code) => {
        const {panel} = makePanel(makeLoader({loadYouTube: vi.fn(async () => { throw flibError(code); })}));
        await panel.start();
        expect(section(panel, 'youtube').querySelector('.fc-xp-help a.fc-btn-acc')?.getAttribute('href')).toBe('https://flib.club/buy?src=extension');
        panel.destroy();
    });

    test('демо-ключ на фильмах: своя причина и предложение полного ключа, а не бесплатного', async () => {
        const {panel} = makePanel(makeLoader({loadFilms: vi.fn(async () => { throw flibError('flib_forbidden'); })}));
        await panel.start();
        const films = section(panel, 'films');
        expect(films.textContent).toContain('Примеры из фильмов этот ключ не включает');
        expect(films.querySelector('.fc-xp-help a.fc-btn-acc')?.getAttribute('href')).toBe('https://flib.club/buy?src=extension');
        panel.destroy();
    });

    test('нет ключа — бот за бесплатным ключом', async () => {
        const {panel} = makePanel(makeLoader({loadYouTube: vi.fn(async () => { throw flibError('flib_key_missing'); })}));
        await panel.start();
        expect(section(panel, 'youtube').querySelector('.fc-xp-help a.fc-btn-acc')?.getAttribute('href')).toMatch(/start=extension$/);
        panel.destroy();
    });

    test('частые запросы — без предложения сменить ключ', async () => {
        const {panel} = makePanel(makeLoader({loadYouTube: vi.fn(async () => { throw flibError('flib_rate_limited'); })}));
        await panel.start();
        expect(section(panel, 'youtube').querySelector('.fc-xp-help')).toBeNull();
        panel.destroy();
    });

    test('низ панели: подсказка без отметок, «N видео уйдут» и кнопка с отметками; кнопка зовёт onSaveSelected', async () => {
        const entry = window.document.createElement('div');
        window.document.body.appendChild(entry);
        const onSaveSelected = vi.fn();
        const panel = new GatewayExamplesPanel(entry, 'run', {onCancel: vi.fn(), onRetry: vi.fn(), onYouTubeOpen: vi.fn(), onSaveSelected}, {
            loader: /** @type {import('../ext/js/display/gateway-examples-loader.js').GatewayExamplesLoader} */ (/** @type {unknown} */ (makeLoader())),
        });
        await panel.start();
        const footerText = () => panel.root.querySelector('.fc-xp-foot-text')?.textContent;
        const button = /** @type {HTMLButtonElement} */ (panel.root.querySelector('.fc-xp-save'));
        expect(footerText()).toMatch(/^Отметьте примеры/);
        expect(button.hidden).toBe(true);
        const checkboxes = /** @type {NodeListOf<HTMLInputElement>} */ (panel.root.querySelectorAll('.ve-gw-yt-card input[type=checkbox]'));
        checkboxes[0].checked = true;
        checkboxes[0].dispatchEvent(new Event('change'));
        expect(footerText()).toBe('1 видео уйдёт в Anki вместе со словом');
        expect(button.hidden).toBe(false);
        button.click();
        expect(onSaveSelected).toHaveBeenCalledTimes(1);
        panel.clearSelection(panel.getSelectedGatewayMedia());
        expect(footerText()).toMatch(/^Отметьте примеры/);
        panel.destroy();
    });

    test.each(/** @type {[language: import('ui-language').UiLanguage, hint: string, summaries: string[], buttons: string[]][]} */ ([
        [
            'ru',
            'Отметьте примеры — они уйдут в Anki вместе с фразой',
            ['1 видео уйдёт в Anki вместе с фразой', '2 видео уйдут в Anki вместе с фразой', '5 видео уйдут в Anki вместе с фразой'],
            ['＋ В Anki · 1 видео', '＋ В Anki · 2 видео', '＋ В Anki · 5 видео'],
        ],
        [
            'en',
            'Tick examples to save them to Anki with the phrase',
            ['1 video will go to Anki with the phrase', '2 videos will go to Anki with the phrase', '5 videos will go to Anki with the phrase'],
            ['＋ To Anki · 1 video', '＋ To Anki · 2 videos', '＋ To Anki · 5 videos'],
        ],
    ]))('фраза (%s): тексты про фразу для 0, 1, 2, 5 отметок, кнопка сохраняет', async (language, hint, summaries, buttons) => {
        setUiLanguage(language);
        try {
            const entry = window.document.createElement('div');
            window.document.body.appendChild(entry);
            const onSaveSelected = vi.fn();
            const items = Array.from({length: 5}, (_, i) => ({...KNOWN_ITEMS[0], ref: `aaaaaaaaaa${i}`}));
            const panel = new GatewayExamplesPanel(entry, 'call it a day', {onCancel: vi.fn(), onRetry: vi.fn(), onYouTubeOpen: vi.fn(), onSaveSelected}, {
                loader: /** @type {import('../ext/js/display/gateway-examples-loader.js').GatewayExamplesLoader} */ (/** @type {unknown} */ (makeLoader({loadBatch: vi.fn(async () => ({items, emptyReason: null, knownSource: null, partial: false}))}))),
                search: {target: {text: 'call it a day', mode: 'quote'}, initialRank: 'plain'},
            });
            await panel.start();
            const footerText = () => panel.root.querySelector('.fc-xp-foot-text')?.textContent;
            const button = /** @type {HTMLButtonElement} */ (panel.root.querySelector('.fc-xp-save'));
            expect(footerText()).toBe(hint);
            expect(button.hidden).toBe(true);
            const checkboxes = /** @type {HTMLInputElement[]} */ ([...panel.root.querySelectorAll('.ve-gw-yt-card input[type=checkbox]')]);
            /** @type {(?string|undefined)[]} */
            const seen = [];
            /** @type {(?string)[]} */
            const labels = [];
            for (const checkbox of checkboxes) {
                checkbox.checked = true;
                checkbox.dispatchEvent(new Event('change'));
                seen.push(footerText());
                labels.push(button.textContent);
            }
            expect([0, 1, 4].map((i) => seen[i])).toStrictEqual(summaries);
            expect([0, 1, 4].map((i) => labels[i])).toStrictEqual(buttons);
            expect(button.hidden).toBe(false);
            button.click();
            expect(onSaveSelected).toHaveBeenCalledTimes(1);
            panel.clearSelection(panel.getSelectedGatewayMedia());
            expect(footerText()).toBe(hint);
            expect(button.hidden).toBe(true);
            panel.destroy();
        } finally {
            setUiLanguage('ru');
        }
    });

    test('слово: тексты прежние', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        expect(panel.root.querySelector('.fc-xp-foot-text')?.textContent).toBe('Отметьте примеры — они сохранятся в карточку Anki вместе со словом.');
        panel.destroy();
    });
});

describe('«С учётом моих знаний» (feature A)', () => {
    const SOON = 'Скоро: сервер ещё не включил эту функцию';
    const PENDING = 'Знакомые слова ещё загружаются — попробуйте через минуту';
    const NONE = 'Ранжирование по знакомым словам сейчас недоступно — для него нужен маршрут на сайте Flib с этим ключом';

    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {HTMLButtonElement}
     */
    const knownButton = (panel) => /** @type {HTMLButtonElement} */ (section(panel, 'youtube').querySelector('.ve-gw-section-tools button.fc-btn.ve-gw-known'));
    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {HTMLElement}
     */
    const note = (panel) => /** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('.ve-gw-known-note'));
    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {string[]}
     */
    const refs = (panel) => [...section(panel, 'youtube').querySelectorAll('.ve-gw-yt-list .ve-gw-yt-card')].map((c) => /** @type {HTMLElement} */ (c).dataset.ref ?? '');
    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {Promise<void>}
     */
    const press = async (panel) => {
        knownButton(panel).click();
        await panel.whenIdle();
    };
    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {string}
     */
    const youTubeCount = (panel) => panel.root.querySelector('.fc-tab[data-tab="youtube"] .fc-tab-n')?.textContent ?? '';

    test('the button sits in the YouTube tools row next to «Понятные», not pressed; films have none', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        const button = knownButton(panel);
        expect(button.textContent).toBe('С учётом моих знаний');
        expect(button.getAttribute('aria-pressed')).toBe('false');
        expect(button.nextElementSibling?.classList.contains('ve-gw-understandable')).toBe(true);
        expect(section(panel, 'films').querySelector('.ve-gw-known')).toBeNull();
        expect(note(panel).getAttribute('role')).toBe('status');
        expect(note(panel).textContent).toBe('');
        panel.destroy();
    });

    test('a press replaces the list with ranked cards and «понятно N%»; a second press restores the plain cards with no request', async () => {
        const loader = makeLoader();
        const {panel} = makePanel(loader);
        await panel.start();
        const plainCard = section(panel, 'youtube').querySelector('.ve-gw-yt-card');
        expect(refs(panel)).toEqual([REF]);
        await press(panel);
        expect(loader.loadBatch).toHaveBeenCalledTimes(1);
        expect(loader.loadBatch).toHaveBeenCalledWith({text: 'run', mode: 'lemma'}, 'known');
        expect(refs(panel)).toEqual([REF2, REF3]);
        const rings = [...section(panel, 'youtube').querySelectorAll('.ve-gw-yt-card .ve-gw-ring')];
        expect(rings.map((r) => r.querySelector('.ve-gw-ring-n')?.textContent)).toEqual(['91', '50']);
        expect(rings.map((r) => /** @type {HTMLElement} */ (r).dataset.level)).toEqual(['high', 'low']);
        expect(rings.map((r) => r.getAttribute('aria-label'))).toEqual(['понятно 91% фрагмента', 'понятно 50% фрагмента']);
        expect(rings.map((r) => r.getAttribute('title'))).toEqual(['понятно 91% фрагмента', 'понятно 50% фрагмента']);
        expect(section(panel, 'youtube').querySelector('.ve-gw-known-badge')).toBeNull();
        expect(section(panel, 'youtube').querySelectorAll('.ve-gw-yt-card > .ve-gw-yt-thumb > .ve-gw-ring')).toHaveLength(2);
        expect(section(panel, 'youtube').querySelectorAll('.ve-gw-ring')).toHaveLength(2);
        expect(knownButton(panel).getAttribute('aria-pressed')).toBe('true');
        expect(youTubeCount(panel)).toBe('2');
        expect(note(panel).textContent).toBe('');
        await press(panel);
        expect(loader.loadBatch).toHaveBeenCalledTimes(1);
        expect(loader.loadYouTube).toHaveBeenCalledTimes(1);
        expect(refs(panel)).toEqual([REF]);
        expect(section(panel, 'youtube').querySelector('.ve-gw-yt-card')).toBe(plainCard);
        expect(knownButton(panel).getAttribute('aria-pressed')).toBe('false');
        expect(youTubeCount(panel)).toBe('1');
        // A fully ranked answer is kept: pressing once more shows it without asking the server again.
        await press(panel);
        expect(loader.loadBatch).toHaveBeenCalledTimes(1);
        expect(refs(panel)).toEqual([REF2, REF3]);
        panel.destroy();
    });

    test('pending/none answers are not kept: the next press asks again', async () => {
        const loader = makeLoader({loadBatch: vi.fn(async () => ({items: KNOWN_ITEMS, emptyReason: null, knownSource: 'pending', partial: false}))});
        const {panel} = makePanel(loader);
        await panel.start();
        await press(panel);
        await press(panel);
        await press(panel);
        expect(loader.loadBatch).toHaveBeenCalledTimes(2);
        panel.destroy();
    });

    test('ordinary list empty, known list found: the section shows the cards, and the empty message returns on un-press', async () => {
        const loader = makeLoader({loadYouTube: vi.fn(async () => ({items: [], emptyReason: 'not_in_corpus'}))});
        const {panel} = makePanel(loader);
        await panel.start();
        const yt = section(panel, 'youtube');
        const message = () => yt.querySelector('.ve-gw-section-message')?.textContent;
        expect(yt.dataset.state).toBe('empty');
        await press(panel);
        expect(refs(panel)).toEqual([REF2, REF3]);
        expect(yt.dataset.state).toBe('ready');
        expect(message()).toBe('');
        expect(youTubeCount(panel)).toBe('2');
        await press(panel);
        expect(refs(panel)).toEqual([]);
        expect(yt.dataset.state).toBe('empty');
        expect(message()).toBe('Этого слова нет в корпусе YouTube-примеров');
        panel.destroy();
    });

    test('pending: the list is shown, the button pressed, the note says the words are still loading', async () => {
        // The items keep their shares: only knownSource says there are no known words yet.
        const loader = makeLoader({loadBatch: vi.fn(async () => ({items: KNOWN_ITEMS, emptyReason: null, knownSource: 'pending', partial: false}))});
        const {panel} = makePanel(loader);
        await panel.start();
        await press(panel);
        expect(refs(panel)).toEqual([REF2, REF3]);
        expect(section(panel, 'youtube').querySelector('.ve-gw-ring')).toBeNull();
        expect(knownButton(panel).getAttribute('aria-pressed')).toBe('true');
        expect(note(panel).textContent).toBe(PENDING);
        panel.destroy();
    });

    test('a click on the ring opens the video (the ring swallows nothing)', async () => {
        const {panel, hooks} = makePanel(makeLoader());
        await panel.start();
        await press(panel);
        /** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('.ve-gw-yt-card .ve-gw-ring-n')).click();
        expect(hooks.onYouTubeOpen).toHaveBeenCalledTimes(1);
        expect(hooks.onYouTubeOpen.mock.calls[0][0].ref).toBe(REF2);
        panel.destroy();
    });

    test('the known button title says what it does, by target mode', async () => {
        const word = makePanel(makeLoader());
        await word.panel.start();
        expect(knownButton(word.panel).title).toBe('Фрагменты со словом, отсортированные по знакомым вам словам');
        word.panel.destroy();
        const phrase = makePanel(makeLoader(), {word: 'call it a day', search: {target: {text: 'call it a day', mode: 'quote'}, initialRank: 'plain'}});
        await phrase.panel.start();
        expect(knownButton(phrase.panel).title).toBe('Фрагменты с этой фразой, отсортированные по знакомым вам словам');
        phrase.panel.destroy();
    });

    test('the time label is two spans (start and «–end») with the same text; a duration is one span', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        await press(panel);
        const time = /** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('.ve-gw-yt-card .ve-gw-yt-time'));
        expect(time.textContent).toBe('0:01–0:02');
        expect(time.children).toHaveLength(2);
        expect(time.children[0].textContent).toBe('0:01');
        expect(time.children[1].classList.contains('ve-gw-yt-time-end')).toBe(true);
        expect(time.children[1].textContent).toBe('–0:02');
        panel.destroy();
    });

    test('none: the list is shown without badges and the note explains why', async () => {
        const loader = makeLoader({loadBatch: vi.fn(async () => ({items: KNOWN_ITEMS, emptyReason: null, knownSource: 'none', partial: false}))});
        const {panel} = makePanel(loader);
        await panel.start();
        await press(panel);
        expect(refs(panel)).toEqual([REF2, REF3]);
        expect(section(panel, 'youtube').querySelector('.ve-gw-ring')).toBeNull();
        expect(knownButton(panel).getAttribute('aria-pressed')).toBe('true');
        expect(note(panel).textContent).toBe(NONE);
        expect(note(panel).textContent).not.toContain('flib.club');
        panel.destroy();
    });

    test('axis off (404) → «Скоро…» in the note; the plain list and the section stay; no anki_conf offer (H4)', async () => {
        const loader = makeLoader({loadBatch: vi.fn(async () => { throw httpError('flib_axis_off', {status: 404}); })});
        const {panel} = makePanel(loader, {coreFallback: true});
        await panel.start();
        await press(panel);
        expect(note(panel).textContent).toBe(SOON);
        expect(refs(panel)).toEqual([REF]);
        expect(section(panel, 'youtube').dataset.state).toBe('ready');
        expect(section(panel, 'youtube').querySelector('.ve-gw-section-message')?.textContent).toBe('');
        expect(knownButton(panel).getAttribute('aria-pressed')).toBe('false');
        expect(panel.root.querySelector('.ve-gw-core-fallback')).toBeNull();
        panel.destroy();
    });

    test.each([
        [{code: 'flib_rate_limited', status: 429, retryAfterSec: 30}, 'Слишком часто — попробуйте через 30 с'],
        [{code: 'flib_rate_limited', status: 429}, 'Слишком часто — попробуйте чуть позже'],
        [{code: 'flib_http_error', status: 500, reason: 'internal_error'}, 'Сервер недоступен — попробуйте позже'],
        [{code: 'flib_service_unavailable', status: 503, retryAfterSec: 5}, 'Сервер недоступен — попробуйте позже'],
    ])('error %o → note «%s», no anki_conf offer', async (data, text) => {
        const loader = makeLoader({loadBatch: vi.fn(async () => { throw httpError(data.code, data); })});
        const {panel} = makePanel(loader, {coreFallback: true});
        await panel.start();
        await press(panel);
        expect(note(panel).textContent).toBe(text);
        expect(note(panel).querySelector('.fc-xp-help')).toBeNull();
        expect(panel.root.querySelector('.ve-gw-core-fallback')).toBeNull();
        panel.destroy();
    });

    test('quota and key errors render inside the note with the key help (M7); the section keeps its list', async () => {
        const quota = makePanel(makeLoader({loadBatch: vi.fn(async () => { throw httpError('examples_quota_exhausted', {status: 403}); })})).panel;
        await quota.start();
        await press(quota);
        expect(note(quota).textContent).toContain('Лимит примеров этого ключа исчерпан');
        expect(note(quota).querySelector('.fc-xp-help a.fc-btn-acc')?.getAttribute('href')).toBe('https://flib.club/buy?src=extension');
        expect(section(quota, 'youtube').querySelector(':scope>.fc-xp-help')).toBeNull();
        expect(refs(quota)).toEqual([REF]);
        quota.destroy();

        const missing = makePanel(makeLoader({loadBatch: vi.fn(async () => { throw httpError('flib_key_missing'); })})).panel;
        await missing.start();
        await press(missing);
        expect(note(missing).querySelector('.fc-xp-help a.fc-btn-acc')?.getAttribute('href')).toMatch(/start=extension$/);
        missing.destroy();
    });

    test('a double click sends one request; the button is aria-busy meanwhile', async () => {
        /** @type {(value: unknown) => void} */
        let resolve = () => {};
        const loader = makeLoader({loadBatch: vi.fn(() => new Promise((r) => { resolve = r; }))});
        const {panel} = makePanel(loader);
        await panel.start();
        knownButton(panel).click();
        knownButton(panel).click();
        expect(knownButton(panel).getAttribute('aria-busy')).toBe('true');
        resolve({items: KNOWN_ITEMS, emptyReason: null, knownSource: 'route', partial: false});
        await panel.whenIdle();
        expect(loader.loadBatch).toHaveBeenCalledTimes(1);
        expect(knownButton(panel).hasAttribute('aria-busy')).toBe(false);
        expect(knownButton(panel).getAttribute('aria-pressed')).toBe('true');
        panel.destroy();
    });

    test('server text with markup renders as text', async () => {
        const evil = '<img src=x onerror=1>';
        const loader = makeLoader({loadBatch: vi.fn(async () => ({items: [{...KNOWN_ITEMS[0], text_en: evil, title: evil}], emptyReason: null, knownSource: 'route', partial: false}))});
        const {panel} = makePanel(loader);
        await panel.start();
        await press(panel);
        const card = /** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('.ve-gw-yt-list .ve-gw-yt-card'));
        expect(card.querySelector('.ve-gw-yt-text')?.textContent).toBe(evil);
        expect([...card.querySelectorAll('img')].map((i) => i.getAttribute('src'))).toEqual([`https://i.ytimg.com/vi/${REF2}/mqdefault.jpg`]);
        panel.destroy();
    });

    test('partial → «Сервер не успел» with a retry button that asks again', async () => {
        const loadBatch = vi.fn()
            .mockResolvedValueOnce({items: [], emptyReason: 'budget_exhausted', knownSource: 'route', partial: true})
            .mockResolvedValueOnce({items: KNOWN_ITEMS, emptyReason: null, knownSource: 'route', partial: false});
        const {panel} = makePanel(makeLoader({loadBatch}));
        await panel.start();
        await press(panel);
        expect(note(panel).textContent).toContain('Сервер не успел');
        expect(refs(panel)).toEqual([REF]);
        expect(knownButton(panel).getAttribute('aria-pressed')).toBe('false');
        const retry = /** @type {HTMLButtonElement} */ (note(panel).querySelector('button.ve-gw-known-retry'));
        expect(retry.textContent).toBe('Попробовать ещё раз');
        retry.click();
        await panel.whenIdle();
        expect(loadBatch).toHaveBeenCalledTimes(2);
        expect(refs(panel)).toEqual([REF2, REF3]);
        expect(note(panel).textContent).toBe('');
        panel.destroy();
    });

    test('partial with items: the ranked list is shown and the retry is offered', async () => {
        const {panel} = makePanel(makeLoader({loadBatch: vi.fn(async () => ({items: KNOWN_ITEMS, emptyReason: null, knownSource: 'route', partial: true}))}));
        await panel.start();
        await press(panel);
        expect(refs(panel)).toEqual([REF2, REF3]);
        expect(note(panel).querySelector('button.ve-gw-known-retry')).not.toBeNull();
        panel.destroy();
    });

    test('an empty known answer keeps the plain list and shows the reason in the note', async () => {
        const {panel} = makePanel(makeLoader({loadBatch: vi.fn(async () => ({items: [], emptyReason: 'not_in_corpus', knownSource: 'route', partial: false}))}));
        await panel.start();
        await press(panel);
        expect(refs(panel)).toEqual([REF]);
        expect(note(panel).textContent).toBe('Этого слова нет в корпусе YouTube-примеров');
        expect(knownButton(panel).getAttribute('aria-pressed')).toBe('false');
        expect(section(panel, 'youtube').dataset.state).toBe('ready');
        panel.destroy();
    });

    test('toggling unticks the hidden set; selection and keys follow the visible cards (C2)', async () => {
        const entry = window.document.createElement('div');
        window.document.body.appendChild(entry);
        const loader = makeLoader();
        const panel = new GatewayExamplesPanel(entry, 'run', {onCancel: vi.fn(), onRetry: vi.fn(), onYouTubeOpen: vi.fn(), onSaveSelected: vi.fn()}, {
            loader: /** @type {import('../ext/js/display/gateway-examples-loader.js').GatewayExamplesLoader} */ (/** @type {unknown} */ (loader)),
        });
        await panel.start();
        const footerText = () => panel.root.querySelector('.fc-xp-foot-text')?.textContent ?? '';
        const plainBox = checkboxOf(/** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('.ve-gw-yt-card')));
        tick(plainBox);
        const plainKey = panel.getSelectedGatewayMedia().youtube[0].key;
        expect(footerText()).toBe('1 видео уйдёт в Anki вместе со словом');
        await press(panel);
        expect(plainBox.checked).toBe(false);
        expect(panel.getSelectedGatewayMedia().youtube).toStrictEqual([]);
        expect(footerText()).toMatch(/^Отметьте примеры/);
        const knownCards = /** @type {HTMLElement[]} */ ([...section(panel, 'youtube').querySelectorAll('.ve-gw-yt-list .ve-gw-yt-card')]);
        tick(checkboxOf(knownCards[1]));
        const selected = panel.getSelectedGatewayMedia().youtube;
        expect(selected).toHaveLength(1);
        expect(selected[0]).toMatchObject({ref: REF3, startMs: 3000, text: 'They run away'});
        expect(selected[0].key).not.toBe(plainKey);
        panel.clearSelection(panel.getSelectedGatewayMedia());
        expect(checkboxOf(knownCards[1]).checked).toBe(false);
        tick(checkboxOf(knownCards[0]));
        await press(panel);
        expect(checkboxOf(knownCards[0]).checked).toBe(false);
        expect(panel.getSelectedGatewayMedia().youtube).toStrictEqual([]);
        expect(footerText()).toMatch(/^Отметьте примеры/);
        panel.destroy();
    });

    test('the «Понятные» list above the YouTube list is never touched by the toggle', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        const und = /** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('div.ve-gw-und-list'));
        const marker = window.document.createElement('div');
        und.appendChild(marker);
        await press(panel);
        await press(panel);
        expect(und.firstElementChild).toBe(marker);
        expect(und.nextElementSibling?.classList.contains('ve-gw-yt-list')).toBe(true);
        panel.destroy();
    });

    test('a known answer arriving after destroy touches nothing', async () => {
        /** @type {(value: unknown) => void} */
        let resolve = () => {};
        const {panel} = makePanel(makeLoader({loadBatch: vi.fn(() => new Promise((r) => { resolve = r; }))}));
        await panel.start();
        knownButton(panel).click();
        panel.destroy();
        resolve({items: KNOWN_ITEMS, emptyReason: null, knownSource: 'route', partial: false});
        await panel.whenIdle();
        expect(refs(panel)).toEqual([REF]);
    });
});

describe('panel search contract {target, initialRank, truncated}', () => {
    const LONG = `${'phrase '.repeat(15)}end of it`;

    test('initialRank known: the first YouTube load is the known batch (no /v1/examples), pressed, with badges', async () => {
        const loader = makeLoader();
        const {panel} = makePanel(loader, {word: 'call it a day', search: {target: {text: 'call it a day', mode: 'quote'}, initialRank: 'known'}});
        await panel.start();
        expect(loader.loadYouTube).not.toHaveBeenCalled();
        expect(loader.loadBatch).toHaveBeenCalledTimes(1);
        expect(loader.loadBatch).toHaveBeenCalledWith({text: 'call it a day', mode: 'quote'}, 'known');
        const yt = section(panel, 'youtube');
        expect(yt.dataset.state).toBe('ready');
        expect(yt.querySelectorAll('.ve-gw-yt-list .ve-gw-ring')).toHaveLength(2);
        expect(/** @type {HTMLElement} */ (yt.querySelector('.ve-gw-known')).getAttribute('aria-pressed')).toBe('true');
        panel.destroy();
    });

    test('initialRank known + axis off → «Скоро…» in the section, no fallback request, no anki_conf offer', async () => {
        const error = new ExtensionError('flib_axis_off');
        error.data = {code: 'flib_axis_off', status: 404};
        const loader = makeLoader({loadBatch: vi.fn(async () => { throw error; })});
        const {panel} = makePanel(loader, {coreFallback: true, search: {target: {text: 'call it a day', mode: 'quote'}, initialRank: 'known'}});
        await panel.start();
        expect(section(panel, 'youtube').querySelector('.ve-gw-section-message')?.textContent).toBe('Скоро: сервер ещё не включил эту функцию');
        expect(section(panel, 'youtube').dataset.state).toBe('error');
        expect(loader.loadYouTube).not.toHaveBeenCalled();
        expect(panel.root.querySelector('.ve-gw-core-fallback')).toBeNull();
        panel.destroy();
    });

    test('initialRank known, un-press with no plain list stored → one plain request (M5): batch plain for a quote', async () => {
        const loadBatch = vi.fn(async (_target, rank) => (rank === 'known' ?
            {items: KNOWN_ITEMS, emptyReason: null, knownSource: 'route', partial: false} :
            {items: [{...KNOWN_ITEMS[0], ref: REF, known_share: null}], emptyReason: null, knownSource: 'none', partial: false}));
        const loader = makeLoader({loadBatch});
        const {panel} = makePanel(loader, {search: {target: {text: 'call it a day', mode: 'quote'}, initialRank: 'known'}});
        await panel.start();
        const button = /** @type {HTMLButtonElement} */ (section(panel, 'youtube').querySelector('.ve-gw-known'));
        button.click();
        await panel.whenIdle();
        expect(loadBatch).toHaveBeenLastCalledWith({text: 'call it a day', mode: 'quote'}, 'plain');
        expect([...section(panel, 'youtube').querySelectorAll('.ve-gw-yt-list .ve-gw-yt-card')].map((c) => /** @type {HTMLElement} */ (c).dataset.ref)).toEqual([REF]);
        expect(section(panel, 'youtube').querySelector('.ve-gw-ring')).toBeNull();
        expect(button.getAttribute('aria-pressed')).toBe('false');
        button.click();
        await panel.whenIdle();
        button.click();
        await panel.whenIdle();
        expect(loadBatch.mock.calls.filter((c) => c[1] === 'plain')).toHaveLength(1);
        expect(loader.loadYouTube).not.toHaveBeenCalled();
        panel.destroy();
    });

    test('initialRank known for a lemma: un-press asks /v1/examples once', async () => {
        const loader = makeLoader();
        const {panel} = makePanel(loader, {search: {target: {text: 'run', mode: 'lemma'}, initialRank: 'known'}});
        await panel.start();
        /** @type {HTMLButtonElement} */ (section(panel, 'youtube').querySelector('.ve-gw-known')).click();
        await panel.whenIdle();
        expect(loader.loadYouTube).toHaveBeenCalledTimes(1);
        expect(loader.loadYouTube).toHaveBeenCalledWith('run');
        panel.destroy();
    });

    test('quote + plain: the first load is the plain batch; films search the 80-code-point cut', async () => {
        const loader = makeLoader();
        const {panel} = makePanel(loader, {word: LONG, search: {target: {text: LONG, mode: 'quote'}, initialRank: 'plain'}});
        await panel.start();
        expect(loader.loadBatch).toHaveBeenCalledWith({text: LONG, mode: 'quote'}, 'plain');
        expect(loader.loadYouTube).not.toHaveBeenCalled();
        const filmsQuery = String(loader.loadFilms.mock.calls[0][0]);
        expect([...filmsQuery].length).toBeLessThanOrEqual(80);
        expect(LONG.startsWith(filmsQuery)).toBe(true);
        expect(filmsQuery.endsWith('phrase')).toBe(true);
        // A plain batch shows no «понятно» badges and does not press the button.
        expect(section(panel, 'youtube').querySelector('.ve-gw-ring')).toBeNull();
        expect(/** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('.ve-gw-known')).getAttribute('aria-pressed')).toBe('false');
        panel.destroy();
    });

    test('quote + plain, axis off → /v1/examples with the 80-code-point cut', async () => {
        const error = new ExtensionError('flib_axis_off');
        error.data = {code: 'flib_axis_off', status: 404};
        const loader = makeLoader({loadBatch: vi.fn(async () => { throw error; })});
        const {panel} = makePanel(loader, {coreFallback: true, word: LONG, search: {target: {text: LONG, mode: 'quote'}, initialRank: 'plain'}});
        await panel.start();
        expect(loader.loadYouTube).toHaveBeenCalledTimes(1);
        const query = String(loader.loadYouTube.mock.calls[0][0]);
        expect(query).toBe(loader.loadFilms.mock.calls[0][0]);
        expect([...query].length).toBeLessThanOrEqual(80);
        expect(section(panel, 'youtube').querySelectorAll('.ve-gw-yt-card')).toHaveLength(1);
        expect(panel.root.querySelector('.ve-gw-core-fallback')).toBeNull();
        panel.destroy();
    });

    test('truncated → «Ищу по первым 200 символам»; not truncated → no note', async () => {
        const {panel} = makePanel(makeLoader(), {search: {target: {text: 'call it a day', mode: 'quote'}, initialRank: 'plain', truncated: true}});
        expect(panel.root.querySelector('.ve-gw-truncated-note')?.textContent).toBe('Ищу по первым 200 символам');
        panel.destroy();
        const plain = makePanel(makeLoader()).panel;
        expect(plain.root.querySelector('.ve-gw-truncated-note')).toBeNull();
        plain.destroy();
    });
});

describe('«Понятные» (feature B)', () => {
    const SEARCHING = 'Ищу понятные ролики…';
    const TOO_SLOW = 'Сервер не успел';
    const INTERRUPTED = 'Поиск прервался — повторите';

    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {HTMLButtonElement}
     */
    const undButton = (panel) => /** @type {HTMLButtonElement} */ (section(panel, 'youtube').querySelector('.ve-gw-section-tools button.ve-gw-understandable'));
    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {HTMLButtonElement}
     */
    const knownButton = (panel) => /** @type {HTMLButtonElement} */ (section(panel, 'youtube').querySelector('.ve-gw-section-tools button.ve-gw-known'));
    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {HTMLElement}
     */
    const undNote = (panel) => /** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('.ve-gw-und-note'));
    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {HTMLElement}
     */
    const undList = (panel) => /** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('div.ve-gw-und-list'));
    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {HTMLElement[]}
     */
    const undCards = (panel) => /** @type {HTMLElement[]} */ ([...undList(panel).querySelectorAll(':scope>.ve-gw-und-card')]);
    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {string}
     */
    const youTubeCount = (panel) => panel.root.querySelector('.fc-tab[data-tab="youtube"] .fc-tab-n')?.textContent ?? '';
    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {Promise<void>}
     */
    const press = async (panel) => {
        undButton(panel).click();
        await panel.whenIdle();
    };

    /**
     * A runUnderstandable that waits for the test; by default it rejects with flib_aborted on abort, as the loader does.
     * @param {{ignoreAbort?: boolean}} [options]
     * @returns {{fn: import('vitest').Mock, resolve: (value: import('flib-gateway-examples').UnderstandableRunResult) => void, reject: (error: unknown) => void, signal: () => AbortSignal}}
     */
    const pendingRun = ({ignoreAbort = false} = {}) => {
        /** @type {(value: import('flib-gateway-examples').UnderstandableRunResult) => void} */
        let resolve = () => {};
        /** @type {(error: unknown) => void} */
        let reject = () => {};
        /** @type {?AbortSignal} */
        let signal = null;
        const fn = vi.fn((/** @type {unknown} */ _request, /** @type {{signal: AbortSignal}} */ options) => new Promise((res, rej) => {
            resolve = res;
            reject = rej;
            signal = options.signal;
            if (ignoreAbort) { return; }
            options.signal.addEventListener('abort', () => { rej(flibError('flib_aborted')); });
        }));
        return {
            fn,
            resolve: (value) => { resolve(value); },
            reject: (error) => { reject(error); },
            signal: () => /** @type {AbortSignal} */ (signal),
        };
    };

    test('a press starts one job for the card word with the refs on screen excluded, and shows progress with «Отменить»', async () => {
        const run = pendingRun();
        const loader = makeLoader({runUnderstandable: run.fn});
        const {panel} = makePanel(loader);
        await panel.start();
        undButton(panel).click();
        undButton(panel).click();
        expect(run.fn).toHaveBeenCalledTimes(1);
        expect(run.fn.mock.calls[0][0]).toStrictEqual({target: {text: 'run', mode: 'lemma'}, excludeVideoIds: [REF]});
        expect(run.signal().aborted).toBe(false);
        expect(undButton(panel).getAttribute('aria-busy')).toBe('true');
        expect(undNote(panel).querySelector('.ve-gw-und-note-text')?.textContent).toBe(SEARCHING);
        expect(undNote(panel).querySelector('button.ve-gw-und-cancel')?.textContent).toBe('Отменить');
        run.resolve(undDone(UND_ITEMS));
        await panel.whenIdle();
        expect(undButton(panel).hasAttribute('aria-busy')).toBe(false);
        expect(undNote(panel).textContent).toBe('');
        panel.destroy();
    });

    test('done → «понятные» cards on top: title as text, «понятно 93% ролика», duration, highlighted first line; counted in the tab', async () => {
        const loader = makeLoader();
        const {panel} = makePanel(loader);
        await panel.start();
        expect(youTubeCount(panel)).toBe('1');
        await press(panel);
        const cards = undCards(panel);
        expect(cards.map((c) => c.dataset.ref)).toEqual([REF4, REF5]);
        const [first, second] = cards;
        expect(first.getAttribute('role')).toBe('button');
        expect(first.tabIndex).toBe(0);
        expect(first.querySelector('img')?.getAttribute('src')).toBe(`https://i.ytimg.com/vi/${REF4}/mqdefault.jpg`);
        expect(first.querySelector('.ve-gw-und-title')?.textContent).toBe('Running <b>fast</b>');
        expect(first.querySelector('b')).toBeNull();
        expect(first.querySelector('.ve-gw-ring .ve-gw-ring-n')?.textContent).toBe('93');
        expect(first.querySelector('.ve-gw-ring')?.getAttribute('aria-label')).toBe('понятно 93% ролика');
        expect(first.querySelector('.ve-gw-ring')?.getAttribute('title')).toBe('понятно 93% ролика');
        expect(first.querySelector('.ve-gw-known-badge, .ve-gw-und-badge')).toBeNull();
        expect(first.querySelector(':scope > .ve-gw-yt-thumb > .ve-gw-ring')).not.toBeNull();
        expect(first.querySelector('.ve-gw-yt-time')?.textContent).toBe('2:05');
        expect(first.querySelector('.ve-gw-yt-time')?.children).toHaveLength(1);
        expect(first.querySelector('.ve-gw-yt-time-end')).toBeNull();
        expect(first.querySelector('.ve-gw-yt-text')?.textContent).toBe('You run so fast');
        expect(first.querySelector('.ve-gw-yt-text mark')?.textContent).toBe('run');
        // No coverage, no duration, no hits: none of those parts.
        expect(second.querySelector('.ve-gw-ring')).toBeNull();
        expect(second.querySelector('.ve-gw-yt-time')).toBeNull();
        expect(second.querySelector('.ve-gw-yt-text')).toBeNull();
        expect(second.querySelector('.ve-gw-und-title')).toBeNull();
        // For Anki like the other cards: an unticked checkbox on each, nothing selected yet.
        expect(cards.map((c) => /** @type {HTMLInputElement} */ (c.querySelector('input[type=checkbox]')).checked)).toEqual([false, false]);
        expect(panel.getSelectedGatewayMedia().youtube).toStrictEqual([]);
        expect(youTubeCount(panel)).toBe('3');
        // The ordinary list is still there, below.
        expect([...section(panel, 'youtube').querySelectorAll('.ve-gw-yt-list>.ve-gw-yt-card')].map((c) => /** @type {HTMLElement} */ (c).dataset.ref)).toEqual([REF]);
        panel.destroy();
    });

    test('a click (or Enter) opens the video from the first hit to its end; without hits from the start, no subtitle', async () => {
        const {panel, hooks} = makePanel(makeLoader());
        await panel.start();
        await press(panel);
        const [first, second] = undCards(panel);
        first.click();
        expect(hooks.onYouTubeOpen).toHaveBeenCalledTimes(1);
        expect(hooks.onYouTubeOpen.mock.calls[0][0]).toStrictEqual({source: 'youtube', ref: REF4, start_ms: 42000, end_ms: null, text_en: 'You run so fast', text_ru: null, thumbnail_url: null});
        expect(hooks.onYouTubeOpen.mock.calls[0][1]).toContain('run');
        second.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Enter', bubbles: true}));
        expect(hooks.onYouTubeOpen.mock.calls[1][0]).toStrictEqual({source: 'youtube', ref: REF5, start_ms: 0, end_ms: null, text_en: null, text_ru: null, thumbnail_url: null});
        panel.destroy();
    });

    test('a card with a title and no hit: a click opens it without a line (the title is never a subtitle)', async () => {
        const {panel, hooks} = makePanel(makeLoader({runUnderstandable: vi.fn(async () => undDone([
            {video_id: REF6, title: 'Only a title', channel_id: null, duration_s: null, coverage: null, target_hits: [], target_hits_unavailable: true},
        ]))}));
        await panel.start();
        await press(panel);
        undCards(panel)[0].click();
        expect(hooks.onYouTubeOpen.mock.calls.map((c) => c[0])).toStrictEqual([{source: 'youtube', ref: REF6, start_ms: 0, end_ms: null, text_en: null, text_ru: null, thumbnail_url: null}]);
        panel.destroy();
    });

    test('a whitespace-only line or title is empty: not shown, not saved', async () => {
        const blank = ' \n\u00a0';
        /** @type {import('flib-gateway').UnderstandableItem[]} */
        const items = [
            {video_id: REF4, title: 'A title', channel_id: null, duration_s: null, coverage: null, target_hits: [{from_ms: 7000, to_ms: 8000, text_en: blank}], target_hits_unavailable: false},
            {video_id: REF5, title: blank, channel_id: null, duration_s: null, coverage: null, target_hits: [{from_ms: 8000, to_ms: 9000, text_en: blank}], target_hits_unavailable: false},
            {video_id: REF6, title: blank, channel_id: null, duration_s: null, coverage: null, target_hits: [{from_ms: 9000, to_ms: 9500, text_en: 'You run'}], target_hits_unavailable: false},
        ];
        const {panel, hooks, tickCard} = await savablePanel(items);
        const cards = undCards(panel);
        expect(cards.map((c) => c.querySelector('.ve-gw-und-title')?.textContent ?? null)).toEqual(['A title', null, null]);
        expect(cards.map((c) => c.querySelector('.ve-gw-yt-text')?.textContent ?? null)).toEqual([null, null, 'You run']);
        for (const card of cards) { tickCard(card); }
        expect(panel.getSelectedGatewayMedia().youtube.map(({startMs, text}) => ({startMs, text}))).toStrictEqual([
            {startMs: 7000, text: 'A title'},
            {startMs: 8000, text: null},
            {startMs: 9000, text: 'You run'},
        ]);
        cards[0].click();
        expect(hooks.onYouTubeOpen.mock.calls[0][0].text_en).toBeNull();
        panel.destroy();
    });

    test('an item the panel cannot build → the common error text, no half-applied cards, a new press works', async () => {
        const broken = /** @type {import('flib-gateway').UnderstandableItem} */ (/** @type {unknown} */ ({video_id: REF6, title: 'x', channel_id: null, duration_s: null, coverage: null, target_hits_unavailable: true}));
        const runUnderstandable = vi.fn()
            .mockImplementationOnce(async () => undDone([UND_ITEMS[0], broken]))
            .mockImplementationOnce(async () => undDone(UND_ITEMS));
        const {panel} = makePanel(makeLoader({runUnderstandable}));
        await panel.start();
        const textsBefore = panel._youTubeTexts.length; // eslint-disable-line no-underscore-dangle
        await press(panel);
        expect(undNote(panel).textContent).toBe('Не удалось получить примеры YouTube');
        expect(undNote(panel).querySelector('.fc-xp-help')).toBeNull();
        expect(undButton(panel).hasAttribute('aria-busy')).toBe(false);
        expect(undCards(panel)).toHaveLength(0);
        expect(youTubeCount(panel)).toBe('1');
        expect(panel._youTubeTexts).toHaveLength(textsBefore); // eslint-disable-line no-underscore-dangle
        await press(panel);
        expect(runUnderstandable.mock.calls[1][0].excludeVideoIds).toStrictEqual([REF]);
        expect(undCards(panel)).toHaveLength(2);
        expect(undNote(panel).textContent).toBe('');
        panel.destroy();
    });

    /**
     * A panel with the save hook (a word card), the «Понятные» answer given, ready for ticking.
     * @param {import('flib-gateway').UnderstandableItem[]} [items]
     * @returns {Promise<{panel: GatewayExamplesPanel, hooks: {onYouTubeOpen: import('vitest').Mock}, loader: ReturnType<typeof makeLoader>, footerText: () => string, tickCard: (el: HTMLElement) => void}>}
     */
    const savablePanel = async (items = UND_ITEMS) => {
        const entry = window.document.createElement('div');
        window.document.body.appendChild(entry);
        const hooks = {onCancel: vi.fn(), onRetry: vi.fn(), onYouTubeOpen: vi.fn(), onSaveSelected: vi.fn()};
        const loader = makeLoader({runUnderstandable: vi.fn(async () => undDone(items))});
        const panel = new GatewayExamplesPanel(entry, 'run', hooks, {
            loader: /** @type {import('../ext/js/display/gateway-examples-loader.js').GatewayExamplesLoader} */ (/** @type {unknown} */ (loader)),
        });
        await panel.start();
        await press(panel);
        return {
            panel,
            hooks,
            loader,
            footerText: () => panel.root.querySelector('.fc-xp-foot-text')?.textContent ?? '',
            tickCard: (/** @type {HTMLElement} */ el) => {
                const input = /** @type {HTMLInputElement} */ (el.querySelector('input[type=checkbox]'));
                input.checked = !input.checked;
                input.dispatchEvent(new Event('change'));
            },
        };
    };

    test('every «понятный» card has a checkbox; ticking selects it, keeps the video closed and updates the footer', async () => {
        const {panel, hooks, footerText, tickCard} = await savablePanel();
        const [first, second] = undCards(panel);
        for (const card of [first, second]) {
            const input = /** @type {HTMLInputElement} */ (card.querySelector('input[type=checkbox]'));
            expect(input.checked).toBe(false);
        }
        tickCard(first);
        expect(first.classList.contains('ve-gw-selected')).toBe(true);
        expect(second.classList.contains('ve-gw-selected')).toBe(false);
        expect(footerText()).toBe('1 видео уйдёт в Anki вместе со словом');
        expect(hooks.onYouTubeOpen).not.toHaveBeenCalled();
        // A click on the label itself toggles the box (here: unticks) and never reaches the card.
        /** @type {HTMLElement} */ (first.querySelector('label.ve-gw-check')).click();
        expect(hooks.onYouTubeOpen).not.toHaveBeenCalled();
        expect(first.classList.contains('ve-gw-selected')).toBe(false);
        expect(panel.getSelectedGatewayMedia().youtube).toStrictEqual([]);
        panel.destroy();
    });

    test('Space/Enter on the checkbox label does not open the video', async () => {
        const {panel, hooks} = await savablePanel();
        const label = /** @type {HTMLElement} */ (undCards(panel)[0].querySelector('label.ve-gw-check'));
        for (const key of [' ', 'Enter']) {
            label.dispatchEvent(new window.KeyboardEvent('keydown', {key, bubbles: true}));
        }
        expect(hooks.onYouTubeOpen).not.toHaveBeenCalled();
        panel.destroy();
    });

    test('the selection of a «понятный» card: first hit, else the start; text = the hit, else the title, else null; end null', async () => {
        /** @type {import('flib-gateway').UnderstandableItem[]} */
        const items = [
            ...UND_ITEMS,
            {video_id: REF6, title: 'Only a title', channel_id: null, duration_s: null, coverage: null, target_hits: [], target_hits_unavailable: true},
            {video_id: REF7, title: 'Empty hit', channel_id: null, duration_s: null, coverage: null, target_hits: [{from_ms: 7000, to_ms: 8000, text_en: ''}], target_hits_unavailable: false},
            {video_id: REF8, title: null, channel_id: null, duration_s: null, coverage: null, target_hits: [{from_ms: 9000, to_ms: 9500, text_en: ''}], target_hits_unavailable: false},
        ];
        const {panel, tickCard} = await savablePanel(items);
        for (const card of undCards(panel)) { tickCard(card); }
        const picked = panel.getSelectedGatewayMedia().youtube.map(({ref, startMs, endMs, text}) => ({ref, startMs, endMs, text}));
        expect(picked).toStrictEqual([
            {ref: REF4, startMs: 42000, endMs: null, text: 'You run so fast'},
            {ref: REF5, startMs: 0, endMs: null, text: null},
            {ref: REF6, startMs: 0, endMs: null, text: 'Only a title'},
            {ref: REF7, startMs: 7000, endMs: null, text: 'Empty hit'},
            {ref: REF8, startMs: 9000, endMs: null, text: null},
        ]);
        expect(panel.getSelectedGatewayMedia().youtube[0].words).toContain('run');
        panel.destroy();
    });

    test('order: ticked «Понятные» first, then the visible list; the keys are unique across all sets', async () => {
        const {panel, tickCard} = await savablePanel();
        const listCard = /** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('.ve-gw-yt-list>.ve-gw-yt-card'));
        tickCard(listCard);
        tickCard(undCards(panel)[1]);
        tickCard(undCards(panel)[0]);
        const {youtube} = panel.getSelectedGatewayMedia();
        expect(youtube.map((y) => y.ref)).toEqual([REF4, REF5, REF]);
        expect(new Set(youtube.map((y) => y.key)).size).toBe(3);
        // The known set adds more cards: keys stay unique against every set.
        /** @type {HTMLButtonElement} */ (section(panel, 'youtube').querySelector('.ve-gw-known')).click();
        await panel.whenIdle();
        const all = [...panel.root.querySelectorAll('.ve-gw-yt-card input[type=checkbox]')];
        for (const input of all) {
            const el = /** @type {HTMLInputElement} */ (input);
            if (el.checked) { continue; }
            el.checked = true;
            el.dispatchEvent(new Event('change'));
        }
        // Two «Понятные» and the two known cards now in the list.
        const keys = panel.getSelectedGatewayMedia().youtube.map((y) => y.key);
        expect(keys).toHaveLength(4);
        expect(new Set(keys).size).toBe(4);
        panel.destroy();
    });

    test('the tick survives the known toggle and a second «Понятные» run that prepends cards', async () => {
        const {panel, tickCard, footerText, loader} = await savablePanel();
        const knownBtn = /** @type {HTMLButtonElement} */ (section(panel, 'youtube').querySelector('.ve-gw-known'));
        tickCard(undCards(panel)[0]);
        knownBtn.click();
        await panel.whenIdle();
        expect(footerText()).toBe('1 видео уйдёт в Anki вместе со словом');
        knownBtn.click();
        await panel.whenIdle();
        expect(panel.getSelectedGatewayMedia().youtube.map((y) => y.ref)).toEqual([REF4]);
        loader.runUnderstandable.mockResolvedValueOnce(undDone([{video_id: REF6, title: 'New', channel_id: null, duration_s: null, coverage: null, target_hits: [], target_hits_unavailable: true}]));
        await press(panel);
        const cards = undCards(panel);
        expect(cards.map((c) => c.dataset.ref)).toEqual([REF6, REF4, REF5]);
        expect(cards.map((c) => /** @type {HTMLInputElement} */ (c.querySelector('input')).checked)).toEqual([false, true, false]);
        expect(panel.getSelectedGatewayMedia().youtube.map((y) => y.ref)).toEqual([REF4]);
        // The order is that of the screen (the newer run is on top), not of the ticks.
        tickCard(cards[0]);
        expect(panel.getSelectedGatewayMedia().youtube.map((y) => y.ref)).toEqual([REF6, REF4]);
        panel.destroy();
    });

    test('clearSelection(snapshot) unticks the «понятные» of the snapshot; one ticked after the snapshot stays', async () => {
        const {panel, tickCard, footerText} = await savablePanel();
        const [first, second] = undCards(panel);
        tickCard(first);
        const snapshot = panel.getSelectedGatewayMedia();
        tickCard(second);
        panel.clearSelection(snapshot);
        expect(first.classList.contains('ve-gw-selected')).toBe(false);
        expect(/** @type {HTMLInputElement} */ (first.querySelector('input')).checked).toBe(false);
        expect(second.classList.contains('ve-gw-selected')).toBe(true);
        expect(/** @type {HTMLInputElement} */ (second.querySelector('input')).checked).toBe(true);
        expect(panel.getSelectedGatewayMedia().youtube.map((y) => y.ref)).toEqual([REF5]);
        expect(footerText()).toBe('1 видео уйдёт в Anki вместе со словом');
        panel.destroy();
    });

    test('a phrase panel: «Понятные» ticks count in the footer of the phrase', async () => {
        const entry = window.document.createElement('div');
        window.document.body.appendChild(entry);
        const loader = makeLoader();
        const panel = new GatewayExamplesPanel(entry, 'call it a day', {onCancel: vi.fn(), onRetry: vi.fn(), onYouTubeOpen: vi.fn(), onSaveSelected: vi.fn()}, {
            loader: /** @type {import('../ext/js/display/gateway-examples-loader.js').GatewayExamplesLoader} */ (/** @type {unknown} */ (loader)),
            search: {target: {text: 'call it a day', mode: 'quote'}, initialRank: 'plain'},
        });
        await panel.start();
        await press(panel);
        const input = /** @type {HTMLInputElement} */ (undCards(panel)[0].querySelector('input[type=checkbox]'));
        input.checked = true;
        input.dispatchEvent(new Event('change'));
        expect(panel.root.querySelector('.fc-xp-foot-text')?.textContent).toBe('1 видео уйдёт в Anki вместе с фразой');
        expect(/** @type {HTMLButtonElement} */ (panel.root.querySelector('.fc-xp-save')).hidden).toBe(false);
        panel.destroy();
    });

    test('the next press excludes everything shown so far (plain, known, earlier «понятные») and puts the new cards on top', async () => {
        const loader = makeLoader({
            runUnderstandable: vi.fn()
                .mockImplementationOnce(async () => undDone(UND_ITEMS))
                .mockImplementationOnce(async () => undDone([{...UND_ITEMS[0], video_id: REF6}])),
        });
        const {panel} = makePanel(loader);
        await panel.start();
        knownButton(panel).click();
        await panel.whenIdle();
        await press(panel);
        expect(loader.runUnderstandable.mock.calls[0][0].excludeVideoIds).toStrictEqual([REF, REF2, REF3]);
        await press(panel);
        expect(loader.runUnderstandable.mock.calls[1][0].excludeVideoIds).toStrictEqual([REF, REF2, REF3, REF4, REF5]);
        expect(undCards(panel).map((c) => c.dataset.ref)).toEqual([REF6, REF4, REF5]);
        panel.destroy();
    });

    test('the cards survive the known toggle and stay counted in the tab', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        await press(panel);
        knownButton(panel).click();
        await panel.whenIdle();
        expect(undCards(panel).length).toBe(2);
        expect(youTubeCount(panel)).toBe('4');
        knownButton(panel).click();
        await panel.whenIdle();
        expect(undCards(panel).length).toBe(2);
        expect(youTubeCount(panel)).toBe('3');
        panel.destroy();
    });

    test('ordinary list empty: the cards clear the section message; it does not come back with the known toggle', async () => {
        const loader = makeLoader({loadYouTube: vi.fn(async () => ({items: [], emptyReason: 'not_in_corpus'}))});
        const {panel} = makePanel(loader);
        await panel.start();
        const message = /** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('.ve-gw-section-message'));
        knownButton(panel).click();
        await panel.whenIdle();
        await press(panel);
        knownButton(panel).click();
        await panel.whenIdle();
        expect(message.textContent).toBe('');
        expect(section(panel, 'youtube').dataset.state).toBe('ready');
        expect(youTubeCount(panel)).toBe('2');

        const plainOnly = makePanel(makeLoader({loadYouTube: vi.fn(async () => ({items: [], emptyReason: 'not_in_corpus'}))})).panel;
        await plainOnly.start();
        await press(plainOnly);
        expect(section(plainOnly, 'youtube').querySelector('.ve-gw-section-message')?.textContent).toBe('');
        expect(section(plainOnly, 'youtube').dataset.state).toBe('ready');
        expect(youTubeCount(plainOnly)).toBe('2');
        panel.destroy();
        plainOnly.destroy();
    });

    test.each([
        ['all_excluded', 'lemma', false, 'Все подходящие ролики уже показаны'],
        ['none_eligible', 'lemma', false, 'Понятных роликов с этим словом не нашлось'],
        ['not_in_corpus', 'lemma', false, 'Этого слова нет в корпусе YouTube-примеров'],
        ['budget_exhausted', 'lemma', false, TOO_SLOW],
        [null, 'lemma', true, TOO_SLOW],
        ['budget_exhausted', 'quote', false, 'Не удалось проверить фразу в роликах'],
        [null, 'quote', true, 'Не удалось проверить фразу в роликах'],
    ])('empty %s (%s, partial %s) → «%s», no retry button (M8)', async (emptyReason, mode, partial, text) => {
        const loader = makeLoader({runUnderstandable: vi.fn(async () => ({status: 'done', items: [], emptyReason, partial, errorCode: null}))});
        const search = mode === 'quote' ? {target: /** @type {import('flib-gateway').ExamplesBatchTarget} */ ({text: 'run fast', mode: 'quote'}), initialRank: /** @type {'plain'} */ ('plain')} : void 0;
        const {panel} = makePanel(loader, {search});
        await panel.start();
        await press(panel);
        expect(undNote(panel).textContent).toBe(text);
        expect(undNote(panel).querySelector('button')).toBeNull();
        expect(undCards(panel)).toStrictEqual([]);
        if (mode === 'quote') { expect(loader.runUnderstandable.mock.calls[0][0].target).toStrictEqual({text: 'run fast', mode: 'quote'}); }
        panel.destroy();
    });

    test.each([
        ['timeout', TOO_SLOW],
        ['failed', TOO_SLOW],
        ['expired', TOO_SLOW],
        ['cancelled', INTERRUPTED],
    ])('job %s → «%s»', async (status, text) => {
        const loader = makeLoader({runUnderstandable: vi.fn(async () => ({status, items: [], emptyReason: null, partial: false, errorCode: null}))});
        const {panel} = makePanel(loader);
        await panel.start();
        await press(panel);
        expect(undNote(panel).textContent).toBe(text);
        expect(undButton(panel).hasAttribute('aria-busy')).toBe(false);
        panel.destroy();
    });

    test.each([
        [flibError('flib_axis_off'), 'Скоро: сервер ещё не включил эту функцию'],
        [flibError('route_profile_missing'), 'Нужен маршрут на сайте Flib с этим ключом'],
        [flibError('flib_job_not_found'), INTERRUPTED],
        [httpError('flib_rate_limited', {retryAfterSec: 30}), 'Слишком часто — попробуйте через 30 с'],
        [flibError('flib_service_unavailable'), 'Сервер недоступен — попробуйте позже'],
    ])('error %s → its text in the note; the section and its list stay; no anki_conf offer', async (error, text) => {
        const loader = makeLoader({runUnderstandable: vi.fn(async () => { throw error; })});
        const {panel} = makePanel(loader, {coreFallback: true});
        await panel.start();
        await press(panel);
        expect(undNote(panel).textContent).toBe(text);
        expect(undNote(panel).querySelector('a')).toBeNull();
        expect(section(panel, 'youtube').querySelectorAll('.ve-gw-yt-list>.ve-gw-yt-card').length).toBe(1);
        expect(section(panel, 'youtube').dataset.state).toBe('ready');
        expect(panel.root.querySelector('.ve-gw-core-fallback')).toBeNull();
        panel.destroy();
    });

    test.each(['understandable_demo_forbidden'])('%s → «“Понятные” доступны с полным ключом» with the buy link', async (code) => {
        const loader = makeLoader({runUnderstandable: vi.fn(async () => { throw httpError(code, {status: 403}); })});
        const {panel} = makePanel(loader);
        await panel.start();
        await press(panel);
        expect(undNote(panel).querySelector('.ve-gw-und-note-text')?.textContent).toBe('«Понятные» доступны с полным ключом');
        const link = /** @type {HTMLAnchorElement} */ (undNote(panel).querySelector('.fc-xp-help a.fc-btn-acc'));
        expect(link.getAttribute('href')).toBe(FLIB_BUY_URL);
        panel.destroy();
    });

    test('a missing key → the key help (bot link) inside the note', async () => {
        const loader = makeLoader({runUnderstandable: vi.fn(async () => { throw flibError('flib_key_missing'); })});
        const {panel} = makePanel(loader);
        await panel.start();
        await press(panel);
        expect(undNote(panel).querySelector('.fc-xp-help')).not.toBeNull();
        expect(undNote(panel).querySelector('.fc-xp-help a.fc-btn-acc')?.getAttribute('href')).not.toBe(FLIB_BUY_URL);
        panel.destroy();
    });

    test('«Отменить» aborts the job signal and clears the note at once; a late answer writes nothing; a new press works', async () => {
        const run = pendingRun({ignoreAbort: true});
        const loader = makeLoader({runUnderstandable: run.fn});
        const {panel} = makePanel(loader);
        await panel.start();
        undButton(panel).click();
        const signal = run.signal();
        const resolveFirst = run.resolve;
        /** @type {HTMLButtonElement} */ (undNote(panel).querySelector('button.ve-gw-und-cancel')).click();
        expect(signal.aborted).toBe(true);
        expect(undNote(panel).textContent).toBe('');
        expect(undButton(panel).hasAttribute('aria-busy')).toBe(false);
        resolveFirst(undDone(UND_ITEMS));
        await panel.whenIdle();
        expect(undCards(panel)).toStrictEqual([]);
        expect(undNote(panel).textContent).toBe('');
        undButton(panel).click();
        expect(run.fn).toHaveBeenCalledTimes(2);
        expect(run.signal()).not.toBe(signal);
        expect(undNote(panel).textContent).toContain(SEARCHING);
        run.resolve(undDone(UND_ITEMS));
        await panel.whenIdle();
        expect(undCards(panel).length).toBe(2);
        panel.destroy();
    });

    test('destroy mid-job aborts the signal; an answer arriving later touches nothing', async () => {
        const run = pendingRun({ignoreAbort: true});
        const {panel} = makePanel(makeLoader({runUnderstandable: run.fn}));
        await panel.start();
        undButton(panel).click();
        const noteHtml = undNote(panel).innerHTML;
        panel.destroy();
        expect(run.signal().aborted).toBe(true);
        run.resolve(undDone(UND_ITEMS));
        await panel.whenIdle();
        expect(undCards(panel)).toStrictEqual([]);
        expect(undNote(panel).innerHTML).toBe(noteHtml);
    });

    test('with the real loader: destroy mid-job → exactly one cancel, no poll after it (Review Focus 1)', async () => {
        /** @type {Array<() => void>} */
        const sleepers = [];
        const api = {
            flibGatewayUnderstandableStart: vi.fn(async () => ({jobId: 'und-7', pollAfterMs: 1000})),
            flibGatewayUnderstandablePoll: vi.fn(async () => ({status: 'running', partial: false, errorCode: null, results: null})),
            flibGatewayUnderstandableCancel: vi.fn(async () => {}),
        };
        let t = 0;
        const realLoader = new GatewayExamplesLoader(/** @type {import('../ext/js/comm/api.js').API} */ (/** @type {unknown} */ (api)), {
            now: () => t,
            sleep: (ms) => new Promise((resolve) => {
                sleepers.push(() => {
                    t += ms;
                    resolve();
                });
            }),
        });
        const fake = makeLoader();
        const loader = {
            ...fake,
            runUnderstandable: vi.fn((
                /** @type {{target: import('flib-gateway').ExamplesBatchTarget, excludeVideoIds: string[]}} */ request,
                /** @type {{signal?: AbortSignal}} */ options,
            ) => realLoader.runUnderstandable(request, options)),
        };
        const {panel} = makePanel(loader);
        await panel.start();
        undButton(panel).click();
        await vi.waitFor(() => { expect(sleepers.length).toBe(1); });
        /** @type {() => void} */ (sleepers.shift())();
        await vi.waitFor(() => { expect(sleepers.length).toBe(1); });
        expect(api.flibGatewayUnderstandablePoll).toHaveBeenCalledTimes(1);
        panel.destroy();
        expect(api.flibGatewayUnderstandableCancel.mock.calls).toStrictEqual([['und-7']]);
        await panel.whenIdle();
        for (const wake of sleepers.splice(0)) { wake(); }
        await panel.whenIdle();
        expect(api.flibGatewayUnderstandablePoll).toHaveBeenCalledTimes(1);
        expect(api.flibGatewayUnderstandableCancel).toHaveBeenCalledTimes(1);
    });

    test('_youTubeTexts stays bounded: replaced known cards are forgotten (Task 3 review)', async () => {
        const loader = makeLoader({loadBatch: vi.fn(async () => ({items: KNOWN_ITEMS, emptyReason: null, knownSource: 'pending', partial: false}))});
        const {panel} = makePanel(loader);
        await panel.start();
        for (let i = 0; i < 10; ++i) {
            knownButton(panel).click();
            await panel.whenIdle();
            knownButton(panel).click();
            await panel.whenIdle();
        }
        expect(loader.loadBatch).toHaveBeenCalledTimes(10);
        /* eslint-disable no-underscore-dangle */
        // 1 plain + 2 known (the last answer only).
        expect(panel._youTubeTexts.length).toBe(3);
        await press(panel);
        // + 1 «понятный» line (the second card has no hits).
        expect(panel._youTubeTexts.length).toBe(4);
        panel.destroy();
        expect(panel._youTubeTexts.length).toBe(0);
        /* eslint-enable no-underscore-dangle */
    });
});

// ---------------------------------------------------------------------------
// Final fix wave (K1, K3, K5, K6, K7, K9).
// ---------------------------------------------------------------------------

/**
 * @param {GatewayExamplesPanel} panel
 * @returns {HTMLButtonElement}
 */
function fixKnownButton(panel) {
    return /** @type {HTMLButtonElement} */ (section(panel, 'youtube').querySelector('.ve-gw-section-tools button.ve-gw-known'));
}

/**
 * @param {GatewayExamplesPanel} panel
 * @returns {string[]}
 */
function fixRefs(panel) {
    return [...section(panel, 'youtube').querySelectorAll('.ve-gw-yt-list .ve-gw-yt-card')].map((c) => /** @type {HTMLElement} */ (c).dataset.ref ?? '');
}

describe('K1: showRank switches the live panel in place; examplesRank follows the view', () => {
    test('plain panel: showRank known → the known list (one request); plain → stored list; known again → cached, no request', async () => {
        const loader = makeLoader();
        const {panel} = makePanel(loader);
        await panel.start();
        expect(panel.rank).toBe('plain');
        expect(panel.root.dataset.examplesRank).toBe('plain');
        expect(panel.showRank('known')).toBe(true);
        await panel.whenIdle();
        expect(fixRefs(panel)).toEqual([REF2, REF3]);
        expect(panel.rank).toBe('known');
        expect(panel.root.dataset.examplesRank).toBe('known');
        expect(fixKnownButton(panel).getAttribute('aria-pressed')).toBe('true');
        expect(panel.showRank('plain')).toBe(true);
        await panel.whenIdle();
        expect(fixRefs(panel)).toEqual([REF]);
        expect(panel.root.dataset.examplesRank).toBe('plain');
        expect(panel.showRank('known')).toBe(true);
        await panel.whenIdle();
        expect(fixRefs(panel)).toEqual([REF2, REF3]);
        expect(loader.loadBatch).toHaveBeenCalledTimes(1);
        expect(loader.loadYouTube).toHaveBeenCalledTimes(1);
        expect(loader.loadFilms).toHaveBeenCalledTimes(1);
        panel.destroy();
    });

    test('showRank with the rank already on screen changes nothing', async () => {
        const loader = makeLoader();
        const {panel} = makePanel(loader);
        await panel.start();
        expect(panel.showRank('plain')).toBe(true);
        await panel.whenIdle();
        expect(loader.loadBatch).not.toHaveBeenCalled();
        expect(fixRefs(panel)).toEqual([REF]);
        panel.destroy();
    });

    test('the in-panel toggle moves root.dataset.examplesRank (the toolbar highlight)', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        fixKnownButton(panel).click();
        await panel.whenIdle();
        expect(panel.root.dataset.examplesRank).toBe('known');
        fixKnownButton(panel).click();
        await panel.whenIdle();
        expect(panel.root.dataset.examplesRank).toBe('plain');
        panel.destroy();
    });

    test('initialRank known: the rank is known from the start, also while the first load runs', () => {
        const loader = makeLoader({loadBatch: vi.fn(() => new Promise(() => {}))});
        const {panel} = makePanel(loader, {search: {target: {text: 'call it a day', mode: 'quote'}, initialRank: 'known'}});
        void panel.start();
        expect(panel.rank).toBe('known');
        expect(panel.root.dataset.examplesRank).toBe('known');
        panel.destroy();
    });

    test('initialRank known whose first load failed: showRank plain asks the ordinary list (no known retry)', async () => {
        const loadBatch = vi.fn(async (_target, rank) => {
            if (rank === 'known') { throw httpError('flib_service_unavailable', {status: 503}); }
            return {items: [{...KNOWN_ITEMS[0], ref: REF, known_share: null}], emptyReason: null, knownSource: 'none', partial: false};
        });
        const loader = makeLoader({loadBatch});
        const {panel} = makePanel(loader, {search: {target: {text: 'call it a day', mode: 'quote'}, initialRank: 'known'}});
        await panel.start();
        expect(panel.showRank('plain')).toBe(true);
        await panel.whenIdle();
        expect(loadBatch.mock.calls.map((c) => c[1])).toEqual(['known', 'plain']);
        expect(fixRefs(panel)).toEqual([REF]);
        expect(panel.root.dataset.examplesRank).toBe('plain');
        panel.destroy();
    });

    test('while the first YouTube load runs, showRank refuses (false): the caller remounts', () => {
        const loader = makeLoader({loadYouTube: vi.fn(() => new Promise(() => {}))});
        const {panel} = makePanel(loader);
        void panel.start();
        expect(panel.showRank('known')).toBe(false);
        expect(loader.loadBatch).not.toHaveBeenCalled();
        panel.destroy();
    });

    test('a destroyed panel refuses showRank', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        panel.destroy();
        expect(panel.showRank('known')).toBe(false);
    });
});

describe('K3: an answered known result is cached per panel (no quota re-spend)', () => {
    const NONE = 'Ранжирование по знакомым словам сейчас недоступно — для него нужен маршрут на сайте Flib с этим ключом';

    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {string}
     */
    const noteText = (panel) => section(panel, 'youtube').querySelector('.ve-gw-known-note')?.textContent ?? '';

    test('known_source none: three presses → one loadBatch; the «none» note comes back with the cached list', async () => {
        const loader = makeLoader({loadBatch: vi.fn(async () => ({items: KNOWN_ITEMS, emptyReason: null, knownSource: 'none', partial: false}))});
        const {panel} = makePanel(loader);
        await panel.start();
        for (let i = 0; i < 3; ++i) {
            fixKnownButton(panel).click();
            await panel.whenIdle();
            expect(fixRefs(panel)).toEqual([REF2, REF3]);
            expect(noteText(panel)).toBe(NONE);
            fixKnownButton(panel).click();
            await panel.whenIdle();
            expect(fixRefs(panel)).toEqual([REF]);
        }
        expect(loader.loadBatch).toHaveBeenCalledTimes(1);
        panel.destroy();
    });

    test('an empty answer with a final reason: re-press shows the same text with no request', async () => {
        const loader = makeLoader({loadBatch: vi.fn(async () => ({items: [], emptyReason: 'not_in_corpus', knownSource: 'route', partial: false}))});
        const {panel} = makePanel(loader);
        await panel.start();
        fixKnownButton(panel).click();
        await panel.whenIdle();
        const text = noteText(panel);
        expect(text.length).toBeGreaterThan(0);
        for (let i = 0; i < 2; ++i) {
            fixKnownButton(panel).click();
            await panel.whenIdle();
            expect(noteText(panel)).toBe(text);
            expect(fixKnownButton(panel).getAttribute('aria-pressed')).toBe('false');
        }
        expect(loader.loadBatch).toHaveBeenCalledTimes(1);
        panel.destroy();
    });

    test.each([
        ['budget_exhausted', false],
        ['quota_exhausted', false],
        [null, true],
    ])('empty with %s (partial %s) is not final: the next press asks again', async (emptyReason, partial) => {
        const loader = makeLoader({loadBatch: vi.fn(async () => ({items: [], emptyReason, knownSource: 'route', partial}))});
        const {panel} = makePanel(loader);
        await panel.start();
        fixKnownButton(panel).click();
        await panel.whenIdle();
        fixKnownButton(panel).click();
        await panel.whenIdle();
        expect(loader.loadBatch).toHaveBeenCalledTimes(2);
        panel.destroy();
    });

    test('partial with items and errors are not cached', async () => {
        let call = 0;
        const loader = makeLoader({loadBatch: vi.fn(async () => {
            ++call;
            if (call === 1) { throw httpError('flib_service_unavailable', {status: 503}); }
            return {items: KNOWN_ITEMS, emptyReason: null, knownSource: 'route', partial: true};
        })});
        const {panel} = makePanel(loader);
        await panel.start();
        fixKnownButton(panel).click();
        await panel.whenIdle();
        fixKnownButton(panel).click();
        await panel.whenIdle();
        expect(fixRefs(panel)).toEqual([REF2, REF3]);
        fixKnownButton(panel).click();
        await panel.whenIdle();
        fixKnownButton(panel).click();
        await panel.whenIdle();
        expect(loader.loadBatch).toHaveBeenCalledTimes(3);
        panel.destroy();
    });
});

describe('K5: phrase «Примеры» (plain quote batch) errors use the knowledge texts and keep the anki_conf offer', () => {
    const PHRASE = /** @type {const} */ ({target: {text: 'as far as I know', mode: 'quote'}, initialRank: 'plain'});

    test.each([
        [httpError('flib_rate_limited', {status: 429, retryAfterSec: 7}), 'Слишком часто — попробуйте через 7 с'],
        [httpError('flib_service_unavailable', {status: 503, retryAfterSec: 7}), 'Сервер недоступен — попробуйте позже'],
        [httpError('flib_http_error', {status: 500}), 'Сервер недоступен — попробуйте позже'],
    ])('%s → %s, with «Показать через Flibooster»', async (error, text) => {
        const loader = makeLoader({loadBatch: vi.fn(async () => { throw error; })});
        const {panel} = makePanel(loader, {coreFallback: true, search: PHRASE});
        await panel.start();
        expect(section(panel, 'youtube').querySelector('.ve-gw-section-message')?.textContent).toBe(text);
        expect(section(panel, 'youtube').dataset.state).toBe('error');
        expect(panel.root.querySelector('.ve-gw-core-fallback')).not.toBeNull();
        panel.destroy();
    });

    test('the main window (lemma) keeps its old wording', async () => {
        const loader = makeLoader({loadYouTube: vi.fn(async () => { throw httpError('flib_service_unavailable', {status: 503, retryAfterSec: 7}); })});
        const {panel} = makePanel(loader, {coreFallback: true});
        await panel.start();
        expect(section(panel, 'youtube').querySelector('.ve-gw-section-message')?.textContent).toBe('Сервис примеров YouTube временно недоступен');
        panel.destroy();
    });
});

describe('K6, K9: «Понятные» wording', () => {
    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {HTMLButtonElement}
     */
    const undButton = (panel) => /** @type {HTMLButtonElement} */ (section(panel, 'youtube').querySelector('.ve-gw-section-tools button.ve-gw-understandable'));
    /**
     * @param {GatewayExamplesPanel} panel
     * @returns {HTMLElement}
     */
    const undNote = (panel) => /** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('.ve-gw-und-note'));

    test('K6: route_forbidden → «Ваш ключ не даёт доступа к «Понятным»» with the standard key help, not the full-key text', async () => {
        const loader = makeLoader({runUnderstandable: vi.fn(async () => { throw httpError('route_forbidden', {status: 403}); })});
        const {panel} = makePanel(loader);
        await panel.start();
        undButton(panel).click();
        await panel.whenIdle();
        expect(undNote(panel).querySelector('.ve-gw-und-note-text')?.textContent).toBe('Ваш ключ не даёт доступа к «Понятным»');
        expect(undNote(panel).querySelector('.fc-xp-help')).not.toBeNull();
        // Polish: the non-buy variant — no «Купить полный ключ» after the neutral headline.
        expect(undNote(panel).textContent).not.toContain('Купить полный ключ');
        expect(undNote(panel).textContent).toContain('Получить ключ в Telegram');
        panel.destroy();
    });

    test('K9: a phrase target → «с этой фразой» in the button title and the none_eligible text', async () => {
        const loader = makeLoader({runUnderstandable: vi.fn(async () => ({status: 'done', items: [], emptyReason: 'none_eligible', partial: false, errorCode: null}))});
        const {panel} = makePanel(loader, {word: 'break the ice', search: {target: {text: 'break the ice', mode: 'quote'}, initialRank: 'plain'}});
        await panel.start();
        expect(undButton(panel).title).toBe('Ролики с этой фразой, понятные вам целиком');
        undButton(panel).click();
        await panel.whenIdle();
        expect(undNote(panel).textContent).toBe('Понятных роликов с этой фразой не нашлось');
        panel.destroy();
    });

    test('K9: a word keeps «с этим словом»', async () => {
        const loader = makeLoader({runUnderstandable: vi.fn(async () => ({status: 'done', items: [], emptyReason: 'none_eligible', partial: false, errorCode: null}))});
        const {panel} = makePanel(loader);
        await panel.start();
        expect(undButton(panel).title).toBe('Ролики с этим словом, понятные вам целиком');
        undButton(panel).click();
        await panel.whenIdle();
        expect(undNote(panel).textContent).toBe('Понятных роликов с этим словом не нашлось');
        panel.destroy();
    });
});

describe('K7: an empty ordinary answer after «Понятные» cards keeps the section ready', () => {
    test('initialRank known → «Понятные» cards → un-press asks the plain list, which is empty: no «0», no empty message', async () => {
        const loadBatch = vi.fn(async (_target, rank) => (rank === 'known' ?
            {items: KNOWN_ITEMS, emptyReason: null, knownSource: 'route', partial: false} :
            {items: [], emptyReason: 'not_in_corpus', knownSource: 'none', partial: false}));
        const loader = makeLoader({loadBatch});
        const {panel} = makePanel(loader, {search: {target: {text: 'call it a day', mode: 'quote'}, initialRank: 'known'}});
        await panel.start();
        /** @type {HTMLButtonElement} */ (section(panel, 'youtube').querySelector('.ve-gw-understandable')).click();
        await panel.whenIdle();
        fixKnownButton(panel).click();
        await panel.whenIdle();
        expect(loadBatch.mock.calls.map((c) => c[1])).toEqual(['known', 'plain']);
        expect(section(panel, 'youtube').dataset.state).toBe('ready');
        expect(section(panel, 'youtube').querySelector('.ve-gw-section-message')?.textContent).toBe('');
        expect(panel.root.querySelector('.fc-tab[data-tab="youtube"] .fc-tab-n')?.textContent).toBe('2');
        panel.destroy();
    });
});

describe('«Открыть в плеере» link', () => {
    /**
     * @param {Element} card
     * @returns {HTMLAnchorElement[]}
     */
    const links = (card) => /** @type {HTMLAnchorElement[]} */ ([...card.querySelectorAll('a.ve-gw-player-link')]);
    /**
     * @param {Element} card
     * @returns {string}
     */
    const hrefOf = (card) => {
        const found = links(card);
        expect(found).toHaveLength(1);
        return found[0].getAttribute('href') ?? '';
    };
    /**
     * @param {Element} card
     * @returns {number}
     */
    const startOf = (card) => Number(new URL(hrefOf(card)).searchParams.get('t') ?? 0);

    /**
     * Plain card, then known cards, then «Понятные»: all three kinds on screen at once.
     * @param {Record<string, import('vitest').Mock>} [overrides]
     * @returns {Promise<{panel: GatewayExamplesPanel, hooks: ReturnType<typeof makePanel>['hooks'], plain: HTMLElement[], known: HTMLElement[], und: HTMLElement[]}>}
     */
    const openAll = async (overrides = {}) => {
        const {panel, hooks} = makePanel(makeLoader(overrides));
        await panel.start();
        const yt = section(panel, 'youtube');
        const plain = /** @type {HTMLElement[]} */ ([...yt.querySelectorAll('.ve-gw-yt-list .ve-gw-yt-card')]);
        /** @type {HTMLButtonElement} */ (yt.querySelector('button.ve-gw-known')).click();
        await panel.whenIdle();
        const known = /** @type {HTMLElement[]} */ ([...yt.querySelectorAll('.ve-gw-yt-list .ve-gw-yt-card')]);
        /** @type {HTMLButtonElement} */ (yt.querySelector('button.ve-gw-understandable')).click();
        await panel.whenIdle();
        const und = /** @type {HTMLElement[]} */ ([...yt.querySelectorAll('div.ve-gw-und-list > .ve-gw-und-card')]);
        return {panel, hooks, plain, known, und};
    };

    test('plain, known and «Понятные» cards each get one link starting at the line second', async () => {
        const {panel, plain, known, und} = await openAll();
        expect(plain).toHaveLength(1);
        expect(hrefOf(plain[0])).toBe(`https://flib.club/player?v=${REF}&t=61`);
        const link = links(plain[0])[0];
        expect(link.textContent).toBe('Открыть в плеере');
        expect(link.getAttribute('target')).toBe('_blank');
        expect(link.getAttribute('rel')).toBe('noopener noreferrer');
        expect(link.querySelector('svg.fc-ico')).not.toBeNull();
        expect(known.map(hrefOf)).toEqual([
            `https://flib.club/player?v=${REF2}&t=1`,
            `https://flib.club/player?v=${REF3}&t=3`,
        ]);
        expect(und.map(hrefOf)).toEqual([
            `https://flib.club/player?v=${REF4}&t=42`,
            `https://flib.club/player?v=${REF5}`,
        ]);
        for (const card of und) { expect(links(card)[0].getAttribute('rel')).toBe('noopener noreferrer'); }
        panel.destroy();
    });

    test('the link is excluded from the popup scanner on every kind of card', async () => {
        const {panel, plain, known, und} = await openAll();
        for (const card of [...plain, ...known, ...und]) {
            expect(links(card)[0].classList.contains('scan-disable')).toBe(true);
        }
        panel.destroy();
    });

    test('the link comes before the checkbox in tab order', async () => {
        const {panel, plain, und} = await openAll();
        for (const card of [...plain, ...und]) {
            const label = /** @type {Element} */ (card.querySelector('.ve-gw-check'));
            expect(links(card)[0].compareDocumentPosition(label) & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
        }
        panel.destroy();
    });

    test('the link second is exactly the second the card saves (plain, known, «Понятные» with and without a hit)', async () => {
        const undItems = [
            {video_id: REF4, title: 'a', channel_id: null, duration_s: null, coverage: null, target_hits: [{from_ms: 42999, to_ms: 45000, text_en: 'You run'}], target_hits_unavailable: false},
            {video_id: REF5, title: 'b', channel_id: null, duration_s: null, coverage: null, target_hits: [], target_hits_unavailable: true},
            {video_id: REF6, title: 'c', channel_id: null, duration_s: null, coverage: null, target_hits: [{from_ms: /** @type {any} */ (null), to_ms: 5000, text_en: 'run'}], target_hits_unavailable: false},
            {video_id: REF7, title: 'd', channel_id: null, duration_s: null, coverage: null, target_hits: [{from_ms: 7500, to_ms: 9000, text_en: ''}], target_hits_unavailable: false},
        ];
        const {panel} = makePanel(makeLoader({runUnderstandable: vi.fn(async () => undDone(undItems))}));
        await panel.start();
        const yt = section(panel, 'youtube');
        /**
         * @param {HTMLElement[]} cards
         */
        const compare = (cards) => {
            expect(cards.length).toBeGreaterThan(0);
            for (const card of cards) { tick(checkboxOf(card)); }
            const byRef = new Map(panel.getSelectedGatewayMedia().youtube.map((c) => [c.ref, c]));
            for (const card of cards) {
                const saved = byRef.get(card.dataset.ref ?? '');
                expect(saved, card.dataset.ref).toBeDefined();
                expect(startOf(card)).toBe(Math.floor((saved?.startMs ?? 0) / 1000));
            }
            for (const card of cards) { tick(checkboxOf(card)); }
            expect(panel.getSelectedGatewayMedia().youtube).toHaveLength(0);
        };
        compare(/** @type {HTMLElement[]} */ ([...yt.querySelectorAll('.ve-gw-yt-list .ve-gw-yt-card')]));
        /** @type {HTMLButtonElement} */ (yt.querySelector('button.ve-gw-known')).click();
        await panel.whenIdle();
        compare(/** @type {HTMLElement[]} */ ([...yt.querySelectorAll('.ve-gw-yt-list .ve-gw-yt-card')]));
        /** @type {HTMLButtonElement} */ (yt.querySelector('button.ve-gw-understandable')).click();
        await panel.whenIdle();
        const und = /** @type {HTMLElement[]} */ ([...yt.querySelectorAll('div.ve-gw-und-list > .ve-gw-und-card')]);
        expect(und).toHaveLength(4);
        compare(und);
        expect(startOf(und[0])).toBe(42);
        expect(startOf(und[1])).toBe(0);
        expect(startOf(und[2])).toBe(0);
        expect(startOf(und[3])).toBe(7);
        panel.destroy();
    });

    test('film cards have no link', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        expect(section(panel, 'films').querySelectorAll('.ve-gw-film-card').length).toBeGreaterThan(0);
        expect(section(panel, 'films').querySelectorAll('a.ve-gw-player-link')).toHaveLength(0);
        panel.destroy();
    });

    test('a «Понятные» card with a bad ref is still rendered, with no link', async () => {
        const {panel} = makePanel(makeLoader({runUnderstandable: vi.fn(async () => undDone([
            {video_id: 'bad', title: 'x', channel_id: null, duration_s: null, coverage: null, target_hits: [], target_hits_unavailable: true},
        ]))}));
        await panel.start();
        const yt = section(panel, 'youtube');
        /** @type {HTMLButtonElement} */ (yt.querySelector('button.ve-gw-understandable')).click();
        await panel.whenIdle();
        const undCards = yt.querySelectorAll('div.ve-gw-und-list > .ve-gw-und-card');
        expect(undCards).toHaveLength(1);
        expect(undCards[0].querySelectorAll('a.ve-gw-player-link')).toHaveLength(0);
        panel.destroy();
    });

    test('click on the link does not open the popup and is not default-prevented by anyone', async () => {
        const {panel, hooks, plain, und} = await openAll();
        for (const card of [...plain, ...und]) {
            const link = links(card)[0];
            /** @type {?boolean} */
            let prevented = null;
            // Runs after the card's and the link's own listeners (same target, registered later); then stops jsdom navigation.
            link.addEventListener('click', (e) => {
                prevented = e.defaultPrevented;
                e.preventDefault();
            });
            link.dispatchEvent(new window.MouseEvent('click', {bubbles: true, cancelable: true}));
            expect(prevented).toBe(false);
        }
        expect(hooks.onYouTubeOpen).not.toHaveBeenCalled();
        panel.destroy();
    });

    test('keys on the link and on the checkbox: no open, no preventDefault; Escape bubbles to the document', async () => {
        const {panel, hooks, known, und} = await openAll();
        document.body.appendChild(panel.root);
        const seen = /** @type {KeyboardEvent[]} */ ([]);
        const onKey = (/** @type {Event} */ e) => { seen.push(/** @type {KeyboardEvent} */ (e)); };
        document.addEventListener('keydown', onKey);
        try {
            for (const card of [...known, ...und]) {
                expect(document.contains(card)).toBe(true);
                for (const target of [links(card)[0], checkboxOf(card)]) {
                    for (const key of ['Enter', ' ', 'Escape']) {
                        const down = new window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true});
                        target.dispatchEvent(down);
                        expect(down.defaultPrevented, `${key} on ${target.tagName}`).toBe(false);
                        expect(seen.at(-1), `${key} reaches document`).toBe(down);
                    }
                }
            }
        } finally {
            document.removeEventListener('keydown', onKey);
            panel.root.remove();
        }
        expect(hooks.onYouTubeOpen).not.toHaveBeenCalled();
        panel.destroy();
    });

    test('Enter and Space on the card itself still open it (plain and «Понятные»)', async () => {
        const {panel, hooks, plain, und} = await openAll();
        for (const card of [plain[0], und[0]]) {
            for (const key of ['Enter', ' ']) {
                const before = hooks.onYouTubeOpen.mock.calls.length;
                const down = new window.KeyboardEvent('keydown', {key, bubbles: true, cancelable: true});
                card.dispatchEvent(down);
                expect(hooks.onYouTubeOpen.mock.calls.length).toBe(before + 1);
                expect(down.defaultPrevented).toBe(true);
            }
        }
        panel.destroy();
    });
});

describe('accessible name of a YouTube card', () => {
    /** @typedef {{title?: ?string, line: ?string, share: ?number}} Case */

    /**
     * The card is a button that opens the YouTube popup: without its own name a screen reader would announce the
     * nested link and checkbox («Открыть в плеере Сохранить…»).
     * @param {HTMLElement} card
     */
    const expectNameOnly = (card) => {
        expect(card.getAttribute('role')).toBe('button');
        expect(card.getAttribute('aria-label')).not.toContain('плеер');
        expect(card.getAttribute('aria-label')).not.toContain('Сохранить');
        // The order in the DOM: the link, then the checkbox.
        const link = /** @type {Element} */ (card.querySelector('a.ve-gw-player-link'));
        const label = /** @type {Element} */ (card.querySelector('.ve-gw-check'));
        expect(link.compareDocumentPosition(label) & window.Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    };

    test.each(/** @type {[Case, string][]} */ ([
        [{title: 'Show', line: 'You run the show', share: 0.912}, 'Show, You run the show, понятно 91% фрагмента'],
        [{title: 'Show', line: 'You run the show', share: null}, 'Show, You run the show'],
        [{title: 'Show', line: null, share: 0.912}, 'Show, понятно 91% фрагмента'],
        [{title: 'Show', line: null, share: null}, 'Show'],
        [{title: null, line: 'You run the show', share: 0.912}, 'You run the show, понятно 91% фрагмента'],
        [{title: null, line: 'You run the show', share: null}, 'You run the show'],
        [{title: ' ', line: ' \n', share: 0}, 'понятно 0% фрагмента'],
        [{title: ' ', line: '\u00a0', share: null}, 'Видео YouTube'],
        [{title: null, line: null, share: null}, 'Видео YouTube'],
        [{title: ' <b>T</b> ', line: ' <i>l</i> ', share: null}, '<b>T</b>, <i>l</i>'],
    ]))('an example %j → «%s»', async ({title, line, share}, name) => {
        const item = {source: 'youtube', ref: REF2, start_ms: 1000, end_ms: 2000, text_en: line, text_ru: null, thumbnail_url: null, title, channel: null, fragment: null, known_share: share};
        const loader = makeLoader({loadBatch: vi.fn(async () => ({items: [item], emptyReason: null, knownSource: 'route', partial: false}))});
        const {panel} = makePanel(loader);
        await panel.start();
        /** @type {HTMLButtonElement} */ (section(panel, 'youtube').querySelector('.ve-gw-known')).click();
        await panel.whenIdle();
        const card = /** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('.ve-gw-yt-list .ve-gw-yt-card'));
        expect(card.getAttribute('aria-label')).toBe(name);
        expectNameOnly(card);
        panel.destroy();
    });

    test('a plain example (no title field): the line', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        const card = /** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('.ve-gw-yt-card'));
        expect(card.getAttribute('aria-label')).toBe('I like to run every day');
        expectNameOnly(card);
        panel.destroy();
    });

    test.each(/** @type {[Case, string][]} */ ([
        [{title: 'T', line: 'You run', share: 0.934}, 'T, You run, понятно 93% ролика'],
        [{title: 'T', line: 'You run', share: null}, 'T, You run'],
        [{title: 'T', line: null, share: 0.934}, 'T, понятно 93% ролика'],
        [{title: 'T', line: null, share: null}, 'T'],
        [{title: null, line: 'You run', share: 0.934}, 'You run, понятно 93% ролика'],
        [{title: null, line: 'You run', share: null}, 'You run'],
        [{title: ' ', line: ' ', share: 0.934}, 'понятно 93% ролика'],
        [{title: null, line: null, share: null}, 'Видео YouTube'],
    ]))('a «Понятные» video %j → «%s»', async ({title, line, share}, name) => {
        /** @type {import('flib-gateway').UnderstandableItem} */
        const item = {
            video_id: REF4,
            title: title ?? null,
            channel_id: null,
            duration_s: null,
            coverage: share,
            target_hits: line === null ? [] : [{from_ms: 1000, to_ms: 2000, text_en: line}],
            target_hits_unavailable: false,
        };
        const {panel} = makePanel(makeLoader({runUnderstandable: vi.fn(async () => undDone([item]))}));
        await panel.start();
        /** @type {HTMLButtonElement} */ (section(panel, 'youtube').querySelector('.ve-gw-understandable')).click();
        await panel.whenIdle();
        const card = /** @type {HTMLElement} */ (section(panel, 'youtube').querySelector('.ve-gw-und-card'));
        expect(card.getAttribute('aria-label')).toBe(name);
        expectNameOnly(card);
        panel.destroy();
    });

    test('English: the fallback text', async () => {
        setUiLanguage('en');
        try {
            const item = {source: 'youtube', ref: REF2, start_ms: 1000, end_ms: 2000, text_en: null, text_ru: null, thumbnail_url: null};
            const {panel} = makePanel(makeLoader({loadYouTube: vi.fn(async () => ({items: [item], emptyReason: null}))}));
            await panel.start();
            expect(section(panel, 'youtube').querySelector('.ve-gw-yt-card')?.getAttribute('aria-label')).toBe('YouTube video');
            panel.destroy();
        } finally {
            setUiLanguage('ru');
        }
    });
});
