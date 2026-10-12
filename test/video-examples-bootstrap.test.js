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
import {FLIB_MEDIA_FIELD_NAME} from '../ext/js/data/flib-anki-media.js';
import {
    VIDEO_EXAMPLES_BOOTSTRAP_FIELD_NAMES,
    VIDEO_EXAMPLES_MODEL_NAME,
    VIDEO_EXAMPLES_REQUIRED_ACTIONS,
    bootstrapVideoExamplesField,
} from '../ext/js/data/video-examples-bootstrap.js';

/**
 * A fake AnkiConnect holding one model's field list. `modelFieldAdd` appends
 * and `modelFieldRename` renames (unless told to lie or throw) so the verify
 * re-read sees the real effect.
 * @param {{fields: string[], addThrows?: string, addIsNoop?: boolean, renameSupported?: boolean}} details
 * @returns {{anki: import('../ext/js/comm/anki-connect.js').AnkiConnect, modelFieldAdd: import('vitest').Mock, modelFieldRename: import('vitest').Mock, fields: string[]}}
 */
function makeAnki({fields, addThrows, addIsNoop = false, renameSupported = true}) {
    const state = [...fields];
    const modelFieldAdd = vi.fn(async (/** @type {string} */ modelName, /** @type {string} */ fieldName, /** @type {number|undefined} */ index) => {
        expect(modelName).toBe(VIDEO_EXAMPLES_MODEL_NAME);
        expect(index).toBeUndefined();
        if (typeof addThrows === 'string') { throw new Error(addThrows); }
        if (!addIsNoop) { state.push(fieldName); }
        return null;
    });
    const modelFieldRename = vi.fn(async (/** @type {string} */ modelName, /** @type {string} */ oldName, /** @type {string} */ newName) => {
        expect(modelName).toBe(VIDEO_EXAMPLES_MODEL_NAME);
        const i = state.indexOf(oldName);
        if (i < 0) { throw new Error('field not found'); }
        state[i] = newName;
        return null;
    });
    const anki = /** @type {import('../ext/js/comm/anki-connect.js').AnkiConnect} */ (/** @type {unknown} */ ({
        enabled: true,
        isConnected: async () => true,
        apiReflect: async () => ({scopes: ['actions'], actions: [...VIDEO_EXAMPLES_REQUIRED_ACTIONS, ...(renameSupported ? ['modelFieldRename'] : [])]}),
        getModelNames: async () => ['Basic', VIDEO_EXAMPLES_MODEL_NAME],
        getModelFieldNames: async () => [...state],
        modelFieldAdd,
        modelFieldRename,
    }));
    return {anki, modelFieldAdd, modelFieldRename, fields: state};
}

