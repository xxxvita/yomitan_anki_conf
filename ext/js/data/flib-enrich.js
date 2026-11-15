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
 * Обогащение карточки (spec docs/superpowers/specs/2026-11-15-card-enrichment-design.md).
 *
 * ⚠️ Промпты (ext/data/flib-enrich-prompts.json) — ДОСЛОВНЫЕ копии anki_conf
 * configs/llm_queries.yaml в коммите a62faa63e (enrichment, phrases, find_form). Источник правды для обеих копий —
 * anki_conf docs/ref/card-enrichment-and-pos.md: кто меняет промпт, обновляет обе.
 * Остальное повторяет anki_conf internal/modules/bridge (module.go,
 * derived_data.go) по результату.
 */

import {fetchJson} from '../core/fetch-utilities.js';
import {parseJson} from '../core/json.js';

/**
 * @typedef {{source: string, enrichment: string, phrases: string, findForm: string}} FlibEnrichPrompts
 */

/** @type {?Promise<FlibEnrichPrompts>} */
let promptsPromise = null;

/**
 * Промпты лежат в ext/data/flib-enrich-prompts.json: это данные, а не текст
 * интерфейса (проверка ui-language-guard), и они дословно из anki_conf.
 * @returns {Promise<FlibEnrichPrompts>}
 */
export function loadFlibEnrichPrompts() {
    if (promptsPromise === null) {
        promptsPromise = /** @type {Promise<FlibEnrichPrompts>} */ (fetchJson('/data/flib-enrich-prompts.json'));
        promptsPromise.catch(() => { promptsPromise = null; });
    }
    return promptsPromise;
}

const BLANK = '_____';
const PAUSE = '... ... ...';
const INFLECTION_SUFFIXES = new Set(['s', 'es', 'ed', 'ing', 'ies']);

/**
 * @param {string} system
 * @param {string} user
 * @returns {object}
 */
export function buildChatBody(system, user) {
    return {
        model: 'gpt-4o-mini',
        temperature: 0.4,
        response_format: {type: 'json_object'},
        messages: [{role: 'system', content: system}, {role: 'user', content: user}],
    };
}

/**
 * ⚠️ Везде JSON.stringify, а не подстановка строки (anki_conf #386).
 * @param {string} word
 * @param {string} example
 * @returns {string}
 */
export function enrichmentUser(word, example) {
    return `#DATA ${JSON.stringify({w: word, ex: example})}`;
}

/**
 * @param {string} word
 * @param {string} context
 * @returns {string}
 */
export function phrasesUser(word, context) {
    return JSON.stringify({word, context});
}

/**
 * @param {string} sentence
 * @param {string} word
 * @returns {string}
 */
export function findFormUser(sentence, word) {
    return JSON.stringify({sentence, word});
}

/**
 * Терпимый разбор, как у Flibooster: от первой `{` до последней `}`.
 * @param {unknown} content
 * @returns {?Record<string, unknown>}
 */
export function parseJsonAnswer(content) {
    if (typeof content !== 'string') { return null; }
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    if (start < 0 || end <= start) { return null; }
    try {
        const value = parseJson(content.slice(start, end + 1));
        return typeof value === 'object' && value !== null && !Array.isArray(value) ? /** @type {Record<string, unknown>} */ (value) : null;
    } catch {
        return null;
    }
}

/**
 * @param {string} text
 * @returns {string}
 */
export function stripHtml(text) {
    // Содержимое script/style — не текст: снимается вместе с тегами.
    return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<[^>]+>/g, '').trim();
}

/**
 * @param {string} text
 * @returns {string}
 */
export function escapeHtml(text) {
    return text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')
        .replaceAll('"', '&quot;')
        .replaceAll('\'', '&#39;');
}

/**
 * ⚠️ Шаблоны Flibooster делают `node.innerHTML = node.textContent…` и
 * `{{text:…}}` → JSON.parse → innerHTML, то есть РАСКОДИРУЮТ сущности перед
 * вставкой как HTML. Экранирование там не спасает: из текста модели убираются
 * сами символы < > &. Сначала снимаются целые теги (и содержимое script/style),
 * затем всё, что осталось от незакрытых тегов и сущностей.
 * @param {string} text
 * @returns {string}
 */
export function cleanModelText(text) {
    return text
        .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
        .replace(/<[^>]*>/g, '')
        .replace(/[<>&]/g, '');
}

