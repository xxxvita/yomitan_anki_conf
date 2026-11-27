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
// The copied PlayerPage mounted under YouTube's player, over the environment of tasks 3-6: fake
// bridge (YouTube's player), fake background (the /api proxy), in-memory chrome.storage.
// The copy is evaluated inside each test, after the layer has installed its environment (the
// same order as the bundle); vi.resetModules() makes every test start from a fresh copy.
import {StrictMode, createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter, Route, Routes, useLocation} from 'react-router-dom';
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {FLIB_SITE_URL} from '../../../ext/js/data/flib-host.js';
import type {Command, Snapshot} from '../bridge/protocol';
import type {StorageBackend} from '../env/storage';
import type {BridgeClient, BridgeClientEvent} from '../env/yt-fake';
import type {FlibYoutubeHandle, RuntimeLike} from '../entry';

// ---------- fakes ----------

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
            // The page player obeys, as YouTube's would.
            if (c.name === 'seekTo') { set({currentTime: c.seconds}); }
            if (c.name === 'pauseVideo') { set({state: 2}); }
            if (c.name === 'playVideo') { set({state: 1}); }
        },
        onEvent: (cb) => { cbs.add(cb); return () => { cbs.delete(cb); }; },
        dispose: () => { cbs.clear(); },
    };
    return {client, commands, get: () => snap, set};
}
type Bridge = ReturnType<typeof fakeBridge>;

/** Bodies as the site's /api/youtube/subtitles returns them. */
function subtitles(videoId: string) {
    return {
        video_id: videoId,
        source_language: 'en',
        cues: [
            // No Russian in the corpus for the first line: the translate menu has to ask /translate.
            {start: 0, end: 4, text_en: `Hello brave world ${videoId}`, text_ru: ''},
            {start: 4, end: 8, text_en: 'Second line here', text_ru: 'Вторая строка'},
            {start: 8, end: 12, text_en: 'Third line there', text_ru: 'Третья строка'},
        ],
    };
}

type Sent = {action: string, params?: unknown};

function fakeBackground(state = {beta: true, panelVisible: false, theme: 'site'}) {
    const sent: Sent[] = [];
    const sendMessage = vi.fn(async (msg: Sent): Promise<unknown> => {
        sent.push(msg);
        if (msg.action === 'flibYoutubeGetState') { return {result: state}; }
        if (msg.action !== 'flibYoutubeFetch') { return {error: {message: 'unknown action'}}; }
        const p = msg.params as {path: string, method: string};
        const url = new URL(p.path, 'https://example.invalid');
        if (url.pathname === '/api/youtube/subtitles') {
            const body = JSON.stringify(subtitles(url.searchParams.get('v') ?? ''));
            return {result: {status: 200, statusText: 'OK', headers: [['content-type', 'application/json'], ['x-subtitle-source', 'yt']], body}};
        }
        if (url.pathname === '/api/youtube/subtitles/translate') {
            return {result: {status: 404, statusText: 'Not Found', headers: [['content-type', 'application/json']], body: '{"detail":"not_in_corpus"}'}};
        }
        return {result: {status: 404, statusText: 'Not Found', headers: [], body: ''}};
    });
    const paramsOf = (m: Sent) => (m.params ?? {}) as Record<string, unknown>;
    const fetched = (pathname: string) => sent.filter((m) => m.action === 'flibYoutubeFetch' && String(paramsOf(m).path).split('?')[0] === pathname).map(paramsOf);
    return {sendMessage, sent, fetched};
}

function memoryBackend(init: Record<string, string> = {}): StorageBackend & {data: Record<string, string>} {
    const data = {...init};
    return {
        data,
        getAll: async (prefix) => Object.fromEntries(Object.entries(data).filter(([k]) => k.startsWith(prefix))),
        set: async (items) => {
            for (const [k, v] of Object.entries(items)) {
                if (v === null) { delete data[k]; } else { data[k] = v; }
            }
        },
        onChanged: () => { /* single tab */ },
    };
}

function youtubePage(url = '/watch?v=vid1') {
    history.replaceState(null, '', url);
    document.documentElement.setAttribute('lang', 'de-DE');
    document.body.innerHTML = `
        <ytd-app>
          <ytd-watch-flexy>
            <div id="columns"><div id="primary"><div id="primary-inner">
              <div id="player"><div id="movie_player" class="html5-video-player"><video></video></div></div>
              <div id="below"><div id="comments"></div></div>
            </div></div></div>
          </ytd-watch-flexy>
        </ytd-app>
        <div id="youtube-last"></div>`;
}

