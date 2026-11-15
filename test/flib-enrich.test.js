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

import {readFileSync} from 'node:fs';
import {describe, expect, test} from 'vitest';
import {parseJson} from '../ext/js/core/json.js';
import {
    blankTarget,
    buildChatBody,
    buildReverseDeckData,
    enrichmentUser,
    escapeHtml,
    extractSoundFile,
    findFormUser,
    frontSpeechText,
    mediaFileName,
    parseJsonAnswer,
    phrasesFields,
    phrasesUser,
    reverseDeckFields,
    sanitizeEnrichment,
    synonymWords,
    cleanModelText,
    ttsText,
} from '../ext/js/data/flib-enrich.js';

/** @type {import('../ext/js/data/flib-enrich.js').FlibEnrichPrompts} */
const FLIB_ENRICH_PROMPTS = parseJson(readFileSync(new URL('../ext/data/flib-enrich-prompts.json', import.meta.url), 'utf8'));

describe('prompts', () => {
    test('prompts verbatim from anki_conf a62faa63e', () => {
        expect(FLIB_ENRICH_PROMPTS.source).toBe('anki_conf a62faa63e configs/llm_queries.yaml');
        expect(FLIB_ENRICH_PROMPTS.enrichment.startsWith('Role: EN→RU lexical enricher. Style: Oxford B1-B2, friendly, modern British English.')).toBe(true);
        expect(FLIB_ENRICH_PROMPTS.enrichment).toContain('- items: РОВНО 6 элементов.');
        expect(FLIB_ENRICH_PROMPTS.phrases.startsWith('Ты — генератор живых примеров в стиле Oxford (британский вариант).')).toBe(true);
        expect(FLIB_ENRICH_PROMPTS.phrases).toContain('- target_form: обязательно.');
        expect(FLIB_ENRICH_PROMPTS.findForm.startsWith('На вход JSON: {"sentence": "<английское предложение>", "word": "<базовое слово или выражение>"}.')).toBe(true);
    });

    test('user messages survive quotes and newlines', () => {
        const ex = 'He said "live"\nand left \\ now';
        expect(parseJson(enrichmentUser('live', ex).slice(6))).toStrictEqual({w: 'live', ex});
        expect(enrichmentUser('live', ex).startsWith('#DATA ')).toBe(true);
        expect(parseJson(phrasesUser('live', ex))).toStrictEqual({word: 'live', context: ex});
        expect(parseJson(findFormUser(ex, 'live'))).toStrictEqual({sentence: ex, word: 'live'});
    });

    test('chat body', () => {
        expect(buildChatBody('SYS', 'USER')).toStrictEqual({
            model: 'gpt-4o-mini',
            temperature: 0.4,

            response_format: {type: 'json_object'},
            messages: [{role: 'system', content: 'SYS'}, {role: 'user', content: 'USER'}],
        });
    });
});

describe('parseJsonAnswer', () => {
    test('tolerant: text around JSON, fences', () => {
        expect(parseJsonAnswer('```json\n{"tr":"жить"}\n```')).toStrictEqual({tr: 'жить'});
    });
    test.each([['no json'], [null], ['[1,2]'], ['{bad']])('rejects %j', (content) => {
        expect(parseJsonAnswer(content)).toBeNull();
    });
});

describe('sanitizeEnrichment', () => {
    test('escapes model html: only <b> survives in examples, nothing elsewhere', () => {
        const clean = /** @type {Record<string, unknown>} */ (sanitizeEnrichment({
            tr: 'жить<script>x</script>',
            items: [{h: 'I <b>live</b> here<img src=x onerror=alert(1)>', t: 'Я <i>живу</i>', c: 'место'}],
            syn: ['reside,verb,проживать<script>'],
            pos: 'verb',
        }));
        expect(clean.tr).toBe('жить');
        expect(clean.items).toStrictEqual([{h: 'I <b>live</b> here', t: 'Я живу', c: 'место'}]);
        expect(clean.syn).toStrictEqual(['reside,verb,проживать']);
        expect(clean.pos).toBe('verb');
    });
});

describe('synonymWords', () => {
    test('syn formats: "word,pos,перевод" and objects', () => {
        expect(synonymWords({syn: ['reside,verb,проживать', {word: 'dwell'}, {w: 'abide', pos: 'verb'}, ' , ', 42]})).toStrictEqual(['reside', 'dwell', 'abide']);
        expect(synonymWords({})).toStrictEqual([]);
    });
});

describe('reverse deck', () => {
    const exampleLLM = JSON.stringify({tr: 'жить', pos: 'verb', items: [{h: 'I <b>live</b> here', t: 'Я живу здесь'}], eu: 'x', eut: 'y'});

    test('reverse data schema v1.0 like Flibooster', () => {
        expect(parseJson(buildReverseDeckData('жить', 'live', ['reside'], exampleLLM, '[sound:tts_live_1.mp3]'))).toStrictEqual({
            front: 'жить',
            englishWords: [{word: 'live', partOfSpeech: 'verb', synonyms: ['reside'], audio: [{selected: true, file: 'tts_live_1.mp3'}]}],
            examples: ['I live here', 'Я живу здесь'],
        });
    });

    test('examples fall back to eu/eut, audio empty without sound', () => {
        const data = /** @type {{examples: string[], englishWords: {audio: unknown[]}[]}} */ (parseJson(buildReverseDeckData('жить', 'live', [], JSON.stringify({eu: 'We live', eut: 'Мы живём'}), '')));
        expect(data.examples).toStrictEqual(['We live', 'Мы живём']);
        expect(data.englishWords[0].audio).toStrictEqual([]);
    });

    test('fields', () => {
        expect(reverseDeckFields({word: 'live', translation: 'жить', exampleLLM, synonyms: ['reside', 'dwell'], baseAudio: ''})).toMatchObject({
            Front: 'жить',
            Back: '',
            ExampleLLM: exampleLLM,
            EnglishWords: 'live<br>reside<br>dwell',
        });
    });

    test('synonyms are html-escaped in EnglishWords', () => {
        expect(reverseDeckFields({word: 'live', translation: 'жить', exampleLLM, synonyms: ['a<b'], baseAudio: ''}).EnglishWords).toBe('live<br>a&lt;b');
    });
});

