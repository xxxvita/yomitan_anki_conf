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

// Русская сторона из dict_base.db (режим по умолчанию, --ru-source dict):
// строки flibooster-en-ru берутся как есть, журнал не открывается.

import JSZip from 'jszip';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {buildDictionaryPair, checkRussianRowCount} from '../../dev/dictionary-pair/pair-builder.js';
import {verifyPairZips} from '../../dev/dictionary-pair/pair-verify.js';
import {RU_SOURCES, openDatabaseBackupSnapshot, parseRuSource} from '../../dev/dictionary-pair/sources.js';
import {parseJson} from '../../dev/json.js';
import {addTerm, createDictDb, wtyArticle} from './fixture-db.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(dirname, '..', '..', 'dev', 'bin', 'build-dictionaries.js');
const SNAPSHOT_PREFIX = 'flib-dict-snapshot-';

/** @type {string} */
let workDir;

beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flib-dict-ru-source-'));
});

afterEach(() => {
    fs.rmSync(workDir, {recursive: true, force: true});
});

/**
 * dict_base.db с готовой русской выкладкой: пара на wty-en-en, пара на
 * сочинённую статью flibooster-en и сирота — штамп, которому хозяина нет.
 * Журнала нет вовсе.
 * @returns {{dictPath: string, journalPath: string}}
 */
function createDictWithRussian() {
    const dictPath = path.join(workDir, 'dict_base.db');
    const dict = createDictDb(dictPath);
    const dream = addTerm(dict, {dictionary: 'wty-en-en', expression: 'dream', glossary: wtyArticle({senses: ['To sleep.']}), definitionTags: 'v', rules: 'v'});
    addTerm(dict, {dictionary: 'wty-en-en', expression: 'dreamt', glossary: [['dream', ['past']]], definitionTags: 'v', rules: 'v'});
    const happen = addTerm(dict, {dictionary: 'flibooster-en', expression: 'happen to', glossary: wtyArticle({senses: ['To occur by chance.']}), definitionTags: 'phrase', rules: 'phrase'});
    // Порядок вставки нарочно не совпадает с порядком выхода (выражение побайтно, затем штамп).
    addTerm(dict, {dictionary: 'flibooster-en-ru', expression: 'happen to', glossary: wtyArticle({senses: ['Случиться.']}), definitionTags: 'phrase', rules: 'phrase', sequence: happen});
    addTerm(dict, {dictionary: 'flibooster-en-ru', expression: 'add in', glossary: wtyArticle({senses: ['Добавить.']}), definitionTags: 'phrase', rules: 'phrase', sequence: 999, termTags: 'orphan-tag'});
    addTerm(dict, {dictionary: 'flibooster-en-ru', expression: 'dream', glossary: wtyArticle({senses: ['Спать.']}), definitionTags: 'v', rules: 'v', sequence: dream, score: 7});
    dict.close();
    return {dictPath, journalPath: path.join(workDir, 'нет-журнала', 'enrich.db')};
}

/**
 * @param {string} zipPath
 * @returns {Promise<unknown[][]>}
 */
async function readRows(zipPath) {
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
    /** @type {unknown[][]} */
    const rows = [];
    for (const name of Object.keys(zip.files).filter((n) => n.startsWith('term_bank_'))) {
        const file = zip.file(name);
        if (file === null) { throw new Error(name); }
        rows.push(.../** @type {unknown[][]} */ (parseJson(await file.async('string'))));
    }
    return rows;
}

/**
 * @param {{dictPath: string, journalPath: string}} sources
 * @param {string} [outName]
 * @returns {Promise<import('../../dev/dictionary-pair/pair-builder.js').BuildResult>}
 */
async function buildDict(sources, outName = 'out') {
    return await buildDictionaryPair({...sources, ruSource: 'dict', outRoot: path.join(workDir, outName)});
}

/**
 * @returns {Set<string>}
 */
function listSnapshots() {
    return new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(SNAPSHOT_PREFIX)));
}

