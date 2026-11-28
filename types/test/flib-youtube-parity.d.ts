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
// Page-world global of the parity harness page (test/flib-youtube/parity/site-harness.tsx), read by
// test/playwright/flib-youtube-parity.spec.js through page.evaluate. Mirrors ParityHarness there.

export type ParitySnapshot = {
    videoId: string | null;
    currentTime: number;
    duration: number;
    state: number;
    rate: number;
    rates: number[];
    muted: boolean;
    volume: number;
    loadedFraction: number;
    adShowing: boolean;
    t: number;
};

export type ParityCommand = {name: string, seconds?: number, rate?: number, volume?: number, module?: string};

export type ParityHarness = {
    mount(init: {entry: string, snapshot: Partial<ParitySnapshot>, storage: Record<string, string>}): Promise<void>;
    pauseAt(seconds: number): void;
    set(patch: Partial<ParitySnapshot>): void;
    readonly commands: ParityCommand[];
    readonly requests: string[];
    snapshot(): ParitySnapshot;
};

declare global {
    interface Window {
        parityHarness: ParityHarness;
    }
}
