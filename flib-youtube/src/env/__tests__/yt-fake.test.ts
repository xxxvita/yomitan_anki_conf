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
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {BRIDGE_SOURCE, type Command, type Snapshot, type YtPlayerEvent} from '../../bridge/protocol';
import {createWindowBridgeClient, installFakeYT, type BridgeClient, type BridgeClientEvent} from '../yt-fake';

type AnyPlayer = Record<string, (...args: unknown[]) => unknown>;
type FakeYT = {
    Player: new (el: string | HTMLElement, opts: Record<string, unknown>) => AnyPlayer,
    PlayerState: Record<string, number>,
};

const BASE: Snapshot = {
    videoId: 'vid1', currentTime: 10, duration: 300, state: 2, rate: 1, rates: [0.5, 1, 1.5, 2],
    muted: false, volume: 80, loadedFraction: 0.25, adShowing: false, t: 0,
};

function fakeBridge(init: Partial<Snapshot> = {}) {
    let snap: Snapshot = {...BASE, ...init};
    const cbs = new Set<(e: BridgeClientEvent) => void>();
    const commands: Command[] = [];
    const client: BridgeClient = {
        snapshot: () => snap,
        command: (c) => { commands.push(c); },
        onEvent: (cb) => { cbs.add(cb); return () => { cbs.delete(cb); }; },
    };
    return {
        client,
        commands,
        listenerCount: () => cbs.size,
        set(p: Partial<Snapshot>) { snap = {...snap, ...p}; for (const cb of [...cbs]) { cb({name: 'snapshot'}); } },
        emit(e: YtPlayerEvent) { for (const cb of [...cbs]) { cb(e); } },
    };
}

const flush = () => new Promise<void>((r) => { setTimeout(r, 0); });

function setup(init: Partial<Snapshot> = {}, videoId = 'vid1') {
    const bridge = fakeBridge(init);
    const win = {} as unknown as Window;
    installFakeYT(win, bridge.client);
    const YT = (win as unknown as {YT: FakeYT}).YT;
    const events = {
        onReady: vi.fn(),
        onStateChange: vi.fn(),
        onPlaybackRateChange: vi.fn(),
        onError: vi.fn(),
        onApiChange: vi.fn(),
    };
    const player = new YT.Player('yt-player', {videoId, width: '100%', height: '100%', playerVars: {controls: 0}, events});
    return {bridge, YT, events, player};
}

async function ready(init: Partial<Snapshot> = {}) {
    const s = setup(init);
    await flush();
    expect(s.events.onReady).toHaveBeenCalledTimes(1);
    return s;
}

