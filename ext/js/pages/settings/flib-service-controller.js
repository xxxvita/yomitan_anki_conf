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

import {ExtensionError} from '../../core/extension-error.js';
import {toError} from '../../core/to-error.js';
import {FLIB_GATEWAY_DEFAULT_BASE, isTrustedFlibGatewayUrl, normalizeFlibGatewayUrl, normalizeFlibPersonalKey} from '../../data/flib-service-config.js';
import {querySelectorNotNull} from '../../dom/query-selector.js';

const INVALID_KEY_MESSAGE = 'Ключ должен быть вида tpk_ и 32 строчных шестнадцатеричных символа (0-9, a-f). Не сохранено.';
const INVALID_URL_MESSAGE = `Нужен адрес https://… или wss://… (открытые http:// и ws:// — только для localhost), либо пусто — тогда ${FLIB_GATEWAY_DEFAULT_BASE}. Не сохранено.`;
const INVALID_STORED_KEY_MESSAGE = 'Сохранённый ключ неверного формата, запросы к серверу с ним не уйдут. Вставьте ключ заново или очистите поле.';
const INVALID_STORED_URL_MESSAGE = `Сохранённый адрес не годится (нужен https:// или wss://; http:// и ws:// — только для localhost), поэтому запросы идут на ${FLIB_GATEWAY_DEFAULT_BASE}. Исправьте или очистите поле.`;
const UNTRUSTED_URL_WARNING = 'Это не сервер Flib-club и не localhost: личный ключ будет уходить на этот адрес. Убедитесь, что доверяете ему.';
const DEFAULT_INPUT_DEBOUNCE_MS = 600;

/**
 * @typedef {object} FieldDetails
 * @property {HTMLInputElement} input
 * @property {HTMLElement} errorElement
 * @property {?HTMLElement} warningElement
 * @property {string} settingPath
 * @property {(raw: string) => {valid: boolean, value: string}} normalize
 * @property {string} invalidMessage
 * @property {string} invalidStoredMessage Ошибка для негодного значения, уже лежащего в настройках.
 * @property {(value: string) => ?string} getWarning Предупреждение для годного значения.
 * @property {boolean} saveOnInput Сохранять по `input` после паузы (ключ — да; адрес — нет, NEW-2).
 * @property {() => number} getProfileIndex Текущий профиль настроек.
 */

/**
 * Одно проверяемое поле настроек.
 *
 * Сохраняет по `change` сразу и, если `saveOnInput`, по `input` после паузы
 * (LOW-3) — только годное значение. Ошибку формата показывает на `change`:
 * посреди набора она шумела бы.
 *
 * ⚠️ NEW-2: адрес по `input` НЕ сохраняется: годный на полпути `https://cache`
 * оказался бы в настройках, а ключ ушёл бы на него.
 */
class ValidatedField {
    /**
     * @param {import('./settings-controller.js').SettingsController} settingsController
     * @param {FieldDetails} details
     * @param {number} inputDebounceMs
     */
    constructor(settingsController, details, inputDebounceMs) {
        /** @type {import('./settings-controller.js').SettingsController} */
        this._settingsController = settingsController;
        /** @type {FieldDetails} */
        this._details = details;
        /** @type {number} */
        this._inputDebounceMs = inputDebounceMs;
        /** @type {?string} Значение в настройках, каким его видело поле. */
        this._storedValue = null;
        /** @type {?import('core').Timeout} */
        this._debounceTimer = null;
    }

    /** */
    prepare() {
        const {input} = this._details;
        input.addEventListener('change', this._onChange.bind(this), false);
        input.addEventListener('input', this._onInput.bind(this), false);
    }

    /**
     * Значение из настроек того же профиля.
     *
     * ⚠️ LOW-2: если оно не изменилось, поле не трогается — иначе любое
     * постороннее optionsChanged стирало бы неверный ввод вместе с объяснением,
     * что с ним не так.
     * @param {string} value
     */
    setStoredValue(value) {
        if (value === this._storedValue) { return; }
        this.reset(value);
    }

    /**
     * Полный сброс поля к значению из настроек: таймер, ввод, ошибка,
     * предупреждение. Обязателен при смене профиля (NEW-1), даже если значение
     * совпало: иначе отложенная запись ключа из профиля A ушла бы в профиль B.
     * @param {string} value
     */
    reset(value) {
        this._storedValue = value;
        this._cancelDebounce();
        this._details.input.value = value;
        const {valid} = this._details.normalize(value);
        this._setError(valid ? null : this._details.invalidStoredMessage);
        this._updateWarning(value);
    }

    /** */
    _onInput() {
        this._cancelDebounce();
        if (!this._details.saveOnInput) { return; }
        const {valid, value} = this._details.normalize(this._details.input.value);
        if (!valid) { return; }
        this._setError(null);
        // ⚠️ NEW-1: запись уходит в ТЕКУЩИЙ профиль на момент вызова. Если за
        // паузу профиль сменился — это уже чужой профиль, запись пропускается.
        const profileIndex = this._details.getProfileIndex();
        this._debounceTimer = setTimeout(() => {
            this._debounceTimer = null;
            if (this._details.getProfileIndex() !== profileIndex) { return; }
            void this._save(value);
        }, this._inputDebounceMs);
    }

    /** */
    _onChange() {
        this._cancelDebounce();
        const {valid, value} = this._details.normalize(this._details.input.value);
        if (!valid) {
            this._setError(this._details.invalidMessage);
            return;
        }
        this._details.input.value = value;
        this._setError(null);
        void this._save(value);
    }

