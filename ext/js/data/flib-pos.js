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

/*
 * Кнопка «?»: часть речи слова в предложении (spec
 * docs/superpowers/specs/2026-11-15-pos-hint-button-design.md).
 *
 * ⚠️ Промпт — ДОСЛОВНАЯ копия `pos_detect` из anki_conf
 * configs/llm_queries.yaml в коммите 5e34f6249. Источник правды для обеих
 * копий — anki_conf docs/ref/card-enrichment-and-pos.md: кто меняет промпт,
 * обновляет обе, иначе Flibooster и расширение начнут отвечать по-разному.
 */

import {parseJson} from '../core/json.js';

export const FLIB_POS_SYSTEM_PROMPT = `Role: English part-of-speech tagger. You receive a target word and the
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
`;

/**
 * Комбинированный промпт: часть речи + перевод предложения на русский.
 * Правила `pos` те же, что у FLIB_POS_SYSTEM_PROMPT, но этот текст — НЕ копия
 * Flibooster: температура 0.4 не измерялась на этом промпте.
 */
export const FLIB_POS_TRANSLATE_SYSTEM_PROMPT = `Role: English part-of-speech tagger and translator. You receive a target word and the
sentence it appears in. Determine the part of speech of the TARGET word
AS USED IN THAT SENTENCE — by its role in the sentence, not the word's
most common use (e.g. "book" in "book a table" = verb). Also translate the
WHOLE sentence into natural Russian.

Input: JSON after #DATA tag. Keys: w=target word, s=sentence.

Output: strictly valid JSON, nothing else:
{ "pos": "<part_of_speech>", "tr": "<translation>" }

Rules:
- pos: exactly ONE of noun, verb, adjective, adverb, pronoun, preposition,
  conjunction, determiner, interjection, numeral.
- pos: lowercase English word only.
- tr: a natural Russian translation of the WHOLE sentence s, as a reader would
  understand it. No comments, no transliteration, no quotes around it.
- No examples, no extra keys, no markdown, no text outside the JSON.
`;

/** Предложение длиннее этого получает старый запрос без перевода. */
export const FLIB_SENTENCE_MAX_CHARS = 1000;

/**
 * Перевод длиннее этого (после trim) считается отсутствующим. Вдвое больше
 * предела предложения: русский перевод фразы почти в 1000 символов длиннее
 * оригинала, а он уже оплачен.
 */
export const FLIB_TRANSLATION_MAX_CHARS = 2000;

/**
 * Сокращения словаря и слова ChatGPT → каноническое имя. Таблица ALIAS из
 * anki_conf electron/renderer/yomitan/pos-normalise.ts. `name` (имя
 * собственное) — отдельный вид: с noun он не совпадает.
 * @type {Readonly<Record<string, string>>}
 */
const POS_ALIAS = Object.freeze({
    n: 'noun',
    noun: 'noun',
    v: 'verb',
    vt: 'verb',
    vi: 'verb',
    verb: 'verb',
    adj: 'adjective',
    adjective: 'adjective',
    adv: 'adverb',
    adverb: 'adverb',
    pron: 'pronoun',
    pronoun: 'pronoun',
    prep: 'preposition',
    preposition: 'preposition',
    conj: 'conjunction',
    conjunction: 'conjunction',
    det: 'determiner',
    artic: 'determiner',
    article: 'determiner',
    determiner: 'determiner',
    intj: 'interjection',
    int: 'interjection',
    interjection: 'interjection',
    num: 'numeral',
    numeral: 'numeral',
    number: 'numeral',
    name: 'name',
});

/** Ответ ChatGPT обязан быть одним из десяти видов промпта; `name` он не даёт. */
const ANSWER_POS = new Set(['noun', 'verb', 'adjective', 'adverb', 'pronoun', 'preposition', 'conjunction', 'determiner', 'interjection', 'numeral']);

/**
 * @param {string} word
 * @param {string} sentence
 * @returns {object}
 */
export function buildPosRequestBody(word, sentence) {
    return {
        model: 'gpt-4o-mini',
        temperature: 0.4,
        response_format: {type: 'json_object'},
        messages: [
            {role: 'system', content: FLIB_POS_SYSTEM_PROMPT},
            // ⚠️ JSON.stringify, а не подстановка строки: у Flibooster кавычка в
            // предложении ломает JSON внутри промпта (anki_conf #386).
            {role: 'user', content: `#DATA ${JSON.stringify({w: word, s: sentence})}`},
        ],
    };
}

/**
 * Терпимый разбор, как у Flibooster: от первой `{` до последней `}`.
 * @param {unknown} content
 * @returns {?Record<string, unknown>} объект ответа или null
 */
