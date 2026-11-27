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

/*
 * «Nothing is lost» (spec §6 item 5): one scenario, run step by step on two sides, and the DOM under
 * the player compared after every step.
 * - Extension: the real extension (./ext after `npm run build:libs`) on the offline YouTube stand
 *   (flib-youtube-stand-util.js); the video is driven through the stand's player API.
 * - Site: the copied PlayerPage in an ordinary page of a browser without the extension
 *   (test/flib-youtube/parity/site-harness.tsx, built by buildFlibYoutubeParityHarness), served as
 *   https://flib.club/__parity/; its window.YT is fed by a stub bridge the spec drives.
 * Both see the same subtitles (the stand's fixtures), the same storage at mount and the same video
 * time at every step: before each snapshot the video is paused at the step's exact time on both.
 *
 * Compared: the `.player-page` subtree, and the portal subtree (document.body's portaled children
 * on the site, #flib-yt-portals on youtube.com). Normalization, and nothing more: resource URLs ->
 * `<asset>`, `--php` rounded to 0.1 %, the `@keyframes` name prefix.
 *
 *   PW_DISABLE_TS_ESM=1 bwrap --dev-bind / / --unshare-net npx playwright test -c playwright.flib-youtube.config.js flib-youtube-parity
 *
 * FLIB_PARITY_DUMP=<dir> writes both normalized snapshots of every step there.
 */

import {chromium, test as base} from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {PARITY_HARNESS_OUTDIR, buildFlibYoutubeParityHarness} from '../../dev/build-flib-youtube.js';
import {
    VIDEO_A,
    VIEWPORT,
    enableBeta,
    findChromium,
    fixture,
    launchStand,
    openStand,
    root,
    serveFile,
    serveFlib,
    showPanel,
} from './flib-youtube-stand-util.js';

const DUMP = process.env.FLIB_PARITY_DUMP ?? null;
const HARNESS_ORIGIN = 'https://flib.club';
const HARNESS_URL = `${HARNESS_ORIGIN}/__parity/index.html`;
const SITE_FONTS = path.join(root, 'vendor', 'flib-site', 'web', 'public', 'fonts');
const STORAGE_PREFIX = 'flibYt:';
// What the panel build puts before the copy's @keyframes names (spec §3 item 5 allows one). Today
// none: dev/flib-css-scope.js leaves @keyframes and animation names as they are (panel.css has the
// site's own names), so normalization 3 strips nothing. Set it here if the build starts prefixing.
const KEYFRAMES_PREFIX = '';

/** @typedef {import('./flib-youtube-stand-util.js').Stand} Stand */
/** @typedef {import('@playwright/test').Page} Page */

/**
 * @typedef {object} Side
 * @property {string} name
 * @property {Page} page
 * @property {string} scope Selector of the node the copy is rendered into.
 * @property {string|null} portals Id of the portal node; null: the copy portals into <body> (the site).
 * @property {(expression: string) => Promise<unknown>} evaluate In the world the copy runs in.
 * @property {(seconds: number) => Promise<void>} pauseAt Pauses the video at exactly `seconds`.
 */

/**
 * The harness page: the site's index.html shape (#root), the harness bundle.
 * @returns {string}
 */
function harnessHtml() {
    return [
        '<!DOCTYPE html>',
        '<html lang="ru">',
        '<head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">',
        '<title>flib.club parity harness</title>',
        '<link rel="stylesheet" href="/__parity/harness.css"></head>',
        '<body><div id="root"></div><script src="/__parity/harness.js"></script></body>',
        '</html>',
    ].join('');
}

/**
 * https://flib.club/* for the harness browser: the page, its bundle, the site's /fonts and the
 * stand's /api (the same fixtures the extension's background gets).
 * @param {import('@playwright/test').Route} route
 * @param {URL} url
 * @returns {Promise<void>}
 */
async function serveHarness(route, url) {
    if (url.origin !== HARNESS_ORIGIN) {
        await route.abort('internetdisconnected');
        return;
    }
    if (url.pathname === '/__parity/index.html') {
        await route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: harnessHtml()});
        return;
    }
    const own = /^\/__parity\/([\w.-]+)$/.exec(url.pathname);
    if (own !== null && fs.existsSync(path.join(PARITY_HARNESS_OUTDIR, own[1]))) {
        const ext = path.extname(own[1]);
        /** @type {Record<string, string>} */
        const types = {'.js': 'text/javascript', '.css': 'text/css', '.png': 'image/png', '.webp': 'image/webp', '.woff2': 'font/woff2', '.woff': 'font/woff'};
        await serveFile(route, path.join(PARITY_HARNESS_OUTDIR, own[1]), types[ext] ?? 'application/octet-stream');
        return;
    }
    const font = /^\/fonts\/([\w.-]+\.woff2)$/.exec(url.pathname);
    if (font !== null && fs.existsSync(path.join(SITE_FONTS, font[1]))) {
        await serveFile(route, path.join(SITE_FONTS, font[1]), 'font/woff2');
        return;
    }
    await serveFlib(route, url);
}

