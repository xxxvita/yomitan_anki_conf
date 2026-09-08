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

/** Версия формата записи. Растёт при несовместимом изменении полей. */
export const FLIB_EVENT_SCHEMA_VERSION = 1;

/**
 * ⚠️ Нормализация обязательна: заголовки статей приезжают в словарном
 * регистре, а резолв на стороне шлюза — точным совпадением, без лемматизации.
 * Без неё разъедутся и ключ дедупа, и будущий резолв.
 * @param {unknown} lemmas
 * @returns {string[]}
 */
export function normalizeLemmas(lemmas) {
    if (!Array.isArray(lemmas)) {
        return [];
    }
    /** @type {string[]} */
    const result = [];
    const seen = new Set();
    for (const raw of lemmas) {
        if (typeof raw !== 'string') {
            continue;
        }
        const lemma = raw.trim().toLowerCase();
        if (lemma.length === 0 || seen.has(lemma)) {
            continue;
        }
        seen.add(lemma);
        result.push(lemma);
    }
    return result;
}

/**
 * ⚠️ Ключ включает URL: то же слово на другой странице — ВТОРОЕ свидетельство,
 * и глушить его нельзя.
 * @param {string} url
 * @param {string} type
 * @param {string} lemma
 * @returns {string}
 */
export function dedupKey(url, type, lemma) {
    return `${url}|${type}|${lemma}`;
}

/**
 * @param {{type: import('flib-events').FlibEventType, lemmas: unknown, url: string, ts: number, eventId: string}} details
 * @returns {?import('flib-events').FlibEvent}
 */
export function buildEvent({type, lemmas, url, ts, eventId}) {
    const normalized = normalizeLemmas(lemmas);
    if (normalized.length === 0) {
        return null;
    }
    let host;
    try {
        host = new URL(url).hostname.toLowerCase().replace(/\.$/, '');
    } catch (e) {
        return null;
    }
    if (host.length === 0) {
        return null;
    }
    return {
        event_id: eventId,
        type,
        lemmas: normalized,
        host,
        url,
        ts,
        schema_version: FLIB_EVENT_SCHEMA_VERSION,
    };
}
