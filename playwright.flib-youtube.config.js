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

// @ts-check
import {defineConfig} from '@playwright/test';

/*
 * Offline YouTube stand (spec §6 item 6): the real extension (./ext, after `npm run build:libs`)
 * in Chromium on a local copy of YouTube's watch-page markup. Run without network:
 *
 *   PW_DISABLE_TS_ESM=1 bwrap --dev-bind / / --unshare-net npx playwright test -c playwright.flib-youtube.config.js
 *
 * PW_DISABLE_TS_ESM=1: on Node 26 the ESM loader hook of Playwright 1.49 (module.register) hangs the
 * runner before it lists a test (the same for playwright.config.js); the stand is plain JS and needs
 * no transform. It must be in the environment: the runner decides before it reads this file.
 * Browser: Playwright's own Chromium if installed, else the newest ~/.cache/ms-playwright/chromium-*
 * (FLIB_STAND_CHROMIUM=<path> to choose). FLIB_STAND_SHOTS=<dir> saves the owner's screenshots.
 *
 * Networking: the spec serves https://www.youtube.com/* (test/flib-youtube/stand) and
 * https://flib.club/* (fixtures) from Playwright `context.route`, and aborts every other http(s)
 * request. The flib.club requests come from the extension's service worker; Playwright routes
 * service-worker requests only with this switch (Chromium), so it is set before any browser starts.
 */
process.env.PW_EXPERIMENTAL_SERVICE_WORKER_NETWORK_EVENTS = '1';

export default defineConfig({
    testDir: './test/playwright',
    testMatch: /flib-youtube\.spec\.js$/,
    timeout: 120 * 1000,
    expect: {timeout: 10 * 1000},
    fullyParallel: false,
    workers: 1,
    retries: 0,
    reporter: [['list']],
    outputDir: 'test-results/flib-youtube',
    use: {
        actionTimeout: 15 * 1000,
        trace: 'off',
    },
});
