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

import {toError} from '../../core/to-error.js';
import {FLIB_GATEWAY_DEFAULT_BASE, isTrustedFlibGatewayUrl, normalizeFlibGatewayUrl, normalizeFlibPersonalKey} from '../../data/flib-service-config.js';
import {querySelectorNotNull} from '../../dom/query-selector.js';

const INVALID_KEY_MESSAGE = 'Ключ должен быть вида tpk_ и 32 строчных шестнадцатеричных символа (0-9, a-f). Не сохранено.';
const INVALID_URL_MESSAGE = `Нужен адрес https://… или wss://… (открытые http:// и ws:// — только для localhost), либо пусто — тогда ${FLIB_GATEWAY_DEFAULT_BASE}. Не сохранено.`;
const UNTRUSTED_URL_WARNING = 'Это не сервер Flib-club и не localhost: личный ключ будет уходить на этот адрес. Убедитесь, что доверяете ему.';
const DEFAULT_INPUT_DEBOUNCE_MS = 600;

/**
 * Раздел «Flib-club: сервер»: личный ключ и адрес шлюза.
 *
 * ⚠️ C1: оба значения живут НЕ в настройках (chrome.storage.local доступна
 * контент-скриптам), а в IndexedDB `flib-secrets` бэкенда, и они глобальные —
 * не по профилям. Страница читает их через flibSecretsGet (ключ — только
 * маской) и пишет через flibSecretsSet; бэкенд проверяет формат ещё раз.
 *
 * Ключ: поле всегда пустое (полного ключа у страницы нет); годный ввод
 * сохраняется по `change` сразу и по `input` после паузы, затем поле
 * очищается, а маска обновляется. Пустой ввод ключ НЕ стирает — для этого
 * кнопка «Удалить ключ».
 *
 * Адрес: сохраняется только по `change` и только если изменился (NEW-2:
 * годный на полпути `https://cache` по `input` унёс бы ключ на чужой хост).
 *
 * ⚠️ У полей НЕТ `data-setting`: GenericSettingController писал бы ввод в
 * настройки без проверки — и в chrome.storage.local.
 */
export class FlibServiceController {
    /**
     * @param {import('./settings-controller.js').SettingsController} settingsController
     * @param {{inputDebounceMs?: number}} [options]
     */
    constructor(settingsController, {inputDebounceMs = DEFAULT_INPUT_DEBOUNCE_MS} = {}) {
        /** @type {import('../../comm/api.js').API} */
        this._api = settingsController.application.api;
        /** @type {number} */
        this._inputDebounceMs = inputDebounceMs;
        /** @type {HTMLInputElement} */
        this._keyInput = querySelectorNotNull(document, '#flib-personal-key-input');
        /** @type {HTMLButtonElement} */
        this._keyToggle = querySelectorNotNull(document, '#flib-personal-key-toggle');
        /** @type {HTMLButtonElement} */
        this._keyClear = querySelectorNotNull(document, '#flib-personal-key-clear');
        /** @type {HTMLElement} */
        this._keyStatus = querySelectorNotNull(document, '#flib-personal-key-status');
        /** @type {HTMLElement} */
        this._keyError = querySelectorNotNull(document, '#flib-personal-key-error');
        /** @type {HTMLInputElement} */
        this._urlInput = querySelectorNotNull(document, '#flib-gateway-url-input');
        /** @type {HTMLElement} */
        this._urlError = querySelectorNotNull(document, '#flib-gateway-url-error');
        /** @type {HTMLElement} */
        this._urlWarning = querySelectorNotNull(document, '#flib-gateway-url-warning');
        /** @type {HTMLElement} Ключи каких профилей не перенесены (миграция). */
        this._migrationNote = querySelectorNotNull(document, '#flib-migration-note');
        /** @type {HTMLElement} */
        this._migrationNoteText = querySelectorNotNull(document, '#flib-migration-note-text');
        /** @type {HTMLButtonElement} */
        this._migrationNoteDismiss = querySelectorNotNull(document, '#flib-migration-note-dismiss');
        /** @type {?import('core').Timeout} */
        this._debounceTimer = null;
        /** @type {?string} Ключ, запись которого сейчас идёт: тот же ключ второй раз не пишется. */
        this._savingKey = null;
        /** @type {?string} Адрес, каким его знает бэкенд; null — ещё не прочитан. */
        this._storedUrl = null;
    }

    /** */
    async prepare() {
        this._keyInput.addEventListener('input', this._onKeyInput.bind(this), false);
        this._keyInput.addEventListener('change', this._onKeyChange.bind(this), false);
        this._keyToggle.addEventListener('click', this._onKeyToggleClick.bind(this), false);
        this._keyClear.addEventListener('click', this._onKeyClearClick.bind(this), false);
        this._urlInput.addEventListener('change', this._onUrlChange.bind(this), false);
        this._migrationNoteDismiss.addEventListener('click', this._onMigrationNoteDismiss.bind(this), false);
        try {
            this._applyView(await this._api.flibSecretsGet());
        } catch (e) {
            this._setError(this._keyInput, this._keyError, `Не удалось прочитать настройки сервера: ${toError(e).message}`);
        }
    }

