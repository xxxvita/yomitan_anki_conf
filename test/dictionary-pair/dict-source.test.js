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

// Русская сторона из dict_base.db — единственный источник пары: строки
// flibooster-en-ru берутся как есть, сироты сохраняются.

import JSZip from 'jszip';
import crypto from 'node:crypto';
import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {buildDictionaryPair, checkRussianRowCount} from '../../dev/dictionary-pair/pair-builder.js';
import {verifyPairZips} from '../../dev/dictionary-pair/pair-verify.js';
import {DICT_ENV, openDatabaseBackupSnapshot} from '../../dev/dictionary-pair/sources.js';
import {parseJson} from '../../dev/json.js';
import {addTerm, createDictDb, wtyArticle} from './fixture-db.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const CLI = path.join(dirname, '..', '..', 'dev', 'bin', 'build-dictionaries.js');
const SNAPSHOT_PREFIX = 'flib-dict-snapshot-';

/** @type {string} */
let workDir;
/** @type {string|undefined} */
let savedTmpdir;

beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flib-dict-source-'));
    // Свой TMPDIR: проверки «снимок не остался» не должны видеть снимки
    // параллельно идущих тестов других файлов.
    savedTmpdir = process.env.TMPDIR;
    process.env.TMPDIR = path.join(workDir, 'tmp');
    fs.mkdirSync(process.env.TMPDIR);
});

afterEach(() => {
    if (typeof savedTmpdir === 'string') {
        process.env.TMPDIR = savedTmpdir;
    } else {
        delete process.env.TMPDIR;
    }
    fs.rmSync(workDir, {recursive: true, force: true});
});

/**
 * dict_base.db с готовой русской выкладкой: пара на wty-en-en, пара на
 * сочинённую статью flibooster-en и сирота — штамп, которому хозяина нет.
 * @returns {{dictPath: string}}
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
    return {dictPath};
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
        /** @type {unknown[][]} */
        const bank = parseJson(await file.async('string'));
        rows.push(...bank);
    }
    return rows;
}

/**
 * @param {{dictPath: string}} sources
 * @param {string} [outName]
 * @returns {Promise<import('../../dev/dictionary-pair/pair-builder.js').BuildResult>}
 */
async function buildDict(sources, outName = 'out') {
    return await buildDictionaryPair({...sources, outRoot: path.join(workDir, outName)});
}

/**
 * @returns {Set<string>}
 */
function listSnapshots() {
    return new Set(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith(SNAPSHOT_PREFIX)));
}

/**
 * Окружение CLI без пути словаря из окружения разработчика и с HOME во
 * временном каталоге: даже вернувшееся машинное умолчание (~/.config/…) не
 * дотянется до настоящей базы.
 * @param {Record<string, string>} [extra]
 * @returns {Record<string, string|undefined>}
 */
function cliEnv(extra = {}) {
    /** @type {Record<string, string|undefined>} */
    const env = {...process.env, HOME: workDir, ...extra};
    if (!(DICT_ENV in extra)) { delete env[DICT_ENV]; }
    return env;
}

/**
 * @param {string[]} args
 * @param {Record<string, string>} [extra]
 * @returns {import('node:child_process').SpawnSyncReturns<string>}
 */
function runCli(args, extra) {
    return spawnSync(process.execPath, [CLI, ...args], {encoding: 'utf8', env: cliEnv(extra)});
}

