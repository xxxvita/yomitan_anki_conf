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

import {describe, expect, test, vi} from 'vitest';
import {fetchProvisionedDefaultOptions} from '../ext/js/data/provisioning-options.js';

/** @type {(path: string) => string} */
const getUrl = (path) => `chrome-extension://x/${path}`;

describe('fetchProvisionedDefaultOptions', () => {
    test('returns parsed options when the asset exists', async () => {
        const fetchImpl = vi.fn(async () => ({ok: true, text: async () => '{"version":75,"profiles":[]}'}));
        const result = await fetchProvisionedDefaultOptions(fetchImpl, getUrl);
        expect(result).toEqual({version: 75, profiles: []});
        expect(fetchImpl).toHaveBeenCalledWith('chrome-extension://x/data/provisioning/default-options.json');
    });
    test('returns null on non-ok response (asset absent)', async () => {
        const fetchImpl = vi.fn(async () => ({ok: false, text: async () => ''}));
        expect(await fetchProvisionedDefaultOptions(fetchImpl, getUrl)).toBeNull();
    });
    test('returns null when fetch throws', async () => {
        const fetchImpl = vi.fn(async () => { throw new Error('ERR_FILE_NOT_FOUND'); });
        expect(await fetchProvisionedDefaultOptions(fetchImpl, getUrl)).toBeNull();
    });
    test('returns null on malformed JSON', async () => {
        const fetchImpl = vi.fn(async () => ({ok: true, text: async () => 'not json'}));
        expect(await fetchProvisionedDefaultOptions(fetchImpl, getUrl)).toBeNull();
    });
    test('returns null when payload is not an object', async () => {
        const fetchImpl = vi.fn(async () => ({ok: true, text: async () => '42'}));
        expect(await fetchProvisionedDefaultOptions(fetchImpl, getUrl)).toBeNull();
    });
});
