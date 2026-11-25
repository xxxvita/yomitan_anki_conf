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
import {FLIB_POS_SYSTEM_PROMPT, FLIB_POS_TRANSLATE_SYSTEM_PROMPT, FLIB_TRANSLATE_SYSTEM_PROMPT, FLIB_TRANSLATION_MAX_CHARS, buildPosRequestBody, buildPosTranslateRequestBody, buildTranslateRequestBody, countWords, entryPosSet, normalizeSentenceKey, parsePosAnswer, parsePosTranslateAnswer, parseTranslateAnswer, pickEntryByPos, pickPosTarget} from '../ext/js/data/flib-pos.js';

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

test('FLIB_POS_SYSTEM_PROMPT is byte-identical to the Flibooster literal', () => {
    expect(FLIB_POS_SYSTEM_PROMPT).toBe(`Role: English part-of-speech tagger. You receive a target word and the
sentence it appears in. Determine the part of speech of the TARGET word
AS USED IN THAT SENTENCE — by its role in the sentence, not the word's
most common use (e.g. "book" in "book a table" = verb).

Input: JSON after #DATA tag. Keys: w=target word, s=sentence.

Output: strictly valid JSON, nothing else:
{ "pos": "<part_of_speech>" }

Rules:
- pos: exactly ONE of noun, verb, adjective, adverb, pronoun, preposition,
  conjunction, determiner, interjection, numeral.
- Lowercase English word only. No examples, no translation, no extra keys,
  no markdown, no text outside the JSON.
`);
});

describe('FLIB_POS_TRANSLATE_SYSTEM_PROMPT', () => {
    test('keeps the POS rules and asks for tr', () => {
        expect(FLIB_POS_TRANSLATE_SYSTEM_PROMPT).toContain('AS USED IN THAT SENTENCE');
        expect(FLIB_POS_TRANSLATE_SYSTEM_PROMPT).toContain('exactly ONE of noun, verb, adjective, adverb, pronoun, preposition,\n  conjunction, determiner, interjection, numeral.');
        expect(FLIB_POS_TRANSLATE_SYSTEM_PROMPT).toContain('"tr"');
        expect(FLIB_POS_TRANSLATE_SYSTEM_PROMPT).toContain('{ "pos": "<part_of_speech>", "tr": "<translation>" }');
        expect(FLIB_POS_TRANSLATE_SYSTEM_PROMPT).not.toContain('no translation');
    });
});

describe('buildPosTranslateRequestBody', () => {
    test('same shape as the POS body with the new prompt', () => {
        const sentence = 'He said "book it"';
        const body = /** @type {{model: string, temperature: number, response_format: {type: string}, messages: {role: string, content: string}[]}} */ (buildPosTranslateRequestBody('book', sentence));
        const pos = /** @type {{model: string, temperature: number, response_format: {type: string}, messages: {role: string, content: string}[]}} */ (buildPosRequestBody('book', sentence));
        expect(body.model).toBe(pos.model);
        expect(body.temperature).toBe(pos.temperature);
        expect(body.response_format).toStrictEqual(pos.response_format);
        expect(body.messages[0]).toStrictEqual({role: 'system', content: FLIB_POS_TRANSLATE_SYSTEM_PROMPT});
        expect(body.messages[1]).toStrictEqual(pos.messages[1]);
    });

    test('only the translate body caps max_tokens; the POS body keeps the Flibooster shape', () => {
        const body = /** @type {{max_tokens?: number}} */ (buildPosTranslateRequestBody('book', 'book a table'));
        expect(body.max_tokens).toBe(1000);
        expect(buildPosRequestBody('book', 'book a table')).toStrictEqual({
            model: 'gpt-4o-mini',
            temperature: 0.4,
            response_format: {type: 'json_object'},
            messages: [
                {role: 'system', content: FLIB_POS_SYSTEM_PROMPT},
                {role: 'user', content: '#DATA {"w":"book","s":"book a table"}'},
            ],
        });
    });
});

