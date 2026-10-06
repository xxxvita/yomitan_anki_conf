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
import {
    FLIB_GATEWAY_DEFAULT_BASE,
    isTrustedFlibGatewayUrl,
    normalizeFlibGatewayUrl,
    normalizeFlibPersonalKey,
    resolveFlibGatewayBase,
} from '../ext/js/data/flib-service-config.js';

const FAKE_KEY = `tpk_${'0'.repeat(32)}`;

describe('normalizeFlibPersonalKey', () => {
    test('пустая строка допустима (ключ снят)', () => {
        expect(normalizeFlibPersonalKey('')).toEqual({valid: true, value: ''});
    });
    test('одни пробелы — тоже пусто', () => {
        expect(normalizeFlibPersonalKey('   \t ')).toEqual({valid: true, value: ''});
    });
    test('корректный ключ принимается', () => {
        expect(normalizeFlibPersonalKey(FAKE_KEY)).toEqual({valid: true, value: FAKE_KEY});
    });
    test('пробелы вокруг ключа срезаются до проверки', () => {
        expect(normalizeFlibPersonalKey(`  ${FAKE_KEY}\n`)).toEqual({valid: true, value: FAKE_KEY});
    });
    test('чужой префикс отвергается', () => {
        expect(normalizeFlibPersonalKey(`tpx_${'0'.repeat(32)}`).valid).toBe(false);
    });
    test('заглавные hex отвергаются (шлюз сверяет строчные)', () => {
        expect(normalizeFlibPersonalKey(`tpk_${'A'.repeat(32)}`).valid).toBe(false);
    });
    test('неверная длина отвергается', () => {
        expect(normalizeFlibPersonalKey(`tpk_${'0'.repeat(31)}`).valid).toBe(false);
        expect(normalizeFlibPersonalKey(`tpk_${'0'.repeat(33)}`).valid).toBe(false);
    });
    test('пробел внутри ключа отвергается', () => {
        expect(normalizeFlibPersonalKey(`tpk_${'0'.repeat(16)} ${'0'.repeat(16)}`).valid).toBe(false);
    });
    test('не строка отвергается', () => {
        expect(normalizeFlibPersonalKey(/** @type {*} */ (null)).valid).toBe(false);
    });
});

describe('resolveFlibGatewayBase', () => {
    test('пусто → адрес по умолчанию', () => {
        expect(resolveFlibGatewayBase('')).toBe(FLIB_GATEWAY_DEFAULT_BASE);
        expect(resolveFlibGatewayBase('   ')).toBe(FLIB_GATEWAY_DEFAULT_BASE);
        expect(FLIB_GATEWAY_DEFAULT_BASE).toBe('https://cache.flib.club');
    });
    test('wss:// → https://', () => {
        expect(resolveFlibGatewayBase('wss://gw.example.org')).toBe('https://gw.example.org');
    });
    test('ws:// → http://', () => {
        expect(resolveFlibGatewayBase('ws://localhost:8080')).toBe('http://localhost:8080');
    });
    test('схема распознаётся без учёта регистра', () => {
        expect(resolveFlibGatewayBase('WSS://gw.example.org')).toBe('https://gw.example.org');
    });
    test('хвостовой слэш срезается', () => {
        expect(resolveFlibGatewayBase('https://gw.example.org/')).toBe('https://gw.example.org');
        expect(resolveFlibGatewayBase('wss://gw.example.org//')).toBe('https://gw.example.org');
    });
    test('пробелы вокруг срезаются', () => {
        expect(resolveFlibGatewayBase('  https://gw.example.org  ')).toBe('https://gw.example.org');
    });
    test('путь сохраняется', () => {
        expect(resolveFlibGatewayBase('https://gw.example.org/prefix/')).toBe('https://gw.example.org/prefix');
    });
    test('мусор и чужие схемы → адрес по умолчанию', () => {
        expect(resolveFlibGatewayBase('not a url')).toBe(FLIB_GATEWAY_DEFAULT_BASE);
        expect(resolveFlibGatewayBase('ftp://gw.example.org')).toBe(FLIB_GATEWAY_DEFAULT_BASE);
        expect(resolveFlibGatewayBase('javascript:alert(1)')).toBe(FLIB_GATEWAY_DEFAULT_BASE);
    });
    test('не строка → адрес по умолчанию', () => {
        expect(resolveFlibGatewayBase(/** @type {*} */ (void 0))).toBe(FLIB_GATEWAY_DEFAULT_BASE);
    });
    test('H3: открытый http/ws на нелокальный хост → адрес по умолчанию', () => {
        expect(resolveFlibGatewayBase('http://gw.example.org')).toBe(FLIB_GATEWAY_DEFAULT_BASE);
        expect(resolveFlibGatewayBase('ws://gw.example.org')).toBe(FLIB_GATEWAY_DEFAULT_BASE);
        expect(resolveFlibGatewayBase('http://127.0.0.1:8080/')).toBe('http://127.0.0.1:8080');
        expect(resolveFlibGatewayBase('ws://[::1]:8080')).toBe('http://[::1]:8080');
    });
});

