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


import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {afterAll, describe, expect, test, vi} from 'vitest';
import {setupDomTest} from './fixtures/dom-test.js';
import {Frontend} from '../ext/js/app/frontend.js';
import {Popup} from '../ext/js/app/popup.js';
import {PopupFactory} from '../ext/js/app/popup-factory.js';
import {EventListenerCollection} from '../ext/js/core/event-listener-collection.js';

const {window, teardown} = await setupDomTest();
const {document} = window;
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/** @type {?Element} */
let currentFullscreenElement = null;
Object.defineProperty(document, 'fullscreenElement', {configurable: true, get: () => currentFullscreenElement});

/* eslint-disable no-underscore-dangle */
// Как в popup-size-target.test.js: методы с прототипов, `this` — простой
// объект только с теми полями, которые методы трогают.

/**
 * @typedef {object} FakePopup
 * @property {?Element} container
 * @property {import('vitest').Mock} setOptionsContext
 * @property {import('vitest').Mock} on
 * @property {import('vitest').Mock} off
 */

/**
 * @param {?Element} container
 * @returns {FakePopup}
 */
function createPopup(container) {
    return {container, setOptionsContext: vi.fn(async () => {}), on: vi.fn(), off: vi.fn()};
}

/**
 * Фабрика с настоящим isPopupContainer поверх карты попапов.
 * @param {FakePopup[]} popups
 * @returns {{_popups: Map<string, FakePopup>, isPopupContainer: (element: Element) => boolean}}
 */
function createFactory(popups) {
    const factory = {
        _popups: new Map(popups.map((p, i) => [`p${i}`, p])),
        /**
         * @param {Element} element
         * @returns {boolean}
         */
        isPopupContainer(element) {
            return PopupFactory.prototype.isPopupContainer.call(/** @type {PopupFactory} */ (/** @type {unknown} */ (factory)), element);
        },
    };
    return factory;
}

/**
 * Frontend-заглушка: настоящие _onFullscreenChanged и _updatePopup.
 * @param {{factory: ReturnType<typeof createFactory>, popup: ?FakePopup, cache: Record<string, ?FakePopup>, isChildFrame?: boolean}} details
 * @returns {import('core').UnknownObject & {_popup: ?FakePopup, _clearSelection: import('vitest').Mock, fullscreenChanged: () => Promise<void>}}
 */
function createFrontend({factory, popup, cache, isChildFrame = false}) {
    /** @type {import('core').UnknownObject & {_popup: ?FakePopup, _clearSelection: import('vitest').Mock, fullscreenChanged: () => Promise<void>}} */
    const context = {
        _options: {general: {usePopupWindow: false, showIframePopupsInRootFrame: true}},
        _useProxyPopup: false,
        _canUseWindowPopup: true,
        _allowRootFramePopupProxy: isChildFrame,
        _isChildFrameForTest: isChildFrame,
        _popupCache: new Map(Object.entries(cache).map(([k, v]) => [k, Promise.resolve(v)])),
        _popup: popup,
        _popupFactory: factory,
        _ownPopupFullscreen: false,
        _updatePopupToken: null,
        _popupEventListeners: new EventListenerCollection(),
        _isPointerOverPopup: false,
        _getOptionsContext: async () => ({index: 0}),
        _clearSelection: vi.fn(),
        _onPopupFramePointerOver: () => {},
        _onPopupFramePointerOut: () => {},
        // eslint-disable-next-line @typescript-eslint/unbound-method
        _updatePopup: Frontend.prototype._updatePopup,
        fullscreenChanged: () => /** @type {Promise<void>} */ (Frontend.prototype._onFullscreenChanged.call(context)),
    };
    return context;
}

/**
 * @param {ReturnType<typeof createFrontend>} frontend
 * @param {?Element} element
 */
async function fire(frontend, element) {
    currentFullscreenElement = element;
    await frontend.fullscreenChanged();
}

afterAll(() => teardown(global));

