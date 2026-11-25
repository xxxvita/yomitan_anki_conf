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

import {ANKI_ROUTE_SWITCHED_CODE} from '../comm/anki-route.js';
import {ExtensionError} from '../core/extension-error.js';
import {FLIB_BASE_MODEL, FLIB_PRODUCT_DECK} from '../data/flib-anki-models.js';
import {
    blankForm,
    blankTarget,
    buildChatBody,
    enrichmentUser,
    escapeHtml,
    findFormUser,
    frontSpeechText,
    mediaFileName,
    parseJsonAnswer,
    phrasesFields,
    phrasesUser,
    reverseDeckFields,
    sanitizeEnrichment,
    normalizeEnrichCards,
    stripHtml,
    synonymWords,
    ttsText,
} from '../data/flib-enrich.js';
import {ensureFlibAnkiSetup} from './flib-anki-setup.js';
import {ENRICH_BUDGET_MS, ENRICH_KEEP_ALIVE_MS, ENRICH_RETRY_DELAY_MS, getEnrichErrorCode, requestChatWithRetry, runKeptAlive, speakToAnkiMedia, updateEnrichedFields} from './flib-enrich-steps.js';
import {getAnkiRouteErrorCode} from './flib-phrase-model.js';

/*
 * Обогащение новой заметки при «+» (spec
 * docs/superpowers/specs/2026-11-15-card-enrichment-design.md): ExampleLLM,
 * перевод, озвучка слова, ReverseDeck и Phrases — через шлюз, как Flibooster.
 *
 * ⚠️ НЕ транзакция: каждый шаг независим, сбой одного не отменяет остальные и
 * не трогает уже добавленную заметку. Отчёт говорит, что вышло.
 * ⚠️ Дубли производных исключает Anki, а не память: тег-ссылка
 * `<noteId>_reverse` / `<noteId>_phrases` (формат Flibooster, по нему мнемоника
 * находит базовую заметку) проверяется findNotes перед созданием. Параллельный
 * второй вызов для той же заметки получает тот же промис (`_inFlight`).
 */

/** @typedef {import('flib-gateway').EnrichStep} EnrichStep */

/**
 * @typedef {object} EnricherAnki
 * @property {?string} server
 * @property {boolean} enabled
 * @property {(server: string) => import('./flib-anki-setup.js').FlibAnkiSetupClient} withoutFallback
 * @property {(ids: number[]) => Promise<unknown[]>} notesInfo
 * @property {(query: string) => Promise<number[]>} findNotes
 * @property {(query: string) => Promise<number[]>} findCards
 * @property {(ids: number[]) => Promise<unknown[]>} cardsInfo
 * @property {(note: import('anki').Note) => Promise<unknown>} updateNoteFields
 * @property {(name: string, base64: string) => Promise<unknown>} storeMediaFile
 * @property {(note: import('anki').Note) => Promise<?number>} addNote
 * @property {(noteIds: number[], tags: string[]) => Promise<void>} removeTags
 */

/**
 * @typedef {object} EnricherGateway
 * @property {(body: object, options?: {signal?: AbortSignal, timeoutMs?: number}) => Promise<string>} chatJson
 * @property {(text: string, options?: {signal?: AbortSignal}) => Promise<{base64: string, cached: boolean}>} synthesizeSpeech
 */

const LINK_REVERSE = 'reverse';
const LINK_PHRASES = 'phrases';
const ENRICHED_TAG = 'flib_enriched';

/** Пауза перед повторной установкой типов заметок после сбоя. */
const SETUP_RETRY_MS = 30_000;

/** Сбои без паузы: Anki могли только что открыть, первый же поиск при открытой Anki ставит типы. */
const SETUP_RETRY_NOW_CODES = new Set(['anki_closed', ANKI_ROUTE_SWITCHED_CODE]);

/** Таймаут запроса к ChatGPT — как у Flibooster (60 с): ответ с шестью примерами бывает долгим. */
const CHAT_TIMEOUT_MS = 60_000;

/**
 * Где помнится, что для этого адреса Anki установка уже была (I3): иначе
 * удалённые пользователем типы и колода возвращались бы на каждом запуске воркера.
 * @typedef {{has: (server: string) => Promise<boolean>, remember: (server: string) => Promise<void>}} FlibSetupStore
 */

