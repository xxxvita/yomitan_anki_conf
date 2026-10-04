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

// Журнал переводов (enrich.db) + английский словарь (dict_base.db) → русские
// статьи `flibooster-en-ru`.
//
// ⚠️ ЭТО ПОРТ, А НЕ ПЕРЕСКАЗ. Оригинал — anki_conf, `cmd/lexicon-dict-enrich/`:
// export.go (buildExportRows), glossary.go (обходчик, clean), apply.go
// (ApplyTranslations), source.go (ArticleByID, Fingerprint), journal.go
// (VerifyDict, articleKeyState), languages.go (NodeGoesToModel). Любая правка
// здесь без правки там — и наоборот — тихо расходит две реализации. Сторож
// расхождения — `npm run check:dictionary-parity` против выгрузки Go-кода.
//
// Сознательные отличия от оригинала (на результат не влияют):
// - глоссарий русской строки сериализуется JSON.stringify, а не encoding/json:
//   порядок ключей и экранирование другие, разобранное содержимое то же;
// - статьи без узлов считаются в stats.noNodes (в Go — молча).
//
// ⚠️ СОЗНАТЕЛЬНОЕ РАСХОЖДЕНИЕ С GO (решение владельца 2026-10-05): легаси-перевод
// (dict_rowid = 0), севший на сочинённую статью flibooster-en, которую с тех пор
// переписали (текст узла не равен `source`, путь журнала исчез, у нового узла нет
// записи) или удалили, ПРОПУСКАЕТСЯ целиком и попадает в staleAuthored. Go здесь
// падает. Перевод заново — точечно, по списку staleAuthored. Расхождение с
// хозяином wty-en-en осталось фатальным: там разошёлся сам английский словарь.
// На входе без таких статей выход прежний — паритет не задет.

import {compareUtf8, goClean, goTrimSpace, goWellFormed} from './go-text.js';
import {parseJson} from '../json.js';
import {asRecord, readInteger, readText} from './sqlite-row.js';

export const SOURCE_DICTIONARY = 'wty-en-en';

export const AUTHORED_DICTIONARY = 'flibooster-en';

export const TRANSLATION_DICTIONARY = 'flibooster-en-ru';

/** @typedef {'gloss'|'etymology'} NodeKind */

/**
 * @typedef {object} GlossNode
 * @property {string} path адрес строки внутри статьи (`node_path` журнала)
 * @property {string} text clean() исходной строки — то, что журнал хранит в `source`
 * @property {NodeKind} kind
 */

/**
 * Строка term-bank v3 до сериализации.
 * @typedef {object} TermRow
 * @property {string} expression
 * @property {string} reading
 * @property {string} definitionTags
 * @property {string} rules
 * @property {number} score
 * @property {string} glossary JSON-текст массива glossary
 * @property {number} sequence
 * @property {string} termTags
 */

/**
 * @typedef {object} TransformStats
 * @property {number} articles статей в журнале (пар expression, dict_rowid)
 * @property {number} expressions статей выложено
 * @property {number} nodes переводов уложено
 * @property {number} skipped пропущено: переведены не целиком
 * @property {number} unchanged пропущено: перевод совпал с оригиналом во всех узлах
 * @property {number} noNodes пропущено: в статье нет переводимых узлов (деинфлексия, редирект)
 */

/**
 * @typedef {object} TransformResult
 * @property {TermRow[]} rows отсортированы как в Go: выражение побайтно, затем штамп
 * @property {TransformStats} stats
 * @property {Set<string>} legacyExpressions выражения журнала с dict_rowid = 0 (для сторожа G11)
 * @property {string[]} staleAuthored выражения, чей легаси-перевод сочинённой статьи
 *   пропущен: статью переписали или удалили. Побайтно отсортированы, без дублей
 */

/**
 * @typedef {object} DecodedNode
 * @property {string} tag
 * @property {string} dataContent
 * @property {boolean} hasContent
 * @property {unknown} content
 */

/**
 * translatableKind из glossary.go — единственное место, где решается, что переводится.
 * @param {string} marker
 * @returns {NodeKind|null}
 */
function translatableKind(marker) {
    switch (marker) {
        case 'glosses': return 'gloss';
        case 'Etymology-content': return 'etymology';
        default: return null;
    }
}

