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

import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {renderEnrichStatus, renderNoKeyStatus, renderPhraseEnrichStatus} from '../ext/js/display/flib-enrich-status.js';
import {setUiLanguage, translate, translatePlural} from '../ext/js/i18n/ui-language.js';
import {setupDomTest} from './fixtures/dom-test.js';

/** @typedef {import('flib-gateway').EnrichReport} EnrichReport */
/** @typedef {import('flib-gateway').PhraseEnrichReport} PhraseEnrichReport */

/**
 * @param {Partial<EnrichReport>} overrides
 * @returns {EnrichReport}
 */
function report(overrides) {
    return {enrich: {status: 'done'}, audio: {status: 'done'}, reverse: {status: 'done'}, phrases: {status: 'done'}, speechCode: null, ...overrides};
}

describe('renderEnrichStatus', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => {
        env = await setupDomTest();
        setUiLanguage('ru');
    });
    afterEach(async () => { await env.teardown(global); });

    test('no-key status: warn line with the text and the key help', () => {
        const node = renderNoKeyStatus(/** @type {*} */ (null), () => {});
        expect(node.className).toContain('fc-enrich-status');
        expect(node.dataset.state).toBe('warn');
        expect(node.classList.contains('scan-disable')).toBe(true);
        expect(node.querySelector('.fc-enrich-head')?.textContent).toBe(translate('enrich.noKey'));
        expect(node.querySelector('.fc-xp-help')).not.toBeNull();
    });

    test('no-key status of a phrase: the same line, its own text', () => {
        const word = renderNoKeyStatus(/** @type {*} */ (null), () => {});
        const node = renderNoKeyStatus(/** @type {*} */ (null), () => {}, 'enrich.phraseNoKey');
        const head = /** @type {HTMLElement} */ (node.querySelector('.fc-enrich-head'));
        expect(head.textContent).toBe('Без озвучки и автоперевода: ключа нет или он неверный');
        head.textContent = translate('enrich.noKey');
        expect(node.outerHTML).toBe(word.outerHTML);
    });

    test('pending', () => {
        const node = renderEnrichStatus('pending');
        expect(node.className).toContain('fc-enrich-status');
        expect(node.textContent).toContain('Обогащаю карточку');
        expect(node.getAttribute('role')).toBe('status');
    });

    test('everything done', () => {
        const node = renderEnrichStatus(report({}));
        expect(node.dataset.state).toBe('ok');
        expect(node.textContent).toContain('Примеры и синонимы');
        expect(node.textContent).toContain('озвучка');
        expect(node.textContent).toContain('ещё 2 карточки');
    });

    test('both extra cards skipped: only examples and audio are listed', () => {
        const node = renderEnrichStatus(report({reverse: {status: 'skipped'}, phrases: {status: 'skipped'}}));
        expect(node.dataset.state).toBe('ok');
        expect(node.querySelector('.fc-enrich-head')?.textContent).toBe(`✓ ${translate('enrich.examples')} · ${translate('enrich.audio')}`);
        expect(node.querySelector('.fc-enrich-head')?.textContent).toBe('✓ Примеры и синонимы · озвучка');
    });

    test('only the phrases card done: the singular «ещё 1 карточка» form', () => {
        const node = renderEnrichStatus(report({reverse: {status: 'skipped'}}));
        expect(node.querySelector('.fc-enrich-head')?.textContent).toContain(translatePlural('enrich.moreCards', 1));
        expect(node.textContent).toContain('ещё 1 карточка');
        expect(node.textContent).not.toContain('ещё 1 карточки');
    });

    test('translation quota: own text and the soon-link stub', () => {
        const node = renderEnrichStatus(report({enrich: {status: 'failed', code: 'llm_quota_exhausted'}, phrases: {status: 'failed', code: 'llm_quota_exhausted'}, reverse: {status: 'skipped'}}));
        expect(node.dataset.state).toBe('warn');
        expect(node.textContent).toContain('Карточка добавлена');
        expect(node.textContent).toContain('Квота переводов на этот месяц исчерпана');
        expect(node.textContent).toContain('Продлить квоту переводов — скоро будет');
        expect(node.querySelectorAll('a')).toHaveLength(0);
    });

    test('speech quota: own text even when notes were created', () => {
        const node = renderEnrichStatus(report({audio: {status: 'failed', code: 'tts_quota_exhausted'}, speechCode: 'tts_quota_exhausted'}));
        expect(node.dataset.state).toBe('warn');
        expect(node.textContent).toContain('квота озвучки на этот месяц исчерпана');
        expect(node.textContent).toContain('Продлить квоту озвучки — скоро будет');
        expect(node.textContent).toContain('ещё 2 карточки');
    });

    test.each([
        ['flib_key_invalid', 'Личный ключ не подходит'],
        ['flib_service_unavailable', 'Сервер недоступен'],
        ['flib_timeout', 'Сервер недоступен'],
        ['anki_model_failed', 'типы карточек'],
        ['anki_failed', 'Anki не ответила'],
        ['anki_deck_failed', 'колоду'],
        ['llm_rejected', 'отклонил запрос'],
    ])('error %s has its own text, once', (code, text) => {
        const node = renderEnrichStatus(report({enrich: {status: 'failed', code}, reverse: {status: 'failed', code}, phrases: {status: 'failed', code}}));
        expect(node.textContent).toContain(text);
        expect(node.textContent?.split(text)).toHaveLength(2);
    });
});

