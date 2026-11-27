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

import {isYoutubeSender} from './flib-youtube-proxy.js';

/*
 * Хранилище слоя панели на youtube.com (flib-youtube/src/env/storage.ts) — через фоновую часть.
 * chrome.storage.local закрыт для контент-скриптов (C1, Backend._restrictStorageToTrustedContexts),
 * поэтому слой читает и пишет свои ключи сообщениями flibYoutubeStorageGetAll / Set / Remove.
 *
 * Правила (все три действия):
 * 1. отправитель — вкладка с origin ровно https://www.youtube.com (isYoutubeSender, как у прокси /api);
 * 2. ключ — строка с префиксом `flibYt:` (не длиннее KEY_MAX), иначе ошибка, ничего не пишется;
 * 3. значение — строка (слой хранит только строки, как Storage), не длиннее VALUE_MAX;
 * 4. чтение отдаёт только ключи с префиксом и строковыми значениями — ни одного чужого ключа.
 * Изменения ключей с префиксом в chrome.storage.local фоновая часть рассылает вкладкам YouTube
 * (pickStorageChanges + FlibYoutubeBeta.forwardStorageChanges): так другие вкладки видят запись.
 */

export const FLIB_YT_STORAGE_PREFIX = 'flibYt:';

const KEY_MAX = 512;
const VALUE_MAX = 1024 * 1024;

/**
 * @param {unknown} key
 * @returns {key is string}
 */
export function isLayerKey(key) {
    return typeof key === 'string' && key.length > FLIB_YT_STORAGE_PREFIX.length && key.length <= KEY_MAX && key.startsWith(FLIB_YT_STORAGE_PREFIX);
}

/**
 * @param {{url?: string}|undefined} sender
 * @throws {Error}
 */
function requireYoutubeSender(sender) {
    if (!isYoutubeSender(sender?.url)) { throw new Error('flibYoutubeStorage: sender is not https://www.youtube.com'); }
}

/**
 * @param {unknown} key
 * @throws {Error}
 */
function requireLayerKey(key) {
    if (!isLayerKey(key)) { throw new Error(`flibYoutubeStorage: key outside ${FLIB_YT_STORAGE_PREFIX}`); }
}

/**
 * Изменения chrome.storage.onChanged -> только ключи слоя: `{key: newValue | null}`; null — если ключей нет.
 * @param {Record<string, chrome.storage.StorageChange>} changes
 * @param {string} area
 * @returns {?Record<string, string|null>}
 */
export function pickStorageChanges(changes, area) {
    if (area !== 'local') { return null; }
    /** @type {Record<string, string|null>} */
    const out = {};
    let any = false;
    for (const [key, change] of Object.entries(changes)) {
        if (!isLayerKey(key)) { continue; }
        out[key] = typeof change.newValue === 'string' ? change.newValue : null;
        any = true;
    }
    return any ? out : null;
}

export class FlibYoutubeStorage {
    /**
     * @param {Pick<chrome.storage.StorageArea, 'get'|'set'|'remove'>} [local] Подменяется в тестах.
     */
    constructor(local = chrome.storage.local) {
        /** @type {Pick<chrome.storage.StorageArea, 'get'|'set'|'remove'>} */
        this._local = local;
    }

    /**
     * @param {{url?: string}|undefined} sender
     * @returns {Promise<{items: Record<string, string>}>}
     */
    async getAll(sender) {
        requireYoutubeSender(sender);
        const all = /** @type {Record<string, unknown>} */ (await this._local.get(null));
        /** @type {Record<string, string>} */
        const items = {};
        for (const [key, value] of Object.entries(all)) {
            if (isLayerKey(key) && typeof value === 'string') { items[key] = value; }
        }
        return {items};
    }

    /**
     * @param {unknown} items
     * @param {{url?: string}|undefined} sender
     * @returns {Promise<void>}
     */
    async set(items, sender) {
        requireYoutubeSender(sender);
        if (typeof items !== 'object' || items === null || Array.isArray(items)) { throw new Error('flibYoutubeStorage: items must be an object'); }
        /** @type {Record<string, string>} */
        const checked = {};
        for (const [key, value] of Object.entries(items)) {
            requireLayerKey(key);
            if (typeof value !== 'string' || value.length > VALUE_MAX) { throw new Error('flibYoutubeStorage: value must be a string'); }
            checked[key] = value;
        }
        if (Object.keys(checked).length > 0) { await this._local.set(checked); }
    }

    /**
     * @param {unknown} keys
     * @param {{url?: string}|undefined} sender
     * @returns {Promise<void>}
     */
    async remove(keys, sender) {
        requireYoutubeSender(sender);
        if (!Array.isArray(keys)) { throw new Error('flibYoutubeStorage: keys must be an array'); }
        for (const key of keys) { requireLayerKey(key); }
        if (keys.length > 0) { await this._local.remove(/** @type {string[]} */ (keys)); }
    }
}
