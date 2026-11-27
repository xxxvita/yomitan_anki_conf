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
// The copied site adapter, unchanged, over the YouTube IFrame API emulation.
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {createIFrameAdapter, type PlayerAdapter} from 'flib-site/adapter/IFrameAdapter';
import type {Command, Snapshot, YtPlayerEvent} from '../../bridge/protocol';
import {installFakeYT, type BridgeClient, type BridgeClientEvent} from '../yt-fake';

function fakeBridge(init: Partial<Snapshot>) {
    let snap: Snapshot = {
        videoId: 'vid1', currentTime: 10, duration: 300, state: 1, rate: 1, rates: [0.5, 1, 1.5, 2],
        muted: false, volume: 100, loadedFraction: 0.1, adShowing: false, t: performance.now(), ...init,
    };
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
        get: () => snap,
        set(p: Partial<Snapshot>) { snap = {...snap, t: performance.now(), ...p}; for (const cb of [...cbs]) { cb({name: 'snapshot'}); } },
        emit(e: YtPlayerEvent) { for (const cb of [...cbs]) { cb(e); } },
    };
}

type Bridge = ReturnType<typeof fakeBridge>;

/** Plays the content in the fake bridge: every 16 ms frame the time advances like a real player. */
async function play(bridge: Bridge, ms: number, field: 'content' | 'ad' = 'content') {
    for (let left = ms; left > 0; left -= 16) {
        await vi.advanceTimersByTimeAsync(16);
        const s = bridge.get();
        bridge.set({currentTime: s.currentTime + (0.016 * s.rate), ...(field === 'ad' ? {adShowing: true} : {})});
    }
}

