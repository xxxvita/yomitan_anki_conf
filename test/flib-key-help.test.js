/*
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


import {afterAll, describe, expect, test, vi} from 'vitest';
import {createFlibKeyHelp} from '../ext/js/display/flib-key-help.js';
import {setupDomTest} from './fixtures/dom-test.js';

const {window, teardown} = await setupDomTest();
afterAll(() => teardown(global));

const KEY = `tpk_${'a'.repeat(32)}`;

/**
 * @param {{flibSecretsSet?: (params: {personalKey: string}) => Promise<unknown>}} api
 * @param {'need'|'limit'} [variant]
 * @returns {{root: HTMLElement, onSaved: import('vitest').Mock, input: HTMLInputElement, submit: () => void, error: HTMLElement}}
 */
function setup(api, variant = 'need') {
    const onSaved = vi.fn();
    const root = createFlibKeyHelp({api: /** @type {*} */ (api), variant, onSaved});
    window.document.body.replaceChildren(root);
    const form = /** @type {HTMLFormElement} */ (root.querySelector('form'));
    return {
        root,
        onSaved,
        input: /** @type {HTMLInputElement} */ (root.querySelector('input')),
        submit: () => { form.dispatchEvent(new window.Event('submit', {cancelable: true, bubbles: true})); },
        error: /** @type {HTMLElement} */ (root.querySelector('.fc-xp-key-error')),
    };
}

describe('createFlibKeyHelp', () => {
    test.each([
        ['need', 'https://t.me/flibclub_bot?start=extension'],
        ['limit', 'https://t.me/flibclub_bot?start=extension_limit'],
    ])('%s leads straight to the bot', (variant, href) => {
        const {root} = setup({}, /** @type {'need'|'limit'} */ (variant));
        const link = /** @type {HTMLAnchorElement} */ (root.querySelector('a.fc-btn-acc'));
        expect(link.href).toBe(href);
        expect(link.target).toBe('_blank');
        expect(link.rel).toContain('noopener');
    });

    test('a valid key with stray spaces is saved once and reports success', async () => {
        const flibSecretsSet = vi.fn(async () => ({}));
        const {input, submit, onSaved} = setup({flibSecretsSet});
        input.value = `  ${KEY}\n`;
        submit();
        submit();
        await vi.waitFor(() => { expect(onSaved).toHaveBeenCalledTimes(1); });
        expect(flibSecretsSet).toHaveBeenCalledTimes(1);
        expect(flibSecretsSet).toHaveBeenCalledWith({personalKey: KEY});
    });

    test('a malformed key is rejected on the spot', () => {
        const flibSecretsSet = vi.fn(async () => ({}));
        const {input, submit, error, onSaved} = setup({flibSecretsSet});
        input.value = 'not-a-key';
        submit();
        expect(flibSecretsSet).not.toHaveBeenCalled();
        expect(onSaved).not.toHaveBeenCalled();
        expect(error.hidden).toBe(false);
        expect(input.value).toBe('not-a-key');
    });

    test('an empty field does nothing', () => {
        const flibSecretsSet = vi.fn(async () => ({}));
        const {submit, error} = setup({flibSecretsSet});
        submit();
        expect(flibSecretsSet).not.toHaveBeenCalled();
        expect(error.hidden).toBe(true);
    });

    test('a failed save keeps the key and allows another try', async () => {
        const flibSecretsSet = vi.fn().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({});
        const {input, submit, error, onSaved, root} = setup({flibSecretsSet});
        input.value = KEY;
        submit();
        await vi.waitFor(() => { expect(error.hidden).toBe(false); });
        expect(onSaved).not.toHaveBeenCalled();
        expect(input.value).toBe(KEY);
        expect(/** @type {HTMLButtonElement} */ (root.querySelector('button')).disabled).toBe(false);
        submit();
        await vi.waitFor(() => { expect(onSaved).toHaveBeenCalledTimes(1); });
    });

    test('closing the window during saving does not reopen anything', async () => {
        /** @type {(value: unknown) => void} */
        let resolve = () => {};
        const flibSecretsSet = vi.fn(() => new Promise((r) => { resolve = r; }));
        const {input, submit, onSaved, root} = setup({flibSecretsSet});
        input.value = KEY;
        submit();
        root.remove();
        resolve({});
        await new Promise((r) => { setTimeout(r, 0); });
        expect(onSaved).not.toHaveBeenCalled();
    });

    test('typing in the field never reaches the card hotkeys', () => {
        const {input} = setup({});
        const onKeyDown = vi.fn();
        window.document.body.addEventListener('keydown', onKeyDown);
        input.dispatchEvent(new window.KeyboardEvent('keydown', {key: 'Escape', bubbles: true}));
        window.document.body.removeEventListener('keydown', onKeyDown);
        expect(onKeyDown).not.toHaveBeenCalled();
    });

    test('the key stays hidden and out of password managers', () => {
        const {input} = setup({});
        expect(input.type).toBe('password');
        expect(input.autocomplete).toBe('one-time-code');
        expect(input.spellcheck).toBe(false);
    });

    test('without an api the links stay and the form is left out', () => {
        const root = createFlibKeyHelp({api: null, variant: 'need', onSaved: () => {}});
        expect(root.querySelector('a.fc-btn-acc')).not.toBeNull();
        expect(root.querySelector('form')).toBeNull();
    });
});
