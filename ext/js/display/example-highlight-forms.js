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
 * Формы слова для подсветки в примерах (строки YouTube, субтитры клипов,
 * дорожка VTT). Для фразы «fix on» в строке «the camera fixes on…» нужно
 * подсветить «fixes on», а не только точное «fix on».
 *
 * Модуль чистый: на входе — слово/заглавные/лемма (склоняются) и готовые
 * формы со шлюза (берутся как есть), на выходе — список строк для
 * highlightCueParts (тот сохраняет границы слова и регистронезависимость;
 * пробел внутри формы там означает «любые пробельные символы»).
 *
 * Фраза склоняется по токенам, порядок токенов строгий, между ними только
 * пробелы (никаких вставных «it»/«the»).
 */

/**
 * ~180 частых неправильных глаголов: основа → формы прошедшего времени и
 * причастия (все варианты, без повторов основы). Правильная -ed к ним НЕ
 * добавляется (be → bed, see → seed — настоящие слова), поэтому
 * употребительные правильные варианты (showed, learned, lied…) — здесь же.
 * @type {Readonly<Record<string, string[]>>}
 */
export const IRREGULAR_VERBS = Object.freeze({
    arise: ['arose', 'arisen'],
    awake: ['awoke', 'awoken'],
    be: ['am', 'is', 'are', 'was', 'were', 'been'],
    bear: ['bore', 'borne', 'born'],
    beat: ['beaten'],
    become: ['became'],
    begin: ['began', 'begun'],
    bend: ['bent'],
    bet: ['betted'],
    bind: ['bound'],
    bite: ['bit', 'bitten'],
    bleed: ['bled'],
    blow: ['blew', 'blown'],
    break: ['broke', 'broken'],
    breed: ['bred'],
    bring: ['brought'],
    broadcast: ['broadcasted'],
    build: ['built'],
    burn: ['burnt', 'burned'],
    burst: [],
    buy: ['bought'],
    cast: [],
    catch: ['caught'],
    choose: ['chose', 'chosen'],
    cling: ['clung'],
    come: ['came'],
    cost: [],
    creep: ['crept'],
    cut: [],
    deal: ['dealt'],
    dig: ['dug'],
    dive: ['dove', 'dived'],
    do: ['did', 'done'],
    draw: ['drew', 'drawn'],
    dream: ['dreamt', 'dreamed'],
    drink: ['drank', 'drunk'],
    drive: ['drove', 'driven'],
    eat: ['ate', 'eaten'],
    fall: ['fell', 'fallen'],
    feed: ['fed'],
    feel: ['felt'],
    fight: ['fought'],
    find: ['found'],
    flee: ['fled'],
    fling: ['flung'],
    fly: ['flew', 'flown'],
    forbid: ['forbade', 'forbidden'],
    forecast: [],
    foresee: ['foresaw', 'foreseen'],
    forget: ['forgot', 'forgotten'],
    forgive: ['forgave', 'forgiven'],
    freeze: ['froze', 'frozen'],
    get: ['got', 'gotten'],
    give: ['gave', 'given'],
    go: ['went', 'gone'],
    grind: ['ground'],
    grow: ['grew', 'grown'],
    hang: ['hung', 'hanged'],
    have: ['has', 'had'],
    hear: ['heard'],
    hide: ['hid', 'hidden'],
    hit: [],
    hold: ['held'],
    hurt: [],
    keep: ['kept'],
    kneel: ['knelt', 'kneeled'],
    know: ['knew', 'known'],
    lay: ['laid'],
    lead: ['led'],
    lean: ['leant', 'leaned'],
    leap: ['leapt', 'leaped'],
    learn: ['learnt', 'learned'],
    leave: ['left'],
    lend: ['lent'],
    let: [],
    lie: ['lay', 'lain', 'lied'],
    light: ['lit', 'lighted'],
    lose: ['lost'],
    make: ['made'],
    mean: ['meant'],
    meet: ['met'],
    mislead: ['misled'],
    mistake: ['mistook', 'mistaken'],
    misunderstand: ['misunderstood'],
    mow: ['mown', 'mowed'],
    overcome: ['overcame'],
    overhear: ['overheard'],
    oversleep: ['overslept'],
    overtake: ['overtook', 'overtaken'],
    overthrow: ['overthrew', 'overthrown'],
    pay: ['paid'],
    prove: ['proven', 'proved'],
    put: [],
    quit: [],
    read: [],
    rebuild: ['rebuilt'],
    redo: ['redid', 'redone'],
    rethink: ['rethought'],
    rewrite: ['rewrote', 'rewritten'],
    rid: [],
    ride: ['rode', 'ridden'],
    ring: ['rang', 'rung'],
    rise: ['rose', 'risen'],
    run: ['ran'],
    saw: ['sawn', 'sawed'],
    say: ['said'],
    see: ['saw', 'seen'],
    seek: ['sought'],
    sell: ['sold'],
    send: ['sent'],
    set: [],
    sew: ['sewn', 'sewed'],
    shake: ['shook', 'shaken'],
    shed: [],
    shine: ['shone', 'shined'],
    shoot: ['shot'],
    show: ['shown', 'showed'],
    shrink: ['shrank', 'shrunk'],
    shut: [],
    sing: ['sang', 'sung'],
    sink: ['sank', 'sunk'],
    sit: ['sat'],
    sleep: ['slept'],
    slide: ['slid'],
    sling: ['slung'],
    slit: [],
    smell: ['smelt', 'smelled'],
    speak: ['spoke', 'spoken'],
    speed: ['sped'],
    spell: ['spelt', 'spelled'],
    spend: ['spent'],
    spill: ['spilt', 'spilled'],
    spin: ['spun'],
    spit: ['spat'],
    split: [],
    spoil: ['spoilt', 'spoiled'],
    spread: [],
    spring: ['sprang', 'sprung'],
    stand: ['stood'],
    steal: ['stole', 'stolen'],
    stick: ['stuck'],
    sting: ['stung'],
    stink: ['stank', 'stunk'],
    stride: ['strode', 'stridden'],
    strike: ['struck', 'stricken'],
    string: ['strung'],
    strive: ['strove', 'striven'],
    swear: ['swore', 'sworn'],
    sweep: ['swept'],
    swell: ['swollen', 'swelled'],
    swim: ['swam', 'swum'],
    swing: ['swung'],
    take: ['took', 'taken'],
    teach: ['taught'],
    tear: ['tore', 'torn'],
    tell: ['told'],
    think: ['thought'],
    throw: ['threw', 'thrown'],
    thrust: [],
    tread: ['trod', 'trodden'],
    undergo: ['underwent', 'undergone'],
    understand: ['understood'],
    undertake: ['undertook', 'undertaken'],
    undo: ['undid', 'undone'],
    upset: [],
    wake: ['woke', 'woken'],
    wear: ['wore', 'worn'],
    weave: ['wove', 'woven'],
    weep: ['wept'],
    wet: [],
    win: ['won'],
    wind: ['wound'],
    withdraw: ['withdrew', 'withdrawn'],
    withhold: ['withheld'],
    withstand: ['withstood'],
    wring: ['wrung'],
    write: ['wrote', 'written'],
});

