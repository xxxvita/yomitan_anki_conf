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

/* eslint-disable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */

import {describe, expect, test, vi} from 'vitest';
import {FlibYoutubeBeta} from '../ext/js/background/flib-youtube-beta.js';

const YT = 'https://www.youtube.com/*';
const KEYS = {id: 'flib-youtube-keys', matches: [YT], js: ['lib/flib-youtube/keys.js'], runAt: 'document_start'};
const BRIDGE = {id: 'flib-youtube-bridge', matches: [YT], js: ['lib/flib-youtube/bridge.js'], world: 'MAIN', runAt: 'document_start'};
const PANEL = {id: 'flib-youtube-panel', matches: [YT], js: ['lib/flib-youtube/panel.js'], css: ['lib/flib-youtube/panel.css'], runAt: 'document_idle'};

/**
 * @param {{registered?: Array<{id: string}>, tabs?: number[], noReceiver?: boolean}} [init]
 * @returns {any}
 */
function makeChrome({registered = [], tabs = [11, 12], noReceiver = false} = {}) {
    const store = /** @type {Record<string, unknown>} */ ({});
    const reg = [...registered];
    return {
        store: store,
        reg: reg,
        storage: {local: {
            get: vi.fn(async (/** @type {string} */ k) => (k in store ? {[k]: store[k]} : {})),
            set: vi.fn(async (/** @type {Record<string, unknown>} */ o) => { Object.assign(store, o); }),
        }},
        scripting: {
            getRegisteredContentScripts: vi.fn(async () => reg.map((s) => ({...s}))),
            registerContentScripts: vi.fn(async (/** @type {Array<{id: string}>} */ list) => {
                for (const s of list) {
                    if (reg.some((r) => r.id === s.id)) { throw new Error(`Duplicate script ID '${s.id}'`); }
                    reg.push(s);
                }
            }),
            unregisterContentScripts: vi.fn(async ({ids}) => {
                for (const id of ids) {
                    const i = reg.findIndex((r) => r.id === id);
                    if (i >= 0) { reg.splice(i, 1); }
                }
            }),
            executeScript: vi.fn(async () => []),
            insertCSS: vi.fn(async () => {}),
        },
        tabs: {
            query: vi.fn(async () => tabs.map((id) => ({id}))),
            sendMessage: vi.fn(async () => {
                if (noReceiver) { throw new Error('Could not establish connection. Receiving end does not exist.'); }
            }),
        },
    };
}

/**
 * A registration as chrome.scripting.getRegisteredContentScripts returns it: defaults filled in.
 * @param {{id: string, matches: string[], js: string[], css?: string[], runAt?: string, world?: string}} s
 * @returns {{id: string} & Record<string, unknown>}
 */
const asChrome = (s) => ({allFrames: false, matchOriginAsFallback: false, persistAcrossSessions: true, world: 'ISOLATED', runAt: 'document_idle', ...s});

const on = (theme = 'site') => ({flibYoutube: {beta: true, theme}});
const off = (theme = 'site') => ({flibYoutube: {beta: false, theme}});

