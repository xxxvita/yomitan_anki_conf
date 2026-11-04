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
 * Иконки карточки Flib-club (макет, flib-ui.jsx): контурные SVG 24×24,
 * цвет — currentColor, размер — 1.15em (класс fc-ico в flib-card.css).
 */

/** @type {Record<string, string>} */
const PATHS = {
    plus: 'M12 5v14 M5 12h14',
    check: 'M5 12.5l4.5 4.5L19 7',
    chev: 'M6 9l6 6 6-6',
    up: 'M6 15l6-6 6 6',
    card: 'M4 6h16v12H4z M8 10h8 M8 14h5',
    alert: 'M12 8.5v4.5 M12 16.2h.01 M10.3 4L2.6 17.5A2 2 0 0 0 4.3 20.5h15.4a2 2 0 0 0 1.7-3L13.7 4a2 2 0 0 0-3.4 0z',
    tag: 'M3.5 12.5V4.5h8l9 9-8 8-9-9z M8 8.5h.01',
    pin: 'M9 3.5h6l-1 6 3 3.5H7l3-3.5-1-6z M12 13v7.5',
    refresh: 'M19.5 12a7.5 7.5 0 1 1-2.2-5.3 M19.5 4.5v4.5H15',
    x: 'M6 6l12 12 M18 6L6 18',
    chevR: 'M9 6l6 6-6 6',
    clip: 'M9 4h6v3H9z M7.5 5.5H5v14.5h14V5.5h-2.5 M8.5 12h7 M8.5 15.5h4.5',
};

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {keyof PATHS|string} name
 * @param {{strokeWidth?: number}} [options]
 * @returns {SVGSVGElement}
 */
export function createIcon(name, {strokeWidth = 1.7} = {}) {
    const svg = /** @type {SVGSVGElement} */ (document.createElementNS(SVG_NS, 'svg'));
    svg.setAttribute('class', 'fc-ico');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none');
    svg.setAttribute('stroke', 'currentColor');
    svg.setAttribute('stroke-width', `${strokeWidth}`);
    svg.setAttribute('stroke-linecap', 'round');
    svg.setAttribute('stroke-linejoin', 'round');
    svg.setAttribute('aria-hidden', 'true');
    const path = document.createElementNS(SVG_NS, 'path');
    path.setAttribute('d', PATHS[name] ?? '');
    svg.appendChild(path);
    return svg;
}
