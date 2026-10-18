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

// `backup()` из node:sqlite (Node >= 22.16 / 23.8) отсутствует в @types/node 22.10,
// который стоит в проекте. Дополнение по документации Node; убрать, когда
// @types/node догонит.

import type {DatabaseSync} from 'node:sqlite';

declare module 'node:sqlite' {
    type BackupOptions = {
        /** Имя исходной базы (по умолчанию 'main'). */
        source?: string;
        /** Имя базы назначения (по умолчанию 'main'). */
        target?: string;
        /** Страниц за шаг (по умолчанию 100). */
        rate?: number;
        /** Вызывается после каждого шага: всего страниц и сколько осталось. */
        progress?: (progress: {totalPages: number, remainingPages: number}) => void;
    };

    /**
     * Онлайн-копия базы в файл path.
     * @param {DatabaseSync} sourceDb открытая база-источник
     * @param {string} path файл назначения (создаётся)
     * @param {{source?: string, target?: string, rate?: number, progress?: (progress: {totalPages: number, remainingPages: number}) => void}} [options]
     *   имена баз, страниц за шаг; progress вызывается после каждого шага
     * @returns {Promise<number>} число скопированных страниц
     */
    function backup(sourceDb: DatabaseSync, path: string, options?: BackupOptions): Promise<number>;
}