/**
 * Узел не уходит модели — и потому не требует перевода — только если это
 * таблица праформ в этимологии (languages.go: NodeGoesToModel, IsFormTable).
 * @param {GlossNode} node
 * @returns {boolean}
 */
export function nodeGoesToModel(node) {
    if (node.kind !== 'etymology') { return true; }
    const text = goTrimSpace(node.text);
    return !(text.startsWith('Etymology tree') || text.startsWith('PIE word'));
}

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Свёртка имени поля, как при сопоставлении ключей JSON полям структуры в
 * encoding/json: без учёта регистра, плюс два не-ASCII символа, которые
 * Unicode-свёртка сводит к ASCII (U+017F → s, U+212A → k).
 * @param {string} key
 * @returns {string}
 */
function goFoldKey(key) {
    return key.toLowerCase().replaceAll(String.fromCodePoint(0x17f), 's').replaceAll(String.fromCodePoint(0x212a), 'k');
}

/**
 * Поле структуры Go: точное или регистронезависимое совпадение ключа,
 * побеждает последнее в документе.
 * @param {Record<string, unknown>} object
 * @param {string} name
 * @returns {{found: boolean, value: unknown}}
 */
function goStructField(object, name) {
    let found = false;
    /** @type {unknown} */
    let value;
    for (const key of Object.keys(object)) {
        if (key === name || goFoldKey(key) === name) {
            found = true;
            value = object[key];
        }
    }
    return {found, value};
}

/**
 * Разбор узла structured-content в struct{Tag; Data{Content}; Content RawMessage}.
 * Тип поля не тот — ошибка, как у json.Unmarshal.
 * @param {Record<string, unknown>} object
 * @param {string} path
 * @param {string} context
 * @returns {DecodedNode}
 * @throws {Error}
 */
function decodeNode(object, path, context) {
    const tagField = goStructField(object, 'tag');
    let tag = '';
    if (tagField.found && tagField.value !== null) {
        if (typeof tagField.value !== 'string') {
            throw new Error(`${context} ${path}: узел: tag не строка`);
        }
        tag = goWellFormed(tagField.value);
    }
    const dataField = goStructField(object, 'data');
    let dataContent = '';
    if (dataField.found && dataField.value !== null) {
        if (!isObject(dataField.value)) {
            throw new Error(`${context} ${path}: узел: data не объект`);
        }
        const inner = goStructField(dataField.value, 'content');
        if (inner.found && inner.value !== null) {
            if (typeof inner.value !== 'string') {
                throw new Error(`${context} ${path}: узел: data.content не строка`);
            }
            dataContent = goWellFormed(inner.value);
        }
    }
    const contentField = goStructField(object, 'content');
    return {tag, dataContent, hasContent: contentField.found, content: contentField.value};
}

/**
 * Шаг пути и маркер для потомков (общая часть walk и applyNode).
 * Собственный маркер ЗАМЕЩАЕТ унаследованный — поэтому пример внутри li
 * значения непереводим.
 * @param {DecodedNode} node
 * @param {string} marker
 * @returns {{step: string, next: string}}
 */
function nodeStep(node, marker) {
    let step = node.tag === '' ? '?' : node.tag;
    let next = marker;
    if (node.dataContent !== '') {
        next = node.dataContent;
        step += `:${node.dataContent}`;
    }
    return {step, next};
}

/**
 * @param {string} glossary
 * @param {string} context
 * @returns {unknown[]}
 * @throws {Error}
 */
function parseGlossaryArray(glossary, context) {
    /** @type {unknown} */
    let items;
    try {
        items = parseJson(glossary);
    } catch (e) {
        throw new Error(`${context}: разбор массива: ${e instanceof Error ? e.message : String(e)}`);
    }
    // json.Unmarshal("null") в срез даёт пустой срез, а не ошибку.
    if (items === null) { return []; }
    if (!Array.isArray(items)) {
        throw new Error(`${context}: разбор массива: glossary не массив`);
    }
    return items;
}

/**
 * walk из glossary.go.
 * @param {unknown} value
 * @param {string} marker
 * @param {string} path
 * @param {GlossNode[]} acc
 */
