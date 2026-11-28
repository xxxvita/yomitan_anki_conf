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
// Wire protocol between the page-world bridge (bridge/main-world.ts, runs in YouTube's own JS world)
// and the layer (env/yt-fake.ts, runs in the extension's isolated world). Both worlds share the
// window's `message` events, so every message is
//   window.postMessage({source: 'flib-yt-bridge', v: 1, from, kind, ...}, location.origin)
// and each side accepts only the other side's direction (`from`), from the same window
// (`event.source === window`), after a strict shape check that copies known fields only.
//
// Trust: page scripts see these messages and can forge them; there is no secret both worlds share.
// That is accepted. A forged snapshot can only mislead the panel's clock; a forged command can
// only call one of the fixed player methods below with checked numeric arguments, which the page
// could call on its own player anyway, or start, idle or stop the bridge (`stop` turns the panel
// off on that page only). Nothing from a message is ever evaluated, used as a
// property name, or passed through unchecked.

export const BRIDGE_SOURCE = 'flib-yt-bridge';
export const BRIDGE_VERSION = 1;

/** YT.PlayerState codes, the same in YouTube's page player and in the IFrame API. */
export const YT_STATE = {UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5} as const;
const STATES: readonly number[] = Object.values(YT_STATE);

export type Snapshot = {
    /** `getVideoData().video_id` of #movie_player; null while there is no player. */
    videoId: string | null,
    currentTime: number,
    /** Seconds; 0 when unknown. The bridge never sends NaN/Infinity, the fake guards anyway. */
    duration: number,
    state: number,
    rate: number,
    rates: number[],
    muted: boolean,
    /** 0..100, as in the YouTube API. */
    volume: number,
    loadedFraction: number,
    /** #movie_player has the class `ad-showing`. */
    adShowing: boolean,
    /** performance.now() of the page when the values were read (both worlds share the clock). */
    t: number,
};

export const EMPTY_SNAPSHOT: Snapshot = {
    videoId: null, currentTime: 0, duration: 0, state: YT_STATE.UNSTARTED, rate: 1, rates: [1],
    muted: false, volume: 100, loadedFraction: 0, adShowing: false, t: 0,
};

export type CaptionsModule = 'captions' | 'cc';

export type Command =
    | {name: 'seekTo', seconds: number}
    | {name: 'playVideo'}
    | {name: 'pauseVideo'}
    | {name: 'setPlaybackRate', rate: number}
    | {name: 'mute'}
    | {name: 'unMute'}
    | {name: 'setVolume', volume: number}
    | {name: 'loadModule', module: CaptionsModule}
    | {name: 'unloadModule', module: CaptionsModule}
    /** Turn YouTube's captions back on if they were on before the first unloadModule. */
    | {name: 'restoreCaptions'}
    /** Post a snapshot now (one snapshot; it does not start polling). */
    | {name: 'requestSnapshot'}
    /** The panel is shown: start polling (frames while PLAYING, the heartbeat) and posting player events. */
    | {name: 'subscribe'}
    /** The panel is hidden: idle again (no polling, no player listeners); commands still run. */
    | {name: 'unsubscribe'}
    /**
     * The layer is stopped (beta off): the bridge ends for good (loops, listeners, its handle on
     * window). A page that forges it only turns the panel off on its own page.
     */
    | {name: 'stop'};

/** Events of YouTube's player API (never of the <video> element). */
export type YtPlayerEvent =
    | {name: 'stateChange', data: number}
    | {name: 'playbackRateChange', data: number}
    | {name: 'error', data: number}
    | {name: 'apiChange'};

export type BridgeMessage =
    | {source: typeof BRIDGE_SOURCE, v: typeof BRIDGE_VERSION, from: 'bridge', kind: 'snapshot', snapshot: Snapshot}
    | {source: typeof BRIDGE_SOURCE, v: typeof BRIDGE_VERSION, from: 'bridge', kind: 'event', event: YtPlayerEvent, snapshot: Snapshot};

export type LayerMessage = {source: typeof BRIDGE_SOURCE, v: typeof BRIDGE_VERSION, from: 'layer', kind: 'command', command: Command};

export const MAX_RATE = 16;
const MAX_RATES = 32;
const VIDEO_ID = /^[\w-]{1,64}$/;

type Rec = Record<string, unknown>;
const isRec = (x: unknown): x is Rec => typeof x === 'object' && x !== null && !Array.isArray(x);
const isNum = (x: unknown): x is number => typeof x === 'number';
const isFin = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x);
const isModule = (x: unknown): x is CaptionsModule => x === 'captions' || x === 'cc';

export function isValidSeconds(x: unknown): x is number { return isFin(x) && x >= 0; }
export function isValidRate(x: unknown): x is number { return isFin(x) && x > 0 && x <= MAX_RATE; }
export function isValidVolume(x: unknown): x is number { return isFin(x) && x >= 0 && x <= 100; }