/**
 * Пример с выделением: остаются только литералы <b> и </b>.
 * @param {string} text
 * @returns {string}
 */
function keepBold(text) {
    return text.split(/(<\/?b>)/i).map((part, i) => (i % 2 === 1 ? part.toLowerCase() : cleanModelText(part))).join('')
        .trim();
}

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function cleanDeep(value) {
    if (typeof value === 'string') { return cleanModelText(value).trim(); }
    if (Array.isArray(value)) { return value.map(cleanDeep); }
    if (typeof value === 'object' && value !== null) {
        /** @type {Record<string, unknown>} */
        const result = {};
        for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (value))) { result[k] = cleanDeep(v); }
        return result;
    }
    return value;
}

/**
 * Ответ модели перед записью в Anki: в примерах (`items[].h`) остаётся только
 * <b>, во всех остальных строках — ни одного < > & (см. cleanModelText).
 * @param {Record<string, unknown>} answer
 * @returns {Record<string, unknown>}
 */
export function sanitizeEnrichment(answer) {
    const result = /** @type {Record<string, unknown>} */ (cleanDeep(answer));
    if (Array.isArray(answer.items)) {
        result.items = /** @type {unknown[]} */ (answer.items).filter((item) => typeof item === 'object' && item !== null).map((item) => {
            const clean = /** @type {Record<string, unknown>} */ (cleanDeep(item));
            const h = /** @type {Record<string, unknown>} */ (item).h;
            if (typeof h === 'string') { clean.h = keepBold(h); }
            return clean;
        });
    }
    return result;
}

/**
 * Синонимы из ответа: строка "word,pos,перевод" или объект {word|w,…}.
 * @param {Record<string, unknown>} answer
 * @returns {string[]}
 */
export function synonymWords(answer) {
    const list = Array.isArray(answer.syn) ? /** @type {unknown[]} */ (answer.syn) : [];
    /** @type {string[]} */
    const words = [];
    for (const item of list) {
        let word = '';
        if (typeof item === 'string') {
            word = item.split(',')[0];
        } else if (typeof item === 'object' && item !== null) {
            const record = /** @type {Record<string, unknown>} */ (item);
            const value = record.word ?? record.w;
            if (typeof value === 'string') { word = value; }
        }
        word = stripHtml(word);
        if (word !== '') { words.push(word); }
    }
    return words;
}

/**
 * @param {string} value
 * @returns {string}
 */
export function extractSoundFile(value) {
    const match = /\[sound:([^\]]*)\]/.exec(value.trim());
    return match === null ? '' : match[1].trim();
}

/**
 * Схема data v1.0 (anki_conf docs/reverse_deck_data_schema.md, derived_data.go:146-180).
 * @param {string} front
 * @param {string} word
 * @param {string[]} synonyms
 * @param {string} exampleLLM
 * @param {string} sourceAudio
 * @returns {string}
 */
export function buildReverseDeckData(front, word, synonyms, exampleLLM, sourceAudio) {
    const answer = parseJsonAnswer(exampleLLM) ?? {};
    const pos = typeof answer.pos === 'string' ? answer.pos : (typeof answer.part_of_speech === 'string' ? answer.part_of_speech : '');
    /** @type {string[]} */
    const examples = [];
    /**
     * @param {unknown} en
     * @param {unknown} ru
     */
    const add = (en, ru) => {
        const e = typeof en === 'string' ? stripHtml(en) : '';
        const r = typeof ru === 'string' ? ru.trim() : '';
        if (e !== '') { examples.push(e); }
        if (r !== '') { examples.push(r); }
    };
    if (Array.isArray(answer.items)) {
        for (const item of /** @type {unknown[]} */ (answer.items)) {
            if (typeof item !== 'object' || item === null) { continue; }
            const record = /** @type {Record<string, unknown>} */ (item);
            add(record.h ?? record.html, record.t ?? record.translation);
        }
    }
    if (examples.length === 0) { add(answer.eu, answer.eut); }
    const file = extractSoundFile(sourceAudio);
    return JSON.stringify({
        front,
        englishWords: [{
            word,
            partOfSpeech: pos,
            synonyms: synonyms.map(stripHtml).filter((s) => s !== ''),
            audio: file === '' ? [] : [{selected: true, file}],
        }],
        examples,
    });
}

/**
 * @param {{word: string, translation: string, exampleLLM: string, synonyms: string[], baseAudio: string}} details
 * @returns {{Front: string, Back: string, ExampleLLM: string, EnglishWords: string, data: string}}
 */
