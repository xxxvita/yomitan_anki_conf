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

import JSZip from 'jszip';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {Worker} from 'node:worker_threads';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {buildDictionaryPair, checkPairGuards} from '../../dev/dictionary-pair/pair-builder.js';
import {verifyPairZips} from '../../dev/dictionary-pair/pair-verify.js';
import {openDatabaseSnapshot, openReadOnlyDatabase} from '../../dev/dictionary-pair/sources.js';
import {parseJson} from '../../dev/json.js';
import {addJournal, addTerm, createDictDb, createJournalDb, sensePath, stampFingerprint, wtyArticle} from './fixture-db.js';

/** @type {string} */
let workDir;

beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flib-dict-pair-'));
});

afterEach(() => {
    fs.rmSync(workDir, {recursive: true, force: true});
});

/**
 * Источники на диске: английская статья с переводом, деинфлексия, сочинённая
 * статья с легаси-переводом, вторая часть речи сочинённой статьи без перевода
 * и протухшая русская строка в dict_base.db, которую сборщик обязан игнорировать.
 * @returns {{dictPath: string, journalPath: string}}
 */
function createSourceFiles() {
    const dictPath = path.join(workDir, 'dict_base.db');
    const journalPath = path.join(workDir, 'enrich.db');
    const dict = createDictDb(dictPath);
    const journal = createJournalDb(journalPath);
    const dream = addTerm(dict, {dictionary: 'wty-en-en', expression: 'dream', glossary: wtyArticle({senses: ['To sleep.', 'To wish.']}), definitionTags: 'v', rules: 'v'});
    addJournal(journal, {expression: 'dream', dictRowid: dream, nodePath: sensePath(0), source: 'To sleep.', translation: 'Спать.'});
    addJournal(journal, {expression: 'dream', dictRowid: dream, nodePath: sensePath(1), source: 'To wish.', translation: 'Мечтать.'});
    addTerm(dict, {dictionary: 'wty-en-en', expression: 'dreamt', glossary: [['dream', ['past']]], definitionTags: 'v', rules: 'v'});
    addTerm(dict, {dictionary: 'wty-en-en', expression: 'zebra', glossary: wtyArticle({senses: ['An animal.']})});
    addTerm(dict, {dictionary: 'flibooster-en', expression: 'happen to', glossary: wtyArticle({senses: ['To occur by chance.']}), definitionTags: 'phrase', rules: 'phrase'});
    addTerm(dict, {dictionary: 'flibooster-en', expression: 'happen to', glossary: wtyArticle({senses: ['Second POS.']}), definitionTags: 'v', rules: 'v'});
    addJournal(journal, {expression: 'happen to', dictRowid: 0, nodePath: sensePath(0), source: 'To occur by chance.', translation: 'Случиться.'});
    addTerm(dict, {dictionary: 'flibooster-en-ru', expression: 'zebra', glossary: wtyArticle({senses: ['Протухшая зебра.']}), sequence: 3});
    stampFingerprint(journal, dict);
    dict.close();
    journal.close();
    return {dictPath, journalPath};
}

/**
 * @param {string} zipPath
 * @returns {Promise<{names: string[], index: Record<string, unknown>, rows: unknown[][], dates: number[]}>}
 */
async function readZip(zipPath) {
    const zip = await JSZip.loadAsync(fs.readFileSync(zipPath));
    const names = Object.keys(zip.files);
    const indexFile = zip.file('index.json');
    if (indexFile === null) { throw new Error('index.json отсутствует'); }
    /** @type {Record<string, unknown>} */
    const index = parseJson(await indexFile.async('string'));
    /** @type {unknown[][]} */
    const rows = [];
    for (const name of names.filter((n) => n.startsWith('term_bank_'))) {
        const file = zip.file(name);
        if (file === null) { throw new Error(name); }
        /** @type {unknown[][]} */
        const bank = parseJson(await file.async('string'));
        rows.push(...bank);
    }
    const dates = names.map((name) => zip.files[name].date.getTime());
    return {names, index, rows, dates};
}

