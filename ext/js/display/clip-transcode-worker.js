/*
 * Copyright (C) 2026  Flib-club Authors (fork of Yomitan)
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

/**
 * One-shot module worker: trims a gateway MP4 (H.264/AAC) to a window and transcodes it to WebM
 * (VP9|VP8 + Opus) with mediabunny + WebCodecs. Protocol: one ClipTranscodeWorkerRequest in, one
 * ClipTranscodeWorkerResponse out (WebM bytes transferred); the client terminates the worker afterwards.
 * The logic lives in clip-transcode-core.js.
 */

import * as mediabunnyBundle from '../../lib/mediabunny.js';
import {handleTranscodeRequest} from './clip-transcode-core.js';

/**
 * ext/lib/mediabunny.js is the esbuild bundle of the `mediabunny` package; tsc infers looser types from the
 * bundled JS than the package's own .d.ts, so view it through the package types.
 */
const mediabunny = /** @type {import('clip-transcode').ClipTranscodeMediabunny} */ (/** @type {unknown} */ (mediabunnyBundle));

self.addEventListener('message', (event) => {
    /** @type {import('clip-transcode').ClipTranscodeWorkerRequest} */
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const request = event.data;
    void handleTranscodeRequest(request, mediabunny, (response, transfer) => {
        self.postMessage(response, {transfer});
    });
}, {once: true});