const handles: FlibYoutubeHandle[] = [];

type CopyModule = typeof import('../mount');

async function start(opts: {bridge?: Bridge, backend?: StorageBackend, background?: ReturnType<typeof fakeBackground>, importCopy?: () => Promise<CopyModule>} = {}) {
    const bridge = opts.bridge ?? fakeBridge();
    const backend = opts.backend ?? memoryBackend();
    const background = opts.background ?? fakeBackground();
    vi.resetModules();
    const entry = await import('../entry');
    const realFetch = vi.fn(async () => { throw new TypeError('no network in tests'); });
    const handle = await entry.startFlibYoutube(window, {
        bridge: bridge.client,
        storageBackend: backend,
        sendMessage: background.sendMessage,
        realFetch: realFetch as unknown as typeof fetch,
        ...(opts.importCopy === undefined ? {} : {importCopy: opts.importCopy}),
    });
    handles.push(handle);
    return {handle, bridge, background, entry};
}

const $ = (sel: string) => document.querySelector<HTMLElement>(sel);
const root = () => $('#flib-yt-root');
const click = (el: Element, init: MouseEventInit = {}) => el.dispatchEvent(new MouseEvent('click', {bubbles: true, cancelable: true, button: 0, ...init}));
const sleep = (ms: number) => new Promise((r) => { setTimeout(r, ms); });

async function shown() {
    await vi.waitFor(() => { expect($('#flib-yt-root [data-workspace-bar]')).not.toBeNull(); }, {timeout: 5000});
}

beforeEach(() => {
    youtubePage();
});

afterEach(() => {
    for (const h of handles.splice(0)) { h.stop(); }
    vi.useRealTimers();
    vi.restoreAllMocks();
    document.body.innerHTML = '';
    delete (window as unknown as {YT?: unknown}).YT;
});

// ---------- tests ----------

describe('show()', () => {
    it('mounts the copied PlayerPage above #below: timeline and the EN plate of the current time; portals last in body', async () => {
        const {handle, bridge} = await start({bridge: fakeBridge({currentTime: 5})});
        expect(root()).toBeNull();
        handle.show();
        await shown();
        const container = root() as HTMLElement;
        expect(container.parentElement?.id).toBe('primary-inner');
        expect(container.nextElementSibling?.id).toBe('below');
        expect(container.closest('ytd-watch-flexy')).not.toBeNull();
        expect(container.querySelector('.player-page .fs-root .player-stage #yt-player')).not.toBeNull();
        // EN plate for t=5 s: the second cue.
        await vi.waitFor(() => { expect(container.querySelector('[data-testid="subtitle-overlay"]')?.textContent).toContain('Second line here'); });
        expect(document.body.lastElementChild?.id).toBe('flib-yt-portals');
        // The adapter took YouTube's captions off through the bridge.
        expect(bridge.commands).toContainEqual({name: 'unloadModule', module: 'captions'});
    });

    it('waits for #below when the watch page is not built yet', async () => {
        document.getElementById('below')?.remove();
        const {handle} = await start();
        handle.show();
        await sleep(50);
        expect(root()).toBeNull();
        const below = document.createElement('div');
        below.id = 'below';
        document.getElementById('primary-inner')?.append(below);
        await shown();
        expect(root()?.nextElementSibling).toBe(below);
    });
});

describe('portals', () => {
    it('createPortal(x, document.body) from the copy renders into #flib-yt-portals; the menu item works', async () => {
        const {handle, background} = await start({bridge: fakeBridge({currentTime: 1})});
        handle.show();
        await shown();
        const plate = await vi.waitFor(() => {
            const el = $('#flib-yt-root [data-testid="subtitle-overlay"]');
            expect(el?.textContent).toContain('Hello brave world');
            return el as HTMLElement;
        });
        plate.dispatchEvent(new MouseEvent('contextmenu', {bubbles: true, cancelable: true, clientX: 100, clientY: 100}));
        const menu = await vi.waitFor(() => {
            const el = $('[data-testid="translate-menu"]');
            expect(el).not.toBeNull();
            return el as HTMLElement;
        });
        expect(menu.parentElement?.id).toBe('flib-yt-portals');
        const item = menu.querySelector('[data-testid="translate-menu-item"]') as HTMLButtonElement;
        expect(item.disabled).toBe(false);
        // Pointer down first, as in a real click: the menu's outside-press handler must see the item as inside.
        item.dispatchEvent(new PointerEvent('pointerdown', {bubbles: true, cancelable: true}));
        click(item);
        await vi.waitFor(() => { expect(background.fetched('/api/youtube/subtitles/translate').length).toBe(1); });
        expect(background.fetched('/api/youtube/subtitles/translate')[0].method).toBe('POST');
        await vi.waitFor(() => { expect($('[data-testid="translate-menu"]')).toBeNull(); });
    });
});

