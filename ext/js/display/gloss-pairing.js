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

/*
 * Перевод НАПРОТИВ каждого значения, а не одним блоком на статью.
 *
 * Пара словарей Flib строится так, что русская строка — перевод английской
 * строки того же sequence, значение в значение: в сборке 2323195-2143344 у
 * всех 360 155 пар число <li> в списке glosses совпадает (проверено по zip,
 * 2026-11-04). Это свойство ДАННЫХ, а не формата: чужая пара или будущая
 * сборка может его нарушить, поэтому при несовпадении числа значений
 * pairGlosses отдаёт null, и колонка откатывается на ячейку на всю статью —
 * лучше крупнее, чем перевод не под тем значением.
 *
 * Значения бывают вложенными (run: «To move swiftly.» и под ним ul с
 * подзначениями). Вложенный список сопоставляется так же, по числу <li>; если
 * числа не сошлись, подсписок перевода целиком уходит в ячейку родителя.
 */

/**
 * @typedef {object} GlossPair
 * @property {HTMLElement} en <li> хозяина.
 * @property {HTMLElement} ru <li> перевода.
 * @property {number} depth 0 — значение верхнего уровня.
 * @property {boolean} withSublist В ячейку идёт и подсписок перевода (подзначения не сопоставились).
 */

/**
 * @param {Element} parent
 * @returns {HTMLElement[]}
 */
function childItems(parent) {
    return /** @type {HTMLElement[]} */ ([...parent.children].filter((el) => el.tagName === 'LI'));
}

/**
 * Вложенный список значения: прямой потомок <li>, ul или ol.
 * @param {HTMLElement} item
 * @returns {?HTMLElement}
 */
export function getSublist(item) {
    for (const child of item.children) {
        if (child.tagName === 'UL' || child.tagName === 'OL') { return /** @type {HTMLElement} */ (child); }
    }
    return null;
}

/**
 * Прямые <li> списка значений в выводе structured-content
 * (`ol[data-sc-content=glosses]`). Вложенные списки не считаются.
 * @param {ParentNode} root
 * @returns {HTMLElement[]}
 */
export function findGlossItems(root) {
    // ⚠️ Ровно один список: при двух второй остался бы без ячеек, а его
    // перевод молча пропал бы (режим «по значениям» не откатывается).
    const lists = root.querySelectorAll('[data-sc-content="glosses"]');
    return lists.length === 1 ? childItems(lists[0]) : [];
}

/**
 * @param {HTMLElement[]} en
 * @param {HTMLElement[]} ru
 * @param {number} depth
 * @param {GlossPair[]} out
 */
function pairLevel(en, ru, depth, out) {
    for (const [i, item] of en.entries()) {
        const ruItem = ru[i];
        const enSub = getSublist(item);
        const ruSub = getSublist(ruItem);
        const enSubItems = enSub === null ? [] : childItems(enSub);
        const ruSubItems = ruSub === null ? [] : childItems(ruSub);
        const nested = enSubItems.length > 0 && enSubItems.length === ruSubItems.length;
        out.push({en: item, ru: ruItem, depth, withSublist: !nested && ruSubItems.length > 0});
        if (nested) { pairLevel(enSubItems, ruSubItems, depth + 1, out); }
    }
}

/**
 * Пары «значение — перевод» в порядке документа (родитель, затем его подзначения).
 * @param {ParentNode} host
 * @param {ParentNode} translation
 * @returns {?GlossPair[]} null — значения верхнего уровня не сопоставить один к одному.
 */
export function pairGlosses(host, translation) {
    const en = findGlossItems(host);
    const ru = findGlossItems(translation);
    if (en.length === 0 || en.length !== ru.length) { return null; }
    /** @type {GlossPair[]} */
    const out = [];
    pairLevel(en, ru, 0, out);
    return out;
}

/**
 * Текст перевода одного значения: без меток (они уже стоят у английского),
 * без примеров (русская строка повторяет английские примеры) и без
 * подзначений, если они стоят своими строками.
 * @param {HTMLElement} item
 * @param {{withSublist?: boolean}} [options]
 * @returns {DocumentFragment}
 */
export function extractGlossTranslation(item, {withSublist = false} = {}) {
    const clone = /** @type {HTMLElement} */ (item.cloneNode(true));
    for (const extra of clone.querySelectorAll('[data-sc-content="tags"], details')) {
        extra.remove();
    }
    if (!withSublist) {
        getSublist(clone)?.remove();
    }
    const fragment = document.createDocumentFragment();
    fragment.append(...clone.childNodes);
    return fragment;
}

/**
 * Собирает собственное содержимое <li> (всё, кроме вложенного списка) в один
 * блок, чтобы рядом встала ячейка перевода: у <li> сетка, и голый текстовый
 * узел стал бы своей ячейкой. Повторный вызов возвращает тот же блок.
 * @param {HTMLElement} item
 * @returns {HTMLElement}
 */
export function wrapGlossItem(item) {
    const existing = item.querySelector(':scope > .fc-gloss-en');
    if (existing !== null) { return /** @type {HTMLElement} */ (existing); }
    const sublist = getSublist(item);
    const wrap = document.createElement('div');
    wrap.className = 'fc-gloss-en';
    wrap.append(...[...item.childNodes].filter((node) => node !== sublist));
    item.insertBefore(wrap, item.firstChild);
    return wrap;
}
