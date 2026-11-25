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
import {setupDomTest} from './fixtures/dom-test.js';
import {Frontend} from '../ext/js/app/frontend.js';
import {Popup} from '../ext/js/app/popup.js';
import {PopupSizeRegistry} from '../ext/js/app/popup-size-registry.js';

// Настоящие Popup и методы Frontend на событиях, снятых в живых браузерах
// (Chromium 1228 и Firefox 151 в отдельном kwin). Подделаны раскладка (её в
// jsdom нет) и всё, что popup шлёт наружу.

const {window, teardown} = await setupDomTest();
const {document} = window;

/** @typedef {[width: number, height: number]} Size */
/** Окно владельца до видео, экран и промежуточные размеры (замер). */
const WINDOW = /** @type {Size} */ ([1248, 615]);
const SCREEN = /** @type {Size} */ ([1600, 944]);
const ENTER_STEP = /** @type {Size} */ ([1248, 702]);
const EXIT_STEP = /** @type {Size} */ ([1600, 857]);

/** @type {?Element} */
let fullscreenElement = null;
Object.defineProperty(document, 'fullscreenElement', {configurable: true, get: () => fullscreenElement});

vi.stubGlobal('chrome', {runtime: {getURL: (/** @type {string} */ path) => `chrome-extension://id${path}`}});

Object.defineProperty(window, 'matchMedia', {configurable: true, value: () => ({matches: false, addEventListener: () => {}})});
Object.defineProperty(window, 'focus', {configurable: true, value: () => {}});

/** @type {Popup[]} */
let popups = [];
/** @type {Array<() => void>} */
let cleanup = [];

/* eslint-disable no-underscore-dangle, jsdoc/require-returns, @typescript-eslint/unbound-method */

/**
 * @param {Size} size
 */
function setViewport([width, height]) {
    Object.defineProperty(window, 'innerWidth', {configurable: true, value: width});
    Object.defineProperty(window, 'innerHeight', {configurable: true, value: height});
}

/**
 * Дать отработать всем async-цепочкам без хода часов.
 * @returns {Promise<void>}
 */
async function flush() {
    for (let i = 0; i < 10; ++i) { await Promise.resolve(); }
}

/** @param {Size} size */
async function resize(size) {
    setViewport(size);
    window.dispatchEvent(new window.Event('resize'));
    await flush();
}

/** @param {?Element} element */
async function fullscreenChange(element) {
    fullscreenElement = element;
    document.dispatchEvent(new window.Event('fullscreenchange'));
    await flush();
}

/**
 * Вход в полный экран, порядок Chrome: элемент назначен до первого resize.
 * @param {Element} element
 */
async function enterChrome(element) {
    fullscreenElement = element;
    await resize(ENTER_STEP);
    await fullscreenChange(element);
    await resize(SCREEN);
}

/**
 * Выход, порядок Chrome: resize раньше fullscreenchange, элемента уже нет.
 * @param {?Element} [next] Полноэкранный элемент страницы под нашим.
 */
async function exitChrome(next = null) {
    fullscreenElement = next;
    await resize(EXIT_STEP);
    await fullscreenChange(next);
    await resize(WINDOW);
}

/** @param {Element} element */
async function enterFirefox(element) {
    fullscreenElement = element;
    await flush();
    await resize([1600, 1000]);
    await fullscreenChange(element);
}

/**
 * Firefox 151: окно на миг МЕНЬШЕ исходного, fullscreenchange раньше resize.
 * @returns {Promise<void>}
 */
async function exitFirefox() {
    setViewport([1196, 563]);
    await fullscreenChange(null);
    await resize([1196, 563]);
    await resize(WINDOW);
}

/**
 * @param {{depth?: number, shadow?: boolean, displayMode?: 'default'|'full-width'}} [details]
 * @returns {Promise<Popup>}
 */
