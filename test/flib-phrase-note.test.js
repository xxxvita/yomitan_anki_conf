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
import {BLANK} from '../ext/js/data/flib-enrich.js';
import {buildPhraseNoteFields, phraseSpeechTexts, pickPhraseBlank, samePhraseNote} from '../ext/js/data/flib-phrase-note.js';

/**
 * Selects the `index`-th occurrence of `part` in `value`.
 * @param {string} value
 * @param {string} part
 * @param {number} [index]
 * @returns {{value: string, selectionStart: number, selectionEnd: number}}
 * @throws {Error}
 */
function select(value, part, index = 0) {
    let start = -1;
    for (let i = 0; i <= index; ++i) { start = value.indexOf(part, start + 1); }
    if (start < 0) { throw new Error(`No "${part}" in "${value}"`); }
    return {value, selectionStart: start, selectionEnd: start + part.length};
}

/**
 * @param {string} value
 * @param {string} part
 * @param {number} [index]
 * @returns {?string}
 */
function picked(value, part, index = 0) {
    const blank = pickPhraseBlank(select(value, part, index));
    return blank === null ? null : value.slice(blank.start, blank.end);
}

/**
 * Front, EnglishWord, Expression of the phrase with `part` selected (null — nothing selected).
 * @param {string} value
 * @param {?string} part
 * @param {number} [index]
 * @returns {?[front: string, englishWord: string, expression: string]}
 */
function texts(value, part, index = 0) {
    const blank = part === null ? null : pickPhraseBlank(select(value, part, index));
    const fields = buildPhraseNoteFields({value, blank, translation: '', mediaHtml: ''});
    return fields === null ? null : [fields.Front, fields.EnglishWord, fields.Expression];
}

/**
 * @param {string} translation
 * @returns {string|undefined}
 */
function translated(translation) {
    return buildPhraseNoteFields({value: 'I love it', blank: null, translation, mediaHtml: ''})?.ExpressionTranslate;
}

describe('pickPhraseBlank', () => {
    test.each([
        ['I love it', 'love', 'love'],
        ['I love it', 'ov', 'love'],
        ['I love it', ' love ', 'love'],
        ['I love it', 've i', 'love it'],
        ['Yes, I love, it.', ', I love, ', 'I love'],
        ['I don\'t know', 'on', 'don\'t'],
        ['I don’t know', 't', 'don’t'],
        ['a well-known man', 'known', 'well-known'],
        ['wait--what now', 'wait', 'wait'],
        ['the \'love\' of', 'love', 'love'],
        ['the dogs\' bowl', 'dogs\'', 'dogs'],
        ['my 3rd café here', 'caf', 'café'],
        ['my cafe\u0301 here', 'cafe', 'cafe\u0301'],
        ['it was won\u00ADder\u200Bful', 'der', 'won\u00ADder\u200Bful'],
        ['I ❤️ it all', '❤️ it', 'it'],
        ['say {{c1::x}} now', 'x', 'x'],
        ['a naïve 東京 plan', 'ïve 東', 'naïve 東京'],
    ])('%j, selected %j → %j', (value, part, expected) => {
        expect(picked(value, part)).toBe(expected);
    });

    test('the offsets are offsets in the untouched value', () => {
        const value = '  \n I\n\nlove  it ';
        expect(pickPhraseBlank(select(value, 'ove '))).toStrictEqual({start: 7, end: 11});
    });

    test('the second of two equal words', () => {
        const value = 'I love love';
        expect(pickPhraseBlank(select(value, 'love', 1))).toStrictEqual({start: 7, end: 11});
    });

    test.each([
        ['I love it', ' '],
        ['I love,  it', ',  '],
        ['Well ... I know', '...'],
        ['I don\'t know', '\''],
        ['I <b> it', '<b>'],
        ['I ❤️ it', '❤️'],
        ['say слово now', 'слово'],
        ['room 42 here', '42'],
        ['I love it', 'I love it'],
        ['  I love it!  ', '  I love it!  '],
        ['"Well, I know."', 'Well, I know'],
        ['love', 'love'],
        ['love', 'o'],
        ['<b>love</b>', 'love'],
        ['🙂 love!', 'love'],
        ['да <b> да', 'да <b> да'],
    ])('%j, selected %j → no blank', (value, part) => {
        expect(pickPhraseBlank(select(value, part))).toBeNull();
    });

    test('a selection is needed, inside the text', () => {
        const value = 'I love it';
        expect(pickPhraseBlank({value, selectionStart: 3, selectionEnd: 3})).toBeNull();
        expect(pickPhraseBlank({value, selectionStart: 5, selectionEnd: 2})).toBeNull();
        expect(pickPhraseBlank({value, selectionStart: null, selectionEnd: null})).toBeNull();
        expect(pickPhraseBlank({value, selectionStart: Number.NaN, selectionEnd: 4})).toBeNull();
        expect(pickPhraseBlank({value, selectionStart: 100, selectionEnd: 200})).toBeNull();
        expect(pickPhraseBlank({value, selectionStart: 7, selectionEnd: 200})).toStrictEqual({start: 7, end: 9});
        expect(pickPhraseBlank({value: '', selectionStart: 0, selectionEnd: 0})).toBeNull();
    });

    test('picking the picked blank changes nothing', () => {
        const value = 'a well-known man, I don’t know';
        const blank = pickPhraseBlank(select(value, 'own man, I d'));
        if (blank === null) { throw new Error('No blank'); }
        expect(pickPhraseBlank({value, selectionStart: blank.start, selectionEnd: blank.end})).toStrictEqual(blank);
    });
});

