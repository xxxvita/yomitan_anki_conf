/*
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


import {afterEach, describe, expect, test, vi} from 'vitest';
import {Backend} from '../ext/js/background/backend.js';

/**
 * @param {unknown} contextMenus
 * @returns {{context: *, sent: unknown[]}}
 */
function prepare(contextMenus) {
    vi.stubGlobal('chrome', {
        contextMenus,
        runtime: {onInstalled: {addListener: () => {}}, onMessage: {addListener: () => {}}},
    });
    vi.stubGlobal('addEventListener', () => {});
    /** @type {unknown[]} */
    const sent = [];
    const noop = () => {};
    const context = {
        _canObservePermissionsChanges: () => false,
        _onInstalled: noop,
        _onMessageWrapper: noop,
        _onPmMessage: noop,
        _onPmMessageError: noop,
        /** @param {unknown} message */
        _sendMessageAllTabsIgnoreResponse: (message) => { sent.push(message); },
    };
    // eslint-disable-next-line no-underscore-dangle
    Backend.prototype._prepareInternalSync.call(context);
    return {context, sent};
}

describe('Backend context menu listener', () => {
    afterEach(() => {
        vi.unstubAllGlobals();
    });

    test.each([
        ['no contextMenus API', void 0],
        ['contextMenus without onClicked', {}],
        ['null onClicked', {onClicked: null}],
    ])('startup survives %s', (_name, contextMenus) => {
        expect(() => prepare(contextMenus)).not.toThrow();
    });

    test('registers one listener synchronously, reacting only to selected text', () => {
        /** @type {((info: {selectionText?: string}) => void)[]} */
        const listeners = [];
        const {sent} = prepare({onClicked: {addListener: (/** @type {(info: {selectionText?: string}) => void} */ listener) => { listeners.push(listener); }}});

        expect(listeners).toHaveLength(1);

        listeners[0]({});
        expect(sent).toStrictEqual([]);

        listeners[0]({selectionText: 'word'});
        expect(sent).toStrictEqual([{action: 'frontendScanSelectedText'}]);
    });
});
