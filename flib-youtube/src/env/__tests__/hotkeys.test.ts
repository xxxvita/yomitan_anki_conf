/*
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
// @vitest-environment jsdom
// Hotkeys of the copied player win over YouTube's while the panel is shown (spec §3 item 10).
//
// How the two JS worlds are modelled in one jsdom window: the extension's isolated world sees
// `window.addEventListener` / `document.addEventListener` as the layer leaves them (own properties
// installed by the key gate); YouTube's page world has its own JS wrappers of the same DOM nodes and
// never sees those properties. So a "YouTube" listener is registered with the node's original
// method (`EventTarget.prototype.addEventListener.call(node, ...)`), which is exactly what the page
// world's call does: it reaches the DOM without passing through anything of ours.
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import type {Command, Snapshot} from '../../bridge/protocol';
import type {FlibYoutubeHandle} from '../../entry';
import type {StorageBackend} from '../storage';
import type {BridgeClient, BridgeClientEvent} from '../yt-fake';
import {installHotkeyArbiter, installKeyGate, isPanelKey, uninstallKeyGate} from '../hotkeys';

// The page world's methods: what the nodes have before the layer exists (for `window` under vitest's
// jsdom, its own bound functions; in a browser, EventTarget.prototype's).
const windowAdd = window.addEventListener;
const windowRemove = window.removeEventListener;
const pageAdd = (t: EventTarget) => (t === window ? windowAdd : EventTarget.prototype.addEventListener);
const pageRemove = (t: EventTarget) => (t === window ? windowRemove : EventTarget.prototype.removeEventListener);
const KEY_TYPES = ['keydown', 'keyup', 'keypress'] as const;

type PageListener = {target: EventTarget, type: string, fn: EventListener, capture: boolean};
const pageListeners: PageListener[] = [];

/** A listener of YouTube's page world (see the header). */
function pageListen(target: EventTarget, type: string, capture: boolean, fn: EventListener): void {
    pageAdd(target).call(target, type, fn, capture);
    pageListeners.push({target, type, fn, capture});
}

/** YouTube's keyboard listeners on window and document, both phases, every key event type. */
function youtubeListeners() {
    const calls: string[] = [];
    for (const type of KEY_TYPES) {
        for (const [name, target] of [['window', window], ['document', document]] as const) {
            for (const capture of [true, false]) {
                pageListen(target, type, capture, (e) => { calls.push(`${type}:${name}:${capture ? 'capture' : 'bubble'}:${(e as KeyboardEvent).key}`); });
            }
        }
    }
    return {calls, keydowns: () => calls.filter((c) => c.startsWith('keydown:'))};
}

function key(type: string, init: KeyboardEventInit): KeyboardEvent {
    return new KeyboardEvent(type, {bubbles: true, cancelable: true, ...init});
}

const SPACE = {key: ' ', code: 'Space'};
const LEFT = {key: 'ArrowLeft', code: 'ArrowLeft'};
const RIGHT = {key: 'ArrowRight', code: 'ArrowRight'};
const letter = (c: string, init: KeyboardEventInit = {}) => ({key: c, code: `Key${c.toUpperCase()}`, ...init});

/** Focus target as the browser would pick it: the focused element, else body. */
const focused = (): Element => document.activeElement ?? document.body;

/** keydown, keypress (printable only), keyup at the focused element; returns keydown's dispatch result. */
function press(init: KeyboardEventInit, target: Element = focused()): boolean {
    const notPrevented = target.dispatchEvent(key('keydown', init));
    if (typeof init.key === 'string' && init.key.length === 1) { target.dispatchEvent(key('keypress', init)); }
    target.dispatchEvent(key('keyup', init));
    return notPrevented;
}

// Listeners of the extension's world added by a test are removed with this signal afterwards.
let controller = new AbortController();
const signal = () => controller.signal;

afterEach(() => {
    controller.abort();
    controller = new AbortController();
    for (const l of pageListeners.splice(0)) { pageRemove(l.target).call(l.target, l.type, l.fn, l.capture); }
    uninstallKeyGate(window);
    document.body.innerHTML = '';
    vi.restoreAllMocks();
});

// ---------- the gate and the arbiter, with plain listeners ----------

