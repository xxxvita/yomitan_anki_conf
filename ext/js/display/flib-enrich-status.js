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

import {FLIB_SENTENCE_MAX_CHARS} from '../data/flib-pos.js';
import {translate, translatePlural} from '../i18n/ui-language.js';
import {createFlibKeyHelp} from './flib-key-help.js';

/*
 * Строка состояния обогащения под шапкой статьи (spec
 * docs/superpowers/specs/2026-11-15-card-enrichment-design.md, «Что видит пользователь»).
 * ⚠️ Заметка уже добавлена при любом исходе: строка говорит, что вышло сверху.
 */

/** @type {Readonly<Record<string, string>>} */
const PROBLEM_TEXT = Object.freeze({
    llm_quota_exhausted: 'enrich.quota',
    tts_quota_exhausted: 'enrich.speechQuota',
    flib_key_missing: 'pos.keyMissing',
    flib_key_invalid: 'pos.keyInvalid',
    flib_rate_limited: 'pos.rateLimited',
    flib_service_unavailable: 'pos.unavailable',
    flib_timeout: 'pos.unavailable',
    llm_bad_answer: 'pos.badAnswer',
    // Из установки типов заметок: она не идёт при закрытой Anki.
    anki_closed: 'enrich.ankiClosed',
    anki_route_switched: 'enrich.ankiSwitched',
    anki_model_failed: 'enrich.models',
    anki_model_outdated: 'enrich.models',
    anki_deck_failed: 'enrich.deck',
    llm_rejected: 'enrich.rejected',
});

/**
 * Фраза: сверх этого — причины её шагов (flib-phrase-enricher.js), у слова таких нет.
 * @type {Readonly<Record<string, string>>}
 */
const PHRASE_PROBLEM_TEXT = Object.freeze({
    ...PROBLEM_TEXT,
    anki_model_outdated: 'anki.phraseModelOutdated',
    anki_note_failed: 'enrich.ankiNoteFailed',
    anki_note_gone: 'enrich.ankiNoteGone',
    flib_media_not_stored: 'enrich.audioNotStored',
    flib_sentence_too_long: 'enrich.phraseTooLong',
    tts_failed: 'enrich.audioFailed',
    flib_bad_request: 'enrich.phraseRefused',
    flib_secret_forbidden: 'enrich.phraseRefused',
    // Добавленная заметка второй раз не обогащается: без «нажмите ещё раз» и «попробуйте позже».
    flib_rate_limited: 'enrich.phraseRateLimited',
    flib_service_unavailable: 'enrich.phraseUnavailable',
    flib_timeout: 'enrich.phraseUnavailable',
    llm_bad_answer: 'enrich.phraseBadAnswer',
});

/** Ссылки-заглушки докупки квоты (задача 385). */
/** @type {Readonly<Record<string, string>>} */
const SOON_TEXT = Object.freeze({
    llm_quota_exhausted: 'pos.quotaLink',
    tts_quota_exhausted: 'enrich.speechQuotaLink',
});

const TEXT_PARAMS = Object.freeze({max: FLIB_SENTENCE_MAX_CHARS});

/**
 * @returns {HTMLElement}
 */
function createStatus() {
    const node = document.createElement('div');
    node.className = 'fc-enrich-status';
    node.setAttribute('role', 'status');
    return node;
}

/**
 * @returns {HTMLElement}
 */
function renderPending() {
    const node = createStatus();
    node.dataset.state = 'pending';
    node.textContent = translate('enrich.pending');
    return node;
}

/**
 * @param {import('flib-gateway').EnrichStep} step
 * @returns {boolean}
 */
function isFailed({status}) {
    return status === 'failed';
}

/**
 * @param {import('flib-gateway').EnrichStep[]} steps Те, чья причина видна.
 * @param {?string} speechCode
 * @returns {string[]} Без повторов.
 */
function getCodes(steps, speechCode) {
    const codes = new Set(steps.map(({code}) => code ?? 'anki_failed'));
    if (typeof speechCode === 'string') { codes.add(speechCode); }
    return [...codes];
}

