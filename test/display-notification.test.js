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

import {afterAll, afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {DisplayNotification} from '../ext/js/display/display-notification.js';
import {setupDomTest} from './fixtures/dom-test.js';

const {window, teardown} = await setupDomTest();
afterAll(() => teardown(global));

// eslint-disable-next-line jsdoc/require-returns -- the inferred shape is what the tests use
/** */
function createNotification() {
    const container = window.document.createElement('div');
    const node = window.document.createElement('div');
    node.innerHTML = '<div class="footer-notification-body"></div><button class="footer-notification-close-button"></button>';
    window.document.body.append(container);
    const notification = new DisplayNotification(container, node);
    const closeButton = /** @type {HTMLElement} */ (node.querySelector('button'));
    const body = /** @type {HTMLElement} */ (node.querySelector('div'));
    return {notification, container, node, closeButton, body};
}

describe('DisplayNotification', () => {
    beforeEach(() => { vi.useFakeTimers(); });
    afterEach(() => {
        vi.useRealTimers();
        window.document.body.replaceChildren();
    });

    test('opens, closes by its button after the animation', () => {
        const {notification, container, node, closeButton, body} = createNotification();
        expect(notification.isClosed()).toBe(true);
        notification.setContent('first');
        notification.open();
        expect(node.parentNode).toBe(container);
        expect(node.hidden).toBe(false);
        expect(body.textContent).toBe('first');
        closeButton.click();
        expect(notification.isClosing()).toBe(true);
        expect(node.hidden).toBe(true);
        vi.advanceTimersByTime(200);
        expect(notification.isClosed()).toBe(true);
        expect(notification.isClosing()).toBe(false);
    });

    test('opened again while closing → the close is cancelled, the new text stays', () => {
        const {notification, node, body} = createNotification();
        notification.setContent('first');
        notification.open();
        notification.close(true);
        vi.advanceTimersByTime(150);
        notification.setContent('second');
        notification.open();
        expect(node.hidden).toBe(false);
        expect(notification.isClosing()).toBe(false);
        vi.advanceTimersByTime(1000);
        expect(notification.isClosed()).toBe(false);
        expect(body.textContent).toBe('second');
        expect(vi.getTimerCount()).toBe(0);
    });

    test('after a cancelled close it can be closed again, in both ways', () => {
        for (const close of /** @type {((parts: ReturnType<typeof createNotification>) => void)[]} */ ([
            ({closeButton}) => { closeButton.click(); },
            ({notification}) => { notification.close(true); },
            ({notification}) => { notification.close(false); },
        ])) {
            const parts = createNotification();
            parts.notification.open();
            parts.notification.close(true);
            parts.notification.open();
            close(parts);
            vi.advanceTimersByTime(200);
            expect(parts.notification.isClosed()).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        }
    });

    test('opening an open notification changes nothing; closing it at once cancels a running close', () => {
        const {notification, node, container} = createNotification();
        notification.open();
        notification.open();
        expect(container.children).toHaveLength(1);
        expect(node.hidden).toBe(false);
        notification.close(true);
        notification.close(false);
        expect(notification.isClosed()).toBe(true);
        expect(vi.getTimerCount()).toBe(0);
        notification.open();
        expect(node.hidden).toBe(false);
    });
});
