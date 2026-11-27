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

import {describe, expect, test, vi} from 'vitest';
import {FlibYoutubeStorage, isLayerKey, pickStorageChanges} from '../ext/js/background/flib-youtube-storage.js';

const YT = {url: 'https://www.youtube.com/watch?v=abc'};

/**
 * @param {Record<string, unknown>} [initial]
 * @returns {{store: Record<string, unknown>, local: {get: import('vitest').Mock, set: import('vitest').Mock, remove: import('vitest').Mock}}}
 */
function fakeLocal(initial = {}) {
    const store = {...initial};
    return {
        store,
        local: {
            get: vi.fn(async () => ({...store})),
            set: vi.fn(async (/** @type {Record<string, unknown>} */ items) => { Object.assign(store, items); }),
            remove: vi.fn(async (/** @type {string[]} */ keys) => { for (const k of keys) { delete store[k]; } }),
        },
    };
}

/**
 * @param {ReturnType<typeof fakeLocal>['local']} local
 * @returns {FlibYoutubeStorage}
 */
const make = (local) => new FlibYoutubeStorage(/** @type {ConstructorParameters<typeof FlibYoutubeStorage>[0]} */ (/** @type {unknown} */ (local)));

describe('FlibYoutubeStorage: prefix guard', () => {
    test('getAll returns only flibYt: keys with string values', async () => {
        const {local} = fakeLocal({'flibYt:flib:dusk-variant': 'indigo', 'flibYt:n': 5, 'flibYoutube.panelVisible': true, 'flibSecret': 'k', 'xflibYt:a': '1'});
        expect(await make(local).getAll(YT)).toEqual({items: {'flibYt:flib:dusk-variant': 'indigo'}});
    });

    test('set with any key outside the prefix is rejected and writes nothing', async () => {
        const {local, store} = fakeLocal();
        const s = make(local);
        await expect(s.set({'flibYt:a': '1', 'options': 'x'}, YT)).rejects.toThrow(/flibYt:/);
        await expect(s.set({'flibYt:': '1'}, YT)).rejects.toThrow(/flibYt:/);
        await expect(s.set({['flibYt:' + 'k'.repeat(600)]: '1'}, YT)).rejects.toThrow(/flibYt:/);
        expect(local.set).not.toHaveBeenCalled();
        expect(store).toEqual({});
    });

    test('set takes strings only, and only objects', async () => {
        const {local} = fakeLocal();
        const s = make(local);
        await expect(s.set({'flibYt:a': 1}, YT)).rejects.toThrow(/string/);
        await expect(s.set(null, YT)).rejects.toThrow(/object/);
        await expect(s.set(['flibYt:a'], YT)).rejects.toThrow(/object/);
        expect(local.set).not.toHaveBeenCalled();
        await s.set({'flibYt:a': '1', 'flibYt:b': '2'}, YT);
        expect(local.set).toHaveBeenCalledWith({'flibYt:a': '1', 'flibYt:b': '2'});
    });

    test('remove with any key outside the prefix is rejected and removes nothing', async () => {
        const {local, store} = fakeLocal({'flibYt:a': '1', 'options': 'x'});
        const s = make(local);
        await expect(s.remove(['flibYt:a', 'options'], YT)).rejects.toThrow(/flibYt:/);
        await expect(s.remove('flibYt:a', YT)).rejects.toThrow(/array/);
        expect(local.remove).not.toHaveBeenCalled();
        await s.remove(['flibYt:a'], YT);
        expect(store).toEqual({options: 'x'});
    });

    test('isLayerKey', () => {
        expect(isLayerKey('flibYt:x')).toBe(true);
        for (const k of ['flibYt:', 'flibyt:x', ' flibYt:x', 'x', 1, null, void 0]) { expect(isLayerKey(k)).toBe(false); }
    });
});

describe('FlibYoutubeStorage: sender guard (same as the /api proxy)', () => {
    const bad = [
        void 0,
        {},
        {url: 'https://youtube.com/watch?v=1'},
        {url: 'http://www.youtube.com/watch?v=1'},
        {url: 'https://www.youtube.com.evil.example/'},
        {url: 'https://m.youtube.com/watch?v=1'},
        {url: 'chrome-extension://abc/popup.html'},
        {url: 'not a url'},
    ];
    test.each(bad)('rejected: %o', async (sender) => {
        const {local} = fakeLocal({'flibYt:a': '1'});
        const s = make(local);
        await expect(s.getAll(sender)).rejects.toThrow(/sender/);
        await expect(s.set({'flibYt:a': '2'}, sender)).rejects.toThrow(/sender/);
        await expect(s.remove(['flibYt:a'], sender)).rejects.toThrow(/sender/);
        expect(local.get).not.toHaveBeenCalled();
        expect(local.set).not.toHaveBeenCalled();
        expect(local.remove).not.toHaveBeenCalled();
    });
});

describe('pickStorageChanges', () => {
    test('local area, flibYt: keys only, removed -> null', () => {
        expect(pickStorageChanges({'flibYt:a': {newValue: '1', oldValue: '0'}, 'flibYt:b': {oldValue: 'x'}, 'options': {newValue: {}}}, 'local'))
            .toEqual({'flibYt:a': '1', 'flibYt:b': null});
    });
    test('nothing of ours, or another area -> null', () => {
        expect(pickStorageChanges({options: {newValue: 1}}, 'local')).toBe(null);
        expect(pickStorageChanges({'flibYt:a': {newValue: '1'}}, 'session')).toBe(null);
    });
});
