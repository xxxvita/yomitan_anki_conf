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

// Где лежат данные anki_conf и как их открыть.
//
// ⚠️ Источники открываются ТОЛЬКО как `file:<path>?mode=ro`: журнал — единственная
// копия часов генерации, словарь — 1.6 ГБ, которые восстанавливать неоткуда.
// Опечатка в пути обязана стать громкой ошибкой, а не пустой базой: SQLite без
// mode=ro создал бы новый файл, и сборка выдала бы «статей 0» как норму.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

// ⚠️ ПУТИ ПО УМОЛЧАНИЮ — МАШИННО-ЗАВИСИМЫЕ: так данные лежат на машине владельца
// (2026-10). На любой другой машине их задают флагами или переменными окружения.
export const DEFAULT_DICT_PATH = path.join(os.homedir(), '.config/anki-connect-desktop/data/yomitan/dict_base.db');

export const DEFAULT_JOURNAL_PATH = path.join(os.homedir(), 'dict-enrich-20260828/enrich.db');

export const DICT_ENV = 'FLIB_DICT_BASE_DB';

export const JOURNAL_ENV = 'FLIB_ENRICH_JOURNAL';

/** Сколько ждать чужой блокировки, мс (столько же ждёт писатель anki_conf). */
export const BUSY_TIMEOUT_MS = 5000;

/**
 * @typedef {object} SourcePaths
 * @property {string} dictPath
 * @property {string} journalPath
 */

/**
 * Флаг важнее переменной окружения, переменная важнее умолчания.
 * @param {{dict?: string, journal?: string}} flags
 * @param {Record<string, string|undefined>} env
 * @returns {SourcePaths}
 */
export function resolveSourcePaths(flags, env) {
    return {
        dictPath: path.resolve(flags.dict ?? env[DICT_ENV] ?? DEFAULT_DICT_PATH),
        journalPath: path.resolve(flags.journal ?? env[JOURNAL_ENV] ?? DEFAULT_JOURNAL_PATH),
    };
}

/**
 * @param {string} filePath
 * @param {string} label
 * @param {string} hint как задать путь
 * @returns {DatabaseSync}
 * @throws {Error}
 */
export function openReadOnlyDatabase(filePath, label, hint) {
    /** @type {fs.Stats} */
    let stat;
    try {
        stat = fs.statSync(filePath);
    } catch (e) {
        throw new Error(`${label} не найден: ${filePath} (${e instanceof Error ? e.message : String(e)}). Путь задаётся ${hint}`);
    }
    if (!stat.isFile()) {
        throw new Error(`${label}: ${filePath} не файл. Путь задаётся ${hint}`);
    }
    // encodeURI не трогает «/», но экранирует «?» и «#», которые иначе стали бы
    // частью URI, а не имени файла.
    const uri = `file:${encodeURI(filePath).replaceAll('?', '%3F').replaceAll('#', '%23')}?mode=ro`;
    const db = new DatabaseSync(uri);
    // ⚠️ У журнала rollback-журнал: пока писатель (прогон перевода) коммитит, любой
    // наш SELECT без ожидания мгновенно падает «database is locked». Ждём, как и
    // писатель anki_conf, до 5 с.
    db.exec(`PRAGMA busy_timeout = ${BUSY_TIMEOUT_MS}`);
    return db;
}

/**
 * @typedef {object} DatabaseSnapshot
 * @property {DatabaseSync} db снимок, открытый только на чтение
 * @property {() => void} dispose закрыть и удалить снимок
 */

/**
 * Снимок базы во временный файл и чтение уже снимка.
 *
 * ⚠️ Зачем: журнал пишет живой прогон перевода. Сборке нужно ~160 тыс. запросов;
 * каждый мог бы упереться в коммит писателя, а держать одну длинную транзакцию
 * нельзя — с rollback-журналом она блокирует коммиты писателя дольше его
 * busy_timeout и роняет прогон. VACUUM INTO читает базу одной короткой
 * транзакцией (живой журнал 167 МБ — ~0.2 с), работает на соединении mode=ro и
 * даёт согласованное состояние: все статьи из одного момента.
 * @param {string} filePath
 * @param {string} label
 * @param {string} hint
 * @returns {DatabaseSnapshot}
 * @throws {Error}
 */
