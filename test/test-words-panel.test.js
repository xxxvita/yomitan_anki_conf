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

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {TestWordsController} from '../ext/js/display/test-words-panel.js';
import {setupDomTest} from './fixtures/dom-test.js';

/** @returns {Promise<void>} */
const flush = async () => {
    for (let i = 0; i < 5; ++i) {
        await new Promise((resolve) => { setTimeout(resolve, 0); });
    }
};

/**
 * @param {{newWords: string[], entries?: {word: string, lemma: string, forms: string[], kind: string}[], source?: string}} result
 * @param {(word: string) => Promise<unknown>} [addKnown]
 * @returns {{controller: TestWordsController, host: HTMLElement, api: {lexiconAnalyzeText: import('vitest').Mock, lexiconAddKnownWord: import('vitest').Mock, lexiconRemoveKnownWord: import('vitest').Mock}}}
 */
function setup(result, addKnown) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const api = {
        lexiconAnalyzeText: vi.fn().mockResolvedValue({source: 'lemma', entries: [], ...result}),
        lexiconAddKnownWord: vi.fn(addKnown ?? (async () => ({}))),
        lexiconRemoveKnownWord: vi.fn().mockResolvedValue({}),
    };
    const display = /** @type {import('../ext/js/display/display.js').Display} */ (/** @type {unknown} */ ({application: {api}}));
    const controller = new TestWordsController({display, hostElement: host, getTextSource: () => 'I googled the engine twice.', triggerLabel: 'Проверить текст', sourceLabel: 'Фраза'});
    controller.render();
    return {controller, host, api};
}

/**
 * @param {HTMLElement} host
 * @returns {Promise<HTMLElement>} The dialog.
 */
async function openDialog(host) {
    /** @type {HTMLButtonElement} */ (host.querySelector('.test-words-trigger')).click();
    await flush();
    /** @type {HTMLButtonElement} */ (host.querySelector('.test-words-count')).click();
    const dialog = document.querySelector('.fc-cw');
    if (!(dialog instanceof HTMLElement)) { throw new Error('dialog not open'); }
    return dialog;
}

/**
 * @param {HTMLElement} dialog
 * @returns {HTMLButtonElement[]}
 */
const rows = (dialog) => [...dialog.querySelectorAll('button.fc-cw-row')].map((e) => /** @type {HTMLButtonElement} */ (e));
/**
 * @param {HTMLElement} dialog
 * @returns {HTMLButtonElement}
 */
const saveButton = (dialog) => /** @type {HTMLButtonElement} */ (dialog.querySelector('.fc-cw-save'));

