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
const RADIUS = 14.5;
const STROKE = 3;
/** One round cap overshoots the dash by stroke/2; in pathLength units (the circle is 100) that is this much. */
const CAP = (STROKE / 2) / (2 * Math.PI * RADIUS) * 100;

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
 * The arc. Painted length = dash + the round caps, so the dash is `percent - 2 * CAP` and starts CAP after the top
 * (dashoffset -CAP): the painted span is exactly [0, percent]. Where the caps alone would eat the percent
 * (below 4), butt caps and a plain dash; 100 is a full closed circle.
 * @param {(cls: string, extra: string[][]) => SVGElement} circle
 * @param {number} percent 1..100
 * @returns {SVGElement}
 */
function createArc(circle, percent) {
    const round = percent >= 4;
    if (!round || percent === 100) {
        return circle('ve-gw-ring-arc', [
            ['stroke-linecap', round ? 'round' : 'butt'], ['pathLength', '100'], ['stroke-dasharray', `${percent} 100`], ['transform', 'rotate(-90 18 18)'],
        ]);
    }
    return circle('ve-gw-ring-arc', [
        ['stroke-linecap', 'round'],
        ['pathLength', '100'],
        ['stroke-dasharray', `${percent - (2 * CAP)} 100`],
        ['stroke-dashoffset', String(-CAP)],
        ['transform', 'rotate(-90 18 18)'],
    ]);
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
        ['class', cls], ['cx', '18'], ['cy', '18'], ['r', String(RADIUS)], ['fill', 'none'], ['stroke-width', String(STROKE)], ...extra,
    ]);
    svg.appendChild(circle('ve-gw-ring-track', []));
    // 0 — no arc at all: a round cap on a zero dash would paint a dot.
    if (percent > 0) { svg.appendChild(createArc(circle, percent)); }
    ring.appendChild(svg);

    const number = document.createElement('span');
    number.className = 've-gw-ring-n';
    number.setAttribute('aria-hidden', 'true');
    number.textContent = String(percent);
    ring.appendChild(number);
    return ring;
}
