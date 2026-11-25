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
import {createPhraseTranslationStrip} from '../ext/js/display/phrase-translation-strip.js';
import {setUiLanguage} from '../ext/js/i18n/ui-language.js';
import {setupDomTest} from './fixtures/dom-test.js';

describe('createPhraseTranslationStrip', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => {
        env = await setupDomTest();
        setUiLanguage('ru');
    });
    afterEach(async () => {
        setUiLanguage('ru');
        await env.teardown(global);
    });

    /**
     * @param {HTMLElement} strip
     * @param {string} name
     * @returns {HTMLButtonElement}
     */
    function byName(strip, name) {
        const found = [...strip.querySelectorAll('button')].filter((node) => (node.getAttribute('aria-label') ?? node.textContent) === name);
        expect(found).toHaveLength(1);
        return found[0];
    }

    test('model text goes in as text, never as markup; the strip is a status', () => {
        const strip = createPhraseTranslationStrip('<img src=x onerror=alert(1)>', {onInsert: () => {}, onClose: () => {}});
        expect(strip.matches('div.fc-phrase-tr')).toBe(true);
        expect(strip.getAttribute('role')).toBe('status');
        expect(strip.querySelector('img')).toBe(null);
        expect(strip.querySelector('.fc-phrase-tr-text')?.textContent).toBe('<img src=x onerror=alert(1)>');
    });

    test('a click or hover on the strip never starts a nested lookup', () => {
        const strip = createPhraseTranslationStrip('Т.', {onInsert: () => {}, onClose: () => {}});
        document.body.appendChild(strip);
        expect(strip.matches(CONTENT_CLICK_EXCLUDE)).toBe(true);
        expect(strip.classList.contains('scan-disable')).toBe(true);
    });

    test.each(/** @type {['ru' | 'en', string, string][]} */ ([
        ['ru', 'Вставить', 'Закрыть'],
        ['en', 'Insert', 'Close'],
    ]))('buttons are localised (%s), never submit, and call their own handler', (language, insertName, closeName) => {
        setUiLanguage(language);
        const onInsert = vi.fn();
        const onClose = vi.fn();
        const strip = createPhraseTranslationStrip('Т.', {onInsert, onClose});
        const insert = byName(strip, insertName);
        const close = byName(strip, closeName);
        expect(strip.querySelectorAll('button')).toHaveLength(2);
        expect([insert.type, close.type]).toStrictEqual(['button', 'button']);
        expect(close.textContent).toBe('×');
        expect(close.title).toBe(closeName);
        insert.click();
        expect(onInsert).toHaveBeenCalledTimes(1);
        expect(onClose).not.toHaveBeenCalled();
        close.click();
        expect(onInsert).toHaveBeenCalledTimes(1);
        expect(onClose).toHaveBeenCalledTimes(1);
    });
});
