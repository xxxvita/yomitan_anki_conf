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

import {isTrustedFlibGatewayUrl, normalizeFlibGatewayUrl, normalizeFlibPersonalKey, resolveFlibGatewayBase} from './flib-service-config.js';

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
 * Предупреждения импорта для одной ветки `flibService` — часть штатного
 * механизма предупреждений импорта (BackupController._settingsImportSanitize*).
 *
 * - Годный адрес на чужой хост (не flib.club и не localhost) — предупреждение;
 *   при санитизации (`dryRun === false`) адрес сбрасывается в пусто (= сервер
 *   по умолчанию). Как `anki.server`: принять его можно только явным отказом
 *   от санитизации.
 * - Негодный адрес или ключ — только предупреждение: их заменяет
 *   {@link reconcileFlibServiceOnImport} всегда, согласен человек или нет.
 *
 * ⚠️ В тексте предупреждений нет значений: ключ — учётные данные.
 * @param {unknown} flibService
 * @param {boolean} dryRun
 * @returns {string[]}
 */
export function getFlibServiceImportWarnings(flibService, dryRun) {
    const service = asRecord(flibService);
    if (service === null) { return []; }
    /** @type {string[]} */
    const warnings = [];
    const url = normalizeFlibGatewayUrl(/** @type {string} */ (service.gatewayUrl));
    if (!url.valid) {
        warnings.push('flibService.gatewayUrl is not a valid gateway URL (https://, or http:// for localhost only); the current value will be kept');
    } else if (!isTrustedFlibGatewayUrl(url.value)) {
        warnings.push('flibService.gatewayUrl points to a host other than the Flib server or localhost');
        if (!dryRun) {
            service.gatewayUrl = '';
        }
    }
    const key = normalizeFlibPersonalKey(/** @type {string} */ (service.personalKey));
    if (!key.valid) {
        warnings.push('flibService.personalKey has an invalid format; the current key will be kept');
    }
    return warnings;
}

/**
 * Сводит `flibService` импортируемых настроек с текущими. Вызывается ВСЕГДА,
 * после санитизации, до сохранения.
 *
 * ⚠️ Выгрузка ВСЕГДА вычищает ключ ({@link redactFlibSecrets}), поэтому любой
 * файл, сделанный этим же расширением, приносит `personalKey: ''`. Без переноса
 * «выгрузил — загрузил обратно» молча снимал бы ключ.
 *
 * ⚠️⚠️ H1: ключ переносится ТОЛЬКО на тот же сервер. Иначе файл с
 * `gatewayUrl: "https://evil.example"` и пустым ключом получал бы текущий ключ,
 * и первый же запрос отдал бы его чужому хосту. Сравниваются действующие базы
 * (resolveFlibGatewayBase), поэтому '' и 'wss://cache.flib.club/' — один сервер.
 *
 * Правила по профилю (источник — текущий профиль с тем же индексом, а при разном
 * числе профилей — текущий профиль 0, потому что индексам тогда верить нельзя):
 * - адрес: годный → срезанный; негодный → годный адрес источника, иначе '';
 * - ключ: годный непустой → срезанный (явное намерение человека); пустой или
 *   негодный → ключ источника, если сервер тот же, иначе ''.
 *
 * Правит `importedOptionsFull` НА МЕСТЕ: это свежий объект из разобранного
 * файла. Кривые формы пропускаются молча.
 * @param {unknown} importedOptionsFull
 * @param {unknown} currentOptionsFull
 */
export function reconcileFlibServiceOnImport(importedOptionsFull, currentOptionsFull) {
    const importedProfiles = asRecord(importedOptionsFull)?.profiles;
    if (!Array.isArray(importedProfiles)) { return; }
    const currentProfilesValue = asRecord(currentOptionsFull)?.profiles;
    const currentProfiles = Array.isArray(currentProfilesValue) ? /** @type {unknown[]} */ (currentProfilesValue) : [];
    const sameShape = importedProfiles.length === currentProfiles.length;
    for (let i = 0; i < importedProfiles.length; ++i) {
        const service = getFlibService(importedProfiles[i]);
        if (service === null) { continue; }
        const source = getFlibService(currentProfiles[sameShape ? i : 0]);
        const sourceUrl = normalizeFlibGatewayUrl(/** @type {string} */ (source?.gatewayUrl));
        const sourceKey = normalizeFlibPersonalKey(/** @type {string} */ (source?.personalKey));

        const url = normalizeFlibGatewayUrl(/** @type {string} */ (service.gatewayUrl));
        if (url.valid) {
            service.gatewayUrl = url.value;
        } else {
            service.gatewayUrl = sourceUrl.valid ? sourceUrl.value : '';
        }

        const key = normalizeFlibPersonalKey(/** @type {string} */ (service.personalKey));
        if (key.valid && key.value !== '') {
            service.personalKey = key.value;
            continue;
        }
        const sameServer = sourceUrl.valid &&
        resolveFlibGatewayBase(/** @type {string} */ (service.gatewayUrl)) === resolveFlibGatewayBase(sourceUrl.value);
        service.personalKey = (sameServer && sourceKey.valid) ? sourceKey.value : '';
    }
}
