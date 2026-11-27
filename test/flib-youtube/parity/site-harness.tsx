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
// The site's side of the DOM parity check (spec §6 item 5, test/playwright/flib-youtube-parity.spec.js).
// The copied PlayerPage mounted as on flib.club - an ordinary page, the site's CSS as it is (no
// scopeCss, no layer.css), the real react-dom (portals go to document.body), StrictMode >
// MemoryRouter as in pages/__tests__/PlayerPage.test.tsx - with the same environment objects the
// extension gives it: window.YT from installFakeYT, the layer's synchronous storage (over an
// in-memory backend) and the layer's fetch / sendBeacon. Only the source of the YT snapshots
// differs: here a stub bridge the spec drives (window.parityHarness), there the page-world bridge
// over the stand's player.
//
// Built by `node dev/build-flib-youtube.js --parity` (buildFlibYoutubeParityHarness) with the same
// `define` as the panel, so the copy reads __flibYt* globals here too.
// NOTE: never use the bare globals localStorage / sessionStorage / fetch here: the build `define`
// rewrites them.
import {EMPTY_SNAPSHOT, YT_STATE, type Command, type Snapshot} from '../../../flib-youtube/src/bridge/protocol';
import {STORAGE_PREFIX} from '../../../flib-youtube/src/constants';
import {createFlibFetch, createFlibSendBeacon, type ProxyRequest, type ProxyResponse} from '../../../flib-youtube/src/env/net';
import {createSyncStorage, preloadSyncStorage, type StorageBackend} from '../../../flib-youtube/src/env/storage';
import {installFakeYT, type BridgeClient, type BridgeClientEvent} from '../../../flib-youtube/src/env/yt-fake';

export type HarnessInit = {
    /** The MemoryRouter entry, `/player?v=<id>`. */
    entry: string,
    /** The player values at mount (the rest from EMPTY_SNAPSHOT); `t` is set here. */
    snapshot: Partial<Snapshot>,
    /** Storage contents at mount, full keys (`flibYt:<site key>`), as the extension preloads them. */
    storage: Record<string, string>,
};

export type ParityHarness = {
    mount(init: HarnessInit): Promise<void>,
    /** A YouTube-like external pause: PAUSED (stateChange if it changes) at exactly `seconds`. */
    pauseAt(seconds: number): void,
    /** Other player values (volume, loaded fraction ...), posted as a snapshot. */
    set(patch: Partial<Omit<Snapshot, 'state' | 'currentTime' | 't'>>): void,
    /** Every command the copy sent to the "player", in order. */
    readonly commands: Command[],
    /** Every /api request of the copy, `METHOD path`. */
    readonly requests: string[],
    snapshot(): Snapshot,
};

/**
 * A player behind the stub bridge, as the page-world bridge reports YouTube's: commands arrive
 * as messages (a task later), state changes come with an event, while PLAYING a snapshot is posted
 * every frame and the time runs at the rate.
 */
