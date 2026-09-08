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
import {redactFlibSecrets} from '../ext/js/data/flib-secrets.js';

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
