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

import {ObjectPropertyAccessor} from '../general/object-property-accessor.js';

/*
 * Личный ключ Flib (flibService.personalKey) не должен уходить в контексты,
 * где его может прочитать чужая страница: контент-скрипт живёт рядом с её
 * кодом. Настройки целиком (optionsGet/optionsGetFull) отдаются таким
 * отправителям с пустым ключом; страницам расширения (настройки, popup-iframe,
 * поиск) — как есть.
 */

/**
 * Отправитель — страница самого расширения (chrome-extension://<id>/…,
 * moz-extension://<uuid>/…) И сообщение пришло от этого же расширения
 * (`sender.id === chrome.runtime.id`). Пустой/неизвестный отправитель — НЕ
 * доверенный.
 *
 * ⚠️ `sender.id` у контент-скрипта тоже наш — его отсекает только проверка
 * адреса; проверка id закрывает чужие расширения.
 * @param {chrome.runtime.MessageSender | undefined} sender
 * @param {string} extensionBaseUrl Например `chrome.runtime.getURL('/')`.
 * @param {string} extensionId `chrome.runtime.id`.
 * @returns {boolean}
 */
export function isExtensionPageSender(sender, extensionBaseUrl, extensionId) {
    if (typeof extensionBaseUrl !== 'string' || extensionBaseUrl.length === 0) { return false; }
    if (typeof extensionId !== 'string' || extensionId.length === 0 || sender?.id !== extensionId) { return false; }
    const base = extensionBaseUrl.endsWith('/') ? extensionBaseUrl : `${extensionBaseUrl}/`;
    const url = sender?.url;
    return typeof url === 'string' && url.startsWith(base);
}

/**
 * Копия настроек профиля с пустым ключом; исходник не трогается.
 * @param {import('settings').ProfileOptions} options
 * @returns {import('settings').ProfileOptions}
 */
export function redactProfileOptions(options) {
    const service = /** @type {Partial<import('settings').ProfileOptions>} */ (options).flibService;
    if (typeof service !== 'object' || service === null) { return options; }
    return {...options, flibService: {...service, personalKey: ''}};
}

/**
 * Копия всех настроек с пустым ключом в каждом профиле; исходник не трогается.
 * @param {import('settings').Options} options
 * @returns {import('settings').Options}
 */
export function redactOptionsFull(options) {
    return {
        ...options,
        profiles: options.profiles.map((profile) => ({...profile, options: redactProfileOptions(profile.options)})),
    };
}

/**
 * Затрагивает ли цель getSettings/modifySettings личный ключ: путь проходит
 * через `flibService` или указывает на его предка (весь профиль, все профили,
 * корень настроек). Неразбираемый путь считается затрагивающим — запрет
 * безопаснее, а законные вызовы такой путь всё равно не пройдут.
 * @param {{scope?: unknown, path?: unknown, path1?: unknown, path2?: unknown}} target
 * @returns {boolean}
 */
export function targetTouchesFlibSecret(target) {
    const paths = [target.path, target.path1, target.path2].filter((p) => typeof p === 'string');
    for (const path of /** @type {string[]} */ (paths)) {
        /** @type {(string|number)[]} */
        let parts;
        try {
            parts = ObjectPropertyAccessor.getPathArray(path);
        } catch (e) {
            return true;
        }
        if (parts.includes('flibService')) { return true; }
        if (parts.length === 0) { return true; }
        // profiles / profiles[i] / profiles[i].options — предки ключа.
        const isProfileAncestor = parts.length <= 2 || (parts.length === 3 && parts[2] === 'options');
        if (target.scope === 'global' && parts[0] === 'profiles' && isProfileAncestor) { return true; }
    }
    return false;
}
