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

const FAKE_KEY = `tpk_${'0'.repeat(28)}beef`;
const OTHER_KEY = `tpk_${'1'.repeat(32)}`;
const DEBOUNCE_MS = 5;

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const wait = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/**
 * @param {string} key
 * @returns {?string}
 */
const mask = (key) => (key === '' ? null : `tpk_…${key.slice(-4)}`);

/**
 * @typedef {object} Harness
 * @property {HTMLInputElement} input
 * @property {HTMLElement} error
 * @property {HTMLElement} status
 * @property {HTMLButtonElement} clear
 * @property {HTMLButtonElement} toggle
 * @property {HTMLInputElement} urlInput
 * @property {HTMLElement} urlError
 * @property {HTMLElement} urlWarning
 * @property {import('api').ApiParams<'flibSecretsSet'>[]} writes Вызовы flibSecretsSet.
 * @property {(value: string) => Promise<void>} enter Ввод ключа + change.
 * @property {(value: string) => Promise<void>} type Ввод ключа без change (событие input).
 * @property {(value: string) => Promise<void>} enterUrl Ввод адреса + change.
 * @property {(value: string) => Promise<void>} typeUrl Ввод адреса без change.
 */

/**
 * Поддельный бэкенд: хранит ключ и отдаёт ТОЛЬКО маску, как flibSecretsGet.
 * @param {string} storedKey
 * @param {{storedUrl?: string, save?: (params: import('api').ApiParams<'flibSecretsSet'>) => Promise<void>, getFails?: boolean, note?: ?string}} [details]
 * @returns {Promise<Harness>}
 */
