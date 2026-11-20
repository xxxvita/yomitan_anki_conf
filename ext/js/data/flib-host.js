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
 * @param {string} url
 * @returns {?string} имя хоста без замыкающей точки, в нижнем регистре
 */
function hostOf(url) {
    if (typeof url !== 'string' || url.length === 0) {
        return null;
    }
    try {
        // Замыкающая точка — законная запись корня DNS: flib.club. === flib.club
        return new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    } catch (e) {
        return null;
    }
}

/**
 * Только flib.club и его поддомены. Доверие к шлюзу строится на этой
 * проверке, а не на isFlibHost: шлюзы живут на flib.club.
 * @param {string} url
 * @returns {boolean}
 */
export function isFlibClubHost(url) {
    const host = hostOf(url);
    return host !== null && (host === 'flib.club' || host.endsWith('.flib.club'));
}

/**
 * ЕДИНСТВЕННАЯ в репозитории проверка «страница Flib» (flib.club или
 * flibooster.ru, с поддоменами). Её читают и дисплей (блюрить ли перевод), и
 * бэкенд (писать ли событие). Вторая копия запрещена: расхождение двух копий
 * тест в одном движке не поймает.
 * @param {string} url
 * @returns {boolean}
 */
export function isFlibHost(url) {
    const host = hostOf(url);
    return host !== null && (
        host === 'flib.club' || host.endsWith('.flib.club') ||
        host === 'flibooster.ru' || host.endsWith('.flibooster.ru')
    );
}

/**
 * Идентификатор пазла (`rp`) со страницы плеера маршрута.
 * Не бросает: негодный вход — null.
 * @param {string} url
 * @returns {?string}
 */
export function parseRoutePuzzleId(url) {
    if (!isFlibHost(url)) {
        return null;
    }
    let parsed;
    try {
        parsed = new URL(url);
    } catch (e) {
        return null;
    }
    // Только https и порт по умолчанию: страница маршрута живёт только там.
    if (parsed.protocol !== 'https:' || parsed.port !== '') {
        return null;
    }
    if (parsed.pathname !== '/player' && parsed.pathname !== '/player/') {
        return null;
    }
    const rp = parsed.searchParams.get('rp');
    return rp !== null && rp.trim().length > 0 ? rp : null;
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

/** Сайт Flib-club (ссылки в карточке). */
export const FLIB_SITE_URL = 'https://flib.club';

/**
 * Бот выдаёт ключи. Параметр start — метка источника в воронке бота; бот
 * пропускает только латиницу, цифры, `_` и `-`.
 */
export const FLIB_KEY_BOT_URL = 'https://t.me/flibclub_bot?start=extension';

/**
 * Покупка полного ключа — для тех, у кого ключ есть, но его не хватает.
 * ⚠️ Адрес постоянный по договорённости с сайтом: если оплата переедет, сайт
 * сам перенаправит с /buy, сохранив параметры. Менять путь здесь — значит
 * выпускать новую версию через проверку магазинов, поэтому не надо.
 * src — метка источника, сайт принимает любые параметры.
 */
export const FLIB_BUY_URL = 'https://flib.club/buy?src=extension';

/**
 * Referer, который расширение подставляет встроенному плееру YouTube
 * (youtube-embed-referer.js). Со страницы chrome-extension:// Referer не
 * уходит, и плеер отвечает «Error 153». Здесь — по той же причине A25.
 */
export const FLIB_YOUTUBE_EMBED_REFERER = 'https://flib.club/';
