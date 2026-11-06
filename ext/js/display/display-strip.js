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
import {createIcon} from './flib-icons.js';

/*
 * Полоса навигации карточки Flib-club (макет, SideStrip): к кнопкам сайдбара
 * Yomitan (закрыть, назад/вперёд по истории) добавляются «статья ↑/↓» и
 * счётчик «2/3».
 *
 * ⚠️ Счётчик показывает ТЕКУЩУЮ статью Yomitan (display.selectedIndex) — ту,
 * на которую действуют горячие клавиши (Alt+↑/↓, добавить в Anki, озвучить), а
 * не ту, что вверху прокрутки: иначе после ручной прокрутки счётчик и
 * клавиши указывали бы на разные статьи.
 */
export class DisplayStrip {
    /**
     * @param {import('./display.js').Display} display
     */
    constructor(display) {
        /** @type {import('./display.js').Display} */
        this._display = display;
        /** @type {?HTMLButtonElement} */
        this._prev = null;
        /** @type {?HTMLButtonElement} */
        this._next = null;
        /** @type {?HTMLElement} */
        this._count = null;
    }

    /** */
    prepare() {
        const top = document.querySelector('.content-sidebar-top');
        if (top === null) { return; }
        const separator = document.createElement('span');
        separator.className = 'fc-strip-sep';
        separator.setAttribute('aria-hidden', 'true');
        this._prev = this._createButton('fc-strip-prev', 'up', -1);
        this._count = document.createElement('span');
        this._count.className = 'fc-strip-count';
        // Вслух — «Статья 2 из 3» (aria-label), глазами — «2/3».
        this._count.setAttribute('role', 'status');
        this._count.setAttribute('aria-atomic', 'true');
        this._count.hidden = true;
        this._next = this._createButton('fc-strip-next', 'chev', 1);
        top.append(separator, this._prev, this._count, this._next);
        this._updateLabels();
        this._display.on('optionsUpdated', () => { this._updateLabels(); });
        this._display.on('contentUpdateComplete', () => { this._update(); });
        this._display.on('currentEntryChanged', () => { this._update(); });
        // Пока ищется новое слово, «2/5» прошлого не должен висеть.
        // ⚠️ contentClear приходит ДО очистки dictionaryEntries — читать их нельзя.
        this._display.on('contentClear', () => { this._reset(); });
        this._update();
    }

    /**
     * @param {string} className
     * @param {string} icon
     * @param {number} offset
     * @returns {HTMLButtonElement}
     */
    _createButton(className, icon, offset) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = `sidebar-button ${className}`;
        button.appendChild(createIcon(icon));
        button.addEventListener('click', () => { this._display.moveCurrentEntry(offset); });
        return button;
    }

    /** Подписи меняются вместе с языком, а кнопки живут всё время окна. */
    _updateLabels() {
        for (const [button, key] of /** @type {[?HTMLButtonElement, string][]} */ ([[this._prev, 'strip.prev'], [this._next, 'strip.next']])) {
            if (button === null) { continue; }
            button.title = translate(key);
            button.setAttribute('aria-label', translate(key));
        }
    }

    /** Нет выдачи: счётчик скрыт, кнопки недоступны. */
    _reset() {
        if (this._prev === null || this._next === null || this._count === null) { return; }
        this._prev.disabled = true;
        this._next.disabled = true;
        this._count.hidden = true;
        this._count.textContent = '';
        this._count.removeAttribute('aria-label');
    }

    /** */
    _update() {
        if (this._prev === null || this._next === null || this._count === null) { return; }
        const total = this._display.dictionaryEntries.length;
        const index = this._display.selectedIndex;
        const focused = document.activeElement;
        this._prev.disabled = total <= 1 || index <= 0;
        this._next.disabled = total <= 1 || index >= total - 1;
        // ⚠️ Кнопка, ставшая недоступной под фокусом, уронила бы фокус на body:
        // клавиатурный пользователь у последней статьи терял бы место.
        if (focused === this._next && this._next.disabled && !this._prev.disabled) { this._prev.focus(); }
        if (focused === this._prev && this._prev.disabled && !this._next.disabled) { this._next.focus(); }
        this._count.hidden = total <= 1;
        const text = total > 1 ? `${index + 1}/${total}` : '';
        // Только при изменении: повтор того же текста часть дикторов зачитывает снова.
        if (this._count.textContent !== text) {
            this._count.textContent = text;
            this._count.setAttribute('aria-label', total > 1 ? translate('nav.entryPosition', {index: index + 1, total}) : '');
        }
    }
}
