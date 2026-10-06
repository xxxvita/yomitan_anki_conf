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

/** Один пример из POST /v1/examples (контракт шлюза 2026-07-15). */
export type ExampleItem = {
    source: string;
    ref: string;
    start_ms: number | null;
    end_ms: number | null;
    text_en: string | null;
    text_ru: string | null;
    thumbnail_url: string | null;
};

export type ExamplesResponse = {
    word: string;
    items: ExampleItem[];
    /** `not_in_corpus` | `no_usable_examples` | `kind_not_served` | … ; null, если items непуст. */
    empty_reason: string | null;
};

export type ExamplesOptions = {
    /** `youtube` | `film` | `any`. */
    kind?: string;
    /** Зажимается в 1..10. */
    limit?: number;
    signal?: AbortSignal;
};

export type WordExampleSub = {
    rel_start_ms: number;
    rel_end_ms: number;
    text: string;
};

export type WordExampleClip = {
    order_index: number;
    subs: WordExampleSub[];
    trim_duration_sec: number | null;
    year: number | null;
    cefr: string | null;
    difficulty: number | string | null;
};

export type WordExampleSet = {
    word: string;
    lemma: string;
    /** Токен для POST /v1/puzzle_movies/clips; null — клипов нет. */
    token: string | null;
    clips: WordExampleClip[];
    matched_forms: string[];
    empty_reason: string | null;
};

export type WordExamplesResult = {
    results: WordExampleSet[];
};

export type WordExamplesJobOptions = {
    perWord?: number;
    onPhase?: (phase: string) => void;
    signal?: AbortSignal;
    budgetMs?: number;
};

export type ClipStatus = 'queued' | 'downloading' | 'ready' | 'failed';

export type ClipSource = {
    title?: string;
    title_ru?: string;
    year?: number;
    media_type?: number;
    season?: number;
    episode?: number;
    imdb_id?: string;
    /** Только `https://www.imdb.com/title/…`. */
    imdb_url?: string;
};

export type RedeemedClip = {
    clip_id: string;
    status: ClipStatus;
    order_index: number | null;
    error?: string;
};

export type RedeemResult = {
    batch_id: string;
    clips: RedeemedClip[];
};

export type ClipInfo = {
    clip_id: string;
    status: ClipStatus;
    duration_sec: number | null;
    lead_trim_sec: number | null;
    size_bytes: number | null;
    download_url: string | null;
    error?: string;
    source?: ClipSource;
};

export type ClipData = {
    data: ArrayBuffer;
    contentType: string;
};

/** Клип для передачи по сообщениям: байты base64, а не массивом чисел. */
export type ClipDataMessage = {
    contentType: string;
    byteLength: number;
    base64: string;
};

export type GatewayClientDetails = {
    fetch: typeof fetch;
    /** Сырое `flibService.gatewayUrl`; клиент сам приводит его к базе. */
    getBase: () => string;
    /** Сырое `flibService.personalKey`. */
    getKey: () => string;
    /** Только для тестов. */
    now?: () => number;
    /** Только для тестов. */
    sleep?: (ms: number, signal?: AbortSignal) => Promise<void>;
    /** Потолок одного запроса, по умолчанию 20 с. */
    requestTimeoutMs?: number;
    /** Потолок загрузки клипа, по умолчанию 60 с. */
    clipTimeoutMs?: number;
    /** Только для тестов; по умолчанию createTimeoutSignal (AbortSignal.timeout или запасной). */
    timeoutSignal?: (ms: number) => AbortSignal;
};
