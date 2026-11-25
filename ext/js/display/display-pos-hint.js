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

import {EventListenerCollection} from '../core/event-listener-collection.js';
import {log} from '../core/log.js';
import {isFlibHost} from '../data/flib-host.js';
import {FLIB_SENTENCE_MAX_CHARS, countWords, entryPosSet, normalizeSentenceKey, pickPosTarget} from '../data/flib-pos.js';
import {translate} from '../i18n/ui-language.js';
import {getGatewayErrorCode} from './gateway-examples-util.js';
import {createPhraseTranslationStrip} from './phrase-translation-strip.js';
import {createSentenceTranslationStrip} from './sentence-translation-strip.js';

/*
 * Кнопка «?» в левой полосе карточки, под стрелками «статья ↑/↓» (spec
 * docs/superpowers/specs/2026-11-15-pos-hint-button-design.md): часть речи
 * слова в предложении через ChatGPT шлюза и переход на подходящую статью.
 * С 2026-11-19 (spec 2026-11-19-pos-sentence-translation-design.md) нажатие
 * ещё и переводит фразу: перевод стоит полосой над статьями, а если он уже
 * в кеше фоновой части, полоса появляется без нажатия.
 *
 * ⚠️ Ответ, пришедший после смены выдачи, ВЫБРАСЫВАЕТСЯ (`_requestId`):
 * иначе карточка нового слова прыгнула бы на статью по ответу про старое.
 * ⚠️ Ошибка шлюза НИКОГДА не выглядит как «такой статьи нет» — у Flibooster
 * выглядит, и пользователь не отличает сбой от промаха (anki_conf #388).
 * ⚠️ Во вложенном окне (и после поиска внутри карточки без вложенности)
 * «предложение» — строка толкования, её русский уже стоит в колонке: там всё
 * как в основе — только часть речи, без полосы и без показа из кеша.
 * ⚠️ То же для фразы длиннее FLIB_SENTENCE_MAX_CHARS (после нормализации):
 * фоновая часть всё равно не переведёт её, и каждое «?» ради перевода было
 * бы платным тупиком.
 *
 * Окно фразы (spec 2026-11-25-key-panel-settings-phrase-translation-design.md
 * §1): «?» переводит всё английское поле в поле «Перевод». Текст пользователя
 * не трогается — тогда перевод стоит полосой под полями. Сам по себе, без
 * нажатия, здесь не появляется ни один перевод.
 */

/** @type {Readonly<Record<string, string>>} */
const ERROR_TEXT = Object.freeze({
    flib_key_missing: 'pos.keyMissing',
    flib_key_invalid: 'pos.keyInvalid',
    flib_rate_limited: 'pos.rateLimited',
    llm_bad_answer: 'pos.badAnswer',
    llm_rejected: 'enrich.rejected',
});

/** @type {Readonly<Record<string, string>>} */
const PHRASE_ERROR_TEXT = Object.freeze({
    ...ERROR_TEXT,
    flib_sentence_too_long: 'pos.phraseTooLong',
    flib_word_empty: 'pos.phraseNoEnglish',
});

/**
 * Подсказка погашенной кнопки в окне фразы.
 * @type {Readonly<Record<string, string>>}
 */
const PHRASE_STATE_TITLE = Object.freeze({
    'phrase-already': 'pos.phraseAlready',
    'phrase-no-english': 'pos.phraseNoEnglish',
    'phrase-too-long': 'pos.phraseTooLong',
});

/** Значения для текстов ошибок и подсказок. */
const TEXT_PARAMS = Object.freeze({max: FLIB_SENTENCE_MAX_CHARS});

/**
 * Одна проверка перевода для показа без нажатия и для ответа «?»: непустая
 * после trim строка, иначе перевода нет.
 * @param {unknown} value
 * @returns {?string}
 */
function usableTranslation(value) {
    if (typeof value !== 'string') { return null; }
    const text = value.trim();
    return text === '' ? null : text;
}

