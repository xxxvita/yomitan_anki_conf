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

import {afterAll, describe, expect, test} from 'vitest';
import {readFileSync} from 'node:fs';
import {createShareRing, getShareLevel} from '../ext/js/display/example-share-ring.js';
import {setupDomTest} from './fixtures/dom-test.js';

const {teardown} = await setupDomTest();
afterAll(() => teardown(global));

describe('getShareLevel', () => {
    test.each([
        [100, 'high'],
        [80, 'high'],
        [79, 'mid'],
        [60, 'mid'],
        [59, 'low'],
        [0, 'low'],
    ])('%i → %s', (percent, level) => {
        expect(getShareLevel(percent)).toBe(level);
    });
});

describe('createShareRing', () => {
    /**
     * @param {number} p
     * @returns {string}
     */
    const describeShare = (p) => `known ${p}`;

    test('0.796 rounds to 80 and is high: the number and the colour come from one rounded percent', () => {
        const ring = /** @type {HTMLElement} */ (createShareRing(0.796, describeShare));
        expect(ring.className).toBe('ve-gw-ring');
        expect(ring.dataset.level).toBe('high');
        expect(ring.querySelector('.ve-gw-ring-n')?.textContent).toBe('80');
    });

    test.each([
        [1, '100'],
        [-1, '0'],
        [1.7, '100'],
        [0.5, '50'],
    ])('%f is clamped and shown as %s', (share, text) => {
        const ring = /** @type {HTMLElement} */ (createShareRing(share, describeShare));
        expect(ring.querySelector('.ve-gw-ring-n')?.textContent).toBe(text);
        expect(ring.querySelector('circle[stroke-dasharray]')?.getAttribute('stroke-dasharray')).toBe(`${text} 100`);
    });

    test.each([[Number.NaN], [Number.POSITIVE_INFINITY], [null], ['0.9']])('%s → null', (share) => {
        expect(createShareRing(share, describeShare)).toBeNull();
    });

    test('structure: role img, label and title from describe, aria-hidden svg and number, pathLength 100', () => {
        const ring = /** @type {HTMLElement} */ (createShareRing(0.7, describeShare));
        expect(ring.getAttribute('role')).toBe('img');
        expect(ring.getAttribute('aria-label')).toBe('known 70');
        expect(ring.getAttribute('title')).toBe('known 70');
        expect(ring.dataset.level).toBe('mid');
        const svg = /** @type {Element} */ (ring.querySelector('svg'));
        expect(svg.getAttribute('viewBox')).toBe('0 0 36 36');
        expect(svg.getAttribute('aria-hidden')).toBe('true');
        expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg');
        expect(svg.querySelectorAll('circle')).toHaveLength(2);
        expect(svg.querySelector('circle[stroke-dasharray]')?.getAttribute('pathLength')).toBe('100');
        expect(ring.querySelector('.ve-gw-ring-n')?.getAttribute('aria-hidden')).toBe('true');
    });

    test('the source never uses innerHTML', () => {
        const source = readFileSync(new URL('../ext/js/display/example-share-ring.js', import.meta.url), 'utf8');
        expect(source).not.toContain('innerHTML');
    });
});
