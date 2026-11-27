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

// Page-world globals of the offline YouTube stand (test/flib-youtube/stand/watch.html), read by
// test/playwright/flib-youtube.spec.js through page.evaluate.

/** The subset of YouTube's player API the stand implements on #movie_player. */
export type StandPlayer = HTMLElement & {
    getCurrentTime(): number;
    getDuration(): number;
    getPlayerState(): number;
    getPlaybackRate(): number;
    getAvailablePlaybackRates(): number[];
    getVolume(): number;
    getVideoLoadedFraction(): number;
    seekTo(seconds: number, allowSeekAhead: boolean): void;
    playVideo(): void;
    pauseVideo(): void;
    isMuted(): boolean;
    mute(): void;
    unMute(): void;
};

export type StandLog = {
    seekTo: {seconds: number, allowSeekAhead: boolean, t: number, ad: boolean}[];
    playVideo: number;
    pauseVideo: number;
    setPlaybackRate: number[];
    mute: number;
    unMute: number;
    setVolume: number[];
    loadModule: string[];
    unloadModule: string[];
    requestFullscreen: number;
    stateChanges: {s: number, t: number, ad: boolean}[];
};

export type Stand = {
    player: StandPlayer;
    log: StandLog;
    video: HTMLVideoElement;
    readonly videoId: string;
    readonly adShowing: boolean;
    readonly captionsOn: boolean;
    setTheater(on: boolean): void;
    midroll(): void;
    navigate(id: string, options?: {preroll?: number}): void;
};

export type BridgeLog = {
    snapshots: number;
    events: {name: string | undefined, data: unknown, t: number}[];
    commands: {name: string | undefined, t: number}[];
};

declare global {
    interface Window {
        stand: Stand;
        standBridgeLog: BridgeLog;
        standKeyLog: {key: string, code: string, t: number}[];
        standFsLog: (string | null)[];
    }
}
