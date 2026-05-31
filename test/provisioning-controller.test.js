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
import {computeDictionariesToImport} from '../ext/js/pages/common/provisioning-controller.js';

const manifest = [{file: 'a.zip', title: 'A'}, {file: 'b.zip', title: 'B'}];

describe('computeDictionariesToImport', () => {
    test('returns nothing when already provisioned', () => {
        expect(computeDictionariesToImport(manifest, new Set(), true)).toEqual([]);
    });
    test('returns all entries when none imported', () => {
        expect(computeDictionariesToImport(manifest, new Set(), false)).toEqual(manifest);
    });
    test('drops entries whose title is already imported', () => {
        expect(computeDictionariesToImport(manifest, new Set(['A']), false)).toEqual([{file: 'b.zip', title: 'B'}]);
    });
    test('returns empty when all titles already imported', () => {
        expect(computeDictionariesToImport(manifest, new Set(['A', 'B']), false)).toEqual([]);
    });
    test('tolerates a non-array manifest', () => {
        expect(computeDictionariesToImport(null, new Set(), false)).toEqual([]);
    });
});
