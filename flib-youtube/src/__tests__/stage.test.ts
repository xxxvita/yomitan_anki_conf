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
// Review Focus 1: the copied .player-stage (plates, countdown, everything in .overlay) stays exactly
// over YouTube's video when YouTube changes mode (default <-> theater), the window resizes or the
// page scrolls.
import {afterEach, beforeEach, describe, expect, it, vi} from 'vitest';
import {startStageSync, syncStage} from '../stage';

type Rect = {left: number, top: number, width: number, height: number};

class FakeResizeObserver {
    static instances: FakeResizeObserver[] = [];
    readonly targets = new Set<Element>();
    constructor(private readonly cb: ResizeObserverCallback) { FakeResizeObserver.instances.push(this); }
    observe(el: Element) { this.targets.add(el); }
    unobserve(el: Element) { this.targets.delete(el); }
    disconnect() { this.targets.clear(); }
    /** What the browser does when an observed element changes size. */
    static resize(el: Element) {
        for (const ro of FakeResizeObserver.instances) {
            if (ro.targets.has(el)) { ro.cb([], ro as unknown as ResizeObserver); }
        }
    }
}

function setRect(el: Element, r: Rect) {
    el.getBoundingClientRect = () => ({
        x: r.left, y: r.top, left: r.left, top: r.top, width: r.width, height: r.height,
        right: r.left + r.width, bottom: r.top + r.height, toJSON() { return {}; },
    }) as DOMRect;
}

function placed(stage: HTMLElement): Rect & {position: string} {
    return {
        position: stage.style.position,
        left: Number.parseFloat(stage.style.left),
        top: Number.parseFloat(stage.style.top),
        width: Number.parseFloat(stage.style.width),
        height: Number.parseFloat(stage.style.height),
    };
}

function page() {
    document.body.innerHTML = `
        <ytd-watch-flexy>
          <div id="player"><div id="movie_player"><video></video></div></div>
          <div id="below"></div>
        </ytd-watch-flexy>`;
    const player = document.getElementById('movie_player') as HTMLElement;
    const flexy = document.querySelector('ytd-watch-flexy') as HTMLElement;
    const stage = document.createElement('div');
    stage.className = 'player-stage';
    document.body.append(stage);
    return {player, flexy, stage};
}

describe('syncStage', () => {
    beforeEach(() => {
        FakeResizeObserver.instances = [];
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('puts .player-stage over the rectangle of #movie_player (fixed positioning)', () => {
        const {player, stage} = page();
        setRect(player, {left: 24, top: 80, width: 854, height: 480});
        const stop = syncStage(stage, player);
        expect(placed(stage)).toEqual({position: 'fixed', left: 24, top: 80, width: 854, height: 480});
        stop();
    });

    it('follows a resize of #movie_player (ResizeObserver)', () => {
        const {player, stage} = page();
        setRect(player, {left: 24, top: 80, width: 854, height: 480});
        const stop = syncStage(stage, player);
        setRect(player, {left: 24, top: 80, width: 1280, height: 720});
        FakeResizeObserver.resize(player);
        expect(placed(stage)).toMatchObject({width: 1280, height: 720});
        stop();
    });

    it('follows scrolling', () => {
        const {player, stage} = page();
        setRect(player, {left: 24, top: 80, width: 854, height: 480});
        const stop = syncStage(stage, player);
        setRect(player, {left: 24, top: -320, width: 854, height: 480});
        window.dispatchEvent(new Event('scroll'));
        expect(placed(stage)).toMatchObject({top: -320, left: 24});
        // A scroll inside some scrolling element of the page (capture phase).
        setRect(player, {left: 24, top: -100, width: 854, height: 480});
        document.getElementById('below')?.dispatchEvent(new Event('scroll'));
        expect(placed(stage).top).toBe(-100);
        stop();
    });

    it('follows a window resize', () => {
        const {player, stage} = page();
        setRect(player, {left: 24, top: 80, width: 854, height: 480});
        const stop = syncStage(stage, player);
        setRect(player, {left: 300, top: 80, width: 854, height: 480});
        window.dispatchEvent(new Event('resize'));
        expect(placed(stage).left).toBe(300);
        stop();
    });

    it('follows the theater mode of ytd-watch-flexy (attribute and class)', async () => {
        const {player, flexy, stage} = page();
        setRect(player, {left: 24, top: 80, width: 854, height: 480});
        const stop = syncStage(stage, player);
        // Theater: YouTube moves the player into the full-bleed container; the size may change later
        // than the attribute, so no ResizeObserver callback is involved here.
        setRect(player, {left: 0, top: 56, width: 1920, height: 810});
        flexy.setAttribute('theater', '');
        await vi.waitFor(() => { expect(placed(stage)).toMatchObject({left: 0, top: 56, width: 1920, height: 810}); });
        setRect(player, {left: 24, top: 80, width: 854, height: 480});
        flexy.classList.add('some-class');
        await vi.waitFor(() => { expect(placed(stage)).toMatchObject({left: 24, top: 80, width: 854}); });
        stop();
    });

    it('stop() removes every listener', () => {
        const {player, stage} = page();
        setRect(player, {left: 24, top: 80, width: 854, height: 480});
        const stop = syncStage(stage, player);
        stop();
        setRect(player, {left: 1, top: 2, width: 3, height: 4});
        window.dispatchEvent(new Event('scroll'));
        window.dispatchEvent(new Event('resize'));
        FakeResizeObserver.resize(player);
        expect(placed(stage)).toMatchObject({left: 24, top: 80});
    });
});

describe('startStageSync', () => {
    beforeEach(() => {
        FakeResizeObserver.instances = [];
        vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        document.body.innerHTML = '';
    });

    it('finds the stage inside the container, also when React replaces it', async () => {
        const {player} = page();
        setRect(player, {left: 10, top: 20, width: 640, height: 360});
        const container = document.createElement('div');
        document.body.append(container);
        const stop = startStageSync(container, document);
        const first = document.createElement('div');
        first.className = 'player-stage';
        container.append(first);
        await vi.waitFor(() => { expect(placed(first)).toEqual({position: 'fixed', left: 10, top: 20, width: 640, height: 360}); });
        first.remove();
        const second = document.createElement('div');
        second.className = 'player-stage';
        container.append(second);
        await vi.waitFor(() => { expect(placed(second).width).toBe(640); });
        setRect(player, {left: 10, top: 20, width: 800, height: 450});
        FakeResizeObserver.resize(player);
        expect(placed(second).width).toBe(800);
        stop();
    });
});
