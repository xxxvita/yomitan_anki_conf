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
 * Offline YouTube stand (spec §6 item 6). The real extension (./ext with ext/lib/flib-youtube from
 * `npm run build:libs`) runs in Chromium on test/flib-youtube/stand/watch.html, served as
 * https://www.youtube.com/watch?v=<id>. flib.club answers from test/flib-youtube/stand/fixtures.
 * Every other http(s) request is aborted. Run (see playwright.flib-youtube.config.js):
 *
 *   PW_DISABLE_TS_ESM=1 bwrap --dev-bind / / --unshare-net npx playwright test -c playwright.flib-youtube.config.js
 *
 * FLIB_STAND_SHOTS=<dir> also saves the owner's screenshots there. FLIB_STAND_CHROMIUM=<path>
 * picks the browser; by default Playwright's own Chromium, or else the newest one in
 * ~/.cache/ms-playwright.
 */

import {test as base, chromium} from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {fileURLToPath} from 'url';
import {createDictionaryArchiveData} from '../../dev/dictionary-archive-util.js';
import {parseJson} from '../../dev/json.js';

process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

const dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dirname, '..', '..');
const STAND = path.join(root, 'test', 'flib-youtube', 'stand');
const SHOTS = process.env.FLIB_STAND_SHOTS ?? null;

const VIDEO_A = 'stndClipA01';
const VIDEO_B = 'stndClipB02';
const WATCH_A = `https://www.youtube.com/watch?v=${VIDEO_A}`;
const VIEWPORT = {width: 1440, height: 900};

/** @typedef {{url: string, method: string, status: number, body?: string}} NetRecord */

/**
 * @returns {string|undefined}
 */
function findChromium() {
    if (process.env.FLIB_STAND_CHROMIUM) { return process.env.FLIB_STAND_CHROMIUM; }
    const own = chromium.executablePath();
    if (fs.existsSync(own)) { return void 0; }
    const cache = path.join(os.homedir(), '.cache', 'ms-playwright');
    const candidates = fs.existsSync(cache) ? fs.readdirSync(cache).filter((d) => /^chromium-\d+$/.test(d)) : [];
    candidates.sort((a, b) => Number(b.split('-')[1]) - Number(a.split('-')[1]));
    for (const dir of candidates) {
        const exe = path.join(cache, dir, 'chrome-linux64', 'chrome');
        if (fs.existsSync(exe)) { return exe; }
    }
    return void 0;
}

/**
 * @param {string} name
 * @returns {unknown}
 */
function fixture(name) {
    return parseJson(fs.readFileSync(path.join(STAND, 'fixtures', name), 'utf8'));
}

/**
 * Serves a stand file, with byte ranges (the <video> seeks with Range requests).
 * @param {import('@playwright/test').Route} route
 * @param {string} file
 * @param {string} contentType
 * @returns {Promise<number>}
 */
async function serveFile(route, file, contentType) {
    const buf = fs.readFileSync(file);
    const range = route.request().headers().range;
    const m = typeof range === 'string' ? /bytes=(\d*)-(\d*)/.exec(range) : null;
    if (m !== null) {
        const start = m[1] ? Number(m[1]) : 0;
        const end = m[2] ? Math.min(Number(m[2]), buf.length - 1) : buf.length - 1;
        await route.fulfill({
            status: 206,
            headers: {'Content-Type': contentType, 'Accept-Ranges': 'bytes', 'Content-Range': `bytes ${start}-${end}/${buf.length}`},
            body: buf.subarray(start, end + 1),
        });
        return 206;
    }
    await route.fulfill({status: 200, headers: {'Content-Type': contentType, 'Accept-Ranges': 'bytes'}, body: buf});
    return 200;
}

/**
 * https://www.youtube.com/*: the watch page and its clips; 404 for anything else.
 * @param {import('@playwright/test').Route} route
 * @param {URL} url
 * @returns {Promise<number>}
 */
async function serveYoutube(route, url) {
    if (url.pathname === '/watch') {
        await route.fulfill({status: 200, contentType: 'text/html; charset=utf-8', body: fs.readFileSync(path.join(STAND, 'watch.html'))});
        return 200;
    }
    const clip = /^\/stand\/([\w-]+\.webm)$/.exec(url.pathname);
    if (clip !== null && fs.existsSync(path.join(STAND, clip[1]))) {
        return await serveFile(route, path.join(STAND, clip[1]), 'video/webm');
    }
    await route.fulfill({status: 404, contentType: 'text/plain', body: 'not on the stand'});
    return 404;
}

/**
 * https://flib.club/*: the site's /api with the site's response shapes.
 * @param {import('@playwright/test').Route} route
 * @param {URL} url
 * @returns {Promise<number>}
 */
async function serveFlib(route, url) {
    const req = route.request();
    const json = async (/** @type {number} */ status, /** @type {unknown} */ body, /** @type {Record<string, string>} */ headers = {}) => {
        await route.fulfill({status, headers: {'Content-Type': 'application/json', ...headers}, body: JSON.stringify(body)});
        return status;
    };
    if (url.pathname === '/api/youtube/subtitles' && req.method() === 'GET') {
        const v = url.searchParams.get('v') ?? '';
        const file = path.join(STAND, 'fixtures', `subtitles-${v}.json`);
        if (!/^[\w-]+$/.test(v) || !fs.existsSync(file)) { return await json(404, {error: 'not_found'}); }
        return await json(200, fixture(`subtitles-${v}.json`), {'X-Subtitle-Source': 'composite'});
    }
    if (url.pathname === '/api/youtube/subtitles/translate' && req.method() === 'POST') {
        // {video_id, from_ms, to_ms} -> {cues: [{en, ru, start, end}]} for the cues the corpus has no RU for.
        const body = /** @type {{video_id?: string, from_ms?: number, to_ms?: number}} */ (/** @type {unknown} */ (req.postDataJSON()) ?? {});
        const name = `translate-${body.video_id}.json`;
        if (typeof body.video_id !== 'string' || !/^[\w-]+$/.test(body.video_id) || !fs.existsSync(path.join(STAND, 'fixtures', name))) { return await json(404, {error: 'not_in_corpus'}); }
        const all = /** @type {{cues: Array<{en: string, ru: string, start: number, end: number}>}} */ (fixture(name));
        const from = (body.from_ms ?? 0) / 1000;
        const to = (body.to_ms ?? 0) / 1000;
        return await json(200, {cues: all.cues.filter((c) => c.end > from && c.start < to)}, {'X-Subtitle-Source': 'composite'});
    }
    if (url.pathname === '/api/examples' && req.method() === 'GET') {
        const examples = /** @type {{word: string, items: Array<{source: string}>}} */ (fixture('examples.json'));
        const kind = url.searchParams.get('kind');
        const items = kind === 'youtube' || kind === 'film' ? examples.items.filter((i) => i.source === kind) : examples.items;
        return await json(200, {word: url.searchParams.get('word') ?? '', items});
    }
    if (url.pathname === '/api/feedback/video' && req.method() === 'POST') {
        await route.fulfill({status: 204, body: ''});
        return 204;
    }
    return await json(404, {error: 'not_on_the_stand'});
}