// ---------------------------------------------------------------------------------------------
// Normalization: exactly the three differences the spec allows.

/**
 * @param {string} html
 * @param {string} extensionId
 * @returns {string}
 */
function normalize(html, extensionId) {
    return html
        // 1. Resource URLs: the extension's files / the harness bundle's files.
        .replaceAll(new RegExp(`chrome-extension://${extensionId}/lib/flib-youtube/[\\w./-]+`, 'g'), '<asset>')
        .replaceAll(/(?:https:\/\/flib\.club)?\/__parity\/[\w.-]+/g, '<asset>')
        // 2. The playhead variable, rounded to 0.1 %.
        .replaceAll(/--php:\s*(-?[\d.]+(?:e-?\d+)?)%/g, (_, /** @type {string} */ n) => `--php: ${(Math.round(Number.parseFloat(n) * 10) / 10).toFixed(1)}%`)
        // 3. The `@keyframes` name prefix (KEYFRAMES_PREFIX).
        .replaceAll(KEYFRAMES_PREFIX.length > 0 ? new RegExp(`\\b${KEYFRAMES_PREFIX}(?=[\\w-])`, 'g') : /(?!)/g, '');
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {string|null} The first differing fragment of both, or null when equal.
 */
function firstDifference(a, b) {
    if (a === b) { return null; }
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) { ++i; }
    const from = Math.max(0, i - 240);
    return `at ${i} of ${a.length}/${b.length}\n  site:      …${a.slice(from, i + 240)}…\n  extension: …${b.slice(from, i + 240)}…`;
}


// ---------------------------------------------------------------------------------------------
// Snapshots

/**
 * The normalized `.player-page` and portal HTML of one side, once its DOM has settled: unchanged
 * over at least two animation frames and 600 ms (four of the copy's 150 ms clock polls).
 * @param {Side} side
 * @param {string} extensionId
 * @returns {Promise<{page: string, portals: string}>}
 */
async function settledSnapshot(side, extensionId) {
    const raw = await side.page.evaluate(async ({scope, portals}) => {
        const portalNodes = () => (portals === null ?
            // The site: what the copy portaled into <body> (everything but #root and the bundle).
            [...document.body.children].filter((el) => el.id !== 'root' && el.tagName !== 'SCRIPT') :
            [...(document.getElementById(portals)?.children ?? [])]);
        const read = () => {
            const page = document.querySelector(`${scope} .player-page`);
            return {page: page === null ? '' : page.outerHTML, portals: portalNodes().map((el) => el.outerHTML).join('')};
        };
        /** @type {() => Promise<number>} The frame's timestamp. */
        const frame = () => new Promise((resolve) => { requestAnimationFrame(resolve); });
        const minMs = 600;
        const start = await frame();
        let last = read();
        let stableSince = start;
        let stableFrames = 0;
        for (let now = start; now - start < 15000; now = await frame()) {
            const next = read();
            if (next.page === last.page && next.portals === last.portals) {
                ++stableFrames;
                if (stableFrames >= 2 && now - stableSince >= minMs) { return next; }
            } else {
                last = next;
                stableSince = now;
                stableFrames = 0;
            }
        }
        throw new Error('the DOM did not settle in 15 s');
    }, {scope: side.scope, portals: side.portals});
    return {page: normalize(raw.page, extensionId), portals: normalize(raw.portals, extensionId)};
}

// ---------------------------------------------------------------------------------------------
// Deterministic inputs. The copy names a new mute region `${Date.now()}-${Math.random() hex}`
// (player/hooks/useMuteRegions.ts:20). That is an input of the copy, like the video time: during
// the step that creates one, both sides get the same frozen Date.now and the same seeded
// Math.random, in the world the copy runs in (the site: the page; youtube.com: the extension's
// isolated world, reached over CDP). Outside that step both are the real ones.