describe('isPanelKey (the copy\'s own guards, useHotkeys.ts / useTrackSelection.ts / WorkspacePanelThemed.tsx)', () => {
    it.each([
        [SPACE, true], [{...SPACE, shiftKey: true}, true], [{...SPACE, ctrlKey: true}, false], [{...SPACE, metaKey: true}, false],
        [LEFT, true], [RIGHT, true], [{...LEFT, ctrlKey: true}, true], [{...RIGHT, ctrlKey: true}, true],
        [letter('b'), true], [letter('B', {shiftKey: true}), true], [letter('b', {ctrlKey: true}), false], [letter('b', {altKey: true}), false],
        [letter('m'), true], [letter('m', {metaKey: true}), false],
        [letter('z'), true], [letter('Z', {shiftKey: true}), false], [letter('z', {ctrlKey: true}), false],
        [letter('s'), true], [letter('s', {ctrlKey: true}), false], [letter('S', {shiftKey: true}), false],
        [letter('r'), true], [letter('r', {ctrlKey: true}), false],
        [letter('g'), true], [letter('G', {shiftKey: true}), true], [letter('g', {ctrlKey: true}), false],
        [{key: 'Escape', code: 'Escape'}, true], [{key: 'Delete', code: 'Delete'}, true],
        // F stays YouTube's; keys the copy does not use stay YouTube's.
        [letter('f'), false], [letter('k'), false], [letter('j'), false], [letter('l'), false],
        [{key: 'ArrowUp', code: 'ArrowUp'}, false], [{key: 'Enter', code: 'Enter'}, false], [{key: '1', code: 'Digit1'}, false],
    ] as Array<[KeyboardEventInit, boolean]>)('%o -> %s', (init, expected) => {
        expect(isPanelKey(key('keydown', init))).toBe(expected);
    });
});