describe('installFakeYT', () => {
    it('puts YT.Player and the PlayerState codes on the window', () => {
        const {YT} = setup();
        expect(typeof YT.Player).toBe('function');
        expect(YT.PlayerState).toEqual({UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5});
    });

    it('never calls a callback synchronously; onReady comes after a microtask', async () => {
        const {events} = setup();
        expect(events.onReady).not.toHaveBeenCalled();
        await Promise.resolve();
        await Promise.resolve();
        expect(events.onReady).toHaveBeenCalledTimes(1);
    });

    it('onReady can read the player constant that the constructor is initialising', async () => {
        const bridge = fakeBridge();
        const win = {} as unknown as Window;
        installFakeYT(win, bridge.client);
        const YT = (win as unknown as {YT: FakeYT}).YT;
        let seen = -1;
        const player = new YT.Player('yt-player', {videoId: 'vid1', events: {onReady: () => { seen = player.getDuration() as number; }}});
        await flush();
        expect(seen).toBe(300);
    });

    it('onReady waits until the bridge reports the requested video id, and fires once', async () => {
        const {bridge, events} = setup({videoId: 'other'});
        await flush();
        expect(events.onReady).not.toHaveBeenCalled();
        bridge.set({videoId: null});
        await flush();
        expect(events.onReady).not.toHaveBeenCalled();
        bridge.set({videoId: 'vid1'});
        await flush();
        expect(events.onReady).toHaveBeenCalledTimes(1);
        bridge.set({currentTime: 11});
        bridge.set({videoId: 'other'});
        bridge.set({videoId: 'vid1'});
        await flush();
        expect(events.onReady).toHaveBeenCalledTimes(1);
    });

    it('getters return the snapshot', async () => {
        const {player} = await ready();
        expect(player.getCurrentTime()).toBe(10);
        expect(player.getDuration()).toBe(300);
        expect(player.getPlayerState()).toBe(2);
        expect(player.getPlaybackRate()).toBe(1);
        expect(player.getAvailablePlaybackRates()).toEqual([0.5, 1, 1.5, 2]);
        expect(player.isMuted()).toBe(false);
        expect(player.getVolume()).toBe(80);
        expect(player.getVideoLoadedFraction()).toBe(0.25);
        expect(player.getIframe()).toBeNull();
    });

    it('getters follow later snapshots; UNSTARTED and CUED are passed through as the player reports them', async () => {
        const {bridge, player} = await ready();
        bridge.set({state: -1, muted: true, volume: 30, rate: 1.5, loadedFraction: 0.5});
        expect(player.getPlayerState()).toBe(-1);
        expect(player.isMuted()).toBe(true);
        expect(player.getVolume()).toBe(30);
        expect(player.getPlaybackRate()).toBe(1.5);
        expect(player.getVideoLoadedFraction()).toBe(0.5);
        bridge.set({state: 5});
        expect(player.getPlayerState()).toBe(5);
    });

    it('getCurrentTime extrapolates a fresh snapshot while PLAYING, like the real library', async () => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(1000);
        try {
            const {bridge, player} = await ready({state: 1, currentTime: 20, rate: 2, t: 1000});
            now.mockReturnValue(1020);
            expect(player.getCurrentTime()).toBeCloseTo(20.04, 6);
            bridge.set({state: 2, t: 1020, currentTime: 20.04});
            now.mockReturnValue(2000);
            expect(player.getCurrentTime()).toBe(20.04);
            bridge.set({state: 1, t: 2000, currentTime: 299.99});
            now.mockReturnValue(2020);
            expect(player.getCurrentTime()).toBe(300);
        } finally {
            now.mockRestore();
        }
    });

    it('extrapolation is capped: a stale snapshot moves the time ahead by at most 0.25 s x rate (I1)', async () => {
        const now = vi.spyOn(performance, 'now').mockReturnValue(100000);
        try {
            const {bridge, player} = await ready({state: 1, currentTime: 10, rate: 2, t: 100000});
            for (const ms of [300, 1000, 5000, 60000]) {
                now.mockReturnValue(100000 + ms);
                const t = player.getCurrentTime() as number;
                expect(t).toBeGreaterThanOrEqual(10);
                expect(t).toBeLessThanOrEqual(10 + (0.25 * 2));
            }
            // A cross-world clock offset: the snapshot's t is 50 s behind the layer's clock ...
            bridge.set({t: 100000 - 50000});
            now.mockReturnValue(100000);
            expect(player.getCurrentTime()).toBeLessThanOrEqual(10 + (0.25 * 2));
            expect(player.getCurrentTime()).toBeGreaterThanOrEqual(10);
            // ... or 50 s in the future: never earlier than the posted time either.
            bridge.set({t: 100000 + 50000});
            expect(player.getCurrentTime()).toBe(10);
        } finally {
            now.mockRestore();
        }
    });

    it.each([[Number.NaN], [Number.POSITIVE_INFINITY], [undefined], [-1]])('getDuration of %s is 0', async (d) => {
        const {player} = await ready({duration: d as number});
        expect(player.getDuration()).toBe(0);
    });

    it('getAvailablePlaybackRates is never empty', async () => {
        const {player} = await ready({rates: []});
        const rates = player.getAvailablePlaybackRates() as number[];
        expect(rates.length).toBeGreaterThan(0);
        expect(rates).toContain(1);
    });

    it('player methods become bridge commands', async () => {
        const {bridge, player} = await ready();
        player.seekTo(12.5, true);
        player.playVideo();
        player.pauseVideo();
        player.setPlaybackRate(1.5);
        player.mute();
        player.unMute();
        player.setVolume(40);
        player.unloadModule('captions');
        player.unloadModule('cc');
        player.loadModule('captions');
        expect(bridge.commands).toEqual([
            {name: 'seekTo', seconds: 12.5},
            {name: 'playVideo'},
            {name: 'pauseVideo'},
            {name: 'setPlaybackRate', rate: 1.5},
            {name: 'mute'},
            {name: 'unMute'},
            {name: 'setVolume', volume: 40},
            {name: 'unloadModule', module: 'captions'},
            {name: 'unloadModule', module: 'cc'},
            {name: 'loadModule', module: 'captions'},
        ]);
    });

    it('malformed arguments are not sent', async () => {
        const {bridge, player} = await ready();
        player.seekTo(Number.NaN, true);
        player.seekTo('5', true);
        player.setPlaybackRate(0);
        player.setVolume(Number.POSITIVE_INFINITY);
        player.unloadModule('annotations');
        expect(bridge.commands).toEqual([]);
    });

    it('cueVideoById positions the current video only and never loads another one', async () => {
        const {bridge, player} = await ready();
        player.cueVideoById({videoId: 'vid1', startSeconds: 12});
        player.cueVideoById({videoId: 'vid9', startSeconds: 5});
        player.cueVideoById('vid1', 7);
        player.cueVideoById({videoId: 'vid1'});
        player.cueVideoById({videoId: 'vid1', startSeconds: 0});
        expect(bridge.commands).toEqual([{name: 'seekTo', seconds: 12}, {name: 'seekTo', seconds: 7}, {name: 'seekTo', seconds: 0}]);
    });

    it('player events arrive asynchronously with e.data and e.target', async () => {
        const {bridge, events, player} = await ready();
        bridge.emit({name: 'stateChange', data: 1});
        bridge.emit({name: 'playbackRateChange', data: 1.5});
        bridge.emit({name: 'error', data: 5});
        bridge.emit({name: 'apiChange'});
        expect(events.onStateChange).not.toHaveBeenCalled();
        expect(events.onPlaybackRateChange).not.toHaveBeenCalled();
        expect(events.onError).not.toHaveBeenCalled();
        expect(events.onApiChange).not.toHaveBeenCalled();
        await flush();
        expect(events.onStateChange).toHaveBeenCalledWith({data: 1, target: player});
        expect(events.onPlaybackRateChange).toHaveBeenCalledWith({data: 1.5, target: player});
        expect(events.onError).toHaveBeenCalledWith({data: 5, target: player});
        expect(events.onApiChange).toHaveBeenCalledWith({target: player});
    });

    it('no player events before onReady except errors of the requested video', async () => {
        const {bridge, events} = setup({videoId: 'other'});
        bridge.emit({name: 'stateChange', data: 1});
        bridge.emit({name: 'error', data: 2});
        await flush();
        expect(events.onStateChange).not.toHaveBeenCalled();
        expect(events.onError).not.toHaveBeenCalled();
    });

    it('onError at most once per player (its one video id): a page forging error events gets one (I2)', async () => {
        const {bridge, events, player} = await ready();
        for (let i = 0; i < 50; i++) { bridge.emit({name: 'error', data: 100 + i}); }
        await flush();
        expect(events.onError).toHaveBeenCalledTimes(1);
        expect(events.onError).toHaveBeenCalledWith({data: 100, target: player});
        // The next video is a new player (a new adapter on the site too): it may report its own error.
        const next = new (player.constructor as new (t: string, o: unknown) => unknown)('yt-player', {videoId: 'vid1', events: {onError: events.onError}});
        bridge.emit({name: 'error', data: 150});
        await flush();
        expect(events.onError).toHaveBeenCalledTimes(2);
        expect(events.onError).toHaveBeenLastCalledWith({data: 150, target: next});
    });

    it('an error event of a <video> element does not produce onError', async () => {
        const {events} = await ready();
        const video = document.createElement('video');
        document.body.appendChild(video);
        video.dispatchEvent(new Event('error'));
        await flush();
        expect(events.onError).not.toHaveBeenCalled();
        video.remove();
    });

    it('during an ad: content time and duration, BUFFERING, no commands; real values after it', async () => {
        const {bridge, events, player} = await ready({state: 1, currentTime: 50, duration: 600, rate: 1.25, loadedFraction: 0.4});
        bridge.set({adShowing: true, currentTime: 3, duration: 15, state: 1, rate: 1, loadedFraction: 1});
        expect(player.getCurrentTime()).toBe(50);
        expect(player.getDuration()).toBe(600);
        expect(player.getPlayerState()).toBe(3);
        expect(player.getPlaybackRate()).toBe(1.25);
        expect(player.getVideoLoadedFraction()).toBe(0.4);
        player.seekTo(10, true);
        player.playVideo();
        player.pauseVideo();
        player.setPlaybackRate(2);
        player.mute();
        player.unMute();
        player.setVolume(5);
        player.unloadModule('captions');
        player.cueVideoById({videoId: 'vid1', startSeconds: 3});
        expect(bridge.commands).toEqual([]);
        await flush();
        expect(events.onStateChange.mock.calls).toEqual([[{data: 3, target: player}]]);
        bridge.emit({name: 'stateChange', data: 1});
        bridge.emit({name: 'playbackRateChange', data: 1});
        bridge.emit({name: 'error', data: 5});
        await flush();
        expect(events.onStateChange).toHaveBeenCalledTimes(1);
        expect(events.onPlaybackRateChange).not.toHaveBeenCalled();
        expect(events.onError).not.toHaveBeenCalled();

        bridge.set({adShowing: false, currentTime: 50.1, duration: 600, state: 1, rate: 1.25, loadedFraction: 0.41});
        expect(player.getCurrentTime()).toBeGreaterThanOrEqual(50.1);
        expect(player.getPlayerState()).toBe(1);
        await flush();
        expect(events.onStateChange.mock.calls[1]).toEqual([{data: 1, target: player}]);
        player.seekTo(10, true);
        expect(bridge.commands).toEqual([{name: 'seekTo', seconds: 10}]);
    });

    it('a speed change made during an ad is reported after it', async () => {
        const {bridge, events, player} = await ready({state: 1, rate: 1});
        bridge.set({adShowing: true});
        bridge.set({rate: 1.5});
        await flush();
        expect(events.onPlaybackRateChange).not.toHaveBeenCalled();
        bridge.set({adShowing: false});
        await flush();
        expect(events.onPlaybackRateChange).toHaveBeenCalledWith({data: 1.5, target: player});
    });

    it('pre-roll before onReady: zero time and duration, BUFFERING, onReady only after the ad', async () => {
        const {bridge, events, player} = setup({adShowing: true, currentTime: 2, duration: 15, state: 1});
        await flush();
        expect(events.onReady).not.toHaveBeenCalled();
        expect(player.getCurrentTime()).toBe(0);
        expect(player.getDuration()).toBe(0);
        expect(player.getPlayerState()).toBe(3);
        bridge.set({adShowing: false, currentTime: 0.2, duration: 420});
        await flush();
        expect(events.onReady).toHaveBeenCalledTimes(1);
        expect(player.getDuration()).toBe(420);
    });

    it('YouTube moved to another video: values of the requested one, BUFFERING, no commands', async () => {
        const {bridge, player} = await ready({state: 1, currentTime: 70, duration: 600});
        bridge.set({videoId: 'vid2', currentTime: 1, duration: 99, state: 1});
        expect(player.getCurrentTime()).toBe(70);
        expect(player.getDuration()).toBe(600);
        expect(player.getPlayerState()).toBe(3);
        player.playVideo();
        expect(bridge.commands).toEqual([]);
    });

    it('destroy() unsubscribes, sends nothing and silences pending callbacks', async () => {
        const {bridge, events, player} = await ready();
        bridge.emit({name: 'stateChange', data: 1});
        expect(player.destroy()).toBeUndefined();
        expect(bridge.listenerCount()).toBe(0);
        player.seekTo(1, true);
        player.playVideo();
        player.unloadModule('captions');
        await flush();
        expect(bridge.commands).toEqual([]);
        expect(events.onStateChange).not.toHaveBeenCalled();
    });

    it('destroy() before onReady prevents onReady', async () => {
        const {events, player} = setup();
        player.destroy();
        await flush();
        expect(events.onReady).not.toHaveBeenCalled();
    });
});

