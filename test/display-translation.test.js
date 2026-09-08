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
import {chooseLayout, createTranslationCell, MIN_COLUMN_WIDTH} from '../ext/js/display/display-translation.js';
import {setupDomTest} from './fixtures/dom-test.js';

describe('chooseLayout', () => {
    test('достигнутой ширины хватает на две колонки', () => {
        expect(chooseLayout({achievedWidth: 800, valid: true, minColumnWidth: MIN_COLUMN_WIDTH})).toBe('columns');
    });
    test('ровно на границе — ещё колонки', () => {
        expect(chooseLayout({achievedWidth: 480, valid: true, minColumnWidth: 240})).toBe('columns');
    });
    test('колонка уже порога — стопка', () => {
        expect(chooseLayout({achievedWidth: 470, valid: true, minColumnWidth: 240})).toBe('stack');
    });
    test('фронтенд размер менять не умеет (popup-window) — стопка', () => {
        expect(chooseLayout({achievedWidth: 0, valid: false, minColumnWidth: 240})).toBe('stack');
    });
});

describe('createTranslationCell', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => {
        env = await setupDomTest();
    });
    afterEach(async () => {
        await env.teardown(global);
    });

    /** @returns {import('../ext/js/display/translation-pairing.js').TranslationRow} */
    const row = () => ({
        hostIndex: 0,
        hostDefinition: null,
        translation: /** @type {import('dictionary').TermDefinition} */ (
            /** @type {unknown} */ ({dictionary: 'ru', sequences: [1], id: 1})
        ),
    });
    const content = () => document.createTextNode('перевод');

    test('заблюренная ячейка — настоящая кнопка с внятной подписью', () => {
        const cell = createTranslationCell(row(), {
            blurred: true,
            revealed: false,
            headword: 'give up',
            content: content(),
        });
        expect(cell.tagName).toBe('BUTTON');
        expect(cell.getAttribute('aria-label')).toBe('Показать перевод: give up');
    });

    test('содержимое герметично: aria-hidden и inert', () => {
        const cell = createTranslationCell(row(), {
            blurred: true,
            revealed: false,
            headword: 'x',
            content: content(),
        });
        const inner = /** @type {HTMLElement} */ (cell.firstElementChild);
        expect(inner.getAttribute('aria-hidden')).toBe('true');
        expect(inner.hasAttribute('inert')).toBe(true);
    });

    test('фильтр блюра стоит на внутреннем узле, а не на кнопке', () => {
        const cell = createTranslationCell(row(), {
            blurred: true,
            revealed: false,
            headword: 'x',
            content: content(),
        });
        expect(cell.classList.contains('is-blurred')).toBe(false);
        expect(cell.querySelector('.is-blurred')).not.toBe(null);
    });

    test('раскрытая ячейка кнопкой не является и не блюрится', () => {
        const cell = createTranslationCell(row(), {
            blurred: true,
            revealed: true,
            headword: 'x',
            content: content(),
        });
        expect(cell.tagName).toBe('DIV');
        expect(cell.querySelector('.is-blurred')).toBe(null);
    });

    test('вне flib.club ячейка сразу открыта', () => {
        const cell = createTranslationCell(row(), {
            blurred: false,
            revealed: false,
            headword: 'x',
            content: content(),
        });
        expect(cell.tagName).toBe('DIV');
    });

    test('прочерк не кликается и не фокусируется', () => {
        const empty = createTranslationCell(
            {hostIndex: 0, hostDefinition: null, translation: null},
            {blurred: true, revealed: false, headword: 'x', content: content()},
        );
        expect(empty.tagName).toBe('SPAN');
        expect(empty.getAttribute('aria-hidden')).toBe('true');
        expect(empty.textContent).toBe('—');
    });
});
