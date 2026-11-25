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

import {readFileSync} from 'node:fs';
import {afterEach, describe, expect, test, vi} from 'vitest';
import {builtinEnvironments} from 'vitest/environments';
import {Application} from '../ext/js/application.js';
import {API} from '../ext/js/comm/api.js';
import {CrossFrameAPI} from '../ext/js/comm/cross-frame-api.js';
import {FrameEndpoint} from '../ext/js/comm/frame-endpoint.js';
import {Display} from '../ext/js/display/display.js';
import {WebExtension} from '../ext/js/extension/web-extension.js';

/* eslint-disable no-underscore-dangle */

/*
 * popup.html is a web-accessible page: any site may put it into a frame of its own, with any address.
 */

const ORIGIN = 'https://ext.test';
const EVIL = '?type=phrase&query=chosen%20by%20the%20page';
const FRAME_ID = 7;

/** @type {?(() => Promise<void>)} */
let teardown = null;

afterEach(async () => {
    await teardown?.();
    teardown = null;
    vi.restoreAllMocks();
});

/**
 * @typedef {object} Page
 * @property {Display} display
 * @property {string[]} calls Every call of the extension API.
 * @property {string[]} events What the parts of the page are told of the content.
 * @property {(message: object) => Promise<unknown>} send As the content script does: `displayPopupMessage1` with the secrets of the handshake.
 * @property {import('vitest').Mock} setPhrase
 * @property {import('vitest').Mock} setTerms
 */

/**
 * @param {import('display').DisplayPageType} pageType
 * @param {string} address After the path.
 * @param {unknown} [historyState] What the browser kept of an earlier document of the frame.
 * @returns {Promise<Page>}
 */
async function openPage(pageType, address, historyState = null) {
    const file = `${pageType}.html`;
    const environment = await builtinEnvironments.jsdom.setup(globalThis, {jsdom: {html: readFileSync(new URL(`../ext/${file}`, import.meta.url), 'utf8'), url: `${ORIGIN}/${file}${address}`}});
    teardown = async () => { await environment.teardown(globalThis); };
    document.caretRangeFromPoint = () => null;
    if (historyState !== null) { history.replaceState(historyState, ''); }

    /** @type {string[]} */
    const calls = [];
    const api = new API(new WebExtension());
    vi.spyOn(api, '_invoke').mockImplementation(async (action) => {
        calls.push(action);
        return /** @type {*} */ (action === 'getEnvironmentInfo' ? {browser: 'chrome', platform: {os: 'linux'}} : []);
    });
    const application = new Application(api, new CrossFrameAPI(api, 1, FRAME_ID));
    const display = new Display(application, pageType, /** @type {*} */ ({blurElement: () => {}}), /** @type {*} */ ({registerActions: () => {}, forwardFrameId: null}));
    for (const part of [display._hotkeyHelpController, display._displayGenerator, display._queryParser, display._optionToggleHotkeyHandler, display._themeController]) {
        vi.spyOn(/** @type {{prepare: () => unknown}} */ (/** @type {unknown} */ (part)), 'prepare').mockImplementation(() => void 0);
    }
    vi.spyOn(display, '_updateQueryParser').mockImplementation(() => {});
    vi.spyOn(display, 'updateOptions').mockResolvedValue(void 0);
    /** @type {string[]} */
    const events = [];
    for (const name of /** @type {const} */ (['contentClear', 'contentUpdateStart', 'contentUpdateEntry', 'contentUpdateComplete'])) {
        display.on(name, () => { events.push(`${name}: ${display.contentType}`); });
    }
    const setPhrase = vi.spyOn(display, '_setContentPhrase').mockResolvedValue(void 0);
    const setTerms = vi.spyOn(display, '_setContentTermsOrKanji').mockResolvedValue(void 0);
    await display.prepare();
    display.initializeState();
    await settle();
    return {
        display,
        calls,
        events,
        setPhrase: /** @type {*} */ (setPhrase),
        setTerms: /** @type {*} */ (setTerms),
        send: async (message) => await application.crossFrame._apiMap.get('displayPopupMessage1')?.(/** @type {*} */ (message)),
    };
}

/** */
async function settle() {
    await new Promise((resolve) => { setTimeout(resolve, 5); });
}

