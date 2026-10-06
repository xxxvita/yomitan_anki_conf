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

import {describe, expect, test, vi} from 'vitest';

// `../../../lib/dexie.js` (imported transitively via backup-controller.js -> dexie-export-import)
// reaches for the browser global `self` at module-evaluation time. Stub it before the module is
// loaded, which requires a dynamic import rather than a static one (static imports are linked
// before any statement in this file runs).
vi.stubGlobal('self', globalThis);
const {BackupController} = await import('../ext/js/pages/settings/backup-controller.js');
const {DictionaryController} = await import('../ext/js/pages/settings/dictionary-controller.js');

/** @typedef {import('../ext/js/pages/settings/backup-controller.js').BackupController} BackupControllerType */

/**
 * Голый BackupController с подменёнными settingsController/chrome, ради изоляции
 * приватного метода _getSettingsExportData от DOM/ThemeController, которые
 * настоящий конструктор требует.
 * @param {string} personalKey
 * @returns {BackupControllerType}
 */
function makeBackupController(personalKey) {
    vi.stubGlobal('chrome', {
        runtime: {
            getURL: () => 'chrome-extension://test/',
            getManifest: () => (/** @type {*} */ ({})),
        },
        permissions: {
            getAll: (/** @type {(result: *) => void} */ callback) => callback({permissions: [], origins: []}),
        },
    });

    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const backupController = /** @type {BackupControllerType} */ (Object.create(BackupController.prototype));
    // eslint-disable-next-line no-underscore-dangle
    backupController._currentVersion = 1;
    // eslint-disable-next-line no-underscore-dangle
    backupController._settingsController = /** @type {*} */ ({
        getOptionsFull: async () => ({
            profiles: [{
                options: {
                    anki: {fieldTemplates: null},
                    flibService: {gatewayUrl: 'https://gw', personalKey},
                },
            }],
        }),
        application: {
            api: {
                getEnvironmentInfo: async () => (/** @type {*} */ ({})),
                getDefaultAnkiFieldTemplates: async () => null,
            },
        },
    });
    return backupController;
}

describe('_getSettingsExportData', () => {
    test('личный ключ вычищен из выгрузки, адрес шлюза сохранён', async () => {
        const backupController = makeBackupController('tpk_secret');
        // eslint-disable-next-line no-underscore-dangle
        const data = await backupController._getSettingsExportData(new Date());
        expect(data.options.profiles[0].options.flibService.personalKey).toBe('');
        expect(data.options.profiles[0].options.flibService.gatewayUrl).toBe('https://gw');
    });
});

const KEY_CURRENT = `tpk_${'1'.repeat(32)}`;
const KEY_IMPORTED = `tpk_${'2'.repeat(32)}`;

/**
 * Прогоняет настоящий `_importSettingsFile` на голом контроллере: файл, миграция,
 * окно предупреждений и словари подменены, а сохранение перехвачено — проверяется,
 * ЧТО ушло бы в setAllSettings. Санитизация НАСТОЯЩАЯ.
 * @param {{importedKey: string, currentKey: string, importedUrl?: string, currentUrl?: string, sanitize?: boolean}} details
 * @returns {Promise<{saved: {gatewayUrl: string, personalKey: string}, warnings: string[]}>} `saved` — ветка flibService первого профиля.
 */
async function runImport({importedKey, currentKey, importedUrl = '', currentUrl = '', sanitize = true}) {
    vi.spyOn(DictionaryController, 'ensureDictionarySettings').mockResolvedValue(void 0);
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const backupController = /** @type {BackupControllerType} */ (Object.create(BackupController.prototype));
    /** @type {?{profiles: {options: {flibService: {gatewayUrl: string, personalKey: string}}}[]}} */
    let saved = null;
    /** @type {string[]} */
    const warnings = [];
    const fileData = {
        version: 1,
        options: {profiles: [{options: {flibService: {gatewayUrl: importedUrl, personalKey: importedKey}}}]},
    };
    const bytes = new TextEncoder().encode(JSON.stringify(fileData));
    /* eslint-disable no-underscore-dangle */
    backupController._currentVersion = 1;
    backupController._optionsUtil = /** @type {*} */ ({update: async (/** @type {unknown} */ value) => value});
    backupController._readFileArrayBuffer = async () => bytes.buffer;
    backupController._showSettingsImportWarnings = async (/** @type {Set<string>} */ set) => {
        warnings.push(...set);
        return {result: true, sanitize};
    };
    backupController._settingsImportSetOptionsFull = async (/** @type {unknown} */ value) => { saved = /** @type {*} */ (value); };
    backupController._settingsController = /** @type {*} */ ({
        getOptionsFull: async () => ({
            profiles: [{options: {flibService: {gatewayUrl: currentUrl, personalKey: currentKey}}}],
        }),
    });
    await backupController._importSettingsFile(/** @type {File} */ (/** @type {unknown} */ ({})));
    /* eslint-enable no-underscore-dangle */
    if (saved === null) { throw new Error('nothing saved'); }
    return {saved: /** @type {{profiles: {options: {flibService: {gatewayUrl: string, personalKey: string}}}[]}} */ (saved).profiles[0].options.flibService, warnings};
}

describe('_importSettingsFile', () => {
    test('пустой ключ в файле не затирает текущий', async () => {
        const {saved, warnings} = await runImport({importedKey: '', currentKey: KEY_CURRENT});
        expect(saved.personalKey).toBe(KEY_CURRENT);
        expect(warnings).toEqual([]);
    });
    test('непустой ключ в файле перезаписывает текущий', async () => {
        const {saved} = await runImport({importedKey: KEY_IMPORTED, currentKey: KEY_CURRENT});
        expect(saved.personalKey).toBe(KEY_IMPORTED);
    });
    test('H1: чужой адрес в файле — предупреждение, адрес сброшен, текущий ключ НЕ передан', async () => {
        const {saved, warnings} = await runImport({importedKey: '', currentKey: KEY_CURRENT, importedUrl: 'https://evil.example'});
        expect(warnings.some((w) => w.includes('flibService.gatewayUrl'))).toBe(true);
        expect(saved.gatewayUrl).toBe('');
        // Адрес сброшен к серверу по умолчанию, тот же, что у текущего профиля, — ключ
        // переносится уже на cache.flib.club, а не на evil.example.
        expect(saved.personalKey).toBe(KEY_CURRENT);
    });
    test('H1: чужой адрес и отказ от санитизации — адрес остаётся, но ключ НЕ переносится', async () => {
        const {saved} = await runImport({importedKey: '', currentKey: KEY_CURRENT, importedUrl: 'https://evil.example', sanitize: false});
        expect(saved.gatewayUrl).toBe('https://evil.example');
        expect(saved.personalKey).toBe('');
    });
    test('M2: кривой ключ в файле — предупреждение, остаётся текущий ключ', async () => {
        const {saved, warnings} = await runImport({importedKey: 'tpk_bad', currentKey: KEY_CURRENT});
        expect(warnings.some((w) => w.includes('flibService.personalKey'))).toBe(true);
        expect(saved.personalKey).toBe(KEY_CURRENT);
    });
});
