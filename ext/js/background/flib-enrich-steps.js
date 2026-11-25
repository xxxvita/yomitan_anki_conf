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

import {ExtensionError} from '../core/extension-error.js';

/*
 * Общее у обогащения слова (flib-card-enricher.js) и фразы (flib-phrase-enricher.js).
 */

/** Сколько всего даётся одному обогащению. */
export const ENRICH_BUDGET_MS = 90_000;

/** Пауза перед повтором временного сбоя шлюза. */
export const ENRICH_RETRY_DELAY_MS = 1500;

/** Как часто продлевается жизнь воркера, пока идёт обогащение. */
export const ENRICH_KEEP_ALIVE_MS = 20_000;

/**
 * @param {unknown} error
 * @returns {string}
 */
export function getEnrichErrorCode(error) {
    if (error instanceof ExtensionError) {
        const data = /** @type {{code?: unknown}} */ (error.data ?? {});
        if (typeof data.code === 'string' && data.code !== '') { return data.code; }
    }
    return 'anki_failed';
}

/**
 * Один повтор после временного сбоя, как у Flibooster (#387); квоту и ключ не повторяем.
 * Только слово: перевод фразы не повторяется, оборванный ответ мог быть уже оплачен.
 * @template [T=unknown]
 * @param {() => Promise<T>} request Запрос к ChatGPT.
 * @param {{signal: AbortSignal, retryDelayMs: number}} details
 * @returns {Promise<T>}
 */
export async function requestChatWithRetry(request, {signal, retryDelayMs}) {
    try {
        return await request();
    } catch (e) {
        // Повтор только после 5xx и обрыва: таймаут клиента и 4xx не повторяем (I5).
        if (getEnrichErrorCode(e) !== 'flib_service_unavailable' || signal.aborted) { throw e; }
        await new Promise((resolve) => { setTimeout(resolve, retryDelayMs); });
        return await request();
    }
}

/**
 * Озвучка в файл Anki. Ошибка запоминается один раз в speechCode и
 * пробрасывается; остальные клипы всё равно пробуются (кэш бесплатен).
 * @param {{speechCode: ?string}} report
 * @param {string} fileName
 * @param {{synthesize: () => Promise<{base64: string}>, store: (fileName: string, base64: string) => Promise<unknown>}} details
 * @returns {Promise<string>} значение поля [sound:…]
 */
export async function speakToAnkiMedia(report, fileName, {synthesize, store}) {
    try {
        const {base64} = await synthesize();
        await store(fileName, base64);
        return `[sound:${fileName}]`;
    } catch (e) {
        if (report.speechCode === null) { report.speechCode = getEnrichErrorCode(e); }
        throw e;
    }
}

/**
 * AnkiConnect updateNoteFields принимает {id, fields}; тип Note в клиенте шире.
 * @param {{updateNoteFields: (note: import('anki').Note) => Promise<unknown>}} anki
 * @param {number} id
 * @param {Record<string, string>} fields
 * @returns {Promise<void>}
 */
export async function updateEnrichedFields(anki, id, fields) {
    await anki.updateNoteFields(/** @type {import('anki').Note} */ (/** @type {unknown} */ ({id, fields})));
}

/**
 * ⚠️ fetch не продлевает жизнь воркера MV3; без пинга API расширения он может
 * уснуть посреди шагов, когда popup уже закрыт (M2).
 * @template [T=unknown]
 * @param {() => Promise<T>} task
 * @param {{keepAlive: ?(() => void), keepAliveMs: number}} details
 * @returns {Promise<T>}
 */
export async function runKeptAlive(task, {keepAlive, keepAliveMs}) {
    const timer = keepAlive === null ? null : setInterval(() => { keepAlive(); }, keepAliveMs);
    try {
        return await task();
    } finally {
        if (timer !== null) { clearInterval(timer); }
    }
}