export function reverseDeckFields({word, translation, exampleLLM, synonyms, baseAudio}) {
    return {
        Front: translation,
        Back: '',
        ExampleLLM: exampleLLM,
        // HTML-поле: экранируется; в data (JSON для аддона) слово идёт как есть (I6).
        EnglishWords: [word, ...synonyms].map(escapeHtml).join('<br>'),
        data: buildReverseDeckData(translation, word, synonyms, exampleLLM, baseAudio),
    };
}

/**
 * @param {string} value
 * @returns {string}
 */
function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * @param {string} sentence
 * @param {string} token
 * @returns {?string}
 */
function blankWholeWord(sentence, token) {
    const t = token.trim();
    if (t === '') { return null; }
    const re = new RegExp(`(^|[^\\p{L}\\p{N}])(${escapeRegExp(t)})($|[^\\p{L}\\p{N}])`, 'iu');
    const match = re.exec(sentence);
    if (match === null) { return null; }
    const start = match.index + match[1].length;
    return sentence.slice(0, start) + BLANK + sentence.slice(start + match[2].length);
}

/**
 * @param {string} sentence
 * @param {string} word
 * @returns {?string}
 */
function blankInflected(sentence, word) {
    const w = word.trim().toLowerCase();
    if ([...w].length < 3) { return null; }
    /** @type {?{start: number, end: number}} */
    let found = null;
    let count = 0;
    for (const match of sentence.matchAll(/[\p{L}\p{N}]+/gu)) {
        const token = match[0].toLowerCase();
        if (token === w || (token.startsWith(w) && INFLECTION_SUFFIXES.has(token.slice(w.length)))) {
            count += 1;
            if (found === null) { found = {start: match.index, end: match.index + match[0].length}; }
        }
    }
    if (count !== 1 || found === null) { return null; }
    return sentence.slice(0, found.start) + BLANK + sentence.slice(found.end);
}

/**
 * Пропуск в предложении: форма от генератора → само слово → простое
 * словоизменение. null — не нашлось (тогда спрашивают find_form).
 * @param {string} sentence
 * @param {string} word
 * @param {string} targetForm
 * @returns {?string}
 */
export function blankTarget(sentence, word, targetForm) {
    return blankWholeWord(sentence, targetForm) ?? blankWholeWord(sentence, word) ?? blankInflected(sentence, word);
}

/**
 * @param {string} sentence
 * @param {string} form
 * @returns {?string}
 */
export function blankForm(sentence, form) {
    return blankWholeWord(sentence, form);
}

/**
 * @param {{word: string, front: string, answer: {sentence?: unknown, translation?: unknown, phrase_or_idiom?: unknown}}} details
 * @returns {{Front: string, Expression: string, EnglishWord: string, ExpressionTranslate: string}}
 */
export function phrasesFields({word, front, answer}) {
    /**
     * @param {unknown} value
     * @returns {string}
     */
    const text = (value) => escapeHtml(cleanModelText(typeof value === 'string' ? value : '').trim());
    let translation = text(answer.translation);
    const idiom = text(answer.phrase_or_idiom);
    if (idiom !== '') { translation += `<br>🔸 ${idiom}`; }
    return {Front: text(front), Expression: text(answer.sentence), EnglishWord: escapeHtml(word), ExpressionTranslate: translation};
}

/**
 * Текст для озвучки: NFC без пробелов по краям — общее правило с Flibooster
 * (anki_conf #392), иначе не совпадёт ключ кэша шлюза.
 * @param {string} text
 * @returns {string}
 */
export function ttsText(text) {
    return text.trim().normalize('NFC');
}

/**
 * @param {string} front
 * @returns {string}
 */
export function frontSpeechText(front) {
    return front.replaceAll(BLANK, PAUSE);
}

/**
 * @param {'word'|'rev'|'phr_exp'|'phr_front'} kind
 * @param {string} word
 * @param {number} noteId
 * @returns {string}
 */
export function mediaFileName(kind, word, noteId) {
    if (kind !== 'word') { return `tts_${kind}_${noteId}.mp3`; }
    const safe = word.normalize('NFC').replace(/[^\p{L}\p{N}]+/gu, '_').replace(/^_+|_+$/g, '')
        .slice(0, 40);
    return `tts_${safe === '' ? 'word' : safe}_${noteId}.mp3`;
}
