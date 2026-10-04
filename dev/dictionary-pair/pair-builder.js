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

// Сборка пары словарей для расширения: wty-en-en.zip (английский хозяин,
// с влитым flibooster-en) + flibooster-en-ru.zip (русские статьи из журнала).
// Контракт — docs/tasks/2026-09-08-dictionary-pair-for-flib-club-extension.md.
//
// ⚠️ REVISION — ОТПЕЧАТОК СОДЕРЖИМОГО, а не даты файла: у Go-сборщика дата
// бралась из mtime dict_base.db и сдвинулась 2026-09-19 без единого изменения
// данных. Здесь revision = `<строк в паре>-<max rowid хозяина>-<12 hex sha256>`,
// где sha256 берётся по канонической сериализации: TOOL_VERSION, затем
// заголовок и строки банков каждого словаря в порядке zip, по строке на ряд.
// Те же данные → тот же revision → тот же каталог; изменился один перевод —
// новый revision. TOOL_VERSION поднимается при любой смене формата артефакта,
// иначе тот же revision описал бы другие байты.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import {AUTHORED_DICTIONARY, SOURCE_DICTIONARY, TRANSLATION_DICTIONARY, buildRussianRows} from './enrich-transform.js';
import {parseJson} from '../json.js';
import {asRecord, readInteger, readText} from './sqlite-row.js';
import {verifyPairZips} from './pair-verify.js';
import {DICT_ENV, JOURNAL_ENV, describeFile, openDatabaseSnapshot, openReadOnlyDatabase} from './sources.js';

/** @typedef {import('./enrich-transform.js').TermRow} TermRow */
/** @typedef {import('./enrich-transform.js').TransformStats} TransformStats */

export const TOOL_VERSION = 'flib-dict-pair/1';

export const HOST_TITLE = SOURCE_DICTIONARY;

export const BANK_SIZE = 10000;

const HOST_DICTIONARIES = [SOURCE_DICTIONARY, AUTHORED_DICTIONARY];
// Дата всех записей zip. JSZip пишет DOS-время по UTC-полям даты, поэтому
// результат не зависит от часового пояса машины.
const ZIP_DATE = new Date(Date.UTC(1980, 0, 1, 0, 0, 0));
const ZIP_OPTIONS = /** @type {const} */ ({compression: 'DEFLATE', compressionOptions: {level: 6}});

/**
 * Хозяин, на которого указывает русский штамп.
 * @typedef {object} HostInfo
 * @property {string} expression
 * @property {string} rules
 * @property {string} dictionary
 * @property {boolean} hasNonArrayElement в glossary есть хоть один не-массив (иначе это деинфлексия/редирект)
 */

/**
 * @typedef {object} GuardResult
 * @property {string} id
 * @property {string} title
 * @property {number} violations
 * @property {string[]} examples
 */

/**
 * @typedef {object} PairSide
 * @property {string} title
 * @property {string} file
 * @property {number} rows
 * @property {Buffer[]} banks
 */

/**
 * @typedef {object} CollectedPair
 * @property {string} revision
 * @property {PairSide & {rowsByDictionary: Record<string, number>, maxRowid: number}} host
 * @property {PairSide} translation
 * @property {TransformStats} transform
 * @property {GuardResult[]} guards
 */

/**
 * @typedef {object} BuildResult
 * @property {'built'|'up-to-date'} status
 * @property {string} revision
 * @property {string} directory
 * @property {Record<string, unknown>} buildJson
 */

/**
 * Строка term-bank v3: ровно 8 элементов; glossary — готовый JSON-текст.
 * @param {TermRow} row
 * @returns {string}
 */
export function serializeBankRow(row) {
    return `[${JSON.stringify(row.expression)},${JSON.stringify(row.reading)},${JSON.stringify(row.definitionTags)},${JSON.stringify(row.rules)},${row.score},${row.glossary},${row.sequence},${JSON.stringify(row.termTags)}]`;
}

/**
 * @param {string[]} rows
 * @returns {Buffer}
 */
function bankBuffer(rows) {
    return Buffer.from(`[${rows.join(',')}]`, 'utf8');
}

/**
 * @param {string} title
 * @param {string} revision
 * @param {boolean} sequenced
 * @param {string} targetLanguage
 * @returns {string}
 */
function indexJson(title, revision, sequenced, targetLanguage) {
    /** @type {Record<string, unknown>} */
    const index = {title, format: 3, revision};
    // `sequenced` — только у английского словаря (контракт §5.6). Полей
    // isUpdatable/indexUrl/downloadUrl нет НАМЕРЕННО (§5.5): автообновление
    // заменило бы словарь апстримным и разорвало пару.
    if (sequenced) { index.sequenced = true; }
    index.author = 'Flibooster';
    index.description = `Flib-club dictionary pair, build ${revision}`;
    index.sourceLanguage = 'en';
    index.targetLanguage = targetLanguage;
    return `${JSON.stringify(index, null, 2)}\n`;
}

