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
// The copied site tree for the parity harness (site-harness.tsx imports it after the environment
// exists). The same tree and stylesheet order as flib-youtube/src/mount.ts - StrictMode >
// MemoryRouter > Routes, /player = PlayerPage, the site's global stylesheets after PlayerPage as in
// its main.tsx:5-9 - minus what is the layer's: layer.css and the OpenOnSite route.
import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import {MemoryRouter, Route, Routes} from 'react-router-dom';
import {PlayerPage} from 'flib-site/pages/PlayerPage';
import 'flib-site/fonts.css';
import 'flib-site/dusk-tokens.css';
import 'flib-site/app.css';
import 'flib-site/site/site-fonts';
import 'flib-site/site/site-theme.css';

export function renderSite(container: HTMLElement, entry: string): void {
    createRoot(container).render(
        <StrictMode>
            <MemoryRouter initialEntries={[entry]}>
                <Routes>
                    <Route path="/player" element={<PlayerPage />} />
                </Routes>
            </MemoryRouter>
        </StrictMode>,
    );
}
