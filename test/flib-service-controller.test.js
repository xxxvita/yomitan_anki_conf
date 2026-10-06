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

/**
 * @param {string} storedKey
 * @param {string} [storedUrl]
 * @returns {Promise<{input: HTMLInputElement, error: HTMLElement, toggle: HTMLButtonElement, writes: [string, unknown][], listeners: ((details: unknown) => void)[], enter: (value: string) => Promise<void>, urlInput: HTMLInputElement, urlError: HTMLElement, enterUrl: (value: string) => Promise<void>}>}
 */
async function setup(storedKey, storedUrl = '') {
    window.document.body.innerHTML = `
        <input type="password" id="flib-personal-key-input">
        <button type="button" id="flib-personal-key-toggle"></button>
        <div id="flib-personal-key-error" hidden></div>
        <input type="text" id="flib-gateway-url-input">
        <div id="flib-gateway-url-error" hidden></div>
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
        setProfileSetting: async (/** @type {string} */ path, /** @type {unknown} */ value) => { writes.push([path, value]); },
    }));
    const controller = new FlibServiceController(settingsController);
    await controller.prepare();
    const input = /** @type {HTMLInputElement} */ (window.document.querySelector('#flib-personal-key-input'));
    const error = /** @type {HTMLElement} */ (window.document.querySelector('#flib-personal-key-error'));
    const toggle = /** @type {HTMLButtonElement} */ (window.document.querySelector('#flib-personal-key-toggle'));
    /**
     * @param {string} value
     */
    const enter = async (value) => {
        input.value = value;
        input.dispatchEvent(new window.Event('change'));
        await new Promise((resolve) => { setTimeout(resolve, 0); });
    };
    const urlInput = /** @type {HTMLInputElement} */ (window.document.querySelector('#flib-gateway-url-input'));
    const urlError = /** @type {HTMLElement} */ (window.document.querySelector('#flib-gateway-url-error'));
    /**
     * @param {string} value
     */
    const enterUrl = async (value) => {
        urlInput.value = value;
        urlInput.dispatchEvent(new window.Event('change'));
        await new Promise((resolve) => { setTimeout(resolve, 0); });
    };
    return {input, error, toggle, writes, listeners, enter, urlInput, urlError, enterUrl};
}

describe('FlibServiceController', () => {
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
    });
    test('неверный ключ не сохраняется и показывает ошибку', async () => {
        const {input, error, writes, enter} = await setup(FAKE_KEY);
        await enter(`tpk_${'A'.repeat(32)}`);
        expect(writes).toEqual([]);
        expect(error.hidden).toBe(false);
        expect(error.textContent).not.toBe('');
        expect(input.validationMessage).not.toBe('');
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
    test('кнопка показывает и прячет ключ', async () => {
        const {input, toggle} = await setup(FAKE_KEY);
        toggle.click();
        expect(input.type).toBe('text');
        toggle.click();
        expect(input.type).toBe('password');
    });
    test('смена профиля обновляет поле и снимает ошибку', async () => {
        const {input, error, listeners, enter} = await setup('');
        await enter('bad');
        for (const listener of listeners) {
            listener({options: {flibService: {gatewayUrl: '', personalKey: FAKE_KEY}}});
        }
        expect(input.value).toBe(FAKE_KEY);
        expect(error.hidden).toBe(true);
    });
    test('показывает сохранённый адрес сервера', async () => {
        const {urlInput} = await setup('', 'wss://gw.example.org');
        expect(urlInput.value).toBe('wss://gw.example.org');
    });
    test('верный адрес сохраняется срезанным', async () => {
        const {urlInput, urlError, writes, enterUrl} = await setup('');
        await enterUrl('  https://gw.example.org/ ');
        expect(writes).toEqual([['flibService.gatewayUrl', 'https://gw.example.org/']]);
        expect(urlInput.value).toBe('https://gw.example.org/');
        expect(urlError.hidden).toBe(true);
    });
    test('пустой адрес сохраняется (= по умолчанию)', async () => {
        const {writes, enterUrl} = await setup('', 'https://old.example.org');
        await enterUrl('');
        expect(writes).toEqual([['flibService.gatewayUrl', '']]);
    });
    test('неверный адрес не сохраняется и показывает ошибку', async () => {
        const {urlInput, urlError, writes, enterUrl} = await setup('');
        await enterUrl('ftp://gw.example.org');
        expect(writes).toEqual([]);
        expect(urlError.hidden).toBe(false);
        expect(urlInput.validationMessage).not.toBe('');
    });
    test('ошибка ключа и ошибка адреса независимы', async () => {
        const {error, urlError, enter, enterUrl} = await setup('');
        await enter('bad');
        await enterUrl('https://gw.example.org');
        expect(error.hidden).toBe(false);
        expect(urlError.hidden).toBe(true);
    });
});
