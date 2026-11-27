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
// Emulation of the YouTube IFrame API library for the copied site adapter
// (vendor/flib-site/web/src/adapter/IFrameAdapter.ts, run verbatim). It is built like the real
// library: getters return the last values the player posted (here: snapshots from the page-world
// bridge, bridge/main-world.ts), methods post commands, callbacks come from player events and are
// always asynchronous.
//
// YT surface used by IFrameAdapter.ts (line numbers of the copy at 8799b6c) and how it is emulated:
//
// | Member                                   | Lines           | Emulation                                    |
// |------------------------------------------|-----------------|----------------------------------------------|
// | window.YT?.Player truthy                 | 252             | installFakeYT sets it before the first call   |
// | window.onYouTubeIframeAPIReady, iframe_api| 255-259        | never reached (YT.Player exists)             |
// | new YT.Player(mountTarget, opts)         | 74              | FakePlayer; mountTarget is ignored           |
// | YT.PlayerState PLAYING/ENDED/BUFFERING   | 125,131,148-150 | YT_STATE codes                               |
// | YT.PlayerState UNSTARTED/CUED            | 215             | passed through from the page player          |
// | opts.videoId                             | 75              | gate: onReady/getters/commands for this id   |
// | opts.width/height/playerVars             | 76-87           | ignored (no iframe; YouTube keeps its start) |
// | events.onReady                           | 89-122          | microtask, once, when ids match and no ad    |
// | events.onStateChange(e.data)             | 123-134         | player event; BUFFERING on ad/foreign id     |
// | events.onApiChange                       | 136             | player event                                 |
// | events.onPlaybackRateChange              | 137             | player event; also after an ad if changed    |
// | events.onError(e.data)                   | 142             | player API event only, never <video> error   |
// | seekTo(t, true)                          | 93,205          | command seekTo (required method)             |
// | cueVideoById({videoId, startSeconds})    | 100             | same id + startSeconds -> seekTo; else no-op |
// | getDuration                              | 98,196          | snapshot, 0 for NaN/Infinity/<=0             |
// | getCurrentTime                           | 105,110         | snapshot (+capped elapsed*rate if PLAYING)   |
// | getPlaybackRate                          | 106,137,198     | snapshot                                     |
// | getPlayerState                           | 109,137,197,... | snapshot                                     |
// | isMuted / getVolume (0..100)             | 116,199,200     | snapshot                                     |
// | getAvailablePlaybackRates                | 154,204         | snapshot, never empty                        |
// | getIframe                                | 166             | null (no iframe; title observer stays inert) |
// | unloadModule('captions'/'cc')            | 190             | command; the bridge unloads YouTube's CC     |
// | getVideoLoadedFraction                   | 202             | snapshot                                     |
// | playVideo / pauseVideo                   | 207,222         | commands                                     |
// | setPlaybackRate / mute / unMute          | 223-225         | commands                                     |
// | setVolume (0..100)                       | 226             | command                                      |
// | destroy                                  | 233             | drops own subscription; never a command      |
//
// Gate (spec §3 items 2-3; the clock-shim alone re-baselines onto an ad after ~300 ms): while the
// page player shows an ad, or plays another video than the requested one (YouTube SPA transition),
// getCurrentTime / getDuration / getPlaybackRate / getVideoLoadedFraction return the last values
// seen for the requested video outside an ad (0, 0, live rate, 0 if never seen), getPlayerState is
// BUFFERING, no command is sent, and player events other than apiChange are dropped. Entering the
// gate fires onStateChange(BUFFERING); leaving it fires onStateChange(real state), plus
// onPlaybackRateChange if the speed changed meanwhile. onReady waits until the gate is open.

import {
    EMPTY_SNAPSHOT,
    YT_STATE,
    commandMessage,
    isValidRate,
    isValidSeconds,
    isValidVolume,
    parseBridgeMessage,
    type Command,
    type Snapshot,
    type YtPlayerEvent,
} from '../bridge/protocol';

export type BridgeClientEvent = YtPlayerEvent | {name: 'snapshot'};

export type BridgeClient = {
    /** The latest snapshot, read synchronously. */
    snapshot(): Snapshot,
    command(c: Command): void,
    /** Called on every new snapshot ({name:'snapshot'}) and every player event. */
    onEvent(cb: (e: BridgeClientEvent) => void): () => void,
};

const DEFAULT_RATES = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 1.75, 2];
// Cap of the extrapolation in getCurrentTime: 3 frames. Not 0.25: clock-shim interpolates
// +0.15 s x rate between its polls, so a stall reported by heartbeats makes it see a jump back of
// (cap + 0.15) x rate; with 0.25 that is 0.40 > BACK_EPS and it freezes one poll per heartbeat
// (test "a stall reported only by heartbeats ..."). 0.05 keeps it at 0.20 at rate 1.
export const MAX_EXTRAPOLATION_S = 0.05;