describe('arbiter with plain listeners', () => {
    /** Listeners of the extension's world (through the gate's wrappers) on window, document and a tracked box. */
    function setup() {
        installKeyGate(window); // keys.js at document_start: before any page script
        const youtube = youtubeListeners();
        const box = document.createElement('div');
        const button = document.createElement('button');
        box.append(button);
        document.body.append(box);
        let active = true;
        const arbiter = installHotkeyArbiter(window, () => active);
        arbiter.track(box);
        const ours: string[] = [];
        const listen = (target: EventTarget, name: string, capture: boolean, fn: (e: Event) => void = () => { /* log only */ }) => {
            target.addEventListener('keydown', (e) => { ours.push(`${name}-${capture ? 'c' : 'b'}`); fn(e); }, {capture, signal: signal()});
        };
        return {youtube, box, button, ours, listen, arbiter, setActive: (v: boolean) => { active = v; }};
    }

    it('replays the extension\'s listeners in native order (capture before bubble, outer to inner); YouTube sees nothing', () => {
        const {youtube, button, box, ours, listen, setActive} = setup();
        listen(window, 'win', false);
        listen(window, 'win', true);
        listen(document, 'doc', false);
        listen(document, 'doc', true);
        listen(box, 'box', false);
        listen(box, 'box', true);
        setActive(false);
        button.dispatchEvent(key('keydown', SPACE));
        const nativeOrder = [...ours];
        expect(nativeOrder).toEqual(['win-c', 'doc-c', 'box-c', 'box-b', 'doc-b', 'win-b']);
        expect(youtube.keydowns().length).toBe(4);

        setActive(true);
        ours.length = 0;
        youtube.calls.length = 0;
        button.dispatchEvent(key('keydown', SPACE));
        expect(ours).toEqual(nativeOrder);
        expect(youtube.calls).toEqual([]);
    });

    it('stopPropagation ends the path after the current node; stopImmediatePropagation ends it at once', () => {
        const {button, ours, listen, youtube} = setup();
        listen(document, 'doc1', true, (e) => { e.stopPropagation(); });
        listen(document, 'doc2', true);
        listen(document, 'doc', false);
        button.dispatchEvent(key('keydown', SPACE));
        expect(ours).toEqual(['doc1-c', 'doc2-c']);

        ours.length = 0;
        const box2 = document.createElement('div');
        document.body.append(box2);
        listen(window, 'win1', true, (e) => { e.stopImmediatePropagation(); });
        listen(window, 'win2', true);
        box2.dispatchEvent(key('keydown', SPACE));
        expect(ours).toEqual(['win1-c']);
        expect(youtube.calls).toEqual([]);
    });

    it('stopPropagation in a target\'s capture listener skips its bubble listeners (DOM order at target)', () => {
        const {box, ours, listen} = setup();
        listen(box, 'box', true, (e) => { e.stopPropagation(); });
        listen(box, 'box', false);
        box.dispatchEvent(key('keydown', SPACE));
        expect(ours).toEqual(['box-c']);
    });

    it('preventDefault reaches the real event; a passive listener cannot prevent', () => {
        const {button, listen} = setup();
        const passive = (e: Event) => { e.preventDefault(); };
        document.addEventListener('keydown', passive, {passive: true, signal: signal()});
        expect(button.dispatchEvent(key('keydown', SPACE))).toBe(true);
        listen(document, 'doc', false, (e) => { e.preventDefault(); });
        const e = key('keydown', SPACE);
        expect(button.dispatchEvent(e)).toBe(false);
        expect(e.defaultPrevented).toBe(true);
    });

    it('add twice = once, remove, once, signal - in replay as in native dispatch', () => {
        const {button, setActive} = setup();
        const twice = vi.fn();
        document.addEventListener('keydown', twice, {signal: signal()});
        document.addEventListener('keydown', twice, {signal: signal()});
        const removed = vi.fn();
        document.addEventListener('keydown', removed, {capture: true, signal: signal()});
        document.removeEventListener('keydown', removed, true);
        const onceReplayed = vi.fn();
        document.addEventListener('keydown', onceReplayed, {once: true, signal: signal()});
        const onceNative = vi.fn();
        window.addEventListener('keydown', onceNative, {once: true, signal: signal()});
        const controller = new AbortController();
        const aborted = vi.fn();
        document.addEventListener('keydown', aborted, {signal: controller.signal});
        controller.abort();
        const object = {handleEvent: vi.fn()};
        document.addEventListener('keydown', object, {signal: signal()});

        setActive(false);
        button.dispatchEvent(key('keydown', letter('k'))); // not a panel key: native
        expect(onceNative).toHaveBeenCalledTimes(1);
        expect(onceReplayed).toHaveBeenCalledTimes(1);
        setActive(true);
        button.dispatchEvent(key('keydown', SPACE)); // replayed
        button.dispatchEvent(key('keydown', SPACE));
        expect(twice).toHaveBeenCalledTimes(3);
        expect(object.handleEvent).toHaveBeenCalledTimes(3);
        expect(removed).not.toHaveBeenCalled();
        expect(aborted).not.toHaveBeenCalled();
        expect(onceNative).toHaveBeenCalledTimes(1);
        expect(onceReplayed).toHaveBeenCalledTimes(1);

        // A `once` listener first met in a replay is gone from the DOM as well.
        const onceFirstReplayed = vi.fn();
        document.addEventListener('keydown', onceFirstReplayed, {once: true, signal: signal()});
        button.dispatchEvent(key('keydown', SPACE));
        setActive(false);
        button.dispatchEvent(key('keydown', letter('k')));
        expect(onceFirstReplayed).toHaveBeenCalledTimes(1);
        // ... and removeEventListener of a `once` listener works before it fired.
        const onceRemoved = vi.fn();
        document.addEventListener('keydown', onceRemoved, {once: true, signal: signal()});
        document.removeEventListener('keydown', onceRemoved);
        button.dispatchEvent(key('keydown', letter('k')));
        expect(onceRemoved).not.toHaveBeenCalled();
    });

    it('a throwing listener is reported and the next one still runs', () => {
        const {button, ours, listen} = setup();
        const reported: unknown[] = [];
        const w = window as unknown as {reportError?: (e: unknown) => void};
        const had = Object.prototype.hasOwnProperty.call(w, 'reportError');
        const original = w.reportError;
        w.reportError = (e) => { reported.push(e); };
        try {
            listen(document, 'doc1', false, () => { throw new Error('boom'); });
            listen(document, 'doc2', false);
            button.dispatchEvent(key('keydown', SPACE));
            expect(ours).toEqual(['doc1-b', 'doc2-b']);
            expect(reported).toEqual([new Error('boom')]);
        } finally {
            if (had) { w.reportError = original; } else { delete w.reportError; }
        }
    });

    it('not intercepted: panel hidden, a key that is not the panel\'s, F, focus in input/textarea/contenteditable', () => {
        const {youtube, ours, listen, setActive} = setup();
        listen(document, 'doc', false);
        const input = document.createElement('input');
        const textarea = document.createElement('textarea');
        const editable = document.createElement('div');
        editable.setAttribute('contenteditable', 'true');
        // jsdom has no isContentEditable; the browser computes it from the attribute.
        Object.defineProperty(editable, 'isContentEditable', {value: true});
        editable.tabIndex = 0;
        document.body.append(input, textarea, editable);

        const expectNative = (init: KeyboardEventInit, target: Element = focused()) => {
            ours.length = 0;
            youtube.calls.length = 0;
            target.dispatchEvent(key('keydown', init));
            expect(youtube.keydowns().length).toBe(4);
            expect(ours).toEqual(['doc-b']);
        };
        expectNative(letter('k'));
        // F: not intercepted either (YouTube gets it); this listener was added while the panel was
        // active, so it is taken for the copy's and skips a plain F (see the F test below).
        ours.length = 0;
        youtube.calls.length = 0;
        focused().dispatchEvent(key('keydown', letter('f')));
        expect(youtube.keydowns().length).toBe(4);
        expect(ours).toEqual([]);
        for (const el of [input, textarea, editable]) {
            el.focus();
            expect(document.activeElement).toBe(el);
            expectNative(SPACE);
            expectNative(LEFT);
            expectNative(letter('b'));
        }
        (document.activeElement as HTMLElement).blur();
        setActive(false);
        expectNative(SPACE);
        expectNative({key: 'Escape', code: 'Escape'});
    });

    it('uninstalling the arbiter gives every key back to YouTube; the gate stays passive', () => {
        const {youtube, ours, listen, arbiter} = setup();
        listen(document, 'doc', false);
        arbiter();
        press(SPACE);
        expect(youtube.keydowns().length).toBe(4);
        expect(ours).toEqual(['doc-b']);
    });

    it('plain F: not intercepted; listeners added while the panel is active skip it, earlier ones get it; F with a modifier reaches all', () => {
        const {youtube, setActive} = setup();
        setActive(false);
        const before = vi.fn();
        document.addEventListener('keydown', before, {signal: signal()});
        setActive(true);
        const during = vi.fn();
        const duringUp = vi.fn();
        document.addEventListener('keydown', during, {signal: signal()});
        document.addEventListener('keyup', duringUp, {signal: signal()});
        press(letter('f'));
        expect(youtube.keydowns().length).toBe(4);
        expect(before).toHaveBeenCalledTimes(1);
        expect(during).not.toHaveBeenCalled();
        expect(duringUp).not.toHaveBeenCalled();
        for (const mod of ['shiftKey', 'ctrlKey', 'altKey', 'metaKey']) { press(letter('f', {[mod]: true})); }
        expect(during).toHaveBeenCalledTimes(4);
        expect(before).toHaveBeenCalledTimes(5);
        // Panel inactive: the panel's listeners get plain F again; other keys always did.
        setActive(false);
        press(letter('f'));
        expect(during).toHaveBeenCalledTimes(5);
        // Removing a wrapped listener works.
        document.removeEventListener('keydown', during);
        press(letter('f'));
        expect(during).toHaveBeenCalledTimes(5);
    });

    it('keyup and keypress of a panel key are kept from YouTube too', () => {
        const {youtube} = setup();
        press(SPACE);
        press(letter('g'));
        expect(youtube.calls).toEqual([]);
    });

    it('late injection (no keys.js at document_start): an earlier window-capture listener of YouTube still sees the key, nothing after it does', () => {
        const early = vi.fn();
        pageListen(window, 'keydown', true, early);
        const youtube = youtubeListeners(); // registered before the arbiter as well
        const arbiter = installHotkeyArbiter(window, () => true); // installs the gate itself
        const ours = vi.fn();
        document.addEventListener('keydown', ours, {signal: signal()});
        press(SPACE);
        expect(early).toHaveBeenCalledTimes(1); // limitation: it precedes the gate on window
        // The other YouTube window-capture listeners in the same list were registered before the
        // gate too and also run first; listeners on document and window bubble never do.
        expect(youtube.keydowns().filter((c) => !c.includes(':window:capture:'))).toEqual([]);
        expect(ours).toHaveBeenCalledTimes(1);
        arbiter();
    });

    it('the gate is one per window: keys.js and the panel share it', () => {
        const a = installKeyGate(window);
        expect(installKeyGate(window)).toBe(a);
        const arbiter = installHotkeyArbiter(window, () => true);
        const fn = vi.fn();
        window.addEventListener('keydown', fn, {signal: signal()});
        press(SPACE);
        expect(fn).toHaveBeenCalledTimes(1);
        arbiter();
    });
});

