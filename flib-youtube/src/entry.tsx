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
// Entry of the panel bundle (ext/lib/flib-youtube/panel.js, IIFE `flibYtPanel`), injected into
// youtube.com tabs only while the beta is on. It mounts the copied flib.club PlayerPage under
// YouTube's player and gives it the environment it has on flib.club.
//
// Start order:
//   startFlibYoutube - on every YouTube page while the beta is on, cheap, no site code:
//   1. window.YT emulation over the page-world bridge (env/yt-fake.ts); storage objects preloaded
//      from chrome.storage.local; the globals the build `define` points the copy at
//      (__flibYtLocalStorage, __flibYtSessionStorage, __flibYtFetch, __flibYtSendBeacon);
//   2. site-link interception and the YouTube navigation listener.
//   first show() - ensureCopy(), once per page:
//   3. `import('./mount')`, which evaluates the copy (it reads storage and writes <html lang> at
//      import), then the <html lang> guard and the full-screen redirect;
//   4. the panel mounts. show() comes from the background's flibYoutubeGetState / SetVisible.
//   A hide() or stop() during step 3 wins: nothing mounts.
//
// Messages (Yomitan api-map convention, the background side is ext/js/background):
//   layer -> background  {action: 'flibYoutubeFetch', params: <ProxyRequest without action>}
//                        {action: 'flibYoutubeGetState'} -> {result: {beta, panelVisible, theme}}
//   background -> layer  {action: 'flibYoutubeSetVisible', params: {visible: boolean}}
//                        {action: 'flibYoutubeRemount'}   (re-reads storage: the theme)
//                        {action: 'flibYoutubeStop'}      (beta switched off)
// NOTE: never use the bare globals localStorage / sessionStorage / fetch in layer code: the build
// `define` rewrites them in the whole bundle.
import {CONTAINER_ID, PORTALS_ID, STORAGE_PREFIX} from './constants';
import {installFullscreenRedirect} from './env/fullscreen';
import {installLangGuard} from './env/lang-guard';
import {createFlibFetch, createFlibSendBeacon, type ProxyRequest, type ProxyResponse} from './env/net';
import {chromeStorageBackend, createSyncStorage, preloadSyncStorage, type StorageBackend} from './env/storage';
import {createWindowBridgeClient, installFakeYT, type BridgeClient} from './env/yt-fake';
import {interceptSiteLinks, openOnSite} from './OpenOnSite';
import {startStageSync} from './stage';

export {CONTAINER_ID, PORTALS_ID, STORAGE_PREFIX};

declare const __FLIB_YT_PANEL_AUTOSTART__: boolean | undefined;

export type FlibYoutubeHandle = {
    show(): void,
    hide(): void,
    /** Mounts the panel again (after the background changed storage, e.g. the theme). */
    remount(): void,
    /** Unmounts and removes every listener; the handle is dead afterwards. */
    stop(): void,
};

export type SendMessage = (message: {action: string, params?: unknown}) => Promise<unknown>;

export type FlibYoutubeDeps = {
    bridge: BridgeClient & {dispose?(): void},
    storageBackend: StorageBackend | null,
    sendMessage: SendMessage,
    realFetch: typeof fetch,
    /** Loads the module with the copy (tests count the calls). */
    importCopy: () => Promise<typeof import('./mount')>,
};

export type RuntimeLike = {
    sendMessage: SendMessage,
    onMessage: {
        addListener(cb: (message: unknown) => void): void,
        removeListener(cb: (message: unknown) => void): void,
    },
};

const VIDEO_ID = /^[\w-]{1,64}$/;
// player/link-start.ts:5-6 - the only form of `t` the copy accepts.
const T_RE = /^[1-9]\d{0,5}$/;
const T_MAX = 86400;

const isRecord = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null;

function videoIdOf(url: URL | Location): string | null {
    if (url.pathname !== '/watch') { return null; }
    const v = new URLSearchParams(url.search).get('v');
    return v !== null && VIDEO_ID.test(v) ? v : null;
}

/**
 * The MemoryRouter entry for a YouTube URL (spec §3.17): `/player?v=<id>`, plus `t` only in the form
 * player/link-start.ts accepts; null when the URL is not a video page.
 */
export function playerEntry(url: URL | Location): string | null {
    const v = videoIdOf(url);
    if (v === null) { return null; }
    const out = new URLSearchParams({v});
    const t = new URLSearchParams(url.search).get('t');
    if (t !== null && T_RE.test(t) && Number(t) <= T_MAX) { out.set('t', t); }
    return `/player?${out.toString()}`;
}

/** Sends `{action, params}` and unwraps `{result}`; `{error}` or anything else rejects. */
async function call(send: SendMessage, action: string, params?: unknown): Promise<unknown> {
    const reply = await send(params === undefined ? {action} : {action, params});
    if (isRecord(reply) && 'result' in reply) { return reply.result; }
    const message = isRecord(reply) && isRecord(reply.error) && typeof reply.error.message === 'string' ? reply.error.message : `${action}: no result`;
    throw new Error(message);
}

const chromeSend: SendMessage = async (message) => await chrome.runtime.sendMessage(message);

