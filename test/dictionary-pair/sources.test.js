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

import {spawn} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import * as sources from '../../dev/dictionary-pair/sources.js';
import {DICT_ENV, openDatabaseBackupSnapshot, resolveSourcePaths, sweepStaleSnapshots} from '../../dev/dictionary-pair/sources.js';
import {parseJson} from '../../dev/json.js';
import {addTerm, createDictDb, wtyArticle} from './fixture-db.js';

const PREFIX = 'flib-dict-snapshot-';

/** @type {string} */
let workDir;

beforeEach(() => {
    workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'flib-dict-sources-'));
});

afterEach(() => {
    fs.rmSync(workDir, {recursive: true, force: true});
});

/**
 * @param {string} root
 * @returns {string[]}
 */
function snapshotNames(root) {
    return fs.readdirSync(root).filter((name) => name.startsWith(PREFIX));
}

/**
 * @param {string} root
 * @param {string} name
 * @param {string | null} owner содержимое owner.pid или null — без файла
 * @param {number} ageMs
 * @returns {string}
 */
function makeSnapshotDir(root, name, owner, ageMs) {
    const directory = path.join(root, name);
    fs.mkdirSync(directory);
    fs.writeFileSync(path.join(directory, 'dict_base.db'), 'x');
    if (owner !== null) { fs.writeFileSync(path.join(directory, 'owner.pid'), owner); }
    ageDirectory(directory, ageMs);
    return directory;
}

/**
 * Состарить каталог (создание вложенного элемента обновляет mtime).
 * @param {string} directory
 * @param {number} ageMs
 */
function ageDirectory(directory, ageMs) {
    const time = new Date(Date.now() - ageMs);
    fs.utimesSync(directory, time, time);
}

/**
 * Выполнить fn с os.tmpdir() == root (TMPDIR читается при каждом вызове).
 * @param {string} root
 * @param {() => Promise<void>|void} fn
 */
async function withTmpdir(root, fn) {
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = root;
    try {
        await fn();
    } finally {
        if (typeof saved === 'string') {
            process.env.TMPDIR = saved;
        } else {
            delete process.env.TMPDIR;
        }
    }
}

/**
 * pid заведомо мёртвого процесса: дождались завершения дочернего.
 * @returns {Promise<number>}
 */
async function deadPid() {
    const child = spawn(process.execPath, ['-e', '0']);
    const pid = child.pid ?? 0;
    await new Promise((resolve) => { child.once('exit', resolve); });
    return pid;
}

describe('resolveSourcePaths — путь к dict_base.db задаётся только явно', () => {
    test('ни флага, ни переменной — громкая ошибка с подсказкой', () => {
        expect(() => resolveSourcePaths({}, {})).toThrow(/--dict/);
        expect(() => resolveSourcePaths({}, {})).toThrow(new RegExp(DICT_ENV));
    });

    test('пустой флаг и пустая переменная — то же, что не заданы', () => {
        expect(() => resolveSourcePaths({dict: ''}, {[DICT_ENV]: ''})).toThrow(/--dict/);
    });

    test('берётся переменная окружения, путь абсолютный', () => {
        expect(resolveSourcePaths({}, {[DICT_ENV]: 'rel/dict_base.db'})).toStrictEqual({dictPath: path.resolve('rel/dict_base.db')});
    });

    test('флаг важнее переменной окружения', () => {
        const flag = path.join(workDir, 'flag.db');
        expect(resolveSourcePaths({dict: flag}, {[DICT_ENV]: path.join(workDir, 'env.db')})).toStrictEqual({dictPath: flag});
        expect(resolveSourcePaths({dict: flag}, {[DICT_ENV]: ''})).toStrictEqual({dictPath: flag});
    });

    test('машинного умолчания нет: файл на прежнем пути в домашнем каталоге не подхватывается', () => {
        // Прежнее умолчание — ~/.config/anki-connect-desktop/data/yomitan/dict_base.db.
        const legacy = path.join(workDir, '.config', 'anki-connect-desktop', 'data', 'yomitan', 'dict_base.db');
        fs.mkdirSync(path.dirname(legacy), {recursive: true});
        fs.writeFileSync(legacy, '');
        const savedHome = process.env.HOME;
        process.env.HOME = workDir;
        try {
            expect(os.homedir()).toBe(workDir);
            expect(() => resolveSourcePaths({}, {})).toThrow(/--dict/);
        } finally {
            if (typeof savedHome === 'string') {
                process.env.HOME = savedHome;
            } else {
                delete process.env.HOME;
            }
        }
        expect(Object.keys(sources).filter((name) => /DEFAULT|JOURNAL|RU_SOURCE/i.test(name))).toStrictEqual([]);
    });
});

