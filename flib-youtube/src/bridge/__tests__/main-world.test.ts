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
import {BRIDGE_SOURCE, type Command, type Snapshot} from '../protocol';
import {startBridge} from '../main-world';

type Listener = (data?: unknown) => void;

/** A stand-in for YouTube's #movie_player: an element carrying the player API, like the real one. */
function makeMoviePlayer(init: {videoId?: string, captionsOn?: boolean} = {}) {
    const el = document.createElement('div');
    el.id = 'movie_player';
    const video = document.createElement('video');
    video.className = 'html5-main-video';
    el.appendChild(video);
    const listeners = new Map<string, Set<Listener>>();
    const p = {
        time: 12.5, duration: 300, state: 1, rate: 1, volume: 70, muted: false, fraction: 0.3,
        videoId: init.videoId ?? 'vid1', captionsOn: init.captionsOn ?? false,
    };
    const api = {
        getCurrentTime: vi.fn(() => p.time),
        getDuration: vi.fn(() => p.duration),
        getPlayerState: vi.fn(() => p.state),
        getPlaybackRate: vi.fn(() => p.rate),
        getAvailablePlaybackRates: vi.fn(() => [0.25, 0.5, 1, 1.5, 2]),
        isMuted: vi.fn(() => p.muted),
        getVolume: vi.fn(() => p.volume),
        getVideoLoadedFraction: vi.fn(() => p.fraction),
        getVideoData: vi.fn(() => ({video_id: p.videoId, title: 'x'})),
        seekTo: vi.fn((t: number) => { p.time = t; }),
        playVideo: vi.fn(() => { p.state = 1; }),
        pauseVideo: vi.fn(() => { p.state = 2; }),
        setPlaybackRate: vi.fn((r: number) => { p.rate = r; }),
        mute: vi.fn(() => { p.muted = true; }),
        unMute: vi.fn(() => { p.muted = false; }),
        setVolume: vi.fn((v: number) => { p.volume = v; }),
        loadModule: vi.fn((m: string) => { if (m === 'captions') { p.captionsOn = true; } }),
        unloadModule: vi.fn((m: string) => { if (m === 'captions' || m === 'cc') { p.captionsOn = false; } }),
        getOption: vi.fn((m: string, o: string) => (m === 'captions' && o === 'track' && p.captionsOn ? {languageCode: 'en'} : {})),
        // The player API replaces the element's addEventListener on the real page too.
        addEventListener: vi.fn((name: string, fn: Listener) => {
            if (!listeners.has(name)) { listeners.set(name, new Set()); }
            listeners.get(name)?.add(fn);
        }),
        removeEventListener: vi.fn((name: string, fn: Listener) => { listeners.get(name)?.delete(fn); }),
    };
    Object.assign(el, api);
    const fire = (name: string, data?: unknown) => { for (const fn of listeners.get(name) ?? []) { fn(data); } };
    return {el, video, p, api, fire, listeners};
}

type Msg = {source: string, v: number, from: string, kind: string, snapshot?: Snapshot, event?: {name: string, data?: number}};

