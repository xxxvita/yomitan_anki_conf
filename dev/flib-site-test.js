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
 * Runs the copied flib.club tests (vendor/flib-site/web) with this repository's vitest and
 * compares the outcome with the site's own baseline (vendor/flib-site/TEST-BASELINE.json).
 * Test ids are built exactly like dev/flib-site-sync.js --baseline: "<web/...path> › <full name>".
 * Exit code 1 on any newly failing or missing test.
 */

import {spawnSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {parseJson} from './json.js';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(dirname, '..');
const vendorDir = path.join(repoRoot, 'vendor', 'flib-site');

/**
 * @typedef {{passed: string[], failed: string[], skipped: string[]}} Outcome
 */

/**
 * @param {Outcome} baseline
 * @param {Outcome} results
 * @returns {{newlyFailing: string[], newlyPassing: string[], missing: string[]}}
 */
export function compareWithBaseline(baseline, results) {
    const passed = new Set(results.passed);
    const failed = new Set(results.failed);
    const skipped = new Set(results.skipped);
    /** @type {string[]} */
    const newlyFailing = [];
    /** @type {string[]} */
    const newlyPassing = [];
    /** @type {string[]} */
    const missing = [];
    for (const id of baseline.passed) {
        if (passed.has(id)) { continue; }
        (failed.has(id) ? newlyFailing : missing).push(id);
    }
    for (const id of [...baseline.failed, ...baseline.skipped]) {
        if (passed.has(id)) {
            if (baseline.failed.includes(id)) { newlyPassing.push(id); }
        } else if (!failed.has(id) && !skipped.has(id)) {
            missing.push(id);
        }
    }
    return {newlyFailing: newlyFailing.sort(), newlyPassing: newlyPassing.sort(), missing: missing.sort()};
}

/**
 * @param {string} jsonPath vitest --reporter=json output
 * @returns {Outcome}
 */
function readResults(jsonPath) {
    const report = /** @type {{testResults: {name: string, status: string, assertionResults: {fullName: string, status: string}[]}[]}} */ (parseJson(fs.readFileSync(jsonPath, 'utf8')));
    /** @type {Outcome} */
    const out = {passed: [], failed: [], skipped: []};
    for (const suite of report.testResults) {
        const rel = String(suite.name).replace(/^.*?\/(web\/)/, '$1');
        if (suite.assertionResults.length === 0 && suite.status === 'failed') {
            out.failed.push(`${rel} › (suite failed to run)`);
        }
        for (const t of suite.assertionResults) {
            const id = `${rel} › ${t.fullName}`;
            (t.status === 'passed' ? out.passed : (t.status === 'failed' ? out.failed : out.skipped)).push(id);
        }
    }
    return out;
}

/** */
function main() {
    const baseline = /** @type {Outcome} */ (parseJson(fs.readFileSync(path.join(vendorDir, 'TEST-BASELINE.json'), 'utf8')));
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'flib-site-test-'));
    const jsonPath = path.join(tmp, 'report.json');
    try {
        const webDir = path.join(vendorDir, 'web');
        const vitestBin = path.join(repoRoot, 'node_modules', 'vitest', 'vitest.mjs');
        const started = Date.now();
        const run = spawnSync(process.execPath, [
            vitestBin,
            'run',
            '--root',
            webDir,
            '--config',
            path.join(dirname, 'flib-site-vitest.config.js'),
            '--reporter=json',
            `--outputFile=${jsonPath}`,
        ], {cwd: webDir, stdio: ['ignore', 'inherit', 'inherit'], env: {...process.env, FLIB_SITE_CACHE_DIR: path.join(tmp, 'cache')}});
        if (!fs.existsSync(jsonPath)) {
            console.error(`vitest produced no report (exit ${String(run.status)})`);
            process.exit(1);
        }
        const diff = compareWithBaseline(baseline, readResults(jsonPath));
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        console.log(`flib-site: baseline passed ${baseline.passed.length}; newlyFailing ${diff.newlyFailing.length}, missing ${diff.missing.length}, newlyPassing ${diff.newlyPassing.length}; ${seconds}s`);
        for (const [label, ids] of Object.entries(diff)) {
            for (const id of ids) { console.log(`  ${label}: ${id}`); }
        }
        if (diff.newlyFailing.length + diff.missing.length > 0) { process.exit(1); }
    } finally {
        fs.rmSync(tmp, {recursive: true, force: true});
    }
}

if (typeof process.argv[1] === 'string' && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    main();
}
