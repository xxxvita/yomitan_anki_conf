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
import {FLIB_BASE_MODEL, FLIB_PRODUCT_DECK} from '../data/flib-anki-models.js';
import {
    FLIB_ENRICH_PROMPTS,
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
    stripHtml,
    synonymWords,
    ttsText,
} from '../data/flib-enrich.js';
import {ensureFlibAnkiSetup} from './flib-anki-setup.js';

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
 * @property {(ids: number[]) => Promise<unknown[]>} notesInfo
 * @property {(query: string) => Promise<number[]>} findNotes
 * @property {(query: string) => Promise<number[]>} findCards
 * @property {(ids: number[]) => Promise<unknown[]>} cardsInfo
 * @property {(note: import('anki').Note) => Promise<unknown>} updateNoteFields
 * @property {(name: string, base64: string) => Promise<unknown>} storeMediaFile
 * @property {(note: import('anki').Note) => Promise<?number>} addNote
 */

/**
 * @typedef {object} EnricherGateway
 * @property {(body: object, options?: {signal?: AbortSignal}) => Promise<string>} chatJson
 * @property {(text: string, options?: {signal?: AbortSignal}) => Promise<{base64: string, cached: boolean}>} synthesizeSpeech
 */

const LINK_REVERSE = 'reverse';
const LINK_PHRASES = 'phrases';
const ENRICHED_TAG = 'flib_enriched';

/**
 * Производные заметки — всегда новые: проверку дублей делает тег-ссылка.
 * @type {import('anki').Note['options']}
 */
