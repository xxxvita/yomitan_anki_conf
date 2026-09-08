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
 * Stateless DOM helper for the single shared toolbar row above
 * #dictionary-entries. Two independent consumers (DisplayAnki: user tags +
 * CheckWords + video-examples density toggle; DisplayTranslation: the Ru
 * button) each need "the panel above the entries list", and previously each
 * built its OWN bar via its own `insertBefore(bar, entries)`. That produced
 * two stacked toolbar rows whenever both were active at once, in an order
 * that depended on which consumer's `prepare()` ran first and flipped after
 * every `_removeButton()`/rebuild.
 *
 * This module is the single authority for "find or create that bar": every
 * caller — regardless of order — asks THIS function, so only one bar is ever
 * created, and later callers reliably find the same node instead of racing
 * to insert their own. Holds no state of its own; callers keep whatever
 * references they need.
 * @returns {?{bar: HTMLElement, tags: HTMLElement, actions: HTMLElement}}
 */
export function ensurePopupToolbar() {
    const entries = document.getElementById('dictionary-entries');
    if (entries === null) {
        return null;
    }
    // ⚠️ Same tolerance as the original DisplayAnki._ensurePopupToolbar: a
    // detached #dictionary-entries (no parentElement) is not expected in the
    // real popup/search DOM, but if it ever happens we still build the trio
    // of elements — callers get a usable (if invisible) toolbar instead of a
    // hard null, matching prior behavior exactly.
    const parent = entries.parentElement;

    const existingBar = parent !== null ? parent.querySelector(':scope > .popup-toolbar') : null;
    if (existingBar instanceof HTMLElement) {
        const existingTags = existingBar.querySelector(':scope > .popup-toolbar-tags');
        const existingActions = existingBar.querySelector(':scope > .popup-toolbar-actions');
        if (existingTags instanceof HTMLElement && existingActions instanceof HTMLElement) {
            return {bar: existingBar, tags: existingTags, actions: existingActions};
        }
    }

    const bar = document.createElement('div');
    bar.className = 'popup-toolbar';
    bar.hidden = true;

    const tags = document.createElement('div');
    tags.className = 'popup-toolbar-tags';
    tags.hidden = true;

    const actions = document.createElement('div');
    actions.className = 'popup-toolbar-actions';
    actions.hidden = true;

    bar.appendChild(tags);
    bar.appendChild(actions);
    if (parent !== null) {
        parent.insertBefore(bar, entries);
    }

    return {bar, tags, actions};
}
