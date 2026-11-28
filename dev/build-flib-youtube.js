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
import {collectKeyframeNames, findUnprefixedAnimations, scopeCss} from './flib-css-scope.js';
import {parseJson} from './json.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoDir = path.join(dirname, '..');
const siteDir = path.join(repoDir, 'vendor', 'flib-site', 'web');
const layerDir = path.join(repoDir, 'flib-youtube', 'src');
const defaultOutDir = path.join(repoDir, 'ext', 'lib', 'flib-youtube');
const wrapperPath = path.join(layerDir, 'env', 'react-dom.ts');
const realReactDomDir = path.join(repoDir, 'node_modules', 'react-dom') + path.sep;

const SCOPE = '#flib-yt-root';
const PORTAL = '#flib-yt-portals';

/**
 * The environment of the copy, applied to the whole panel bundle (layer code included).
 * flib-youtube/vitest.config.ts applies the same map to the copy and the layer in tests.
 * @type {Record<string, string>}
 */
export const FLIB_YT_DEFINE = {
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
 * The @keyframes names the copy's stylesheets define (every .css of vendor/flib-site/web/src and of
 * the layer). scopeCss prefixes them everywhere, also where one stylesheet uses another's.
 * @returns {Promise<Set<string>>}
 */
async function copyKeyframeNames() {
    /** @type {Set<string>} */
    const names = new Set();
    for (const dir of [path.join(siteDir, 'src'), layerDir]) {
        for (const entry of await fs.promises.readdir(dir, {recursive: true, withFileTypes: true})) {
            if (!entry.isFile() || !entry.name.endsWith('.css')) { continue; }
            const text = await fs.promises.readFile(path.join(entry.parentPath, entry.name), 'utf8');
            for (const name of collectKeyframeNames(text)) { names.add(name); }
        }
    }
    return names;
}

/** In panel.js, replaced by the @font-face rules after the build (flib-youtube/src/env/fonts.ts). */
const FONT_FACES_PLACEHOLDER = '"@@FLIB_YT_FONT_FACES@@"';

/** SIL OFL texts of the copy's own fonts (web/public/fonts has one for Lora only): `<Family>-OFL.txt`. */
const fontLicenseDir = path.join(repoDir, 'flib-youtube', 'licenses');
const fontsourceDir = path.join(repoDir, 'node_modules', '@fontsource') + path.sep;

/**
 * The license text of a shipped font file and its name next to the fonts: an @fontsource package's
 * own LICENSE, or flib-youtube/licenses/<Family>-OFL.txt for the copy's web/public/fonts (Family =
 * the file name up to the first '-').
 * @param {string} source
 * @returns {{name: string, source: string}}
 * @throws {Error} When the family has no license text (a new font after a sync of the copy).
 */
function fontLicense(source) {
    if (source.startsWith(fontsourceDir)) {
        const pkg = source.slice(fontsourceDir.length).split(path.sep)[0];
        // The family as the package names it ("JetBrains Mono" -> JetBrainsMono).
        /** @type {{family?: unknown}} */
        const metadata = parseJson(fs.readFileSync(path.join(fontsourceDir, pkg, 'metadata.json'), 'utf8'));
        if (typeof metadata.family !== 'string') { throw new Error(`@fontsource/${pkg}: no family in metadata.json`); }
        return {name: `fonts/${metadata.family.replaceAll(/\s+/g, '')}-OFL.txt`, source: path.join(fontsourceDir, pkg, 'LICENSE')};
    }
    const family = path.basename(source).split('-')[0];
    const text = path.join(fontLicenseDir, `${family}-OFL.txt`);
    if (!fs.existsSync(text)) { throw new Error(`No license text for the font ${path.basename(source)}: add ${path.relative(repoDir, text)}`); }
    return {name: `fonts/${family}-OFL.txt`, source: text};
}

/**
 * The fonts/<file> names a text references in url(...).
 * @param {string} text
 * @returns {Set<string>}
 */
