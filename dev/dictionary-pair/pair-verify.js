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

// Приёмка пары ТОЛЬКО по артефакту (контракт §11): читаются два zip, база не
// открывается. Проверки повторяют dict-pair-verify из anki_conf (П1–П6а, G9),
// чтобы «собрано» значило «расширение спарит», а не «код отработал».

import JSZip from 'jszip';
import {parseJson} from '../json.js';
import {SOURCE_DICTIONARY, TRANSLATION_DICTIONARY} from './enrich-transform.js';

const HOST_TITLE = SOURCE_DICTIONARY;

/**
 * @typedef {object} VerifiedSide
 * @property {string} revision
 * @property {number} rows
 * @property {number} banks
 */

/**
 * @typedef {object} PairVerification
 * @property {VerifiedSide} host
 * @property {VerifiedSide} translation
 * @property {number} pairedStamps русских штампов, нашедших хозяина
 */

/**
 * @typedef {object} BankRow
 * @property {string} expression
 * @property {unknown} reading
 * @property {string} rules
 * @property {unknown} glossary
 * @property {number} sequence
 * @property {unknown} termTags
 */

/**
 * @param {JSZip} zip
 * @param {string} label
 * @returns {Promise<{index: Record<string, unknown>, bankNames: string[]}>}
 */
async function readLayout(zip, label) {
    const names = Object.keys(zip.files);
    const indexFile = zip.file('index.json');
    if (indexFile === null) { throw new Error(`${label}: нет index.json`); }
    /** @type {unknown} */
    const index = parseJson(await indexFile.async('string'));
    if (typeof index !== 'object' || index === null || Array.isArray(index)) {
        throw new Error(`${label}: index.json не объект`);
    }
    const bankNames = names.filter((name) => name !== 'index.json');
    for (const [i, name] of bankNames.entries()) {
        if (name !== `term_bank_${i + 1}.json`) {
            throw new Error(`${label}: запись ${name} на месте term_bank_${i + 1}.json`);
        }
    }
    return {index: /** @type {Record<string, unknown>} */ (index), bankNames};
}

/**
 * @param {JSZip} zip
 * @param {string} name
 * @param {string} label
 * @returns {Promise<BankRow[]>}
 */
async function readBank(zip, name, label) {
    const file = zip.file(name);
    if (file === null) { throw new Error(`${label}: нет ${name}`); }
    /** @type {unknown} */
    const parsed = parseJson(await file.async('string'));
    if (!Array.isArray(parsed)) { throw new Error(`${label} ${name}: банк не массив`); }
    return /** @type {unknown[]} */ (parsed).map((raw, i) => {
        const where = `${label} ${name}[${i}]`;
        if (!Array.isArray(raw) || raw.length !== 8) { throw new Error(`${where}: строка не из 8 элементов`); }
        const cells = /** @type {unknown[]} */ (raw);
        const [expression, reading, , rules, , glossary, sequence, termTags] = cells;
        if (typeof expression !== 'string' || typeof rules !== 'string') { throw new Error(`${where}: expression/rules не строки`); }
        if (typeof reading !== 'string' || typeof termTags !== 'string') { throw new Error(`${where}: reading/termTags не строки`); }
        if (typeof sequence !== 'number' || !Number.isSafeInteger(sequence)) { throw new Error(`${where}: sequence не целое`); }
        return {expression, reading, rules, glossary, sequence, termTags};
    });
}

/**
 * @param {Record<string, unknown>} index
 * @param {string} title
 * @param {boolean} sequenced
 * @param {string} label
 * @param {string[]} errors
 */
function checkIndex(index, title, sequenced, label, errors) {
    if (index.title !== title) { errors.push(`${label}: title ${JSON.stringify(index.title)} вместо ${title}`); }
    if (index.format !== 3) { errors.push(`${label}: format ${String(index.format)} вместо 3`); }
    if (typeof index.revision !== 'string' || index.revision === '') { errors.push(`${label}: пустой revision`); }
    if (('sequenced' in index) !== sequenced) { errors.push(`${label}: sequenced ${sequenced ? 'отсутствует' : 'присутствует'}`); }
    for (const key of ['isUpdatable', 'indexUrl', 'downloadUrl']) {
        if (key in index) { errors.push(`${label}: в index.json есть ${key}`); }
    }
}

/**
 * @param {Buffer} hostZip
 * @param {Buffer} translationZip
 * @returns {Promise<PairVerification>}
 */
export async function verifyPairZips(hostZip, translationZip) {
    /** @type {string[]} */
    const errors = [];
    const host = await JSZip.loadAsync(hostZip);
    const translation = await JSZip.loadAsync(translationZip);
    const hostLayout = await readLayout(host, HOST_TITLE);
    const translationLayout = await readLayout(translation, TRANSLATION_DICTIONARY);
    checkIndex(hostLayout.index, HOST_TITLE, true, HOST_TITLE, errors);
    checkIndex(translationLayout.index, TRANSLATION_DICTIONARY, false, TRANSLATION_DICTIONARY, errors);
    if (hostLayout.index.revision !== translationLayout.index.revision) {
        errors.push(`revision разошёлся: ${String(hostLayout.index.revision)} / ${String(translationLayout.index.revision)}`);
    }

    /** @type {Map<number, BankRow>} */
    const russian = new Map();
    let translationRows = 0;
    for (const name of translationLayout.bankNames) {
        for (const row of await readBank(translation, name, TRANSLATION_DICTIONARY)) {
            ++translationRows;
            if (row.sequence <= 0) { errors.push(`П2: русский штамп ${row.sequence} у ${row.expression}`); }
            if (russian.has(row.sequence)) { errors.push(`П4а: русский штамп ${row.sequence} повторяется`); }
            if (row.reading !== '' && row.reading !== row.expression) { errors.push(`П5: reading ${row.sequence}`); }
            russian.set(row.sequence, row);
        }
    }

    let hostRows = 0;
    let previous = 0;
    let paired = 0;
    for (const name of hostLayout.bankNames) {
        for (const row of await readBank(host, name, HOST_TITLE)) {
            ++hostRows;
            if (row.sequence <= previous) { errors.push(`П1/П4: штамп хозяина ${row.sequence} после ${previous}`); }
            previous = row.sequence;
            const pair = russian.get(row.sequence);
            if (typeof pair === 'undefined') { continue; }
            ++paired;
            if (pair.expression !== row.expression || pair.rules !== row.rules) { errors.push(`П5: пара ${row.sequence} расходится по expression/rules`); }
            if (!Array.isArray(row.glossary) || !row.glossary.some((item) => !Array.isArray(item))) {
                errors.push(`G9: русский штамп ${row.sequence} указывает на деинфлексию ${row.expression}`);
            }
        }
    }
    if (paired !== russian.size) { errors.push(`П3: ${russian.size - paired} русских штампов без хозяина`); }
    if (hostRows === 0 || translationRows === 0) { errors.push('пустая сторона пары'); }

    if (errors.length > 0) {
        throw new Error(`приёмка пары по артефакту провалена (${errors.length}):\n  ${errors.slice(0, 20).join('\n  ')}`);
    }
    return {
        host: {revision: String(hostLayout.index.revision), rows: hostRows, banks: hostLayout.bankNames.length},
        translation: {revision: String(translationLayout.index.revision), rows: translationRows, banks: translationLayout.bankNames.length},
        pairedStamps: paired,
    };
}
