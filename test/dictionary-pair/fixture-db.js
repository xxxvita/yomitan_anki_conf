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

// Маленькая база-фикстура той же схемы, что живой dict_base.db.
// Схема списана с `.schema` живого файла, а не с кода anki_conf.

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