/**
 * @param {{dictPath: string, journalPath: string}} sources
 * @param {string} outName
 * @returns {Promise<import('../../dev/dictionary-pair/pair-builder.js').BuildResult>}
 */
async function build(sources, outName = 'out') {
    return await buildDictionaryPair({...sources, outRoot: path.join(workDir, outName)});
}

describe('buildDictionaryPair — артефакт по контракту расширения', () => {
    test('index.json: заголовки, формат, одинаковый revision, sequenced только у английского, без полей автообновления', async () => {
        const result = await build(createSourceFiles());
        const host = await readZip(path.join(result.directory, 'wty-en-en.zip'));
        const translation = await readZip(path.join(result.directory, 'flibooster-en-ru.zip'));
        expect(host.index).toStrictEqual({
            title: 'wty-en-en',
            format: 3,
            revision: result.revision,
            sequenced: true,
            author: 'Flibooster',
            description: `Flib-club dictionary pair, build ${result.revision}`,
            sourceLanguage: 'en',
            targetLanguage: 'en',
        });
        expect(translation.index).toStrictEqual({
            title: 'flibooster-en-ru',
            format: 3,
            revision: result.revision,
            author: 'Flibooster',
            description: `Flib-club dictionary pair, build ${result.revision}`,
            sourceLanguage: 'en',
            targetLanguage: 'ru',
        });
        expect(result.revision).toMatch(/^\d+-\d+-[0-9a-f]{12}$/);
        for (const index of [host.index, translation.index]) {
            expect(index).not.toHaveProperty('isUpdatable');
            expect(index).not.toHaveProperty('indexUrl');
            expect(index).not.toHaveProperty('downloadUrl');
        }
    });

    test('строки банков: 8 элементов, хозяин = rowid, сочинённые статьи влиты в английский zip, протухшие русские строки dict_base.db не берутся', async () => {
        const result = await build(createSourceFiles());
        const host = await readZip(path.join(result.directory, 'wty-en-en.zip'));
        const translation = await readZip(path.join(result.directory, 'flibooster-en-ru.zip'));
        for (const row of [...host.rows, ...translation.rows]) {
            expect(row).toHaveLength(8);
            expect(Number.isInteger(row[6])).toBe(true);
        }
        expect(host.rows.map((row) => [row[0], row[6]])).toStrictEqual([['dream', 1], ['dreamt', 2], ['zebra', 3], ['happen to', 4], ['happen to', 5]]);
        expect(translation.rows.map((row) => [row[0], row[6], row[2]])).toStrictEqual([['dream', 1, 'v'], ['happen to', 4, 'phrase']]);
        expect(JSON.stringify(translation.rows)).not.toContain('Протухшая');
        expect(translation.rows[0][5]).toStrictEqual(wtyArticle({senses: ['Спать.', 'Мечтать.']}));
        /** @type {{host: Record<string, unknown>, translation: Record<string, unknown>}} */
        const buildJson = parseJson(fs.readFileSync(path.join(result.directory, 'build.json'), 'utf8'));
        expect(buildJson.host).toMatchObject({rows: 5, rowsByDictionary: {'wty-en-en': 3, 'flibooster-en': 2}});
        expect(buildJson.translation).toMatchObject({rows: 2});
        expect(buildJson.host.sha256).toMatch(/^[0-9a-f]{64}$/);
    });

    test('два прогона на тех же данных дают побайтно одинаковые zip с фиксированной датой', async () => {
        const sources = createSourceFiles();
        const first = await build(sources, 'a');
        const second = await build(sources, 'b');
        expect(second.revision).toBe(first.revision);
        for (const name of ['wty-en-en.zip', 'flibooster-en-ru.zip']) {
            const a = fs.readFileSync(path.join(first.directory, name));
            const b = fs.readFileSync(path.join(second.directory, name));
            expect(a.equals(b)).toBe(true);
            const {names, dates} = await readZip(path.join(first.directory, name));
            expect(names[0]).toBe('index.json');
            expect(new Set(dates)).toStrictEqual(new Set([Date.UTC(1980, 0, 1)]));
        }
    });

    test('revision: та же сборка — тот же каталог; один изменённый перевод — новый revision', async () => {
        const sources = createSourceFiles();
        const first = await build(sources);
        const again = await build(sources);
        expect(again.revision).toBe(first.revision);
        expect(again.status).toBe('up-to-date');

        const journal = new DatabaseSync(sources.journalPath);
        journal.prepare("UPDATE enrich_log SET translation = 'Грезить.' WHERE expression = 'dream' AND node_path = ?").run(sensePath(1));
        journal.close();
        const changed = await build(sources);
        expect(changed.revision).not.toBe(first.revision);
        expect(changed.status).toBe('built');
        expect(fs.existsSync(first.directory)).toBe(true);
        expect(fs.existsSync(changed.directory)).toBe(true);
    });

    test('отсутствующий источник — громкая ошибка, файл не создаётся, выход не пишется', async () => {
        const sources = createSourceFiles();
        // Каталог существует: без mode=ro SQLite молча создал бы здесь пустую базу.
        const missing = path.join(workDir, 'missing-enrich.db');
        await expect(build({...sources, journalPath: missing})).rejects.toThrow(/журнал enrich\.db не найден/);
        expect(fs.existsSync(missing)).toBe(false);
        expect(fs.existsSync(path.join(workDir, 'out'))).toBe(false);
    });
});

