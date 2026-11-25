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

import {translate} from '../i18n/ui-language.js';

/*
 * Полоса перевода в окне фразы (spec
 * docs/superpowers/specs/2026-11-25-key-panel-settings-phrase-translation-design.md
 * §1): перевод, который не попал в поле «Перевод», потому что там текст
 * пользователя. Чистый построитель DOM: где полоса стоит и что делают кнопки,
 * решает DisplayPosHint.
 *
 * ⚠️ Текст — ответ модели: в DOM он попадает ТОЛЬКО через textContent.
 * ⚠️ scan-disable — как у createSentenceTranslationStrip: щелчок по русскому
 * слову не должен открывать вложенную карточку.
 */

/**
 * @param {string} text перевод фразы
 * @param {{onInsert: () => void, onClose: () => void}} details
 * @returns {HTMLElement}
 */
export function createPhraseTranslationStrip(text, {onInsert, onClose}) {
    const strip = document.createElement('div');
    strip.className = 'fc-phrase-tr scan-disable';
    strip.setAttribute('role', 'status');
    const content = document.createElement('div');
    content.className = 'fc-phrase-tr-text';
    content.textContent = text;
    const insert = document.createElement('button');
    insert.type = 'button';
    insert.className = 'fc-btn fc-phrase-tr-insert';
    insert.textContent = translate('pos.phraseInsert');
    insert.addEventListener('click', () => { onInsert(); });
    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'fc-btn fc-btn-ghost fc-btn-ico fc-phrase-tr-close';
    close.textContent = '×';
    close.title = translate('pos.phraseClose');
    close.setAttribute('aria-label', close.title);
    close.addEventListener('click', () => { onClose(); });
    strip.append(content, insert, close);
    return strip;
}
