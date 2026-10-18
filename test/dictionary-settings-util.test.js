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

import {describe, expect, test} from 'vitest';
import {applyDictionarySettingsReconcile, applyEnsuredDictionarySettings, createDefaultDictionarySettings, ensureDictionaryEntries, reconcileDictionaryEntries} from '../ext/js/data/dictionary-settings-util.js';

/**
 * @param {string} name
 * @param {Partial<import('settings').DictionaryOptions>} [extra]
 * @returns {import('settings').DictionaryOptions}
 */
const entry = (name, extra = {}) => ({...createDefaultDictionarySettings(name, true, ''), ...extra});

/**
 * @param {string} title
 * @param {string} [styles]
 * @returns {{title: string, styles: string}}
 */
const installed = (title, styles = '') => ({title, styles});

describe('createDefaultDictionarySettings', () => {
    test('matches the upstream default', () => {
        expect(createDefaultDictionarySettings('A', false, void 0)).toEqual({
            name: 'A',
            alias: 'A',
            enabled: false,
            allowSecondarySearches: false,
            definitionsCollapsible: 'not-collapsible',
            partsOfSpeechFilter: true,
            useDeinflections: true,
            styles: '',
        });
    });
});

describe('ensureDictionaryEntries', () => {
    test('consistent list → null (nothing to write)', () => {
        expect(ensureDictionaryEntries([entry('A'), entry('B')], [installed('A'), installed('B')], false)).toBe(null);
    });
    test('an entry for an uninstalled dictionary is removed', () => {
        expect(ensureDictionaryEntries([entry('A', {alias: 'p3'}), entry('Gone'), entry('B')], [installed('A'), installed('B')], false))
            .toEqual([entry('A', {alias: 'p3'}), entry('B')]);
    });
    test('an installed dictionary without an entry gets a default (enabled flag and styles)', () => {
        expect(ensureDictionaryEntries([entry('A')], [installed('A'), installed('New', 'S')], false))
            .toEqual([entry('A'), createDefaultDictionarySettings('New', false, 'S')]);
    });
    test('duplicate entries collapse to one (the last, as upstream iterates from the end)', () => {
        expect(ensureDictionaryEntries([entry('A', {alias: 'p1'}), entry('A', {alias: 'p2'})], [installed('A')], true))
            .toEqual([entry('A', {alias: 'p2'})]);
    });
    test('the input array is not mutated', () => {
        const list = [entry('Gone')];
        ensureDictionaryEntries(list, [], false);
        expect(list).toEqual([entry('Gone')]);
    });
});

describe('applyEnsuredDictionarySettings', () => {
    test('mutates only inconsistent profiles and reports whether anything changed', () => {
        const options = {profiles: [
            {options: {dictionaries: [entry('A')]}},
            {options: {dictionaries: [entry('Gone'), entry('A', {enabled: false})]}},
        ]};
        const first = options.profiles[0].options.dictionaries;
        expect(applyEnsuredDictionarySettings(/** @type {import('settings').Options} */ (/** @type {unknown} */ (options)), [installed('A')], false)).toBe(true);
        expect(options.profiles[0].options.dictionaries).toBe(first);
        expect(options.profiles[1].options.dictionaries).toEqual([entry('A', {enabled: false})]);
        expect(applyEnsuredDictionarySettings(/** @type {import('settings').Options} */ (/** @type {unknown} */ (options)), [installed('A')], false)).toBe(false);
    });
});

describe('applyEnsuredDictionarySettings without removal (settings unstable while the DB was read)', () => {
    test('adds the missing defaults but keeps entries the stale list does not know', () => {
        const options = {profiles: [{options: {dictionaries: [entry('JustImported')]}}]};
        expect(applyEnsuredDictionarySettings(/** @type {import('settings').Options} */ (/** @type {unknown} */ (options)), [installed('A')], false, {removeAbsent: false})).toBe(true);
        expect(options.profiles[0].options.dictionaries).toEqual([entry('JustImported'), createDefaultDictionarySettings('A', false, '')]);
    });
});

