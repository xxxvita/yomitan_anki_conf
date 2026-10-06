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

import {describe, expect, test} from 'vitest';
import {getFlibServiceImportWarnings, reconcileFlibServiceOnImport, redactFlibSecrets} from '../ext/js/data/flib-secrets.js';

const makeOptions = () => ({
    profiles: [
        {
            options: {
                flibService: {gatewayUrl: 'https://gw', personalKey: 'tpk_secret'},
            },
        },
    ],
});

describe('redactFlibSecrets', () => {
    test('личный ключ вычищен', () => {
        expect(redactFlibSecrets(makeOptions()).profiles[0].options.flibService.personalKey).toBe('');
    });
    test('адрес шлюза сохранён', () => {
        expect(redactFlibSecrets(makeOptions()).profiles[0].options.flibService.gatewayUrl).toBe('https://gw');
    });
    test('исходный объект НЕ изменён', () => {
        const source = makeOptions();
        redactFlibSecrets(source);
        expect(source.profiles[0].options.flibService.personalKey).toBe('tpk_secret');
    });
    test('профиль без flibService не ломает функцию', () => {
        expect(() => redactFlibSecrets({profiles: [{options: {}}]})).not.toThrow();
    });

    test('битый профиль обработан, а СОСЕДНИЕ по массиву — вычищены', () => {
        // ⚠️ Проверка «не бросает» была бы зелёной и у полного no-op. Здесь
        // утверждается, что остальные профили того же массива действительно
        // вычищены, и что ни один вид ключа не пережил вызов.
        const result = /** @type {{profiles: {options?: {flibService?: {personalKey?: string}}}[]}} */ (
            /** @type {unknown} */ (redactFlibSecrets({
                profiles: [
                    {options: {flibService: {gatewayUrl: 'https://gw', personalKey: 'tpk_first'}}},
                    {options: {}},
                    null,
                    {},
                    {options: {flibService: 'tpk_inline'}},
                    {options: {flibService: {gatewayUrl: 'https://gw', personalKey: 'tpk_last'}}},
                ],
            }))
        );

        expect(result.profiles[0].options?.flibService?.personalKey).toBe('');
        expect(result.profiles[5].options?.flibService?.personalKey).toBe('');
        expect(JSON.stringify(result)).not.toContain('tpk_');
    });

    test('profiles не массив — отказ закрытый: выгрузка не отдаётся вовсе', () => {
        // ⚠️ Раньше эта форма возвращала клон КАК ЕСТЬ, вместе с ключом.
        expect(() => redactFlibSecrets({
            profiles: {options: {flibService: {personalKey: 'tpk_secret'}}},
        })).toThrow();
    });

    test('profiles отсутствует — тоже отказ, а не тихий пропуск', () => {
        expect(() => redactFlibSecrets({version: 1})).toThrow();
    });
});

const KEY_A = `tpk_${'a'.repeat(32)}`;
const KEY_B = `tpk_${'b'.repeat(32)}`;
const KEY_C = `tpk_${'c'.repeat(32)}`;

/**
 * @typedef {{options: {flibService: {gatewayUrl: unknown, personalKey: unknown}}}} TestProfile
 */

/**
 * @param {unknown[]} keys
 * @param {unknown[]} [urls]
 * @returns {{profiles: TestProfile[]}}
 */
const makeFull = (keys, urls = []) => ({
    profiles: keys.map((personalKey, i) => ({options: {flibService: {gatewayUrl: urls[i] ?? '', personalKey}}})),
});

/**
 * @param {{profiles: TestProfile[]}} full
 * @returns {unknown[]}
 */
const keysOf = (full) => full.profiles.map((p) => p.options.flibService.personalKey);

/**
 * @param {{profiles: TestProfile[]}} full
 * @returns {unknown[]}
 */
const urlsOf = (full) => full.profiles.map((p) => p.options.flibService.gatewayUrl);

