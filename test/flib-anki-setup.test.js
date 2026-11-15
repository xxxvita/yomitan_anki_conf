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
import {ensureFlibAnkiSetup} from '../ext/js/background/flib-anki-setup.js';
import {ExtensionError} from '../ext/js/core/extension-error.js';

/**
 * @param {string} name
 * @param {string[]} fields
 * @returns {import('flib-anki-models').FlibAnkiModel}
 */
const model = (name, fields) => ({name, fields, css: '/* ankimodels-rev:0123456789abcdef */\n', isCloze: false, cardTemplates: [{Name: 'Card 1', Front: '', Back: ''}]});
const MODELS = [model('Phrases', ['Front', 'Expression']), model('ReverseDeck', ['Front', 'Back']), model('Yomitan Card Type', ['Word', 'ExampleLLM', 'Audio_Translate'])];

/**
 * @param {Record<string, string[]>} existing model name → fields
 * @returns {{anki: object, calls: string[]}}
 */
function fakeAnki(existing) {
    /** @type {string[]} */
    const calls = [];
    const anki = {
        getModelNames: vi.fn(async () => Object.keys(existing)),
        getModelFieldNames: vi.fn(async (/** @type {string} */ name) => existing[name] ?? []),
        modelFieldAdd: vi.fn(async (/** @type {string} */ name, /** @type {string} */ field, /** @type {number} */ index) => { calls.push(`field ${name}.${field}@${index}`); }),
        createModel: vi.fn(async (/** @type {{name: string}} */ m) => { calls.push(`model ${m.name}`); }),
        createDeck: vi.fn(async (/** @type {string} */ deck) => { calls.push(`deck ${deck}`); return 1; }),
    };
    return {anki, calls};
}

describe('ensureFlibAnkiSetup', () => {
    test('creates missing models and the deck', async () => {
        const {anki, calls} = fakeAnki({Basic: ['Front']});
        const result = await ensureFlibAnkiSetup(/** @type {*} */ (anki), MODELS, 'Flibooster');
        expect(calls).toStrictEqual(['model Phrases', 'model ReverseDeck', 'model Yomitan Card Type', 'deck Flibooster']);
        expect(result).toStrictEqual({created: ['Phrases', 'ReverseDeck', 'Yomitan Card Type'], fieldsAdded: [], deckOk: true});
    });

    test('existing model is never recreated: only missing fields are appended', async () => {
        const {anki, calls} = fakeAnki({'Yomitan Card Type': ['Word'], 'Phrases': ['Front', 'Expression'], 'ReverseDeck': ['Front', 'Back']});
        const result = await ensureFlibAnkiSetup(/** @type {*} */ (anki), MODELS, 'Flibooster');
        expect(anki.createModel).not.toHaveBeenCalled();
        expect(calls).toStrictEqual(['field Yomitan Card Type.ExampleLLM@1', 'field Yomitan Card Type.Audio_Translate@2', 'deck Flibooster']);
        expect(result.fieldsAdded).toStrictEqual(['Yomitan Card Type.ExampleLLM', 'Yomitan Card Type.Audio_Translate']);
    });

    test('field names match case-insensitively, like Anki', async () => {
        const {anki} = fakeAnki({'Yomitan Card Type': ['word', 'examplellm', 'audio_translate'], 'Phrases': ['Front', 'Expression'], 'ReverseDeck': ['Front', 'Back']});
        await ensureFlibAnkiSetup(/** @type {*} */ (anki), MODELS, 'Flibooster');
        expect(anki.modelFieldAdd).not.toHaveBeenCalled();
    });

    test('already exists race is not an error', async () => {
        const {anki} = fakeAnki({});
        anki.createModel.mockRejectedValueOnce(new ExtensionError('Anki error: Model name already exists'));
        const result = await ensureFlibAnkiSetup(/** @type {*} */ (anki), MODELS, 'Flibooster');
        expect(result.created).toStrictEqual(['ReverseDeck', 'Yomitan Card Type']);
    });

    test('deck failure is not fatal', async () => {
        const {anki} = fakeAnki({});
        anki.createDeck.mockRejectedValueOnce(new Error('boom'));
        expect((await ensureFlibAnkiSetup(/** @type {*} */ (anki), MODELS, 'Flibooster')).deckOk).toBe(false);
    });

    test('createModel failure → anki_model_failed', async () => {
        const {anki} = fakeAnki({});
        anki.createModel.mockRejectedValueOnce(new ExtensionError('Anki error: disk full'));
        await expect(ensureFlibAnkiSetup(/** @type {*} */ (anki), MODELS, 'Flibooster')).rejects.toMatchObject({data: {code: 'anki_model_failed'}});
    });

    test('field add failure → anki_model_outdated', async () => {
        const {anki} = fakeAnki({'Yomitan Card Type': ['Word'], 'Phrases': ['Front', 'Expression'], 'ReverseDeck': ['Front', 'Back']});
        anki.modelFieldAdd.mockRejectedValueOnce(new Error('no such action'));
        await expect(ensureFlibAnkiSetup(/** @type {*} */ (anki), MODELS, 'Flibooster')).rejects.toMatchObject({data: {code: 'anki_model_outdated'}});
    });
});
