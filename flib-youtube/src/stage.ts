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
// The rectangle goes into custom properties of the layer's container (--flib-yt-stage-left/top/
// width/height, px), and layer.css positions `.player-stage` from them. The copy's own nodes are
// never written: its DOM stays the site's (DOM parity, spec §6 item 5), and React never meets
// attributes it did not render. The container is placed at once, before React has rendered a stage.
//
// YouTube's control bar (I3, N1): on flib.club the iframe has `controls: 0`; here YouTube's own bar
// (progress bar and buttons, `.ytp-chrome-bottom`, about 48 px) is at the bottom of the player, and
// the copy's plates (RU at 3 % from the stage's bottom) would cover it. The stage always ends at the
// top edge of the bar as it is laid out (offsetTop / offsetHeight up to #movie_player), which
// YouTube's autohide (a fade) does not change. Hover and autohide never move the stage: a plate lies
// outside #movie_player, so hovering it makes YouTube hide its controls, and a stage that grew then
// would move the plate under the cursor (and back: flicker). If the bar's layout box collapses
// (offsetHeight 0, or display none), the last distance measured from the bar's top to the player's
// bottom is kept; with no bar measured yet the stage covers the whole player.
//
// The rectangle is re-read on: a size change of #movie_player or of the bar (ResizeObserver: window
// resize, theater, mini-player, big mode), any scroll (capture: the page or an inner scroller), a
// window resize, and attribute changes of ytd-watch-flexy (theater/fullscreen; YouTube may move the
// player first and resize it later, so once now and once on the next frame).

const WATCH_ATTRIBUTES = ['theater', 'fullscreen', 'full-bleed-player', 'class'];
const CONTROLS = '.ytp-chrome-bottom';

/** The bar's top edge in the player's layout box (px from the player's top), or null if not laid out in it. */
function barTopInPlayer(player: Element, bar: HTMLElement): number | null {
    if (bar.offsetHeight <= 0) { return null; }
    let top = 0;
    let el: HTMLElement | null = bar;
    while (el !== null && el !== player) {
        top += el.offsetTop;
        const parent: Element | null = el.offsetParent;
        el = parent instanceof HTMLElement || parent === null ? parent : null;
    }
    return el === player ? top : null;
}

/** Places the stage; returns the bar's distance from the player's bottom as measured now (or the kept one). */
function place(host: HTMLElement, player: Element, gap: number | null): number | null {
    const r = player.getBoundingClientRect();
    const bar = player.querySelector(CONTROLS);
    const layoutHeight = player instanceof HTMLElement && player.offsetHeight > 0 ? player.offsetHeight : r.height;
    let kept = gap;
    if (bar instanceof HTMLElement) {
        const top = barTopInPlayer(player, bar);
        if (top !== null && top > 0 && top < layoutHeight) { kept = layoutHeight - top; }
    }
    const height = kept !== null && kept > 0 && kept < r.height ? r.height - kept : r.height;
    const s = host.style;
    s.setProperty('--flib-yt-stage-left', `${r.left}px`);
    s.setProperty('--flib-yt-stage-top', `${r.top}px`);
    s.setProperty('--flib-yt-stage-width', `${r.width}px`);
    s.setProperty('--flib-yt-stage-height', `${height}px`);
    return kept;
}

/**
 * Keeps the rectangle of `player` in the custom properties of `host` (the layer's container, whose
 * `.player-stage` layer.css places from them) until the returned function is called.
 * @returns Stops following.
 */
export function syncStage(host: HTMLElement, player: Element, win: Window = window): () => void {
    const doc = player.ownerDocument;
    let raf = 0;
    const MO = (win as unknown as {MutationObserver: typeof MutationObserver}).MutationObserver;
    /** The bar's last measured distance from the player's bottom (null: never measured). */
    let gap: number | null = null;
    // The bar is observed for size too; YouTube may replace it (re-observed when another node is found).
    let observedBar: Element | null = null;
    let stopped = false;
    const update = () => {
        if (stopped) { return; }
        const bar = player.querySelector(CONTROLS);
        if (bar !== observedBar) {
            if (observedBar !== null) { resize.unobserve(observedBar); }
            if (bar !== null) { resize.observe(bar); }
            observedBar = bar;
        }
        gap = place(host, player, gap);
    };
    const resize = new (win as unknown as {ResizeObserver: typeof ResizeObserver}).ResizeObserver(() => { update(); });
    const updateNowAndNextFrame = () => {
        update();
        win.cancelAnimationFrame(raf);
        raf = win.requestAnimationFrame(update);
    };
    resize.observe(player);
    update();
    win.addEventListener('scroll', update, {capture: true, passive: true});
    win.addEventListener('resize', update, {passive: true});
    const flexy = player.closest('ytd-watch-flexy') ?? doc.querySelector('ytd-watch-flexy');
    const mutations = new MO(updateNowAndNextFrame);
    if (flexy !== null) { mutations.observe(flexy, {attributes: true, attributeFilter: WATCH_ATTRIBUTES}); }
    return () => {
        stopped = true;
        resize.disconnect();
        mutations.disconnect();
        win.removeEventListener('scroll', update, {capture: true});
        win.removeEventListener('resize', update);
        win.cancelAnimationFrame(raf);
    };
}

/**
 * Keeps the rectangle of `#movie_player` on `container` for the copy's `.player-stage` inside it.
 * The player node is looked up again whenever the container's subtree changes (YouTube may replace it).
 * @returns Stops following.
 */
export function startStageSync(container: HTMLElement, doc: Document): () => void {
    const win = doc.defaultView;
    if (win === null) { return () => { /* no window */ }; }
    let current: {player: Element, stop: () => void} | null = null;
    const bind = () => {
        const player = doc.getElementById('movie_player');
        if (current !== null && current.player === player) { return; }
        current?.stop();
        current = player !== null ? {player, stop: syncStage(container, player, win)} : null;
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
