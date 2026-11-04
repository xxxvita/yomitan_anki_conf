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
 * Цепочка «форма в тексте ← словарная форма» для шапки статьи
 * (`googling ← google`). Берётся из первичного источника первого заголовка:
 * то, что человек навёл в тексте, и то, к чему его свёл деинфлектор.
 *
 * null — показывать нечего: формы совпадают без учёта регистра (Google ←
 * google — не новость), источника нет или он пуст.
 * @param {import('dictionary').TermHeadword[]} headwords
 * @returns {?{source: string, term: string}}
 */
export function getSourceChain(headwords) {
    const [headword] = headwords;
    if (typeof headword === 'undefined') { return null; }
    const source = headword.sources.find((s) => s.isPrimary) ?? headword.sources[0];
    if (typeof source === 'undefined') { return null; }
    const text = source.originalText.trim();
    if (text.length === 0 || text.toLowerCase() === headword.term.toLowerCase()) { return null; }
    return {source: text, term: headword.term};
}
