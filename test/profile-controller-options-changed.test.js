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

/* eslint-disable no-underscore-dangle -- drives ProfileController._onOptionsChanged and replaces its ProfileConditionsUI */

import {afterAll, describe, expect, test} from 'vitest';
import {setupDomTest} from './fixtures/dom-test.js';
import {ProfileController} from '../ext/js/pages/settings/profile-controller.js';

const env = await setupDomTest();
const {window, teardown} = env;
afterAll(() => teardown(global));

/**
 * Two open settings pages used to ping-pong `profileCurrent` forever: every optionsChanged wrote
 * profileCurrent back (even unchanged), the write broadcast optionsUpdated, the other page's
 * optionsChanged wrote it again… Each bounce re-rendered every controller on both pages.
 * @param {number} profileCurrent
 * @returns {{controller: ProfileController, writes: string[], state: {profileCurrent: number, profileIndex: number}, onOptionsChanged: () => Promise<void>}}
 */
function setup(profileCurrent) {
    window.document.body.innerHTML = `
        <select id="profile-active-select"></select>
        <select id="profile-copy-source-select"></select>
        <span id="profile-reset-name"></span>
        <span id="profile-remove-name"></span>
        <button id="profile-add-button"></button>
        <button id="profile-reset-confirm-button"></button>
        <button id="profile-remove-confirm-button"></button>
        <button id="profile-copy-confirm-button"></button>
        <div id="profile-entry-list"></div>
        <span id="profile-conditions-profile-name"></span>
        <div id="profile-condition-groups"></div>
        <button id="profile-add-condition-group"></button>
    `;
    /** @type {string[]} */
    const writes = [];
    const state = {profileCurrent, profileIndex: 0};
    const settingsController = {
        get profileIndex() { return state.profileIndex; },
        set profileIndex(value) { state.profileIndex = value; },
        on: () => {},
        getOptionsFull: async () => ({profileCurrent: state.profileCurrent, profiles: [{name: 'A', conditionGroups: [], options: {}}, {name: 'B', conditionGroups: [], options: {}}]}),
        setGlobalSetting: async (/** @type {string} */ path, /** @type {unknown} */ value) => { writes.push(`${path}=${String(value)}`); },
    };
    const controller = new ProfileController(
        /** @type {import('../ext/js/pages/settings/settings-controller.js').SettingsController} */ (/** @type {unknown} */ (settingsController)),
        /** @type {import('../ext/js/pages/settings/modal-controller.js').ModalController} */ (/** @type {unknown} */ ({getModal: () => null})),
    );
    const self = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (controller));
    self._profileConditionsUI = {cleanup: () => {}, prepare: async () => {}};
    const onOptionsChanged = /** @type {() => Promise<void>} */ (self._onOptionsChanged).bind(controller);
    return {controller, writes, state, onOptionsChanged};
}

describe('ProfileController', () => {
    test('optionsChanged does not write profileCurrent back', async () => {
        const s = setup(0);
        await s.onOptionsChanged();
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(s.writes).toEqual([]);
    });

    test('optionsChanged with another default profile (switched from the action popup) follows it locally without writing', async () => {
        const s = setup(1);
        await s.onOptionsChanged();
        await new Promise((resolve) => { setTimeout(resolve, 0); });
        expect(s.writes).toEqual([]);
        expect(s.state.profileIndex).toBe(1);
        expect(s.controller.profileCurrentIndex).toBe(1);
    });

    test('a user choosing the default profile still writes it', async () => {
        const s = setup(0);
        await s.onOptionsChanged();
        await s.controller.setDefaultProfile(1);
        expect(s.writes).toEqual(['profileCurrent=1']);
        expect(s.state.profileIndex).toBe(1);
    });
});

/* eslint-enable no-underscore-dangle */
