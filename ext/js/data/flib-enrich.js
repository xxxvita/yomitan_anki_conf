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
 * ⚠️ Промпты — ДОСЛОВНЫЕ копии anki_conf configs/llm_queries.yaml в коммите
 * a62faa63e (enrichment, phrases, find_form). Источник правды для обеих копий —
 * anki_conf docs/ref/card-enrichment-and-pos.md: кто меняет промпт, обновляет обе.
 * Остальное повторяет anki_conf internal/modules/bridge (module.go,
 * derived_data.go) по результату.
 */

import {parseJson} from '../core/json.js';

/** @type {Readonly<{enrichment: string, phrases: string, findForm: string}>} */
export const FLIB_ENRICH_PROMPTS = Object.freeze({
    enrichment: `Role: EN→RU lexical enricher. Style: Oxford B1-B2, friendly, modern British English.
Contractions OK (I'm, don't). No semicolons, no formality.

Input: JSON after #DATA tag. Keys: w=word, ex=example sentence (may be empty).

Output: strictly valid JSON, nothing else:
{
  "tr": "<перевод 1-3 слова, без скобок/пояснений>",
  "items": [
    {"h": "<EN sentence, target word in <b> tags>", "t": "<RU перевод предложения>", "c": "<контекст применения>"}
  ],
  "syn": ["<word>,<pos>,<RU перевод>"],
  "pos": "<part_of_speech>",
  "eu": "<example ≤15 words with target word>",
  "eut": "<RU перевод eu>",
  "tc": "<RU перевод ex, если ex задан>"
}

Rules:
- tr: обязательно. Одно короткое слово/словосочетание.
- items: РОВНО 6 элементов. Каждый h содержит целевое слово в <b>. Если ex задан: первые 3 примера — в том же значении и переводе (tr) и той же части речи, что и в ex; следующие 3 — в других употребимых значениях/контекстах слова. Если ex пуст: все 6 — в разных употребимых значениях. Поле c всегда поясняет, в каком значении употреблено слово.
- syn: 0-5 элементов, формат "word,pos,перевод". Если ex задан — синонимы ТОЛЬКО для значения из tr (в контексте ex), не для других значений слова. Если ex пуст — близкие по смыслу слова/выражения в наиболее употребимом значении.
- pos: часть речи слова tr. Если слово многозначно и ex пуст — перечисли через запятую (noun,verb).
- eu: если ex пуст, сгенерируй пример (≤15 слов) с целевым словом в той же форме/времени.
- eut: перевод eu, если eu сгенерирован.
- tc: перевод ex на русский, если ex задан. Иначе пусто.
- Ответ строго JSON. Никакого текста, markdown, комментариев вне JSON.
`,
    phrases: `Ты — генератор живых примеров в стиле Oxford (британский вариант).

ЦЕЛЬ
По заданному английскому слову и необязательному контексту выдай ОДНО естественное, повседневное предложение на британском английском, где это слово используется по смыслу. ПРИОРИТЕТ: по возможности используй фразовые глаголы или идиомы для лучшего изучения живого языка. Предложение должно быть полезным в реальной речи (здоровье, записи к врачу, очереди, покупки, работа, small talk).

СТИЛЬ И УРОВЕНЬ
- Речь: современная разговорная British English (Oxford teaching style), дружелюбная и ясная.
- Уровень: B1–B2 friendly (без книжности, без сленга и внутр. шуток).
- Разрешай сокращения: I'm, don't, it's.
- Избегай точек с запятой и чрезмерной формальности.

КРИТИЧЕСКОЕ ПРАВИЛО О ВРЕМЕНИ/ФОРМЕ
- Если входное "word" уже дано в конкретной форме/времени (например: went, has gone, will go, looking, looked), ТО ты ОБЯЗАН использовать РОВНО ЭТУ форму (тот же токен) в предложении.
- Если слово дано в базовой форме Present (например: look, assess), время выбирай любое по смыслу; можно слово изменить.
- В любом случае целевое слово (в нужной форме при необходимости) ДОЛЖНО присутствовать в финальном предложении.

ОГРАНИЧЕНИЯ
- Длина предложения: НЕ БОЛЕЕ 15 слов.
- Считай слова по пробелам; дефисные составные слова считаются за одно.
- Фразовый глагол/идиома — ЖЕЛАТЕЛЬНЫ для обучения; включай их везде, где естественно.
- ОБЯЗАТЕЛЬНО указывай каноническую форму фразового глагола/идиомы, если используешь (напр., "cut down on", "look into", "under the weather").

ФОРМАТ ВВОДА (сообщение пользователя)
JSON:
{
  "word": "<целевое_слово_или_его_форма>",
  "context": "<необязательный краткий контекст, может быть пусто>"
}

ФОРМАТ ВЫВОДА
Верни СТРОГО один JSON-объект (без Markdown и пояснений):
{
  "sentence": "<английское предложение, ≤15 слов>",
  "translation": "<естественный русский перевод>",
  "phrase_or_idiom": "<фразовый глагол или идиома, если использованы; иначе null>",
  "target_form": "<точная форма целевого слова, ровно как она написана в sentence (тот же токен/словосочетание, с тем же регистром)>"
}

ПРАВИЛА ГЕНЕРАЦИИ
- Учитывай "context", если он задан.
- Проверяй: (1) длина ≤15 слов; (2) целевое слово присутствует и в нужной форме, если оно задано не в Present; (3) фразовый/идиома естественны. Иначе — перегенерируй до соответствия правилам.
- target_form: обязательно. Это точная подстрока из sentence — та форма, в которой целевое слово реально встречается (учитывая время, число, часть речи). Если это фразовый глагол/идиома — верни его целиком.
- Не добавляй альтернативы, объяснения или дефиниции — только JSON.
`,
    findForm: `На вход JSON: {"sentence": "<английское предложение>", "word": "<базовое слово или выражение>"}.
Найди в sentence слово word в той форме, в какой оно там написано (любое время, число, часть речи; для фразового глагола/идиомы — целиком).
Верни СТРОГО валидный JSON, ничего вне него: {"form": "<точная подстрока из sentence>"}.
Если слова нет в предложении ни в какой форме — верни {"form": ""}.
Никакого текста, markdown или пояснений вне JSON.
`,
});

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
 * Пример с выделением: остаётся только <b>…</b>, остальная разметка снимается.
 * @param {string} text
 * @returns {string}
 */