/**
 * Производные заметки — всегда новые: проверку дублей делает тег-ссылка.
 * @type {import('anki').Note['options']}
 */
const DERIVED_NOTE_OPTIONS = {allowDuplicate: true, duplicateScope: 'collection', duplicateScopeOptions: {deckName: null, checkChildren: false, checkAllModels: false}};

/**
 * @param {string} code
 * @returns {ExtensionError}
 */
function codedError(code) {
    const error = new ExtensionError(code);
    error.data = {code, status: null};
    return error;
}

/**
 * @param {unknown} note
 * @returns {{modelName: string, fields: Record<string, string>}}
 */
function readNote(note) {
    const record = typeof note === 'object' && note !== null ? /** @type {Record<string, unknown>} */ (note) : {};
    /** @type {Record<string, string>} */
    const fields = {};
    const raw = typeof record.fields === 'object' && record.fields !== null ? /** @type {Record<string, unknown>} */ (record.fields) : {};
    for (const [name, value] of Object.entries(raw)) {
        const v = typeof value === 'object' && value !== null ? /** @type {{value?: unknown}} */ (value).value : null;
        fields[name] = typeof v === 'string' ? v : '';
    }
    return {modelName: typeof record.modelName === 'string' ? record.modelName : '', fields};
}

export class FlibCardEnricher {
    /**
     * @param {{anki: EnricherAnki, gateway: EnricherGateway, loadModels: () => Promise<import('flib-anki-models').FlibAnkiModelsFile>, loadPrompts: () => Promise<import('../data/flib-enrich.js').FlibEnrichPrompts>, budgetMs?: number, retryDelayMs?: number, now?: () => number, setupStore?: ?FlibSetupStore, keepAlive?: ?(() => void), keepAliveMs?: number}} details
     */
    constructor({anki, gateway, loadModels, loadPrompts, budgetMs = ENRICH_BUDGET_MS, retryDelayMs = ENRICH_RETRY_DELAY_MS, now = Date.now, setupStore = null, keepAlive = null, keepAliveMs = ENRICH_KEEP_ALIVE_MS}) {
        /** @type {EnricherAnki} */
        this._anki = anki;
        /** @type {EnricherGateway} */
        this._gateway = gateway;
        /** @type {() => Promise<import('flib-anki-models').FlibAnkiModelsFile>} */
        this._loadModels = loadModels;
        /** @type {() => Promise<import('../data/flib-enrich.js').FlibEnrichPrompts>} */
        this._loadPrompts = loadPrompts;
        /** @type {number} */
        this._budgetMs = budgetMs;
        /** @type {number} */
        this._retryDelayMs = retryDelayMs;
        /** @type {() => number} */
        this._now = now;
        /** @type {Set<string>} Адреса, где типы заметок и колода проверены за жизнь воркера; сбой не кэшируется. */
        this._setupDone = new Set();
        /** @type {Map<string, {at: number, code: string}>} Последний сбой адреса: повтор не раньше чем через SETUP_RETRY_MS. */
        this._setupFailed = new Map();
        /** @type {Map<string, Promise<?string>>} Установка в полёте: параллельные вызовы ждут её же (I2). */
        this._setupRuns = new Map();
        /** @type {?FlibSetupStore} */
        this._setupStore = setupStore;
        /** @type {?(() => void)} */
        this._keepAlive = keepAlive;
        /** @type {number} */
        this._keepAliveMs = keepAliveMs;
        /** @type {Map<number, Promise<import('flib-gateway').EnrichReport>>} */
        this._inFlight = new Map();
    }

    /**
     * @param {import('flib-gateway').EnrichRequest} request
     * @returns {Promise<import('flib-gateway').EnrichReport>}
     */
    enrich({noteId, userTags, cards}) {
        const pending = this._inFlight.get(noteId);
        if (typeof pending !== 'undefined') { return pending; }
        const promise = this._runAndRelease(noteId, userTags, normalizeEnrichCards(cards)).finally(() => { this._inFlight.delete(noteId); });
        this._inFlight.set(noteId, promise);
        return promise;
    }

