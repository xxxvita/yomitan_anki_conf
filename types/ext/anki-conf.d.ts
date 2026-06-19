/*
 * Copyright (C) 2024-2025  Yomitan Authors
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

export type AnalyzeSource = 'lemma' | 'regex' | 'empty' | 'unknown';

export type AnalyzeEntry = {
    word: string;
    lemma: string;
    forms: string[];
    kind: string;
};

export type AnalyzeTextResult = {
    newWords: string[];
    source: AnalyzeSource;
    entries: AnalyzeEntry[];
};

// ---------- Video-examples / clips ----------
//
// The clip types below use snake_case property names on purpose: they pass
// through verbatim from the Anki-Conf wire response into the `data` field
// on the Yomitan Card Type note (see docs/prd/video-examples.md, Stage 3).
// Converting to camelCase only to re-convert back when writing to Anki adds
// two mapping layers with no upside.

export type ClipsFilters = {
    cefr?: string[];
    difficulty_min?: number;
    difficulty_max?: number;
    kinds?: string[];
    has_passive?: boolean | null;
    has_conditional?: boolean | null;
    has_phrasal_verb?: boolean | null;
    has_modal?: boolean | null;
};

export type ClipsStartParams = {
    words: string[];
    selection?: string;
    forms?: string;
    exclude_puzzle_ids?: string[];
    filters?: ClipsFilters;
};

export type ClipsStartResult = {
    job_id: string;
    words: string[];
    started_at: string;
};

export type ClipsRecutHandle = {
    token: string;
    order_index: number;
};

export type ClipStatus = {
    clip_id: string;
    order_index: number;
    clip_url: string;
    subtitle_url: string | null;
    thumb_data_url?: string;
    subtitle_text: string;
    duration_ms: number;
    year?: number;
    cefr?: string;
    difficulty?: number;
    recut: ClipsRecutHandle;
};

export type ClipsWordStage = 'searching' | 'rendering' | 'saving' | 'done' | 'empty';

/**
 * Known reasons Core may send for `word_empty`. The wire type is `string` so
 * unknown values from a newer Core version don't break parsing; UI should
 * fall back to a generic "no examples" message on anything unrecognised.
 *
 * Known values: `no_examples`, `render_failed`, `needs_connection`,
 * `transient_error`.
 */
export type ClipsEmptyReason = string;

export type ClipsWordStatus = {
    word: string;
    lemma: string;
    forms: string[];
    stage: ClipsWordStage;
    empty_reason?: ClipsEmptyReason;
    clips: ClipStatus[];
};

export type ClipsJobState = 'pending' | 'partial' | 'ready' | 'failed';

export type ClipsStatusResult = {
    job_id: string;
    state: ClipsJobState;
    started_at: string;
    updated_at: string;
    words: ClipsWordStatus[];
};

export type ClipsPersistParams = {
    job_id: string;
    clips: {clip_id: string}[];
};

export type ClipsPersistedItem = {
    clip_id: string;
    cache_key: string;
    clip_url: string;
    subtitle_url: string | null;
    duration_ms: number;
    subtitle_text: string;
    recut: ClipsRecutHandle;
    meta: {
        lemma: string;
        forms: string[];
        year?: number;
        cefr?: string;
        difficulty?: number;
    };
};

/** Known persist-failure codes: `source_gone`, `copy_failed`. */
export type ClipsPersistFailure = {
    clip_id: string;
    error: string;
};

export type ClipsPersistResult = {
    persisted: ClipsPersistedItem[];
    failed: ClipsPersistFailure[];
};

export type ClipsRecutParams = {
    recut: ClipsRecutHandle;
};

export type ClipsRecutResult = {
    persisted: ClipsPersistedItem;
};

export type ClipsStatsResult = {
    cache_bytes: number;
    cache_count: number;
    scratch_bytes: number;
    scratch_count: number;
    oldest_at?: string;
    newest_at?: string;
    service?: string;
    version?: string;
};

export type ClipsPruneScope = 'scratch' | 'unreferenced';

export type ClipsPruneParams = {
    scope: ClipsPruneScope;
    keep_cache_keys?: string[];
};

export type ClipsPruneResult = {
    removed: number;
    freed_bytes: number;
};
