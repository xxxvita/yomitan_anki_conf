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
 * Полоса перевода фразы над статьями (spec
 * docs/superpowers/specs/2026-11-19-pos-sentence-translation-design.md,
 * «Вид», 18a «Размытие»). Чистый построитель DOM: где полоса стоит и когда
 * её показывать, решает DisplayPosHint.
 *
 * ⚠️ Текст — ответ модели: в DOM он попадает ТОЛЬКО через textContent.
 * ⚠️ Корень помечен scan-disable (и display.js CONTENT_CLICK_EXCLUDE знает
 * `.fc-sentence-tr`): щелчок по русскому слову полосы не должен открывать
 * вложенную карточку.
 */

/**
 * @param {string} text перевод фразы
 * @param {{blurred: boolean, revealed: boolean, onReveal: () => void}} details
 * @returns {HTMLElement}
 */
export function createSentenceTranslationStrip(text, {blurred, revealed, onReveal}) {
    const strip = document.createElement('div');
    strip.className = 'fc-sentence-tr scan-disable';
    strip.setAttribute('role', 'note');
    strip.setAttribute('aria-label', translate('sentence.label'));
    if (!blurred || revealed) {
        const open = document.createElement('div');
        open.className = 'fc-sentence-tr-text';
        open.textContent = text;
        strip.appendChild(open);
        return strip;
    }
    // ⚠️ Как createTranslationCell: блюр на ВНУТРЕННЕМ узле, чтобы фокусное
    // кольцо кнопки оставалось чётким, а inert прячет текст от Tab.
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'fc-sentence-tr-blurred';
    button.title = translate('translation.blurHint');
    button.setAttribute('aria-label', translate('sentence.show'));
    const inner = document.createElement('span');
    inner.className = 'is-blurred';
    inner.setAttribute('aria-hidden', 'true');
    inner.setAttribute('inert', '');
    inner.textContent = text;
    button.appendChild(inner);
    button.addEventListener('click', () => { onReveal(); }, {once: true});
    strip.appendChild(button);
    return strip;
}