    /**
     * @param {string} value
     */
    async _save(value) {
        this._updateWarning(value);
        if (value === this._storedValue) { return; }
        try {
            const results = await this._settingsController.setProfileSetting(this._details.settingPath, value);
            for (const result of results) {
                if (typeof result === 'object' && result !== null && 'error' in result && typeof result.error !== 'undefined') {
                    throw ExtensionError.deserialize(result.error);
                }
            }
            this._storedValue = value;
        } catch (e) {
            this._setError(`Не удалось сохранить: ${toError(e).message}`);
        }
    }

    /** */
    _cancelDebounce() {
        if (this._debounceTimer === null) { return; }
        clearTimeout(this._debounceTimer);
        this._debounceTimer = null;
    }

    /**
     * @param {string} value
     */
    _updateWarning(value) {
        const {warningElement, getWarning, normalize} = this._details;
        if (warningElement === null) { return; }
        // Для негодного значения уже показана ошибка — предупреждение лишнее.
        const warning = normalize(value).valid ? getWarning(value) : null;
        warningElement.textContent = warning ?? '';
        warningElement.hidden = warning === null;
    }

    /**
     * @param {?string} message
     */
    _setError(message) {
        const {input, errorElement} = this._details;
        input.setCustomValidity(message ?? '');
        input.setAttribute('aria-invalid', message === null ? 'false' : 'true');
        errorElement.textContent = message ?? '';
        errorElement.hidden = message === null;
    }
}

/**
 * Раздел «Flib-club: сервер»: личный ключ и адрес шлюза.
 *
 * ⚠️ У полей НЕТ `data-setting`: GenericSettingController сохранял бы любой ввод
 * без проверки. Здесь ввод срезается, проверяется и пишется в настройки только
 * если годен; негодный остаётся в поле с сообщением, а в настройках остаётся
 * прежнее значение.
 *
 * ⚠️ Проверка — на вводе, а не в схеме настроек: `pattern` в options-schema
 * отверг бы уже сохранённые старые значения при загрузке профиля.
 */
export class FlibServiceController {
    /**
     * @param {import('./settings-controller.js').SettingsController} settingsController
     * @param {{inputDebounceMs?: number}} [options]
     */
    constructor(settingsController, {inputDebounceMs = DEFAULT_INPUT_DEBOUNCE_MS} = {}) {
        /** @type {import('./settings-controller.js').SettingsController} */
        this._settingsController = settingsController;
        /** @type {?number} Профиль, чьи значения сейчас в полях. */
        this._profileIndex = null;
        /** @type {() => number} */
        const getProfileIndex = () => settingsController.profileIndex;
        /** @type {HTMLInputElement} */
        this._keyInput = querySelectorNotNull(document, '#flib-personal-key-input');
        /** @type {HTMLButtonElement} */
        this._keyToggle = querySelectorNotNull(document, '#flib-personal-key-toggle');
        /** @type {ValidatedField} */
        this._keyField = new ValidatedField(settingsController, {
            input: this._keyInput,
            errorElement: querySelectorNotNull(document, '#flib-personal-key-error'),
            warningElement: null,
            settingPath: 'flibService.personalKey',
            normalize: normalizeFlibPersonalKey,
            invalidMessage: INVALID_KEY_MESSAGE,
            invalidStoredMessage: INVALID_STORED_KEY_MESSAGE,
            getWarning: () => null,
            saveOnInput: true,
            getProfileIndex,
        }, inputDebounceMs);
        /** @type {ValidatedField} */
        this._urlField = new ValidatedField(settingsController, {
            input: querySelectorNotNull(document, '#flib-gateway-url-input'),
            errorElement: querySelectorNotNull(document, '#flib-gateway-url-error'),
            warningElement: /** @type {HTMLElement} */ (querySelectorNotNull(document, '#flib-gateway-url-warning')),
            settingPath: 'flibService.gatewayUrl',
            normalize: normalizeFlibGatewayUrl,
            invalidMessage: INVALID_URL_MESSAGE,
            // H3: чужой хост не запрещён (свой сервер разработчика), но человек
            // должен видеть, что ключ уйдёт не на Flib.
            getWarning: (value) => (isTrustedFlibGatewayUrl(value) ? null : UNTRUSTED_URL_WARNING),
            invalidStoredMessage: INVALID_STORED_URL_MESSAGE,
            saveOnInput: false,
            getProfileIndex,
        }, inputDebounceMs);
    }

    /** */
    async prepare() {
        const options = await this._settingsController.getOptions();
        this._keyField.prepare();
        this._urlField.prepare();
        this._keyToggle.addEventListener('click', this._onKeyToggleClick.bind(this), false);
        this._settingsController.on('optionsChanged', this._onOptionsChanged.bind(this));
        this._update(options);
    }

    // Private

    /**
     * @param {import('settings-controller').EventArgument<'optionsChanged'>} details
     */
    _onOptionsChanged({options}) {
        this._update(options);
    }

    /**
     * @param {import('settings').ProfileOptions} options
     */
    _update(options) {
        const {personalKey, gatewayUrl} = options.flibService;
        const profileIndex = this._settingsController.profileIndex;
        if (profileIndex !== this._profileIndex) {
            // NEW-1: другой профиль — сбросить всё, что относилось к прежнему.
            this._profileIndex = profileIndex;
            this._keyField.reset(personalKey);
            this._urlField.reset(gatewayUrl);
            return;
        }
        this._keyField.setStoredValue(personalKey);
        this._urlField.setStoredValue(gatewayUrl);
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