describe('IFrameAdapter.ts (verbatim copy) over the emulation', () => {
    beforeEach(() => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance', 'Date']});
        delete (window as unknown as {YT?: unknown}).YT;
    });
    afterEach(() => {
        vi.useRealTimers();
        delete (window as unknown as {YT?: unknown}).YT;
    });

    async function mount(bridge: Bridge, videoId = 'vid1') {
        installFakeYT(window, bridge.client);
        let adapter: PlayerAdapter | null = null;
        void createIFrameAdapter('yt-player', videoId, {}, () => false).then((a) => { adapter = a; });
        await vi.advanceTimersByTimeAsync(0);
        return {get: () => adapter};
    }

    it('resolves without injecting the real iframe_api', async () => {
        const bridge = fakeBridge({});
        const m = await mount(bridge);
        const adapter = m.get() as PlayerAdapter | null;
        expect(adapter).not.toBeNull();
        expect(document.head.querySelector('script[src*="iframe_api"]')).toBeNull();
        expect(document.querySelector('script[src*="youtube.com"]')).toBeNull();
        expect((window as unknown as {onYouTubeIframeAPIReady?: unknown}).onYouTubeIframeAPIReady).toBeUndefined();
        expect(adapter?.duration()).toBe(300);
        expect(adapter?.paused()).toBe(false);
        expect(adapter?.getAvailableRates()).toEqual([0.5, 1, 1.5, 2]);
        adapter?.destroy();
    });

    it('currentTime() grows between the 150 ms polls while PLAYING (clock-shim smoothing)', async () => {
        const bridge = fakeBridge({currentTime: 10, state: 1});
        const adapter = (await mount(bridge)).get() as unknown as PlayerAdapter;
        await play(bridge, 320);
        const a = adapter.currentTime();
        await vi.advanceTimersByTimeAsync(50);
        const b = adapter.currentTime();
        await vi.advanceTimersByTimeAsync(50);
        const c = adapter.currentTime();
        expect(b).toBeGreaterThan(a);
        expect(c).toBeGreaterThan(b);
        expect(c).toBeCloseTo(10 + 0.42, 1);
        adapter.destroy();
    });

    it('seek(30) sends seekTo 30, play/pause/rate/volume go to the bridge', async () => {
        const bridge = fakeBridge({});
        const adapter = (await mount(bridge)).get() as unknown as PlayerAdapter;
        const unload = bridge.commands.filter((c) => c.name === 'unloadModule');
        expect(unload).toEqual([{name: 'unloadModule', module: 'captions'}, {name: 'unloadModule', module: 'cc'}]);
        bridge.commands.length = 0;
        adapter.seek(30);
        adapter.pause();
        adapter.play();
        adapter.setRate(1.4);
        adapter.setVolume(55);
        adapter.mute();
        adapter.unmute();
        expect(bridge.commands).toEqual([
            {name: 'seekTo', seconds: 30},
            {name: 'pauseVideo'},
            {name: 'playVideo'},
            {name: 'setPlaybackRate', rate: 1.5},
            {name: 'setVolume', volume: 55},
            {name: 'mute'},
            {name: 'unMute'},
        ]);
        expect(adapter.currentTime()).toBe(30);
        adapter.destroy();
    });

    it('state, volume and rate events of the player reach the adapter', async () => {
        const bridge = fakeBridge({});
        const adapter = (await mount(bridge)).get() as unknown as PlayerAdapter;
        const states: unknown[] = [];
        const volumes: unknown[] = [];
        adapter.on('state', (s) => { states.push(s); });
        adapter.on('volume', (v) => { volumes.push(v); });
        bridge.set({state: 2});
        bridge.emit({name: 'stateChange', data: 2});
        bridge.set({volume: 40, muted: true});
        await vi.advanceTimersByTimeAsync(160);
        expect(states).toContain('paused');
        expect(volumes[volumes.length - 1]).toEqual({muted: true, volume: 40});
        bridge.set({rate: 1.5});
        bridge.emit({name: 'playbackRateChange', data: 1.5});
        await vi.advanceTimersByTimeAsync(0);
        expect(adapter.rate()).toBe(1.5);
        adapter.destroy();
    });

    it('an ad in the middle: the clock stays on the content, the timeline keeps the content duration', async () => {
        const bridge = fakeBridge({currentTime: 100, duration: 600, state: 1});
        const adapter = (await mount(bridge)).get() as unknown as PlayerAdapter;
        await play(bridge, 320);
        const before = adapter.currentTime();
        // The ad plays on the same <video>: consistent time from 0 for 3 s (clock-shim alone would re-baseline in ~300 ms).
        bridge.set({adShowing: true, currentTime: 0, duration: 15, state: 1});
        await play(bridge, 3000, 'ad');
        expect(adapter.currentTime()).toBeGreaterThan(before - 0.5);
        expect(adapter.currentTime()).toBeLessThan(before + 0.5);
        expect(adapter.duration()).toBe(600);
        expect(adapter.buffering()).toBe(true);
        bridge.commands.length = 0;
        adapter.seek(5);
        adapter.play();
        expect(bridge.commands).toEqual([]);
        // The 15 s botwall check does not fire on an ad.
        const unplayable = vi.fn();
        adapter.on('unplayable', unplayable);
        await play(bridge, 16000, 'ad');
        expect(unplayable).not.toHaveBeenCalled();
        // After the ad the content goes on.
        bridge.set({adShowing: false, currentTime: before + 0.1, duration: 600, state: 1});
        await play(bridge, 480);
        expect(adapter.currentTime()).toBeGreaterThan(before);
        expect(adapter.buffering()).toBe(false);
        adapter.destroy();
    });

    it('moving to another video during an ad: no onReady for vid2 until the ad ends, then the content duration (Review Focus 4)', async () => {
        const bridge = fakeBridge({videoId: 'vid2', adShowing: true, currentTime: 0, duration: 15, state: 1});
        const m = await mount(bridge, 'vid2');
        await play(bridge, 2000, 'ad');
        expect(m.get()).toBeNull();
        bridge.set({adShowing: false, currentTime: 0, duration: 420, state: 1});
        await vi.advanceTimersByTimeAsync(0);
        const adapter = m.get() as PlayerAdapter | null;
        expect(adapter).not.toBeNull();
        expect(adapter?.duration()).toBe(420);
        adapter?.destroy();
    });

    it('before the page shows the requested video the adapter waits; the old video does not seed it', async () => {
        const bridge = fakeBridge({videoId: 'vid1', currentTime: 200, duration: 900, state: 1});
        const m = await mount(bridge, 'vid2');
        await play(bridge, 500);
        expect(m.get()).toBeNull();
        bridge.set({videoId: 'vid2', currentTime: 0, duration: 120});
        await vi.advanceTimersByTimeAsync(0);
        const adapter = m.get() as PlayerAdapter | null;
        expect(adapter?.duration()).toBe(120);
        expect(adapter?.currentTime()).toBeLessThan(1);
        adapter?.destroy();
    });

    it('destroy() stops the poll and leaves YouTube alone', async () => {
        const bridge = fakeBridge({});
        const adapter = (await mount(bridge)).get() as unknown as PlayerAdapter;
        adapter.destroy();
        bridge.commands.length = 0;
        await play(bridge, 1000);
        expect(bridge.commands).toEqual([]);
    });
});
