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

import {afterAll, describe, expect, test} from 'vitest';
import {setupDomTest} from './fixtures/dom-test.js';
import {FlibServiceController} from '../ext/js/pages/settings/flib-service-controller.js';

const env = await setupDomTest();
const {window, teardown} = env;
afterAll(() => teardown(global));

const FAKE_KEY = `tpk_${'0'.repeat(32)}`;
const OTHER_KEY = `tpk_${'1'.repeat(32)}`;
const DEBOUNCE_MS = 5;

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * @typedef {object} Harness
 * @property {HTMLInputElement} input
 * @property {HTMLElement} error
 * @property {HTMLButtonElement} toggle
 * @property {HTMLInputElement} urlInput
 * @property {HTMLElement} urlError
 * @property {HTMLElement} urlWarning
 * @property {[string, unknown][]} writes
 * @property {(options: unknown) => void} emitOptionsChanged
 * @property {(value: string) => Promise<void>} enter Ввод ключа + change.
 * @property {(value: string) => Promise<void>} type Ввод ключа без change (событие input).
 * @property {(value: string) => Promise<void>} enterUrl Ввод адреса + change.
 */

/**
 * @param {string} storedKey
 * @param {{storedUrl?: string, save?: (path: string, value: unknown) => Promise<unknown>}} [details]
 * @returns {Promise<Harness>}
 */
async function setup(storedKey, {storedUrl = '', save} = {}) {
    window.document.body.innerHTML = `
        <input type="password" id="flib-personal-key-input">
        <button type="button" id="flib-personal-key-toggle">Показать</button>
        <div id="flib-personal-key-error" hidden></div>
        <input type="text" id="flib-gateway-url-input">
        <div id="flib-gateway-url-error" hidden></div>
        <div id="flib-gateway-url-warning" hidden></div>
    `;
    /** @type {[string, unknown][]} */
    const writes = [];
    /** @type {((details: unknown) => void)[]} */
    const listeners = [];
    const options = {flibService: {gatewayUrl: storedUrl, personalKey: storedKey}};
    const settingsController = /** @type {import('../ext/js/pages/settings/settings-controller.js').SettingsController} */ (/** @type {unknown} */ ({
        getOptions: async () => options,
        getOptionsContext: () => ({index: 0}),
        on: (/** @type {string} */ name, /** @type {(details: unknown) => void} */ callback) => {
            if (name === 'optionsChanged') { listeners.push(callback); }
        },
        setProfileSetting: async (/** @type {string} */ path, /** @type {unknown} */ value) => {
            writes.push([path, value]);
            return typeof save === 'function' ? await save(path, value) : [{result: value}];
        },
    }));
    const controller = new FlibServiceController(settingsController, {inputDebounceMs: DEBOUNCE_MS});
    await controller.prepare();
    const $ = (/** @type {string} */ selector) => /** @type {HTMLElement} */ (window.document.querySelector(selector));
    const input = /** @type {HTMLInputElement} */ ($('#flib-personal-key-input'));
    const urlInput = /** @type {HTMLInputElement} */ ($('#flib-gateway-url-input'));
    /**
     * @param {HTMLInputElement} element
     * @param {string} value
     * @param {string} eventName
     */
    const fire = async (element, value, eventName) => {
        element.value = value;
        element.dispatchEvent(new window.Event(eventName));
        await wait(0);
    };
    return {
        input,
        error: $('#flib-personal-key-error'),
        toggle: /** @type {HTMLButtonElement} */ ($('#flib-personal-key-toggle')),
        urlInput,
        urlError: $('#flib-gateway-url-error'),
        urlWarning: $('#flib-gateway-url-warning'),
        writes,
        emitOptionsChanged: (value) => {
            for (const listener of listeners) { listener({options: value}); }
        },
        enter: (value) => fire(input, value, 'change'),
        type: (value) => fire(input, value, 'input'),
        enterUrl: (value) => fire(urlInput, value, 'change'),
    };
}