/**
 * @typedef {object} PosAnswer
 * @property {?string} pos
 * @property {?string} translation
 */

/**
 * Окно фразы на экране.
 * @typedef {object} PhraseFields
 * @property {HTMLTextAreaElement} english
 * @property {HTMLTextAreaElement} translation
 * @property {HTMLElement} split
 */

/**
 * Перевод и фраза (normalizeSentenceKey), к которой он относится.
 * @typedef {object} PhraseTranslation
 * @property {string} key
 * @property {string} text
 */

export class DisplayPosHint {
    /**
     * @param {import('./display.js').Display} display
     * @param {{api: import('../comm/api.js').API}} details
     */
    constructor(display, {api}) {
        /** @type {import('./display.js').Display} */
        this._display = display;
        /** @type {import('../comm/api.js').API} */
        this._api = api;
        /** @type {?HTMLButtonElement} */
        this._button = null;
        /** @type {?HTMLElement} */
        this._label = null;
        /** @type {boolean} */
        this._busy = false;
        /** Растёт при каждой смене выдачи; ответ со старым номером выбрасывается. */
        this._requestId = 0;
        /**
         * слово + "\0" + предложение → ответ; живёт, пока жив popup. Перевод в
         * записи — полученный или уже показанный (повтор перерисует полосу).
         * @type {Map<string, PosAnswer>}
         */
        this._cache = new Map();
        /** Текст подсказки по умолчанию; результат и ошибки его заменяют до смены выдачи. */
        this._message = '';
        /**
         * ⚠️ contentClear приходит ДО очистки dictionaryEntries (как в DisplayStrip):
         * читать выдачу в этот момент нельзя, поэтому кнопка гасится флагом.
         */
        this._cleared = true;
        /** @type {?{text: string, key: string}} Перевод фразы, показанный для текущей выдачи. */
        this._strip = null;
        /**
         * Статья, в которой стоит полоса: 0 при показе без нажатия; после «?» —
         * цель ответа, а без цели — статья, на которой стоял пользователь.
         */
        this._stripHost = 0;
        /**
         * Открытые фразы (normalizeSentenceKey), как `_revealed` колонки перевода:
         * другие слова той же фразы показывают полосу уже открытой.
         * @type {Set<string>}
         */
        this._revealed = new Set();
        /** @type {?ResizeObserver} */
        this._toolbarObserver = null;
        /** @type {?PhraseFields} Поля окна фразы; null — на экране не фраза. */
        this._phrase = null;
        /**
         * Перевод, который стоит в поле, — дословно, как поле его хранит
         * (textarea меняет переводы строк). Гасит кнопку.
         * ⚠️ Перезаписать его можно, только если он НАШ (`written`): текст
         * пользователя, совпавший с ответом, остаётся текстом пользователя.
         * @type {?(PhraseTranslation & {written: boolean})}
         */
        this._phraseAuto = null;
        /** @type {?{element: HTMLElement, key: string}} Полоса под полями. */
        this._phraseStrip = null;
        /** @type {EventListenerCollection} */
        this._phraseListeners = new EventListenerCollection();
    }

    /** */
    prepare() {
        const top = document.querySelector('.content-sidebar-top');
        if (top === null) { return; }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'sidebar-button fc-strip-pos';
        button.textContent = '?';
        button.addEventListener('click', () => { void this._onClick(); });
        const label = document.createElement('span');
        label.className = 'fc-strip-pos-label';
        label.setAttribute('role', 'status');
        top.append(button, label);
        this._button = button;
        this._label = label;
        this._display.on('contentUpdateComplete', () => {
            this._reset(false);
            void this._autoShow();
        });
        this._display.on('contentClear', () => { this._reset(true); });
        this._display.on('optionsUpdated', () => { this._render(); });
        this._reset(true);
    }