describe('buildDictionaryPair — сторожа пары срабатывают на сборке', () => {
    test('легаси-перевод, севший на статью wty-en-en, роняет сборку (G11), выход не пишется', async () => {
        const sources = createSourceFiles();
        // У «zebra» есть только статья wty-en-en: легаси-адрес 0 сядет на неё.
        const journal = new DatabaseSync(sources.journalPath);
        addJournal(journal, {expression: 'zebra', dictRowid: 0, nodePath: sensePath(0), source: 'An animal.', translation: 'Зебра.'});
        journal.close();
        await expect(build(sources)).rejects.toThrow(/G11/);
        expect(fs.existsSync(path.join(workDir, 'out'))).toBe(false);
    });
});

describe('чтение источников', () => {
    /**
     * Держит в отдельном потоке ЭКСКЛЮЗИВНУЮ пишущую транзакцию на базе
     * holdMs миллисекунд — как коммит живого прогона перевода. Ожидание
     * в нашем потоке синхронное, поэтому писатель обязан жить в другом.
     * @param {string} dbPath
     * @param {number} holdMs
     * @returns {Promise<{worker: Worker, done: Promise<void>}>}
     */
    async function holdExclusiveLock(dbPath, holdMs) {
        const worker = new Worker(`
            const {DatabaseSync} = require('node:sqlite');
            const {parentPort, workerData} = require('node:worker_threads');
            const db = new DatabaseSync(workerData.dbPath);
            db.exec('BEGIN EXCLUSIVE');
            db.exec("UPDATE meta SET value = value WHERE key = 'dict_title'");
            parentPort.postMessage('locked');
            Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, workerData.holdMs);
            db.exec('COMMIT');
            db.close();
        `, {eval: true, workerData: {dbPath, holdMs}});
        /** @type {Promise<void>} */
        const done = new Promise((resolve, reject) => {
            worker.once('exit', () => resolve());
            worker.once('error', reject);
        });
        await new Promise((resolve, reject) => {
            worker.once('message', resolve);
            worker.once('error', reject);
        });
        return {worker, done};
    }

    test('журнал под пишущей транзакцией: сборка ждёт коммита, а не падает «database is locked»', async () => {
        const sources = createSourceFiles();
        const reference = await build(sources, 'free');
        const {done} = await holdExclusiveLock(sources.journalPath, 700);
        const started = Date.now();
        const locked = await build(sources, 'locked');
        expect(Date.now() - started).toBeGreaterThanOrEqual(300);
        expect(locked.revision).toBe(reference.revision);
        await done;
    });

    test('соединение с источником отвергает запись, снимок тоже', () => {
        const sources = createSourceFiles();
        const db = openReadOnlyDatabase(sources.journalPath, 'журнал', '--journal');
        expect(() => db.exec('CREATE TABLE x (a)')).toThrow(/readonly/);
        db.close();
        const snapshot = openDatabaseSnapshot(sources.journalPath, 'журнал', '--journal');
        expect(() => snapshot.db.exec('CREATE TABLE x (a)')).toThrow(/readonly/);
        snapshot.dispose();
        const check = new DatabaseSync(sources.journalPath);
        expect(check.prepare("SELECT count(*) AS n FROM sqlite_master WHERE name = 'x'").get()).toMatchObject({n: 0});
        check.close();
    });
    test('снимок журнала не видит записей после снятия и удаляется вместе с каталогом', () => {
        const sources = createSourceFiles();
        const before = fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('flib-dict-snapshot-')).length;
        const snapshot = openDatabaseSnapshot(sources.journalPath, 'журнал', '--journal');
        const writer = new DatabaseSync(sources.journalPath);
        writer.exec('DELETE FROM enrich_log');
        writer.close();
        expect(snapshot.db.prepare('SELECT count(*) AS n FROM enrich_log').get()).toMatchObject({n: 3});
        snapshot.dispose();
        expect(fs.readdirSync(os.tmpdir()).filter((name) => name.startsWith('flib-dict-snapshot-')).length).toBe(before);
    });
});