describe('reconcileDictionaryEntries', () => {
    const OTHER = entry('B');
    const USER = entry('T', {alias: 'MyT'});
    const DEFAULT = createDefaultDictionarySettings('T', false, '');
    test('preferred entry replaces every same-name entry at its index', () => {
        expect(reconcileDictionaryEntries([entry('J'), DEFAULT, OTHER, DEFAULT], 'T', {entry: USER, index: 1}, DEFAULT)).toEqual([entry('J'), USER, OTHER]);
    });
    test('the index is clamped to the end', () => {
        expect(reconcileDictionaryEntries([entry('J')], 'T', {entry: USER, index: 9}, DEFAULT)).toEqual([entry('J'), USER]);
    });
    test('without a preferred entry the first existing one is kept in place', () => {
        expect(reconcileDictionaryEntries([entry('J'), USER, OTHER, DEFAULT], 'T', null, DEFAULT)).toEqual([entry('J'), USER, OTHER]);
    });
    test('without any entry the fallback is appended', () => {
        expect(reconcileDictionaryEntries([entry('J')], 'T', null, DEFAULT)).toEqual([entry('J'), DEFAULT]);
    });
});

describe('applyDictionarySettingsReconcile (backend, on the live options)', () => {
    /**
     * @param {Record<string, import('settings').DictionaryOptions[]>} lists
     * @param {string} [mainDictionary]
     * @returns {import('settings').Options}
     */
    const optionsOf = (lists, mainDictionary = '') => /** @type {import('settings').Options} */ (/** @type {unknown} */ ({
        profiles: Object.entries(lists).map(([id, dictionaries]) => ({id, options: {dictionaries, general: {mainDictionary}}})),
    }));

    test('a new dictionary: our default replaces a same-name default in place, enabled only in the given profiles', () => {
        const options = optionsOf({p1: [entry('J'), createDefaultDictionarySettings('T', false, '')], p2: [entry('J')]});
        const changed = applyDictionarySettingsReconcile(options, {title: 'T', styles: 'S', preferred: null, enabledProfileIds: ['p1'], setMainDictionaryIfEmpty: false});
        expect(changed).toBe(true);
        expect(options.profiles[0].options.dictionaries).toEqual([entry('J'), createDefaultDictionarySettings('T', true, 'S')]);
        expect(options.profiles[1].options.dictionaries).toEqual([entry('J'), createDefaultDictionarySettings('T', false, 'S')]);
    });

    test('a concurrent edit of another entry in the live options survives (no whole-array write from a stale read)', () => {
        const options = optionsOf({p1: [entry('J', {enabled: false, alias: 'edited elsewhere'}), entry('Parallel')]});
        applyDictionarySettingsReconcile(options, {title: 'T', styles: '', preferred: null, enabledProfileIds: ['p1'], setMainDictionaryIfEmpty: false});
        expect(options.profiles[0].options.dictionaries).toEqual([entry('J', {enabled: false, alias: 'edited elsewhere'}), entry('Parallel'), createDefaultDictionarySettings('T', true, '')]);
    });

    test('a replace: the snapshot entry goes to its index; a profile without one keeps its entry or gets a disabled default', () => {
        const USER = entry('T', {alias: 'MyT', enabled: true});
        const options = optionsOf({
            p1: [entry('J'), createDefaultDictionarySettings('T', false, ''), entry('T', {alias: 'dup'})],
            p2: [entry('T', {alias: 'kept'})],
            p3: [entry('J')],
        });
        applyDictionarySettingsReconcile(options, {title: 'T', styles: 'S', preferred: {p1: {entry: USER, index: 1}}, enabledProfileIds: ['p1'], setMainDictionaryIfEmpty: false});
        expect(options.profiles[0].options.dictionaries).toEqual([entry('J'), USER]);
        expect(options.profiles[1].options.dictionaries).toEqual([entry('T', {alias: 'kept'})]);
        expect(options.profiles[2].options.dictionaries).toEqual([entry('J'), createDefaultDictionarySettings('T', false, 'S')]);
    });

    test('mainDictionary is set only where it is empty', () => {
        const options = optionsOf({p1: [], p2: []});
        options.profiles[1].options.general.mainDictionary = 'Other';
        applyDictionarySettingsReconcile(options, {title: 'T', styles: '', preferred: null, enabledProfileIds: [], setMainDictionaryIfEmpty: true});
        expect(options.profiles.map(({options: o}) => o.general.mainDictionary)).toEqual(['T', 'Other']);
    });

    test('applying the same request again changes nothing', () => {
        const options = optionsOf({p1: [entry('J')]});
        const request = {title: 'T', styles: '', preferred: null, enabledProfileIds: ['p1'], setMainDictionaryIfEmpty: true};
        expect(applyDictionarySettingsReconcile(options, request)).toBe(true);
        expect(applyDictionarySettingsReconcile(options, request)).toBe(false);
    });
});
