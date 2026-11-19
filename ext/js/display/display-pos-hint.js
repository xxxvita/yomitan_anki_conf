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

import {log} from '../core/log.js';
import {isFlibHost} from '../data/flib-host.js';
import {countWords, entryPosSet, normalizeSentenceKey, pickPosTarget} from '../data/flib-pos.js';
import {translate} from '../i18n/ui-language.js';
import {getGatewayErrorCode} from './gateway-examples-util.js';
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
 */

/** @type {Readonly<Record<string, string>>} */
const ERROR_TEXT = Object.freeze({
    flib_key_missing: 'pos.keyMissing',
    flib_key_invalid: 'pos.keyInvalid',
    flib_rate_limited: 'pos.rateLimited',
    llm_bad_answer: 'pos.badAnswer',
    llm_rejected: 'enrich.rejected',
});

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
        /** Статья, в которой стоит полоса: 0 или та, на которую перешёл ответ «?». */
        this._stripHost = 0;
        /**
         * Открытые фразы (normalizeSentenceKey), как `_revealed` колонки перевода:
         * другие слова той же фразы показывают полосу уже открытой.
         * @type {Set<string>}
         */
        this._revealed = new Set();
        /** @type {?ResizeObserver} */
        this._toolbarObserver = null;
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
        this._setLabel('', null);
        this._render();
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

    /** @returns {boolean} */
    _isBlurred() {
        // ⚠️ До загрузки настроек getOptions() — null: тогда размывает только flib-хост.
        const options = this._display.getOptions();
        return options?.flibTranslation?.blur === true || isFlibHost(this._display.getOptionsContext()?.url ?? '');
    }

    /**
     * @returns {'idle'|'busy'|'no-query'|'nothing-to-choose'|'translated'}
     */
    _getButtonState() {
        if (this._busy) { return 'busy'; }
        if (this._getQuery() === null) { return 'no-query'; }
        if (this._knownPosCount() >= 2) { return 'idle'; }
        // Выбирать не из чего: во вложенном окне это старое «нечего спрашивать»,
        // в корне нажатие нужно только ради перевода, пока его нет.
        if (this._isNested()) { return 'nothing-to-choose'; }
        return this._strip !== null ? 'translated' : 'idle';
    }

    /** */
    _render() {
        const button = this._button;
        if (button === null) { return; }
        const state = this._getButtonState();
        button.disabled = state !== 'idle';
        button.setAttribute('aria-busy', this._busy ? 'true' : 'false');
        // Погашена из-за видимого перевода: прежний результат в подсказке был бы устаревшим.
        const title = this._message === '' || state === 'translated' ? translate('pos.button') : this._message;
        button.title = title;
        button.setAttribute('aria-label', title);
    }

    /**
     * Показ без нажатия (spec §7): локальный запрос перевода из кеша фоновой части.
     */
    async _autoShow() {
        if (this._isNested()) { return; }
        const query = this._getQuery();
        if (query === null) { return; }
        const requestId = this._requestId;
        /** @type {?string} */
        let translation;
        try {
            translation = usableTranslation((await this._api.flibSentenceTranslationGet(query.sentence)).translation);
        } catch (e) {
            log.error(e);
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
        const query = /** @type {{word: string, sentence: string}} */ (this._getQuery());
        const key = `${query.word}\0${query.sentence}`;
        const cached = this._cache.get(key);
        if (typeof cached !== 'undefined') {
            this._showAnswer(cached, query.sentence);
            return;
        }
        const withTranslation = !this._isNested();
        const requestId = this._requestId;
        this._busy = true;
        this._render();
        try {
            const result = await this._api.flibPosDetect(query.word, query.sentence, withTranslation);
            if (requestId !== this._requestId) { return; }
            // Во вложенном окне полосы нет, даже если перевод вдруг пришёл.
            const answer = {pos: result.pos, translation: withTranslation ? result.translation : null};
            this._busy = false;
            this._showAnswer(answer, query.sentence);
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
     * @param {PosAnswer} answer
     * @param {string} sentence
     */
    _showAnswer({pos, translation}, sentence) {
        const text = usableTranslation(translation);
        if (text !== null) {
            this._strip = {text, key: normalizeSentenceKey(sentence)};
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
     */
    _showError(code) {
        this._setLabel('!', 'error');
        if (code === 'llm_quota_exhausted') {
            this._message = `${translate('pos.quota')}. ${translate('pos.quotaLink')}`;
        } else {
            const key = code !== null && Object.hasOwn(ERROR_TEXT, code) ? ERROR_TEXT[code] : 'pos.unavailable';
            this._message = translate(key);
        }
        this._render();
    }
}
