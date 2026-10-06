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

import {FLIB_GATEWAY_DEFAULT_BASE, normalizeFlibGatewayUrl, normalizeFlibPersonalKey} from '../../data/flib-service-config.js';
import {querySelectorNotNull} from '../../dom/query-selector.js';

const INVALID_KEY_MESSAGE = 'Ключ должен быть вида tpk_ и 32 строчных шестнадцатеричных символа (0-9, a-f). Не сохранено.';
const INVALID_URL_MESSAGE = `Нужен адрес вида https://… (или http://, wss://, ws://), либо пусто — тогда ${FLIB_GATEWAY_DEFAULT_BASE}. Не сохранено.`;

/**
 * Одно проверяемое поле: ввод, элемент ошибки, путь в настройках и проверка.
 */
class ValidatedField {
    /**
     * @param {import('./settings-controller.js').SettingsController} settingsController
     * @param {HTMLInputElement} input
     * @param {HTMLElement} errorElement
     * @param {string} settingPath
     * @param {(raw: string) => {valid: boolean, value: string}} normalize
     * @param {string} invalidMessage
     */
    constructor(settingsController, input, errorElement, settingPath, normalize, invalidMessage) {
        /** @type {import('./settings-controller.js').SettingsController} */
        this._settingsController = settingsController;
        /** @type {HTMLInputElement} */
        this._input = input;
        /** @type {HTMLElement} */
        this._errorElement = errorElement;
        /** @type {string} */
        this._settingPath = settingPath;
        /** @type {(raw: string) => {valid: boolean, value: string}} */
        this._normalize = normalize;
        /** @type {string} */
        this._invalidMessage = invalidMessage;
    }

    /** */
    prepare() {
        this._input.addEventListener('change', this._onChange.bind(this), false);
    }

    /**
     * @param {string} value
     */
    setValue(value) {
        this._input.value = value;
        this._setError(null);
    }

    /** */
    _onChange() {
        const {valid, value} = this._normalize(this._input.value);
        if (!valid) {
            this._setError(this._invalidMessage);
            return;
        }
        this._input.value = value;
        this._setError(null);
        void this._settingsController.setProfileSetting(this._settingPath, value);
    }

    /**
     * @param {?string} message
     */
    _setError(message) {
        this._input.setCustomValidity(message ?? '');
        this._errorElement.textContent = message ?? '';
        this._errorElement.hidden = message === null;
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
     */
    constructor(settingsController) {
        /** @type {import('./settings-controller.js').SettingsController} */
        this._settingsController = settingsController;
        /** @type {HTMLInputElement} */
        this._keyInput = querySelectorNotNull(document, '#flib-personal-key-input');
        /** @type {HTMLButtonElement} */
        this._keyToggle = querySelectorNotNull(document, '#flib-personal-key-toggle');
        /** @type {ValidatedField} */
        this._keyField = new ValidatedField(
            settingsController,
            this._keyInput,
            querySelectorNotNull(document, '#flib-personal-key-error'),
            'flibService.personalKey',
            normalizeFlibPersonalKey,
            INVALID_KEY_MESSAGE,
        );
        /** @type {ValidatedField} */
        this._urlField = new ValidatedField(
            settingsController,
            querySelectorNotNull(document, '#flib-gateway-url-input'),
            querySelectorNotNull(document, '#flib-gateway-url-error'),
            'flibService.gatewayUrl',
            normalizeFlibGatewayUrl,
            INVALID_URL_MESSAGE,
        );
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
        this._keyField.setValue(options.flibService.personalKey);
        this._urlField.setValue(options.flibService.gatewayUrl);
    }

    /** */
    _onKeyToggleClick() {
        const show = this._keyInput.type === 'password';
        this._keyInput.type = show ? 'text' : 'password';
        this._keyToggle.setAttribute('aria-pressed', show ? 'true' : 'false');
        this._keyToggle.title = show ? 'Скрыть ключ' : 'Показать ключ';
        this._keyToggle.textContent = show ? 'Скрыть' : 'Показать';
    }
}