function walk(value, marker, path, acc) {
    if (typeof value === 'string') {
        const kind = translatableKind(marker);
        if (kind === null) { return; }
        const text = goClean(goWellFormed(value));
        if (text !== '') { acc.push({path, text, kind}); }
        return;
    }
    if (Array.isArray(value)) {
        for (let i = 0; i < value.length; ++i) {
            walk(value[i], marker, `${path}/${i}`, acc);
        }
        return;
    }
    if (isObject(value)) {
        const node = decodeNode(value, path, 'glossary');
        const {step, next} = nodeStep(node, marker);
        if (!node.hasContent) { return; }
        walk(node.content, next, `${path}/${step}`, acc);
    }
    // Число, булево, null — переводить нечего.
}

/**
 * ExtractTranslatable из glossary.go: переводимые строки статьи в порядке обхода.
 * @param {string} glossary JSON-текст колонки terms.glossary
 * @returns {GlossNode[]}
 * @throws {Error}
 */
export function extractTranslatable(glossary) {
    const items = parseGlossaryArray(glossary, 'glossary');
    /** @type {GlossNode[]} */
    const out = [];
    for (let i = 0; i < items.length; ++i) {
        const item = items[i];
        const base = `i${i}`;
        if (typeof item === 'string') {
            const text = goClean(goWellFormed(item));
            if (text !== '') { out.push({path: base, text, kind: 'gloss'}); }
        } else if (Array.isArray(item)) {
            // Легаси-редирект ["цель", ["пометы"]]: переводить цель — сломать ссылку.
            continue;
        } else if (isObject(item)) {
            // Верхний уровень читается в map[string]RawMessage: ключ точный.
            if (!Object.prototype.hasOwnProperty.call(item, 'content')) { continue; }
            walk(item.content, '', base, out);
        } else {
            throw new Error(`glossary[${i}]: неизвестная форма элемента`);
        }
    }
    return out;
}

/**
 * applyNode из apply.go.
 * @param {unknown} value
 * @param {string} marker
 * @param {string} path
 * @param {Map<string, string>} tr
 * @param {Set<string>} used
 * @returns {unknown}
 */
function applyNode(value, marker, path, tr, used) {
    if (typeof value === 'string') {
        if (translatableKind(marker) === null) { return value; }
        const translation = tr.get(path);
        if (typeof translation === 'undefined') { return value; }
        used.add(path);
        return translation;
    }
    if (Array.isArray(value)) {
        return value.map((item, i) => applyNode(item, marker, `${path}/${i}`, tr, used));
    }
    if (isObject(value)) {
        const node = decodeNode(value, path, 'укладка');
        if (!node.hasContent) { return value; }
        const {step, next} = nodeStep(node, marker);
        const content = applyNode(node.content, next, `${path}/${step}`, tr, used);
        // rebuildObject: подменяется ровно ключ "content", прочие — как были.
        return {...value, content};
    }
    return value;
}

/**
 * ApplyTranslations из apply.go: статья, где строки по путям заменены переводом.
 * Неиспользованный путь — ошибка: журнал и словарь разошлись.
 * @param {string} glossary
 * @param {Map<string, string>} tr
 * @returns {string}
 * @throws {Error}
 */
export function applyTranslations(glossary, tr) {
    const {glossary: out, unused} = applyTranslationsCollect(glossary, tr);
    if (unused.length > 0) {
        throw new Error(`укладка: путь ${JSON.stringify(unused[0])} в статье не найден — рассинхрон журнала`);
    }
    return out;
}

/**
 * Укладка без отказа: статья с переводами и пути перевода, которых в статье нет.
 * @param {string} glossary
 * @param {Map<string, string>} tr
 * @returns {{glossary: string, unused: string[]}}
 * @throws {Error}
 */
function applyTranslationsCollect(glossary, tr) {
    const items = parseGlossaryArray(glossary, 'укладка');
    /** @type {Set<string>} */
    const used = new Set();
    const out = items.map((item, i) => {
        const base = `i${i}`;
        if (typeof item === 'string') {
            const translation = tr.get(base);
            if (typeof translation === 'undefined') { return item; }
            used.add(base);
            return translation;
        }
        if (isObject(item)) {
            if (!Object.prototype.hasOwnProperty.call(item, 'content')) { return item; }
            return {...item, content: applyNode(item.content, '', base, tr, used)};
        }
        // Легаси-редирект и всё прочее — дословно.
        return item;
    });
    return {glossary: JSON.stringify(out), unused: [...tr.keys()].filter((path) => !used.has(path))};
}

