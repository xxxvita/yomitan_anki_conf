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

/* eslint-disable no-underscore-dangle -- the click scanner is configured through Display's private seams */
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {Display} from '../ext/js/display/display.js';
import {TextScanner} from '../ext/js/language/text-scanner.js';
import {setupDomTest} from './fixtures/dom-test.js';

/**
 * Клик по слову в карточке ищет ТАК ЖЕ, как Shift-наведение: от начала слова
 * (scanResolution из настроек) и по всей статье, кроме интерактивного.
 */
describe('клик по слову в карточке — тот же алгоритм, что у Shift', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => { env = await setupDomTest(); });
    afterEach(async () => {
        vi.restoreAllMocks();
        await env.teardown(global);
    });

    /** @returns {{display: Display, setOptions: import('vitest').MockInstance}} */
    const setup = () => {
        const setOptions = vi.spyOn(TextScanner.prototype, 'setOptions').mockImplementation(() => {});
        vi.spyOn(TextScanner.prototype, 'prepare').mockImplementation(() => {});
        vi.spyOn(TextScanner.prototype, 'setEnabled').mockImplementation(() => {});
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
        const display = /** @type {Display} */ (Object.create(Display.prototype));
        /** @type {*} */ (display)._contentTextScanner = null;
        /** @type {*} */ (display)._pageType = 'popup';
        /** @type {*} */ (display)._application = {api: {}};
        /** @type {*} */ (display)._textSourceGenerator = {};
        return {display, setOptions};
    };
    const options = /** @type {import('settings').ProfileOptions} */ (/** @type {unknown} */ ({
        general: {language: 'en'},
        scanning: {enablePopupSearch: true, enableOnSearchPage: true, deepDomScan: false, normalizeCssZoom: true, delay: 20, length: 34, layoutAwareScan: false, scanResolution: 'word'},
        sentenceParsing: {},
    }));

    test('scanResolution и длина — из настроек, как у сканера страницы', () => {
        const {display, setOptions} = setup();
        display._updateContentTextScanner(options);
        const passed = /** @type {import('text-scanner').Options} */ (/** @type {unknown[]} */ (setOptions.mock.calls[0])[0]);
        expect(passed.scanResolution).toBe('word');
        expect(passed.scanLength).toBe(34);
    });

    test('ищется вся статья; кнопки, ссылки, раскрывашки, теги, словоформы и перевод — нет', () => {
        const {display} = setup();
        display._updateContentTextScanner(options);
        const scanner = /** @type {TextScanner} */ (/** @type {{_contentTextScanner: unknown}} */ (/** @type {unknown} */ (display))._contentTextScanner);
        document.body.innerHTML = `<div class="entry">
            <span class="headword-term">google</span>
            <ol><li class="gloss-item click-scannable"><span id="gloss">To search</span>
              <details><summary id="sum">Grammar</summary><p id="grammar">google is a verb</p></details>
              <a class="gloss-link" id="link">engine</a></li></ol>
            <button id="btn">Примеры</button>
            <span class="tag-label" id="tag">vt</span>
            <span class="inflection" data-reason="past" id="infl">past</span>
            <div class="scan-disable"><span id="ru">искать</span></div>
        </div>`;
        /**
         * @param {string} selector
         * @returns {boolean}
         */
        const scannable = (selector) => {
            const el = /** @type {Element} */ (document.querySelector(selector));
            return el.matches(scanner.includeSelector ?? '*') && !el.matches(scanner.excludeSelector ?? ':not(*)');
        };
        expect(scannable('#gloss')).toBe(true);
        expect(scannable('#grammar')).toBe(true);
        expect(scannable('.headword-term')).toBe(true);
        expect(scannable('#sum')).toBe(false);
        expect(scannable('#link')).toBe(false);
        expect(scannable('#btn')).toBe(false);
        expect(scannable('#tag')).toBe(false);
        expect(scannable('#infl')).toBe(false);
        expect(scannable('#ru')).toBe(false);
    });
});
/* eslint-enable no-underscore-dangle */
