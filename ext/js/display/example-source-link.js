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

const EXAMPLE_SOURCE_MARKER = 'example-sentence-c';
const YOUTUBE_SOURCE_PATTERN = /^youtube::([\w-]{11})$/;

/**
 * Содержимое элемента словаря. Источник цитаты из субтитров хранится как
 * `youtube::<id>`: здесь он становится ссылкой на видео, иначе читатель видит
 * служебную строку и не может перейти к источнику.
 * @param {import('structured-content').LineBreak|import('structured-content').UnstyledElement|import('structured-content').TableElement|import('structured-content').StyledElement} element
 * @returns {import('structured-content').Content|undefined}
 */
export function resolveExampleSourceContent(element) {
    const {content, data} = element;
    if (typeof content !== 'string' || typeof data !== 'object' || data === null || data.content !== EXAMPLE_SOURCE_MARKER) {
        return content;
    }
    const match = YOUTUBE_SOURCE_PATTERN.exec(content);
    if (match === null) { return content; }
    return {tag: 'a', href: `https://www.youtube.com/watch?v=${match[1]}`, content: 'YouTube'};
}
