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
import {messagesRu} from '../ext/js/i18n/messages-ru.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const BASELINE_PATH = path.join(ROOT, 'test/data/ui-language-baseline.json');
const SCANNED_OUTSIDE_EXT = ['dev/data/manifest-variants.json'];
const SKIPPED = /^ext\/(js\/i18n\/messages-|js\/language\/|lib\/|legal-npm\.html|manifest\.json|data\/(?!schemas\/options-schema\.json))/;
const RUSSIAN = /[Ѐ-ӿ]/;

/**
 * @param {string} directory
 * @returns {string[]}
 */
function listFiles(directory) {
    return fs.readdirSync(directory, {withFileTypes: true}).flatMap((entry) => {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) { return listFiles(full); }
        return /\.(js|html|css|json)$/.test(entry.name) ? [full] : [];
    });
}

/**
 * Русский текст разобранного кода: строки, части шаблонов, регулярные выражения, имена.
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
    if (element.type === 'Literal' && RUSSIAN.test(String(element.raw))) { output.push(String(element.raw)); }
    if ((element.type === 'Identifier' || element.type === 'PrivateIdentifier') && RUSSIAN.test(String(element.name))) { output.push(String(element.name)); }
    if (element.type === 'TemplateElement') {
        const {cooked, raw} = /** @type {{cooked: ?string, raw: string}} */ (element.value);
        const text = `${cooked ?? ''}${raw}`;
        if (RUSSIAN.test(text)) { output.push(cooked ?? raw); }
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
        const text = source.replace(/<!--[\s\S]*?-->/g, '').replace(/\/\*[\s\S]*?\*\//g, '').replace(/&#(\d+);/g, (_mark, code) => String.fromCodePoint(Number(code)));
        for (const line of text.split('\n')) {
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
    const files = [...listFiles(path.join(ROOT, 'ext')), ...SCANNED_OUTSIDE_EXT.map((name) => path.join(ROOT, name))];
    for (const file of files.sort()) {
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

/**
 * Вызовы translate и translatePlural в разобранном коде.
 * @param {unknown} node
 * @param {{name: string, argument: {[key: string]: unknown}}[]} output
 */
function collectTranslateCalls(node, output) {
    if (Array.isArray(node)) {
        for (const item of node) { collectTranslateCalls(item, output); }
        return;
    }
    if (typeof node !== 'object' || node === null) { return; }
    const element = /** @type {{[key: string]: unknown}} */ (node);
    if (element.type === 'CallExpression') {
        const {callee, arguments: args} = /** @type {{callee: {name?: string}, arguments: {[key: string]: unknown}[]}} */ (/** @type {unknown} */ (element));
        if (callee.name === 'translate' || callee.name === 'translatePlural') { output.push({name: callee.name, argument: args[0]}); }
    }
    for (const [key, value] of Object.entries(element)) {
        if (key !== 'loc' && key !== 'range') { collectTranslateCalls(value, output); }
    }
}

/**
 * Ключи выражения: строка или обе ветки условия. null, если ключ вычисляется.
 * @param {{[key: string]: unknown}} node
 * @returns {?string[]}
 */
function getStaticKeys(node) {
    if (node.type === 'Literal' && typeof node.value === 'string') { return [node.value]; }
    if (node.type === 'ConditionalExpression') {
        const yes = getStaticKeys(/** @type {{[key: string]: unknown}} */ (node.consequent));
        const no = getStaticKeys(/** @type {{[key: string]: unknown}} */ (node.alternate));
        return yes === null || no === null ? null : [...yes, ...no];
    }
    return null;
}

test('каждый ключ из кода и разметки есть в файлах перевода и подходит вызову', () => {
    /** @type {string[]} */
    const problems = [];
    const markup = /(?:data-i18n(?:-[a-z-]+)?|data-default-title)=["']([\w.]+)/g;
    const mapValues = /^\s+\w+: '((?:audio|gateway|media|video)\.[\w.]+)',$/gm;
    for (const file of listFiles(path.join(ROOT, 'ext'))) {
        const name = path.relative(ROOT, file).replaceAll(path.sep, '/');
        if (SKIPPED.test(name) || /\.(css|json)$/.test(name)) { continue; }
        const source = fs.readFileSync(file, 'utf8');
        if (name.endsWith('.html')) {
            for (const match of source.matchAll(markup)) {
                if (!Object.hasOwn(messagesRu, match[1])) { problems.push(`${name}: ${match[1]}`); }
            }
            continue;
        }
        if (name.startsWith('ext/js/display/')) {
            for (const match of source.matchAll(mapValues)) {
                if (!Object.hasOwn(messagesRu, match[1])) { problems.push(`${name}: ${match[1]}`); }
            }
        }
        /** @type {{name: string, argument: {[key: string]: unknown}}[]} */
        const calls = [];
        collectTranslateCalls(parse(source, {ecmaVersion: 'latest', sourceType: 'module'}), calls);
        for (const {name: callName, argument} of calls) {
            for (const key of getStaticKeys(argument) ?? []) {
                if (!Object.hasOwn(messagesRu, key)) {
                    problems.push(`${name}: ${key}`);
                } else if (callName === 'translate' && typeof messagesRu[key] !== 'string') {
                    problems.push(`${name}: ${key} требует translatePlural`);
                }
            }
            if (argument.type === 'TemplateLiteral') {
                const {quasis} = /** @type {{quasis: {value: {raw: string}}[]}} */ (/** @type {unknown} */ (argument));
                const prefix = quasis[0].value.raw;
                if (prefix.length === 0 || !Object.keys(messagesRu).some((key) => key.startsWith(prefix))) { problems.push(`${name}: ${prefix}…`); }
            }
        }
    }
    expect(problems).toStrictEqual([]);
});