/**
 * @typedef {object} Stand
 * @property {import('@playwright/test').BrowserContext} context
 * @property {string} extensionId
 * @property {NetRecord[]} net Every http(s) request of the browser (pages and the service worker).
 * @property {import('@playwright/test').Page} ext An extension page (info.html) to call the backend from.
 * @property {string[]} consoleErrors console.error lines of every page, `<url> | <text>`.
 */

const test = base.extend(/** @type {import('@playwright/test').Fixtures<{stand: Stand}>} */ ({
    // eslint-disable-next-line no-empty-pattern
    stand: async ({}, use) => {
        const pathToExtension = path.join(root, 'ext');
        const context = await chromium.launchPersistentContext('', {
            executablePath: findChromium(),
            headless: true,
            viewport: VIEWPORT,
            args: [
                `--disable-extensions-except=${pathToExtension}`,
                `--load-extension=${pathToExtension}`,
                '--autoplay-policy=no-user-gesture-required',
            ],
        });
        /** @type {NetRecord[]} */
        const net = [];
        /** @type {string[]} */
        const consoleErrors = [];
        context.on('page', (p) => {
            p.on('console', (m) => {
                if (m.type() === 'error') { consoleErrors.push(`${p.url()} | ${m.text()}`); }
            });
        });
        await context.route(/^https?:\/\//, async (route) => {
            const req = route.request();
            const url = new URL(req.url());
            /** @type {NetRecord} */
            const record = {url: req.url(), method: req.method(), status: 0};
            if (req.method() === 'POST') { record.body = req.postData() ?? ''; }
            net.push(record);
            if (url.origin === 'https://www.youtube.com') {
                record.status = await serveYoutube(route, url);
            } else if (url.origin === 'https://flib.club') {
                record.status = await serveFlib(route, url);
            } else {
                // Includes AnkiConnect / the local gateway on 127.0.0.1: never reached.
                await route.abort('internetdisconnected');
            }
        });
        let [worker] = context.serviceWorkers();
        if (!worker) { worker = await context.waitForEvent('serviceworker'); }
        const extensionId = worker.url().split('/')[2];
        // The on-install welcome tab.
        for (const p of context.pages()) {
            if (p.url().includes('/welcome.html')) { await p.close(); }
        }
        context.on('page', (p) => {
            if (p.url().includes('/welcome.html')) { void p.close(); }
        });
        const ext = await context.newPage();
        await ext.goto(`chrome-extension://${extensionId}/info.html`);
        await use({context, extensionId, net, ext, consoleErrors});
        await context.close();
    },
}));
const expect = test.expect;

/**
 * Calls the backend's api-map from an extension page.
 * @param {Stand} stand
 * @param {string} action
 * @param {unknown} [params]
 * @returns {Promise<unknown>}
 */
async function backend(stand, action, params) {
    const reply = /** @type {{result?: unknown, error?: {message: string}}} */ (await stand.ext.evaluate(
        async ([a, p]) => await chrome.runtime.sendMessage(p === null ? {action: a} : {action: a, params: p}),
        /** @type {[string, unknown]} */ ([action, params ?? null]),
    ));
    if (reply && typeof reply === 'object' && 'error' in reply && reply.error) { throw new Error(`${action}: ${reply.error.message}`); }
    return reply?.result;
}

/**
 * @param {Stand} stand
 * @param {string} settingPath
 * @param {unknown} value
 */
async function setGlobalSetting(stand, settingPath, value) {
    const result = /** @type {Array<{error?: unknown}>} */ (await backend(stand, 'modifySettings', {
        targets: [{action: 'set', path: settingPath, value, scope: 'global', optionsContext: null}],
        source: 'flib-youtube-stand',
    }));
    expect(result[0].error).toBeUndefined();
}

/**
 * @param {Stand} stand
 * @param {string} settingPath
 * @param {unknown} value
 */
async function setProfileSetting(stand, settingPath, value) {
    const result = /** @type {Array<{error?: unknown}>} */ (await backend(stand, 'modifySettings', {
        targets: [{action: 'set', path: settingPath, value, scope: 'profile', optionsContext: {current: true}}],
        source: 'flib-youtube-stand',
    }));
    expect(result[0].error).toBeUndefined();
}

/**
 * @param {Stand} stand
 * @returns {Promise<string[]>}
 */
async function registeredFlibScripts(stand) {
    return await stand.ext.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id).filter((id) => id.startsWith('flib-youtube')));
}

/**
 * Beta on through the backend (the same setting the settings toggle writes) and waits for the
 * three content scripts.
 * @param {Stand} stand
 */
async function enableBeta(stand) {
    await setGlobalSetting(stand, 'global.flibYoutube.beta', true);
    await expect.poll(() => registeredFlibScripts(stand)).toHaveLength(3);
}

/**
 * Opens settings.html with the advanced items shown, scrolled to the beta toggle.
 * @param {Stand} stand
 * @returns {Promise<import('@playwright/test').Page>}
 */