/**
 * @param {string} text
 * @returns {string} С заглавной буквы: после точки.
 */
function capitalize(text) {
    return text.charAt(0).toUpperCase() + text.slice(1);
}

/**
 * @param {string[]} done Что вышло.
 * @param {string[]} codes Что не вышло.
 * @param {Readonly<Record<string, string>>} problemText
 * @returns {HTMLElement}
 */
function renderResult(done, codes, problemText) {
    const node = createStatus();
    node.dataset.state = codes.length === 0 ? 'ok' : 'warn';
    const head = document.createElement('div');
    head.className = 'fc-enrich-head';
    head.textContent = codes.length === 0 ? `✓ ${done.join(' · ')}` : `⚠ ${translate('enrich.added')}${done.length > 0 ? ` ${capitalize(done.join(' · '))}` : ''}`;
    node.appendChild(head);
    /** @type {Set<string>} */
    const shown = new Set();
    for (const code of codes) {
        const key = Object.hasOwn(problemText, code) ? problemText[code] : 'enrich.anki';
        if (shown.has(key)) { continue; }
        shown.add(key);
        const line = document.createElement('div');
        line.className = 'fc-enrich-problem';
        line.textContent = translate(key, TEXT_PARAMS);
        if (Object.hasOwn(SOON_TEXT, code)) {
            const soon = document.createElement('span');
            soon.className = 'fc-enrich-soon';
            soon.textContent = ` ${translate(SOON_TEXT[code])}`;
            line.appendChild(soon);
        }
        node.appendChild(line);
    }
    return node;
}

/**
 * @param {'pending' | import('flib-gateway').EnrichReport} state
 * @returns {HTMLElement}
 */
export function renderEnrichStatus(state) {
    if (state === 'pending') { return renderPending(); }
    const steps = [state.enrich, state.audio, state.reverse, state.phrases];
    /** @type {string[]} */
    const done = [];
    if (state.enrich.status === 'done') { done.push(translate('enrich.examples')); }
    if (state.audio.status === 'done') { done.push(translate('enrich.audio')); }
    const cards = [state.reverse, state.phrases].filter((step) => step.status === 'done').length;
    if (cards > 0) { done.push(translatePlural('enrich.moreCards', cards)); }
    return renderResult(done, getCodes(steps.filter(isFailed), state.speechCode), PROBLEM_TEXT);
}

/**
 * Озвучка и перевод фразы: причина видна и у пропущенного шага (нет ключа, слишком длинная).
 * @param {'pending' | import('flib-gateway').PhraseEnrichReport} state
 * @returns {HTMLElement}
 */
export function renderPhraseEnrichStatus(state) {
    if (state === 'pending') { return renderPending(); }
    const {audio, translation, speechCode} = state;
    const codes = getCodes([audio, translation].filter((step) => isFailed(step) || typeof step.code === 'string'), speechCode);
    /** @type {string[]} */
    const done = [];
    if (audio.status === 'done') { done.push(translate('enrich.audio')); }
    if (translation.status === 'done') { done.push(translate('enrich.translation')); }
    if (done.length === 0 && codes.length === 0) { done.push(translate('enrich.added')); }
    return renderResult(done, codes, PHRASE_PROBLEM_TEXT);
}

/**
 * Заметка добавлена без обогащения: нет личного ключа. Строка объясняет почему
 * и сразу даёт получить ключ или вставить его.
 * @param {import('../comm/api.js').API} api
 * @param {() => void} onSaved
 * @param {string} [textKey] Чего без ключа нет.
 * @returns {HTMLElement}
 */
export function renderNoKeyStatus(api, onSaved, textKey = 'enrich.noKey') {
    const node = createStatus();
    node.classList.add('scan-disable');
    node.dataset.state = 'warn';
    const head = document.createElement('div');
    head.className = 'fc-enrich-head';
    head.textContent = translate(textKey);
    node.append(head, createFlibKeyHelp({api, variant: 'need', onSaved}));
    return node;
}
