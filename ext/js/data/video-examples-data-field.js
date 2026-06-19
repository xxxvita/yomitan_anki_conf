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

import {parseJson} from '../core/json.js';

/** @typedef {import('anki-conf').ClipsPersistedItem} ClipsPersistedItem */

export const DATA_FIELD_OWNER = 'flib-club-video-examples';

export const DATA_FIELD_VERSION = 1;

/**
 * @typedef {object} VideoDataEntry
 * @property {string} cache_key
 * @property {number} duration_ms
 * @property {string} subtitle_text
 * @property {{token: string, order_index: number}} recut
 * @property {string} lemma
 * @property {string[]} forms
 * @property {number} [year]
 * @property {string} [cefr]
 * @property {number} [difficulty]
 * @property {string} server_origin
 * @property {string} selected_at
 */

/**
 * @typedef {object} VideoDataDocument
 * @property {string} _owner
 * @property {number} v
 * @property {VideoDataEntry[]} videos
 */

/**
 * Serialise the wire-shape `persisted[]` from `clips/persist` into the
 * single-line JSON string that lands in the Anki note's `data` field.
 *
 * Adds:
 *   - `_owner` marker so future re-parsers can tell our data apart from any
 *     other plugin that decides to scribble in `data`.
 *   - `v` schema version for forward-compat.
 *   - `server_origin` so the F2 hover-replay path can detect cross-server
 *     drift (e.g. user switched their Core URL between save and recall) and
 *     warn instead of silently 404-ing.
 *   - `selected_at` ISO timestamp purely for user-facing UX in P8/P9.
 *
 * `subtitle_text` is normalised NFC and the line/paragraph separators
 * U+2028/U+2029 — valid in JSON, but they break legacy `eval`-based JSON
 * readers and some Anki template engines — are escaped to `\n`.
 * @param {ClipsPersistedItem[]} persisted
 * @param {{serverOrigin: string, nowIso: string}} ctx
 * @returns {string}
 */
export function serializeVideosForData(persisted, ctx) {
    /** @type {VideoDataEntry[]} */
    const videos = [];
    for (const p of persisted) {
        if (typeof p.cache_key !== 'string' || p.cache_key.length === 0) { continue; }
        /** @type {VideoDataEntry} */
        const entry = {
            cache_key: p.cache_key,
            duration_ms: typeof p.duration_ms === 'number' ? p.duration_ms : 0,
            subtitle_text: sanitizeText(p.subtitle_text),
            recut: {
                token: typeof p.recut?.token === 'string' ? p.recut.token : '',
                order_index: typeof p.recut?.order_index === 'number' ? p.recut.order_index : 0,
            },
            lemma: typeof p.meta?.lemma === 'string' ? p.meta.lemma : '',
            forms: Array.isArray(p.meta?.forms) ? p.meta.forms.filter((f) => typeof f === 'string') : [],
            server_origin: ctx.serverOrigin,
            selected_at: ctx.nowIso,
        };
        if (typeof p.meta?.year === 'number') { entry.year = p.meta.year; }
        if (typeof p.meta?.cefr === 'string' && p.meta.cefr.length > 0) { entry.cefr = p.meta.cefr; }
        if (typeof p.meta?.difficulty === 'number') { entry.difficulty = p.meta.difficulty; }
        videos.push(entry);
    }

    /** @type {VideoDataDocument} */
    const doc = {
        _owner: DATA_FIELD_OWNER,
        v: DATA_FIELD_VERSION,
        videos,
    };
    return JSON.stringify(doc);
}

/**
 * Parse a `data` field value back into the document shape. Returns null when
 * the value is empty, not JSON, not an object, or owned by a different
 * plugin — never throws.
 * @param {string} value
 * @returns {?VideoDataDocument}
 */
export function parseVideosFromData(value) {
    if (typeof value !== 'string' || value.trim().length === 0) { return null; }
    /** @type {unknown} */
    let parsed;
    try {
        parsed = parseJson(value);
    } catch {
        return null;
    }
    if (typeof parsed !== 'object' || parsed === null) { return null; }
    const obj = /** @type {Record<string, unknown>} */ (parsed);
    // eslint-disable-next-line no-underscore-dangle
    if (obj._owner !== DATA_FIELD_OWNER) { return null; }
    if (obj.v !== DATA_FIELD_VERSION) { return null; }
    if (!Array.isArray(obj.videos)) { return null; }
    /** @type {VideoDataEntry[]} */
    const videos = [];
    for (const item of /** @type {unknown[]} */ (obj.videos)) {
        if (typeof item !== 'object' || item === null) { continue; }
        const v = /** @type {Record<string, unknown>} */ (item);
        if (typeof v.cache_key !== 'string' || v.cache_key.length === 0) { continue; }
        /** @type {VideoDataEntry} */
        const entry = {
            cache_key: v.cache_key,
            duration_ms: typeof v.duration_ms === 'number' ? v.duration_ms : 0,
            subtitle_text: typeof v.subtitle_text === 'string' ? v.subtitle_text : '',
            recut: parseRecut(v.recut),
            lemma: typeof v.lemma === 'string' ? v.lemma : '',
            forms: Array.isArray(v.forms) ? /** @type {unknown[]} */ (v.forms).filter((f) => typeof f === 'string').map((f) => /** @type {string} */ (f)) : [],
            server_origin: typeof v.server_origin === 'string' ? v.server_origin : '',
            selected_at: typeof v.selected_at === 'string' ? v.selected_at : '',
        };
        if (typeof v.year === 'number') { entry.year = v.year; }
        if (typeof v.cefr === 'string' && v.cefr.length > 0) { entry.cefr = v.cefr; }
        if (typeof v.difficulty === 'number') { entry.difficulty = v.difficulty; }
        videos.push(entry);
    }
    return {_owner: DATA_FIELD_OWNER, v: DATA_FIELD_VERSION, videos};
}

/**
 * @param {unknown} raw
 * @returns {{token: string, order_index: number}}
 */
function parseRecut(raw) {
    if (typeof raw !== 'object' || raw === null) {
        return {token: '', order_index: 0};
    }
    const r = /** @type {Record<string, unknown>} */ (raw);
    return {
        token: typeof r.token === 'string' ? r.token : '',
        order_index: typeof r.order_index === 'number' ? r.order_index : 0,
    };
}

/**
 * NFC normalise + escape the JSON-valid-but-eval-breaking line/paragraph
 * separators that occasionally land in transcripts.
 * @param {unknown} text
 * @returns {string}
 */
function sanitizeText(text) {
    if (typeof text !== 'string') { return ''; }
    return text.normalize('NFC').replace(/[\u2028\u2029]/g, '\n');
}
