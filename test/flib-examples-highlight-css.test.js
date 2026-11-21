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

import {readFileSync} from 'node:fs';
import {describe, expect, test} from 'vitest';

// jsdom's selector engine (nwsapi) cannot evaluate `:has(> …)`, so the rule's selector list is checked structurally.
/** @returns {string[]} selectors of the rule that lights the header «Примеры» button while a panel is open */
function highlightSelectors() {
    const css = readFileSync(new URL('../ext/css/flib-card.css', import.meta.url), 'utf8');
    const start = css.indexOf('.entry[data-type=phrase]:has(');
    const block = css.slice(start, css.indexOf('{', start));
    return block.replace(/\/\*[\s\S]*?\*\//g, '').split(',').map((v) => v.trim());
}

describe('header «Примеры» highlight selectors', () => {
    test('phrase entries keep the rank-based per-button rules', () => {
        const phrase = highlightSelectors().filter((v) => v.startsWith('.entry[data-type=phrase]'));
        expect(phrase).toHaveLength(2);
        expect(phrase.some((v) => v.includes('[data-examples-rank=known])') && v.includes('[data-action=show-examples-known]'))).toBe(true);
    });

    test('dictionary entries light the button whenever a gateway panel is open, whatever its rank', () => {
        const other = highlightSelectors().filter((v) => v.startsWith('.entry:not([data-type=phrase])'));
        expect(other).toHaveLength(1);
        expect(other[0]).toContain(':has(> .ve-gw)');
        expect(other[0]).not.toContain('data-examples-rank');
        expect(other[0]).toContain('.action-button-examples');
    });
});
