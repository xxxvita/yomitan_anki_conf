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
 * @param {unknown} value
 * @returns {?Record<string, unknown>}
 */
function asRecord(value) {
    return typeof value === 'object' && value !== null ?
        /** @type {Record<string, unknown>} */ (value) :
        null;
}

/**
 * Убирает личный ключ из копии настроек, готовящейся к выгрузке.
 *
 * ⚠️ Клонирует, а не правит на месте: тот же объект приходит из
 * settingsController и продолжает жить как настройки пользователя.
 * ⚠️ Ключ — учётные данные; файлы резервных копий пересылают.
 *
 * ⚠️ **Отказ закрытый, а не открытый.** Раньше неожиданная форма `profiles`
 * молча возвращала клон КАК ЕСТЬ — то есть функция, единственная работа
 * которой снять учётные данные, на непонятном входе отдавала их наружу. Для
 * такой функции «не понял — пропустил» неверно по определению: файл выгрузки
 * пересылают в поддержку. Форма не подтвердилась ⇒ выгрузки нет.
 * @template T
 * @param {T} optionsFull
 * @returns {T}
 * @throws {Error} если `profiles` не массив — форму не подтвердить, и отдавать
 *   непроверенные настройки наружу нельзя.
 */
export function redactFlibSecrets(optionsFull) {
    const clone = structuredClone(optionsFull);
    const profiles = /** @type {{profiles?: unknown}} */ (clone).profiles;
    if (!Array.isArray(profiles)) {
        throw new Error('flib: unexpected options shape, refusing to export unredacted settings');
    }
    for (const profile of /** @type {unknown[]} */ (profiles)) {
        const options = asRecord(asRecord(profile)?.options);
        if (options === null || !Object.hasOwn(options, 'flibService')) {
            continue;
        }
        const service = asRecord(options.flibService);
        if (service === null) {
            // ⚠️ Ветка есть, но это не объект: разобрать её нечем, а ключ мог
            // лежать прямо в ней (строкой). Убираем целиком — оставить «как
            // было» значило бы вынести его в файл.
            delete options.flibService;
            continue;
        }
        service.personalKey = '';
    }
    return clone;
}

/**
 * @param {unknown} profile
 * @returns {?Record<string, unknown>}
 */
function getFlibService(profile) {
    return asRecord(asRecord(asRecord(profile)?.options)?.flibService);
}

/**
 * Не даёт импорту настроек стереть личный ключ.
 *
 * ⚠️ Выгрузка ВСЕГДА вычищает ключ ({@link redactFlibSecrets}), поэтому любой
 * файл, сделанный этим же расширением, приносит `personalKey: ''`. Без этой
 * функции «выгрузил — загрузил обратно» молча снимал бы ключ, и примеры
 * переставали бы работать без видимой причины.
 *
 * Правило: пустой (после trim) ключ импортируемого профиля заменяется ключом
 * текущего профиля С ТЕМ ЖЕ ИНДЕКСОМ; если число профилей разное, индексам
 * верить нельзя (профили могли быть удалены/добавлены), и берётся ключ текущего
 * профиля 0. Непустой ключ из файла побеждает — это явное намерение человека.
 *
 * Правит `importedOptionsFull` НА МЕСТЕ: это свежий объект из разобранного
 * файла, у него нет других владельцев. Кривые формы пропускаются молча — это
 * сохранение удобства, а не проверка файла (её делает OptionsUtil).
 * @param {unknown} importedOptionsFull
 * @param {unknown} currentOptionsFull
 */
export function preserveFlibKeysOnImport(importedOptionsFull, currentOptionsFull) {
    const importedProfiles = asRecord(importedOptionsFull)?.profiles;
    const currentProfiles = asRecord(currentOptionsFull)?.profiles;
    if (!Array.isArray(importedProfiles) || !Array.isArray(currentProfiles)) { return; }
    const sameShape = importedProfiles.length === currentProfiles.length;
    for (let i = 0; i < importedProfiles.length; ++i) {
        const service = getFlibService(importedProfiles[i]);
        if (service === null) { continue; }
        const importedKey = service.personalKey;
        if (typeof importedKey === 'string' && importedKey.trim() !== '') { continue; }
        const currentKey = getFlibService(currentProfiles[sameShape ? i : 0])?.personalKey;
        if (typeof currentKey === 'string' && currentKey.trim() !== '') {
            service.personalKey = currentKey;
        }
    }
}