    /**
     * Новая выдача (или её очистка): прежний ответ и запрос в полёте больше не про неё.
     * @param {boolean} cleared
     */
    _reset(cleared) {
        this._cleared = cleared;
        this._requestId += 1;
        this._busy = false;
        this._message = '';
        this._strip = null;
        this._stripHost = 0;
        this._paintStrip();
        this._resetPhrase();
        this._setLabel('', null);
        this._render();
    }

    /**
     * ⚠️ На contentClear тип выдачи ещё «phrase», поэтому одного типа мало.
     * @returns {boolean}
     */
    _isPhrase() {
        return this._display.contentType === 'phrase' && !this._cleared;
    }

    /** */
    _resetPhrase() {
        this._phraseListeners.removeAllEventListeners();
        this._removePhraseStrip();
        this._phrase = null;
        this._phraseAuto = null;
        if (!this._isPhrase()) { return; }
        const entry = this._display.dictionaryEntryNodes[0] ?? null;
        const split = entry?.querySelector('.phrase-split');
        const english = entry?.querySelector('.phrase-expression-input');
        const translation = entry?.querySelector('.phrase-translate-input');
        if (!(split instanceof HTMLElement) || !(english instanceof HTMLTextAreaElement) || !(translation instanceof HTMLTextAreaElement)) { return; }
        this._phrase = {english, translation, split};
        let key = normalizeSentenceKey(english.value);
        this._phraseListeners.addEventListener(english, 'input', () => {
            const newKey = normalizeSentenceKey(english.value);
            if (newKey !== key) {
                key = newKey;
                this._onPhraseEdited(newKey);
            }
            this._render();
        }, false);
        // Своя запись в поле тоже приходит сюда: здесь только пересчёт состояния.
        this._phraseListeners.addEventListener(translation, 'input', () => { this._render(); }, false);
    }

    /**
     * Другой английский текст: прежние ошибка и полоса уже не про него.
     * @param {string} key
     */
    _onPhraseEdited(key) {
        if (this._phraseStrip !== null && this._phraseStrip.key !== key) { this._removePhraseStrip(); }
        this._message = '';
        this._setLabel('', null);
    }

    /** */
    _removePhraseStrip() {
        this._phraseStrip?.element.remove();
        this._phraseStrip = null;
    }

    /**
     * Видимая подпись под кнопкой: подсказка в title на сенсорном экране не видна,
     * поэтому промах и ошибка отличаются и глазами (flib-card.css).
     * @param {string} text
     * @param {?('miss'|'error')} state
     */
    _setLabel(text, state) {
        const label = this._label;
        if (label === null) { return; }
        label.textContent = text;
        label.toggleAttribute('data-miss', state === 'miss');
        if (state === 'miss') { label.dataset.miss = 'true'; }
        label.toggleAttribute('data-error', state === 'error');
        if (state === 'error') { label.dataset.error = 'true'; }
    }

    /**
     * Что спрашивать: статья-термин, предложение из ≥2 слов, слово. Без условия
     * о частях речи — перевод нужен и однозначным словам (spec §1).
     * @returns {?{word: string, sentence: string}}
     */
    _getQuery() {
        if (this._cleared) { return null; }
        const {dictionaryEntries, selectedIndex} = this._display;
        if (dictionaryEntries.length === 0) { return null; }
        const entry = dictionaryEntries[selectedIndex] ?? dictionaryEntries[0];
        const state = /** @type {{sentence?: unknown} | null | undefined} */ (this._display.history.state);
        const sentenceData = state?.sentence;
        const sentence = typeof sentenceData === 'object' && sentenceData !== null ? /** @type {{text?: unknown}} */ (sentenceData).text : null;
        if (typeof sentence !== 'string' || countWords(sentence) <= 1) { return null; }
        if (entry.type !== 'term') { return null; }
        const headword = entry.headwords[0];
        // Спрашиваем ту форму, что стоит в тексте («booked»), а не заголовок статьи.
        const original = headword?.sources[0]?.originalText;
        const word = typeof original === 'string' && original.trim() !== '' ? original.trim() : (headword?.term ?? '');
        return word === '' ? null : {word, sentence: sentence.trim()};
    }

