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
 * @param {string|undefined} url
 * @returns {boolean} Страница ролика: https://www.youtube.com/watch с непустым параметром v.
 */
export function isYoutubeWatchUrl(url) {
    if (typeof url !== 'string') { return false; }
    try {
        const parsed = new URL(url);
        return parsed.protocol === 'https:' &&
        parsed.hostname === 'www.youtube.com' &&
        parsed.pathname === '/watch' &&
        (parsed.searchParams.get('v') ?? '') !== '';
    } catch (e) {
        return false;
    }
}

/**
 * Состояние кнопки «C» в окошке действия.
 * @param {{beta: boolean, panelVisible: boolean, tabUrl: string|undefined}} details
 * @returns {{hidden: boolean, disabled: boolean, pressed: boolean, titleKey: string}}
 */
export function computeFlibButtonState({beta, panelVisible, tabUrl}) {
    if (!beta) { return {hidden: true, disabled: true, pressed: false, titleKey: 'popup.flibYoutubeShow'}; }
    if (!isYoutubeWatchUrl(tabUrl)) { return {hidden: false, disabled: true, pressed: false, titleKey: 'popup.flibYoutubeNotWatch'}; }
    return {hidden: false, disabled: false, pressed: panelVisible, titleKey: panelVisible ? 'popup.flibYoutubeHide' : 'popup.flibYoutubeShow'};
}
