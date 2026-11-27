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
// react-dom for the copied site (dev/build-flib-youtube.js redirects every `react-dom` import here,
// except from this file and from react-dom itself). It is the real react-dom; only the target of
// createPortal changes: the copy portals menus into `document.body` or `document.fullscreenElement`
// (WorkspacePanelThemed.tsx:1903-1915, TrackCombo.tsx:191-362, TranslateMenu.tsx:56-57), and on
// youtube.com both become the layer's portal node - a plain div at the end of <body> that the
// scoped copy CSS applies to. Any other target is left as is.
import type {ReactNode, ReactPortal} from 'react';
import * as ReactDOM from 'react-dom';
import {PORTALS_ID} from '../constants';

// Every other export is the real one. Listed by name (react-dom 18.3.1, pinned in package.json),
// not `export *`: under `export *` a bundler may let the star re-export shadow the local
// createPortal (vite's SSR transform does), and the copy would portal into YouTube's <body>.
// __tests__/react-dom.test.ts checks this list against the real package.
const real = ReactDOM as unknown as Record<string, unknown>;
export const __SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED = real.__SECRET_INTERNALS_DO_NOT_USE_OR_YOU_WILL_BE_FIRED;
export const createRoot = real.createRoot;
export const hydrateRoot = real.hydrateRoot;
export const {
    findDOMNode,
    flushSync,
    hydrate,
    render,
    unmountComponentAtNode,
    unstable_batchedUpdates,
    unstable_renderSubtreeIntoContainer,
    version,
} = ReactDOM;

/**
 * @param container The target the copy asked for.
 * @returns The layer's portal node for `document.body` / `document.fullscreenElement`; otherwise `container`.
 */
export function portalTarget(container: Element | DocumentFragment): Element | DocumentFragment {
    const doc = container.ownerDocument;
    if (doc === null) { return container; }
    if (container === doc.body || container === doc.fullscreenElement) {
        const host = doc.getElementById(PORTALS_ID);
        if (host !== null) { return host; }
    }
    return container;
}

export function createPortal(children: ReactNode, container: Element | DocumentFragment, key?: string | null): ReactPortal {
    return ReactDOM.createPortal(children, portalTarget(container), key);
}

export default {...ReactDOM, createPortal};
