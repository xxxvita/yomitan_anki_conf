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

// Типизированное чтение строк node:sqlite. Драйвер отдаёт `unknown`; колонка
// не того типа — ошибка, а не тихое приведение: Go-код, который здесь
// переносится, на NULL в строковой колонке тоже падает (Scan в string).

/**
 * @param {unknown} row
 * @param {string} context
 * @returns {Record<string, unknown>}
 * @throws {Error}
 */
export function asRecord(row, context) {
    if (typeof row !== 'object' || row === null) {
        throw new Error(`${context}: строка выборки отсутствует`);
    }
    return /** @type {Record<string, unknown>} */ (row);
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} column
 * @param {string} context
 * @returns {string}
 * @throws {Error}
 */
export function readText(row, column, context) {
    const value = row[column];
    if (typeof value !== 'string') {
        throw new Error(`${context}: колонка ${column} не текст (${value === null ? 'NULL' : typeof value})`);
    }
    return value;
}

/**
 * @param {Record<string, unknown>} row
 * @param {string} column
 * @param {string} context
 * @returns {number}
 * @throws {Error}
 */
export function readInteger(row, column, context) {
    const value = row[column];
    if (typeof value !== 'number' || !Number.isSafeInteger(value)) {
        throw new Error(`${context}: колонка ${column} не целое (${String(value)})`);
    }
    return value;
}