describe('buildDictionaryPair — ревизия и пустые стороны', () => {
    test('изменилась одна английская строка — новая ревизия', async () => {
        const sources = createSourceFiles();
        const first = await build(sources);
        const dict = new DatabaseSync(sources.dictPath);
        dict.prepare("UPDATE terms SET definition_tags = 'adj' WHERE expression = 'zebra' AND dictionary = 'wty-en-en'").run();
        dict.close();
        const changed = await build(sources);
        expect(changed.revision).not.toBe(first.revision);
    });

    test('в журнале нет ни одной готовой статьи — отказ', async () => {
        const sources = createSourceFiles();
        const journal = new DatabaseSync(sources.journalPath);
        journal.exec("UPDATE enrich_log SET status = 'failed', translation = ''");
        journal.close();
        await expect(build(sources)).rejects.toThrow(/нет ни одной готовой русской статьи/);
    });

    test('в словаре нет строк хозяев — отказ', async () => {
        const dictPath = path.join(workDir, 'dict_base.db');
        const journalPath = path.join(workDir, 'enrich.db');
        const dict = createDictDb(dictPath);
        const journal = createJournalDb(journalPath);
        // Легаси-адрес садится на первую не-русскую строку, здесь — словаря вне пары.
        addTerm(dict, {dictionary: 'other', expression: 'stray', glossary: wtyArticle({senses: ['One.']})});
        addJournal(journal, {expression: 'stray', dictRowid: 0, nodePath: sensePath(0), source: 'One.', translation: 'Один.'});
        dict.close();
        journal.close();
        await expect(build({dictPath, journalPath})).rejects.toThrow(/в словаре нет строк/);
    });
});

