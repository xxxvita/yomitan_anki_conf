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

import {FLIB_BASE_MODEL} from '../data/flib-anki-models.js';
import {normalizeEnrichCards} from '../data/flib-enrich.js';
import {getGatewayErrorCode} from './gateway-examples-util.js';

/*
 * Связка «+» → обогащение в popup (spec docs/superpowers/specs/2026-11-15-card-enrichment-design.md).
 * ⚠️ Тег ставится ДО addNote: если Anki идёт через Flibooster, он видит тег в
 * самом addNote и заметку не трогает (anki_conf #391), иначе квота ушла бы дважды.
 */

export const FLIB_ENRICHED_TAG = 'flib_enriched';

/**
 * Единственное место, где решается «это наш тип заметки» (иначе расхождение даёт тихое 'none').
 * @param {import('anki').Note} note
 * @returns {boolean}
 */
export function isEnrichableModel(note) {
    return note.modelName.trim().toLowerCase() === FLIB_BASE_MODEL.toLowerCase();
}

/**
 * Что делать с новой заметкой: обогащать, объяснить отсутствие ключа или ничего.
 * ⚠️ hasKey === null — вызов статуса упал: ключа «нет» мы не знаем, подсказку не показываем.
 * В маршруте core пустой ключ — не наше дело: мост Flibooster обогащает сам.
 * @param {import('anki').Note} note
 * @param {{enrichCards: boolean, hasKey: ?boolean, coreRoute: boolean}} details
 * @returns {'enrich'|'no-key'|'none'}
 */
export function decideEnrichment(note, {enrichCards, hasKey, coreRoute}) {
    if (!enrichCards || !isEnrichableModel(note)) { return 'none'; }
    if (hasKey === true) { return 'enrich'; }
    return hasKey === false && !coreRoute ? 'no-key' : 'none';
}

/**
 * @param {unknown} flibService
 * @returns {import('flib-gateway').EnrichCards}
 */
export function enrichCardsFromOptions(flibService) {
    const s = /** @type {?{createReverseCard?: unknown, createPhrasesCard?: unknown}} */ (flibService);
    return normalizeEnrichCards({reverse: s?.createReverseCard, phrases: s?.createPhrasesCard});
}

/**
 * @param {import('anki').Note} note
 */
export function markNoteForEnrichment(note) {
    if (!note.tags.includes(FLIB_ENRICHED_TAG)) { note.tags = [...note.tags, FLIB_ENRICHED_TAG]; }
}

/**
 * @param {{api: import('../comm/api.js').API, noteId: number, tags: string[], cards: import('flib-gateway').EnrichCards, isCurrent: () => boolean, render: (state: 'pending' | import('flib-gateway').EnrichReport) => void}} details
 * @returns {Promise<import('flib-gateway').EnrichReport>}
 */
export async function startEnrichment({api, noteId, tags, cards, isCurrent, render}) {
    render('pending');
    /** @type {import('flib-gateway').EnrichReport} */
    let report;
    try {
        report = await api.flibEnrichNote(noteId, tags.filter((tag) => tag !== FLIB_ENRICHED_TAG), cards);
    } catch (e) {
        /** @type {import('flib-gateway').EnrichStep} */
        const failed = {status: 'failed', code: getGatewayErrorCode(e) ?? 'flib_service_unavailable'};
        report = {enrich: failed, audio: {...failed}, reverse: {...failed}, phrases: {...failed}, speechCode: null};
    }
    // Карточку уже сменили: отчёт про прошлую заметку не рисуем.
    if (isCurrent()) { render(report); }
    return report;
}
