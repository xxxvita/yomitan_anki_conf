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
 * Bootstrap for the video-examples feature: ensures the `data` and
 * `flib_media` fields exist on the "Yomitan Card Type" note type, gated behind an AnkiConnect capability
 * probe. Idempotent — safe to call on every options-apply, but the caller is
 * expected to memoise by (server, enabled) signature to avoid extra HTTP.
 *
 * Returns a result discriminated by `status` so the caller can decide whether
 * to enable the Ex button, surface a toast, log a warning, etc.
 *
 * See docs/prd/video-examples.md (Stage 3, P1) for the wider design.
 */

import {FLIB_MEDIA_FIELD_NAME} from './flib-anki-media.js';

export const VIDEO_EXAMPLES_MODEL_NAME = 'Yomitan Card Type';

export const VIDEO_EXAMPLES_FIELD_NAME = 'data';

/**
 * Fields the bootstrap appends when missing, in this order: `data` (video
 * examples JSON) and `flib_media` (gateway clips, docs/gateway-clips-to-anki-spec.md).
 * Each missing one costs one schema change (Anki then asks for a full sync);
 * fields already present cost nothing.
 */
export const VIDEO_EXAMPLES_BOOTSTRAP_FIELD_NAMES = Object.freeze([VIDEO_EXAMPLES_FIELD_NAME, FLIB_MEDIA_FIELD_NAME]);

/** Needed only when a case-variant `flib_media` must be renamed (see planFieldChanges). */
const FIELD_RENAME_ACTION = 'modelFieldRename';

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
 *   {status: 'field_added', addedFields: string[], renamedFields: string[]} |
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
        reflect = await ankiConnect.apiReflect(['actions'], [...VIDEO_EXAMPLES_REQUIRED_ACTIONS, FIELD_RENAME_ACTION]);
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
    const plan = planFieldChanges(fields);
    if (plan.length === 0) {
        return {status: 'ready'};
    }
    // `modelFieldRename` is required only when a rename is due: an older
    // AnkiConnect without it keeps working for users whose fields are fine.
    if (plan.some(({rename}) => rename !== null) && !reflect.actions.includes(FIELD_RENAME_ACTION)) {
        return {status: 'unsupported_anki_connect', missingActions: [FIELD_RENAME_ACTION]};
    }

    /** @type {string[]} */
    const addedFields = [];
    /** @type {string[]} */
    const renamedFields = [];
    for (const {fieldName, rename} of plan) {
        if (rename !== null) {
            try {
                // Case-only rename keeps note data (verified on Anki 26.5).
                await ankiConnect.modelFieldRename(VIDEO_EXAMPLES_MODEL_NAME, rename, fieldName);
            } catch (e) {
                return {status: 'connect_failed', error: `modelFieldRename ${rename} → ${fieldName}: ${errorMessage(e)}`};
            }
            renamedFields.push(fieldName);
            continue;
        }
        try {
            // Omit `index` → append. Passing -1 would put the field one-from-last.
            await ankiConnect.modelFieldAdd(VIDEO_EXAMPLES_MODEL_NAME, fieldName);
        } catch (e) {
            // Fields changed before this one stay; the retry only does what is still due.
            return {status: 'connect_failed', error: `modelFieldAdd ${fieldName}: ${errorMessage(e)}`};
        }
        addedFields.push(fieldName);
    }

    // AnkiConnect `addNote` silently drops payload keys that don't match an
    // existing model field, so a missed write is invisible at write time.
    // Re-read the schema to make sure the mutation actually landed before we
    // ever write to the new fields.
    let fieldsAfter;
    try {
        fieldsAfter = await ankiConnect.getModelFieldNames(VIDEO_EXAMPLES_MODEL_NAME);
    } catch (e) {
        return {status: 'verify_failed', error: `re-read fields: ${errorMessage(e)}`};
    }
    const stillDue = planFieldChanges(fieldsAfter).map(({fieldName}) => fieldName);
    if (stillDue.length > 0) {
        return {status: 'verify_failed', error: `schema change reported success but field is absent: ${stillDue.join(', ')}`};
    }

    return {status: 'field_added', addedFields, renamedFields};
}

/**
 * What the bootstrap must do to each field.
 * - `data`: present in any case → nothing (today's behaviour: existing
 *   templates may use `{{Data}}`, and the runtime looks it up case-insensitively).
 * - `flib_media`: exact → nothing; a case variant (`Flib_Media`) → rename to
 *   the exact name, because templates (`{{flib_media}}`) and note-field keys
 *   are case-sensitive; absent → append.
 * @param {string[]} fields
 * @returns {Array<{fieldName: string, rename: ?string}>} `rename` = the live name to rename from; null = append.
 */
function planFieldChanges(fields) {
    /** @type {Array<{fieldName: string, rename: ?string}>} */
    const plan = [];
    for (const fieldName of VIDEO_EXAMPLES_BOOTSTRAP_FIELD_NAMES) {
        if (fieldName === VIDEO_EXAMPLES_FIELD_NAME) {
            if (!hasFieldCaseInsensitive(fields, fieldName)) { plan.push({fieldName, rename: null}); }
            continue;
        }
        if (fields.includes(fieldName)) { continue; }
        const lower = fieldName.toLowerCase();
        const variant = fields.find((f) => f.toLowerCase() === lower);
        plan.push({fieldName, rename: typeof variant === 'string' ? variant : null});
    }
    return plan;
}

/**
 * Case-insensitive presence check (`data` policy; see planFieldChanges for `flib_media`).
 * @param {string[]} fields
 * @param {string} needle
 * @returns {boolean}
 */
export function hasFieldCaseInsensitive(fields, needle) {
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
