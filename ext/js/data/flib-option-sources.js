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
 * `source` записи настроек, после которой НЕ надо перезапускать поиск.
 *
 * ⚠️ Обычная запись настроек рассылает applicationOptionsUpdated, а
 * Frontend и страница поиска на неё делают searchLast — выдача
 * перерисовывается: пропадают отмеченные примеры, идущее сохранение с
 * клипами отменяется. Новый тег из полосы «Теги для Anki» выдачу не меняет,
 * поэтому пишется с этим source, и обе стороны пропускают перепоиск.
 */
export const USER_TAGS_OPTIONS_SOURCE = 'flib-user-tags';
