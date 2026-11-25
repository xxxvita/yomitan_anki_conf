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

import {createDeckSearchTerm} from '../comm/anki-connect.js';
import {ANKI_ROUTE_SWITCHED_CODE} from '../comm/anki-route.js';
import {createFlibError, getFlibErrorCode} from '../comm/flib-gateway-client.js';
import {ExtensionError} from '../core/extension-error.js';
import {isObjectNotArray} from '../core/object-utilities.js';
import {FLIB_MEDIA_FIELD_NAME} from '../data/flib-anki-media.js';
import {FLIB_PHRASES_MODEL} from '../data/flib-anki-models.js';
import {samePhraseNote} from '../data/flib-phrase-note.js';
import {runKeptAlive, updateEnrichedFields} from './flib-enrich-steps.js';
import {getAnkiRouteErrorCode, PHRASE_REQUEST_TIMEOUT_MS, requirePhraseServer, withPhraseTimeout} from './flib-phrase-model.js';

/*
 * Phrase notes in Anki: found, added, given videos. The note type is prepared before by flib-phrase-model.js.
 *
 * ⚠️ Every operation goes through a view pinned to the address that was prepared (see {@link createPhraseRun}):
 * comparing the address before a request is not enough, the client awaits before it sends.
 *
 * Known limits: an edited card (tags around its text) that is older than the 1000 newest of the second search is not
 * found; a card whose Front or EnglishWord has markup inside a word (`k<b>n</b>ow`) is not found; a write that
 * gave no answer in time may still be done by Anki afterwards (the next press finds that note); a field that the user
 * edits in Anki between the read and the write of `updateMedia` is overwritten; the turns are per worker.
 */

/** Notes of one `notesInfo`: their `flib_media` is large. */
const BATCH_SIZE = 200;
/** Notes of the second search that are read: for a phrase of one letter it finds most of the collection. */
const MAX_SECOND_CANDIDATES = 1000;
/** Longest Front and EnglishWord: a phrase is at most 5000 characters, cleaning and the blank add little. */
const MAX_TEXT_LENGTH = 20_000;
/** Longest field, in practice `flib_media`: its clips are files, the field has their subtitles. */
const MAX_FIELD_LENGTH = 2 * 1024 * 1024;

/**
 * @typedef {import('api').ApiParams<'flibPhraseFind'>} FindParams
 * @typedef {import('api').ApiParams<'flibPhraseAdd'>} AddParams
 * @typedef {import('api').ApiParams<'flibPhraseUpdateMedia'>} UpdateMediaParams
 * @typedef {import('flib-phrase-notes').Run} Run
 */

/**
 * @param {boolean} valid
 * @throws {Error} flib_bad_request
 */
function requireValid(valid) {
    if (!valid) { throw createFlibError('flib_bad_request'); }
}

/**
 * @param {unknown} value
 * @param {number} [maxLength]
 * @returns {boolean}
 */
export function isText(value, maxLength = MAX_TEXT_LENGTH) {
    return typeof value === 'string' && value.length <= maxLength && value.trim() !== '';
}

/**
 * Every run of other characters becomes a wildcard: in the stored HTML it may be an entity (`&#39;`, `&nbsp;`), and
 * nothing of it can be search syntax. The candidates are compared exactly afterwards.
 * @param {string} text
 * @returns {string}
 */
function createPattern(text) {
    // NFC, as Anki stores it: `e` of a decomposed `é` is not there.
    return text.normalize('NFC').replace(/[^A-Za-z0-9]+/g, '*');
}

/**
 * @param {FindParams} card
 * @returns {string[]} The second one only when the first finds no such card: an editor may have put tags or spaces
 *   around the text (`<div>…</div>`, `…<br>`), but there it would match most of a deck for a short phrase.
 */
