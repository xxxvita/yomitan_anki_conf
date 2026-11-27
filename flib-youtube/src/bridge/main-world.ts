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
// Page-world bridge (bundled as ext/lib/flib-youtube/bridge.js and registered with world:'MAIN').
// It talks to YouTube's own player API object, #movie_player, which the extension's isolated world
// cannot reach: it posts snapshots of the player's values (every animation frame while PLAYING,
// otherwise when they change and at least once a second, and with every player event) and executes the fixed set of commands of
// bridge/protocol.ts. Volume, speed and mute go through the player API, so YouTube's own controls
// stay in sync with the panel. YouTube's captions are unloaded on the player for real, and
// `restoreCaptions` turns them back on if they were on at any unload since the last restore.
//
// #movie_player can appear late or be replaced (YouTube is a SPA): it is looked up by id on every
// tick (cheap) and listeners are moved when the element changes. Events of a stale element are
// ignored. Errors are taken only from the player API's onError, never from the <video> element.

import {
    EMPTY_SNAPSHOT,
    YT_STATE,
    eventMessage,
    parseLayerMessage,
    snapshotMessage,
    type Command,
    type Snapshot,
    type YtPlayerEvent,
} from './protocol';

declare const __FLIB_YT_BRIDGE_AUTOSTART__: boolean | undefined;

type Fn = (...args: unknown[]) => unknown;
/** The parts of YouTube's player API the bridge uses; every call is guarded. */
type PagePlayer = HTMLElement & Partial<Record<
    'getCurrentTime' | 'getDuration' | 'getPlayerState' | 'getPlaybackRate' | 'getAvailablePlaybackRates' |
    'isMuted' | 'getVolume' | 'getVideoLoadedFraction' | 'getVideoData' | 'getOption' |
    'seekTo' | 'playVideo' | 'pauseVideo' | 'setPlaybackRate' | 'mute' | 'unMute' | 'setVolume' |
    'loadModule' | 'unloadModule' | 'removeEventListener',
    Fn
>>;

const PLAYER_EVENTS = ['onStateChange', 'onPlaybackRateChange', 'onError', 'onApiChange'] as const;
type PlayerEventName = typeof PLAYER_EVENTS[number];

const HEARTBEAT_MS = 1000;
const FALLBACK_TICK_MS = 500; // rAF stops in background tabs; timers still run (throttled).
const RUNNING = new WeakSet<Window>();

function call(p: PagePlayer, name: keyof PagePlayer & string, ...args: unknown[]): unknown {
    try {
        const fn = p[name as keyof PagePlayer];
        return typeof fn === 'function' ? (fn as Fn).apply(p, args) : undefined;
    } catch {
        return undefined;
    }
}

