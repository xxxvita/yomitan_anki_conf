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


import {FLIB_KEY_BOT_URL, FLIB_KEY_LIMIT_BOT_URL, FLIB_SITE_URL} from '../data/flib-host.js';
import {normalizeFlibPersonalKey} from '../data/flib-service-config.js';
import {translate} from '../i18n/ui-language.js';

/**
 * @param {string} className
 * @param {string} href
 * @param {string} text
 * @returns {HTMLAnchorElement}
 */
function createLink(className, href, text) {
    const link = document.createElement('a');
    link.className = className;
    link.href = href;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.textContent = text;
    return link;
}

/**
 * @param {?import('../comm/api.js').API} api
 * @param {() => void} onSaved
 * @returns {HTMLFormElement}
 */
function createKeyForm(api, onSaved) {
    const form = document.createElement('form');
    form.className = 'fc-xp-key-form';

    const label = document.createElement('label');
    label.className = 'fc-xp-key-label';
    const caption = document.createElement('span');
    caption.textContent = translate('keyHelp.haveKey');
    const input = document.createElement('input');
    input.type = 'password';
    input.className = 'fc-xp-key-input';
    input.placeholder = 'tpk_…';
    input.spellcheck = false;
    input.autocomplete = 'one-time-code';
    input.dataset['1pIgnore'] = '';
    input.dataset.lpignore = 'true';
    label.append(caption, input);

    const save = document.createElement('button');
    save.type = 'submit';
    save.className = 'fc-btn';
    save.textContent = translate('keyHelp.save');

    const error = document.createElement('div');
    error.className = 'fc-xp-key-error';
    error.setAttribute('role', 'alert');
    error.hidden = true;

    /** @param {?string} text */
    const showError = (text) => {
        error.textContent = text ?? '';
        error.hidden = text === null;
    };

    // Иначе буквы и Escape в поле сработают как горячие клавиши карточки.
    input.addEventListener('keydown', (e) => { e.stopPropagation(); });

    let saving = false;
    form.addEventListener('submit', (e) => {
        e.preventDefault();
        if (saving || api === null) { return; }
        const raw = input.value.trim();
        if (raw.length === 0) {
            showError(null);
            return;
        }
        const {valid, value} = normalizeFlibPersonalKey(raw);
        if (!valid) {
            showError(translate('settings.invalidKey'));
            return;
        }
        saving = true;
        save.disabled = true;
        showError(null);
        void (async () => {
            try {
                await api.flibSecretsSet({personalKey: value});
                // Окно могли закрыть, пока шло сохранение: открывать уже нечего.
                if (form.isConnected) { onSaved(); }
            } catch {
                showError(translate('keyHelp.saveFailed'));
            } finally {
                saving = false;
                save.disabled = false;
            }
        })();
    });

    form.append(label, save, error);
    return form;
}

/**
 * Блок помощи там, где примерам не хватает ключа: ссылка на бота, ссылка на
 * сайт и поле, чтобы вставить ключ на месте.
 * @param {{api: ?import('../comm/api.js').API, variant: 'need'|'limit', onSaved: () => void}} details
 * @returns {HTMLElement}
 */
export function createFlibKeyHelp({api, variant, onSaved}) {
    const root = document.createElement('div');
    root.className = 'fc-xp-help';

    const text = document.createElement('div');
    text.className = 'fc-xp-help-text';
    text.textContent = translate(variant === 'limit' ? 'keyHelp.limitText' : 'keyHelp.needText');
    root.appendChild(text);

    root.appendChild(createLink(
        'fc-btn fc-btn-acc',
        variant === 'limit' ? FLIB_KEY_LIMIT_BOT_URL : FLIB_KEY_BOT_URL,
        translate(variant === 'limit' ? 'keyHelp.getFullKey' : 'keyHelp.getKey'),
    ));
    root.appendChild(createLink('fc-xp-tg', FLIB_SITE_URL, translate('keyHelp.about', {host: new URL(FLIB_SITE_URL).host})));
    if (api !== null) { root.appendChild(createKeyForm(api, onSaved)); }
    return root;
}