const DETERMINISM = `(() => {
    if (globalThis.__parityDet) { return true; }
    const now = Date.now.bind(Date);
    const random = Math.random.bind(Math);
    const det = {frozen: null, seed: null};
    Date.now = () => (det.frozen === null ? now() : det.frozen);
    Math.random = () => {
        if (det.seed === null) { return random(); }
        det.seed = (det.seed + 0x6D2B79F5) | 0;
        let t = det.seed;
        t = Math.imul(t ^ (t >>> 15), t | 1);
        t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    globalThis.__parityDet = det;
    return true;
})()`;

/**
 * @param {number|null} frozen
 * @param {number|null} seed
 * @returns {string}
 */
const setDeterminism = (frozen, seed) => `(() => { globalThis.__parityDet.frozen = ${JSON.stringify(frozen)}; globalThis.__parityDet.seed = ${JSON.stringify(seed)}; return true; })()`;

/**
 * Evaluates expressions in the extension's isolated world of the page's main frame (the world of
 * the panel bundle: the one where `__flibYtPanelStarted` is true).
 * @param {Page} page
 * @returns {Promise<(expression: string) => Promise<unknown>>}
 */
async function panelWorld(page) {
    const cdp = await page.context().newCDPSession(page);
    /** @type {Array<{id: number, auxData?: {type?: string, frameId?: string}}>} */
    const contexts = [];
    cdp.on('Runtime.executionContextCreated', ({context}) => { contexts.push(context); });
    await cdp.send('Runtime.enable');
    const {frameTree} = await cdp.send('Page.getFrameTree');
    const evaluate = async (/** @type {number} */ contextId, /** @type {string} */ expression) => {
        const reply = await cdp.send('Runtime.evaluate', {contextId, expression, returnByValue: true});
        if (reply.exceptionDetails) { throw new Error(`panel world: ${reply.exceptionDetails.text}`); }
        return /** @type {unknown} */ (reply.result.value);
    };
    for (const context of contexts) {
        if (context.auxData?.type !== 'isolated' || context.auxData.frameId !== frameTree.frame.id) { continue; }
        if (await evaluate(context.id, 'globalThis.__flibYtPanelStarted === true') === true) {
            return async (expression) => await evaluate(context.id, expression);
        }
    }
    throw new Error('no isolated world with the panel');
}

// ---------------------------------------------------------------------------------------------
// The scenario (task brief, step 1), plus the RegionMenu for the portal subtree. Each step acts
// the same way on both sides; then both are paused at `at`, the step's video time.

/**
 * @param {Side} side
 * @param {string} selector
 * @returns {import('@playwright/test').Locator}
 */
function q(side, selector) {
    return side.page.locator(`${side.scope} ${selector}`).first();
}

/**
 * A real mouse click at a point of the element (fractions of its box).
 * @param {Side} side
 * @param {import('@playwright/test').Locator} locator
 * @param {{button?: 'left'|'right', fx?: number, fy?: number}} [options]
 */
async function clickAt(side, locator, {button = 'left', fx = 0.5, fy = 0.5} = {}) {
    const box = await locator.boundingBox();
    if (box === null) { throw new Error(`${side.name}: the element to click has no box`); }
    await side.page.mouse.click(box.x + box.width * fx, box.y + box.height * fy, {button});
}

const CUES = /** @type {{cues: Array<{start: number, end: number}>}} */ (fixture(`subtitles-${VIDEO_A}.json`)).cues;
const BOX = 4; // the 5th SUB box
const BOX_START = CUES[BOX].start;

/**
 * @param {number} t
 * @returns {string} The copy's time display at `t` of the 1:00 clip.
 */
const clock = (t) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')} / 1:00`;

/**
 * @typedef {object} Step
 * @property {string} name
 * @property {number} at The video time both sides are paused at before the snapshot.
 * @property {(side: Side) => Promise<void>} [act]
 * @property {(side: Side) => Promise<void>} check What the step did (both sides; also the explicit wait).
 * @property {boolean} [deterministic] Frozen Date.now and seeded Math.random during `act`.
 * @property {string} [align] Before `act`, the site's #root is moved so that this element of the copy
 *   is at the same viewport point as on youtube.com (the copy opens menus at the click's clientX/Y).
 */