// ---------- with the copied PlayerPage mounted by the layer ----------

function fakeBridge(init: Partial<Snapshot> = {}) {
    let snap: Snapshot = {
        videoId: 'vid1', currentTime: 1, duration: 300, state: 2, rate: 1, rates: [0.5, 1, 1.5, 2],
        muted: false, volume: 100, loadedFraction: 0.1, adShowing: false, t: performance.now(), ...init,
    };
    const cbs = new Set<(e: BridgeClientEvent) => void>();
    const commands: Command[] = [];
    const set = (p: Partial<Snapshot>) => {
        snap = {...snap, t: performance.now(), ...p};
        for (const cb of [...cbs]) { cb({name: 'snapshot'}); }
    };
    const client: BridgeClient & {dispose(): void} = {
        snapshot: () => snap,
        command: (c) => {
            commands.push(c);
            if (c.name === 'seekTo') { set({currentTime: c.seconds}); }
            if (c.name === 'pauseVideo') { set({state: 2}); }
            if (c.name === 'playVideo') { set({state: 1}); }
        },
        onEvent: (cb) => { cbs.add(cb); return () => { cbs.delete(cb); }; },
        dispose: () => { cbs.clear(); },
    };
    /** Commands of the player-control kind sent since `from`. */
    const since = (from: number) => commands.slice(from).filter((c) => ['playVideo', 'pauseVideo', 'seekTo'].includes(c.name));
    return {client, commands, since, set};
}