async function createPopup({depth = 0, shadow = false, displayMode = 'default'} = {}) {
    const application = {
        on: () => {},
        webExtension: {unloaded: false},
        api: {},
        crossFrame: {invoke: async () => {}},
    };
    const popup = new Popup(/** @type {import('../ext/js/application.js').Application} */ (/** @type {unknown} */ (application)), `popup${depth}`, depth, 0, true);
    popup._invokeSafe = async () => void 0;
    popup._injectStyles = async () => {};
    popup._inject = async () => true;
    popup._optionsContext = {current: true};
    popup._initialHeight = 357;
    popup._displayMode = displayMode;
    popup._displayModeIsFullWidth = (displayMode === 'full-width');
    popup.prepare();
    await popup._setUpContainer(shadow);
    const container = /** @type {HTMLElement} */ (popup.container);
    document.body.appendChild(container);
    cleanup.push(() => { container.remove(); });

    // Раскладка: полноэкранный контейнер (или iframe в нём) занимает экран,
    // иначе рамка стоит по своим стилям (box-sizing: border-box).
    const frame = popup._frame;
    const rect = () => {
        if (fullscreenElement === container) {
            return {left: 0, top: 0, width: window.innerWidth, height: window.innerHeight};
        }
        const [left, top, width, height] = [frame.style.left, frame.style.top, frame.style.width, frame.style.height].map((v) => Number.parseFloat(v) || 0);
        return {left, top, width, height};
    };
    const getRect = () => {
        const {left, top, width, height} = rect();
        return {left, top, width, height, right: left + width, bottom: top + height, x: left, y: top, toJSON: () => ({})};
    };
    frame.getBoundingClientRect = getRect;
    Object.defineProperty(frame, 'offsetWidth', {configurable: true, get: () => Math.round(rect().width)});
    Object.defineProperty(frame, 'offsetHeight', {configurable: true, get: () => Math.round(rect().height)});
    popups.push(popup);
    return popup;
}

/** @typedef {{left: number, top: number, right: number, bottom: number}} Rect */
/** @type {Rect} */
const WORD = {left: 542, top: 220, right: 590, bottom: 248};

/**
 * Frontend, чьи методы — настоящие.
 * @param {Popup} popup
 * @param {Rect} word Прямоугольник слова на странице.
 */
function createFrontend(popup, word = WORD) {
    const rects = {word};
    const textSource = {getRects: () => [rects.word], getWritingMode: () => 'horizontal-tb'};
    const context = {
        rects,
        _application: {webExtension: {unloaded: false}},
        _textScanner: {getCurrentTextSource: () => textSource},
        _popup: popup,
        _popupSizeRegistry: new PopupSizeRegistry(),
        _popupOriginalSize: null,
        _popupAppliedSize: null,
        _lastShowPromise: Promise.resolve(),
        _updatePopupPosition: Frontend.prototype._updatePopupPosition,
        _showPopupContent: Frontend.prototype._showPopupContent,
        _applyPopupSizeTarget: Frontend.prototype._applyPopupSizeTarget,
        passive: () => { Frontend.prototype._onResize.call(/** @type {Frontend} */ (/** @type {unknown} */ (context))); },
        /** @param {Rect} [newWord] */
        lookup: async (newWord) => {
            if (typeof newWord !== 'undefined') { rects.word = newWord; }
            await context._showPopupContent.call(
                context,
                /** @type {import('text-source').TextSource} */ (/** @type {unknown} */ (textSource)),
                /** @type {import('settings').OptionsContext} */ ({current: true}),
                /** @type {import('display').ContentDetails} */ (/** @type {unknown} */ ({})),
            );
        },
        /**
         * @param {string} owner
         * @param {number} minWidth
         * @param {number} minHeight
         * @returns {Promise<{width: number, height: number, valid: boolean}>}
         */
        request: async (owner, minWidth, minHeight) => await Frontend.prototype._onApiRequestPopupSize.call(context, {owner, minWidth, minHeight}),
        /**
         * @param {string} owner
         * @returns {Promise<void>}
         */
        release: async (owner) => await Frontend.prototype._onApiReleasePopupSize.call(context, {owner}),
        /**
         * @param {number} minHeight
         * @returns {Promise<void>}
         */
        fit: async (minHeight) => await Frontend.prototype._onApiFitPopupForViewport.call(context, {minHeight}),
    };
    window.addEventListener('resize', context.passive);
    cleanup.push(() => { window.removeEventListener('resize', context.passive); });
    return context;
}

