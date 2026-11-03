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

import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {extractGlossTranslation, findGlossItems, pairGlosses, wrapGlossItem} from '../ext/js/display/gloss-pairing.js';
import {setupDomTest} from './fixtures/dom-test.js';

/**
 * @param {string} tag
 * @param {Record<string, string>} data dataset; `href` — атрибут.
 * @param {...(Node|string)} children
 * @returns {HTMLElement}
 */
function h(tag, data, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(data)) {
        if (key === 'href') {
            el.setAttribute('href', value);
        } else {
            el.dataset[key] = value;
        }
    }
    el.append(...children);
    return el;
}

/**
 * Узел в форме вывода structured-content-generator для статьи Wiktionary:
 * preamble, ol[data-sc-content=glosses] > li (теги, текст, примеры), backlink.
 * @param {string[]} glosses
 * @returns {HTMLElement}
 */
function makeScEntry(glosses) {
    return h(
        'div',
        {},
        h('div', {scContent: 'preamble'}, h('details', {scContent: 'details-entry-Grammar'}, h('summary', {}, 'Grammar'), h('div', {}, 'g'))),
        h('ol', {scContent: 'glosses'}, ...glosses.map((text) => h(
            'li',
            {},
            h(
                'div',
                {},
                h('div', {scContent: 'tags'}, h('span', {scContent: 'tag'}, 'vt')),
                text,
                h('details', {scContent: 'details-entry-examples'}, h('summary', {}, '1 example'), h('div', {}, 'ex')),
            ),
        ))),
        h('div', {scContent: 'backlink'}, h('a', {href: '#'}, 'Wiktionary')),
    );
}

describe('gloss-pairing', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => { env = await setupDomTest(); });
    afterEach(async () => { await env.teardown(global); });

    test('findGlossItems берёт только прямых li списка glosses, не вложенные', () => {
        const root = makeScEntry(['a', 'b']);
        const nested = document.createElement('ol');
        nested.dataset.scContent = 'glosses';
        nested.appendChild(document.createElement('li'));
        root.querySelectorAll('li')[0].appendChild(nested);
        expect(findGlossItems(root)).toHaveLength(2);
    });

    test('нет списка glosses (чужой словарь) — пусто', () => {
        expect(findGlossItems(h('div', {}, h('ul', {}, h('li', {}, 'plain'))))).toEqual([]);
    });

    test('pairGlosses: равное число — пары по порядку', () => {
        const pairs = pairGlosses(makeScEntry(['a', 'b']), makeScEntry(['а', 'б']));
        expect(pairs).not.toBeNull();
        expect(pairs?.map(({en, ru}) => [en.textContent, ru.textContent])).toEqual([
            ['vta1 exampleex', 'vtа1 exampleex'],
            ['vtb1 exampleex', 'vtб1 exampleex'],
        ]);
    });

    test('pairGlosses: разное число значений — null (откат на ячейку целиком)', () => {
        expect(pairGlosses(makeScEntry(['a', 'b']), makeScEntry(['а']))).toBeNull();
    });

    test('pairGlosses: у хозяина нет glosses — null', () => {
        const plain = document.createElement('div');
        expect(pairGlosses(plain, makeScEntry(['а']))).toBeNull();
    });

    test('extractGlossTranslation убирает теги и примеры, оставляет текст перевода', () => {
        const [li] = findGlossItems(makeScEntry(['Подать мяч.']));
        const fragment = extractGlossTranslation(li);
        const box = document.createElement('div');
        box.appendChild(fragment);
        expect(box.textContent).toBe('Подать мяч.');
        expect(li.textContent).toContain('vt');
    });

    test('wrapGlossItem идемпотентен и сохраняет содержимое', () => {
        const [li] = findGlossItems(makeScEntry(['text']));
        const before = li.textContent;
        const a = wrapGlossItem(li);
        const b = wrapGlossItem(li);
        expect(a).toBe(b);
        expect(li.children).toHaveLength(1);
        expect(a.classList.contains('fc-gloss-en')).toBe(true);
        expect(li.textContent).toBe(before);
    });

    /**
     * run: «To move swiftly.» и под ним ul с подзначениями.
     * @param {string} head
     * @param {string[]} subs
     * @returns {HTMLElement}
     */
    const makeNested = (head, subs) => h(
        'div',
        {},
        h(
            'ol',
            {scContent: 'glosses'},
            h('li', {}, h('div', {}, head), h('ul', {}, ...subs.map((x) => h('li', {}, x)))),
            h('li', {}, h('div', {}, 'other')),
        ),
    );

    test('подзначения сопоставляются своими строками, в порядке документа', () => {
        const pairs = pairGlosses(makeNested('To move swiftly.', ['a', 'b']), makeNested('Двигаться быстро.', ['а', 'б']));
        expect(pairs?.map(({depth, withSublist}) => [depth, withSublist])).toEqual([[0, false], [1, false], [1, false], [0, false]]);
        const head = extractGlossTranslation(/** @type {import('../ext/js/display/gloss-pairing.js').GlossPair[]} */ (pairs)[0].ru);
        const box = document.createElement('div');
        box.appendChild(head);
        expect(box.textContent).toBe('Двигаться быстро.');
    });

    test('подзначения не сошлись — подсписок перевода уходит в ячейку родителя', () => {
        const pairs = /** @type {import('../ext/js/display/gloss-pairing.js').GlossPair[]} */ (pairGlosses(makeNested('h', ['a', 'b']), makeNested('х', ['а'])));
        expect(pairs.map(({depth, withSublist}) => [depth, withSublist])).toEqual([[0, true], [0, false]]);
        const box = document.createElement('div');
        box.appendChild(extractGlossTranslation(pairs[0].ru, {withSublist: true}));
        expect(box.textContent).toBe('ха');
    });

    test('wrapGlossItem не забирает вложенный список в обёртку', () => {
        const [li] = findGlossItems(makeNested('head', ['a']));
        const wrap = wrapGlossItem(li);
        expect(li.firstElementChild).toBe(wrap);
        expect(wrap.querySelector('ul')).toBeNull();
        expect(li.querySelector(':scope > ul')).not.toBeNull();
    });
});