/**
 * Легаси-перевод сочинённой статьи не подходит к её нынешнему тексту: статью
 * переписали. Признаки — любой из: исходник готового узла не равен тексту узла;
 * готовый путь в статье не найден; у переводимого узла нет НИ ОДНОЙ записи в
 * журнале (узел появился после перевода). Узел с записью не-done — это неполный
 * перевод неизменённой статьи, а не устаревший.
 * @param {string} glossary
 * @param {GlossNode[]} nodes
 * @param {Map<string, string>} tr готовые переводы по путям
 * @param {Map<string, string>} sources исходники готовых переводов по путям
 * @param {Set<string>} journalPaths пути статьи в журнале при любом статусе
 * @returns {boolean}
 * @throws {Error}
 */
function isStaleAuthored(glossary, nodes, tr, sources, journalPaths) {
    for (const node of nodes) {
        if (!nodeGoesToModel(node)) { continue; }
        if (!journalPaths.has(node.path)) { return true; }
        const was = sources.get(node.path);
        if (typeof was === 'string' && was !== '' && was !== node.text) { return true; }
    }
    return applyTranslationsCollect(glossary, tr).unused.length > 0;
}

/**
 * Список выражений для построчного файла: побайтный порядок UTF-8, без дублей.
 * @param {Iterable<string>} expressions
 * @returns {string[]}
 */
function sortedUnique(expressions) {
    return [...new Set(expressions)].sort(compareUtf8);
}

/**
 * Сочинённые выражения flibooster-en, у которых в журнале нет ни одного готового
 * (done) перевода ни по какому адресу: кандидаты на перевод.
 * @param {import('node:sqlite').DatabaseSync} dict
 * @param {import('node:sqlite').DatabaseSync} journal
 * @returns {string[]} побайтно отсортированы, без дублей
 */
export function listUntranslatedAuthored(dict, journal) {
    const context = 'журнал: готовые выражения';
    /** @type {Set<string>} */
    const done = new Set();
    for (const raw of journal.prepare("SELECT DISTINCT expression FROM enrich_log WHERE status = 'done'").all()) {
        done.add(readText(asRecord(raw, context), 'expression', context));
    }
    /** @type {string[]} */
    const out = [];
    for (const raw of dict.prepare('SELECT DISTINCT expression FROM terms WHERE dictionary = ?').all(AUTHORED_DICTIONARY)) {
        const expression = readText(asRecord(raw, 'словарь: сочинённые'), 'expression', 'словарь: сочинённые');
        if (!done.has(expression)) { out.push(expression); }
    }
    return sortedUnique(out);
}

/**
 * @typedef {object} SourceArticle
 * @property {number} rowid
 * @property {string} dictionary
 * @property {TermRow} row
 */

const ARTICLE_COLUMNS = 'rowid AS rowid, dictionary, expression, reading, definition_tags, rules, score, glossary, sequence, term_tags';

/**
 * @param {unknown} raw
 * @param {string} context
 * @returns {SourceArticle}
 */
function readArticle(raw, context) {
    const r = asRecord(raw, context);
    return {
        rowid: readInteger(r, 'rowid', context),
        dictionary: readText(r, 'dictionary', context),
        row: {
            expression: readText(r, 'expression', context),
            reading: readText(r, 'reading', context),
            definitionTags: readText(r, 'definition_tags', context),
            rules: readText(r, 'rules', context),
            score: readInteger(r, 'score', context),
            glossary: readText(r, 'glossary', context),
            sequence: readInteger(r, 'sequence', context),
            termTags: readText(r, 'term_tags', context),
        },
    };
}

/**
 * articleKeyState + отказ из openJournalReadOnly: журнал старого ключа
 * разложил бы переводы по чужим статьям.
 * @param {import('node:sqlite').DatabaseSync} journal
 * @throws {Error}
 */
