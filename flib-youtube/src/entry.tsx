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
// 'flib-site/*' is the build alias of vendor/flib-site/web/src (see dev/build-flib-youtube.js and
// env/flib-site.d.ts: the copy omits type-only modules, so tsc cannot read it directly).
// Global stylesheets of the site, in the order of its main.tsx:5-9. They are rewritten at build time.
import 'flib-site/fonts.css';
import 'flib-site/dusk-tokens.css';
import 'flib-site/app.css';
import 'flib-site/site/site-fonts';
import 'flib-site/site/site-theme.css';

import {PlayerPage} from 'flib-site/pages/PlayerPage';

export const CONTAINER_ID = 'flib-yt-root';
export const PORTALS_ID = 'flib-yt-portals';
export const STORAGE_PREFIX = 'flibYt:';

/** Placeholder: the mounting code arrives in a later task. */
export function mount(): unknown {
    return PlayerPage;
}
