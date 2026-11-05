/*
 * Copyright (C) 2026  Flib-club Authors (fork of Yomitan)
 * Copyright (C) 2023-2025  Yomitan Authors
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

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect, test} from 'vitest';
import {parseJson} from '../dev/json.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'test/data/ui-language-baseline.json');
const SKIPPED = /^ext\/js\/(i18n|language)\//;

/**
 * @param {string} directory
 * @returns {string[]}
 */
function listScripts(directory) {
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) { return listScripts(full); }
        return entry.name.endsWith('.js') ? [full] : [];
    });
}

/**
 * Русские строки в коде. Комментарии и журнал не считаются.
 * @param {string} source
 * @returns {number}
 */
function countRussianLiterals(source) {
    const code = source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '')
        .replace(/\s\/\/ .*$/gm, '');
    let count = 0;
    for (const match of code.matchAll(/(['"`])((?:\\.|(?!\1).)*?[Ѐ-ӿ](?:\\.|(?!\1).)*?)\1/g)) {
        if (!/(log\.|console\.)\w*\(?$/.test(code.slice(Math.max(0, match.index - 30), match.index))) { ++count; }
    }
    return count;
}

/**
 * Храповик: новые русские строки в коде запрещены, а убранная строка должна уйти
 * и из списка, чтобы не вернуться. Обновить список: UPDATE_UI_BASELINE=1.
 */
test('русские строки только в файлах перевода', () => {
    /** @type {{[file: string]: number}} */
    const actual = {};
    for (const file of listScripts(path.join(ROOT, 'ext/js')).sort()) {
        const name = path.relative(ROOT, file).replaceAll(path.sep, '/');
        if (SKIPPED.test(name)) { continue; }
        const count = countRussianLiterals(fs.readFileSync(file, 'utf8'));
        if (count > 0) { actual[name] = count; }
    }
    if (process.env.UPDATE_UI_BASELINE === '1') {
        fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 4)}\n`);
    }
    expect(actual).toStrictEqual(parseJson(fs.readFileSync(BASELINE_PATH, 'utf8')));
});