    /**
     * ⚠️ Тег flib_enriched стоит на заметке с момента addNote, чтобы её не
     * начал обогащать Flibooster. Если у нас не вышло НИЧЕГО, тег снимается —
     * иначе заметку не обогатит никто.
     * @param {number} noteId
     * @param {string[]} userTags
     * @param {import('flib-gateway').EnrichCards} cards
     * @returns {Promise<import('flib-gateway').EnrichReport>}
     */
    async _runAndRelease(noteId, userTags, cards) {
        /** @type {{preexisting: boolean}} */
        const state = {preexisting: false};
        const report = await runKeptAlive(() => this._run(noteId, userTags, state, cards), {keepAlive: this._keepAlive, keepAliveMs: this._keepAliveMs});
        const steps = [report.enrich, report.audio, report.reverse, report.phrases];
        // Снимаем, только если ничего не сделано и до нас заметку никто не обогащал:
        // повторный вызов на уже обогащённой заметке тег не трогает (I4).
        if (!state.preexisting && !steps.some((step) => step.status === 'done')) {
            try {
                await this._anki.removeTags([noteId], [ENRICHED_TAG]);
            } catch {
                // Anki недоступна — тег останется, это принимаемый риск v1.
            }
        }
        return report;
    }

    /**
     * @param {number} noteId
     * @param {string[]} userTags
     * @param {{preexisting: boolean}} state
     * @param {import('flib-gateway').EnrichCards} cards
     * @returns {Promise<import('flib-gateway').EnrichReport>}
     */
    async _run(noteId, userTags, state, cards) {
        /** @type {import('flib-gateway').EnrichReport} */
        const report = {enrich: {status: 'skipped'}, audio: {status: 'skipped'}, reverse: {status: 'skipped'}, phrases: {status: 'skipped'}, speechCode: null};
        const started = Date.now();
        const controller = new AbortController();
        const timer = setTimeout(() => { controller.abort(); }, this._budgetMs);
        const {signal} = controller;
        try {
            const [info] = await this._anki.notesInfo([noteId]);
            const note = readNote(info);
            if (note.modelName.trim().toLowerCase() !== FLIB_BASE_MODEL.toLowerCase()) { return report; }
            const word = ttsText(stripHtml(note.fields.Word ?? ''));
            if (word === '') { return report; }
            const example = stripHtml(note.fields.Example ?? '');
            const prompts = await this._loadPrompts();
            if ((note.fields.ExampleLLM ?? '').trim() !== '') { state.preexisting = true; }
            const ctx = {noteId, userTags, word, example, signal, report, started, setupCode: /** @type {?string} */ (null), note, exampleLLM: note.fields.ExampleLLM ?? '', tr: '', prompts, state, originalTranslate: note.fields.Translate ?? ''};

            ctx.setupCode = await this.ensureSetup({force: true});
            await this._step(ctx, 'enrich', () => this._stepEnrich(ctx));
            await this._step(ctx, 'audio', () => this._stepWordAudio(ctx));
            if (cards.reverse) { await this._step(ctx, 'reverse', () => this._stepReverse(ctx)); }
            if (cards.phrases) { await this._step(ctx, 'phrases', () => this._stepPhrases(ctx)); }
            return report;
        } catch (e) {
            const code = getEnrichErrorCode(e);
            for (const key of /** @type {const} */ (['enrich', 'audio', 'reverse', 'phrases'])) {
                if ((key === 'reverse' || key === 'phrases') && !cards[key]) { continue; }
                if (report[key].status === 'skipped') { report[key] = {status: 'failed', code}; }
            }
            return report;
        } finally {
            clearTimeout(timer);
        }
    }