describe('createWindowBridgeClient', () => {
    const origin = location.origin;
    let posted: unknown[] = [];
    let realPost: typeof window.postMessage;

    // jsdom leaves event.source null; a browser sets it to the posting window. Emulate the browser.
    beforeEach(() => {
        posted = [];
        realPost = window.postMessage;
        window.postMessage = ((data: unknown) => {
            posted.push(data);
            setTimeout(() => { window.dispatchEvent(new MessageEvent('message', {data: structuredClone(data), source: window, origin})); }, 0);
        }) as typeof window.postMessage;
    });
    afterEach(() => { window.postMessage = realPost; });

    const fromBridge = (msg: Record<string, unknown>, source: Window | null = window) => {
        window.dispatchEvent(new MessageEvent('message', {data: msg, source, origin}));
    };
    const snapMsg = (s: Partial<Snapshot> = {}) => ({source: BRIDGE_SOURCE, v: 1, from: 'bridge', kind: 'snapshot', snapshot: {...BASE, ...s}});

    it('posts nothing when created (the bridge stays idle until subscribe) and starts from an empty snapshot', () => {
        const client = createWindowBridgeClient(window);
        expect(posted).toEqual([]);
        expect(client.snapshot().videoId).toBeNull();
        client.dispose();
    });

    it('subscribe after an unsubscribe drops the stale snapshot: a new player waits for a fresh one (M1)', () => {
        const client = createWindowBridgeClient(window);
        client.command({name: 'subscribe'});
        fromBridge(snapMsg({currentTime: 42}));
        expect(client.snapshot().currentTime).toBe(42);
        client.command({name: 'subscribe'}); // already subscribed: kept
        expect(client.snapshot().currentTime).toBe(42);
        client.command({name: 'unsubscribe'});
        client.command({name: 'subscribe'});
        expect(client.snapshot().videoId).toBeNull();
        expect(posted.map((m) => (m as {command: {name: string}}).command.name)).toEqual(['subscribe', 'subscribe', 'unsubscribe', 'subscribe']);
        client.dispose();
    });

    it('takes snapshots from bridge messages and notifies', () => {
        const client = createWindowBridgeClient(window);
        const seen: BridgeClientEvent[] = [];
        client.onEvent((e) => { seen.push(e); });
        fromBridge(snapMsg({currentTime: 42}));
        expect(client.snapshot()).toEqual({...BASE, currentTime: 42});
        expect(seen).toEqual([{name: 'snapshot'}]);
        client.dispose();
    });

    it('an event message updates the snapshot first, then delivers the event', () => {
        const client = createWindowBridgeClient(window);
        const seen: [BridgeClientEvent, number][] = [];
        client.onEvent((e) => { seen.push([e, client.snapshot().state]); });
        fromBridge({source: BRIDGE_SOURCE, v: 1, from: 'bridge', kind: 'event', event: {name: 'stateChange', data: 1}, snapshot: {...BASE, state: 1}});
        expect(seen).toEqual([[{name: 'snapshot'}, 1], [{name: 'stateChange', data: 1}, 1]]);
        client.dispose();
    });

    it.each([
        ['no source', {v: 1, from: 'bridge', kind: 'snapshot', snapshot: BASE}],
        ['wrong source', {source: 'x', v: 1, from: 'bridge', kind: 'snapshot', snapshot: BASE}],
        ['wrong version', {source: BRIDGE_SOURCE, v: 2, from: 'bridge', kind: 'snapshot', snapshot: BASE}],
        ['own direction', {source: BRIDGE_SOURCE, v: 1, from: 'layer', kind: 'snapshot', snapshot: BASE}],
        ['unknown kind', {source: BRIDGE_SOURCE, v: 1, from: 'bridge', kind: 'eval', snapshot: BASE}],
        ['bad snapshot', {source: BRIDGE_SOURCE, v: 1, from: 'bridge', kind: 'snapshot', snapshot: {...BASE, state: 'playing'}}],
        ['bad videoId', {source: BRIDGE_SOURCE, v: 1, from: 'bridge', kind: 'snapshot', snapshot: {...BASE, videoId: 7}}],
        ['bad event', {source: BRIDGE_SOURCE, v: 1, from: 'bridge', kind: 'event', event: {name: 'eval', data: 1}, snapshot: BASE}],
    ])('ignores a message with %s', (_label, msg) => {
        const client = createWindowBridgeClient(window);
        const cb = vi.fn();
        client.onEvent(cb);
        fromBridge(msg as Record<string, unknown>);
        expect(cb).not.toHaveBeenCalled();
        expect(client.snapshot().videoId).toBeNull();
        client.dispose();
    });

    it('ignores messages from another window (e.g. a child frame)', () => {
        const client = createWindowBridgeClient(window);
        const cb = vi.fn();
        client.onEvent(cb);
        fromBridge(snapMsg(), null);
        expect(cb).not.toHaveBeenCalled();
        client.dispose();
    });

    it('sends commands as layer messages to its own origin', () => {
        const spy = vi.spyOn(window, 'postMessage');
        const client = createWindowBridgeClient(window);
        client.command({name: 'seekTo', seconds: 30});
        expect(spy).toHaveBeenLastCalledWith({source: BRIDGE_SOURCE, v: 1, from: 'layer', kind: 'command', command: {name: 'seekTo', seconds: 30}}, origin);
        client.dispose();
        spy.mockRestore();
    });

    it('dispose() stops listening and the unsubscribe function works', () => {
        const client = createWindowBridgeClient(window);
        const cb = vi.fn();
        const off = client.onEvent(cb);
        off();
        fromBridge(snapMsg());
        expect(cb).not.toHaveBeenCalled();
        const cb2 = vi.fn();
        client.onEvent(cb2);
        client.dispose();
        fromBridge(snapMsg({currentTime: 99}));
        expect(cb2).not.toHaveBeenCalled();
    });
});
