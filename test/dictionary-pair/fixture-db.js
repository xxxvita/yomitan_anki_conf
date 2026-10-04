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

// Маленькие базы-фикстуры той же схемы, что живые dict_base.db и enrich.db.
// Схемы списаны с `.schema` живых файлов, а не с кода anki_conf.

import {DatabaseSync} from 'node:sqlite';

/**
 * @typedef {object} TermInput
 * @property {string} dictionary
 * @property {string} expression
 * @property {unknown} glossary
 * @property {string} [reading]
 * @property {string} [definitionTags]
 * @property {string} [rules]
 * @property {number} [score]
 * @property {number} [sequence]
 * @property {string} [termTags]
 * @property {number} [rowid]
 */

/**
 * @typedef {object} JournalInput
 * @property {string} expression
 * @property {number} dictRowid
 * @property {string} nodePath
 * @property {string} [status]
 * @property {string} [kind]
 * @property {string} [source]
 * @property {string} [translation]
 */

/**
 * @param {string} [location]
 * @returns {DatabaseSync}
 */
export function createDictDb(location = ':memory:') {
    const db = new DatabaseSync(location);
    db.exec(`
        CREATE TABLE terms (
            dictionary      TEXT    NOT NULL,
            expression      TEXT    NOT NULL,
            reading         TEXT    NOT NULL DEFAULT '',
            definition_tags TEXT    NOT NULL DEFAULT '',
            rules           TEXT    NOT NULL DEFAULT '',
            score           INTEGER NOT NULL DEFAULT 0,
            glossary        TEXT    NOT NULL DEFAULT '[]',
            sequence        INTEGER NOT NULL DEFAULT 0,
            term_tags       TEXT    NOT NULL DEFAULT ''
        );
        CREATE INDEX terms_expr_idx ON terms(expression);
        CREATE TABLE dictionaries (
            title       TEXT    NOT NULL PRIMARY KEY,
            revision    TEXT    NOT NULL DEFAULT '',
            version     INTEGER NOT NULL DEFAULT 0,
            term_count  INTEGER NOT NULL DEFAULT 0,
            kanji_count INTEGER NOT NULL DEFAULT 0,
            lang        TEXT    NOT NULL DEFAULT ''
        );
        INSERT INTO dictionaries(title, revision, lang) VALUES
            ('wty-en-en', '2026.03.05', 'en'),
            ('flibooster-en', '2026.08.29', 'en'),
            ('flibooster-en-ru', '2026.09.06', 'ru');
    `);
    return db;
}

/**
 * @param {DatabaseSync} db
 * @param {TermInput} term
 * @returns {number} rowid
 */
export function addTerm(db, term) {
    const glossary = typeof term.glossary === 'string' ? term.glossary : JSON.stringify(term.glossary);
    const values = [
        term.dictionary,
        term.expression,
        term.reading ?? '',
        term.definitionTags ?? 'n',
        term.rules ?? 'n',
        term.score ?? 0,
        glossary,
        term.sequence ?? 0,
        term.termTags ?? '',
    ];
    const columns = 'dictionary, expression, reading, definition_tags, rules, score, glossary, sequence, term_tags';
    const result = typeof term.rowid === 'number' ?
        db.prepare(`INSERT INTO terms(rowid, ${columns}) VALUES(?,?,?,?,?,?,?,?,?,?)`).run(term.rowid, ...values) :
        db.prepare(`INSERT INTO terms(${columns}) VALUES(?,?,?,?,?,?,?,?,?)`).run(...values);
    return Number(result.lastInsertRowid);
}

/**
 * @param {string} [location]
 * @returns {DatabaseSync}
 */