describe('blankTarget', () => {
    test.each([
        ['She lives in London.', 'live', 'lives', 'She _____ in London.'],
        ['She lives in London.', 'live', '', 'She _____ in London.'],
        ['I LIVE here', 'live', '', 'I _____ here'],
        ['We cut down on sugar.', 'cut down on', 'cut down on', 'We _____ sugar.'],
        ['They went home.', 'go', '', null],
        ['Olive oil', 'live', '', null],
    ])('%j / %j / %j', (sentence, word, targetForm, expected) => {
        const result = blankTarget(sentence, word, targetForm);
        expect(result).toBe(expected);
    });
});

describe('phrasesFields', () => {
    test('translation with the idiom', () => {
        expect(phrasesFields({word: 'live', front: 'I _____ here', answer: {sentence: 'I live here', translation: 'Я живу тут', phrase_or_idiom: 'live in'}})).toStrictEqual({
            Front: 'I _____ here',
            Expression: 'I live here',
            EnglishWord: 'live',
            ExpressionTranslate: 'Я живу тут<br>🔸 live in',
        });
    });
    test('no idiom, model markup removed', () => {
        expect(phrasesFields({word: 'live', front: 'I _____ <here>', answer: {sentence: 'I live <here>', translation: 'Я', phrase_or_idiom: null}})).toStrictEqual({
            Front: 'I _____',
            Expression: 'I live',
            EnglishWord: 'live',
            ExpressionTranslate: 'Я',
        });
    });
});

describe('speech and files', () => {
    test('tts text is NFC and trimmed', () => {
        expect(ttsText(' Café ')).toBe('Café');
    });
    test('front speech replaces the blank with a pause', () => {
        expect(frontSpeechText('I _____ here')).toBe('I ... ... ... here');
    });
    test('media file names', () => {
        expect(mediaFileName('word', 'live', 12)).toBe('tts_live_12.mp3');
        expect(mediaFileName('word', 'look up/../x', 12)).toBe('tts_look_up_x_12.mp3');
        expect(mediaFileName('rev', '', 7)).toBe('tts_rev_7.mp3');
        expect(mediaFileName('phr_exp', '', 7)).toBe('tts_phr_exp_7.mp3');
        expect(mediaFileName('phr_front', '', 7)).toBe('tts_phr_front_7.mp3');
    });
    test('extractSoundFile and escapeHtml', () => {
        expect(extractSoundFile(' [sound:a b.mp3] ')).toBe('a b.mp3');
        expect(extractSoundFile('none')).toBe('');
        expect(escapeHtml('<a href="x">&\'')).toBe('&lt;a href=&quot;x&quot;&gt;&amp;&#39;');
    });
});

describe('model text cannot become markup in Anki templates (templates decode textContent, then set innerHTML)', () => {
    test('entity-encoded tags lose < > &', () => {
        const clean = /** @type {Record<string, unknown>} */ (sanitizeEnrichment({eu: '&lt;img src=x onerror=alert(1)&gt;', tr: 'a&amp;b'}));
        expect(clean.eu).not.toMatch(/[<>&]/);
        expect(clean.tr).not.toMatch(/[<>&]/);
    });

    test('an unclosed tag cannot survive', () => {
        const clean = /** @type {{items: {h: string}[], eu: string}} */ (sanitizeEnrichment({eu: '<img src=x onerror=alert(2)// ', items: [{h: 'I <b>live</b> <img src=x onerror=alert(2)// here'}]}));
        expect(clean.eu).not.toMatch(/[<>&]/);
        expect(clean.items[0].h).toBe('I <b>live</b> img src=x onerror=alert(2)// here');
    });

    test('objects in syn are cleaned too', () => {
        const clean = /** @type {{syn: unknown[]}} */ (sanitizeEnrichment({syn: [{word: '<img src=x onerror=alert(1)>', tr: '&lt;b&gt;'}]}));
        expect(JSON.stringify(clean.syn)).not.toMatch(/[<>&]/);
    });

    test('phrases fields carry no < > & from the model', () => {
        const fields = phrasesFields({word: 'live', front: 'Look <img src=x onerror=alert(1)// and _____ here.', answer: {sentence: 'Look &lt;img&gt; and live here.', translation: '<i>x</i>', phrase_or_idiom: '&amp;'}});
        for (const value of Object.values(fields)) { expect(value.replace('<br>🔸 ', '')).not.toMatch(/[<>&]/); }
    });

    test('cleanModelText keeps plain text', () => {
        expect(cleanModelText('don\'t <x> & "go"')).toBe('don\'t   "go"');
        expect(cleanModelText('a <i>b</i> c')).toBe('a b c');
    });
});

describe('reverse data keeps the raw word (I6)', () => {
    test('an apostrophe is not escaped in data, only in EnglishWords html', () => {
        const fields = reverseDeckFields({word: "don't", translation: 'не надо', exampleLLM: '{}', synonyms: ['a<b'], baseAudio: ''});
        expect(/** @type {{englishWords: {word: string}[]}} */ (parseJson(fields.data)).englishWords[0].word).toBe("don't");
        expect(fields.EnglishWords).toBe('don&#39;t<br>a&lt;b');
    });
});
