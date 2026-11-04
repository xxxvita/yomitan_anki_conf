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
 * Размер попапа с клавиатуры (макет flib-drag.jsx, уголок role=slider):
 * границы и шаг стрелок.
 */

const MIN_WIDTH = 320;
const MAX_WIDTH = 1200;
const MIN_HEIGHT = 220;
const MAX_HEIGHT = 1000;
/** Шаг стрелки, px. */
const KEY_STEP = 20;

/**
 * One arrow step. Only the axis of the step changes, and the limit applies
 * only in the step's direction: a popup already wider than 1200 (mouse and
 * settings are not limited) is not snapped back by an unrelated key.
 * @param {{width: number, height: number}} current
 * @param {[number, number]} delta
 * @returns {{width: number, height: number}}
 */
export function stepPopupSize(current, [dx, dy]) {
    return {
        width: Math.round(stepAxis(current.width, dx, MIN_WIDTH, MAX_WIDTH)),
        height: Math.round(stepAxis(current.height, dy, MIN_HEIGHT, MAX_HEIGHT)),
    };
}

/**
 * @param {number} value
 * @param {number} delta
 * @param {number} min
 * @param {number} max
 * @returns {number}
 */
function stepAxis(value, delta, min, max) {
    if (delta > 0) { return value >= max ? value : Math.min(max, value + delta); }
    if (delta < 0) { return value <= min ? value : Math.max(min, value + delta); }
    return value;
}

/**
 * @param {KeyboardEvent} event
 * @returns {?[number, number]} Сдвиг [ширина, высота]; null — клавиша не наша
 *   (с модификатором стрелки остаются горячим клавишам).
 */
export function getResizeKeyDelta(event) {
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) { return null; }
    switch (event.key) {
        case 'ArrowRight': return [KEY_STEP, 0];
        case 'ArrowLeft': return [-KEY_STEP, 0];
        case 'ArrowDown': return [0, KEY_STEP];
        case 'ArrowUp': return [0, -KEY_STEP];
        default: return null;
    }
}
