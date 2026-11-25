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

import {ExtensionError} from '../core/extension-error.js';
import {FLIB_PHRASES_MODEL} from '../data/flib-anki-models.js';
import {getAnkiRouteErrorCode} from './flib-phrase-model.js';

/*
 * Колода «Flibooster» и три типа заметок, если их нет в Anki — как установщик
 * Flibooster (anki_conf internal/cli/anki_bootstrap.go, BootstrapInstall).
 *
 * ⚠️ Существующий тип НИКОГДА не пересоздаётся и его шаблоны/CSS не меняются:
 * обновляет их Flibooster («Обновить устаревшие типы», по метке ревизии).
 * Добавляются только недостающие поля — как бутстрап `data`/`flib_media`.
 * ⚠️ Phrases не получает и полей: новое поле меняет схему, и AnkiWeb попросил бы
 * полную синхронизацию у всех. Его обновляет первая запись из окна фразы.
 */

/**
 * @typedef {object} FlibAnkiSetupClient
 * @property {() => Promise<string[]>} getModelNames
 * @property {(modelName: string) => Promise<string[]>} getModelFieldNames
 * @property {(modelName: string, fieldName: string, index: number) => Promise<unknown>} modelFieldAdd
 * @property {(model: import('flib-anki-models').FlibAnkiModel) => Promise<void>} createModel
 * @property {(name: string) => Promise<?number>} createDeck
 */

/**
 * @param {string} otherCode Код любой другой ошибки.
 * @param {string} what
 * @param {unknown} e Ошибка AnkiConnect.
 * @returns {ExtensionError} anki_closed / anki_route_switched / otherCode
 */
function createSetupError(otherCode, what, e) {
    const code = getAnkiRouteErrorCode(e) ?? otherCode;
    const error = new ExtensionError(code);
    error.data = {code, status: null, message: `${what}: ${e instanceof Error ? e.message : String(e)}`};
    return error;
}

/**
 * @param {unknown} error
 * @returns {boolean}
 */
function isAlreadyExists(error) {
    return error instanceof Error && error.message.toLowerCase().includes('already exists');
}

/**
 * @param {FlibAnkiSetupClient} anki ⚠️ Вид withoutFallback(адрес): Core с закрытой Anki создал бы типы без наших шаблонов.
 * @param {ReadonlyArray<import('flib-anki-models').FlibAnkiModel>} models
 * @param {string} deck
 * @returns {Promise<{created: string[], fieldsAdded: string[], deckOk: boolean}>}
 * @throws {Error} anki_closed / anki_route_switched / anki_model_failed / anki_model_outdated / anki_deck_failed; ошибка
 *   чтения — как её бросил клиент
 */
export async function ensureFlibAnkiSetup(anki, models, deck) {
    const existing = new Set(await anki.getModelNames());
    /** @type {string[]} */
    const created = [];
    /** @type {string[]} */
    const fieldsAdded = [];
    for (const model of models) {
        if (!existing.has(model.name)) {
            try {
                await anki.createModel(model);
                created.push(model.name);
            } catch (e) {
                // Гонка с Flibooster: он успел создать тот же тип — это не ошибка.
                if (isAlreadyExists(e)) { continue; }
                throw createSetupError('anki_model_failed', model.name, e);
            }
            continue;
        }
        if (model.name === FLIB_PHRASES_MODEL) { continue; }
        const have = await anki.getModelFieldNames(model.name);
        // Anki сравнивает имена полей без учёта регистра.
        const lower = new Set(have.map((name) => name.toLowerCase()));
        let index = have.length;
        for (const field of model.fields) {
            if (lower.has(field.toLowerCase())) { continue; }
            try {
                await anki.modelFieldAdd(model.name, field, index);
            } catch (e) {
                // Поле успел добавить параллельный вызов или Flibooster — цель достигнута.
                if (!isAlreadyExists(e)) {
                    throw createSetupError('anki_model_outdated', `${model.name}.${field}`, e);
                }
            }
            index += 1;
            lower.add(field.toLowerCase());
            fieldsAdded.push(`${model.name}.${field}`);
        }
    }
    // ⚠️ Сбой колоды — сбой установки: новые установки сохраняют карточки
    // именно в неё, и addNote в несуществующую колоду AnkiConnect отвергнет.
    try {
        await anki.createDeck(deck);
    } catch (e) {
        throw createSetupError('anki_deck_failed', deck, e);
    }
    return {created, fieldsAdded, deckOk: true};
}
