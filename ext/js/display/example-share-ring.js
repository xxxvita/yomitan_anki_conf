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
 * Кружок «доля знакомых слов» на миниатюре карточки YouTube-примера: число и цвет берутся от ОДНОГО округлённого
 * процента. Чистые функции + DOM только через createElement/createElementNS/textContent/setAttribute.
 */

const SVG_NS = 'http://www.w3.org/2000/svg';

/**
 * @param {number} percent Rounded 0..100.
 * @returns {'high'|'mid'|'low'}
 */
export function getShareLevel(percent) {
    if (percent >= 80) { return 'high'; }
    if (percent >= 60) { return 'mid'; }
    return 'low';
}

/**
 * @param {string} name
 * @param {string[][]} attributes [name, value] pairs.
 * @returns {SVGElement}
 */
function createSvgElement(name, attributes) {
    const element = document.createElementNS(SVG_NS, name);
    for (const [key, value] of attributes) { element.setAttribute(key, value); }
    return /** @type {SVGElement} */ (element);
}

/**
 * @param {unknown} share 0..1 (clamped); anything but a finite number — no ring.
 * @param {(percent: number) => string} describe Text of the tooltip and of the accessible name.
 * @returns {?HTMLElement}
 */
export function createShareRing(share, describe) {
    if (typeof share !== 'number' || !Number.isFinite(share)) { return null; }
    const percent = Math.round(Math.min(1, Math.max(0, share)) * 100);
    const text = describe(percent);

    const ring = document.createElement('span');
    ring.className = 've-gw-ring';
    ring.dataset.level = getShareLevel(percent);
    ring.setAttribute('role', 'img');
    ring.setAttribute('aria-label', text);
    ring.setAttribute('title', text);

    const svg = createSvgElement('svg', [['viewBox', '0 0 36 36'], ['aria-hidden', 'true']]);
    const circle = (/** @type {string} */ cls, /** @type {string[][]} */ extra) => createSvgElement('circle', [
        ['class', cls], ['cx', '18'], ['cy', '18'], ['r', '15.5'], ['fill', 'none'], ['stroke-width', '4'], ...extra,
    ]);
    svg.appendChild(circle('ve-gw-ring-track', []));
    svg.appendChild(circle('ve-gw-ring-arc', [
        ['stroke-linecap', 'round'], ['pathLength', '100'], ['stroke-dasharray', `${percent} 100`], ['transform', 'rotate(-90 18 18)'],
    ]));
    ring.appendChild(svg);

    const number = document.createElement('span');
    number.className = 've-gw-ring-n';
    number.setAttribute('aria-hidden', 'true');
    number.textContent = String(percent);
    ring.appendChild(number);
    return ring;
}
