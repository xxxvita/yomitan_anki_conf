/*
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

import fs from 'fs';
import path from 'path';
import {fileURLToPath} from 'url';
import {describe, expect, test} from 'vitest';
import {isFlibClubHost, isFlibHost, parseRoutePuzzleId, pickSenderUrl} from '../ext/js/data/flib-host.js';

const extJsRoot = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'ext', 'js');

/**
 * @param {string} directory
 * @returns {string[]} абсолютные пути всех файлов поддерева
 */
function walkFiles(directory) {
    /** @type {string[]} */
    const found = [];
    for (const entry of fs.readdirSync(directory, {withFileTypes: true})) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) {
            found.push(...walkFiles(full));
        } else if (entry.isFile()) {
            found.push(full);
        }
    }
    return found;
}

/**
 * Убирает комментарии, оставляя код.
 *
 * ⚠️ Строчные комментарии режутся только там, где `//` НЕ идёт сразу за `:` —
 * иначе `'https://flib.club/x'` в настоящем коде выглядел бы как комментарий,
 * и грепный тест молча пропустил бы вторую реализацию.
 * @param {string} source
 * @returns {string}
 */
function stripComments(source) {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/(?<!:)\/\/.*$/gm, '');
}

describe('isFlibHost', () => {
    test.each([
        ['https://flib.club/book/1', true],
        ['http://flib.club/', true],
        ['https://www.flib.club/x', true],
        ['https://a.b.flib.club/x', true],
        ['https://FLIB.CLUB/x', true],
        ['https://flib.club./x', true],
        ['https://example.com/', false],
        ['https://notflib.club/', false],
        ['https://xflib.club/', false],
        ['https://flib.club.evil.com/', false],
        ['https://evil.com/?x=flib.club', false],
        ['about:blank', false],
        ['', false],
        ['не url', false],
    ])('%s -> %s', (url, expected) => {
        expect(isFlibHost(url)).toBe(expected);
    });
    test('не бросает на не-строке', () => {
    // @ts-expect-error - проверяем защиту от мусора на проводе
        expect(isFlibHost(null)).toBe(false);
    });
});

describe('pickSenderUrl', () => {
    test('берёт адрес вкладки, а не данные клиента', () => {
        expect(pickSenderUrl({tab: {url: 'https://flib.club/1'}})).toBe(
            'https://flib.club/1',
        );
    });
    test('нет вкладки — нет адреса', () => {
        expect(pickSenderUrl({})).toBe(null);
    });
    test('вкладка без url — нет адреса (Firefox без выданных host-permissions)', () => {
        expect(pickSenderUrl({tab: {}})).toBe(null);
    });
});

describe('A25 — реализация проверки хоста в репозитории ровно одна', () => {
    // ⚠️ Инвариант держится НЕ тем, что две копии совпадают, а тем, что копия
    // одна: две реализации, покрытые тестом, который гоняет обе в одном
    // движке, расхождения не ловят — этот класс дефекта в проекте уже
    // воспроизводился (ТЗ §5.3). Поэтому тест читает файлы С ДИСКА, а не
    // импортирует модули: инлайн `endsWith('.flib.club')` в соседнем файле
    // никаким импортом не виден.
    test('литерал хоста flib.club встречается в коде только в flib-host.js', () => {
        /** @type {string[]} */
        const offenders = [];
        for (const file of walkFiles(extJsRoot)) {
            // Файлы перевода описывают адрес словами и ничего по нему не решают.
            if (file.includes(`${path.sep}i18n${path.sep}messages-`)) { continue; }
            const code = stripComments(fs.readFileSync(file, {encoding: 'utf8'}));
            if (code.includes('flib.club')) {
                offenders.push(path.relative(extJsRoot, file).split(path.sep).join('/'));
            }
        }
        expect(offenders).toEqual(['data/flib-host.js']);
    });

    test('обход действительно читает дерево, а не пустой список', () => {
        // Страховка от «зелёного и мёртвого»: если бы walkFiles возвращал
        // пустоту, проверка выше проходила бы... нет — она требует РОВНО один
        // файл, поэтому пустой обход её уже валит. Здесь фиксируется, что
        // дерево читается целиком, а не одним каталогом.
        const files = walkFiles(extJsRoot);
        expect(files.length).toBeGreaterThan(50);
        expect(files.some((f) => f.endsWith(path.join('data', 'flib-host.js')))).toBe(true);
        expect(files.some((f) => f.endsWith(path.join('display', 'display-translation.js')))).toBe(true);
    });
});

describe('flibooster.ru host', () => {
    test.each([
        ['https://flibooster.ru/x', true],
        ['https://www.flibooster.ru/x', true],
        ['https://flibooster.ru./x', true],
        ['https://notflibooster.ru/', false],
        ['https://flibooster.ru.evil.com/', false],
    ])('isFlibHost(%s) = %s', (url, expected) => {
        expect(isFlibHost(url)).toBe(expected);
    });
});

describe('parseRoutePuzzleId', () => {
    test.each([
        ['https://flib.club/player?v=abc&rp=youtube%3A%3AdQw4w9WgXcQ', 'youtube::dQw4w9WgXcQ'],
        ['https://flibooster.ru/player?v=abc&rp=youtube%3A%3AdQw4w9WgXcQ', 'youtube::dQw4w9WgXcQ'],
        ['https://flib.club/player/?rp=x', 'x'],
        ['https://flib.club/player?v=abc', null],
        ['https://flib.club/player?rp=', null],
        ['https://flib.club/player?rp=%20', null],
        ['https://flib.club/watch?rp=x', null],
        ['https://example.com/player?rp=x', null],
        ['not a url', null],
    ])('%s -> %s', (url, expected) => {
        expect(parseRoutePuzzleId(url)).toBe(expected);
    });

    test('keeps rp untrimmed and accepts subdomain and trailing dot', () => {
        expect(parseRoutePuzzleId('https://flib.club/player?rp=%20x%20')).toBe(' x ');
        expect(parseRoutePuzzleId('https://www.flibooster.ru/player?rp=a')).toBe('a');
        expect(parseRoutePuzzleId('https://flib.club./player?rp=a')).toBe('a');
    });

    test('never throws on non-strings', () => {
        expect(parseRoutePuzzleId(/** @type {string} */ (/** @type {unknown} */ (null)))).toBeNull();
    });
});

describe('isFlibClubHost', () => {
    test.each([
        ['https://flib.club/', true],
        ['https://cache.flib.club', true],
        ['https://flib.club./', true],
        ['https://flibooster.ru/', false],
        ['https://cache.flibooster.ru', false],
        ['https://evilflib.club', false],
    ])('%s -> %s', (url, expected) => {
        expect(isFlibClubHost(url)).toBe(expected);
    });
});
