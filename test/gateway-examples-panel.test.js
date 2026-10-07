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
import {GATEWAY_SAVE_NOTE_TEXT, GatewayExamplesPanel} from '../ext/js/display/gateway-examples-panel.js';
import {setupDomTest} from './fixtures/dom-test.js';

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

/** @type {import('flib-gateway-examples').FilmClip[]} */
const FILM_CLIPS = [
    {clipId: 'c1', orderIndex: 0, status: 'queued', error: null, subs: [{rel_start_ms: 0, rel_end_ms: 900, text: 'You run fast'}], trimDurationSec: 4, year: 1995, cefr: 'B1'},
    {clipId: 'c2', orderIndex: 1, status: 'failed', error: 'x', subs: [], trimDurationSec: 3, year: null, cefr: null},
];

/** @type {import('flib-gateway').ClipInfo} */
const READY_INFO = {clip_id: 'c1', status: 'ready', duration_sec: 10, lead_trim_sec: 1, size_bytes: 3, download_url: null};

/**
 * @param {Partial<Record<'loadYouTube'|'loadFilms'|'loadClipMedia', import('vitest').Mock>>} overrides
 * @returns {Record<'loadYouTube'|'loadFilms'|'loadClipMedia', import('vitest').Mock>}
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
        ...overrides,
    };
}

/**
 * @param {ReturnType<typeof makeLoader>} loader
 * @param {{coreFallback?: boolean, canFallbackToCore?: boolean, word?: string, highlightForms?: string[]}} [options]
 * @returns {{panel: GatewayExamplesPanel, hooks: {onCancel: import('vitest').Mock, onRetry: import('vitest').Mock, onYouTubeOpen: import('vitest').Mock, onCoreFallback?: import('vitest').Mock}}}
 */
function makePanel(loader, {coreFallback = false, canFallbackToCore = true, word = 'run', highlightForms} = {}) {
    const entry = window.document.createElement('div');
    window.document.body.appendChild(entry);
    /** @type {{onCancel: import('vitest').Mock, onRetry: import('vitest').Mock, onYouTubeOpen: import('vitest').Mock, onCoreFallback?: import('vitest').Mock}} */
    const hooks = {onCancel: vi.fn(), onRetry: vi.fn(), onYouTubeOpen: vi.fn()};
    if (coreFallback) { hooks.onCoreFallback = vi.fn(); }
    const panel = new GatewayExamplesPanel(entry, word, hooks, {
        loader: /** @type {import('../ext/js/display/gateway-examples-loader.js').GatewayExamplesLoader} */ (/** @type {unknown} */ (loader)),
        highlightForms,
        canFallbackToCore: () => canFallbackToCore,
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

let blobCounter = 0;
const createObjectURL = vi.fn(() => `blob:test/${++blobCounter}`);
const revokeObjectURL = vi.fn();
beforeEach(() => {
    blobCounter = 0;
    createObjectURL.mockClear();
    revokeObjectURL.mockClear();
    URL.createObjectURL = createObjectURL;
    URL.revokeObjectURL = revokeObjectURL;
});
afterEach(() => {
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
    test('no selection checkboxes; the save note is shown; nothing is selectable', async () => {
        const {panel} = makePanel(makeLoader());
        await panel.start();
        expect(panel.root.querySelectorAll('input[type="checkbox"]').length).toBe(0);
        expect(panel.root.textContent).toContain(GATEWAY_SAVE_NOTE_TEXT);
        expect(GATEWAY_SAVE_NOTE_TEXT).toBe('Сохранение в карточку — только для примеров через anki_conf');
        expect(panel.getSelectedClipIds()).toEqual([]);
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

describe('«Показать через anki_conf» fallback (review M5)', () => {
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
        expect(buttons[0].textContent).toBe('Показать через anki_conf');
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