describe('buildPhraseNoteFields', () => {
    test('the table: a selection', () => {
        const value = 'Well, I love it.';
        expect(buildPhraseNoteFields({value, blank: pickPhraseBlank(select(value, 'love')), translation: 'Ну, люблю.', mediaHtml: '<ol><li>x</li></ol>'})).toStrictEqual({
            Front: 'Well, I _____ it.',
            Expression: 'Well, I love it.',
            EnglishWord: 'love',
            ExpressionTranslate: 'Ну, люблю.',
            flib_media: '<ol><li>x</li></ol>',
            Audio_front: '',
            Audio_expression: '',
        });
        expect(BLANK).toBe('_____');
    });

    test('the table: no selection', () => {
        expect(buildPhraseNoteFields({value: ' Well,\n I know. ', blank: null, translation: '', mediaHtml: ''})).toStrictEqual({
            Front: 'Well, I know.',
            Expression: 'Well, I know.',
            EnglishWord: 'Well, I know.',
            ExpressionTranslate: '',
            flib_media: '',
            Audio_front: '',
            Audio_expression: '',
        });
    });

    test.each([
        // the same word twice
        ['I love love', 'love', 0, ['I _____ love', 'love', 'I love love']],
        ['I love love', 'love', 1, ['I love _____', 'love', 'I love love']],
        // whitespace around and inside the blank
        ['  I\n\n love \t\n it\u00A0\u00A0now ', 'love', 0, ['I _____ it now', 'love', 'I love it now']],
        ['so give \n up now', 'give \n up', 0, ['so _____ now', 'give up', 'so give up now']],
        ['\n love it', 'love', 0, ['_____ it', 'love', 'love it']],
        ['it love \n', 'love', 0, ['it _____', 'love', 'it love']],
        // curly quotes and apostrophes stay as they are
        ['“I don’t know” it\'s "so"', 'don’t', 0, ['“I _____ know” it\'s "so"', 'don’t', '“I don’t know” it\'s "so"']],
        // emoji
        ['I 👨‍👩‍👧 love ❤️ it', 'love', 0, ['I 👨‍👩‍👧 _____ ❤️ it', 'love', 'I 👨‍👩‍👧 love ❤️ it']],
        // underscores of the text
        ['a __ b ___ love', 'love', 0, ['a _ b _ _____', 'love', 'a _ b _ love']],
        ['I __love__ it', 'love', 0, ['I _____ it', 'love', 'I love it']],
        ['I _\u200B_love it', 'love', 0, ['I _____ it', 'love', 'I love it']],
        ['I _<b></b>love<i>_ it', 'love', 0, ['I _____ it', 'love', 'I love it']],
        ['I give__up now', 'give__up', 0, ['I _____ now', 'give_up', 'I give_up now']],
        // markup
        ['I <b>love</b> R&D <x', 'love', 0, ['I _____ RD x', 'love', 'I love RD x']],
        ['I <love> it', 'love', 0, ['I _____ it', 'love', 'I love it']],
        ['so a <b>gi</b>ve up', 'a <b>gi', 0, ['so _____ve up', 'a gi', 'so a give up']],
        ['say {{c1::x}} now', 'x', 0, ['say {{c1::_____}} now', 'x', 'say {{c1::x}} now']],
        // [sound:
        ['I [sound:x] love', 'love', 0, ['I sound:x] _____', 'love', 'I sound:x] love']],
        ['a [sound:x] b', 'sound', 0, ['a _____:x] b', 'sound', 'a sound:x] b']],
        ['a [[SOUND:x] b', 'x', 0, ['a SOUND:_____] b', 'x', 'a SOUND:x] b']],
        ['a [so<b></b>und:x] b', 'so', 0, ['a _____und:x] b', 'so', 'a sound:x] b']],
        ['a [x [so<b></b>und:y] b', 'x [so', 0, ['a [_____und:y] b', 'x so', 'a [x sound:y] b']],
        ['a _[sound:x b', 'sound', 0, ['a _____:x b', 'sound', 'a sound:x b']],
        // control and invisible characters
        ['I\u0000 lo\u0007ve \u001Fit', 'lo\u0007ve', 0, ['I _____ it', 'love', 'I love it']],
        ['I won\u00ADder\uFEFF now', 'won', 0, ['I _____ now', 'wonder', 'I wonder now']],
        // a combining mark orphaned by the cleaning belongs to nothing
        ['my cafe<\u0301 here', 'cafe', 0, ['my _____ here', 'cafe', 'my cafe here']],
    ])('%j, selected %j (%i)', (value, part, index, expected) => {
        expect(texts(value, part, index)).toStrictEqual(expected);
    });

    test.each([
        ['I  __ love\n__it', 'I _ love _it'],
        ['I <b>love</b> & it', 'I love it'],
        ['[[sound:sound:x', 'sound:sound:x'],
        ['a [[so\u200Bund:x]', 'a sound:x]'],
        ['a [_<b></b>_[sound:x]', 'a [_sound:x]'],
        ['a [<b></b>Sound:x]', 'a Sound:x]'],
        ['say {{c1::x}} "now" it\'s', 'say {{c1::x}} "now" it\'s'],
        ['it _<x>_ is', 'it _ is'],
        ['a < b > c', 'a c'],
        ['lone \uD83D half', 'lone half'],
    ])('the whole phrase %j → %j', (value, expected) => {
        expect(texts(value, null)).toStrictEqual([expected, expected, expected]);
    });

    test('NFD input equals NFC input', () => {
        const value = 'the café is a naïve ≮ place';
        const nfd = value.normalize('NFD');
        expect(nfd).not.toBe(value);
        expect(texts(nfd, null)).toStrictEqual([value, value, value]);
        expect(texts(nfd, 'cafe')).toStrictEqual(['the _____ is a naïve ≮ place', 'café', value]);
        expect(texts(value, 'caf')).toStrictEqual(texts(nfd, 'cafe'));
        expect(texts('say é now'.normalize('NFD'), 'e')).toStrictEqual(texts('say é now', 'é'));
        expect(texts('say é now', 'é')).toStrictEqual(['say _____ now', 'é', 'say é now']);
    });

    test('letters that merge across the seam: no blank, and the pick knows it', () => {
        for (const part of ['\u1161 b', 'b \u1100']) {
            const value = part.startsWith('b') ? 'x b \u1100<\u1161' : 'x \u1100<\u1161 b';
            const whole = part.startsWith('b') ? 'x b \uAC00' : 'x \uAC00 b';
            expect(pickPhraseBlank(select(value, part))).toBeNull();
            expect(texts(value, part)).toStrictEqual([whole, whole, whole]);
        }
    });

    test.each([
        // cleaning leaves nothing of it
        ['I <b> it', 2, 5, 'I it'],
        ['I <br> it', 1, 7, 'I it'],
        // nothing English, or nothing outside of it
        ['да <b> да', 0, 9, 'да да'],
        ['<b>love</b>', 3, 7, 'love'],
        // not a range
        ['I love it', 1, 2, 'I love it'],
        ['I love it', 5, 2, 'I love it'],
        ['I love it', Number.NaN, 4, 'I love it'],
    ])('a blank that is not one: %j %i–%i is saved whole', (value, start, end, expected) => {
        expect(buildPhraseNoteFields({value, blank: {start, end}, translation: '', mediaHtml: ''}))
            .toMatchObject({Front: expected, EnglishWord: expected, Expression: expected});
    });

    test('an unaligned blank is widened to whole words', () => {
        expect(buildPhraseNoteFields({value: 'I love it', blank: {start: 1, end: 4}, translation: '', mediaHtml: ''}))
            .toMatchObject({Front: 'I _____ it', EnglishWord: 'love', Expression: 'I love it'});
    });

    test.each([[''], [' \n\t '], ['<b></b>'], ['<script>x</script>'], ['&<>'], ['\u0000\u200B'], ['... !'], ['__'], ['🙂']])('%j → nothing to save', (value) => {
        expect(buildPhraseNoteFields({value, blank: null, translation: 'перевод', mediaHtml: ''})).toBeNull();
        expect(buildPhraseNoteFields({value, blank: {start: 0, end: value.length}, translation: '', mediaHtml: ''})).toBeNull();
    });

    test('the translation: markup removed, the rest escaped, newlines kept', () => {
        expect(translated(' «Люблю» <b>это</b> & "то" it\'s\r\nвторая\nтретья\n ')).toBe('«Люблю» это  &quot;то&quot; it&#39;s<br>вторая<br>третья');
        expect(translated('<img src=x onerror=alert(1)>a')).toBe('a');
        expect(translated('a <script>x\n</script>b &lt;i&gt;')).toBe('a b lt;igt;');
        expect(translated(' \n\n ')).toBe('');
        expect(translated('<b>\n</b>')).toBe('');
    });
});