describe('bootstrapVideoExamplesField: data + flib_media', () => {
    test('the shared field-name constant and the bootstrap list', () => {
        expect(FLIB_MEDIA_FIELD_NAME).toBe('flib_media');
        expect(VIDEO_EXAMPLES_BOOTSTRAP_FIELD_NAMES).toStrictEqual(['data', 'flib_media']);
    });

    test('both fields missing → two appends in order, then verified', async () => {
        const {anki, modelFieldAdd, fields} = makeAnki({fields: ['Front', 'Back']});
        const result = await bootstrapVideoExamplesField(anki);
        expect(result).toStrictEqual({status: 'field_added', addedFields: ['data', 'flib_media'], renamedFields: []});
        expect(modelFieldAdd.mock.calls).toStrictEqual([
            [VIDEO_EXAMPLES_MODEL_NAME, 'data'],
            [VIDEO_EXAMPLES_MODEL_NAME, 'flib_media'],
        ]);
        expect(fields).toStrictEqual(['Front', 'Back', 'data', 'flib_media']);
    });

    test('data present, flib_media missing → exactly one append', async () => {
        const {anki, modelFieldAdd} = makeAnki({fields: ['Front', 'Data']});
        const result = await bootstrapVideoExamplesField(anki);
        expect(result).toStrictEqual({status: 'field_added', addedFields: ['flib_media'], renamedFields: []});
        expect(modelFieldAdd.mock.calls).toStrictEqual([[VIDEO_EXAMPLES_MODEL_NAME, 'flib_media']]);
    });

    test.each([
        [['Front', 'data', 'flib_media']],
        [['Front', 'DATA', 'flib_media']],
        [['flib_media', 'Front', 'Data']],
    ])('data in any case + exact flib_media (%j) → ready, zero schema calls', async (present) => {
        const {anki, modelFieldAdd, modelFieldRename} = makeAnki({fields: present});
        expect(await bootstrapVideoExamplesField(anki)).toStrictEqual({status: 'ready'});
        expect(modelFieldAdd).not.toHaveBeenCalled();
        expect(modelFieldRename).not.toHaveBeenCalled();
    });

    test.each([
        [['Front', 'data', 'Flib_Media'], 'Flib_Media'],
        [['Front', 'Data', 'FLIB_MEDIA'], 'FLIB_MEDIA'],
    ])('case-variant flib_media (%j) → exactly one rename to the exact name, zero adds; data untouched', async (present, liveName) => {
        const {anki, modelFieldAdd, modelFieldRename, fields} = makeAnki({fields: present});
        expect(await bootstrapVideoExamplesField(anki)).toStrictEqual({status: 'field_added', addedFields: [], renamedFields: ['flib_media']});
        expect(modelFieldRename.mock.calls).toStrictEqual([[VIDEO_EXAMPLES_MODEL_NAME, liveName, 'flib_media']]);
        expect(modelFieldAdd).not.toHaveBeenCalled();
        expect(fields).toContain(present[1]);
    });

    test('case-variant flib_media but no modelFieldRename in AnkiConnect → unsupported_anki_connect, nothing changed', async () => {
        const {anki, modelFieldAdd, modelFieldRename} = makeAnki({fields: ['data', 'Flib_Media'], renameSupported: false});
        expect(await bootstrapVideoExamplesField(anki)).toStrictEqual({status: 'unsupported_anki_connect', missingActions: ['modelFieldRename']});
        expect(modelFieldAdd).not.toHaveBeenCalled();
        expect(modelFieldRename).not.toHaveBeenCalled();
    });

    test('no modelFieldRename in AnkiConnect does not matter when no rename is due', async () => {
        const {anki, modelFieldAdd} = makeAnki({fields: ['Data'], renameSupported: false});
        expect(await bootstrapVideoExamplesField(anki)).toStrictEqual({status: 'field_added', addedFields: ['flib_media'], renamedFields: []});
        expect(modelFieldAdd).toHaveBeenCalledTimes(1);
    });

    test('modelFieldAdd reports success but the field is absent → verify_failed', async () => {
        const {anki, modelFieldAdd} = makeAnki({fields: ['Front', 'data'], addIsNoop: true});
        const result = await bootstrapVideoExamplesField(anki);
        expect(result.status).toBe('verify_failed');
        expect(/** @type {{error: string}} */ (result).error).toContain('flib_media');
        expect(modelFieldAdd).toHaveBeenCalledTimes(1);
    });

    test('modelFieldAdd throws → connect_failed (caller retries later), no further adds', async () => {
        const {anki, modelFieldAdd} = makeAnki({fields: ['Front'], addThrows: 'boom'});
        const result = await bootstrapVideoExamplesField(anki);
        expect(result.status).toBe('connect_failed');
        expect(/** @type {{error: string}} */ (result).error).toContain('modelFieldAdd');
        expect(/** @type {{error: string}} */ (result).error).toContain('boom');
        expect(modelFieldAdd).toHaveBeenCalledTimes(1);
    });

    test('model missing → model_missing, nothing added', async () => {
        const {anki, modelFieldAdd} = makeAnki({fields: []});
        /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (anki)).getModelNames = async () => ['Basic'];
        expect(await bootstrapVideoExamplesField(anki)).toStrictEqual({status: 'model_missing'});
        expect(modelFieldAdd).not.toHaveBeenCalled();
    });

    test('disabled → disabled, no network', async () => {
        const {anki, modelFieldAdd} = makeAnki({fields: []});
        /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (anki)).enabled = false;
        expect(await bootstrapVideoExamplesField(anki)).toStrictEqual({status: 'disabled'});
        expect(modelFieldAdd).not.toHaveBeenCalled();
    });
});
