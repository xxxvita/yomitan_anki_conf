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
 * The prefix of the copy's @keyframes names on youtube.com (spec §3 item 5): @keyframes names are
 * global to the document, so `spin` of the copy and `spin` of YouTube would replace each other.
 */
export const KEYFRAMES_PREFIX = 'flibyt-';

const KEYFRAMES_AT = /^(?:-[a-z]+-)?keyframes$/i;
const ANIMATION_PROP = /^(?:-[a-z]+-)?animation(?:-name)?$/i;

/**
 * Maps the top-level identifiers of a declaration value (not function names, nothing inside
 * parentheses, separators kept as they are).
 * @param {string} value
 * @param {(word: string) => string} map
 * @returns {string}
 */
function mapTopLevelWords(value, map) {
    let out = '';
    let word = '';
    let depth = 0;
    for (const ch of value) {
        if (depth > 0) {
            out += ch;
            if (ch === '(') {
                ++depth;
            } else if (ch === ')') {
                --depth;
            }
        } else if (ch === '(') {
            out += word + ch; // a function name
            word = '';
            depth = 1;
        } else if (/[\s,]/.test(ch)) {
            out += map(word) + ch;
            word = '';
        } else {
            word += ch;
        }
    }
    return out + map(word);
}

/**
 * @param {import('postcss').Root} root
 * @returns {Set<string>}
 */
function keyframeNamesOf(root) {
    /** @type {Set<string>} */
    const names = new Set();
    root.walkAtRules(KEYFRAMES_AT, (rule) => { names.add(rule.params.trim()); });
    return names;
}

/**
 * The names of the @keyframes a stylesheet defines.
 * @param {string} css
 * @returns {Set<string>}
 */
export function collectKeyframeNames(css) {
    return keyframeNamesOf(postcss.parse(css));
}

/**
 * What the build must not emit (dev/build-flib-youtube.js checks panel.css): an `animation` /
 * `animation-name` that names one of `names` without the prefix, and an unprefixed @keyframes of one.
 * @param {string} css
 * @param {ReadonlySet<string>} names The @keyframes names defined in the copy's stylesheets.
 * @returns {string[]} The offending declarations and at-rules.
 */
export function findUnprefixedAnimations(css, names) {
    const root = postcss.parse(css);
    /** @type {string[]} */
    const out = [];
    root.walk((node) => {
        if (node.type === 'decl' && ANIMATION_PROP.test(node.prop)) {
            let bad = false;
            mapTopLevelWords(node.value, (w) => {
                bad ||= names.has(w);
                return w;
            });
            if (bad) { out.push(`${node.prop}: ${node.value}`); }
        } else if (node.type === 'atrule' && KEYFRAMES_AT.test(node.name) && names.has(node.params.trim())) {
            out.push(`@${node.name} ${node.params.trim()}`);
        }
    });
    return out;
}

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
 * container and portal node, and every @keyframes name of the copy carries KEYFRAMES_PREFIX.
 * Keyframe names: the @keyframes this stylesheet defines, plus `keyframes` (the names the other
 * stylesheets of the copy define), are renamed in their definitions and in `animation` /
 * `animation-name` (vendor prefixed too). Any other name is left as it is: the copy also adds
 * keyframes at runtime from its components (slideUp ...), which the build cannot rename.
 * @param {string} css
 * @param {{scope: string, portal: string, fontUrl: (url: string) => string, keyframes?: ReadonlySet<string>}} options
 * @returns {string}
 */
export function scopeCss(css, {scope, portal, fontUrl, keyframes}) {
    const where = `:where(${scope}, ${portal})`;
    const root = postcss.parse(css);
    const names = keyframeNamesOf(root);
    for (const name of keyframes ?? []) { names.add(name); }
    /** @type {(word: string) => string} */
    const renameWord = (word) => (names.has(word) ? KEYFRAMES_PREFIX + word : word);
    root.walkAtRules(KEYFRAMES_AT, (rule) => { rule.params = renameWord(rule.params.trim()); });

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
        if (parent?.type === 'atrule' && KEYFRAMES_AT.test(/** @type {import('postcss').AtRule} */ (parent).name)) { return; }
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
        if (ANIMATION_PROP.test(decl.prop)) { decl.value = mapTopLevelWords(decl.value, renameWord); }
    });

    return root.toString();
}