    /**
     * Колода «Flibooster» и три типа заметок (flib-anki-setup.js). Зовётся и
     * перед первой проверкой «можно ли добавить» (backend): без типа «Yomitan
     * Card Type» Anki не даст добавить даже базовую заметку.
     * - успех кэшируется на жизнь воркера и запоминается для адреса Anki (I3);
     * - закрытая Anki ничего не получает и не запоминается (⚠️ Core пишет за неё
     *   в файл коллекции: типы без наших шаблонов); со следующего вызова — снова;
     * - после другого сбоя повтор не раньше чем через SETUP_RETRY_MS, кроме
     *   `force` — его даёт обогащение, чтобы не взять устаревший сбой (I2);
     * - параллельные вызовы делят одну установку (I2).
     * @param {{force?: boolean}} [options]
     * @returns {Promise<?string>} код ошибки установки или null
     */
    async ensureSetup({force = false} = {}) {
        const server = this._anki.server ?? '';
        const code = await this._ensureSetupAt(server, force);
        const current = this._anki.server ?? '';
        // Маршрут сменился посреди установки: у нового адреса она своя, с начала.
        return code === ANKI_ROUTE_SWITCHED_CODE && current !== server ? await this._ensureSetupAt(current, force) : code;
    }

    /**
     * @param {string} server
     * @param {boolean} force
     * @returns {Promise<?string>}
     */
    async _ensureSetupAt(server, force) {
        if (server === '') { return 'anki_closed'; }
        if (this._setupDone.has(server)) { return null; }
        const run = this._setupRuns.get(server);
        if (typeof run !== 'undefined') { return await run; }
        const failed = this._setupFailed.get(server);
        if (!force && typeof failed !== 'undefined' && this._now() - failed.at < SETUP_RETRY_MS) { return failed.code; }
        const promise = this._runSetup(server).finally(() => { this._setupRuns.delete(server); });
        this._setupRuns.set(server, promise);
        return await promise;
    }

    /**
     * @param {string} server Адрес, для которого установка запоминается: все её запросы уходят на него или никуда.
     * @returns {Promise<?string>}
     */
    async _runSetup(server) {
        try {
            if (this._setupStore !== null && await this._setupStore.has(server)) {
                this._setupDone.add(server);
                return null;
            }
            const {models} = await this._loadModels();
            await ensureFlibAnkiSetup(this._anki.withoutFallback(server), models, FLIB_PRODUCT_DECK);
            if (this._anki.server !== server) { throw codedError(ANKI_ROUTE_SWITCHED_CODE); }
            // Выключенный клиент отвечает пустотой, ничего не записав.
            if (!this._anki.enabled) { throw codedError('anki_model_failed'); }
            this._setupDone.add(server);
            this._setupFailed.delete(server);
            if (this._setupStore !== null) {
                try {
                    await this._setupStore.remember(server);
                } catch {
                    // Не запомнили — в следующий раз установка проверит модели ещё раз, это безвредно.
                }
            }
            return null;
        } catch (e) {
            const enrichCode = getEnrichErrorCode(e);
            const code = getAnkiRouteErrorCode(e) ?? (enrichCode === 'anki_failed' ? 'anki_model_failed' : enrichCode);
            if (SETUP_RETRY_NOW_CODES.has(code)) {
                this._setupFailed.delete(server);
            } else {
                this._setupFailed.set(server, {at: this._now(), code});
            }
            return code;
        }
    }

    /**
     * @param {{report: import('flib-gateway').EnrichReport, started: number}} ctx
     * @param {'enrich'|'audio'|'reverse'|'phrases'} key
     * @param {() => Promise<'done'|'skipped'>} run
     */
    async _step(ctx, key, run) {
        if (Date.now() - ctx.started >= this._budgetMs) {
            ctx.report[key] = {status: 'failed', code: 'flib_timeout'};
            return;
        }
        try {
            ctx.report[key] = {status: await run()};
        } catch (e) {
            ctx.report[key] = {status: 'failed', code: getEnrichErrorCode(e)};
        }
    }

    /**
     * @param {object} body
     * @param {AbortSignal} signal
     * @returns {Promise<string>}
     */
    async _chat(body, signal) {
        return await requestChatWithRetry(
            () => this._gateway.chatJson(body, {signal, timeoutMs: CHAT_TIMEOUT_MS}),
            {signal, retryDelayMs: this._retryDelayMs},
        );
    }