function parseAnswerObject(content) {
    if (typeof content !== 'string') { return null; }
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) { return null; }
    /** @type {unknown} */
    let value;
    try {
        value = parseJson(content.slice(start, end + 1));
    } catch {
        return null;
    }
    if (typeof value !== 'object' || value === null) { return null; }
    return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} raw
 * @returns {?string}
 */
function canonicalAnswerPos(raw) {
    if (typeof raw !== 'string') { return null; }
    const canonical = POS_ALIAS[raw.trim().toLowerCase()];
    return typeof canonical === 'string' && ANSWER_POS.has(canonical) ? canonical : null;
}

/**
 * @param {unknown} content
 * @returns {?string} одно из десяти канонических имён или null
 */
export function parsePosAnswer(content) {
    const value = parseAnswerObject(content);
    return value === null ? null : canonicalAnswerPos(value.pos);
}

/**
 * @param {string} word
 * @param {string} sentence
 * @returns {object}
 */
export function buildPosTranslateRequestBody(word, sentence) {
    return {
        ...buildPosRequestBody(word, sentence),
        // Потолок ответа только здесь: тело «только части речи» — копия Flibooster.
        max_tokens: 1000,
        messages: [
            {role: 'system', content: FLIB_POS_TRANSLATE_SYSTEM_PROMPT},
            {role: 'user', content: `#DATA ${JSON.stringify({w: word, s: sentence})}`},
        ],
    };
}

/**
 * @param {unknown} content
 * @returns {{pos: ?string, translation: ?string}} каждая половина независима; пустой, не строковый или слишком длинный перевод — null
 */
export function parsePosTranslateAnswer(content) {
    const value = parseAnswerObject(content);
    if (value === null) { return {pos: null, translation: null}; }
    const tr = typeof value.tr === 'string' ? value.tr.trim() : '';
    return {
        pos: canonicalAnswerPos(value.pos),
        translation: tr !== '' && tr.length <= FLIB_TRANSLATION_MAX_CHARS ? tr : null,
    };
}

/**
 * Ключ кэша предложения: NFC, каждая серия пробелов → один пробел, trim; регистр сохраняется.
 * @param {string} sentence
 * @returns {string}
 */
export function normalizeSentenceKey(sentence) {
    return sentence.normalize('NFC').replace(/\s+/g, ' ').trim();
}

/**
 * Части речи статьи: классы слова заголовков и теги определений.
 * @param {import('dictionary').DictionaryEntry} entry
 * @returns {Set<string>}
 */
export function entryPosSet(entry) {
    /** @type {Set<string>} */
    const result = new Set();
    if (entry.type !== 'term') { return result; }
    /** @param {string} token */
    const add = (token) => {
        const canonical = POS_ALIAS[token.toLowerCase()];
        if (typeof canonical === 'string') { result.add(canonical); }
    };
    for (const headword of entry.headwords) {
        for (const wordClass of headword.wordClasses) { add(wordClass); }
    }
    for (const definition of entry.definitions) {
        for (const tag of definition.tags) { add(tag.name); }
    }
    return result;
}

/**
 * @param {import('dictionary').DictionaryEntry[]} entries
 * @param {string} pos
 * @param {number} currentIndex
 * @returns {number} текущая, если подходит; иначе первая подходящая; иначе -1
 */
export function pickEntryByPos(entries, pos, currentIndex) {
    const current = entries[currentIndex];
    if (typeof current !== 'undefined' && entryPosSet(current).has(pos)) { return currentIndex; }
    return entries.findIndex((entry) => entryPosSet(entry).has(pos));
}

/**
 * Куда поставить карточку. ⚠️ В режиме группировки по умолчанию у слова ОДНА
 * статья, а части речи — это группы её определений (book: сначала n, ниже v),
 * поэтому выбирается не только статья, но и первое определение нужной части
 * речи. Определения без тега части речи дают 0 — начало статьи.
 * @param {import('dictionary').DictionaryEntry[]} entries
 * @param {string} pos
 * @param {number} currentIndex
 * @returns {?{entryIndex: number, definitionIndex: number}}
 */
export function pickPosTarget(entries, pos, currentIndex) {
    const entryIndex = pickEntryByPos(entries, pos, currentIndex);
    if (entryIndex < 0) { return null; }
    const entry = entries[entryIndex];
    if (entry.type !== 'term') { return {entryIndex, definitionIndex: 0}; }
    const definitionIndex = entry.definitions.findIndex(({tags}) => tags.some(({name}) => POS_ALIAS[name.toLowerCase()] === pos));
    return {entryIndex, definitionIndex: Math.max(0, definitionIndex)};
}

/**
 * @param {string} sentence
 * @returns {number}
 */
export function countWords(sentence) {
    const trimmed = sentence.trim();
    return trimmed === '' ? 0 : trimmed.split(/\s+/).length;
}
