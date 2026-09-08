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

import {mkdtempSync, rmSync, writeFileSync} from 'node:fs';
import os from 'node:os';
import {fileURLToPath} from 'node:url';
import path from 'path';
import {describe, it, vi} from 'vitest';
import {createDictionaryArchiveData} from '../dev/dictionary-archive-util.js';
import * as dictionaryValidate from '../dev/dictionary-validate.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * @param {string} dictionary
 * @param {string} [dictionaryName]
 * @returns {Promise<ArrayBuffer>}
 */
async function createTestDictionaryArchiveData(dictionary, dictionaryName) {
    const dictionaryDirectory = path.join(dirname, 'data', 'dictionaries', dictionary);
    return await createDictionaryArchiveData(dictionaryDirectory, dictionaryName);
}

describe('Dictionary validation', () => {
    const testCases = [
        {name: 'valid-dictionary1', valid: true},
        {name: 'invalid-dictionary1', valid: false},
        {name: 'invalid-dictionary2', valid: false},
        {name: 'invalid-dictionary3', valid: false},
        {name: 'invalid-dictionary4', valid: false},
        {name: 'invalid-dictionary5', valid: false},
        {name: 'invalid-dictionary6', valid: false},
    ];
    const schemas = dictionaryValidate.getSchemas();
    describe.each(testCases)('Test dictionary $name', ({name, valid}) => {
        it(`should be ${valid ? 'valid' : 'invalid'}`, async ({expect}) => {
            const archive = await createTestDictionaryArchiveData(name);
            const promise = dictionaryValidate.validateDictionary(null, archive, schemas);
            await (
                valid ?
                expect(promise).resolves.not.toThrow() :
                expect(promise).rejects.toThrow()
            );
        });
    });
});

describe('testDictionaryFiles failure reporting', () => {
    it('validates every file and reports a failure count that a CLI can use as an exit code, without stopping at the first bad file', async ({expect}) => {
        const tmpDir = mkdtempSync(path.join(os.tmpdir(), 'yomitan-dictionary-validate-'));
        try {
            // A mix of good and bad dictionaries, with a bad one first, to prove that a
            // failure does not stop validation of the remaining files.
            const dictionaryNames = ['invalid-dictionary1', 'valid-dictionary1', 'invalid-dictionary2'];
            const filePaths = [];
            for (const name of dictionaryNames) {
                const archive = await createTestDictionaryArchiveData(name, name);
                const filePath = path.join(tmpDir, `${name}.zip`);
                writeFileSync(filePath, Buffer.from(archive));
                filePaths.push(filePath);
            }

            const logSpy = vi.spyOn(console, 'log').mockImplementation(() => {});
            const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
            try {
                const failureCount = await dictionaryValidate.testDictionaryFiles(null, filePaths);

                // Both invalid dictionaries must be counted as failures. If the failure is
                // swallowed (the historical bug), this is `undefined`, not `2`.
                expect(failureCount).toBe(2);

                // All three files must have been attempted, proving the loop did not abort
                // after the first (invalid) file.
                const validatingCalls = logSpy.mock.calls.filter(
                    (args) => typeof args[0] === 'string' && args[0].startsWith('Validating '),
                );
                expect(validatingCalls).toHaveLength(3);
            } finally {
                logSpy.mockRestore();
                warnSpy.mockRestore();
            }
        } finally {
            rmSync(tmpDir, {recursive: true, force: true});
        }
    });
});
