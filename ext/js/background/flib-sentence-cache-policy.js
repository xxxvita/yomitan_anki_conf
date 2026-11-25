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
 * Можно ли читать и писать кэш переводов фраз для этого запроса.
 * Да только если: `useCache === true`, у отправителя есть вкладка, она не
 * инкогнито, а её адрес (если известен) — http(s) или file, не страница
 * расширения. Неизвестный адрес вкладки допустим лишь для popup.html
 * (`sender.url`): без разрешения «tabs» адрес вкладки не отдаётся.
 * @param {unknown} useCache
 * @param {chrome.runtime.MessageSender | undefined} sender
 * @returns {boolean}
 */
export function mayUseSentenceCache(useCache, sender) {
    if (useCache !== true) { return false; }
    const tab = sender?.tab;
    if (typeof tab !== 'object' || tab === null || tab.incognito === true) { return false; }
    const tabUrl = tab.url;
    if (typeof tabUrl === 'string' && tabUrl !== '') {
        return /^(?:https?|file):/i.test(tabUrl);
    }
    return isPopupPageUrl(sender?.url);
}

/**
 * @param {unknown} url
 * @returns {boolean}
 */
function isPopupPageUrl(url) {
    if (typeof url !== 'string') { return false; }
    try {
        const parsed = new URL(url);
        return (parsed.protocol === 'chrome-extension:' || parsed.protocol === 'moz-extension:') && parsed.pathname === '/popup.html';
    } catch {
        return false;
    }
}
