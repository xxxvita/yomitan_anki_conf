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

import {describe, expect, test} from 'vitest';
import {compareRussianRows} from '../../dev/dictionary-pair/parity.js';

/** @type {import('../../dev/dictionary-pair/enrich-transform.js').TermRow} */
const row = {expression: 'dream', reading: '', definitionTags: 'v', rules: 'v', score: 0, glossary: '[{"type":"structured-content","content":["Сон."]}]', sequence: 7, termTags: ''};

describe('compareRussianRows — сверка с эталоном Go', () => {
    test('порядок ключей и экранирование JSON не считаются расхождением', () => {
        const goEncoded = {...row, glossary: '[{"content":["\\u0421\\u043e\\u043d."],"type":"structured-content"}]'};
        const report = compareRussianRows([goEncoded], [row]);
        expect(report).toMatchObject({equal: 1, sameOrder: true, classes: {}});
    });

    test('другой текст в glossary, другое поле, лишняя и недостающая строка — по классам', () => {
        const report = compareRussianRows(
            [row, {...row, sequence: 8, expression: 'b'}, {...row, sequence: 9}],
            [{...row, glossary: '[{"type":"structured-content","content":["Мечта."]}]'}, {...row, sequence: 8, expression: 'b', rules: 'n'}, {...row, sequence: 10}],
        );
        expect(report.equal).toBe(0);
        expect(report.classes).toStrictEqual({'field:glossary': 1, 'field:rules': 1, 'only-in-reference': 1, 'only-in-ours': 1, 'order': 1});
    });

    test.each([
        ['expression', {expression: 'other'}],
        ['reading', {reading: 'dream'}],
        ['definitionTags', {definitionTags: 'n'}],
        ['termTags', {termTags: 'x'}],
        ['score', {score: 1}],
    ])('расхождение в %s — свой класс', (field, change) => {
        expect(compareRussianRows([row], [{...row, ...change}]).classes).toStrictEqual({[`field:${field}`]: 1});
    });

    test('другой порядок строк — отдельный класс', () => {
        const other = {...row, sequence: 8};
        expect(compareRussianRows([row, other], [other, row]).classes).toStrictEqual({order: 1});
    });
});
