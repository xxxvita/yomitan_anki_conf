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

/**
 * The `z-index` of the only rule with exactly this selector that sets one.
 * @param {string} file
 * @param {string} selector
 * @returns {number}
 */
function zIndexOf(file, selector) {
    const css = readFileSync(new URL(`../ext/css/${file}`, import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
    const values = [];
    for (const [, selectors, body] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
        if (!selectors.split(',').some((value) => value.trim() === selector)) { continue; }
        const match = /(?:^|[\s;])z-index:\s*(-?\d+)/.exec(body);
        if (match !== null) { values.push(Number(match[1])); }
    }
    expect(values, `${file} ${selector}`).toHaveLength(1);
    return values[0];
}

// The messages about saving (errors, «Карточка ещё сохраняется») are footer notifications. All the layers below are
// compared in one stacking context: .content, .content-scroll and .content-body create none.
describe('layers of the footer notifications', () => {
    const FOOTER = zIndexOf('display.css', '.content-footer-container1');

    test.each([
        ['flib-card.css', '.fc-tagbar'],
        ['flib-card.css', '.popup-toolbar'],
        ['flib-card.css', '.fc-sentence-tr'],
        ['display.css', '.entry-video-examples-check-floating'],
    ])('above the results: %s %s', (file, selector) => {
        expect(FOOTER).toBeGreaterThan(zIndexOf(file, selector));
    });

    test.each([
        ['display.css', '.overlay-panel-container'],
        ['display.css', '.content-sidebar'],
        ['display.css', '.top-progress-bar-container'],
        ['display.css', '.frame-resizer-container'],
        ['flib-card.css', '.fc-rz-tip'],
        ['display.css', '.sticky-header'],
        ['material.css', '.popup-menu-container'],
        ['display.css', '.test-words-modal-overlay'],
        ['display.css', '.entry-video-examples-modal-overlay'],
    ])('below the panels, menus and windows: %s %s', (file, selector) => {
        expect(FOOTER).toBeLessThan(zIndexOf(file, selector));
    });
});

// footer-space.js sets the variable; without these rules it has no reader.
describe('the space under the phrase window', () => {
    const css = readFileSync(new URL('../ext/css/display.css', import.meta.url), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

    test.each([
        ['body:has(.entry[data-type=\'phrase\']) .content-body', 'padding-bottom'],
        ['body:has(.entry[data-type=\'phrase\']) .content-scroll', 'scroll-padding-bottom'],
    ])('%s: %s', (selector, property) => {
        const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].filter((match) => match[1].split(',').some((value) => value.trim() === selector));
        expect(rules.map((match) => match[2]).join('')).toContain(`${property}: var(--footer-notifications-height, 0px);`);
    });
});