/**
 * Разобранный glossary — массив? И есть ли в нём не-массив (G5, G9).
 * @param {string} glossary
 * @returns {{valid: boolean, hasNonArrayElement: boolean}}
 */
function inspectGlossary(glossary) {
    /** @type {unknown} */
    let parsed;
    try {
        parsed = parseJson(glossary);
    } catch (e) {
        return {valid: false, hasNonArrayElement: false};
    }
    if (!Array.isArray(parsed)) { return {valid: false, hasNonArrayElement: false}; }
    return {valid: true, hasNonArrayElement: parsed.some((item) => !Array.isArray(item))};
}

/**
 * Инварианты пары по русским строкам и их хозяевам. Номера — как у сторожей
 * Go-сборщика (anki_conf internal/dictpair/guards.go), чтобы отчёты сравнивались.
 * @param {TermRow[]} russian
 * @param {Map<number, HostInfo>} hosts хозяева по rowid; достаточно тех, на кого есть штамп
 * @param {Set<string>} legacyExpressions выражения журнала с dict_rowid = 0
 * @returns {GuardResult[]}
 */
export function checkPairGuards(russian, hosts, legacyExpressions) {
    /** @type {Map<string, GuardResult>} */
    const guards = new Map();
    const define = (/** @type {string} */ id, /** @type {string} */ title) => {
        guards.set(id, {id, title, violations: 0, examples: []});
    };
    define('G1', 'каждый русский штамп = rowid строки-хозяина');
    define('G2', 'русские штампы уникальны');
    define('G3', 'expression и rules русской строки равны хозяйским');
    define('G4', "русский reading — '' или expression");
    define('G5', 'glossary русских строк — JSON-массив');
    define('G7', 'русский штамп >= 1');
    define('G9', 'хозяин русской строки не деинфлексия (есть элемент glossary не-массив)');
    define('G11', 'легаси-выражения журнала не садятся на wty-en-en');
    const fail = (/** @type {string} */ id, /** @type {TermRow} */ row) => {
        const guard = guards.get(id);
        if (typeof guard === 'undefined') { throw new Error(`неизвестный сторож ${id}`); }
        ++guard.violations;
        if (guard.examples.length < 5) { guard.examples.push(`${row.sequence}:${row.expression}`); }
    };

    /** @type {Set<number>} */
    const seen = new Set();
    for (const row of russian) {
        if (seen.has(row.sequence)) { fail('G2', row); }
        seen.add(row.sequence);
        if (row.sequence < 1) { fail('G7', row); }
        if (row.reading !== '' && row.reading !== row.expression) { fail('G4', row); }
        if (!inspectGlossary(row.glossary).valid) { fail('G5', row); }
        const host = hosts.get(row.sequence);
        if (typeof host === 'undefined') {
            fail('G1', row);
            continue;
        }
        if (host.expression !== row.expression || host.rules !== row.rules) { fail('G3', row); }
        if (!host.hasNonArrayElement) { fail('G9', row); }
        if (legacyExpressions.has(row.expression) && host.dictionary === SOURCE_DICTIONARY) { fail('G11', row); }
    }
    return [...guards.values()];
}

/**
 * Читает всё нужное из источников и собирает банки обеих сторон в памяти.
 * Английские строки читаются страницами по rowid — 1.9 млн строк целиком не
 * держатся.
 * @param {import('node:sqlite').DatabaseSync} dict
 * @param {import('node:sqlite').DatabaseSync} journal
 * @returns {CollectedPair}
 * @throws {Error}
 */
