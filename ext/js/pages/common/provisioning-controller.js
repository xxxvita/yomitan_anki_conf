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