export function parseSnapshot(x: unknown): Snapshot | null {
    if (!isRec(x)) { return null; }
    const {videoId, currentTime, duration, state, rate, rates, muted, volume, loadedFraction, adShowing, t} = x;
    if (!(videoId === null || (typeof videoId === 'string' && VIDEO_ID.test(videoId)))) { return null; }
    if (!isFin(currentTime) || !isNum(duration) || !isNum(state) || !STATES.includes(state)) { return null; }
    if (!isValidRate(rate) || !Array.isArray(rates) || rates.length > MAX_RATES || !rates.every((r) => isValidRate(r))) { return null; }
    if (typeof muted !== 'boolean' || !isValidVolume(volume) || !isFin(loadedFraction) || typeof adShowing !== 'boolean' || !isFin(t)) { return null; }
    return {videoId, currentTime, duration, state, rate, rates: [...rates] as number[], muted, volume, loadedFraction, adShowing, t};
}

export function parseCommand(x: unknown): Command | null {
    if (!isRec(x)) { return null; }
    switch (x.name) {
        case 'seekTo': return isValidSeconds(x.seconds) ? {name: 'seekTo', seconds: x.seconds} : null;
        case 'setPlaybackRate': return isValidRate(x.rate) ? {name: 'setPlaybackRate', rate: x.rate} : null;
        case 'setVolume': return isValidVolume(x.volume) ? {name: 'setVolume', volume: x.volume} : null;
        case 'loadModule': return isModule(x.module) ? {name: 'loadModule', module: x.module} : null;
        case 'unloadModule': return isModule(x.module) ? {name: 'unloadModule', module: x.module} : null;
        case 'playVideo': return {name: 'playVideo'};
        case 'pauseVideo': return {name: 'pauseVideo'};
        case 'mute': return {name: 'mute'};
        case 'unMute': return {name: 'unMute'};
        case 'restoreCaptions': return {name: 'restoreCaptions'};
        case 'requestSnapshot': return {name: 'requestSnapshot'};
        case 'subscribe': return {name: 'subscribe'};
        case 'unsubscribe': return {name: 'unsubscribe'};
        case 'stop': return {name: 'stop'};
        default: return null;
    }
}

export function parsePlayerEvent(x: unknown): YtPlayerEvent | null {
    if (!isRec(x)) { return null; }
    switch (x.name) {
        case 'stateChange': return isNum(x.data) && STATES.includes(x.data) ? {name: 'stateChange', data: x.data} : null;
        case 'playbackRateChange': return isValidRate(x.data) ? {name: 'playbackRateChange', data: x.data} : null;
        case 'error': return Number.isInteger(x.data) ? {name: 'error', data: x.data as number} : null;
        case 'apiChange': return {name: 'apiChange'};
        default: return null;
    }
}

const isOurs = (x: unknown, from: 'bridge' | 'layer'): x is Rec => isRec(x) && x.source === BRIDGE_SOURCE && x.v === BRIDGE_VERSION && x.from === from;

/** For the layer: a message from the bridge, or null. */
export function parseBridgeMessage(x: unknown): BridgeMessage | null {
    if (!isOurs(x, 'bridge')) { return null; }
    const snapshot = parseSnapshot(x.snapshot);
    if (snapshot === null) { return null; }
    if (x.kind === 'snapshot') { return {source: BRIDGE_SOURCE, v: BRIDGE_VERSION, from: 'bridge', kind: 'snapshot', snapshot}; }
    if (x.kind === 'event') {
        const event = parsePlayerEvent(x.event);
        return event === null ? null : {source: BRIDGE_SOURCE, v: BRIDGE_VERSION, from: 'bridge', kind: 'event', event, snapshot};
    }
    return null;
}

/** For the bridge: a command from the layer, or null. */
export function parseLayerMessage(x: unknown): LayerMessage | null {
    if (!isOurs(x, 'layer') || x.kind !== 'command') { return null; }
    const command = parseCommand(x.command);
    return command === null ? null : {source: BRIDGE_SOURCE, v: BRIDGE_VERSION, from: 'layer', kind: 'command', command};
}

export function snapshotMessage(snapshot: Snapshot): BridgeMessage {
    return {source: BRIDGE_SOURCE, v: BRIDGE_VERSION, from: 'bridge', kind: 'snapshot', snapshot};
}

export function eventMessage(event: YtPlayerEvent, snapshot: Snapshot): BridgeMessage {
    return {source: BRIDGE_SOURCE, v: BRIDGE_VERSION, from: 'bridge', kind: 'event', event, snapshot};
}

export function commandMessage(command: Command): LayerMessage {
    return {source: BRIDGE_SOURCE, v: BRIDGE_VERSION, from: 'layer', kind: 'command', command};
}
