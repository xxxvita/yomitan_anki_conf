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

/* eslint-disable no-underscore-dangle -- the provisioning path is driven through the controller's private seams (_modifying, _deleteDictionaryData, _importInWorker, _readFile, _addDictionarySettings) */

import {afterAll, describe, expect, test, vi} from 'vitest';
import {setupDomTest} from './fixtures/dom-test.js';
import {FLIB_SETTINGS_SNAPSHOT_KEY} from '../ext/js/data/flib-dictionary-provisioning.js';
import {DictionaryImportController, reconcileDictionaryEntries} from '../ext/js/pages/settings/dictionary-import-controller.js';

const env = await setupDomTest();
const {window, teardown} = env;
afterAll(() => teardown(global));

const TITLE = 'wty-en-en';

/** @typedef {{name: string, enabled: boolean, priority: number, alias: string, styles?: string}} DictionarySettingsStub */
/** @typedef {{title: string, revision: string, importSuccess?: boolean}} InstalledStub */

/** @type {DictionarySettingsStub} */
const USER = {name: TITLE, enabled: true, priority: 5, alias: 'MyEN'};
/** @type {DictionarySettingsStub} */
const STALE = {name: TITLE, enabled: false, priority: 1, alias: 'Old'};
/** @type {DictionarySettingsStub} */
const DEFAULT = {name: TITLE, enabled: false, priority: 0, alias: TITLE};
/** @type {DictionarySettingsStub} */
const JMDICT = {name: 'JMdict', enabled: true, priority: 0, alias: 'JMdict'};
/** @type {InstalledStub[]} */
const INSTALLED = [{title: TITLE, revision: 'r1', importSuccess: true}];

/**
 * @typedef {object} SetupState
 * @property {Record<string, DictionarySettingsStub[]>} dictionaries
 * @property {InstalledStub[]} [installed] What getDictionaryInfo reports before the import.
 * @property {Record<string, unknown>} [stored] chrome.storage.local content.
 * @property {?Error[]} [fatalErrors] The worker returns no summary, only these errors.
 * @property {Error[]} [nonFatalErrors] The worker returns a summary plus these errors.
 */

/**
 * The Flib provisioning import (importDictionaryFromFile {file, title, replace}). Everything —
 * busy check, settings snapshot (persisted), delete, import, reconcile — runs inside the
 * controller's own _setModifying(true) section. Only the worker (import/delete) and the file
 * read are stubbed; _importDictionaryFromZip and _addDictionarySettings run for real.
 * @param {SetupState} state
 * @returns {{controller: Record<string, unknown>, calls: string[], profiles: {id: string, options: {dictionaries: DictionarySettingsStub[]}}[], appliedSettings: unknown[], importFile: (replace: boolean) => Promise<Error[]>, storage: Record<string, unknown>}}
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
    /** @type {string[]} */
    const calls = [];
    /** @type {Record<string, unknown>} */
    const storage = structuredClone(state.stored ?? {});
    // Minimal chrome stub for _importDictionaries and the snapshot store.
    vi.stubGlobal('chrome', {
        runtime: {getManifest: () => ({version: '1.0.0.0'})},
        storage: {local: {
            get: async (/** @type {string[]} */ keys) => Object.fromEntries(keys.filter((k) => k in storage).map((k) => [k, structuredClone(storage[k])])),
            set: async (/** @type {Record<string, unknown>} */ items) => { calls.push(`storage:set:${Object.keys(items).join(',')}`); Object.assign(storage, structuredClone(items)); },
            remove: async (/** @type {string} */ key) => { calls.push(`storage:remove:${key}`); delete storage[key]; },
        }},
    });
    const profiles = Object.entries(state.dictionaries).map(([id, dictionaries]) => ({id, options: {dictionaries, anki: {cardFormats: []}, general: {mainDictionary: ''}}}));
    /** @type {Map<string, (details: unknown) => void>} */
    const handlers = new Map();
    const settingsController = {
        profileIndex: 0,
        on: (/** @type {string} */ name, /** @type {(details: unknown) => void} */ handler) => { handlers.set(name, handler); },
        getOptionsFull: async () => ({global: {database: {prefixWildcardsSupported: false}}, profiles: structuredClone(profiles)}),
        getDictionaryInfo: async () => structuredClone(state.installed ?? INSTALLED),
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
            api: {triggerDatabaseUpdated: async (/** @type {string} */ type, /** @type {string} */ cause) => { calls.push(`triggerDatabaseUpdated:${cause}`); }},
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
    const appliedSettings = [];
    self._deleteDictionaryData = vi.fn(async (/** @type {string} */ title) => {
        calls.push(`deleteData:${title}:modifying=${String(self._modifying)}`);
    });
    self._readFile = async () => new ArrayBuffer(3);
    self._importInWorker = vi.fn(async () => {
        calls.push('workerImport');
        if (state.fatalErrors) { return {result: null, errors: state.fatalErrors}; }
        return {result: {title: TITLE, sequenced: false, styles: ''}, errors: [...(state.nonFatalErrors ?? [])]};
    });
    const addOriginal = /** @type {(summary: unknown, settings: unknown) => Promise<Error[]>} */ (self._addDictionarySettings).bind(controller);
    self._addDictionarySettings = async (/** @type {unknown} */ summary, /** @type {unknown} */ settings) => {
        appliedSettings.push(settings);
        return await addOriginal(summary, settings);
    };
    /**
     * @param {boolean} replace
     * @returns {Promise<Error[]>}
     */
    const importFile = (replace) => new Promise((resolve) => {
        const handler = handlers.get('importDictionaryFromFile');
        if (typeof handler === 'undefined') { throw new Error('importDictionaryFromFile is not handled'); }
        handler({file: new File(['zip'], `${TITLE}.zip`), title: TITLE, replace, onImportDone: resolve});
    });
    return {controller: self, calls, profiles, appliedSettings, importFile, storage};
}

