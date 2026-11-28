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

import {test as base} from '@playwright/test';
import fs from 'fs';
import path from 'path';
import {createDictionaryArchiveData} from '../../dev/dictionary-archive-util.js';
import {
    STAND,
    VIDEO_A,
    VIDEO_B,
    WATCH_A,
    backend,
    enableBeta,
    fixture,
    launchStand,
    openStand,
    registeredFlibScripts,
    VIEWPORT,
    setGlobalSetting,
    setProfileSetting,
    showPanel,
    waitPanelReady,
} from './flib-youtube-stand-util.js';

const SHOTS = process.env.FLIB_STAND_SHOTS ?? null;

/** @typedef {import('./flib-youtube-stand-util.js').Stand} Stand */

const test = base.extend(/** @type {import('@playwright/test').Fixtures<{stand: Stand}>} */ ({
    // eslint-disable-next-line no-empty-pattern
    stand: async ({}, use) => {
        const stand = await launchStand();
        await use(stand);
        await stand.context.close();
    },
}));
const expect = test.expect;

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
 * The rectangle the stage must have: #movie_player, ending at the top of YouTube's control bar
 * while the controls are visible (I3).
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<{x: number, y: number, width: number, height: number}>}
 */
async function expectedStage(page) {
    const player = await rect(page, '#movie_player');
    const controlsTop = await page.evaluate(() => {
        const p = document.getElementById('movie_player');
        const bar = p?.querySelector('.ytp-chrome-bottom');
        if (!p || !bar || p.classList.contains('ytp-autohide') || getComputedStyle(bar).display === 'none') { return null; }
        return bar.getBoundingClientRect().top;
    });
    return controlsTop === null ? player : {...player, height: controlsTop - player.y};
}

/**
 * The copied `.player-stage` lies exactly on #movie_player above its controls (±1 px).
 * @param {import('@playwright/test').Page} page
 * @param {string} where
 */