    /**
     * Сколько частей речи знает выдача — и в одной сгруппированной статье, и в
     * нескольких. Меньше двух — выбирать не из чего.
     * @returns {number}
     */
    _knownPosCount() {
        /** @type {Set<string>} */
        const known = new Set();
        for (const item of this._display.dictionaryEntries) {
            for (const pos of entryPosSet(item)) { known.add(pos); }
        }
        return known.size;
    }

    /**
     * Вложенное окно — или корень, чью выдачу заменил поиск внутри карточки:
     * тогда `history.state.url` — адрес самой страницы окна (display.js
     * _applyContentClickResult).
     * @returns {boolean}
     */
    _isNested() {
        if (this._display.depth > 0) { return true; }
        const url = /** @type {{url?: unknown} | null | undefined} */ (this._display.history.state)?.url;
        if (typeof url !== 'string' || url === '') { return false; }
        try {
            const origin = new URL(url).origin;
            return origin !== 'null' && origin === window.location.origin;
        } catch {
            return false;
        }
    }

    /**
     * Только часть речи, старые правила основы: вложенное окно или фраза,
     * которую фоновая часть не переведёт (длиннее FLIB_SENTENCE_MAX_CHARS
     * после той же нормализации, что у ключа кеша).
     * @returns {boolean}
     */
    _isPosOnly() {
        if (this._isNested()) { return true; }
        const query = this._getQuery();
        return query !== null && normalizeSentenceKey(query.sentence).length > FLIB_SENTENCE_MAX_CHARS;
    }

    /** @returns {boolean} */
    _isBlurred() {
        // ⚠️ До загрузки настроек getOptions() — null: тогда размывает только flib-хост.
        const options = this._display.getOptions();
        return options?.flibTranslation?.blur === true || isFlibHost(this._display.getOptionsContext()?.url ?? '');
    }

    /**
     * @returns {'idle'|'no-query'|'phrase-no-english'|'phrase-too-long'|'phrase-already'}
     */
    _getPhraseState() {
        if (this._phrase === null) { return 'no-query'; }
        const key = normalizeSentenceKey(this._phrase.english.value);
        if (!/[A-Za-z]/.test(key)) { return 'phrase-no-english'; }
        if (key.length > FLIB_SENTENCE_MAX_CHARS) { return 'phrase-too-long'; }
        const auto = this._phraseAuto;
        return auto !== null && auto.key === key && auto.text === this._phrase.translation.value ? 'phrase-already' : 'idle';
    }

    /**
     * @returns {'idle'|'busy'|'no-query'|'nothing-to-choose'|'translated'|'phrase-no-english'|'phrase-too-long'|'phrase-already'}
     */
    _getButtonState() {
        if (this._busy) { return 'busy'; }
        if (this._isPhrase()) { return this._getPhraseState(); }
        if (this._getQuery() === null) { return 'no-query'; }
        if (this._knownPosCount() >= 2) { return 'idle'; }
        // Выбирать не из чего: без перевода (вложенное окно, длинная фраза) это
        // старое «нечего спрашивать», иначе нажатие нужно ради перевода, пока его нет.
        if (this._isPosOnly()) { return 'nothing-to-choose'; }
        return this._strip !== null ? 'translated' : 'idle';
    }

    /** */
    _render() {
        const button = this._button;
        if (button === null) { return; }
        const state = this._getButtonState();
        button.disabled = state !== 'idle';
        button.setAttribute('aria-busy', this._busy ? 'true' : 'false');
        const title = this._getTitle(state);
        button.title = title;
        button.setAttribute('aria-label', title);
    }

    /**
     * @param {string} state
     * @returns {string}
     */
    _getTitle(state) {
        if (Object.hasOwn(PHRASE_STATE_TITLE, state)) { return translate(PHRASE_STATE_TITLE[state], TEXT_PARAMS); }
        // Погашена из-за видимого перевода: прежний результат в подсказке был бы устаревшим.
        if (this._message !== '' && state !== 'translated') { return this._message; }
        return this._isPhrase() ? translate('pos.phraseButton') : translate('pos.button');
    }