function createQueries({deckName, front, englishWord}) {
    const createQuery = (/** @type {(pattern: string) => string} */ change) => (
        `"note:${FLIB_PHRASES_MODEL}" ${createDeckSearchTerm(deckName)} "front:${change(createPattern(front))}" "EnglishWord:${change(createPattern(englishWord))}"`
    );
    const first = createQuery((pattern) => pattern);
    const second = createQuery((pattern) => `*${pattern}*`.replace(/\*+/g, '*'));
    return first === second ? [first] : [first, second];
}

/**
 * @param {import('anki').NoteInfo} info
 * @returns {boolean} Anki tells note types apart without letter case.
 */
function isPhraseNote({modelName}) {
    return modelName.toLowerCase() === FLIB_PHRASES_MODEL.toLowerCase();
}

/**
 * @param {import('anki').NoteInfo} info
 * @param {string} name
 * @returns {?string} null — no such field.
 */
function getField({fields}, name) {
    return Object.hasOwn(fields, name) ? fields[name].value : null;
}

/**
 * @param {import('anki').NoteInfo} info
 * @param {FindParams} card
 * @returns {boolean}
 */
function isSameCard(info, {front, englishWord}) {
    const Front = getField(info, 'Front');
    const EnglishWord = getField(info, 'EnglishWord');
    if (!isPhraseNote(info) || Front === null || EnglishWord === null) { return false; }
    return samePhraseNote({Front, EnglishWord}, {Front: front, EnglishWord: englishWord});
}

/**
 * @param {unknown} error
 * @param {boolean} routeSwitched The address changed during the request.
 * @param {string} otherCode The code of any other error.
 * @returns {Error} With a code and without the request: the error of AnkiConnect carries the text of the note.
 */
function createRequestError(error, routeSwitched, otherCode) {
    const detail = error instanceof Error ? error.message : String(error);
    const {apiError} = /** @type {{apiError?: unknown}} */ ((error instanceof ExtensionError ? error.data : null) ?? {});
    const answer = typeof apiError === 'string' ? apiError.toLowerCase() : '';
    let code = routeSwitched ? ANKI_ROUTE_SWITCHED_CODE : (getAnkiRouteErrorCode(error) ?? otherCode);
    if (code === otherCode && answer.includes('model was not found')) { code = 'anki_model_outdated'; }
    if (code === otherCode && answer.includes('deck was not found')) { code = 'anki_deck_failed'; }
    return createFlibError(code, null, {detail});
}

/**
 * @param {{deckName: unknown, fields: unknown, tags: unknown}} params
 * @returns {import('anki').Note}
 * @throws {Error} flib_bad_request
 */
function createNote({deckName, fields, tags}) {
    requireValid(isText(deckName, MAX_TEXT_LENGTH) && isObjectNotArray(fields) && Array.isArray(tags));
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (fields));
    requireValid(entries.every(([, value]) => typeof value === 'string' && value.length <= MAX_FIELD_LENGTH));
    const tagList = [...(/** @type {unknown[]} */ (tags))];
    requireValid(tagList.every((tag) => typeof tag === 'string'));
    const {Front, EnglishWord} = /** @type {Record<string, unknown>} */ (fields);
    requireValid(isText(Front, MAX_TEXT_LENGTH) && isText(EnglishWord, MAX_TEXT_LENGTH));
    return {
        deckName: /** @type {string} */ (deckName),
        modelName: FLIB_PHRASES_MODEL,
        fields: /** @type {import('anki').NoteFields} */ (Object.fromEntries(entries)),
        tags: /** @type {string[]} */ (tagList),
        // The check of Anki compares only the first field: `I _____ it` of «love» and of «hate» are different cards.
        options: {
            allowDuplicate: true,
            duplicateScope: 'collection',
            duplicateScopeOptions: {deckName: null, checkChildren: false, checkAllModels: false},
        },
    };
}

