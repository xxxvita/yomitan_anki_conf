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

/* eslint-disable no-underscore-dangle -- the click path is driven through Display's private seams */
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {Display} from '../ext/js/display/display.js';
import {setupDomTest} from './fixtures/dom-test.js';

/**
 * Bare Display holding only what `_onContentTextScannerSearchSuccess` reads.
 * @param {{pageType: string, frontend: ?{setTextSource: import('vitest').Mock}, nestedEnabled: boolean}} details
 * @returns {{display: Display, setContent: import('vitest').Mock, clearSelection: import('vitest').Mock}}
 */
function makeDisplay({pageType, frontend, nestedEnabled}) {
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const display = /** @type {Display} */ (Object.create(Display.prototype));
    const setContent = vi.fn();
    const clearSelection = vi.fn();
    /** @type {*} */ (display)._pageType = pageType;
    /** @type {*} */ (display)._frontend = frontend;
    /** @type {*} */ (display)._nestedFrontendEnabled = nestedEnabled;
    /** @type {*} */ (display)._contentTextScanner = {clearSelection};
    /** @type {*} */ (display)._history = {state: {crumbs: ['google']}};
    /** @type {*} */ (display)._query = 'search';
    /** @type {*} */ (display)._contentOriginTabId = 1;
    /** @type {*} */ (display)._contentOriginFrameId = 0;
    /** @type {*} */ (display)._application = {webExtension: {unloaded: true}};
    /** @type {*} */ (display)._nestedClickNext = null;
    /** @type {*} */ (display)._nestedClickRunning = false;
    display.setContent = setContent;
    return {display, setContent, clearSelection};
}

/**
 * @param {Node} node
 * @returns {import('text-source').TextSource}
 */
const sourceAt = (node) => /** @type {import('text-source').TextSource} */ (/** @type {unknown} */ ({type: 'range', range: {startContainer: node}, text: () => 'engine'}));
/** @type {import('text-source').TextSource} */
let textSource;
/** @type {import('text-scanner').EventArgument<'searchSuccess'>} */
let args;
/**
 * @param {import('text-source').TextSource} source
 * @returns {import('text-scanner').EventArgument<'searchSuccess'>}
 */
const argsFor = (source) => /** @type {import('text-scanner').EventArgument<'searchSuccess'>} */ (/** @type {unknown} */ ({type: 'terms', dictionaryEntries: [], sentence: null, textSource: source, optionsContext: null}));