async function setup(storedKey, {storedUrl = '', save, getFails = false, note = null} = {}) {
    window.document.body.innerHTML = `
        <input type="password" id="flib-personal-key-input">
        <button type="button" id="flib-personal-key-toggle">Показать</button>
        <button type="button" id="flib-personal-key-clear" hidden>Удалить ключ</button>
        <div id="flib-personal-key-status"></div>
        <div id="flib-personal-key-error" hidden></div>
        <input type="text" id="flib-gateway-url-input">
        <div id="flib-gateway-url-error" hidden></div>
        <div id="flib-gateway-url-warning" hidden></div>
        <div id="flib-migration-note" hidden><span id="flib-migration-note-text"></span><button type="button" id="flib-migration-note-dismiss">Скрыть</button></div>
    `;
    /** @type {import('api').ApiParams<'flibSecretsSet'>[]} */
    const writes = [];
    /** @type {{key: string, url: string, note: ?string}} */
    const state = {key: storedKey, url: storedUrl, note};
    const view = () => ({hasKey: state.key !== '', keyMasked: mask(state.key), gatewayUrl: state.url, migrationNote: state.note});
    const api = {
        flibSecretsGet: async () => {
            if (getFails) { throw new Error('backend gone'); }
            return view();
        },
        flibSecretsSet: async (/** @type {import('api').ApiParams<'flibSecretsSet'>} */ params) => {
            writes.push(params);
            if (typeof save === 'function') { await save(params); }
            if (typeof params.personalKey === 'string') {
                state.key = params.personalKey;
                state.note = null;
            }
            if (params.dismissMigrationNote === true) { state.note = null; }
            if (typeof params.gatewayUrl === 'string') { state.url = params.gatewayUrl; }
            return view();
        },
    };
    const settingsController = /** @type {import('../ext/js/pages/settings/settings-controller.js').SettingsController} */ (/** @type {unknown} */ ({
        application: {api},
        // Профили больше ни при чём: если контроллер их тронет — тест упадёт.
        get profileIndex() { throw new Error('profileIndex must not be read'); },
        setProfileSetting: () => { throw new Error('setProfileSetting must not be used'); },
        on: () => { throw new Error('optionsChanged must not be used'); },
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
        status: $('#flib-personal-key-status'),
        clear: /** @type {HTMLButtonElement} */ ($('#flib-personal-key-clear')),
        toggle: /** @type {HTMLButtonElement} */ ($('#flib-personal-key-toggle')),
        urlInput,
        urlError: $('#flib-gateway-url-error'),
        urlWarning: $('#flib-gateway-url-warning'),
        writes,
        enter: (value) => fire(input, value, 'change'),
        type: (value) => fire(input, value, 'input'),
        enterUrl: (value) => fire(urlInput, value, 'change'),
        typeUrl: (value) => fire(urlInput, value, 'input'),
    };
}

describe('FlibServiceController: ключ (C1 — через flibSecretsGet/Set, только маска)', () => {
    test('сохранённый ключ показан маской, поле пустое, есть «Удалить ключ»', async () => {
        const {input, status, clear} = await setup(FAKE_KEY);
        expect(input.value).toBe('');
        expect(status.textContent).toContain('tpk_…beef');
        expect(status.textContent).not.toContain(FAKE_KEY);
        expect(clear.hidden).toBe(false);
    });
    test('ключа нет — «не задан», кнопки удаления нет', async () => {
        const {status, clear} = await setup('');
        expect(status.textContent).toContain('не задан');
        expect(clear.hidden).toBe(true);
    });
    test('верный ключ с пробелами сохраняется срезанным; поле очищается, маска обновляется', async () => {
        const {input, error, status, clear, writes, enter} = await setup('');
        await enter(`  ${FAKE_KEY} `);
        expect(writes).toEqual([{personalKey: FAKE_KEY}]);
        expect(input.value).toBe('');
        expect(status.textContent).toContain('tpk_…beef');
        expect(clear.hidden).toBe(false);
        expect(error.hidden).toBe(true);
        expect(input.getAttribute('aria-invalid')).toBe('false');
    });
    test('неверный ключ не сохраняется и показывает ошибку', async () => {
        const {input, error, writes, enter} = await setup(FAKE_KEY);
        await enter(`tpk_${'A'.repeat(32)}`);
        expect(writes).toEqual([]);
        expect(error.hidden).toBe(false);
        expect(input.validationMessage).not.toBe('');
        expect(input.getAttribute('aria-invalid')).toBe('true');
    });
    test('после неверного верный ввод снимает ошибку', async () => {
        const {error, writes, enter} = await setup('');
        await enter('tpk_bad');
        await enter(FAKE_KEY);
        expect(writes).toEqual([{personalKey: FAKE_KEY}]);
        expect(error.hidden).toBe(true);
    });
    test('пустой ввод НЕ стирает ключ (поле пустое всегда); стирает только кнопка', async () => {
        const {writes, enter, clear, status} = await setup(FAKE_KEY);
        await enter('   ');
        expect(writes).toEqual([]);
        clear.click();
        await wait(0);
        expect(writes).toEqual([{personalKey: ''}]);
        expect(status.textContent).toContain('не задан');
        expect(clear.hidden).toBe(true);
    });
    test('кнопка показывает и прячет набранный ключ одним сигналом — текстом', async () => {
        const {input, toggle} = await setup(FAKE_KEY);
        toggle.click();
        expect(input.type).toBe('text');
        expect(toggle.textContent).toBe('Скрыть');
        toggle.click();
        expect(input.type).toBe('password');
        expect(toggle.textContent).toBe('Показать');
        expect(toggle.hasAttribute('aria-pressed')).toBe(false);
    });
    test('верный ключ сохраняется по вводу, без change, после паузы', async () => {
        const {writes, type} = await setup('');
        await type(` ${FAKE_KEY}`);
        expect(writes).toEqual([]);
        await wait(DEBOUNCE_MS * 4);
        expect(writes).toEqual([{personalKey: FAKE_KEY}]);
    });
    test('неверный ввод по input не сохраняется и не кричит до change', async () => {
        const {error, writes, type} = await setup('');
        await type('tpk_0');
        await wait(DEBOUNCE_MS * 4);
        expect(writes).toEqual([]);
        expect(error.hidden).toBe(true);
    });
    test('input и сразу change — одна запись, не две', async () => {
        const {writes, type, enter} = await setup('');
        await type(FAKE_KEY);
        await enter(FAKE_KEY);
        await wait(DEBOUNCE_MS * 4);
        expect(writes).toEqual([{personalKey: FAKE_KEY}]);
    });
    test('change во время ещё идущей записи того же ключа — вторая запись не уходит', async () => {
        /** @type {() => void} */
        let release = () => {};
        const {writes, type, enter} = await setup('', {save: () => new Promise((resolve) => { release = resolve; })});
        await type(FAKE_KEY);
        await wait(DEBOUNCE_MS * 4);
        await enter(FAKE_KEY);
        release();
        await wait(0);
        expect(writes).toEqual([{personalKey: FAKE_KEY}]);
    });
    test('ошибка сохранения показывается, введённое остаётся в поле', async () => {
        const {error, input, enter} = await setup('', {save: async () => { throw new Error('boom'); }});
        await enter(OTHER_KEY);
        expect(error.hidden).toBe(false);
        expect(error.textContent).toContain('boom');
        expect(input.value).toBe(OTHER_KEY);
    });
    test('бэкенд не ответил при открытии — ошибка видна, prepare не падает', async () => {
        const {error} = await setup('', {getFails: true});
        expect(error.hidden).toBe(false);
        expect(error.textContent).toContain('backend gone');
    });
});

describe('FlibServiceController: адрес сервера', () => {
    test('показывает сохранённый адрес сервера', async () => {
        const {urlInput} = await setup('', {storedUrl: 'wss://gw.flib.club'});
        expect(urlInput.value).toBe('wss://gw.flib.club');
    });
    test('верный адрес сохраняется срезанным, только адрес', async () => {
        const {urlInput, urlError, writes, enterUrl} = await setup('');
        await enterUrl('  https://gw.flib.club/ ');
        expect(writes).toEqual([{gatewayUrl: 'https://gw.flib.club/'}]);
        expect(urlInput.value).toBe('https://gw.flib.club/');
        expect(urlError.hidden).toBe(true);
    });
    test('пустой адрес сохраняется (= по умолчанию)', async () => {
        const {writes, enterUrl} = await setup('', {storedUrl: 'https://gw.flib.club'});
        await enterUrl('');
        expect(writes).toEqual([{gatewayUrl: ''}]);
    });
    test('тот же адрес повторно не пишется (сохранение только по изменению)', async () => {
        const {writes, enterUrl} = await setup('', {storedUrl: 'https://gw.flib.club'});
        await enterUrl(' https://gw.flib.club ');
        expect(writes).toEqual([]);
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
        expect(writes).toEqual([{gatewayUrl: 'https://evil.example'}]);
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
    test('NEW-2: адрес по вводу НЕ сохраняется, только по change', async () => {
        const {writes, typeUrl, enterUrl} = await setup('');
        await typeUrl('https://cache');
        await wait(DEBOUNCE_MS * 4);
        expect(writes).toEqual([]);
        await enterUrl('https://cache.flib.club');
        expect(writes).toEqual([{gatewayUrl: 'https://cache.flib.club'}]);
    });
    test('набираемый адрес не затирается ответом на запись ключа (аудит LOW)', async () => {
        const {urlInput, enter} = await setup('', {storedUrl: 'https://cache.flib.club'});
        urlInput.focus();
        urlInput.value = 'https://my.flib.club';
        await enter(FAKE_KEY);
        expect(urlInput.value).toBe('https://my.flib.club');
    });
    test('ошибка сохранения адреса показывается', async () => {
        const {urlError, enterUrl} = await setup('', {save: async () => { throw new Error('flib_url_invalid'); }});
        await enterUrl('https://cache.flib.club');
        expect(urlError.hidden).toBe(false);
        expect(urlError.textContent).toContain('flib_url_invalid');
    });
});

describe('FlibServiceController: заметка миграции (ключи профилей не перенесены)', () => {
    const NOTE = 'Ключ из профилей 2, 3 не перенесён: теперь ключ один на все профили';
    const $ = (/** @type {string} */ selector) => /** @type {HTMLElement} */ (window.document.querySelector(selector));

    test('нет заметки — блок скрыт', async () => {
        await setup(FAKE_KEY);
        expect($('#flib-migration-note').hidden).toBe(true);
    });
    test('заметка видна; «Скрыть» убирает её через flibSecretsSet', async () => {
        const {writes} = await setup(FAKE_KEY, {note: NOTE});
        expect($('#flib-migration-note').hidden).toBe(false);
        expect($('#flib-migration-note-text').textContent).toBe(NOTE);
        $('#flib-migration-note-dismiss').click();
        await wait(0);
        expect(writes).toEqual([{dismissMigrationNote: true}]);
        expect($('#flib-migration-note').hidden).toBe(true);
    });
    test('новый ключ снимает заметку', async () => {
        const {enter} = await setup(FAKE_KEY, {note: NOTE});
        await enter(OTHER_KEY);
        expect($('#flib-migration-note').hidden).toBe(true);
    });
});