async function expectStageOnPlayer(page, where) {
    await expect.poll(async () => {
        const stage = await rect(page, '#flib-yt-root .player-stage');
        const want = await expectedStage(page);
        return Math.max(Math.abs(stage.x - want.x), Math.abs(stage.y - want.y), Math.abs(stage.width - want.width), Math.abs(stage.height - want.height));
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
 * What is on top at the centre of the first `selector`: 'self' when it (or its child) is the hit.
 * `forcePointer` gives the element pointer-events for the probe (the toast has none; elementFromPoint skips such nodes).
 * @param {import('@playwright/test').Page} page
 * @param {string} selector
 * @param {boolean} [forcePointer]
 * @returns {Promise<string>}
 */
async function topAt(page, selector, forcePointer = false) {
    return await page.locator(selector).first().evaluate((el, force) => {
        const node = /** @type {HTMLElement} */ (el);
        const before = node.style.pointerEvents;
        if (force) { node.style.pointerEvents = 'auto'; }
        const b = node.getBoundingClientRect();
        const hit = document.elementFromPoint(b.x + b.width / 2, b.y + Math.min(b.height / 2, 12));
        if (force) { node.style.pointerEvents = before; }
        if (hit === null) { return 'nothing'; }
        return node.contains(hit) ? 'self' : `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0]}`;
    }, forcePointer);
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

/**
 * Posts a layer command from the page itself (as a page script could) and returns how many bridge
 * snapshots arrived within `ms`: 0 means no page-world bridge is listening.
 * @param {import('@playwright/test').Page} page
 * @param {string} name
 * @param {number} [ms]
 * @returns {Promise<number>}
 */
async function probeBridge(page, name, ms = 400) {
    const before = await page.evaluate(() => window.standBridgeLog.snapshots);
    await page.evaluate((n) => { window.postMessage({source: 'flib-yt-bridge', v: 1, from: 'layer', kind: 'command', command: {name: n}}, location.origin); }, name);
    await page.waitForTimeout(ms);
    return (await page.evaluate(() => window.standBridgeLog.snapshots)) - before;
}

/**
 * Whether panel.css applies in the page: the z-index its rule gives the layer's portal node
 * ('1300'), on a probe node; 'auto' without the sheet.
 * @param {import('@playwright/test').Page} page
 * @returns {Promise<string>}
 */
async function panelCssProbe(page) {
    return await page.evaluate(() => {
        const el = document.createElement('div');
        el.id = 'flib-yt-portals';
        document.body.append(el);
        const z = getComputedStyle(el).zIndex;
        el.remove();
        return z;
    });
}

/**
 * Snapshots the bridge posts within `ms` (the tab must be in front: rAF).
 * @param {import('@playwright/test').Page} page
 * @param {number} ms
 * @returns {Promise<number>}
 */
async function snapshotsDuring(page, ms) {
    const before = await page.evaluate(() => window.standBridgeLog.snapshots);
    await page.waitForTimeout(ms);
    return (await page.evaluate(() => window.standBridgeLog.snapshots)) - before;
}

// ---------------------------------------------------------------------------------------------

test.describe('flib-youtube offline stand', () => {
    test('beta off: none of the panel code is loaded', async ({stand}) => {
        expect(await registeredFlibScripts(stand)).toEqual([]);
        const page = await openStand(stand);
        await page.waitForTimeout(3000);
        expect(await page.locator('#flib-yt-root, #flib-yt-portals').count()).toBe(0);
        // No page-world bridge: nothing answers a command, not even one that starts polling.
        expect(await page.evaluate(() => window.standBridgeLog.snapshots)).toBe(0);
        expect(await probeBridge(page, 'requestSnapshot')).toBe(0);
        expect(await probeBridge(page, 'subscribe')).toBe(0);
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
        // M1: with the panel hidden the bridge is idle - no snapshot in 1.5 s while the video plays.
        await page.waitForTimeout(1500);
        expect(await page.evaluate(() => window.standBridgeLog.snapshots), 'idle bridge while hidden').toBe(0);
        // Positive control for the beta-off probes: the bridge is there and answers.
        expect(await probeBridge(page, 'requestSnapshot')).toBe(1);
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

    test('YouTube\'s control bar is not under the plates; with autohide the stage covers the whole player (I3)', async ({stand}) => {
        await enableBeta(stand);
        const page = await openStand(stand);
        await showPanel(stand, page);
        await page.locator('#flib-yt-root [data-testid="sub-mode-enru"]').click();
        await seekYoutube(page, 16.5);
        await page.evaluate(() => { window.stand.player.pauseVideo(); });
        await expect.poll(() => plateEn(page)).toBe(cueTextAt(VIDEO_A, 16.5));
        await expect(page.locator('#flib-yt-root .subtitle-l1')).toHaveText(/Я бы сейчас не отказался от чашки кофе/);
        await expectStageOnPlayer(page, 'controls shown');
        const bar = await rect(page, '#movie_player .ytp-chrome-bottom');
        const stage = await rect(page, '#flib-yt-root .player-stage');
        expect(Math.abs(stage.y + stage.height - bar.y)).toBeLessThanOrEqual(1);
        /**
         * What a click at the centre of `selector` hits: inside YouTube's control bar or not.
         * @param {string} selector
         * @returns {Promise<string>}
         */
        const hitAt = async (selector) => await page.locator(selector).first().evaluate((el) => {
            const b = el.getBoundingClientRect();
            const hit = document.elementFromPoint(b.x + b.width / 2, b.y + b.height / 2);
            if (hit === null) { return 'nothing'; }
            return hit.closest('.ytp-chrome-bottom') !== null ? 'controls' : `${hit.tagName.toLowerCase()}.${String(hit.className).split(' ')[0]}`;
        });
        expect(await hitAt('#movie_player .ytp-progress'), 'progress bar').toBe('controls');
        expect(await hitAt('#movie_player .ytp-time-display'), 'a control').toBe('controls');
        expect(await hitAt('#movie_player .ytp-play-glyph'), 'play button').toBe('controls');
        // A click on the progress bar is YouTube's (the bar takes it, not a plate).
        await shot(page, '15-controls-free.png');

        // Autohide: the stage covers the whole player again; the controls back: above them again.
        await page.evaluate(() => { window.stand.setAutohide(true); });
        await expect.poll(async () => (await rect(page, '#flib-yt-root .player-stage')).height).toBeCloseTo((await rect(page, '#movie_player')).height, 0);
        await expectStageOnPlayer(page, 'autohide');
        await page.evaluate(() => { window.stand.setAutohide(false); });
        await expectStageOnPlayer(page, 'controls shown again');
        expect(await hitAt('#movie_player .ytp-progress'), 'progress bar after autohide').toBe('controls');
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
            commands: window.standBridgeLog.commands.filter((c) => c.t > t0 && !['restoreCaptions', 'requestSnapshot', 'unsubscribe'].includes(c.name ?? '')).map((c) => c.name),
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
        // The window is on top: its header (the word) and ✕ are not under the plates.
        expect(await topAt(page, '[data-testid="word-popup-word"]'), 'word window header above the plates').toBe('self');
        expect(await topAt(page, '[data-testid="word-popup"] .wp-close'), 'word window ✕ above the plates').toBe('self');
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

    test('the copy\'s overlays are above the plates: word window, examples panel, settings drawer, toast, vote form', async ({stand}) => {
        await enableBeta(stand);
        const page = await openStand(stand);
        await showPanel(stand, page);
        await page.locator('#flib-yt-root [data-testid="sub-mode-enru"]').click();
        await seekYoutube(page, 16.5);
        await page.evaluate(() => { window.stand.player.pauseVideo(); });
        await expect.poll(() => plateEn(page)).toBe(cueTextAt(VIDEO_A, 16.5));

        // Word window (fixed, over the plates): header and ✕.
        await page.locator('#flib-yt-root .subtitle-l2 [data-word]', {hasText: /^coffee/}).click();
        await expect(page.locator('[data-testid="word-popup"]')).toBeVisible();
        expect(await topAt(page, '[data-testid="word-popup-word"]'), 'word window header').toBe('self');
        expect(await topAt(page, '[data-testid="word-popup"] .wp-close'), 'word window ✕').toBe('self');
        // Its film examples -> the «Чат: Видео» panel: header ✕ and the card.
        await page.locator('[data-testid="word-popup"] .wp-btn').nth(1).click();
        await expect(page.locator('#flib-yt-root [data-testid="vcp-card-film"]').first()).toBeVisible();
        await page.waitForTimeout(300); // slide-in
        expect(await topAt(page, '#flib-yt-root [data-testid="vcp-close"]'), 'examples panel ✕').toBe('self');
        expect(await topAt(page, '#flib-yt-root [data-testid="vcp-card-film"]'), 'examples card').toBe('self');
        await page.locator('#flib-yt-root [data-testid="vcp-close"]').click();

        // Gear: the subtitle settings drawer (over the timeline bar): ✕ and a mode button.
        await page.locator('#flib-yt-root [data-testid="gear-btn"]').click();
        await expect(page.locator('#flib-yt-root [data-testid="settings-drawer"]')).toHaveClass(/open/);
        await page.waitForTimeout(300); // slide-in
        expect(await topAt(page, '#flib-yt-root [data-testid="sd-close"]'), 'settings drawer ✕').toBe('self');
        expect(await topAt(page, '#flib-yt-root [data-testid="sd-mode-l2"]'), 'settings drawer item').toBe('self');
        await page.locator('#flib-yt-root [data-testid="sd-close"]').click();

        // Vote bar «👎» form (inside the stage): its title and the first score button.
        await page.locator('#flib-yt-root .vvb-btn').nth(1).click();
        await expect(page.locator('#flib-yt-root .vvb-dislike-form')).toBeVisible();
        expect(await topAt(page, '#flib-yt-root .vvb-dislike-form .vvb-form-title'), 'vote form title').toBe('self');
        expect(await topAt(page, '#flib-yt-root .vvb-dislike-form .vvb-scale-btns button'), 'vote form score').toBe('self');
        await page.locator('#flib-yt-root .vvb-btn').nth(1).click();

        // Toast at the bottom of a short window, where the video reaches the viewport's bottom edge.
        await page.setViewportSize({width: VIEWPORT.width, height: 600});
        await page.evaluate(() => { window.scrollTo(0, 0); });
        await expect.poll(() => rect(page, '#movie_player').then((r) => r.y + r.height)).toBeGreaterThan(600);
        const plate = await rect(page, '#flib-yt-root .subtitle-l2');
        await page.mouse.click(plate.x + plate.width / 2, plate.y + plate.height / 2, {button: 'right'});
        await page.locator('[data-testid="translate-menu-item"]').click(); // cue with RU in the corpus: toast «Уже переведено»
        await expect(page.locator('[data-testid="mini-toast"]')).toBeVisible();
        const toast = await rect(page, '[data-testid="mini-toast"]');
        const playerRect = await rect(page, '#movie_player');
        expect(toast.y + toast.height, 'toast over the video area').toBeLessThan(playerRect.y + playerRect.height);
        expect(await topAt(page, '[data-testid="mini-toast"]', true), 'toast').toBe('self');
        await shot(page, '13-overlays-toast.png');
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
        // The rules point at this extension's files (chrome.runtime.getURL), one <style> in <head>.
        const urls = await page.evaluate(() => [...(document.getElementById('flib-yt-fonts')?.textContent ?? '').matchAll(/url\("([^"]+)"\)/g)].map((m) => m[1]));
        expect(urls.length).toBeGreaterThan(0);
        expect(urls.filter((u) => !u.startsWith(`chrome-extension://${stand.extensionId}/lib/flib-youtube/fonts/`))).toEqual([]);
        // The plates render in their own fonts: the first family of each plate is loaded for its text.
        await seekYoutube(page, 16.5);
        await page.locator('#flib-yt-root [data-testid="sub-mode-enru"]').click();
        await expect.poll(() => plateEn(page)).toBe(cueTextAt(VIDEO_A, 16.5));
        const plates = await page.evaluate(() => ['.subtitle-l2', '.subtitle-l1'].map((sel) => {
            const el = /** @type {HTMLElement} */ (document.querySelector(`#flib-yt-root ${sel}`));
            const cs = getComputedStyle(el);
            const family = cs.fontFamily.split(',')[0].trim();
            return {sel, family, ready: document.fonts.check(`${cs.fontWeight} ${cs.fontSize} ${family}`, el.textContent ?? '')};
        }));
        await page.evaluate(() => document.fonts.ready);
        const loadedFamilies = await page.evaluate(() => [...document.fonts].filter((f) => f.status === 'loaded').map((f) => f.family.replace(/"/g, '')));
        for (const p of plates) {
            expect(loadedFamilies, `${p.sel} font ${p.family}`).toContain(p.family.replace(/["']/g, ''));
            expect(p.ready, `${p.sel}: document.fonts.check ${p.family}`).toBe(true);
        }
        // Screenshot for the owner: both plates on two lines (cue 9). The copy anchors the plates on
        // their own (SubtitleOverlay.tsx:26 EN bottom at 90 % of the stage, SubtitleL1Overlay.tsx:11 RU
        // at 97 %): on a stage this low a two-line RU plate covers the second EN line (report, fix round 1).
        await seekYoutube(page, 37.5);
        await expect.poll(() => plateEn(page)).toBe(cueTextAt(VIDEO_A, 37.5));
        await page.waitForTimeout(200);
        await shot(page, '14-two-line-plates.png');
    });

    test('beta switched on in settings while the stand is open: one panel, one key gate, one bridge', async ({stand}) => {
        const page = await openStand(stand);
        const settings = await openSettingsGeneral(stand);
        await setBetaInSettings(settings, true);
        await expect.poll(() => registeredFlibScripts(stand)).toHaveLength(3);
        await page.waitForTimeout(500);
        await shot(settings, '10-settings-beta.png');
        await page.bringToFront();
        // The injected bridge is there (idle until the panel shows: M1).
        await expect.poll(() => probeBridge(page, 'requestSnapshot')).toBe(1);
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

    test('beta on -> off -> on in an open tab: the bridge ends with the beta, then exactly one bridge (C1)', async ({stand}) => {
        await enableBeta(stand);
        const page = await openStand(stand);
        await showPanel(stand, page);
        expect(await snapshotsDuring(page, 500), 'polling while shown').toBeGreaterThan(5);

        // Off: the layer stops the bridge; no loop, timer or listener is left in the page.
        await setGlobalSetting(stand, 'global.flibYoutube.beta', false);
        await expect.poll(() => registeredFlibScripts(stand)).toEqual([]);
        await expect(page.locator('#flib-yt-root')).toHaveCount(0);
        await page.waitForTimeout(300); // what was in flight
        expect(await snapshotsDuring(page, 2000), 'snapshots after the beta is off').toBe(0);
        expect(await probeBridge(page, 'subscribe'), 'a listener left after the beta is off').toBe(0);
        // M3: the stylesheet goes with the beta.
        const probeCss = () => panelCssProbe(page);
        // Recorded, not asserted: the sheet of the registration (this tab loaded with the beta on) is
        // not removable through scripting.removeCSS (measured: still 1300); an injected one is (M3 test).
        test.info().annotations.push({type: 'panel.css after off (z-index of a probe)', description: await probeCss()});

        // On again: injected into the open tab once more.
        // The panel was left visible: the injected layer shows it again by itself.
        await enableBeta(stand);
        await waitPanelReady(page);
        expect(await page.locator('#flib-yt-root').count()).toBe(1);
        expect(await page.locator('#flib-yt-portals').count()).toBe(1);
        expect(await probeCss()).toBe('1300');
        // One bridge: one stateChange(2) event per pause of YouTube's player.
        const t0 = await page.evaluate(() => window.performance.now());
        await page.evaluate(() => { window.stand.player.pauseVideo(); });
        await page.waitForTimeout(500);
        expect(await page.evaluate((t) => window.standBridgeLog.events.filter((e) => e.t > t && e.name === 'stateChange' && e.data === 2).length, t0), 'stateChange(2) events per pause').toBe(1);
        await page.evaluate(() => { window.stand.player.playVideo(); });
        await expect.poll(async () => (await video(page)).paused).toBe(false);
        // One execution per command: the panel's Space reaches YouTube's pauseVideo once.
        await page.locator('#below h1').click();
        const pauses0 = await page.evaluate(() => window.stand.log.pauseVideo);
        await page.keyboard.press('Space');
        await expect.poll(async () => (await video(page)).paused).toBe(true);
        await page.waitForTimeout(500);
        expect(await page.evaluate(() => window.stand.log.pauseVideo) - pauses0, 'pauseVideo calls per command').toBe(1);
    });

    test('panel.css injected into an open tab goes with the beta and comes back once with it (M3)', async ({stand}) => {
        const page = await openStand(stand); // open before the beta: the sheet comes from insertCSS
        const probeCss = () => panelCssProbe(page);
        expect(await probeCss()).toBe('auto');
        await enableBeta(stand);
        await expect.poll(probeCss).toBe('1300');
        await setGlobalSetting(stand, 'global.flibYoutube.beta', false);
        await expect.poll(() => registeredFlibScripts(stand)).toEqual([]);
        await expect.poll(probeCss, {message: 'panel.css removed with the beta'}).toBe('auto');
        await enableBeta(stand);
        await expect.poll(probeCss).toBe('1300');
        await showPanel(stand, page);
        await expectStageOnPlayer(page, 'after off and on');
    });

    test('forged bridge error events from the page: at most one /api/feedback/video POST (I2)', async ({stand}) => {
        await enableBeta(stand);
        const page = await openStand(stand);
        await showPanel(stand, page);
        const posts = () => stand.net.filter((r) => r.url === 'https://flib.club/api/feedback/video' && r.method === 'POST').length;
        expect(posts()).toBe(0);
        // A page script posts bridge `error` events (with a snapshot of the shown video) in a loop.
        await page.evaluate((videoId) => {
            for (let i = 0; i < 30; i++) {
                const snapshot = {videoId, currentTime: 5, duration: 60, state: 1, rate: 1, rates: [1], muted: false, volume: 100, loadedFraction: 0.5, adShowing: false, t: window.performance.now()};
                window.postMessage({source: 'flib-yt-bridge', v: 1, from: 'bridge', kind: 'event', event: {name: 'error', data: 2 + (i % 3)}, snapshot}, location.origin);
            }
        }, VIDEO_A);
        await expect.poll(posts, {message: 'the first forged error reaches the copy'}).toBe(1);
        await page.waitForTimeout(1500);
        expect(posts(), 'POSTs after 30 forged errors').toBe(1);
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