describe('--ru-source dict — русские строки из dict_base.db', () => {
    test('выкладываются все строки flibooster-en-ru как есть, включая сироту; журнал не нужен', async () => {
        const sources = createDictWithRussian();
        const result = await buildDict(sources);
        const rows = await readRows(path.join(result.directory, 'flibooster-en-ru.zip'));
        expect(rows).toStrictEqual([
            ['add in', '', 'phrase', 'phrase', 0, wtyArticle({senses: ['Добавить.']}), 999, 'orphan-tag'],
            ['dream', '', 'v', 'v', 7, wtyArticle({senses: ['Спать.']}), 1, ''],
            ['happen to', '', 'phrase', 'phrase', 0, wtyArticle({senses: ['Случиться.']}), 3, ''],
        ]);
        // Английская сторона — прежний путь: штамп = rowid, сочинённые статьи влиты.
        const host = await readRows(path.join(result.directory, 'wty-en-en.zip'));
        expect(host.map((row) => [row[0], row[6]])).toStrictEqual([['dream', 1], ['dreamt', 2], ['happen to', 3]]);
        expect(fs.existsSync(sources.journalPath)).toBe(false);
    });

    test('build.json: источник, счётчики и сироты; полей журнала и списков нет', async () => {
        const result = await buildDict(createDictWithRussian());
        /** @type {Record<string, any>} */
        const onDisk = parseJson(fs.readFileSync(path.join(result.directory, 'build.json'), 'utf8'));
        expect(onDisk.ruSource).toBe('dict');
        expect(Object.keys(onDisk.sources)).toStrictEqual(['dict']);
        expect(onDisk.translation).toMatchObject({rows: 3, sourceRows: 3, pairedStamps: 2, orphanStamps: 1, sourceRevision: '2026.09.06'});
        expect(onDisk.artifactVerification).toMatchObject({pairedStamps: 2, orphanStamps: 1, translation: {rows: 3}});
        for (const key of ['transform', 'staleAuthoredTranslations', 'untranslatedAuthored']) {
            expect(onDisk).not.toHaveProperty(key);
        }
        expect(onDisk.guards.map((/** @type {{id: string}} */ g) => g.id)).not.toContain('G1');
        expect(onDisk.guards.map((/** @type {{id: string}} */ g) => g.id)).not.toContain('G11');
        expect(fs.readdirSync(result.directory).sort()).toStrictEqual(['build.json', 'flibooster-en-ru.zip', 'wty-en-en.zip']);
    });

    test('ревизия детерминирована и меняется, когда меняется русская строка (и сирота тоже)', async () => {
        const sources = createDictWithRussian();
        const first = await buildDict(sources, 'a');
        const second = await buildDict(sources, 'b');
        expect(second.revision).toBe(first.revision);
        for (const name of ['wty-en-en.zip', 'flibooster-en-ru.zip']) {
            expect(fs.readFileSync(path.join(first.directory, name)).equals(fs.readFileSync(path.join(second.directory, name)))).toBe(true);
        }
        const again = await buildDict(sources, 'a');
        expect(again.status).toBe('up-to-date');

        const dict = new DatabaseSync(sources.dictPath);
        dict.prepare("UPDATE terms SET glossary = ? WHERE dictionary = 'flibooster-en-ru' AND expression = 'dream'").run(JSON.stringify(wtyArticle({senses: ['Грезить.']})));
        dict.close();
        const changed = await buildDict(sources, 'a');
        expect(changed.revision).not.toBe(first.revision);

        const dict2 = new DatabaseSync(sources.dictPath);
        dict2.prepare("UPDATE terms SET term_tags = 'x' WHERE dictionary = 'flibooster-en-ru' AND expression = 'add in'").run();
        dict2.close();
        const orphanChanged = await buildDict(sources, 'a');
        expect(orphanChanged.revision).not.toBe(changed.revision);
    });

    test('ревизия не зависит от порядка строк в базе', async () => {
        const sources = createDictWithRussian();
        const first = await buildDict(sources, 'a');
        const dict = new DatabaseSync(sources.dictPath);
        // Пересоздаём русские строки в обратном порядке: rowid другие, содержимое то же.
        const ru = dict.prepare("SELECT * FROM terms WHERE dictionary = 'flibooster-en-ru' ORDER BY rowid DESC").all();
        dict.exec("DELETE FROM terms WHERE dictionary = 'flibooster-en-ru'");
        const insert = dict.prepare('INSERT INTO terms(dictionary, expression, reading, definition_tags, rules, score, glossary, sequence, term_tags) VALUES(?,?,?,?,?,?,?,?,?)');
        for (const r of /** @type {Record<string, any>[]} */ (ru)) {
            insert.run(r.dictionary, r.expression, r.reading, r.definition_tags, r.rules, r.score, r.glossary, r.sequence, r.term_tags);
        }
        dict.close();
        const second = await buildDict(sources, 'b');
        expect(second.revision).toBe(first.revision);
    });

    test('журнал не открывается даже когда путь указывает на мусор', async () => {
        const sources = createDictWithRussian();
        const garbage = path.join(workDir, 'garbage.db');
        fs.writeFileSync(garbage, 'это не sqlite');
        const result = await buildDict({...sources, journalPath: garbage});
        expect(result.status).toBe('built');
    });

    test('словарь не найден — громкая ошибка, файл не создаётся', async () => {
        const missing = path.join(workDir, 'missing.db');
        await expect(buildDict({dictPath: missing, journalPath: missing})).rejects.toThrow(/словарь dict_base\.db не найден/);
        expect(fs.existsSync(missing)).toBe(false);
    });

    test('ни одной строки flibooster-en-ru — отказ, снимок не остаётся', async () => {
        const sources = createDictWithRussian();
        const dict = new DatabaseSync(sources.dictPath);
        dict.exec("DELETE FROM terms WHERE dictionary = 'flibooster-en-ru'");
        dict.close();
        const before = listSnapshots();
        await expect(buildDict(sources)).rejects.toThrow(/нет ни одной строки flibooster-en-ru/);
        expect([...listSnapshots()].filter((name) => !before.has(name))).toStrictEqual([]);
        expect(fs.existsSync(path.join(workDir, 'out'))).toBe(false);
    });

    test('русская строка, чей штамп сел на чужое выражение, роняет сборку (G3)', async () => {
        const sources = createDictWithRussian();
        const dict = new DatabaseSync(sources.dictPath);
        dict.prepare("UPDATE terms SET sequence = 3 WHERE dictionary = 'flibooster-en-ru' AND expression = 'dream'").run();
        dict.close();
        await expect(buildDict(sources)).rejects.toThrow(/G2|G3/);
        expect(fs.existsSync(path.join(workDir, 'out'))).toBe(false);
    });

    test('русский штамп на деинфлексию роняет сборку (G9)', async () => {
        const sources = createDictWithRussian();
        const dict = new DatabaseSync(sources.dictPath);
        addTerm(dict, {dictionary: 'flibooster-en-ru', expression: 'dreamt', glossary: ['Снилось.'], definitionTags: 'v', rules: 'v', sequence: 2});
        dict.close();
        await expect(buildDict(sources)).rejects.toThrow(/G9/);
    });

    test('ошибка до записи не оставляет снимка словаря', async () => {
        const sources = createDictWithRussian();
        const dict = new DatabaseSync(sources.dictPath);
        addTerm(dict, {dictionary: 'flibooster-en-ru', expression: 'dreamt', glossary: ['Снилось.'], definitionTags: 'v', rules: 'v', sequence: 2});
        dict.close();
        const before = listSnapshots();
        await expect(buildDict(sources)).rejects.toThrow(/G9/);
        expect([...listSnapshots()].filter((name) => !before.has(name))).toStrictEqual([]);
    });
});