describe('normalizeFlibGatewayUrl', () => {
    test('пусто допустимо', () => {
        expect(normalizeFlibGatewayUrl('  ')).toEqual({valid: true, value: ''});
    });
    test('http/https/ws/wss допустимы, значение срезано, но не переписано', () => {
        expect(normalizeFlibGatewayUrl(' https://gw.example.org/ ')).toEqual({valid: true, value: 'https://gw.example.org/'});
        expect(normalizeFlibGatewayUrl('http://localhost:8080').valid).toBe(true);
        expect(normalizeFlibGatewayUrl('wss://gw.example.org')).toEqual({valid: true, value: 'wss://gw.example.org'});
        expect(normalizeFlibGatewayUrl('ws://127.0.0.1:9000').valid).toBe(true);
        expect(normalizeFlibGatewayUrl('http://[::1]:8080').valid).toBe(true);
    });
    test('H3: http/ws допустимы ТОЛЬКО для localhost/127.0.0.1/[::1]', () => {
        expect(normalizeFlibGatewayUrl('ws://gw.example.org').valid).toBe(false);
        expect(normalizeFlibGatewayUrl('http://gw.example.org').valid).toBe(false);
        expect(normalizeFlibGatewayUrl('http://cache.flib.club').valid).toBe(false);
        expect(normalizeFlibGatewayUrl('http://localhost.evil.example').valid).toBe(false);
    });
    test('мусор и чужие схемы отвергаются', () => {
        expect(normalizeFlibGatewayUrl('cache.flib.club').valid).toBe(false);
        expect(normalizeFlibGatewayUrl('ftp://gw.example.org').valid).toBe(false);
        expect(normalizeFlibGatewayUrl('javascript:alert(1)').valid).toBe(false);
        expect(normalizeFlibGatewayUrl(/** @type {*} */ (null)).valid).toBe(false);
    });
});

describe('isTrustedFlibGatewayUrl', () => {
    test('пусто и хосты flib.club — доверенные', () => {
        expect(isTrustedFlibGatewayUrl('')).toBe(true);
        expect(isTrustedFlibGatewayUrl('https://cache.flib.club')).toBe(true);
        expect(isTrustedFlibGatewayUrl('wss://gw.flib.club/')).toBe(true);
        expect(isTrustedFlibGatewayUrl('https://flib.club')).toBe(true);
    });
    test('localhost — доверенный', () => {
        expect(isTrustedFlibGatewayUrl('http://localhost:8080')).toBe(true);
        expect(isTrustedFlibGatewayUrl('ws://127.0.0.1:9')).toBe(true);
    });
    test('чужие хосты и похожие имена — нет', () => {
        expect(isTrustedFlibGatewayUrl('https://evil.example')).toBe(false);
        expect(isTrustedFlibGatewayUrl('https://flib.club.evil.example')).toBe(false);
        expect(isTrustedFlibGatewayUrl('https://evilflib.club')).toBe(false);
    });
    test('невалидный адрес — нет', () => {
        expect(isTrustedFlibGatewayUrl('http://cache.flib.club')).toBe(false);
        expect(isTrustedFlibGatewayUrl('nonsense')).toBe(false);
    });
});
