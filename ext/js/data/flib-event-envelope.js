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
 * ⚠️ Нормализация обязательна: заголовки статей приезжают в словарном
 * регистре, а резолв на стороне шлюза — точным совпадением, без лемматизации.
 * Без неё разъедутся и ключ дедупа, и будущий резолв.
 *
 * ⚠️ Одного `trim()` НЕ хватает: заголовок может приехать с двойным пробелом
 * («figure  out») или с неразрывным/экзотическим пробелом внутри — из вёрстки
 * страницы или из правки поля выражения руками. Такая лемма не совпадёт ни с
 * точным резолвом на шлюзе, ни с ключом дедупа своего же чистого двойника, и
 * та же пара «слово+страница» пролезет вторым событием. Поэтому ЛЮБОЙ пробег
 * пробельных (`\s` покрывает U+00A0, U+2000–U+200A, U+202F, U+205F, U+3000,
 * U+FEFF) схлопывается в один обычный пробел ДО обрезки и опускания регистра.
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
        const lemma = raw.replace(/\s+/gu, ' ').trim().toLowerCase();
        if (lemma.length === 0 || seen.has(lemma)) {
            continue;
        }
        seen.add(lemma);
        result.push(lemma);
    }
    return result;
}

export const FLIB_ROUTE_EVENT_ID_PREFIX = 'ext:yomitan:';

export const FLIB_SUBS_SOURCE = 'yomitan_web';

/** @type {Record<import('flib-events').FlibRouteEventType, true>} */
const FLIB_ROUTE_EVENT_TYPES = {
    hint_requested: true,
    translation_opened: true,
};

/**
 * @param {unknown} value
 * @returns {value is import('flib-events').FlibRouteEventType}
 */
export function isFlibRouteEventType(value) {
    return typeof value === 'string' && Object.hasOwn(FLIB_ROUTE_EVENT_TYPES, value);
}

/**
 * @param {{type: import('flib-events').FlibRouteEventType, lemmas: unknown, puzzleId: string, now: number, uuid: string}} details
 * @returns {?import('flib-events').FlibOutboxRecord}
 */
export function buildOutboxRecord({type, lemmas, puzzleId, now, uuid}) {
    if (!isFlibRouteEventType(type)) {
        return null;
    }
    if (!Number.isFinite(now) || Number.isNaN(new Date(now).getTime())) {
        return null;
    }
    const normalized = normalizeLemmas(lemmas);
    if (normalized.length === 0) {
        return null;
    }
    // Зеркало ValidPuzzleID шлюза: без C0/DEL/C1 и не длиннее 512 байт UTF-8.
    if (
        typeof puzzleId !== 'string' ||
        puzzleId.length === 0 ||
        /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/u.test(puzzleId) ||
        // eslint-disable-next-line no-control-regex
        /[\u0000-\u001f\u007f-\u009f]/u.test(puzzleId) ||
        new TextEncoder().encode(puzzleId).length > 512
    ) {
        return null;
    }
    if (typeof uuid !== 'string') {
        return null;
    }
    const eventId = FLIB_ROUTE_EVENT_ID_PREFIX + uuid.toLowerCase();
    if (!/^[A-Za-z0-9._:-]{1,128}$/u.test(eventId)) {
        return null;
    }
    return {
        event_id: eventId,
        type,
        puzzle_id: puzzleId,
        lemmas: normalized,
        client_ts: now,
        created_at: now,
    };
}

/**
 * @param {string} puzzleId
 * @param {import('flib-events').FlibRouteEventType} type
 * @param {string} lemma
 * @returns {string}
 */
export function outboxDedupKey(puzzleId, type, lemma) {
    return `${puzzleId}\0${type}\0${lemma}`;
}

/**
 * ⚠️ client_ts на проводе — строка RFC 3339 (шлюз молча отбрасывает число).
 * @param {import('flib-events').FlibOutboxRecord} record
 * @returns {import('flib-events').FlibWireEvent}
 */
export function toWireEvent(record) {
    /** @type {import('flib-events').FlibWireEvent} */
    const wire = {
        event_id: record.event_id,
        type: record.type,
        puzzle_id: record.puzzle_id,
        lemmas: record.lemmas,
        subs_source: FLIB_SUBS_SOURCE,
    };
    // Поле необязательно для сервера; невалидное время не должно ронять отправку.
    const date = new Date(record.client_ts);
    if (Number.isFinite(record.client_ts) && !Number.isNaN(date.getTime())) {
        wire.client_ts = date.toISOString();
    }
    return wire;
}