describe('<html lang>', () => {
    it('stays YouTube\'s before and after mounting and after setLocale() in the copy', async () => {
        expect(document.documentElement.lang).toBe('de-DE');
        const {handle} = await start();
        expect(document.documentElement.lang).toBe('de-DE');
        handle.show(); // loads the copy: i18n.ts writes <html lang> at import
        await shown();
        expect(document.documentElement.lang).toBe('de-DE');
        const i18n = await import('flib-site/player/i18n');
        i18n.setLocale('en');
        expect(document.documentElement.lang).toBe('en'); // the copy did write it
        await vi.waitFor(() => { expect(document.documentElement.lang).toBe('de-DE'); });
        // YouTube changes its own lang: that one stays; the copy's next write goes back to it.
        document.documentElement.lang = 'fr';
        await sleep(0);
        expect(document.documentElement.lang).toBe('fr');
        i18n.setLocale('ru');
        await vi.waitFor(() => { expect(document.documentElement.lang).toBe('fr'); });
        expect(i18n.getLocale()).toBe('ru');
    });
});

describe('links', () => {
    it('a click on <a href="/route"> inside the container opens the site in a new tab; the tab stays', async () => {
        const open = vi.spyOn(window, 'open').mockReturnValue(null);
        const {handle} = await start();
        handle.show();
        await shown();
        const before = location.href;
        const page = $('#flib-yt-root .player-page');
        const link = $('#flib-yt-root a[href="/route"]') as HTMLAnchorElement; // the copy's <Link to="/route">
        expect(link).not.toBeNull();
        expect(click(link)).toBe(false); // default prevented
        expect(open).toHaveBeenCalledTimes(1);
        expect(open.mock.calls[0][0]).toBe(`${FLIB_SITE_URL}/route`);
        expect(open.mock.calls[0][1]).toBe('_blank');
        expect(location.href).toBe(before);
        // The router did not navigate: the same PlayerPage is still there.
        await sleep(20);
        expect($('#flib-yt-root .player-page')).toBe(page);
        // A plain anchor (and a middle click) the same way; absolute links are left alone.
        const plain = document.createElement('a');
        plain.setAttribute('href', '/app/route?next=1');
        root()?.append(plain);
        plain.dispatchEvent(new MouseEvent('auxclick', {bubbles: true, cancelable: true, button: 1}));
        expect(open.mock.calls[1][0]).toBe(`${FLIB_SITE_URL}/app/route?next=1`);
        const external = document.createElement('a');
        external.setAttribute('href', 'https://example.org/x');
        root()?.append(external);
        external.addEventListener('click', (e) => { e.preventDefault(); }); // jsdom would navigate
        click(external);
        expect(open).toHaveBeenCalledTimes(2);
        // Links of YouTube itself are not ours.
        const yt = document.createElement('a');
        yt.setAttribute('href', '/feed/history');
        document.getElementById('comments')?.append(yt);
        let ytDefaultPrevented: boolean | null = null;
        yt.addEventListener('click', (e) => { ytDefaultPrevented = e.defaultPrevented; e.preventDefault(); });
        click(yt);
        expect(ytDefaultPrevented).toBe(false);
        expect(open).toHaveBeenCalledTimes(2);
    });

    it('route * opens the site and returns to /player?v=<id>', async () => {
        const {OpenOnSite} = await import('../OpenOnSite');
        const opened: string[] = [];
        const seen: string[] = [];
        function Player() {
            const loc = useLocation();
            seen.push(loc.pathname + loc.search);
            return null;
        }
        const host = document.createElement('div');
        document.body.append(host);
        const r = createRoot(host);
        r.render(createElement(StrictMode, null,
            createElement(MemoryRouter, {initialEntries: ['/app/route?next=abc#x']},
                createElement(Routes, null,
                    createElement(Route, {path: '/player', element: createElement(Player)}),
                    createElement(Route, {path: '*', element: createElement(OpenOnSite, {home: '/player?v=vid1', open: (p: string) => { opened.push(p); }})})))));
        await vi.waitFor(() => { expect(seen).toContain('/player?v=vid1'); });
        expect(opened).toEqual(['/app/route?next=abc#x']); // once, also under StrictMode
        r.unmount();
    });
});