/**
 * Служебные слова фраз (предлоги, частицы, артикли, местоимения): их не
 * склоняем — «on» → «ons», «a» → «as» дали бы ложные подсветки.
 * @type {ReadonlySet<string>}
 */
const FUNCTION_WORDS = new Set([
    'a',
    'about',
    'above',
    'across',
    'after',
    'against',
    'along',
    'among',
    'an',
    'and',
    'apart',
    'around',
    'as',
    'aside',
    'at',
    'away',
    'back',
    'before',
    'behind',
    'below',
    'beneath',
    'beside',
    'between',
    'beyond',
    'but',
    'by',
    'down',
    'during',
    'for',
    'forth',
    'from',
    'he',
    'her',
    'here',
    'him',
    'his',
    'i',
    'if',
    'in',
    'into',
    'it',
    'its',
    'me',
    'my',
    'no',
    'nor',
    'not',
    'of',
    'off',
    'on',
    'once',
    'one',
    'oneself',
    'onto',
    'or',
    'our',
    'out',
    'over',
    'past',
    'sb',
    'she',
    'so',
    'someone',
    'something',
    'sth',
    'than',
    'that',
    'the',
    'their',
    'them',
    'then',
    'there',
    'they',
    'this',
    'through',
    'to',
    'together',
    'toward',
    'towards',
    'under',
    'up',
    'upon',
    'us',
    'we',
    'what',
    'with',
    'within',
    'without',
    'you',
    'your',
]);

/**
 * Короткие (≤2 букв) неправильные глаголы: правильные -s/-ing к ним не
 * применяются (be → bes, go → gos), поэтому их -s/-ing — явным списком.
 * @type {Readonly<Record<string, string[]>>}
 */
