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
// The module that pulls in the copied site. entry.tsx imports it dynamically, only after the
// layer's environment exists (window.YT, storage globals, fetch): the copy reads storage at module
// evaluation (player/i18n.ts, video-player-store.ts).
//
// The tree is the site's own (main.tsx:27-31: StrictMode > BrowserRouter > App, App.tsx: route
// /player = PlayerPage), with a MemoryRouter instead of BrowserRouter (nothing reads or writes
// YouTube's URL and history) and route `*` = the layer's OpenOnSite.
import {StrictMode, createElement} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {PlayerPage} from 'flib-site/pages/PlayerPage';
// The site's global stylesheets, in the order of its main.tsx:5-9 - which imports them after App
// (so after the component stylesheets of PlayerPage). They are rewritten at build time.
import 'flib-site/fonts.css';
import 'flib-site/dusk-tokens.css';
import 'flib-site/app.css';
import 'flib-site/site/site-fonts';
import 'flib-site/site/site-theme.css';
// Layout of the layer, after every stylesheet of the copy.
import './layer.css';
import {OpenOnSite} from './OpenOnSite';

export {getLocale} from 'flib-site/player/i18n';

/**
 * Renders the copied player into `container`.
 * @param entry The MemoryRouter's initial entry, `/player?v=<id>[&t=<s>]`.
 * @param home Where route `*` returns after opening the site, `/player?v=<id>`.
 * @param open Opens a site path in a new tab.
 * @returns Unmounts the tree (synchronously: effect cleanups of the copy run before it returns).
 */
export function renderPanel(container: HTMLElement, entry: string, home: string, open: (path: string) => void): () => void {
    const root = createRoot(container);
    root.render(createElement(StrictMode, null,
        createElement(MemoryRouter, {initialEntries: [entry]},
            createElement(Routes, null,
                createElement(Route, {path: '/player', element: createElement(PlayerPage)}),
                createElement(Route, {path: '*', element: createElement(OpenOnSite, {home, open})})))));
    return () => { root.unmount(); };
}
