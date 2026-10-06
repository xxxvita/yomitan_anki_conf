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
import {describeAnkiRouteStatus} from '../ext/js/pages/settings/anki-route-status.js';

const CORE = 'http://127.0.0.1:8777';
const DIRECT = 'http://127.0.0.1:8765';

/**
 * @param {import('anki-route').AnkiRouteMode} mode
 * @param {string} ankiServer
 * @param {?string} coreBase
 * @returns {import('anki-route').AnkiRoute}
 */
function route(mode, ankiServer, coreBase) {
    return {mode, ankiServer, coreBase, checkedAt: 1};
}

describe('describeAnkiRouteStatus', () => {
    test('through Core', () => {
        expect(describeAnkiRouteStatus(route('core', CORE, CORE), CORE)).toBe('Подключено через anki_conf (Core)');
    });

    test('automatic fallback from a silent Core', () => {
        expect(describeAnkiRouteStatus(route('direct', DIRECT, null), CORE)).toBe('Подключено напрямую к AnkiConnect (anki_conf не запущен)');
    });

    test.each([
        DIRECT,
        `${DIRECT}/`,
        `  ${DIRECT}  `,
        'http://192.168.1.5:8765',
    ])('direct because the settings point at AnkiConnect (%s) — not "anki_conf не запущен"', (primary) => {
        expect(describeAnkiRouteStatus(route('direct', primary.trim(), null), primary)).toBe('Подключено напрямую к AnkiConnect (выбрано в настройках)');
    });

    test('none, disabled and unknown keep the existing status text', () => {
        expect(describeAnkiRouteStatus(route('none', CORE, null), CORE)).toBeNull();
        expect(describeAnkiRouteStatus(route('disabled', CORE, CORE), CORE)).toBeNull();
        expect(describeAnkiRouteStatus(null, CORE)).toBeNull();
    });
});
