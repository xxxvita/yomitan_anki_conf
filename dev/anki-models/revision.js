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

/*
 * JS-порт метки ревизии типов заметок Flibooster (anki_conf
 * internal/cli/anki_bootstrap_revision.go:58-96, normContent —
 * anki_bootstrap_status.go:88). Метка нужна, чтобы Flibooster узнавал модели,
 * поставленные расширением, и не перезаписывал их как «устаревшие».
 * Сверено с Go эталонами в test/anki-model-revision.test.js.
 */

import {createHash} from 'node:crypto';

/**
 * @typedef {{name: string, fields: string[], templates: Record<string, Record<string, string>>, css: string, isCloze?: boolean}} SourceModel
 */

const REV_MARKER_TAG = 'ankimodels-rev:';
const REV_MARKER_RE = /\/\*[ \t]*ankimodels-rev:([^\n]*?)[ \t]*\*\/[ \t]*(?:\r?\n)?/g;

/**
 * @param {string} s
 * @returns {string}
 */
function normContent(s) {
    return s.replaceAll('\r\n', '\n').replaceAll('\r', '\n').trim();
}

/**
 * @param {string} css
 * @returns {string}
 */
export function stripRevMarker(css) {
    let result = css;
    while (new RegExp(REV_MARKER_RE.source).test(result)) {
        result = result.replace(REV_MARKER_RE, '');
    }
    return result;
}

/**
 * @param {string} css
 * @param {string} revision
 * @returns {string}
 */
export function stampRevMarker(css, revision) {
    return `/* ${REV_MARKER_TAG}${revision} */\n${stripRevMarker(css)}`;
}

/**
 * Беззнаковый varint, как binary.PutUvarint в Go.
 * @param {number} value
 * @returns {Buffer}
 */
function uvarint(value) {
    const bytes = [];
    let v = value;
    while (v >= 0x80) {
        bytes.push((v & 0x7f) | 0x80);
        v = Math.floor(v / 128);
    }
    bytes.push(v);
    return Buffer.from(bytes);
}

/**
 * Go сортирует строки побайтно (UTF-8); для ASCII-имён это обычный порядок.
 * @param {string[]} values
 * @returns {string[]}
 */
function sortBytes(values) {
    return [...values].sort((a, b) => Buffer.compare(Buffer.from(a, 'utf8'), Buffer.from(b, 'utf8')));
}

/**
 * @param {SourceModel} model
 * @returns {string} 16 hex
 */
export function modelRevision(model) {
    const hash = createHash('sha256');
    /** @param {number} n */
    const putLen = (n) => { hash.update(uvarint(n)); };
    /** @param {string} s */
    const put = (s) => {
        const bytes = Buffer.from(s, 'utf8');
        putLen(bytes.length);
        hash.update(bytes);
    };
    put('ankimodels-rev/v1');
    put(model.name);
    const fields = model.fields ?? [];
    putLen(fields.length);
    for (const field of fields) { put(field); }
    const templates = model.templates ?? {};
    const names = sortBytes(Object.keys(templates));
    putLen(names.length);
    for (const name of names) {
        put(name);
        const sides = templates[name];
        const keys = sortBytes(Object.keys(sides));
        putLen(keys.length);
        for (const key of keys) {
            put(key);
            put(normContent(sides[key]));
        }
    }
    put(normContent(stripRevMarker(model.css ?? '')));
    put(model.isCloze === true ? 'cloze' : 'standard');
    return hash.digest().subarray(0, 8).toString('hex');
}