type Content = {currentTime: number, duration: number, rate: number, loadedFraction: number};
type PlayerOpts = {videoId?: unknown, events?: Record<string, unknown>};
type Callback = (e: Record<string, unknown>) => void;

const cleanDuration = (d: unknown): number => (typeof d === 'number' && Number.isFinite(d) && d > 0 ? d : 0);
const cleanNumber = (x: unknown, fallback: number): number => (typeof x === 'number' && Number.isFinite(x) ? x : fallback);

function createPlayerClass(bridge: BridgeClient) {
    return class Player {
        private readonly requested: string | null;
        private readonly events: Record<string, unknown>;
        private readonly unsubscribe: () => void;
        private destroyed = false;
        private ready = false;
        private readyScheduled = false;
        private gatedSinceReady = false;
        private content: Content | null = null;

        constructor(_mountTarget: string | HTMLElement, opts: PlayerOpts = {}) {
            this.requested = typeof opts.videoId === 'string' ? opts.videoId : null;
            this.events = opts.events ?? {};
            this.unsubscribe = bridge.onEvent((e) => { this.onBridgeEvent(e); });
            this.observe(bridge.snapshot());
            this.maybeReady();
        }

        // ---- getters (IFrameAdapter calls them with ?.; the real library has them all) ----
        getCurrentTime(): number {
            const s = bridge.snapshot();
            if (this.isGated(s)) { return this.content?.currentTime ?? 0; }
            let t = cleanNumber(s.currentTime, 0);
            if (s.state === YT_STATE.PLAYING) {
                // As the real library: the posted time plus the time since it was posted, but capped.
                // Uncapped, a stalled player (PLAYING, frozen time, heartbeat-only snapshots) yields a
                // sawtooth that trips clock-shim's freeze, and a cross-world clock offset shifts the time
                // permanently. The bridge posts every frame while PLAYING, so a fresh snapshot needs
                // only a few frames of extrapolation.
                const elapsed = Math.min(Math.max(0, (performance.now() - cleanNumber(s.t, 0)) / 1000), MAX_EXTRAPOLATION_S);
                t += elapsed * this.getPlaybackRate();
                const d = cleanDuration(s.duration);
                if (d > 0 && t > d) { t = d; }
            }
            return t;
        }

        getDuration(): number {
            const s = bridge.snapshot();
            return this.isGated(s) ? (this.content?.duration ?? 0) : cleanDuration(s.duration);
        }

        getPlayerState(): number {
            const s = bridge.snapshot();
            return this.isGated(s) ? YT_STATE.BUFFERING : s.state;
        }

        getPlaybackRate(): number {
            const s = bridge.snapshot();
            if (this.isGated(s) && this.content !== null) { return this.content.rate; }
            return isValidRate(s.rate) ? s.rate : 1;
        }

        getAvailablePlaybackRates(): number[] {
            const rates = bridge.snapshot().rates;
            return Array.isArray(rates) && rates.length > 0 ? [...rates] : [...DEFAULT_RATES];
        }

        isMuted(): boolean { return bridge.snapshot().muted === true; }

        getVolume(): number { return cleanNumber(bridge.snapshot().volume, 100); }

        getVideoLoadedFraction(): number {
            const s = bridge.snapshot();
            return this.isGated(s) ? (this.content?.loadedFraction ?? 0) : cleanNumber(s.loadedFraction, 0);
        }

        getIframe(): null { return null; }

        // ---- commands ----
        seekTo(seconds: unknown, _allowSeekAhead?: unknown): void {
            if (isValidSeconds(seconds)) { this.send({name: 'seekTo', seconds}); }
        }

        cueVideoById(arg: unknown, startSeconds?: unknown): void {
            // Never loads another video: for the requested id only a seek to startSeconds.
            let id: unknown = arg;
            let start: unknown = startSeconds;
            if (typeof arg === 'object' && arg !== null) {
                id = (arg as Record<string, unknown>).videoId;
                start = (arg as Record<string, unknown>).startSeconds;
            }
            if (id === this.requested && isValidSeconds(start)) { this.send({name: 'seekTo', seconds: start}); }
        }

        playVideo(): void { this.send({name: 'playVideo'}); }

        pauseVideo(): void { this.send({name: 'pauseVideo'}); }

        setPlaybackRate(rate: unknown): void {
            if (isValidRate(rate)) { this.send({name: 'setPlaybackRate', rate}); }
        }

        mute(): void { this.send({name: 'mute'}); }

        unMute(): void { this.send({name: 'unMute'}); }

        setVolume(volume: unknown): void {
            if (isValidVolume(volume)) { this.send({name: 'setVolume', volume}); }
        }

        loadModule(module: unknown): void {
            if (module === 'captions' || module === 'cc') { this.send({name: 'loadModule', module}); }
        }

        unloadModule(module: unknown): void {
            if (module === 'captions' || module === 'cc') { this.send({name: 'unloadModule', module}); }
        }

        /** Drops this player's subscription. YouTube's player is not touched. */
        destroy(): void {
            if (this.destroyed) { return; }
            this.destroyed = true;
            this.unsubscribe();
        }

        // ---- internals ----
        private isGated(s: Snapshot): boolean {
            return s.adShowing || s.videoId === null || s.videoId !== this.requested;
        }

        private send(c: Command): void {
            if (this.destroyed || !this.ready || this.isGated(bridge.snapshot())) { return; }
            bridge.command(c);
        }

        /** Remembers the requested video's values outside the gate. */
        private observe(s: Snapshot): void {
            if (this.isGated(s)) { return; }
            this.content = {
                currentTime: cleanNumber(s.currentTime, 0),
                duration: cleanDuration(s.duration),
                rate: isValidRate(s.rate) ? s.rate : 1,
                loadedFraction: cleanNumber(s.loadedFraction, 0),
            };
        }

        private fire(name: string, payload: Record<string, unknown>): void {
            queueMicrotask(() => {
                if (this.destroyed) { return; }
                const cb = this.events[name];
                if (typeof cb === 'function') { (cb as Callback)({...payload, target: this}); }
            });
        }

        private maybeReady(): void {
            if (this.ready || this.readyScheduled || this.destroyed || this.isGated(bridge.snapshot())) { return; }
            this.readyScheduled = true;
            queueMicrotask(() => {
                this.readyScheduled = false;
                if (this.destroyed || this.ready) { return; }
                if (this.isGated(bridge.snapshot())) { return; }
                this.ready = true;
                this.gatedSinceReady = false;
                const cb = this.events.onReady;
                if (typeof cb === 'function') { (cb as Callback)({target: this}); }
            });
        }

        private onBridgeEvent(e: BridgeClientEvent): void {
            if (this.destroyed) { return; }
            const s = bridge.snapshot();
            const gated = this.isGated(s);
            if (e.name === 'snapshot') {
                const heldRate = this.content?.rate;
                this.observe(s);
                if (!this.ready) { this.maybeReady(); return; }
                if (gated !== this.gatedSinceReady) {
                    this.gatedSinceReady = gated;
                    this.fire('onStateChange', {data: gated ? YT_STATE.BUFFERING : s.state});
                    if (!gated && heldRate !== undefined && isValidRate(s.rate) && s.rate !== heldRate) {
                        this.fire('onPlaybackRateChange', {data: s.rate});
                    }
                }
                return;
            }
            if (e.name === 'error') {
                // The adapter's onError does not touch the player, so it may precede onReady.
                if (!gated) { this.fire('onError', {data: e.data}); }
                return;
            }
            if (!this.ready) { return; }
            if (e.name === 'apiChange') { this.fire('onApiChange', {}); return; }
            if (gated) { return; }
            if (e.name === 'stateChange') { this.fire('onStateChange', {data: e.data}); return; }
            if (e.name === 'playbackRateChange') { this.fire('onPlaybackRateChange', {data: e.data}); }
        }
    };
}