const SHORT_VERB_FORMS = Object.freeze({
    be: ['being'],
    do: ['does', 'doing'],
    go: ['goes', 'going'],
});

/** Сколько вариантов фразы держать максимум (декартово произведение форм токенов). */
const MAX_FORMS_PER_PHRASE = 512;

const VOWELS = 'aeiou';

/**
 * @param {string} ch
 * @returns {boolean}
 */
function isVowel(ch) { return VOWELS.includes(ch); }

/**
 * Число групп гласных — грубая оценка числа слогов (немая -e не считается).
 * @param {string} word
 * @returns {number}
 */
function vowelGroups(word) {
    const stem = word.endsWith('e') && word.length > 2 ? word.slice(0, -1) : word;
    const groups = stem.match(/[aeiouy]+/g);
    return groups === null ? 0 : groups.length;
}

/**
 * Оканчивается на согласная-гласная-согласная (последняя не w/x/y): stop, run, travel.
 * @param {string} word
 * @returns {boolean}
 */
function endsWithCvc(word) {
    if (word.length < 3) { return false; }
    const c2 = word[word.length - 1];
    const v = word[word.length - 2];
    const c1 = word[word.length - 3];
    // «qu» звучит как согласная: quit → quitting.
    const c1Consonant = !isVowel(c1) || (c1 === 'u' && word[word.length - 4] === 'q');
    return c1Consonant && isVowel(v) && !isVowel(c2) && !'wxy'.includes(c2);
}

/**
 * Основы для -ed / -ing с учётом удвоения согласной: односложные CVC —
 * только удвоенная (stop → stopp-), многосложные — обе (travel → travel-/travell-).
 * @param {string} word
 * @returns {string[]}
 */
function doublingStems(word) {
    if (!endsWithCvc(word)) { return [word]; }
    const doubled = word + word[word.length - 1];
    return vowelGroups(word) <= 1 ? [doubled] : [word, doubled];
}

/**
 * Все формы одного английского токена: сам токен первым, затем -s/-es/-ies,
 * -ed/-d/-ied, -ing (с выпадением немой e и удвоением согласной) и формы
 * неправильных глаголов. Служебные слова и всё, что не из латинских букв,
 * возвращаются как есть.
 * @param {string} token
 * @returns {string[]}
 */
export function inflectEnglishToken(token) {
    const word = typeof token === 'string' ? token.trim().toLowerCase() : '';
    if (word.length === 0) { return []; }
    if (!/^[a-z]+$/.test(word) || FUNCTION_WORDS.has(word)) { return [word]; }

    const irregular = Object.prototype.hasOwnProperty.call(IRREGULAR_VERBS, word) ? IRREGULAR_VERBS[word] : null;
    if (word.length <= 2) {
        // hi → his, k → king: короткие слова склоняем только по таблицам.
        if (irregular === null) { return [word]; }
        const extra = Object.prototype.hasOwnProperty.call(SHORT_VERB_FORMS, word) ? SHORT_VERB_FORMS[word] : [];
        return [...new Set([word, ...irregular, ...extra])];
    }

    /** @type {Set<string>} */
    const forms = new Set([word]);
    const last = word[word.length - 1];
    const beforeLast = word.length > 1 ? word[word.length - 2] : '';
    const consonantY = last === 'y' && beforeLast !== '' && !isVowel(beforeLast);

    // -s / -es / -ies (3-е лицо и множественное число)
    if (consonantY) {
        forms.add(`${word.slice(0, -1)}ies`);
    } else if (/(?:s|x|z|ch|sh)$/.test(word)) {
        forms.add(`${word}es`);
    } else if (last === 'o') {
        forms.add(`${word}es`);
        forms.add(`${word}s`);
    } else {
        forms.add(`${word}s`);
    }

    // -ed / -d / -ied — только у правильных: прошедшее неправильных берётся из таблицы.
    if (irregular !== null) {
        for (const form of irregular) { forms.add(form); }
    } else if (consonantY) {
        forms.add(`${word.slice(0, -1)}ied`);
    } else if (last === 'e') {
        forms.add(`${word}d`);
    } else if (last === 'c') {
        forms.add(`${word}ked`);
    } else {
        for (const stem of doublingStems(word)) { forms.add(`${stem}ed`); }
    }

    // -ing
    if (word.endsWith('ie')) {
        forms.add(`${word.slice(0, -2)}ying`);
    } else if (last === 'e' && !/(?:ee|oe|ye)$/.test(word) && word.length > 2) {
        forms.add(`${word.slice(0, -1)}ing`);
    } else if (last === 'c') {
        forms.add(`${word}king`);
    } else if (last === 'e') {
        forms.add(`${word}ing`);
    } else {
        for (const stem of doublingStems(word)) { forms.add(`${stem}ing`); }
    }
    return [...forms];
}

