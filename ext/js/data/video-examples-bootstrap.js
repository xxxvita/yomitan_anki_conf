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

/**
 * Bootstrap for the video-examples feature: ensures the `data` field exists
 * on the "Yomitan Card Type" note type, gated behind an AnkiConnect capability
 * probe. Idempotent — safe to call on every options-apply, but the caller is
 * expected to memoise by (server, enabled) signature to avoid extra HTTP.
 *
 * Returns a result discriminated by `status` so the caller can decide whether
 * to enable the Ex button, surface a toast, log a warning, etc.
 *
 * See docs/prd/video-examples.md (Stage 3, P1) for the wider design.
 */

export const VIDEO_EXAMPLES_MODEL_NAME = 'Yomitan Card Type';

export const VIDEO_EXAMPLES_FIELD_NAME = 'data';

/** Actions the feature relies on; bootstrap fails fast if any is missing. */
export const VIDEO_EXAMPLES_REQUIRED_ACTIONS = Object.freeze([
    'modelFieldAdd',
    'modelFieldNames',
    'modelNames',
    'updateNoteFields',
    'notesInfo',
    'canAddNotesWithErrorDetail',
]);

/**
 * @typedef {(
 *   {status: 'disabled'} |
 *   {status: 'ready'} |
 *   {status: 'field_added'} |
 *   {status: 'model_missing'} |
 *   {status: 'unsupported_anki_connect', missingActions: string[]} |
 *   {status: 'connect_failed', error: string} |
 *   {status: 'verify_failed', error: string}
 * )} VideoExamplesBootstrapResult
 */

/**
 * @param {import('../comm/anki-connect.js').AnkiConnect} ankiConnect
 * @returns {Promise<VideoExamplesBootstrapResult>}
 */
export async function bootstrapVideoExamplesField(ankiConnect) {
    if (!ankiConnect.enabled) {
        return {status: 'disabled'};
    }

    if (!(await ankiConnect.isConnected())) {
        return {status: 'connect_failed', error: 'AnkiConnect not reachable'};
    }

    let reflect;
    try {
        reflect = await ankiConnect.apiReflect(['actions'], [...VIDEO_EXAMPLES_REQUIRED_ACTIONS]);
    } catch (e) {
        return {status: 'connect_failed', error: `apiReflect: ${errorMessage(e)}`};
    }
    const missing = VIDEO_EXAMPLES_REQUIRED_ACTIONS.filter((a) => !reflect.actions.includes(a));
    if (missing.length > 0) {
        return {status: 'unsupported_anki_connect', missingActions: missing};
    }

    let models;
    try {
        models = await ankiConnect.getModelNames();
    } catch (e) {
        return {status: 'connect_failed', error: `getModelNames: ${errorMessage(e)}`};
    }
    if (!models.includes(VIDEO_EXAMPLES_MODEL_NAME)) {
        // User hasn't installed the Yomitan Card Type model yet (or renamed it).
        // The video-examples UI will hide its Ex button until the model exists.
        return {status: 'model_missing'};
    }

    let fields;
    try {
        fields = await ankiConnect.getModelFieldNames(VIDEO_EXAMPLES_MODEL_NAME);
    } catch (e) {
        return {status: 'connect_failed', error: `getModelFieldNames: ${errorMessage(e)}`};
    }
    if (hasFieldCaseInsensitive(fields, VIDEO_EXAMPLES_FIELD_NAME)) {
        return {status: 'ready'};
    }

    try {
        // Omit `index` → append. Passing -1 would put the field one-from-last.
        await ankiConnect.modelFieldAdd(VIDEO_EXAMPLES_MODEL_NAME, VIDEO_EXAMPLES_FIELD_NAME);
    } catch (e) {
        return {status: 'connect_failed', error: `modelFieldAdd: ${errorMessage(e)}`};
    }

    // AnkiConnect `addNote` silently drops payload keys that don't match an
    // existing model field (case-insensitive match), so a missed write is
    // invisible at write time. Re-read the schema to make sure the mutation
    // actually landed before we ever write a JSON blob to `data`.
    let fieldsAfter;
    try {
        fieldsAfter = await ankiConnect.getModelFieldNames(VIDEO_EXAMPLES_MODEL_NAME);
    } catch (e) {
        return {status: 'verify_failed', error: `re-read fields: ${errorMessage(e)}`};
    }
    if (!hasFieldCaseInsensitive(fieldsAfter, VIDEO_EXAMPLES_FIELD_NAME)) {
        return {status: 'verify_failed', error: 'modelFieldAdd reported success but field is absent'};
    }

    return {status: 'field_added'};
}

/**
 * @param {string[]} fields
 * @param {string} needle
 * @returns {boolean}
 */
function hasFieldCaseInsensitive(fields, needle) {
    const lower = needle.toLowerCase();
    for (const f of fields) {
        if (f.toLowerCase() === lower) { return true; }
    }
    return false;
}

/**
 * Find the actual property name in a noteInfo `fields` object that matches
 * the desired field name case-insensitively. AnkiConnect honours whatever
 * case the model was created with, so the bootstrap accepts `data`/`Data`/
 * `DATA` as equivalent and the runtime lookup must do the same.
 * @param {Record<string, unknown>} fields
 * @param {string} needle
 * @returns {?string}
 */
export function findFieldKeyCaseInsensitive(fields, needle) {
    if (fields === null || typeof fields !== 'object') { return null; }
    if (Object.prototype.hasOwnProperty.call(fields, needle)) { return needle; }
    const lower = needle.toLowerCase();
    for (const k of Object.keys(fields)) {
        if (k.toLowerCase() === lower) { return k; }
    }
    return null;
}

/**
 * @param {unknown} e
 * @returns {string}
 */
function errorMessage(e) {
    if (e instanceof Error) { return e.message; }
    return String(e);
}