/**
 * Всё, что запрещено менять.
 * @param {Popup} popup
 * @returns {string}
 */
function geometry(popup) {
    const {style, dataset} = popup._frame;
    return JSON.stringify([style.left, style.top, style.width, style.height, dataset.after, dataset.below]);
}

/**
 * @param {Popup} popup
 * @param {Partial<CSSStyleDeclaration>} style
 */
function setStyle(popup, style) {
    Object.assign(popup._frame.style, style);
}

/**
 * Дождаться конца окна ожидания после выхода.
 * @returns {Promise<void>}
 */
async function settle() {
    await vi.advanceTimersByTimeAsync(1100);
    await flush();
}

beforeEach(async () => {
    vi.useFakeTimers();
    fullscreenElement = null;
    popups = [];
    cleanup = [];
    await resize(WINDOW);
    await vi.advanceTimersByTimeAsync(5000);
});

afterEach(async () => {
    fullscreenElement = null;
    for (const popup of popups) { popup.hide(false); }
    document.dispatchEvent(new window.Event('fullscreenchange'));
    await vi.advanceTimersByTimeAsync(5000);
    for (const f of cleanup) { f(); }
    vi.useRealTimers();
});

afterAll(() => teardown(global));

/** @type {Array<[name: string, enter: (element: Element) => Promise<void>, exit: () => Promise<void>]>} */
const browsers = [
    ['Chrome', enterChrome, exitChrome],
    ['Firefox', enterFirefox, exitFirefox],
];

