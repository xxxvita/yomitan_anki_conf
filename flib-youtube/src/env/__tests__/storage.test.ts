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
import {chromeStorageBackend, createSyncStorage, preloadSyncStorage, type StorageBackend} from '../storage';

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

describe('chromeStorageBackend', () => {
    function fakeChrome() {
        const store: Record<string, string> = {};
        const calls: string[] = [];
        let listener: ((c: Record<string, {newValue?: string, oldValue?: string}>, area: string) => void) | null = null;
        const g = globalThis as unknown as {chrome?: unknown};
        g.chrome = {storage: {
            local: {
                get: async (k: null) => { calls.push(`get:${String(k)}`); return {...store}; },
                set: async (items: Record<string, string>) => { calls.push('set'); Object.assign(store, items); },
                remove: async (keys: string[]) => { calls.push(`remove:${keys.join(',')}`); for (const k of keys) { delete store[k]; } },
            },
            onChanged: {addListener: (cb: typeof listener) => { listener = cb; }},
        }};
        return {store, calls, fire: (c: Record<string, {newValue?: string}>, area = 'local') => listener?.(c, area)};
    }
    it('getAll filters by prefix using get(null)', async () => {
        const c = fakeChrome(); c.store[`${P}a`] = '1'; c.store.z = '2';
        expect(await chromeStorageBackend().getAll(P)).toEqual({[`${P}a`]: '1'});
        expect(c.calls).toContain('get:null');
    });
    it('set maps null to remove and the rest to set', async () => {
        const c = fakeChrome(); c.store[`${P}b`] = 'x';
        await chromeStorageBackend().set({[`${P}a`]: '1', [`${P}b`]: null});
        expect(c.store).toEqual({[`${P}a`]: '1'});
        expect(c.calls).toEqual(['set', `remove:${P}b`]);
    });
    it('onChanged maps newValue undefined to null and ignores non-local areas', () => {
        const c = fakeChrome();
        const seen: Array<Record<string, string | null>> = [];
        chromeStorageBackend().onChanged((ch) => { seen.push(ch); });
        c.fire({[`${P}a`]: {newValue: '1'}, [`${P}b`]: {}});
        c.fire({[`${P}c`]: {newValue: '3'}}, 'sync');
        expect(seen).toEqual([{[`${P}a`]: '1', [`${P}b`]: null}]);
    });
});
