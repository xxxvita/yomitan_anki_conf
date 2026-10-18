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

import {log} from '../../core/log.js';
import {FLIB_PROVISIONED_MARKER_KEY, provisionFlibDictionaries} from '../../data/flib-dictionary-provisioning.js';
import {DictionaryWorker} from '../../dictionary/dictionary-worker.js';

/**
 * Page side of the Flib dictionary pair provisioning (welcome page and settings): binds
 * the orchestrator in data/flib-dictionary-provisioning.js to the extension APIs and to a
 * status block. Element ids are shared by welcome.html and settings.html:
 * #flib-dictionaries-provisioning (root), #flib-dictionaries-status,
 * #flib-dictionaries-progress (.dictionary-import-progress, so the import controller's
 * ImportProgressTracker also drives it during import), #flib-dictionaries-button.
 */

const LOCK_NAME = 'flib-dictionary-provisioning';

/**
 * @typedef {object} StatusView
 * @property {string} text
 * @property {'hidden'|'external'|number} progress `external` = the import flow's tracker draws it.
 * @property {boolean} retry Whether the action button should invite another attempt.
 * @property {boolean} running
 * @property {boolean} error
 */

/**
 * Maps a status to what the page shows. All user-visible strings live here (Russian).
 * @param {import('flib-dictionary-provisioning').ProvisioningStatus} status
 * @returns {StatusView}
 */
export function describeProvisioningStatus(status) {
    switch (status.state) {
        case 'checking':
            return {text: 'Проверяю словари Flib…', progress: 'hidden', retry: false, running: true, error: false};
        case 'downloading':
            return {
                text: `Загружаю словари Flib… (${status.index} из ${status.count})`,
                progress: status.total > 0 ? Math.min(100, Math.floor(status.loaded / status.total * 100)) : 0,
                retry: false,
                running: true,
                error: false,
            };
        case 'removing':
            return {text: `Загружаю словари Flib… (${status.index} из ${status.count}): удаляю старую версию ${status.title}`, progress: 'hidden', retry: false, running: true, error: false};
        case 'importing':
            return {text: `Загружаю словари Flib… (${status.index} из ${status.count}): импорт ${status.title}`, progress: 'external', retry: false, running: true, error: false};
        case 'installed':
            return {text: 'Словари установлены', progress: 'hidden', retry: false, running: false, error: false};
        case 'up-to-date':
            return {text: 'Словари установлены, обновлений нет', progress: 'hidden', retry: false, running: false, error: false};
        case 'busy':
            return {text: 'Словари Flib уже устанавливаются в другой вкладке', progress: 'hidden', retry: true, running: false, error: false};
        case 'unavailable':
            return {text: 'Словари временно недоступны, попробуйте позже', progress: 'hidden', retry: true, running: false, error: false};
        case 'failed':
            return {text: `Не удалось установить словари Flib: ${status.message}`, progress: 'hidden', retry: true, running: false, error: true};
    }
}

/**
 * @param {ArrayBuffer} data
 * @returns {Promise<string>}
 */