describe('TestWordsController — окно «Отметьте знакомые слова»', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => { env = await setupDomTest(); });
    afterEach(async () => { await env.teardown(global); });

    const result = {
        newWords: ['googled', 'engine', 'twice', 'engine'],
        entries: [{word: 'googled', lemma: 'google', forms: ['googled'], kind: 'verb'}],
    };

    test('после анализа — «Новые слова» с числом без дублей', async () => {
        const {host} = setup(result);
        /** @type {HTMLButtonElement} */ (host.querySelector('.test-words-trigger')).click();
        await flush();
        const count = /** @type {HTMLButtonElement} */ (host.querySelector('.test-words-count'));
        expect(count.hidden).toBe(false);
        expect(count.textContent).toContain('3');
    });

    test('строки-флажки, форма «googled ← google», источник с длиной', async () => {
        const {host} = setup(result);
        const dialog = await openDialog(host);
        expect(dialog.getAttribute('role')).toBe('dialog');
        expect(dialog.getAttribute('aria-modal')).toBe('true');
        const r = rows(dialog);
        expect(r.map((e) => e.getAttribute('aria-checked'))).toStrictEqual(['false', 'false', 'false']);
        expect(r[0].textContent).toContain('googled ← google');
        expect(r[1].textContent).not.toContain('←');
        expect(dialog.querySelector('.fc-cw-k')?.textContent).toContain('Фраза');
        expect(dialog.querySelector('.fc-cw-k')?.textContent).toContain('27');
    });

    test('ничего не отмечено — «Все новые — сохранить», без запросов, «Готово»', async () => {
        const {host, api} = setup(result);
        const dialog = await openDialog(host);
        expect(saveButton(dialog).textContent).toBe('Все новые — сохранить');
        saveButton(dialog).click();
        await flush();
        expect(api.lexiconAddKnownWord).not.toHaveBeenCalled();
        expect(dialog.querySelector('.fc-cw-done')).not.toBeNull();
    });

    test('отмеченное записывается по «Сохранить», счётчик — оставшиеся', async () => {
        const {host, api} = setup(result);
        const dialog = await openDialog(host);
        rows(dialog)[1].click();
        expect(rows(dialog)[1].getAttribute('aria-checked')).toBe('true');
        expect(saveButton(dialog).textContent).toBe('Сохранить · 1 знакомое');
        expect(api.lexiconAddKnownWord).not.toHaveBeenCalled();
        saveButton(dialog).click();
        await flush();
        expect(api.lexiconAddKnownWord.mock.calls).toStrictEqual([['engine', 'yomitan']]);
        expect(dialog.querySelector('.fc-cw-done')?.textContent).toContain('1 слово отмечено знакомым');
        expect(/** @type {HTMLElement} */ (host.querySelector('.test-words-count')).textContent).toContain('2');
    });

    test('сбой на втором слове: первое ушло из списка, второе осталось отмеченным, ошибка видна', async () => {
        const {host, api} = setup(result, async (word) => {
            if (word === 'twice') { throw Object.assign(new Error('offline'), {data: {status: 503}}); }
            return {};
        });
        const dialog = await openDialog(host);
        rows(dialog)[1].click();
        rows(dialog)[2].click();
        saveButton(dialog).click();
        await flush();
        expect(api.lexiconAddKnownWord).toHaveBeenCalledTimes(2);
        expect(dialog.querySelector('.fc-cw-done')).toBeNull();
        const left = rows(dialog);
        expect(left.map((e) => e.dataset.word)).toStrictEqual(['googled', 'twice']);
        expect(left[1].getAttribute('aria-checked')).toBe('true');
        expect(dialog.querySelector('.fc-cw-status')?.textContent).toContain('Flibooster');
        // Повтор дописывает только остаток.
        api.lexiconAddKnownWord.mockImplementation(async () => ({}));
        saveButton(dialog).click();
        await flush();
        expect(api.lexiconAddKnownWord.mock.calls.slice(2)).toStrictEqual([['twice', 'yomitan']]);
    });

    test('двойной клик по «Сохранить» — каждое слово один раз', async () => {
        /** @type {(value: unknown) => void} */
        let release = () => {};
        const gate = new Promise((resolve) => { release = resolve; });
        const {host, api} = setup(result, async () => {
            await gate;
            return {};
        });
        const dialog = await openDialog(host);
        rows(dialog)[0].click();
        saveButton(dialog).click();
        saveButton(dialog).click();
        release(null);
        await flush();
        expect(api.lexiconAddKnownWord).toHaveBeenCalledTimes(1);
    });

    test('«Знаю все» отмечает и снимает все', async () => {
        const {host} = setup(result);
        const dialog = await openDialog(host);
        // Список перерисовывается после каждого клика — кнопку ищем заново.
        const all = () => /** @type {HTMLButtonElement} */ (dialog.querySelector('.fc-cw-all'));
        all().click();
        expect(rows(dialog).every((e) => e.getAttribute('aria-checked') === 'true')).toBe(true);
        expect(all().getAttribute('aria-checked')).toBe('true');
        all().click();
        expect(rows(dialog).every((e) => e.getAttribute('aria-checked') === 'false')).toBe(true);
    });

    test('«Отмена» и Esc закрывают без записи', async () => {
        const {host, api} = setup(result);
        let dialog = await openDialog(host);
        rows(dialog)[0].click();
        /** @type {HTMLButtonElement} */ (dialog.querySelector('.fc-cw-cancel')).click();
        expect(document.querySelector('.fc-cw')).toBeNull();
        /** @type {HTMLButtonElement} */ (host.querySelector('.test-words-count')).click();
        dialog = /** @type {HTMLElement} */ (document.querySelector('.fc-cw'));
        expect(rows(dialog)[0].getAttribute('aria-checked')).toBe('false');
        document.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape'}));
        expect(document.querySelector('.fc-cw')).toBeNull();
        expect(api.lexiconAddKnownWord).not.toHaveBeenCalled();
    });
    test('«Вернуть в новые» после «Готово» снимает записанное и возвращает список', async () => {
        const {host, api} = setup(result);
        const dialog = await openDialog(host);
        rows(dialog)[1].click();
        rows(dialog)[2].click();
        saveButton(dialog).click();
        await flush();
        /** @type {HTMLButtonElement} */ (dialog.querySelector('.fc-cw-undo')).click();
        await flush();
        expect(api.lexiconRemoveKnownWord.mock.calls).toStrictEqual([['engine'], ['twice']]);
        expect(rows(dialog).map((e) => e.dataset.word)).toStrictEqual(['googled', 'engine', 'twice']);
        expect(/** @type {HTMLElement} */ (host.querySelector('.test-words-count')).textContent).toContain('3');
    });

    test('Esc закрывает только окно — до горячих клавиш попапа не доходит', async () => {
        const {host} = setup(result);
        await openDialog(host);
        const popupHotkey = vi.fn();
        document.addEventListener('keydown', popupHotkey);
        document.body.dispatchEvent(new KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
        expect(document.querySelector('.fc-cw')).toBeNull();
        expect(popupHotkey).not.toHaveBeenCalled();
        document.removeEventListener('keydown', popupHotkey);
    });

    test('после закрытия фокус возвращается на «Новые слова»', async () => {
        const {host} = setup(result);
        const dialog = await openDialog(host);
        /** @type {HTMLButtonElement} */ (dialog.querySelector('.fc-cw-cancel')).click();
        expect(document.activeElement).toBe(host.querySelector('.test-words-count'));
    });

    test('пока идёт запись — новый анализ не запускается', async () => {
        /** @type {(value: unknown) => void} */
        let release = () => {};
        const gate = new Promise((resolve) => { release = resolve; });
        const {host, api} = setup(result, async () => {
            await gate;
            return {};
        });
        const dialog = await openDialog(host);
        rows(dialog)[0].click();
        saveButton(dialog).click();
        /** @type {HTMLButtonElement} */ (host.querySelector('.test-words-trigger')).click();
        await flush();
        expect(api.lexiconAnalyzeText).toHaveBeenCalledTimes(1);
        release(null);
        await flush();
    });

    test('окно закрыли во время записи, запись упала — при новом открытии отметок нет', async () => {
        /** @type {(value: unknown) => void} */
        let fail = () => {};
        const gate = new Promise((resolve) => { fail = resolve; });
        const {host} = setup(result, async () => {
            await gate;
            throw new Error('down');
        });
        const dialog = await openDialog(host);
        rows(dialog)[0].click();
        saveButton(dialog).click();
        /** @type {HTMLButtonElement} */ (dialog.querySelector('.fc-cw-close')).click();
        fail(null);
        await flush();
        /** @type {HTMLButtonElement} */ (host.querySelector('.test-words-count')).click();
        const again = /** @type {HTMLElement} */ (document.querySelector('.fc-cw'));
        expect(rows(again).every((e) => e.getAttribute('aria-checked') === 'false')).toBe(true);
    });
});