export function openDatabaseSnapshot(filePath, label, hint) {
    // До открытия источника: чистка «по возможности» не должна оставить его открытым.
    sweepStaleSnapshots();
    const source = openReadOnlyDatabase(filePath, label, hint);
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), SNAPSHOT_PREFIX));
    // Владелец снимка — этот процесс: по pid-файлу чистильщик отличает мёртвый
    // прогон от соседнего живого.
    fs.writeFileSync(path.join(directory, OWNER_FILE), String(process.pid));
    const snapshotPath = path.join(directory, path.basename(filePath));
    try {
        source.exec(`VACUUM INTO '${snapshotPath.replaceAll("'", "''")}'`);
    } catch (e) {
        fs.rmSync(directory, {recursive: true, force: true});
        throw new Error(`${label}: снимок ${filePath} не снят: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
        source.close();
    }
    /** @type {DatabaseSync} */
    let db;
    try {
        db = openReadOnlyDatabase(snapshotPath, `снимок: ${label}`, hint);
    } catch (e) {
        fs.rmSync(directory, {recursive: true, force: true});
        throw e;
    }
    const remove = () => {
        fs.rmSync(directory, {recursive: true, force: true});
    };
    return {
        db,
        dispose: () => {
            // ⚠️ Удаление не зависит от close(): упавший close не должен оставить
            // 167 МБ в tmpfs (то есть в ОЗУ).
            try {
                db.close();
            } finally {
                remove();
            }
        },
    };
}

/** Префикс каталогов снимков в os.tmpdir(). */
const SNAPSHOT_PREFIX = 'flib-dict-snapshot-';
/** Файл с pid владельца внутри каталога снимка. */
const OWNER_FILE = 'owner.pid';
/**
 * Каталог без pid-файла моложе этого возраста — снимок, который сосед только
 * создаёт (mkdtemp и запись pid не атомарны); его не трогаем.
 */
const UNOWNED_GRACE_MS = 60_000;

/**
 * Жив ли процесс с таким pid. EPERM значит «жив, но чужой».
 * @param {number} pid
 * @returns {boolean}
 */
function isProcessAlive(pid) {
    try {
        process.kill(pid, 0);
        return true;
    } catch (e) {
        return e instanceof Error && 'code' in e && e.code === 'EPERM';
    }
}

/**
 * Удалить снимки, брошенные мёртвыми прогонами (SIGKILL, потеря питания).
 *
 * Правило: каталог `flib-dict-snapshot-*` удаляется, только если pid из его
 * owner.pid не жив. Возраст как критерий хуже: сборка длится минуты, и любой
 * порог либо стирает снимок долгого живого прогона, либо оставляет мусор в
 * ОЗУ надолго. Сверка pid ошибается в безопасную сторону: переиспользованный pid оставит
 * мусор. Исключение: контейнер с общим /tmp, но своим пространством PID — там
 * чужая живая сборка выглядит мёртвой и её снимок может быть удалён. Каталог без читаемого pid удаляется
 * лишь по истечении UNOWNED_GRACE_MS.
 * @param {string} [root] где искать; по умолчанию os.tmpdir()
 * @returns {string[]} имена удалённых каталогов
 */
export function sweepStaleSnapshots(root = os.tmpdir()) {
    /** @type {string[]} */
    const removed = [];
    let names;
    try {
        names = fs.readdirSync(root);
    } catch {
        return removed;
    }
    for (const name of names) {
        if (!name.startsWith(SNAPSHOT_PREFIX)) { continue; }
        const directory = path.join(root, name);
        try {
            const pid = Number.parseInt(fs.readFileSync(path.join(directory, OWNER_FILE), 'utf8'), 10);
            if (Number.isInteger(pid) && pid > 0) {
                if (isProcessAlive(pid)) { continue; }
            } else if (Date.now() - fs.statSync(directory).mtimeMs < UNOWNED_GRACE_MS) {
                continue;
            }
        } catch {
            // pid-файла нет или он нечитаем: решает возраст каталога.
            try {
                if (Date.now() - fs.statSync(directory).mtimeMs < UNOWNED_GRACE_MS) { continue; }
            } catch {
                continue;
            }
        }
        try {
            fs.rmSync(directory, {recursive: true, force: true});
        } catch {
            // Чужой каталог без прав (общий /tmp): чистка по возможности, сборку не роняем.
            continue;
        }
        removed.push(name);
    }
    return removed;
}


/**
 * Размер и время файла — для build.json, не для отпечатка.
 * @param {string} filePath
 * @returns {{path: string, bytes: number, mtimeUtc: string}}
 */
export function describeFile(filePath) {
    const stat = fs.statSync(filePath);
    return {path: filePath, bytes: stat.size, mtimeUtc: stat.mtime.toISOString()};
}