describe('YouTube navigation', () => {
    it('a new v= + yt-navigate-finish remounts with the new id; leaving for /results unmounts', async () => {
        const {handle, bridge, background} = await start();
        const subsPaths = () => background.fetched('/api/youtube/subtitles').map((p) => p.path);
        handle.show();
        await shown();
        await vi.waitFor(() => { expect(subsPaths()).toContain('/api/youtube/subtitles?v=vid1'); });
        const first = root();
        history.pushState(null, '', '/watch?v=vid2');
        bridge.set({videoId: 'vid2', currentTime: 0});
        document.dispatchEvent(new CustomEvent('yt-navigate-finish', {bubbles: true}));
        await vi.waitFor(() => { expect(subsPaths()).toContain('/api/youtube/subtitles?v=vid2'); });
        await shown();
        expect(root()).not.toBe(first);
        expect(first?.isConnected).toBe(false);
        await vi.waitFor(() => { expect(root()?.querySelector('[data-testid="subtitle-overlay"]')?.textContent).toContain('vid2'); });
        // Same video again (e.g. a timestamp link): no remount.
        const second = root();
        history.pushState(null, '', '/watch?v=vid2&t=30');
        document.dispatchEvent(new CustomEvent('yt-navigate-finish', {bubbles: true}));
        await sleep(20);
        expect(root()).toBe(second);
        bridge.commands.length = 0;
        history.pushState(null, '', '/results?search_query=x');
        document.dispatchEvent(new CustomEvent('yt-navigate-finish', {bubbles: true}));
        expect(root()).toBeNull();
        expect($('#flib-yt-portals')).toBeNull();
        expect(bridge.commands).toContainEqual({name: 'restoreCaptions'});
        // Back to a video while still visible: mounted again.
        history.pushState(null, '', '/watch?v=vid1');
        bridge.set({videoId: 'vid1'});
        document.dispatchEvent(new CustomEvent('yt-navigate-finish', {bubbles: true}));
        await shown();
    });
});

describe('Review Focus 2: hiding during the A-B countdown', () => {
    const LOOP = JSON.stringify({rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 300, looping: true, pauseAtEnd: 2});

    async function frames(bridge: Bridge, ms: number, until?: () => boolean) {
        for (let left = ms; left > 0; left -= 16) {
            await vi.advanceTimersByTimeAsync(16);
            const s = bridge.get();
            if (s.state === 1) { bridge.set({currentTime: s.currentTime + (0.016 * s.rate)}); }
            await new Promise((r) => { setImmediate(r); }); // React renders on a real macrotask
            if (until?.()) { return true; }
        }
        return false;
    }

    async function toCountdown() {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance', 'Date']});
        const bridge = fakeBridge({currentTime: 8, state: 1});
        const {handle} = await start({bridge, backend: memoryBackend({'flibYt:flib:ws:vid1': LOOP})});
        handle.show();
        // The first show() loads the copy (real module I/O): wait on real macrotasks, not on fake time.
        for (let i = 0; i < 20000 && root() === null; ++i) { await new Promise((r) => { setImmediate(r); }); }
        expect(root()).not.toBeNull();
        // Playing from 8 s towards B = 10 s: the copy pauses at B, seeks to A and starts its countdown.
        const reached = await frames(bridge, 8000, () => bridge.commands.some((c) => c.name === 'seekTo' && c.seconds === 5));
        expect(reached).toBe(true);
        expect(bridge.commands).toContainEqual({name: 'pauseVideo'});
        await frames(bridge, 32);
        expect($('#flib-yt-root [data-testid="countdown-ring"]')).not.toBeNull();
        return {handle, bridge};
    }

    it('control: without hiding, the countdown ends with playVideo', async () => {
        const {bridge} = await toCountdown();
        const after = bridge.commands.length;
        await frames(bridge, 4000);
        expect(bridge.commands.slice(after)).toContainEqual({name: 'playVideo'});
    });

    it('hide() during the countdown: 4 s later neither playVideo nor seekTo reached the bridge', async () => {
        const {handle, bridge} = await toCountdown();
        handle.hide();
        expect(root()).toBeNull();
        expect(bridge.commands).toContainEqual({name: 'restoreCaptions'});
        const after = bridge.commands.length;
        await frames(bridge, 4000);
        const late = bridge.commands.slice(after);
        expect(late.filter((c) => c.name === 'playVideo' || c.name === 'seekTo')).toEqual([]);
        expect(late).toEqual([]);
    });
});

