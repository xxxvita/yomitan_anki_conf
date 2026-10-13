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

import type {ClipOutputSettings, ClipWindow, EncoderSupport} from 'clip-transcode';

export type GatewayClipWaitErrorCode = 'timeout' | 'failed' | 'missing' | 'aborted';

/** A ticked film clip, ready to be transcoded (everything the save path needs from the panel). */
export type GatewayFilmMedia = {
    clipId: string;
    /** The gateway MP4 (not trimmed). */
    blob: Blob;
    leadTrimSec: number | null;
    trimDurationSec: number | null;
    /** From `loadedmetadata`: square-pixel, post-rotation size and the file duration. */
    videoWidth: number;
    videoHeight: number;
    durationSec: number;
    /** Window-relative WebVTT with `<c.hl>` cues. */
    vttText: string;
    title: string | null;
    year: number | null;
    imdbUrl: string | null;
};

export type GatewaySelectedFilm = {
    clipId: string;
};

export type GatewaySelectedYouTube = {
    /** The panel's card key (position in the section): what `clearSelection` unticks after a successful save. */
    key: string;
    ref: string;
    startMs: number | null;
    text: string | null;
    /** Highlight forms at the time of selection. */
    words: string[];
};

export type GatewaySelectedMedia = {
    films: GatewaySelectedFilm[];
    youtube: GatewaySelectedYouTube[];
};

export type WaitForFilmOptions = {
    timeoutMs: number;
    signal?: AbortSignal;
};

export type FlibMediaProgress = {
    stage: 'waiting' | 'transcoding' | 'storing';
    index: number;
    total: number;
};

export type FlibMediaApi = {
    flibAnkiModelHasField(modelName: string, fieldName: string): Promise<boolean>;
    flibStoreAnkiMedia(fileName: string, base64: string): Promise<{fileName: string}>;
};

export type FlibMediaDeps = {
    probeEncoderSupport?: () => Promise<EncoderSupport>;
    transcodeClipToWebm?: (mp4: Blob, options: {window: ClipWindow, settings: ClipOutputSettings, signal?: AbortSignal}) => Promise<Uint8Array>;
};

export type PrepareFlibMediaFieldOptions = {
    selection: GatewaySelectedMedia;
    modelName: string;
    api: FlibMediaApi;
    waitForFilm: (clipId: string, options: WaitForFilmOptions) => Promise<GatewayFilmMedia>;
    signal: AbortSignal;
    isFirefox: boolean;
    onProgress?: (progress: FlibMediaProgress) => void;
    /** Test seams; default to the real transcoder. */
    deps?: FlibMediaDeps;
};

/** What the gateway panel had ticked when «+» was pressed (taken before any await of the save). */
export type GatewaySaveSnapshot = {
    /** The entry the save was started on; detached after a new lookup. */
    entry: HTMLElement;
    panel: import('../../ext/js/display/gateway-examples-panel.js').GatewayExamplesPanel;
    selection: GatewaySelectedMedia;
    signal: AbortSignal;
};

/**
 * One save's line in the gateway panel's visible status (`beginSaveStatus`). Several saves (card formats) may run
 * at once; each owns a handle. Calls after the panel is destroyed, or after `finish`, are ignored.
 */
export type GatewaySaveStatus = {
    /** Show the current phase (plain text). */
    update(text: string): void;
    /** The save ended; `saved` — the note was added/updated (shows «Сохранено» briefly when no other save is busy). */
    finish(saved: boolean): void;
};