describe('Frontend._onFullscreenChanged', () => {
    test('the listener registered in prepare() is _onFullscreenChanged, not _updatePopup', () => {
        const code = fs.readFileSync(path.join(root, 'ext', 'js', 'app', 'frontend.js'), {encoding: 'utf8'});
        expect(code).toContain('addFullscreenChangeEventListener(this._onFullscreenChanged.bind(this));');
        expect(code).not.toContain('addFullscreenChangeEventListener(this._updatePopup');
    });

    test('our popup iframe enters fullscreen and exits → no setOptionsContext (no Display searchLast)', async () => {
        const popup = createPopup(document.createElement('iframe'));
        const frontend = createFrontend({factory: createFactory([popup]), popup, cache: {default: popup}});
        await fire(frontend, popup.container);
        await fire(frontend, null);
        expect(popup.setOptionsContext).not.toHaveBeenCalled();
        expect(frontend._popup).toBe(popup);
    });

    test('shadow-DOM popup: the fullscreen element is the closed shadow host → skipped', async () => {
        const host = document.createElement('div');
        host.attachShadow({mode: 'closed'}).appendChild(document.createElement('iframe'));
        const popup = createPopup(host);
        const frontend = createFrontend({factory: createFactory([popup]), popup, cache: {default: popup}});
        await fire(frontend, host);
        await fire(frontend, null);
        expect(popup.setOptionsContext).not.toHaveBeenCalled();
    });

    test('nested popup (depth 1) created by this frame\'s factory is ours too', async () => {
        const depth0 = createPopup(document.createElement('iframe'));
        const depth1 = createPopup(document.createElement('iframe'));
        const frontend = createFrontend({factory: createFactory([depth0, depth1]), popup: depth0, cache: {default: depth0}});
        await fire(frontend, depth1.container);
        await fire(frontend, null);
        expect(depth0.setOptionsContext).not.toHaveBeenCalled();
    });

    test('a page element (its own <video>) goes fullscreen and back → setOptionsContext both times', async () => {
        const popup = createPopup(document.createElement('iframe'));
        const frontend = createFrontend({factory: createFactory([popup]), popup, cache: {default: popup}});
        await fire(frontend, document.createElement('video'));
        await fire(frontend, null);
        expect(popup.setOptionsContext).toHaveBeenCalledTimes(2);
    });

    test('a foreign iframe with the same class is not ours', async () => {
        const popup = createPopup(document.createElement('iframe'));
        const foreign = document.createElement('iframe');
        foreign.className = 'yomitan-popup';
        const frontend = createFrontend({factory: createFactory([popup]), popup, cache: {default: popup}});
        await fire(frontend, foreign);
        expect(popup.setOptionsContext).toHaveBeenCalledTimes(1);
    });

    test('child frame: page fullscreen → own clip fullscreen → full exit restores the root-frame proxy popup', async () => {
        const parentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent');
        Object.defineProperty(window, 'parent', {configurable: true, get: () => ({})});
        try {
            const proxy = createPopup(null); // PopupProxy: container null
            const local = createPopup(document.createElement('iframe'));
            const frontend = createFrontend({factory: createFactory([local]), popup: proxy, cache: {iframe: proxy, default: local}, isChildFrame: true});
            // 1) the page's own video in this frame goes fullscreen → switch to the local popup
            const pageVideo = document.createElement('video');
            await fire(frontend, pageVideo);
            expect(frontend._popup).toBe(local);
            expect(local.setOptionsContext).toHaveBeenCalledTimes(1);
            // 2) a clip inside our local popup goes fullscreen → same popup, no re-render
            await fire(frontend, local.container);
            // 3) clip exits back to the page video → still no re-render
            await fire(frontend, pageVideo);
            expect(local.setOptionsContext).toHaveBeenCalledTimes(1);
            // 4) full exit → back to the proxy popup in the root frame
            await fire(frontend, null);
            expect(frontend._popup).toBe(proxy);
            expect(proxy.setOptionsContext).toHaveBeenCalledTimes(1);
        } finally {
            if (typeof parentDescriptor !== 'undefined') { Object.defineProperty(window, 'parent', parentDescriptor); }
        }
    });

    test('child frame: Esc straight from own clip fullscreen to none still restores the proxy', async () => {
        const parentDescriptor = Object.getOwnPropertyDescriptor(window, 'parent');
        Object.defineProperty(window, 'parent', {configurable: true, get: () => ({})});
        try {
            const proxy = createPopup(null);
            const local = createPopup(document.createElement('iframe'));
            const frontend = createFrontend({factory: createFactory([local]), popup: proxy, cache: {iframe: proxy, default: local}, isChildFrame: true});
            await fire(frontend, document.createElement('video'));
            await fire(frontend, local.container);
            await fire(frontend, null);
            expect(frontend._popup).toBe(proxy);
        } finally {
            if (typeof parentDescriptor !== 'undefined') { Object.defineProperty(window, 'parent', parentDescriptor); }
        }
    });

    test('proxy/window popup (container null) or no popup yet → unchanged behaviour', async () => {
        for (const popup of [createPopup(null), null]) {
            const local = createPopup(document.createElement('iframe'));
            const frontend = createFrontend({factory: createFactory([]), popup, cache: {default: local}});
            await fire(frontend, document.createElement('iframe'));
            await fire(frontend, null);
            expect(local.setOptionsContext).toHaveBeenCalledTimes(2);
        }
    });
});

