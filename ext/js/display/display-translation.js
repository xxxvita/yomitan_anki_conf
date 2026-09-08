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

import {log} from '../core/log.js';
import {ensurePopupToolbar} from './popup-toolbar.js';
import {isStrictPairingAvailable} from './translation-pairing.js';

/** Минимальная ширина колонки, ниже которой рисуем стопкой, а не рядом. */
export const MIN_COLUMN_WIDTH = 240;

/** Ключ состояния колонки в chrome.storage.local. */
export const COLUMN_OPEN_KEY = 'flibTranslationColumnOpen';

/**
 * ⚠️ Решение принимается по ДОСТИГНУТОЙ ширине, которую вернул фронтенд.
 * Дисплей живёт в iframe: его window.innerWidth — ширина попапа, и считать по
 * нему значило бы всегда получать stack.
 * @param {{achievedWidth: number, valid: boolean, minColumnWidth: number}} details
 * @returns {'columns'|'stack'}
 */
export function chooseLayout({achievedWidth, valid, minColumnWidth}) {
    if (!valid) {
        return 'stack';
    }
    return achievedWidth / 2 >= minColumnWidth ? 'columns' : 'stack';
}

export class DisplayTranslation {
    /**
     * @param {import('./display.js').Display} display
     */
    constructor(display) {
        /** @type {import('./display.js').Display} */
        this._display = display;
        /** @type {boolean} */
        this._open = false;
        /** @type {Set<number>} */
        this._revealed = new Set();
        /** @type {'columns'|'stack'} */
        this._layout = 'stack';
        /** @type {boolean} */
        this._strict = false;
        /** @type {?HTMLButtonElement} */
        this._button = null;
        /** @type {Map<HTMLElement, import('dictionary').TermDictionaryEntry>} */
        this._entries = new Map();
        // ⚠️ Токен-поколение для _applyState (по образцу
        // _updateDictionaryEntryDetailsToken в display-anki.js): метод асинхронный
        // и зовётся из трёх источников (contentUpdateComplete, storage.onChanged,
        // _toggle) — без токена два перекрывшихся вызова могут завершиться в
        // обратном порядке и оставить this._layout от устаревшего ответа.
        /** @type {?import('core').TokenObject} */
        this._applyStateToken = null;
    }

    /** @returns {boolean} */
    get isOpen() {
        return this._open;
    }

