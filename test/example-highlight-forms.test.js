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
import {IRREGULAR_VERBS, buildHighlightMatcher, highlightCueParts, inflectEnglishToken} from '../ext/js/display/example-highlight-forms.js';

/**
 * @param {string} text
 * @param {string[]} words
 * @returns {string[]}
 */
function hits(text, words) {
    return highlightCueParts(text, words).filter((p) => p.hl === true).map((p) => p.t);
}

describe('inflectEnglishToken', () => {
    test.each([
        ['fix', ['fix', 'fixes', 'fixed', 'fixing']],
        ['watch', ['watches', 'watched', 'watching']],
        ['try', ['tries', 'tried', 'trying']],
        ['play', ['plays', 'played', 'playing']],
        ['make', ['makes', 'making']],
        ['love', ['loves', 'loved', 'loving']],
        ['stop', ['stops', 'stopped', 'stopping']],
        ['run', ['runs', 'running', 'ran']],
        ['die', ['dies', 'died', 'dying']],
        ['see', ['sees', 'seeing', 'saw', 'seen']],
        ['go', ['goes', 'going', 'went', 'gone']],
        ['be', ['am', 'is', 'are', 'was', 'were', 'been', 'being']],
        ['have', ['has', 'had', 'having']],
        ['panic', ['panicked', 'panicking']],
        ['travel', ['travels', 'traveled', 'travelled', 'traveling', 'travelling']],
        ['box', ['boxes', 'boxed', 'boxing']],
    ])('%s', (token, expected) => {
        const forms = inflectEnglishToken(token);
        for (const form of expected) { expect(forms).toContain(form); }
        expect(forms[0]).toBe(token);
    });

    test('single-syllable CVC doubles only; w/x/y never double', () => {
        expect(inflectEnglishToken('stop')).not.toContain('stoped');
        expect(inflectEnglishToken('fix')).not.toContain('fixxed');
        expect(inflectEnglishToken('show')).not.toContain('showwed');
    });

    test('irregular verbs get no regular -ed/-d: no real-word false positives (review H1)', () => {
        expect(inflectEnglishToken('be')).not.toContain('bed');
        expect(inflectEnglishToken('see')).not.toContain('seed');
        expect(inflectEnglishToken('sing')).not.toContain('singed');
        expect(inflectEnglishToken('ring')).not.toContain('ringed');
        expect(inflectEnglishToken('wind')).not.toContain('winded');
        expect(inflectEnglishToken('see')).toEqual(expect.arrayContaining(['sees', 'seeing']));
        expect(inflectEnglishToken('sing')).toEqual(expect.arrayContaining(['sings', 'singing', 'sang', 'sung']));
        expect(inflectEnglishToken('do')).toEqual(expect.arrayContaining(['does', 'doing', 'did', 'done']));
        expect(inflectEnglishToken('go')).toEqual(expect.arrayContaining(['goes', 'going']));
        expect(inflectEnglishToken('be')).toContain('being');
        expect(hits('a bed and some seed', buildHighlightMatcher({terms: ['be', 'see']}))).toEqual([]);
    });

    test('words of ≤2 letters are inflected only via the irregular table (review H2)', () => {
        expect(inflectEnglishToken('hi')).toEqual(['hi']);
        expect(inflectEnglishToken('s')).toEqual(['s']);
        expect(inflectEnglishToken('k')).toEqual(['k']);
        expect(inflectEnglishToken('b')).toEqual(['b']);
        expect(inflectEnglishToken('be')).not.toContain('bes');
        expect(inflectEnglishToken('go')).not.toContain('gos');
        expect(inflectEnglishToken('go')).not.toContain('goed');
    });

    test('function words and non-Latin tokens are not inflected', () => {
        expect(inflectEnglishToken('on')).toEqual(['on']);
        expect(inflectEnglishToken('a')).toEqual(['a']);
        expect(inflectEnglishToken("one's")).toEqual(["one's"]);
        expect(inflectEnglishToken('бежать')).toEqual(['бежать']);
    });

    test('input is lower-cased; empty input → empty list', () => {
        expect(inflectEnglishToken('Fix')).toContain('fixed');
        expect(inflectEnglishToken('')).toEqual([]);
    });

    test('the irregular table is big enough and well-formed', () => {
        expect(Object.keys(IRREGULAR_VERBS).length).toBeGreaterThanOrEqual(140);
        for (const [base, forms] of Object.entries(IRREGULAR_VERBS)) {
            expect(base).toMatch(/^[a-z]+$/);
            for (const f of forms) { expect(f).toMatch(/^[a-z]+$/); }
        }
    });
});

