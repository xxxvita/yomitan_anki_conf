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
import {pickStorageChanges} from './flib-youtube-storage.js';

/*
 * Бета «панель субтитров на youtube.com»: переключатель в настройках (global.flibYoutube.beta)
 * регистрирует три сценария и внедряет их в уже открытые вкладки.
 *
 * Состояние (D2), всё перечислено:
 * - настройки global.flibYoutube {beta, theme} — источник истины, читаются через applyOptions();
 * - зарегистрированные сценарии браузера (persistAcrossSessions по умолчанию true: переживают
 *   перезапуск браузера и service worker) — сверяются с настройкой при каждом applyOptions()
 *   через getRegisteredContentScripts: недостающие регистрируются, лишние снимаются, дубликата id нет;
 * - chrome.storage.local `flibYoutube.panelVisible` (по умолчанию false) — пишет и читает только этот класс;
 * - chrome.storage.local `flibYt:flib:dusk-variant` — тема для слоя (его синхронное хранилище читает
 *   ключи с префиксом `flibYt:`; код сайта читает `flib:dusk-variant`), пишет только этот класс;
 * - память: `_beta` (применённое значение), `_betaRequested` (последнее из applyOptions, сразу; его
 *   отдают getState() и isEnabled()), `_theme`, `_panelVisible`, `_writtenTheme` (что уже записано),
 *   `_queue` (applyOptions выполняются строго по очереди: два одновременных вызова не дадут
 *   двойной регистрации). Память теряется при засыпании service worker'а — всё восстановимо:
 *   prepare() читает panelVisible, applyOptions() — остальное.
 * Внедрение в открытые вкладки — только когда мы сами что-то зарегистрировали (включение, либо
 * сценарии пропали): после перезапуска браузера вкладки грузятся заново и получают сценарии сами.
 */

const YOUTUBE_MATCH = 'https://www.youtube.com/*';
const PANEL_VISIBLE_KEY = 'flibYoutube.panelVisible';
const THEME_KEY = 'flibYt:flib:dusk-variant';
const THEMES = new Set(['site', 'refined', 'indigo', 'mono']);
const DEFAULT_THEME = 'site';

const KEYS_JS = 'lib/flib-youtube/keys.js';
const BRIDGE_JS = 'lib/flib-youtube/bridge.js';
const PANEL_JS = 'lib/flib-youtube/panel.js';
// Шрифты слой подключает сам (@font-face с адресами chrome.runtime.getURL): относительные url() в CSS
// контент-скрипта считались бы от страницы (youtube.com/fonts/… -> 404).
const PANEL_CSS = ['lib/flib-youtube/panel.css'];

/**
 * Порядок важен: keys.js (изолированный мир) и bridge.js (MAIN) — document_start, до любого
 * сценария YouTube; panel.js — document_idle.
 * @returns {chrome.scripting.RegisteredContentScript[]}
 */
function createScripts() {
    return [
        {id: 'flib-youtube-keys', matches: [YOUTUBE_MATCH], js: [KEYS_JS], runAt: 'document_start'},
        {id: 'flib-youtube-bridge', matches: [YOUTUBE_MATCH], js: [BRIDGE_JS], world: 'MAIN', runAt: 'document_start'},
        {id: 'flib-youtube-panel', matches: [YOUTUBE_MATCH], js: [PANEL_JS], css: [...PANEL_CSS], runAt: 'document_idle'},
    ];
}

const SCRIPT_IDS = createScripts().map((s) => s.id);

export class FlibYoutubeBeta {
    /**
     * @param {typeof chrome} [api] Подменяется в тестах.
     */
    constructor(api = chrome) {
        /** @type {typeof chrome} */
        this._api = api;
        /** @type {boolean} */
        this._beta = false;
        /** @type {string} */
        this._theme = DEFAULT_THEME;
        /** @type {boolean} */
        this._panelVisible = false;
        /** @type {?string} */
        this._writtenTheme = null;
        /** @type {Promise<void>} */
        this._queue = Promise.resolve();
        /** @type {boolean} Значение из последнего applyOptions, сразу (до вызовов браузера). */
        this._betaRequested = false;
    }

    /** Читает запомненную видимость панели. */
    async prepare() {
        try {
            const items = await this._api.storage.local.get(PANEL_VISIBLE_KEY);
            this._panelVisible = items[PANEL_VISIBLE_KEY] === true;
        } catch (e) {
            log.error(e);
        }
    }

    /**
     * Сводит браузер с настройкой. Не бросает; вызовы идут по очереди.
     * @param {?{flibYoutube?: {beta?: unknown, theme?: unknown}}} globalOptions
     * @returns {Promise<void>}
     */
    applyOptions(globalOptions) {
        const block = globalOptions?.flibYoutube;
        const beta = block?.beta === true;
        const theme = (typeof block?.theme === 'string' && THEMES.has(block.theme)) ? block.theme : DEFAULT_THEME;
        this._betaRequested = beta;
        const run = this._queue.then(() => this._apply(beta, theme));
        this._queue = run.catch(() => {});
        return run.catch((e) => { log.error(e); });
    }

    /**
     * @param {boolean} visible
     * @returns {Promise<void>}
     */
    async setPanelVisible(visible) {
        this._panelVisible = visible === true;
        try {
            await this._api.storage.local.set({[PANEL_VISIBLE_KEY]: this._panelVisible});
        } catch (e) {
            log.error(e);
        }
        await this._sendToTabs({action: 'flibYoutubeSetVisible', params: {visible: this._panelVisible}});
    }

