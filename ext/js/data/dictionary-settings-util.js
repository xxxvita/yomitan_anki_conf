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
 * @param {{removeAbsent?: boolean}} [details] `removeAbsent: false` keeps entries whose dictionary is
 *   not in `installed` (used when `installed` may be stale); duplicates are still collapsed.
 * @returns {?import('settings').DictionaryOptions[]} The new list, or `null` when nothing changes.
 */
export function ensureDictionaryEntries(dictionaries, installed, newDictionariesEnabled, {removeAbsent = true} = {}) {
    const missing = [...installed];
    const result = [...dictionaries];
    let modified = false;
    for (let j = result.length - 1; j >= 0; --j) {
        const {name} = result[j];
        const missingIndex = missing.findIndex(({title}) => title === name);
        if (missingIndex !== -1) {
            missing.splice(missingIndex, 1);
        } else if (removeAbsent || installed.some(({title}) => title === name)) {
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
 * @param {{removeAbsent?: boolean}} [details] See ensureDictionaryEntries.
 * @returns {boolean} Whether any profile changed.
 */
export function applyEnsuredDictionarySettings(optionsFull, installed, newDictionariesEnabled, details = {}) {
    let changed = false;
    for (const {options} of optionsFull.profiles) {
        const next = ensureDictionaryEntries(options.dictionaries, installed, newDictionariesEnabled, details);
        if (next === null) { continue; }
        options.dictionaries = next;
        changed = true;
    }
    return changed;
}

/**
 * The profile's dictionary settings with exactly one entry named `title`: `preferred` (at its
 * index, clamped) if given, else the first existing entry in place, else `fallback` appended.
 * Every other same-name entry is dropped.
 * @template {{name: string}} T
 * @param {T[]} dictionaries
 * @param {string} title
 * @param {?{entry: T, index: number}} preferred
 * @param {T} fallback
 * @returns {T[]}
 */
export function reconcileDictionaryEntries(dictionaries, title, preferred, fallback) {
    const existingIndex = dictionaries.findIndex(({name}) => name === title);
    const rest = dictionaries.filter(({name}) => name !== title);
    /** @type {T} */
    let entry;
    let position;
    if (preferred !== null) {
        entry = preferred.entry;
        position = preferred.index;
    } else if (existingIndex >= 0) {
        // The first same-name entry has no same-name entries before it, so its index is valid in `rest`.
        entry = dictionaries[existingIndex];
        position = existingIndex;
    } else {
        entry = fallback;
        position = rest.length;
    }
    position = Math.max(0, Math.min(position, rest.length));
    return [...rest.slice(0, position), entry, ...rest.slice(position)];
}

/**
 * The settings side of a dictionary import, applied by the backend on its live options in one
 * synchronous step (no page-side read-modify-write that could lose another page's concurrent
 * edit). Per profile, by id:
 * - `preferred === null` (a new dictionary): the profile's default — enabled iff its id is in
 *   `enabledProfileIds` — replaces any same-name entry in place, else is appended;
 * - otherwise (an update/replace): `preferred[id]` goes to its index; a profile without one keeps
 *   its existing entry, else gets the default.
 * Exactly one entry per title remains; nothing else in the list is touched. `mainDictionary` is set
 * to `title` where it is empty when `setMainDictionaryIfEmpty`.
 * @param {import('settings').Options} optionsFull Mutated in place.
 * @param {import('dictionary-settings-util').DictionarySettingsReconcile} request
 * @returns {boolean} Whether anything changed.
 */
export function applyDictionarySettingsReconcile(optionsFull, {title, styles, preferred, enabledProfileIds, setMainDictionaryIfEmpty}) {
    let changed = false;
    for (const {id, options} of optionsFull.profiles) {
        const fallback = createDefaultDictionarySettings(title, enabledProfileIds.includes(id), styles);
        /** @type {?{entry: import('settings').DictionaryOptions, index: number}} */
        let wanted;
        if (preferred === null) {
            const existingIndex = options.dictionaries.findIndex(({name}) => name === title);
            wanted = {entry: fallback, index: existingIndex >= 0 ? existingIndex : options.dictionaries.length};
        } else {
            wanted = preferred[id] ?? null;
        }
        const next = reconcileDictionaryEntries(options.dictionaries, title, wanted, fallback);
        if (JSON.stringify(next) !== JSON.stringify(options.dictionaries)) {
            options.dictionaries = next;
            changed = true;
        }
        if (setMainDictionaryIfEmpty && options.general.mainDictionary === '') {
            options.general.mainDictionary = title;
            changed = true;
        }
    }
    return changed;
}
