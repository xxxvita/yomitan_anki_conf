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

/** Ключ и адрес шлюза в IndexedDB `flib-secrets` (C1). Глобальные, не по профилям. */
export type FlibSecrets = {
    personalKey: string;
    gatewayUrl: string;
};

/** Что видят страницы расширения: маска вместо ключа. */
export type FlibSecretsView = {
    hasKey: boolean;
    /** `tpk_…abcd` или null, если ключа нет. Полный ключ наружу не уходит. */
    keyMasked: string | null;
    gatewayUrl: string;
    /** Заметка миграции (какие профили потеряли свой ключ) или null. */
    migrationNote: string | null;
};
