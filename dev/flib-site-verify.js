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
import path from 'node:path';

/**
 * @typedef {{path: string, sha256: string, replaced?: 'placeholder', originalSha256?: string}} SourceFile
 * @typedef {{repo: string, commit: string, date: string, files: SourceFile[]}} SourceManifest
 */

/** Files in the vendor directory that are not part of the copied site. */
export const nonSourceFiles = new Set(['README.md', 'SOURCE.json', 'TEST-BASELINE.json']);

/**
 * @param {string} dir
 * @param {string} base
 * @returns {string[]}
 */
function listFiles(dir, base = '') {
    /** @type {string[]} */
    const result = [];
    if (!fs.existsSync(dir)) { return result; }
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const rel = base === '' ? entry.name : `${base}/${entry.name}`;
        if (entry.isDirectory()) {
            result.push(...listFiles(path.join(dir, entry.name), rel));
        } else {
            result.push(rel);
        }
    }
    return result;
}

/**
 * @param {string} vendorDir
 * @param {SourceManifest} source
 * @returns {{missing: string[], changed: string[], extra: string[]}}
 */
export function verifyVendor(vendorDir, source) {
    /** @type {string[]} */
    const missing = [];
    /** @type {string[]} */
    const changed = [];
    const known = new Set();
    for (const file of source.files) {
        known.add(file.path);
        const full = path.join(vendorDir, file.path);
        if (!fs.existsSync(full)) {
            missing.push(file.path);
            continue;
        }
        const hash = createHash('sha256').update(fs.readFileSync(full)).digest('hex');
        if (hash !== file.sha256) { changed.push(file.path); }
    }
    const extra = listFiles(vendorDir).filter((f) => !known.has(f) && !nonSourceFiles.has(f));
    return {missing: missing.sort(), changed: changed.sort(), extra: extra.sort()};
}
