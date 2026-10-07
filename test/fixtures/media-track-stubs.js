/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2020-2022  Yomichan Authors
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

/**
 * jsdom has no TextTrack, no event-firing TextTrackList and no Fullscreen API.
 * Installs minimal stand-ins so subtitle-track wiring can be observed:
 * `trackEl.track` → `{mode}`, `video.textTracks` → an EventTarget,
 * `document.fullscreenElement` → whatever `setFullscreen` was given.
 * @param {import('jsdom').DOMWindow} window
 * @returns {{setFullscreen: (el: ?Element) => void, restore: () => void}}
 */
export function installMediaTrackStubs(window) {
    /** @type {WeakMap<object, {mode: string}>} */
    const tracks = new WeakMap();
    /** @type {WeakMap<object, EventTarget>} */
    const lists = new WeakMap();
    /** @type {?Element} */
    let fullscreen = null;
    const trackProto = window.HTMLTrackElement.prototype;
    const mediaProto = window.HTMLMediaElement.prototype;
    const savedTrack = Object.getOwnPropertyDescriptor(trackProto, 'track');
    const savedLists = Object.getOwnPropertyDescriptor(mediaProto, 'textTracks');
    Object.defineProperty(trackProto, 'track', {
        configurable: true,
        /**
         * @this {object}
         * @returns {{mode: string}}
         */
        get() {
            let t = tracks.get(this);
            if (typeof t === 'undefined') {
                t = {mode: 'disabled'};
                tracks.set(this, t);
            }
            return t;
        },
    });
    Object.defineProperty(mediaProto, 'textTracks', {
        configurable: true,
        /**
         * @this {object}
         * @returns {EventTarget}
         */
        get() {
            let l = lists.get(this);
            if (typeof l === 'undefined') {
                l = new window.EventTarget();
                lists.set(this, l);
            }
            return l;
        },
    });
    Object.defineProperty(window.document, 'fullscreenElement', {configurable: true, get: () => fullscreen});
    return {
        setFullscreen: (el) => {
            fullscreen = el;
            window.document.dispatchEvent(new window.Event('fullscreenchange'));
        },
        restore: () => {
            if (typeof savedTrack === 'undefined') {
                Reflect.deleteProperty(trackProto, 'track');
            } else {
                Object.defineProperty(trackProto, 'track', savedTrack);
            }
            if (typeof savedLists === 'undefined') {
                Reflect.deleteProperty(mediaProto, 'textTracks');
            } else {
                Object.defineProperty(mediaProto, 'textTracks', savedLists);
            }
            Reflect.deleteProperty(window.document, 'fullscreenElement');
        },
    };
}
