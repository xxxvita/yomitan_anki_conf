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

import {fetchJson} from '../core/fetch-utilities.js';

/*
 * Типы заметок Flibooster для createModel. Данные — ext/data/flib-anki-models.json,
 * его пишет dev/anki-models/sync.js из дословных копий anki_conf
 * internal/ankimodels/models/*.json; в CSS уже стоит метка ревизии.
 */

/** Колода продукта, как ankimodels.ProductDeckName во Flibooster. */
export const FLIB_PRODUCT_DECK = 'Flibooster';

/** Базовый тип заметки, который обогащает расширение. */
export const FLIB_BASE_MODEL = 'Yomitan Card Type';

/** Тип карточек фраз: его обновляет только запись из окна фразы. */
export const FLIB_PHRASES_MODEL = 'Phrases';

/** Метка ревизии Flibooster (revMarkerRe в anki_conf): всё до первого `*\/` в той же строке и перенос после неё. */
const REV_MARKER_PATTERN = /\/\*[ \t]*ankimodels-rev:[^\n]*?\*\/[ \t]*\n?/g;

/** @type {?Promise<import('flib-anki-models').FlibAnkiModelsFile>} */
let modelsPromise = null;

/**
 * @returns {Promise<import('flib-anki-models').FlibAnkiModelsFile>}
 */
export function loadFlibAnkiModels() {
    if (modelsPromise === null) {
        modelsPromise = /** @type {Promise<import('flib-anki-models').FlibAnkiModelsFile>} */ (fetchJson('/data/flib-anki-models.json'));
        // Сбой не кэшируется: следующий вызов попробует снова.
        modelsPromise.catch(() => { modelsPromise = null; });
    }
    return modelsPromise;
}

/**
 * Шаблон или CSS в том виде, в каком их сравнивают: переносы `\n`, без метки ревизии и пробелов по краям.
 * Переносы заменяются ДО поиска метки: она кончается в своей строке, чем бы строка ни кончалась.
 * @param {string} text
 * @returns {string}
 */
export function normalizeModelContent(text) {
    let result = text.replace(/\r\n?/g, '\n');
    // Удаление одной метки может составить другую.
    for (;;) {
        const next = result.replace(REV_MARKER_PATTERN, '');
        if (next === result) { return next.trim(); }
        result = next;
    }
}

/**
 * Отпечаток шаблона или CSS: им сравнивают установленный тип с новой и прежними версиями.
 * @param {string} text
 * @returns {Promise<string>} sha256, 64 hex
 */
export async function hashModelContent(text) {
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(normalizeModelContent(text)));
    return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/**
 * @param {string} css The CSS of a type of `flib-anki-models.json`: its marker is the first thing in it.
 * @returns {string} 16 hex; empty without a marker.
 */
export function getModelRevision(css) {
    return /^\/\* ankimodels-rev:([0-9a-f]{16}) \*\//.exec(css)?.[1] ?? '';
}
