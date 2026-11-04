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

/*
 * Карточку Flib-club тащат за пустое место верхней панели (макет
 * flib-drag.jsx: .fc-tb). Само перетаскивание ведёт фронтенд страницы —
 * `frontendBeginPopupDrag` (его же зовёт ручка панели примеров в
 * display-anki.js). Кнопки, поля, переключатели и чипы в панели перетаскивание
 * не начинают.
 */

/** Панели, за которые можно тащить. */
const DRAG_AREAS = '.popup-toolbar, .phrase-toolbar';
/** Внутри панели — интерактивное, не для перетаскивания. */
const INTERACTIVE = 'button, input, textarea, select, a, label, [role=switch], [role=slider], [role=checkbox], [contenteditable], [tabindex]:not([tabindex="-1"])';

export class DisplayDrag {
    /**
     * @param {import('./display.js').Display} display
     */
    constructor(display) {
        /** @type {import('./display.js').Display} */
        this._display = display;
    }

    /** */
    prepare() {
        document.addEventListener('pointerdown', (e) => { this._onPointerDown(e); });
    }

    /**
     * @param {PointerEvent} e
     */
    _onPointerDown(e) {
        if (e.button !== 0) { return; }
        const target = e.target;
        if (!(target instanceof Element)) { return; }
        if (target.closest(DRAG_AREAS) === null || target.closest(INTERACTIVE) !== null) { return; }
        e.preventDefault();
        void this._display.invokeContentOrigin('frontendBeginPopupDrag', {
            pointerId: e.pointerId,
            clientX: e.clientX,
            clientY: e.clientY,
        }).catch(() => {
            // Попап-окно (без iframe) или страница поиска: перетаскивать нечего.
        });
    }
}