describe('full screen', () => {
    it('requestFullscreen of the copy\'s .fs-root goes to #movie_player', async () => {
        const calls: Element[] = [];
        const proto = Element.prototype as unknown as {requestFullscreen?: unknown};
        const had = Object.prototype.hasOwnProperty.call(proto, 'requestFullscreen');
        const original = proto.requestFullscreen;
        proto.requestFullscreen = function requestFullscreen(this: Element) { calls.push(this); return Promise.resolve(); };
        try {
            const {handle} = await start();
            handle.show();
            await shown();
            // The copy's hotkey needs the adapter; wait for the plate (adapter + subtitles are in).
            await vi.waitFor(() => { expect($('#flib-yt-root [data-testid="subtitle-overlay"]')).not.toBeNull(); });
            // ⛶ (VideoControlsBar.tsx:119) -> FullscreenContainer.toggleFullscreen -> .fs-root.requestFullscreen.
            // (The F key is YouTube's alone while the panel is shown: env/hotkeys.ts.)
            click($('#flib-yt-root [data-testid="cb-fs-btn"]') as HTMLElement);
            expect(calls).toEqual([document.getElementById('movie_player')]);
            // Other elements, even with the same class, are untouched.
            const other = document.createElement('div');
            other.className = 'fs-root';
            document.body.append(other);
            void (other as unknown as {requestFullscreen(): Promise<void>}).requestFullscreen();
            expect(calls[1]).toBe(other);
            handle.stop();
            expect(proto.requestFullscreen).not.toBe(undefined);
        } finally {
            if (had) { proto.requestFullscreen = original; } else { delete proto.requestFullscreen; }
        }
    });
});

describe('full screen refused', () => {
    it('a rejected request leaves the copy in mode off: no history.pushState, nothing written', async () => {
        const calls: Element[] = [];
        const proto = Element.prototype as unknown as {requestFullscreen?: unknown};
        const had = Object.prototype.hasOwnProperty.call(proto, 'requestFullscreen');
        const original = proto.requestFullscreen;
        proto.requestFullscreen = function requestFullscreen(this: Element) {
            calls.push(this);
            return Promise.reject(new TypeError('Permissions check failed'));
        };
        const push = vi.spyOn(history, 'pushState');
        const back = vi.spyOn(history, 'back');
        try {
            const {handle} = await start();
            handle.show();
            await shown();
            await vi.waitFor(() => { expect($('#flib-yt-root [data-testid="subtitle-overlay"]')).not.toBeNull(); });
            const f = () => click($('#flib-yt-root [data-testid="cb-fs-btn"]') as HTMLElement);
            f();
            await sleep(30);
            expect(calls).toEqual([document.getElementById('movie_player')]);
            expect(push).not.toHaveBeenCalled();
            expect(back).not.toHaveBeenCalled();
            expect($('#flib-yt-root [data-testid="fs-root"]')?.getAttribute('data-fs-mode')).toBe('off');
            expect($('#flib-yt-root .fs-pseudo')).toBeNull();
            // The next ⛶ simply tries again.
            f();
            await sleep(30);
            expect(calls.length).toBe(2);
            expect(push).not.toHaveBeenCalled();
        } finally {
            if (had) { proto.requestFullscreen = original; } else { delete proto.requestFullscreen; }
        }
    });
});