describe('phraseSpeechTexts', () => {
    test('the phrase and the pause', () => {
        const value = 'I \n love __ it';
        expect(phraseSpeechTexts({value, blank: pickPhraseBlank(select(value, 'love'))})).toStrictEqual({expression: 'I love _ it', front: 'I ... ... ... _ it'});
        expect(phraseSpeechTexts({value, blank: null})).toStrictEqual({expression: 'I love _ it', front: null});
        expect(phraseSpeechTexts({value: 'love', blank: {start: 0, end: 4}})).toStrictEqual({expression: 'love', front: null});
        expect(phraseSpeechTexts({value: '<b></b>', blank: null})).toStrictEqual({expression: '', front: null});
    });
});

describe('samePhraseNote', () => {
    const note = {Front: 'I don\'t _____ “it” é', EnglishWord: 'love'};

    test.each([
        ['itself', note],
        ['entities', {Front: 'I don&#39;t _____ &ldquo;it&rdquo; &#xE9;', EnglishWord: 'love'}],
        ['&apos;', {Front: 'I don&apos;t _____ “it” é', EnglishWord: 'l&#111;ve'}],
        ['&nbsp; and spaces', {Front: ' I&nbsp;don\'t\u00A0 _____ \n“it” é&nbsp;', EnglishWord: '&nbsp;love '}],
        ['<br>', {Front: 'I don\'t<br>_____<BR/>“it” é<br />', EnglishWord: 'love<br>'}],
        ['editor markup', {Front: '<div>I don\'t _____ <b>“it”</b> é</div><!-- x -->', EnglishWord: '<span style="color: red">lo</span>ve'}],
        ['NFD', {Front: note.Front.normalize('NFD'), EnglishWord: 'love'}],
    ])('the same: %s', (_name, other) => {
        expect(samePhraseNote(note, other)).toBe(true);
        expect(samePhraseNote(other, note)).toBe(true);
    });

    test.each([
        ['another word', {Front: note.Front, EnglishWord: 'hate'}],
        ['another front', {Front: 'I don\'t _____ “it”', EnglishWord: 'love'}],
        ['letter case of the word', {Front: note.Front, EnglishWord: 'Love'}],
        ['letter case of the front', {Front: note.Front.toUpperCase(), EnglishWord: 'love'}],
        ['punctuation', {Front: `${note.Front}.`, EnglishWord: 'love'}],
        ['straight quotes', {Front: 'I don\'t _____ "it" é', EnglishWord: 'love'}],
    ])('different: %s', (_name, other) => {
        expect(samePhraseNote(note, other)).toBe(false);
    });

    test('entities are decoded once; what is not an entity stays', () => {
        expect(samePhraseNote({Front: '&amp;lt;', EnglishWord: ''}, {Front: '<', EnglishWord: ''})).toBe(false);
        expect(samePhraseNote({Front: '&amp;lt;', EnglishWord: ''}, {Front: '&amp;lt;', EnglishWord: ''})).toBe(true);
        expect(samePhraseNote({Front: 'a &lt; b &gt; c', EnglishWord: 'x'}, {Front: 'a c', EnglishWord: 'x'})).toBe(false);
        expect(samePhraseNote({Front: '&constructor;&#99999999;&#xD800;', EnglishWord: 'x'}, {Front: '', EnglishWord: 'x'})).toBe(false);
        expect(samePhraseNote({Front: 'AT&T', EnglishWord: 'x'}, {Front: 'AT&amp;T', EnglishWord: 'x'})).toBe(true);
    });
});