const finite = (x: unknown, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

function readSnapshot(win: Window, p: PagePlayer | null): Snapshot {
    const t = win.performance.now();
    if (p === null) { return {...EMPTY_SNAPSHOT, rates: [...EMPTY_SNAPSHOT.rates], t}; }
    const data = call(p, 'getVideoData') as {video_id?: unknown} | undefined;
    const id = data && typeof data.video_id === 'string' && /^[\w-]{1,64}$/.test(data.video_id) ? data.video_id : null;
    const duration = finite(call(p, 'getDuration'), 0);
    const state = call(p, 'getPlayerState');
    const rate = finite(call(p, 'getPlaybackRate'), 1);
    const rawRates = call(p, 'getAvailablePlaybackRates');
    const rates = Array.isArray(rawRates) ? rawRates.filter((r): r is number => typeof r === 'number' && Number.isFinite(r) && r > 0 && r <= 16).slice(0, 32) : [];
    const volume = finite(call(p, 'getVolume'), 100);
    return {
        videoId: id,
        currentTime: Math.max(0, finite(call(p, 'getCurrentTime'), 0)),
        duration: duration > 0 ? duration : 0,
        state: typeof state === 'number' && (Object.values(YT_STATE) as number[]).includes(state) ? state : YT_STATE.UNSTARTED,
        rate: rate > 0 && rate <= 16 ? rate : 1,
        rates: rates.length > 0 ? rates : [1],
        muted: call(p, 'isMuted') === true,
        volume: Math.min(100, Math.max(0, volume)),
        loadedFraction: finite(call(p, 'getVideoLoadedFraction'), 0),
        adShowing: p.classList.contains('ad-showing'),
        t,
    };
}

function captionsAreOn(p: PagePlayer): boolean {
    const track = call(p, 'getOption', 'captions', 'track') as {languageCode?: unknown} | undefined;
    if (track && typeof track === 'object' && typeof track.languageCode === 'string' && track.languageCode !== '') { return true; }
    return p.querySelector('.ytp-subtitles-button')?.getAttribute('aria-pressed') === 'true';
}

export type BridgeHandle = {stop(): void};

export function startBridge(win: Window): BridgeHandle {
    if (RUNNING.has(win)) { return {stop: () => {}}; }
    RUNNING.add(win);

    let player: PagePlayer | null = null;
    let handlers: Record<PlayerEventName, Fn> | null = null;
    /**
     * Captions were on at some unload since the last restore. Accumulated, not taken at the first
     * unload only: the adapter's first unload runs at onReady, before YouTube loads the captions
     * module at playback start (IFrameAdapter.ts:183-185).
     */
    let captionsWereOn = false;
    let lastKey = '';
    let lastPostAt = -Infinity;
    let rafId: number | null = null;
    let stopped = false;

    const post = (msg: unknown) => { win.postMessage(msg, win.location.origin); };
    const keyOf = (s: Snapshot) => JSON.stringify({...s, t: 0});
    const postSnapshot = (s: Snapshot) => { lastKey = keyOf(s); lastPostAt = s.t; post(snapshotMessage(s)); };

    const detach = () => {
        if (player !== null && handlers !== null) {
            for (const name of PLAYER_EVENTS) { call(player, 'removeEventListener', name, handlers[name]); }
        }
        player = null;
        handlers = null;
    };

    const attach = (el: PagePlayer) => {
        detach();
        player = el;
        const mine = el;
        const onEvent = (event: YtPlayerEvent) => {
            if (stopped || player !== mine) { return; }
            const s = readSnapshot(win, mine);
            lastKey = keyOf(s);
            lastPostAt = s.t;
            post(eventMessage(event, s));
        };
        handlers = {
            onStateChange: (data) => { if (typeof data === 'number') { onEvent({name: 'stateChange', data}); } },
            onPlaybackRateChange: (data) => { if (typeof data === 'number') { onEvent({name: 'playbackRateChange', data}); } },
            onError: (data) => { if (typeof data === 'number') { onEvent({name: 'error', data}); } },
            onApiChange: () => { onEvent({name: 'apiChange'}); },
        };
        for (const name of PLAYER_EVENTS) {
            // #movie_player's addEventListener is the player API's, which takes these event names.
            try { (el.addEventListener as unknown as (n: string, f: Fn) => void)(name, handlers[name]); } catch { /* API changed */ }
        }
    };

    const findPlayer = (): PagePlayer | null => {
        const el = win.document.getElementById('movie_player') as PagePlayer | null;
        return el !== null && typeof el.getCurrentTime === 'function' ? el : null;
    };

    const tick = (force = false) => {
        if (stopped) { return; }
        const el = findPlayer();
        if (el !== player) {
            if (el === null) { detach(); } else { attach(el); }
        }
        const s = readSnapshot(win, player);
        // While PLAYING every frame is posted (spec item 2), so the layer's snapshot is at most a frame old.
        if (force || s.state === YT_STATE.PLAYING || keyOf(s) !== lastKey || s.t - lastPostAt >= HEARTBEAT_MS) { postSnapshot(s); }
    };

    const frame = () => {
        rafId = null;
        tick();
        if (!stopped) { rafId = win.requestAnimationFrame(frame); }
    };

    const execute = (c: Command) => {
        if (c.name === 'requestSnapshot') { tick(true); return; }
        const el = findPlayer();
        if (el === null) { return; }
        if (el !== player) { attach(el); }
        switch (c.name) {
            case 'seekTo': call(el, 'seekTo', c.seconds, true); break;
            case 'playVideo': call(el, 'playVideo'); break;
            case 'pauseVideo': call(el, 'pauseVideo'); break;
            case 'setPlaybackRate': call(el, 'setPlaybackRate', c.rate); break;
            case 'mute': call(el, 'mute'); break;
            case 'unMute': call(el, 'unMute'); break;
            case 'setVolume': call(el, 'setVolume', c.volume); break;
            case 'loadModule': call(el, 'loadModule', c.module); break;
            case 'unloadModule':
                captionsWereOn = captionsWereOn || captionsAreOn(el);
                call(el, 'unloadModule', c.module);
                break;
            case 'restoreCaptions':
                if (captionsWereOn) { call(el, 'loadModule', 'captions'); }
                captionsWereOn = false;
                break;
        }
        tick(true);
    };

    const onMessage = (ev: MessageEvent) => {
        if (stopped || ev.source !== win) { return; }
        const msg = parseLayerMessage(ev.data);
        if (msg !== null) { execute(msg.command); }
    };

    win.addEventListener('message', onMessage);
    const fallbackId = win.setInterval(() => { tick(); }, FALLBACK_TICK_MS);
    rafId = win.requestAnimationFrame(frame);
    tick(true);

    return {
        stop: () => {
            if (stopped) { return; }
            stopped = true;
            win.removeEventListener('message', onMessage);
            win.clearInterval(fallbackId);
            if (rafId !== null) { win.cancelAnimationFrame(rafId); }
            detach();
            RUNNING.delete(win);
        },
    };
}

// The build defines this as true for bridge.js; tests import startBridge without starting it.
if (typeof __FLIB_YT_BRIDGE_AUTOSTART__ !== 'undefined' && __FLIB_YT_BRIDGE_AUTOSTART__) {
    startBridge(window);
}
