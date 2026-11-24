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

import {afterEach, describe, expect, test, vi} from 'vitest';
import {Backend} from '../ext/js/background/backend.js';
import {API} from '../ext/js/comm/api.js';
import {parseJson} from '../ext/js/core/json.js';

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

describe('findAnkiNotesInDeck', () => {
    const findNotesInDeck = Backend.prototype._onApiFindAnkiNotesInDeck;
    const params = {noteIds: [5, 6], deckName: 'D "x" _*', modelName: 'M'};

    test('asks AnkiConnect once, with the names as they are', async () => {
        const find = vi.fn(async () => [6]);
        expect(await findNotesInDeck.call(/** @type {*} */ ({_anki: {findNotesInDeck: find}}), params, /** @type {*} */ ({}))).toStrictEqual([6]);
        expect(find.mock.calls).toStrictEqual([[[5, 6], 'D "x" _*', 'M']]);
    });

    test('a failure is a failure, not «none»', async () => {
        const find = async () => { throw new Error('Anki connection failure'); };
        await expect(findNotesInDeck.call(/** @type {*} */ ({_anki: {findNotesInDeck: find}}), params, /** @type {*} */ ({}))).rejects.toThrow('Anki connection failure');
    });

    describe('API → the api map of a real Backend → AnkiConnect', () => {
        afterEach(() => { vi.unstubAllGlobals(); });

        /**
         * @param {(query: string) => Response} findNotes
         * @returns {{api: API, requests: {action: string, params: {query?: string}}[]}}
         */
        function wire(findNotes) {
            /** @type {{action: string, params: {query?: string}}[]} */
            const requests = [];
            vi.stubGlobal('fetch', /** @type {typeof fetch} */ (async (_input, init = {}) => {
                /** @type {{action: string, params: {query?: string}}} */
                const body = parseJson(typeof init.body === 'string' ? init.body : '{}');
                requests.push(body);
                return body.action === 'version' ? new Response('6') : findNotes(body.params.query ?? '');
            }));
            vi.stubGlobal('chrome', {storage: {local: {}}, runtime: {}, offscreen: {}});
            const backend = new Backend(/** @type {*} */ ({getUrl: (/** @type {string} */ path) => path}));
            backend._anki.enabled = true;
            backend._anki.server = 'http://anki.invalid';
            return {
                requests,
                api: new API(/** @type {*} */ ({
                    sendMessage: (/** @type {import('api').ApiMessageAny} */ message, /** @type {(response: unknown) => void} */ callback) => {
                        if (!backend._onMessage(message, /** @type {*} */ ({}), callback)) { callback(void 0); }
                    },
                    getLastError: () => null,
                })),
            };
        }

        test('the query has the deck, the type and the notes, each in its place', async () => {
            const {api, requests} = wire(() => new Response('[6]'));
            expect(await api.findAnkiNotesInDeck([5, 6], 'The deck', 'The type')).toStrictEqual([6]);
            expect(requests.map(({action, params: {query}}) => [action, query])).toStrictEqual([['version', void 0], ['findNotes', '"deck:The deck" "note:The type" nid:5,6']]);
        });

        test('a failure reaches the caller', async () => {
            const {api} = wire(() => new Response('', {status: 500}));
            await expect(api.findAnkiNotesInDeck([5], 'D', 'M')).rejects.toThrow('Anki connection error: 500');
        });

        test('a server that cannot search reaches the caller as a failure', async () => {
            const {api} = wire(() => new Response('[]'));
            await expect(api.findAnkiNotesInDeck([5], 'D', 'M')).rejects.toThrow('cannot search');
        });
    });
});
/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */
