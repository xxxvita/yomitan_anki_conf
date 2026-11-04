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

/* eslint-disable no-underscore-dangle -- getScanStartAt reads Display's private scan state */
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {Display} from '../ext/js/display/display.js';
import {setupDomTest} from './fixtures/dom-test.js';

describe('Display.getScanStartAt — начало поиска щелчка (то же, что у сканера)', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => { env = await setupDomTest(); });
    afterEach(async () => { await env.teardown(global); });

    /**
     * @param {?object} options
     * @param {unknown} source
     * @returns {Display}
     */
    const make = (options, source) => {
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const display = /** @type {Display} */ (Object.create(Display.prototype));
        /** @type {*} */ (display)._options = options;
        /** @type {*} */ (display)._textSourceGenerator = {getRangeFromPoint: () => source};
        return display;
    };
    /**
     * @param {string} resolution
     * @param {string} language
     * @returns {object}
     */
    const opts = (resolution, language) => ({
        scanning: {deepDomScan: false, normalizeCssZoom: true, scanResolution: resolution, length: 34, layoutAwareScan: false},
        general: {language},
    });
    /**
     * @param {Text} node
     * @param {number} offset
     * @returns {{type: string, range: Range, setStartOffset: import('vitest').Mock, cleanup: import('vitest').Mock}}
     */
    const rangeSource = (node, offset) => {
        const range = document.createRange();
        range.setStart(node, offset);
        range.setEnd(node, offset);
        return {
            type: 'range',
            range,
            setStartOffset: vi.fn(() => { range.setStart(node, 0); }),
            cleanup: vi.fn(),
        };
    };

    test('настроек ещё нет / в точке нет текста / alt-текст картинки — null', () => {
        const node = document.createTextNode('bowler');
        expect(make(null, rangeSource(node, 3)).getScanStartAt(1, 1)).toBeNull();
        expect(make(opts('word', 'en'), null).getScanStartAt(1, 1)).toBeNull();
        expect(make(opts('word', 'en'), {type: 'element', cleanup: vi.fn()}).getScanStartAt(1, 1)).toBeNull();
    });
    test('по словам: начало расширено тем же setStartOffset(длина, layoutAware, true)', () => {
        const node = document.createTextNode('bowler');
        const source = rangeSource(node, 3);
        const result = make(opts('word', 'en'), source).getScanStartAt(1, 1);
        expect(source.setStartOffset).toHaveBeenCalledWith(34, false, true);
        expect(result).toStrictEqual({start: {node, offset: 0}, caret: {node, offset: 3}});
        expect(source.cleanup).toHaveBeenCalled();
    });
    test('по символам и японский — без расширения: начало = буква под курсором', () => {
        for (const [res, lang] of [['character', 'en'], ['word', 'ja']]) {
            const node = document.createTextNode('bowler');
            const source = rangeSource(node, 3);
            const result = make(opts(res, lang), source).getScanStartAt(1, 1);
            expect(source.setStartOffset).not.toHaveBeenCalled();
            expect(result?.start).toStrictEqual({node, offset: 3});
        }
    });
});
/* eslint-enable no-underscore-dangle */