describe('click on a word inside the card', () => {
    /** @type {Awaited<ReturnType<typeof setupDomTest>>} */
    let env;
    beforeEach(async () => {
        env = await setupDomTest();
        const gloss = document.createElement('li');
        gloss.textContent = 'an engine';
        document.body.appendChild(gloss);
        textSource = sourceAt(/** @type {Node} */ (gloss.firstChild));
        args = argsFor(textSource);
    });
    afterEach(async () => { await env.teardown(global); });

    test('popup with nested cards on: opens a nested card, the card itself stays', () => {
        const frontend = {setTextSource: vi.fn(() => Promise.resolve())};
        const {display, setContent, clearSelection} = makeDisplay({pageType: 'popup', frontend, nestedEnabled: true});
        display._onContentTextScannerSearchSuccess(args);
        expect(frontend.setTextSource).toHaveBeenCalledWith(textSource);
        expect(setContent).not.toHaveBeenCalled();
        expect(clearSelection).toHaveBeenCalled();
    });

    test('nested cards off (depth limit reached): the word replaces the card content', () => {
        const frontend = {setTextSource: vi.fn(() => Promise.resolve())};
        const {display, setContent} = makeDisplay({pageType: 'popup', frontend, nestedEnabled: false});
        display._onContentTextScannerSearchSuccess(args);
        expect(frontend.setTextSource).not.toHaveBeenCalled();
        expect(setContent).toHaveBeenCalledTimes(1);
    });

    test('no nested frontend yet: the word replaces the card content', () => {
        const {display, setContent} = makeDisplay({pageType: 'popup', frontend: null, nestedEnabled: true});
        display._onContentTextScannerSearchSuccess(args);
        expect(setContent).toHaveBeenCalledTimes(1);
    });

    test('search page: the word replaces the results, as before', () => {
        const frontend = {setTextSource: vi.fn(() => Promise.resolve())};
        const {display, setContent} = makeDisplay({pageType: 'search', frontend, nestedEnabled: true});
        display._onContentTextScannerSearchSuccess(args);
        expect(frontend.setTextSource).not.toHaveBeenCalled();
        expect(setContent).toHaveBeenCalledTimes(1);
    });

    test('a failed nested lookup does not throw out of the click handler', async () => {
        const frontend = {setTextSource: vi.fn(() => Promise.reject(new Error('frame gone')))};
        const {display} = makeDisplay({pageType: 'popup', frontend, nestedEnabled: true});
        expect(() => display._onContentTextScannerSearchSuccess(args)).not.toThrow();
        await Promise.resolve();
    });

    test('клик по ссылке в значении: ссылка уже перешла сама — вложенной карточки нет', () => {
        const frontend = {setTextSource: vi.fn(() => Promise.resolve())};
        const {display, setContent} = makeDisplay({pageType: 'popup', frontend, nestedEnabled: true});
        const link = document.createElement('a');
        link.className = 'gloss-link';
        link.textContent = 'engine';
        document.body.appendChild(link);
        display._onContentTextScannerSearchSuccess(argsFor(sourceAt(/** @type {Node} */ (link.firstChild))));
        expect(frontend.setTextSource).not.toHaveBeenCalled();
        expect(setContent).not.toHaveBeenCalled();
    });

    test('слово уже снято со страницы (выдача сменилась) — вложенной карточки нет', () => {
        const frontend = {setTextSource: vi.fn(() => Promise.resolve())};
        const {display, setContent} = makeDisplay({pageType: 'popup', frontend, nestedEnabled: true});
        const detached = document.createTextNode('engine');
        display._onContentTextScannerSearchSuccess(argsFor(sourceAt(detached)));
        expect(frontend.setTextSource).not.toHaveBeenCalled();
        expect(setContent).not.toHaveBeenCalled();
    });

    test('быстрые клики A, B, C: поиски по очереди, после A выполняется только последний (C)', async () => {
        /** @type {Array<() => void>} */
        const pending = [];
        /** @type {string[]} */
        const searched = [];
        const frontend = {setTextSource: vi.fn((/** @type {import('text-source').TextSource} */ source) => {
            searched.push(source.text());
            return new Promise((resolve) => { pending.push(() => resolve(void 0)); });
        })};
        const {display} = makeDisplay({pageType: 'popup', frontend, nestedEnabled: true});
        /**
         * @param {string} word
         * @returns {import('text-scanner').EventArgument<'searchSuccess'>}
         */
        const clickOn = (word) => {
            const li = document.createElement('li');
            li.textContent = word;
            document.body.appendChild(li);
            const source = /** @type {import('text-source').TextSource} */ (/** @type {unknown} */ ({type: 'range', range: {startContainer: li.firstChild}, text: () => word}));
            return argsFor(source);
        };
        display._onContentTextScannerSearchSuccess(clickOn('alpha'));
        display._onContentTextScannerSearchSuccess(clickOn('beta'));
        display._onContentTextScannerSearchSuccess(clickOn('gamma'));
        expect(searched).toStrictEqual(['alpha']);
        /** @type {() => void} */ (pending.shift())();
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(searched).toStrictEqual(['alpha', 'gamma']);
        /** @type {() => void} */ (pending.shift())();
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(searched).toStrictEqual(['alpha', 'gamma']);
    });

    test('ошибка поиска не останавливает очередь', async () => {
        let calls = 0;
        const frontend = {setTextSource: vi.fn(() => (++calls === 1 ? Promise.reject(new Error('gone')) : Promise.resolve()))};
        const {display} = makeDisplay({pageType: 'popup', frontend, nestedEnabled: true});
        display._onContentTextScannerSearchSuccess(args);
        display._onContentTextScannerSearchSuccess(args);
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(frontend.setTextSource).toHaveBeenCalledTimes(2);
    });
});

/* eslint-enable no-underscore-dangle */