describe.each(browsers)('fullscreen video of our popup, %s event order', (_name, enter, exit) => {
    test.each([
        {shadow: false, displayMode: /** @type {const} */ ('default')},
        {shadow: true, displayMode: /** @type {const} */ ('default')},
        {shadow: false, displayMode: /** @type {const} */ ('full-width')},
        {shadow: true, displayMode: /** @type {const} */ ('full-width')},
    ])('opened, two rounds: the same place and size ($displayMode, shadow: $shadow)', async (details) => {
        const popup = await createPopup(details);
        const frontend = createFrontend(popup);
        await frontend.lookup();
        const before = geometry(popup);
        for (let i = 0; i < 2; ++i) {
            await enter(popup.container);
            expect(geometry(popup)).toBe(before);
            await vi.advanceTimersByTimeAsync(20000);
            expect(geometry(popup)).toBe(before);
            await exit();
            expect(geometry(popup)).toBe(before);
            await settle();
            expect(geometry(popup)).toBe(before);
        }
    });

    test('a second round inside the settle window', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        setStyle(popup, {left: '520px', top: '40px'});
        const before = geometry(popup);
        await enter(popup.container);
        await exit();
        await vi.advanceTimersByTimeAsync(300);
        await enter(popup.container);
        await vi.advanceTimersByTimeAsync(3000); // the first round's timer must not fire here
        expect(geometry(popup)).toBe(before);
        await exit();
        await settle();
        expect(geometry(popup)).toBe(before);
    });

    test('the place and size the user chose by hand stay', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        await Frontend.prototype._onApiSetPopupSize.call(frontend, {width: 520, height: 300});
        setStyle(popup, {left: '610px', top: '35px'});
        const before = geometry(popup);
        await enter(popup.container);
        await exit();
        await settle();
        expect(geometry(popup)).toBe(before);
    });

    test('A: grown by the examples panel → stays, the next word gets the normal width, the panel still releases', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        const opened = [popup._frame.offsetWidth, popup._frame.offsetHeight];
        await frontend.request('video-examples', 820, 500);
        const before = geometry(popup);
        await enter(popup.container);
        await exit();
        await settle();
        expect(geometry(popup)).toBe(before);
        // the panel of the same word asks again → no growth from a polluted base
        await frontend.request('video-examples', 820, 500);
        expect(geometry(popup)).toBe(before);
        await frontend.release('video-examples');
        expect([popup._frame.offsetWidth, popup._frame.offsetHeight]).toEqual(opened);
        await frontend.lookup({left: 100, top: 100, right: 150, bottom: 128});
        expect(popup._frame.style.width).toBe('400px');
    });

    test('B: viewport-fit (YouTube modal) → tall and at the same place; the release returns the old size', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        const opened = [popup._frame.offsetWidth, popup._frame.offsetHeight];
        await frontend.fit(720);
        expect(popup._frame.offsetHeight).toBe(590); // 96 % of 615
        const before = geometry(popup);
        await enter(popup.container);
        await exit();
        await settle();
        expect(geometry(popup)).toBe(before);
        await frontend.release('viewport-fit');
        expect([popup._frame.offsetWidth, popup._frame.offsetHeight]).toEqual(opened);
    });

    test('nested: the child goes fullscreen → the parent keeps its place and does not hide the child', async () => {
        const parent = await createPopup();
        const child = await createPopup({depth: 1});
        parent.child = child;
        child.parent = parent;
        const frontend0 = createFrontend(parent);
        const frontend1 = createFrontend(child, {left: 700, top: 300, right: 740, bottom: 320});
        await frontend0.lookup();
        await frontend1.lookup();
        setStyle(parent, {left: '30px', top: '20px'});
        setStyle(child, {left: '470px', top: '50px'});
        const before = [geometry(parent), geometry(child)];
        for (const popup of [child, parent]) {
            await enter(popup.container);
            await exit();
            await settle();
            expect([geometry(parent), geometry(child)]).toEqual(before);
            expect(child.isVisibleSync()).toBe(true);
        }
    });

    test('a late reposition (proxy frontend of another frame) after the viewport is back is ignored too', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        setStyle(popup, {left: '520px', top: '40px'});
        const before = geometry(popup);
        await enter(popup.container);
        await exit();
        await vi.advanceTimersByTimeAsync(200);
        frontend.passive();
        await settle();
        expect(geometry(popup)).toBe(before);
    });

    test('the window has another size after the exit → exactly one normal reposition with the last details', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        await frontend.request('video-examples', 820, 500);
        setStyle(popup, {left: '10px', top: '40px'});
        const before = geometry(popup);
        await enter(popup.container);
        await exit();
        const show = vi.spyOn(popup, '_show');
        frontend.rects.word = {left: 100, top: 60, right: 140, bottom: 80};
        await resize([1000, 900]);
        frontend.rects.word = {left: 60, top: 70, right: 100, bottom: 90};
        await resize([1100, 800]);
        await vi.advanceTimersByTimeAsync(400);
        expect(geometry(popup)).toBe(before);
        await settle();
        expect(show).toHaveBeenCalledTimes(1);
        expect(show.mock.calls[0][0]).toEqual([{left: 60, top: 70, right: 100, bottom: 90}]);
        expect([popup._frame.style.width, popup._frame.style.height]).toEqual(['820px', '500px']);
        expect([popup._frame.style.left, popup._frame.style.top]).toEqual(['60px', '100px']);
        await settle();
        expect(show).toHaveBeenCalledTimes(1);
        // and from here on as always
        await resize([900, 800]);
        expect(show).toHaveBeenCalledTimes(2);
    });

    test('hidden during the wait → no reposition brings it back', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        await enter(popup.container);
        await exit();
        await resize([1000, 900]);
        popup.hide(false);
        await settle();
        expect(popup.isVisibleSync()).toBe(false);
    });
});

