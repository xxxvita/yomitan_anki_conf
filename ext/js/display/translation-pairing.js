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

/**
 * @typedef {{
 *   hostIndex: ?number,
 *   hostDefinition: ?import('dictionary').TermDefinition,
 *   translation: ?import('dictionary').TermDefinition,
 * }} TranslationRow
 */

/**
 * Строгий паринг допустим, только когда оба словаря вышли из одной сборки.
 *
 * ⚠️ Без этой сверки протухший штамп молча поставил бы перевод под чужую
 * статью. Отпечаток кладётся в index.json.revision обоих zip (ТЗ Ш-3), а сюда
 * приходит из api.getDictionaryInfo().
 * @param {{title: string, revision: string}[]} dictionaryInfo
 * @param {{translationDictionary: string, hostDictionary: string}} names
 * @returns {boolean}
 */
export function isStrictPairingAvailable(
    dictionaryInfo,
    {
        translationDictionary,
        hostDictionary,
    },
) {
    const host = dictionaryInfo.find((d) => d.title === hostDictionary);
    const translation = dictionaryInfo.find(
        (d) => d.title === translationDictionary,
    );
    if (typeof host === 'undefined' || typeof translation === 'undefined') {
        return false;
    }
    return host.revision.length > 0 && host.revision === translation.revision;
}

/**
 * Складывает определения ОДНОЙ статьи в ряды «оригинал + перевод».
 *
 * ⚠️ ХОЗЯИН НАЗВАН ПОИМЁННО, а не «любой непереводной словарь»: у пользователя
 * может стоять второй английский словарь с чужими sequence.
 *
 * ⚠️ СМЕШАННОГО РЕЖИМА НЕТ: либо все пары строгие, либо все переводы сироты.
 * Часть строгими, часть по заголовку — состояние, в котором причину увиденного
 * не восстановить.
 * @param {{definitions: import('dictionary').TermDefinition[]}} dictionaryEntry
 * @param {{translationDictionary: string, hostDictionary: string, strict: boolean}} options
 * @returns {TranslationRow[]}
 */
export function pairDefinitions(
    dictionaryEntry,
    {
        translationDictionary,
        hostDictionary,
        strict,
    },
) {
    /** @type {TranslationRow[]} */
    const rows = [];
    /** @type {TranslationRow[]} */
    const translations = [];

    for (const [hostIndex, definition] of dictionaryEntry.definitions.entries()) {
        if (definition.dictionary === translationDictionary) {
            translations.push({
                hostIndex: null,
                hostDefinition: null,
                translation: definition,
            });
            continue;
        }
        rows.push({
            hostIndex,
            hostDefinition: definition,
            translation: null,
        });
    }

    for (const orphan of translations) {
        const translation = /** @type {import('dictionary').TermDefinition} */ (
            orphan.translation
        );
        const host = strict ? findHost(rows, translation, hostDictionary) : null;
        if (host !== null) {
            host.translation = translation;
        } else {
            rows.push(orphan);
        }
    }
    return rows;
}

/**
 * @param {TranslationRow[]} rows
 * @param {import('dictionary').TermDefinition} translation
 * @param {string} hostDictionary
 * @returns {?TranslationRow}
 */
function findHost(rows, translation, hostDictionary) {
    // ⚠️ Пересечение списков, а не sequences[0]: определения одного словаря с
    // идентичным глоссарием сливаются, объединяя штампы.
    // ⚠️ Штампы <= 0 не в счёт: апстримный словарь пишет 0, отсутствие — -1.
    const stamps = new Set(translation.sequences.filter((s) => s > 0));
    if (stamps.size === 0) {
        return null;
    }
    for (const row of rows) {
        const host = row.hostDefinition;
        if (host === null || row.translation !== null) {
            continue;
        }
        if (host.dictionary !== hostDictionary) {
            continue;
        }
        if (host.sequences.some((s) => stamps.has(s))) {
            return row;
        }
    }
    return null;
}