describe('page-world bridge', () => {
    let posted: Msg[] = [];
    let realPost: typeof window.postMessage;
    let stop: (() => void) | null = null;

    beforeEach(() => {
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'requestAnimationFrame', 'cancelAnimationFrame', 'performance']});
        posted = [];
        realPost = window.postMessage;
        // jsdom leaves event.source null and dispatches through its own timer; emulate the browser.
        window.postMessage = ((data: unknown) => {
            const copy = structuredClone(data) as Msg;
            if (copy.from === 'bridge') { posted.push(copy); }
            window.dispatchEvent(new MessageEvent('message', {data: copy, source: window, origin: location.origin}));
        }) as typeof window.postMessage;
    });
    afterEach(() => {
        stop?.();
        stop = null;
        window.postMessage = realPost;
        document.getElementById('movie_player')?.remove();
        vi.useRealTimers();
    });

    const start = () => { stop = startBridge(window).stop; };
    const snapshots = () => posted.filter((m) => m.kind === 'snapshot' || m.kind === 'event').map((m) => m.snapshot as Snapshot);
    const last = () => { const s = snapshots(); return s[s.length - 1]; };
    const send = (data: unknown, source: Window | null = window) => {
        window.dispatchEvent(new MessageEvent('message', {data, source, origin: location.origin}));
    };
    const command = (c: Command | Record<string, unknown>) => send({source: BRIDGE_SOURCE, v: 1, from: 'layer', kind: 'command', command: c});

    it('posts a snapshot of the Snapshot shape on animation frames', () => {
        const mp = makeMoviePlayer();
        document.body.appendChild(mp.el);
        start();
        vi.advanceTimersByTime(20);
        const s = last();
        expect(s).toEqual({
            videoId: 'vid1', currentTime: 12.5, duration: 300, state: 1, rate: 1, rates: [0.25, 0.5, 1, 1.5, 2],
            muted: false, volume: 70, loadedFraction: 0.3, adShowing: false, t: expect.any(Number),
        });
        expect(posted[posted.length - 1]).toMatchObject({source: BRIDGE_SOURCE, v: 1, from: 'bridge', kind: 'snapshot'});
        mp.p.time = 13;
        vi.advanceTimersByTime(20);
        expect(last().currentTime).toBe(13);
    });

    it('posts the snapshot and the event on onStateChange of the player', () => {
        const mp = makeMoviePlayer();
        document.body.appendChild(mp.el);
        start();
        vi.advanceTimersByTime(20);
        mp.p.state = 2;
        mp.fire('onStateChange', 2);
        const m = posted[posted.length - 1];
        expect(m.kind).toBe('event');
        expect(m.event).toEqual({name: 'stateChange', data: 2});
        expect(m.snapshot?.state).toBe(2);
    });

    it('forwards onError, onPlaybackRateChange and onApiChange of the player API', () => {
        const mp = makeMoviePlayer();
        document.body.appendChild(mp.el);
        start();
        vi.advanceTimersByTime(20);
        mp.fire('onError', 5);
        mp.fire('onPlaybackRateChange', 1.5);
        mp.fire('onApiChange');
        expect(posted.filter((m) => m.kind === 'event').map((m) => m.event)).toEqual([
            {name: 'error', data: 5}, {name: 'playbackRateChange', data: 1.5}, {name: 'apiChange'},
        ]);
    });

    it('does not turn <video> error events into player errors', () => {
        const mp = makeMoviePlayer();
        document.body.appendChild(mp.el);
        start();
        vi.advanceTimersByTime(20);
        mp.video.dispatchEvent(new Event('error'));
        expect(posted.filter((m) => m.kind === 'event')).toEqual([]);
    });

    it('adShowing follows the ad-showing class of #movie_player', () => {
        const mp = makeMoviePlayer();
        document.body.appendChild(mp.el);
        start();
        vi.advanceTimersByTime(20);
        expect(last().adShowing).toBe(false);
        mp.el.classList.add('ad-showing');
        vi.advanceTimersByTime(20);
        expect(last().adShowing).toBe(true);
        mp.el.classList.remove('ad-showing');
        vi.advanceTimersByTime(20);
        expect(last().adShowing).toBe(false);
    });

    it('sanitises non-finite numbers from the player', () => {
        const mp = makeMoviePlayer();
        mp.p.duration = Number.NaN;
        mp.p.time = Number.NaN;
        document.body.appendChild(mp.el);
        start();
        vi.advanceTimersByTime(20);
        expect(last().duration).toBe(0);
        expect(last().currentTime).toBe(0);
        mp.p.duration = Number.POSITIVE_INFINITY;
        vi.advanceTimersByTime(20);
        expect(last().duration).toBe(0);
    });

    it('copes with #movie_player appearing late and being replaced', () => {
        start();
        vi.advanceTimersByTime(20);
        expect(last().videoId).toBeNull();
        const a = makeMoviePlayer({videoId: 'vidA'});
        document.body.appendChild(a.el);
        vi.advanceTimersByTime(20);
        expect(last().videoId).toBe('vidA');
        expect(a.api.addEventListener).toHaveBeenCalledWith('onStateChange', expect.any(Function));
        a.el.remove();
        const b = makeMoviePlayer({videoId: 'vidB'});
        document.body.appendChild(b.el);
        vi.advanceTimersByTime(20);
        expect(last().videoId).toBe('vidB');
        expect(b.api.addEventListener).toHaveBeenCalledWith('onStateChange', expect.any(Function));
        const before = posted.length;
        a.fire('onStateChange', 2);
        expect(posted.length).toBe(before);
        b.fire('onStateChange', 2);
        expect(posted[posted.length - 1].event).toEqual({name: 'stateChange', data: 2});
    });

    it('answers requestSnapshot at once', () => {
        const mp = makeMoviePlayer();
        document.body.appendChild(mp.el);
        start();
        const before = posted.length;
        command({name: 'requestSnapshot'});
        expect(posted.length).toBe(before + 1);
        expect(last().videoId).toBe('vid1');
    });

    it('executes valid commands on the player API', () => {
        const mp = makeMoviePlayer();
        document.body.appendChild(mp.el);
        start();
        command({name: 'seekTo', seconds: 30});
        command({name: 'pauseVideo'});
        command({name: 'playVideo'});
        command({name: 'mute'});
        command({name: 'unMute'});
        expect(mp.api.seekTo).toHaveBeenCalledWith(30, true);
        expect(mp.api.pauseVideo).toHaveBeenCalledTimes(1);
        expect(mp.api.playVideo).toHaveBeenCalledTimes(1);
        expect(mp.api.mute).toHaveBeenCalledTimes(1);
        expect(mp.api.unMute).toHaveBeenCalledTimes(1);
    });

    it.each([
        ['no source', {v: 1, from: 'layer', kind: 'command', command: {name: 'playVideo'}}],
        ['v !== 1', {source: BRIDGE_SOURCE, v: 2, from: 'layer', kind: 'command', command: {name: 'playVideo'}}],
        ['bridge direction', {source: BRIDGE_SOURCE, v: 1, from: 'bridge', kind: 'command', command: {name: 'playVideo'}}],
        ['unknown kind', {source: BRIDGE_SOURCE, v: 1, from: 'layer', kind: 'call', command: {name: 'playVideo'}}],
        ['unknown name', {source: BRIDGE_SOURCE, v: 1, from: 'layer', kind: 'command', command: {name: 'loadVideoById', videoId: 'x'}}],
        ['bad seconds', {source: BRIDGE_SOURCE, v: 1, from: 'layer', kind: 'command', command: {name: 'seekTo', seconds: '30'}}],
        ['NaN seconds', {source: BRIDGE_SOURCE, v: 1, from: 'layer', kind: 'command', command: {name: 'seekTo', seconds: Number.NaN}}],
        ['bad volume', {source: BRIDGE_SOURCE, v: 1, from: 'layer', kind: 'command', command: {name: 'setVolume', volume: 500}}],
        ['bad module', {source: BRIDGE_SOURCE, v: 1, from: 'layer', kind: 'command', command: {name: 'unloadModule', module: 'annotations'}}],
        ['a string', 'playVideo'],
        ['null', null],
    ])('ignores a command with %s', (_label, data) => {
        const mp = makeMoviePlayer();
        document.body.appendChild(mp.el);
        start();
        send(data);
        expect(mp.api.playVideo).not.toHaveBeenCalled();
        expect(mp.api.seekTo).not.toHaveBeenCalled();
        expect(mp.api.setVolume).not.toHaveBeenCalled();
        expect(mp.api.unloadModule).not.toHaveBeenCalled();
        expect(mp.api.loadModule).not.toHaveBeenCalled();
    });

    it('ignores a valid command from another window', () => {
        const mp = makeMoviePlayer();
        document.body.appendChild(mp.el);
        start();
        send({source: BRIDGE_SOURCE, v: 1, from: 'layer', kind: 'command', command: {name: 'playVideo'}}, null);
        expect(mp.api.playVideo).not.toHaveBeenCalled();
    });

    it('unloads captions on the player and restores them only if they were on', () => {
        const mp = makeMoviePlayer({captionsOn: true});
        document.body.appendChild(mp.el);
        start();
        command({name: 'unloadModule', module: 'captions'});
        command({name: 'unloadModule', module: 'cc'});
        expect(mp.api.unloadModule).toHaveBeenCalledWith('captions');
        expect(mp.api.unloadModule).toHaveBeenCalledWith('cc');
        // A later unload, with captions already off, must not overwrite what was there before.
        command({name: 'unloadModule', module: 'captions'});
        command({name: 'restoreCaptions'});
        expect(mp.api.loadModule).toHaveBeenCalledTimes(1);
        expect(mp.api.loadModule).toHaveBeenCalledWith('captions');
        // Restoring is one-shot.
        command({name: 'restoreCaptions'});
        expect(mp.api.loadModule).toHaveBeenCalledTimes(1);
    });

    it('captions YouTube turns on after the first unload are still restored (I2)', () => {
        const mp = makeMoviePlayer({captionsOn: false});
        document.body.appendChild(mp.el);
        start();
        // The adapter's first unload is at onReady, before YouTube loads the captions module.
        command({name: 'unloadModule', module: 'captions'});
        command({name: 'unloadModule', module: 'cc'});
        // At playback start YouTube loads the module with the viewer's track; the adapter unloads it again.
        mp.p.captionsOn = true;
        command({name: 'unloadModule', module: 'captions'});
        command({name: 'restoreCaptions'});
        expect(mp.api.loadModule).toHaveBeenCalledTimes(1);
        expect(mp.api.loadModule).toHaveBeenCalledWith('captions');
        // After a restore the memory starts over.
        mp.p.captionsOn = false;
        command({name: 'unloadModule', module: 'captions'});
        command({name: 'restoreCaptions'});
        expect(mp.api.loadModule).toHaveBeenCalledTimes(1);
    });

    it('posts every frame while PLAYING even if nothing changed (I1)', () => {
        const mp = makeMoviePlayer();
        document.body.appendChild(mp.el);
        start();
        vi.advanceTimersByTime(20);
        const before = snapshots().length;
        vi.advanceTimersByTime(16 * 10);
        expect(snapshots().length - before).toBeGreaterThanOrEqual(9);
        const ts = snapshots().slice(before).map((s) => s.t);
        expect(new Set(ts).size).toBe(ts.length);
    });

    it('while not PLAYING and unchanged, only the heartbeat posts', () => {
        const mp = makeMoviePlayer();
        mp.p.state = 2;
        document.body.appendChild(mp.el);
        start();
        vi.advanceTimersByTime(20);
        const before = snapshots().length;
        vi.advanceTimersByTime(600);
        expect(snapshots().length).toBe(before);
        vi.advanceTimersByTime(600);
        expect(snapshots().length - before).toBeGreaterThanOrEqual(1);
        expect(snapshots().length - before).toBeLessThanOrEqual(2);
    });

    it('does not turn captions on at restore when they were off', () => {
        const mp = makeMoviePlayer({captionsOn: false});
        document.body.appendChild(mp.el);
        start();
        command({name: 'unloadModule', module: 'captions'});
        command({name: 'restoreCaptions'});
        expect(mp.api.unloadModule).toHaveBeenCalledWith('captions');
        expect(mp.api.loadModule).not.toHaveBeenCalled();
    });

    it('captions state from the subtitles button when the player has no getOption', () => {
        const mp = makeMoviePlayer();
        (mp.el as unknown as {getOption?: unknown}).getOption = undefined;
        const btn = document.createElement('button');
        btn.className = 'ytp-subtitles-button';
        btn.setAttribute('aria-pressed', 'true');
        mp.el.appendChild(btn);
        document.body.appendChild(mp.el);
        start();
        command({name: 'unloadModule', module: 'captions'});
        command({name: 'restoreCaptions'});
        expect(mp.api.loadModule).toHaveBeenCalledWith('captions');
    });

    it('volume and speed changed in the YouTube interface reach the next snapshot (Review Focus 3)', () => {
        const mp = makeMoviePlayer();
        document.body.appendChild(mp.el);
        start();
        vi.advanceTimersByTime(20);
        // The YouTube volume slider and speed menu go through the player API.
        mp.p.volume = 25;
        mp.p.muted = true;
        mp.p.rate = 1.75;
        vi.advanceTimersByTime(20);
        expect(last()).toMatchObject({volume: 25, muted: true, rate: 1.75});
    });

    it('setVolume / setPlaybackRate from the copy call the player, not the <video> element (Review Focus 3)', () => {
        const mp = makeMoviePlayer();
        document.body.appendChild(mp.el);
        mp.video.volume = 1;
        mp.video.playbackRate = 1;
        start();
        command({name: 'setVolume', volume: 40});
        command({name: 'setPlaybackRate', rate: 1.5});
        expect(mp.api.setVolume).toHaveBeenCalledWith(40);
        expect(mp.api.setPlaybackRate).toHaveBeenCalledWith(1.5);
        expect(mp.video.volume).toBe(1);
        expect(mp.video.playbackRate).toBe(1);
        expect(last()).toMatchObject({volume: 40, rate: 1.5});
    });

    it('commands without a player are dropped', () => {
        start();
        expect(() => { command({name: 'playVideo'}); }).not.toThrow();
    });

    it('stop() detaches from the player and stops posting', () => {
        const mp = makeMoviePlayer();
        document.body.appendChild(mp.el);
        start();
        vi.advanceTimersByTime(20);
        stop?.();
        stop = null;
        const before = posted.length;
        mp.p.time = 99;
        vi.advanceTimersByTime(2000);
        mp.fire('onStateChange', 2);
        command({name: 'playVideo'});
        expect(posted.length).toBe(before);
        expect(mp.api.playVideo).not.toHaveBeenCalled();
    });

    it('a second start on the same window is a no-op', () => {
        const mp = makeMoviePlayer();
        document.body.appendChild(mp.el);
        start();
        const second = startBridge(window);
        command({name: 'playVideo'});
        expect(mp.api.playVideo).toHaveBeenCalledTimes(1);
        second.stop();
    });
});