describe('renderPhraseEnrichStatus', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => {
        env = await setupDomTest();
        setUiLanguage('ru');
    });
    afterEach(async () => { await env.teardown(global); });

    /** @type {import('flib-gateway').EnrichStep} */
    const DONE = {status: 'done'};
    /** @type {import('flib-gateway').EnrichStep} */
    const SKIPPED = {status: 'skipped'};
    /**
     * @param {string} code
     * @returns {import('flib-gateway').EnrichStep}
     */
    const failed = (code) => ({status: 'failed', code});

    /**
     * @param {Partial<PhraseEnrichReport>} [change]
     * @returns {HTMLElement}
     */
    const render = (change = {}) => renderPhraseEnrichStatus({audio: DONE, translation: DONE, speechCode: null, ...change});
    /**
     * @param {HTMLElement} node
     * @returns {(string|null)[]} The head and the problems.
     */
    const lines = (node) => [...node.children].map(({textContent}) => textContent);

    test('pending: the same line as of a word', () => {
        expect(renderPhraseEnrichStatus('pending').outerHTML).toBe(renderEnrichStatus('pending').outerHTML);
    });

    test.each(/** @type {[name: string, change: Partial<PhraseEnrichReport>, head: string][]} */ ([
        ['both', {}, '✓ озвучка · перевод'],
        ['only the audio: the translation was typed', {translation: SKIPPED}, '✓ озвучка'],
        ['only the translation: the audio is there', {audio: SKIPPED}, '✓ перевод'],
        ['nothing was left to do', {audio: SKIPPED, translation: SKIPPED}, '✓ Карточка добавлена.'],
    ]))('done: %s', (_name, change, head) => {
        const node = render(change);
        expect(node.className).toBe('fc-enrich-status');
        expect(node.getAttribute('role')).toBe('status');
        expect(node.dataset.state).toBe('ok');
        expect(lines(node)).toStrictEqual([head]);
    });

    test.each(/** @type {[name: string, change: Partial<PhraseEnrichReport>, lines: string[]][]} */ ([
        ['the audio failed', {audio: failed('tts_quota_exhausted'), speechCode: 'tts_quota_exhausted'}, ['⚠ Карточка добавлена. перевод', 'Озвучки нет: квота озвучки на этот месяц исчерпана. Продлить квоту озвучки — скоро будет']],
        ['the translation failed', {translation: failed('llm_quota_exhausted')}, ['⚠ Карточка добавлена. озвучка', 'Квота переводов на этот месяц исчерпана. Продлить квоту переводов — скоро будет']],
        ['both, for different reasons', {audio: failed('flib_media_not_stored'), translation: failed('anki_closed')}, ['⚠ Карточка добавлена.', 'Anki не сохранила файл озвучки', 'Anki закрыта — часть карточки не дописана']],
        ['both, for one reason', {audio: failed('anki_closed'), translation: failed('anki_closed'), speechCode: 'anki_closed'}, ['⚠ Карточка добавлена.', 'Anki закрыта — часть карточки не дописана']],
        ['a failed step without a code', {audio: {status: 'failed'}}, ['⚠ Карточка добавлена. перевод', 'Anki не ответила — часть карточки не дописана']],
        ['a speech error besides', {audio: failed('anki_note_failed'), speechCode: 'flib_rate_limited'}, ['⚠ Карточка добавлена. перевод', 'Anki не приняла часть карточки или не ответила', 'Слишком много запросов к серверу — часть карточки не дописана']],
        ['skipped with a code: too long', {audio: {status: 'skipped', code: 'flib_sentence_too_long'}, translation: {status: 'skipped', code: 'flib_sentence_too_long'}}, ['⚠ Карточка добавлена.', 'Без озвучки и автоперевода: фраза длиннее 1000 знаков']],
        ['skipped with a code: the key is gone', {audio: {status: 'skipped', code: 'flib_key_missing'}, translation: {status: 'skipped', code: 'flib_key_missing'}}, ['⚠ Карточка добавлена.', 'Не указан личный ключ — его можно ввести в настройках']],
        ['one skipped with a code, the other failed', {audio: {status: 'skipped', code: 'flib_key_invalid'}, translation: failed('flib_timeout')}, ['⚠ Карточка добавлена.', 'Личный ключ не подходит — проверьте его в настройках', 'Сервер недоступен — часть карточки не дописана']],
    ]))('%s', (_name, change, expected) => {
        const node = render(change);
        expect(node.dataset.state).toBe('warn');
        expect(lines(node)).toStrictEqual(expected);
    });

    test.each(['ru', 'en'])('every code of the report has its own text (%s), it is not «Anki did not answer»', (language) => {
        setUiLanguage(/** @type {*} */ (language));
        const texts = [
            'anki_closed',
            'anki_route_switched',
            'anki_note_gone',
            'anki_note_failed',
            'anki_model_outdated',
            'flib_media_not_stored',
            'flib_sentence_too_long',
            'tts_failed',
            'flib_bad_request',
            'flib_rate_limited',
            'flib_service_unavailable',
            'llm_bad_answer',
        ].map((code) => lines(render({audio: failed(code), translation: failed(code)}))[1]);
        expect(new Set(texts).size).toBe(texts.length);
        expect(texts).not.toContain(translate('enrich.anki'));
        for (const text of texts) { expect(text).not.toMatch(/[{}]|enrich\./); }
    });

    test.each(['ru', 'en'])('nothing can be pressed again here (%s): no text advises it', (language) => {
        setUiLanguage(/** @type {*} */ (language));
        const codes = [
            'llm_quota_exhausted',
            'tts_quota_exhausted',
            'flib_key_missing',
            'flib_key_invalid',
            'flib_rate_limited',
            'flib_service_unavailable',
            'flib_timeout',
            'llm_bad_answer',
            'llm_rejected',
            'flib_bad_request',
            'flib_secret_forbidden',
            'anki_closed',
            'anki_route_switched',
            'anki_note_gone',
            'anki_note_failed',
            'anki_model_outdated',
            'anki_model_failed',
            'anki_deck_failed',
            'flib_media_not_stored',
            'flib_sentence_too_long',
            'tts_failed',
            'anki_failed',
        ];
        for (const code of codes) {
            expect(lines(render({translation: failed(code)}))[1], code).not.toMatch(/ещё раз|позже|нажмите|again|later|press/i);
        }
    });

    test.each(['flib_bad_request', 'flib_secret_forbidden'])('%s: refused, Anki has nothing to do with it', (code) => {
        expect(lines(render({audio: failed(code), translation: failed(code)}))).toStrictEqual(['⚠ Карточка добавлена.', 'Запрос отклонён — часть карточки не дописана']);
    });

    test.each([
        'llm_quota_exhausted',
        'tts_quota_exhausted',
        'flib_key_missing',
        'flib_key_invalid',
        'llm_rejected',
        'anki_failed',
        'something_else',
    ])('%s: the text of a word', (code) => {
        expect(lines(render({translation: failed(code)}))[1]).toBe(lines(renderEnrichStatus(report({enrich: failed(code)})))[1]);
    });

    test.each([
        ['anki_closed', 'Anki закрыта — часть карточки не дописана'],
        ['anki_route_switched', 'Связь с Anki переключена — часть карточки не дописана'],
    ])('a word: the note types were not set up (%s)', (code, text) => {
        expect(lines(renderEnrichStatus(report({reverse: failed(code), phrases: failed(code)})))).toStrictEqual([expect.stringContaining('⚠'), text]);
    });

    test('a word: the codes of a phrase and a skipped step say what they said', () => {
        for (const code of ['anki_note_gone', 'anki_note_failed', 'flib_media_not_stored', 'flib_sentence_too_long', 'tts_failed', 'flib_bad_request', 'flib_secret_forbidden']) {
            expect(lines(renderEnrichStatus(report({enrich: failed(code)})))[1]).toBe('Anki не ответила — часть карточки не дописана');
        }
        expect(lines(renderEnrichStatus(report({enrich: failed('anki_model_outdated')})))[1]).toBe('Не удалось поставить в Anki типы карточек Flibooster');
        for (const [code, key] of [['flib_rate_limited', 'pos.rateLimited'], ['llm_bad_answer', 'pos.badAnswer'], ['flib_service_unavailable', 'pos.unavailable'], ['flib_timeout', 'pos.unavailable']]) {
            expect(lines(renderEnrichStatus(report({enrich: failed(code)})))[1]).toBe(translate(key));
        }
        const skipped = renderEnrichStatus(report({reverse: {status: 'skipped', code: 'flib_key_missing'}}));
        expect(skipped.dataset.state).toBe('ok');
        expect(skipped.textContent).not.toContain('ключ');
    });
});