    // Private

    /**
     * @param {import('flib-secret-store').FlibSecretsView} view
     */
    _applyView({keyMasked, gatewayUrl, migrationNote}) {
        this._keyStatus.textContent = keyMasked !== null ? `Ключ задан: ${keyMasked}` : 'Ключ не задан';
        this._keyClear.hidden = keyMasked === null;
        this._migrationNoteText.textContent = migrationNote ?? '';
        this._migrationNote.hidden = migrationNote === null;
        this._storedUrl = gatewayUrl;
        // Набираемый адрес не затирается ответом на запись ключа.
        if (this._urlInput.ownerDocument.activeElement === this._urlInput) { return; }
        this._urlInput.value = gatewayUrl;
        this._updateUrlWarning(gatewayUrl);
    }

    /** */
    _onKeyInput() {
        this._cancelDebounce();
        const {valid, value} = normalizeFlibPersonalKey(this._keyInput.value);
        if (!valid || value === '') { return; }
        this._setError(this._keyInput, this._keyError, null);
        this._debounceTimer = setTimeout(() => {
            this._debounceTimer = null;
            void this._saveKey(value);
        }, this._inputDebounceMs);
    }

    /** */
    _onKeyChange() {
        this._cancelDebounce();
        const {valid, value} = normalizeFlibPersonalKey(this._keyInput.value);
        if (!valid) {
            this._setError(this._keyInput, this._keyError, INVALID_KEY_MESSAGE);
            return;
        }
        this._setError(this._keyInput, this._keyError, null);
        if (value === '') { return; }
        void this._saveKey(value);
    }

    /** */
    async _onMigrationNoteDismiss() {
        try {
            this._applyView(await this._api.flibSecretsSet({dismissMigrationNote: true}));
        } catch (e) {
            this._setError(this._keyInput, this._keyError, `Не удалось скрыть заметку: ${toError(e).message}`);
        }
    }

    /** */
    _onKeyClearClick() {
        this._cancelDebounce();
        this._keyInput.value = '';
        void this._saveKey('');
    }

    /**
     * @param {string} value '' — стереть ключ.
     */
    async _saveKey(value) {
        if (this._savingKey === value) { return; }
        this._savingKey = value;
        try {
            this._applyView(await this._api.flibSecretsSet({personalKey: value}));
            // Поле очищается, только если в нём всё ещё сохранённое значение:
            // набранное за время записи не трогаем.
            if (normalizeFlibPersonalKey(this._keyInput.value).value === value) { this._keyInput.value = ''; }
            this._setError(this._keyInput, this._keyError, null);
        } catch (e) {
            this._setError(this._keyInput, this._keyError, `Не удалось сохранить: ${toError(e).message}`);
        } finally {
            if (this._savingKey === value) { this._savingKey = null; }
        }
    }

    /** */
    async _onUrlChange() {
        const {valid, value} = normalizeFlibGatewayUrl(this._urlInput.value);
        if (!valid) {
            this._setError(this._urlInput, this._urlError, INVALID_URL_MESSAGE);
            return;
        }
        this._urlInput.value = value;
        this._setError(this._urlInput, this._urlError, null);
        this._updateUrlWarning(value);
        if (value === this._storedUrl) { return; }
        try {
            this._applyView(await this._api.flibSecretsSet({gatewayUrl: value}));
        } catch (e) {
            this._setError(this._urlInput, this._urlError, `Не удалось сохранить: ${toError(e).message}`);
        }
    }

    /** */
    _cancelDebounce() {
        if (this._debounceTimer === null) { return; }
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
    }

    /**
     * H3: чужой хост не запрещён (свой сервер разработчика), но человек должен
     * видеть, что ключ уйдёт не на Flib.
     * @param {string} value
     */
    _updateUrlWarning(value) {
        const warning = normalizeFlibGatewayUrl(value).valid && !isTrustedFlibGatewayUrl(value) ? UNTRUSTED_URL_WARNING : null;
        this._urlWarning.textContent = warning ?? '';
        this._urlWarning.hidden = warning === null;
    }

    /**
     * @param {HTMLInputElement} input
     * @param {HTMLElement} errorElement
     * @param {?string} message
     */
    _setError(input, errorElement, message) {
        input.setCustomValidity(message ?? '');
        input.setAttribute('aria-invalid', message === null ? 'false' : 'true');
        errorElement.textContent = message ?? '';
        errorElement.hidden = message === null;
    }

    /**
     * Один сигнал состояния — текст кнопки (LOW-4): aria-pressed вместе с
     * меняющимся текстом читался бы как две противоречивые подсказки.
     */
    _onKeyToggleClick() {
        const show = this._keyInput.type === 'password';
        this._keyInput.type = show ? 'text' : 'password';
        this._keyToggle.textContent = show ? 'Скрыть' : 'Показать';
    }
}