function fakeBackground() {
    const sendMessage = vi.fn(async (msg: {action: string, params?: unknown}): Promise<unknown> => {
        if (msg.action === 'flibYoutubeGetState') { return {result: {beta: true, panelVisible: false, theme: 'site'}}; }
        if (msg.action !== 'flibYoutubeFetch') { return {error: {message: 'unknown action'}}; }
        const p = msg.params as {path: string};
        const url = new URL(p.path, 'https://example.invalid');
        if (url.pathname === '/api/youtube/subtitles') {
            const body = JSON.stringify({
                video_id: url.searchParams.get('v'),
                source_language: 'en',
                cues: [
                    {start: 0, end: 4, text_en: 'Hello brave world', text_ru: ''},
                    {start: 4, end: 8, text_en: 'Second line here', text_ru: 'Вторая строка'},
                    {start: 8, end: 12, text_en: 'Third line there', text_ru: 'Третья строка'},
                ],
            });
            return {result: {status: 200, statusText: 'OK', headers: [['content-type', 'application/json'], ['x-subtitle-source', 'yt']], body}};
        }
        return {result: {status: 404, statusText: 'Not Found', headers: [['content-type', 'application/json']], body: '{"detail":"not_in_corpus"}'}};
    });
    return {sendMessage};
}

function memoryBackend(): StorageBackend {
    const data: Record<string, string> = {};
    return {
        getAll: async (prefix) => Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith(prefix))),
        set: async (items) => {
            for (const [k, v] of Object.entries(items)) {
                if (v === null) { delete data[k]; } else { data[k] = v; }
            }
        },
        onChanged: () => { /* single tab */ },
    };
}

function youtubePage() {
    history.replaceState(null, '', '/watch?v=vid1');
    document.body.innerHTML = `
        <ytd-app>
          <ytd-watch-flexy>
            <div id="primary-inner">
              <div id="player"><div id="movie_player" class="html5-video-player"><video></video></div></div>
              <div id="below"><div id="comments"></div></div>
            </div>
          </ytd-watch-flexy>
        </ytd-app>`;
}

const handles: FlibYoutubeHandle[] = [];

