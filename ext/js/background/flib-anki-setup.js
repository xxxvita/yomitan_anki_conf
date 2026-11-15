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

/*
 * Колода «Flibooster» и три типа заметок, если их нет в Anki — как установщик
 * Flibooster (anki_conf internal/cli/anki_bootstrap.go, BootstrapInstall).
 *
 * ⚠️ Существующий тип НИКОГДА не пересоздаётся и его шаблоны/CSS не меняются:
 * обновляет их Flibooster («Обновить устаревшие типы», по метке ревизии).
 * Добавляются только недостающие поля — как бутстрап `data`/`flib_media`.
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
 * @param {string} code
 * @param {string} message
 * @returns {ExtensionError}
 */
function setupError(code, message) {
    const error = new ExtensionError(code);
    error.data = {code, status: null, message};
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
 * @param {FlibAnkiSetupClient} anki
 * @param {ReadonlyArray<import('flib-anki-models').FlibAnkiModel>} models
 * @param {string} deck
 * @returns {Promise<{created: string[], fieldsAdded: string[], deckOk: boolean}>}
 * @throws {ExtensionError} anki_model_failed / anki_model_outdated
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
                throw setupError('anki_model_failed', `${model.name}: ${e instanceof Error ? e.message : String(e)}`);
            }
            continue;
        }
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
                    throw setupError('anki_model_outdated', `${model.name}.${field}: ${e instanceof Error ? e.message : String(e)}`);
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
        throw setupError('anki_deck_failed', `${deck}: ${e instanceof Error ? e.message : String(e)}`);
    }
    return {created, fieldsAdded, deckOk: true};
}