/** @type {Step[]} */
const SCENARIO = [
    ...[0, 12.3, 47].map((t) => ({
        name: `video time ${t}`,
        at: t,
        check: async (/** @type {Side} */ side) => { await expect(q(side, '[data-testid="time"]')).toHaveText(clock(t)); },
    })),
    {
        name: 'click the 5th SUB box',
        at: BOX_START,
        act: async (side) => { await clickAt(side, side.page.locator(`${side.scope} [data-cue]`).nth(BOX)); },
        check: async (side) => {
            await expect(q(side, '[data-workspace-bar]')).toHaveAttribute('data-ab-start', String(CUES[BOX].start));
            await expect(q(side, '[data-workspace-bar]')).toHaveAttribute('data-ab-end', String(CUES[BOX].end));
            await expect(q(side, '[data-testid="time"]')).toHaveText(clock(BOX_START));
        },
    },
    {
        name: 'Ctrl+wheel over the timeline (zoom)',
        at: BOX_START,
        act: async (side) => {
            const box = await q(side, '[data-workspace-bar]').boundingBox();
            if (box === null) { throw new Error(`${side.name}: no timeline`); }
            await side.page.mouse.move(box.x + box.width * 0.3, box.y + 30);
            await side.page.keyboard.down('Control');
            await side.page.mouse.wheel(0, -400);
            await side.page.keyboard.up('Control');
        },
        // xToTime at 30 % of the bar is 18 s at the start: zoomed in, cue 0 (0-5 s) leaves the view.
        check: async (side) => { await expect(side.page.locator(`${side.scope} [data-cue]`)).not.toHaveCount(CUES.length); },
    },
    {
        name: 'drag handle B',
        at: BOX_START,
        act: async (side) => {
            const box = await q(side, '[data-handle="right"]').boundingBox();
            if (box === null) { throw new Error(`${side.name}: no handle B`); }
            const x = box.x + box.width / 2;
            const y = box.y + box.height / 2;
            await side.page.mouse.move(x, y);
            await side.page.mouse.down();
            await side.page.mouse.move(x + 20, y, {steps: 4});
            await side.page.mouse.move(x + 40, y, {steps: 4});
            await side.page.mouse.up();
        },
        check: async (side) => {
            await expect(q(side, '[data-workspace-bar]')).not.toHaveAttribute('data-ab-end', String(CUES[BOX].end));
        },
    },
    {
        name: 'A-B on',
        at: BOX_START,
        act: async (side) => { await q(side, '[data-loop-active]').click(); },
        check: async (side) => { await expect(q(side, '[data-loop-active]')).toHaveAttribute('data-loop-active', 'true'); },
    },
    {
        // EN+RU is the copy's default mode: the click keeps it.
        name: 'mode EN+RU',
        at: BOX_START,
        act: async (side) => { await q(side, '[data-testid="sub-mode-enru"]').click(); },
        check: async (side) => { await expect(q(side, '[data-testid="sub-mode-enru"]')).toHaveClass(/\bis-active\b/); },
    },
    {
        name: 'mode Hide',
        at: BOX_START,
        act: async (side) => { await q(side, '[data-testid="sub-mode-off"]').click(); },
        check: async (side) => { await expect(q(side, '[data-testid="sub-mode-off"]')).toHaveClass(/\bis-active\b/); },
    },
    {
        // The AUD track's own right-click: the next waveform mode, with a pill for 1.2 s.
        name: 'right-click the AUD track',
        at: BOX_START,
        act: async (side) => { await clickAt(side, q(side, '[data-testid="aud-track-toggle"]'), {button: 'right'}); },
        check: async (side) => { await expect(q(side, '[data-testid="aud-track-toggle"]')).toHaveAttribute('title', /дБ/); },
    },
    {
        name: 'key m (mute region over A-B)',
        at: BOX_START,
        deterministic: true,
        act: async (side) => { await side.page.keyboard.press('m'); },
        check: async (side) => { await expect(side.page.locator(`${side.scope} [data-testid="mute-region"]`)).toHaveCount(1); },
    },
    {
        name: 'key z (timeline hidden)',
        at: BOX_START,
        act: async (side) => { await side.page.keyboard.press('z'); },
        check: async (side) => { await expect(side.page.locator(`${side.scope} [data-workspace-bar]`)).toHaveCount(0); },
    },
    {
        name: 'key z again (timeline back)',
        at: BOX_START,
        act: async (side) => { await side.page.keyboard.press('z'); },
        check: async (side) => { await expect(side.page.locator(`${side.scope} [data-testid="mute-region"]`)).toHaveCount(1); },
    },
    {
        // Beyond the brief's list: a portaled menu (RegionMenu), to compare the portal subtree.
        name: 'right-click the mute region (RegionMenu, portaled)',
        at: BOX_START,
        align: '[data-testid="mute-region"]',
        act: async (side) => { await clickAt(side, q(side, '[data-testid="mute-region"]'), {button: 'right'}); },
        check: async (side) => {
            await expect(side.page.locator('[data-testid="region-menu"]')).toHaveCount(1);
            await expect(side.page.locator(`${side.scope} [data-testid="region-menu"]`)).toHaveCount(0);
        },
    },
    {
        name: 'Escape closes the RegionMenu',
        at: BOX_START,
        act: async (side) => { await side.page.keyboard.press('Escape'); },
        check: async (side) => { await expect(side.page.locator('[data-testid="region-menu"]')).toHaveCount(0); },
    },
];

