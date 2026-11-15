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
