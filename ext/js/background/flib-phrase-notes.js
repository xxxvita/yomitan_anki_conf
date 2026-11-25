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
import {isAnkiClosedError, requirePhraseServer} from './flib-phrase-model.js';

/*
 * Phrase notes in Anki: found, added, given videos. The note type is prepared before by flib-phrase-model.js.
 *
 * ⚠️ Every request goes through `withoutFallback()` and belongs to the address that was prepared: the client repeats
 * a failed read (and `updateNoteFields`) on another route by itself, so the address is compared around every request.
 */

/** Most candidates of one search that are read and compared. */
const MAX_CANDIDATES = 200;
/** Longest Front and EnglishWord: a phrase is at most 5000 characters, cleaning and the blank add little. */
const MAX_TEXT_LENGTH = 20_000;
/** Longest field, in practice `flib_media`: its clips are files, the field has their subtitles. */
const MAX_FIELD_LENGTH = 2 * 1024 * 1024;

/**
 * @typedef {import('api').ApiParams<'flibPhraseFind'>} FindParams
 * @typedef {import('api').ApiParams<'flibPhraseAdd'>} AddParams
 * @typedef {import('api').ApiParams<'flibPhraseUpdateMedia'>} UpdateMediaParams
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
 * @param {number} maxLength
 * @returns {boolean}
 */
function isText(value, maxLength) {
    return typeof value === 'string' && value.length <= maxLength && value.trim() !== '';
}

/**
 * Every run of other characters becomes a wildcard: in the stored HTML it may be an entity (`&#39;`, `&nbsp;`), and
 * nothing of it can be search syntax. The candidates are compared exactly afterwards.
 * @param {string} front
 * @returns {string}
 */
