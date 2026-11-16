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
    anki_model_failed: 'enrich.models',
    anki_model_outdated: 'enrich.models',
    anki_deck_failed: 'enrich.deck',
    llm_rejected: 'enrich.rejected',
});

/** Ссылки-заглушки докупки квоты (задача 385). */
/** @type {Readonly<Record<string, string>>} */
const SOON_TEXT = Object.freeze({
    llm_quota_exhausted: 'pos.quotaLink',
    tts_quota_exhausted: 'enrich.speechQuotaLink',
});

/**
 * @param {'pending' | import('flib-gateway').EnrichReport} state
 * @returns {HTMLElement}
 */
export function renderEnrichStatus(state) {
    const node = document.createElement('div');
    node.className = 'fc-enrich-status';
    node.setAttribute('role', 'status');
    if (state === 'pending') {
        node.dataset.state = 'pending';
        node.textContent = translate('enrich.pending');
        return node;
    }
    const steps = [state.enrich, state.audio, state.reverse, state.phrases];
    /** @type {string[]} */
    const codes = [];
    for (const code of [...steps.filter((step) => step.status === 'failed').map((step) => step.code ?? 'anki_failed'), state.speechCode]) {
        if (typeof code === 'string' && !codes.includes(code)) { codes.push(code); }
    }
    /** @type {string[]} */
    const done = [];
    if (state.enrich.status === 'done') { done.push(translate('enrich.examples')); }
    if (state.audio.status === 'done') { done.push(translate('enrich.audio')); }
    const cards = [state.reverse, state.phrases].filter((step) => step.status === 'done').length;
    if (cards > 0) { done.push(translatePlural('enrich.moreCards', cards)); }

    node.dataset.state = codes.length === 0 ? 'ok' : 'warn';
    const head = document.createElement('div');
    head.className = 'fc-enrich-head';
    head.textContent = codes.length === 0 ? `✓ ${done.join(' · ')}` : `⚠ ${translate('enrich.added')}${done.length > 0 ? ` ${done.join(' · ')}` : ''}`;
    node.appendChild(head);
    /** @type {Set<string>} */
    const shown = new Set();
    for (const code of codes) {
        const key = Object.hasOwn(PROBLEM_TEXT, code) ? PROBLEM_TEXT[code] : 'enrich.anki';
        if (shown.has(key)) { continue; }
        shown.add(key);
        const line = document.createElement('div');
        line.className = 'fc-enrich-problem';
        line.textContent = translate(key);
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
 * Заметка добавлена без обогащения: нет личного ключа. Строка объясняет почему
 * и сразу даёт получить ключ или вставить его.
 * @param {import('../comm/api.js').API} api
 * @param {() => void} onSaved
 * @returns {HTMLElement}
 */
export function renderNoKeyStatus(api, onSaved) {
    const node = document.createElement('div');
    node.className = 'fc-enrich-status';
    node.setAttribute('role', 'status');
    node.dataset.state = 'warn';
    const head = document.createElement('div');
    head.className = 'fc-enrich-head';
    head.textContent = translate('enrich.noKey');
    node.append(head, createFlibKeyHelp({api, variant: 'need', onSaved}));
    return node;
}