async function sha256Hex(data) {
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', data));
    return [...digest].map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * @template T
 * @param {() => Promise<T>} callback
 * @returns {Promise<T|null>}
 */
async function withExclusiveLock(callback) {
    if (typeof navigator === 'undefined' || typeof navigator.locks === 'undefined') { return await callback(); }
    return /** @type {T|null} */ (await navigator.locks.request(LOCK_NAME, {ifAvailable: true}, async (lock) => (lock === null ? null : await callback())));
}

/**
 * Same capture as DictionaryController._updateDictionary: each profile's settings entry for
 * `title` plus its position, so the re-import splices it back with enabled/priority/alias kept.
 * @param {import('../settings/settings-controller.js').SettingsController} settingsController
 * @param {string} title
 * @returns {Promise<import('settings-controller').ProfilesDictionarySettings>}
 */
async function captureDictionarySettings(settingsController, title) {
    const {profiles} = await settingsController.getOptionsFull();
    /** @type {NonNullable<import('settings-controller').ProfilesDictionarySettings>} */
    const result = {};
    for (const profile of profiles) {
        const index = profile.options.dictionaries.findIndex(({name}) => name === title);
        if (index >= 0) { result[profile.id] = {...profile.options.dictionaries[index], index}; }
    }
    return Object.keys(result).length > 0 ? result : null;
}

/**
 * Same steps as DictionaryController._deleteDictionary (worker delete, databaseUpdated,
 * settings entries spliced out), without its list-UI coupling.
 * @param {import('../settings/settings-controller.js').SettingsController} settingsController
 * @param {string} title
 */
async function deleteDictionary(settingsController, title) {
    await new DictionaryWorker().deleteDictionary(title, () => {});
    await settingsController.application.api.triggerDatabaseUpdated('dictionary', 'delete');
    const {profiles} = await settingsController.getOptionsFull();
    /** @type {import('settings-modifications').Modification[]} */
    const targets = [];
    for (let i = 0; i < profiles.length; ++i) {
        const {dictionaries} = profiles[i].options;
        for (let j = dictionaries.length - 1; j >= 0; --j) {
            if (dictionaries[j].name !== title) { continue; }
            targets.push({action: 'splice', path: `profiles[${i}].options.dictionaries`, start: j, deleteCount: 1, items: []});
        }
    }
    if (targets.length > 0) { await settingsController.modifyGlobalSettings(targets); }
}

/**
 * @param {import('../settings/settings-controller.js').SettingsController} settingsController
 * @param {(status: import('flib-dictionary-provisioning').ProvisioningStatus) => void} onStatus
 * @returns {import('flib-dictionary-provisioning').ProvisioningDependencies}
 */
export function createProvisioningDependencies(settingsController, onStatus) {
    const {api} = settingsController.application;
    return {
        fetch: (url, init) => fetch(url, init),
        getDictionaryInfo: () => api.getDictionaryInfo(),
        getMarker: async () => (await chrome.storage.local.get([FLIB_PROVISIONED_MARKER_KEY]))[FLIB_PROVISIONED_MARKER_KEY] === true,
        setMarker: async (value) => {
            await (value ? chrome.storage.local.set({[FLIB_PROVISIONED_MARKER_KEY]: true}) : chrome.storage.local.remove(FLIB_PROVISIONED_MARKER_KEY));
        },
        sha256Hex,
        createObjectUrl: (blob) => URL.createObjectURL(blob),
        revokeObjectUrl: (url) => { URL.revokeObjectURL(url); },
        captureDictionarySettings: (title) => captureDictionarySettings(settingsController, title),
        deleteDictionary: (title) => deleteDictionary(settingsController, title),
        importFromUrl: (url, profilesDictionarySettings) => new Promise((resolve) => {
            settingsController.trigger('importDictionaryFromUrl', {url, profilesDictionarySettings, onImportDone: resolve});
        }),
        withExclusiveLock,
        onStatus,
    };
}

class ProvisioningStatusBlock {
    /**
     * @param {HTMLElement} root
     * @param {boolean} retryOnlyAfterFailure Welcome: the button appears only to retry. Settings: always shown.
     */
    constructor(root, retryOnlyAfterFailure) {
        /** @type {HTMLElement} */
        this._root = root;
        /** @type {?HTMLElement} */
        this._status = root.querySelector('#flib-dictionaries-status');
        /** @type {?HTMLElement} */
        this._progress = root.querySelector('#flib-dictionaries-progress');
        /** @type {?HTMLButtonElement} */
        this._button = root.querySelector('#flib-dictionaries-button');
        /** @type {boolean} */
        this._retryOnlyAfterFailure = retryOnlyAfterFailure;
    }

    /** @type {?HTMLButtonElement} */
    get button() { return this._button; }

    /**
     * @param {import('flib-dictionary-provisioning').ProvisioningStatus} status
     */
    render(status) {
        const view = describeProvisioningStatus(status);
        this._root.hidden = false;
        if (this._status !== null) {
            this._status.textContent = view.text;
            this._status.classList.toggle('danger-text', view.error);
        }
        if (this._progress !== null) {
            this._progress.hidden = view.progress === 'hidden';
            if (typeof view.progress === 'number') {
                for (const bar of this._progress.querySelectorAll('.progress-bar')) { /** @type {HTMLElement} */ (bar).style.width = `${view.progress}%`; }
                for (const label of this._progress.querySelectorAll('.progress-status')) { label.textContent = `${view.progress}%`; }
            }
        }
        if (this._button !== null) {
            this._button.disabled = view.running;
            if (this._retryOnlyAfterFailure) { this._button.hidden = !view.retry; }
        }
    }

    /** @param {boolean} running */
    setRunning(running) {
        if (this._button !== null) { this._button.disabled = running; }
    }
}

/**
 * @param {import('../settings/settings-controller.js').SettingsController} settingsController
 * @param {ProvisioningStatusBlock} block
 * @param {import('flib-dictionary-provisioning').ProvisioningMode} mode
 * @returns {Promise<import('flib-dictionary-provisioning').ProvisioningOutcome>}
 */
async function run(settingsController, block, mode) {
    block.setRunning(true);
    const prevention = settingsController.preventPageExit();
    try {
        return await provisionFlibDictionaries(createProvisioningDependencies(settingsController, (status) => block.render(status)), mode);
    } finally {
        prevention.end();
        block.setRunning(false);
    }
}

/**
 * Welcome page: installs the pair on first run (no-op once the marker is set) and offers
 * «Повторить» on failure. Never throws; the caller does not await it.
 * @param {import('../settings/settings-controller.js').SettingsController} settingsController
 * @returns {Promise<void>}
 */
export async function runDictionaryProvisioning(settingsController) {
    try {
        const root = document.querySelector('#flib-dictionaries-provisioning');
        if (!(root instanceof HTMLElement)) { return; }
        const block = new ProvisioningStatusBlock(root, true);
        block.button?.addEventListener('click', () => { void run(settingsController, block, 'first-run'); }, false);
        await run(settingsController, block, 'first-run');
    } catch (e) {
        log.error(e);
    }
}

/**
 * Settings → Dictionaries: «Установить / обновить словари Flib» runs the pair-level repair
 * (replaces outdated or half-imported titles, keeps their per-profile settings).
 * @param {import('../settings/settings-controller.js').SettingsController} settingsController
 */
export function setupDictionaryProvisioningButton(settingsController) {
    const root = document.querySelector('#flib-dictionaries-provisioning');
    if (!(root instanceof HTMLElement)) { return; }
    const block = new ProvisioningStatusBlock(root, false);
    block.button?.addEventListener('click', () => { void run(settingsController, block, 'repair'); }, false);
}