export function createJournalDb(location = ':memory:') {
    const db = new DatabaseSync(location);
    db.exec(`
        CREATE TABLE enrich_log (
            expression  TEXT    NOT NULL,
            dict_rowid  INTEGER NOT NULL DEFAULT 0,
            node_path   TEXT    NOT NULL,
            kind        TEXT    NOT NULL,
            status      TEXT    NOT NULL,
            source      TEXT    NOT NULL DEFAULT '',
            translation TEXT    NOT NULL DEFAULT '',
            article_tags TEXT   NOT NULL DEFAULT '',
            attempt     INTEGER NOT NULL DEFAULT 0,
            note        TEXT    NOT NULL DEFAULT '',
            updated_at  INTEGER NOT NULL,
            PRIMARY KEY (expression, dict_rowid, node_path)
        );
        CREATE TABLE meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    `);
    return db;
}

/**
 * @param {DatabaseSync} db
 * @param {JournalInput} entry
 */
export function addJournal(db, entry) {
    const status = entry.status ?? 'done';
    db.prepare(`
        INSERT OR REPLACE INTO enrich_log(expression, dict_rowid, node_path, kind, status, source, translation, updated_at)
        VALUES(?,?,?,?,?,?,?,1)
    `).run(
        entry.expression,
        entry.dictRowid,
        entry.nodePath,
        entry.kind ?? 'gloss',
        status,
        entry.source ?? '',
        entry.translation ?? '',
    );
}

/**
 * Отпечаток словаря-источника в meta журнала — как его пишет прогон.
 * @param {DatabaseSync} journal
 * @param {DatabaseSync} dict
 */
export function stampFingerprint(journal, dict) {
    const fp = /** @type {{rows: number, maxRowid: number}} */ (dict.prepare(
        "SELECT count(*) AS rows, COALESCE(max(rowid),0) AS maxRowid FROM terms WHERE dictionary = 'wty-en-en'",
    ).get());
    const insert = journal.prepare('INSERT OR REPLACE INTO meta(key, value) VALUES(?, ?)');
    insert.run('dict_title', 'wty-en-en');
    insert.run('dict_revision', '2026.03.05');
    insert.run('dict_rows', String(fp.rows));
    insert.run('dict_max_rowid', String(fp.maxRowid));
}

/**
 * Статья в форме wty-en-en: преамбула с этимологией, список значений с примером
 * внутри значения и вложенным под-значением, ссылка-подвал.
 * @param {{senses: string[], etymology?: string[], subSense?: string}} parts
 * @returns {unknown[]}
 */
export function wtyArticle({senses, etymology = [], subSense}) {
    /** @type {unknown[]} */
    const content = [];
    if (etymology.length > 0) {
        content.push({
            tag: 'div',
            data: {content: 'preamble'},
            content: [{
                tag: 'details',
                data: {content: 'details-entry-Etymology'},
                content: [
                    {tag: 'summary', data: {content: 'summary-entry'}, content: 'Etymology'},
                    {tag: 'div', data: {content: 'Etymology-content'}, content: etymology.map((text) => ({tag: 'div', content: text}))},
                ],
            }],
        });
    }
    content.push({
        tag: 'ol',
        data: {content: 'glosses'},
        content: senses.map((sense, index) => ({
            tag: 'li',
            content: [
                {
                    tag: 'div',
                    content: [
                        sense,
                        {
                            tag: 'details',
                            data: {content: 'details-entry-examples'},
                            content: [
                                {tag: 'summary', data: {content: 'summary-entry'}, content: '1 example'},
                                `Example ${index}.`,
                            ],
                        },
                    ],
                },
                ...(index === 0 && typeof subSense === 'string' ? [{tag: 'ul', content: [{tag: 'li', content: subSense}]}] : []),
            ],
        })),
    }, {tag: 'div', data: {content: 'backlink'}, content: 'Wiktionary'});
    return [{type: 'structured-content', content}];
}

/**
 * Путь значения номер index в статье wtyArticle (без этимологии — смещение 0).
 * @param {number} index
 * @param {boolean} [withEtymology]
 * @returns {string}
 */
export function sensePath(index, withEtymology = false) {
    return `i0/${withEtymology ? 1 : 0}/ol:glosses/${index}/li/0/div/0`;
}

/**
 * @param {number} index
 * @returns {string}
 */
export function etymologyPath(index) {
    return `i0/0/div:preamble/0/details:details-entry-Etymology/1/div:Etymology-content/${index}/div`;
}