/**
 * Requests of one operation. Every one of them is sent to this address or not at all, so its answer is true
 * whatever the current address is afterwards. Off, the client would answer with an empty list or a write that did
 * not happen.
 * @param {import('../comm/anki-connect.js').AnkiConnect} anki
 * @param {string} server
 * @param {number} timeoutMs Of one request.
 * @returns {Run}
 * @throws {Error} anki_route_switched / anki_closed: before anything is sent.
 */
export function createPhraseRun(anki, server, timeoutMs) {
    // Not a check alone: `withoutFallback()` without an address is not pinned.
    requirePhraseServer(anki, server);
    const view = anki.withoutFallback(server);
    return async (request, otherCode = 'anki_note_failed') => {
        if (!view.enabled) { throw createFlibError('anki_note_failed', null, {detail: 'AnkiConnect not enabled'}); }
        try {
            return await withPhraseTimeout((signal) => request(view.withSignal(signal)), timeoutMs);
        } catch (e) {
            throw createRequestError(e, view.server !== server, otherCode);
        }
    };
}

/**
 * @param {Run} run
 * @param {number} noteId
 * @returns {Promise<?import('anki').NoteInfo>} null — there is no such note.
 */
async function readNote(run, noteId) {
    const infos = await run((anki) => anki.notesInfo([noteId]));
    return infos.find((info) => info?.noteId === noteId) ?? null;
}

/**
 * @param {Run} run
 * @param {number} noteId
 * @param {string} name
 * @returns {Promise<string>} The field of a phrase note as it is in Anki now.
 * @throws {Error} anki_note_gone (deleted, or of another type) / anki_model_outdated
 */
export async function readPhraseField(run, noteId, name) {
    const info = await readNote(run, noteId);
    if (info === null || !isPhraseNote(info)) { throw createFlibError('anki_note_gone'); }
    const value = getField(info, name);
    if (value === null) { throw createFlibError('anki_model_outdated', null, {detail: name}); }
    return value;
}

export class FlibPhraseNotes {
    /**
     * @param {object} details
     * @param {import('../comm/anki-connect.js').AnkiConnect} details.anki Any client: the work goes through pinned views of it.
     * @param {(existing: string, added: string) => (string|Promise<string>)} details.mergeMedia `mergeFlibMediaFieldHtml` where there is a DOM.
     * @param {?(() => void)} [details.keepAlive] Called again and again during the work: the worker must not stop between two requests.
     * @param {number} [details.keepAliveMs]
     * @param {number} [details.timeoutMs] Of one request.
     */
    constructor({anki, mergeMedia, keepAlive = null, keepAliveMs = 20_000, timeoutMs = PHRASE_REQUEST_TIMEOUT_MS}) {
        /** @type {import('../comm/anki-connect.js').AnkiConnect} */
        this._anki = anki;
        /** @type {(existing: string, added: string) => (string|Promise<string>)} */
        this._mergeMedia = mergeMedia;
        /** @type {?(() => void)} */
        this._keepAlive = keepAlive;
        /** @type {number} */
        this._keepAliveMs = keepAliveMs;
        /** @type {number} */
        this._timeoutMs = timeoutMs;
        /** @type {Map<string, Promise<unknown>>} The last work of every key. */
        this._locks = new Map();
    }

    /**
     * @param {FindParams} params
     * @returns {Promise<import('api').ApiReturn<'flibPhraseFind'>>}
     * @throws {Error} flib_bad_request / anki_route_switched / anki_closed / anki_note_failed
     */
    async find(params) {
        requireValid(isObjectNotArray(params));
        const {server, deckName, front, englishWord} = params;
        requireValid(isText(deckName, MAX_TEXT_LENGTH) && isText(front, MAX_TEXT_LENGTH) && isText(englishWord, MAX_TEXT_LENGTH));
        return await this._work(async () => {
            const noteIds = await this._find(createPhraseRun(this._anki, server, this._timeoutMs), {server, deckName, front, englishWord});
            requirePhraseServer(this._anki, server);
            return {noteIds};
        });
    }