describe('parsePosTranslateAnswer', () => {
    test.each([
        ['{"pos":"verb","tr":"\u042f \u0437\u0430\u0431\u0440\u043e\u043d\u0438\u0440\u043e\u0432\u0430\u043b."}', {pos: 'verb', translation: '\u042f \u0437\u0430\u0431\u0440\u043e\u043d\u0438\u0440\u043e\u0432\u0430\u043b.'}],
        ['{"pos":"vt","tr":"  X  "}', {pos: 'verb', translation: 'X'}],
        ['{"pos":"verb"}', {pos: 'verb', translation: null}],
        ['{"pos":"verb","tr":"   "}', {pos: 'verb', translation: null}],
        ['{"pos":"verb","tr":42}', {pos: 'verb', translation: null}],
        ['{"pos":"blah","tr":"X"}', {pos: null, translation: 'X'}],
        ['not json', {pos: null, translation: null}],
        [null, {pos: null, translation: null}],
    ])('%s', (content, expected) => {
        expect(parsePosTranslateAnswer(content)).toStrictEqual(expected);
    });

    test('translation over 2000 chars is missing: a near-limit sentence keeps its paid translation', () => {
        expect(parsePosTranslateAnswer(JSON.stringify({pos: 'noun', tr: 'x'.repeat(2001)}))).toStrictEqual({pos: 'noun', translation: null});
        expect(parsePosTranslateAnswer(JSON.stringify({pos: 'noun', tr: 'x'.repeat(2000)})).translation).toHaveLength(2000);
        expect(FLIB_TRANSLATION_MAX_CHARS).toBe(2000);
    });
});

describe('normalizeSentenceKey', () => {
    test('NFC, trim, whitespace runs collapse, case kept', () => {
        expect(normalizeSentenceKey('cafe\u0301')).toBe('caf\u00e9');
        expect(normalizeSentenceKey('a\u00a0\u00a0b\r\nc')).toBe('a b c');
        expect(normalizeSentenceKey('  x  ')).toBe('x');
        expect(normalizeSentenceKey('Book')).toBe('Book');
    });
});

describe('translate-only request', () => {
    test('body: same model settings, own prompt, #DATA with sentence only', () => {
        const body = /** @type {*} */ (buildTranslateRequestBody('He said "hi".'));
        const pos = /** @type {*} */ (buildPosRequestBody('w', 's'));
        expect(body.model).toBe(pos.model);
        expect(body.temperature).toBe(pos.temperature);
        expect(body.response_format).toStrictEqual(pos.response_format);
        expect(body.messages[0]).toStrictEqual({role: 'system', content: FLIB_TRANSLATE_SYSTEM_PROMPT});
        expect(body.messages[1].role).toBe('user');
        expect(parseJson(String(body.messages[1].content).slice(6))).toStrictEqual({s: 'He said "hi".'});
        expect(body.messages[1].content.startsWith('#DATA ')).toBe(true);
    });

    test('prompt asks for {"tr": ...} only and differs from the pos prompts', () => {
        expect(FLIB_TRANSLATE_SYSTEM_PROMPT).toContain('"tr"');
        expect(FLIB_TRANSLATE_SYSTEM_PROMPT).not.toBe(FLIB_POS_TRANSLATE_SYSTEM_PROMPT);
        expect(FLIB_TRANSLATE_SYSTEM_PROMPT).not.toBe(FLIB_POS_SYSTEM_PROMPT);
    });

    test('answer: valid, extra keys, whitespace', () => {
        expect(parseTranslateAnswer('{"tr":"Привет."}')).toBe('Привет.');
        expect(parseTranslateAnswer('{"tr":"  Привет.  ","pos":"verb","x":1}')).toBe('Привет.');
        expect(parseTranslateAnswer('ok: {"tr":"Да"} done')).toBe('Да');
    });

    test.each(['{"tr":""}', '{"tr":"   "}', '{"tr":5}', '{"x":1}', 'not json', '', '[]', '{"tr":'])('answer %j → null', (content) => {
        expect(parseTranslateAnswer(content)).toBeNull();
    });

    test('non-string content → null', () => {
        expect(parseTranslateAnswer(/** @type {*} */ (null))).toBeNull();
    });

    test('length cap: 2000 ok, 2001 null', () => {
        expect(parseTranslateAnswer(JSON.stringify({tr: 'я'.repeat(FLIB_TRANSLATION_MAX_CHARS)}))).toHaveLength(FLIB_TRANSLATION_MAX_CHARS);
        expect(parseTranslateAnswer(JSON.stringify({tr: 'я'.repeat(FLIB_TRANSLATION_MAX_CHARS + 1)}))).toBeNull();
    });

    test('markup stays text', () => {
        expect(parseTranslateAnswer('{"tr":"<script>alert(1)</script>"}')).toBe('<script>alert(1)</script>');
    });
});
