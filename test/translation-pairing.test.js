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
import {
    isStrictPairingAvailable,
    pairDefinitions,
} from '../ext/js/display/translation-pairing.js';

const opts = {
    translationDictionary: 'ru',
    hostDictionary: 'en',
    strict: true,
};

/**
 * @param {string} dictionary
 * @param {number[]} sequences
 * @returns {import('dictionary').TermDefinition}
 */
const def = (dictionary, sequences) => /** @type {import('dictionary').TermDefinition} */ (
    /** @type {unknown} */ ({
        dictionary,
        sequences,
        id: sequences[0],
        entries: [],
        tags: [],
        headwordIndices: [0],
    })
);

describe('isStrictPairingAvailable', () => {
    const names = {translationDictionary: 'ru', hostDictionary: 'en'};
    test('совпавшие отпечатки включают строгий режим', () => {
        expect(
            isStrictPairingAvailable(
                [
                    {title: 'en', revision: '2026.09.07+1962075'},
                    {title: 'ru', revision: '2026.09.07+1962075'},
                ],
                names,
            ),
        ).toBe(true);
    });
    test('разные отпечатки строгий режим выключают', () => {
        expect(
            isStrictPairingAvailable(
                [
                    {title: 'en', revision: '2026.03.05'},
                    {title: 'ru', revision: '2026.09.07+1962075'},
                ],
                names,
            ),
        ).toBe(false);
    });
    test('словаря-хозяина нет — строгого режима нет', () => {
        expect(
            isStrictPairingAvailable([{title: 'ru', revision: 'x'}], names),
        ).toBe(false);
    });
    test('пустая ревизия строгий режим не включает', () => {
        expect(
            isStrictPairingAvailable(
                [
                    {title: 'en', revision: ''},
                    {title: 'ru', revision: ''},
                ],
                names,
            ),
        ).toBe(false);
    });
    test('пустой список словарей', () => {
        expect(isStrictPairingAvailable([], names)).toBe(false);
    });
});

describe('pairDefinitions', () => {
    test('перевод встаёт к своей английской статье по штампу', () => {
        const entry = {
            definitions: [def('en', [10]), def('en', [20]), def('ru', [20])],
        };
        const rows = pairDefinitions(entry, opts);
        expect(rows.map((r) => r.hostIndex)).toEqual([0, 1]);
        expect(rows[0].translation).toBe(null);
        expect(rows[1].translation).toBe(entry.definitions[2]);
    });

    test('hostIndex — индекс в ИСХОДНОМ массиве, не порядковый номер ряда', () => {
        const entry = {definitions: [def('ru', [10]), def('en', [10])]};
        expect(pairDefinitions(entry, opts)[0].hostIndex).toBe(1);
    });

    test('чужой непереводной словарь хозяином не становится', () => {
        const entry = {definitions: [def('другой-en', [20]), def('ru', [20])]};
        const rows = pairDefinitions(entry, opts);
        expect(rows[0].translation).toBe(null);
        expect(rows[1].hostIndex).toBe(null);
    });

    test('перевод без хозяина показывается сиротой, а не выбрасывается', () => {
        const entry = {definitions: [def('en', [10]), def('ru', [999])]};
        const rows = pairDefinitions(entry, opts);
        expect(rows.length).toBe(2);
        expect(rows[1].hostIndex).toBe(null);
        expect(rows[1].translation).toBe(entry.definitions[1]);
    });

    test('сверяется ПЕРЕСЕЧЕНИЕ списков штампов, не первый элемент', () => {
        const entry = {definitions: [def('en', [10, 20]), def('ru', [20])]};
        expect(pairDefinitions(entry, opts)[0].translation).toBe(
            entry.definitions[1],
        );
    });

    test('штамп 0 пары не даёт — это апстримный словарь без штампов', () => {
        const entry = {definitions: [def('en', [0]), def('ru', [0])]};
        const rows = pairDefinitions(entry, opts);
        expect(rows[0].translation).toBe(null);
        expect(rows[1].hostIndex).toBe(null);
    });

    test('нестрогий режим делает сиротами ВСЕ переводы, без смешения', () => {
        const entry = {definitions: [def('en', [20]), def('ru', [20])]};
        const rows = pairDefinitions(entry, {...opts, strict: false});
        expect(rows[0].translation).toBe(null);
        expect(rows[1].hostIndex).toBe(null);
    });

    test('один хозяин не берёт два перевода', () => {
        const entry = {
            definitions: [def('en', [20]), def('ru', [20]), def('ru', [20])],
        };
        const rows = pairDefinitions(entry, opts);
        expect(rows.length).toBe(2);
        expect(rows[0].translation).toBe(entry.definitions[1]);
        expect(rows[1].hostIndex).toBe(null);
        expect(rows[1].translation).toBe(entry.definitions[2]);
    });

    test('статья без переводов даёт ряды с пустой правой ячейкой', () => {
        const entry = {definitions: [def('en', [1]), def('en', [2])]};
        expect(
            pairDefinitions(entry, opts).every((r) => r.translation === null),
        ).toBe(true);
    });
});
