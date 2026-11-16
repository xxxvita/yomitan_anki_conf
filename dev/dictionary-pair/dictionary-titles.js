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

// Заголовки словарей пары — как их пишет anki_conf в dict_base.db
// (колонка terms.dictionary) и как их ждёт расширение
// (ext/js/data/flib-dictionary-provisioning.js, FLIB_DICTIONARY_TITLES).

/** Английский хозяин из Викисловаря; его заголовок носит и собранный хозяйский zip. */
export const SOURCE_DICTIONARY = 'wty-en-en';

/** Сочинённые статьи Flibooster; вливаются в хозяйский zip. */
export const AUTHORED_DICTIONARY = 'flibooster-en';

/** Русские статьи; штамп `sequence` = rowid английского хозяина. */
export const TRANSLATION_DICTIONARY = 'flibooster-en-ru';
