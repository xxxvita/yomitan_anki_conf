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
import {describe, expect, it} from 'vitest';
import {FlibYoutubeStorage, pickStorageChanges} from '../../../../ext/js/background/flib-youtube-storage.js';
import {backgroundStorageBackend, createSyncStorage, preloadSyncStorage, type StorageBackend} from '../storage';

const P = 'flibYt:';

/** @returns {{backend: StorageBackend, store: Record<string,string>, sets: Array<Record<string,string|null>>, emit: (c: Record<string,string|null>) => void, release: () => void}} */
function fakeBackend(initial: Record<string, string> = {}, deferred = false) {
    const store = {...initial};
    const sets: Array<Record<string, string | null>> = [];
    const listeners: Array<(c: Record<string, string | null>) => void> = [];
    const waiting: Array<() => void> = [];
    const backend: StorageBackend = {
        getAll: async (prefix) => Object.fromEntries(Object.entries(store).filter(([k]) => k.startsWith(prefix))),
        set: async (items) => {
            sets.push(items);
            if (deferred) { await new Promise<void>((r) => { waiting.push(r); }); }
            for (const [k, v] of Object.entries(items)) { if (v === null) { delete store[k]; } else { store[k] = v; } }
        },
        onChanged: (cb) => { listeners.push(cb); },
    };
    return {backend, store, sets, emit: (c: Record<string, string | null>) => { for (const l of listeners) { l(c); } }, release: () => { while (waiting.length) { waiting.shift()?.(); } }};
}

async function loaded(initial: Record<string, string> = {}, deferred = false) {
    const f = fakeBackend(initial, deferred);
    const storage = createSyncStorage({backend: f.backend, prefix: P});
    await preloadSyncStorage(storage, f.backend);
    return {...f, storage};
}

describe('createSyncStorage interface', () => {
    it('getItem of a missing key is null; setItem coerces to string', async () => {
        const {storage} = await loaded();
        expect(storage.getItem('a')).toBeNull();
        storage.setItem('a', 5 as unknown as string);
        expect(storage.getItem('a')).toBe('5');
    });
    it('removeItem, key(i) and length follow insertion order', async () => {
        const {storage} = await loaded();
        storage.setItem('a', '1'); storage.setItem('b', '2'); storage.setItem('c', '3');
        expect(storage.length).toBe(3);
        expect([storage.key(0), storage.key(1), storage.key(2), storage.key(3)]).toEqual(['a', 'b', 'c', null]);
        storage.removeItem('b');
        expect(storage.length).toBe(2);
        expect([storage.key(0), storage.key(1)]).toEqual(['a', 'c']);
        expect(storage.getItem('b')).toBeNull();
    });
    it('overwriting a key keeps its position', async () => {
        const {storage} = await loaded();
        storage.setItem('a', '1'); storage.setItem('b', '2'); storage.setItem('a', '9');
        expect(storage.key(0)).toBe('a');
        expect(storage.getItem('a')).toBe('9');
    });
    it('key() with a negative or out-of-range index is null', async () => {
        const {storage} = await loaded();
        storage.setItem('a', '1');
        expect(storage.key(-1)).toBeNull();
        expect(storage.key(1)).toBeNull();
    });
});

describe('preload and write-through', () => {
    it('preloaded values (own prefix only, prefix stripped) are readable synchronously', async () => {
        const {storage} = await loaded({[`${P}flib:ws:A`]: 'x', 'other:k': 'y'});
        expect(storage.getItem('flib:ws:A')).toBe('x');
        expect(storage.getItem('other:k')).toBeNull();
        expect(storage.length).toBe(1);
    });
    it('setItem writes prefixed key to the backend; removeItem writes null', async () => {
        const {storage, sets, store} = await loaded();
        storage.setItem('k', 'v');
        storage.removeItem('k');
        await Promise.resolve(); await Promise.resolve();
        expect(sets).toEqual([{[`${P}k`]: 'v'}, {[`${P}k`]: null}]);
        expect(store).toEqual({});
    });
    it('clear removes only keys of this prefix', async () => {
        const {storage, sets} = await loaded({[`${P}a`]: '1', [`${P}b`]: '2', 'site:z': '3'});
        storage.clear();
        expect(storage.length).toBe(0);
        expect(sets).toEqual([{[`${P}a`]: null, [`${P}b`]: null}]);
    });
    it('clear of an empty storage writes nothing', async () => {
        const {storage, sets} = await loaded();
        storage.clear();
        expect(sets).toEqual([]);
    });
    it('a failing backend write does not throw and keeps memory', async () => {
        const f = fakeBackend();
        f.backend.set = () => Promise.reject(new Error('quota'));
        const storage = createSyncStorage({backend: f.backend, prefix: P});
        await preloadSyncStorage(storage, f.backend);
        expect(() => storage.setItem('a', '1')).not.toThrow();
        await Promise.resolve(); await Promise.resolve();
        expect(storage.getItem('a')).toBe('1');
    });
});