function checkJournalKey(journal) {
    const table = journal.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='enrich_log'").get();
    const exists = readInteger(asRecord(table, 'журнал: схема'), 'n', 'журнал: схема') > 0;
    let inPrimaryKey = false;
    if (exists) {
        for (const raw of journal.prepare('PRAGMA table_info(enrich_log)').all()) {
            const column = asRecord(raw, 'журнал: состав ключа');
            if (column.name === 'dict_rowid' && readInteger(column, 'pk', 'журнал: состав ключа') > 0) {
                inPrimaryKey = true;
            }
        }
    }
    if (!exists || !inPrimaryKey) {
        throw new Error('журнал ключуется по (слово, путь) — выкладка на нём разложила бы переводы по чужим статьям. Выполните -migrate-journal в anki_conf');
    }
}

/**
 * Число из meta так, как его читает fmt.Sscan: ведущие цифры.
 * @param {string} value
 * @param {string} name
 * @returns {number}
 * @throws {Error}
 */
function parseMetaInteger(value, name) {
    const match = /^\s*([+-]?\d+)/.exec(value);
    if (match === null) {
        throw new Error(`журнал: отпечаток: ${name} ${JSON.stringify(value)} не число`);
    }
    return Number.parseInt(match[1], 10);
}

/**
 * VerifyDict из journal.go: отпечаток словаря-источника плюс выборочная сверка
 * ста адресов. Ловит пересборку и VACUUM словаря, после которых адреса
 * журнала указывают на чужие статьи.
 * @param {import('node:sqlite').DatabaseSync} dict
 * @param {import('node:sqlite').DatabaseSync} journal
 * @throws {Error}
 */
function verifyDict(dict, journal) {
    const revisionRow = dict.prepare("SELECT COALESCE(revision,'') AS revision FROM dictionaries WHERE title = ?").get(SOURCE_DICTIONARY);
    const revision = typeof revisionRow === 'undefined' ? '' : readText(asRecord(revisionRow, 'словарь: ревизия'), 'revision', 'словарь: ревизия');
    const countRow = asRecord(dict.prepare('SELECT count(*) AS rows, COALESCE(max(rowid),0) AS maxRowid FROM terms WHERE dictionary = ?').get(SOURCE_DICTIONARY), 'словарь: отпечаток');
    const actual = {
        title: SOURCE_DICTIONARY,
        revision,
        rows: readInteger(countRow, 'rows', 'словарь: отпечаток'),
        maxRowid: readInteger(countRow, 'maxRowid', 'словарь: отпечаток'),
    };

    const hasMeta = journal.prepare("SELECT count(*) AS n FROM sqlite_master WHERE type='table' AND name='meta'").get();
    if (readInteger(asRecord(hasMeta, 'журнал: meta'), 'n', 'журнал: meta') > 0) {
        const stored = {title: '', revision: '', rows: 0, maxRowid: 0};
        let found = false;
        for (const raw of journal.prepare('SELECT key, value FROM meta').all()) {
            const r = asRecord(raw, 'журнал: отпечаток');
            const key = readText(r, 'key', 'журнал: отпечаток');
            const value = readText(r, 'value', 'журнал: отпечаток');
            switch (key) {
                case 'dict_title':
                    stored.title = value;
                    found = true;
                    break;
                case 'dict_revision': stored.revision = value; break;
                case 'dict_rows': stored.rows = parseMetaInteger(value, 'число строк'); break;
                case 'dict_max_rowid': stored.maxRowid = parseMetaInteger(value, 'max rowid'); break;
            }
        }
        if (found && (stored.title !== actual.title || stored.revision !== actual.revision || stored.rows !== actual.rows || stored.maxRowid !== actual.maxRowid)) {
            throw new Error(
                `журнал собран против другого словаря:\n  журнал:  ${JSON.stringify(stored)}\n  словарь: ${JSON.stringify(actual)}\n` +
                'Адреса статей в журнале относятся к другой сборке — нужен повторный бэкфилл',
            );
        }
    }

    const expressionAt = dict.prepare('SELECT expression FROM terms WHERE rowid = ?');
    const sample = journal.prepare('SELECT expression, dict_rowid FROM enrich_log WHERE dict_rowid > 0 ORDER BY dict_rowid % 97, dict_rowid LIMIT 100').all();
    for (const raw of sample) {
        const r = asRecord(raw, 'журнал: сверка адресов');
        const expected = readText(r, 'expression', 'журнал: сверка адресов');
        const rowid = readInteger(r, 'dict_rowid', 'журнал: сверка адресов');
        const got = expressionAt.get(rowid);
        const gotExpression = typeof got === 'undefined' ? '' : readText(asRecord(got, 'словарь'), 'expression', 'словарь');
        if (typeof got === 'undefined' || gotExpression !== expected) {
            throw new Error(`журнал: адрес ${rowid} описывает ${JSON.stringify(gotExpression)}, а журнал ждал ${JSON.stringify(expected)} — словарь пересобран, адреса статей протухли`);
        }
    }
}

