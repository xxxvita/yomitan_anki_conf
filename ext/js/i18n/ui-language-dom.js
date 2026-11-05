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

import {parseJson} from '../core/json.js';
import {translate} from './ui-language.js';

const TRANSLATED_ATTRIBUTES = ['title', 'placeholder', 'aria-label', 'data-title-default'];
const ATTRIBUTES_WITH_KEYS = ['data-i18n', 'data-i18n-hotkey', ...TRANSLATED_ATTRIBUTES.map((name) => `data-i18n-${name}`)];
const SELECTOR = ATTRIBUTES_WITH_KEYS.map((name) => `[${name}]`).join(',');

/**
 * @param {HTMLElement} node
 */
function setHotkeyLabel(node) {
    const {i18nHotkey: key, hotkey} = node.dataset;
    if (typeof key !== 'string' || typeof hotkey !== 'string') { return; }
    try {
        /** @type {unknown} */
        const value = parseJson(hotkey);
        if (Array.isArray(value)) {
            // Четвёртый элемент: запомненное значение атрибута на прежнем языке.
            // Без него контроллер горячих клавиш прочитает атрибут заново.
            node.dataset.hotkey = JSON.stringify([value[0], value[1], `${translate(key)} ({0})`]);
        }
    } catch (e) {
        // Подпись остаётся прежней: разбор этого значения всё равно не удастся.
    }
}

/**
 * @param {HTMLElement} node
 */
function applyToNode(node) {
    const key = node.dataset.i18n;
    if (typeof key === 'string') { node.textContent = translate(key); }
    for (const name of TRANSLATED_ATTRIBUTES) {
        const attributeKey = node.getAttribute(`data-i18n-${name}`);
        if (attributeKey !== null) { node.setAttribute(name, translate(attributeKey)); }
    }
    setHotkeyLabel(node);
}

/**
 * Подставляет строки в разметку. HTML хранит английский текст и ключи в data-i18n.
 * @param {Element|DocumentFragment} root
 */
export function applyUiMessages(root) {
    if ('matches' in root && root.matches(SELECTOR)) { applyToNode(/** @type {HTMLElement} */ (root)); }
    for (const node of /** @type {NodeListOf<HTMLElement>} */ (root.querySelectorAll(SELECTOR))) { applyToNode(node); }
}

/**
 * Снимает ключи с копии шаблона. Шаблоны переводятся целиком при смене языка, а
 * в готовой копии код сам меняет подписи: «В Anki: формат», состояние карточки.
 * С ключами перевод страницы вернул бы им общий текст.
 * @param {Element|DocumentFragment} root
 */
export function clearUiMessageKeys(root) {
    const nodes = /** @type {HTMLElement[]} */ ([...root.querySelectorAll(SELECTOR)]);
    if ('matches' in root && root.matches(SELECTOR)) { nodes.push(/** @type {HTMLElement} */ (root)); }
    for (const node of nodes) {
        for (const name of ATTRIBUTES_WITH_KEYS) { node.removeAttribute(name); }
    }
}
