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
import path from 'path';
import {fileURLToPath} from 'url';
import type {Plugin} from 'vite';
import {defineConfig} from 'vitest/config';
// @ts-expect-error - the dev script is JavaScript without declarations
import {FLIB_YT_DEFINE} from '../dev/build-flib-youtube.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const siteSrc = path.join(dirname, '..', 'vendor', 'flib-site', 'web', 'src') + path.sep;
const layerSrc = path.join(dirname, 'src') + path.sep;
const bridgeSrc = path.join(layerSrc, 'bridge') + path.sep;
const reactDomWrapper = path.join(layerSrc, 'env', 'react-dom.ts');

const fileOf = (id: string): string => id.split('?')[0];

/**
 * The same environment as dev/build-flib-youtube.js, for tests:
 * - `react-dom` imported by the copy or the layer -> env/react-dom.ts (the wrapper itself,
 *   node_modules and tests get the real package);
 * - the build `define` map (storage, fetch, sendBeacon, import.meta.env, NODE_ENV) applied to the
 *   copy and to layer code. Not to tests (they set the stage explicitly) and not to the
 *   page-world bridge (its bundle has no such defines).
 * @returns {Plugin[]}
 */
function flibYoutubeEnvironment(): Plugin[] {
    return [
        {
            name: 'flib-youtube-react-dom',
            enforce: 'pre',
            resolveId(source, importer) {
                if (source !== 'react-dom' || typeof importer !== 'string') { return null; }
                const file = fileOf(importer);
                if (file === reactDomWrapper || file.includes(`${path.sep}node_modules${path.sep}`) || file.includes(`${path.sep}__tests__${path.sep}`)) { return null; }
                return reactDomWrapper;
            },
        },
        {
            name: 'flib-youtube-define',
            enforce: 'post',
            async transform(code, id) {
                const file = fileOf(id);
                if (!/\.[cm]?[jt]sx?$/.test(file)) { return null; }
                const inCopy = file.startsWith(siteSrc);
                const inLayer = file.startsWith(layerSrc) && !file.startsWith(bridgeSrc) && !file.includes(`${path.sep}__tests__${path.sep}`);
                if (!inCopy && !inLayer) { return null; }
                const result = await esbuild.transform(code, {loader: 'js', define: FLIB_YT_DEFINE as Record<string, string>, sourcemap: 'external', sourcefile: file});
                return {code: result.code, map: result.map};
            },
        },
    ];
}

export default defineConfig({
    plugins: flibYoutubeEnvironment(),
    esbuild: {jsx: 'automatic'},
    resolve: {
        // Same alias as dev/build-flib-youtube.js: tests import the copied site modules as they are.
        alias: {'flib-site': path.join(dirname, '..', 'vendor', 'flib-site', 'web', 'src')},
    },
    test: {
        include: ['flib-youtube/src/**/__tests__/**/*.test.{ts,tsx}'],
        setupFiles: ['flib-youtube/src/__tests__/setup.ts'],
        passWithNoTests: true,
    },
});
