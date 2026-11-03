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

/* eslint-disable no-underscore-dangle */

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {EventDispatcher} from '../ext/js/core/event-dispatcher.js';
import {DisplayTranslation} from '../ext/js/display/display-translation.js';
import {setupDomTest} from './fixtures/dom-test.js';

vi.stubGlobal('chrome', {storage: {local: {get: () => Promise.resolve({}), set: () => Promise.resolve()}, onChanged: {addListener: () => {}}}});

/**
 * @param {string[]} installed
 * @param {{mode?: string, contentType?: string}} [options]
 * @returns {DisplayTranslation}
 */
function make(installed, {mode = 'group', contentType = 'terms'} = {}) {
    const display = Object.assign(new EventDispatcher(), {
        contentType,
        getOptions: () => ({general: {resultOutputMode: mode}, flibTranslation: {translationDictionary: 'ru', hostDictionary: 'en', buttonLabel: 'Перевод'}}),
        application: {api: {getDictionaryInfo: () => Promise.resolve(installed.map((title) => ({title, revision: 'r'})))}},
    });
    return new DisplayTranslation(/** @type {*} */ (display));
}

describe('DisplayTranslation — нет русского словаря', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => {
        env = await setupDomTest();
        const entries = document.createElement('div');
        entries.id = 'dictionary-entries';
        document.body.appendChild(entries);
    });
    afterEach(async () => { await env.teardown(global); });

    test('английский есть, русского нет — «missing»; есть оба или нет английского — нет', async () => {
        expect(await make(['en'])._isTranslationMissing()).toBe(true);
        expect(await make(['en', 'ru'])._isTranslationMissing()).toBe(false);
        expect(await make([])._isTranslationMissing()).toBe(false);
        expect(await make(['en'], {mode: 'split'})._isTranslationMissing()).toBe(false);
        expect(await make(['en'], {contentType: 'kanji'})._isTranslationMissing()).toBe(false);
    });

    test('переключатель «Перевод ⚠» недоступен; щелчок раскрывает и скрывает подсказку; «Не сейчас» закрывает', () => {
        const translation = make(['en']);
        translation._setMissingState(true);
        const button = /** @type {HTMLButtonElement} */ (document.querySelector('.fc-switch-missing'));
        expect(button.getAttribute('aria-disabled')).toBe('true');
        expect(button.textContent).toBe('Перевод');
        button.click();
        expect(document.querySelector('.fc-noru')).not.toBeNull();
        expect(button.getAttribute('aria-expanded')).toBe('true');
        const install = /** @type {HTMLAnchorElement} */ (document.querySelector('.fc-noru a'));
        expect(install.getAttribute('href')).toBe('/settings.html#flib-dictionaries-provisioning');
        /** @type {HTMLButtonElement} */ (document.querySelector('.fc-noru button')).click();
        expect(document.querySelector('.fc-noru')).toBeNull();
        button.click();
        button.click();
        expect(document.querySelector('.fc-noru')).toBeNull();
    });

    test('словарь поставили — переключатель и подсказка уходят, повторный показ не плодит кнопки', () => {
        const translation = make(['en']);
        translation._setMissingState(true);
        /** @type {HTMLButtonElement} */ (document.querySelector('.fc-switch-missing')).click();
        translation._setMissingState(false);
        expect(/** @type {HTMLElement} */ (document.querySelector('.fc-switch-missing')).hidden).toBe(true);
        expect(document.querySelector('.fc-noru')).toBeNull();
        translation._setMissingState(true);
        expect(document.querySelectorAll('.fc-switch-missing')).toHaveLength(1);
    });
});

/* eslint-enable no-underscore-dangle */