type Mounted = {
    videoId: string,
    container: HTMLElement,
    portals: HTMLElement,
    unrender: () => void,
    stopStage: () => void,
};

/**
 * Installs the environment, evaluates the copy and returns the panel's controls. The panel is not
 * shown until show().
 */
export async function startFlibYoutube(win: Window, deps: Partial<FlibYoutubeDeps> = {}): Promise<FlibYoutubeHandle> {
    const doc = win.document;

    // 1. Environment, before the copy exists.
    const bridge = deps.bridge ?? createWindowBridgeClient(win);
    installFakeYT(win, bridge);
    const backend = deps.storageBackend !== undefined ? deps.storageBackend : chromeStorageBackend();
    const local = createSyncStorage({backend, prefix: STORAGE_PREFIX});
    const session = createSyncStorage({backend: null, prefix: STORAGE_PREFIX});
    try {
        await preloadSyncStorage(local, backend);
    } catch (e) {
        // The copy still works, with what it writes during this page's life.
        console.error('[flib-youtube] storage preload failed', e);
    }
    const send = deps.sendMessage ?? chromeSend;
    const proxy = async (request: ProxyRequest): Promise<ProxyResponse> => {
        const {action, ...params} = request;
        return await call(send, action, params) as ProxyResponse;
    };
    const realFetch = deps.realFetch ?? globalThis.fetch.bind(globalThis);
    const globals = globalThis as unknown as Record<string, unknown>;
    globals.__flibYtLocalStorage = local;
    globals.__flibYtSessionStorage = session;
    globals.__flibYtFetch = createFlibFetch(proxy, realFetch);
    globals.__flibYtSendBeacon = createFlibSendBeacon();

    const importCopy = deps.importCopy ?? (() => import('./mount'));
    const open = (path: string) => { openOnSite(win, path); };
    let mounted: Mounted | null = null;
    const isOurs = (node: Node) => mounted !== null && (mounted.container.contains(node) || mounted.portals.contains(node));
    const stopLinks = interceptSiteLinks(doc, isOurs, open);

    let visible = false;
    let stopped = false;
    let waiting: MutationObserver | null = null;
    // Video ids mounted in this page's life: `t` from the URL goes only into the first mount of an
    // id; a re-show or a theme remount must not seek YouTube back (spec §3.17).
    const startedIds = new Set<string>();

    // The copy and what it would otherwise do to YouTube's page; loaded on the first show().
    let panel: typeof import('./mount') | null = null;
    let loading: Promise<boolean> | null = null;
    let stopLang = () => { /* not installed yet */ };
    let stopFullscreen = () => { /* not installed yet */ };
    /** @returns Whether the copy is loaded (false: the import failed, or a stop came meanwhile). */
    const ensureCopy = (): Promise<boolean> => {
        loading ??= (async () => {
            const youtubeLang = doc.documentElement.getAttribute('lang');
            const mod = await importCopy();
            // Installed even after a stop: its first check puts back the lang the import wrote.
            const stopGuard = installLangGuard(doc, {initial: youtubeLang, isOurs: (value) => value === mod.getLocale()});
            if (stopped) {
                stopGuard();
                return false;
            }
            stopLang = stopGuard;
            stopFullscreen = installFullscreenRedirect(win, {
                isSource: (el) => el.classList.contains('fs-root') && el.closest(`#${CONTAINER_ID}`) !== null,
                target: () => doc.getElementById('movie_player'),
            });
            panel = mod;
            return true;
        })().catch((e: unknown) => {
            loading = null; // the next show() tries again
            console.error('[flib-youtube] loading the panel failed', e);
            return false;
        });
        return loading;
    };

    const stopWaiting = () => {
        waiting?.disconnect();
        waiting = null;
    };

    const unmount = (restoreCaptions: boolean) => {
        stopWaiting();
        if (mounted === null) { return; }
        const m = mounted;
        mounted = null;
        // Unmount first: the copy's cleanups (adapter.destroy, countdown, loop timers) run now,
        // so none of its timers can reach the player afterwards.
        m.unrender();
        m.stopStage();
        m.container.remove();
        m.portals.remove();
        if (restoreCaptions) { bridge.command({name: 'restoreCaptions'}); }
    };

    const findBelow = (): Element | null => doc.querySelector('ytd-watch-flexy #below');

    const sync = () => {
        if (stopped) { return; }
        const urlEntry = visible ? playerEntry(win.location) : null;
        const videoId = urlEntry === null ? null : videoIdOf(win.location);
        if (urlEntry === null || videoId === null) {
            unmount(true);
            return;
        }
        if (panel === null) {
            void ensureCopy().then((ok) => { if (ok) { sync(); } });
            return;
        }
        if (mounted !== null && mounted.videoId === videoId) { return; }
        // Another video: a new tree, as on the site a new video = a new adapter (useWorkspace.ts:408-417).
        unmount(false);
        const below = findBelow();
        if (below === null || below.parentNode === null) {
            // The watch page is still being built (SPA transition).
            if (waiting === null) {
                const observer = new (win as unknown as typeof globalThis).MutationObserver(() => {
                    if (findBelow() !== null) { stopWaiting(); sync(); }
                });
                observer.observe(doc.documentElement, {childList: true, subtree: true});
                waiting = observer;
            }
            return;
        }
        // Nodes left by a dead instance of the layer would duplicate the ids the CSS is scoped to.
        doc.getElementById(CONTAINER_ID)?.remove();
        doc.getElementById(PORTALS_ID)?.remove();
        const container = doc.createElement('div');
        container.id = CONTAINER_ID;
        below.parentNode.insertBefore(container, below);
        const portals = doc.createElement('div');
        portals.id = PORTALS_ID;
        doc.body.append(portals);
        const home = `/player?v=${videoId}`;
        const entry = startedIds.has(videoId) ? home : urlEntry;
        startedIds.add(videoId);
        const unrender = panel.renderPanel(container, entry, home, open);
        const stopStage = startStageSync(container, doc);
        mounted = {videoId, container, portals, unrender, stopStage};
    };

    const onNavigate = () => { sync(); };
    doc.addEventListener('yt-navigate-finish', onNavigate);

    return {
        show: () => {
            if (stopped) { return; }
            visible = true;
            sync();
        },
        hide: () => {
            visible = false;
            unmount(true);
        },
        remount: () => {
            if (stopped) { return; }
            // chrome.storage.onChanged and this message race; read storage again before mounting.
            void preloadSyncStorage(local, backend).catch(() => { /* keep what is in memory */ }).then(() => {
                if (stopped || mounted === null) { return; }
                unmount(false);
                sync();
            });
        },
        stop: () => {
            if (stopped) { return; }
            visible = false;
            unmount(true);
            stopped = true;
            doc.removeEventListener('yt-navigate-finish', onNavigate);
            stopLinks();
            stopFullscreen();
            stopLang();
            bridge.dispose?.();
        },
    };
}

