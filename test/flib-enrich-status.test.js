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
import {renderEnrichStatus, renderNoKeyStatus} from '../ext/js/display/flib-enrich-status.js';
import {setUiLanguage, translate} from '../ext/js/i18n/ui-language.js';
import {setupDomTest} from './fixtures/dom-test.js';

/** @typedef {import('flib-gateway').EnrichReport} EnrichReport */

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
        expect(node.querySelector('.fc-enrich-head')?.textContent).toBe(translate('enrich.noKey'));
        expect(node.querySelector('.fc-xp-help')).not.toBeNull();
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
