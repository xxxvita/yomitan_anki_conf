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

import {translate} from '../../i18n/ui-language.js';
import {log} from '../../core/log.js';
import {FLIB_PROVISIONED_MARKER_KEY, FLIB_RETRY_AFTER_KEY, provisionFlibDictionaries} from '../../data/flib-dictionary-provisioning.js';

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
 * Maps a status to what the page shows. Its strings come from the message files.
 * @param {import('flib-dictionary-provisioning').ProvisioningStatus} status
 * @returns {StatusView}
 */
export function describeProvisioningStatus(status) {
    switch (status.state) {
        case 'checking':
            return {text: translate('provision.checking'), progress: 'hidden', retry: false, running: true, error: false};
        case 'downloading':
            return {
                text: translate('provision.downloading', {index: status.index, count: status.count}),
                progress: status.total > 0 ? Math.min(100, Math.floor(status.loaded / status.total * 100)) : 0,
                retry: false,
                running: true,
                error: false,
            };
        case 'importing':
            return {
                text: translate(status.replace ? 'provision.updating' : 'provision.importing', {index: status.index, count: status.count, title: status.title}),
                progress: 'external',
                retry: false,
                running: true,
                error: false,
            };
        case 'installed':
            return {text: translate('provision.installed'), progress: 'hidden', retry: false, running: false, error: false};
        case 'up-to-date':
            return {text: translate('provision.upToDate'), progress: 'hidden', retry: false, running: false, error: false};
        case 'busy':
            return {text: translate('provision.otherTab'), progress: 'hidden', retry: true, running: false, error: false};
        case 'unavailable':
            return {text: translate('provision.unavailable'), progress: 'hidden', retry: true, running: false, error: false};
        case 'failed':
            return {text: translate('provision.failed', {message: status.message}), progress: 'hidden', retry: true, running: false, error: true};
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
 * @param {import('../settings/settings-controller.js').SettingsController} settingsController
 * @param {(status: import('flib-dictionary-provisioning').ProvisioningStatus) => void} onStatus
 * @returns {import('flib-dictionary-provisioning').ProvisioningDependencies}
 */
export function createProvisioningDependencies(settingsController, onStatus) {
    const {api} = settingsController.application;
    return {
        fetch: (url, init) => fetch(url, init),
        getDictionaryInfo: () => api.getDictionaryInfo(),
        getMarker: async () => {
            const value = /** @type {unknown} */ ((await chrome.storage.local.get([FLIB_PROVISIONED_MARKER_KEY]))[FLIB_PROVISIONED_MARKER_KEY]);
            return value === true || value === 'in-progress' ? value : null;
        },
        setMarker: async (value) => { await chrome.storage.local.set({[FLIB_PROVISIONED_MARKER_KEY]: value}); },
        setRetryAfter: async (value) => {
            await (value === null ? chrome.storage.local.remove(FLIB_RETRY_AFTER_KEY) : chrome.storage.local.set({[FLIB_RETRY_AFTER_KEY]: value}));
        },
        now: () => Date.now(),
        sha256Hex,
        importFile: (file, title, replace) => new Promise((resolve) => {
            settingsController.trigger('importDictionaryFromFile', {file, title, replace, onImportDone: resolve});
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
        block.button?.addEventListener('click', () => {
            void (async () => {
                // Another tab may have finished meanwhile: the retry then finds the marker set.
                if (await run(settingsController, block, 'first-run') === 'already-done') { block.render({state: 'installed'}); }
            })();
        }, false);
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