/**
 * buildExportRows из export.go, со всеми его предусловиями
 * (buildExportRowsAt → openJournalReadOnly + VerifyDict).
 * Базы только читаются.
 * @param {import('node:sqlite').DatabaseSync} dict dict_base.db
 * @param {import('node:sqlite').DatabaseSync} journal enrich.db
 * @returns {TransformResult}
 * @throws {Error}
 */
export function buildRussianRows(dict, journal) {
    checkJournalKey(journal);
    verifyDict(dict, journal);

    const articleById = dict.prepare(`SELECT ${ARTICLE_COLUMNS} FROM terms WHERE rowid = ?`);
    // ⚠️ Легаси-адрес 0 = «строка, которую вернул старый запрос»: словарь-источник
    // НЕ фильтруется (сочинённые статьи лежат в flibooster-en), исключается
    // только собственный выход выкладки.
    const legacyArticle = dict.prepare(`SELECT ${ARTICLE_COLUMNS} FROM terms WHERE expression = ? AND dictionary <> ? ORDER BY rowid LIMIT 1`);
    const doneTranslations = journal.prepare('SELECT node_path, translation, source FROM enrich_log WHERE expression = ? AND dict_rowid = ? AND status = ?');
    const journalPaths = journal.prepare('SELECT node_path FROM enrich_log WHERE expression = ? AND dict_rowid = ?');
    // Без единой строки flibooster-en «исчезнувшее» сочинённое выражение — признак
    // не той базы, а не переписанной статьи: тогда отказ, как раньше.
    const hasAuthored = typeof dict.prepare('SELECT 1 AS one FROM terms WHERE dictionary = ? LIMIT 1').get(AUTHORED_DICTIONARY) !== 'undefined';

    const articles = journal.prepare('SELECT DISTINCT expression, dict_rowid FROM enrich_log ORDER BY expression, dict_rowid').all().map((raw) => {
        const r = asRecord(raw, 'журнал: список статей');
        return {expression: readText(r, 'expression', 'журнал: список статей'), rowid: readInteger(r, 'dict_rowid', 'журнал: список статей')};
    });

    /** @type {TransformStats} */
    const stats = {articles: articles.length, expressions: 0, nodes: 0, skipped: 0, unchanged: 0, noNodes: 0};
    /** @type {Set<string>} */
    const legacyExpressions = new Set();
    /** @type {Map<number, string>} */
    const emitted = new Map();
    /** @type {string[]} */
    const missing = [];
    /** @type {string[]} */
    const staleAuthored = [];
    /** @type {TermRow[]} */
    const out = [];

    for (const article of articles) {
        const expression = article.expression;
        const context = `выкладка ${JSON.stringify(expression)}`;
        /** @type {SourceArticle} */
        let source;
        if (article.rowid > 0) {
            const raw = articleById.get(article.rowid);
            if (typeof raw === 'undefined') {
                throw new Error(`${context}: словарь: статьи с адресом ${article.rowid} нет — журнал и словарь разошлись`);
            }
            source = readArticle(raw, context);
            if (source.row.expression !== expression) {
                throw new Error(`${context}: словарь: адрес ${article.rowid} описывает слово ${JSON.stringify(source.row.expression)}, а журнал ждал ${JSON.stringify(expression)} — словарь пересобрали`);
            }
            if (source.dictionary !== SOURCE_DICTIONARY) {
                throw new Error(`${context}: словарь: адрес ${article.rowid} принадлежит словарю ${JSON.stringify(source.dictionary)}, а источник ${JSON.stringify(SOURCE_DICTIONARY)}`);
            }
        } else {
            legacyExpressions.add(expression);
            const raw = legacyArticle.get(expression, TRANSLATION_DICTIONARY);
            if (typeof raw === 'undefined') {
                // Сочинённую статью удалили (ревью отклонило): перевод устарел.
                if (hasAuthored) {
                    staleAuthored.push(expression);
                } else {
                    missing.push(expression);
                }
                continue;
            }
            source = readArticle(raw, context);
        }

        const previous = emitted.get(source.rowid);
        if (typeof previous !== 'undefined') {
            throw new Error(`${context}: статья с адресом ${source.rowid} записана в журнале дважды (ещё как ${JSON.stringify(previous)}) — одна часть речи получила бы две русские строки`);
        }

        /** @type {GlossNode[]} */
        let nodes;
        try {
            nodes = extractTranslatable(source.row.glossary);
        } catch (e) {
            throw new Error(`${context}: разбор статьи: ${e instanceof Error ? e.message : String(e)}`);
        }
        if (nodes.length === 0) {
            // Сплошной легаси-редирект/деинфлексия: русской версии быть не может.
            ++stats.noNodes;
            continue;
        }

        // Адрес журнала, а не разрешённый rowid: у легаси-статей это 0.
        /** @type {Map<string, string>} */
        const tr = new Map();
        /** @type {Map<string, string>} */
        const sources = new Map();
        for (const raw of doneTranslations.all(expression, article.rowid, 'done')) {
            const r = asRecord(raw, context);
            const path = readText(r, 'node_path', context);
            tr.set(path, readText(r, 'translation', context));
            sources.set(path, readText(r, 'source', context));
        }

        // ⚠️ Только легаси-адрес на сочинённой статье. Хозяин wty-en-en идёт
        // дальше, к фатальным проверкам: там расхождение — пересобранный словарь.
        if (article.rowid === 0 && source.dictionary === AUTHORED_DICTIONARY) {
            /** @type {Set<string>} */
            const paths = new Set();
            for (const raw of journalPaths.all(expression, article.rowid)) {
                paths.add(readText(asRecord(raw, context), 'node_path', context));
            }
            let stale;
            try {
                stale = isStaleAuthored(source.row.glossary, nodes, tr, sources, paths);
            } catch (e) {
                throw new Error(`${context}: ${e instanceof Error ? e.message : String(e)}`);
            }
            if (stale) {
                staleAuthored.push(expression);
                continue;
            }
        }

        let complete = true;
        for (const node of nodes) {
            if (!nodeGoesToModel(node)) { continue; }
            if (!tr.has(node.path)) {
                complete = false;
                break;
            }
            const was = sources.get(node.path);
            if (typeof was === 'string' && was !== '' && was !== node.text) {
                throw new Error(
                    `${context}: путь ${node.path} описывает другой текст, чем в журнале\n  журнал:  ${JSON.stringify(was)}\n  словарь: ${JSON.stringify(node.text)}\n` +
                    'словарь пересобрали — перевод относился бы к чужому значению',
                );
            }
        }
        if (!complete) {
            ++stats.skipped;
            continue;
        }

        let changed = false;
        for (const node of nodes) {
            if (!nodeGoesToModel(node)) { continue; }
            if (tr.get(node.path) !== node.text) {
                changed = true;
                break;
            }
        }
        if (!changed) {
            ++stats.unchanged;
            continue;
        }

        /** @type {string} */
        let glossary;
        try {
            glossary = applyTranslations(source.row.glossary, tr);
        } catch (e) {
            throw new Error(`${context}: ${e instanceof Error ? e.message : String(e)}`);
        }
        // ⚠️ ШТАМП: sequence русской строки = rowid английской статьи.
        out.push({...source.row, glossary, sequence: source.rowid});
        emitted.set(source.rowid, expression);
        ++stats.expressions;
        stats.nodes += tr.size;
    }

    // «Нет в словаре» — ошибка: выкладка стёрла бы уже готовые русские статьи.
    if (missing.length > 0) {
        throw new Error(`выкладка: ${missing.length} выражений журнала нет в словаре (${missing.slice(0, 5).join(', ')}…) — выкладывайте против словаря, где эти статьи есть`);
    }

    out.sort((a, b) => compareUtf8(a.expression, b.expression) || a.sequence - b.sequence);
    return {rows: out, stats, legacyExpressions, staleAuthored: sortedUnique(staleAuthored)};
}
