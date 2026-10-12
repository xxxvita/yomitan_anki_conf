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

/** Окно нарезки во времени исходного MP4-файла, секунды. Инвариант: 0 <= startSec < endSec. */
export type ClipWindow = {
    startSec: number;
    endSec: number;
};

export type ClipWindowInput = {
    /** `ClipInfo.lead_trim_sec`: начало реплики в файле. */
    leadTrimSec: number | null | undefined;
    /** `clip.trimDurationSec`: длина окна. */
    trimDurationSec: number | null | undefined;
    /** Длительность загруженного файла (`HTMLMediaElement.duration`); NaN/0/Infinity/неизвестна — ошибка `invalid-window`. */
    mediaDurationSec: number | null | undefined;
};

export type ClipVideoCodec = 'vp9' | 'vp8';

/** Параметры выходного WebM (D-4). */
export type ClipOutputSettings = {
    codec: ClipVideoCodec;
    width: number;
    height: number;
    /** Видео, бит/с. */
    videoBitrate: number;
    /** Opus, бит/с. */
    audioBitrate: number;
};

export type ChooseOutputSettingsInput = {
    /** Отображаемые размеры исходника (`videoWidth`/`videoHeight`). */
    sourceWidth: number;
    sourceHeight: number;
    vp9Supported: boolean;
    vp8Supported: boolean;
    /** false — Opus-кодировщика нет, сохранять нечего (edge case 2). */
    opusSupported: boolean;
    isFirefox: boolean;
};

export type EncoderSupport = {
    vp9Supported: boolean;
    vp8Supported: boolean;
    opusSupported: boolean;
};

export type ClipTranscodeErrorCode =
    | 'encoder-unsupported'
    | 'invalid-source-size'
    | 'invalid-window'
    | 'invalid-input'
    | 'conversion-invalid'
    | 'transcode-failed'
    | 'empty-output'
    | 'worker-error'
    | 'timeout';

/** Сообщение main → worker. Воркер одноразовый: одно сообщение, один ответ. */
export type ClipTranscodeWorkerRequest = {
    mp4: Blob | ArrayBuffer;
    window: ClipWindow;
    settings: ClipOutputSettings;
};

export type ClipTranscodeWorkerError = {
    code: ClipTranscodeErrorCode;
    message: string;
};

/** Подмножество экспорта ext/lib/mediabunny.js (типы из пакета mediabunny), нужное ядру воркера (подменяется в тестах). */
export type ClipTranscodeMediabunny = Pick<
    typeof import('mediabunny'),
    'BlobSource' | 'BufferSource' | 'BufferTarget' | 'Conversion' | 'Input' | 'MP4' | 'Output' | 'Quality' | 'WebMOutputFormat'
>;

/** Отправка ответа воркера (`self.postMessage` с transfer-списком). */
export type ClipTranscodeWorkerPost = (response: ClipTranscodeWorkerResponse, transfer: Transferable[]) => void;

/** Сообщение worker → main. `webm` передаётся как transferable. */
export type ClipTranscodeWorkerResponse =
    | {ok: true, webm: ArrayBuffer}
    | {ok: false, error: ClipTranscodeWorkerError};

/** Минимальный контракт Worker, нужный клиенту (подменяется в тестах). */
export type ClipTranscodeWorkerLike = {
    postMessage(message: ClipTranscodeWorkerRequest): void;
    terminate(): void;
    addEventListener(type: 'message' | 'error' | 'messageerror', listener: (event: Event) => void): void;
};

export type TranscodeClipOptions = {
    window: ClipWindow;
    settings: ClipOutputSettings;
    signal?: AbortSignal;
    /** По умолчанию max(30000, 4000 * длина окна в секундах) (edge case 2). */
    timeoutMs?: number;
    /** Фабрика воркера; по умолчанию модульный `clip-transcode-worker.js`. */
    createWorker?: () => ClipTranscodeWorkerLike;
};