function createStubBridge(win: Window): BridgeClient & {harness: Pick<ParityHarness, 'pauseAt' | 'set' | 'commands' | 'snapshot'>, reset(s: Partial<Snapshot>): void} {
    let current: Snapshot = {...EMPTY_SNAPSHOT, rates: [...EMPTY_SNAPSHOT.rates]};
    // While PLAYING: the time at `playingSince` (page clock).
    let playingSince = 0;
    const listeners = new Set<(e: BridgeClientEvent) => void>();
    const commands: Command[] = [];
    const notify = (e: BridgeClientEvent) => {
        for (const cb of [...listeners]) {
            try { cb(e); } catch (error) { queueMicrotask(() => { throw error; }); }
        }
    };
    const now = () => win.performance.now();
    const currentTime = () => {
        if (current.state !== YT_STATE.PLAYING) { return current.currentTime; }
        const t = current.currentTime + ((now() - playingSince) / 1000) * current.rate;
        return current.duration > 0 ? Math.min(t, current.duration) : t;
    };
    /** Re-reads the "player" into a new snapshot (the bridge's readSnapshot). */
    const settle = (patch: Partial<Snapshot> = {}) => {
        const t = now();
        current = {...current, currentTime: currentTime(), ...patch, t};
        playingSince = t;
    };
    const post = () => { notify({name: 'snapshot'}); };
    const setState = (state: number) => {
        if (current.state === state) { return; }
        settle({state});
        post();
        notify({name: 'stateChange', data: state});
    };
    const frame = () => {
        if (current.state === YT_STATE.PLAYING) {
            settle();
            post();
        }
        win.requestAnimationFrame(frame);
    };
    win.requestAnimationFrame(frame);

    const execute = (c: Command) => {
        switch (c.name) {
            case 'seekTo': settle({currentTime: c.seconds}); post(); return;
            case 'playVideo': setState(YT_STATE.PLAYING); return;
            case 'pauseVideo': setState(YT_STATE.PAUSED); return;
            case 'setPlaybackRate':
                if (current.rate === c.rate) { return; }
                settle({rate: c.rate});
                post();
                notify({name: 'playbackRateChange', data: c.rate});
                return;
            case 'mute': settle({muted: true}); post(); return;
            case 'unMute': settle({muted: false}); post(); return;
            case 'setVolume': settle({volume: c.volume}); post(); return;
            default: settle(); post();
        }
    };

    return {
        snapshot: () => current,
        // The page-world bridge receives commands as window messages: a task later.
        command: (c) => {
            commands.push(c);
            win.setTimeout(() => { execute(c); }, 0);
        },
        onEvent: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
        reset: (s) => {
            current = {...EMPTY_SNAPSHOT, ...s, rates: [...(s.rates ?? EMPTY_SNAPSHOT.rates)], t: now()};
            playingSince = current.t;
        },
        harness: {
            pauseAt: (seconds) => {
                // As YouTube's player: a stateChange only when the state changes.
                const changes = current.state !== YT_STATE.PAUSED;
                settle({currentTime: seconds, state: YT_STATE.PAUSED});
                post();
                if (changes) { notify({name: 'stateChange', data: YT_STATE.PAUSED}); }
            },
            set: (patch) => {
                settle(patch);
                post();
            },
            commands,
            snapshot: () => ({...current, currentTime: currentTime()}),
        },
    };
}

/** An in-memory StorageBackend (the extension's goes through the background to chrome.storage.local). */
function memoryBackend(initial: Record<string, string>): StorageBackend {
    const items = new Map(Object.entries(initial));
    return {
        getAll: async (prefix) => Object.fromEntries([...items].filter(([k]) => k.startsWith(prefix))),
        set: async (changes) => {
            for (const [k, v] of Object.entries(changes)) {
                if (v === null) { items.delete(k); } else { items.set(k, v); }
            }
        },
        onChanged: () => { /* no other tab */ },
    };
}

function install(): ParityHarness {
    const win = window;
    const bridge = createStubBridge(win);
    installFakeYT(win, bridge);
    const requests: string[] = [];
    const realFetch = globalThis.fetch.bind(globalThis);
    // The layer's fetch; its proxy is the page's own origin (the spec serves the stand's /api there).
    const proxy = async (request: ProxyRequest): Promise<ProxyResponse> => {
        requests.push(`${request.method} ${request.path}`);
        const response = await realFetch(request.path, {method: request.method, headers: request.headers, body: request.body, credentials: 'omit'});
        return {status: response.status, statusText: response.statusText, headers: [...response.headers], body: await response.text()};
    };
    const globals = globalThis as unknown as Record<string, unknown>;
    globals.__flibYtFetch = createFlibFetch(proxy, realFetch);
    globals.__flibYtSendBeacon = createFlibSendBeacon();
    let mounted = false;
    return {
        mount: async ({entry, snapshot, storage}) => {
            if (mounted) { throw new Error('mounted already'); }
            mounted = true;
            bridge.reset(snapshot);
            const backend = memoryBackend(storage);
            const local = createSyncStorage({backend, prefix: STORAGE_PREFIX});
            await preloadSyncStorage(local, backend);
            globals.__flibYtLocalStorage = local;
            globals.__flibYtSessionStorage = createSyncStorage({backend: null, prefix: STORAGE_PREFIX});
            // The copy reads storage at module evaluation: imported only now (as entry.tsx does).
            const {renderSite} = await import('./site-tree');
            const root = document.getElementById('root');
            if (root === null) { throw new Error('no #root'); }
            renderSite(root, entry);
        },
        pauseAt: bridge.harness.pauseAt,
        set: bridge.harness.set,
        commands: bridge.harness.commands,
        requests,
        snapshot: bridge.harness.snapshot,
    };
}

(window as unknown as {parityHarness: ParityHarness}).parityHarness = install();
