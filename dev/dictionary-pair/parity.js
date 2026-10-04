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

// Сверка русских строк нашего порта с выгрузкой Go-кода anki_conf
// (`lexicon-dict-enrich -export`). Две реализации одного преобразования
// расходятся молча; эта сверка — единственный сторож, и пускать её надо при
// каждой правке enrich-кода в anki_conf.
//
// Равенство — по содержимому: (expression, reading, sequence, разобранный
// glossary, definitionTags, rules, termTags, score). Порядок ключей и байтовое
// экранирование JSON не сравниваются: Go и JS их пишут по-разному законно.

import {TRANSLATION_DICTIONARY} from './enrich-transform.js';
import {parseJson} from '../json.js';
import {asRecord, readInteger, readText} from './sqlite-row.js';

/** @typedef {import('./enrich-transform.js').TermRow} TermRow */

/**
 * @typedef {object} ParityMismatch
 * @property {string} kind класс расхождения
 * @property {number} sequence
 * @property {string} expression
 */

/**
 * @typedef {object} ParityReport
 * @property {number} referenceRows
 * @property {number} ourRows
 * @property {number} equal
 * @property {boolean} sameOrder порядок строк совпал (порядок становится порядком банков zip)
 * @property {Record<string, number>} classes число расхождений по классам
 * @property {ParityMismatch[]} samples первые расхождения каждого класса
 */

/** Поля, сравниваемые как есть. */
const SCALAR_FIELDS = /** @type {const} */ (['expression', 'reading', 'definitionTags', 'rules', 'termTags', 'score']);

/**
 * Канонический JSON: ключи объектов по алфавиту, без пробелов.
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
    if (Array.isArray(value)) {
        return `[${value.map((item) => canonicalJson(item)).join(',')}]`;
    }
    if (typeof value === 'object' && value !== null) {
        const record = /** @type {Record<string, unknown>} */ (value);
        const keys = Object.keys(record).sort();
        return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`;
    }
    return JSON.stringify(value);
}

/**
 * Русские строки выгрузки Go (копия dict_base.db, где -export переписал
 * `flibooster-en-ru`).
 * @param {import('node:sqlite').DatabaseSync} reference
 * @returns {TermRow[]}
 */
export function readReferenceRows(reference) {
    const context = 'эталон';
    return reference.prepare(
        'SELECT expression, reading, definition_tags, rules, score, glossary, sequence, term_tags FROM terms WHERE dictionary = ? ORDER BY rowid',
    ).all(TRANSLATION_DICTIONARY).map((raw) => {
        const r = asRecord(raw, context);
        return {
            expression: readText(r, 'expression', context),
            reading: readText(r, 'reading', context),
            definitionTags: readText(r, 'definition_tags', context),
            rules: readText(r, 'rules', context),
            score: readInteger(r, 'score', context),
            glossary: readText(r, 'glossary', context),
            sequence: readInteger(r, 'sequence', context),
            termTags: readText(r, 'term_tags', context),
        };
    });
}

/**
 * @param {TermRow[]} rows
 * @param {string} side
 * @returns {Map<number, TermRow>}
 * @throws {Error}
 */
function indexBySequence(rows, side) {
    /** @type {Map<number, TermRow>} */
    const map = new Map();
    for (const row of rows) {
        if (map.has(row.sequence)) {
            throw new Error(`${side}: штамп ${row.sequence} встречается дважды — сверка по штампу невозможна`);
        }
        map.set(row.sequence, row);
    }
    return map;
}

/**
 * @param {TermRow[]} referenceRows
 * @param {TermRow[]} ourRows
 * @param {number} [samplesPerClass]
 * @returns {ParityReport}
 */
export function compareRussianRows(referenceRows, ourRows, samplesPerClass = 5) {
    const reference = indexBySequence(referenceRows, 'эталон');
    const ours = indexBySequence(ourRows, 'порт');
    /** @type {Record<string, number>} */
    const classes = {};
    /** @type {ParityMismatch[]} */
    const samples = [];
    /**
     * @param {string} kind
     * @param {TermRow} row
     */
    const record = (kind, row) => {
        const count = (classes[kind] ?? 0) + 1;
        classes[kind] = count;
        if (count <= samplesPerClass) {
            samples.push({kind, sequence: row.sequence, expression: row.expression});
        }
    };

    let equal = 0;
    for (const [sequence, expected] of reference) {
        const actual = ours.get(sequence);
        if (typeof actual === 'undefined') {
            record('only-in-reference', expected);
            continue;
        }
        let same = true;
        for (const field of SCALAR_FIELDS) {
            if (expected[field] !== actual[field]) {
                record(`field:${field}`, expected);
                same = false;
            }
        }
        if (canonicalJson(parseJson(expected.glossary)) !== canonicalJson(parseJson(actual.glossary))) {
            record('field:glossary', expected);
            same = false;
        }
        if (same) { ++equal; }
    }
    for (const [sequence, actual] of ours) {
        if (!reference.has(sequence)) {
            record('only-in-ours', actual);
        }
    }
    const sameOrder = referenceRows.length === ourRows.length && referenceRows.every((row, i) => row.sequence === ourRows[i].sequence);
    if (!sameOrder) {
        classes.order = 1;
    }
    return {referenceRows: referenceRows.length, ourRows: ourRows.length, equal, sameOrder, classes, samples};
}