    /**
     * Показ без нажатия (spec §7): локальный запрос перевода из кеша фоновой части.
     */
    async _autoShow() {
        if (this._isPosOnly()) { return; }
        const query = this._getQuery();
        if (query === null) { return; }
        const requestId = this._requestId;
        /** @type {?string} */
        let translation;
        try {
            translation = usableTranslation((await this._api.flibSentenceTranslationGet(query.sentence)).translation);
        } catch (e) {
            // Уровень `log`: сбой кеша пользователю не показывается (spec §11),
            // а log.error зажёг бы «!!» на значке расширения.
            log.logGenericError(e, 'log');
            return;
        }
        if (requestId !== this._requestId) { return; }
        // ⚠️ Пустой ответ не трогает полосу: её мог уже нарисовать ответ «?».
        if (translation === null || this._strip !== null) { return; }
        this._strip = {text: translation, key: normalizeSentenceKey(query.sentence)};
        this._paintStrip();
        this._render();
    }

    /** */
    async _onClick() {
        if (this._getButtonState() !== 'idle') { return; }
        if (this._isPhrase()) {
            await this._translatePhrase();
            return;
        }
        const query = /** @type {{word: string, sentence: string}} */ (this._getQuery());
        const key = `${query.word}\0${query.sentence}`;
        // Статья под пользователем в момент нажатия: туда встанет полоса, если у ответа нет цели.
        const hostIndex = this._display.selectedIndex;
        const cached = this._cache.get(key);
        if (typeof cached !== 'undefined') {
            this._showAnswer(cached, query.sentence, hostIndex);
            return;
        }
        const withTranslation = !this._isPosOnly();
        const requestId = this._requestId;
        this._busy = true;
        this._render();
        try {
            const result = await this._api.flibPosDetect(query.word, query.sentence, withTranslation);
            if (requestId !== this._requestId) { return; }
            // Во вложенном окне полосы нет, даже если перевод вдруг пришёл.
            const answer = {pos: result.pos, translation: withTranslation ? result.translation : null};
            this._busy = false;
            this._showAnswer(answer, query.sentence, hostIndex);
            // spec §4: ответ без перевода НЕ запоминается, иначе перевод станет
            // недостижим до перезагрузки; вложенное окно перевода не просит —
            // там повтор бесплатный, как в основе. Без части речи — тоже нет:
            // повтор пойдёт в фоновую часть, а та уже знает перевод.
            const shown = this._strip?.text ?? null;
            if (answer.pos !== null && (shown !== null || !withTranslation)) {
                this._cache.set(key, {pos: answer.pos, translation: shown});
            }
        } catch (e) {
            if (requestId !== this._requestId) { return; }
            // ⚠️ Полоса, уже нарисованная показом без нажатия, остаётся (spec §5:
            // ошибка лишь не рисует новую).
            this._showError(getGatewayErrorCode(e));
        } finally {
            if (requestId === this._requestId) {
                this._busy = false;
                this._render();
            }
        }
    }

    /**
     * Нажатие в окне фразы. Ответ помнит только кеш фоновой части; вложенное
     * окно им не пользуется: там вкладка-отправитель не доказывает, что
     * страница не инкогнито.
     */
    async _translatePhrase() {
        const phrase = /** @type {PhraseFields} */ (this._phrase);
        const sentence = phrase.english.value;
        const key = normalizeSentenceKey(sentence);
        const requestId = this._requestId;
        // Ответ всё ещё про то, что на экране?
        const isCurrent = () => requestId === this._requestId && normalizeSentenceKey(phrase.english.value) === key;
        this._busy = true;
        this._message = '';
        this._setLabel('', null);
        this._render();
        try {
            const result = await this._api.flibSentenceTranslate(sentence, this._display.depth === 0);
            if (!isCurrent()) { return; }
            this._busy = false;
            // Переводы строк — как их хранит textarea: ответ сравнивается с полем.
            const text = usableTranslation(result.translation)?.replace(/\r\n?/g, '\n') ?? null;
            if (text === null) {
                this._showError('llm_bad_answer', PHRASE_ERROR_TEXT);
            } else {
                this._showPhraseTranslation({key, text});
            }
        } catch (e) {
            if (!isCurrent()) { return; }
            this._showError(getGatewayErrorCode(e), PHRASE_ERROR_TEXT);
        } finally {
            if (requestId === this._requestId) {
                this._busy = false;
                this._render();
            }
        }
    }