    /**
     * @param {AddParams} params
     * @returns {Promise<import('api').ApiReturn<'flibPhraseAdd'>>}
     * @throws {Error} As `find`, also anki_model_outdated / anki_deck_failed
     */
    async add(params) {
        requireValid(isObjectNotArray(params));
        const {server} = params;
        const note = createNote(params);
        const {deckName, fields: {Front: front, EnglishWord: englishWord}} = note;
        /** @type {FindParams} */
        const card = {server, deckName, front, englishWord};
        const key = JSON.stringify(['add', server, deckName.toLowerCase(), front, englishWord]).normalize('NFC');
        return await this._workInTurn(key, async () => {
            const run = createPhraseRun(this._anki, server, this._timeoutMs);
            const [existing] = await this._find(run, card);
            requirePhraseServer(this._anki, server);
            if (typeof existing !== 'undefined') { return {noteId: existing, existed: true}; }
            await this._requireFields(run, Object.keys(note.fields));
            await this._ensureDeck(run, deckName);
            return {noteId: await this._addNote(run, card, note), existed: false};
        });
    }

    /**
     * @param {UpdateMediaParams} params
     * @returns {Promise<import('api').ApiReturn<'flibPhraseUpdateMedia'>>}
     * @throws {Error} As `find`, also anki_note_gone / anki_model_outdated
     */
    async updateMedia(params) {
        requireValid(isObjectNotArray(params));
        const {server, noteId, deckName, html} = params;
        requireValid(Number.isSafeInteger(noteId) && noteId > 0 && isText(deckName, MAX_TEXT_LENGTH) && isText(html, MAX_FIELD_LENGTH));
        return await this._workInTurn(JSON.stringify(['media', server, noteId]), async () => {
            const run = createPhraseRun(this._anki, server, this._timeoutMs);
            const existing = await this._readMedia(run, noteId, deckName);
            const merged = await this._merge(existing, html);
            if (merged !== existing) {
                await run((anki) => updateEnrichedFields(anki, noteId, {[FLIB_MEDIA_FIELD_NAME]: merged}));
            }
            return {};
        });
    }

    // Private

    /**
     * ⚠️ Every candidate is read: a Front as `I _____` matches any number of other cards, and a card that is not
     * found is added again.
     * @param {Run} run
     * @param {FindParams} card
     * @returns {Promise<import('anki').NoteId[]>} The oldest first.
     */
    async _find(run, card) {
        /** @type {Set<import('anki').NoteId>} */
        const known = new Set();
        for (const [i, query] of createQueries(card).entries()) {
            const found = (await run((anki) => anki.findNotes(query))).filter((id) => !known.has(id)).sort((a, b) => a - b);
            // The newest: their ids are the time of creation.
            const candidates = i === 0 ? found : found.slice(-MAX_SECOND_CANDIDATES);
            /** @type {import('anki').NoteId[]} */
            const result = [];
            for (let start = 0; start < candidates.length; start += BATCH_SIZE) {
                const batch = candidates.slice(start, start + BATCH_SIZE);
                for (const info of await run((anki) => anki.notesInfo(batch))) {
                    if (info !== null && isSameCard(info, card)) { result.push(info.noteId); }
                }
            }
            if (result.length > 0) { return result; }
            for (const id of candidates) { known.add(id); }
        }
        return [];
    }

    /**
     * ⚠️ AnkiConnect drops the fields that the type does not have and says nothing.
     * @param {Run} run
     * @param {string[]} names
     * @throws {Error} anki_model_outdated
     */
    async _requireFields(run, names) {
        const modelFields = await run((anki) => anki.getModelFieldNames(FLIB_PHRASES_MODEL));
        const missing = names.filter((name) => !modelFields.includes(name));
        if (missing.length > 0) { throw createFlibError('anki_model_outdated', null, {detail: missing.join(', ')}); }
    }