describe('FlibServiceController: ключ', () => {
    test('показывает сохранённый ключ', async () => {
        const {input} = await setup(FAKE_KEY);
        expect(input.value).toBe(FAKE_KEY);
    });
    test('верный ключ с пробелами сохраняется срезанным', async () => {
        const {input, error, writes, enter} = await setup('');
        await enter(`  ${FAKE_KEY} `);
        expect(writes).toEqual([['flibService.personalKey', FAKE_KEY]]);
        expect(input.value).toBe(FAKE_KEY);
        expect(error.hidden).toBe(true);
        expect(input.validationMessage).toBe('');
        expect(input.getAttribute('aria-invalid')).toBe('false');
    });
    test('неверный ключ не сохраняется и показывает ошибку', async () => {
        const {input, error, writes, enter} = await setup(FAKE_KEY);
        await enter(`tpk_${'A'.repeat(32)}`);
        expect(writes).toEqual([]);
        expect(error.hidden).toBe(false);
        expect(error.textContent).not.toBe('');
        expect(input.validationMessage).not.toBe('');
        expect(input.getAttribute('aria-invalid')).toBe('true');
    });
    test('после неверного верный ввод снимает ошибку', async () => {
        const {input, error, writes, enter} = await setup('');
        await enter('tpk_bad');
        await enter(FAKE_KEY);
        expect(writes).toEqual([['flibService.personalKey', FAKE_KEY]]);
        expect(error.hidden).toBe(true);
        expect(input.validationMessage).toBe('');
    });
    test('пустой ввод снимает ключ', async () => {
        const {writes, enter} = await setup(FAKE_KEY);
        await enter('   ');
        expect(writes).toEqual([['flibService.personalKey', '']]);
    });
    test('кнопка показывает и прячет ключ одним сигналом — текстом', async () => {
        const {input, toggle} = await setup(FAKE_KEY);
        toggle.click();
        expect(input.type).toBe('text');
        expect(toggle.textContent).toBe('Скрыть');
        toggle.click();
        expect(input.type).toBe('password');
        expect(toggle.textContent).toBe('Показать');
        expect(toggle.hasAttribute('aria-pressed')).toBe(false);
    });
    test('смена профиля обновляет поле и снимает ошибку', async () => {
        const {input, error, emitOptionsChanged, enter} = await setup('');
        await enter('bad');
        emitOptionsChanged({flibService: {gatewayUrl: '', personalKey: FAKE_KEY}});
        expect(input.value).toBe(FAKE_KEY);
        expect(error.hidden).toBe(true);
    });
    test('LOW-2: постороннее optionsChanged не затирает неверный ввод и его ошибку', async () => {
        const {input, error, emitOptionsChanged, enter} = await setup(FAKE_KEY);
        await enter('tpk_bad');
        emitOptionsChanged({flibService: {gatewayUrl: '', personalKey: FAKE_KEY}});
        expect(input.value).toBe('tpk_bad');
        expect(error.hidden).toBe(false);
    });
    test('LOW-3: верный ключ сохраняется по вводу, без change, после паузы', async () => {
        const {input, writes, type} = await setup('');
        await type(` ${FAKE_KEY}`);
        expect(writes).toEqual([]);
        await wait(DEBOUNCE_MS * 4);
        expect(writes).toEqual([['flibService.personalKey', FAKE_KEY]]);
        // Поле во время набора не переписывается.
        expect(input.value).toBe(` ${FAKE_KEY}`);
    });
    test('LOW-3: неверный ввод по input не сохраняется и не кричит до change', async () => {
        const {error, writes, type} = await setup('');
        await type('tpk_0');
        await wait(DEBOUNCE_MS * 4);
        expect(writes).toEqual([]);
        expect(error.hidden).toBe(true);
    });
    test('LOW-3: input и сразу change — одна запись, не две', async () => {
        const {writes, type, enter} = await setup('');
        await type(FAKE_KEY);
        await enter(FAKE_KEY);
        await wait(DEBOUNCE_MS * 4);
        expect(writes).toEqual([['flibService.personalKey', FAKE_KEY]]);
    });
    test('LOW-3: ошибка сохранения (в результате) показывается', async () => {
        const {error, enter} = await setup('', {save: async () => [{error: {message: 'quota'}}]});
        await enter(OTHER_KEY);
        expect(error.hidden).toBe(false);
        expect(error.textContent).toContain('quota');
    });
    test('LOW-3: ошибка сохранения (исключение) показывается', async () => {
        const {error, enter} = await setup('', {save: async () => { throw new Error('boom'); }});
        await enter(OTHER_KEY);
        expect(error.hidden).toBe(false);
        expect(error.textContent).toContain('boom');
    });
});

describe('FlibServiceController: адрес сервера', () => {
    test('показывает сохранённый адрес сервера', async () => {
        const {urlInput} = await setup('', {storedUrl: 'wss://gw.flib.club'});
        expect(urlInput.value).toBe('wss://gw.flib.club');
    });
    test('верный адрес сохраняется срезанным', async () => {
        const {urlInput, urlError, writes, enterUrl} = await setup('');
        await enterUrl('  https://gw.flib.club/ ');
        expect(writes).toEqual([['flibService.gatewayUrl', 'https://gw.flib.club/']]);
        expect(urlInput.value).toBe('https://gw.flib.club/');
        expect(urlError.hidden).toBe(true);
    });
    test('пустой адрес сохраняется (= по умолчанию)', async () => {
        const {writes, enterUrl} = await setup('', {storedUrl: 'https://gw.flib.club'});
        await enterUrl('');
        expect(writes).toEqual([['flibService.gatewayUrl', '']]);
    });
    test('неверный адрес не сохраняется и показывает ошибку', async () => {
        const {urlInput, urlError, writes, enterUrl} = await setup('');
        await enterUrl('ftp://gw.flib.club');
        await enterUrl('http://gw.flib.club');
        expect(writes).toEqual([]);
        expect(urlError.hidden).toBe(false);
        expect(urlInput.validationMessage).not.toBe('');
    });
    test('ошибка ключа и ошибка адреса независимы', async () => {
        const {error, urlError, enter, enterUrl} = await setup('');
        await enter('bad');
        await enterUrl('https://gw.flib.club');
        expect(error.hidden).toBe(false);
        expect(urlError.hidden).toBe(true);
    });
    test('H3: чужой хост сохраняется, но с видимым предупреждением', async () => {
        const {urlWarning, writes, enterUrl} = await setup('');
        await enterUrl('https://evil.example');
        expect(writes).toEqual([['flibService.gatewayUrl', 'https://evil.example']]);
        expect(urlWarning.hidden).toBe(false);
        expect(urlWarning.textContent).not.toBe('');
    });
    test('H3: flib.club, localhost и пусто — без предупреждения', async () => {
        const {urlWarning, enterUrl} = await setup('', {storedUrl: 'https://evil.example'});
        expect(urlWarning.hidden).toBe(false);
        for (const value of ['https://cache.flib.club', 'http://localhost:8080', '']) {
            await enterUrl(value);
            expect(urlWarning.hidden).toBe(true);
        }
    });
});
