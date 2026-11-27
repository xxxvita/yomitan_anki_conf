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
// Stacking of the layer's two nodes (review of task 7, I1): the copy's menus are portalled into
// #flib-yt-portals (position:fixed, z-index 300, TranslateMenu.tsx:43) and open at the click point
// over a plate; the plates live in .player-stage, which layer.css lifts over YouTube's video. The
// portal node must stack above the stage, as on the site (stage z-index 0, app.css). Read from the
// CSS rules exactly as the build emits them (dev/flib-css-scope.js), layered rules excluded.
import fs from 'fs';
import path from 'path';
import postcss from 'postcss';
import {fileURLToPath} from 'url';
import {describe, expect, it} from 'vitest';
import {scopeCss} from '../../../dev/flib-css-scope.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const WHERE = ':where(#flib-yt-root, #flib-yt-portals)';

function scoped(file: string): string {
    return scopeCss(fs.readFileSync(file, 'utf8'), {scope: '#flib-yt-root', portal: '#flib-yt-portals', fontUrl: (u: string) => u});
}

/** Unlayered declarations of rules with exactly this selector, later ones winning. */
function declarations(css: string, selector: string): Record<string, string> {
    const out: Record<string, string> = {};
    postcss.parse(css).walkRules((rule) => {
        for (let p = rule.parent as postcss.Node | undefined; p !== undefined && p.type !== 'root'; p = p.parent as postcss.Node | undefined) {
            if (p.type === 'atrule' && /^(layer|media|supports)$/i.test((p as postcss.AtRule).name)) { return; }
        }
        if (!rule.selectors.map((x) => x.trim()).includes(selector)) { return; }
        rule.walkDecls((d) => { out[d.prop] = d.value; });
    });
    return out;
}

describe('layer.css stacking', () => {
    const layer = scoped(path.join(dirname, '..', 'layer.css'));
    const app = scoped(path.join(dirname, '..', '..', '..', 'vendor', 'flib-site', 'web', 'src', 'app.css'));

    it('the portal node is a positioned stacking context above the stage', () => {
        const portals = declarations(layer, `${WHERE}#flib-yt-portals`);
        const stage = declarations(layer, `${WHERE} .player-stage`);
        expect(portals.position).toBe('relative'); // z-index applies; the fixed menus keep the viewport
        const portalZ = Number(portals['z-index']);
        const stageZ = Number(stage['z-index']);
        expect(Number.isInteger(portalZ) && Number.isInteger(stageZ)).toBe(true);
        expect(portalZ).toBeGreaterThan(stageZ);
        // The stage (position: fixed, stage.ts) must be above YouTube's player layers.
        expect(stageZ).toBeGreaterThan(0);
    });

    it('the container creates no stacking context, so the stage competes with the portal node directly', () => {
        const container = declarations(layer, `${WHERE}#flib-yt-root`);
        for (const prop of ['z-index', 'transform', 'filter', 'contain', 'isolation', 'will-change', 'position']) {
            expect(container[prop], prop).toBeUndefined();
        }
        // The copy's root rule (html, body, #root -> both layer nodes) sets none of it either.
        const root = declarations(app, WHERE);
        for (const prop of ['z-index', 'transform', 'filter', 'contain', 'isolation', 'position']) {
            expect(root[prop], prop).toBeUndefined();
        }
    });
});
