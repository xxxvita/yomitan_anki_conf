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
// Synchronous Storage for the copied site, backed by chrome.storage.local.
// NOTE: this module must never mention the bare globals localStorage/sessionStorage:
// the build `define` rewrites them inside layer code too.
//
// Model: the in-memory Map is the source of truth for synchronous reads. Keys in memory are
// site keys (no prefix); the backend sees `prefix + key`. key(i) follows the insertion order
// of the Map (an overwrite keeps position; delete + set moves the key to the end).
//
// Cross-tab rule (exact): each key has a counter of this tab's backend writes that have not
// settled yet. A remote change (backend.onChanged, keys of our prefix only) is applied to
// memory UNLESS that counter is > 0 for the key; then it is dropped, because our write is
// newer than anything we can have received and will itself reach the backend (last write
// wins in the backend). Once the write has settled, later remote changes apply again.
// preload follows the same rule for keys written before the preload resolved.

export type StorageBackend = {
    getAll(prefix: string): Promise<Record<string, string>>;
    set(items: Record<string, string | null>): Promise<void>;
    onChanged(cb: (changes: Record<string, string | null>) => void): void;
};

type Internals = {
    prefix: string;
    memory: Map<string, string>;
    pending: Map<string, number>;
    backend: StorageBackend | null;
    subscribed: boolean;
};

const internals = new WeakMap<Storage, Internals>();

export function createSyncStorage(opts: {backend: StorageBackend | null, prefix: string}): Storage {
    const state: Internals = {prefix: opts.prefix, memory: new Map(), pending: new Map(), backend: opts.backend, subscribed: false};

    const write = (items: Record<string, string | null>): void => {
        const backend = state.backend;
        if (backend === null) { return; }
        const keys = Object.keys(items);
        for (const k of keys) { state.pending.set(k, (state.pending.get(k) ?? 0) + 1); }
        const settle = () => {
            for (const k of keys) {
                const n = (state.pending.get(k) ?? 1) - 1;
                if (n <= 0) { state.pending.delete(k); } else { state.pending.set(k, n); }
            }
        };
        let promise: Promise<void>;
        try { promise = backend.set(items); } catch (e) { promise = Promise.reject(e); }
        promise.then(settle, settle);
    };

    const storage: Storage = {
        getItem: (key) => state.memory.get(String(key)) ?? null,
        setItem: (key, value) => {
            const k = String(key);
            const v = String(value);
            state.memory.set(k, v);
            write({[state.prefix + k]: v});
        },
        removeItem: (key) => {
            const k = String(key);
            if (!state.memory.delete(k)) { return; }
            write({[state.prefix + k]: null});
        },
        clear: () => {
            const items: Record<string, string | null> = {};
            for (const k of state.memory.keys()) { items[state.prefix + k] = null; }
            state.memory.clear();
            if (Object.keys(items).length > 0) { write(items); }
        },
        key: (index) => {
            if (!Number.isInteger(index) || index < 0) { return null; }
            let i = 0;
            for (const k of state.memory.keys()) {
                if (i === index) { return k; }
                ++i;
            }
            return null;
        },
        get length() { return state.memory.size; },
    };
    internals.set(storage, state);
    return storage;
}

function applyRemote(state: Internals, changes: Record<string, string | null>): void {
    for (const [fullKey, value] of Object.entries(changes)) {
        if (!fullKey.startsWith(state.prefix)) { continue; }
        const key = fullKey.slice(state.prefix.length);
        if ((state.pending.get(fullKey) ?? 0) > 0) { continue; }
        if (value === null) { state.memory.delete(key); } else { state.memory.set(key, value); }
    }
}

/** Loads the backend contents (own prefix) into memory and starts listening to other tabs. */
export async function preloadSyncStorage(storage: Storage, backend: StorageBackend | null): Promise<void> {
    const state = internals.get(storage);
    if (!state || backend === null) { return; }
    if (!state.subscribed) {
        state.subscribed = true;
        backend.onChanged((changes) => { applyRemote(state, changes); });
    }
    applyRemote(state, await backend.getAll(state.prefix));
}

/** Backend over chrome.storage.local (Chrome and Firefox: promise API, get(null) + filter). */
export function chromeStorageBackend(): StorageBackend {
    const local = () => chrome.storage.local;
    return {
        getAll: async (prefix) => {
            const all = (await local().get(null)) as Record<string, unknown>;
            const result: Record<string, string> = {};
            for (const [k, v] of Object.entries(all)) {
                if (k.startsWith(prefix) && typeof v === 'string') { result[k] = v; }
            }
            return result;
        },
        set: async (items) => {
            const toSet: Record<string, string> = {};
            const toRemove: string[] = [];
            for (const [k, v] of Object.entries(items)) {
                if (v === null) { toRemove.push(k); } else { toSet[k] = v; }
            }
            if (Object.keys(toSet).length > 0) { await local().set(toSet); }
            if (toRemove.length > 0) { await local().remove(toRemove); }
        },
        onChanged: (cb) => {
            chrome.storage.onChanged.addListener((changes, area) => {
                if (area !== 'local') { return; }
                const out: Record<string, string | null> = {};
                for (const [k, c] of Object.entries(changes)) {
                    out[k] = typeof c.newValue === 'string' ? c.newValue : null;
                }
                cb(out);
            });
        },
    };
}