    /**
     * @param {{report: import('flib-gateway').EnrichReport, signal: AbortSignal}} ctx
     * @param {string} text
     * @param {string} fileName
     * @returns {Promise<string>} значение поля [sound:…]
     */
    async _speak(ctx, text, fileName) {
        return await speakToAnkiMedia(ctx.report, fileName, {
            synthesize: () => this._gateway.synthesizeSpeech(text, {signal: ctx.signal}),
            store: (name, base64) => this._anki.storeMediaFile(name, base64),
        });
    }

    /**
     * @param {{noteId: number, word: string, example: string, signal: AbortSignal, note: {fields: Record<string, string>}, exampleLLM: string, tr: string, prompts: import('../data/flib-enrich.js').FlibEnrichPrompts}} ctx
     * @returns {Promise<'done'|'skipped'>}
     */
    async _stepEnrich(ctx) {
        if (ctx.exampleLLM.trim() !== '') { return 'skipped'; }
        const content = await this._chat(buildChatBody(ctx.prompts.enrichment, enrichmentUser(ctx.word, ctx.example)), ctx.signal);
        const answer = parseJsonAnswer(content);
        if (answer === null) { throw codedError('llm_bad_answer'); }
        const clean = sanitizeEnrichment(answer);
        ctx.exampleLLM = JSON.stringify(clean);
        ctx.tr = typeof clean.tr === 'string' ? clean.tr : '';
        /** @type {Record<string, string>} */
        const fields = {ExampleLLM: ctx.exampleLLM};
        if ((ctx.note.fields.Translate ?? '').trim() === '' && ctx.tr !== '') {
            fields.Translate = escapeHtml(ctx.tr);
            ctx.note.fields.Translate = fields.Translate;
        }
        await this._updateFields(ctx.noteId, fields);
        return 'done';
    }

    /**
     * @param {{noteId: number, word: string, note: {fields: Record<string, string>}, report: import('flib-gateway').EnrichReport, signal: AbortSignal}} ctx
     * @returns {Promise<'done'|'skipped'>}
     */
    async _stepWordAudio(ctx) {
        if ((ctx.note.fields.Audio ?? '').trim() !== '') { return 'skipped'; }
        const value = await this._speak(ctx, ctx.word, mediaFileName('word', ctx.word, ctx.noteId));
        await this._updateFields(ctx.noteId, {Audio: value});
        ctx.note.fields.Audio = value;
        return 'done';
    }

    /**
     * @param {number} id
     * @param {Record<string, string>} fields
     * @returns {Promise<void>}
     */
    async _updateFields(id, fields) {
        await updateEnrichedFields(this._anki, id, fields);
    }

    /**
     * @param {number} noteId
     * @param {string} kind
     * @returns {Promise<boolean>}
     */
    async _linkExists(noteId, kind) {
        const ids = await this._anki.findNotes(`"tag:${noteId}_${kind}"`);
        return ids.length > 0;
    }

    /**
     * @param {number} noteId
     * @returns {Promise<string>}
     */
    async _deckForNote(noteId) {
        try {
            const cards = await this._anki.findCards(`nid:${noteId}`);
            if (cards.length > 0) {
                const [info] = await this._anki.cardsInfo([cards[0]]);
                const deck = typeof info === 'object' && info !== null ? /** @type {{deckName?: unknown}} */ (info).deckName : null;
                if (typeof deck === 'string' && deck !== '') { return deck; }
            }
        } catch {
            // Колода по умолчанию, как у Flibooster.
        }
        return FLIB_PRODUCT_DECK;
    }

    /**
     * @param {{noteId: number, userTags: string[]}} ctx
     * @param {string} kind
     * @returns {string[]}
     */
    _derivedTags(ctx, kind) {
        return [...new Set([`${ctx.noteId}_${kind}`, ENRICHED_TAG, ...ctx.userTags])];
    }

