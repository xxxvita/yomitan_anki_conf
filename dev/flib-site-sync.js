/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2020-2022  Yomichan Authors
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

/*
 * The only legitimate way to change vendor/flib-site/: a byte-for-byte copy of the
 * flib.club player. The set of files is decided by a machine (esbuild metafile closure
 * of web/src/pages/PlayerPage.tsx), never by judgment.
 *
 *   node dev/flib-site-sync.js --site <repo> --commit <sha> [--check]
 *   node dev/flib-site-sync.js --baseline <vitest-json>
 */

import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import esbuild from 'esbuild';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import zlib from 'node:zlib';
import {parseJson} from './json.js';
import {nonSourceFiles, verifyVendor} from './lib/flib-site-verify.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const vendorDir = path.join(dirname, '..', 'vendor', 'flib-site');
const sourceRepoName = 'x2-2/flib.club';
const entryPoint = 'web/src/pages/PlayerPage.tsx';
const setupFile = 'web/vitest.setup.ts';
const placeholderColor = [0x2b, 0x2b, 0x2b];
const placeholderPaths = new Set(['web/src/site/img/clip-zootopia.png', 'web/src/site/img/clip-phm.png']);

/** Fixed list from the spec, section 1. Directories end with a slash. */
const fixedFiles = [
    'web/vitest.config.ts',
    'web/tsconfig.json',
    'web/package.json',
    'web/package-lock.json',
    'web/vite.config.ts',
    'web/public/fonts/',
    'web/public/pcm16-worklet.js',
    'web/src/fonts.css',
    'web/src/dusk-tokens.css',
    'web/src/app.css',
    'web/src/site/site-theme.css',
    'web/src/site/site-fonts.ts',
    'web/src/site/lora.css',
    'web/src/main.tsx',
];

/**
 * @param {Buffer|string} data
 * @returns {string}
 */
function sha256(data) {
    return createHash('sha256').update(data).digest('hex');
}

/**
 * @param {string} dir
 * @param {string} base
 * @returns {string[]}
 */
function listFiles(dir, base = '') {
    /** @type {string[]} */
    const result = [];
    if (!fs.existsSync(dir)) { return result; }
    for (const entry of fs.readdirSync(dir, {withFileTypes: true})) {
        const rel = base === '' ? entry.name : `${base}/${entry.name}`;
        if (entry.isDirectory()) {
            result.push(...listFiles(path.join(dir, entry.name), rel));
        } else {
            result.push(rel);
        }
    }
    return result;
}

/**
 * @param {Buffer} buffer
 * @returns {{width: number, height: number}}
 * @throws {Error}
 */
function readPngSize(buffer) {
    if (buffer.subarray(1, 4).toString('latin1') !== 'PNG' || buffer.subarray(12, 16).toString('latin1') !== 'IHDR') {
        throw new Error('not a PNG');
    }
    return {width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20)};
}

/**
 * @param {string} type
 * @param {Buffer} data
 * @returns {Buffer}
 */
function pngChunk(type, data) {
    const head = Buffer.alloc(8);
    head.writeUInt32BE(data.length, 0);
    head.write(type, 4, 'latin1');
    const tail = Buffer.alloc(4);
    tail.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])), 0);
    return Buffer.concat([head, data, tail]);
}

/**
 * A valid, deterministic, single-colour 8-bit RGB PNG.
 * @param {number} width
 * @param {number} height
 * @returns {Buffer}
 */
export function makePlaceholderPng(width, height) {
    const ihdr = Buffer.alloc(13);
    ihdr.writeUInt32BE(width, 0);
    ihdr.writeUInt32BE(height, 4);
    ihdr[8] = 8; // bit depth
    ihdr[9] = 2; // RGB
    const row = Buffer.alloc(1 + (width * 3));
    for (let x = 0; x < width; ++x) { Buffer.from(placeholderColor).copy(row, 1 + (x * 3)); }
    const raw = Buffer.alloc(row.length * height);
    for (let y = 0; y < height; ++y) { row.copy(raw, y * row.length); }
    return Buffer.concat([
        Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
        pngChunk('IHDR', ihdr),
        pngChunk('IDAT', zlib.deflateSync(raw, {level: 9})),
        pngChunk('IEND', Buffer.alloc(0)),
    ]);
}

