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
import {preserveFlibKeysOnImport, redactFlibSecrets} from '../ext/js/data/flib-secrets.js';

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
 * @param {unknown[]} keys
 * @returns {{profiles: {options: {flibService: {gatewayUrl: string, personalKey: unknown}}}[]}}
 */
const makeFull = (keys) => ({
    profiles: keys.map((personalKey) => ({options: {flibService: {gatewayUrl: '', personalKey}}})),
});

/**
 * @param {{profiles: {options: {flibService: {personalKey: unknown}}}[]}} full
 * @returns {unknown[]}
 */
const keysOf = (full) => full.profiles.map((p) => p.options.flibService.personalKey);

describe('preserveFlibKeysOnImport', () => {
    test('пустой ключ в импорте не затирает текущий (по индексу профиля)', () => {
        const imported = makeFull(['', '']);
        preserveFlibKeysOnImport(imported, makeFull([KEY_A, KEY_B]));
        expect(keysOf(imported)).toEqual([KEY_A, KEY_B]);
    });
    test('непустой ключ в импорте побеждает текущий', () => {
        const imported = makeFull([KEY_C, '']);
        preserveFlibKeysOnImport(imported, makeFull([KEY_A, KEY_B]));
        expect(keysOf(imported)).toEqual([KEY_C, KEY_B]);
    });
    test('ключ из одних пробелов считается пустым', () => {
        const imported = makeFull(['   ']);
        preserveFlibKeysOnImport(imported, makeFull([KEY_A]));
        expect(keysOf(imported)).toEqual([KEY_A]);
    });
    test('число профилей разное → берётся ключ текущего профиля 0', () => {
        const imported = makeFull(['', '', '']);
        preserveFlibKeysOnImport(imported, makeFull([KEY_A, KEY_B]));
        expect(keysOf(imported)).toEqual([KEY_A, KEY_A, KEY_A]);
    });
    test('текущий ключ тоже пуст → в импорте остаётся пусто', () => {
        const imported = makeFull(['']);
        preserveFlibKeysOnImport(imported, makeFull(['']));
        expect(keysOf(imported)).toEqual(['']);
    });
    test('кривые формы не роняют функцию', () => {
        expect(() => preserveFlibKeysOnImport({profiles: [null, {}, {options: {}}]}, makeFull([KEY_A]))).not.toThrow();
        expect(() => preserveFlibKeysOnImport({profiles: 'x'}, makeFull([KEY_A]))).not.toThrow();
        expect(() => preserveFlibKeysOnImport(makeFull(['']), null)).not.toThrow();
        expect(() => preserveFlibKeysOnImport(makeFull(['']), {profiles: [{options: {flibService: 5}}]})).not.toThrow();
    });
    test('профиль импорта без flibService ветку не заводит', () => {
        const imported = {profiles: [{options: {}}]};
        preserveFlibKeysOnImport(imported, makeFull([KEY_A]));
        expect(imported).toEqual({profiles: [{options: {}}]});
    });
});
