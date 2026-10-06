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

import type {ClipInfo, ExampleItem, WordExampleSub, WordExamplesResult} from 'flib-gateway';

/** Ответ flibGatewayStatus: есть ли годный ключ. Сам ключ наружу не уходит. */
export type GatewayStatus = {
    hasKey: boolean;
    base: string;
};

/** Ответ flibGatewayWordExamplesPoll. Ошибка задания приходит исключением с кодом. */
export type WordExamplesPollResult =
    | {done: false, phase: string | null}
    | {done: true, result: WordExamplesResult};

export type WordExamplesStartResult = {
    jobId: string;
};

/** Секция YouTube панели. */
export type YouTubeSectionResult = {
    items: ExampleItem[];
    emptyReason: string | null;
};

export type FilmClipStatus = 'queued' | 'downloading' | 'ready' | 'failed';

/** Клип нарезки: данные задания word_examples + id после погашения токена. */
export type FilmClip = {
    clipId: string;
    orderIndex: number | null;
    status: FilmClipStatus;
    error: string | null;
    subs: WordExampleSub[];
    trimDurationSec: number | null;
    year: number | null;
    cefr: string | null;
};

export type FilmsSectionResult = {
    clips: FilmClip[];
    emptyReason: string | null;
};

export type FilmsPhase = 'searching' | 'cutting';

export type ClipMedia = {
    info: ClipInfo;
    blob: Blob;
};
