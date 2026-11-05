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
// с влитым flibooster-en) + flibooster-en-ru.zip (русские статьи).
//
// Откуда русские статьи (--ru-source, sources.js):
// - `dict` (умолчание): строки flibooster-en-ru из снимка dict_base.db — уже
//   готовый выложенный русский текст; журнал не открывается, трансформ
//   журнала не запускается. Сироты (штамп без хозяина) сохраняются: расширение
//   показывает их отдельно (translation-pairing.js);
// - `journal`: журнал enrich.db через порт Go-выкладки (enrich-transform.js).
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
//
// Только в режиме journal: рядом с build.json — два построчных списка выражений (вход точечного
// перевода, `lexicon-dict-enrich -list`): STALE_AUTHORED_FILE — сочинённые
// статьи, чей русский пропущен как устаревший, UNTRANSLATED_AUTHORED_FILE —
// сочинённые без единого готового перевода. В ревизию они не входят: это не
// артефакт расширения, а отчёт о нём. Пустой список — пустой файл.

import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import JSZip from 'jszip';
import {AUTHORED_DICTIONARY, SOURCE_DICTIONARY, TRANSLATION_DICTIONARY, buildRussianRows, listUntranslatedAuthored} from './enrich-transform.js';
import {compareUtf8} from './go-text.js';
import {parseJson} from '../json.js';
import {asRecord, readInteger, readText} from './sqlite-row.js';
import {verifyPairZips} from './pair-verify.js';
import {DICT_ENV, JOURNAL_ENV, describeFile, openDatabaseBackupSnapshot, openDatabaseSnapshot, openReadOnlyDatabase} from './sources.js';

/** @typedef {import('./enrich-transform.js').TermRow} TermRow */
/** @typedef {import('./enrich-transform.js').TransformStats} TransformStats */
/** @typedef {import('./sources.js').RuSource} RuSource */

export const TOOL_VERSION = 'flib-dict-pair/2';

/** Куда ведёт источник текста; поле `url` обоих словарей. */
export const DICTIONARY_SOURCE_URL = 'https://en.wiktionary.org/';

const CC_BY_SA = 'CC BY-SA 4.0 (https://creativecommons.org/licenses/by-sa/4.0/)';

// ⚠️ Текст Викисловаря распространяется по CC BY-SA: авторство, лицензия и
// пометка об изменениях обязательны для обоих словарей, включая русский: его
// статьи содержат текст Викисловаря и переводят его. Приёмка (pair-verify.js)
// не пропускает пару без этих полей.
export const HOST_ATTRIBUTION = `Text from Wiktionary (${DICTIONARY_SOURCE_URL}) by Wiktionary contributors, licensed under ${CC_BY_SA}. Converted, filtered and edited for Flib-club, with some added entries. Distributed under the same license.`;

export const TRANSLATION_ATTRIBUTION = `Based on text from Wiktionary (${DICTIONARY_SOURCE_URL}) by Wiktionary contributors, licensed under ${CC_BY_SA}. Translated into Russian, adapted and edited for Flib-club. Distributed under the same license.`;

export const HOST_TITLE = SOURCE_DICTIONARY;

export const BANK_SIZE = 10000;

export const STALE_AUTHORED_FILE = 'stale-authored-translations.txt';

export const UNTRANSLATED_AUTHORED_FILE = 'untranslated-authored.txt';

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
 * Отчёт режима journal: трансформ и списки кандидатов на перевод.
 * @typedef {object} JournalReport
 * @property {TransformStats} transform
 * @property {string[]} staleAuthored сочинённые выражения, чей русский пропущен как устаревший
 * @property {string[]} untranslatedAuthored сочинённые выражения без единого готового перевода
 */

/**
 * Отчёт режима dict: что лежало в источнике.
 * @typedef {object} DictReport
 * @property {number} sourceRows строк flibooster-en-ru в снимке (сверяется с выложенными)
 * @property {string|null} sourceRevision dictionaries.revision выкладки anki_conf — откуда этот русский
 */