/**
 * Puts the emulated IFrame API on `win.YT`. Must run before the first createIFrameAdapter call
 * (IFrameAdapter.ts:252), otherwise the adapter injects the real iframe_api into the page.
 */
export function installFakeYT(win: Window, bridge: BridgeClient): void {
    (win as unknown as {YT: unknown}).YT = {
        Player: createPlayerClass(bridge),
        PlayerState: {...YT_STATE},
        loaded: 1,
    };
}

/** The isolated-world side of the bridge protocol over window messages. */
export function createWindowBridgeClient(win: Window): BridgeClient & {dispose(): void} {
    let current: Snapshot = {...EMPTY_SNAPSHOT, rates: [...EMPTY_SNAPSHOT.rates]};
    const listeners = new Set<(e: BridgeClientEvent) => void>();
    const notify = (e: BridgeClientEvent) => {
        for (const cb of [...listeners]) {
            try { cb(e); } catch (error) { queueMicrotask(() => { throw error; }); }
        }
    };
    const onMessage = (ev: MessageEvent) => {
        if (ev.source !== win) { return; }
        const msg = parseBridgeMessage(ev.data);
        if (msg === null) { return; }
        current = msg.snapshot;
        notify({name: 'snapshot'});
        if (msg.kind === 'event') { notify(msg.event); }
    };
    win.addEventListener('message', onMessage);
    const post = (c: Command) => { win.postMessage(commandMessage(c), win.location.origin); };
    post({name: 'requestSnapshot'});
    return {
        snapshot: () => current,
        command: post,
        onEvent: (cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; },
        dispose: () => { win.removeEventListener('message', onMessage); listeners.clear(); },
    };
}