const DERIVED_NOTE_OPTIONS = {allowDuplicate: true, duplicateScope: 'collection', duplicateScopeOptions: {deckName: null, checkChildren: false, checkAllModels: false}};

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorCode(error) {
    if (error instanceof ExtensionError) {
        const data = /** @type {{code?: unknown}} */ (error.data ?? {});
        if (typeof data.code === 'string' && data.code !== '') { return data.code; }
    }
    return 'anki_failed';
}

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
     * @param {{anki: EnricherAnki & import('./flib-anki-setup.js').FlibAnkiSetupClient, gateway: EnricherGateway, loadModels: () => Promise<import('flib-anki-models').FlibAnkiModelsFile>, budgetMs?: number, retryDelayMs?: number}} details
     */
    constructor({anki, gateway, loadModels, budgetMs = 90_000, retryDelayMs = 1500}) {
        /** @type {EnricherAnki & import('./flib-anki-setup.js').FlibAnkiSetupClient} */
        this._anki = anki;
        /** @type {EnricherGateway} */
        this._gateway = gateway;
        /** @type {() => Promise<import('flib-anki-models').FlibAnkiModelsFile>} */
        this._loadModels = loadModels;
        /** @type {number} */
        this._budgetMs = budgetMs;
        /** @type {number} */
        this._retryDelayMs = retryDelayMs;
        /** Типы заметок и колода проверены за жизнь воркера; сбой не кэшируется. */
        this._setupDone = false;
        /** @type {Map<number, Promise<import('flib-gateway').EnrichReport>>} */
        this._inFlight = new Map();
    }

    /**
     * @param {import('flib-gateway').EnrichRequest} request
     * @returns {Promise<import('flib-gateway').EnrichReport>}
     */
    enrich({noteId, userTags}) {
        const pending = this._inFlight.get(noteId);
        if (typeof pending !== 'undefined') { return pending; }
        const promise = this._run(noteId, userTags).finally(() => { this._inFlight.delete(noteId); });
        this._inFlight.set(noteId, promise);
        return promise;
    }

    /**
     * @param {number} noteId
     * @param {string[]} userTags
     * @returns {Promise<import('flib-gateway').EnrichReport>}
     */
    async _run(noteId, userTags) {
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
            const ctx = {noteId, userTags, word, example, signal, report, started, setupCode: /** @type {?string} */ (null), note, exampleLLM: note.fields.ExampleLLM ?? '', tr: ''};

            ctx.setupCode = await this._ensureSetup();
            await this._step(ctx, 'enrich', () => this._stepEnrich(ctx));
            await this._step(ctx, 'audio', () => this._stepWordAudio(ctx));
            await this._step(ctx, 'reverse', () => this._stepReverse(ctx));
            await this._step(ctx, 'phrases', () => this._stepPhrases(ctx));
            return report;
        } catch (e) {
            const code = errorCode(e);
            for (const key of /** @type {const} */ (['enrich', 'audio', 'reverse', 'phrases'])) {
                if (report[key].status === 'skipped') { report[key] = {status: 'failed', code}; }
            }
            return report;
        } finally {
            clearTimeout(timer);
        }
    }

    /** @returns {Promise<?string>} код ошибки установки или null */
    async _ensureSetup() {
        if (this._setupDone) { return null; }
        try {
            const {models} = await this._loadModels();
            await ensureFlibAnkiSetup(this._anki, models, FLIB_PRODUCT_DECK);
            this._setupDone = true;
            return null;
        } catch (e) {
            return errorCode(e) === 'anki_failed' ? 'anki_model_failed' : errorCode(e);
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
            ctx.report[key] = {status: 'failed', code: errorCode(e)};
        }
    }

    /**
     * Один повтор после временного сбоя, как у Flibooster (#387); квоту и ключ не повторяем.
     * @param {object} body
     * @param {AbortSignal} signal
     * @returns {Promise<string>}
     */
    async _chat(body, signal) {
        try {
            return await this._gateway.chatJson(body, {signal});
        } catch (e) {
            if (errorCode(e) !== 'flib_service_unavailable' || signal.aborted) { throw e; }
            await new Promise((resolve) => { setTimeout(resolve, this._retryDelayMs); });
            return await this._gateway.chatJson(body, {signal});
        }
    }

    /**
     * Озвучка в файл Anki. Ошибка запоминается один раз в speechCode и
     * пробрасывается; остальные клипы всё равно пробуются (кэш бесплатен).
     * @param {{report: import('flib-gateway').EnrichReport, signal: AbortSignal}} ctx
     * @param {string} text
     * @param {string} fileName
     * @returns {Promise<string>} значение поля [sound:…]
     */
    async _speak(ctx, text, fileName) {
        try {
            const {base64} = await this._gateway.synthesizeSpeech(text, {signal: ctx.signal});
            await this._anki.storeMediaFile(fileName, base64);
            return `[sound:${fileName}]`;
        } catch (e) {
            if (ctx.report.speechCode === null) { ctx.report.speechCode = errorCode(e); }
            throw e;
        }
    }

    /**
     * @param {{noteId: number, word: string, example: string, signal: AbortSignal, note: {fields: Record<string, string>}, exampleLLM: string, tr: string}} ctx
     * @returns {Promise<'done'|'skipped'>}
     */
    async _stepEnrich(ctx) {
        if (ctx.exampleLLM.trim() !== '') { return 'skipped'; }
        const content = await this._chat(buildChatBody(FLIB_ENRICH_PROMPTS.enrichment, enrichmentUser(ctx.word, ctx.example)), ctx.signal);
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
     * AnkiConnect updateNoteFields принимает {id, fields}; тип Note в клиенте шире.
     * @param {number} id
     * @param {Record<string, string>} fields
     * @returns {Promise<void>}
     */
    async _updateFields(id, fields) {
        await this._anki.updateNoteFields(/** @type {import('anki').Note} */ (/** @type {unknown} */ ({id, fields})));
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
     * @param {{noteId: number, userTags: string[], word: string, signal: AbortSignal, report: import('flib-gateway').EnrichReport, setupCode: ?string, note: {fields: Record<string, string>}, exampleLLM: string, tr: string}} ctx
     * @returns {Promise<'done'|'skipped'>}
     */
    async _stepReverse(ctx) {
        const existing = (ctx.note.fields.Translate ?? '').trim();
        const translation = existing !== '' ? existing : escapeHtml(ctx.tr);
        if (translation === '') { return 'skipped'; }
        if (ctx.setupCode !== null) { throw codedError(ctx.setupCode); }
        if (await this._linkExists(ctx.noteId, LINK_REVERSE)) { return 'skipped'; }
        const answer = parseJsonAnswer(ctx.exampleLLM) ?? {};
        const fields = reverseDeckFields({word: escapeHtml(ctx.word), translation, exampleLLM: ctx.exampleLLM, synonyms: synonymWords(answer), baseAudio: ctx.note.fields.Audio ?? ''});
        const reverseId = await this._anki.addNote({
            deckName: await this._deckForNote(ctx.noteId),
            modelName: 'ReverseDeck',
            fields,
            tags: this._derivedTags(ctx, LINK_REVERSE),
            options: DERIVED_NOTE_OPTIONS,
        });
        if (typeof reverseId !== 'number') { throw codedError('anki_failed'); }
        try {
            const value = await this._speak(ctx, stripHtml(translation), mediaFileName('rev', '', reverseId));
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
     * @param {{noteId: number, userTags: string[], word: string, example: string, signal: AbortSignal, report: import('flib-gateway').EnrichReport, setupCode: ?string}} ctx
     * @returns {Promise<'done'|'skipped'>}
     */
    async _stepPhrases(ctx) {
        if (ctx.setupCode !== null) { throw codedError(ctx.setupCode); }
        if (await this._linkExists(ctx.noteId, LINK_PHRASES)) { return 'skipped'; }
        const answer = parseJsonAnswer(await this._chat(buildChatBody(FLIB_ENRICH_PROMPTS.phrases, phrasesUser(ctx.word, ctx.example)), ctx.signal));
        const sentence = answer !== null && typeof answer.sentence === 'string' ? stripHtml(answer.sentence) : '';
        if (answer === null || sentence === '') { throw codedError('llm_bad_answer'); }
        const targetForm = typeof answer.target_form === 'string' ? answer.target_form : '';
        let front = blankTarget(sentence, ctx.word, targetForm);
        if (front === null) {
            try {
                const found = parseJsonAnswer(await this._chat(buildChatBody(FLIB_ENRICH_PROMPTS.findForm, findFormUser(sentence, ctx.word)), ctx.signal));
                const form = found !== null && typeof found.form === 'string' ? found.form : '';
                front = blankForm(sentence, form);
            } catch {
                // Последняя попытка не удалась — предложение остаётся целым, как у Flibooster.
            }
        }
        const frontText = front ?? sentence;
        const fields = phrasesFields({word: escapeHtml(ctx.word), front: frontText, answer: {...answer, sentence}});
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