/**
 * @param {Display} display
 * @returns {{token: string, secret: string}}
 */
function connect(display) {
    const endpoint = /** @type {FrameEndpoint} */ (display._frameEndpoint);
    const secret = endpoint._secret;
    endpoint._onMessage(/** @type {*} */ ({data: {action: 'frameEndpointConnect', params: {secret, token: 'T', hostFrameId: 0}}}));
    return {token: 'T', secret};
}

/**
 * @param {string} type
 * @param {string} query
 * @param {'new'|'clear'|'overwrite'} [historyMode]
 * @returns {{action: string, params: object}}
 */
function content(type, query, historyMode = 'clear') {
    return {
        action: 'displaySetContent',
        params: {details: {focus: false, historyMode, params: {type, query}, state: {sentence: {text: query, offset: 0}}, content: {contentOrigin: {tabId: 1, frameId: 0}}}},
    };
}

/**
 * @param {import('vitest').Mock} mock
 * @returns {?string[]} The queries that were shown.
 */
const queries = (mock) => mock.mock.calls.map((args) => /** @type {URLSearchParams} */ (args.find((arg) => arg instanceof URLSearchParams)).get('query') ?? '');

describe('a popup in a frame of a page', () => {
    test.each([
        ['a phrase', EVIL],
        ['a word', '?query=word'],
        ['terms', '?type=terms&query=word&lookup=true'],
        ['kanji', '?type=kanji&query=%E6%97%A5'],
        ['a hash', '#type=phrase&query=x'],
        ['both', `${EVIL}#${EVIL}`],
        ['nothing', ''],
    ])('the address is dropped, nothing of it is shown and nothing is asked (%s)', async (_name, address) => {
        const {display, calls, events, setPhrase, setTerms} = await openPage('popup', address);
        expect(location.href).toBe(`${ORIGIN}/popup.html`);
        expect(setPhrase).not.toHaveBeenCalled();
        expect(setTerms).not.toHaveBeenCalled();
        expect(display.contentType).toBe('clear');
        expect(events).toStrictEqual([]);
        expect(calls.filter((name) => !['getEnvironmentInfo', 'getLanguageSummaries', 'getDictionaryInfo', 'broadcastTab'].includes(name))).toStrictEqual([]);
        expect(display.getOptionsContext().url).toBe(`${ORIGIN}/popup.html`);
    });

    test('what the browser kept of an earlier document is dropped too', async () => {
        const {display} = await openPage('popup', EVIL, {id: 'i', state: {sentence: {text: 'evil', offset: 0}}});
        expect(history.state).toBeNull();
        expect(display.history.state).toBeNull();
        expect(display.history._current.url).toBe(`${ORIGIN}/popup.html`);
    });

    test('an address that comes later, without content from the extension, shows nothing', async () => {
        const {display, events, setPhrase} = await openPage('popup', '');
        history.pushState(null, '', `${ORIGIN}/popup.html${EVIL}`);
        display.history._onPopState();
        await settle();
        expect(setPhrase).not.toHaveBeenCalled();
        expect(events).toStrictEqual([]);
    });

    test('nothing in it can be pressed before that', async () => {
        const {display, send} = await openPage('popup', EVIL);
        expect(document.body.inert).toBe(true);
        await send({...connect(display), data: content('phrase', 'a text')});
        expect(document.body.inert).toBe(false);
    });

    test.each([
        ['without the handshake', () => ({token: 'T', secret: 'S'})],
        ['with a wrong token', (/** @type {Display} */ display) => ({...connect(display), token: 'other'})],
        ['with a wrong secret', (/** @type {Display} */ display) => ({...connect(display), secret: 'other'})],
    ])('content %s is refused', async (_name, getSecrets) => {
        const {display, send, setPhrase} = await openPage('popup', '');
        await expect(send({...getSecrets(display), data: content('phrase', 'evil')})).rejects.toThrow('Invalid authentication');
        await settle();
        expect(setPhrase).not.toHaveBeenCalled();
        expect(location.search).toBe('');
    });

    test('the messages without secrets are only for the search page', async () => {
        const {display, setPhrase} = await openPage('popup', '');
        connect(display);
        const handler = display.application.crossFrame._apiMap.get('displayPopupMessage2');
        await expect((async () => await handler?.(/** @type {*} */ (content('phrase', 'evil'))))()).rejects.toThrow('Invalid authentication');
        await settle();
        expect(setPhrase).not.toHaveBeenCalled();
    });

    test('a message of the page itself is not content', async () => {
        const {setPhrase} = await openPage('popup', '');
        window.dispatchEvent(new MessageEvent('message', {data: content('phrase', 'evil')}));
        window.dispatchEvent(new MessageEvent('message', {data: {token: null, secret: null, data: content('phrase', 'evil')}}));
        await settle();
        expect(setPhrase).not.toHaveBeenCalled();
    });
});