/**
 * Wires the panel to the background: asks flibYoutubeGetState once (shows the panel if it was
 * visible) and follows flibYoutubeSetVisible / flibYoutubeRemount / flibYoutubeStop.
 * The listener is added before `handle` resolves: a SetVisible or Stop that arrives while the
 * layer is still starting is kept and applied, never lost.
 */
export async function connectRuntime(handle: FlibYoutubeHandle | Promise<FlibYoutubeHandle>, runtime: RuntimeLike): Promise<void> {
    let ready: FlibYoutubeHandle | null = null;
    let answered = false; // a SetVisible that arrives first is newer than the state being fetched
    let pendingVisible: boolean | null = null;
    let stopRequested = false;
    const listener = (message: unknown) => {
        if (!isRecord(message) || stopRequested) { return; }
        switch (message.action) {
            case 'flibYoutubeSetVisible': {
                const params = message.params;
                if (!isRecord(params) || typeof params.visible !== 'boolean') { return; }
                answered = true;
                if (ready === null) {
                    pendingVisible = params.visible;
                } else if (params.visible) {
                    ready.show();
                } else {
                    ready.hide();
                }
                return;
            }
            case 'flibYoutubeRemount':
                // Before the layer is ready nothing is mounted; the first mount reads storage anyway.
                ready?.remount();
                return;
            case 'flibYoutubeStop':
                stopRequested = true;
                runtime.onMessage.removeListener(listener);
                ready?.stop();
                return;
        }
    };
    runtime.onMessage.addListener(listener);
    const state = call(runtime.sendMessage, 'flibYoutubeGetState').catch((e: unknown) => {
        console.error('[flib-youtube] flibYoutubeGetState failed', e);
        return null;
    });
    try {
        ready = await handle;
    } catch (e) {
        runtime.onMessage.removeListener(listener);
        throw e;
    }
    if (stopRequested) {
        ready.stop();
        return;
    }
    if (pendingVisible !== null) {
        if (pendingVisible) { ready.show(); } else { ready.hide(); }
    }
    const answer = await state;
    if (!answered && !stopRequested && isRecord(answer) && answer.panelVisible === true) { ready.show(); }
}

async function autoStart(): Promise<void> {
    const globals = globalThis as unknown as {__flibYtPanelStarted?: boolean};
    // The background may inject into a tab where the registered script already runs.
    if (globals.__flibYtPanelStarted === true) { return; }
    globals.__flibYtPanelStarted = true;
    const runtime: RuntimeLike = {
        sendMessage: chromeSend,
        onMessage: {
            addListener: (cb) => { chrome.runtime.onMessage.addListener(cb); },
            removeListener: (cb) => { chrome.runtime.onMessage.removeListener(cb); },
        },
    };
    const handle = startFlibYoutube(window).then((h): FlibYoutubeHandle => ({
        ...h,
        stop: () => {
            h.stop();
            globals.__flibYtPanelStarted = false; // a later injection (beta on again) starts anew
        },
    }));
    try {
        await connectRuntime(handle, runtime);
    } catch (e) {
        globals.__flibYtPanelStarted = false;
        console.error('[flib-youtube] start failed', e);
    }
}

if (typeof __FLIB_YT_PANEL_AUTOSTART__ !== 'undefined' && __FLIB_YT_PANEL_AUTOSTART__) {
    void autoStart();
}
