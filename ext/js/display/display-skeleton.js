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
 * Скелетон «Идёт поиск» карточки Flib-club (макет flib-states.jsx, cardState
 * 'loading'). Попап со страницы приходит уже с результатом — ждать там нечего;
 * ожидание видно, когда поиск ведёт сама карточка: страница поиска, переход по
 * истории, поиск по щелчку на месте. Появляется только если поиск дольше
 * SKELETON_DELAY_MS — быстрый поиск не мигает.
 */

/** Задержка показа, мс. */
export const SKELETON_DELAY_MS = 200;

/**
 * @param {HTMLElement} container `#dictionary-entries`.
 * @returns {() => void} Остановить: снять таймер и убрать скелетон.
 */
export function startSearchSkeleton(container) {
    /** @type {?HTMLElement} */
    let node = null;
    /** @type {?ReturnType<typeof setTimeout>} */
    let timer = setTimeout(() => {
        timer = null;
        // Уже есть статьи (или что-то своё) — поверх не ставим.
        if (container.childElementCount > 0) { return; }
        node = document.createElement('div');
        node.className = 'fc-skel';
        node.setAttribute('aria-busy', 'true');
        node.setAttribute('aria-label', 'Идёт поиск');
        node.setAttribute('role', 'status');
        for (const width of ['40%', '28%', '92%', '80%', '86%']) {
            const bar = document.createElement('i');
            bar.style.width = width;
            node.appendChild(bar);
        }
        container.appendChild(node);
    }, SKELETON_DELAY_MS);
    return () => {
        if (timer !== null) {
            clearTimeout(timer);
            timer = null;
        }
        if (node !== null) {
            node.remove();
            node = null;
        }
    };
}
