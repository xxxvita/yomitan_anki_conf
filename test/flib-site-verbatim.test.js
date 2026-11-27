/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2020-2022  Yomichan Authors
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

import {createHash} from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {parseJson} from '../dev/json.js';
import {verifyVendor} from '../dev/flib-site-verify.js';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');

/**
 * @param {Buffer|string} data
 * @returns {string}
 */
function sha(data) {
    return createHash('sha256').update(data).digest('hex');
}

describe('verifyVendor', () => {
    /** @type {string} */
    let dir = '';
    beforeEach(() => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flib-verify-'));
    });
    afterEach(() => {
        fs.rmSync(dir, {recursive: true, force: true});
    });

    /**
     * @param {string} rel
     * @param {string} content
     */
    const put = (rel, content) => {
        const full = path.join(dir, rel);
        fs.mkdirSync(path.dirname(full), {recursive: true});
        fs.writeFileSync(full, content);
    };
    /** @returns {import('../dev/flib-site-verify.js').SourceManifest} */
    const manifest = () => ({
        repo: 'x',
        commit: 'c',
        date: 'd',
        files: [
            {path: 'web/a.ts', sha256: sha('a')},
            {path: 'web/b/c.css', sha256: sha('c')},
        ],
    });
    const setup = () => {
        put('web/a.ts', 'a');
        put('web/b/c.css', 'c');
    };

    test('everything matches', () => {
        setup();
        expect(verifyVendor(dir, manifest())).toStrictEqual({missing: [], changed: [], extra: []});
    });
    test('changed byte is reported', () => {
        setup();
        put('web/a.ts', 'b');
        expect(verifyVendor(dir, manifest())).toStrictEqual({missing: [], changed: ['web/a.ts'], extra: []});
    });
    test('deleted file is missing', () => {
        setup();
        fs.rmSync(path.join(dir, 'web/b/c.css'));
        expect(verifyVendor(dir, manifest())).toStrictEqual({missing: ['web/b/c.css'], changed: [], extra: []});
    });
    test('extra file is reported, README.md/SOURCE.json/TEST-BASELINE.json are not', () => {
        setup();
        put('README.md', 'r');
        put('SOURCE.json', '{}');
        put('TEST-BASELINE.json', '{}');
        put('web/z.ts', 'z');
        expect(verifyVendor(dir, manifest())).toStrictEqual({missing: [], changed: [], extra: ['web/z.ts']});
    });
    test('placeholder is compared by its own sha256', () => {
        put('web/a.ts', 'a');
        put('web/b/c.css', 'c');
        put('web/p.png', 'placeholder-bytes');
        const m = manifest();
        m.files.push({path: 'web/p.png', sha256: sha('placeholder-bytes'), replaced: 'placeholder', originalSha256: sha('orig')});
        expect(verifyVendor(dir, m)).toStrictEqual({missing: [], changed: [], extra: []});
        put('web/p.png', 'orig');
        expect(verifyVendor(dir, m).changed).toStrictEqual(['web/p.png']);
    });
});

describe('real vendor copy', () => {
    test('vendor/flib-site matches SOURCE.json', () => {
        const vendor = path.join(root, 'vendor', 'flib-site');
        const source = /** @type {import('../dev/flib-site-verify.js').SourceManifest} */ (parseJson(fs.readFileSync(path.join(vendor, 'SOURCE.json'), 'utf8')));
        expect(verifyVendor(vendor, source)).toStrictEqual({missing: [], changed: [], extra: []});
    });
});