export function collectPair(dict, journal) {
    const transform = buildRussianRows(dict, journal);
    const russian = transform.rows;
    if (russian.length === 0) {
        throw new Error('в журнале нет ни одной готовой русской статьи — пустой словарь не собирается');
    }
    const stamps = new Set(russian.map((row) => row.sequence));

    const hash = crypto.createHash('sha256');
    hash.update(`${TOOL_VERSION}\n${HOST_TITLE}\n`);

    /** @type {Map<number, HostInfo>} */
    const hosts = new Map();
    /** @type {Record<string, number>} */
    const rowsByDictionary = Object.fromEntries(HOST_DICTIONARIES.map((title) => [title, 0]));
    /** @type {Buffer[]} */
    const hostBanks = [];
    /** @type {string[]} */
    let pending = [];
    let hostRows = 0;
    let maxRowid = 0;
    let invalidHostGlossaries = 0;
    /** @type {string[]} */
    const invalidExamples = [];

    const page = dict.prepare(`
        SELECT rowid AS rowid, dictionary, expression, reading, definition_tags, rules, score, glossary, term_tags
        FROM terms WHERE dictionary IN (?, ?) AND rowid > ? ORDER BY rowid LIMIT ${BANK_SIZE}
    `);
    for (;;) {
        const batch = page.all(SOURCE_DICTIONARY, AUTHORED_DICTIONARY, maxRowid);
        if (batch.length === 0) { break; }
        for (const raw of batch) {
            const context = 'словарь: хозяин';
            const r = asRecord(raw, context);
            const rowid = readInteger(r, 'rowid', context);
            const dictionary = readText(r, 'dictionary', context);
            /** @type {TermRow} */
            const row = {
                expression: readText(r, 'expression', context),
                reading: readText(r, 'reading', context),
                definitionTags: readText(r, 'definition_tags', context),
                rules: readText(r, 'rules', context),
                score: readInteger(r, 'score', context),
                glossary: readText(r, 'glossary', context),
                // Штамп хозяина — его rowid; колонка sequence в dict_base.db не используется.
                sequence: rowid,
                termTags: readText(r, 'term_tags', context),
            };
            const inspected = inspectGlossary(row.glossary);
            if (!inspected.valid) {
                ++invalidHostGlossaries;
                if (invalidExamples.length < 5) { invalidExamples.push(`${rowid}:${row.expression}`); }
            }
            if (stamps.has(rowid)) {
                hosts.set(rowid, {expression: row.expression, rules: row.rules, dictionary, hasNonArrayElement: inspected.hasNonArrayElement});
            }
            const serialized = serializeBankRow(row);
            hash.update(`${serialized}\n`);
            pending.push(serialized);
            if (pending.length === BANK_SIZE) {
                hostBanks.push(bankBuffer(pending));
                pending = [];
            }
            rowsByDictionary[dictionary] = (rowsByDictionary[dictionary] ?? 0) + 1;
            ++hostRows;
            maxRowid = rowid;
        }
    }
    if (pending.length > 0) { hostBanks.push(bankBuffer(pending)); }
    if (hostRows === 0) {
        throw new Error(`в словаре нет строк ${HOST_DICTIONARIES.join(', ')}`);
    }

    hash.update(`${TRANSLATION_DICTIONARY}\n`);
    /** @type {Buffer[]} */
    const translationBanks = [];
    for (let i = 0; i < russian.length; i += BANK_SIZE) {
        const serialized = russian.slice(i, i + BANK_SIZE).map((row) => serializeBankRow(row));
        for (const line of serialized) { hash.update(`${line}\n`); }
        translationBanks.push(bankBuffer(serialized));
    }

    const guards = checkPairGuards(russian, hosts, transform.legacyExpressions);
    guards.push({id: 'G5h', title: 'glossary хозяев — JSON-массив', violations: invalidHostGlossaries, examples: invalidExamples});
    const failed = guards.filter((guard) => guard.violations > 0);
    if (failed.length > 0) {
        throw new Error(`пара нарушает контракт:\n${failed.map((g) => `  ${g.id} (${g.title}): ${g.violations}, например ${g.examples.join('; ')}`).join('\n')}`);
    }

    const revision = `${hostRows + russian.length}-${maxRowid}-${hash.digest('hex').slice(0, 12)}`;
    return {
        revision,
        host: {title: HOST_TITLE, file: `${HOST_TITLE}.zip`, rows: hostRows, banks: hostBanks, rowsByDictionary, maxRowid},
        translation: {title: TRANSLATION_DICTIONARY, file: `${TRANSLATION_DICTIONARY}.zip`, rows: russian.length, banks: translationBanks},
        transform: transform.stats,
        guards,
    };
}

/**
 * Детерминированный zip: фиксированные дата, порядок записей и уровень сжатия.
 * @param {PairSide} side
 * @param {string} revision
 * @param {boolean} sequenced
 * @param {string} targetLanguage
 * @returns {Promise<Buffer>}
 */
async function createZip(side, revision, sequenced, targetLanguage) {
    const zip = new JSZip();
    zip.file('index.json', indexJson(side.title, revision, sequenced, targetLanguage), {date: ZIP_DATE, ...ZIP_OPTIONS});
    for (const [i, bank] of side.banks.entries()) {
        zip.file(`term_bank_${i + 1}.json`, bank, {date: ZIP_DATE, binary: true, ...ZIP_OPTIONS});
    }
    return await zip.generateAsync({type: 'nodebuffer', platform: 'DOS', ...ZIP_OPTIONS});
}

/**
 * @param {Buffer} data
 * @returns {string}
 */
