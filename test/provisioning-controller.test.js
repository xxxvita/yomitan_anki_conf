/*
 * Copyright (C) 2025  Yomitan Authors
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
import {describeProvisioningStatus} from '../ext/js/pages/common/provisioning-controller.js';

describe('describeProvisioningStatus', () => {
    test('downloading shows «Загружаю словари Flib… (1 из 2)» with a percentage', () => {
        expect(describeProvisioningStatus({state: 'downloading', index: 1, count: 2, title: 'wty-en-en', loaded: 50, total: 200}))
            .toEqual({text: 'Загружаю словари Flib… (1 из 2)', progress: 25, retry: false, running: true, error: false});
    });
    test('importing hands the progress bar to the import flow', () => {
        const view = describeProvisioningStatus({state: 'importing', index: 2, count: 2, title: 'flibooster-en-ru'});
        expect(view.text.startsWith('Загружаю словари Flib… (2 из 2)')).toBe(true);
        expect(view.progress).toBe('external');
        expect(view.running).toBe(true);
    });
    test('installed', () => {
        expect(describeProvisioningStatus({state: 'installed'})).toMatchObject({text: 'Словари установлены', running: false, retry: false, error: false});
    });
    test('unavailable is quiet and offers a retry', () => {
        expect(describeProvisioningStatus({state: 'unavailable'})).toEqual({text: 'Словари временно недоступны, попробуйте позже', progress: 'hidden', retry: true, running: false, error: false});
    });
    test('failed is an error with the reason and a retry', () => {
        const view = describeProvisioningStatus({state: 'failed', message: 'версии словарей не совпадают'});
        expect(view).toMatchObject({retry: true, running: false, error: true});
        expect(view.text).toContain('версии словарей не совпадают');
    });
    test('a zero-length total does not divide by zero', () => {
        expect(describeProvisioningStatus({state: 'downloading', index: 1, count: 1, title: 'x', loaded: 0, total: 0}).progress).toBe(0);
    });
});
