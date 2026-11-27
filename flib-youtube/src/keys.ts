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
// Entry of ext/lib/flib-youtube/keys.js: the key gate of env/hotkeys.ts, alone (no site code, no
// React). Registered in youtube.com tabs while the beta is on, in the extension's isolated world at
// `document_start`, so its window-capture key listener comes before every listener of YouTube's
// page. It stays passive (every key passes) until the panel (panel.js) installs its arbiter.
import {installKeyGate} from './env/hotkeys';

declare const __FLIB_YT_KEYS_AUTOSTART__: boolean | undefined;

if (typeof __FLIB_YT_KEYS_AUTOSTART__ !== 'undefined' && __FLIB_YT_KEYS_AUTOSTART__) {
    installKeyGate(window);
}
