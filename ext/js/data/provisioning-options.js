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

import {parseJson} from '../core/json.js';

/**
 * Path (relative to the extension root) of the bundled seed options.
 */
const PROVISIONED_OPTIONS_PATH = 'data/provisioning/default-options.json';

/**
 * Fetch the bundled provisioning options, if the build includes them. Returns the raw
 * parsed object (NOT migrated/validated — the caller runs it through OptionsUtil.update),
 * or null when the asset is absent or unreadable. Never throws.
 * @param {(input: string) => Promise<{ok: boolean, text: () => Promise<string>}>} fetchImpl
 * @param {(path: string) => string} getUrl
 * @returns {Promise<?import('settings').Options>}
 */
export async function fetchProvisionedDefaultOptions(fetchImpl, getUrl) {
    try {
        const response = await fetchImpl(getUrl(PROVISIONED_OPTIONS_PATH));
        if (!response.ok) { return null; }
        const text = await response.text();
        const parsed = parseJson(text);
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) { return null; }
        return /** @type {import('settings').Options} */ (parsed);
    } catch (e) {
        return null;
    }
}