describe('FlibYoutubeBeta', () => {
    test('beta off: nothing registered, stale scripts removed', async () => {
        const c = makeChrome({registered: [{id: 'flib-youtube-panel'}, {id: 'flib-youtube-bridge'}, {id: 'flib-youtube-keys'}, {id: 'other'}]});
        const b = new FlibYoutubeBeta(c);
        await b.prepare();
        await b.applyOptions(off());
        expect(c.scripting.registerContentScripts).not.toHaveBeenCalled();
        expect(c.reg.map((/** @type {{id: string}} */ r) => r.id)).toEqual(['other']);
        expect(c.scripting.executeScript).not.toHaveBeenCalled();
    });

    test('beta off from start with nothing registered: no calls that touch tabs', async () => {
        const c = makeChrome();
        const b = new FlibYoutubeBeta(c);
        await b.applyOptions(off());
        expect(c.scripting.registerContentScripts).not.toHaveBeenCalled();
        expect(c.scripting.unregisterContentScripts).not.toHaveBeenCalled();
        expect(c.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test('beta on: three scripts registered with exact values and injected into open tabs', async () => {
        const c = makeChrome();
        const b = new FlibYoutubeBeta(c);
        await b.applyOptions(on());
        expect(c.scripting.registerContentScripts).toHaveBeenCalledTimes(1);
        expect(c.scripting.registerContentScripts.mock.calls[0][0]).toEqual([KEYS, BRIDGE, PANEL]);
        expect(c.tabs.query).toHaveBeenCalledWith({url: YT});
        const exec = c.scripting.executeScript.mock.calls.map((/** @type {any[]} */ x) => x[0]);
        expect(exec.filter((/** @type {any} */ e) => e.target.tabId === 11)).toEqual([
            {target: {tabId: 11}, files: ['lib/flib-youtube/keys.js']},
            {target: {tabId: 11}, files: ['lib/flib-youtube/bridge.js'], world: 'MAIN'},
            {target: {tabId: 11}, files: ['lib/flib-youtube/panel.js']},
        ]);
        expect(exec).toHaveLength(6);
        expect(c.scripting.insertCSS).toHaveBeenCalledWith({target: {tabId: 11}, files: ['lib/flib-youtube/panel.css']});
        expect(c.scripting.insertCSS).toHaveBeenCalledWith({target: {tabId: 12}, files: ['lib/flib-youtube/panel.css']});
        // theme written once on enable, before the first mount
        expect(c.store['flibYt:flib:dusk-variant']).toBe('site');
    });

    test('same value again: no duplicate registration or injection', async () => {
        const c = makeChrome();
        const b = new FlibYoutubeBeta(c);
        await b.applyOptions(on());
        await b.applyOptions(on());
        expect(c.scripting.registerContentScripts).toHaveBeenCalledTimes(1);
        expect(c.scripting.executeScript).toHaveBeenCalledTimes(6);
        expect(c.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test('concurrent applyOptions calls do not race into a duplicate id', async () => {
        const c = makeChrome();
        const b = new FlibYoutubeBeta(c);
        await Promise.all([b.applyOptions(on()), b.applyOptions(on())]);
        expect(c.scripting.registerContentScripts).toHaveBeenCalledTimes(1);
    });

    test('restart: scripts already registered -> reconcile, no register, no injection', async () => {
        const c = makeChrome({registered: [asChrome(KEYS), asChrome(BRIDGE), asChrome(PANEL)]});
        const b = new FlibYoutubeBeta(c);
        await b.applyOptions(on());
        expect(c.scripting.registerContentScripts).not.toHaveBeenCalled();
        expect(c.scripting.executeScript).not.toHaveBeenCalled();
    });

    test('restart with partial registration: only the missing ones are registered', async () => {
        const c = makeChrome({registered: [asChrome(BRIDGE)]});
        const b = new FlibYoutubeBeta(c);
        await b.applyOptions(on());
        expect(c.scripting.registerContentScripts.mock.calls[0][0]).toEqual([KEYS, PANEL]);
    });

    test('registrations with other files, CSS, runAt, world or matches are registered again (M2)', async () => {
        for (const stale of [
            {...PANEL, css: ['lib/flib-youtube/panel.css', 'lib/flib-youtube/fonts.css']}, // dev builds before e5b0eeb8
            {...PANEL, js: ['lib/flib-youtube/old-panel.js']},
            {...PANEL, runAt: 'document_end'},
            {...PANEL, world: 'MAIN'},
            {...PANEL, matches: ['https://*.youtube.com/*']},
        ]) {
            const c = makeChrome({registered: [asChrome(KEYS), asChrome(BRIDGE), asChrome(stale)]});
            const b = new FlibYoutubeBeta(c);
            await b.applyOptions(on());
            expect(c.scripting.unregisterContentScripts.mock.calls.flatMap((/** @type {any[]} */ x) => x[0].ids)).toEqual(['flib-youtube-panel']);
            expect(c.scripting.registerContentScripts.mock.calls.map((/** @type {any[]} */ x) => x[0])).toEqual([[PANEL]]);
            // Re-registered, not new: open tabs are not injected into (they run the old ones until reloaded).
            expect(c.scripting.executeScript).not.toHaveBeenCalled();
        }
    });

    test('after an extension update every script is registered again, even with equal definitions (M2)', async () => {
        const c = makeChrome({registered: [asChrome(KEYS), asChrome(BRIDGE), asChrome(PANEL)]});
        const b = new FlibYoutubeBeta(c);
        await b.applyOptions(on());
        expect(c.scripting.registerContentScripts).not.toHaveBeenCalled();
        await b.onExtensionUpdated();
        expect(c.scripting.registerContentScripts.mock.calls.map((/** @type {any[]} */ x) => x[0])).toEqual([[KEYS, BRIDGE, PANEL]]);
        expect(c.reg.map((/** @type {{id: string}} */ r) => r.id).sort()).toEqual(['flib-youtube-bridge', 'flib-youtube-keys', 'flib-youtube-panel']);
        expect(c.scripting.executeScript).not.toHaveBeenCalled();
        // Once: the next applyOptions does not register again.
        await b.applyOptions(on());
        expect(c.scripting.registerContentScripts).toHaveBeenCalledTimes(1);
    });

    test('an update reported before the options are applied is applied with them (M2)', async () => {
        const c = makeChrome({registered: [asChrome(KEYS), asChrome(BRIDGE), asChrome(PANEL)]});
        const b = new FlibYoutubeBeta(c);
        await b.onExtensionUpdated();
        expect(c.scripting.getRegisteredContentScripts).not.toHaveBeenCalled();
        await b.applyOptions(on());
        expect(c.scripting.registerContentScripts.mock.calls.map((/** @type {any[]} */ x) => x[0])).toEqual([[KEYS, BRIDGE, PANEL]]);
    });

    test('an update with the beta off registers nothing (M2)', async () => {
        const c = makeChrome();
        const b = new FlibYoutubeBeta(c);
        await b.applyOptions(off());
        await b.onExtensionUpdated();
        expect(c.scripting.registerContentScripts).not.toHaveBeenCalled();
    });

    test('a duplicate-id error from the browser does not throw', async () => {
        const c = makeChrome();
        c.scripting.registerContentScripts.mockRejectedValueOnce(new Error("Duplicate script ID 'flib-youtube-panel'"));
        const b = new FlibYoutubeBeta(c);
        await expect(b.applyOptions(on())).resolves.toBeUndefined();
    });

    test('beta true -> false: scripts removed, tabs get flibYoutubeStop', async () => {
        const c = makeChrome();
        const b = new FlibYoutubeBeta(c);
        await b.applyOptions(on());
        await b.applyOptions(off());
        expect(c.reg).toEqual([]);
        expect(c.tabs.sendMessage).toHaveBeenCalledWith(11, {action: 'flibYoutubeStop'});
        expect(c.tabs.sendMessage).toHaveBeenCalledWith(12, {action: 'flibYoutubeStop'});
        expect(b.getState().beta).toBe(false);
    });

    test('off -> on -> off -> on registers again', async () => {
        const c = makeChrome();
        const b = new FlibYoutubeBeta(c);
        await b.applyOptions(on());
        await b.applyOptions(off());
        await b.applyOptions(on());
        expect(c.scripting.registerContentScripts).toHaveBeenCalledTimes(2);
        expect(c.scripting.executeScript).toHaveBeenCalledTimes(12);
    });

    test('setPanelVisible stores the flag and notifies tabs', async () => {
        const c = makeChrome();
        const b = new FlibYoutubeBeta(c);
        await b.prepare();
        expect(b.getState().panelVisible).toBe(false);
        await b.setPanelVisible(true);
        expect(c.store['flibYoutube.panelVisible']).toBe(true);
        expect(b.getState().panelVisible).toBe(true);
        expect(c.tabs.sendMessage).toHaveBeenCalledWith(11, {action: 'flibYoutubeSetVisible', params: {visible: true}});
    });

    test('prepare restores panelVisible from storage; garbage -> false', async () => {
        const c = makeChrome();
        c.store['flibYoutube.panelVisible'] = true;
        const b = new FlibYoutubeBeta(c);
        await b.prepare();
        expect(b.getState().panelVisible).toBe(true);
        const c2 = makeChrome();
        c2.store['flibYoutube.panelVisible'] = 'yes';
        const b2 = new FlibYoutubeBeta(c2);
        await b2.prepare();
        expect(b2.getState().panelVisible).toBe(false);
    });

    test('theme change: stored and tabs remount', async () => {
        const c = makeChrome();
        const b = new FlibYoutubeBeta(c);
        await b.applyOptions(on('site'));
        await b.applyOptions(on('indigo'));
        expect(c.store['flibYt:flib:dusk-variant']).toBe('indigo');
        expect(c.tabs.sendMessage).toHaveBeenCalledWith(11, {action: 'flibYoutubeRemount'});
        expect(c.tabs.sendMessage).toHaveBeenCalledWith(12, {action: 'flibYoutubeRemount'});
        expect(b.getState()).toEqual({beta: true, panelVisible: false, theme: 'indigo'});
    });

    test('unknown theme falls back to site', async () => {
        const c = makeChrome();
        const b = new FlibYoutubeBeta(c);
        await b.applyOptions({flibYoutube: {beta: true, theme: 'neon'}});
        expect(c.store['flibYt:flib:dusk-variant']).toBe('site');
    });

    test('missing flibYoutube block means off', async () => {
        const c = makeChrome();
        const b = new FlibYoutubeBeta(c);
        await b.applyOptions({});
        expect(b.getState().beta).toBe(false);
        expect(c.scripting.registerContentScripts).not.toHaveBeenCalled();
    });

    test('storage changes of flibYt: keys go to the YouTube tabs, only while the beta is on', async () => {
        const c = makeChrome();
        const b = new FlibYoutubeBeta(c);
        await b.forwardStorageChanges({'flibYt:a': {newValue: '1'}}, 'local');
        expect(c.tabs.sendMessage).not.toHaveBeenCalled(); // beta off
        await b.applyOptions(on());
        c.tabs.sendMessage.mockClear();
        await b.forwardStorageChanges({'flibYt:a': {newValue: '1'}, 'flibYt:b': {oldValue: 'x'}, 'flibYoutube.panelVisible': {newValue: true}}, 'local');
        const msg = {action: 'flibYoutubeStorageChanged', params: {changes: {'flibYt:a': '1', 'flibYt:b': null}}};
        expect(c.tabs.sendMessage).toHaveBeenCalledWith(11, msg);
        expect(c.tabs.sendMessage).toHaveBeenCalledWith(12, msg);
        c.tabs.sendMessage.mockClear();
        await b.forwardStorageChanges({'flibYoutube.panelVisible': {newValue: true}}, 'local');
        await b.forwardStorageChanges({'flibYt:a': {newValue: '2'}}, 'sync');
        expect(c.tabs.sendMessage).not.toHaveBeenCalled();
    });

    test('disable unregisters every known id, even ones getRegisteredContentScripts did not list (I1)', async () => {
        const c = makeChrome();
        const b = new FlibYoutubeBeta(c);
        await b.applyOptions(on());
        // The browser still has them, but the query fails (stale registrations, T9).
        c.scripting.getRegisteredContentScripts.mockRejectedValue(new Error('query failed'));
        await b.applyOptions(off());
        expect(c.reg).toEqual([]);
        const ids = c.scripting.unregisterContentScripts.mock.calls.flatMap((/** @type {any[]} */ x) => x[0].ids);
        expect(new Set(ids)).toEqual(new Set(['flib-youtube-keys', 'flib-youtube-bridge', 'flib-youtube-panel']));
        expect(c.tabs.sendMessage).toHaveBeenCalledWith(11, {action: 'flibYoutubeStop'});
    });

    test('disable with a query that lists nothing still unregisters every known id (I1)', async () => {
        const c = makeChrome();
        const b = new FlibYoutubeBeta(c);
        await b.applyOptions(on());
        c.scripting.getRegisteredContentScripts.mockResolvedValue([]);
        await b.applyOptions(off());
        expect(c.reg).toEqual([]);
    });

    test('beta off from start and the query fails: every known id is unregistered, one at a time (I1)', async () => {
        const c = makeChrome({registered: [{id: 'flib-youtube-panel'}]});
        c.scripting.getRegisteredContentScripts.mockRejectedValue(new Error('query failed'));
        // As the browser: an unknown id fails the whole call.
        c.scripting.unregisterContentScripts.mockImplementation(async (/** @type {{ids: string[]}} */ {ids}) => {
            for (const id of ids) {
                if (!c.reg.some((/** @type {{id: string}} */ r) => r.id === id)) { throw new Error(`Nonexistent script ID '${id}'`); }
            }
            for (const id of ids) { c.reg.splice(c.reg.findIndex((/** @type {{id: string}} */ r) => r.id === id), 1); }
        });
        const b = new FlibYoutubeBeta(c);
        await b.applyOptions(off());
        expect(c.reg).toEqual([]);
    });

    test('isEnabled follows the last applyOptions at once, before the browser calls finish (I1)', async () => {
        const c = makeChrome();
        const b = new FlibYoutubeBeta(c);
        expect(b.isEnabled()).toBe(false);
        const p = b.applyOptions(on());
        expect(b.isEnabled()).toBe(true);
        expect(b.getState().beta).toBe(true);
        await p;
        const q = b.applyOptions(off());
        expect(b.isEnabled()).toBe(false);
        expect(b.getState().beta).toBe(false);
        await q;
    });

    test('tabs without the layer (no receiver) and failed injections are swallowed', async () => {
        const c = makeChrome({noReceiver: true});
        c.scripting.executeScript.mockRejectedValueOnce(new Error('Cannot access contents of the page'));
        const b = new FlibYoutubeBeta(c);
        await b.applyOptions(on());
        await expect(b.setPanelVisible(true)).resolves.toBeUndefined();
        await expect(b.applyOptions(off())).resolves.toBeUndefined();
    });
});

/* eslint-enable @typescript-eslint/no-unsafe-assignment, @typescript-eslint/no-unsafe-argument */
