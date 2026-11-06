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

import {parseHTML} from 'linkedom';
import {describe, expect, test} from 'vitest';
import {resolveExampleSourceContent} from '../ext/js/display/example-source-link.js';
import {StructuredContentGenerator} from '../ext/js/display/structured-content-generator.js';

const VIDEO_ID = 'K1A9DQTtPu8';

/**
 * @param {unknown} content
 * @param {string} [marker]
 * @returns {import('structured-content').StyledElement}
 */
function sourceNode(content, marker = 'example-sentence-c') {
    return /** @type {import('structured-content').StyledElement} */ ({tag: 'div', data: {content: marker}, content});
}

describe('resolveExampleSourceContent', () => {
    test('строка источника становится ссылкой на видео', () => {
        expect(resolveExampleSourceContent(sourceNode(`youtube::${VIDEO_ID}`))).toStrictEqual({
            tag: 'a',
            href: `https://www.youtube.com/watch?v=${VIDEO_ID}`,
            content: 'YouTube',
        });
    });

    test('идентификатор с - и _ подходит', () => {
        expect(resolveExampleSourceContent(sourceNode('youtube::a-b_c-d_e-f'))).toMatchObject({href: 'https://www.youtube.com/watch?v=a-b_c-d_e-f'});
    });

    test.each([
        ['короткий идентификатор', 'youtube::short'],
        ['длинный идентификатор', `youtube::${VIDEO_ID}x`],
        ['параметры в адресе', 'youtube::abcdefghi&t'],
        ['перевод строки в конце', `youtube::${VIDEO_ID}\n`],
        ['текст вокруг', `см. youtube::${VIDEO_ID}`],
        ['другой регистр', `YouTube::${VIDEO_ID}`],
        ['обычный источник', 'Shakespeare, Hamlet'],
    ])('%s: остаётся текстом', (_name, text) => {
        expect(resolveExampleSourceContent(sourceNode(text))).toBe(text);
    });

    test('содержимое не строка: возвращается как есть', () => {
        const content = [`youtube::${VIDEO_ID}`];
        expect(resolveExampleSourceContent(sourceNode(content))).toBe(content);
        expect(resolveExampleSourceContent(sourceNode(void 0))).toBeUndefined();
    });

    test('другая разметка: остаётся текстом', () => {
        const text = `youtube::${VIDEO_ID}`;
        expect(resolveExampleSourceContent(sourceNode(text, 'example-sentence-a'))).toBe(text);
        expect(resolveExampleSourceContent(/** @type {import('structured-content').StyledElement} */ ({tag: 'div', content: text}))).toBe(text);
    });
});

describe('StructuredContentGenerator: источник примера', () => {
    /**
     * @param {unknown} content
     * @returns {HTMLElement}
     */
    function render(content) {
        const {document} = parseHTML('<!DOCTYPE html><html><body></body></html>');
        const contentManager = {
            /**
             * @param {HTMLAnchorElement} element
             * @param {string} href
             */
            prepareLink: (element, href) => { element.setAttribute('href', href); },
        };
        const generator = new StructuredContentGenerator(
            /** @type {import('../ext/js/display/structured-content-generator.js').StructuredContentGenerator['_contentManager']} */ (/** @type {unknown} */ (contentManager)),
            document,
            /** @type {Window} */ (/** @type {unknown} */ ({})),
        );
        return /** @type {HTMLElement} */ (generator.createStructuredContent(/** @type {import('structured-content').Content} */ (content), 'test'));
    }

    test('в карточке ссылка, разметка источника сохранена', () => {
        const node = render(sourceNode(`youtube::${VIDEO_ID}`));
        const element = /** @type {HTMLElement} */ (node.querySelector('[data-sc-content=example-sentence-c]'));
        const link = /** @type {HTMLAnchorElement} */ (element.querySelector('a'));
        expect(link.getAttribute('href')).toBe(`https://www.youtube.com/watch?v=${VIDEO_ID}`);
        expect(link.textContent).toBe('YouTube');
        expect(element.textContent).not.toContain('youtube::');
    });

    test('обычный источник не становится ссылкой', () => {
        const node = render(sourceNode('Shakespeare, Hamlet'));
        expect(node.querySelector('a')).toBeNull();
        expect(node.textContent).toBe('Shakespeare, Hamlet');
    });
});
