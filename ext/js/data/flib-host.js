/*
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
 * ЕДИНСТВЕННАЯ в репозитории проверка «страница на flib.club». Её читают и
 * дисплей (блюрить ли перевод), и бэкенд (писать ли событие). Вторая копия
 * запрещена: расхождение двух копий тест в одном движке не поймает.
 * @param {string} url
 * @returns {boolean}
 */
export function isFlibHost(url) {
    if (typeof url !== 'string' || url.length === 0) {
        return false;
    }
    let hostname;
    try {
        hostname = new URL(url).hostname;
    } catch (e) {
        return false;
    }
    // Замыкающая точка — законная запись корня DNS: flib.club. === flib.club
    const host = hostname.toLowerCase().replace(/\.$/, '');
    return host === 'flib.club' || host.endsWith('.flib.club');
}

/**
 * Адрес вкладки отправителя, если он есть.
 *
 * ⚠️ Возвращает null ЧАСТО, и это не край: tab.url требует разрешения `tabs`,
 * которого у расширения нет, а в Firefox MV3 host-permissions опциональны,
 * пока пользователь их не выдал. Вызывающий обязан иметь фолбэк
 * (backend._getTabUrl), а не считать null за «не flib.club».
 * @param {{tab?: {url?: string}}} sender
 * @returns {?string}
 */
export function pickSenderUrl(sender) {
    const url = sender?.tab?.url;
    return typeof url === 'string' && url.length > 0 ? url : null;
}

/**
 * Адрес шлюза Flib по умолчанию (когда `flibService.gatewayUrl` пуст).
 * Живёт здесь, а не в flib-service-config.js, потому что литерал домена
 * flib.club по инварианту A25 допустим только в этом файле.
 */
export const FLIB_GATEWAY_DEFAULT_BASE = 'https://cache.flib.club';