describe('invariants on generated phrases', () => {
    const PIECES = [
        'love',
        'I',
        'it',
        'don\'t',
        'don’t',
        'well-known',
        'café',
        'cafe\u0301',
        'sound',
        'SOUND',
        'so',
        'und',
        'b',
        'script',
        'слово',
        '東京',
        '42',
        'ᄀ',
        'ᅡ',
        'e',
        ' ',
        ' ',
        ' ',
        '  ',
        '\n',
        '\t',
        '\u00A0',
        '\uFEFF',
        '\u2028',
        '_',
        '__',
        '_____',
        '[',
        '[[',
        ']',
        ':',
        '[sound:',
        'sound:',
        '[sound:x.mp3]',
        '<',
        '>',
        '&',
        '&lt;',
        '&#39;',
        '<b>',
        '</b>',
        '<script>',
        '</script>',
        '<br>',
        '.',
        ',',
        '!',
        '…',
        '“',
        '”',
        '"',
        '\'',
        '’',
        '-',
        '$&',
        '$1',
        '{{c1::',
        '}}',
        '\\',
        '*',
        '\u0301',
        '\u0338',
        '\u0000',
        '\u0007',
        '\u001F',
        '\u0085',
        '\u00AD',
        '\u200B',
        '\u200D',
        '\u202E',
        '🙂',
        '❤️',
        '👨‍👩‍👧',
        '\uD83D',
        '\uDE42',
    ];

    /**
     * Mulberry32: the same phrases on every run.
     * @param {number} seed
     * @returns {() => number}
     */
    function createRandom(seed) {
        let state = seed;
        return () => {
            state = (state + 0x6D2B79F5) | 0;
            let t = Math.imul(state ^ (state >>> 15), 1 | state);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
    }

    test('the fields agree with each other', () => {
        const random = createRandom(437);
        /**
         * @param {number} limit
         * @returns {number}
         */
        const int = (limit) => Math.floor(random() * limit);
        const counts = {blank: 0, whole: 0, empty: 0};
        for (let i = 0; i < 3000; ++i) {
            let value = '';
            for (let j = int(14); j >= 0; --j) { value += PIECES[int(PIECES.length)]; }
            const selectionStart = int(value.length + 1);
            const selectionEnd = int(value.length + 1);
            const blank = pickPhraseBlank({value, selectionStart, selectionEnd});
            const fields = buildPhraseNoteFields({value, blank, translation: value, mediaHtml: ''});
            const context = JSON.stringify({value, selectionStart, selectionEnd, blank, fields});
            if (blank !== null) {
                // The pick promises a blank, so the note has it: the button's hint does not lie.
                expect(blank.start < selectionEnd && blank.end > selectionStart, context).toBe(true);
                expect(fields !== null && fields.Front !== fields.Expression, context).toBe(true);
            }
            if (fields === null) {
                ++counts.empty;
                continue;
            }
            const {Front, Expression, EnglishWord} = fields;
            for (const text of [Front, Expression, EnglishWord]) {
                expect(text, context).not.toMatch(/[<>&]/);
                expect(text, context).not.toMatch(/\[sound:/i);
                expect(text, context).not.toMatch(/\p{Cc}|\p{Cs}|[\u00AD\u200B\u202E\uFEFF]/u);
                expect(text, context).toBe(text.replace(/\s+/g, ' ').trim());
                expect(text, context).toBe(text.normalize('NFC'));
                expect(text, context).toMatch(/[\p{L}\p{N}]/u);
            }
            for (const text of [Expression, EnglishWord]) { expect(text, context).not.toMatch(/_{2,}/); }
            if (blank === null) {
                ++counts.whole;
                expect(Front, context).toBe(Expression);
                expect(EnglishWord, context).toBe(Expression);
            } else {
                ++counts.blank;
                expect(Front.match(/_{2,}/g), context).toStrictEqual([BLANK]);
                expect(Front.split(BLANK).join(EnglishWord), context).toBe(Expression);
                expect(EnglishWord, context).toMatch(/\p{Script=Latin}/u);
            }
            expect(fields.ExpressionTranslate.replaceAll('<br>', ''), context).not.toMatch(/[<>"']|&(?!quot;|#39;)/);
            expect(phraseSpeechTexts({value, blank}).expression, context).toBe(Expression);
            // Saving the saved phrase again changes nothing.
            expect(texts(Expression, null)?.[2], context).toBe(Expression);
        }
        expect(counts.blank).toBeGreaterThan(400);
        expect(counts.whole).toBeGreaterThan(400);
        expect(counts.empty).toBeGreaterThan(50);
    });
});