function keepBold(text) {
    return text.replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '').replace(/<(?!\/?b>)[^>]*>/gi, '').trim();
}

/**
 * ⚠️ Текст ответа идёт в поля Anki, а шаблоны Anki исполняют HTML. Предложение
 * со страницы попадает в промпт, так что ответ может нести чужую разметку:
 * в примерах (`items[].h`) остаётся только <b>, всё прочее — чистый текст.
 * @param {Record<string, unknown>} answer
 * @returns {Record<string, unknown>}
 */
export function sanitizeEnrichment(answer) {
    /** @type {Record<string, unknown>} */
    const result = {};
    for (const [key, value] of Object.entries(answer)) {
        if (typeof value === 'string') {
            result[key] = stripHtml(value);
        } else if (key === 'items' && Array.isArray(value)) {
            result.items = /** @type {unknown[]} */ (value).filter((item) => typeof item === 'object' && item !== null).map((item) => {
                /** @type {Record<string, unknown>} */
                const clean = {};
                for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (item))) {
                    if (typeof v === 'string') { clean[k] = k === 'h' ? keepBold(v) : stripHtml(v); }
                }
                return clean;
            });
        } else if (key === 'syn' && Array.isArray(value)) {
            result.syn = /** @type {unknown[]} */ (value).map((item) => (typeof item === 'string' ? stripHtml(item) : item));
        }
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
        EnglishWords: [word, ...synonyms.map(escapeHtml)].join('<br>'),
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
    const sentence = typeof answer.sentence === 'string' ? answer.sentence : '';
    let translation = escapeHtml(typeof answer.translation === 'string' ? answer.translation : '');
    const idiom = typeof answer.phrase_or_idiom === 'string' ? answer.phrase_or_idiom.trim() : '';
    if (idiom !== '') { translation += `<br>🔸 ${escapeHtml(idiom)}`; }
    return {Front: escapeHtml(front), Expression: escapeHtml(sentence), EnglishWord: word, ExpressionTranslate: translation};
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