describe('backend null (sessionStorage)', () => {
    it('works in memory only', async () => {
        const storage = createSyncStorage({backend: null, prefix: 'flibYtS:'});
        storage.setItem('a', '1');
        expect(storage.getItem('a')).toBe('1');
        storage.removeItem('a');
        storage.setItem('b', '2');
        storage.clear();
        expect(storage.length).toBe(0);
        await expect(preloadSyncStorage(storage, null)).resolves.toBeUndefined();
    });
});

describe('cross-tab (Review Focus 5)', () => {
    it('writing flib:ws:A never touches flib:ws:B; a remote change to B is visible', async () => {
        const {storage, sets, emit} = await loaded({[`${P}flib:ws:B`]: 'b0'});
        storage.setItem('flib:ws:A', 'a1');
        await Promise.resolve(); await Promise.resolve();
        expect(sets).toEqual([{[`${P}flib:ws:A`]: 'a1'}]);
        expect(storage.getItem('flib:ws:B')).toBe('b0');
        emit({[`${P}flib:ws:B`]: 'b1'});
        expect(storage.getItem('flib:ws:B')).toBe('b1');
        expect(storage.getItem('flib:ws:A')).toBe('a1');
    });
    it('a remote change does not overwrite a key with a local write still in flight', async () => {
        const {storage, emit, release} = await loaded({}, true);
        storage.setItem('k', 'local');
        emit({[`${P}k`]: 'remote'});
        expect(storage.getItem('k')).toBe('local');
        release();
        await new Promise((r) => setTimeout(r, 0));
        emit({[`${P}k`]: 'remote2'});
        expect(storage.getItem('k')).toBe('remote2');
    });
    it('a remote change applies to a key written here earlier and already settled', async () => {
        const {storage, emit} = await loaded();
        storage.setItem('k', 'local');
        await new Promise((r) => setTimeout(r, 0));
        emit({[`${P}k`]: 'remote'});
        expect(storage.getItem('k')).toBe('remote');
    });
    it('a remote delete (null) removes the key; foreign-prefix changes are ignored', async () => {
        const {storage, emit} = await loaded({[`${P}k`]: 'v'});
        emit({'other:k': 'zzz'});
        expect(storage.getItem('other:k')).toBeNull();
        expect(storage.length).toBe(1);
        emit({[`${P}k`]: null});
        expect(storage.getItem('k')).toBeNull();
        expect(storage.length).toBe(0);
    });
    it('remote changes arriving before preload settles are not lost for untouched keys', async () => {
        const f = fakeBackend({[`${P}a`]: '1'});
        const storage = createSyncStorage({backend: f.backend, prefix: P});
        await preloadSyncStorage(storage, f.backend);
        f.emit({[`${P}a`]: '2'});
        expect(storage.getItem('a')).toBe('2');
    });
});