/**
 * @typedef {object} CollectedPair
 * @property {string} revision
 * @property {RuSource} ruSource
 * @property {PairSide & {rowsByDictionary: Record<string, number>, maxRowid: number}} host
 * @property {PairSide & {pairedStamps: number, orphanStamps: number}} translation
 * @property {GuardResult[]} guards
 * @property {JournalReport|null} journal только в режиме journal
 * @property {DictReport|null} dict только в режиме dict
 */

/**
 * Русская сторона до сборки банков.
 * @typedef {object} RussianSide
 * @property {TermRow[]} rows отсортированы: выражение побайтно, затем штамп
 * @property {Set<string>|null} legacyExpressions для G11; null — сторож не применим
 * @property {boolean} allowOrphans штамп без хозяина допустим (сирота)
 * @property {JournalReport|null} journal
 * @property {DictReport|null} dict
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
 * @param {string} attribution
 * @returns {string}
 */
function indexJson(title, revision, sequenced, targetLanguage, attribution) {
    /** @type {Record<string, unknown>} */
    const index = {title, format: 3, revision};
    // `sequenced` — только у английского словаря (контракт §5.6). Полей
    // isUpdatable/indexUrl/downloadUrl нет НАМЕРЕННО (§5.5): автообновление
    // заменило бы словарь апстримным и разорвало пару.
    if (sequenced) { index.sequenced = true; }
    index.author = 'Flibooster';
    index.attribution = attribution;
    index.url = DICTIONARY_SOURCE_URL;
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
 *
 * В режиме dict G1 не сторож: русская строка без хозяина — сирота, которую
 * расширение показывает отдельно; G11 не применим (журнала нет).
 * @param {TermRow[]} russian
 * @param {Map<number, HostInfo>} hosts хозяева по rowid; достаточно тех, на кого есть штамп
 * @param {Set<string>|null} legacyExpressions выражения журнала с dict_rowid = 0; null — без G11
 * @param {{allowOrphans?: boolean}} [options]
 * @returns {GuardResult[]}
 */
export function checkPairGuards(russian, hosts, legacyExpressions, {allowOrphans = false} = {}) {
    /** @type {Map<string, GuardResult>} */
    const guards = new Map();
    const define = (/** @type {string} */ id, /** @type {string} */ title) => {
        guards.set(id, {id, title, violations: 0, examples: []});
    };
    if (!allowOrphans) { define('G1', 'каждый русский штамп = rowid строки-хозяина'); }
    define('G2', 'русские штампы уникальны');
    define('G3', 'expression и rules русской строки равны хозяйским');
    define('G4', "русский reading — '' или expression");
    define('G5', 'glossary русских строк — JSON-массив');
    define('G7', 'русский штамп >= 1');
    define('G9', 'хозяин русской строки не деинфлексия (есть элемент glossary не-массив)');
    if (legacyExpressions !== null) { define('G11', 'легаси-выражения журнала не садятся на wty-en-en'); }
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
            if (!allowOrphans) { fail('G1', row); }
            continue;
        }
        if (host.expression !== row.expression || host.rules !== row.rules) { fail('G3', row); }
        if (!host.hasNonArrayElement) { fail('G9', row); }
        if (legacyExpressions !== null && legacyExpressions.has(row.expression) && host.dictionary === SOURCE_DICTIONARY) { fail('G11', row); }
    }
    return [...guards.values()];
}

/** Колонки terms, из которых строится строка банка (обе стороны). */
const TERM_COLUMNS = 'rowid AS rowid, dictionary, expression, reading, definition_tags, rules, score, glossary, sequence, term_tags';