/**
 * Closure of one entry: every file under web/ that esbuild sees. npm packages and bare
 * URLs are external.
 * @param {string} root Extracted tree containing web/
 * @param {string} entry Repo-relative entry
 * @returns {Promise<Set<string>>}
 */
async function closureOf(root, entry) {
    /** @type {import('esbuild').Plugin} */
    const externals = {
        name: 'externals',
        setup(build) {
            build.onResolve({filter: /^[^./]/}, (args) => (args.kind === 'entry-point' || path.isAbsolute(args.path) ? null : {path: args.path, external: true}));
        },
    };
    const result = await esbuild.build({
        entryPoints: [path.join(root, entry)],
        bundle: true,
        metafile: true,
        write: false,
        platform: 'browser',
        format: 'esm',
        outdir: path.join(root, '.out'),
        logLevel: 'silent',
        absWorkingDir: root,
        plugins: [externals],
        loader: {'.css': 'empty', '.png': 'file', '.webp': 'file', '.woff2': 'file', '.svg': 'file'},
    });
    const files = new Set();
    for (const input of Object.keys(result.metafile.inputs)) {
        // Vite-style suffixes (`?url`, `?raw`) are not part of the file name.
        const rel = path.relative(root, path.resolve(root, input.replace(/[?#].*$/, ''))).split(path.sep).join('/');
        if (rel.startsWith('web/')) { files.add(rel); }
    }
    return files;
}

/**
 * @param {string} site
 * @param {string} commit
 * @param {string} root Empty directory
 */
function exportWeb(site, commit, root) {
    const tar = execFileSync('git', ['-C', site, 'archive', commit, 'web'], {maxBuffer: 1 << 30});
    execFileSync('tar', ['-x', '-C', root], {input: tar});
}

/**
 * @param {string} site
 * @param {string} commit
 * @returns {Promise<{contents: Map<string, Buffer>, manifest: import('./lib/flib-site-verify.js').SourceManifest, closureCount: number, testCount: number}>}
 */
async function computeCopy(site, commit) {
    const root = fs.mkdtempSync(path.join(process.env.FLIB_SYNC_TMP ?? os.tmpdir(), 'flib-site-'));
    try {
        exportWeb(site, commit, root);
        const date = execFileSync('git', ['-C', site, 'show', '-s', '--format=%cI', commit], {encoding: 'utf8'}).trim();
        const player = await closureOf(root, entryPoint);
        const selected = new Set(player);
        const allFiles = listFiles(root).filter((f) => !f.startsWith('.out/'));

        // Tests whose own closure intersects the player closure.
        const testFiles = allFiles.filter((f) => f.startsWith('web/src/') && (/\.test\.tsx?$/.test(f) || f.includes('/__tests__/')) && /\.tsx?$/.test(f));
        let testCount = 0;
        for (const test of testFiles) {
            const c = await closureOf(root, test);
            const hit = [...c].some((f) => f !== test && player.has(f));
            if (hit) {
                ++testCount;
                for (const f of c) { selected.add(f); }
            }
        }
        for (const f of await closureOf(root, setupFile)) { selected.add(f); }

        for (const fixed of fixedFiles) {
            if (fixed.endsWith('/')) {
                for (const f of allFiles.filter((x) => x.startsWith(fixed))) { selected.add(f); }
            } else {
                if (!fs.existsSync(path.join(root, fixed))) { throw new Error(`fixed file missing: ${fixed}`); }
                selected.add(fixed);
            }
        }
        for (const f of selected) {
            if (!fs.existsSync(path.join(root, f))) { throw new Error(`closure file missing in export: ${f}`); }
        }

        /** @type {Map<string, Buffer>} */
        const contents = new Map();
        /** @type {import('./lib/flib-site-verify.js').SourceFile[]} */
        const files = [];
        for (const f of [...selected].sort()) {
            const original = fs.readFileSync(path.join(root, f));
            if (placeholderPaths.has(f)) {
                const {width, height} = readPngSize(original);
                const placeholder = makePlaceholderPng(width, height);
                contents.set(f, placeholder);
                files.push({path: f, sha256: sha256(placeholder), replaced: 'placeholder', originalSha256: sha256(original)});
            } else {
                contents.set(f, original);
                files.push({path: f, sha256: sha256(original)});
            }
        }
        return {contents, manifest: {repo: sourceRepoName, commit, date, files}, closureCount: player.size, testCount};
    } finally {
        fs.rmSync(root, {recursive: true, force: true});
    }
}

/**
 * @param {string} flag
 * @returns {string|null}
 */
function arg(flag) {
    const i = process.argv.indexOf(flag);
    return i >= 0 && i + 1 < process.argv.length ? process.argv[i + 1] : null;
}

/**
 * @param {string} jsonPath
 */
function writeBaseline(jsonPath) {
    const source = /** @type {import('./lib/flib-site-verify.js').SourceManifest} */ (parseJson(fs.readFileSync(path.join(vendorDir, 'SOURCE.json'), 'utf8')));
    const copied = new Set(source.files.map((f) => f.path));
    const report = /** @type {{testResults: {name: string, status: string, assertionResults: {fullName: string, status: string}[]}[]}} */ (parseJson(fs.readFileSync(jsonPath, 'utf8')));
    /** @type {string[]} */
    const passed = [];
    /** @type {string[]} */
    const failed = [];
    /** @type {string[]} */
    const skipped = [];
    for (const suite of report.testResults) {
        const rel = String(suite.name).replace(/^.*?\/(web\/)/, '$1');
        if (!copied.has(rel)) { continue; }
        if (suite.assertionResults.length === 0 && suite.status === 'failed') {
            failed.push(`${rel} › (suite failed to run)`);
        }
        for (const t of suite.assertionResults) {
            const id = `${rel} › ${t.fullName}`;
            const bucket = t.status === 'passed' ? passed : (t.status === 'failed' ? failed : skipped);
            bucket.push(id);
        }
    }
    const out = {commit: source.commit, passed: passed.sort(), failed: failed.sort(), skipped: skipped.sort()};
    fs.writeFileSync(path.join(vendorDir, 'TEST-BASELINE.json'), `${JSON.stringify(out, null, 2)}\n`);
    console.log(`baseline: passed ${passed.length}, failed ${failed.length}, skipped ${skipped.length}`);
}

/** */
async function main() {
    const baseline = arg('--baseline');
    if (baseline !== null) {
        writeBaseline(baseline);
        return;
    }
    const site = arg('--site');
    const commit = arg('--commit');
    if (site === null || commit === null) {
        console.error('usage: flib-site-sync.js --site <repo> --commit <sha> [--check] | --baseline <json>');
        process.exit(2);
    }
    const check = process.argv.includes('--check');
    const {contents, manifest, closureCount, testCount} = await computeCopy(site, commit);
    const manifestText = `${JSON.stringify(manifest, null, 2)}\n`;
    console.log(`closure of PlayerPage: ${closureCount} files; tests: ${testCount}; total in copy: ${manifest.files.length}`);

    if (check) {
        const sourcePath = path.join(vendorDir, 'SOURCE.json');
        const result = fs.existsSync(sourcePath) ? verifyVendor(vendorDir, manifest) : {missing: ['SOURCE.json'], changed: [], extra: []};
        const sourceSame = fs.existsSync(sourcePath) && fs.readFileSync(sourcePath, 'utf8') === manifestText;
        if (result.missing.length + result.changed.length + result.extra.length > 0 || !sourceSame) {
            console.error(JSON.stringify({...result, sourceJsonDiffers: !sourceSame}, null, 2));
            process.exit(1);
        }
        console.log('vendor/flib-site is identical to the site');
        return;
    }

    for (const existing of listFiles(vendorDir)) {
        if (!contents.has(existing) && !nonSourceFiles.has(existing)) { fs.rmSync(path.join(vendorDir, existing)); }
    }
    for (const [rel, data] of contents) {
        const full = path.join(vendorDir, rel);
        fs.mkdirSync(path.dirname(full), {recursive: true});
        fs.writeFileSync(full, data);
    }
    // Remove empty directories left behind.
    /** @param {string} d */
    const prune = (d) => {
        for (const e of fs.readdirSync(d, {withFileTypes: true})) {
            if (e.isDirectory()) { prune(path.join(d, e.name)); }
        }
        if (d !== vendorDir && fs.readdirSync(d).length === 0) { fs.rmdirSync(d); }
    };
    prune(vendorDir);
    fs.writeFileSync(path.join(vendorDir, 'SOURCE.json'), manifestText);
}

await main();
