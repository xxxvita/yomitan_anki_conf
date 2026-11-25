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

import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {JSDOM} from 'jsdom';
import {afterAll, afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {EventDispatcher} from '../ext/js/core/event-dispatcher.js';
import {ExtensionError} from '../ext/js/core/extension-error.js';
import {parseKeyAccess} from '../ext/js/data/flib-key-access.js';
import {FLIB_BUY_URL, FLIB_HELP_EMAIL} from '../ext/js/data/flib-host.js';
import {messagesEn} from '../ext/js/i18n/messages-en.js';
import {messagesRu} from '../ext/js/i18n/messages-ru.js';
import {setUiLanguage} from '../ext/js/i18n/ui-language.js';
import {FlibKeyAccessController} from '../ext/js/pages/settings/flib-key-access-controller.js';
import {setupDomTest} from './fixtures/dom-test.js';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const {document: page} = new JSDOM(fs.readFileSync(path.join(ROOT, 'ext/settings.html'), 'utf8')).window;
const PANEL = /** @type {HTMLElement} */ (page.querySelector('#flib-key-access'));

const env = await setupDomTest();
const {window, teardown} = env;
afterAll(() => teardown(global));

beforeEach(() => {
    vi.useFakeTimers({now: Date.parse('2026-11-25T10:00:00Z'), toFake: ['Date']});
});

afterEach(() => {
    vi.useRealTimers();
    setUiLanguage('ru');
});

/** @type {import('flib-gateway').KeyAccess} */
const FULL = {
    keyPrefix: 'tpk_1a2b',
    expiresAt: '2026-12-31T00:00:00Z',
    demo: false,
    rights: [right('examples'), right('route'), right('puzzle_movies'), right('elevenlabs_realtime'), right('assemblyai')],
    gpt: {used: 3799999, limit: 10000000, unlimited: false},
    tts: {used: 12000, limit: 25000, unlimited: false},
    stt: {used: 120, limit: 4380, unlimited: false},
    resetsAt: '2026-12-01T00:00:00Z',
    gptTokens: null,
    examplesQuota: null,
};

/**
 * @param {string} id
 * @param {Partial<import('flib-gateway').KeyRight>} [fields]
 * @returns {import('flib-gateway').KeyRight}
 */
function right(id, fields = {}) {
    return {id, usable: true, permanent: true, validFrom: '2026-01-01', validTo: '2079-01-01', ...fields};
}

/**
 * @param {string} code
 * @returns {ExtensionError}
 */
function flibError(code) {
    const error = new ExtensionError(code);
    error.data = {code, status: null};
    // Ошибка приходит сообщением: класс и данные восстанавливаются из JSON.
    return ExtensionError.deserialize(ExtensionError.serialize(error));
}

/**
 * @param {?string|undefined} text
 * @returns {string}
 */
const squash = (text) => (text ?? '').replace(/\s+/g, ' ').trim();

const flush = async () => {
    for (let i = 0; i < 10; ++i) { await Promise.resolve(); }
};

/**
 * @template T
 * @returns {{promise: Promise<T>, resolve: (value: T) => void, reject: (error: unknown) => void}}
 */
function defer() {
    /** @type {(value: T) => void} */
    let resolve = () => {};
    /** @type {(error: unknown) => void} */
    let reject = () => {};
    /** @type {Promise<T>} */
    const promise = new Promise((resolve2, reject2) => {
        resolve = resolve2;
        reject = reject2;
    });
    return {promise, resolve, reject};
}

/** @typedef {import('flib-gateway').KeyAccess} KeyAccess */

/**
 * @typedef {object} Harness
 * @property {HTMLElement} panel
 * @property {HTMLElement} state
 * @property {HTMLElement} summary
 * @property {HTMLElement} body
 * @property {HTMLButtonElement} refresh
 * @property {{keyMasked: ?string, gatewayUrl: string, fails: boolean}} store
 * @property {import('vitest').Mock<(expected: import('flib-secret-store').FlibSecretsIdentity) => Promise<unknown>>} keyAccess
 * @property {import('vitest').Mock<() => Promise<unknown>>} secretsGet
 * @property {(visible?: boolean) => Promise<void>} visibility
 * @property {() => Promise<void>} focus Фокус вернулся в окно страницы.
 * @property {() => Promise<void>} changed Ключ или адрес записаны на этой странице.
 * @property {() => Promise<void>} language
 * @property {import('flib-secret-store').FlibSecretsIdentity[]} read Что панель узнала о ключе и адресе, по порядку.
 */

/**
 * Поддельная фоновая часть: вместе с ответом и ошибкой отдаёт маску и адрес,
 * которые в хранилище на момент ответа, как `_onApiFlibKeyAccess`.
 * @param {KeyAccess|Error|(() => Promise<KeyAccess>)} answer
 * @param {{keyMasked?: ?string, gatewayUrl?: string, fails?: boolean}} [details]
 * @returns {Promise<Harness>}
 */
async function setup(answer, {keyMasked = 'tpk_…beef', gatewayUrl = '', fails = false} = {}) {
    window.document.body.replaceChildren(window.document.importNode(PANEL, true));
    const store = {keyMasked, gatewayUrl, fails};
    const identity = () => ({keyMasked: store.keyMasked, gatewayUrl: store.gatewayUrl, changed: false});
    const keyAccess = vi.fn(async (/** @type {unknown} */ _expected) => {
        try {
            const access = typeof answer === 'function' ? await answer() : answer;
            if (access instanceof Error) { throw access; }
            return {access, ...identity()};
        } catch (e) {
            if (e instanceof ExtensionError) {
                const data = /** @type {Record<string, unknown>} */ (e.data);
                e.data = {...identity(), ...data};
            }
            throw e;
        }
    });
    const secretsGet = vi.fn(async () => {
        if (store.fails) { throw new Error('backend gone'); }
        return {hasKey: store.keyMasked !== null, keyMasked: store.keyMasked, gatewayUrl: store.gatewayUrl, migrationNote: null};
    });
    const events = /** @type {EventDispatcher<import('settings-controller').Events>} */ (new EventDispatcher());
    const settingsController = /** @type {import('../ext/js/pages/settings/settings-controller.js').SettingsController} */ (/** @type {unknown} */ (Object.assign(events, {
        application: {api: {flibKeyAccess: keyAccess, flibSecretsGet: secretsGet}},
    })));
    /** @type {import('flib-secret-store').FlibSecretsIdentity[]} */
    const read = [];
    events.on('flibSecretsRead', (details) => { read.push(details); });
    const controller = new FlibKeyAccessController(settingsController);
    controller.prepare();
    await flush();
    const $ = (/** @type {string} */ selector) => /** @type {HTMLElement} */ (window.document.querySelector(selector));
    return {
        panel: $('#flib-key-access'),
        state: $('#flib-key-access-state'),
        summary: $('#flib-key-access-summary'),
        body: $('#flib-key-access-body'),
        refresh: /** @type {HTMLButtonElement} */ ($('#flib-key-access-refresh')),
        store,
        keyAccess,
        secretsGet,
        visibility: async (visible = true) => {
            Object.defineProperty(window.document, 'visibilityState', {configurable: true, value: visible ? 'visible' : 'hidden'});
            window.document.dispatchEvent(new window.Event('visibilitychange'));
            await flush();
        },
        focus: async () => {
            Object.defineProperty(window.document, 'visibilityState', {configurable: true, value: 'visible'});
            window.dispatchEvent(new window.Event('focus'));
            await flush();
        },
        changed: async () => {
            events.trigger('flibSecretsChanged', {});
            await flush();
        },
        language: async () => {
            events.trigger('uiLanguageChanged', {});
            await flush();
        },
        read,
    };
}

/**
 * @param {Harness} harness
 * @returns {string[]} Строки прав: «✓ подпись», «✗ подпись».
 */
const rightsOf = ({body}) => [...body.querySelectorAll('.flib-key-right')].map((node) => squash(node.textContent));

/**
 * @param {Harness} harness
 * @returns {string[]}
 */
const usageOf = ({body}) => [...body.querySelectorAll('.flib-key-usage-row')].map((node) => squash(node.textContent));

/**
 * @param {Harness} harness
 * @returns {string}
 */
const otherOf = ({body}) => squash(body.querySelector('.flib-key-other')?.textContent);

/**
 * @param {Partial<KeyAccess>} fields
 * @returns {Promise<Harness>}
 */
const setupWith = (fields) => setup({...FULL, ...fields});

describe('разметка', () => {
    test('панель стоит сразу под полем ключа, перед адресом сервера', () => {
        expect(PANEL.previousElementSibling?.querySelector('#flib-personal-key-input')).not.toBeNull();
        expect(PANEL.nextElementSibling?.querySelector('#flib-gateway-url-input')).not.toBeNull();
        expect(PANEL.matches('.settings-group[data-flib]>.settings-item')).toBe(true);
    });

    test('aria-live только у строки состояния, загрузка стоит в ней с самого начала', () => {
        expect([...PANEL.querySelectorAll('[aria-live],[role=status],[role=alert]')].map(({id}) => id)).toStrictEqual(['flib-key-access-state']);
        expect(PANEL.querySelector('#flib-key-access-state')?.getAttribute('aria-live')).toBe('polite');
        expect(PANEL.dataset.state).toBe('loading');
    });
});

describe('settings.css', () => {
    test('высота панели занята заранее, и на узком экране тоже; без ключа и при ошибке без данных — нет', () => {
        const styles = fs.readFileSync(path.join(ROOT, 'ext/css/settings.css'), 'utf8');
        const heights = [...styles.matchAll(/([^{}]+)\{[^{}]*?min-height: ([^;]+);/g)].filter(([, selector]) => selector.includes('#flib-key-access')).map(([, selector, height]) => `${[...selector.matchAll(/#flib-key-access(?!-)(\S*?),?\s/g)].map(([, state]) => state).join(' ')} ${height}`.trim());
        expect(heights).toStrictEqual(['27em', '[data-state=empty] 0', '[data-state=error]:has(#flib-key-access-body:empty) 0', '38em']);
    });
});

describe('данные', () => {
    test('полный ключ', async () => {
        const harness = await setup(FULL);
        expect(harness.panel.dataset.state).toBe('ready');
        expect(harness.state.textContent).toBe('');
        expect(squash(harness.summary.textContent)).toBe('Ключ tpk_1a2b… · действует до 31.12.2026');
        expect(rightsOf(harness)).toStrictEqual([
            '✓ Примеры YouTube и «С учётом моих знаний»',
            '✓ Фильмы в примерах',
            '✓ Понятные видео',
            '✓ Перевод, часть речи и обогащение карточек (ChatGPT)',
            '✓ Озвучка карточек',
        ]);
        expect(otherOf(harness)).toBe('Ещё по этому ключу: Видео каталог · Распознавание речи');
        expect(usageOf(harness)).toStrictEqual([
            'ИИ потрачено 37 %, осталось 63 %',
            'Озвучка 12 000 из 25 000 символов, осталось 13 000',
            'Речь 2 из 73 мин, осталось 71',
        ]);
        expect(squash(harness.body.querySelector('.flib-key-foot')?.textContent)).toBe('Обновится 1 декабря. Считаются все программы с этим ключом.');
        expect(harness.refresh.disabled).toBe(false);
    });

    test('английский', async () => {
        setUiLanguage('en');
        const harness = await setupWith({gptTokens: {input: 1000, output: 1}, rights: [right('examples'), right('lingq', {permanent: false, validTo: '2026-12-05'})]});
        expect(squash(harness.summary.textContent)).toBe('Key tpk_1a2b… · valid until Dec 31, 2026');
        expect(rightsOf(harness).slice(2)).toStrictEqual(['✗ Understandable videos', '✓ Translation, part of speech and card enrichment (ChatGPT)', '✓ Card audio']);
        expect(otherOf(harness)).toBe('Also with this key: Listening course (until December 5, 2026)');
        expect(usageOf(harness)).toStrictEqual([
            'AI 37% spent, 63% left · 1,001 tokens spent',
            'Audio 12,000 of 25,000 characters, 13,000 left',
            'Speech 2 of 73 min, 71 left',
        ]);
        expect(squash(harness.body.querySelector('.flib-key-foot')?.textContent)).toBe('Renews on December 1. All programs using this key are counted.');
        expect(harness.panel.querySelector('#flib-key-access-body')?.textContent).not.toMatch(/[а-я]/i);
    });

    test('смена языка перерисовывает без запроса', async () => {
        const harness = await setup(FULL);
        setUiLanguage('en');
        await harness.language();
        expect(usageOf(harness)[0]).toBe('AI 37% spent, 63% left');
        expect(harness.keyAccess).toHaveBeenCalledTimes(1);
    });

    test('смена языка во время загрузки и при ошибке', async () => {
        const harness = await setup(flibError('flib_key_expired'));
        setUiLanguage('en');
        await harness.language();
        expect(harness.state.textContent).toBe('The key has expired. Renew it');
    });

    test.each([
        [null, 'Ключ tpk_1a2b… · бессрочно'],
        ['', 'Ключ tpk_1a2b… · срок: нет данных'],
        ['2027-01-01', 'Ключ tpk_1a2b… · действует до 01.01.2027'],
        ['2026-12-31T22:00:00-05:00', 'Ключ tpk_1a2b… · действует до 01.01.2027'],
        ['2027-01-01T00:00:00.5+05:00', 'Ключ tpk_1a2b… · действует до 31.12.2026'],
    ])('срок ключа %j: %s', async (expiresAt, expected) => {
        expect(squash((await setupWith({expiresAt})).summary.textContent)).toBe(expected);
    });

    test('даты всегда по UTC', async () => {
        const {TZ} = process.env;
        try {
            for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
                process.env.TZ = zone;
                const harness = await setupWith({rights: [right('chad', {permanent: false, validTo: '2026-12-01'})]});
                expect(squash(harness.summary.textContent)).toContain('31.12.2026');
                expect(otherOf(harness)).toContain('(до 1 декабря 2026)');
                expect(squash(harness.body.querySelector('.flib-key-foot')?.textContent)).toContain('Обновится 1 декабря.');
            }
        } finally {
            process.env.TZ = TZ;
            if (typeof TZ !== 'string') { delete process.env.TZ; }
        }
    });

    test.each([[null], ['key_1a2b'], ['tpk_1A2B'], ['tpk_'], ['tpk_chad'], ['<b>x</b>'], ['tpk_1a2b\n']])('начало ключа %j не показывается', async (keyPrefix) => {
        expect(squash((await setupWith({keyPrefix})).summary.textContent)).toBe('Ключ · действует до 31.12.2026');
    });

    test('без даты обновления', async () => {
        const harness = await setupWith({resetsAt: null});
        expect(squash(harness.body.querySelector('.flib-key-foot')?.textContent)).toBe('Считаются все программы с этим ключом.');
    });
});

describe('права расширения', () => {
    const none = '✗ Примеры YouTube и «С учётом моих знаний»|✗ Фильмы в примерах|✗ Понятные видео';
    test.each([
        ['без прав', [], false, none],
        ['только примеры', [right('examples')], false, none.replace('✗', '✓')],
        ['фильмы требуют route', [right('puzzle_movies')], false, none],
        ['фильмы требуют puzzle_movies', [right('route')], false, none.replace('✗ Понятные', '✓ Понятные')],
        ['examples фильмов не касается', [right('route'), right('puzzle_movies')], false, none.replace('✗ Фильмы', '✓ Фильмы').replace('✗ Понятные', '✓ Понятные')],
        ['тестовый ключ', [right('examples'), right('route'), right('puzzle_movies')], true, '✓ Примеры YouTube и «С учётом моих знаний»|✓ Фильмы в примерах — ограниченно|✗ Понятные видео'],
        ['тестовый ключ без фильмов', [right('route')], true, none],
        ['право есть, но не действует', [right('examples', {usable: false}), right('route', {usable: false}), right('puzzle_movies')], false, none],
        ['повтор права: действует одно из двух', [right('examples', {usable: false}), right('examples')], false, none.replace('✗', '✓')],
    ])('%s', async (_name, rights, demo, expected) => {
        expect(rightsOf(await setupWith({rights, demo})).slice(0, 3).join('|')).toBe(expected);
    });

    test('ИИ и озвучка есть у любого годного ключа', async () => {
        for (const usage of [null, {used: 5, limit: null, unlimited: true}, {used: 4, limit: 5, unlimited: false}]) {
            expect(rightsOf(await setupWith({rights: [], gpt: usage, tts: usage})).slice(3)).toStrictEqual(['✓ Перевод, часть речи и обогащение карточек (ChatGPT)', '✓ Озвучка карточек']);
        }
    });

    test.each([[5, 5], [6, 5], [0, 0]])('исчерпано: %i из %i', async (used, limit) => {
        const usage = {used, limit, unlimited: false};
        expect(rightsOf(await setupWith({gpt: usage})).slice(3)).toStrictEqual(['✗ Перевод, часть речи и обогащение карточек (ChatGPT) — лимит ИИ на месяц исчерпан', '✓ Озвучка карточек']);
        expect(rightsOf(await setupWith({tts: usage})).slice(3)).toStrictEqual(['✓ Перевод, часть речи и обогащение карточек (ChatGPT)', '✗ Озвучка карточек — лимит озвучки на месяц исчерпан']);
        expect(rightsOf(await setupWith({stt: usage})).every((text) => text.startsWith('✓'))).toBe(true);
        expect(rightsOf(await setupWith({examplesQuota: {used, limit}}))[0]).toBe('✗ Примеры YouTube и «С учётом моих знаний» — квота исчерпана');
    });

    test('квота примеров: не исчерпана, без лимита, без самого права', async () => {
        const label = 'Примеры YouTube и «С учётом моих знаний»';
        expect(rightsOf(await setupWith({examplesQuota: {used: 4, limit: 5}}))[0]).toBe(`✓ ${label}`);
        expect(rightsOf(await setupWith({examplesQuota: {used: 4, limit: null}}))[0]).toBe(`✓ ${label}`);
        expect(rightsOf(await setupWith({rights: [], examplesQuota: {used: 5, limit: 5}}))[0]).toBe(`✗ ${label}`);
    });

    test('знак имеет словесную подпись', async () => {
        const marks = [...(await setupWith({rights: [right('examples')]})).body.querySelectorAll('.flib-key-mark')];
        expect(marks.map((node) => `${node.getAttribute('role')} ${node.getAttribute('aria-label')}`)).toStrictEqual(['img доступно', 'img недоступно', 'img недоступно', 'img доступно', 'img доступно']);
    });

    test.each([
        ['право с завтрашнего дня', [right('examples', {usable: false, validFrom: '2026-11-26'})], '✗ Примеры YouTube и «С учётом моих знаний» — с 26 ноября 2026'],
        ['сегодняшнее — уже не будущее', [right('examples', {usable: false, validFrom: '2026-11-25'})], '✗ Примеры YouTube и «С учётом моих знаний»'],
        ['срок раньше срока ключа', [right('examples', {permanent: false, validTo: '2026-12-29'})], '✓ Примеры YouTube и «С учётом моих знаний» — до 29 декабря 2026'],
        ['срок в последний целый день ключа', [right('examples', {permanent: false, validTo: '2026-12-30'})], '✓ Примеры YouTube и «С учётом моих знаний»'],
        ['срок в день срока ключа', [right('examples', {permanent: false, validTo: '2026-12-31'})], '✓ Примеры YouTube и «С учётом моих знаний»'],
        ['право начнётся, когда ключа уже не будет', [right('examples', {usable: false, validFrom: '2026-12-31'})], '✗ Примеры YouTube и «С учётом моих знаний»'],
        ['право начнётся в последний день ключа', [right('examples', {usable: false, validFrom: '2026-12-30'})], '✗ Примеры YouTube и «С учётом моих знаний» — с 30 декабря 2026'],
        ['право кончится раньше, чем начнётся', [right('examples', {usable: false, permanent: false, validFrom: '2026-12-10', validTo: '2026-12-09'})], '✗ Примеры YouTube и «С учётом моих знаний»'],
        ['право на один будущий день', [right('examples', {usable: false, permanent: false, validFrom: '2026-12-10', validTo: '2026-12-10'})], '✗ Примеры YouTube и «С учётом моих знаний» — с 10 декабря 2026'],
        ['срок позже срока ключа', [right('examples', {permanent: false, validTo: '2027-01-30'})], '✓ Примеры YouTube и «С учётом моих знаний»'],
        ['бессрочное право смотрится раньше даты', [right('examples', {permanent: true, validTo: '2026-12-01'})], '✓ Примеры YouTube и «С учётом моих знаний»'],
        ['срока нет в ответе', [right('examples', {permanent: false, validTo: null})], '✓ Примеры YouTube и «С учётом моих знаний»'],
        ['прошедшее право', [right('examples', {usable: false, permanent: false, validTo: '2026-11-01'})], '✗ Примеры YouTube и «С учётом моих знаний»'],
    ])('срок строки: %s', async (_name, rights, expected) => {
        expect(rightsOf(await setupWith({rights}))[0]).toBe(expected);
    });

    test.each([
        ['2027-01-01T00:00:00Z', '2026-12-31', ''],
        ['2027-01-01T00:00:00Z', '2026-12-30', ' — до 30 декабря 2026'],
        ['2026-12-31T23:59:59Z', '2026-12-31', ''],
        ['2026-12-31T23:59:59.999Z', '2026-12-31', ''],
        ['2026-12-31T23:59:59Z', '2026-12-30', ' — до 30 декабря 2026'],
        ['2026-12-31T18:30:00Z', '2026-12-30', ' — до 30 декабря 2026'],
        ['2026-12-31T18:30:00Z', '2026-12-31', ''],
        ['2026-12-31T00:00:01Z', '2026-12-30', ''],
        ['2026-12-31T00:00:01.001Z', '2026-12-30', ' — до 30 декабря 2026'],
        ['2026-12-31T00:00:00Z', '2026-12-30', ''],
        ['2027-01-01T04:59:59+05:00', '2026-12-30', ' — до 30 декабря 2026'],
        ['2026-12-31', '2026-12-31', ''],
        ['2026-12-31', '2026-12-30', ' — до 30 декабря 2026'],
    ])('конец права сверяется с концом ключа, секунда не в счёт: %s, %s', async (expiresAt, validTo, note) => {
        expect(rightsOf(await setupWith({expiresAt, rights: [right('examples', {permanent: false, validTo})]}))[0]).toBe(`✓ Примеры YouTube и «С учётом моих знаний»${note}`);
    });

    test.each([
        ['2026-12-31', '2026-12-31', ' — с 31 декабря 2026'],
        ['2026-12-31', '2027-01-01', ''],
        ['2026-12-31T00:00:01Z', '2026-12-31', ' — с 31 декабря 2026'],
        [null, '2030-01-01', ' — с 1 января 2030'],
        ['', '2030-01-01', ' — с 1 января 2030'],
    ])('начало права позже срока ключа не обещается: %j, %s', async (expiresAt, validFrom, note) => {
        expect(rightsOf(await setupWith({expiresAt, rights: [right('examples', {usable: false, validFrom})]}))[0]).toBe(`✗ Примеры YouTube и «С учётом моих знаний»${note}`);
    });

    test('срок строки при бессрочном ключе и при ключе без данных о сроке', async () => {
        const limited = [right('examples', {permanent: false, validTo: '2027-02-01'})];
        for (const expiresAt of [null, '']) {
            expect(rightsOf(await setupWith({rights: limited, expiresAt}))[0]).toBe('✓ Примеры YouTube и «С учётом моих знаний» — до 1 февраля 2027');
        }
        // Бессрочное право раньше срока ключа не кончится; без данных о сроке ключа «бессрочно» — новость.
        expect(rightsOf(await setupWith({rights: [right('examples')], expiresAt: null}))[0]).toBe('✓ Примеры YouTube и «С учётом моих знаний»');
        expect(rightsOf(await setupWith({rights: [right('examples')], expiresAt: ''}))[0]).toBe('✓ Примеры YouTube и «С учётом моих знаний» — бессрочно');
    });

    test('фильмы: оба права решают и срок, и начало', async () => {
        const until = (/** @type {string} */ validTo) => ({permanent: false, validTo});
        const from = (/** @type {string} */ validFrom) => ({usable: false, validFrom});
        const films = async (/** @type {Partial<import('flib-gateway').KeyRight>} */ route, /** @type {Partial<import('flib-gateway').KeyRight>} */ movies, demo = false) => rightsOf(await setupWith({rights: [right('route', route), right('puzzle_movies', movies)], demo}))[1];
        expect(await films(until('2026-12-20'), until('2026-12-10'))).toBe('✓ Фильмы в примерах — до 10 декабря 2026');
        expect(await films({}, until('2026-12-10'))).toBe('✓ Фильмы в примерах — до 10 декабря 2026');
        expect(await films({}, until('2026-12-10'), true)).toBe('✓ Фильмы в примерах — ограниченно · до 10 декабря 2026');
        expect(await films(from('2026-12-20'), from('2026-12-10'))).toBe('✗ Фильмы в примерах — с 20 декабря 2026');
        expect(await films({}, from('2026-12-10'))).toBe('✗ Фильмы в примерах — с 10 декабря 2026');
        expect(await films({usable: false}, from('2026-12-10'))).toBe('✗ Фильмы в примерах');
        expect(await films(from('2026-12-20'), {}, true)).toBe('✗ Фильмы в примерах — с 20 декабря 2026');
        // Второе право кончится раньше, чем начнётся первое: вместе они не будут никогда.
        expect(await films(until('2026-12-10'), from('2026-12-20'))).toBe('✗ Фильмы в примерах');
        expect(await films(until('2026-12-20'), from('2026-12-20'))).toBe('✗ Фильмы в примерах — с 20 декабря 2026');
        expect(await films({...from('2026-12-05'), ...until('2026-12-10')}, from('2026-12-20'))).toBe('✗ Фильмы в примерах');
        expect(await films({...from('2026-12-05'), ...until('2026-12-25')}, from('2026-12-20'))).toBe('✗ Фильмы в примерах — с 20 декабря 2026');
        expect(await films({}, from('2027-01-20'))).toBe('✗ Фильмы в примерах');
    });

    test('понятные видео тестовому ключу не обещаны и в будущем', async () => {
        const rights = [right('route', {usable: false, validFrom: '2026-12-01'})];
        expect(rightsOf(await setupWith({rights}))[2]).toBe('✗ Понятные видео — с 1 декабря 2026');
        expect(rightsOf(await setupWith({rights, demo: true}))[2]).toBe('✗ Понятные видео');
    });
});

describe('прочие права', () => {
    test('известные — по именам, распознавание речи один раз, остальные не показаны', async () => {
        const ids = ['locker', 'assemblyai', 'elevenlabs_realtime', 'lingq', 'chad', 'puzzle_movies', 'yt_long', 'yt_video', 'yt_shorts', 'beginner_kit_edit', 'examples', 'route', 'new_right', 'constructor', '__proto__'];
        expect(otherOf(await setupWith({rights: ids.map((id) => right(id))}))).toBe('Ещё по этому ключу: YouTube Shorts · Видео YouTube · Длинные видео YouTube · Видео каталог · Курс произношения · Курс аудирования · Распознавание речи · Хранилище');
    });

    test('нет прочих прав — нет строки', async () => {
        for (const rights of [[], [right('beginner_kit_edit')], [right('what')], [right('locker', {usable: false})]]) {
            expect((await setupWith({rights})).body.querySelector('.flib-key-other')).toBeNull();
        }
    });

    test('будущее право и срок', async () => {
        const rights = [right('chad', {usable: false, validFrom: '2026-12-01'}), right('locker', {permanent: false, validTo: '2026-12-02'}), right('yt_shorts', {usable: false, validFrom: '2026-11-01'})];
        expect(otherOf(await setupWith({rights}))).toBe('Ещё по этому ключу: Курс произношения (с 1 декабря 2026) · Хранилище (до 2 декабря 2026)');
    });

    test('два права под одним именем: лучшее из них', async () => {
        const named = async (/** @type {import('flib-gateway').KeyRight[]} */ ...rights) => otherOf(await setupWith({rights})).replace('Ещё по этому ключу: ', '');
        expect(await named(right('assemblyai', {usable: false, validFrom: '2026-12-01'}), right('elevenlabs_realtime'))).toBe('Распознавание речи');
        expect(await named(right('assemblyai', {permanent: false, validTo: '2026-12-01'}), right('elevenlabs_realtime', {permanent: false, validTo: '2026-12-05'}))).toBe('Распознавание речи (до 5 декабря 2026)');
        expect(await named(right('assemblyai', {permanent: false, validTo: '2026-12-01'}), right('elevenlabs_realtime'))).toBe('Распознавание речи');
        expect(await named(right('assemblyai', {usable: false, validFrom: '2026-12-09'}), right('elevenlabs_realtime', {usable: false, validFrom: '2026-12-03'}))).toBe('Распознавание речи (с 3 декабря 2026)');
    });

    test('ни одного включённого права', async () => {
        for (const rights of [[], [right('examples', {usable: false})], [right('beginner_kit_edit')], [right('new_right', {usable: false})]]) {
            const harness = await setupWith({rights});
            expect(harness.panel.dataset.state).toBe('ready');
            expect(harness.state.textContent).toBe('У ключа нет включённых прав.');
            expect(rightsOf(harness)).toHaveLength(5);
            expect(usageOf(harness)).toHaveLength(3);
        }
        for (const id of ['locker', 'examples', 'route', 'new_right']) { expect((await setupWith({rights: [right(id)]})).state.textContent, id).toBe(''); }
    });
});

describe('расход', () => {
    const usage = (/** @type {number} */ used, /** @type {?number} */ limit) => ({used, limit, unlimited: limit === null});
    const bars = (/** @type {Harness} */ {body}) => [...body.querySelectorAll('.flib-key-bar')];

    test.each([
        [usage(0, 1000), 'ИИ потрачено 0 %, осталось 100 %'],
        [usage(1, 1000), 'ИИ потрачено меньше 1 %, осталось больше 99 %'],
        [usage(10, 1000), 'ИИ потрачено 1 %, осталось 99 %'],
        [usage(999, 1000), 'ИИ потрачено 99 %, осталось 1 %'],
        [usage(1000, 1000), 'ИИ лимит исчерпан'],
        [usage(5000, 1000), 'ИИ лимит исчерпан'],
        [usage(0, 0), 'ИИ лимит исчерпан'],
        [usage(5, null), 'ИИ без лимита'],
        [null, 'ИИ нет данных'],
    ])('ИИ %j: %s', async (gpt, expected) => {
        const harness = await setupWith({gpt});
        expect(usageOf(harness)[0]).toBe(expected);
        expect(bars(harness)).toHaveLength(gpt === null || gpt.unlimited ? 2 : 3);
    });

    test.each([
        [usage(0, 1000), 'Озвучка 0 из 1 000 символов, осталось 1 000'],
        [usage(1, 21), 'Озвучка 1 из 21 символа, осталось 20'],
        [usage(1, 22), 'Озвучка 1 из 22 символов, осталось 21'],
        [usage(1000, 1000), 'Озвучка 1 000 из 1 000 символов, лимит исчерпан'],
        [usage(1200, 1000), 'Озвучка 1 200 из 1 000 символов, лимит исчерпан'],
        [usage(0, 0), 'Озвучка 0 из 0 символов, лимит исчерпан'],
        [usage(1200, null), 'Озвучка без лимита'],
        [null, 'Озвучка нет данных'],
    ])('озвучка %j: %s', async (tts, expected) => {
        expect(usageOf(await setupWith({tts}))[1]).toBe(expected);
    });

    test.each([
        [usage(0, 4380), 'Речь 0 из 73 мин, осталось 73'],
        [usage(59, 4380), 'Речь меньше 1 из 73 мин, осталось 72'],
        [usage(179, 4380), 'Речь 2 из 73 мин, осталось 71'],
        [usage(4379, 4380), 'Речь 72 из 73 мин, осталось 1'],
        [usage(4380, 4380), 'Речь 73 из 73 мин, лимит исчерпан'],
        [usage(90, 300), 'Речь 90 из 300 с, осталось 210'],
        [usage(0, 0), 'Речь 0 из 0 с, лимит исчерпан'],
        [usage(4399, 4400), 'Речь 73 из 73 мин, осталось меньше 1'],
        [usage(4400, 4400), 'Речь 73 из 73 мин, лимит исчерпан'],
        [usage(640, 650), 'Речь 10 из 10 мин, осталось меньше 1'],
        [usage(599, 600), 'Речь 9 из 10 мин, осталось 1'],
        [usage(599.5, 599.6), 'Речь 599 из 599 с, осталось меньше 1'],
        [usage(90, null), 'Речь без лимита'],
        [null, 'Речь нет данных'],
    ])('речь %j: %s', async (stt, expected) => {
        expect(usageOf(await setupWith({stt}))[2]).toBe(expected);
    });

    test('полоса: role=img, подпись, ширина', async () => {
        const harness = await setupWith({gpt: usage(1, 1000), stt: usage(5, 5)});
        expect(bars(harness).map((node) => `${node.getAttribute('role')}|${squash(node.getAttribute('aria-label'))}`)).toStrictEqual(['img|ИИ: потрачено меньше 1 %', 'img|Озвучка: потрачено 48 %', 'img|Речь: лимит исчерпан']);
        expect(bars(harness).map((node) => /** @type {HTMLElement} */ (node.firstElementChild).style.width)).toStrictEqual(['1%', '48%', '100%']);
        expect(bars(harness).map((node) => node.classList.contains('exhausted'))).toStrictEqual([false, false, true]);
        expect((await setupWith({gpt: usage(0, 10)})).body.querySelector('.flib-key-bar>span')?.getAttribute('style')).toBe('width: 0%;');
    });

    test('токены — необязательное поле', async () => {
        const tokens = (/** @type {number} */ input, /** @type {number} */ output) => ({gptTokens: {input, output}});
        expect(usageOf(await setupWith({}))[0]).not.toContain('токен');
        expect(usageOf(await setupWith(tokens(1000, 234)))[0]).toBe('ИИ потрачено 37 %, осталось 63 % · потрачено 1 234 токена');
        expect(usageOf(await setupWith(tokens(1, 0)))[0]).toContain('потрачен 1 токен');
        expect(usageOf(await setupWith(tokens(0, 0)))[0]).toContain('потрачено 0 токенов');
        expect(usageOf(await setupWith({...tokens(5, 0), gpt: null}))[0]).toBe('ИИ нет данных · потрачено 5 токенов');
        expect(usageOf(await setupWith({...tokens(5, 0), gpt: usage(1, null)}))[0]).toBe('ИИ без лимита · потрачено 5 токенов');
    });

    test('квота примеров — необязательное поле', async () => {
        const quota = async (/** @type {KeyAccess['examplesQuota']} */ examplesQuota) => squash((await setupWith({examplesQuota})).body.querySelector('.flib-key-quota')?.textContent);
        expect(await quota(null)).toBe('');
        expect(await quota({used: 1500, limit: 2000})).toBe('Примеры: использовано 1 500 из 2 000');
        expect(await quota({used: 3, limit: null})).toBe('Примеры: без лимита');
        expect(await quota({used: 5, limit: 5})).toBe('Примеры: использовано 5 из 5, лимит исчерпан');
    });

    test('долларов нет', async () => {
        const harness = await setupWith({gpt: usage(1234567, 7654321), gptTokens: {input: 11, output: 22}});
        expect(harness.panel.textContent).not.toMatch(/\$|USD|долл|1234567|7654321|1 234 567|7 654 321|1\.23/i);
    });
});

describe('состояния', () => {
    test('нет ключа: запроса нет', async () => {
        const harness = await setup(FULL, {keyMasked: null});
        expect(harness.panel.dataset.state).toBe('empty');
        expect(harness.state.textContent).toBe('Вставьте ключ, чтобы увидеть права');
        expect(harness.keyAccess).not.toHaveBeenCalled();
        expect(harness.body.childElementCount).toBe(0);
        expect(harness.summary.textContent).toBe('');
    });

    test('загрузка: кнопка погашена', async () => {
        /** @type {ReturnType<typeof defer<KeyAccess>>} */
        const answer = defer();
        const harness = await setup(() => answer.promise);
        expect(harness.panel.dataset.state).toBe('loading');
        expect(harness.state.textContent).toBe('Узнаём права ключа…');
        expect(harness.refresh.disabled).toBe(true);
        harness.refresh.click();
        await flush();
        expect(harness.keyAccess).toHaveBeenCalledTimes(1);
        answer.resolve(FULL);
        await flush();
        expect(harness.refresh.disabled).toBe(false);
    });

    const DOWN = 'Сервер временно недоступен. Попробуйте позже.';
    test.each([
        ['flib_key_invalid', 'Ключ не найден. Проверьте, что он вставлен целиком.'],
        ['flib_key_revoked', `Ключ отозван. Если это ошибка, напишите нам: ${FLIB_HELP_EMAIL}`],
        ['flib_key_expired', 'Срок ключа истёк. Продлить'],
        ['flib_key_access_unsupported', 'Этот сервер не сообщает права ключа.'],
        ['flib_key_changed', 'Ключ сменился во время запроса. Нажмите «Обновить».'],
        ['flib_service_unavailable', DOWN],
        ['flib_network', DOWN],
        ['flib_timeout', DOWN],
        ['flib_secret_forbidden', 'Не удалось узнать права ключа. Попробуйте ещё раз.'],
        ['flib_rate_limited', 'Не удалось узнать права ключа. Попробуйте ещё раз.'],
        ['constructor', 'Не удалось узнать права ключа. Попробуйте ещё раз.'],
    ])('%s: %s', async (code, expected) => {
        const harness = await setup(flibError(code));
        expect(harness.panel.dataset.state).toBe('error');
        expect(harness.state.textContent).toBe(expected);
        expect(harness.body.childElementCount).toBe(0);
        expect(harness.refresh.disabled).toBe(false);
        if (code !== 'flib_key_invalid') { expect(expected).not.toMatch(/не найден|неверн/); }
    });

    test('ссылки: продлить и почта', async () => {
        const link = (/** @type {Harness} */ {state}) => /** @type {HTMLAnchorElement} */ (state.querySelector('a'));
        const expired = link(await setup(flibError('flib_key_expired')));
        expect([expired.getAttribute('href'), expired.target, expired.rel, expired.textContent]).toStrictEqual([FLIB_BUY_URL, '_blank', 'noopener noreferrer', 'Продлить']);
        const revoked = link(await setup(flibError('flib_key_revoked')));
        expect([revoked.getAttribute('href'), revoked.target, revoked.textContent]).toStrictEqual([`mailto:${FLIB_HELP_EMAIL}`, '', 'help@flib.club']);
        expect((await setup(flibError('flib_key_invalid'))).state.querySelector('a')).toBeNull();
    });

    test('строка состояния меняется, только когда меняется её текст', async () => {
        const harness = await setup(FULL);
        const spy = vi.spyOn(harness.state, 'replaceChildren');
        harness.keyAccess.mockImplementation(() => new Promise(() => {}));
        await harness.changed();
        expect(harness.state.textContent).toBe('Узнаём права ключа…');
        expect(spy).toHaveBeenCalledTimes(1);
        // Вторая загрузка поверх первой, снятые данные другого ключа, перевод страницы на тот же язык.
        harness.store.keyMasked = 'tpk_…cafe';
        await harness.changed();
        await harness.language();
        expect(spy).toHaveBeenCalledTimes(1);
        setUiLanguage('en');
        await harness.language();
        expect(spy).toHaveBeenCalledTimes(2);
        expect(harness.state.textContent).toBe('Reading the key rights…');
    });

    test('снятые при «Обновить» данные другого ключа не объявляют загрузку второй раз', async () => {
        const harness = await setup(FULL);
        const spy = vi.spyOn(harness.state, 'replaceChildren');
        harness.keyAccess.mockImplementation(() => new Promise(() => {}));
        harness.store.keyMasked = 'tpk_…cafe';
        harness.refresh.click();
        await flush();
        expect(harness.body.childElementCount).toBe(0);
        expect(spy).toHaveBeenCalledTimes(1);
    });

    test('страница посылает маску и адрес, которые прочитала', async () => {
        const harness = await setup(FULL, {gatewayUrl: 'https://gw.test'});
        expect(harness.keyAccess.mock.calls).toStrictEqual([[{keyMasked: 'tpk_…beef', gatewayUrl: 'https://gw.test'}]]);
    });

    test('flib_key_missing при заданной маске — «вставьте ключ»', async () => {
        const harness = await setup(flibError('flib_key_missing'));
        expect(harness.panel.dataset.state).toBe('empty');
        expect(harness.state.textContent).toBe('Вставьте ключ, чтобы увидеть права');
    });

    test('сбой не из шлюза: текст ошибки на страницу не попадает', async () => {
        const harness = await setup(new Error('tpk_secret <b>Extension context invalidated</b>'));
        expect(harness.state.textContent).toBe('Не удалось узнать права ключа. Попробуйте ещё раз.');
        expect(harness.panel.innerHTML).not.toContain('tpk_secret');
    });

    test('маска не читается: ошибка без запроса прав, возврат на вкладку пробует снова', async () => {
        const harness = await setup(FULL, {fails: true});
        expect(harness.panel.dataset.state).toBe('error');
        expect(harness.keyAccess).not.toHaveBeenCalled();
        harness.store.fails = false;
        await harness.visibility();
        expect(harness.panel.dataset.state).toBe('ready');
    });

    test('ничего не пишется в журнал', async () => {
        const spies = ['log', 'warn', 'error', 'info', 'debug'].map((name) => vi.spyOn(console, /** @type {'log'} */ (name)));
        await setup(FULL);
        await setup(flibError('flib_key_invalid'));
        await setup(new Error('x'));
        for (const spy of spies) {
            expect(spy).not.toHaveBeenCalled();
            spy.mockRestore();
        }
    });
});

describe('обновление', () => {
    test('прежние данные остаются до ответа', async () => {
        /** @type {ReturnType<typeof defer<KeyAccess>>} */
        const second = defer();
        let count = 0;
        const harness = await setup(() => (++count === 1 ? Promise.resolve(FULL) : second.promise));
        harness.refresh.click();
        await flush();
        expect(harness.panel.dataset.state).toBe('loading');
        expect(harness.state.textContent).toBe('Узнаём права ключа…');
        expect(harness.refresh.disabled).toBe(true);
        expect(usageOf(harness)[0]).toBe('ИИ потрачено 37 %, осталось 63 %');
        second.resolve({...FULL, gpt: {used: 5, limit: 10, unlimited: false}});
        await flush();
        expect(usageOf(harness)[0]).toBe('ИИ потрачено 50 %, осталось 50 %');
        expect(harness.state.textContent).toBe('');
    });

    test.each([
        ['flib_network', 'Сервер временно недоступен. Попробуйте позже. Показаны прежние данные.'],
        ['flib_timeout', 'Сервер временно недоступен. Попробуйте позже. Показаны прежние данные.'],
        ['flib_key_access_unsupported', 'Этот сервер не сообщает права ключа. Показаны прежние данные.'],
        ['flib_rate_limited', 'Не удалось узнать права ключа. Попробуйте ещё раз. Показаны прежние данные.'],
    ])('ошибка %s: данные с подписью', async (code, expected) => {
        let count = 0;
        const harness = await setup(async () => {
            if (++count === 1) { return FULL; }
            throw flibError(code);
        });
        harness.refresh.click();
        await flush();
        expect(harness.panel.dataset.state).toBe('error');
        expect(squash(harness.state.textContent)).toBe(expected);
        expect(usageOf(harness)[0]).toBe('ИИ потрачено 37 %, осталось 63 %');
        expect(squash(harness.summary.textContent)).toContain('tpk_1a2b…');
        expect(harness.refresh.disabled).toBe(false);
    });

    test.each([
        ['flib_key_missing', 'empty', 'Вставьте ключ, чтобы увидеть права'],
        ['flib_key_changed', 'error', 'Ключ сменился во время запроса. Нажмите «Обновить».'],
        ['flib_key_invalid', 'error', 'Ключ не найден. Проверьте, что он вставлен целиком.'],
        ['flib_key_revoked', 'error', `Ключ отозван. Если это ошибка, напишите нам: ${FLIB_HELP_EMAIL}`],
        ['flib_key_expired', 'error', 'Срок ключа истёк. Продлить'],
    ])('%s: прежние данные убраны', async (code, state, expected) => {
        let count = 0;
        const harness = await setup(async () => {
            if (++count === 1) { return FULL; }
            throw flibError(code);
        });
        harness.refresh.click();
        await flush();
        expect(harness.panel.dataset.state).toBe(state);
        expect(harness.state.textContent).toBe(expected);
        expect(harness.body.childElementCount).toBe(0);
        expect(harness.summary.textContent).toBe('');
        // Только flib_key_changed не говорит, чей ключ стоит теперь: возврат перечитает.
        await harness.visibility();
        expect(harness.keyAccess).toHaveBeenCalledTimes(code === 'flib_key_changed' ? 3 : 2);
    });

    test('сбой без маски: чей он, неизвестно — данные убраны, сам по себе запрос не повторяется', async () => {
        let count = 0;
        const harness = await setup(async () => {
            if (++count === 1) { return FULL; }
            throw new Error('worker gone');
        });
        harness.refresh.click();
        await flush();
        expect(harness.state.textContent).toBe('Не удалось узнать права ключа. Попробуйте ещё раз.');
        expect(harness.body.childElementCount).toBe(0);
        await harness.visibility();
        await harness.focus();
        expect(harness.keyAccess).toHaveBeenCalledTimes(2);
    });

    test('маска не прочиталась при «Обновить»: данные убраны', async () => {
        const harness = await setup(FULL);
        harness.store.fails = true;
        harness.refresh.click();
        await flush();
        expect(harness.body.childElementCount).toBe(0);
        expect(harness.keyAccess).toHaveBeenCalledTimes(1);
        harness.store.fails = false;
        await harness.focus();
        expect(harness.panel.dataset.state).toBe('ready');
    });

    test('«Обновить» при сменившемся ключе: прежние данные убраны сразу', async () => {
        /** @type {ReturnType<typeof defer<KeyAccess>>} */
        const second = defer();
        let count = 0;
        const harness = await setup(() => (++count === 1 ? Promise.resolve(FULL) : second.promise));
        harness.store.keyMasked = 'tpk_…cafe';
        harness.refresh.click();
        await flush();
        expect(harness.body.childElementCount).toBe(0);
        expect(harness.summary.textContent).toBe('');
        second.reject(flibError('flib_network'));
        await flush();
        expect(harness.body.childElementCount).toBe(0);
        expect(harness.state.textContent).toBe('Сервер временно недоступен. Попробуйте позже.');
    });

    test('фокус возвращается на кнопку', async () => {
        const harness = await setup(FULL);
        const other = window.document.body.appendChild(window.document.createElement('button'));
        harness.refresh.focus();
        harness.refresh.click();
        // Браузер снимает фокус с погашенной кнопки, jsdom — только с удалённой.
        other.focus();
        other.remove();
        expect(window.document.activeElement).toBe(window.document.body);
        await flush();
        expect(window.document.activeElement).toBe(harness.refresh);
        // Ушедший за время загрузки фокус не отбирается.
        window.document.body.append(other);
        harness.refresh.click();
        other.focus();
        await flush();
        expect(window.document.activeElement).toBe(other);
        // И не возвращается потом, без нового нажатия.
        other.remove();
        await harness.changed();
        expect(window.document.activeElement).toBe(window.document.body);
    });

    test('фокус возвращается и тогда, когда загрузку сменила другая', async () => {
        /** @type {ReturnType<typeof defer<KeyAccess>>[]} */
        const answers = [defer(), defer()];
        let count = 0;
        const harness = await setup(() => (count === 0 ? Promise.resolve(++count).then(() => FULL) : answers[count++ - 1].promise));
        const other = window.document.body.appendChild(window.document.createElement('button'));
        harness.refresh.focus();
        harness.refresh.click();
        other.focus();
        other.remove();
        await flush();
        await harness.changed();
        answers[0].resolve(FULL);
        await flush();
        expect(window.document.activeElement).toBe(window.document.body);
        answers[1].resolve(FULL);
        await flush();
        expect(harness.refresh.disabled).toBe(false);
        expect(window.document.activeElement).toBe(harness.refresh);
    });
});

describe('ответ привязан к ключу, который его получил', () => {
    const A = 'tpk_…beef';
    const B = 'tpk_…bbbb';
    const ACCESS_B = {...FULL, keyPrefix: 'tpk_bbbb'};

    test('R1: ответ получен для B, ключ вернули на A — A запрошен заново', async () => {
        /** @type {ReturnType<typeof defer<KeyAccess>>} */
        const first = defer();
        let count = 0;
        const harness = await setup(() => (++count === 1 ? first.promise : Promise.resolve(FULL)));
        harness.store.keyMasked = B;
        first.resolve(ACCESS_B);
        await flush();
        expect(squash(harness.summary.textContent)).toContain('tpk_bbbb…');
        harness.store.keyMasked = A;
        await harness.visibility();
        expect(harness.keyAccess).toHaveBeenCalledTimes(2);
        expect(squash(harness.summary.textContent)).toContain('tpk_1a2b…');
    });

    test('R1: ключ так и остался B — второго запроса нет', async () => {
        /** @type {ReturnType<typeof defer<KeyAccess>>} */
        const answer = defer();
        const harness = await setup(() => answer.promise);
        harness.store.keyMasked = B;
        answer.resolve(ACCESS_B);
        await flush();
        await harness.visibility();
        await harness.focus();
        expect(harness.keyAccess).toHaveBeenCalledTimes(1);
    });

    test.each([
        ['ключ', {keyMasked: B}],
        ['адрес', {gatewayUrl: 'https://gw.test'}],
    ])('R2: на экране A, за время запроса сменился %s, новый не ответил — строк A нет', async (_name, change) => {
        /** @type {ReturnType<typeof defer<KeyAccess>>} */
        const second = defer();
        let count = 0;
        const harness = await setup(() => (++count === 1 ? Promise.resolve(FULL) : second.promise));
        harness.refresh.click();
        await flush();
        expect(usageOf(harness)).toHaveLength(3);
        Object.assign(harness.store, change);
        second.reject(flibError('flib_network'));
        await flush();
        expect(harness.body.childElementCount).toBe(0);
        expect(harness.summary.textContent).toBe('');
        expect(harness.state.textContent).toBe('Сервер временно недоступен. Попробуйте позже.');
    });

    test('R2b: B истёк, ключ вернули на A — про A «истёк» не сказано', async () => {
        /** @type {ReturnType<typeof defer<KeyAccess>>} */
        const second = defer();
        let count = 0;
        const harness = await setup(() => {
            ++count;
            return count === 2 ? second.promise : Promise.resolve(FULL);
        });
        harness.refresh.click();
        await flush();
        harness.store.keyMasked = B;
        second.reject(flibError('flib_key_expired'));
        await flush();
        expect(harness.state.textContent).toContain('истёк');
        harness.store.keyMasked = A;
        harness.keyAccess.mockImplementationOnce(() => new Promise(() => {}));
        await harness.focus();
        expect(harness.state.textContent).toBe('Узнаём права ключа…');
        expect(harness.body.childElementCount).toBe(0);
    });

    test('ключ сменился за время запроса, а хвост тот же: строки убраны по слову фоновой части', async () => {
        const harness = await setup(FULL);
        harness.keyAccess.mockImplementation(async () => {
            const error = flibError('flib_network');
            error.data = {code: 'flib_network', status: null, keyMasked: A, gatewayUrl: '', changed: true};
            throw error;
        });
        harness.refresh.click();
        await flush();
        expect(harness.body.childElementCount).toBe(0);
    });

    test('успех для другого ключа: строки A не стоят рядом с ответом B', async () => {
        let count = 0;
        const harness = await setup(() => Promise.resolve(++count === 1 ? FULL : ACCESS_B));
        harness.secretsGet.mockImplementationOnce(async () => {
            const view = {hasKey: true, keyMasked: A, gatewayUrl: '', migrationNote: null};
            harness.store.keyMasked = B;
            return view;
        });
        harness.refresh.click();
        await flush();
        expect(squash(harness.summary.textContent)).toContain('tpk_bbbb…');
        harness.store.keyMasked = A;
        await harness.focus();
        expect(harness.keyAccess).toHaveBeenCalledTimes(3);
    });
});

describe('смена ключа', () => {
    test('после записи ключа или адреса: прежние данные убраны, запрос новый', async () => {
        const harness = await setup(FULL);
        harness.keyAccess.mockImplementation(() => new Promise(() => {}));
        await harness.changed();
        expect(harness.panel.dataset.state).toBe('loading');
        expect(harness.body.childElementCount).toBe(0);
        // Маска — только хвост ключа: она может совпасть, запрос всё равно новый.
        expect(harness.keyAccess).toHaveBeenCalledTimes(2);
    });

    test('ключ удалён', async () => {
        const harness = await setup(FULL);
        harness.store.keyMasked = null;
        await harness.changed();
        expect(harness.panel.dataset.state).toBe('empty');
        expect(harness.body.childElementCount).toBe(0);
        expect(harness.keyAccess).toHaveBeenCalledTimes(1);
    });

    test.each([['ответ'], ['ошибка']])('ключ сменился во время запроса: поздний %s старого выброшен', async (kind) => {
        /** @type {ReturnType<typeof defer<KeyAccess>>[]} */
        const answers = [defer(), defer()];
        let count = 0;
        const harness = await setup(() => answers[count++].promise);
        harness.store.keyMasked = 'tpk_…cafe';
        await harness.changed();
        expect(count).toBe(2);
        if (kind === 'ответ') { answers[0].resolve(FULL); }
        answers[0].reject(flibError('flib_key_invalid'));
        await flush();
        expect(harness.panel.dataset.state).toBe('loading');
        expect(harness.refresh.disabled).toBe(true);
        expect(harness.body.childElementCount).toBe(0);
        answers[1].resolve({...FULL, keyPrefix: 'tpk_9999'});
        await flush();
        expect(squash(harness.summary.textContent)).toContain('tpk_9999…');
        expect(harness.refresh.disabled).toBe(false);
    });

    test('новый ответ пришёл раньше старого', async () => {
        /** @type {ReturnType<typeof defer<KeyAccess>>[]} */
        const answers = [defer(), defer()];
        let count = 0;
        const harness = await setup(() => answers[count++].promise);
        await harness.changed();
        answers[1].resolve({...FULL, keyPrefix: 'tpk_9999'});
        await flush();
        answers[0].resolve(FULL);
        await flush();
        expect(squash(harness.summary.textContent)).toContain('tpk_9999…');
        expect(harness.panel.dataset.state).toBe('ready');
    });

    test('ключ удалён во время запроса: поздний ответ выброшен', async () => {
        /** @type {ReturnType<typeof defer<KeyAccess>>} */
        const answer = defer();
        const harness = await setup(() => answer.promise);
        harness.store.keyMasked = null;
        await harness.changed();
        answer.resolve(FULL);
        await flush();
        expect(harness.panel.dataset.state).toBe('empty');
        expect(harness.body.childElementCount).toBe(0);
        expect(harness.refresh.disabled).toBe(false);
    });

    test('запись во время чтения маски: поздняя маска не открывает второй запрос', async () => {
        const harness = await setup(FULL, {keyMasked: null});
        /** @type {ReturnType<typeof defer<unknown>>} */
        const slow = defer();
        harness.secretsGet.mockImplementationOnce(() => slow.promise);
        await harness.changed();
        harness.store.keyMasked = 'tpk_…cafe';
        await harness.changed();
        expect(harness.keyAccess).toHaveBeenCalledTimes(1);
        slow.resolve({hasKey: true, keyMasked: 'tpk_…dead', gatewayUrl: '', migrationNote: null});
        await flush();
        expect(harness.keyAccess).toHaveBeenCalledTimes(1);
        await harness.visibility();
        expect(harness.keyAccess).toHaveBeenCalledTimes(1);
    });
});

describe('возврат на вкладку', () => {
    test('та же маска и тот же адрес — запроса нет', async () => {
        const harness = await setup(FULL);
        await harness.visibility();
        expect(harness.secretsGet).toHaveBeenCalledTimes(2);
        expect(harness.keyAccess).toHaveBeenCalledTimes(1);
        expect(harness.panel.dataset.state).toBe('ready');
    });

    test.each([
        ['маска', {keyMasked: 'tpk_…cafe'}],
        ['адрес', {gatewayUrl: 'https://gw.test'}],
    ])('%s другая — новый запрос, прежние данные убраны', async (_name, change) => {
        const harness = await setup(FULL);
        harness.keyAccess.mockImplementation(() => new Promise(() => {}));
        Object.assign(harness.store, change);
        await harness.visibility();
        expect(harness.keyAccess).toHaveBeenCalledTimes(2);
        expect(harness.body.childElementCount).toBe(0);
        // Теперь известна новая маска: второй возврат не запрашивает снова.
        await harness.visibility();
        expect(harness.keyAccess).toHaveBeenCalledTimes(2);
    });

    test('фокус окна: ключ сменён в соседнем окне или в карточке предпросмотра, вкладка всё время видна', async () => {
        const harness = await setup(FULL);
        await harness.focus();
        await harness.focus();
        expect(harness.secretsGet).toHaveBeenCalledTimes(3);
        expect(harness.keyAccess).toHaveBeenCalledTimes(1);
        harness.store.keyMasked = 'tpk_…cafe';
        await harness.focus();
        expect(harness.keyAccess).toHaveBeenCalledTimes(2);
        await harness.focus();
        expect(harness.keyAccess).toHaveBeenCalledTimes(2);
    });

    test('фокус и видимость вместе дают один запрос', async () => {
        const harness = await setup(FULL);
        harness.store.keyMasked = 'tpk_…cafe';
        Object.defineProperty(window.document, 'visibilityState', {configurable: true, value: 'visible'});
        window.document.dispatchEvent(new window.Event('visibilitychange'));
        window.dispatchEvent(new window.Event('focus'));
        await flush();
        expect(harness.keyAccess).toHaveBeenCalledTimes(2);
    });

    test('фокус во время загрузки её не повторяет', async () => {
        /** @type {ReturnType<typeof defer<KeyAccess>>} */
        const answer = defer();
        const harness = await setup(() => answer.promise);
        await harness.focus();
        answer.resolve(FULL);
        await flush();
        expect(harness.keyAccess).toHaveBeenCalledTimes(1);
        expect(harness.panel.dataset.state).toBe('ready');
    });

    test('ключ появился и пропал', async () => {
        const harness = await setup(FULL, {keyMasked: null});
        harness.store.keyMasked = 'tpk_…beef';
        await harness.visibility();
        expect(harness.panel.dataset.state).toBe('ready');
        harness.store.keyMasked = null;
        await harness.visibility();
        expect(harness.panel.dataset.state).toBe('empty');
        expect(harness.keyAccess).toHaveBeenCalledTimes(1);
    });

    test('уход со вкладки ничего не читает', async () => {
        const harness = await setup(FULL);
        harness.store.keyMasked = 'tpk_…cafe';
        await harness.visibility(false);
        expect(harness.secretsGet).toHaveBeenCalledTimes(1);
    });

    test('сбой чтения маски молчит', async () => {
        const harness = await setup(FULL);
        harness.store.fails = true;
        await harness.visibility();
        expect(harness.panel.dataset.state).toBe('ready');
        expect(harness.state.textContent).toBe('');
    });

    test('маска пришла после новой загрузки — не считается', async () => {
        const harness = await setup(FULL);
        /** @type {ReturnType<typeof defer<unknown>>} */
        const slow = defer();
        harness.secretsGet.mockImplementationOnce(() => slow.promise);
        await harness.visibility();
        harness.store.keyMasked = 'tpk_…cafe';
        await harness.changed();
        slow.resolve({hasKey: true, keyMasked: 'tpk_…beef', gatewayUrl: '', migrationNote: null});
        await flush();
        expect(harness.keyAccess).toHaveBeenCalledTimes(2);
    });
});

describe('страница узнаёт о перемене ключа и адреса от панели', () => {
    const A = {keyMasked: 'tpk_…beef', gatewayUrl: ''};
    const B = {keyMasked: 'tpk_…cafe', gatewayUrl: 'https://gw.test'};

    test('возврат на вкладку и «Обновить»', async () => {
        const harness = await setup(FULL);
        expect(harness.read.at(-1)).toStrictEqual(A);
        Object.assign(harness.store, B);
        await harness.visibility();
        expect(harness.read.at(-1)).toStrictEqual(B);
        Object.assign(harness.store, A);
        harness.refresh.click();
        await flush();
        expect(harness.read.at(-1)).toStrictEqual(A);
    });

    test('ключ удалён в другом окне', async () => {
        const harness = await setup(FULL);
        harness.store.keyMasked = null;
        await harness.focus();
        expect(harness.read.at(-1)).toStrictEqual({keyMasked: null, gatewayUrl: ''});
    });

    test.each([['ответ', FULL], ['ошибка', flibError('flib_key_expired')]])('сменились за время запроса: говорит %s', async (_name, result) => {
        const harness = await setup(FULL);
        harness.keyAccess.mockImplementation(async () => {
            if (!(result instanceof Error)) { return {access: result, ...B, changed: true}; }
            const data = /** @type {Record<string, unknown>} */ (result.data);
            result.data = {...data, ...B, changed: true};
            throw result;
        });
        harness.refresh.click();
        await flush();
        expect(harness.read.at(-1)).toStrictEqual(B);
    });

    test('поздняя маска прежней загрузки — не новость', async () => {
        const harness = await setup(FULL);
        /** @type {ReturnType<typeof defer<unknown>>} */
        const slow = defer();
        harness.secretsGet.mockImplementationOnce(() => slow.promise);
        harness.refresh.click();
        Object.assign(harness.store, B);
        await harness.changed();
        slow.resolve({hasKey: true, ...A, migrationNote: null});
        await flush();
        expect(harness.read.at(-1)).toStrictEqual(B);
    });
});

describe('чужие данные', () => {
    test('разметка из ответа не становится разметкой', async () => {
        const evil = '<img src=x onerror=alert(1)>';
        const access = /** @type {KeyAccess} */ (parseKeyAccess({
            capabilities: [{capability: evil, usable_now: true, valid_from: evil, valid_to: evil}, {capability: 'examples', usable_now: true, permanent: evil, valid_from: evil, valid_to: evil}],
            key_prefix: evil.slice(0, 16),
            key_expires_at: evil,
            demo: evil,
            el_limits: {resets_at: evil, gpt: {used_microusd: evil, limit_microusd: evil}, tts: {used: evil, limit: evil, exempt: evil}, stt: evil},
            examples_quota: {used: evil, limit: evil},
        }));
        const harness = await setup(access);
        expect(harness.panel.innerHTML).not.toContain('onerror');
        expect(harness.panel.querySelector('img')).toBeNull();
        expect(rightsOf(harness)[0]).toBe('✓ Примеры YouTube и «С учётом моих знаний»');
        expect(usageOf(harness)).toStrictEqual(['ИИ нет данных', 'Озвучка нет данных', 'Речь нет данных']);
        expect(squash(harness.summary.textContent)).toBe('Ключ · срок: нет данных');
    });

    test.each([['ru'], ['en']])('«Chad» и «LingQ» не попадают на страницу ни при каком ответе: %s', async (language) => {
        setUiLanguage(/** @type {import('ui-language').UiLanguage} */ (language));
        const ids = ['chad', 'lingq', 'Chad', 'LingQ', 'examples', 'route', 'puzzle_movies', 'chad_pro', 'lingq_raw'];
        for (const usable of [true, false]) {
            for (const validFrom of ['2026-01-01', '2026-12-01']) {
                for (const demo of [true, false]) {
                    for (const keyPrefix of ['tpk_chad', 'Chad LingQ', 'tpk_1a2b']) {
                        const {panel} = await setupWith({rights: ids.map((id) => right(id, {usable, validFrom, permanent: false, validTo: '2026-12-05'})), demo, keyPrefix});
                        expect(panel.outerHTML).not.toMatch(/chad|lingq/i);
                    }
                }
            }
        }
    });

    test('в текстах панели нет этих слов', () => {
        for (const messages of [messagesRu, messagesEn]) {
            for (const [key, message] of Object.entries(messages)) {
                if (!/^settings\.key/.test(key)) { continue; }
                expect(`${key} ${JSON.stringify(message)}`).not.toMatch(/chad|lingq/i);
            }
        }
    });

    test('огромные и дробные числа не ломают вид', async () => {
        const harness = await setupWith({
            gpt: {used: 1e300, limit: Number.MAX_VALUE, unlimited: false},
            tts: {used: 0.5, limit: 10.5, unlimited: false},
            stt: {used: 0.5, limit: 600.5, unlimited: false},
            gptTokens: {input: Number.MAX_VALUE, output: Number.MAX_VALUE},
        });
        expect(usageOf(harness)[1]).toBe('Озвучка 0 из 10 символов, осталось 10');
        expect(harness.panel.textContent).not.toMatch(/NaN|Infinity|∞|undefined|null/);
    });
});