/**
 * Строка terms → строка банка. Единый путь для обеих сторон.
 * ⚠️ Штамп у сторон разный: у хозяина — его rowid (колонка sequence у
 * английских строк dict_base.db равна 0 и не используется), у русской
 * строки — колонка sequence, то есть rowid английского хозяина.
 * @param {unknown} raw
 * @param {'rowid'|'sequence'} stamp
 * @param {string} context
 * @returns {{rowid: number, dictionary: string, row: TermRow}}
 */
function readTermRow(raw, stamp, context) {
    const r = asRecord(raw, context);
    const rowid = readInteger(r, 'rowid', context);
    return {
        rowid,
        dictionary: readText(r, 'dictionary', context),
        row: {
            expression: readText(r, 'expression', context),
            reading: readText(r, 'reading', context),
            definitionTags: readText(r, 'definition_tags', context),
            rules: readText(r, 'rules', context),
            score: readInteger(r, 'score', context),
            glossary: readText(r, 'glossary', context),
            sequence: stamp === 'rowid' ? rowid : readInteger(r, 'sequence', context),
            termTags: readText(r, 'term_tags', context),
        },
    };
}

/**
 * Русская сторона из dict_base.db: строки flibooster-en-ru как есть.
 * Трансформ журнала НЕ применяется — это уже выложенный anki_conf русский текст.
 * @param {import('node:sqlite').DatabaseSync} dict снимок dict_base.db
 * @returns {RussianSide}
 * @throws {Error}
 */
function readRussianRowsFromDict(dict) {
    const context = `словарь: ${TRANSLATION_DICTIONARY}`;
    const rows = dict.prepare(`SELECT ${TERM_COLUMNS} FROM terms WHERE dictionary = ?`).all(TRANSLATION_DICTIONARY)
        .map((raw) => readTermRow(raw, 'sequence', context).row);
    // Порядок как у выкладки из журнала и не зависит от rowid в базе.
    rows.sort((a, b) => compareUtf8(a.expression, b.expression) || a.sequence - b.sequence);
    const count = asRecord(dict.prepare('SELECT count(*) AS n FROM terms WHERE dictionary = ?').get(TRANSLATION_DICTIONARY), context);
    const meta = dict.prepare('SELECT revision FROM dictionaries WHERE title = ?').get(TRANSLATION_DICTIONARY);
    return {
        rows,
        legacyExpressions: null,
        allowOrphans: true,
        journal: null,
        dict: {
            sourceRows: readInteger(count, 'n', context),
            sourceRevision: typeof meta === 'undefined' ? null : readText(asRecord(meta, context), 'revision', context),
        },
    };
}

/**
 * Русская сторона из журнала (порт Go-выкладки) — прежний режим.
 * @param {import('node:sqlite').DatabaseSync} dict
 * @param {import('node:sqlite').DatabaseSync} journal
 * @returns {RussianSide}
 * @throws {Error}
 */
function readRussianRowsFromJournal(dict, journal) {
    const transform = buildRussianRows(dict, journal);
    if (transform.rows.length === 0) {
        throw new Error('в журнале нет ни одной готовой русской статьи — пустой словарь не собирается');
    }
    return {
        rows: transform.rows,
        legacyExpressions: transform.legacyExpressions,
        allowOrphans: false,
        journal: {transform: transform.stats, staleAuthored: transform.staleAuthored, untranslatedAuthored: listUntranslatedAuthored(dict, journal)},
        dict: null,
    };
}

/**
 * Выложено ровно столько русских строк, сколько лежит в источнике (режим dict).
 * @param {{sourceRows: number, emitted: number, inZip: number}} counts
 * @throws {Error}
 */
export function checkRussianRowCount({sourceRows, emitted, inZip}) {
    if (emitted !== sourceRows || inZip !== sourceRows) {
        throw new Error(`число русских строк разошлось: в источнике ${sourceRows}, собрано ${emitted}, в zip ${inZip}`);
    }
}

