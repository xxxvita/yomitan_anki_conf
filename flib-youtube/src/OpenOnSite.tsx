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
// The copy's links and navigations to other site pages ("Мой маршрут" = <Link to="/route">,
// navigate('/app/route?...'), LeftRail ...) would lead the YouTube tab to youtube.com/<path>, or
// push YouTube's history. On youtube.com they open https://flib.club<path> in a new tab instead:
// - route `*` of the layer's MemoryRouter: OpenOnSite opens the site and returns to the player;
// - clicks on <a href="/..."> inside the container or the portal node: interceptSiteLinks, in the
//   capture phase on the document, so react-router's <Link> sees `defaultPrevented` and does not
//   navigate (the player stays mounted).
import {useEffect, useRef} from 'react';
import {useLocation, useNavigate} from 'react-router-dom';
import {FLIB_SITE_URL} from '../../ext/js/data/flib-host.js';

/**
 * @param path A root-relative path of the site (`/route?x=1#y`).
 * @returns The absolute site URL, or null for anything that is not a root-relative path.
 */
export function siteUrl(path: string): string | null {
    if (!path.startsWith('/') || path.startsWith('//') || path.startsWith('/\\')) { return null; }
    return `${FLIB_SITE_URL}${path}`;
}

/** Opens a site path in a new tab (no opener: the site gets no handle to the YouTube tab). */
export function openOnSite(win: Window, path: string): void {
    const url = siteUrl(path);
    if (url !== null) { win.open(url, '_blank', 'noopener'); }
}

/**
 * Route `*`: opens the requested path on the site once per navigation, then replaces the entry with
 * the player again.
 */
export function OpenOnSite({home, open}: {home: string, open: (path: string) => void}): null {
    const location = useLocation();
    const navigate = useNavigate();
    // StrictMode runs the effect twice on mount (development); the ref keeps it to one tab.
    const done = useRef<string | null>(null);
    useEffect(() => {
        if (done.current === location.key) { return; }
        done.current = location.key;
        open(`${location.pathname}${location.search}${location.hash}`);
        navigate(home, {replace: true});
    }, [location, navigate, home, open]);
    return null;
}

/**
 * Root-relative links inside the layer's nodes open on the site (left, middle, modified clicks).
 * @param isOurs Whether a node belongs to the layer (container or portal node).
 * @returns Removes the listeners.
 */
export function interceptSiteLinks(doc: Document, isOurs: (node: Node) => boolean, open: (path: string) => void): () => void {
    const onClick = (e: MouseEvent) => {
        if (e.type === 'auxclick' && e.button !== 1) { return; }
        const target = e.target;
        if (!(target instanceof Element)) { return; }
        const a = target.closest('a[href]');
        if (a === null || !isOurs(a)) { return; }
        const href = a.getAttribute('href') ?? '';
        if (siteUrl(href) === null) { return; }
        e.preventDefault();
        open(href);
    };
    doc.addEventListener('click', onClick, true);
    doc.addEventListener('auxclick', onClick, true);
    return () => {
        doc.removeEventListener('click', onClick, true);
        doc.removeEventListener('auxclick', onClick, true);
    };
}
