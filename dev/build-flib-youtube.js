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
import esbuild from 'esbuild';
import fs from 'fs';
import {createHash} from 'crypto';
import path from 'path';
import {fileURLToPath} from 'url';
import postcss from 'postcss';
import {scopeCss} from './flib-css-scope.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.join(dirname, '..');
const siteDir = path.join(repoDir, 'vendor', 'flib-site', 'web');
const layerDir = path.join(repoDir, 'flib-youtube', 'src');
const defaultOutDir = path.join(repoDir, 'ext', 'lib', 'flib-youtube');
const wrapperPath = path.join(layerDir, 'env', 'react-dom.ts');
const realReactDomDir = path.join(repoDir, 'node_modules', 'react-dom') + path.sep;

const SCOPE = '#flib-yt-root';
const PORTAL = '#flib-yt-portals';

/** @type {Record<string, string>} */
const define = {
    'import.meta.env.DEV': 'false',
    'import.meta.env.PROD': 'true',
    'import.meta.env.VITE_SHADOW_REALTIME': 'undefined',
    'import.meta.env': '{"DEV":false,"PROD":true,"MODE":"production","BASE_URL":"/","SSR":false}',
    'process.env.NODE_ENV': '"production"',
    // The environment of the layer: the site code reads these as plain globals.
    'localStorage': '__flibYtLocalStorage',
    'window.localStorage': '__flibYtLocalStorage',
    'sessionStorage': '__flibYtSessionStorage',
    'window.sessionStorage': '__flibYtSessionStorage',
    'fetch': '__flibYtFetch',
    'navigator.sendBeacon': '__flibYtSendBeacon',
};

/**
 * @param {string} outdir
 * @returns {import('esbuild').Plugin}
 */
function createPanelPlugin(outdir) {
    /** @type {Map<string, string>} */
    const fontFiles = new Map(); // fonts/<name> -> source path
    /** @type {Map<string, string>} */
    const fontFaceByFile = new Map(); // source css path -> @font-face text
    /** @type {Map<string, string>} */
    const assetFiles = new Map(); // assets/<name> -> source path

    /**
     * @param {string} cssPath
     * @param {string} url
     * @returns {string}
     * @throws {Error} When two different fonts share a file name.
     */
    const fontUrl = (cssPath, url) => {
        let source;
        if (url.startsWith('/')) {
            source = path.join(siteDir, 'public', url);
        } else if (url.startsWith('@')) {
            source = path.join(repoDir, 'node_modules', url);
        } else {
            source = path.resolve(path.dirname(cssPath), url);
        }
        const name = `fonts/${path.basename(source)}`;
        const existing = fontFiles.get(name);
        if (typeof existing === 'string' && existing !== source) { throw new Error(`Font name collision: ${name}`); }
        fontFiles.set(name, source);
        return name;
    };

    return {
        name: 'flib-youtube',
        setup(build) {
            // react-dom -> the layer's wrapper, except from the wrapper itself and from react-dom's own files.
            build.onResolve({filter: /^react-dom$/}, async (args) => {
                if (args.pluginData === 'real' || args.importer === wrapperPath || args.importer.startsWith(realReactDomDir)) {
                    if (args.pluginData === 'real') { return null; }
                    return await build.resolve('react-dom', {kind: args.kind, resolveDir: repoDir, pluginData: 'real'});
                }
                return {path: wrapperPath};
            });

            build.onLoad({filter: /\.css$/}, async (args) => {
                const text = await fs.promises.readFile(args.path, 'utf8');
                const scoped = scopeCss(text, {scope: SCOPE, portal: PORTAL, fontUrl: (u) => fontUrl(args.path, u)});
                const root = postcss.parse(scoped);
                /** @type {string[]} */
                const faces = [];
                root.walkAtRules(/^font-face$/i, (rule) => {
                    // woff is only a fallback for browsers without woff2, which all of ours have.
                    rule.walkDecls('src', (decl) => {
                        decl.value = decl.value.split(/,\s*(?=url\()/).filter((part) => !/format\(['"]woff['"]\)/.test(part)).join(', ');
                    });
                    faces.push(rule.toString());
                    rule.remove();
                });
                fontFaceByFile.set(args.path, faces.join('\n'));
                return {contents: root.toString(), loader: 'css'};
            });

            build.onLoad({filter: /\.(?:png|webp)$/}, async (args) => {
                const data = await fs.promises.readFile(args.path);
                const hash = createHash('sha256')
                    .update(data)
                    .digest('hex')
                    .slice(0, 8);
                const ext = path.extname(args.path);
                const name = `assets/${path.basename(args.path, ext)}-${hash}${ext}`;
                assetFiles.set(name, args.path);
                return {
                    contents: `export default chrome.runtime.getURL(${JSON.stringify(`lib/flib-youtube/${name}`)});`,
                    loader: 'js',
                };
            });

            build.onEnd(async () => {
                const copy = async (/** @type {Map<string, string>} */ files) => {
                    for (const [name, source] of [...files].sort(([a], [b]) => (a < b ? -1 : 1))) {
                        const dest = path.join(outdir, name);
                        await fs.promises.mkdir(path.dirname(dest), {recursive: true});
                        await fs.promises.copyFile(source, dest);
                    }
                };
                await copy(fontFiles);
                await copy(assetFiles);
                const faces = [...fontFaceByFile].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v).filter((v) => v.length > 0);
                await fs.promises.writeFile(path.join(outdir, 'fonts.css'), faces.join('\n') + '\n');
            });
        },
    };
}

/**
 * Bundles the copied flib.club player and the layer into the extension.
 * @param {{outdir?: string}} [options]
 */
export async function buildFlibYoutube({outdir = defaultOutDir} = {}) {
    await fs.promises.rm(outdir, {recursive: true, force: true});
    await fs.promises.mkdir(outdir, {recursive: true});

    /** @type {import('esbuild').BuildOptions} */
    const common = {
        bundle: true,
        minify: false,
        sourcemap: false,
        format: 'iife',
        target: 'es2022',
        logLevel: 'warning',
        legalComments: 'none',
    };

    await esbuild.build({
        ...common,
        entryPoints: {panel: path.join(layerDir, 'entry.tsx')},
        outdir,
        globalName: 'flibYtPanel',
        jsx: 'automatic',
        define,
        alias: {'flib-site': path.join(siteDir, 'src')},
        plugins: [createPanelPlugin(outdir)],
    });

    await esbuild.build({
        ...common,
        entryPoints: {bridge: path.join(layerDir, 'bridge', 'main-world.ts')},
        outdir,
        // main-world.ts starts itself only in the bundle; tests import it without side effects.
        define: {__FLIB_YT_BRIDGE_AUTOSTART__: 'true'},
    });
}