describe('checkPairGuards — инварианты пары', () => {
    /** @type {import('../../dev/dictionary-pair/enrich-transform.js').TermRow} */
    const base = {expression: 'dream', reading: '', definitionTags: 'v', rules: 'v', score: 0, glossary: '["Сон."]', sequence: 1, termTags: ''};
    /** @type {import('../../dev/dictionary-pair/pair-builder.js').HostInfo} */
    const host = {expression: 'dream', rules: 'v', dictionary: 'wty-en-en', hasNonArrayElement: true};

    /**
     * @param {import('../../dev/dictionary-pair/enrich-transform.js').TermRow[]} russian
     * @param {Map<number, import('../../dev/dictionary-pair/pair-builder.js').HostInfo>} hosts
     * @param {Set<string>} [legacy]
     * @returns {Record<string, number>}
     */
    const violations = (russian, hosts, legacy = new Set()) => Object.fromEntries(
        checkPairGuards(russian, hosts, legacy).filter((g) => g.violations > 0).map((g) => [g.id, g.violations]),
    );

    test('чистая пара — без нарушений', () => {
        expect(violations([base], new Map([[1, host]]))).toStrictEqual({});
    });

    test('дубль русского штампа', () => {
        expect(violations([base, {...base, glossary: '["Мечта."]'}], new Map([[1, host]]))).toStrictEqual({G2: 1});
    });

    test('штамп на английскую строку-деинфлексию (только массивы)', () => {
        expect(violations([base], new Map([[1, {...host, hasNonArrayElement: false}]]))).toStrictEqual({G9: 1});
    });

    test('штамп без хозяина и нулевой штамп', () => {
        expect(violations([{...base, sequence: 7}], new Map([[1, host]]))).toStrictEqual({G1: 1});
        expect(violations([{...base, sequence: 0}], new Map([[1, host]]))).toStrictEqual({G1: 1, G7: 1});
    });

    test('расхождение выражения/правил и чтения с хозяином', () => {
        expect(violations([{...base, rules: 'n'}], new Map([[1, host]]))).toStrictEqual({G3: 1});
        expect(violations([{...base, reading: 'x'}], new Map([[1, host]]))).toStrictEqual({G4: 1});
    });

    test('легаси-выражение, севшее на wty-en-en (G11)', () => {
        expect(violations([base], new Map([[1, host]]), new Set(['dream']))).toStrictEqual({G11: 1});
        expect(violations([base], new Map([[1, {...host, dictionary: 'flibooster-en'}]]), new Set(['dream']))).toStrictEqual({});
    });
});

describe('verifyPairZips — приёмка по самому артефакту', () => {
    /**
     * Перепаковывает zip, пропуская каждую запись через правку.
     * @param {Buffer} data
     * @param {(name: string, text: string) => string} change
     * @returns {Promise<Buffer>}
     */
    async function rewriteZip(data, change) {
        const source = await JSZip.loadAsync(data);
        const target = new JSZip();
        for (const name of Object.keys(source.files)) {
            const file = source.file(name);
            if (file === null) { throw new Error(name); }
            target.file(name, change(name, await file.async('string')));
        }
        return await target.generateAsync({type: 'nodebuffer'});
    }

    /**
     * @returns {Promise<{host: Buffer, translation: Buffer}>}
     */
    async function builtZips() {
        const result = await build(createSourceFiles());
        return {
            host: fs.readFileSync(path.join(result.directory, 'wty-en-en.zip')),
            translation: fs.readFileSync(path.join(result.directory, 'flibooster-en-ru.zip')),
        };
    }

    test('собранная пара проходит приёмку', async () => {
        const {host, translation} = await builtZips();
        await expect(verifyPairZips(host, translation)).resolves.toMatchObject({pairedStamps: 2, host: {rows: 5}, translation: {rows: 2}});
    });

    test('isUpdatable в index.json — провал', async () => {
        const {host, translation} = await builtZips();
        const tampered = await rewriteZip(host, (name, text) => (name === 'index.json' ? text.replace('{', '{"isUpdatable": true,') : text));
        await expect(verifyPairZips(tampered, translation)).rejects.toThrow(/isUpdatable/);
    });

    test('разные revision — провал', async () => {
        const {host, translation} = await builtZips();
        const tampered = await rewriteZip(translation, (name, text) => (name === 'index.json' ? text.replace(/"revision": "[^"]+"/, '"revision": "other"') : text));
        await expect(verifyPairZips(host, tampered)).rejects.toThrow(/revision разошёлся/);
    });

    test('русский штамп на деинфлексию и штамп без хозяина — провал', async () => {
        const {host, translation} = await builtZips();
        // "dream" (штамп 1) переносится на "dreamt" (rowid 2, только массивы).
        const onDeinflection = await rewriteZip(translation, (name, text) => (name === 'index.json' ? text : text.replace('["dream","","v","v",0,', '["dreamt","","v","v",0,').replace(/,1,""\]/, ',2,""]')));
        await expect(verifyPairZips(host, onDeinflection)).rejects.toThrow(/G9/);
        const orphan = await rewriteZip(translation, (name, text) => (name === 'index.json' ? text : text.replace(/,4,""\]/, ',99,""]')));
        await expect(verifyPairZips(host, orphan)).rejects.toThrow(/П3/);
    });
});