/**
 * Moves the site's #root (position: relative, left/top; no transform, which would change where the
 * copy's fixed elements are placed) so that `selector` is where it is on youtube.com.
 * @param {Side} site
 * @param {Side} ext
 * @param {string} selector
 */
async function alignSite(site, ext, selector) {
    const delta = async () => {
        const e = await q(ext, selector).boundingBox();
        const s = await q(site, selector).boundingBox();
        if (e === null || s === null) { throw new Error(`align: ${selector} has no box`); }
        return {dx: e.x - s.x, dy: e.y - s.y};
    };
    await site.page.evaluate(({dx, dy}) => {
        const el = /** @type {HTMLElement} */ (document.getElementById('root'));
        el.style.position = 'relative';
        el.style.left = `${(Number.parseFloat(el.style.left) || 0) + dx}px`;
        el.style.top = `${(Number.parseFloat(el.style.top) || 0) + dy}px`;
    }, await delta());
    const after = await delta();
    expect(Math.max(Math.abs(after.dx), Math.abs(after.dy))).toBeLessThan(0.5);
}

// ---------------------------------------------------------------------------------------------

const test = base.extend(/** @type {import('@playwright/test').Fixtures<{stand: Stand, harness: Page}>} */ ({
    // eslint-disable-next-line no-empty-pattern
    stand: async ({}, use) => {
        const stand = await launchStand();
        await use(stand);
        await stand.context.close();
    },
    // A browser without the extension: the site's page as on flib.club.
    // eslint-disable-next-line no-empty-pattern
    harness: async ({}, use) => {
        await buildFlibYoutubeParityHarness();
        const browser = await chromium.launch({executablePath: findChromium(), headless: true});
        const context = await browser.newContext({viewport: VIEWPORT});
        await context.route(/^https?:\/\//, async (route) => { await serveHarness(route, new URL(route.request().url())); });
        const page = await context.newPage();
        await use(page);
        await browser.close();
    },
}));
const expect = test.expect;

test.describe('flib-youtube DOM parity with the site', () => {
    test('the same scenario gives the same DOM under the player', async ({stand, harness}) => {
        test.setTimeout(240 * 1000);
        // Extension: beta on, the stand paused at 0, the panel shown.
        await enableBeta(stand);
        const page = await openStand(stand);
        await page.evaluate(() => {
            window.stand.player.pauseVideo();
            window.stand.player.seekTo(0, true);
        });
        await showPanel(stand, page);
        const player = await page.evaluate(() => {
            const p = window.stand.player;
            return {
                duration: p.getDuration(),
                rate: p.getPlaybackRate(),
                rates: p.getAvailablePlaybackRates(),
                muted: p.isMuted(),
                volume: p.getVolume(),
                loadedFraction: p.getVideoLoadedFraction(),
            };
        });
        const storage = /** @type {Record<string, string>} */ (await stand.ext.evaluate(async (prefix) => {
            const all = await chrome.storage.local.get(null);
            return Object.fromEntries(Object.entries(all).filter(([k, v]) => k.startsWith(prefix) && typeof v === 'string'));
        }, STORAGE_PREFIX));

        // Site: the same player values and the same storage.
        await harness.goto(HARNESS_URL);
        await harness.evaluate(async (init) => { await window.parityHarness.mount(init); }, {
            entry: `/player?v=${VIDEO_A}`,
            snapshot: {...player, videoId: VIDEO_A, currentTime: 0, state: 2},
            storage,
        });
        await expect(harness.locator('#root [data-cue]')).toHaveCount(CUES.length);

        // The copy renders at the same width on both sides: #root takes the width of the extension's
        // container (YouTube's column), so the rail, the panel and the timeline get the same pixels.
        const width = await page.evaluate(() => document.getElementById('flib-yt-root')?.getBoundingClientRect().width ?? 0);
        expect(width).toBeGreaterThan(0);
        await harness.evaluate((w) => { /** @type {HTMLElement} */ (document.getElementById('root')).style.width = `${w}px`; }, width);
        await Promise.all([page, harness].map((p) => p.evaluate(async () => { await document.fonts.ready; })));

        const extWorld = await panelWorld(page);
        await extWorld(DETERMINISM);
        await harness.evaluate(DETERMINISM);

        /** @type {Side} */
        const site = {
            name: 'site',
            page: harness,
            scope: '#root',
            portals: null,
            evaluate: async (expression) => await harness.evaluate(expression),
            pauseAt: async (t) => { await harness.evaluate((s) => { window.parityHarness.pauseAt(s); }, t); },
        };
        /** @type {Side} */
        const ext = {
            name: 'extension',
            page,
            scope: '#flib-yt-root',
            portals: 'flib-yt-portals',
            evaluate: extWorld,
            pauseAt: async (t) => {
                await page.evaluate((s) => {
                    window.stand.player.pauseVideo();
                    window.stand.player.seekTo(s, true);
                }, t);
                await expect.poll(() => page.evaluate(() => ({paused: window.stand.video.paused, t: window.stand.video.currentTime}))).toEqual({paused: true, t});
            },
        };

        /** @type {string[]} */
        const results = [];
        /** @type {string|null} */
        let failure = null;
        let previous = '';
        for (const [i, step] of SCENARIO.entries()) {
            const frozen = Date.now();
            if (step.align) { await alignSite(site, ext, step.align); }
            // A failed check is reported with the step, after the DOM comparison: it shows what differs.
            const checks = await Promise.all([site, ext].map(async (side) => {
                if (step.deterministic) { await side.evaluate(setDeterminism(frozen, 0x5eed)); }
                try {
                    if (step.act) { await step.act(side); }
                } finally {
                    if (step.deterministic) { await side.evaluate(setDeterminism(null, null)); }
                }
                await side.pauseAt(step.at);
                try {
                    await step.check(side);
                    return null;
                } catch (e) {
                    return `the check failed on the ${side.name} side: ${(e instanceof Error ? e.message : String(e)).split('\n')[0]}`;
                }
            }));
            const [a, b] = await Promise.all([settledSnapshot(site, stand.extensionId), settledSnapshot(ext, stand.extensionId)]);
            if (DUMP !== null) {
                fs.mkdirSync(DUMP, {recursive: true});
                const file = `${String(i).padStart(2, '0')}-${step.name.replaceAll(/[^\w]+/g, '_')}`;
                fs.writeFileSync(path.join(DUMP, `${file}.site.html`), `${a.page}\n<!-- portals -->\n${a.portals}\n`);
                fs.writeFileSync(path.join(DUMP, `${file}.ext.html`), `${b.page}\n<!-- portals -->\n${b.portals}\n`);
            }
            /** @type {string|null} */
            let diff = null;
            if (a.page.length === 0 || b.page.length === 0) {
                diff = `no .player-page (site ${a.page.length} chars, extension ${b.page.length} chars)`;
            } else if (i > 0 && step.name !== 'mode EN+RU' && `${a.page}${a.portals}` === previous) {
                diff = 'the step changed nothing on the site';
            } else {
                const pageDiff = firstDifference(a.page, b.page);
                const portalDiff = firstDifference(a.portals, b.portals);
                diff = pageDiff !== null ? `.player-page ${pageDiff}` : (portalDiff !== null ? `portals ${portalDiff}` : null);
            }
            const checkFailures = checks.filter((c) => c !== null);
            if (checkFailures.length > 0) { diff = `${checkFailures.join('; ')}${diff === null ? '' : `\n${diff}`}`; }
            previous = `${a.page}${a.portals}`;
            results.push(`${diff === null ? 'PASS' : 'FAIL'}  ${i}. ${step.name}`);
            if (diff !== null) {
                console.log(`step ${i} «${step.name}»: ${diff}`);
                failure ??= `step ${i} «${step.name}»: ${diff}`;
            }
        }
        console.log(`parity steps:\n${results.join('\n')}`);
        // What each side asked the site's /api (the extension through its background proxy).
        const siteApi = await harness.evaluate(() => [...window.parityHarness.requests]);
        const extApi = stand.net.filter((r) => r.url.startsWith('https://flib.club/api/')).map((r) => `${r.method} ${r.url.slice('https://flib.club'.length)} ${r.status}`);
        console.log(`/api requests:\n  site:      ${siteApi.join(', ')}\n  extension: ${extApi.join(', ')}`);
        expect(failure).toBeNull();
    });
});