describe('sizes while our container is fullscreen', () => {
    test('a new lookup in fullscreen is shown with the size of the styles, and put into the window after the exit', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        await enterChrome(popup.container);
        await frontend.lookup({left: 1300, top: 100, right: 1340, bottom: 120});
        expect([popup._frame.style.width, popup._frame.style.height]).toEqual(['400px', '357px']);
        expect(popup._frame.style.left).toBe('1200px'); // the fullscreen viewport, as today
        frontend.rects.word = {left: 1100, top: 100, right: 1140, bottom: 120};
        await exitChrome();
        await settle();
        expect([popup._frame.style.left, popup._frame.style.top]).toEqual(['848px', '130px']);
        expect([popup._frame.style.width, popup._frame.style.height]).toEqual(['400px', '357px']);
    });

    test('a new lookup after the exit, before the window is back, gets its place from the final window', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        await enterChrome(popup.container);
        fullscreenElement = null;
        await resize(EXIT_STEP);
        await fullscreenChange(null);
        await frontend.lookup({left: 1300, top: 100, right: 1340, bottom: 120});
        frontend.rects.word = {left: 1100, top: 100, right: 1140, bottom: 120};
        await resize(WINDOW);
        await settle();
        expect([popup._frame.style.left, popup._frame.style.top]).toEqual(['848px', '130px']);
    });

    test('getFrameSize is the size of the styles (whole pixels, like offsetWidth)', async () => {
        for (const shadow of [false, true]) {
            const popup = await createPopup({shadow});
            setStyle(popup, {left: '10px', top: '10px', width: '400px', height: '356.828px'});
            const normal = await popup.getFrameSize();
            await enterChrome(popup.container);
            expect(await popup.getFrameSize()).toEqual(normal);
            expect(normal).toEqual({width: 400, height: 357, valid: true});
            await exitChrome();
            await settle();
        }
    });

    test('the arbiter: base and caps of the window before the video, in fullscreen and while settling', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        const caps = {width: Math.floor(1248 * 0.96), height: Math.floor(615 * 0.96)};
        await enterChrome(popup.container);
        expect(await frontend.request('translation-column', 5000, 5000)).toEqual({...caps, valid: true});
        // the card must not hang out of the window it comes back to
        expect([popup._frame.style.left, popup._frame.style.top]).toEqual([`${1248 - caps.width}px`, `${615 - caps.height}px`]);
        fullscreenElement = null;
        await resize(EXIT_STEP);
        expect(await frontend.request('translation-column', 6000, 6000)).toEqual({...caps, valid: true});
        await fullscreenChange(null);
        await resize(WINDOW);
        await settle();
        await frontend.release('translation-column');
        expect([popup._frame.offsetWidth, popup._frame.offsetHeight]).toEqual([400, 357]);
    });

    test('frontendFitPopupForViewport in fullscreen: the cap and the place of the window before the video', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        await enterChrome(popup.container);
        await frontend.fit(720);
        expect(popup._frame.style.height).toBe('590px');
        expect(popup._frame.style.top).toBe('17px'); // 615 - 8 - 590
        await exitChrome();
        await settle();
        expect([popup._frame.style.height, popup._frame.style.top]).toEqual(['590px', '17px']);
    });
});