describe('the copy loads on the first show()', () => {
    /** importCopy that waits for release() and counts its calls. */
    function gatedImport() {
        let release: () => void = () => { /* set below */ };
        const gate = new Promise<void>((r) => { release = r; });
        const counter = {calls: 0};
        const importCopy = async (): Promise<CopyModule> => {
            ++counter.calls;
            await gate;
            return await import('../mount');
        };
        return {importCopy, release: () => { release(); }, counter};
    }

    it('startup with the panel hidden evaluates no site module', async () => {
        // Probes of evaluation (both happen at import of the copy, nowhere else):
        // - player/i18n.ts:213-226 reads `flib:locale` from storage and writes <html lang>;
        // - player/workspace/video-player-store.ts reads `videoPlayer.shadowChatDock`.
        // A MutationObserver records every lang write, even one the guard reverts; a spy on the
        // storage global (what the copy's `localStorage` is in the build) records every read.
        const langWrites: (string | null)[] = [];
        const mo = new MutationObserver((records) => { for (const r of records) { langWrites.push(r.oldValue); } });
        mo.observe(document.documentElement, {attributes: true, attributeFilter: ['lang'], attributeOldValue: true});
        try {
            const background = fakeBackground({beta: true, panelVisible: false, theme: 'site'});
            const {handle, entry} = await start({background});
            const storage = (globalThis as unknown as {__flibYtLocalStorage: Storage}).__flibYtLocalStorage;
            const reads = vi.spyOn(storage, 'getItem');
            await entry.connectRuntime(handle, {sendMessage: background.sendMessage, onMessage: {addListener: () => { /* none */ }, removeListener: () => { /* none */ }}});
            await sleep(50);
            expect(root()).toBeNull();
            expect(langWrites).toEqual([]);
            expect(reads).not.toHaveBeenCalled();
            // Control: the first show() evaluates the copy, and the probes see it.
            handle.show();
            await shown();
            expect(reads.mock.calls.map((c) => c[0])).toEqual(expect.arrayContaining(['flib:locale', 'videoPlayer.shadowChatDock']));
            await vi.waitFor(() => { expect(langWrites.length).toBeGreaterThan(0); });
            expect(document.documentElement.lang).toBe('de-DE');
        } finally {
            mo.disconnect();
        }
    });

    it('stop() while the copy is loading: nothing mounts, <html lang> is put back', async () => {
        const g = gatedImport();
        const {handle} = await start({importCopy: g.importCopy});
        handle.show();
        handle.stop();
        g.release();
        await sleep(50);
        expect(root()).toBeNull();
        expect($('#flib-yt-portals')).toBeNull();
        expect(document.documentElement.lang).toBe('de-DE');
        handle.show();
        await sleep(20);
        expect(root()).toBeNull();
    });

    it('hide() while the copy is loading wins; the next show() mounts without a second import', async () => {
        const g = gatedImport();
        const {handle} = await start({importCopy: g.importCopy});
        handle.show();
        handle.hide();
        g.release();
        await sleep(50);
        expect(root()).toBeNull();
        handle.show();
        await shown();
        expect(g.counter.calls).toBe(1);
    });

    it('the first show() imports and mounts once; later shows do not import again', async () => {
        const g = gatedImport();
        const {handle} = await start({importCopy: g.importCopy});
        expect(g.counter.calls).toBe(0);
        handle.show();
        handle.show(); // a second show while loading
        g.release();
        await shown();
        expect(document.querySelectorAll('#flib-yt-root').length).toBe(1);
        expect(document.querySelectorAll('#flib-yt-portals').length).toBe(1);
        handle.hide();
        handle.show();
        await shown();
        handle.remount();
        await sleep(30);
        await shown();
        expect(g.counter.calls).toBe(1);
        expect(document.querySelectorAll('#flib-yt-root').length).toBe(1);
    });

    it('a flibYoutubeStop that arrives while the layer is still starting is not lost', async () => {
        let releaseStorage: () => void = () => { /* set below */ };
        const storageGate = new Promise<void>((r) => { releaseStorage = r; });
        const backend = memoryBackend();
        const slow: StorageBackend = {...backend, getAll: async (prefix) => { await storageGate; return await backend.getAll(prefix); }};
        const background = fakeBackground({beta: true, panelVisible: true, theme: 'site'});
        vi.resetModules();
        const entry = await import('../entry');
        const listeners = new Set<(msg: unknown) => void>();
        const runtime: RuntimeLike = {
            sendMessage: background.sendMessage,
            onMessage: {addListener: (cb) => { listeners.add(cb); }, removeListener: (cb) => { listeners.delete(cb); }},
        };
        const starting = entry.startFlibYoutube(window, {bridge: fakeBridge().client, storageBackend: slow, sendMessage: background.sendMessage});
        const connected = entry.connectRuntime(starting, runtime);
        await sleep(10);
        expect(listeners.size).toBe(1); // listening before the layer is ready
        for (const cb of [...listeners]) { cb({action: 'flibYoutubeStop'}); }
        releaseStorage();
        await connected;
        const handle = await starting;
        handles.push(handle);
        await sleep(50);
        expect(root()).toBeNull();
        expect(listeners.size).toBe(0);
        handle.show(); // stopped: dead
        await sleep(20);
        expect(root()).toBeNull();
    });

    it('a SetVisible that arrives while the layer is still starting is applied', async () => {
        let releaseStorage: () => void = () => { /* set below */ };
        const storageGate = new Promise<void>((r) => { releaseStorage = r; });
        const backend = memoryBackend();
        const slow: StorageBackend = {...backend, getAll: async (prefix) => { await storageGate; return await backend.getAll(prefix); }};
        const background = fakeBackground({beta: true, panelVisible: false, theme: 'site'});
        vi.resetModules();
        const entry = await import('../entry');
        const listeners = new Set<(msg: unknown) => void>();
        const runtime: RuntimeLike = {
            sendMessage: background.sendMessage,
            onMessage: {addListener: (cb) => { listeners.add(cb); }, removeListener: (cb) => { listeners.delete(cb); }},
        };
        const starting = entry.startFlibYoutube(window, {bridge: fakeBridge().client, storageBackend: slow, sendMessage: background.sendMessage});
        void starting.then((h) => { handles.push(h); });
        const connected = entry.connectRuntime(starting, runtime);
        await sleep(10);
        for (const cb of [...listeners]) { cb({action: 'flibYoutubeSetVisible', params: {visible: true}}); }
        releaseStorage();
        await connected;
        await shown(); // the stale GetState (hidden) does not override the newer message
    });
});