describe('sweepStaleSnapshots — чистка брошенных снимков', () => {
    test('удаляет каталог мёртвого владельца, не трогает живого и чужие каталоги', async () => {
        const dead = makeSnapshotDir(workDir, `${PREFIX}dead`, String(await deadPid()), 0);
        const alive = makeSnapshotDir(workDir, `${PREFIX}alive`, String(process.pid), 0);
        const foreign = makeSnapshotDir(workDir, 'other-dir', String(await deadPid()), 0);
        expect(sweepStaleSnapshots(workDir)).toEqual([`${PREFIX}dead`]);
        expect(fs.existsSync(dead)).toBe(false);
        expect(fs.existsSync(alive)).toBe(true);
        expect(fs.existsSync(foreign)).toBe(true);
    });

    test('каталог без pid: свежий — не трогаем, старый — удаляем', () => {
        const fresh = makeSnapshotDir(workDir, `${PREFIX}fresh`, null, 1000);
        const garbageFresh = makeSnapshotDir(workDir, `${PREFIX}garbage-fresh`, 'не число', 1000);
        const old = makeSnapshotDir(workDir, `${PREFIX}old`, null, 10 * 60_000);
        const garbageOld = makeSnapshotDir(workDir, `${PREFIX}garbage-old`, 'не число', 10 * 60_000);
        expect(sweepStaleSnapshots(workDir).sort()).toEqual([`${PREFIX}garbage-old`, `${PREFIX}old`]);
        expect(fs.existsSync(fresh)).toBe(true);
        expect(fs.existsSync(garbageFresh)).toBe(true);
        expect(fs.existsSync(old)).toBe(false);
        expect(fs.existsSync(garbageOld)).toBe(false);
    });

    test('живой чужой владелец (EPERM, pid 1) не удаляется', () => {
        const foreign = makeSnapshotDir(workDir, `${PREFIX}pid1`, '1', 10 * 60_000);
        expect(sweepStaleSnapshots(workDir)).toEqual([]);
        expect(fs.existsSync(foreign)).toBe(true);
    });

    test.skipIf(process.getuid?.() === 0)('недоступный каталог пропускается, чистка не бросает', async () => {
        const locked = makeSnapshotDir(workDir, `${PREFIX}locked`, String(await deadPid()), 10 * 60_000);
        const inner = path.join(locked, 'sub');
        fs.mkdirSync(inner);
        ageDirectory(locked, 10 * 60_000);
        fs.chmodSync(locked, 0o000);
        try {
            expect(() => sweepStaleSnapshots(workDir)).not.toThrow();
        } finally {
            fs.chmodSync(locked, 0o700);
        }
        expect(fs.existsSync(inner)).toBe(true);
    });

    test('несуществующий корень — пустой результат, не исключение', () => {
        expect(sweepStaleSnapshots(path.join(workDir, 'нет-такого'))).toEqual([]);
    });
});

describe('снимок: источник не открылся — каталога снимка не остаётся', () => {
    test('backup(): ни каталога, ни созданного файла', async () => {
        const tmpRoot = path.join(workDir, 'tmp');
        fs.mkdirSync(tmpRoot);
        const missing = path.join(workDir, 'missing.db');
        await withTmpdir(tmpRoot, async () => {
            await expect(openDatabaseBackupSnapshot(missing, 'словарь', '--dict')).rejects.toThrow(/не найден/);
        });
        expect(snapshotNames(tmpRoot)).toEqual([]);
        expect(fs.existsSync(missing)).toBe(false);
    });
});