describe('DictionaryImportController importDictionaryFromFile', () => {
    test('busy: reports an error and touches nothing', async () => {
        const s = setup({dictionaries: {p1: [USER]}});
        s.controller._modifying = true;
        const errors = await s.importFile(true);
        expect(errors).toHaveLength(1);
        expect(errors[0].message).toMatch(/уже идёт/);
        expect(s.calls).toEqual([]);
    });

    test('replace: snapshot persisted before delete, no intermediate delete broadcast or settings cut, snapshot removed right after the settings are applied', async () => {
        const s = setup({dictionaries: {p1: [JMDICT, USER], p2: [JMDICT]}});
        expect(await s.importFile(true)).toEqual([]);
        expect(s.calls).toEqual([
            `storage:set:${FLIB_SETTINGS_SNAPSHOT_KEY}`,
            `deleteData:${TITLE}:modifying=true`,
            'workerImport',
            'modify:set:profiles[0].options.dictionaries',
            'modify:set:profiles[1].options.dictionaries',
            `storage:remove:${FLIB_SETTINGS_SNAPSHOT_KEY}`,
            'triggerDatabaseUpdated:import',
        ]);
        expect(s.appliedSettings).toEqual([{p1: {...USER, index: 1}}]);
        expect(s.profiles[0].options.dictionaries).toEqual([JMDICT, {...USER, styles: ''}]);
        expect(s.storage).toEqual({});
        expect(s.controller._modifying).toBe(false);
    });

    test('importer non-fatal errors (summary returned) still remove the snapshot', async () => {
        const s = setup({dictionaries: {p1: [USER]}, nonFatalErrors: [new Error('bad media file')]});
        const errors = await s.importFile(true);
        expect(errors.map((e) => e.message)[0]).toBe('bad media file');
        expect(s.storage).toEqual({});
        expect(s.profiles[0].options.dictionaries).toEqual([{...USER, styles: ''}]);
    });

    test('an installed title takes its CURRENT entry and overwrites a stale stored snapshot', async () => {
        const s = setup({dictionaries: {p1: [USER]}, stored: {[FLIB_SETTINGS_SNAPSHOT_KEY]: {[TITLE]: {p1: {...STALE, index: 0}}}}});
        expect(await s.importFile(true)).toEqual([]);
        expect(s.appliedSettings).toEqual([{p1: {...USER, index: 0}}]);
        expect(s.calls[0]).toBe(`storage:set:${FLIB_SETTINGS_SNAPSHOT_KEY}`);
        expect(s.profiles[0].options.dictionaries).toEqual([{...USER, styles: ''}]);
    });

    test('a half-imported title (failed phase B) uses the stored snapshot over its current default entry', async () => {
        const s = setup({
            dictionaries: {p1: [DEFAULT]},
            installed: [{title: TITLE, revision: 'r2', importSuccess: false}],
            stored: {[FLIB_SETTINGS_SNAPSHOT_KEY]: {[TITLE]: {p1: {...USER, index: 0}}}},
        });
        expect(await s.importFile(true)).toEqual([]);
        expect(s.appliedSettings).toEqual([{p1: {...USER, index: 0}}]);
        expect(s.calls.filter((c) => c.startsWith('storage:set'))).toEqual([]);
        expect(s.profiles[0].options.dictionaries).toEqual([{...USER, styles: ''}]);
    });

    test('a plain import of an absent title with a stored snapshot applies it and removes only that title', async () => {
        const s = setup({dictionaries: {p1: [JMDICT]}, installed: [], stored: {[FLIB_SETTINGS_SNAPSHOT_KEY]: {[TITLE]: {p1: {...USER, index: 0}}, other: {p1: {...JMDICT, index: 0}}}}});
        expect(await s.importFile(false)).toEqual([]);
        expect(s.appliedSettings).toEqual([{p1: {...USER, index: 0}}]);
        expect(s.storage).toEqual({[FLIB_SETTINGS_SNAPSHOT_KEY]: {other: {p1: {...JMDICT, index: 0}}}});
        expect(s.profiles[0].options.dictionaries).toEqual([{...USER, styles: ''}, JMDICT]);
    });

    test('a plain import without a snapshot imports with default settings', async () => {
        const s = setup({dictionaries: {p1: []}, installed: []});
        expect(await s.importFile(false)).toEqual([]);
        expect(s.calls).toEqual(['workerImport', 'modify:set:profiles[0].options.dictionaries', 'triggerDatabaseUpdated:import']);
        expect(s.appliedSettings).toEqual([null]);
        expect(s.profiles[0].options.dictionaries.map(({name, enabled}) => `${name}:${enabled}`)).toEqual([`${TITLE}:true`]);
    });

    test('settings are written BEFORE the import broadcast (upstream order), and a default another page appended earlier is overwritten', async () => {
        // The importing page's own DictionaryController answers the broadcast with
        // ensureDictionarySettings; written first, the entry is already there for it. A default that
        // another page's (backend-atomic) ensure appended once the data was committed is replaced by
        // name, never duplicated.
        const s = setup({dictionaries: {p1: [JMDICT, DEFAULT]}, installed: []});
        /** @type {string[]} */
        const atBroadcast = [];
        const settingsController = /** @type {{application: {api: {triggerDatabaseUpdated: (type: string, cause: string) => Promise<void>}}}} */ (s.controller._settingsController);
        settingsController.application.api.triggerDatabaseUpdated = async (_type, cause) => {
            s.calls.push(`triggerDatabaseUpdated:${cause}`);
            atBroadcast.push(...s.profiles[0].options.dictionaries.map(({name, enabled}) => `${name}:${enabled}`));
        };
        expect(await s.importFile(false)).toEqual([]);
        expect(atBroadcast).toEqual(['JMdict:true', `${TITLE}:true`]);
        expect(s.profiles[0].options.dictionaries.map(({name, enabled}) => `${name}:${enabled}`)).toEqual(['JMdict:true', `${TITLE}:true`]);
    });

    test('a fatal import error (no summary) keeps the stored snapshot for the next repair', async () => {
        const s = setup({dictionaries: {p1: [USER]}, fatalErrors: [new Error('Dictionary has an incorrect format')]});
        expect((await s.importFile(true)).map((e) => e.message)).toEqual(['Dictionary has an incorrect format']);
        expect(s.storage).toEqual({[FLIB_SETTINGS_SNAPSHOT_KEY]: {[TITLE]: {p1: {...USER, index: 0}}}});
    });

    test('a failing delete keeps the title installed, so the next run snapshots the user\'s later edits, not the stored copy', async () => {
        const s = setup({dictionaries: {p1: [USER]}});
        s.controller._deleteDictionaryData = async () => { throw new Error('worker died'); };
        expect((await s.importFile(true)).map((e) => e.message)).toEqual(['worker died']);
        expect(s.calls).toEqual([`storage:set:${FLIB_SETTINGS_SNAPSHOT_KEY}`]);
        expect(s.storage).toEqual({[FLIB_SETTINGS_SNAPSHOT_KEY]: {[TITLE]: {p1: {...USER, index: 0}}}});
        expect(s.controller._modifying).toBe(false);

        // The user edits the still-installed dictionary; the next replace must not roll that back.
        const edited = {...USER, priority: 8, alias: 'Edited'};
        s.profiles[0].options.dictionaries = [edited];
        s.controller._deleteDictionaryData = async () => {};
        expect(await s.importFile(true)).toEqual([]);
        expect(s.appliedSettings.at(-1)).toEqual({p1: {...edited, index: 0}});
        expect(s.profiles[0].options.dictionaries).toEqual([{...edited, styles: ''}]);
        expect(s.storage).toEqual({});
    });
});

