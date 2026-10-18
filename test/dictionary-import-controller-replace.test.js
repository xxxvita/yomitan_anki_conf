/*
 * Copyright (C) 2025  Yomitan Authors
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

/* eslint-disable no-underscore-dangle -- the replace path is driven through the controller's private seams (_modifying, _deleteDictionaryData, _importDictionaryFromZip) */

import {afterAll, describe, expect, test, vi} from 'vitest';
import {setupDomTest} from './fixtures/dom-test.js';
import {DictionaryImportController} from '../ext/js/pages/settings/dictionary-import-controller.js';

const env = await setupDomTest();
const {window, teardown} = env;
afterAll(() => teardown(global));

/** @typedef {{name: string, enabled: boolean, priority: number, alias: string}} DictionarySettingsStub */

/**
 * The replace path of the Flib provisioning import (importDictionaryFromFile with replaceTitle):
 * the busy check, the settings snapshot and the delete all happen inside the controller's own
 * _setModifying(true) section, so a manual import cannot interleave.
 * @param {{dictionaries: Record<string, DictionarySettingsStub[]>}} state
 * @returns {{controller: Record<string, unknown>, calls: string[], profiles: {id: string, options: {dictionaries: DictionarySettingsStub[]}}[], importedWith: unknown[], importFile: (replaceTitle: ?string) => Promise<Error[]>}}
 */
function setup(state) {
    window.document.body.innerHTML = `
        <button id="dictionary-delete-all-button"></button>
        <button id="dictionary-confirm-delete-all-button"></button>
        <input id="dictionary-import-file-input">
        <div id="dictionary-drop-file-zone"></div>
        <button id="dictionary-import-button"></button>
        <button id="dictionary-import-url-button"></button>
        <textarea id="dictionary-import-url-text"></textarea>
        <div id="dictionary-error" hidden></div>
    `;
    // @ts-expect-error - minimal chrome stub for _importDictionaries
    globalThis.chrome = {runtime: {getManifest: () => ({version: '1.0.0.0'})}};
    /** @type {string[]} */
    const calls = [];
    const profiles = Object.entries(state.dictionaries).map(([id, dictionaries]) => ({id, options: {dictionaries, anki: {cardFormats: []}, general: {mainDictionary: ''}}}));
    /** @type {Map<string, (details: unknown) => void>} */
    const handlers = new Map();
    const settingsController = {
        profileIndex: 0,
        on: (/** @type {string} */ name, /** @type {(details: unknown) => void} */ handler) => { handlers.set(name, handler); },
        getOptionsFull: async () => ({global: {database: {prefixWildcardsSupported: false}}, profiles: structuredClone(profiles)}),
        modifyGlobalSettings: async (/** @type {{action: string, path: string, value?: unknown}[]} */ targets) => {
            for (const target of targets) {
                calls.push(`modify:${target.action}:${target.path}`);
                const match = /^profiles\[(\d+)\]\.options\.dictionaries$/.exec(target.path);
                if (match !== null && target.action === 'set') {
                    profiles[Number(match[1])].options.dictionaries = /** @type {DictionarySettingsStub[]} */ (target.value);
                }
            }
            return targets.map(() => ({}));
        },
        setAllSettings: async () => {},
        preventPageExit: () => ({end: () => {}}),
        application: {
            api: {triggerDatabaseUpdated: async () => { calls.push('triggerDatabaseUpdated'); }},
            triggerStorageChanged: () => {},
        },
    };
    const modalController = {getModal: () => null};
    const controller = new DictionaryImportController(
        /** @type {import('../ext/js/pages/settings/settings-controller.js').SettingsController} */ (/** @type {unknown} */ (settingsController)),
        /** @type {import('../ext/js/pages/settings/modal-controller.js').ModalController} */ (/** @type {unknown} */ (modalController)),
        /** @type {import('../ext/js/pages/settings/status-footer.js').StatusFooter} */ (/** @type {unknown} */ (null)),
    );
    controller.prepare();
    const self = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (controller));
    /** @type {unknown[]} */
    const importedWith = [];
    self._deleteDictionaryData = vi.fn(async (/** @type {string} */ title) => {
        calls.push(`deleteData:${title}:modifying=${String(self._modifying)}`);
    });
    self._importDictionaryFromZip = vi.fn(async (/** @type {File} */ file, /** @type {unknown} */ settings) => {
        calls.push(`importZip:${file.name}`);
        importedWith.push(settings);
        return [];
    });
    /**
     * @param {?string} replaceTitle
     * @returns {Promise<Error[]>}
     */
    const importFile = (replaceTitle) => new Promise((resolve) => {
        const handler = handlers.get('importDictionaryFromFile');
        if (typeof handler === 'undefined') { throw new Error('importDictionaryFromFile is not handled'); }
        handler({file: new File(['zip'], 'wty-en-en.zip'), replaceTitle, onImportDone: resolve});
    });
    return {controller: self, calls, profiles, importedWith, importFile};
}

describe('DictionaryImportController importDictionaryFromFile', () => {
    test('busy: reports an error and deletes nothing', async () => {
        const s = setup({dictionaries: {p1: [{name: 'wty-en-en', enabled: true, priority: 5, alias: 'MyEN'}]}});
        s.controller._modifying = true;
        const errors = await s.importFile('wty-en-en');
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toMatch(/уже идёт/);
        expect(s.calls).toEqual([]);
        expect(s.profiles[0].options.dictionaries).toHaveLength(1);
    });

    test('replace: snapshot, delete and settings removal run inside the busy section, then import with the snapshot', async () => {
        const s = setup({dictionaries: {
            p1: [{name: 'JMdict', enabled: true, priority: 0, alias: 'JMdict'}, {name: 'wty-en-en', enabled: true, priority: 5, alias: 'MyEN'}],
            p2: [{name: 'JMdict', enabled: false, priority: 0, alias: 'JMdict'}],
        }});
        const errors = await s.importFile('wty-en-en');
        expect(errors).toEqual([]);
        expect(s.calls).toEqual([
            'deleteData:wty-en-en:modifying=true',
            'triggerDatabaseUpdated',
            'modify:set:profiles[0].options.dictionaries',
            'importZip:wty-en-en.zip',
        ]);
        expect(s.profiles[0].options.dictionaries.map(({name}) => name)).toEqual(['JMdict']);
        expect(s.importedWith).toEqual([{p1: {name: 'wty-en-en', enabled: true, priority: 5, alias: 'MyEN', index: 1}}]);
        expect(s.controller._modifying).toBe(false);
    });

    test('new title: nothing is deleted and the import gets no snapshot', async () => {
        const s = setup({dictionaries: {p1: []}});
        expect(await s.importFile(null)).toEqual([]);
        expect(s.calls).toEqual(['importZip:wty-en-en.zip']);
        expect(s.importedWith).toEqual([null]);
    });

    test('a failing delete is reported and nothing is imported', async () => {
        const s = setup({dictionaries: {p1: [{name: 'wty-en-en', enabled: true, priority: 5, alias: 'MyEN'}]}});
        s.controller._deleteDictionaryData = async () => { throw new Error('worker died'); };
        const errors = await s.importFile('wty-en-en');
        expect(errors.map((e) => e.message)).toEqual(['worker died']);
        expect(s.calls).toEqual([]);
        expect(s.controller._modifying).toBe(false);
    });
});

/* eslint-enable no-underscore-dangle */
