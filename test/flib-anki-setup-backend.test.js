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
import {Backend} from '../ext/js/background/backend.js';

/* eslint-disable no-underscore-dangle, @typescript-eslint/unbound-method */
const ensureFor = Backend.prototype._ensureFlibAnkiSetupFor;
const isConnected = Backend.prototype._onApiIsAnkiConnected;

/**
 * @param {boolean} enabled
 * @returns {{context: object, ensureSetup: import('vitest').Mock}}
 */
function makeContext(enabled = true) {
    const ensureSetup = vi.fn(async () => null);
    return {context: {_anki: {enabled}, _getFlibCardEnricher: () => ({ensureSetup})}, ensureSetup};
}

/**
 * @param {string} modelName
 * @returns {import('anki').Note}
 */
const note = (modelName) => /** @type {import('anki').Note} */ (/** @type {unknown} */ ({modelName, fields: {}, tags: [], deckName: 'Flibooster'}));

describe('_ensureFlibAnkiSetupFor', () => {
    test('a Yomitan Card Type note installs the note types before canAdd is asked', async () => {
        const {context, ensureSetup} = makeContext();
        await ensureFor.call(/** @type {*} */ (context), [note('Basic'), note('Yomitan Card Type')]);
        expect(ensureSetup).toHaveBeenCalledTimes(1);
    });

    test('other models only: nothing is installed', async () => {
        const {context, ensureSetup} = makeContext();
        await ensureFor.call(/** @type {*} */ (context), [note('Basic')]);
        expect(ensureSetup).not.toHaveBeenCalled();
    });

    test('Anki integration disabled: nothing is installed', async () => {
        const {context, ensureSetup} = makeContext(false);
        await ensureFor.call(/** @type {*} */ (context), [note('Yomitan Card Type')]);
        expect(ensureSetup).not.toHaveBeenCalled();
    });

    test('a setup failure never breaks the lookup', async () => {
        const {context, ensureSetup} = makeContext();
        ensureSetup.mockRejectedValueOnce(new Error('boom'));
        await expect(ensureFor.call(/** @type {*} */ (context), [note('Yomitan Card Type')])).resolves.toBeUndefined();
    });
});

describe('isAnkiConnected', () => {
    /**
     * @param {boolean} connected
     * @param {string} model
     * @returns {{context: object, ensureSetup: import('vitest').Mock}}
     */
    function makeConnectedContext(connected, model) {
        const ensureSetup = vi.fn(async () => null);
        const context = {
            _anki: {enabled: true, isConnected: async () => connected},
            _getFlibCardEnricher: () => ({ensureSetup}),
            _getProfileOptions: () => ({anki: {cardFormats: [{model}]}}),
            _ensureFlibAnkiSetupFor: Backend.prototype._ensureFlibAnkiSetupFor,
        };
        return {context, ensureSetup};
    }

    test('connected with a Yomitan Card Type format: note types are installed (duplicate check off)', async () => {
        const {context, ensureSetup} = makeConnectedContext(true, 'Yomitan Card Type');
        expect(await isConnected.call(/** @type {*} */ (context), void 0, /** @type {*} */ ({}))).toBe(true);
        expect(ensureSetup).toHaveBeenCalledTimes(1);
    });

    test('not connected: nothing is installed', async () => {
        const {context, ensureSetup} = makeConnectedContext(false, 'Yomitan Card Type');
        expect(await isConnected.call(/** @type {*} */ (context), void 0, /** @type {*} */ ({}))).toBe(false);
        expect(ensureSetup).not.toHaveBeenCalled();
    });

    test('another model: nothing is installed', async () => {
        const {context, ensureSetup} = makeConnectedContext(true, 'Basic');
        await isConnected.call(/** @type {*} */ (context), void 0, /** @type {*} */ ({}));
        expect(ensureSetup).not.toHaveBeenCalled();
    });
});
/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */
