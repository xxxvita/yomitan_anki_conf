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

import {FLIB_YOUTUBE_EMBED_REFERER} from '../data/flib-host.js';

/**
 * Встроенный плеер YouTube (youtube-nocookie) на страницах расширения.
 *
 * Плеер требует Referer у запроса /embed/ и без него показывает «Error 153»
 * (Video player configuration error). Со страниц chrome-extension:// браузер
 * Referer не отправляет вовсе — referrerPolicy у iframe этого не меняет.
 * Поэтому сессионное правило declarativeNetRequest ставит Referer, но ТОЛЬКО:
 * - на документ iframe (sub_frame) по адресу www.youtube-nocookie.com/embed/;
 * - когда запрос начат нашим origin (initiatorDomains = хост базового URL
 *   расширения). Встраивания на обычных сайтах сохраняют свой Referer.
 *   Хост берётся из runtime.getURL, а не runtime.id: в Firefox origin —
 *   moz-extension://<UUID>, а runtime.id — id дополнения.
 *
 * Правило сессионное: переживает перезапуски воркера и ставится заново на
 * каждом старте (removeRuleIds + addRules одним вызовом — без дублей).
 * ⚠️ Ставить ПОСЛЕ RequestBuilder.prepare(): тот стирает все сессионные правила.
 *
 * Нет DNR или правило отклонено (Firefox до modifyHeaders, ~<128) — плеер
 * может показать Error 153; ссылка «Открыть на YouTube» остаётся всегда.
 * Отказ ожидаем, поэтому бэкенд пишет его через log.log, а не log.error:
 * error зажёг бы значок ошибки на кнопке расширения на всю сессию.
 */

/** Id правила. RequestBuilder раздаёт id с 1 подряд — держимся далеко от них. */
export const YOUTUBE_EMBED_REFERER_RULE_ID = 900001;

const SUB_FRAME = /** @type {chrome.declarativeNetRequest.ResourceType} */ ('sub_frame');

/**
 * @param {string} initiatorHost Хост origin расширения.
 * @returns {chrome.declarativeNetRequest.Rule}
 */
export function createYouTubeEmbedRefererRule(initiatorHost) {
    return {
        id: YOUTUBE_EMBED_REFERER_RULE_ID,
        priority: 1,
        condition: {
            urlFilter: '||www.youtube-nocookie.com/embed/',
            resourceTypes: [SUB_FRAME],
            initiatorDomains: [initiatorHost],
        },
        action: {
            type: /** @type {chrome.declarativeNetRequest.RuleActionType} */ ('modifyHeaders'),
            requestHeaders: [{
                header: 'Referer',
                operation: /** @type {chrome.declarativeNetRequest.HeaderOperation} */ ('set'),
                value: FLIB_YOUTUBE_EMBED_REFERER,
            }],
        },
    };
}

/**
 * @typedef {object} RegisterDetails
 * @property {?{updateSessionRules?: (options: chrome.declarativeNetRequest.UpdateRuleOptions) => Promise<void>}} [dnr] По умолчанию chrome.declarativeNetRequest.
 * @property {string} [extensionBaseUrl] По умолчанию runtime.getURL('/').
 * @property {(error: unknown) => void} [onError]
 */

/**
 * Не бросает: сбой здесь не должен мешать запуску бэкенда.
 * @param {RegisterDetails} [details]
 * @returns {Promise<'registered'|'unsupported'|'failed'>}
 */
export async function registerYouTubeEmbedRefererRule({dnr = getDefaultDnr(), extensionBaseUrl = getDefaultBaseUrl(), onError} = {}) {
    if (typeof dnr?.updateSessionRules !== 'function') { return 'unsupported'; }
    const host = getExtensionHost(extensionBaseUrl);
    // Пустой список инициаторов совпал бы с ЛЮБОЙ страницей — тогда не ставим.
    if (host === null) { return 'unsupported'; }
    try {
        await dnr.updateSessionRules({
            removeRuleIds: [YOUTUBE_EMBED_REFERER_RULE_ID],
            addRules: [createYouTubeEmbedRefererRule(host)],
        });
        return 'registered';
    } catch (e) {
        onError?.(e);
        return 'failed';
    }
}

/**
 * @param {string} baseUrl
 * @returns {?string}
 */
function getExtensionHost(baseUrl) {
    let url;
    try {
        url = new URL(baseUrl);
    } catch (e) {
        return null;
    }
    if (url.protocol !== 'chrome-extension:' && url.protocol !== 'moz-extension:') { return null; }
    return url.hostname.length > 0 ? url.hostname : null;
}

/**
 * @returns {?{updateSessionRules?: (options: chrome.declarativeNetRequest.UpdateRuleOptions) => Promise<void>}}
 */
function getDefaultDnr() {
    try {
        return globalThis.chrome?.declarativeNetRequest ?? null;
    } catch (e) {
        return null;
    }
}

/**
 * @returns {string}
 */
function getDefaultBaseUrl() {
    try {
        return globalThis.chrome.runtime.getURL('/');
    } catch (e) {
        return '';
    }
}
