/*
 * Copyright (C) 2024-2025  Yomitan Authors
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
import {computeAutoTags, computeDomainTag, computeEndpointTag, sanitizeTag} from '../ext/js/data/url-tags.js';

describe('sanitizeTag', () => {
    test.each([
        ['', ''],
        ['example.com', 'example_com'],
        ['Hello World', 'hello_world'],
        ['  spaces  ', 'spaces'],
        ['__leading_trailing__', 'leading_trailing'],
        ['a..b..c', 'a_b_c'],
        ['пример.рф', 'пример_рф'],
        ['日本語', '日本語'],
        ['under_score-dash', 'under_score-dash'],
    ])('sanitizeTag(%j) === %j', (input, expected) => {
        expect(sanitizeTag(input)).toBe(expected);
    });
});

describe('computeDomainTag', () => {
    test.each([
        ['https://www.example.com/wiki/Article', 'example_com'],
        ['https://en.wikipedia.org/wiki/Foo', 'en_wikipedia_org'],
        ['https://app.localhost:8777/api/v1/health', 'app_localhost_8777'],
        // IDN hostnames are normalized to Punycode by the WHATWG URL parser.
        ['https://пример.рф/foo', 'xn--e1afmkfd_xn--p1ai'],
        ['http://localhost/', 'localhost'],
        ['not-a-url', null],
        ['', null],
    ])('computeDomainTag(%j) === %j', (input, expected) => {
        expect(computeDomainTag(input)).toBe(expected);
    });
});

describe('computeEndpointTag', () => {
    test.each([
        ['https://www.example.com/wiki/Article', 'wiki_article'],
        ['https://en.wikipedia.org/wiki/Foo', 'wiki_foo'],
        ['https://app.localhost:8777/api/v1/health', 'api_v1_health'],
        ['https://example.com/', null],
        ['https://example.com', null],
        ['https://example.com/?q=1#frag', null],
        ['not-a-url', null],
    ])('computeEndpointTag(%j) === %j', (input, expected) => {
        expect(computeEndpointTag(input)).toBe(expected);
    });
});

describe('computeAutoTags', () => {
    test('domain and endpoint together, both webpage_-prefixed', () => {
        expect(computeAutoTags('https://www.example.com/wiki/Article')).toEqual(['webpage_example_com', 'webpage_wiki_article']);
    });
    test('domain only when no path', () => {
        expect(computeAutoTags('https://example.com/')).toEqual(['webpage_example_com']);
    });
    test('empty for invalid url', () => {
        expect(computeAutoTags('not-a-url')).toEqual([]);
    });
    test('dedup when domain equals endpoint', () => {
        expect(computeAutoTags('https://example.com/example.com')).toEqual(['webpage_example_com']);
    });
});
