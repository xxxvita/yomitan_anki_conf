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
import {messagesEn} from '../ext/js/i18n/messages-en.js';
import {messagesRu} from '../ext/js/i18n/messages-ru.js';
import {setupDomTest} from './fixtures/dom-test.js';

/** @type {Record<string, unknown>} */
const en = messagesEn;
/** @type {Record<string, unknown>} */
const ru = messagesRu;

describe('what the hints say', () => {
    test.each([
        ['settings.keyHint', ['видеопримеров', '«?»', 'обогащения', 'озвучки'], ['video examples', '“?”', 'enrichment', 'audio']],
        ['settings.enrichCardsHint', ['Yomitan Card Type', 'из окна фразы', 'если он пуст, перевод', 'Без галочки или без ключа'], ['Yomitan Card Type', 'phrase window', 'if it is empty, the translation', 'When off or without a key']],
        ['settings.createReverseCardHint', ['квоту озвучки'], ['audio quota']],
        ['settings.createPhrasesCardHint', ['к карточке слова', 'Окна фразы не касается'], ['for a word card', 'Does not affect the phrase window']],
        ['settings.ankiUrlHint', ['на этом компьютере'], ['on this computer']],
        ['settings.ankiMore1', ['функций Flibooster'], ['Flibooster features']],
        ['settings.ankiMore3', ['никто не отвечал'], ['nothing answered']],
        ['settings.ankiMore4', ['недоступны проверка слов'], ['the word check']],
        ['settings.blurHint', ['flibooster.ru'], ['flibooster.ru']],
        ['settings.uiLanguageHint', ['в настройках'], ['settings']],
        ['about.words', ['Flibooster'], ['Flibooster']],
        ['words.regexTitle', ['Flibooster проверил'], ['Flibooster checked']],
        ['words.footerRegex', ['Flibooster нашёл'], ['Flibooster found']],
    ])('%s', (key, russian, english) => {
        for (const part of russian) { expect(ru[key]).toContain(part); }
        for (const part of english) { expect(en[key]).toContain(part); }
    });

    // The word check asks Flibooster and nobody else; the simple rules are its own.
    test('no text promises the word check without Flibooster', () => {
        for (const text of [...Object.values(ru), ...Object.values(en)].map((value) => JSON.stringify(value))) {
            expect(text).not.toMatch(/(?:Без Flibooster|Without Flibooster)[^.]*(?:простым правилам|simple rules)/);
        }
    });
});

describe.each(['settings', 'welcome'])('%s.html', (name) => {
    test('the text in the markup is the English one', async () => {
        const {window, teardown} = await setupDomTest(`ext/${name}.html`);
        try {
            const nodes = [...window.document.querySelectorAll('[data-i18n]')];
            expect(nodes.length).toBeGreaterThan(10);
            for (const node of nodes) {
                expect(node.textContent).toBe(en[/** @type {HTMLElement} */ (node).dataset.i18n ?? '']);
            }
        } finally {
            await teardown(global);
        }
    });
});