describe('a popup of the extension', () => {
    test('content after the handshake is shown', async () => {
        const {display, events, send, setPhrase} = await openPage('popup', EVIL);
        const secrets = connect(display);
        await send({...secrets, data: content('phrase', 'a text')});
        await settle();
        expect(queries(setPhrase)).toStrictEqual(['a text']);
        expect(new URLSearchParams(location.search).get('query')).toBe('a text');
        expect(events).toContain('contentClear: clear');
        expect(display.contentType).toBe('phrase');
    });

    test.each(/** @type {('new'|'overwrite'|'clear')[]} */ (['new', 'overwrite', 'clear']))('the first content (%s) is the first page: no empty one before it', async (historyMode) => {
        const {display, send, setPhrase} = await openPage('popup', EVIL);
        await send({...connect(display), data: content('phrase', 'a text', historyMode)});
        await settle();
        expect(queries(setPhrase)).toStrictEqual(['a text']);
        expect(display.history.hasPrevious()).toBe(false);
    });

    test('back and forward, words and phrases', async () => {
        const {display, send, setPhrase, setTerms} = await openPage('popup', EVIL);
        const secrets = connect(display);
        await send({...secrets, data: {action: 'displayConfigure', params: {depth: 1, parentPopupId: 'p', parentFrameId: 0, childrenSupported: true, scale: 1, optionsContext: {depth: 1, url: 'https://page.test/'}}}});
        display.setHistorySettings({clearable: true, useBrowserHistory: false});
        await send({...secrets, data: content('terms', 'one')});
        await send({...secrets, data: content('phrase', 'two', 'new')});
        await send({...secrets, data: content('terms', 'three', 'new')});
        await settle();
        expect(display.history.back()).toBe(true);
        await settle();
        expect(new URLSearchParams(location.search).get('query')).toBe('two');
        expect(display.history.back()).toBe(true);
        await settle();
        expect(display.history.forward()).toBe(true);
        await settle();
        expect(queries(setTerms)).toStrictEqual(['one', 'three', 'one']);
        expect(queries(setPhrase)).toStrictEqual(['two', 'two', 'two']);
        // What was before the first content is not the address of the page.
        display.history.back();
        expect(display.history.back()).toBe(false);
    });

    test('the extension is gone: the page says so, with and without content', async () => {
        const {display, events} = await openPage('popup', EVIL);
        const show = vi.spyOn(display, '_setContentExtensionUnloaded').mockImplementation(() => {});
        display._onExtensionUnloaded();
        await settle();
        expect(show).toHaveBeenCalledTimes(1);
        expect(events).toContain('contentClear: clear');
    });
});

describe('the search page', () => {
    test('shows what its address says, also without a message', async () => {
        const {setTerms, setPhrase, calls} = await openPage('search', '?query=word');
        expect(location.search).toBe('?query=word');
        expect(queries(setTerms)).toStrictEqual(['word']);
        expect(setPhrase).not.toHaveBeenCalled();
        expect(calls).not.toContain('broadcastTab');
        expect(document.body.inert ?? false).toBe(false);
    });

    test('takes the messages without secrets (popup window)', async () => {
        const {display, setTerms} = await openPage('search', '');
        await display.application.crossFrame._apiMap.get('displayPopupMessage2')?.(/** @type {*} */ (content('terms', 'one')));
        await settle();
        expect(queries(setTerms)).toStrictEqual(['one']);
    });
});

/* eslint-enable no-underscore-dangle */