describe('start time (spec §3.17)', () => {
    it('playerEntry passes only t that link-start.ts accepts', async () => {
        const {playerEntry} = await import('../entry');
        const at = (u: string) => playerEntry(new URL(u, 'https://www.youtube.com'));
        expect(at('/watch?v=x&t=90')).toBe('/player?v=x&t=90');
        expect(at('/watch?t=90&v=x')).toBe('/player?v=x&t=90');
        expect(at('/watch?v=x&t=86400')).toBe('/player?v=x&t=86400');
        for (const t of ['90s', '1m30s', '0', '1000000', '86401', '', '-5', '090']) {
            expect(at(`/watch?v=x&t=${t}`), t).toBe('/player?v=x');
        }
        expect(at('/watch?v=x')).toBe('/player?v=x');
        expect(at('/watch?v=a-B_9')).toBe('/player?v=a-B_9');
        expect(at('/watch')).toBeNull();
        expect(at('/watch?v=bad%20id')).toBeNull();
        expect(at('/results?search_query=x')).toBeNull();
        expect(at('/shorts/abc')).toBeNull();
        expect(at('/')).toBeNull();
    });

    async function playerVarsFor(url: string) {
        youtubePage(url);
        const {handle} = await start();
        type PlayerCtor = new (t: unknown, o: Record<string, unknown>) => object;
        const yt = (window as unknown as {YT: {Player: PlayerCtor}}).YT;
        const seen: Record<string, unknown>[] = [];
        const Orig = yt.Player;
        yt.Player = class extends Orig {
            constructor(t: unknown, o: Record<string, unknown>) { seen.push(o); super(t, o); }
        };
        handle.show();
        await vi.waitFor(() => { expect(seen.length).toBeGreaterThan(0); });
        return seen.map((o) => o.playerVars as Record<string, unknown>);
    }

    it('watch?v=x&t=90 reaches the copy as /player?v=x&t=90 (adapter cue start 90)', async () => {
        const vars = await playerVarsFor('/watch?v=vid1&t=90');
        expect(vars.every((v) => v.start === 90)).toBe(true);
    });

    it('watch?v=x&t=1m30s reaches the copy without t', async () => {
        const vars = await playerVarsFor('/watch?v=vid1&t=1m30s');
        expect(vars.every((v) => !('start' in v))).toBe(true);
    });

    it('t goes only into the first mount of a video: a re-show or a remount does not seek back', async () => {
        youtubePage('/watch?v=vid1&t=90');
        const bridge = fakeBridge();
        const {handle} = await start({bridge});
        type PlayerCtor = new (t: unknown, o: Record<string, unknown>) => object;
        const yt = (window as unknown as {YT: {Player: PlayerCtor}}).YT;
        const seen: Record<string, unknown>[] = [];
        const Orig = yt.Player;
        yt.Player = class extends Orig {
            constructor(t: unknown, o: Record<string, unknown>) { seen.push(o.playerVars as Record<string, unknown>); super(t, o); }
        };
        const next = async () => {
            const n = seen.length;
            await vi.waitFor(() => { expect(seen.length).toBeGreaterThan(n); });
            await sleep(20); // StrictMode creates the first player twice
            return seen.slice(n);
        };
        handle.show();
        expect((await next()).every((v) => v.start === 90)).toBe(true);
        handle.hide();
        handle.show();
        expect((await next()).every((v) => !('start' in v))).toBe(true);
        handle.remount();
        expect((await next()).every((v) => !('start' in v))).toBe(true);
        // Another video: its own first mount takes its t.
        history.pushState(null, '', '/watch?v=vid2&t=30');
        bridge.set({videoId: 'vid2'});
        document.dispatchEvent(new CustomEvent('yt-navigate-finish', {bubbles: true}));
        expect((await next()).every((v) => v.start === 30)).toBe(true);
    });
});