    /**
     * ⚠️ Решение по тексту поля на момент ответа: пока шёл запрос, пользователь печатал.
     * @param {PhraseTranslation} answer
     */
    _showPhraseTranslation(answer) {
        const {translation, split} = /** @type {PhraseFields} */ (this._phrase);
        const current = translation.value;
        this._removePhraseStrip();
        const auto = this._phraseAuto;
        if (current.trim() === '' || (auto !== null && auto.written && current === auto.text)) {
            this._writePhraseTranslation(answer);
            return;
        }
        if (current === answer.text) {
            // Пользователь написал то же сам: вставлять нечего, а текст — его.
            this._phraseAuto = {...answer, written: false};
            return;
        }
        const element = createPhraseTranslationStrip(answer.text, {
            onInsert: () => {
                this._removePhraseStrip();
                this._insertPhraseTranslation(answer);
            },
            onClose: () => {
                this._removePhraseStrip();
                // Фокус был на исчезнувшей кнопке.
                const button = this._button;
                (button !== null && !button.disabled ? button : translation).focus();
            },
        });
        this._phraseStrip = {element, key: answer.key};
        split.after(element);
    }

    /**
     * Автоматическая запись: без фокуса, поэтому не через execCommand.
     * @param {PhraseTranslation} answer
     */
    _writePhraseTranslation({key, text}) {
        const {translation} = /** @type {PhraseFields} */ (this._phrase);
        translation.value = text;
        // ⚠️ До события: слушатели (и свой пересчёт) видят уже верное состояние.
        this._phraseAuto = {key, text: translation.value, written: true};
        translation.dispatchEvent(new Event('input', {bubbles: true}));
    }

    /**
     * «Вставить» поверх текста пользователя: через execCommand, чтобы Ctrl+Z
     * вернул его (запись в value и setRangeText историю правок не пополняют).
     * Событие input при этом шлёт сам браузер.
     * @param {PhraseTranslation} answer
     */
    _insertPhraseTranslation(answer) {
        const {translation} = /** @type {PhraseFields} */ (this._phrase);
        translation.focus();
        translation.select();
        // ⚠️ До вставки: её событие input видит уже верное состояние.
        this._phraseAuto = {...answer, written: true};
        const inserted = typeof document.execCommand === 'function' && document.execCommand('insertText', false, answer.text);
        if (!inserted || translation.value !== answer.text) {
            this._writePhraseTranslation(answer);
        }
        this._render();
    }

    /**
     * @param {PosAnswer} answer
     * @param {string} sentence
     * @param {number} hostIndex статья, на которой стоял пользователь при нажатии
     */
    _showAnswer({pos, translation}, sentence, hostIndex) {
        const text = usableTranslation(translation);
        if (text !== null) {
            this._strip = {text, key: normalizeSentenceKey(sentence)};
            // Цель ответа (_apply) перенесёт полосу; без цели она остаётся здесь.
            this._stripHost = hostIndex;
        }
        if (pos !== null) {
            this._apply(pos);
            return;
        }
        this._paintStrip();
        if (this._strip !== null && this._knownPosCount() < 2) {
            // Выбирать было не из чего, а перевод показан: красная «!» без
            // объяснения и без повтора (кнопка погашена) была бы тупиком.
            this._setLabel('', null);
            this._message = '';
            this._render();
            return;
        }
        this._showError('llm_bad_answer');
    }

