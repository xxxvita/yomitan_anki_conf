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

import {messagesEn} from './messages-en.js';
import {messagesRu} from './messages-ru.js';

/*
 * Язык интерфейса Flib-club. chrome.i18n не подходит: он следует языку браузера,
 * а язык выбирают в настройках плагина. Строки живут в messages-*.js, запасной
 * язык русский: он полон всегда, а английский может отставать на срез.
 */

/** @type {import('ui-language').UiLanguage} */
let currentLanguage = 'ru';

/**
 * @param {string|undefined} setting Значение general.uiLanguage.
 * @param {string} browserLanguage Например ru-RU.
 * @returns {import('ui-language').UiLanguage}
 */
export function resolveUiLanguage(setting, browserLanguage) {
    if (setting === 'ru' || setting === 'en') { return setting; }
    if (typeof setting === 'string' && setting !== 'auto') { return 'ru'; }
    return /^ru(-|$)/i.test(browserLanguage) ? 'ru' : 'en';
}

/** @returns {string} Язык браузера, пустая строка вне расширения. */
export function getBrowserUiLanguage() {
    return typeof chrome === 'undefined' ? '' : chrome.i18n.getUILanguage();
}

/** @returns {import('ui-language').UiLanguage} */
export function getUiLanguage() {
    return currentLanguage;
}

/**
 * @param {import('ui-language').UiLanguage} language
 */
export function setUiLanguage(language) {
    currentLanguage = language;
}

/**
 * @param {string} text
 * @param {{[name: string]: string|number}} params
 * @returns {string}
 */
function fillParams(text, params) {
    return text.replace(/\{(\w+)\}/g, (mark, /** @type {string} */ name) => (Object.hasOwn(params, name) ? String(params[name]) : mark));
}

/**
 * @param {string} key
 * @param {import('ui-language').Messages} english
 * @param {import('ui-language').Messages} russian
 * @returns {import('ui-language').Message|undefined}
 */
function findMessage(key, english, russian) {
    const primary = currentLanguage === 'en' ? english : russian;
    if (Object.hasOwn(primary, key)) { return primary[key]; }
    return Object.hasOwn(russian, key) ? russian[key] : void 0;
}

/**
 * @param {string} key
 * @param {{[name: string]: string|number}} [params]
 * @param {import('ui-language').Messages} [english] Подмена словаря для тестов.
 * @param {import('ui-language').Messages} [russian] Подмена словаря для тестов.
 * @returns {string}
 */
export function translate(key, params = {}, english = messagesEn, russian = messagesRu) {
    const message = findMessage(key, english, russian);
    return typeof message === 'string' ? fillParams(message, params) : key;
}

/**
 * @param {string} key
 * @param {number} count
 * @param {{[name: string]: string|number}} [params]
 * @returns {string}
 */
export function translatePlural(key, count, params = {}) {
    const message = findMessage(key, messagesEn, messagesRu);
    if (typeof message === 'undefined') { return key; }
    const allParams = {...params, count};
    if (typeof message === 'string') { return fillParams(message, allParams); }
    const category = new Intl.PluralRules(currentLanguage).select(count);
    const text = message[category] ?? message.other ?? message.many ?? Object.values(message)[0];
    return fillParams(text, allParams);
}
