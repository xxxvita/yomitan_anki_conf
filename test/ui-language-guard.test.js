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

import {parse} from 'acorn';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {expect, test} from 'vitest';
import {parseJson} from '../dev/json.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'test/data/ui-language-baseline.json');
const SKIPPED = /^ext\/(js\/(i18n|language)\/|lib\/|data\/|legal)/;
const RUSSIAN = /[Ѐ-ӿ]/;

/**
 * @param {string} directory
 * @returns {string[]}
 */
function listFiles(directory) {
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) { return listFiles(full); }
        return /\.(js|html)$/.test(entry.name) ? [full] : [];
    });
}

/**
 * @param {unknown} callee
 * @returns {boolean} Вызов журнала: log.error(...), console.warn(...).
 */
function isLogCall(callee) {
    const node = /** @type {{type?: string, object?: {type?: string, name?: string}}} */ (callee);
    return node.type === 'MemberExpression' && node.object?.type === 'Identifier' && (node.object.name === 'log' || node.object.name === 'console');
}

/**
 * Русские строки разобранного кода, включая части шаблонов. Журнал не считается.
 * @param {unknown} node
 * @param {string[]} output
 */
function collectLiterals(node, output) {
    if (Array.isArray(node)) {
        for (const item of node) { collectLiterals(item, output); }
        return;
    }
    if (typeof node !== 'object' || node === null) { return; }
    const element = /** @type {{[key: string]: unknown}} */ (node);
    if (element.type === 'CallExpression' && isLogCall(element.callee)) { return; }
    if (element.type === 'Literal' && typeof element.value === 'string' && RUSSIAN.test(element.value)) { output.push(element.value); }
    if (element.type === 'TemplateElement') {
        const {cooked} = /** @type {{cooked: string}} */ (element.value);
        if (RUSSIAN.test(cooked)) { output.push(cooked); }
    }
    for (const [key, value] of Object.entries(element)) {
        if (key !== 'loc' && key !== 'range') { collectLiterals(value, output); }
    }
}

/**
 * @param {string} name
 * @param {string} source
 * @returns {string[]}
 */
function listRussianStrings(name, source) {
    /** @type {string[]} */
    const output = [];
    if (name.endsWith('.js')) {
        collectLiterals(parse(source, {ecmaVersion: 'latest', sourceType: 'module'}), output);
    } else {
        for (const line of source.replace(/<!--[\s\S]*?-->/g, '').split('\n')) {
            if (RUSSIAN.test(line)) { output.push(line.trim()); }
        }
    }
    return output.sort();
}

/**
 * Храповик: список сверяется целиком, поэтому новая строка не пройдёт, даже если
 * другая ушла, а перенесённая в файлы перевода должна уйти и из списка.
 * Обновить список: UPDATE_UI_BASELINE=1.
 */
test('русский текст только в файлах перевода', () => {
    /** @type {{[file: string]: string[]}} */
    const actual = {};
    for (const file of listFiles(path.join(ROOT, 'ext')).sort()) {
        const name = path.relative(ROOT, file).replaceAll(path.sep, '/');
        if (SKIPPED.test(name)) { continue; }
        const strings = listRussianStrings(name, fs.readFileSync(file, 'utf8'));
        if (strings.length > 0) { actual[name] = strings; }
    }
    if (process.env.UPDATE_UI_BASELINE === '1') {
        fs.writeFileSync(BASELINE_PATH, `${JSON.stringify(actual, null, 4)}\n`);
    }
    expect(actual).toStrictEqual(parseJson(fs.readFileSync(BASELINE_PATH, 'utf8')));
});