    /**
     * @param {string} pos
     */
    _apply(pos) {
        const {dictionaryEntries, selectedIndex} = this._display;
        const full = translate(`pos.full.${pos}`);
        const target = pickPosTarget(dictionaryEntries, pos, selectedIndex);
        // ⚠️ Полоса переезжает в статью цели ДО перехода: _focusEntry вычитает
        // высоту липкой полосы этой статьи.
        if (target !== null) { this._stripHost = target.entryIndex; }
        this._paintStrip();
        if (target === null && this._knownPosCount() < 2) {
            // Выбирать было не из чего: «нет статьи» здесь ложный промах (spec §1).
            this._setLabel('', null);
            this._message = '';
        } else {
            this._setLabel(translate(`pos.short.${pos}`), target === null ? 'miss' : null);
            this._message = target === null ? translate('pos.noEntry', {pos: full}) : full;
        }
        this._render();
        if (target !== null) {
            this._display.focusEntryDefinition(target.entryIndex, target.definitionIndex);
        }
    }

    /**
     * Полоса перевода: ровно одна, перед `.entry-body` статьи-хозяина (строки
     * Anki display-anki.js вставляет после шапки асинхронно — они остаются выше).
     */
    _paintStrip() {
        for (const old of document.querySelectorAll('.fc-sentence-tr')) { old.remove(); }
        const strip = this._strip;
        if (strip === null) { return; }
        const nodes = this._display.dictionaryEntryNodes;
        const host = nodes[this._stripHost] ?? nodes[0];
        if (typeof host === 'undefined') { return; }
        const {text, key} = strip;
        const element = createSentenceTranslationStrip(text, {
            blurred: this._isBlurred(),
            revealed: this._revealed.has(key),
            onReveal: () => {
                this._revealed.add(key);
                if (this._strip !== strip) { return; }
                this._paintStrip();
                const shown = document.querySelector('.fc-sentence-tr');
                if (shown instanceof HTMLElement) {
                    shown.tabIndex = -1;
                    shown.focus();
                }
            },
        });
        const body = host.querySelector(':scope > .entry-body');
        if (body !== null) {
            body.before(element);
        } else {
            host.appendChild(element);
        }
        this._watchToolbar();
    }

    /**
     * ⚠️ Полоса липкая (flib-card.css), но верхняя панель карточки тоже липкая,
     * с z-index выше: при top: 0 полоса ушла бы ПОД панель. Отступ — живая
     * высота видимой панели в `--fc-sentence-tr-top`; панель появляется и
     * растёт асинхронно (Anki, колонка перевода), поэтому ResizeObserver.
     */
    _watchToolbar() {
        if (this._toolbarObserver !== null || typeof ResizeObserver !== 'function') { return; }
        const bar = document.querySelector('.popup-toolbar');
        if (!(bar instanceof HTMLElement)) { return; }
        const sync = () => {
            const sticky = !bar.hidden && getComputedStyle(bar).position === 'sticky';
            const height = sticky ? bar.getBoundingClientRect().height : 0;
            document.documentElement.style.setProperty('--fc-sentence-tr-top', `${height}px`);
        };
        this._toolbarObserver = new ResizeObserver(sync);
        this._toolbarObserver.observe(bar);
    }

    /**
     * @param {?string} code
     * @param {Readonly<Record<string, string>>} [texts]
     */
    _showError(code, texts = ERROR_TEXT) {
        this._setLabel('!', 'error');
        if (code === 'llm_quota_exhausted') {
            this._message = `${translate('pos.quota')}. ${translate('pos.quotaLink')}`;
        } else {
            const key = code !== null && Object.hasOwn(texts, code) ? texts[code] : 'pos.unavailable';
            this._message = translate(key, TEXT_PARAMS);
        }
        this._render();
    }
}
