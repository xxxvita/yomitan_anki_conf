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
 * Shared by the offline YouTube stand (flib-youtube.spec.js) and the DOM parity check
 * (flib-youtube-parity.spec.js): the browser with the real extension, the routing that serves
 * https://www.youtube.com/* from test/flib-youtube/stand and https://flib.club/* from its fixtures
 * (every other http(s) request is aborted), and the backend helpers. Run instructions:
 * playwright.flib-youtube.config.js.
 */

import {chromium, expect} from '@playwright/test';
import fs from 'fs';
import os from 'os';
import path from 'path';
import {fileURLToPath} from 'url';
import {parseJson} from '../../dev/json.js';

// Routes service-worker requests (flib.club from the extension's background); before any browser starts.
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

const dirname = path.dirname(fileURLToPath(import.meta.url));

export const root = path.join(dirname, '..', '..');

export const STAND = path.join(root, 'test', 'flib-youtube', 'stand');

export const VIDEO_A = 'stndClipA01';

export const VIDEO_B = 'stndClipB02';

export const WATCH_A = `https://www.youtube.com/watch?v=${VIDEO_A}`;

export const VIEWPORT = {width: 1440, height: 900};

/** @typedef {{url: string, method: string, status: number, body?: string}} NetRecord */

/**
 * @returns {string|undefined}
 */
export function findChromium() {
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
export function fixture(name) {
    return parseJson(fs.readFileSync(path.join(STAND, 'fixtures', name), 'utf8'));
}

/**
 * Serves a stand file, with byte ranges (the <video> seeks with Range requests).
 * @param {import('@playwright/test').Route} route
 * @param {string} file
 * @param {string} contentType
 * @returns {Promise<number>}
 */
export async function serveFile(route, file, contentType) {
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
export async function serveYoutube(route, url) {
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
export async function serveFlib(route, url) {
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

/**
 * Starts Chromium with the extension and the stand's routing; the caller closes `context`.
 * @returns {Promise<Stand>}
 */
export async function launchStand() {
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
    return {context, extensionId, net, ext, consoleErrors};
}

/**
 * Calls the backend's api-map from an extension page.
 * @param {Stand} stand
 * @param {string} action
 * @param {unknown} [params]
 * @returns {Promise<unknown>}
 */
export async function backend(stand, action, params) {
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
export async function setGlobalSetting(stand, settingPath, value) {
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
export async function setProfileSetting(stand, settingPath, value) {
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
export async function registeredFlibScripts(stand) {
    return await stand.ext.evaluate(async () => (await chrome.scripting.getRegisteredContentScripts()).map((s) => s.id).filter((id) => id.startsWith('flib-youtube')));
}

/**
 * Beta on through the backend (the same setting the settings toggle writes) and waits for the
 * three content scripts.
 * @param {Stand} stand
 */
export async function enableBeta(stand) {
    await setGlobalSetting(stand, 'global.flibYoutube.beta', true);
    await expect.poll(() => registeredFlibScripts(stand)).toHaveLength(3);
}

/**
 * Opens the stand at `url` and waits for its <video> to play.
 * @param {Stand} stand
 * @param {string} [url]
 * @returns {Promise<import('@playwright/test').Page>}
 */
export async function openStand(stand, url = WATCH_A) {
    const page = await stand.context.newPage();
    await page.goto(url);
    await page.bringToFront();
    await expect.poll(() => page.evaluate(() => window.stand.video.currentTime), {message: 'the stand clip plays'}).toBeGreaterThan(0.2);
    return page;
}

/**
 * Panel visible: through the backend (same action as «C»), waits for the panel and its subtitles.
 * @param {Stand} stand
 * @param {import('@playwright/test').Page} page
 */
export async function showPanel(stand, page) {
    await backend(stand, 'flibYoutubeSetPanelVisible', {visible: true});
    await waitPanelReady(page);
}

/**
 * @param {import('@playwright/test').Page} page
 * @param {number} [cueCount]
 */
export async function waitPanelReady(page, cueCount = 14) {
    await expect(page.locator('#flib-yt-root')).toHaveCount(1);
    await expect(page.locator('#flib-yt-root [data-cue]')).toHaveCount(cueCount);
}
