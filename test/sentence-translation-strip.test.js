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

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {CONTENT_CLICK_EXCLUDE} from '../ext/js/display/display.js';
import {createSentenceTranslationStrip} from '../ext/js/display/sentence-translation-strip.js';
import {setUiLanguage, translate} from '../ext/js/i18n/ui-language.js';
import {setupDomTest} from './fixtures/dom-test.js';

describe('createSentenceTranslationStrip', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => {
        env = await setupDomTest();
        setUiLanguage('ru');
    });
    afterEach(async () => { await env.teardown(global); });

    test('open: model text goes in as text, never as markup', () => {
        const onReveal = vi.fn();
        const strip = createSentenceTranslationStrip('<img src=x onerror=alert(1)>', {blurred: false, revealed: false, onReveal});
        expect(strip.matches('div.fc-sentence-tr')).toBe(true);
        expect(strip.getAttribute('role')).toBe('note');
        expect(strip.getAttribute('aria-label')).toBe(translate('sentence.label'));
        expect(strip.querySelector('img')).toBe(null);
        expect(strip.querySelector('button')).toBe(null);
        expect(strip.textContent).toContain('<img src=x onerror=alert(1)>');
    });

    test('a click or hover on the strip never starts a nested lookup', () => {
        for (const blurred of [false, true]) {
            const strip = createSentenceTranslationStrip('Т.', {blurred, revealed: false, onReveal: () => {}});
            document.body.appendChild(strip);
            expect(strip.classList.contains('scan-disable')).toBe(true);
            expect(strip.matches(CONTENT_CLICK_EXCLUDE)).toBe(true);
            expect(/** @type {Element} */ (strip.firstElementChild).matches(CONTENT_CLICK_EXCLUDE)).toBe(true);
        }
        // The exclude list knows the strip by its own class, not only through scan-disable.
        const bare = document.createElement('div');
        bare.className = 'fc-sentence-tr';
        bare.appendChild(document.createElement('span'));
        expect(bare.matches(CONTENT_CLICK_EXCLUDE)).toBe(true);
        expect(/** @type {Element} */ (bare.firstElementChild).matches(CONTENT_CLICK_EXCLUDE)).toBe(true);
    });

    test('blurred: a button with the blur hint over an inert text; a click reveals once', () => {
        const onReveal = vi.fn();
        const strip = createSentenceTranslationStrip('Я забронировал столик.', {blurred: true, revealed: false, onReveal});
        const button = /** @type {HTMLButtonElement} */ (strip.querySelector('button.fc-sentence-tr-blurred'));
        expect(button).not.toBe(null);
        expect(button.type).toBe('button');
        expect(button.title).toBe(translate('translation.blurHint'));
        expect(button.getAttribute('aria-label')).toBe(translate('sentence.show'));
        const inner = /** @type {HTMLElement} */ (button.querySelector('.is-blurred'));
        expect(inner.hasAttribute('inert')).toBe(true);
        expect(inner.getAttribute('aria-hidden')).toBe('true');
        expect(inner.textContent).toBe('Я забронировал столик.');
        button.click();
        expect(onReveal).toHaveBeenCalledTimes(1);
    });

    test('blurred and revealed: open, no button', () => {
        const strip = createSentenceTranslationStrip('Т.', {blurred: true, revealed: true, onReveal: () => {}});
        expect(strip.querySelector('button')).toBe(null);
        expect(strip.querySelector('.is-blurred')).toBe(null);
        expect(strip.textContent).toBe('Т.');
    });
});
