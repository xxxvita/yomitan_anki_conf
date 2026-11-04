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
import {getSourceChain} from '../ext/js/display/flib-card-util.js';

/**
 * @param {string} term
 * @param {{originalText: string, isPrimary: boolean}[]} sources
 * @returns {import('dictionary').TermHeadword[]}
 */
const hw = (term, sources) => /** @type {import('dictionary').TermHeadword[]} */ (/** @type {unknown} */ ([{term, sources}]));

describe('getSourceChain', () => {
    test('форма в тексте отличается — цепочка', () => {
        expect(getSourceChain(hw('google', [{originalText: 'googling', isPrimary: true}]))).toEqual({source: 'googling', term: 'google'});
    });
    test('отличие только регистром — без цепочки', () => {
        expect(getSourceChain(hw('google', [{originalText: 'Google', isPrimary: true}]))).toBeNull();
    });
    test('берётся первичный источник, а не первый', () => {
        expect(getSourceChain(hw('run', [{originalText: 'run', isPrimary: false}, {originalText: 'ran', isPrimary: true}]))).toEqual({source: 'ran', term: 'run'});
    });
    test('нет заголовков или источников — null', () => {
        expect(getSourceChain([])).toBeNull();
        expect(getSourceChain(hw('x', []))).toBeNull();
        expect(getSourceChain(hw('x', [{originalText: '  ', isPrimary: true}]))).toBeNull();
    });
});