describe('русские строки из dict_base.db', () => {
    test('выкладываются все строки flibooster-en-ru как есть, включая сироту', async () => {
        const sources = createDictWithRussian();
        const result = await buildDict(sources);
        const rows = await readRows(path.join(result.directory, 'flibooster-en-ru.zip'));
        expect(rows).toStrictEqual([
            ['add in', '', 'phrase', 'phrase', 0, wtyArticle({senses: ['Добавить.']}), 999, 'orphan-tag'],
            ['dream', '', 'v', 'v', 7, wtyArticle({senses: ['Спать.']}), 1, ''],
            ['happen to', '', 'phrase', 'phrase', 0, wtyArticle({senses: ['Случиться.']}), 3, ''],
        ]);
        // Английская сторона: штамп = rowid, сочинённые статьи влиты.
        const host = await readRows(path.join(result.directory, 'wty-en-en.zip'));
        expect(host.map((row) => [row[0], row[6]])).toStrictEqual([['dream', 1], ['dreamt', 2], ['happen to', 3]]);
    });

    test('выход побайтно тот же, что до отказа от журнала (закреплено)', async () => {
        const result = await buildDict(createDictWithRussian());
        // Сняты с createDictWithRussian() кодом до удаления режима journal (--ru-source dict).
        expect(result.revision).toBe('6-3-762ee2a4d45d');
        const digest = (/** @type {string} */ name) => crypto.createHash('sha256').update(fs.readFileSync(path.join(result.directory, name))).digest('hex');
        expect(digest('wty-en-en.zip')).toBe('7440b668493d8275330ae1a2d14d1e054526552c9671850eea9502a1934f90bf');
        expect(digest('flibooster-en-ru.zip')).toBe('0a583a74421a4f2b3711ec43128342fd1876b7b85e5e1706ac4aaede38f2cbbd');
        /** @type {Record<string, unknown>} */
        const onDisk = parseJson(fs.readFileSync(path.join(result.directory, 'build.json'), 'utf8'));
        expect(Object.keys(onDisk)).toStrictEqual(['tool', 'revision', 'ruSource', 'sources', 'host', 'translation', 'guards', 'artifactVerification', 'startedAt', 'finishedAt']);
        const {startedAt, finishedAt, sources, ...stable} = onDisk;
        expect(typeof startedAt).toBe('string');
        expect(typeof finishedAt).toBe('string');
        expect(Object.keys(/** @type {Record<string, unknown>} */ (sources))).toStrictEqual(['dict']);
        expect(stable).toStrictEqual({
            tool: 'flib-dict-pair/2',
            revision: '6-3-762ee2a4d45d',
            ruSource: 'dict',
            host: {title: 'wty-en-en', file: 'wty-en-en.zip', revision: '6-3-762ee2a4d45d', rows: 3, banks: 1, bytes: 896, sha256: '7440b668493d8275330ae1a2d14d1e054526552c9671850eea9502a1934f90bf', rowsByDictionary: {'wty-en-en': 2, 'flibooster-en': 1}, maxRowid: 3},
            translation: {title: 'flibooster-en-ru', file: 'flibooster-en-ru.zip', revision: '6-3-762ee2a4d45d', rows: 3, banks: 1, bytes: 939, sha256: '0a583a74421a4f2b3711ec43128342fd1876b7b85e5e1706ac4aaede38f2cbbd', sourceRows: 3, sourceRevision: '2026.09.06', pairedStamps: 2, orphanStamps: 1},
            guards: [
                {id: 'G2', title: 'русские штампы уникальны', violations: 0},
                {id: 'G3', title: 'expression и rules русской строки равны хозяйским', violations: 0},
                {id: 'G4', title: "русский reading — '' или expression", violations: 0},
                {id: 'G5', title: 'glossary русских строк — JSON-массив', violations: 0},
                {id: 'G7', title: 'русский штамп >= 1', violations: 0},
                {id: 'G9', title: 'хозяин русской строки не деинфлексия (есть элемент glossary не-массив)', violations: 0},
                {id: 'G5h', title: 'glossary хозяев — JSON-массив', violations: 0},
            ],
            artifactVerification: {host: {revision: '6-3-762ee2a4d45d', rows: 3, banks: 1}, translation: {revision: '6-3-762ee2a4d45d', rows: 3, banks: 1}, pairedStamps: 2, orphanStamps: 1},
        });
    });

    test('build.json: источник, счётчики и сироты; полей журнала и списков нет', async () => {
        const result = await buildDict(createDictWithRussian());
        /** @type {{ruSource: string, sources: Record<string, unknown>, translation: unknown, artifactVerification: unknown, guards: {id: string}[]}} */
        const onDisk = parseJson(fs.readFileSync(path.join(result.directory, 'build.json'), 'utf8'));
        expect(onDisk.ruSource).toBe('dict');
        expect(Object.keys(onDisk.sources)).toStrictEqual(['dict']);
        expect(onDisk.translation).toMatchObject({rows: 3, sourceRows: 3, pairedStamps: 2, orphanStamps: 1, sourceRevision: '2026.09.06'});
        expect(onDisk.artifactVerification).toMatchObject({pairedStamps: 2, orphanStamps: 1, translation: {rows: 3}});
        for (const key of ['transform', 'staleAuthoredTranslations', 'untranslatedAuthored']) {
            expect(onDisk).not.toHaveProperty(key);
        }
        expect(onDisk.guards.map((g) => g.id)).not.toContain('G1');
        expect(onDisk.guards.map((g) => g.id)).not.toContain('G11');
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
        dict.exec(`
            CREATE TEMP TABLE ru AS SELECT * FROM terms WHERE dictionary = 'flibooster-en-ru' ORDER BY rowid DESC;
            DELETE FROM terms WHERE dictionary = 'flibooster-en-ru';
            INSERT INTO terms SELECT * FROM temp.ru ORDER BY rowid;
        `);
        expect(dict.prepare("SELECT group_concat(expression, '|') AS e FROM (SELECT expression FROM terms WHERE dictionary = 'flibooster-en-ru' ORDER BY rowid)").get()).toMatchObject({e: 'dream|add in|happen to'});
        dict.close();
        const second = await buildDict(sources, 'b');
        expect(second.revision).toBe(first.revision);
    });

    test('словарь не найден — громкая ошибка, файл не создаётся', async () => {
        const missing = path.join(workDir, 'missing.db');
        await expect(buildDict({dictPath: missing})).rejects.toThrow(/словарь dict_base\.db не найден/);
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

describe('каталог прежней сборки из журнала', () => {
    test('пересборка той же ревизии: zip те же, build.json заменён, списки журнала убраны', async () => {
        const sources = createDictWithRussian();
        const outRoot = path.join(workDir, 'out');
        const first = await buildDictionaryPair({...sources, outRoot});
        // Так выглядел каталог, собранный режимом journal: два построчных списка рядом с build.json.
        fs.writeFileSync(path.join(first.directory, 'stale-authored-translations.txt'), 'gone away\n');
        fs.writeFileSync(path.join(first.directory, 'untranslated-authored.txt'), '');
        fs.writeFileSync(path.join(first.directory, 'build.json'), '{"ruSource": "journal"}\n');
        const again = await buildDictionaryPair({...sources, outRoot});
        expect(again.revision).toBe(first.revision);
        expect(again.status).toBe('up-to-date');
        expect(fs.readdirSync(again.directory).sort()).toStrictEqual(['build.json', 'flibooster-en-ru.zip', 'wty-en-en.zip']);
        /** @type {Record<string, unknown>} */
        const onDisk = parseJson(fs.readFileSync(path.join(again.directory, 'build.json'), 'utf8'));
        expect(onDisk.ruSource).toBe('dict');
    });
});

describe('build.json публикуется — без локальных путей', () => {
    /**
     * Все строковые значения JSON, рекурсивно.
     * @param {unknown} value
     * @returns {string[]}
     */
    function strings(value) {
        if (typeof value === 'string') { return [value]; }
        if (Array.isArray(value)) { return value.flatMap((item) => strings(item)); }
        if (typeof value === 'object' && value !== null) { return Object.values(value).flatMap((item) => strings(item)); }
        return [];
    }

    test('источник записан только именем файла', async () => {
        const result = await buildDict(createDictWithRussian());
        const text = fs.readFileSync(path.join(result.directory, 'build.json'), 'utf8');
        expect(text).not.toContain(workDir);
        expect(text).not.toContain(os.homedir());
        const values = strings(parseJson(text));
        expect(values.filter((value) => path.isAbsolute(value))).toStrictEqual([]);
        /** @type {{sources: {dict: {path: string}}}} */
        const onDisk = parseJson(text);
        expect(onDisk.sources.dict.path).toBe('dict_base.db');
    });

    test('ревизия не зависит от пути и имени источника', async () => {
        const sources = createDictWithRussian();
        const first = await buildDict(sources, 'a');
        const elsewhere = path.join(workDir, 'другой каталог');
        fs.mkdirSync(elsewhere);
        const moved = path.join(elsewhere, 'renamed.db');
        fs.copyFileSync(sources.dictPath, moved);
        const second = await buildDict({dictPath: moved}, 'b');
        expect(second.revision).toBe(first.revision);
        /** @type {{sources: {dict: {path: string}}}} */
        const onDisk = parseJson(fs.readFileSync(path.join(second.directory, 'build.json'), 'utf8'));
        expect(onDisk.sources.dict.path).toBe('renamed.db');
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

describe('CLI: путь словаря обязателен', () => {
    test('ни --dict, ни переменной — отказ до открытия источников, выход не пишется', () => {
        // Годная база на прежнем машинном пути (HOME CLI = workDir) не должна подхватиться.
        const legacy = path.join(workDir, '.config', 'anki-connect-desktop', 'data', 'yomitan', 'dict_base.db');
        fs.mkdirSync(path.dirname(legacy), {recursive: true});
        fs.copyFileSync(createDictWithRussian().dictPath, legacy);
        const out = path.join(workDir, 'out');
        const run = runCli(['--out', out]);
        expect(run.status).toBe(1);
        expect(run.stderr).toMatch(/--dict/);
        expect(run.stderr).toMatch(new RegExp(DICT_ENV));
        expect(run.stdout).toBe('');
        expect(fs.existsSync(out)).toBe(false);
        expect([...listSnapshots()]).toStrictEqual([]);
    });

    test('путь берётся из переменной окружения', () => {
        const sources = createDictWithRussian();
        const run = runCli(['--out', path.join(workDir, 'out')], {[DICT_ENV]: sources.dictPath});
        expect(run.stderr).not.toMatch(/build:dictionaries:/);
        expect(run.status).toBe(0);
        /** @type {Record<string, any>} */
        const report = parseJson(run.stdout);
        expect(report.status).toBe('built');
        expect(report.ruSource).toBe('dict');
        expect(report.translation).toMatchObject({rows: 3, sourceRows: 3, orphanStamps: 1});
    });

    test('--dict важнее переменной окружения', () => {
        const sources = createDictWithRussian();
        const run = runCli(['--dict', sources.dictPath, '--out', path.join(workDir, 'out')], {[DICT_ENV]: path.join(workDir, 'нет-такого.db')});
        expect(run.status).toBe(0);
        expect(parseJson(run.stdout)).toMatchObject({status: 'built'});
    });

    test.each([
        [['--ru-source', 'dict']],
        [['--ru-source', 'journal']],
        [['--journal', '/нет/enrich.db']],
    ])('прежние флаги режима журнала отвергаются: %j', (args) => {
        const sources = createDictWithRussian();
        const out = path.join(workDir, 'out');
        const run = runCli(['--dict', sources.dictPath, ...args, '--out', out]);
        expect(run.status).toBe(1);
        expect(run.stderr).toContain(args[0]);
        expect(fs.existsSync(out)).toBe(false);
    });

    test('--help: --dict обязателен, режима журнала нет, источники не трогаются', () => {
        const run = runCli(['--help']);
        expect(run.status).toBe(0);
        expect(run.stdout).toMatch(/--dict <path>/);
        expect(run.stdout).toMatch(new RegExp(DICT_ENV));
        expect(run.stdout).toMatch(/required/);
        expect(run.stdout).not.toMatch(/--ru-source|--journal|enrich\.db/);
    });
});

describe('CLI --verify', () => {
    /**
     * @returns {string} каталог собранной ревизии
     */
    function buildWithCli() {
        const sources = createDictWithRussian();
        const run = runCli(['--dict', sources.dictPath, '--out', path.join(workDir, 'out')]);
        expect(run.status).toBe(0);
        /** @type {{directory: string}} */
        const report = parseJson(run.stdout);
        return report.directory;
    }

    test('не требует ни --dict, ни переменной окружения', () => {
        const directory = buildWithCli();
        const run = runCli(['--verify', directory]);
        expect(run.status).toBe(0);
        expect(parseJson(run.stdout)).toMatchObject({orphanStamps: 1, translation: {rows: 3}});
    });

    test('сверяет zip с build.json: строки и сироты', () => {
        const directory = buildWithCli();
        const buildJsonPath = path.join(directory, 'build.json');
        const original = fs.readFileSync(buildJsonPath, 'utf8');

        /** @type {{translation: {rows: number, orphanStamps: number}, host: {rows: number}}} */
        const tampered = parseJson(original);
        tampered.translation.orphanStamps = 0;
        fs.writeFileSync(buildJsonPath, JSON.stringify(tampered));
        const orphans = runCli(['--verify', directory]);
        expect(orphans.status).toBe(1);
        expect(orphans.stderr).toMatch(/translation\.orphanStamps/);

        tampered.translation.orphanStamps = 1;
        tampered.translation.rows = 4;
        tampered.host.rows = 9;
        fs.writeFileSync(buildJsonPath, JSON.stringify(tampered));
        const rows = runCli(['--verify', directory]);
        expect(rows.status).toBe(1);
        expect(rows.stderr).toMatch(/host\.rows/);
        expect(rows.stderr).toMatch(/translation\.rows/);
    });

    test('сироты допустимы, только если build.json говорит ruSource "dict"; старый каталог — строгая проверка', () => {
        const directory = buildWithCli();
        const buildJsonPath = path.join(directory, 'build.json');
        /** @type {Record<string, unknown>} */
        const original = parseJson(fs.readFileSync(buildJsonPath, 'utf8'));
        for (const ruSource of [void 0, 'journal']) {
            fs.writeFileSync(buildJsonPath, JSON.stringify({...original, ruSource}));
            const run = runCli(['--verify', directory]);
            expect(run.status).toBe(1);
            expect(run.stderr).toMatch(/П3/);
        }
        fs.rmSync(buildJsonPath);
        expect(runCli(['--verify', directory]).stderr).toMatch(/П3/);
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
