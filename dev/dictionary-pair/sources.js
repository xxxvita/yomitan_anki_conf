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
    return new DatabaseSync(uri);
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