describe('_addDictionarySettings with a snapshot reconciles by name in one set per profile', () => {
    test('a default inserted by another page and a duplicate are overwritten by the snapshot', async () => {
        const s = setup({dictionaries: {
            p1: [JMDICT, DEFAULT, {...DEFAULT, priority: 7}],
            p2: [{...DEFAULT, alias: 'kept'}],
            p3: [JMDICT],
        }});
        const add = /** @type {(summary: unknown, settings: unknown) => Promise<Error[]>} */ (s.controller._addDictionarySettings);
        expect(await add({title: TITLE, sequenced: false, styles: 'S'}, {p1: {...USER, index: 1}})).toEqual([]);
        expect(s.calls).toEqual([
            'modify:set:profiles[0].options.dictionaries',
            'modify:set:profiles[1].options.dictionaries',
            'modify:set:profiles[2].options.dictionaries',
        ]);
        expect(s.profiles[0].options.dictionaries).toEqual([JMDICT, {...USER, styles: 'S'}]);
        expect(s.profiles[1].options.dictionaries).toEqual([{...DEFAULT, alias: 'kept'}]);
        expect(s.profiles[2].options.dictionaries.map(({name}) => name)).toEqual(['JMdict', TITLE]);
        expect(s.profiles[2].options.dictionaries[1].enabled).toBe(false);
    });
});

describe('reconcileDictionaryEntries', () => {
    const OTHER = {name: 'B', enabled: true, priority: 0, alias: 'B'};
    test('preferred entry replaces every same-name entry at its index', () => {
        expect(reconcileDictionaryEntries([JMDICT, DEFAULT, OTHER, DEFAULT], TITLE, {entry: USER, index: 1}, DEFAULT)).toEqual([JMDICT, USER, OTHER]);
    });
    test('the index is clamped to the end', () => {
        expect(reconcileDictionaryEntries([JMDICT], TITLE, {entry: USER, index: 9}, DEFAULT)).toEqual([JMDICT, USER]);
    });
    test('without a preferred entry the first existing one is kept in place', () => {
        expect(reconcileDictionaryEntries([JMDICT, USER, OTHER, DEFAULT], TITLE, null, DEFAULT)).toEqual([JMDICT, USER, OTHER]);
    });
    test('without any entry the fallback is appended', () => {
        expect(reconcileDictionaryEntries([JMDICT], TITLE, null, DEFAULT)).toEqual([JMDICT, DEFAULT]);
    });
});

/* eslint-enable no-underscore-dangle */
