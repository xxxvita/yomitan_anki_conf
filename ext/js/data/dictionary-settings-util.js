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
 * Pure helpers for the per-profile dictionary settings list (`options.dictionaries`), shared by
 * the settings pages and the backend. No DOM, no I/O.
 */

/**
 * @param {string} name
 * @param {boolean} enabled
 * @param {string|undefined} styles
 * @returns {import('settings').DictionaryOptions}
 */
export function createDefaultDictionarySettings(name, enabled, styles) {
    return {
        name,
        alias: name,
        enabled,
        allowSecondarySearches: false,
        definitionsCollapsible: 'not-collapsible',
        partsOfSpeechFilter: true,
        useDeinflections: true,
        styles: styles ?? '',
    };
}

/**
 * The upstream ensureDictionarySettings rule for one profile: drop entries whose dictionary is not
 * installed (and same-name duplicates, keeping the last), append a default for every installed
 * dictionary without an entry.
 * @param {import('settings').DictionaryOptions[]} dictionaries The profile's current list (not mutated).
 * @param {{title: string, styles?: string}[]} installed
 * @param {boolean} newDictionariesEnabled
 * @returns {?import('settings').DictionaryOptions[]} The new list, or `null` when nothing changes.
 */
export function ensureDictionaryEntries(dictionaries, installed, newDictionariesEnabled) {
    const missing = [...installed];
    const result = [...dictionaries];
    let modified = false;
    for (let j = result.length - 1; j >= 0; --j) {
        const {name} = result[j];
        const missingIndex = missing.findIndex(({title}) => title === name);
        if (missingIndex !== -1) {
            missing.splice(missingIndex, 1);
        } else {
            result.splice(j, 1);
            modified = true;
        }
    }
    for (const {title, styles} of missing) {
        result.push(createDefaultDictionarySettings(title, newDictionariesEnabled, styles));
        modified = true;
    }
    return modified ? result : null;
}

/**
 * Applies ensureDictionaryEntries to every profile of `optionsFull` in place. Synchronous, so the
 * backend can run it on its live options as one atomic step between other settings writes.
 * @param {import('settings').Options} optionsFull
 * @param {{title: string, styles?: string}[]} installed
 * @param {boolean} newDictionariesEnabled
 * @returns {boolean} Whether any profile changed.
 */
export function applyEnsuredDictionarySettings(optionsFull, installed, newDictionariesEnabled) {
    let changed = false;
    for (const {options} of optionsFull.profiles) {
        const next = ensureDictionaryEntries(options.dictionaries, installed, newDictionariesEnabled);
        if (next === null) { continue; }
        options.dictionaries = next;
        changed = true;
    }
    return changed;
}
