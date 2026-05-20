/*
 * Copyright (C) 2024-2025  Yomitan Authors
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

import {querySelectorNotNull} from '../../dom/query-selector.js';

export class UserTagsController {
    /**
     * @param {import('./settings-controller.js').SettingsController} settingsController
     */
    constructor(settingsController) {
        /** @type {import('./settings-controller.js').SettingsController} */
        this._settingsController = settingsController;
        /** @type {HTMLTextAreaElement} */
        this._textarea = querySelectorNotNull(document, '#user-tags-textarea');
        /** @type {HTMLButtonElement} */
        this._saveButton = querySelectorNotNull(document, '#user-tags-save');
        /** @type {HTMLElement} */
        this._statusElement = querySelectorNotNull(document, '#user-tags-status');
        /** @type {?number} */
        this._statusTimeoutId = null;
    }

    /** */
    async prepare() {
        this._saveButton.addEventListener('click', this._onSaveClick.bind(this));
        this._settingsController.on('optionsChanged', this._onOptionsChanged.bind(this));
        await this._loadFromOptions();
    }

    // Private

    /** */
    _onOptionsChanged() {
        void this._loadFromOptions();
    }

    /** */
    async _loadFromOptions() {
        const options = await this._settingsController.getOptions();
        const tags = options.anki.userTags;
        this._textarea.value = Array.isArray(tags) ? tags.join('\n') : '';
    }

    /**
     * @param {MouseEvent} _e
     */
    _onSaveClick(_e) {
        void this._save();
    }

    /** */
    async _save() {
        const tags = this._textarea.value
            .split('\n')
            .map((line) => line.trim())
            .filter((line) => line.length > 0);
        this._textarea.value = tags.join('\n');
        await this._settingsController.setProfileSetting('anki.userTags', tags);
        this._showStatus('Saved');
    }

    /**
     * @param {string} message
     */
    _showStatus(message) {
        this._statusElement.textContent = message;
        this._statusElement.hidden = false;
        if (this._statusTimeoutId !== null) {
            clearTimeout(this._statusTimeoutId);
        }
        this._statusTimeoutId = window.setTimeout(() => {
            this._statusElement.hidden = true;
            this._statusTimeoutId = null;
        }, 2000);
    }
}
