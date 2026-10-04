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
import {openDatabaseSnapshot, sweepStaleSnapshots} from '../../dev/dictionary-pair/sources.js';
import {parseJson} from '../../dev/json.js';
import {addJournal, createJournalDb, sensePath} from './fixture-db.js';

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
    fs.writeFileSync(path.join(directory, 'enrich.db'), 'x');
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
 * @param {() => void} fn
 */
function withTmpdir(root, fn) {
    const saved = process.env.TMPDIR;
    process.env.TMPDIR = root;
    try {
        fn();
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

describe('openDatabaseSnapshot — очистка', () => {
    /** @returns {string} */
    function createJournal() {
        const journalPath = path.join(workDir, 'enrich.db');
        const journal = createJournalDb(journalPath);
        addJournal(journal, {expression: 'a', dictRowid: 1, nodePath: sensePath(0), source: 'One.', translation: 'Один.'});
        journal.close();
        return journalPath;
    }

    test('dispose удаляет каталог, даже если db.close() бросил', () => {
        const journalPath = createJournal();
        const tmpRoot = path.join(workDir, 'tmp');
        fs.mkdirSync(tmpRoot);
        withTmpdir(tmpRoot, () => {
            const snapshot = openDatabaseSnapshot(journalPath, 'журнал', '--journal');
            expect(snapshotNames(tmpRoot)).toHaveLength(1);
            snapshot.db.close(); // повторный close() внутри dispose бросит
            expect(() => snapshot.dispose()).toThrow();
            expect(snapshotNames(tmpRoot)).toEqual([]);
        });
    });

    test.skipIf(process.getuid?.() === 0)('недоступный чужой снимок не роняет открытие', async () => {
        const journalPath = createJournal();
        const tmpRoot = path.join(workDir, 'tmp');
        fs.mkdirSync(tmpRoot);
        const locked = makeSnapshotDir(tmpRoot, `${PREFIX}locked`, String(await deadPid()), 10 * 60_000);
        fs.mkdirSync(path.join(locked, 'sub'));
        ageDirectory(locked, 10 * 60_000);
        fs.chmodSync(locked, 0o000);
        try {
            withTmpdir(tmpRoot, () => {
                openDatabaseSnapshot(journalPath, 'журнал', '--journal').dispose();
            });
        } finally {
            fs.chmodSync(locked, 0o700);
        }
    });

    test('открытие снимка подчищает снимки мёртвых прогонов', async () => {
        const journalPath = createJournal();
        const tmpRoot = path.join(workDir, 'tmp');
        fs.mkdirSync(tmpRoot);
        makeSnapshotDir(tmpRoot, `${PREFIX}dead`, String(await deadPid()), 0);
        withTmpdir(tmpRoot, () => {
            const snapshot = openDatabaseSnapshot(journalPath, 'журнал', '--journal');
            expect(snapshotNames(tmpRoot)).toHaveLength(1);
            expect(snapshotNames(tmpRoot)).not.toContain(`${PREFIX}dead`);
            snapshot.dispose();
        });
    });
});

describe('CLI не ставят обработчиков сигналов', () => {
    // Обработчик SIGINT в синхронной сборке откладывал бы Ctrl-C на десятки секунд.
    test.each([
        ['build-dictionaries.js', ['--dict', '/нет/dict.db', '--journal', '/нет/enrich.db']],
        ['check-dictionary-parity.js', []],
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
            env: {...process.env, FLIB_DICT_BASE_DB: '', FLIB_ENRICH_JOURNAL: ''},
            stdio: ['ignore', 'pipe', 'ignore'],
            cwd: fileURLToPath(new URL('../..', import.meta.url)),
        });
        let output = '';
        child.stdout.on('data', (chunk) => { output += String(chunk); });
        await new Promise((resolve) => { child.once('close', resolve); });
        expect(parseJson(output.trim().split('\n').pop() ?? '')).toEqual([0, 0]);
    });
});
