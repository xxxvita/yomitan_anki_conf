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

import {normalizeFlibGatewayUrl, normalizeFlibPersonalKey} from './flib-service-config.js';

/*
 * Хранилище личного ключа Flib и адреса шлюза.
 *
 * ⚠️ C1: НЕ в chrome.storage.local. Там лежат настройки, а в MV3
 * контент-скрипты читают и пишут chrome.storage.local напрямую — редакция
 * ответов optionsGet ключ не защищала. IndexedDB привязана к origin:
 * контент-скрипт работает в origin страницы и эту базу открыть не может, а
 * сервис-воркер и страницы расширения (chrome-extension://<id>) делят одну.
 *
 * Значения ГЛОБАЛЬНЫЕ (не по профилям): импорт файла настроек не может ни
 * подменить шлюз, ни подсунуть ключ, и нет путаницы «ключ в другом профиле».
 *
 * Доступ — только через бэкенд (flibSecretsGet / flibSecretsSet); страницы
 * эту базу напрямую не открывают, поэтому кэш в памяти бэкенда согласован.
 */

export const FLIB_SECRETS_DB_NAME = 'flib-secrets';

export const FLIB_SECRETS_DB_VERSION = 1;

const STORE_NAME = 'secrets';

const RECORD_ID = 'flibService';

/**
 * @typedef {object} FlibSecrets
 * @property {string} personalKey
 * @property {string} gatewayUrl
 */

/**
 * @param {IDBRequest} request
 * @returns {Promise<unknown>}
 */
function requestToPromise(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => { resolve(request.result); };
        request.onerror = () => { reject(request.error); };
    });
}

/**
 * @param {unknown} value
 * @returns {?FlibSecrets}
 */
function toSecrets(value) {
    if (typeof value !== 'object' || value === null) { return null; }
    const {personalKey, gatewayUrl} = /** @type {{personalKey?: unknown, gatewayUrl?: unknown}} */ (value);
    return {
        personalKey: typeof personalKey === 'string' ? personalKey : '',
        gatewayUrl: typeof gatewayUrl === 'string' ? gatewayUrl : '',
    };
}

export class FlibSecretStore {
    /**
     * @param {{indexedDB?: IDBFactory}} [details] Фабрика IndexedDB; в тестах — fake-indexeddb.
     */
    constructor({indexedDB} = {}) {
        /** @type {?IDBFactory} */
        this._factory = indexedDB ?? null;
        /**
         * Прочитанная запись. Мемоизируется обещание; провал снимается, чтобы
         * одна неудача открытия не глушила ключ до конца жизни воркера.
         * @type {?Promise<?FlibSecrets>}
         */
        this._cache = null;
        /** @type {number} Растёт при каждом set: чтение, начатое раньше, кэш не перезаписывает. */
        this._generation = 0;
    }

    /**
     * Сохранённая запись или null — запись ни разу не писалась (миграция из
     * настроек ещё не прошла).
     * @returns {Promise<?FlibSecrets>}
     */
    getRecord() {
        if (this._cache === null) {
            const generation = this._generation;
            const promise = this._readRecord();
            this._cache = promise;
            promise.catch(() => {
                if (this._cache === promise && this._generation === generation) { this._cache = null; }
            });
        }
        return this._cache;
    }

    /**
     * @returns {Promise<FlibSecrets>} Пустые строки, если записи нет.
     */
    async get() {
        return (await this.getRecord()) ?? {personalKey: '', gatewayUrl: ''};
    }

    /**
     * Сливает `patch` с записью в ОДНОЙ транзакции readwrite: два параллельных
     * частичных set (ключ и адрес) не затирают друг друга.
     *
     * ⚠️ Проверки формата здесь нет — её делает бэкенд (flibSecretsSet).
     * @param {Partial<FlibSecrets>} patch
     * @returns {Promise<FlibSecrets>}
     */
    async set(patch) {
        const generation = ++this._generation;
        this._cache = null;
        const db = await this._open();
        try {
            const transaction = db.transaction([STORE_NAME], 'readwrite');
            const store = transaction.objectStore(STORE_NAME);
            const done = new Promise((resolve, reject) => {
                transaction.oncomplete = () => { resolve(void 0); };
                transaction.onerror = () => { reject(transaction.error); };
                transaction.onabort = () => { reject(transaction.error ?? new Error('Transaction aborted')); };
            });
            /** @type {FlibSecrets} */
            let next = {personalKey: '', gatewayUrl: ''};
            const read = store.get(RECORD_ID);
            read.onsuccess = () => {
                const current = toSecrets(read.result) ?? {personalKey: '', gatewayUrl: ''};
                next = {
                    personalKey: typeof patch.personalKey === 'string' ? patch.personalKey : current.personalKey,
                    gatewayUrl: typeof patch.gatewayUrl === 'string' ? patch.gatewayUrl : current.gatewayUrl,
                };
                store.put({id: RECORD_ID, ...next});
            };
            await done;
            // Кэш — записанное значение, а не повторное чтение: так он не
            // зависит от порядка транзакций. Более поздний set побеждает.
            if (this._generation === generation) { this._cache = Promise.resolve(next); }
            return next;
        } finally {
            db.close();
        }
    }

