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

import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {HtmlTemplateCollection} from '../ext/js/dom/html-template-collection.js';
import {applyUiMessages} from '../ext/js/i18n/ui-language-dom.js';
import {setUiLanguage} from '../ext/js/i18n/ui-language.js';
import {setupDomTest} from './fixtures/dom-test.js';

describe('applyUiMessages', () => {
    /** @type {Awaited<ReturnType<typeof setupDomTest>>} */
    let env;
    beforeEach(async () => { env = await setupDomTest(); });
    afterEach(async () => {
        setUiLanguage('ru');
        await env.teardown(global);
    });

    /**
     * @param {string} html
     * @returns {HTMLElement}
     */
    function render(html) {
        const host = document.createElement('div');
        // eslint-disable-next-line no-unsanitized/property
        host.innerHTML = html;
        return host;
    }

    test('заменяет текст и не трогает потомков-элементы вне ключа', () => {
        const host = render('<button><svg></svg><span data-i18n="anki.save">To Anki</span></button>');
        applyUiMessages(host);
        expect(host.querySelector('span')?.textContent).toBe('В Anki');
        expect(host.querySelector('svg')).not.toBeNull();
    });

    test('заменяет атрибуты', () => {
        const host = render('<textarea data-i18n-placeholder="anki.save" data-i18n-title="anki.open" data-i18n-aria-label="anki.saved" data-i18n-data-title-default="anki.save"></textarea>');
        applyUiMessages(host);
        const node = /** @type {HTMLElement} */ (host.firstElementChild);
        expect(node.getAttribute('placeholder')).toBe('В Anki');
        expect(node.getAttribute('title')).toBe('Открыть в Anki');
        expect(node.getAttribute('aria-label')).toBe('Сохранено в Anki');
        expect(node.dataset.titleDefault).toBe('В Anki');
    });

    test('меняет подпись горячей клавиши и сохраняет остальное', () => {
        const host = render('<button data-hotkey=\'["saveNote",["title","data-title-default"],"To Anki ({0})"]\' data-i18n-hotkey="anki.save"></button>');
        applyUiMessages(host);
        expect(host.querySelector('button')?.dataset.hotkey).toBe('["saveNote",["title","data-title-default"],"В Anki ({0})"]');
    });

    test('запомненное значение прежнего языка не остаётся в data-hotkey', () => {
        const host = render('<button data-hotkey=\'["saveNote","title","To Anki ({0})",["To Anki"]]\' data-i18n-hotkey="anki.save"></button>');
        applyUiMessages(host);
        expect(host.querySelector('button')?.dataset.hotkey).toBe('["saveNote","title","В Anki ({0})"]');
    });

    test('повторный вызов следует за языком', () => {
        const host = render('<span data-i18n="anki.save">To Anki</span>');
        applyUiMessages(host);
        setUiLanguage('en');
        applyUiMessages(host);
        expect(host.textContent).toBe('To Anki');
    });

    test('корень тоже обрабатывается', () => {
        const node = document.createElement('span');
        node.dataset.i18n = 'anki.save';
        applyUiMessages(node);
        expect(node.textContent).toBe('В Anki');
    });

    test('копия шаблона без ключей: перевод страницы не трогает подпись из кода', () => {
        const collection = new HtmlTemplateCollection();
        const source = new DOMParser().parseFromString('<template id="x-template"><button data-i18n-title="anki.save" title="В Anki"><b data-i18n="anki.save">В Anki</b></button></template>', 'text/html');
        collection.load(source);
        const node = /** @type {HTMLElement} */ (collection.instantiate('x'));
        node.title = 'В Anki: формат';
        document.body.appendChild(node);
        applyUiMessages(document.documentElement);
        expect(node.title).toBe('В Anki: формат');
        expect(node.outerHTML).not.toContain('data-i18n');
    });

    test('шаблон сохраняет ключи и не теряет подпись клавиши у копии', () => {
        const collection = new HtmlTemplateCollection();
        const source = new DOMParser().parseFromString('<template id="x-template"><button data-i18n-title="anki.save" title="To Anki"></button></template>', 'text/html');
        collection.load(source);
        const [template] = collection.getAllTemplates();
        applyUiMessages(template.content);
        /** @type {HTMLElement} */ (template.content.firstElementChild).title = 'В Anki (Alt+E)';
        expect(/** @type {HTMLElement} */ (collection.instantiate('x')).title).toBe('В Anki (Alt+E)');
        expect(template.content.querySelector('[data-i18n-title]')).not.toBeNull();
    });

    test('испорченный data-hotkey не роняет страницу', () => {
        const host = render('<button data-hotkey="[" data-i18n-hotkey="anki.save"></button>');
        expect(() => { applyUiMessages(host); }).not.toThrow();
        expect(host.querySelector('button')?.dataset.hotkey).toBe('[');
    });
});