function sha256(data) {
    return crypto.createHash('sha256').update(data).digest('hex');
}

/**
 * @param {string} filePath
 * @param {Buffer} data
 */
function writeFileDurably(filePath, data) {
    const fd = fs.openSync(filePath, 'w');
    try {
        fs.writeSync(fd, data);
        fs.fsyncSync(fd);
    } finally {
        fs.closeSync(fd);
    }
}

/**
 * Одна команда: источники → `<outRoot>/<revision>/{wty-en-en.zip, flibooster-en-ru.zip, build.json}`.
 * Каталог появляется только целиком (запись во временный и rename). Если
 * каталог этой ревизии уже есть, новые zip обязаны совпасть с ним побайтно.
 * @param {{dictPath: string, journalPath: string, outRoot: string}} options
 * @returns {Promise<BuildResult>}
 */
export async function buildDictionaryPair({dictPath, journalPath, outRoot}) {
    const startedAt = new Date();
    const dict = openReadOnlyDatabase(dictPath, 'словарь dict_base.db', `флагом --dict или ${DICT_ENV}`);
    /** @type {import('./sources.js').DatabaseSnapshot} */
    let journal;
    try {
        // Журнал читается со снимка: его может писать живой прогон перевода.
        journal = openDatabaseSnapshot(journalPath, 'журнал enrich.db', `флагом --journal или ${JOURNAL_ENV}`);
    } catch (e) {
        dict.close();
        throw e;
    }
    /** @type {CollectedPair} */
    let pair;
    try {
        pair = collectPair(dict, journal.db);
    } finally {
        dict.close();
        journal.dispose();
    }

    const hostZip = await createZip(pair.host, pair.revision, true, 'en');
    const translationZip = await createZip(pair.translation, pair.revision, false, 'ru');
    // Приёмка по самим zip ДО записи: на диск не попадает пара, которую
    // расширение не спарит.
    const verification = await verifyPairZips(hostZip, translationZip);
    if (verification.host.rows !== pair.host.rows || verification.translation.rows !== pair.translation.rows || verification.pairedStamps !== pair.translation.rows) {
        throw new Error(`zip не совпали с собранным: ${JSON.stringify(verification)}`);
    }
    const describeSide = (/** @type {PairSide} */ side, /** @type {Buffer} */ zip) => ({
        title: side.title,
        file: side.file,
        revision: pair.revision,
        rows: side.rows,
        banks: side.banks.length,
        bytes: zip.length,
        sha256: sha256(zip),
    });
    /** @type {Record<string, unknown>} */
    const buildJson = {
        tool: TOOL_VERSION,
        revision: pair.revision,
        sources: {dict: describeFile(dictPath), journal: describeFile(journalPath)},
        host: {...describeSide(pair.host, hostZip), rowsByDictionary: pair.host.rowsByDictionary, maxRowid: pair.host.maxRowid},
        translation: describeSide(pair.translation, translationZip),
        transform: pair.transform,
        guards: pair.guards.map(({id, title, violations}) => ({id, title, violations})),
        artifactVerification: verification,
        startedAt: startedAt.toISOString(),
        finishedAt: new Date().toISOString(),
    };

    fs.mkdirSync(outRoot, {recursive: true});
    const directory = path.join(outRoot, pair.revision);
    const partial = path.join(outRoot, `.${pair.revision}.partial-${process.pid}`);
    fs.rmSync(partial, {recursive: true, force: true});
    fs.mkdirSync(partial);
    try {
        writeFileDurably(path.join(partial, pair.host.file), hostZip);
        writeFileDurably(path.join(partial, pair.translation.file), translationZip);
        writeFileDurably(path.join(partial, 'build.json'), Buffer.from(`${JSON.stringify(buildJson, null, 2)}\n`, 'utf8'));
        if (fs.existsSync(directory)) {
            // Та же ревизия = то же содержимое: zip обязаны совпасть с уже лежащими.
            for (const [file, data] of [[pair.host.file, hostZip], [pair.translation.file, translationZip]]) {
                const existing = path.join(directory, /** @type {string} */ (file));
                if (!fs.existsSync(existing) || sha256(fs.readFileSync(existing)) !== sha256(/** @type {Buffer} */ (data))) {
                    throw new Error(`${existing}: каталог ревизии ${pair.revision} уже есть, но его ${String(file)} отличается от собранного — сборщик недетерминирован или TOOL_VERSION не поднят`);
                }
            }
            return {status: 'up-to-date', revision: pair.revision, directory, buildJson};
        }
        fs.renameSync(partial, directory);
        return {status: 'built', revision: pair.revision, directory, buildJson};
    } finally {
        fs.rmSync(partial, {recursive: true, force: true});
    }
}