async function openSettingsGeneral(stand) {
    const page = await stand.context.newPage();
    await page.goto(`chrome-extension://${stand.extensionId}/settings.html#general`);
    const advanced = page.locator('#advanced-checkbox');
    await expect(advanced).toBeAttached();
    if (!(await advanced.isChecked())) {
        await page.locator('label.advanced-toggle').click();
        await expect(advanced).toBeChecked();
    }
    // The checkbox itself is 0x0 (a styled toggle); its settings item is what a user sees.
    const item = page.locator('.settings-item', {has: page.locator('input[data-setting="global.flibYoutube.beta"]')});
    await item.scrollIntoViewIfNeeded();
    await expect(item).toBeVisible();
    await expect(page.locator('.settings-item', {has: page.locator('select[data-setting="global.flibYoutube.theme"]')})).toBeVisible();
    return page;
}

/**
 * The beta toggle of settings.html, clicked like a user.
 * @param {import('@playwright/test').Page} settings
 * @param {boolean} on
 */
async function setBetaInSettings(settings, on) {
    const input = settings.locator('input[data-setting="global.flibYoutube.beta"]');
    if ((await input.isChecked()) !== on) {
        await settings.locator('label.toggle', {has: input}).click();
    }
    await expect(input).toBeChecked({checked: on});
}

/**
 * Opens the stand at `url` and waits for its <video> to play.
 * @param {Stand} stand
 * @param {string} [url]
 * @returns {Promise<import('@playwright/test').Page>}
 */
async function openStand(stand, url = WATCH_A) {
    const page = await stand.context.newPage();
    await page.goto(url);
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => window.stand.video.currentTime), {message: 'the stand clip plays'}).toBeGreaterThan(0.2);
    return page;
}

/**
 * The action popup opened as a tab while the stand tab is the active one: the popup asks
 * chrome.tabs.query({active, currentWindow}) for the tab it acts on.
 * @param {Stand} stand
 * @param {import('@playwright/test').Page} standPage
 * @returns {Promise<import('@playwright/test').Page>}
 */
async function openActionPopup(stand, standPage) {
    const popup = await stand.context.newPage();
    await popup.goto('about:blank');
    await standPage.bringToFront();
    await popup.goto(`chrome-extension://${stand.extensionId}/action-popup.html`);
    await expect(popup.locator('.action-flib-youtube')).toBeVisible();
    return popup;
}

/**
 * Clicks «C» in the action popup and waits for its pressed state.
 * @param {import('@playwright/test').Page} popup
 * @param {boolean} pressed
 */
async function clickC(popup, pressed) {
    const button = popup.locator('.action-flib-youtube');
    await expect(button).toBeEnabled();
    await button.click();
    await expect(button).toHaveAttribute('aria-pressed', String(pressed));
}

/**
 * Panel visible: through the backend (same action as «C»), waits for the panel and its subtitles.
 * @param {Stand} stand
 * @param {import('@playwright/test').Page} page
 */
async function showPanel(stand, page) {
    await backend(stand, 'flibYoutubeSetPanelVisible', {visible: true});
    await waitPanelReady(page);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} [cueCount]
 */
async function waitPanelReady(page, cueCount = 14) {
    await expect(page.locator('#flib-yt-root')).toHaveCount(1);
    await expect(page.locator('#flib-yt-root [data-cue]')).toHaveCount(cueCount);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{t: number, paused: boolean, ad: boolean}>}
 */
async function video(page) {
    return await page.evaluate(() => ({t: window.stand.video.currentTime, paused: window.stand.video.paused, ad: window.stand.adShowing}));
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @returns {Promise<{x: number, y: number, width: number, height: number}>}
 */
async function rect(page, selector) {
    const r = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (el === null) { return null; }
        const b = el.getBoundingClientRect();
        return {x: b.x, y: b.y, width: b.width, height: b.height};
    }, selector);
    if (r === null) { throw new Error(`no ${selector}`); }
    return r;
}

/**
 * The copied `.player-stage` lies exactly on #movie_player (±1 px).
 * @param {import('@playwright/test').Page} page
 * @param {string} where
 */
async function expectStageOnPlayer(page, where) {
    await expect.poll(async () => {
        const stage = await rect(page, '#flib-yt-root .player-stage');
        const player = await rect(page, '#movie_player');
        return Math.max(Math.abs(stage.x - player.x), Math.abs(stage.y - player.y), Math.abs(stage.width - player.width), Math.abs(stage.height - player.height));
    }, {message: `stage over the video (${where})`}).toBeLessThanOrEqual(1);
    // The EN plate is drawn inside the video rectangle.
    const plate = await rect(page, '#flib-yt-root .subtitle-overlay--l2');
    const player = await rect(page, '#movie_player');
    expect(plate.x).toBeGreaterThanOrEqual(player.x - 1);
    expect(plate.y).toBeGreaterThanOrEqual(player.y - 1);
    expect(plate.x + plate.width).toBeLessThanOrEqual(player.x + player.width + 1);
    expect(plate.y + plate.height).toBeLessThanOrEqual(player.y + player.height + 1);
}

/**
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>}
 */
async function plateEn(page) {
    return ((await page.locator('#flib-yt-root .subtitle-l2').textContent()) ?? '').trim();
}

/**
 * The EN text of the cue the stand's clock is in (fixture), or null between cues.
 * @param {string} videoId
 * @param {number} t
 * @returns {string|null}
 */