describe('everything else is as before', () => {
    test('an ordinary window resize repositions at once', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        setStyle(popup, {left: '20px', top: '20px'});
        frontend.rects.word = {left: 300, top: 100, right: 340, bottom: 120};
        await resize([1000, 900]);
        expect([popup._frame.style.left, popup._frame.style.top]).toEqual(['300px', '130px']);
    });

    test('a passive reposition without any resize (scroll, zoom) works', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        setStyle(popup, {left: '20px', top: '20px'});
        frontend.passive();
        await flush();
        expect(popup._frame.style.left).toBe('542px');
    });

    test('a fullscreen element of the page: every resize repositions, on the way in and out', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        const show = vi.spyOn(popup, '_show');
        await enterChrome(document.createElement('video'));
        expect(show).toHaveBeenCalledTimes(2);
        setStyle(popup, {left: '20px', top: '20px'});
        await exitChrome();
        expect(show).toHaveBeenCalledTimes(4);
        expect(popup._frame.style.left).toBe('542px');
        await settle();
        expect(show).toHaveBeenCalledTimes(4);
    });

    test('our video inside a fullscreen player of the page: back to the player → nothing moves', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        const player = document.createElement('div');
        document.body.appendChild(player);
        cleanup.push(() => { player.remove(); });
        await enterChrome(player);
        await frontend.lookup();
        setStyle(popup, {left: '900px', top: '500px'});
        const before = geometry(popup);
        await vi.advanceTimersByTimeAsync(5000);
        await fullscreenChange(popup.container);
        frontend.passive();
        await flush();
        await fullscreenChange(player);
        frontend.passive();
        await settle();
        expect(geometry(popup)).toBe(before);
        frontend.passive();
        await flush();
        expect(popup._frame.style.left).toBe('542px');
    });

    test('any order on the way in: resizes before the element is set are undone', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        setStyle(popup, {left: '520px', top: '40px'});
        const before = geometry(popup);
        await resize(ENTER_STEP);
        await vi.advanceTimersByTimeAsync(50);
        await resize(SCREEN);
        expect(geometry(popup)).not.toBe(before);
        await fullscreenChange(popup.container);
        expect(geometry(popup)).toBe(before);
        await exitChrome();
        await settle();
        expect(geometry(popup)).toBe(before);
    });

    test('what came after the early resize is not undone: a new word, a size asked for', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        for (const change of [
            async () => { await frontend.lookup({left: 100, top: 60, right: 140, bottom: 80}); },
            async () => { await frontend.request('video-examples', 820, 500); },
        ]) {
            await frontend.lookup();
            await vi.advanceTimersByTimeAsync(3000);
            await resize(ENTER_STEP);
            await change();
            const before = geometry(popup);
            await fullscreenChange(popup.container);
            expect(geometry(popup)).toBe(before);
            await exitChrome();
            await settle();
        }
    });

    test('an old reposition is not undone by an early resize which moved nothing', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        frontend.passive();
        await flush();
        setStyle(popup, {left: '20px', top: '20px'});
        const before = geometry(popup);
        await vi.advanceTimersByTimeAsync(3000);
        window.removeEventListener('resize', frontend.passive);
        await resize(SCREEN);
        await fullscreenChange(popup.container);
        expect(geometry(popup)).toBe(before);
    });

    test('details held in one round are not used in the next', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        await enterChrome(popup.container);
        await exitChrome();
        await settle();
        window.removeEventListener('resize', frontend.passive);
        await frontend.lookup({left: 100, top: 60, right: 140, bottom: 80});
        const before = geometry(popup);
        await enterChrome(popup.container);
        await exitChrome();
        await resize([1000, 900]);
        await settle();
        expect(geometry(popup)).toBe(before);
    });

    test('a window resized well before the video is not undone', async () => {
        const popup = await createPopup();
        const frontend = createFrontend(popup);
        await frontend.lookup();
        await resize([1000, 900]);
        const before = geometry(popup);
        await vi.advanceTimersByTimeAsync(3000);
        await enterChrome(popup.container);
        fullscreenElement = null;
        await resize(EXIT_STEP);
        await fullscreenChange(null);
        await resize([1000, 900]);
        await settle();
        expect(geometry(popup)).toBe(before);
    });
});
/* eslint-enable no-underscore-dangle, jsdoc/require-returns, @typescript-eslint/unbound-method */