async function startLayer(bridge = fakeBridge()) {
    vi.resetModules();
    const entry = await import('../../entry');
    const handle = await entry.startFlibYoutube(window, {
        bridge: bridge.client,
        storageBackend: memoryBackend(),
        sendMessage: fakeBackground().sendMessage,
        realFetch: (async () => { throw new TypeError('no network in tests'); }) as unknown as typeof fetch,
    });
    handles.push(handle);
    return {handle, bridge};
}

const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms); });
const plateText = () => $('#flib-yt-root [data-testid="subtitle-overlay"]')?.textContent ?? '';

async function shownWithAdapter(handle: FlibYoutubeHandle) {
    handle.show();
    // The copy's hotkeys need the adapter; the plate means adapter and subtitles are in.
    await vi.waitFor(() => { expect(plateText()).not.toBe(''); }, {timeout: 5000});
}

describe('with the copied PlayerPage', () => {
    beforeEach(() => {
        youtubePage();
    });

    afterEach(() => {
        for (const h of handles.splice(0)) { h.stop(); }
        delete (window as unknown as {YT?: unknown}).YT;
    });

    /** keys.js at document_start, then YouTube's listeners, then the layer and the panel. */
    async function panel(bridgeInit: Partial<Snapshot> = {}) {
        installKeyGate(window);
        const youtube = youtubeListeners();
        const {handle, bridge} = await startLayer(fakeBridge(bridgeInit));
        await shownWithAdapter(handle);
        // A listener of the extension's world other than the copy (Yomitan's, for instance).
        const extension: string[] = [];
        document.addEventListener('keydown', (e) => { extension.push(e.key); }, {signal: signal()});
        return {youtube, handle, bridge, extension};
    }

    it('Space, ←/→, Ctrl+←/→: the copy acts exactly once, YouTube gets nothing', async () => {
        const {youtube, bridge, extension} = await panel({currentTime: 1});
        let mark = bridge.commands.length;
        expect(press(SPACE)).toBe(false); // the copy's preventDefault (no page scroll)
        expect(bridge.since(mark)).toEqual([{name: 'playVideo'}]);
        mark = bridge.commands.length;
        press(SPACE);
        expect(bridge.since(mark)).toEqual([{name: 'pauseVideo'}]);

        bridge.set({currentTime: 10});
        await vi.waitFor(() => { expect(plateText()).toContain('Third line there'); });
        mark = bridge.commands.length;
        press(LEFT);
        expect(bridge.since(mark)).toEqual([{name: 'seekTo', seconds: 5}]);
        await vi.waitFor(() => { expect(plateText()).toContain('Second line here'); });
        mark = bridge.commands.length;
        press(RIGHT);
        expect(bridge.since(mark)).toEqual([{name: 'seekTo', seconds: 10}]);

        bridge.set({currentTime: 1});
        await vi.waitFor(() => { expect(plateText()).toContain('Hello brave world'); });
        mark = bridge.commands.length;
        press({...RIGHT, ctrlKey: true});
        expect(bridge.since(mark)).toEqual([{name: 'seekTo', seconds: 4}]);
        await vi.waitFor(() => { expect(plateText()).toContain('Second line here'); });
        mark = bridge.commands.length;
        press({...LEFT, ctrlKey: true});
        expect(bridge.since(mark)).toEqual([{name: 'seekTo', seconds: 0}]);

        expect(youtube.calls).toEqual([]);
        expect(extension).toEqual([' ', ' ', 'ArrowLeft', 'ArrowRight', 'ArrowRight', 'ArrowLeft']);
    });

    it('B, M, Delete, Z, G, Esc: the copy reacts once, YouTube gets nothing', async () => {
        const {youtube, extension} = await panel({currentTime: 1});
        await vi.waitFor(() => { expect(plateText()).toContain('Hello brave world'); });
        const loop = () => $('#flib-yt-root [data-tour="player-loop"]')?.getAttribute('data-loop-active');
        const regions = () => document.querySelectorAll('#flib-yt-root [data-testid="mute-region"]');

        // B: A-B on the current line (a second handling would switch it off again).
        expect(loop()).not.toBe('true');
        expect(press(letter('b'))).toBe(false);
        await vi.waitFor(() => { expect(loop()).toBe('true'); });
        await sleep(30);
        expect(loop()).toBe('true');

        // M: a mute region over [A, B] (a second M would toggle it).
        expect(press(letter('m'))).toBe(false);
        await vi.waitFor(() => { expect(regions().length).toBe(1); });

        // Delete: the selected region is deleted.
        (regions()[0] as HTMLElement).click();
        await sleep(30); // the copy subscribes its Delete listener in an effect of the selection
        press({key: 'Delete', code: 'Delete'});
        await vi.waitFor(() => { expect(regions().length).toBe(0); });

        // G: held while down, released on keyup (useTrackSelection.ts).
        press(letter('g'));

        // Esc closes the copy's translate menu (TranslateMenu.tsx: document capture + stopPropagation).
        $('#flib-yt-root [data-testid="subtitle-overlay"]')?.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: 100, clientY: 100}));
        await vi.waitFor(() => { expect($('[data-testid="translate-menu"]')).not.toBeNull(); });
        press({key: 'Escape', code: 'Escape'});
        await vi.waitFor(() => { expect($('[data-testid="translate-menu"]')).toBeNull(); });

        // Z hides the timeline and shows it again.
        expect($('#flib-yt-root [data-workspace-bar]')).not.toBeNull();
        expect(press(letter('z'))).toBe(false);
        await vi.waitFor(() => { expect($('#flib-yt-root [data-workspace-bar]')).toBeNull(); });
        press(letter('z'));
        await vi.waitFor(() => { expect($('#flib-yt-root [data-workspace-bar]')).not.toBeNull(); });

        expect(youtube.calls).toEqual([]);
        // The copy's TranslateMenu stopped Esc at document capture: a document-bubble listener does not get it, as on the site.
        expect(extension).toEqual(['b', 'm', 'Delete', 'g', 'z', 'z']);
    });

    it('react-dom\'s root and portal containers are on the replayed path (the copy\'s onKeyDown props)', async () => {
        const {youtube, bridge} = await panel({currentTime: 1});
        const container = $('#flib-yt-root') as HTMLElement;
        const portals = $('#flib-yt-portals') as HTMLElement;
        const seen: string[] = [];
        container.addEventListener('keydown', (e) => { seen.push(`root:${e.key}`); }, {signal: signal()});
        portals.addEventListener('keydown', (e) => { seen.push(`portals:${e.key}`); }, {signal: signal()});
        const button = container.querySelector('button') as HTMLButtonElement;
        button.focus();
        expect(document.activeElement).toBe(button);
        let mark = bridge.commands.length;
        press(SPACE);
        expect(bridge.since(mark)).toEqual([{name: 'playVideo'}]);
        $('#flib-yt-root [data-testid="subtitle-overlay"]')?.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: 100, clientY: 100}));
        const item = await vi.waitFor(() => {
            const el = $('#flib-yt-portals [data-testid="translate-menu-item"]');
            expect(el).not.toBeNull();
            return el as HTMLButtonElement;
        });
        item.focus();
        expect(document.activeElement).toBe(item);
        mark = bridge.commands.length;
        press(SPACE);
        expect(bridge.since(mark)).toEqual([{name: 'pauseVideo'}]);
        expect(seen).toEqual(['root: ', 'portals: ']);
        expect(youtube.calls).toEqual([]);
    });

    it('S and R are locked as on the site (the copy takes them, nothing happens), YouTube does not get them', async () => {
        const {youtube, bridge} = await panel();
        const mark = bridge.commands.length;
        expect(press(letter('s'))).toBe(false);
        expect(press(letter('r'))).toBe(false);
        await sleep(30);
        expect(bridge.since(mark)).toEqual([]);
        expect(youtube.calls).toEqual([]);
    });

    it('F is YouTube\'s alone while the panel is shown: not intercepted, the copy\'s F handler does not run; ⛶ still redirects', async () => {
        const calls: Element[] = [];
        const proto = Element.prototype as unknown as {requestFullscreen?: unknown};
        const had = Object.prototype.hasOwnProperty.call(proto, 'requestFullscreen');
        const original = proto.requestFullscreen;
        proto.requestFullscreen = function requestFullscreen(this: Element) { calls.push(this); return Promise.resolve(); };
        try {
            installKeyGate(window);
            // Yomitan's listener: added at document_idle, long before the panel mounts.
            const early: string[] = [];
            document.addEventListener('keydown', (e) => { early.push(e.key); }, {signal: signal()});
            const youtube = youtubeListeners();
            const {handle} = await startLayer();
            await shownWithAdapter(handle);
            // The copy's own listener of the same kind, added while the panel is mounted.
            const late: string[] = [];
            document.addEventListener('keydown', (e) => { late.push(e.key); }, {signal: signal()});

            expect(press(letter('f'))).toBe(true); // nobody of ours prevented it: YouTube's to handle
            expect(youtube.calls.filter((c) => c.startsWith('keydown:'))).toEqual([
                'keydown:window:capture:f', 'keydown:document:capture:f', 'keydown:document:bubble:f', 'keydown:window:bubble:f',
            ]);
            expect(youtube.calls.filter((c) => c.startsWith('keyup:')).length).toBe(4);
            await sleep(30);
            expect(calls).toEqual([]); // the copy's F (useHotkeys.ts:134) did not run
            expect(early).toEqual(['f']);
            expect(late).toEqual([]);

            // Shift+F, Ctrl+F: unchanged - not intercepted, every listener gets them; the copy's
            // own guard ignores F with a modifier, so no full screen from the copy either.
            youtube.calls.length = 0;
            press(letter('F', {shiftKey: true}));
            press(letter('f', {ctrlKey: true}));
            expect(youtube.keydowns().length).toBe(8);
            expect(late).toEqual(['F', 'f']);
            expect(early).toEqual(['f', 'F', 'f']);
            await sleep(30);
            expect(calls).toEqual([]);

            // The copy's ⛶ button keeps the redirect to YouTube's player (env/fullscreen.ts).
            ($('#flib-yt-root [data-testid="cb-fs-btn"]') as HTMLButtonElement).click();
            expect(calls).toEqual([document.getElementById('movie_player')]);

            // Panel hidden: nothing changes - every listener left of ours gets F.
            handle.hide();
            youtube.calls.length = 0;
            press(letter('f'));
            expect(youtube.keydowns().length).toBe(4);
            expect(late).toEqual(['F', 'f', 'f']);
        } finally {
            if (had) { proto.requestFullscreen = original; } else { delete proto.requestFullscreen; }
        }
    });

    it('focus in the copy\'s search field, a textarea or a contenteditable: not intercepted, the copy ignores the key', async () => {
        const {youtube, bridge} = await panel();
        const search = $('#flib-yt-root [data-testid="search-input"]') as HTMLInputElement;
        expect(search).not.toBeNull();
        const textarea = document.createElement('textarea');
        const editable = document.createElement('div');
        editable.setAttribute('contenteditable', 'true');
        Object.defineProperty(editable, 'isContentEditable', {value: true}); // what the browser computes
        editable.tabIndex = 0;
        document.getElementById('comments')?.append(textarea, editable);
        const fields: HTMLElement[] = [textarea, editable];
        if (!search.disabled) { fields.unshift(search); }
        expect(fields.length).toBe(3);
        for (const field of fields) {
            field.focus();
            expect(document.activeElement).toBe(field);
            youtube.calls.length = 0;
            const mark = bridge.commands.length;
            press(SPACE);
            press(LEFT);
            press(letter('b'));
            expect(bridge.since(mark)).toEqual([]);
            expect(youtube.keydowns().length).toBe(12);
        }
    });

    it('panel hidden or the layer stopped: every key is YouTube\'s', async () => {
        const {youtube, handle, bridge} = await panel();
        handle.hide();
        let mark = bridge.commands.length;
        youtube.calls.length = 0;
        press(SPACE);
        press(LEFT);
        expect(youtube.keydowns().length).toBe(8);
        expect(bridge.since(mark)).toEqual([]);

        handle.show();
        await vi.waitFor(() => { expect(plateText()).not.toBe(''); }, {timeout: 5000});
        mark = bridge.commands.length;
        youtube.calls.length = 0;
        press(SPACE);
        expect(youtube.calls).toEqual([]);
        expect(bridge.since(mark)).toEqual([{name: 'playVideo'}]);

        handle.stop();
        youtube.calls.length = 0;
        press(SPACE);
        expect(youtube.keydowns().length).toBe(4);
    });

    it('a panel started before show(): keys stay YouTube\'s until the copy is mounted', async () => {
        installKeyGate(window);
        const youtube = youtubeListeners();
        await startLayer();
        press(SPACE);
        expect(youtube.keydowns().length).toBe(4);
    });
});