describe('checkRussianRowCount — выложено столько, сколько в источнике', () => {
    test('совпало — молчит', () => {
        expect(() => checkRussianRowCount({sourceRows: 5, emitted: 5, inZip: 5})).not.toThrow();
    });

    test('расхождение с источником или с zip — громкая ошибка', () => {
        expect(() => checkRussianRowCount({sourceRows: 5, emitted: 4, inZip: 4})).toThrow(/число русских строк/);
        expect(() => checkRussianRowCount({sourceRows: 5, emitted: 5, inZip: 6})).toThrow(/число русских строк/);
    });
});

describe('verifyPairZips — сироты', () => {
    test('сирота допустима только явно и посчитана', async () => {
        const result = await buildDict(createDictWithRussian());
        const host = fs.readFileSync(path.join(result.directory, 'wty-en-en.zip'));
        const translation = fs.readFileSync(path.join(result.directory, 'flibooster-en-ru.zip'));
        await expect(verifyPairZips(host, translation)).rejects.toThrow(/П3/);
        await expect(verifyPairZips(host, translation, {allowOrphans: true})).resolves.toMatchObject({pairedStamps: 2, orphanStamps: 1});
    });
});

describe('parseRuSource и CLI', () => {
    test('по умолчанию dict, journal допустим, остальное — отказ', () => {
        expect(RU_SOURCES).toStrictEqual(['dict', 'journal']);
        expect(parseRuSource(void 0)).toBe('dict');
        expect(parseRuSource('dict')).toBe('dict');
        expect(parseRuSource('journal')).toBe('journal');
        expect(() => parseRuSource('Journal')).toThrow(/--ru-source/);
        expect(() => parseRuSource('')).toThrow(/--ru-source/);
    });

    test('CLI отвергает неизвестный --ru-source до открытия источников', () => {
        const missing = path.join(workDir, 'missing.db');
        const run = spawnSync(process.execPath, [CLI, '--ru-source', 'enrich', '--dict', missing, '--out', path.join(workDir, 'out')], {encoding: 'utf8'});
        expect(run.status).toBe(1);
        expect(run.stderr).toMatch(/--ru-source/);
        expect(run.stderr).not.toMatch(/не найден/);
        expect(fs.existsSync(path.join(workDir, 'out'))).toBe(false);
    });

    test('CLI --help описывает --ru-source и не трогает источники', () => {
        const run = spawnSync(process.execPath, [CLI, '--help'], {encoding: 'utf8'});
        expect(run.status).toBe(0);
        expect(run.stdout).toMatch(/--ru-source/);
        expect(run.stdout).toMatch(/dict/);
        expect(run.stdout).toMatch(/journal/);
    });

    test('CLI в режиме dict собирает пару без журнала', () => {
        const sources = createDictWithRussian();
        const out = path.join(workDir, 'out');
        const run = spawnSync(process.execPath, [CLI, '--dict', sources.dictPath, '--out', out], {encoding: 'utf8', env: {...process.env, FLIB_ENRICH_JOURNAL: sources.journalPath}});
        expect(run.stderr).not.toMatch(/build:dictionaries:/);
        expect(run.status).toBe(0);
        /** @type {Record<string, any>} */
        const report = parseJson(run.stdout);
        expect(report.status).toBe('built');
        expect(report.ruSource).toBe('dict');
        expect(report.translation).toMatchObject({rows: 3, sourceRows: 3, orphanStamps: 1});
    });
});

