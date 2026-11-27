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
// The copied `.player-stage` (PlayerRoot.tsx:60-104) stays in the copy's tree; the layer only
// places it over YouTube's video: `position: fixed` on the viewport rectangle of `#movie_player`.
// Its `.overlay` (EN/RU plates, A-B countdown, vote bar, end card ...) is then drawn over the
// video. layer.css makes the stage transparent and lets clicks through to YouTube except on the
// plates.
//
// The rectangle is re-read on: a size change of #movie_player (ResizeObserver: window resize,
// theater, mini-player), any scroll (capture: the page or an inner scroller), a window resize, and
// attribute changes of ytd-watch-flexy (theater/fullscreen; YouTube may move the player first and
// resize it later, so once now and once on the next frame).

const WATCH_ATTRIBUTES = ['theater', 'fullscreen', 'full-bleed-player', 'class'];

function place(stage: HTMLElement, player: Element): void {
    const r = player.getBoundingClientRect();
    const s = stage.style;
    s.position = 'fixed';
    s.left = `${r.left}px`;
    s.top = `${r.top}px`;
    s.width = `${r.width}px`;
    s.height = `${r.height}px`;
}

/**
 * Keeps `stage` over `player` until the returned function is called.
 * @returns Stops following.
 */
export function syncStage(stage: HTMLElement, player: Element, win: Window = window): () => void {
    const doc = player.ownerDocument;
    let raf = 0;
    const update = () => { place(stage, player); };
    const updateNowAndNextFrame = () => {
        update();
        win.cancelAnimationFrame(raf);
        raf = win.requestAnimationFrame(update);
    };
    update();
    const resize = new (win as unknown as {ResizeObserver: typeof ResizeObserver}).ResizeObserver(update);
    resize.observe(player);
    win.addEventListener('scroll', update, {capture: true, passive: true});
    win.addEventListener('resize', update, {passive: true});
    const flexy = player.closest('ytd-watch-flexy') ?? doc.querySelector('ytd-watch-flexy');
    const mutations = new (win as unknown as {MutationObserver: typeof MutationObserver}).MutationObserver(updateNowAndNextFrame);
    if (flexy !== null) { mutations.observe(flexy, {attributes: true, attributeFilter: WATCH_ATTRIBUTES}); }
    return () => {
        resize.disconnect();
        mutations.disconnect();
        win.removeEventListener('scroll', update, {capture: true});
        win.removeEventListener('resize', update);
        win.cancelAnimationFrame(raf);
    };
}

/**
 * Follows the copy's `.player-stage` inside `container` (React may replace it, e.g. on a transport
 * switch) and keeps it over `#movie_player`.
 * @returns Stops following.
 */
export function startStageSync(container: Element, doc: Document): () => void {
    const win = doc.defaultView;
    if (win === null) { return () => { /* no window */ }; }
    let current: {stage: Element, player: Element, stop: () => void} | null = null;
    const bind = () => {
        const stage = container.querySelector<HTMLElement>('.player-stage');
        const player = doc.getElementById('movie_player');
        if (current !== null && current.stage === stage && current.player === player) { return; }
        current?.stop();
        current = stage !== null && player !== null ? {stage, player, stop: syncStage(stage, player, win)} : null;
    };
    const observer = new win.MutationObserver(bind);
    observer.observe(container, {childList: true, subtree: true});
    bind();
    return () => {
        observer.disconnect();
        current?.stop();
        current = null;
    };
}
