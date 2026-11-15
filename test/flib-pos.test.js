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
import {parseJson} from '../ext/js/core/json.js';
import {FLIB_POS_SYSTEM_PROMPT, buildPosRequestBody, countWords, entryPosSet, parsePosAnswer, pickEntryByPos, pickPosTarget} from '../ext/js/data/flib-pos.js';

/**
 * @param {string[]} wordClasses
 * @param {string[]} [tagNames]
 * @returns {import('dictionary').DictionaryEntry}
 */
function termEntry(wordClasses, tagNames = []) {
    return /** @type {import('dictionary').DictionaryEntry} */ (/** @type {unknown} */ ({
        type: 'term',
        headwords: [{term: 'book', wordClasses, sources: [{originalText: 'book'}]}],
        definitions: [{tags: tagNames.map((name) => ({name}))}],
    }));
}

describe('buildPosRequestBody', () => {
    test('body survives quotes', () => {
        const sentence = 'He said "book it"\n\\ now';
        const body = /** @type {{model: string, temperature: number, response_format: {type: string}, messages: {role: string, content: string}[]}} */ (buildPosRequestBody('book', sentence));
        expect(body.model).toBe('gpt-4o-mini');
        expect(body.temperature).toBe(0.4);
        expect(body.response_format.type).toBe('json_object');
        expect(body.messages[0]).toStrictEqual({role: 'system', content: FLIB_POS_SYSTEM_PROMPT});
        expect(body.messages[1].role).toBe('user');
        expect(body.messages[1].content.startsWith('#DATA ')).toBe(true);
        expect(parseJson(body.messages[1].content.slice(6))).toStrictEqual({w: 'book', s: sentence});
    });

    test('prompt is pos_detect verbatim', () => {
        expect(FLIB_POS_SYSTEM_PROMPT.startsWith('Role: English part-of-speech tagger.')).toBe(true);
        expect(FLIB_POS_SYSTEM_PROMPT).toContain('- pos: exactly ONE of noun, verb, adjective, adverb, pronoun, preposition,');
        expect(FLIB_POS_SYSTEM_PROMPT).toContain('"book" in "book a table" = verb');
    });
});

describe('parsePosAnswer', () => {
    test.each([
        ['{"pos":"verb"}', 'verb'],
        ['Sure: {"pos": "Verb"} ok', 'verb'],
        ['{"pos":"adj"}', 'adjective'],
        ['{"pos":" noun "}', 'noun'],
    ])('parse tolerant: %s', (content, expected) => {
        expect(parsePosAnswer(content)).toBe(expected);
    });

    test.each([['{"pos":"gerundive"}'], ['no json'], [null], ['{"pos":3}'], ['{"pos":"name"}'], ['{broken']])('parse rejects unknown: %s', (content) => {
        expect(parsePosAnswer(content)).toBeNull();
    });
});

describe('entryPosSet', () => {
    test('word classes and tags map to canonical names', () => {
        expect([...entryPosSet(termEntry(['v']))]).toStrictEqual(['verb']);
        expect([...entryPosSet(termEntry(['n'], ['uncount']))]).toStrictEqual(['noun']);
        expect([...entryPosSet(termEntry(['name']))]).toStrictEqual(['name']);
        expect([...entryPosSet(termEntry([], ['adj', 'not-comp']))]).toStrictEqual(['adjective']);
    });

    test('kanji entries have no part of speech', () => {
        const kanji = /** @type {import('dictionary').DictionaryEntry} */ (/** @type {unknown} */ ({type: 'kanji', character: '本'}));
        expect(entryPosSet(kanji).size).toBe(0);
    });
});

describe('pickEntryByPos', () => {
    const entries = [termEntry(['n']), termEntry(['v']), termEntry(['name'])];
    test('current entry matches', () => { expect(pickEntryByPos(entries, 'verb', 1)).toBe(1); });
    test('first matching entry otherwise', () => { expect(pickEntryByPos(entries, 'verb', 0)).toBe(1); });
    test('nothing matches', () => { expect(pickEntryByPos(entries, 'adverb', 0)).toBe(-1); });
    test('noun does not match a name entry', () => { expect(pickEntryByPos([termEntry(['name'])], 'noun', 0)).toBe(-1); });
});

describe('countWords', () => {
    test.each([['', 0], ['   ', 0], ['book', 1], ['book a table', 3], ['  I booked it. ', 3]])('%j has %i words', (sentence, n) => {
        expect(countWords(sentence)).toBe(n);
    });
});

describe('pickPosTarget', () => {
    /**
     * @param {string[][]} definitionTags
     * @returns {import('dictionary').DictionaryEntry}
     */
    const grouped = (definitionTags) => /** @type {import('dictionary').DictionaryEntry} */ (/** @type {unknown} */ ({
        type: 'term',
        headwords: [{term: 'book', wordClasses: ['n', 'v'], sources: [{originalText: 'book'}]}],
        definitions: definitionTags.map((tags) => ({tags: tags.map((name) => ({name}))})),
    }));

    test('one grouped entry: the first definition of that part of speech', () => {
        expect(pickPosTarget([grouped([['n'], ['n', 'uncount'], ['v', 'vt'], ['v']])], 'verb', 0)).toStrictEqual({entryIndex: 0, definitionIndex: 2});
    });

    test('split entries: the matching entry, from its top when its definitions carry no tag', () => {
        expect(pickPosTarget([termEntry(['n']), termEntry(['v'])], 'verb', 0)).toStrictEqual({entryIndex: 1, definitionIndex: 0});
    });

    test('nothing matches', () => {
        expect(pickPosTarget([grouped([['n'], ['v']])], 'adverb', 0)).toBeNull();
    });
});
