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
import {computeFlibButtonState, isYoutubeWatchUrl} from '../ext/js/pages/action-popup-flib-youtube.js';

const WATCH = 'https://www.youtube.com/watch?v=abc123';

describe('isYoutubeWatchUrl', () => {
    test.each([
        [WATCH, true],
        ['https://www.youtube.com/watch?list=x&v=abc', true],
        ['https://www.youtube.com/watch', false],
        ['https://www.youtube.com/watch?v=', false],
        ['https://www.youtube.com/', false],
        ['https://www.youtube.com/results?search_query=v', false],
        ['https://www.youtube.com/shorts/abc', false],
        ['https://m.youtube.com/watch?v=abc', false],
        ['https://example.com/watch?v=abc', false],
        ['http://www.youtube.com/watch?v=abc', false],
        ['not a url', false],
        ['', false],
        [void 0, false],
    ])('%s -> %s', (url, expected) => {
        expect(isYoutubeWatchUrl(url)).toBe(expected);
    });
});

describe('computeFlibButtonState', () => {
    test('hidden without beta', () => {
        expect(computeFlibButtonState({beta: false, panelVisible: false, tabUrl: WATCH}).hidden).toBe(true);
    });

    test('active on a watch page, pressed follows panelVisible', () => {
        expect(computeFlibButtonState({beta: true, panelVisible: false, tabUrl: WATCH})).toEqual({hidden: false, disabled: false, pressed: false, titleKey: 'popup.flibYoutubeShow'});
        expect(computeFlibButtonState({beta: true, panelVisible: true, tabUrl: WATCH})).toEqual({hidden: false, disabled: false, pressed: true, titleKey: 'popup.flibYoutubeHide'});
    });

    test.each([
        'https://www.youtube.com/',
        'https://www.youtube.com/results?search_query=a',
        'https://www.youtube.com/shorts/x',
        'https://example.com/',
        void 0,
    ])('visible but disabled off a watch page: %s', (tabUrl) => {
        expect(computeFlibButtonState({beta: true, panelVisible: true, tabUrl})).toEqual({hidden: false, disabled: true, pressed: false, titleKey: 'popup.flibYoutubeNotWatch'});
    });
});
