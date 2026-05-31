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
import {parseJson} from '../../core/json.js';

/**
 * @typedef {{file: string, title: string}} ProvisioningDictionaryEntry
 */

/**
 * Decide which bundled dictionaries still need importing.
 * @param {unknown} manifest Parsed dictionaries.json (expected: ProvisioningDictionaryEntry[]).
 * @param {Set<string>} importedTitles Titles already present in the dictionary DB.
 * @param {boolean} provisioningDone Whether provisioning already completed once.
 * @returns {ProvisioningDictionaryEntry[]}
 */
export function computeDictionariesToImport(manifest, importedTitles, provisioningDone) {
    if (provisioningDone || !Array.isArray(manifest)) { return []; }
    /** @type {ProvisioningDictionaryEntry[]} */
    const entries = manifest;
    return entries.filter((entry) => !importedTitles.has(entry.title));
}

/**
 * @param {string} key
 * @returns {Promise<boolean>}
 */
function getProvisioningDone(key) {
    return new Promise((resolve) => {
        chrome.storage.local.get([key], (store) => { resolve(store[key] === true); });
    });
}

/**
 * Run first-install dictionary provisioning: import any bundled dictionaries listed in
 * data/provisioning/dictionaries.json that are not yet present, reusing the existing
 * import-from-URL flow. Sets the `provisioningDone` marker once every manifest title is
 * present. Inert (returns early) when the manifest is absent or all zips are missing
 * (e.g. a build without the injected zip). Never throws.
 * @param {import('../settings/settings-controller.js').SettingsController} settingsController
 * @param {import('../../application.js').Application} application
 * @param {(path: string) => string} getUrl
 * @returns {Promise<void>}
 */
export async function runDictionaryProvisioning(settingsController, application, getUrl) {
    const markerKey = 'provisioningDone';
    try {
        if (await getProvisioningDone(markerKey)) { return; }

        /** @type {ProvisioningDictionaryEntry[]} */
        let manifest;
        try {
            const response = await fetch(getUrl('data/provisioning/dictionaries.json'));
            if (!response.ok) { return; }
            manifest = parseJson(await response.text());
        } catch (e) {
            return;
        }

        const info = await application.api.getDictionaryInfo();
        const importedTitles = new Set(info.map((entry) => entry.title));
        const toImport = computeDictionariesToImport(manifest, importedTitles, false);

        for (const entry of toImport) {
            const url = getUrl(`data/provisioning/dictionaries/${entry.file}`);
            try {
                const head = await fetch(url);
                if (!head.ok) { continue; }
            } catch (e) {
                // Zip not present in this build (e.g. dev build); skip silently.
                continue;
            }
            await /** @type {Promise<void>} */ (new Promise((resolve) => {
                settingsController.trigger('importDictionaryFromUrl', {
                    url,
                    profilesDictionarySettings: null,
                    onImportDone: () => { resolve(); },
                });
            }));
        }

        const infoAfter = await application.api.getDictionaryInfo();
        const titlesAfter = new Set(infoAfter.map((entry) => entry.title));
        if (Array.isArray(manifest) && manifest.length > 0 && manifest.every((entry) => titlesAfter.has(entry.title))) {
            await /** @type {Promise<void>} */ (new Promise((resolve) => {
                chrome.storage.local.set({[markerKey]: true}, () => { resolve(); });
            }));
        }
    } catch (e) {
        log.error(e);
    }
}
