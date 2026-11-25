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

import type * as AnkiTemplatesInternal from './anki-templates-internal';
import type {ClipOutputSettings, ClipWindow, EncoderSupport} from 'clip-transcode';
import type * as Settings from './settings';

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
    /**
     * Taken from the panel when the save was pressed; it stays usable when the panel is gone. A promise while only the
     * video metadata is missing: it rejects with a `GatewayClipWaitError` after 20 s, and nobody has to await it.
     */
    media: GatewayFilmMedia | Promise<GatewayFilmMedia>;
};

export type GatewaySelectedYouTube = {
    /**
     * The panel's card key (from a monotonic per-panel counter, unique across the plain, the known-words and the
     * «Понятные» sets): what `clearSelection` unticks after a successful save.
     */
    key: string;
    ref: string;
    startMs: number | null;
    /** End of the spoken line; null — unknown. */
    endMs: number | null;
    text: string | null;
    /** Highlight forms at the time of selection. */
    words: string[];
};

export type GatewaySelectedMedia = {
    films: GatewaySelectedFilm[];
    youtube: GatewaySelectedYouTube[];
};

export type CaptureOptions = {
    /** Ends the waits for metadata (the save is over, or the page is being unloaded). */
    signal?: AbortSignal;
};

export type FlibMediaProgress = {
    stage: 'waiting' | 'transcoding' | 'storing';
    index: number;
    total: number;
};

export type FlibMediaApi = {
    flibAnkiModelHasField(modelName: string, fieldName: string, noFallback?: boolean, server?: string): Promise<boolean>;
    flibStoreAnkiMedia(fileName: string, base64: string, noFallback?: boolean, server?: string): Promise<{fileName: string}>;
};

export type FlibMediaDeps = {
    probeEncoderSupport?: () => Promise<EncoderSupport>;
    transcodeClipToWebm?: (mp4: Blob, options: {window: ClipWindow, settings: ClipOutputSettings, signal?: AbortSignal}) => Promise<Uint8Array>;
};

export type PrepareFlibMediaFieldOptions = {
    selection: GatewaySelectedMedia;
    modelName: string;
    api: FlibMediaApi;
    signal: AbortSignal;
    isFirefox: boolean;
    onProgress?: (progress: FlibMediaProgress) => void;
    /** Of a phrase: the address of `flibPhrasePrepare`; only a running Anki there answers. Undefined — a word. */
    phraseServer?: string;
    /** Test seams; default to the real transcoder. */
    deps?: FlibMediaDeps;
};

/**
 * The options a save with ticked videos or of a phrase works with, taken when it was pressed: such a save goes on after a new lookup,
 * which may bring the sentence, the profile and the tags of another word. Each field names its reader in DisplayAnki.
 */
export type GatewaySaveSettings = {
    /** `_createNote` (the sentence, URL and query of the lookup). */
    noteContext: AnkiTemplatesInternal.Context | null;
    /** `_createNote`, `_getDictionaryEntryDetails`, `_getOverwrittenNote`, `_updateSaveButtonForDuplicateBehavior`. */
    cardFormats: Settings.AnkiCardFormat[];
    /** `_createNote`. */
    fieldTemplates: string | null;
    /** `_createNote`, `_savePhraseNote`. */
    noteTags: string[];
    /** `_createNote`. */
    duplicateScope: Settings.AnkiDuplicateScope;
    /** `_createNote`. */
    duplicateScopeCheckAllModels: boolean;
    /** `_createNote`. */
    resultOutputMode: Settings.ResultOutputMode;
    /** `_createNote`. */
    glossaryLayoutMode: Settings.GlossaryLayoutMode;
    /** `_createNote`. */
    compactTags: boolean;
    /** `_createNote` (dictionary styles). */
    dictionaries: Settings.DictionariesOptions;
    /** `_getDictionaryEntryDetails`. */
    checkForDuplicates: boolean;
    /** `_getDictionaryEntryDetails`. */
    additionalInfo: boolean;
    /** `_applyExtraTagsToNote`, the «Сохранено в Anki · теги» line and `_savePhraseNote`. */
    extraTags: string[];
    /** `_decideEnrichment`. */
    flibService: Settings.FlibServiceOptions | undefined;
    /** `_addNewAnkiNote`. */
    suspendNewCards: boolean;
    /** `_addNewAnkiNote`. */
    forceSync: boolean;
};

/** What the gateway panel had ticked when the save was pressed (taken before any await of the save). */
export type GatewaySaveSnapshot = {
    /** Shows the save's status line; its ticks are cleared after a saved note, while it lives. null — the save ended. */
    panel: import('../../ext/js/display/gateway-examples-panel.js').GatewayExamplesPanel | null;
    /** Read by `_applySelectedGatewayMediaToNote` and `_createPhraseMediaHtml`; emptied when the save ends (it holds the film Blobs). */
    selection: GatewaySelectedMedia;
    /** Aborted by `_onPageHide` (the workers stop) and when the save ends (nothing waits for metadata any more). */
    abortController: AbortController;
    /** Read by `_saveAnkiNoteClaimed` and what it calls. */
    settings: GatewaySaveSettings;
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