/**
 * Читает всё нужное из источников и собирает банки обеих сторон в памяти.
 * Английские строки читаются страницами по rowid — 1.9 млн строк целиком не
 * держатся.
 * @param {import('node:sqlite').DatabaseSync} dict в режиме dict — снимок, из него же и русская сторона
 * @param {{ruSource: 'dict'}|{ruSource: 'journal', journal: import('node:sqlite').DatabaseSync}} source
 * @returns {CollectedPair}
 * @throws {Error}
 */
export function collectPair(dict, source) {
    const side = source.ruSource === 'dict' ? readRussianRowsFromDict(dict) : readRussianRowsFromJournal(dict, source.journal);
    const russian = side.rows;
    if (russian.length === 0) {
        throw new Error(`в dict_base.db нет ни одной строки ${TRANSLATION_DICTIONARY} — пустой словарь не собирается`);
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
        SELECT ${TERM_COLUMNS}
        FROM terms WHERE dictionary IN (?, ?) AND rowid > ? ORDER BY rowid LIMIT ${BANK_SIZE}
    `);
    for (;;) {
        const batch = page.all(SOURCE_DICTIONARY, AUTHORED_DICTIONARY, maxRowid);
        if (batch.length === 0) { break; }
        for (const raw of batch) {
            const {rowid, dictionary, row} = readTermRow(raw, 'rowid', 'словарь: хозяин');
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

    const guards = checkPairGuards(russian, hosts, side.legacyExpressions, {allowOrphans: side.allowOrphans});
    guards.push({id: 'G5h', title: 'glossary хозяев — JSON-массив', violations: invalidHostGlossaries, examples: invalidExamples});
    const failed = guards.filter((guard) => guard.violations > 0);
    if (failed.length > 0) {
        throw new Error(`пара нарушает контракт:\n${failed.map((g) => `  ${g.id} (${g.title}): ${g.violations}, например ${g.examples.join('; ')}`).join('\n')}`);
    }

    const revision = `${hostRows + russian.length}-${maxRowid}-${hash.digest('hex').slice(0, 12)}`;
    let orphanStamps = 0;
    for (const row of russian) {
        if (!hosts.has(row.sequence)) { ++orphanStamps; }
    }
    return {
        revision,
        ruSource: source.ruSource,
        host: {title: HOST_TITLE, file: `${HOST_TITLE}.zip`, rows: hostRows, banks: hostBanks, rowsByDictionary, maxRowid},
        translation: {
            title: TRANSLATION_DICTIONARY,
            file: `${TRANSLATION_DICTIONARY}.zip`,
            rows: russian.length,
            banks: translationBanks,
            pairedStamps: russian.length - orphanStamps,
            orphanStamps,
        },
        guards,
        journal: side.journal,
        dict: side.dict,
    };
}

/**
 * Построчный список выражений: UTF-8, по выражению в строке, `\n` после каждой.
 * @param {string[]} expressions
 * @param {string} file
 * @returns {Buffer}
 * @throws {Error}
 */
export function expressionListBuffer(expressions, file) {
    for (const expression of expressions) {
        if (/[\r\n]/.test(expression)) {
            throw new Error(`${file}: выражение ${JSON.stringify(expression)} содержит перевод строки — построчный список его разорвал бы`);
        }
    }
    return Buffer.from(expressions.map((expression) => `${expression}\n`).join(''), 'utf8');
}

/**
 * Детерминированный zip: фиксированные дата, порядок записей и уровень сжатия.
 * @param {PairSide} side
 * @param {string} revision
 * @param {boolean} sequenced
 * @param {string} targetLanguage
 * @param {string} attribution
 * @returns {Promise<Buffer>}
 */
async function createZip(side, revision, sequenced, targetLanguage, attribution) {
    const zip = new JSZip();
    zip.file('index.json', indexJson(side.title, revision, sequenced, targetLanguage, attribution), {date: ZIP_DATE, ...ZIP_OPTIONS});
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
 * Источники → собранная пара. Режим dict читает всё (и английскую, и русскую
 * сторону) из одного снимка dict_base.db; журнал не открывается вовсе.
 * @param {{dictPath: string, journalPath?: string, ruSource: RuSource}} options
 * @returns {Promise<CollectedPair>}
 * @throws {Error}
 */
async function collectFromSources({dictPath, journalPath, ruSource}) {
    const dictHint = `флагом --dict или ${DICT_ENV}`;
    if (ruSource === 'dict') {
        // Снимок, а не живой файл: его может держать настольное приложение.
        const snapshot = await openDatabaseBackupSnapshot(dictPath, 'словарь dict_base.db', dictHint);
        try {
            return collectPair(snapshot.db, {ruSource});
        } finally {
            snapshot.dispose();
        }
    }
    if (typeof journalPath !== 'string') {
        throw new Error(`--ru-source journal: не задан путь журнала (флагом --journal или ${JOURNAL_ENV})`);
    }
    const dict = openReadOnlyDatabase(dictPath, 'словарь dict_base.db', dictHint);
    /** @type {import('./sources.js').DatabaseSnapshot} */
    let journal;
    try {
        // Журнал читается со снимка: его может писать живой прогон перевода.
        journal = openDatabaseSnapshot(journalPath, 'журнал enrich.db', `флагом --journal или ${JOURNAL_ENV}`);
    } catch (e) {
        dict.close();
        throw e;
    }
    try {
        return collectPair(dict, {ruSource, journal: journal.db});
    } finally {
        dict.close();
        journal.dispose();
    }
}

/**
 * Одна команда: источники → `<outRoot>/<revision>/{wty-en-en.zip, flibooster-en-ru.zip, build.json}`
 * (+ два списка кандидатов в режиме journal).
 * Каталог появляется только целиком (запись во временный и rename). Если
 * каталог этой ревизии уже есть, новые zip обязаны совпасть с ним побайтно.
 * @param {{dictPath: string, journalPath?: string, outRoot: string, ruSource: RuSource}} options
 * @returns {Promise<BuildResult>}
 */
export async function buildDictionaryPair({dictPath, journalPath, outRoot, ruSource}) {
    const startedAt = new Date();
    const pair = await collectFromSources({dictPath, journalPath, ruSource});

    const hostZip = await createZip(pair.host, pair.revision, true, 'en', HOST_ATTRIBUTION);
    const translationZip = await createZip(pair.translation, pair.revision, false, 'ru', TRANSLATION_ATTRIBUTION);
    // Приёмка по самим zip ДО записи: на диск не попадает пара, которую
    // расширение не спарит.
    const verification = await verifyPairZips(hostZip, translationZip, {allowOrphans: ruSource === 'dict'});
    if (
        verification.host.rows !== pair.host.rows ||
        verification.translation.rows !== pair.translation.rows ||
        verification.pairedStamps !== pair.translation.pairedStamps ||
        verification.orphanStamps !== pair.translation.orphanStamps
    ) {
        throw new Error(`zip не совпали с собранным: ${JSON.stringify(verification)}`);
    }
    if (pair.dict !== null) {
        // ⚠️ Главная сверка режима dict: ни одна строка flibooster-en-ru не потеряна.
        checkRussianRowCount({sourceRows: pair.dict.sourceRows, emitted: pair.translation.rows, inZip: verification.translation.rows});
    }
    /** @type {Map<string, Buffer>} */
    const lists = new Map();
    if (pair.journal !== null) {
        lists.set(STALE_AUTHORED_FILE, expressionListBuffer(pair.journal.staleAuthored, STALE_AUTHORED_FILE));
        lists.set(UNTRANSLATED_AUTHORED_FILE, expressionListBuffer(pair.journal.untranslatedAuthored, UNTRANSLATED_AUTHORED_FILE));
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
    const translation = describeSide(pair.translation, translationZip);
    if (pair.dict !== null) {
        Object.assign(translation, {
            sourceRows: pair.dict.sourceRows,
            sourceRevision: pair.dict.sourceRevision,
            pairedStamps: pair.translation.pairedStamps,
            orphanStamps: pair.translation.orphanStamps,
        });
    }
    /** @type {Record<string, unknown>} */
    const buildJson = {
        tool: TOOL_VERSION,
        revision: pair.revision,
        // Читает --verify: в режиме dict сироты допустимы.
        ruSource: pair.ruSource,
        sources: pair.journal !== null && typeof journalPath === 'string' ?
            {dict: describeFile(dictPath), journal: describeFile(journalPath)} :
            {dict: describeFile(dictPath)},
        host: {...describeSide(pair.host, hostZip), rowsByDictionary: pair.host.rowsByDictionary, maxRowid: pair.host.maxRowid},
        translation,
    };
    if (pair.journal !== null) {
        buildJson.transform = pair.journal.transform;
    }
    buildJson.guards = pair.guards.map(({id, title, violations}) => ({id, title, violations}));
    if (pair.journal !== null) {
        // Сознательное расхождение с Go: легаси-переводы переписанных/удалённых
        // сочинённых статей пропущены (решение владельца 2026-10-05).
        buildJson.staleAuthoredTranslations = {skipped: pair.journal.staleAuthored.length, file: STALE_AUTHORED_FILE};
        buildJson.untranslatedAuthored = {expressions: pair.journal.untranslatedAuthored.length, file: UNTRANSLATED_AUTHORED_FILE};
    }
    buildJson.artifactVerification = verification;
    buildJson.startedAt = startedAt.toISOString();
    buildJson.finishedAt = new Date().toISOString();

    fs.mkdirSync(outRoot, {recursive: true});
    const directory = path.join(outRoot, pair.revision);
    const partial = path.join(outRoot, `.${pair.revision}.partial-${process.pid}`);
    fs.rmSync(partial, {recursive: true, force: true});
    fs.mkdirSync(partial);
    try {
        writeFileDurably(path.join(partial, pair.host.file), hostZip);
        writeFileDurably(path.join(partial, pair.translation.file), translationZip);
        for (const [file, data] of lists) { writeFileDurably(path.join(partial, file), data); }
        writeFileDurably(path.join(partial, 'build.json'), Buffer.from(`${JSON.stringify(buildJson, null, 2)}\n`, 'utf8'));
        if (fs.existsSync(directory)) {
            // Та же ревизия = то же содержимое: zip обязаны совпасть с уже лежащими.
            for (const [file, data] of [[pair.host.file, hostZip], [pair.translation.file, translationZip]]) {
                const existing = path.join(directory, /** @type {string} */ (file));
                if (!fs.existsSync(existing) || sha256(fs.readFileSync(existing)) !== sha256(/** @type {Buffer} */ (data))) {
                    throw new Error(`${existing}: каталог ревизии ${pair.revision} уже есть, но его ${String(file)} отличается от собранного — сборщик недетерминирован или TOOL_VERSION не поднят`);
                }
            }
            // Списки зависят и от журнала вне ревизии (исчезнувшее выражение не
            // меняет русских строк) — отчёт каталога обновляется атомарным rename.
            for (const file of [...lists.keys(), 'build.json']) {
                fs.renameSync(path.join(partial, file), path.join(directory, file));
            }
            // Та же ревизия, собранная в другом режиме: списки прошлого прогона
            // по журналу этот build.json уже не описывает — убрать.
            for (const file of [STALE_AUTHORED_FILE, UNTRANSLATED_AUTHORED_FILE]) {
                if (!lists.has(file)) { fs.rmSync(path.join(directory, file), {force: true}); }
            }
            return {status: 'up-to-date', revision: pair.revision, directory, buildJson};
        }
        fs.renameSync(partial, directory);
        return {status: 'built', revision: pair.revision, directory, buildJson};
    } finally {
        fs.rmSync(partial, {recursive: true, force: true});
    }
}