describe('reconcileFlibServiceOnImport', () => {
    test('пустой ключ в импорте не затирает текущий (по индексу профиля)', () => {
        const imported = makeFull(['', '']);
        reconcileFlibServiceOnImport(imported, makeFull([KEY_A, KEY_B]));
        expect(keysOf(imported)).toEqual([KEY_A, KEY_B]);
    });
    test('непустой ключ в импорте побеждает текущий', () => {
        const imported = makeFull([KEY_C, '']);
        reconcileFlibServiceOnImport(imported, makeFull([KEY_A, KEY_B]));
        expect(keysOf(imported)).toEqual([KEY_C, KEY_B]);
    });
    test('ключ импорта с пробелами вокруг срезается', () => {
        const imported = makeFull([` ${KEY_C} `]);
        reconcileFlibServiceOnImport(imported, makeFull([KEY_A]));
        expect(keysOf(imported)).toEqual([KEY_C]);
    });
    test('ключ из одних пробелов считается пустым', () => {
        const imported = makeFull(['   ']);
        reconcileFlibServiceOnImport(imported, makeFull([KEY_A]));
        expect(keysOf(imported)).toEqual([KEY_A]);
    });
    test('число профилей разное → берётся ключ текущего профиля 0', () => {
        const imported = makeFull(['', '', '']);
        reconcileFlibServiceOnImport(imported, makeFull([KEY_A, KEY_B]));
        expect(keysOf(imported)).toEqual([KEY_A, KEY_A, KEY_A]);
    });
    test('текущий ключ тоже пуст → в импорте остаётся пусто', () => {
        const imported = makeFull(['']);
        reconcileFlibServiceOnImport(imported, makeFull(['']));
        expect(keysOf(imported)).toEqual(['']);
    });
    test('H1: файл с чужим адресом и пустым ключом НЕ получает текущий ключ', () => {
        const imported = makeFull([''], ['https://evil.example']);
        reconcileFlibServiceOnImport(imported, makeFull([KEY_A]));
        expect(keysOf(imported)).toEqual(['']);
    });
    test('H1: тот же сервер в другой записи (пусто ↔ wss://cache) — ключ переносится', () => {
        const imported = makeFull([''], ['wss://cache.flib.club/']);
        reconcileFlibServiceOnImport(imported, makeFull([KEY_A], ['']));
        expect(keysOf(imported)).toEqual([KEY_A]);
    });
    test('H1: текущий профиль на localhost, файл на cache.flib.club — ключ не переносится', () => {
        const imported = makeFull([''], ['']);
        reconcileFlibServiceOnImport(imported, makeFull([KEY_A], ['http://localhost:8080']));
        expect(keysOf(imported)).toEqual(['']);
    });
    test('M2: кривой ключ в файле → текущий ключ (сервер тот же)', () => {
        const imported = makeFull(['tpk_bad']);
        reconcileFlibServiceOnImport(imported, makeFull([KEY_A]));
        expect(keysOf(imported)).toEqual([KEY_A]);
    });
    test('M2: кривой ключ в файле и чужой сервер → пусто', () => {
        const imported = makeFull([`tpk_${'A'.repeat(32)}`], ['https://evil.example']);
        reconcileFlibServiceOnImport(imported, makeFull([KEY_A]));
        expect(keysOf(imported)).toEqual(['']);
    });
    test('M2: кривой адрес в файле → текущий адрес, ключ переносится', () => {
        const imported = makeFull([''], ['http://evil.example']);
        reconcileFlibServiceOnImport(imported, makeFull([KEY_A], ['https://gw.flib.club']));
        expect(urlsOf(imported)).toEqual(['https://gw.flib.club']);
        expect(keysOf(imported)).toEqual([KEY_A]);
    });
    test('M2: кривой адрес и в файле, и в текущих → пусто', () => {
        const imported = makeFull([''], [42]);
        reconcileFlibServiceOnImport(imported, makeFull([''], ['ftp://x']));
        expect(urlsOf(imported)).toEqual(['']);
    });
    test('годный адрес из файла срезается', () => {
        const imported = makeFull([''], ['  https://gw.flib.club/ ']);
        reconcileFlibServiceOnImport(imported, makeFull(['']));
        expect(urlsOf(imported)).toEqual(['https://gw.flib.club/']);
    });
    test('кривые формы не роняют функцию', () => {
        expect(() => reconcileFlibServiceOnImport({profiles: [null, {}, {options: {}}]}, makeFull([KEY_A]))).not.toThrow();
        expect(() => reconcileFlibServiceOnImport({profiles: 'x'}, makeFull([KEY_A]))).not.toThrow();
        expect(() => reconcileFlibServiceOnImport(makeFull(['']), null)).not.toThrow();
        expect(() => reconcileFlibServiceOnImport(makeFull(['']), {profiles: [{options: {flibService: 5}}]})).not.toThrow();
    });
    test('профиль импорта без flibService ветку не заводит', () => {
        const imported = {profiles: [{options: {}}]};
        reconcileFlibServiceOnImport(imported, makeFull([KEY_A]));
        expect(imported).toEqual({profiles: [{options: {}}]});
    });
});

describe('getFlibServiceImportWarnings', () => {
    test('адрес flib.club, localhost и пустой — без предупреждений', () => {
        for (const gatewayUrl of ['', 'https://cache.flib.club', 'wss://gw.flib.club', 'http://localhost:8080']) {
            expect(getFlibServiceImportWarnings({gatewayUrl, personalKey: KEY_A}, false)).toEqual([]);
        }
    });
    test('H1: чужой хост — предупреждение и сброс в пусто', () => {
        const service = {gatewayUrl: 'https://evil.example', personalKey: ''};
        expect(getFlibServiceImportWarnings(service, false)).toHaveLength(1);
        expect(service.gatewayUrl).toBe('');
    });
    test('сухой прогон только предупреждает', () => {
        const service = {gatewayUrl: 'https://evil.example', personalKey: ''};
        expect(getFlibServiceImportWarnings(service, true)).toHaveLength(1);
        expect(service.gatewayUrl).toBe('https://evil.example');
    });
    test('M2: кривой адрес и кривой ключ — по предупреждению', () => {
        const warnings = getFlibServiceImportWarnings({gatewayUrl: 'http://evil.example', personalKey: 'tpk_bad'}, true);
        expect(warnings).toHaveLength(2);
    });
    test('предупреждения не содержат значения ключа', () => {
        const warnings = getFlibServiceImportWarnings({gatewayUrl: '', personalKey: 'tpk_bad_secret_value'}, true);
        expect(warnings.join(' ')).not.toContain('tpk_bad_secret_value');
    });
    test('не объект — без предупреждений и без падения', () => {
        expect(getFlibServiceImportWarnings(null, false)).toEqual([]);
    });
});