describe('openDatabaseBackupSnapshot — снимок через backup()', () => {
    test('снимок только на чтение, не видит записей после снятия и удаляется', async () => {
        const {dictPath} = createDictWithRussian();
        const before = listSnapshots();
        const snapshot = await openDatabaseBackupSnapshot(dictPath, 'словарь', '--dict');
        expect([...listSnapshots()].filter((name) => !before.has(name))).toHaveLength(1);
        const writer = new DatabaseSync(dictPath);
        writer.exec("DELETE FROM terms WHERE dictionary = 'flibooster-en-ru'");
        writer.close();
        expect(snapshot.db.prepare("SELECT count(*) AS n FROM terms WHERE dictionary = 'flibooster-en-ru'").get()).toMatchObject({n: 3});
        expect(() => snapshot.db.exec('CREATE TABLE x (a)')).toThrow(/readonly/);
        snapshot.dispose();
        expect([...listSnapshots()].filter((name) => !before.has(name))).toStrictEqual([]);
    });

    test('источник не найден — ошибка, файл и снимок не создаются', async () => {
        const missing = path.join(workDir, 'missing.db');
        const before = listSnapshots();
        await expect(openDatabaseBackupSnapshot(missing, 'словарь', '--dict')).rejects.toThrow(/не найден/);
        expect(fs.existsSync(missing)).toBe(false);
        expect([...listSnapshots()].filter((name) => !before.has(name))).toStrictEqual([]);
    });
});