    // Private

    /**
     * @returns {Promise<?FlibSecrets>}
     */
    async _readRecord() {
        const db = await this._open();
        try {
            const transaction = db.transaction([STORE_NAME], 'readonly');
            return toSecrets(await requestToPromise(transaction.objectStore(STORE_NAME).get(RECORD_ID)));
        } finally {
            db.close();
        }
    }

    /**
     * Соединение на операцию: операций мало (чтение кэшируется), а умершее
     * долгоживущее соединение пришлось бы отслеживать отдельно.
     * @returns {Promise<IDBDatabase>}
     */
    _open() {
        return new Promise((resolve, reject) => {
            const factory = this._factory ?? globalThis.indexedDB;
            const request = factory.open(FLIB_SECRETS_DB_NAME, FLIB_SECRETS_DB_VERSION);
            request.onupgradeneeded = () => {
                const db = request.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME, {keyPath: 'id'});
                }
            };
            request.onsuccess = () => {
                const db = request.result;
                // Чужая версия (обновление расширения) не должна ждать нас.
                db.onversionchange = () => { db.close(); };
                resolve(db);
            };
            request.onerror = () => { reject(request.error); };
            // onblocked не отклоняет: открытие всё равно продолжится и
            // закончится onsuccess/onerror — иначе соединение осталось бы
            // открытым и незакрытым.
        });
    }
}

/**
 * Для показа в настройках: префикс и последние 4 символа. Полный ключ из
 * бэкенда не уходит никуда.
 * @param {string} key
 * @returns {?string} null — ключа нет.
 */
export function maskFlibPersonalKey(key) {
    if (typeof key !== 'string' || key.length === 0) { return null; }
    return `tpk_…${key.slice(-4)}`;
}

/**
 * @param {import('settings').Options} optionsFull
 * @returns {Record<string, unknown>[]} Ветки `flibService`, какими бы они ни были.
 */
function getServiceValues(optionsFull) {
    const profiles = Array.isArray(optionsFull?.profiles) ? optionsFull.profiles : [];
    /** @type {Record<string, unknown>[]} */
    const result = [];
    for (const profile of profiles) {
        const options = /** @type {unknown} */ (profile?.options);
        if (typeof options !== 'object' || options === null || !Object.hasOwn(options, 'flibService')) { continue; }
        result.push(/** @type {Record<string, unknown>} */ (options));
    }
    return result;
}

/**
 * Источник миграции: ПЕРВЫЙ годный непустой ключ и ПЕРВЫЙ годный непустой
 * адрес по профилям (могут быть из разных профилей). Негодные пропускаются.
 * @param {import('settings').Options} optionsFull
 * @returns {FlibSecrets}
 */
export function findFlibSecretsInOptions(optionsFull) {
    let personalKey = '';
    let gatewayUrl = '';
    for (const options of getServiceValues(optionsFull)) {
        const service = /** @type {{personalKey?: unknown, gatewayUrl?: unknown}} */ (options.flibService);
        if (typeof service !== 'object' || service === null) { continue; }
        if (personalKey === '') {
            const key = normalizeFlibPersonalKey(/** @type {string} */ (service.personalKey));
            if (key.valid && key.value !== '') { personalKey = key.value; }
        }
        if (gatewayUrl === '') {
            const url = normalizeFlibGatewayUrl(/** @type {string} */ (service.gatewayUrl));
            if (url.valid && url.value !== '') { gatewayUrl = url.value; }
        }
    }
    return {personalKey, gatewayUrl};
}

/**
 * Стирает ключ и адрес во ВСЕХ профилях (ветка остаётся в схеме, пустой).
 * Мутирует `optionsFull`.
 * @param {import('settings').Options} optionsFull
 * @returns {boolean} true — что-то изменилось и настройки надо сохранить.
 */
export function blankFlibServiceInOptions(optionsFull) {
    let changed = false;
    for (const options of getServiceValues(optionsFull)) {
        const service = /** @type {{personalKey?: unknown, gatewayUrl?: unknown}} */ (options.flibService);
        if (typeof service === 'object' && service !== null && service.personalKey === '' && service.gatewayUrl === '') { continue; }
        options.flibService = {gatewayUrl: '', personalKey: ''};
        changed = true;
    }
    return changed;
}