describe('buildHighlightMatcher + highlightCueParts', () => {
    test('owner recording: «fix on» highlights the inflected YouTube lines', () => {
        const words = buildHighlightMatcher({terms: ['fix on']});
        expect(hits('the camera is being fixed on the target', words)).toEqual(['fixed on']);
        expect(hits('so the fixing on the wall is loose', words)).toEqual(['fixing on']);
        expect(hits('the camera fixes on her face', words)).toEqual(['fixes on']);
        expect(hits("they're fixed on the price", words)).toEqual(['fixed on']);
        expect(hits('just fix on one thing', words)).toEqual(['fix on']);
    });

    test('«went» and «gone» for lemma go', () => {
        const words = buildHighlightMatcher({terms: ['go']});
        expect(hits('She went home', words)).toEqual(['went']);
        expect(hits("He's gone", words)).toEqual(['gone']);
        expect(hits('Going, going, GONE', words)).toEqual(['Going', 'going', 'GONE']);
    });

    test('no false positives inside longer words', () => {
        expect(hits('a fixture on the wall', buildHighlightMatcher({terms: ['fix']}))).toEqual([]);
        expect(hits('the gong rang', buildHighlightMatcher({terms: ['go']}))).toEqual([]);
        expect(hits('a gonelike sound', buildHighlightMatcher({terms: ['go']}))).toEqual([]);
    });

    test('phrase token order is respected, only whitespace between tokens', () => {
        const words = buildHighlightMatcher({terms: ['fix on']});
        expect(hits('on fixed ground', words)).toEqual([]);
        expect(hits('fixed it on', words)).toEqual([]);
        expect(hits('fixed\non it', words)).toEqual(['fixed\non']);
        expect(hits('fixed,on', words)).toEqual([]);
    });

    test('exact forms (gateway matched_forms) are added as-is; lemma is inflected', () => {
        const words = buildHighlightMatcher({terms: ['ran', 'run'], forms: ['runnin']});
        expect(hits('runnin late, she runs and ran', words)).toEqual(['runnin', 'runs', 'ran']);
    });

    test('sources are deduped, junk is ignored, longest form wins', () => {
        const words = buildHighlightMatcher({terms: ['fix', 'Fix', '', '  ', 'fix on'], forms: [(/** @type {unknown} */ (null))]});
        expect(new Set(words.map((w) => w.toLowerCase())).size).toBe(words.length);
        expect(hits('they fixed on it', words)).toEqual(['fixed on']);
    });

    test('a huge phrase stays small: only its first content token is inflected', () => {
        const words = buildHighlightMatcher({terms: ['make take give bring keep run stop fix see go']});
        expect(words.length).toBeLessThanOrEqual(20);
        expect(words).toContain('make take give bring keep run stop fix see go');
        expect(words).toContain('made take give bring keep run stop fix see go');
    });

    test('«take something into account» keeps every form of the verb (review M3)', () => {
        const words = buildHighlightMatcher({terms: ['take something into account']});
        for (const form of ['take', 'takes', 'took', 'taken', 'taking']) {
            expect(words).toContain(`${form} something into account`);
        }
        expect(hits('she took something into account', words)).toEqual(['took something into account']);
    });

    test('empty sources → empty matcher → no highlight', () => {
        expect(buildHighlightMatcher({terms: []})).toEqual([]);
        expect(hits('anything', [])).toEqual([]);
    });
});
