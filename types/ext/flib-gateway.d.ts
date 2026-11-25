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

import type {FlibSecretsIdentity} from './flib-secret-store';

/** Один пример из POST /v1/examples (контракт шлюза 2026-07-15). */
/** Обогащение заметки при «+» (flib-card-enricher.js). */
export type EnrichCards = {
    reverse: boolean;
    phrases: boolean;
};

export type EnrichRequest = {
    noteId: number;
    userTags: string[];
    cards?: Partial<EnrichCards>;
};

export type EnrichStep = {
    status: 'done' | 'skipped' | 'failed';
    code?: string;
};

export type EnrichReport = {
    enrich: EnrichStep;
    audio: EnrichStep;
    reverse: EnrichStep;
    phrases: EnrichStep;
    /** Первая ошибка озвучки за вызов (например tts_quota_exhausted), иначе null. */
    speechCode: string | null;
};

/** Озвучка: mp3 в base64 и признак попадания в кэш шлюза. */
export type SpeechResult = {
    base64: string;
    cached: boolean;
};

/** Ответ кнопки «?»: одно из десяти канонических имён части речи. */
export type PosResult = {
    pos: string;
};

/** Ответ «?» с переводом: каждая половина может отсутствовать, но не обе сразу. */
export type PosTranslationResult = {
    pos: string | null;
    translation: string | null;
};

/** Ответ «только перевод фразы». */
export type TranslationResult = {
    translation: string;
};

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

export type ExamplesBatchTarget = {
    text: string;
    mode: 'lemma' | 'quote';
};

export type ExamplesBatchItem = ExampleItem & {
    title: string | null;
    channel: string | null;
    fragment: {start_ms: number | null, end_ms: number | null} | null;
    /** 0..1, только при known_source === 'route'. */
    known_share: number | null;
};

export type ExamplesBatchResult = {
    index: number;
    text: string;
    mode: string;
    items: ExamplesBatchItem[];
    empty_reason: string | null;
};

export type ExamplesBatchResponse = {
    known_source: 'route' | 'pending' | 'none';
    partial: boolean;
    results: ExamplesBatchResult[];
};

export type UnderstandableHit = {
    from_ms: number;
    to_ms: number;
    text_en: string;
};

export type UnderstandableItem = {
    video_id: string;
    title: string | null;
    channel_id: string | null;
    duration_s: number | null;
    /** 0..1 или null. */
    coverage: number | null;
    target_hits: UnderstandableHit[];
    target_hits_unavailable: boolean;
};

export type UnderstandableResult = {
    index: number;
    text: string;
    mode: string;
    items: UnderstandableItem[];
    empty_reason: string | null;
};

export type UnderstandableJob = {
    status: string;
    partial: boolean;
    errorCode: string | null;
    results: UnderstandableResult[] | null;
};

export type UnderstandableStartResult = {
    jobId: string;
    pollAfterMs: number;
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

export type ClipStatus = 'queued' | 'downloading' | 'concatenating' | 'ready' | 'failed';

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

/** Право ключа из GET /v1/me/access (flib-key-access.js). */
export type KeyRight = {
    id: string;
    usable: boolean;
    /** Без срока; `validTo` тогда — дата-заглушка шлюза, с ней не сравнивать. */
    permanent: boolean;
    /** `YYYY-MM-DD` (UTC) или null. */
    validFrom: string | null;
    /** `YYYY-MM-DD` (UTC, включительно) или null. */
    validTo: string | null;
};

/** Расход за месяц в целых единицах шлюза (микродоллары, символы, секунды). */
export type KeyUsage = {
    used: number;
    /** null только у `unlimited`; 0 — лимит, а не его отсутствие. */
    limit: number | null;
    unlimited: boolean;
};

export type KeyUsageShare = {
    spentPercent: number;
    leftPercent: number;
    /** Потрачено больше нуля, но меньше процента. */
    underOne: boolean;
    exhausted: boolean;
};

/** Права и расход ключа. `null` у поля — «нет данных», если не сказано иное. */
export type KeyAccess = {
    keyPrefix: string | null;
    /** null — срока нет; `''` — срок есть, но не читается (не «бессрочно»). */
    expiresAt: string | null;
    demo: boolean;
    rights: KeyRight[];
    gpt: KeyUsage | null;
    tts: KeyUsage | null;
    stt: KeyUsage | null;
    resetsAt: string | null;
    gptTokens: {input: number, output: number} | null;
    /** `limit: null` — без лимита. */
    examplesQuota: {used: number, limit: number | null} | null;
};

/** С каким ключом и адресом получен ответ flibKeyAccess. То же лежит в `data` его ошибок. */
export type KeyAccessIdentity = FlibSecretsIdentity & {
    /** Не те, что страница прочитала перед вызовом, или сменились за время запроса. */
    changed: boolean;
};

export type KeyAccessAnswer = KeyAccessIdentity & {
    access: KeyAccess;
};

export type GatewayClientDetails = {
    fetch: typeof fetch;
    /** Сырой адрес шлюза (flib-secrets); клиент сам приводит его к базе. */
    getBase: () => string | Promise<string>;
    /** Сырой личный ключ (flib-secrets). */
    getKey: () => string | Promise<string>;
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

export type ExternalEventsResult = {
    kind: 'ok';
    accepted: number;
    duplicates: number;
    rejectedIds: string[];
} | {
    kind: 'http';
    status: number;
    error: string | null;
    routeId: string | null;
    retryAfterSec: number | null;
};