function referencedFonts(text) {
    return new Set([...text.matchAll(/url\(\s*\\?["']?(fonts\/[^)"'\\\s]+)/g)].map((m) => m[1]));
}

/**
 * @param {string} outdir
 * @param {{faces: string[], files: Map<string, string>}} fonts Filled at the end of the build: the
 *   font-face rules (`url(fonts/<file>)`) and every font file a stylesheet named (fonts/<name> ->
 *   source); buildFlibYoutube copies only those the output references.
 * @param {Set<string>} keyframes The copy's @keyframes names (copyKeyframeNames); the build adds
 *   those of every stylesheet it loads.
 * @returns {import('esbuild').Plugin}
 */
function createPanelPlugin(outdir, fonts, keyframes) {
    const fontFiles = fonts.files; // fonts/<name> -> source path
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
                for (const name of collectKeyframeNames(text)) { keyframes.add(name); }
                const scoped = scopeCss(text, {scope: SCOPE, portal: PORTAL, fontUrl: (u) => fontUrl(args.path, u), keyframes});
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
                await copy(assetFiles);
                // No fonts.css: relative url() in content-script CSS resolve against youtube.com. The rules go
                // into panel.js, and the layer points them at chrome.runtime.getURL (env/fonts.ts).
                fonts.faces = [...fontFaceByFile].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, v]) => v).filter((v) => v.length > 0);
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
        // The license comments of React, react-router, lucide ... stay, at the end of each file (I4).
        legalComments: 'eof',
    };

    /** @type {{faces: string[], files: Map<string, string>}} */
    const fonts = {faces: [], files: new Map()};
    const keyframes = await copyKeyframeNames();
    const panel = await esbuild.build({
        ...common,
        entryPoints: {panel: path.join(layerDir, 'entry.tsx')},
        outdir,
        globalName: 'flibYtPanel',
        jsx: 'automatic',
        // entry.tsx starts itself only in the bundle; tests import it without side effects.
        define: {...FLIB_YT_DEFINE, __FLIB_YT_PANEL_AUTOSTART__: 'true', __FLIB_YT_FONT_FACES__: FONT_FACES_PLACEHOLDER},
        alias: {'flib-site': path.join(siteDir, 'src')},
        plugins: [createPanelPlugin(outdir, fonts, keyframes)],
        // Written below, after the font rules (known only at the end of the build) replace the placeholder.
        write: false,
    });
    /** @type {string[]} */
    const referenced = [];
    for (const file of panel.outputFiles) {
        let contents = file.text;
        if (path.basename(file.path) === 'panel.js') {
            const parts = contents.split(FONT_FACES_PLACEHOLDER);
            if (parts.length !== 2) { throw new Error(`panel.js: expected one font placeholder, found ${parts.length - 1}`); }
            contents = parts.join(JSON.stringify(fonts.faces));
        }
        if (path.basename(file.path) === 'panel.css') {
            // Spec §3 item 5: no animation of panel.css may name one of the copy's @keyframes unprefixed.
            const bad = findUnprefixedAnimations(contents, keyframes);
            if (bad.length > 0) { throw new Error(`panel.css: unprefixed @keyframes names of the copy:\n  ${bad.join('\n  ')}`); }
        }
        await fs.promises.mkdir(path.dirname(file.path), {recursive: true});
        await fs.promises.writeFile(file.path, contents);
        referenced.push(...referencedFonts(contents));
    }

    // Only the font files panel.js / panel.css reference (M5: no .woff fallbacks, nothing unused),
    // each family with its license text next to it (I4).
    /** @type {Map<string, string>} */
    const ship = new Map();
    for (const name of new Set(referenced)) {
        const source = fonts.files.get(name);
        if (typeof source !== 'string') { throw new Error(`panel references ${name}, which no stylesheet names`); }
        ship.set(name, source);
        const license = fontLicense(source);
        ship.set(license.name, license.source);
    }
    for (const [name, source] of [...ship].sort(([x], [y]) => (x < y ? -1 : 1))) {
        const dest = path.join(outdir, name);
        await fs.promises.mkdir(path.dirname(dest), {recursive: true});
        await fs.promises.copyFile(source, dest);
    }

    await esbuild.build({
        ...common,
        entryPoints: {bridge: path.join(layerDir, 'bridge', 'main-world.ts')},
        outdir,
        // main-world.ts starts itself only in the bundle; tests import it without side effects.
        define: {__FLIB_YT_BRIDGE_AUTOSTART__: 'true'},
    });

    // The key gate, registered at document_start in the isolated world (flib-youtube/src/env/hotkeys.ts).
    await esbuild.build({
        ...common,
        entryPoints: {keys: path.join(layerDir, 'keys.ts')},
        outdir,
        define: {__FLIB_YT_KEYS_AUTOSTART__: 'true'},
    });
}

const parityDir = path.join(repoDir, 'test', 'flib-youtube', 'parity');

export const PARITY_HARNESS_OUTDIR = path.join(repoDir, 'test-results', 'flib-youtube-parity', 'harness');

/**
 * The site's side of the DOM parity check (test/playwright/flib-youtube-parity.spec.js): the copy
 * in an ordinary page as on flib.club. The same `define` and `flib-site` alias as the panel, but
 * none of what the panel changes for youtube.com: the copy's CSS is not scoped (the site's own
 * text, `/fonts/...` left to the page's origin), react-dom is the real one (portals go to
 * document.body), no layer.css. Writes harness.js and harness.css (+ hashed images and the
 * fontsource fonts) into `outdir`.
 * @param {{outdir?: string}} [options]
 */
export async function buildFlibYoutubeParityHarness({outdir = PARITY_HARNESS_OUTDIR} = {}) {
    await fs.promises.rm(outdir, {recursive: true, force: true});
    await fs.promises.mkdir(outdir, {recursive: true});
    await esbuild.build({
        bundle: true,
        minify: false,
        sourcemap: false,
        format: 'iife',
        target: 'es2022',
        logLevel: 'warning',
        legalComments: 'none',
        entryPoints: {harness: path.join(parityDir, 'site-harness.tsx')},
        outdir,
        jsx: 'automatic',
        define: FLIB_YT_DEFINE,
        alias: {'flib-site': path.join(siteDir, 'src')},
        loader: {'.png': 'file', '.webp': 'file', '.woff2': 'file', '.woff': 'file'},
        assetNames: '[name]-[hash]',
        // The spec serves `outdir` at https://flib.club/__parity/.
        publicPath: '/__parity/',
        // As on the site: served from the page's origin (web/public/fonts).
        external: ['/fonts/*'],
    });
}

// `node dev/build-flib-youtube.js [--parity]`: the panel into ext/lib/flib-youtube, or the parity harness.
if (typeof process.argv[1] === 'string' && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    await (process.argv.includes('--parity') ? buildFlibYoutubeParityHarness() : buildFlibYoutube());
}