/**
 * @param {unknown} value
 * @returns {string[]}
 */
function cleanStrings(value) {
    if (!Array.isArray(value)) { return []; }
    /** @type {string[]} */
    const out = [];
    for (const item of value) {
        if (typeof item !== 'string') { continue; }
        const s = item.trim().replace(/\s+/g, ' ');
        if (s.length > 0) { out.push(s); }
    }
    return out;
}

/**
 * Склонить фразу по токенам: декартово произведение форм с потолком.
 * Фраза из 1–2 токенов склоняется целиком («fix on», «look after»); в
 * более длинной — только первый значимый токен (обычно глагол: «take
 * something into account» → took/taken/taking), так что его формы не
 * отсекаются потолком. Первой всегда идёт исходная фраза.
 * @param {string} phrase
 * @returns {string[]}
 */
function inflectPhrase(phrase) {
    const tokens = phrase.split(' ');
    const head = tokens.length >= 3 ? tokens.findIndex((t) => !FUNCTION_WORDS.has(t)) : -1;
    /** @type {string[]} */
    let combos = [''];
    for (const [i, token] of tokens.entries()) {
        const alts = tokens.length < 3 || i === head ? inflectEnglishToken(token) : [token];
        /** @type {string[]} */
        const next = [];
        outer:
        for (const prefix of combos) {
            for (const alt of alts) {
                next.push(prefix.length > 0 ? `${prefix} ${alt}` : alt);
                if (next.length >= MAX_FORMS_PER_PHRASE) { break outer; }
            }
        }
        combos = next;
    }
    return combos;
}

/**
 * Список форм для highlightCueParts.
 * @param {{terms?: unknown, forms?: unknown}} sources
 *   terms — щёлкнутое слово, заглавные статьи, лемма шлюза: склоняются;
 *   forms — matched_forms шлюза: берутся как есть.
 * @returns {string[]} Без повторов (без учёта регистра), в нижнем регистре.
 */
export function buildHighlightMatcher({terms, forms} = {}) {
    /** @type {Set<string>} */
    const out = new Set();
    for (const term of cleanStrings(terms)) {
        for (const form of inflectPhrase(term.toLowerCase())) { out.add(form); }
    }
    for (const form of cleanStrings(forms)) { out.add(form.toLowerCase()); }
    return [...out];
}

/**
 * Split a single cue's text into `{t, hl?}` parts around any of the searched
 * word forms. Same Unicode-aware regex the inline panel uses for its `<mark>`
 * highlight, extended to an alternation so dictionary lemma + inflected
 * surface forms (Yomitan deinflection chain) all light up.
 * Returns a one-element array (no match / empty words) so the runtime
 * renderer doesn't have to special-case it.
 * @param {string} text
 * @param {string[]} words
 * @returns {{t: string, hl?: boolean}[]}
 */
export function highlightCueParts(text, words) {
    if (!Array.isArray(words) || words.length === 0) { return [{t: text}]; }
    // Longest-first so "people" wins over "person" when both could match a
    // single position (regex alternation picks left-to-right).
    const escapedAlts = words
        .filter((w) => typeof w === 'string' && w.length > 0)
        .sort((a, b) => b.length - a.length)
        // A space inside a phrase form matches any whitespace run («fixed\non»).
        .map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+'));
    if (escapedAlts.length === 0) { return [{t: text}]; }
    let re;
    try {
        re = new RegExp(`(?<![\\p{L}\\p{N}])(${escapedAlts.join('|')})(?![\\p{L}\\p{N}])`, 'giu');
    } catch (e) {
        return [{t: text}];
    }
    /** @type {{t: string, hl?: boolean}[]} */
    const parts = [];
    let last = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
        if (m.index > last) { parts.push({t: text.slice(last, m.index)}); }
        parts.push({t: m[1], hl: true});
        last = m.index + m[1].length;
        // Guard against zero-width matches infinite-looping.
        if (m[0].length === 0) { re.lastIndex++; }
    }
    if (last < text.length) { parts.push({t: text.slice(last)}); }
    return parts.length > 0 ? parts : [{t: text}];
}