    /**
     * @param {{noteId: number, userTags: string[], word: string, signal: AbortSignal, report: import('flib-gateway').EnrichReport, setupCode: ?string, note: {fields: Record<string, string>}, exampleLLM: string, tr: string, state: {preexisting: boolean}, originalTranslate: string}} ctx
     * @returns {Promise<'done'|'skipped'>}
     */
    async _stepReverse(ctx) {
        // Перевод из поля — только тот, что был до нас; наш собственный (из tr) берётся из ctx.tr.
        const existing = ctx.originalTranslate.trim();
        const translation = existing !== '' ? existing : escapeHtml(ctx.tr);
        if (translation === '') { return 'skipped'; }
        // Озвучивается чистый текст: экранированный дал бы другой ключ кэша шлюза (M4).
        const speech = existing !== '' ? stripHtml(existing) : ctx.tr;
        if (ctx.setupCode !== null) { throw codedError(ctx.setupCode); }
        if (await this._linkExists(ctx.noteId, LINK_REVERSE)) {
            ctx.state.preexisting = true;
            return 'skipped';
        }
        const answer = parseJsonAnswer(ctx.exampleLLM) ?? {};
        const fields = reverseDeckFields({word: ctx.word, translation, exampleLLM: ctx.exampleLLM, synonyms: synonymWords(answer), baseAudio: ctx.note.fields.Audio ?? ''});
        const reverseId = await this._anki.addNote({
            deckName: await this._deckForNote(ctx.noteId),
            modelName: 'ReverseDeck',
            fields,
            tags: this._derivedTags(ctx, LINK_REVERSE),
            options: DERIVED_NOTE_OPTIONS,
        });
        if (typeof reverseId !== 'number') { throw codedError('anki_failed'); }
        try {
            const value = await this._speak(ctx, speech, mediaFileName('rev', '', reverseId));
            await this._updateFields(reverseId, {Audio: value});
            if ((ctx.note.fields.Audio_Translate ?? '').trim() === '') {
                await this._updateFields(ctx.noteId, {Audio_Translate: value});
            }
        } catch {
            // Без звука карточка остаётся: о квоте говорит speechCode.
        }
        return 'done';
    }

    /**
     * @param {{noteId: number, userTags: string[], word: string, example: string, signal: AbortSignal, report: import('flib-gateway').EnrichReport, setupCode: ?string, prompts: import('../data/flib-enrich.js').FlibEnrichPrompts, state: {preexisting: boolean}}} ctx
     * @returns {Promise<'done'|'skipped'>}
     */
    async _stepPhrases(ctx) {
        if (ctx.setupCode !== null) { throw codedError(ctx.setupCode); }
        if (await this._linkExists(ctx.noteId, LINK_PHRASES)) {
            ctx.state.preexisting = true;
            return 'skipped';
        }
        const answer = parseJsonAnswer(await this._chat(buildChatBody(ctx.prompts.phrases, phrasesUser(ctx.word, ctx.example)), ctx.signal));
        const sentence = answer !== null && typeof answer.sentence === 'string' ? stripHtml(answer.sentence) : '';
        if (answer === null || sentence === '') { throw codedError('llm_bad_answer'); }
        const targetForm = typeof answer.target_form === 'string' ? answer.target_form : '';
        let front = blankTarget(sentence, ctx.word, targetForm);
        if (front === null) {
            try {
                const found = parseJsonAnswer(await this._chat(buildChatBody(ctx.prompts.findForm, findFormUser(sentence, ctx.word)), ctx.signal));
                const form = found !== null && typeof found.form === 'string' ? found.form : '';
                front = blankForm(sentence, form);
            } catch {
                // Последняя попытка не удалась — предложение остаётся целым, как у Flibooster.
            }
        }
        const frontText = front ?? sentence;
        const fields = phrasesFields({word: ctx.word, front: frontText, answer: {...answer, sentence}});
        const phrasesId = await this._anki.addNote({
            deckName: await this._deckForNote(ctx.noteId),
            modelName: 'Phrases',
            fields,
            tags: this._derivedTags(ctx, LINK_PHRASES),
            options: DERIVED_NOTE_OPTIONS,
        });
        if (typeof phrasesId !== 'number') { throw codedError('anki_failed'); }
        for (const [field, text, kind] of /** @type {const} */ ([['Audio_expression', sentence, 'phr_exp'], ['Audio_front', frontSpeechText(frontText), 'phr_front']])) {
            try {
                const value = await this._speak(ctx, text, mediaFileName(kind, '', phrasesId));
                await this._updateFields(phrasesId, {[field]: value});
            } catch {
                // См. _stepReverse.
            }
        }
        return 'done';
    }
}
