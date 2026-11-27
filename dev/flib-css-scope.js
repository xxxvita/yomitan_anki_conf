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
import postcss from 'postcss';

const ROOT_LIKE = /^(?:html|body|:root|#root)(?![\w-])/;

/**
 * @param {string} value
 * @returns {string}
 */
function remToPx(value) {
    return value.replaceAll(/(?<![\w.-])(-?(?:\d+\.?\d*|\.\d+))rem(?![\w-])/g, (_, /** @type {string} */ n) => {
        const px = Math.round(Number.parseFloat(n) * 16 * 10000) / 10000;
        return `${px}px`;
    });
}

/**
 * Rewrites the text of a stylesheet so that every rule applies only inside the layer's
 * container and portal node.
 * @param {string} css
 * @param {{scope: string, portal: string, fontUrl: (url: string) => string}} options
 * @returns {string}
 */
export function scopeCss(css, {scope, portal, fontUrl}) {
    const where = `:where(${scope}, ${portal})`;
    const root = postcss.parse(css);

    /**
     * @param {string} selector
     * @returns {string[]}
     */
    const scopeSelector = (selector) => {
        const s = selector.trim();
        if (s.startsWith(`:where(${scope}`)) { return [s]; }
        const universal = /^\*((?:::?[\w-]+)?)$/.exec(s);
        if (universal !== null) { return [`${where} *${universal[1]}`, `${where}${universal[1]}`]; }
        if (ROOT_LIKE.test(s)) { return [where + s.replace(ROOT_LIKE, '')]; }
        return [`${where} ${s}`];
    };

    root.walkRules((rule) => {
        const parent = rule.parent;
        if (parent?.type === 'atrule' && /keyframes$/i.test(/** @type {import('postcss').AtRule} */ (parent).name)) { return; }
        if (parent?.type === 'atrule' && /^font-face$/i.test(/** @type {import('postcss').AtRule} */ (parent).name)) { return; }
        /** @type {string[]} */
        const out = [];
        for (const selector of rule.selectors) {
            for (const r of scopeSelector(selector)) {
                if (!out.includes(r)) { out.push(r); }
            }
        }
        rule.selector = out.join(', ');
    });

    root.walkDecls((decl) => {
        const parent = decl.parent;
        if (parent?.type === 'atrule' && /^font-face$/i.test(/** @type {import('postcss').AtRule} */ (parent).name)) {
            if (decl.prop.toLowerCase() === 'src') {
                decl.value = decl.value.replaceAll(/url\(\s*(?:'([^']*)'|"([^"]*)"|([^)'"\s]*))\s*\)/g, (/** @type {string} */ m, /** @type {string|undefined} */ a, /** @type {string|undefined} */ b, /** @type {string|undefined} */ c) => {
                    const url = a ?? b ?? c ?? '';
                    return /^(?:data:|https?:)/i.test(url) ? m : `url(${fontUrl(url)})`;
                });
            }
            return;
        }
        decl.value = remToPx(decl.value);
    });

    return root.toString();
}