describe('openDatabaseBackupSnapshot — очистка', () => {
    /** @returns {string} */
    function createDict() {
        const dictPath = path.join(workDir, 'dict_base.db');
        const dict = createDictDb(dictPath);
        addTerm(dict, {dictionary: 'wty-en-en', expression: 'a', glossary: wtyArticle({senses: ['One.']})});
        dict.close();
        return dictPath;
    }

    test('dispose удаляет каталог, даже если db.close() бросил', async () => {
        const dictPath = createDict();
        const tmpRoot = path.join(workDir, 'tmp');
        fs.mkdirSync(tmpRoot);
        await withTmpdir(tmpRoot, async () => {
            const snapshot = await openDatabaseBackupSnapshot(dictPath, 'словарь', '--dict');
            expect(snapshotNames(tmpRoot)).toHaveLength(1);
            snapshot.db.close(); // повторный close() внутри dispose бросит
            expect(() => snapshot.dispose()).toThrow();
            expect(snapshotNames(tmpRoot)).toEqual([]);
        });
    });

    test.skipIf(process.getuid?.() === 0)('недоступный чужой снимок не роняет открытие', async () => {
        const dictPath = createDict();
        const tmpRoot = path.join(workDir, 'tmp');
        fs.mkdirSync(tmpRoot);
        const locked = makeSnapshotDir(tmpRoot, `${PREFIX}locked`, String(await deadPid()), 10 * 60_000);
        fs.mkdirSync(path.join(locked, 'sub'));
        ageDirectory(locked, 10 * 60_000);
        fs.chmodSync(locked, 0o000);
        try {
            await withTmpdir(tmpRoot, async () => {
                (await openDatabaseBackupSnapshot(dictPath, 'словарь', '--dict')).dispose();
            });
        } finally {
            fs.chmodSync(locked, 0o700);
        }
    });

    test('открытие снимка подчищает снимки мёртвых прогонов', async () => {
        const dictPath = createDict();
        const tmpRoot = path.join(workDir, 'tmp');
        fs.mkdirSync(tmpRoot);
        makeSnapshotDir(tmpRoot, `${PREFIX}dead`, String(await deadPid()), 0);
        await withTmpdir(tmpRoot, async () => {
            const snapshot = await openDatabaseBackupSnapshot(dictPath, 'словарь', '--dict');
            expect(snapshotNames(tmpRoot)).toHaveLength(1);
            expect(snapshotNames(tmpRoot)).not.toContain(`${PREFIX}dead`);
            snapshot.dispose();
        });
    });
});

describe('CLI не ставит обработчиков сигналов', () => {
    // Обработчик SIGINT в синхронной сборке откладывал бы Ctrl-C на десятки секунд.
    test.each([
        ['build-dictionaries.js', ['--dict', '/нет/dict.db']],
    ])('%s', async (cli, args) => {
        const cliUrl = new URL(`../../dev/bin/${cli}`, import.meta.url).href;
        const script = `
            process.argv = ['node', 'cli', ...${JSON.stringify(args)}];
            process.on('exit', () => {
                console.log(JSON.stringify([process.listenerCount('SIGINT'), process.listenerCount('SIGTERM')]));
            });
            await import(${JSON.stringify(cliUrl)});
        `;
        const child = spawn(process.execPath, ['--input-type=module', '-e', script], {
            env: {...process.env, [DICT_ENV]: '', HOME: workDir},
            stdio: ['ignore', 'pipe', 'ignore'],
            cwd: fileURLToPath(new URL('../..', import.meta.url)),
        });
        let output = '';
        child.stdout.on('data', (chunk) => { output += String(chunk); });
        await new Promise((resolve) => { child.once('close', resolve); });
        expect(parseJson(output.trim().split('\n').pop() ?? '')).toEqual([0, 0]);
    });
});
