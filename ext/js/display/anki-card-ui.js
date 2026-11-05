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

import {translatePlural} from '../i18n/ui-language.js';

/*
 * Состояние кнопки Anki в шапке статьи (макет «Карточка Flib-club»,
 * flib-anki.jsx). Чистые функции: DisplayAnki собирает факты о заметке
 * (`noteMap` из `_getDictionaryEntryDetails`) и по ответу этих функций
 * оформляет свои же кнопки save-note / view-note — логика сохранения не меняется.
 */

/**
 * @typedef {object} NoteStateInput
 * @property {?Error} ankiError Ошибка запроса к Anki по этой заметке.
 * @property {boolean} canAdd Anki разрешает добавить (поля и модель в порядке).
 * @property {number} noteCount Сколько заметок с этим словом уже есть.
 * @property {import('settings').AnkiDuplicateBehavior} duplicateBehavior
 * @property {boolean} saving Сохранение этого формата идёт прямо сейчас.
 */

/**
 * @typedef {object} NoteState
 * @property {'add'|'saving'|'open'|'off'|'hidden'|'disabled'} kind
 *   add — «＋ В Anki»; saving — «Сохраняю…»; open — «Открыть в Anki ▾»;
 *   off — Anki не запущена; hidden — иная ошибка Anki (кнопка скрыта, как в
 *   Yomitan); disabled — добавить нельзя, заметок нет.
 * @property {boolean} addAgain В меню «▾» есть «Добавить повторно».
 * @property {boolean} replace В меню «▾» есть «Заменить карточку».
 */

/** Текст ошибки AnkiConnect, когда Anki не отвечает (anki-connect.js). */
export const ANKI_NOT_CONNECTED = 'Anki not connected';

/**
 * @param {NoteStateInput} input
 * @returns {NoteState}
 */
export function describeNoteState({ankiError, canAdd, noteCount, duplicateBehavior, saving}) {
    const none = {addAgain: false, replace: false};
    if (ankiError !== null) {
        return {kind: ankiError.message === ANKI_NOT_CONNECTED ? 'off' : 'hidden', ...none};
    }
    if (saving) { return {kind: 'saving', ...none}; }
    if (noteCount > 0) {
        return {kind: 'open', addAgain: duplicateBehavior !== 'prevent', replace: true};
    }
    return {kind: canAdd ? 'add' : 'disabled', ...none};
}

/**
 * Тег Anki не может содержать пробелов: внутренние становятся «_».
 * @param {string} raw
 * @returns {?string}
 */
export function normalizeNewTag(raw) {
    const tag = raw.trim().replace(/\s+/g, '_');
    return tag.length > 0 ? tag : null;
}

/**
 * Формат карточки без колоды или типа записи заметку создать не может
 * (canAdd=false всегда) — в карточке его кнопку не показываем.
 * @param {{deck: string, model: string}} cardFormat
 * @returns {boolean}
 */
export function isCardFormatConfigured({deck, model}) {
    return deck.length > 0 && model.length > 0;
}

/**
 * @param {number} n
 * @param {string} one
 * @param {string} few
 * @param {string} many
 * @returns {string}
 */
export function pluralRu(n, one, few, many) {
    const m10 = n % 10;
    const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) { return one; }
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) { return few; }
    return many;
}

/**
 * @param {number} count
 * @returns {string}
 */
export function formatExistingStatus(count) {
    return translatePlural('anki.existing', count);
}