    /** Подписки и стартовое состояние. */
    prepare() {
        this._display.on('contentClear', () => {
            this._revealed.clear();
            this._entries.clear();
        });
        // ⚠️ contentUpdateEntry (display.js:2417) даёт {dictionaryEntry, element,
        // index} — узел и его статью, без сопоставления по порядковому номеру.
        this._display.on('contentUpdateEntry', (details) => {
            this._onContentUpdateEntry(details);
        });
        this._display.on('contentUpdateComplete', () => {
            void this._onContentUpdateComplete();
        });
        // ⚠️ Состояние меняется в ЛЮБОЙ вкладке: без подписки вкладка, чей
        // Display уже подготовлен, не узнает о нажатии Ru в соседней (ТЗ A21).
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !Object.hasOwn(changes, COLUMN_OPEN_KEY)) {
                return;
            }
            this._open = changes[COLUMN_OPEN_KEY].newValue === true;
            void this._applyState();
        });
        void this._loadOpenState();
    }

    /** @returns {Promise<void>} */
    async _loadOpenState() {
        try {
            const stored = await chrome.storage.local.get([COLUMN_OPEN_KEY]);
            this._open = stored[COLUMN_OPEN_KEY] === true;
        } catch (e) {
            this._open = false;
        }
    }

    /**
     * Кнопка показывается, только когда пара словарей пригодна к работе.
     * @returns {Promise<boolean>}
     */
    async _shouldShowButton() {
        const options = this._display.getOptions();
        if (options === null) {
            return false;
        }
        // ⚠️ В режимах split/merge словари не сливаются в одну статью, и хозяина
        // для перевода не найти никогда — кнопки быть не должно.
        if (options.general.resultOutputMode !== 'group') {
            return false;
        }
        // ⚠️ Только term-выдача сливает статьи в одну сущность с хозяином и
        // переводом; на kanji/phrase/unloaded переводить нечего — тот же гейт
        // по типу контента, что у CheckWords (display-anki.js:1561-1562).
        if (this._display.contentType !== 'terms') {
            return false;
        }
        const info = await this._display.application.api.getDictionaryInfo();
        return info.some((d) => d.title === options.flibTranslation.translationDictionary);
    }

    /** @returns {Promise<void>} */
    async _onContentUpdateComplete() {
        const options = this._display.getOptions();
        if (options === null) {
            return;
        }
        if (!(await this._shouldShowButton())) {
            await this._removeButton();
            return;
        }
        const info = await this._display.application.api.getDictionaryInfo();
        this._strict = isStrictPairingAvailable(info, options.flibTranslation);
        if (!this._strict) {
            log.warn(new Error('flib: dictionary build fingerprints differ, translations shown unpaired'));
        }
        this._ensureButton(options.flibTranslation.buttonLabel);
        await this._applyState();
    }

    /**
     * ⚠️ Размер ПЕРЕЗАПРАШИВАЕТСЯ на каждой выдаче: popup._show() сбрасывает
     * размер фрейма при каждом показе (popup.js:737), поэтому «раз раздвинули и
     * держится» — неверная посылка.
     * @returns {Promise<void>}
     */
    async _applyState() {
        const options = this._display.getOptions();
        if (options === null || this._button === null) {
            return;
        }
        /** @type {import('core').TokenObject} */
        const token = {};
        this._applyStateToken = token;
        this._button.setAttribute('aria-pressed', this._open ? 'true' : 'false');
        if (!this._open) {
            await this._display.invokeContentOrigin('frontendReleasePopupSize', {owner: 'translation-column'}).catch(() => {});
            if (this._applyStateToken !== token) {
                return;
            }
            this._layout = 'stack';
            this._renderColumns();
            return;
        }
        const base = options.general.popupWidth;
        const achieved = await this._display.invokeContentOrigin('frontendRequestPopupSize', {
            owner: 'translation-column',
            minWidth: base * 2,
            minHeight: 0,
        }).catch(() => ({width: 0, height: 0, valid: false}));
        if (this._applyStateToken !== token) {
            return;
        }
        this._layout = chooseLayout({
            achievedWidth: achieved.width,
            valid: achieved.valid,
            minColumnWidth: MIN_COLUMN_WIDTH,
        });
        this._renderColumns();
    }

    /**
     * ⚠️ Живёт в правом слоте ОБЩЕЙ панели (`.popup-toolbar-actions`,
     * popup-toolbar.js), а не в собственном баре: у DisplayAnki уже была своя
     * панель над #dictionary-entries (теги + CheckWords + плотность видео), и
     * отдельный `insertBefore(bar, entries)` здесь ставил ВТОРУЮ строку рядом
     * с первой при любом обычном поиске термина — не край, а обычный случай.
     * Слот `.popup-toolbar-actions` для этого и предназначен (margin-left:
     * auto, «right slot» — display-anki.js:1422-1426).
     * @param {string} label
     */
    _ensureButton(label) {
        if (this._button !== null) {
            this._button.textContent = label;
            this._button.hidden = false;
            return;
        }
        const toolbar = ensurePopupToolbar();
        if (toolbar === null) {
            return;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'translation-toolbar-button';
        button.dataset.action = 'show-translation';
        button.setAttribute('aria-pressed', 'false');
        button.title = 'Показать перевод';
        button.textContent = label;
        button.addEventListener('click', () => {
            void this._toggle();
        });
        toolbar.actions.appendChild(button);
        this._button = button;
    }

    /**
     * Прячет кнопку (элемент переиспользуется, не пересоздаётся) и, если
     * колонка была раскрыта, освобождает требование к ширине попапа.
     *
     * ⚠️ Порядок обязателен: релиз ДО того, как кнопка станет недоступна.
     * Иначе (отключили словарь переводов, переключили resultOutputMode,
     * ушли на kanji/phrase) кнопка исчезает, а frontendReleasePopupSize
     * никогда не зовётся — требование остаётся висеть в PopupSizeRegistry
     * фронтенда, попап остаётся раздутым, а UI для отката больше нет.
     * `_applyState` тут не спасает: он выходит по `this._button === null`
     * ещё до попытки релиза.
     * @returns {Promise<void>}
     */
    async _removeButton() {
        // ⚠️ Инвалидирует токен _applyState: если рядом ещё летит запрос
        // размера (например, только что нажали Ru, а сюда уже пришёл
        // следующий contentUpdateComplete с kanji-выдачей), его отложенный
        // ответ не должен переписать this._layout после того, как кнопка
        // спрятана и требование освобождено.
        this._applyStateToken = null;
        if (this._open) {
            await this._display.invokeContentOrigin('frontendReleasePopupSize', {owner: 'translation-column'}).catch(() => {});
        }
        this._layout = 'stack';
        if (this._button !== null) {
            this._button.hidden = true;
        }
    }

    /** @returns {Promise<void>} */
    async _toggle() {
        // ⚠️ Нажатие Ru события НЕ шлёт: одно нажатие пометило бы «не знал»
        // разом все статьи слова.
        this._open = !this._open;
        try {
            await chrome.storage.local.set({[COLUMN_OPEN_KEY]: this._open});
        } catch (e) {
            // Приватное окно или очищенное хранилище — состояние живёт в памяти.
        }
        await this._applyState();
    }

    /**
     * @param {import('display').EventArgument<'contentUpdateEntry'>} details
     */
    _onContentUpdateEntry({dictionaryEntry, element}) {
        if (dictionaryEntry.type !== 'term') {
            return;
        }
        this._entries.set(/** @type {HTMLElement} */ (element), dictionaryEntry);
    }

    /** Тело пишет задача 9. */
    _renderColumns() {
        // Task 9
    }
}
