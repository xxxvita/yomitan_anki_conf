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
// Full screen of the copy -> full screen of YouTube's player. The copy's ⛶ button and F key call
// `requestFullscreen` on its own `.fs-root` (FullscreenContainer.tsx:83-101), which holds no video
// on youtube.com: a black screen. The layer redirects that one call (a browser API, not site code)
// to `#movie_player`; a refused request is swallowed (see below). Element.prototype is patched
// in the extension's isolated world only: page
// scripts never see it, and every other element goes to the original method.

export type FullscreenRedirect = {
    /** The element the copy wants in full screen instead (`.fs-root` inside the layer's container). */
    isSource: (el: Element) => boolean,
    /** YouTube's player; null falls back to the original call. */
    target: () => Element | null,
};

/**
 * @returns Undoes the patch (only if nobody patched over it since).
 */
export function installFullscreenRedirect(win: Window, {isSource, target}: FullscreenRedirect): () => void {
    const proto = (win as unknown as {Element: typeof Element}).Element.prototype;
    const original = proto.requestFullscreen;
    // No Fullscreen API: leave the copy's own fallback alone.
    if (typeof original !== 'function') { return () => { /* nothing installed */ }; }
    const had = Object.prototype.hasOwnProperty.call(proto, 'requestFullscreen');
    function requestFullscreen(this: Element, options?: FullscreenOptions): Promise<void> {
        if (!isSource(this)) { return original.call(this, options); }
        const player = target();
        // A refused request (no user activation, iframe policy ...) must not reach the copy's catch:
        // FullscreenContainer.tsx:91-93 would enter its pseudo mode, which pushes onto YouTube's
        // history (pushState, later history.back()). The promise stays pending instead: the copy
        // stays in mode 'off' and the next ⛶ / F simply tries again.
        return original.call(player ?? this, options).catch(() => new Promise<void>(() => { /* never settles */ }));
    }
    proto.requestFullscreen = requestFullscreen;
    return () => {
        if (proto.requestFullscreen !== requestFullscreen) { return; }
        if (had) {
            proto.requestFullscreen = original;
        } else {
            delete (proto as Partial<Element>).requestFullscreen;
        }
    };
}
