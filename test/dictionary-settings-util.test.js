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
import {applyEnsuredDictionarySettings, createDefaultDictionarySettings, ensureDictionaryEntries} from '../ext/js/data/dictionary-settings-util.js';

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
