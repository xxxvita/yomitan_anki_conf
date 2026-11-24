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
        expect(ring.querySelector('.ve-gw-ring-arc') === null).toBe(text === '0');
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
        const track = /** @type {Element} */ (svg.querySelector('.ve-gw-ring-track'));
        const arc = /** @type {Element} */ (svg.querySelector('.ve-gw-ring-arc'));
        expect(track.getAttribute('stroke-dasharray')).toBeNull();
        expect(arc.getAttribute('pathLength')).toBe('100');
        expect(arc.getAttribute('transform')).toBe('rotate(-90 18 18)');
        expect(arc.getAttribute('stroke-linecap')).toBe('round');
        for (const c of [track, arc]) {
            // A clear white rim: r + stroke/2 = 16 of 18.
            expect(c.getAttribute('r')).toBe('14.5');
            expect(c.getAttribute('stroke-width')).toBe('3');
        }
        expect(ring.querySelector('.ve-gw-ring-n')?.getAttribute('aria-hidden')).toBe('true');
    });

    test('0 percent draws no arc (a round cap on a zero dash would paint a dot); 1 draws one', () => {
        expect(createShareRing(0, describeShare)?.querySelector('.ve-gw-ring-arc')).toBeNull();
        expect(createShareRing(0.004, describeShare)?.querySelector('.ve-gw-ring-arc')).toBeNull();
        expect(createShareRing(0.01, describeShare)?.querySelectorAll('.ve-gw-ring-arc')).toHaveLength(1);
        expect(createShareRing(0, describeShare)?.querySelectorAll('.ve-gw-ring-track')).toHaveLength(1);
    });

    // The painted length (dash + the two round caps, 1.5 units each of a 91.1-unit circle) equals the percent.
    test.each([1, 2, 3, 4, 5, 50, 87, 97, 99, 100])('%i percent paints exactly that share of the circle', (percent) => {
        const arc = /** @type {Element} */ (createShareRing(percent / 100, describeShare)?.querySelector('.ve-gw-ring-arc'));
        const [dash, gap] = /** @type {string} */ (arc.getAttribute('stroke-dasharray')).split(' ').map(Number);
        const cap = 1.5 / (2 * Math.PI * 14.5) * 100;
        const round = arc.getAttribute('stroke-linecap') === 'round';
        const offset = Number(arc.getAttribute('stroke-dashoffset') ?? 0);
        expect(dash).toBeGreaterThan(0);
        expect(gap).toBe(100);
        // Every branch (butt, round, closed): the dash is in percents and starts at the top.
        expect(arc.getAttribute('pathLength')).toBe('100');
        expect(arc.getAttribute('transform')).toBe('rotate(-90 18 18)');
        // 100 is a full closed circle: its caps overlap the start, nothing to subtract.
        if (percent < 100) { expect(dash + (round ? 2 * cap : 0)).toBeCloseTo(percent, 1); }
        // The painted span starts at the top: the cap overshoot is taken off the front too.
        expect(-offset).toBeCloseTo(round && percent < 100 ? cap : 0, 2);
        if (percent === 100) { expect(dash).toBe(100); }
        if (percent <= 3) { expect(round).toBe(false); }
        if (percent >= 5) { expect(round).toBe(true); }
    });

    test('the source never uses innerHTML', () => {
        const source = readFileSync(new URL('../ext/js/display/example-share-ring.js', import.meta.url), 'utf8');
        expect(source).not.toContain('innerHTML');
    });
});