function createFrontPattern(front) {
    // NFC, as Anki stores it: `e` of a decomposed `é` is not there.
    return front.normalize('NFC').replace(/[^A-Za-z0-9]+/g, '*');
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
 * @param {unknown} error
 * @param {boolean} routeSwitched The address changed during the request.
 * @param {string} otherCode The code of any other error.
 * @returns {Error} With a code and without the request: the error of AnkiConnect carries the text of the note.
 */
function createRequestError(error, routeSwitched, otherCode) {
    const detail = error instanceof Error ? error.message : String(error);
    const {code, apiError} = /** @type {{code?: unknown, apiError?: unknown}} */ ((error instanceof ExtensionError ? error.data : null) ?? {});
    const answer = typeof apiError === 'string' ? apiError.toLowerCase() : '';
    let result = otherCode;
    if (code === ANKI_ROUTE_SWITCHED_CODE) {
        result = ANKI_ROUTE_SWITCHED_CODE;
    } else if (isAnkiClosedError(error)) {
        // Also when the address changed: nobody is at the new one either.
        result = 'anki_closed';
    } else if (routeSwitched) {
        result = ANKI_ROUTE_SWITCHED_CODE;
    } else if (answer.includes('model was not found')) {
        result = 'anki_model_outdated';
    } else if (answer.includes('deck was not found')) {
        result = 'anki_deck_failed';
    }
    return createFlibError(result, null, {detail});
}

/**
 * @param {unknown} params
 * @returns {import('anki').Note}
 * @throws {Error} flib_bad_request
 */
function createNote(params) {
    const {deckName, fields, tags} = /** @type {{deckName: unknown, fields: unknown, tags: unknown}} */ (params);
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

export class FlibPhraseNotes {
    /**
     * @param {object} details
     * @param {import('../comm/anki-connect.js').AnkiConnect} details.anki Any client: the work goes through its `withoutFallback()`.
     * @param {(existing: string, added: string) => (string|Promise<string>)} details.mergeMedia `mergeFlibMediaFieldHtml` where there is a DOM.
     * @param {?(() => void)} [details.keepAlive] Called again and again during the work: the worker must not stop between two requests.
     * @param {number} [details.keepAliveMs]
     * @param {number} [details.timeoutMs] Of one request: an Anki that hangs must not hold the next press.
     */
    constructor({anki, mergeMedia, keepAlive = null, keepAliveMs = 20_000, timeoutMs = 15_000}) {
        /** @type {import('../comm/anki-connect.js').AnkiConnect} */
        this._anki = anki.withoutFallback();
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
    async find({server, deckName, front, englishWord}) {
        requireValid(isText(deckName, MAX_TEXT_LENGTH) && isText(front, MAX_TEXT_LENGTH) && isText(englishWord, MAX_TEXT_LENGTH));
        return await this._work(async () => ({noteIds: await this._find({server, deckName, front, englishWord})}));
    }

    /**
     * @param {AddParams} params
     * @returns {Promise<import('api').ApiReturn<'flibPhraseAdd'>>}
     * @throws {Error} As `find`, also anki_model_outdated / anki_deck_failed
     */
    async add(params) {
        const {server} = params;
        const note = createNote(params);
        const {deckName, fields: {Front: front, EnglishWord: englishWord}} = note;
        /** @type {FindParams} */
        const card = {server, deckName, front, englishWord};
        const key = JSON.stringify(['add', server, deckName.toLowerCase(), front, englishWord]).normalize('NFC');
        return await this._workInTurn(key, async () => {
            const [existing] = await this._find(card);
            if (typeof existing !== 'undefined') { return {noteId: existing, existed: true}; }
            await this._requireFields(server, Object.keys(note.fields));
            await this._ensureDeck(server, deckName);
            return {noteId: await this._addNote(card, note), existed: false};
        });
    }

    /**
     * @param {UpdateMediaParams} params
     * @returns {Promise<import('api').ApiReturn<'flibPhraseUpdateMedia'>>}
     * @throws {Error} As `find`, also anki_note_gone / anki_model_outdated
     */
    async updateMedia({server, noteId, deckName, html}) {
        requireValid(Number.isSafeInteger(noteId) && noteId > 0 && isText(deckName, MAX_TEXT_LENGTH) && isText(html, MAX_FIELD_LENGTH));
        return await this._workInTurn(JSON.stringify(['media', server, noteId]), async () => {
            const existing = await this._readMedia(server, noteId, deckName);
            const merged = await this._merge(existing, html);
            if (merged !== existing) {
                // The type of the client is wider than the request of AnkiConnect.
                const note = /** @type {import('anki').Note} */ (/** @type {unknown} */ ({id: noteId, fields: {[FLIB_MEDIA_FIELD_NAME]: merged}}));
                await this._request(server, (anki) => anki.updateNoteFields(note));
            }
            return {};
        });
    }

    // Private

    /**
     * @param {FindParams} card
     * @returns {Promise<import('anki').NoteId[]>} The oldest first.
     */
    async _find({server, deckName, front, englishWord}) {
        const query = `"note:${FLIB_PHRASES_MODEL}" ${createDeckSearchTerm(deckName)} "front:${createFrontPattern(front)}"`;
        const found = await this._request(server, (anki) => anki.findNotes(query));
        if (found.length === 0) { return []; }
        const candidates = found.sort((a, b) => a - b).slice(0, MAX_CANDIDATES);
        const infos = await this._request(server, (anki) => anki.notesInfo(candidates));
        /** @type {import('anki').NoteId[]} */
        const result = [];
        for (const info of infos) {
            if (info === null || !isPhraseNote(info)) { continue; }
            const Front = getField(info, 'Front');
            const EnglishWord = getField(info, 'EnglishWord');
            if (Front === null || EnglishWord === null) { continue; }
            if (samePhraseNote({Front, EnglishWord}, {Front: front, EnglishWord: englishWord})) { result.push(info.noteId); }
        }
        return result.sort((a, b) => a - b);
    }

    /**
     * ⚠️ AnkiConnect drops the fields that the type does not have and says nothing.
     * @param {string} server
     * @param {string[]} names
     * @throws {Error} anki_model_outdated
     */
    async _requireFields(server, names) {
        const modelFields = await this._request(server, (anki) => anki.getModelFieldNames(FLIB_PHRASES_MODEL));
        const missing = names.filter((name) => !modelFields.includes(name));
        if (missing.length > 0) { throw createFlibError('anki_model_outdated', null, {detail: missing.join(', ')}); }
    }

    /**
     * @param {string} server
     * @param {string} deckName
     * @throws {Error} anki_deck_failed
     */
    async _ensureDeck(server, deckName) {
        const names = await this._request(server, (anki) => anki.getDeckNames());
        // Anki tells decks apart without letter case.
        if (names.some((name) => name.toLowerCase() === deckName.toLowerCase())) { return; }
        const id = await this._request(server, (anki) => anki.createDeck(deckName), {otherCode: 'anki_deck_failed'});
        if (id === null) { throw createFlibError('anki_deck_failed', null, {detail: deckName}); }
    }

    /**
     * ⚠️ A note whose answer was lost (a timeout, a broken connection, 502 of Core after it had passed the request on)
     * is in the collection: it is looked for before a failure is reported, or the next press would make a second one.
     * It was not there a moment ago, so what is found is ours.
     * @param {FindParams} card
     * @param {import('anki').Note} note
     * @returns {Promise<import('anki').NoteId>}
     */
    async _addNote(card, note) {
        try {
            const noteId = await this._request(card.server, (anki) => anki.addNote(note), {checkAfter: false});
            if (noteId !== null) { return noteId; }
            throw createFlibError('anki_note_failed', null, {detail: 'addNote: null'});
        } catch (e) {
            // On another address (the route switched) nothing is looked for: it may be another collection.
            const [landed] = await this._find(card).catch(() => []);
            if (typeof landed !== 'undefined') { return landed; }
            throw e;
        }
    }

    /**
     * @param {string} server
     * @param {number} noteId
     * @param {string} deckName
     * @returns {Promise<string>} `flib_media` as it is in Anki now.
     * @throws {Error} anki_note_gone / anki_model_outdated
     */
    async _readMedia(server, noteId, deckName) {
        let found;
        try {
            found = await this._request(server, (anki) => anki.findNotesInDeck([noteId], deckName, FLIB_PHRASES_MODEL));
        } catch (e) {
            // A deleted note looks there like a server that cannot search.
            if (getFlibErrorCode(e) === 'anki_note_failed' && await this._readNote(server, noteId) === null) { throw createFlibError('anki_note_gone'); }
            throw e;
        }
        if (!found.includes(noteId)) { throw createFlibError('anki_note_gone'); }
        const info = await this._readNote(server, noteId);
        if (info === null || !isPhraseNote(info)) { throw createFlibError('anki_note_gone'); }
        const value = getField(info, FLIB_MEDIA_FIELD_NAME);
        if (value === null) { throw createFlibError('anki_model_outdated', null, {detail: FLIB_MEDIA_FIELD_NAME}); }
        return value;
    }

    /**
     * @param {string} server
     * @param {number} noteId
     * @returns {Promise<?import('anki').NoteInfo>} null — there is no such note.
     */
    async _readNote(server, noteId) {
        const infos = await this._request(server, (anki) => anki.notesInfo([noteId]));
        return infos.find((info) => info?.noteId === noteId) ?? null;
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
            merged = await this._withTimeout(Promise.resolve(this._mergeMedia(existing, added)));
        } catch (e) {
            throw createRequestError(e, false, 'anki_note_failed');
        }
        if (typeof merged !== 'string') { throw createFlibError('anki_note_failed', null, {detail: FLIB_MEDIA_FIELD_NAME}); }
        return merged;
    }

    /**
     * @param {string} server
     * @throws {Error}
     */
    _check(server) {
        // Off, the client answers with an empty list or a write that did not happen.
        if (!this._anki.enabled) { throw createFlibError('anki_note_failed', null, {detail: 'AnkiConnect not enabled'}); }
        requirePhraseServer(this._anki, server);
    }

    /**
     * @template [T=unknown]
     * @param {string} server
     * @param {(anki: import('../comm/anki-connect.js').AnkiConnect) => Promise<T>} request
     * @param {{checkAfter?: boolean, otherCode?: string}} [options] checkAfter false — for a write that the client never repeats: its answer is true.
     * @returns {Promise<T>}
     * @throws {Error}
     */
    async _request(server, request, {checkAfter = true, otherCode = 'anki_note_failed'} = {}) {
        this._check(server);
        let result;
        try {
            result = await this._withTimeout(request(this._anki));
        } catch (e) {
            throw createRequestError(e, this._anki.server !== server, otherCode);
        }
        if (checkAfter) { this._check(server); }
        return result;
    }

    /**
     * @template [T=unknown]
     * @param {Promise<T>} promise
     * @returns {Promise<T>}
     */
    async _withTimeout(promise) {
        /** @type {?import('core').Timeout} */
        let timer = null;
        /** @type {Promise<never>} */
        const timeout = new Promise((_resolve, reject) => {
            timer = setTimeout(() => { reject(new Error(`No answer in ${this._timeoutMs} ms`)); }, this._timeoutMs);
        });
        try {
            return await Promise.race([promise, timeout]);
        } finally {
            if (timer !== null) { clearTimeout(timer); }
        }
    }

    /**
     * @template [T=unknown]
     * @param {() => Promise<T>} task
     * @returns {Promise<T>}
     */
    async _work(task) {
        const timer = this._keepAlive === null ? null : setInterval(() => { this._keepAlive?.(); }, this._keepAliveMs);
        try {
            return await task();
        } finally {
            if (timer !== null) { clearInterval(timer); }
        }
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
