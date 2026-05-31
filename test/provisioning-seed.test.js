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

import fs from 'fs';
import {fileURLToPath} from 'node:url';
import path from 'path';
import {describe, expect, test, vi} from 'vitest';
import {parseJson} from '../ext/js/core/json.js';
import {OptionsUtil} from '../ext/js/data/options-util.js';
import {chrome, fetch} from './mocks/common.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));

vi.stubGlobal('fetch', fetch);
vi.stubGlobal('chrome', chrome);

/**
 * The bundled provisioning seed is hand-derived from an export and pinned to a schema
 * version. These tests guard against drift: the seed must still validate against the
 * current schema, must land on the current build version after `update()`, and must hold
 * the invariants the deployment relies on (every profile has a stable id; dictionaries are
 * stripped so the welcome-page import is the sole registrar). If a future schema version
 * bump breaks these, the seed must be regenerated.
 */
describe('provisioning seed default-options.json', () => {
    test('validates through update() and holds deploy invariants', async () => {
        const seedPath = path.join(dirname, '..', 'ext', 'data', 'provisioning', 'default-options.json');
        const seed = parseJson(fs.readFileSync(seedPath, 'utf8'));

        const optionsUtil = new OptionsUtil();
        await optionsUtil.prepare();

        const updated = /** @type {import('settings').Options} */ (await optionsUtil.update(structuredClone(seed)));
        expect(() => optionsUtil.validate(updated)).not.toThrow();

        // Seed is pinned to the current build's schema version (no silent downgrade/upgrade mangling).
        expect(updated.version).toBe(optionsUtil.getDefault().version);

        expect(Array.isArray(updated.profiles)).toBe(true);
        expect(updated.profiles.length).toBeGreaterThan(0);
        for (const profile of updated.profiles) {
            // I1: a stable non-empty profile id (not backfilled at v75, so it must be in the seed).
            expect(typeof profile.id).toBe('string');
            expect(profile.id.length).toBeGreaterThan(0);
            // Dictionaries are owned by the welcome-page import (Unit B); the seed must not pre-register any.
            expect(profile.options.dictionaries).toEqual([]);
        }
    });
});