    /**
     * @param {Run} run
     * @param {string} deckName
     * @throws {Error} anki_deck_failed
     */
    async _ensureDeck(run, deckName) {
        const names = await run((anki) => anki.getDeckNames());
        // Anki tells decks apart without letter case.
        if (names.some((name) => name.toLowerCase() === deckName.toLowerCase())) { return; }
        const id = await run((anki) => anki.createDeck(deckName), 'anki_deck_failed');
        if (id === null) { throw createFlibError('anki_deck_failed', null, {detail: deckName}); }
    }

    /**
     * ⚠️ A note whose answer was lost (a timeout, a broken connection, 502 of Core after it had passed the request on)
     * is in the collection: it is looked for before a failure is reported, or the next press would make a second one.
     * It was not there a moment ago, so what is found is ours.
     * @param {Run} run
     * @param {FindParams} card
     * @param {import('anki').Note} note
     * @returns {Promise<import('anki').NoteId>}
     */
    async _addNote(run, card, note) {
        try {
            const noteId = await run((anki) => anki.addNote(note));
            if (noteId !== null) { return noteId; }
            throw createFlibError('anki_note_failed', null, {detail: 'addNote: null'});
        } catch (e) {
            // At another address (the route switched) nothing is looked for: it may be another collection.
            const [landed] = await this._find(run, card).catch(() => []);
            if (typeof landed !== 'undefined') { return landed; }
            throw e;
        }
    }

    /**
     * @param {Run} run
     * @param {number} noteId
     * @param {string} deckName
     * @returns {Promise<string>} `flib_media` as it is in Anki now.
     * @throws {Error} anki_note_gone / anki_model_outdated
     */
    async _readMedia(run, noteId, deckName) {
        let found;
        try {
            found = await run((anki) => anki.findNotesInDeck([noteId], deckName, FLIB_PHRASES_MODEL));
        } catch (e) {
            // A deleted note looks there like a server that cannot search.
            if (getFlibErrorCode(e) === 'anki_note_failed' && await readNote(run, noteId) === null) { throw createFlibError('anki_note_gone'); }
            throw e;
        }
        if (!found.includes(noteId)) { throw createFlibError('anki_note_gone'); }
        return await readPhraseField(run, noteId, FLIB_MEDIA_FIELD_NAME);
    }

    /**
     * @param {string} existing
     * @param {string} added
     * @returns {Promise<string>}
     * @throws {Error} anki_note_failed: nothing may be written then.
     */
    async _merge(existing, added) {
        /** @type {unknown} */
        let merged;
        try {
            merged = await withPhraseTimeout(async () => await this._mergeMedia(existing, added), this._timeoutMs);
        } catch (e) {
            throw createRequestError(e, false, 'anki_note_failed');
        }
        // Whoever merged: what is in the field stays there byte for byte.
        const isKept = typeof merged === 'string' && (existing.trim() === '' || merged.startsWith(existing) || merged.endsWith(existing));
        if (!isKept) { throw createFlibError('anki_note_failed', null, {detail: FLIB_MEDIA_FIELD_NAME}); }
        return /** @type {string} */ (merged);
    }

    /**
     * @template [T=unknown]
     * @param {() => Promise<T>} task
     * @returns {Promise<T>}
     */
    async _work(task) {
        return await runKeptAlive(task, {keepAlive: this._keepAlive, keepAliveMs: this._keepAliveMs});
    }

    /**
     * One work of a key at a time, in the order of the calls, whatever the previous ones ended with.
     * @template [T=unknown]
     * @param {string} key
     * @param {() => Promise<T>} task
     * @returns {Promise<T>}
     */
    async _workInTurn(key, task) {
        const work = () => this._work(task);
        const current = (this._locks.get(key) ?? Promise.resolve()).then(work, work);
        this._locks.set(key, current);
        try {
            return await current;
        } finally {
            if (this._locks.get(key) === current) { this._locks.delete(key); }
        }
    }
}