    /**
     * chrome.storage.onChanged -> вкладкам YouTube изменения ключей слоя `flibYt:` (сообщение
     * flibYoutubeStorageChanged): так запись одной вкладки видят остальные. Только при включённой бете.
     * @param {Record<string, chrome.storage.StorageChange>} changes
     * @param {string} area
     * @returns {Promise<void>}
     */
    async forwardStorageChanges(changes, area) {
        if (!this._beta) { return; }
        const picked = pickStorageChanges(changes, area);
        if (picked === null) { return; }
        await this._sendToTabs({action: 'flibYoutubeStorageChanged', params: {changes: picked}});
    }

    /**
     * Включена ли бета — по последнему applyOptions, не дожидаясь регистрации. По нему фоновая часть
     * отвечает слою (getState) и пускает его к прокси и хранилищу (I1).
     * @returns {boolean}
     */
    isEnabled() {
        return this._betaRequested;
    }

    /** @returns {{beta: boolean, panelVisible: boolean, theme: string}} */
    getState() {
        return {beta: this._betaRequested, panelVisible: this._panelVisible, theme: this._theme};
    }

    // Private

    /**
     * @param {boolean} beta
     * @param {string} theme
     */
    async _apply(beta, theme) {
        const wasBeta = this._beta;
        const themeChanged = this._writtenTheme !== null && this._writtenTheme !== theme;
        this._beta = beta;
        this._theme = theme;
        const registered = await this._getRegisteredIds();
        if (!beta) {
            // I1: выключение снимает все известные id, а не только те, что вернул запрос (он мог
            // упасть или отстать); то же — если запрос упал или что-то нашёл.
            const known = registered !== null && SCRIPT_IDS.some((id) => registered.has(id));
            if (wasBeta || registered === null || known) {
                await this._unregisterAll();
                await this._sendToTabs({action: 'flibYoutubeStop'});
            }
            return;
        }
        // Тема — до внедрения: первый показ уже видит выбранную.
        if (this._writtenTheme !== theme) { await this._writeTheme(theme); }
        const have = registered ?? new Set();
        const missing = createScripts().filter((s) => !have.has(s.id));
        if (missing.length > 0) {
            let ok = true;
            try {
                await this._api.scripting.registerContentScripts(missing);
            } catch (e) {
                // «Duplicate script ID»: другой вызов или прошлая жизнь worker'а успели раньше — сценарии на месте.
                if (!(e instanceof Error && /duplicate/i.test(e.message))) {
                    ok = false;
                    log.error(e);
                }
            }
            if (ok) { await this._injectIntoOpenTabs(); }
        } else if (themeChanged) {
            await this._sendToTabs({action: 'flibYoutubeRemount'});
        }
    }

    /** @returns {Promise<?Set<string>>} null — запрос не удался. */
    async _getRegisteredIds() {
        try {
            const list = await this._api.scripting.getRegisteredContentScripts({ids: SCRIPT_IDS});
            return new Set(list.map((s) => s.id));
        } catch (e) {
            log.error(e);
            return null;
        }
    }

    /**
     * Снимает все три сценария, по одному: браузер отклоняет весь вызов, если хоть одного id нет.
     */
    async _unregisterAll() {
        for (const id of SCRIPT_IDS) {
            try {
                await this._api.scripting.unregisterContentScripts({ids: [id]});
            } catch (e) {
                if (!(e instanceof Error && /nonexistent/i.test(e.message))) { log.error(e); }
            }
        }
    }

    /** @param {string} theme */
    async _writeTheme(theme) {
        try {
            await this._api.storage.local.set({[THEME_KEY]: theme});
            this._writtenTheme = theme;
        } catch (e) {
            log.error(e);
        }
    }

    /** @returns {Promise<number[]>} */
    async _getTabIds() {
        try {
            const tabs = await this._api.tabs.query({url: YOUTUBE_MATCH});
            /** @type {number[]} */
            const ids = [];
            for (const {id} of tabs) {
                if (typeof id === 'number') { ids.push(id); }
            }
            return ids;
        } catch (e) {
            log.error(e);
            return [];
        }
    }

    /**
     * Ошибка «нет приёмника» (вкладка без слоя) — не ошибка.
     * @param {{action: string, params?: unknown}} message
     */
    async _sendToTabs(message) {
        const ids = await this._getTabIds();
        await Promise.all(ids.map(async (id) => {
            try {
                await this._api.tabs.sendMessage(id, message);
            } catch (_) {
                // Вкладка без слоя или закрылась.
            }
        }));
    }

    /** Внедряет три сценария в открытые вкладки YouTube: сначала ворота клавиш и мост. */
    async _injectIntoOpenTabs() {
        const ids = await this._getTabIds();
        await Promise.all(ids.map(async (tabId) => {
            const target = {tabId};
            try {
                // Порядок: ворота клавиш и мост до панели.
                await this._api.scripting.executeScript({target, files: [KEYS_JS]});
                await this._api.scripting.executeScript({target, files: [BRIDGE_JS], world: 'MAIN'});
                await this._api.scripting.insertCSS({target, files: [...PANEL_CSS]});
                await this._api.scripting.executeScript({target, files: [PANEL_JS]});
            } catch (_) {
                // Вкладка закрылась или недоступна: следующая загрузка получит сценарии сама.
            }
        }));
    }
}