describe('messages from the background', () => {
    function fakeRuntime(background: ReturnType<typeof fakeBackground>) {
        const listeners = new Set<(msg: unknown) => void>();
        const runtime: RuntimeLike = {
            sendMessage: background.sendMessage,
            onMessage: {
                addListener: (cb) => { listeners.add(cb); },
                removeListener: (cb) => { listeners.delete(cb); },
            },
        };
        const post = (msg: unknown) => { for (const cb of [...listeners]) { cb(msg); } };
        return {runtime, listeners, post};
    }

    it('asks flibYoutubeGetState on start and follows SetVisible / Remount / Stop', async () => {
        const background = fakeBackground({beta: true, panelVisible: true, theme: 'site'});
        const {handle, bridge, entry} = await start({background});
        const rt = fakeRuntime(background);
        await entry.connectRuntime(handle, rt.runtime);
        expect(background.sent.some((m) => m.action === 'flibYoutubeGetState')).toBe(true);
        await shown();
        rt.post({action: 'flibYoutubeSetVisible', params: {visible: false}});
        expect(root()).toBeNull();
        expect(bridge.commands).toContainEqual({name: 'restoreCaptions'});
        rt.post({action: 'flibYoutubeSetVisible', params: {visible: true}});
        await shown();
        const before = root();
        rt.post({action: 'flibYoutubeRemount'});
        await vi.waitFor(() => { expect(root()).not.toBe(before); expect(root()).not.toBeNull(); });
        await shown();
        rt.post({action: 'flibYoutubeStop'});
        expect(root()).toBeNull();
        expect(rt.listeners.size).toBe(0);
        // After stop nothing mounts again.
        handle.show();
        await sleep(20);
        expect(root()).toBeNull();
    });

    it('ignores malformed messages and stays hidden when the background says so', async () => {
        const background = fakeBackground({beta: true, panelVisible: false, theme: 'site'});
        const {handle, entry} = await start({background});
        const rt = fakeRuntime(background);
        await entry.connectRuntime(handle, rt.runtime);
        await sleep(30);
        expect(root()).toBeNull();
        for (const msg of [null, 'flibYoutubeSetVisible', {action: 'flibYoutubeSetVisible'}, {action: 'flibYoutubeSetVisible', params: {visible: 'yes'}}, {action: 'other'}]) {
            rt.post(msg);
        }
        await sleep(30);
        expect(root()).toBeNull();
    });

    it('remount re-reads the theme the background wrote to chrome.storage', async () => {
        const backend = memoryBackend();
        const {handle} = await start({backend});
        handle.show();
        await shown();
        // usePlayerTheme.ts applies the variant's CSS variables inline on .player-page.
        const vars = () => $('#flib-yt-root .player-page')?.style.cssText ?? '';
        const site = vars();
        expect(site).not.toBe('');
        const first = root();
        backend.data['flibYt:flib:dusk-variant'] = 'indigo'; // written by the background; no onChanged here
        handle.remount();
        await vi.waitFor(() => { expect(root()).not.toBe(first); expect(vars()).not.toBe(''); expect(vars()).not.toBe(site); });
    });
});
