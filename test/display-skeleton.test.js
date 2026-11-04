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

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {SKELETON_DELAY_MS, startSearchSkeleton} from '../ext/js/display/display-skeleton.js';
import {setupDomTest} from './fixtures/dom-test.js';

describe('скелетон «Идёт поиск» (макет flib-states.jsx)', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    /** @type {HTMLElement} */
    let container;
    beforeEach(async () => {
        env = await setupDomTest();
        vi.useFakeTimers();
        container = document.createElement('div');
        document.body.appendChild(container);
    });
    afterEach(async () => {
        vi.useRealTimers();
        await env.teardown(global);
    });

    test('быстрый поиск — скелетона нет совсем (без мигания)', () => {
        const stop = startSearchSkeleton(container);
        vi.advanceTimersByTime(SKELETON_DELAY_MS - 1);
        stop();
        vi.advanceTimersByTime(1000);
        expect(container.querySelector('.fc-skel')).toBeNull();
    });

    test('долгий поиск — скелетон с aria-busy и подписью; по окончании убран', () => {
        const stop = startSearchSkeleton(container);
        vi.advanceTimersByTime(SKELETON_DELAY_MS);
        const skel = /** @type {HTMLElement} */ (container.querySelector('.fc-skel'));
        expect(skel).not.toBeNull();
        expect(skel.getAttribute('aria-busy')).toBe('true');
        expect(skel.getAttribute('aria-label')).toBe('Идёт поиск');
        expect(skel.querySelectorAll('i').length).toBe(5);
        stop();
        expect(container.querySelector('.fc-skel')).toBeNull();
    });

    test('в контейнере уже есть статьи — скелетон не ставится поверх', () => {
        const entry = document.createElement('div');
        entry.className = 'entry';
        container.appendChild(entry);
        const stop = startSearchSkeleton(container);
        vi.advanceTimersByTime(SKELETON_DELAY_MS);
        expect(container.querySelector('.fc-skel')).toBeNull();
        stop();
    });

    test('stop дважды — без ошибок', () => {
        const stop = startSearchSkeleton(container);
        vi.advanceTimersByTime(SKELETON_DELAY_MS);
        stop();
        expect(() => stop()).not.toThrow();
    });

    test('новый поиск отменяет скелетон прошлого (медленный A, быстрый B)', () => {
        startSearchSkeleton(container);
        const stopB = startSearchSkeleton(container);
        stopB();
        vi.advanceTimersByTime(SKELETON_DELAY_MS * 2);
        expect(container.querySelector('.fc-skel')).toBeNull();
    });

    test('видно «Ничего не нашлось» — скелетон под ним не ставится', () => {
        const noResults = document.createElement('div');
        noResults.id = 'no-results';
        document.body.appendChild(noResults);
        const stop = startSearchSkeleton(container);
        vi.advanceTimersByTime(SKELETON_DELAY_MS);
        expect(container.querySelector('.fc-skel')).toBeNull();
        stop();
    });
});