function cueTextAt(videoId, t) {
    const bundle = /** @type {{cues: Array<{start: number, end: number, text_en: string}>}} */ (fixture(`subtitles-${videoId}.json`));
    return bundle.cues.find((c) => t >= c.start && t < c.end)?.text_en ?? null;
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 */
async function shot(page, name) {
    if (SHOTS === null) { return; }
    fs.mkdirSync(SHOTS, {recursive: true});
    await page.screenshot({path: path.join(SHOTS, name)});
}

/**
 * The action popup at its own size (it is a tab here, sized like the browser's popup).
 * @param {import('@playwright/test').Page} popup
 * @param {string} name
 */
async function shotPopup(popup, name) {
    if (SHOTS === null) { return; }
    // About the size Chrome gives the action popup.
    await popup.setViewportSize({width: 460, height: 340});
    await popup.waitForTimeout(200);
    await shot(popup, name);
}

/**
 * Seeks the stand through YouTube's own API (as a viewer using YouTube's controls).
 * @param {import('@playwright/test').Page} page
 * @param {number} t
 */
async function seekYoutube(page, t) {
    await page.evaluate((s) => { window.stand.player.seekTo(s, true); }, t);
}

/**
 * Clicks the SUB box of cue `index` (sets A-B to the cue and seeks to A), turns the A-B loop on and
 * sets the pause at B to `pause` seconds with the copy's own mini-scale.
 * @param {import('@playwright/test').Page} page
 * @param {number} index
 * @param {number} pause
 * @returns {Promise<{start: number, end: number}>} The cue (fixture).
 */
async function setupLoop(page, index, pause) {
    const cue = /** @type {{cues: Array<{start: number, end: number}>}} */ (fixture(`subtitles-${VIDEO_A}.json`)).cues[index];
    await page.locator('#flib-yt-root [data-cue]').nth(index).click();
    const bar = page.locator('#flib-yt-root [data-workspace-bar]');
    await expect(bar).toHaveAttribute('data-ab-start', String(cue.start));
    await expect(bar).toHaveAttribute('data-ab-end', String(cue.end));
    const loop = page.locator('#flib-yt-root [data-loop-active]');
    if ((await loop.getAttribute('data-loop-active')) !== 'true') { await loop.click(); }
    await expect(loop).toHaveAttribute('data-loop-active', 'true');
    if (pause > 0) {
        await page.locator('#flib-yt-root [data-testid="pause-at-b-add"]').click();
        const scale = page.locator('#flib-yt-root [data-testid="pause-at-b-scale"]');
        const box = await scale.boundingBox();
        if (box === null) { throw new Error('no pause scale'); }
        // 96 px = 2.5 s, snapped to 0.1 s.
        await page.mouse.click(box.x + Math.min((box.width * pause) / 2.5, box.width - 0.5), box.y + box.height / 2);
        await expect(page.locator('#flib-yt-root [data-testid="pause-at-b-pill"]')).toContainText(pause.toFixed(1));
    }
    return cue;
}

// ---------------------------------------------------------------------------------------------

test.describe('flib-youtube offline stand', () => {
    test('beta off: none of the panel code is loaded', async ({stand}) => {
        expect(await registeredFlibScripts(stand)).toEqual([]);
        const page = await openStand(stand);
        await page.waitForTimeout(3000);
        expect(await page.locator('#flib-yt-root, #flib-yt-portals').count()).toBe(0);
        // No page-world bridge: it would post snapshots at least once a second.
        expect(await page.evaluate(() => window.standBridgeLog.snapshots)).toBe(0);
        // No panel.css: its rules for the portal node would apply to a probe node.
        const probe = await page.evaluate(() => {
            const el = document.createElement('div');
            el.id = 'flib-yt-portals';
            document.body.append(el);
            const z = getComputedStyle(el).zIndex;
            el.remove();
            return z;
        });
        expect(probe).toBe('auto');
        // No request for the panel's files (fonts, assets) or through the panel's proxy.
        expect(stand.net.filter((r) => /lib\/flib-youtube\/|youtube\.com\/fonts\/|flib\.club/.test(r.url))).toEqual([]);
        // The popup has no «C» button.
        const popup = await stand.context.newPage();
        await popup.goto(`chrome-extension://${stand.extensionId}/action-popup.html`);
        await popup.waitForTimeout(500);
        await expect(popup.locator('.action-flib-youtube')).toBeHidden();
    });

    test('beta and «C» on: panel under the player, plates over the video, the line follows the video', async ({stand}) => {
        await enableBeta(stand);
        const page = await openStand(stand);
        // Positive control for the beta-off probes: the bridge posts, panel.css applies.
        await expect.poll(() => page.evaluate(() => window.standBridgeLog.snapshots)).toBeGreaterThan(0);
        expect(await page.locator('#flib-yt-root').count()).toBe(0); // «C» not pressed yet
        const popup = await openActionPopup(stand, page);
        await clickC(popup, true);
        await shotPopup(popup, '09-popup-C.png');
        await page.bringToFront();
        await waitPanelReady(page);

        // Under the player: the container is the node right before #below, below #movie_player.
        expect(await page.evaluate(() => document.getElementById('below')?.previousElementSibling?.id)).toBe('flib-yt-root');
        const player = await rect(page, '#movie_player');
        const container = await rect(page, '#flib-yt-root');
        expect(container.y).toBeGreaterThanOrEqual(player.y + player.height - 1);
        expect(Math.abs(container.x - player.x)).toBeLessThanOrEqual(1);
        expect(Math.abs(container.width - player.width)).toBeLessThanOrEqual(1);
        await expectStageOnPlayer(page, 'default');

        // The EN plate shows the fixture cue of the current time, and changes as the video plays.
        await seekYoutube(page, 3);
        await expect.poll(() => plateEn(page)).toBe(cueTextAt(VIDEO_A, 3));
        await expect.poll(() => plateEn(page), {timeout: 8000}).toBe(cueTextAt(VIDEO_A, 4.5));
        // EN + RU.
        await page.locator('#flib-yt-root [data-testid="sub-mode-enru"]').click();
        await seekYoutube(page, 16.5);
        await expect.poll(() => plateEn(page)).toBe(cueTextAt(VIDEO_A, 16.5));
        await expect(page.locator('#flib-yt-root .subtitle-l1')).toHaveText(/Я бы сейчас не отказался от чашки кофе/);
        await page.waitForTimeout(400);
        await shot(page, '01-default.png');

        // EN only, then hidden.
        await page.locator('#flib-yt-root [data-testid="sub-mode-en"]').click();
        await expect(page.locator('#flib-yt-root .subtitle-l1')).toHaveCount(0);
        await shot(page, '04-en-only.png');
        await page.locator('#flib-yt-root [data-testid="sub-mode-off"]').click();
        await expect(page.locator('#flib-yt-root .subtitle-l2')).toHaveCount(0);
        await shot(page, '05-hidden-subs.png');

        // «C» again: the panel goes, the plates go.
        await openActionPopup(stand, page).then(async (p) => { await clickC(p, false); });
        await expect(page.locator('#flib-yt-root')).toHaveCount(0);
    });

    test('stage stays over the video: default, theater, resize, scroll (Review Focus 1)', async ({stand}) => {
        await enableBeta(stand);
        const page = await openStand(stand);
        await showPanel(stand, page);
        await seekYoutube(page, 16.5);
        await expect.poll(() => plateEn(page)).toBe(cueTextAt(VIDEO_A, 16.5));
        await page.evaluate(() => { window.stand.player.pauseVideo(); });
        await expectStageOnPlayer(page, 'default');
        await page.evaluate(() => { window.stand.setTheater(true); });
        await expectStageOnPlayer(page, 'theater');
        await page.waitForTimeout(300);
        await shot(page, '02-theater.png');
        await page.setViewportSize({width: 1100, height: 760});
        await expectStageOnPlayer(page, 'theater, window resized');
        await page.evaluate(() => { window.scrollBy(0, 240); });
        await expectStageOnPlayer(page, 'theater, scrolled');
        await page.evaluate(() => { window.stand.setTheater(false); });
        await expectStageOnPlayer(page, 'default again, scrolled');
        await page.setViewportSize(VIEWPORT);
        await page.evaluate(() => { window.scrollTo(0, 120); });
        await expectStageOnPlayer(page, 'default, resized back, scrolled');
    });

    test('A-B with a 1 s pause at B: pause, countdown, then on from A', async ({stand}) => {
        await enableBeta(stand);
        const page = await openStand(stand);
        await showPanel(stand, page);
        await page.locator('#flib-yt-root [data-testid="sub-mode-enru"]').click();
        const cue = await setupLoop(page, 4, 1); // 16 .. 19.2
        await page.evaluate(() => { window.scrollTo(0, 120); }); // video and timeline in one screenshot
        const t0 = await page.evaluate(() => window.performance.now());
        // At B the copy pauses YouTube's player and puts it back on A; the countdown runs on the stage.
        await expect(page.locator('#flib-yt-root [data-testid="countdown-ring"]')).toBeVisible({timeout: 8000});
        const atB = await video(page);
        expect(atB.paused).toBe(true);
        expect(Math.abs(atB.t - cue.start)).toBeLessThan(0.3);
        await shot(page, '03-ab-loop.png');
        const pausedAt = await page.evaluate((t) => window.stand.log.stateChanges.filter((s) => s.t > t && s.s === 2).map((s) => s.t), t0);
        expect(pausedAt).toHaveLength(1);
        // Then playing again from A, about 1 s after the pause.
        await expect.poll(async () => (await video(page)).paused, {timeout: 4000}).toBe(false);
        const resumedAt = await page.evaluate((t) => window.stand.log.stateChanges.filter((s) => s.t > t && s.s === 1).map((s) => s.t), pausedAt[0]);
        expect(resumedAt.length).toBeGreaterThan(0);
        expect(resumedAt[0] - pausedAt[0]).toBeGreaterThan(800);
        expect(resumedAt[0] - pausedAt[0]).toBeLessThan(2500);
        const after = await video(page);
        expect(after.t).toBeGreaterThanOrEqual(cue.start - 0.1);
        expect(after.t).toBeLessThan(cue.start + 1.5);
        await expect(page.locator('#flib-yt-root [data-testid="countdown-ring"]')).toHaveCount(0);
    });

    test('hiding with «C» during the A-B countdown: the video does not resume (Review Focus 2)', async ({stand}) => {
        await enableBeta(stand);
        const page = await openStand(stand);
        await showPanel(stand, page);
        await setupLoop(page, 4, 2.5);
        const popup = await openActionPopup(stand, page);
        await expect(popup.locator('.action-flib-youtube')).toHaveAttribute('aria-pressed', 'true');
        // Wait for the countdown, then «C» in the popup.
        await expect(page.locator('#flib-yt-root [data-testid="countdown-ring"]')).toBeVisible({timeout: 8000});
        expect((await video(page)).paused).toBe(true);
        await clickC(popup, false);
        await expect(page.locator('#flib-yt-root')).toHaveCount(0);
        const hiddenAt = await page.evaluate(() => window.performance.now());
        const before = await video(page);
        await page.waitForTimeout(4000);
        const now = await video(page);
        expect(now.paused).toBe(true);
        expect(Math.abs(now.t - before.t)).toBeLessThan(0.05);
        const late = await page.evaluate((t0) => ({
            play: window.stand.log.stateChanges.filter((s) => s.t > t0 && s.s === 1).length,
            seeks: window.stand.log.seekTo.filter((s) => s.t > t0).length,
            commands: window.standBridgeLog.commands.filter((c) => c.t > t0 && c.name !== 'restoreCaptions' && c.name !== 'requestSnapshot').map((c) => c.name),
        }), hiddenAt);
        expect(late).toEqual({play: 0, seeks: 0, commands: []});
    });

    test('Space pauses once and resumes once; YouTube does not get the key while the panel is shown', async ({stand}) => {
        await enableBeta(stand);
        const page = await openStand(stand);
        await showPanel(stand, page);
        await page.locator('#below h1').click(); // focus in the page, not in a field
        const keysBefore = await page.evaluate(() => window.standKeyLog.length);
        const paused0 = (await video(page)).paused;
        expect(paused0).toBe(false);
        await page.keyboard.press('Space');
        await expect.poll(async () => (await video(page)).paused).toBe(true);
        await page.waitForTimeout(400);
        expect((await video(page)).paused).toBe(true); // once, not toggled back
        await page.keyboard.press('Space');
        await expect.poll(async () => (await video(page)).paused).toBe(false);
        await page.waitForTimeout(400);
        expect((await video(page)).paused).toBe(false);
        expect(await page.evaluate(() => window.standKeyLog.length)).toBe(keysBefore);
    });

    test('page key listener (window, capture, first in <head>) gets no panel keys while shown, all keys when hidden', async ({stand}) => {
        await enableBeta(stand);
        const page = await openStand(stand);
        await showPanel(stand, page);
        await page.locator('#below h1').click();
        const start = await page.evaluate(() => window.standKeyLog.length);
        for (const key of ['Space', 'ArrowLeft', 'ArrowRight', 'b', 'Space']) {
            await page.keyboard.press(key);
            await page.waitForTimeout(150);
        }
        const shownKeys = await page.evaluate((n) => window.standKeyLog.slice(n).map((k) => k.key), start);
        expect(shownKeys).toEqual([]);
        // A key that is not the panel's still reaches the page.
        await page.keyboard.press('q');
        expect(await page.evaluate((n) => window.standKeyLog.slice(n).map((k) => k.key), start)).toEqual(['q']);

        await backend(stand, 'flibYoutubeSetPanelVisible', {visible: false});
        await expect(page.locator('#flib-yt-root')).toHaveCount(0);
        const mid = await page.evaluate(() => window.standKeyLog.length);
        const wasPaused = (await video(page)).paused;
        await page.keyboard.press('Space');
        await page.keyboard.press('ArrowLeft');
        await page.keyboard.press('b');
        expect(await page.evaluate((n) => window.standKeyLog.slice(n).map((k) => k.key), mid)).toEqual([' ', 'ArrowLeft', 'b']);
        await expect.poll(async () => (await video(page)).paused).toBe(!wasPaused); // YouTube's Space toggled
    });

    test('ads: pre-roll does not seed the timeline; mid-roll freezes line, loop and playhead; all goes on after', async ({stand}) => {
        await enableBeta(stand);
        await backend(stand, 'flibYoutubeSetPanelVisible', {visible: true});
        const page = await stand.context.newPage();
        await page.goto(`${WATCH_A}&stand_preroll=2`);
        await page.bringToFront();
        await expect.poll(() => page.evaluate(() => window.stand.adShowing)).toBe(true);
        await expect(page.locator('#flib-yt-root')).toHaveCount(1);
        // During the pre-roll (two 5 s ads): the panel never shows the ad's 0:05 as the length.
        /** @type {Array<{time: string|null, adTime: number}>} */
        const during = [];
        for (;;) {
            const sample = await page.evaluate(() => ({
                ad: window.stand.adShowing,
                adTime: window.stand.video.currentTime,
                time: document.querySelector('#flib-yt-root [data-testid="time"]')?.textContent?.trim() ?? null,
            }));
            if (!sample.ad) { break; }
            during.push({time: sample.time, adTime: sample.adTime});
            await page.waitForTimeout(250);
        }
        expect(during.length).toBeGreaterThan(20);
        // The panel shows the ad's length (0:05) nowhere, and never runs its clock.
        expect(during.filter((x) => x.time !== null && /0:0[1-5]\s*$/.test(x.time))).toEqual([]);
        expect(during.filter((x) => x.time !== null && !/^0:00\s*\/\s*(0:00|1:00)$/.test(x.time))).toEqual([]);
        // After the ad: the timeline is the clip's 1:00.
        await waitPanelReady(page);
        await expect(page.locator('#flib-yt-root [data-testid="time"]')).toHaveText(/1:00/);

        // Mid-roll inside an A-B loop near B.
        const cue = await setupLoop(page, 4, 0); // 16 .. 19.2
        await expect.poll(async () => (await video(page)).t, {timeout: 6000}).toBeGreaterThan(cue.start + 1.8);
        const line = await plateEn(page);
        expect(line).toBe(cueTextAt(VIDEO_A, 17.5));
        const head = page.locator('#flib-yt-root [data-handle="pos"]').first();
        const t0 = await page.evaluate(() => window.performance.now());
        await page.evaluate(() => { window.stand.midroll(); });
        await expect.poll(() => page.evaluate(() => window.stand.adShowing)).toBe(true);
        await page.waitForTimeout(600);
        const headBox0 = await head.boundingBox();
        const time0 = await page.locator('#flib-yt-root [data-testid="time"]').textContent();
        /** @type {Array<{line: string, x: number|undefined, time: string|null}>} */
        const samples = [];
        while (await page.evaluate(() => window.stand.adShowing)) {
            samples.push({line: await plateEn(page), x: (await head.boundingBox())?.x, time: await page.locator('#flib-yt-root [data-testid="time"]').textContent()});
            await page.waitForTimeout(300);
        }
        expect(samples.length).toBeGreaterThan(6);
        for (const s of samples) {
            expect(s.line).toBe(line);
            expect(Math.abs((s.x ?? 0) - (headBox0?.x ?? 0))).toBeLessThan(1.5);
            expect(s.time).toBe(time0);
        }
        // No seek into the ad (the loop did not jump while the ad's clock ran past "B").
        expect(await page.evaluate((t) => window.stand.log.seekTo.filter((s) => s.t > t && s.ad), t0)).toEqual([]);
        // After the ad: the video resumes where it was, the loop takes it back to A at B.
        await expect.poll(async () => (await video(page)).ad).toBe(false);
        await expect.poll(async () => (await video(page)).t, {timeout: 6000}).toBeLessThan(cue.start + 1);
        expect(await page.evaluate((t) => window.stand.log.seekTo.filter((s) => s.t > t && !s.ad).length, t0)).toBeGreaterThan(0);
    });

    test('another video without a reload: the panel of the new video', async ({stand}) => {
        await enableBeta(stand);
        const page = await openStand(stand);
        await showPanel(stand, page);
        await page.evaluate((id) => { window.stand.navigate(id); }, VIDEO_B);
        await waitPanelReady(page, 7);
        await expect(page.locator('#flib-yt-root')).toHaveCount(1);
        await expect(page.locator('#flib-yt-root [data-testid="time"]')).toHaveText(/0:40/);
        await seekYoutube(page, 5);
        await expect.poll(() => plateEn(page)).toBe(cueTextAt(VIDEO_B, 5));
        expect(stand.net.some((r) => r.url === `https://flib.club/api/youtube/subtitles?v=${VIDEO_B}`)).toBe(true);
    });

    test('word click opens the site word window; Shift + hover opens the Yomitan card', async ({stand}) => {
        // A tiny EN-RU dictionary for Yomitan, imported through the settings page.
        await setProfileSetting(stand, 'general.language', 'en');
        const settings = await stand.context.newPage();
        await settings.goto(`chrome-extension://${stand.extensionId}/settings.html`);
        // The import input works once the settings controllers are up (the count is filled in).
        await expect(settings.locator('id=dictionaries')).toContainText('0 installed');
        const archive = await createDictionaryArchiveData(path.join(STAND, 'dictionary'), 'Stand EN-RU');
        await settings.locator('input[id="dictionary-import-file-input"]').setInputFiles({name: 'stand-en-ru.zip', mimeType: 'application/x-zip', buffer: Buffer.from(archive)});
        await expect(settings.locator('id=dictionaries')).toContainText('1 installed', {timeout: 60 * 1000});
        await settings.close();

        await enableBeta(stand);
        const page = await openStand(stand);
        await showPanel(stand, page);
        await seekYoutube(page, 16.5);
        await page.evaluate(() => { window.stand.player.pauseVideo(); });
        await expect.poll(() => plateEn(page)).toBe(cueTextAt(VIDEO_A, 16.5));
        const word = page.locator('#flib-yt-root .subtitle-l2 [data-word]', {hasText: /^coffee/});
        await expect(word).toBeVisible();

        // Plain click: the site's word window, examples from /api/examples.
        await word.click();
        await expect(page.locator('[data-testid="word-popup"]')).toBeVisible();
        await expect(page.locator('[data-testid="word-popup-word"]')).toHaveText(/coffee/i);
        await shot(page, '11-word-popup.png');
        // The window is on top: its header (the word, ✕) is not under the plates (soft: reported, the test goes on).
        const onTop = await page.locator('[data-testid="word-popup"] .wp-header').evaluate((el) => {
            const b = el.getBoundingClientRect();
            const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
            return hit === null ? 'nothing' : (el.contains(hit) ? 'header' : `${hit.tagName.toLowerCase()}.${hit.className}`);
        });
        expect.soft(onTop, 'word window header above the plates').toBe('header');
        // «Примеры YouTube»: the site's examples panel, from /api/examples.
        await page.locator('[data-testid="word-popup"] .wp-btn').first().click();
        await expect.poll(() => stand.net.some((r) => r.url.startsWith('https://flib.club/api/examples?word=coffee&kind=youtube'))).toBe(true);
        await expect(page.locator('#flib-yt-root [data-testid="vcp-card-youtube"]').first()).toBeVisible();
        await expect(page.locator('[data-testid="word-popup"]')).toHaveCount(0);

        // Shift + hover: Yomitan's own popup with the dictionary entry.
        const box = await word.boundingBox();
        if (box === null) { throw new Error('no word box'); }
        await page.mouse.move(box.x - 30, box.y - 40);
        await page.keyboard.down('Shift');
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, {steps: 4});
        const frame = page.locator('iframe.yomitan-popup');
        await expect(frame).toBeVisible({timeout: 10000});
        await expect(page.frameLocator('iframe.yomitan-popup').locator('body')).toContainText('кофе', {timeout: 10000});
        await page.keyboard.up('Shift');
        await shot(page, '12-yomitan-card.png');
    });

    test('theme in settings: the open panel is repainted (indigo, mono)', async ({stand}) => {
        await enableBeta(stand);
        const page = await openStand(stand);
        await showPanel(stand, page);
        await seekYoutube(page, 16.5);
        await page.locator('#flib-yt-root [data-testid="sub-mode-enru"]').click();
        // The copy reads the theme from its storage (chrome.storage.local `flibYt:flib:dusk-variant`,
        // written by the background); a failed preload leaves it on the default.
        expect.soft(stand.consoleErrors.filter((e) => e.includes('[flib-youtube]')), 'errors of the layer').toEqual([]);
        // PlayerPage.tsx:1664 always renders data-dusk="site"; the variant is the inline CSS variables
        // usePlayerTheme puts on .player-page (--surface: site #16140f, indigo #120F22, mono #15171B).
        const surface = () => page.evaluate(() => /** @type {HTMLElement|null} */ (document.querySelector('#flib-yt-root .player-page'))?.style.getPropertyValue('--surface'));
        expect((await surface())?.toLowerCase()).toBe('#16140f'); // site
        const settings = await openSettingsGeneral(stand);
        const select = settings.locator('select[data-setting="global.flibYoutube.theme"]');
        await select.selectOption('indigo');
        // The background's half: the variant is in chrome.storage.local under the layer's key.
        await expect.poll(() => stand.ext.evaluate(async () => (await chrome.storage.local.get('flibYt:flib:dusk-variant'))['flibYt:flib:dusk-variant'])).toBe('indigo');
        await page.bringToFront();
        // Soft: the screenshots for the owner are taken either way.
        const soft = expect.configure({soft: true});
        await soft.poll(async () => (await surface())?.toLowerCase(), {message: 'indigo --surface on the open panel'}).toBe('#120f22');
        await waitPanelReady(page);
        await page.waitForTimeout(500);
        await shot(page, '07-theme-indigo.png');
        await settings.bringToFront();
        await select.selectOption('mono');
        await page.bringToFront();
        await soft.poll(async () => (await surface())?.toLowerCase(), {message: 'mono --surface on the open panel'}).toBe('#15171b');
        await waitPanelReady(page);
        await page.waitForTimeout(500);
        await shot(page, '08-theme-mono.png');
    });

    test('translate menu (right-click a plate) is above the plates and its item works', async ({stand}) => {
        await enableBeta(stand);
        const page = await openStand(stand);
        await showPanel(stand, page);
        await page.locator('#flib-yt-root [data-testid="sub-mode-enru"]').click();
        // Cue 11 has no RU in the corpus (fixture): the menu asks the site to translate it.
        await seekYoutube(page, 46);
        await page.evaluate(() => { window.stand.player.pauseVideo(); });
        await expect.poll(() => plateEn(page)).toBe(cueTextAt(VIDEO_A, 46));
        const plate = await rect(page, '#flib-yt-root .subtitle-l2');
        await page.mouse.click(plate.x + plate.width / 2, plate.y + plate.height / 2, {button: 'right'});
        const item = page.locator('[data-testid="translate-menu-item"]');
        await expect(item).toBeVisible();
        const top = await item.evaluate((el) => {
            const b = el.getBoundingClientRect();
            const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
            return hit !== null && (hit === el || el.contains(hit));
        });
        expect(top).toBe(true);
        await shot(page, '06-translate-menu.png');
        await item.click();
        await expect(page.locator('[data-testid="translate-menu"]')).toHaveCount(0);
        await expect.poll(() => stand.net.filter((r) => r.url === 'https://flib.club/api/youtube/subtitles/translate' && r.method === 'POST').length).toBe(1);
        await expect(page.locator('#flib-yt-root .subtitle-l1')).toHaveText(/Попробуйте тот же приём со своим любимым сериалом/);
    });

    test('F twice: YouTube full screen once in, once out; ⛶ of the panel: full screen of #movie_player', async ({stand}) => {
        await enableBeta(stand);
        const page = await openStand(stand);
        await showPanel(stand, page);
        await page.evaluate(() => {
            window.standFsLog = [];
            document.addEventListener('fullscreenchange', () => { window.standFsLog.push(document.fullscreenElement?.id ?? null); });
        });
        await page.locator('#below h1').click();
        await page.keyboard.press('f');
        await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id ?? null)).toBe('movie_player');
        await page.waitForTimeout(500);
        await page.keyboard.press('f');
        await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id ?? null)).toBe(null);
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => window.standFsLog)).toEqual(['movie_player', null]);
        expect(await page.evaluate(() => window.stand.log.requestFullscreen)).toBe(1);

        const history0 = await page.evaluate(() => history.length);
        await page.locator('#flib-yt-root [data-testid="cb-fs-btn"]').click();
        await expect.poll(() => page.evaluate(() => document.fullscreenElement?.id ?? null)).toBe('movie_player');
        expect(await page.evaluate(() => history.length)).toBe(history0);
        await page.evaluate(() => document.exitFullscreen());
    });

    test('fonts come from the extension; no font request fails', async ({stand}) => {
        await enableBeta(stand);
        const page = await openStand(stand);
        await showPanel(stand, page);
        await page.evaluate(() => document.fonts.ready);
        await page.waitForTimeout(1000);
        const faces = await page.evaluate(() => [...document.fonts].map((f) => ({family: f.family.replace(/"/g, ''), status: f.status})));
        // Fonts are chrome-extension:// loads; a font URL on the network (e.g. youtube.com/fonts/…) is a miss.
        expect(stand.net.filter((r) => /\.(woff2?|ttf|otf)(\?|$)/.test(r.url)).map((r) => `${r.status} ${r.url}`), 'font requests on the network').toEqual([]);
        expect(faces.filter((f) => f.status === 'error'), 'font faces in error').toEqual([]);
        for (const family of ['IBM Plex Sans', 'Inter Tight']) {
            expect(faces.filter((f) => f.family === family && f.status === 'loaded').length, `${family} loaded`).toBeGreaterThan(0);
        }
    });

    test('beta switched on in settings while the stand is open: one panel, one key gate, one bridge', async ({stand}) => {
        const page = await openStand(stand);
        const settings = await openSettingsGeneral(stand);
        await setBetaInSettings(settings, true);
        await expect.poll(() => registeredFlibScripts(stand)).toHaveLength(3);
        await page.waitForTimeout(500);
        await shot(settings, '10-settings-beta.png');
        await page.bringToFront();
        await expect.poll(() => page.evaluate(() => window.standBridgeLog.snapshots)).toBeGreaterThan(0);
        await showPanel(stand, page);

        /** @param {string} when */
        const expectSingle = async (when) => {
            expect(await page.locator('#flib-yt-root').count(), `one panel (${when})`).toBe(1);
            expect(await page.locator('#flib-yt-portals').count(), `one portal node (${when})`).toBe(1);
            // One bridge: exactly one `event` message per player state change.
            const t0 = await page.evaluate(() => window.performance.now());
            await page.evaluate(() => { window.stand.player.pauseVideo(); });
            await page.waitForTimeout(500);
            const pausedEvents = await page.evaluate((t) => window.standBridgeLog.events.filter((e) => e.t > t && e.name === 'stateChange' && e.data === 2).length, t0);
            expect(pausedEvents, `one bridge (${when})`).toBe(1);
            await page.evaluate(() => { window.stand.player.playVideo(); });
            await expect.poll(async () => (await video(page)).paused).toBe(false);
            // One key gate: Space toggles exactly once (two gates would replay it twice).
            await page.locator('#below h1').click();
            await page.keyboard.press('Space');
            await page.waitForTimeout(600);
            expect((await video(page)).paused, `one key gate (${when})`).toBe(true);
            await page.keyboard.press('Space');
            await page.waitForTimeout(600);
            expect((await video(page)).paused).toBe(false);
        };
        await expectSingle('injected into the open tab');
        // Reload: the registered scripts run, the injected ones are gone.
        await page.reload();
        await expect.poll(() => page.evaluate(() => window.stand.video.currentTime)).toBeGreaterThan(0.2);
        await waitPanelReady(page);
        await expectSingle('after a reload');
    });

    test('<html lang> and history.length stay as YouTube set them', async ({stand}) => {
        await enableBeta(stand);
        const page = await openStand(stand);
        const lang0 = await page.evaluate(() => document.documentElement.getAttribute('lang'));
        const history0 = await page.evaluate(() => history.length);
        await showPanel(stand, page);
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => document.documentElement.getAttribute('lang'))).toBe(lang0);
        await setupLoop(page, 2, 0.5);
        await page.locator('#flib-yt-root [data-testid="sub-mode-enru"]').click();
        await page.locator('#flib-yt-root [data-testid="sub-mode-en"]').click();
        await page.locator('#flib-yt-root [data-cue]').nth(6).click();
        await page.locator('#flib-yt-root [data-testid="gear-btn"]').click();
        await page.keyboard.press('Escape');
        await page.locator('#below h1').click();
        await page.keyboard.press('Space');
        await page.keyboard.press('Space');
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => document.documentElement.getAttribute('lang'))).toBe(lang0);
        expect(await page.evaluate(() => history.length)).toBe(history0);
        expect(new URL(page.url()).pathname + new URL(page.url()).search).toBe(`/watch?v=${VIDEO_A}`);
    });
});