describe('PopupFactory.isPopupContainer', () => {
    test('true only for containers of popups this factory created; null containers never match', () => {
        const a = createPopup(document.createElement('iframe'));
        const proxy = createPopup(null);
        const factory = createFactory([a, proxy]);
        expect(factory.isPopupContainer(/** @type {Element} */ (a.container))).toBe(true);
        expect(factory.isPopupContainer(document.createElement('iframe'))).toBe(false);
    });
});

describe('Popup._onFullscreenChanged (container re-parenting)', () => {
    /**
     * @param {Element} container
     * @returns {import('core').UnknownObject & {_container: Element}}
     */
    function createPopupContext(container) {
        return {
            _container: container,
            _containerIsFullscreen: false,
            // eslint-disable-next-line @typescript-eslint/unbound-method
            _getFrameParentElement: Popup.prototype._getFrameParentElement,
        };
    }
    /**
     * @param {import('core').UnknownObject} context
     * @param {?Element} element
     */
    function firePopup(context, element) {
        currentFullscreenElement = element;
        Popup.prototype._onFullscreenChanged.call(context);
    }

    test('page fullscreen → container moves in; own fullscreen → no move; exit back → stays; page exit → body', () => {
        const pv = document.createElement('div');
        document.body.appendChild(pv);
        const iframe = document.createElement('iframe');
        document.body.appendChild(iframe);
        const context = createPopupContext(iframe);
        firePopup(context, pv);
        expect(iframe.parentNode).toBe(pv);
        const appendSpy = vi.spyOn(document.body, 'appendChild');
        firePopup(context, iframe); // our own iframe is the fullscreen element now
        expect(iframe.parentNode).toBe(pv); // moving it out of pv would reload it
        firePopup(context, pv); // clip exits back to the page element
        expect(iframe.parentNode).toBe(pv);
        expect(appendSpy).not.toHaveBeenCalled();
        appendSpy.mockRestore();
        firePopup(context, null);
        expect(iframe.parentNode).toBe(document.body);
        pv.remove();
        iframe.remove();
    });

    test('closed shadow host as the fullscreen element → no HierarchyRequestError (host.appendChild(host))', () => {
        const host = document.createElement('div');
        host.attachShadow({mode: 'closed'}).appendChild(document.createElement('iframe'));
        document.body.appendChild(host);
        const context = createPopupContext(host);
        expect(() => { firePopup(context, host); }).not.toThrow();
        expect(host.parentNode).toBe(document.body);
        expect(() => { firePopup(context, null); }).not.toThrow();
        host.remove();
    });
});
/* eslint-enable no-underscore-dangle */