describe('backgroundStorageBackend (through the background, C1)', () => {
    type Listener = (message: unknown) => void;
    /** The background half for real (ext/js/background/flib-youtube-storage.js) over an in-memory chrome.storage.local, behind a fake sendMessage with api-map replies. */
    function fakeBackground(senderUrl = 'https://www.youtube.com/watch?v=x') {
        const store: Record<string, unknown> = {};
        const tabs: Listener[] = [];
        const sent: Array<{action: string, params?: unknown}> = [];
        const changed = (changes: Record<string, {newValue?: unknown}>) => {
            const picked = pickStorageChanges(changes as Record<string, chrome.storage.StorageChange>, 'local');
            if (picked !== null) { for (const l of tabs) { l({action: 'flibYoutubeStorageChanged', params: {changes: picked}}); } }
        };
        const local = {
            get: async () => ({...store}),
            set: async (items: Record<string, unknown>) => {
                const ch: Record<string, {newValue?: unknown}> = {};
                for (const [k, v] of Object.entries(items)) { store[k] = v; ch[k] = {newValue: v}; }
                changed(ch);
            },
            remove: async (keys: string | string[]) => {
                const ch: Record<string, {newValue?: unknown}> = {};
                for (const k of Array.isArray(keys) ? keys : [keys]) { delete store[k]; ch[k] = {}; }
                changed(ch);
            },
        };
        const bg = new FlibYoutubeStorage(local as unknown as chrome.storage.StorageArea);
        const sender = {url: senderUrl};
        const handlers: Record<string, (params: Record<string, unknown>) => Promise<unknown>> = {
            flibYoutubeStorageGetAll: async () => await bg.getAll(sender),
            flibYoutubeStorageSet: async (p) => { await bg.set(p.items, sender); },
            flibYoutubeStorageRemove: async (p) => { await bg.remove(p.keys, sender); },
        };
        const runtime = () => ({
            sendMessage: async (message: {action: string, params?: unknown}) => {
                sent.push(message);
                try {
                    return {result: await handlers[message.action]((message.params ?? {}) as Record<string, unknown>)};
                } catch (e) {
                    return {error: {message: (e as Error).message}};
                }
            },
            onMessage: {addListener: (cb: Listener) => { tabs.push(cb); }},
        });
        return {store, sent, runtime};
    }

    it('round trip: preload sees the background store; setItem/removeItem reach it; another tab sees the write', async () => {
        const bg = fakeBackground();
        bg.store[`${P}flib:dusk-variant`] = 'indigo';
        bg.store['flibYoutube.panelVisible'] = true; // not the layer's: never read
        bg.store['flibSecret'] = 'k';

        const backendA = backgroundStorageBackend(bg.runtime());
        const a = createSyncStorage({backend: backendA, prefix: P});
        await preloadSyncStorage(a, backendA);
        expect(a.getItem('flib:dusk-variant')).toBe('indigo');
        expect(a.length).toBe(1);

        const backendB = backgroundStorageBackend(bg.runtime());
        const b = createSyncStorage({backend: backendB, prefix: P});
        await preloadSyncStorage(b, backendB);

        a.setItem('flib:ws:A', '{"x":1}');
        await new Promise((r) => { setTimeout(r, 0); });
        expect(bg.store[`${P}flib:ws:A`]).toBe('{"x":1}');
        expect(b.getItem('flib:ws:A')).toBe('{"x":1}'); // cross-tab
        expect(bg.sent.some((m) => m.action === 'flibYoutubeStorageSet')).toBe(true);

        a.removeItem('flib:ws:A');
        await new Promise((r) => { setTimeout(r, 0); });
        expect(`${P}flib:ws:A` in bg.store).toBe(false);
        expect(b.getItem('flib:ws:A')).toBe(null);
        expect(bg.sent.some((m) => m.action === 'flibYoutubeStorageRemove')).toBe(true);
        expect(bg.store.flibSecret).toBe('k');
    });

    it('a background error rejects the backend call (preload fails, memory stays usable)', async () => {
        const bg = fakeBackground('https://evil.example/');
        const backend = backgroundStorageBackend(bg.runtime());
        const s2 = createSyncStorage({backend, prefix: P});
        await expect(preloadSyncStorage(s2, backend)).rejects.toThrow(/sender/);
        s2.setItem('a', '1');
        expect(s2.getItem('a')).toBe('1');
    });

    it('getAll keeps only prefixed string values even if the reply had others', async () => {
        const backend = backgroundStorageBackend({
            sendMessage: async () => ({result: {items: {[`${P}a`]: '1', other: '2', [`${P}n`]: 3}}}),
            onMessage: {addListener: () => {}},
        });
        expect(await backend.getAll(P)).toEqual({[`${P}a`]: '1'});
    });

    it('onChanged takes only flibYoutubeStorageChanged messages of the right shape', () => {
        const listeners: Listener[] = [];
        const backend = backgroundStorageBackend({sendMessage: async () => ({result: null}), onMessage: {addListener: (cb) => { listeners.push(cb); }}});
        const seen: Array<Record<string, string | null>> = [];
        backend.onChanged((c) => { seen.push(c); });
        for (const l of listeners) {
            l({action: 'flibYoutubeSetVisible', params: {visible: true}});
            l({action: 'flibYoutubeStorageChanged', params: {}});
            l({action: 'flibYoutubeStorageChanged', params: {changes: {[`${P}a`]: '1', [`${P}b`]: null, [`${P}c`]: 5}}});
        }
        expect(seen).toEqual([{[`${P}a`]: '1', [`${P}b`]: null}]);
    });
});
