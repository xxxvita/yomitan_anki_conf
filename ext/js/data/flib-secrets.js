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
 * Убирает личный ключ из копии настроек, готовящейся к выгрузке.
 *
 * ⚠️ Клонирует, а не правит на месте: тот же объект приходит из
 * settingsController и продолжает жить как настройки пользователя.
 * ⚠️ Ключ — учётные данные; файлы резервных копий пересылают.
 * @template T
 * @param {T} optionsFull
 * @returns {T}
 */
export function redactFlibSecrets(optionsFull) {
    const clone = structuredClone(optionsFull);
    const profiles = /** @type {{options?: {flibService?: {personalKey: string}}}[]} */ (
        /** @type {unknown} */ (
            /** @type {{profiles?: unknown}} */ (clone).profiles
        )
    );
    if (!Array.isArray(profiles)) {
        return clone;
    }
    for (const profile of profiles) {
        const service = profile?.options?.flibService;
        if (service) {
            service.personalKey = '';
        }
    }
    return clone;
}
