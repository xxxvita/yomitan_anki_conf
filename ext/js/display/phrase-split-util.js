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

/**
 * Pure helpers for the phrase card's expression/translation splitter
 * (card redesign stage 6, mock `flib-phrase.jsx`).
 */

/** Smallest share of the expression pane (wide layout); mock: 25–75 %, so neither pane gets unreadably thin. */
export const PHRASE_SPLIT_MIN = 0.25;

/** Largest share of the expression pane (wide layout). */
export const PHRASE_SPLIT_MAX = 0.75;

/** One arrow key press moves the wide splitter by this share. */
export const PHRASE_SPLIT_KEY_STEP = 0.05;

/** One arrow key press changes the top pane height (narrow layout) by this many px. */
export const PHRASE_TOP_KEY_STEP_PX = 20;

/** Below this width, in em of the card font, the panes stack vertically. */
const NARROW_WIDTH_EM = 26;

/**
 * @param {number} value
 * @returns {boolean} A finite number above zero (NaN is not).
 */
export function isPositiveNumber(value) {
    return Number.isFinite(value) && value > 0;
}

/**
 * @param {number} ratio
 * @returns {number} The share clamped to [MIN, MAX]; 0.5 for NaN/±Infinity (corrupt storage).
 */
export function clampPhraseSplitRatio(ratio) {
    if (!Number.isFinite(ratio)) { return 0.5; }
    return Math.max(PHRASE_SPLIT_MIN, Math.min(PHRASE_SPLIT_MAX, ratio));
}

/**
 * @param {string} key `KeyboardEvent.key`
 * @param {boolean} vertical Narrow (stacked) layout.
 * @returns {-1|0|1} Direction: wide — ←/→, narrow — ↑/↓; any other key 0.
 */
export function getPhraseSplitStep(key, vertical) {
    const [back, forward] = vertical ? ['ArrowUp', 'ArrowDown'] : ['ArrowLeft', 'ArrowRight'];
    if (key === back) { return -1; }
    if (key === forward) { return 1; }
    return 0;
}

/**
 * @param {number} widthPx Width of the split container.
 * @param {number} fontSizePx Its computed font size.
 * @returns {boolean} Whether to stack the panes. A hidden container (width 0)
 *   or a broken font size keeps the wide layout.
 */
export function isPhraseSplitNarrow(widthPx, fontSizePx) {
    if (!isPositiveNumber(widthPx) || !isPositiveNumber(fontSizePx)) { return false; }
    return widthPx < fontSizePx * NARROW_WIDTH_EM;
}

/**
 * @param {number} heightPx Requested top pane height.
 * @param {number} fontSizePx Computed font size of the split container.
 * @returns {number} Height clamped to [3.5em, 20em]; NaN → the minimum.
 */
export function clampPhraseTopHeight(heightPx, fontSizePx) {
    const min = fontSizePx * 3.5;
    const max = fontSizePx * 20;
    if (!Number.isFinite(heightPx)) { return min; }
    return Math.max(min, Math.min(max, heightPx));
}
