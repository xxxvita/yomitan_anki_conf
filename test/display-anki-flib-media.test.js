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

/* eslint-disable no-underscore-dangle, @typescript-eslint/unbound-method */

import {afterEach, describe, expect, test, vi} from 'vitest';
import {ExtensionError} from '../ext/js/core/extension-error.js';
import {log} from '../ext/js/core/log.js';
import {computeAutoTags} from '../ext/js/data/url-tags.js';
import {ClipTranscodeError, flibMediaFileName} from '../ext/js/display/clip-transcode-util.js';
import {DisplayAnki} from '../ext/js/display/display-anki.js';
import {GatewayClipWaitError} from '../ext/js/display/gateway-anki-media.js';
import {setUiLanguage} from '../ext/js/i18n/ui-language.js';

const REF = 'dQw4w9WgXcQ';
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 9, 9]);
/** The player of the ticked YouTube example, from its start to its end (plus the margin). */
const PLAYER_START = `<iframe class="flib-yt-player" src="https://www.youtube-nocookie.com/embed/${REF}?start=4&amp;end=9&amp;rel=0"`;
const OLD_FIELD = '<div class="flib-clip">old</div>';
/** @type {Record<string, string>} */
const OLD_FIELDS = {Front: 'old front', flib_media: OLD_FIELD};

/**
 * The record of a saved note, as AnkiConnect gives it.
 * @param {number} noteId
 * @param {Record<string, string>} [fields]
 * @returns {{noteId: number, fields: Record<string, {value: string, order: number}>}}
 */
function noteInfo(noteId, fields = OLD_FIELDS) {
    return {noteId, fields: Object.fromEntries(Object.entries(fields).map(([key, value], order) => [key, {value, order}]))};
}

/**
 * @param {string} code
 * @returns {ExtensionError}
 */
function codedError(code) {
    const error = new ExtensionError(code);
    error.data = {code};
    return error;
}

/**
 * @param {string} clipId
 * @returns {import('gateway-anki-media').GatewayFilmMedia}
 */
function filmMedia(clipId) {
    return {
        clipId,
        blob: new Blob(['mp4'], {type: 'video/mp4'}),
        leadTrimSec: 0.5,
        trimDurationSec: 3,
        videoWidth: 640,
        videoHeight: 360,
        durationSec: 5,
        vttText: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\n<c.hl>run</c>\n\n',
        title: 'Heat',
        year: 1995,
        imdbUrl: 'https://www.imdb.com/title/tt0113277/',
    };
}

/**
 * @typedef {object} ContextOptions
 * @property {boolean} [overwrite]
 * @property {string[]} [films]
 * @property {boolean} [youtube]
 * @property {boolean|Error} [hasField]
 * @property {import('vitest').Mock} [transcode]
 * @property {(clipId: string) => (import('gateway-anki-media').GatewayFilmMedia|Promise<import('gateway-anki-media').GatewayFilmMedia>)} [media] What the panel captured for a film.
 * @property {import('vitest').Mock<(note: import('anki').Note) => Promise<?number>>} [addAnkiNote]
 * @property {(name: string) => unknown} [store]
 * @property {string} [userAgent]
 * @property {import('anki').NoteFields} [noteFields]
 */

// eslint-disable-next-line jsdoc/require-returns -- the inferred shape is what the tests use
/**
 * A plain object carrying only what `_saveAnkiNote` and the flib_media hook touch (same technique as
 * test/anki-add-event.test.js), with the REAL `_applySelectedGatewayMediaToNote`, `_addNewAnkiNote`,
 * `_updateAnkiNote` and `_getOverwrittenNote`, and fakes for the transcoder and the backend API.
 * @param {ContextOptions} [options]
 */
function createContext({overwrite = false, films = ['c1'], youtube = true, hasField = true, transcode, media = filmMedia, addAnkiNote, store, userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36', noteFields} = {}) {
    vi.stubGlobal('navigator', {userAgent});
    /** @type {string[]} */
    const calls = [];
    /** @type {{texts: string[], finished: boolean[], update: import('vitest').Mock, finish: import('vitest').Mock}[]} */
    const statuses = [];
    const entry = /** @type {HTMLElement} */ (/** @type {unknown} */ ({id: 'entry', isConnected: true}));
    const panel = {
        root: {isConnected: true},
        getSelectedClipIds: () => [],
        getSelectedGatewayMedia: vi.fn((/** @type {{signal?: AbortSignal}} */ _options = {}) => ({
            films: films.map((clipId) => {
                const captured = media(clipId);
                // As the real panel: a wait nobody came to collect is not an unhandled rejection.
                if (captured instanceof Promise) { captured.catch(() => {}); }
                return {clipId, media: captured};
            }),
            youtube: youtube ? [{key: '0', ref: REF, startMs: 4200, endMs: 6900, text: 'we run', words: ['run']}] : [],
        })),
        clearSelection: vi.fn(),
        beginSaveStatus: vi.fn(() => {
            const handle = {
                /** @type {string[]} */
                texts: [],
                /** @type {boolean[]} */
                finished: [],
                update: vi.fn((/** @type {string} */ text) => { handle.texts.push(text); }),
                finish: vi.fn((/** @type {boolean} */ saved) => { handle.finished.push(saved); }),
            };
            statuses.push(handle);
            return handle;
        }),
        /** @type {?('user'|'content')} */
        destroyReason: null,
    };
    const button = {
        disabled: false,
        dataset: overwrite ? {overwrite: '1'} : {},
        title: 'Add expression',
        classList: new Set(),
    };
    /** @type {{disabled: boolean}[]} Every button handed to _saveAnkiNote (one copy per call). */
    const buttons = [];
    const buttonClassList = {
        add: vi.fn((/** @type {string} */ c) => { button.classList.add(c); }),
        remove: vi.fn((/** @type {string} */ c) => { button.classList.delete(c); }),
        contains: (/** @type {string} */ c) => button.classList.has(c),
    };
    const api = {
        flibAnkiModelHasField: vi.fn(async () => {
            calls.push('hasField');
            if (hasField instanceof Error) { throw hasField; }
            return hasField;
        }),
        flibStoreAnkiMedia: vi.fn(async (/** @type {string} */ fileName) => {
            calls.push(`store:${fileName}`);
            return typeof store === 'function' ? store(fileName) : {fileName};
        }),
        addAnkiNote: addAnkiNote ?? vi.fn(async (/** @type {import('anki').Note} */ _note) => {
            calls.push('addNote');
            return 123;
        }),
        updateAnkiNote: vi.fn(async (/** @type {import('anki').NoteWithId} */ _note) => { calls.push('updateNote'); }),
        getAnkiNotesInfoByIds: vi.fn(async () => /** @type {(?ReturnType<typeof noteInfo>)[]} */ ([noteInfo(77)])),
        flibRecordEvent: vi.fn(async () => true),
    };
    const transcodeFn = transcode ?? vi.fn(async () => {
        calls.push('transcode');
        return WEBM;
    });
    const probe = vi.fn(async () => ({vp9Supported: true, vp8Supported: true, opusSupported: true}));
    const note = {
        deckName: 'D',
        modelName: 'Yomitan Card Type',
        fields: {Front: 'run', ...noteFields},
        tags: [],
        options: {},
    };
    const context = {
        _display: {
            dictionaryEntries: [{type: 'term', headwords: [{term: 'run'}]}],
            progressIndicatorVisible: {setOverride: vi.fn(() => 'token'), clearOverride: vi.fn()},
            application: {api},
            getOptions: vi.fn(() => ({flibService: {}})),
        },
        _gatewaySaves: new Set(),
        _captureSaveSettings: DisplayAnki.prototype._captureSaveSettings,
        _releaseGatewaySnapshot: DisplayAnki.prototype._releaseGatewaySnapshot,
        _isAdditionalInfoEnabled: vi.fn(() => false),
        _dictionaryEntryDetails: [{noteMap: new Map([[0, {requirements: []}], [1, {requirements: []}]])}],
        _duplicateBehavior: 'prevent',
        _videoExamplesPanels: new Map([[entry, panel]]),
        _savingNotes: new Map(),
        // Оформление кнопки карточки Flib-club сохранения не меняет.
        _applyCardFormatUi: vi.fn(),
        _hasNotes: vi.fn(() => false),
        _lastSaved: new WeakMap(),
        _collectExtraTags: vi.fn(() => []),
        _saveAnkiNoteClaimed: DisplayAnki.prototype._saveAnkiNoteClaimed,
        _decideEnrichment: async () => ({action: 'none', cards: {reverse: true, phrases: true}}),
        _flibMediaDeps: {probeEncoderSupport: probe, transcodeClipToWebm: transcodeFn},
        _saveButtonFind: vi.fn(() => {
            const copy = {
                ...button,
                classList: buttonClassList,
                get title() { return button.title; },
                set title(v) { button.title = v; },
            };
            buttons.push(copy);
            return copy;
        }),
        _hideErrorNotification: vi.fn(),
        _showErrorNotification: vi.fn(),
        _createNote: vi.fn(async () => ({note: structuredClone(note), errors: [], requirements: []})),
        _getAddNoteRequirementsError: vi.fn(() => null),
        _applyExtraTagsToNote: vi.fn(),
        _getEntry: vi.fn(() => entry),
        _applySelectedClipsToNote: vi.fn(async () => null),
        _applySelectedGatewayMediaToNote: DisplayAnki.prototype._applySelectedGatewayMediaToNote,
        _takeGatewaySnapshot: DisplayAnki.prototype._takeGatewaySnapshot,
        _getOverwrittenNote: DisplayAnki.prototype._getOverwrittenNote,
        _getExistingNoteField: DisplayAnki.prototype._getExistingNoteField,
        _getOverwrittenField: DisplayAnki.prototype._getOverwrittenField,
        _getDictionaryEntryDetails: vi.fn(async () => [{
            noteMap: new Map([[0, {
                noteIds: [77],
                noteInfos: [noteInfo(77)],
            }]]),
        }]),
        /** @type {{fields: Record<string, {value: string, overwriteMode: string}>}[]} */
        _cardFormats: [{fields: {Front: {value: '{expression}', overwriteMode: 'coalesce'}}}],
        _updateAnkiNote: DisplayAnki.prototype._updateAnkiNote,
        _addNewAnkiNote: DisplayAnki.prototype._addNewAnkiNote,
        _suspendNewCards: false,
        _forceSync: false,
        _getCardFormatIndex: vi.fn(() => 0),
        _updateSaveButtonForDuplicateBehavior: vi.fn(),
        _updateViewNoteButton: vi.fn(),
        _clearSavedGatewaySelection: DisplayAnki.prototype._clearSavedGatewaySelection,
    };
    const save = (cardFormatIndex = 0) => DisplayAnki.prototype._saveAnkiNote.call(context, 0, cardFormatIndex);
    return {context, entry, api, calls, panel, button, buttons, buttonClassList, probe, transcode: transcodeFn, save, statuses};
}

/**
 * @param {ReturnType<typeof createContext>} ctx
 * @returns {string[]}
 */
function shownErrors(ctx) {
    return ctx.context._showErrorNotification.mock.calls.flatMap((c) => c[0].map((/** @type {Error} */ e) => e.message));
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

describe('DisplayAnki#_saveAnkiNote + flib_media', () => {
    test('edge 11: nothing ticked → no flib call, field untouched, addNote as before', async () => {
        const ctx = createContext({films: [], youtube: false});
        await ctx.save();
        expect(ctx.api.flibAnkiModelHasField).not.toHaveBeenCalled();
        expect(ctx.probe).not.toHaveBeenCalled();
        expect(ctx.calls).toStrictEqual(['addNote']);
        const note = ctx.api.addAnkiNote.mock.calls[0][0];
        expect(Object.hasOwn(note.fields, 'flib_media')).toBe(false);
    });

    test('order hasField → transcode → store → addNote; the added note carries the field HTML', async () => {
        const ctx = createContext();
        await ctx.save();
        const name = await flibMediaFileName(WEBM);
        expect(ctx.calls).toStrictEqual(['hasField', 'transcode', `store:${name}`, 'addNote']);
        const note = ctx.api.addAnkiNote.mock.calls[0][0];
        expect(note.fields.flib_media).toContain(`src="${name}"`);
        expect(note.fields.flib_media).toContain(`watch?v=${REF}&amp;t=4s`);
        expect(note.fields.flib_media.match(/flib-yt-player/g)).toHaveLength(1);
        expect(note.fields.flib_media).toContain(PLAYER_START);
        expect(ctx.context._showErrorNotification).not.toHaveBeenCalled();
        expect(ctx.api.flibRecordEvent).not.toHaveBeenCalled();
    });

    test('edge 12: Firefox → transcoded as VP8; Chrome (even with a `browser` global) → VP9', async () => {
        const firefox = createContext({userAgent: 'Mozilla/5.0 (X11; Linux x86_64; rv:131.0) Gecko/20100101 Firefox/131.0'});
        await firefox.save();
        expect(firefox.transcode.mock.calls[0][1].settings.codec).toBe('vp8');
        vi.stubGlobal('browser', {});
        const chrome = createContext();
        await chrome.save();
        expect(chrome.transcode.mock.calls[0][1].settings.codec).toBe('vp9');
    });

    test('the transcode is tied to the save, not to the panel', async () => {
        const ctx = createContext();
        await ctx.save();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- mock calls of a generic Mock
        const {signal} = ctx.transcode.mock.calls[0][1];
        expect(signal).toBeInstanceOf(AbortSignal);
        expect(ctx.panel.getSelectedGatewayMedia.mock.calls[0][0]?.signal).toBe(signal);
    });

    test.each([
        [false, 'В типе заметки нет поля flib_media — обновите шаблон в Flibooster'],
        [codedError('flib_anki_unavailable'), 'Anki недоступен'],
        [codedError('flib_anki_model_unknown'), 'Тип заметки не найден в Anki'],
    ])('edge 6: hasField %s → «%s», nothing transcoded, no addNote', async (hasField, message) => {
        const ctx = createContext({hasField});
        await ctx.save();
        expect(ctx.transcode).not.toHaveBeenCalled();
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
        expect(shownErrors(ctx)).toStrictEqual([message]);
        expect(ctx.api.flibRecordEvent).not.toHaveBeenCalled();
    });

    test('a failed gateway save re-enables «+» even in duplicateBehavior=prevent (the 2.5 s timer already ran)', async () => {
        vi.useFakeTimers();
        try {
            const ctx = createContext({media: async () => {
                await new Promise((resolve) => { setTimeout(resolve, 5000); });
                throw new GatewayClipWaitError('timeout', 'x');
            }});
            const saving = ctx.save();
            await vi.advanceTimersByTimeAsync(6000);
            await saving;
            expect(shownErrors(ctx)).toStrictEqual(['Нарезка ещё не загрузилась']);
            expect(ctx.buttons[0].disabled).toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    test('edge 6 on the overwrite path: no updateNote, error shown', async () => {
        const ctx = createContext({overwrite: true, hasField: false});
        await ctx.save();
        expect(ctx.api.updateAnkiNote).not.toHaveBeenCalled();
        expect(ctx.context._getDictionaryEntryDetails).not.toHaveBeenCalled();
        expect(shownErrors(ctx)).toStrictEqual(['В типе заметки нет поля flib_media — обновите шаблон в Flibooster']);
    });

    test('edge 1: clip not ready → «Нарезка ещё не загрузилась», no addNote', async () => {
        const ctx = createContext({media: async () => { throw new GatewayClipWaitError('timeout', 'x'); }});
        await ctx.save();
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
        expect(ctx.api.flibStoreAnkiMedia).not.toHaveBeenCalled();
        expect(shownErrors(ctx)).toStrictEqual(['Нарезка ещё не загрузилась']);
    });

    test('edge 2: transcode fails → message, nothing stored, no addNote', async () => {
        const ctx = createContext({transcode: vi.fn(async () => { throw new ClipTranscodeError('worker-error', 'boom'); })});
        await ctx.save();
        expect(ctx.api.flibStoreAnkiMedia).not.toHaveBeenCalled();
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
        expect(shownErrors(ctx)[0]).toContain('перекодировать');
    });

    test('edge 5: media stored but addNote fails → addNote NOT retried, error shown', async () => {
        const addAnkiNote = vi.fn(async () => { throw new Error('cannot create note because it is a duplicate'); });
        const ctx = createContext({addAnkiNote});
        await ctx.save();
        expect(ctx.api.flibStoreAnkiMedia).toHaveBeenCalledTimes(1);
        expect(addAnkiNote).toHaveBeenCalledTimes(1);
        expect(shownErrors(ctx)).toStrictEqual(['cannot create note because it is a duplicate']);
    });

    test('edge 8: a store error with base64 → no base64 in the UI or the log', async () => {
        const payload = 'QUJD'.repeat(100);
        const logged = [vi.spyOn(log, 'log').mockImplementation(() => {}), vi.spyOn(log, 'warn').mockImplementation(() => {}), vi.spyOn(log, 'error').mockImplementation(() => {})];
        const ctx = createContext({store: () => { throw new ExtensionError(`failed {"data":"${payload}"}`); }});
        await ctx.save();
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
        expect(shownErrors(ctx).join(' ')).not.toContain(payload.slice(0, 48));
        expect(JSON.stringify(logged.flatMap((s) => s.mock.calls.map((c) => c.map(String))))).not.toContain(payload.slice(0, 48));
    });

    test('a different stored name → abort, no addNote', async () => {
        const ctx = createContext({store: () => ({fileName: 'flib-renamed.webm'})});
        await ctx.save();
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
        expect(shownErrors(ctx)[0]).toContain('Anki не сохранил видеофайл');
    });

    test('edge 10: overwrite writes the new selection into flib_media (even if not in the card format), keeping the saved examples', async () => {
        const ctx = createContext({overwrite: true});
        await ctx.save();
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
        const updated = /** @type {import('anki').NoteWithId} */ (/** @type {unknown} */ (ctx.api.updateAnkiNote.mock.calls[0][0]));
        expect(updated.id).toBe(77);
        expect(updated.fields.flib_media).toContain('<div class="flib-clip"><video');
        expect(updated.fields.flib_media).not.toBe(OLD_FIELD);
        // Карточка Flib-club: «В Anki · N видео» на существующей карточке ДОБАВЛЯЕТ видео.
        expect(updated.fields.flib_media.startsWith(OLD_FIELD)).toBe(true);
        expect(updated.fields.flib_media.match(/flib-yt-player/g)).toHaveLength(1);
        expect(updated.fields.flib_media).toContain(PLAYER_START);
    });

    test('edge 10: overwrite writes the selection even when the card format would coalesce flib_media', async () => {
        const ctx = createContext({overwrite: true, noteFields: {flib_media: ''}});
        ctx.context._cardFormats = [{fields: {Front: {value: '{expression}', overwriteMode: 'coalesce'}, flib_media: {value: '', overwriteMode: 'coalesce'}}}];
        await ctx.save();
        // The existing value is the non-empty OLD_FIELD: coalesce alone would keep it.
        const updated = /** @type {import('anki').NoteWithId} */ (/** @type {unknown} */ (ctx.api.updateAnkiNote.mock.calls[0][0]));
        expect(updated.fields.flib_media).not.toBe(OLD_FIELD);
        expect(updated.fields.flib_media).toContain('<video controls');
    });

    test('race: a slow _createNote and a second «+» after the 2.5 s re-enable → exactly one save, one addNote', async () => {
        const ctx = createContext({films: [], youtube: false});
        ctx.context._duplicateBehavior = 'new';
        /** @type {() => void} */
        let release = () => {};
        const slowNote = {deckName: 'D', modelName: 'Yomitan Card Type', fields: {Front: 'run'}, tags: [], options: {}};
        let calls = 0;
        ctx.context._createNote = vi.fn(() => new Promise((resolve) => {
            const value = {note: structuredClone(slowNote), errors: [], requirements: []};
            if (++calls > 1) {
                resolve(value);
                return;
            }
            release = () => { resolve(value); };
        }));
        const first = ctx.save();
        // Second «+» while the first is still inside _createNote (each call gets an enabled button copy).
        const second = ctx.save();
        release();
        await Promise.all([first, second]);
        expect(ctx.context._createNote).toHaveBeenCalledTimes(1);
        expect(ctx.api.addAnkiNote).toHaveBeenCalledTimes(1);
        expect(ctx.context._savingNotes.size).toBe(0);
        // Released: a later «+» saves again.
        await ctx.save();
        expect(ctx.context._createNote).toHaveBeenCalledTimes(2);
        expect(ctx.api.addAnkiNote).toHaveBeenCalledTimes(2);
    });

    /**
     * @param {ReturnType<typeof createContext>} ctx
     * @param {?string} newData What the Core hook writes when clips are ticked; null — nothing ticked.
     */
    const setupCoreOverwrite = (ctx, newData) => {
        ctx.context._applySelectedClipsToNote = vi.fn(async (/** @type {import('anki').Note} */ note) => {
            if (newData !== null) { note.fields.data = newData; }
            return null;
        });
        ctx.context._getDictionaryEntryDetails = vi.fn(async () => [{
            noteMap: new Map([[0, {
                noteIds: [77],
                noteInfos: [noteInfo(77, {Front: 'old front', data: '{"videos":["old"]}'})],
            }]]),
        }]);
    };

    test('overwrite with Core clips ticked (`data` not in the card format) → updateNoteFields gets the new data', async () => {
        const ctx = createContext({overwrite: true, films: [], youtube: false});
        setupCoreOverwrite(ctx, '{"videos":["new"]}');
        await ctx.save();
        const updated = /** @type {import('anki').NoteWithId} */ (/** @type {unknown} */ (ctx.api.updateAnkiNote.mock.calls[0][0]));
        expect(updated.fields.data).toBe('{"videos":["new"]}');
        expect(updated.fields.Front).toBe('old front');
        expect(shownErrors(ctx)).toStrictEqual([]);
    });

    test('overwrite with nothing ticked → no `data` key (the existing value stays in Anki)', async () => {
        const ctx = createContext({overwrite: true, films: [], youtube: false});
        setupCoreOverwrite(ctx, null);
        await ctx.save();
        const updated = /** @type {import('anki').NoteWithId} */ (/** @type {unknown} */ (ctx.api.updateAnkiNote.mock.calls[0][0]));
        expect(Object.hasOwn(updated.fields, 'data')).toBe(false);
    });

    test('a throwing selection snapshot releases the claim and shows the error', async () => {
        const ctx = createContext();
        ctx.panel.getSelectedGatewayMedia.mockImplementationOnce(() => { throw new Error('snapshot boom'); });
        await ctx.save();
        expect(ctx.context._savingNotes.size).toBe(0);
        expect(shownErrors(ctx)).toStrictEqual(['snapshot boom']);
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
        // «+» is not dead for this entry.
        await ctx.save();
        expect(ctx.api.addAnkiNote).toHaveBeenCalledTimes(1);
    });

    test('edge 10: overwrite with nothing ticked leaves the existing value', async () => {
        const ctx = createContext({overwrite: true, films: [], youtube: false});
        await ctx.save();
        const updated = /** @type {import('anki').NoteWithId} */ (/** @type {unknown} */ (ctx.api.updateAnkiNote.mock.calls[0][0]));
        expect(Object.hasOwn(updated.fields, 'flib_media')).toBe(false);
        expect(ctx.api.flibAnkiModelHasField).not.toHaveBeenCalled();
    });

    test('edge 7: the same clip saved twice → the same media name both times', async () => {
        const first = createContext();
        await first.save();
        const second = createContext();
        await second.save();
        expect(first.api.flibStoreAnkiMedia.mock.calls[0][0]).toBe(second.api.flibStoreAnkiMedia.mock.calls[0][0]);
    });

    test('progress on «+» while preparing, cleared afterwards; re-entry for the same entry is ignored', async () => {
        /** @type {(value: Uint8Array) => void} */
        let release = () => {};
        const transcode = vi.fn(() => new Promise((resolve) => { release = resolve; }));
        const ctx = createContext({transcode});
        const first = ctx.save();
        await vi.waitFor(() => expect(transcode).toHaveBeenCalledTimes(1));
        expect(ctx.buttonClassList.contains('flib-media-busy')).toBe(true);
        expect(ctx.button.title).toBe('Готовлю видео…');
        // A second «+» (button re-enabled by the 2.5 s timer, or the hotkey) while busy.
        await ctx.save();
        expect(ctx.context._createNote).toHaveBeenCalledTimes(1);
        release(WEBM);
        await first;
        expect(ctx.buttonClassList.contains('flib-media-busy')).toBe(false);
        expect(ctx.button.title).toBe('Add expression');
        expect(ctx.context._savingNotes.size).toBe(0);
        expect(ctx.api.addAnkiNote).toHaveBeenCalledTimes(1);
    });

    test('a Core panel (no gateway selection API) is ignored by the flib hook', async () => {
        const ctx = createContext();
        const entry = ctx.context._getEntry();
        ctx.context._videoExamplesPanels.set(entry, /** @type {any} */ ({root: {isConnected: true}, getSelectedClipIds: () => []}));
        await ctx.save();
        expect(ctx.api.flibAnkiModelHasField).not.toHaveBeenCalled();
        expect(ctx.api.addAnkiNote).toHaveBeenCalledTimes(1);
    });
});

describe('DisplayAnki: ticks cleared after a successful save + visible status (UX follow-up)', () => {
    test('add succeeds → exactly the snapshot items are cleared in the snapshot panel; status ends with success', async () => {
        const ctx = createContext();
        await ctx.save();
        expect(ctx.api.addAnkiNote).toHaveBeenCalledTimes(1);
        expect(ctx.panel.clearSelection).toHaveBeenCalledTimes(1);
        expect(ctx.panel.clearSelection.mock.calls[0][0]).toStrictEqual({
            films: [{clipId: 'c1', media: filmMedia('c1')}],
            youtube: [{key: '0', ref: REF, startMs: 4200, endMs: 6900, text: 'we run', words: ['run']}],
        });
        expect(ctx.statuses).toHaveLength(1);
        expect(ctx.statuses[0].finished).toStrictEqual([true]);
    });

    test('the cleared selection is the snapshot taken at «+», not what is ticked when the save ends', async () => {
        const ctx = createContext({films: ['c1']});
        const snapshotSelection = ctx.panel.getSelectedGatewayMedia();
        ctx.panel.getSelectedGatewayMedia.mockReturnValueOnce(snapshotSelection);
        // Ticked during the save: a later read would include c2.
        ctx.panel.getSelectedGatewayMedia.mockReturnValue({films: [{clipId: 'c1', media: filmMedia('c1')}, {clipId: 'c2', media: filmMedia('c2')}], youtube: []});
        await ctx.save();
        expect(ctx.panel.clearSelection.mock.calls[0][0]).toBe(snapshotSelection);
    });

    test.each([
        ['addNote throws', {addAnkiNote: vi.fn(async () => { throw new Error('duplicate'); })}],
        ['addNote returns null', {addAnkiNote: vi.fn(async () => null)}],
        ['the media save fails (no flib_media field)', {hasField: false}],
        ['the transcode fails', {transcode: vi.fn(async () => { throw new ClipTranscodeError('worker-error', 'boom'); })}],
    ])('%s → ticks kept, status finished without success', async (_name, options) => {
        const ctx = createContext(/** @type {ContextOptions} */ (options));
        await ctx.save();
        expect(ctx.panel.clearSelection).not.toHaveBeenCalled();
        expect(ctx.statuses[0].finished).toStrictEqual([false]);
    });

    test('the panel is destroyed DURING addNote (note added) → no clear call, no throw, no notification', async () => {
        const ctx = createContext();
        ctx.api.addAnkiNote.mockImplementation(async () => {
            ctx.panel.destroyReason = 'content';
            return 123;
        });
        await ctx.save();
        expect(ctx.api.addAnkiNote).toHaveBeenCalledTimes(1);
        expect(ctx.panel.clearSelection).not.toHaveBeenCalled();
        expect(ctx.context._showErrorNotification).not.toHaveBeenCalled();
    });

    test('a throwing clearSelection after a saved note is logged, never shown as a save error', async () => {
        const warn = vi.spyOn(log, 'warn').mockImplementation(() => {});
        const ctx = createContext();
        ctx.panel.clearSelection.mockImplementation(() => { throw new Error('dom gone'); });
        await ctx.save();
        expect(ctx.context._showErrorNotification).not.toHaveBeenCalled();
        expect(warn).toHaveBeenCalledTimes(1);
        expect(ctx.statuses[0].finished).toStrictEqual([true]);
    });

    test('overwrite: updateNote succeeds → cleared; updateNote throws / no note to overwrite → kept', async () => {
        const ok = createContext({overwrite: true});
        await ok.save();
        expect(ok.api.updateAnkiNote).toHaveBeenCalledTimes(1);
        expect(ok.panel.clearSelection).toHaveBeenCalledTimes(1);
        expect(ok.statuses[0].finished).toStrictEqual([true]);

        const failing = createContext({overwrite: true});
        failing.api.updateAnkiNote.mockImplementation(async () => { throw new Error('Anki down'); });
        await failing.save();
        expect(failing.panel.clearSelection).not.toHaveBeenCalled();
        expect(failing.statuses[0].finished).toStrictEqual([false]);

        const gone = createContext({overwrite: true});
        gone.context._getDictionaryEntryDetails = vi.fn(async () => [{noteMap: new Map([[0, {noteIds: [], noteInfos: []}]])}]);
        await gone.save();
        expect(gone.api.updateAnkiNote).not.toHaveBeenCalled();
        expect(gone.panel.clearSelection).not.toHaveBeenCalled();
        expect(gone.statuses[0].finished).toStrictEqual([false]);
    });

    test('suspend and forceSync fail after a successful addNote → still saved: ticks cleared, status «Сохранено»', async () => {
        const ctx = createContext();
        ctx.context._suspendNewCards = true;
        ctx.context._forceSync = true;
        const api = /** @type {Record<string, unknown>} */ (/** @type {unknown} */ (ctx.api));
        api.suspendAnkiCardsForNote = vi.fn(async () => { throw new Error('suspend failed'); });
        api.forceSync = vi.fn(async () => { throw new Error('sync failed'); });
        await ctx.save();
        expect(ctx.api.addAnkiNote).toHaveBeenCalledTimes(1);
        expect(shownErrors(ctx)).toStrictEqual(['suspend failed', 'sync failed']);
        expect(ctx.panel.clearSelection).toHaveBeenCalledTimes(1);
        expect(ctx.statuses[0].finished).toStrictEqual([true]);
    });

    test('nothing ticked → no status line, no clear call (zero overhead)', async () => {
        const ctx = createContext({films: [], youtube: false});
        await ctx.save();
        expect(ctx.api.addAnkiNote).toHaveBeenCalledTimes(1);
        expect(ctx.panel.beginSaveStatus).not.toHaveBeenCalled();
        expect(ctx.panel.clearSelection).not.toHaveBeenCalled();
    });

    test('status phases: «Клип N из M» per film, then the note save; the «+» title mirrors them and is restored', async () => {
        const ctx = createContext({films: ['c1', 'c2']});
        /** @type {string[]} */
        const titles = [];
        const status = {texts: /** @type {string[]} */ ([])};
        ctx.context._flibMediaDeps.transcodeClipToWebm = vi.fn(async () => {
            titles.push(ctx.button.title);
            return WEBM;
        });
        await ctx.save();
        status.texts = ctx.statuses[0].texts;
        expect(status.texts).toStrictEqual([
            'Готовлю видео…',
            'Готовлю видео… Клип 1 из 2',
            'Готовлю видео… Клип 1 из 2',
            'Готовлю видео… Клип 2 из 2',
            'Готовлю видео… Клип 2 из 2',
            'Сохраняю видео в Anki… Клип 1 из 2',
            'Сохраняю видео в Anki… Клип 2 из 2',
            'Сохраняю карточку в Anki…',
        ]);
        expect(titles).toStrictEqual(['Готовлю видео… Клип 1 из 2', 'Готовлю видео… Клип 2 из 2']);
        expect(ctx.button.title).toBe('Add expression');
    });

    test('YouTube-only selection: no «Готовлю видео» phase', async () => {
        const ctx = createContext({films: []});
        await ctx.save();
        expect(ctx.statuses[0].texts).toStrictEqual(['Сохраняю в Anki…', 'Сохраняю карточку в Anki…']);
        expect(ctx.panel.clearSelection).toHaveBeenCalledTimes(1);
    });

    test('two card formats saved in parallel: each clears its own snapshot and finishes its own status', async () => {
        const ctx = createContext({films: ['c1'], youtube: false});
        ctx.context._cardFormats.push({fields: {Front: {value: '{expression}', overwriteMode: 'coalesce'}}});
        const selA = {films: [{clipId: 'c1', media: filmMedia('c1')}], youtube: []};
        const selB = {films: [{clipId: 'c1', media: filmMedia('c1')}, {clipId: 'c2', media: filmMedia('c2')}], youtube: []};
        ctx.panel.getSelectedGatewayMedia.mockReturnValueOnce(selA).mockReturnValueOnce(selB);
        /** @type {(reason: Error) => void} */
        let failA = () => {};
        let adds = 0;
        ctx.api.addAnkiNote.mockImplementation(() => new Promise((resolve, reject) => {
            if (++adds === 1) {
                failA = reject;
                return;
            }
            resolve(124);
        }));
        const a = ctx.save(0);
        await vi.waitFor(() => expect(ctx.api.addAnkiNote).toHaveBeenCalledTimes(1));
        // B is pressed while A waits in addNote; A then fails.
        const b = ctx.save(1);
        await b;
        failA(new Error('duplicate'));
        await a;
        expect(ctx.panel.clearSelection).toHaveBeenCalledTimes(1);
        expect(ctx.panel.clearSelection.mock.calls[0][0]).toBe(selB);
        expect(ctx.statuses.map((st) => st.finished)).toStrictEqual([[false], [true]]);
    });
});

/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */

/* eslint-disable no-underscore-dangle */
describe('DisplayAnki: выдача сменилась во время сохранения (карточка Flib-club)', () => {
    test('отмечены клипы Core, выдача сменилась — карточка не добавляется, ошибка показана', async () => {
        const ctx = createContext({films: [], youtube: false});
        ctx.context._duplicateBehavior = 'new';
        /** @type {{getSelectedClipIds: () => string[]}} */ (/** @type {unknown} */ (ctx.panel)).getSelectedClipIds = () => ['k1'];
        const original = ctx.entry;
        const other = /** @type {HTMLElement} */ (/** @type {unknown} */ ({id: 'other', isConnected: true}));
        let calls = 0;
        // Первый взгляд (нажатие) — статья слова; дальше по тому же индексу уже другая.
        ctx.context._getEntry = vi.fn(() => (++calls <= 2 ? original : other));
        await ctx.save();
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
        expect(shownErrors(ctx).some((m) => m.includes('Выдача сменилась'))).toBe(true);
    });

    test('статья та же, но панель Core пересоздана (без отметок) — обновление не идёт, «не обновлена»', async () => {
        const ctx = createContext({films: [], youtube: false, overwrite: true});
        /** @type {{getSelectedClipIds: () => string[]}} */ (/** @type {unknown} */ (ctx.panel)).getSelectedClipIds = () => ['k1'];
        const fresh = {...ctx.panel, getSelectedClipIds: () => []};
        const original = ctx.context._applySelectedClipsToNote;
        ctx.context._createNote = vi.fn(async () => {
            ctx.context._videoExamplesPanels.set(ctx.entry, /** @type {*} */ (fresh));
            return {note: {deckName: 'D', modelName: 'Yomitan Card Type', fields: {Front: 'run'}, tags: [], options: {}}, errors: [], requirements: []};
        });
        await ctx.save();
        expect(ctx.api.updateAnkiNote).not.toHaveBeenCalled();
        expect(original).not.toHaveBeenCalled();
        expect(shownErrors(ctx).some((m) => m.includes('карточка не обновлена'))).toBe(true);
    });

    test('сохранение клипов Core упало — ошибка показана ровно один раз, карточка не добавлена, кнопка снова доступна', async () => {
        const ctx = createContext({films: [], youtube: false});
        ctx.context._duplicateBehavior = 'new';
        ctx.context._applySelectedClipsToNote = /** @type {*} */ (vi.fn(async () => new Error('persist failed')));
        await ctx.save();
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
        expect(ctx.context._showErrorNotification).toHaveBeenCalledTimes(1);
        expect(shownErrors(ctx)).toEqual(['persist failed']);
        expect(ctx.buttons.at(-1)?.disabled).toBe(false);
    });
});

describe('overwrite with ticked videos never loses saved ones', () => {
    const READ_FAILED = 'Не удалось прочитать сохранённые видео — ничего не изменено';

    /**
     * @param {ReturnType<typeof createContext>} ctx
     * @param {string} message
     */
    function expectNothingWritten(ctx, message) {
        expect(ctx.api.updateAnkiNote).not.toHaveBeenCalled();
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
        expect(shownErrors(ctx)).toStrictEqual([message]);
        expect(ctx.panel.clearSelection).not.toHaveBeenCalled();
        expect(ctx.statuses.map((status) => status.finished)).toStrictEqual([[false]]);
        expect(ctx.buttons.at(-1)?.disabled).toBe(false);
    }

    /**
     * @param {ReturnType<typeof createContext>} ctx
     * @returns {import('anki').NoteWithId}
     */
    function updatedNote(ctx) {
        expect(ctx.api.updateAnkiNote).toHaveBeenCalledTimes(1);
        return ctx.api.updateAnkiNote.mock.calls[0][0];
    }

    test.each(/** @type {[string, unknown][]} */ ([
        ['[null] (the answer to any AnkiConnect error)', [null]],
        ['no records', []],
        ['not an array', null],
        ['the record of another note', [noteInfo(78)]],
        ['a record without the field', [noteInfo(77, {Front: 'x'})]],
        ['a record whose field has another letter case', [noteInfo(77, {Front: 'x', Flib_Media: 'saved'})]],
        ['a field without a text value', [{noteId: 77, fields: {flib_media: {order: 0}}}]],
        ['a record without fields', [{noteId: 77}]],
    ]))('the saved value cannot be read: %s → the error, nothing replaced, ticks kept', async (_name, answer) => {
        const ctx = createContext({overwrite: true});
        ctx.api.getAnkiNotesInfoByIds.mockResolvedValue(/** @type {*} */ (answer));
        await ctx.save();
        expectNothingWritten(ctx, READ_FAILED);
    });

    test('the read itself fails → its error, nothing replaced, ticks kept', async () => {
        const ctx = createContext({overwrite: true});
        ctx.api.getAnkiNotesInfoByIds.mockRejectedValue(new Error('port closed'));
        await ctx.save();
        expectNothingWritten(ctx, 'port closed');
    });

    test('the record is there and the field is empty → only the new examples', async () => {
        const ctx = createContext({overwrite: true, films: []});
        ctx.api.getAnkiNotesInfoByIds.mockResolvedValue([noteInfo(77, {Front: 'x', flib_media: ''})]);
        await ctx.save();
        expect(updatedNote(ctx).fields.flib_media.startsWith('<ul class="flib-yt"><li>')).toBe(true);
        expect(ctx.panel.clearSelection).toHaveBeenCalledTimes(1);
    });

    test('the same answer in English', async () => {
        setUiLanguage('en');
        try {
            const ctx = createContext({overwrite: true});
            ctx.api.getAnkiNotesInfoByIds.mockResolvedValue([null]);
            await ctx.save();
            expectNothingWritten(ctx, 'Could not read the saved videos — nothing was changed');
        } finally {
            setUiLanguage('ru');
        }
    });
});
/* eslint-enable no-underscore-dangle */

/* eslint-disable no-underscore-dangle */
/** @typedef {'run'|'walk'} Word */
/** @typedef {'createNote'|'hasField'|'transcode'|'store'|'findNotes'|'readField'|'write'} SaveStage */

// eslint-disable-next-line jsdoc/require-returns -- the inferred shape is what the tests use
/**
 * The results of one word as the popup shows them.
 * @param {Word} term
 */
function makeWord(term) {
    const entry = /** @type {HTMLElement} */ (/** @type {unknown} */ ({id: term, isConnected: true, dataset: {type: 'term'}, querySelectorAll: () => [], querySelector: () => null}));
    const button = /** @type {HTMLButtonElement} */ (/** @type {unknown} */ ({disabled: false, dataset: {cardFormatIndex: '0'}, title: 'В Anki', classList: {add: vi.fn(), remove: vi.fn()}}));
    return {
        term,
        entry,
        button,
        dictionaryEntries: /** @type {import('dictionary').DictionaryEntry[]} */ (/** @type {unknown} */ ([{type: 'term', headwords: [{term, reading: ''}]}])),
        panel: makeSelectionPanel({films: [], youtube: []}),
    };
}

// eslint-disable-next-line jsdoc/require-returns -- the inferred shape is what the tests use
/**
 * @param {import('gateway-anki-media').GatewaySelectedMedia} selection
 */
function makeSelectionPanel(selection) {
    /** @type {{texts: string[], finished: boolean[]}[]} */
    const statuses = [];
    const panel = {
        root: {isConnected: true},
        statuses,
        /** @type {?('user'|'content')} */
        destroyReason: null,
        getSelectedClipIds: () => [],
        // Built per call, as in the real panel: nothing of a capture stays in the fake.
        getSelectedGatewayMedia: vi.fn(() => ({films: selection.films.map((film) => ({...film})), youtube: selection.youtube.map((item) => ({...item}))})),
        clearSelection: vi.fn(),
        beginSaveStatus: vi.fn(() => {
            /** @type {{texts: string[], finished: boolean[]}} */
            const status = {texts: [], finished: []};
            statuses.push(status);
            return {
                update: (/** @type {string} */ text) => { status.texts.push(text); },
                finish: (/** @type {boolean} */ saved) => { status.finished.push(saved); },
            };
        }),
        destroy: vi.fn((/** @type {'user'|'content'} */ reason = 'content') => { panel.destroyReason = panel.destroyReason ?? reason; }),
    };
    return panel;
}

/** @type {Record<'youtube'|'film'|'both'|'none', import('gateway-anki-media').GatewaySelectedMedia>} */
const SELECTIONS = {
    youtube: {films: [], youtube: [{key: '0', ref: REF, startMs: 4200, endMs: 6900, text: 'we run', words: ['run']}]},
    film: {films: [{clipId: 'c1', media: filmMedia('c1')}], youtube: []},
    both: {films: [{clipId: 'c1', media: filmMedia('c1')}], youtube: [{key: '0', ref: REF, startMs: 4200, endMs: 6900, text: 'we run', words: ['run']}]},
    none: {films: [], youtube: []},
};

/** Tags added to a note by the page and the tag bar, at the press and after the next lookup. */
const EXTRA_TAGS = [...computeAutoTags('https://first.example/'), 'first user tag'];
const NEXT_EXTRA_TAGS = [...computeAutoTags('https://second.example/'), 'second user tag'];

/** The options a note is built with, at the press and after the next lookup. */
const BUILD_OPTIONS = {template: 'first template', duplicateScope: 'collection', duplicateScopeCheckAllModels: false, resultOutputMode: 'split', glossaryLayoutMode: 'default', compactTags: false, dictionaryStylesMap: ['first']};
const NEXT_BUILD_OPTIONS = {template: 'second template', duplicateScope: 'deck', duplicateScopeCheckAllModels: true, resultOutputMode: 'merge', glossaryLayoutMode: 'compact', compactTags: true, dictionaryStylesMap: ['second']};

/**
 * @param {typeof BUILD_OPTIONS} options
 * @returns {unknown} The DisplayAnki fields that give these options.
 */
function buildOptionsFields({template, dictionaryStylesMap, duplicateScope, duplicateScopeCheckAllModels, resultOutputMode, glossaryLayoutMode, compactTags}) {
    return {
        _ankiFieldTemplates: template,
        _dictionaries: dictionaryStylesMap,
        _duplicateScope: duplicateScope,
        _duplicateScopeCheckAllModels: duplicateScopeCheckAllModels,
        _resultOutputMode: resultOutputMode,
        _glossaryLayoutMode: glossaryLayoutMode,
        _compactTags: compactTags,
    };
}

/** Saved notes by «Front»; «run» with the sentence of the second lookup is another note (a trap). */
const SAVED_NOTES = new Map([['run|first sentence', 77], ['walk|second sentence', 88], ['run|second sentence', 99]]);

// eslint-disable-next-line jsdoc/require-returns -- the inferred shape is what the tests use
/**
 * The popup with the word «run» on screen: every DisplayAnki method is real except the drawing of the buttons; the
 * display, the note builder and the backend are fakes. `lookup()` shows «walk» as the real display does, with another
 * options context. `during[stage]` runs once, inside that stage of the first save.
 * @param {{selection?: keyof typeof SELECTIONS, overwrite?: boolean, transcode?: (blob: Blob, options: {signal?: AbortSignal}) => Promise<Uint8Array>, updateAnkiNote?: () => Promise<void>, addAnkiNote?: () => Promise<?number>, savedFields?: () => unknown}} [options]
 */
function createPopup({selection = 'both', overwrite = false, transcode, updateAnkiNote, addAnkiNote, savedFields} = {}) {
    vi.stubGlobal('navigator', {userAgent: 'Chrome/142.0.0.0'});
    const run = makeWord('run');
    const walk = makeWord('walk');
    run.panel = makeSelectionPanel(SELECTIONS[selection]);
    if (overwrite) { run.button.dataset.overwrite = 'true'; }
    /** @type {Partial<Record<SaveStage, () => void|Promise<void>>>} */
    const during = {};
    /** @param {SaveStage} stage */
    const at = async (stage) => {
        const hook = during[stage];
        delete during[stage];
        await hook?.();
    };
    /** @type {[string, unknown[]][]} Every backend call, in order. */
    const calls = [];
    /** @type {Record<string, (...args: any[]) => Promise<unknown>>} */
    const handlers = {
        flibAnkiModelHasField: async () => {
            await at('hasField');
            return true;
        },
        flibStoreAnkiMedia: async (/** @type {string} */ fileName) => {
            await at('store');
            return {fileName};
        },
        addAnkiNote: async () => {
            await at('write');
            return typeof addAnkiNote === 'function' ? await addAnkiNote() : 123;
        },
        updateAnkiNote: async () => {
            await at('write');
            await updateAnkiNote?.();
        },
        getAnkiNoteInfo: async (/** @type {import('anki').Note[]} */ notes) => {
            await at('findNotes');
            return notes.map(({fields}) => {
                const id = SAVED_NOTES.get(fields.Front);
                return {canAdd: true, valid: true, noteIds: typeof id === 'number' ? [id] : null};
            });
        },
        getAnkiNotesInfoByIds: async (/** @type {number[]} */ [id]) => {
            await at('readField');
            return typeof savedFields === 'function' ? savedFields() : [noteInfo(id, {Front: `saved ${id}`, Sentence: `saved ${id}`, flib_media: `<b>saved ${id}</b>`})];
        },
        isAnkiConnected: async () => true,
        suspendAnkiCardsForNote: async () => 1,
        forceSync: async () => {},
        flibGatewayStatus: async () => ({hasKey: true}),
        flibEnrichNote: async () => ({}),
        getAnkiRoute: async () => ({mode: 'direct'}),
    };
    const api = Object.fromEntries(Object.entries(handlers).map(([name, handler]) => [name, (/** @type {unknown[]} */ ...args) => {
        calls.push([name, structuredClone(args)]);
        return handler(...args);
    }]));
    /** @type {string[][]} Opened notifications: the messages of each. */
    const notifications = [];
    const display = {
        dictionaryEntries: run.dictionaryEntries,
        dictionaryEntryNodes: [run.entry],
        progressIndicatorVisible: {setOverride: vi.fn(() => ({})), clearOverride: vi.fn()},
        application: {api},
        options: {anki: {enable: true}, flibService: {enrichCards: false}},
        optionsContext: {url: 'https://first.example/'},
        getOptions: () => display.options,
        getOptionsContext: () => display.optionsContext,
        getContentOrigin: () => ({tabId: 1, frameId: 0}),
        getLanguageSummary: () => ({iso: 'en'}),
        displayGenerator: {
            createAnkiNoteErrorsNotificationContent: (/** @type {Error[]} */ errors) => ({messages: errors.map((e) => e.message), querySelectorAll: () => []}),
        },
        createNotification: () => {
            /** @type {string[]} */
            let messages = [];
            return {
                setContent: (/** @type {{messages: string[]}} */ content) => { ({messages} = content); },
                open: () => { notifications.push(messages); },
                close: () => {},
            };
        },
    };
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- Object.create gives `any`
    const anki = /** @type {DisplayAnki} */ (Object.create(DisplayAnki.prototype));
    /** The drawing of buttons and statuses; `ui` holds the calls since the last `lookup()`. */
    const ui = {
        _applyCardFormatUi: vi.fn(),
        _updateSaveButtonForDuplicateBehavior: vi.fn(),
        _updateViewNoteButton: vi.fn(),
        _renderEnrichStatus: vi.fn(),
        _renderNoKeyStatus: vi.fn(),
        _hideErrorNotification: vi.fn(),
    };
    /**
     * @param {Word} term
     * @returns {unknown[]}
     */
    const details = (term) => [{noteMap: new Map([[0, {requirements: [{type: 'audio'}], noteIds: [SAVED_NOTES.get(`${term}|x`)]}]])}];
    /**
     * @param {string} name
     * @returns {unknown}
     */
    const format = (name) => ({name, type: 'term', deck: `${name} deck`, model: 'Yomitan Card Type', icon: 'x', fields: {Front: {value: 'x', overwriteMode: 'coalesce'}, Sentence: {value: 'x', overwriteMode: 'overwrite'}}});
    Object.assign(anki, {
        _display: display,
        _displayAudio: {getAnkiNoteMediaAudioDetails: () => ({sources: [], preferredAudioIndex: null, enableDefaultAudioSources: false})},
        _ankiNoteBuilder: {
            getDictionaryEntryDetailsForNote: (/** @type {import('dictionary').TermDictionaryEntry} */ {headwords}) => ({type: 'term', term: headwords[0].term, reading: ''}),
            getDictionaryStylesMap: (/** @type {unknown} */ dictionaries) => dictionaries,
            createNote: async (/** @type {import('anki-note-builder').CreateNoteDetails} */ {dictionaryEntry, cardFormat, context, tags, requirements = [], template, duplicateScope, duplicateScopeCheckAllModels, resultOutputMode, glossaryLayoutMode, compactTags, dictionaryStylesMap}) => {
                const {headwords} = /** @type {import('dictionary').TermDictionaryEntry} */ (dictionaryEntry);
                const sentence = context.sentence.text;
                // The note being saved is the one with requirements; the lookups of saved notes have none.
                if (requirements.length > 0) { await at('createNote'); }
                return {
                    note: {deckName: cardFormat.deck, modelName: cardFormat.model, fields: {Front: `${headwords[0].term}|${sentence}`, Sentence: sentence}, tags, options: {template, duplicateScope, duplicateScopeCheckAllModels, resultOutputMode, glossaryLayoutMode, compactTags, dictionaryStylesMap}},
                    errors: [],
                    requirements: [],
                };
            },
        },
        ...(/** @type {object} */ (buildOptionsFields(BUILD_OPTIONS))),
        _noteContext: {sentence: {text: 'first sentence', offset: 0}, url: 'https://first.example/', documentTitle: '', query: 'run', fullQuery: 'run'},
        _cardFormats: [format('first')],
        _noteTags: ['first tag'],
        _activeUserTags: new Set(['first user tag']),
        _duplicateBehavior: 'new',
        _displayTagsAndFlags: 'never',
        _checkForDuplicates: true,
        _suspendNewCards: false,
        _forceSync: false,
        _dictionaryEntryDetails: details('run'),
        _videoExamplesPanels: new Map([[run.entry, run.panel]]),
        _videoExamplesOrchestrator: null,
        _videoExamplesModal: null,
        _hideVideoExamplesDensityToggleIfEmpty: vi.fn(),
        _phraseTestWordsPanels: new Map(),
        _examplesNotification: null,
        _errorNotification: null,
        _errorNotificationEventListeners: null,
        _eventListeners: {removeAllEventListeners: vi.fn()},
        _savingNotes: new Map(),
        _gatewaySaves: new Set(),
        _lastSaved: new WeakMap(),
        _flibMediaDeps: {
            probeEncoderSupport: async () => ({vp9Supported: true, vp8Supported: true, opusSupported: true}),
            transcodeClipToWebm: vi.fn(async (/** @type {Blob} */ blob, /** @type {{signal?: AbortSignal}} */ options) => {
                await at('transcode');
                return typeof transcode === 'function' ? await transcode(blob, options) : WEBM;
            }),
        },
        _saveButtonFind: (/** @type {number} */ index) => [run, walk].find(({entry}) => entry === display.dictionaryEntryNodes[index])?.button ?? null,
        ...ui,
    });
    /** A new lookup, as Display#_onStateChanged does it: the popup page lives on, its content is replaced. */
    const lookup = () => {
        anki._onContentClear();
        display.dictionaryEntries = [];
        display.dictionaryEntryNodes = [];
        /** @type {{isConnected: boolean}} */ (run.entry).isConnected = false;
        display.options = {anki: {enable: true}, flibService: {enrichCards: true}};
        display.optionsContext = {url: 'https://second.example/'};
        Object.assign(anki, {
            _noteContext: {sentence: {text: 'second sentence', offset: 0}, url: 'https://second.example/', documentTitle: '', query: 'walk', fullQuery: 'walk'},
            _cardFormats: [format('second')],
            _noteTags: ['second tag'],
            _activeUserTags: new Set(['second user tag']),
            ...(/** @type {object} */ (buildOptionsFields(NEXT_BUILD_OPTIONS))),
            _checkForDuplicates: false,
            _displayTagsAndFlags: 'always',
            _suspendNewCards: true,
            _forceSync: true,
            _dictionaryEntryDetails: details('walk'),
        });
        display.dictionaryEntries = walk.dictionaryEntries;
        display.dictionaryEntryNodes = [walk.entry];
        anki._videoExamplesPanels.set(walk.entry, /** @type {*} */ (walk.panel));
        for (const spy of Object.values(ui)) { spy.mockClear(); }
    };
    /** ×, as the onCancel hook of _mountGatewayExamplesPanel. */
    const close = () => {
        anki._videoExamplesPanels.delete(run.entry);
        run.panel.destroy('user');
    };
    /** ↻: the panel is replaced by a fresh one with something else ticked. */
    const reopened = makeSelectionPanel({films: [{clipId: 'other', media: filmMedia('other')}], youtube: []});
    const restart = () => {
        close();
        anki._videoExamplesPanels.set(run.entry, /** @type {*} */ (reopened));
    };
    const closeThenLookup = () => {
        close();
        lookup();
    };
    const events = {lookup, close, restart, 'close, then lookup': closeThenLookup};
    /**
     * @param {string} name
     * @returns {unknown[][]} The arguments of each call.
     */
    const callsOf = (name) => calls.filter(([callName]) => callName === name).map(([, args]) => args);
    /**
     * @param {'addAnkiNote'|'updateAnkiNote'} name
     * @returns {import('anki').NoteWithId[]} The notes written (an added one has no id).
     */
    const notesOf = (name) => callsOf(name).map(([note]) => /** @type {import('anki').NoteWithId} */ (note));
    return {anki, api, display, run, walk, reopened, during, events, lookup, calls, callsOf, notesOf, notifications, ui, save: () => anki._saveAnkiNote(0, 0)};
}

/**
 * Every Blob reachable from a value.
 * @param {unknown} value
 * @param {Set<unknown>} [seen]
 * @returns {Blob[]}
 */
function findBlobs(value, seen = new Set()) {
    if (value instanceof Blob) { return [value]; }
    if (typeof value !== 'object' || value === null || seen.has(value)) { return []; }
    seen.add(value);
    if (value instanceof Map) { return findBlobs([...value.keys(), ...value.values()], seen); }
    const children = value instanceof Set ? [...value] : Object.values(value);
    return children.flatMap((child) => findBlobs(child, seen));
}

/** The note looked up among the saved ones for «run». */
const FOUND_NOTES = [{deckName: 'first deck', modelName: 'Yomitan Card Type', fields: {Front: 'run|first sentence', Sentence: 'first sentence'}, tags: ['first tag'], options: BUILD_OPTIONS}];

const TICKED = /** @type {const} */ (['youtube', 'film', 'both']);

/**
 * @param {typeof TICKED[number]} selection
 * @param {boolean} overwrite
 * @returns {SaveStage[]}
 */
function stagesOf(selection, overwrite) {
    return [
        'createNote',
        'hasField',
        ...(selection === 'youtube' ? [] : /** @type {SaveStage[]} */ (['transcode', 'store'])),
        ...(overwrite ? /** @type {SaveStage[]} */ (['findNotes', 'readField']) : []),
        'write',
    ];
}

describe('a pressed save with ticked videos always finishes', () => {
    /** @typedef {'lookup'|'close'|'restart'|'close, then lookup'} PanelEvent */
    /**
     * @param {PanelEvent[]} events
     * @returns {[typeof TICKED[number], boolean, SaveStage, PanelEvent][]}
     */
    function casesOf(events) {
        /** @type {[typeof TICKED[number], boolean, SaveStage, PanelEvent][]} */
        const cases = [];
        for (const selection of TICKED) {
            for (const overwrite of [false, true]) {
                for (const stage of stagesOf(selection, overwrite)) {
                    for (const event of events) { cases.push([selection, overwrite, stage, event]); }
                }
            }
        }
        return cases;
    }

    test.each(casesOf(['lookup', 'close', 'restart', 'close, then lookup']))('%s ticked, overwrite %s, during %s: %s → saved once, into the note of the first word', async (selection, overwrite, stage, event) => {
        const popup = createPopup({selection, overwrite});
        let happened = false;
        popup.during[stage] = () => {
            happened = true;
            popup.events[event]();
        };
        await popup.save();
        expect(happened).toBe(true);
        expect(popup.notifications).toStrictEqual([]);
        expect(popup.callsOf('addAnkiNote')).toHaveLength(overwrite ? 0 : 1);
        expect(popup.callsOf('updateAnkiNote')).toHaveLength(overwrite ? 1 : 0);
        const [note] = popup.notesOf(overwrite ? 'updateAnkiNote' : 'addAnkiNote');
        expect(note).toMatchObject({deckName: 'first deck', tags: ['first tag', ...EXTRA_TAGS]});
        expect(note.options).toStrictEqual(BUILD_OPTIONS);
        expect(note.fields.Sentence).toBe('first sentence');
        expect(note.fields.Front).toBe(overwrite ? 'saved 77' : 'run|first sentence');
        if (overwrite) {
            expect(note.id).toBe(77);
            // The lookup of the saved note: the entries, the sentence and the options of the press.
            expect(popup.callsOf('getAnkiNoteInfo')).toStrictEqual([[FOUND_NOTES, false]]);
            expect(note.fields.flib_media).toContain('<b>saved 77</b>');
        }
        expect(note.fields.flib_media.includes('flib-clip')).toBe(selection !== 'youtube');
        expect(note.fields.flib_media.includes(PLAYER_START)).toBe(selection !== 'film');
        // The options of the press, not those of the next word's options context.
        for (const name of ['suspendAnkiCardsForNote', 'forceSync', 'flibEnrichNote', 'flibGatewayStatus']) { expect(popup.callsOf(name)).toStrictEqual([]); }
        expect(popup.run.panel.statuses.map(({finished}) => finished)).toStrictEqual([[true]]);
        // Ticks: only in the panel they were ticked in, only while it lives (it died in every case here).
        for (const {panel} of [popup.run, popup.walk, {panel: popup.reopened}]) { expect(panel.clearSelection).not.toHaveBeenCalled(); }
        for (const panel of [popup.walk.panel, popup.reopened]) {
            expect(panel.beginSaveStatus).not.toHaveBeenCalled();
            expect(panel.getSelectedGatewayMedia).not.toHaveBeenCalled();
        }
        expect(popup.anki._savingNotes.size).toBe(0);
    });

    test.each(casesOf(['lookup', 'close, then lookup']))('%s ticked, overwrite %s, during %s: %s → the buttons and statuses of the next word are not touched', async (selection, overwrite, stage, event) => {
        const popup = createPopup({selection, overwrite});
        popup.during[stage] = popup.events[event];
        await popup.save();
        for (const [name, spy] of Object.entries(popup.ui)) { expect(spy.mock.calls, name).toStrictEqual([]); }
        expect(popup.walk.button).toMatchObject({disabled: false, title: 'В Anki', dataset: {cardFormatIndex: '0'}});
        expect(popup.anki._lastSaved.has(popup.walk.entry)).toBe(false);
        expect(popup.anki._lastSaved.has(popup.run.entry)).toBe(false);
    });

    test.each([false, true])('overwrite %s: × while the word stays on screen → its button and status are updated as usual', async (overwrite) => {
        const popup = createPopup({overwrite});
        popup.during.transcode = popup.events.close;
        await popup.save();
        expect(popup.anki._lastSaved.get(popup.run.entry)).toStrictEqual({replaced: overwrite, tags: EXTRA_TAGS});
        expect(popup.ui._applyCardFormatUi).toHaveBeenLastCalledWith(0, 0);
        expect(popup.ui._hideErrorNotification).toHaveBeenLastCalledWith(true);
    });

    test('the next profile has no such card format → still saved, no error', async () => {
        for (const overwrite of [false, true]) {
            const popup = createPopup({overwrite});
            delete (/** @type {*} */ (popup.anki)._updateSaveButtonForDuplicateBehavior);
            popup.during.transcode = () => {
                popup.lookup();
                popup.anki._cardFormats = [];
            };
            await popup.save();
            expect(popup.callsOf(overwrite ? 'updateAnkiNote' : 'addAnkiNote')).toHaveLength(1);
            expect(popup.notifications).toStrictEqual([]);
            expect(popup.run.panel.statuses[0].finished).toStrictEqual([true]);
        }
    });

    test('the options change while the word is still on screen → the note is added and its ticks are cleared', async () => {
        vi.stubGlobal('HTMLElement', class {});
        const popup = createPopup();
        delete (/** @type {*} */ (popup.anki)._updateSaveButtonForDuplicateBehavior);
        Object.assign(popup.run.button, {setAttribute: vi.fn(), querySelector: () => null});
        Object.assign(popup.display, {_hotkeyHelpController: {getHotkeyLabel: () => null}});
        popup.during.write = () => { popup.anki._cardFormats = []; };
        await popup.save();
        expect(popup.notifications).toStrictEqual([]);
        expect(popup.run.panel.clearSelection).toHaveBeenCalledTimes(1);
        expect(popup.callsOf('addAnkiNote')).toHaveLength(1);
    });

    test.each(/** @type {('overwrite'|'new')[]} */ (['overwrite', 'new']))('the footer / «▾» save (%s): a new lookup does not touch the next word', async (mode) => {
        const popup = createPopup();
        const getNodeNoteIds = vi.fn(() => [77]);
        Object.assign(popup.anki, {_getNodeNoteIds: getNodeNoteIds});
        Object.assign(popup.display, {getElementDictionaryEntryIndex: () => 0});
        const container = /** @type {HTMLElement} */ (/** @type {unknown} */ ({querySelector: () => popup.run.button}));
        popup.during.transcode = popup.lookup;
        await popup.anki._saveWithMode(container, mode);
        expect(popup.callsOf(mode === 'overwrite' ? 'updateAnkiNote' : 'addAnkiNote')).toHaveLength(1);
        for (const [name, spy] of Object.entries(popup.ui)) { expect(spy.mock.calls, name).toStrictEqual([]); }
        // The word still on screen: the button is put in order as before.
        const same = createPopup();
        Object.assign(same.anki, {_getNodeNoteIds: getNodeNoteIds});
        Object.assign(same.display, {getElementDictionaryEntryIndex: () => 0});
        await same.anki._saveWithMode(/** @type {HTMLElement} */ (/** @type {unknown} */ ({querySelector: () => same.run.button})), mode);
        expect(same.ui._updateSaveButtonForDuplicateBehavior).toHaveBeenLastCalledWith(same.run.button, [77]);
        expect(Object.hasOwn(same.run.button.dataset, 'overwrite')).toBe(false);
        expect(same.ui._applyCardFormatUi).toHaveBeenLastCalledWith(0, 0);
    });

    test('a Core panel opened after × (its clips ticked) adds nothing to the save', async () => {
        const popup = createPopup();
        const applyCore = vi.spyOn(popup.anki, '_applySelectedClipsToNote');
        popup.during.createNote = () => {
            popup.events.close();
            popup.anki._videoExamplesPanels.set(popup.run.entry, /** @type {*} */ ({root: {isConnected: true}, getSelectedClipIds: () => ['k1']}));
        };
        await popup.save();
        expect(applyCore).not.toHaveBeenCalled();
        expect(popup.callsOf('addAnkiNote')).toHaveLength(1);
        expect(popup.notifications).toStrictEqual([]);
    });

    test('enrichment chosen in the profile of the press goes on after a new lookup', async () => {
        const popup = createPopup();
        popup.display.options = {anki: {enable: true}, flibService: {enrichCards: true}};
        popup.during.transcode = () => {
            popup.lookup();
            popup.display.options = {anki: {enable: true}, flibService: {enrichCards: false}};
        };
        await popup.save();
        expect(popup.callsOf('flibEnrichNote')).toHaveLength(1);
    });

    test('two words saved at once: each gets its own fields, videos and status', async () => {
        /** @type {() => void} */
        let release = () => {};
        const popup = createPopup();
        popup.walk.panel = makeSelectionPanel({films: [], youtube: [{key: '5', ref: 'aaaaaaaaaaa', startMs: 1000, endMs: 2000, text: 'we walk', words: ['walk']}]});
        popup.during.transcode = () => new Promise((resolve) => { release = resolve; });
        const first = popup.save();
        await vi.waitFor(() => { expect(popup.anki._flibMediaDeps?.transcodeClipToWebm).toHaveBeenCalled(); });
        popup.lookup();
        const second = popup.save();
        await second;
        expect(popup.callsOf('addAnkiNote')).toHaveLength(1);
        release();
        await first;
        const [walkNote, runNote] = popup.notesOf('addAnkiNote');
        expect(walkNote).toMatchObject({deckName: 'second deck', fields: {Front: 'walk|second sentence'}});
        expect(walkNote.fields.flib_media).toContain('aaaaaaaaaaa');
        expect(walkNote.fields.flib_media).not.toContain(REF);
        expect(runNote).toMatchObject({deckName: 'first deck', fields: {Front: 'run|first sentence'}});
        expect(runNote.fields.flib_media).toContain(REF);
        expect(runNote.fields.flib_media).not.toContain('aaaaaaaaaaa');
        expect(popup.walk.panel.clearSelection).toHaveBeenCalledTimes(1);
        expect(popup.run.panel.clearSelection).not.toHaveBeenCalled();
        expect(popup.notifications).toStrictEqual([]);
        expect(popup.anki._gatewaySaves.size).toBe(0);
    });
});

describe('a save with ticked videos fails after a new lookup', () => {
    const boom = async () => { throw new ClipTranscodeError('worker-error', 'boom'); };

    test.each([
        ['ru', false, 'Не сохранено: run — Не удалось перекодировать клип в WebM'],
        ['ru', true, 'Не сохранено: run — Не удалось перекодировать клип в WebM'],
        ['en', false, 'Not saved: run — Could not convert the clip to WebM'],
    ])('%s, overwrite %s: one notification with the first word', async (language, overwrite, message) => {
        setUiLanguage(/** @type {'ru'|'en'} */ (language));
        try {
            const popup = createPopup({overwrite, transcode: boom});
            popup.during.createNote = popup.lookup;
            await popup.save();
            expect(popup.notifications).toStrictEqual([[message]]);
            expect(popup.callsOf('addAnkiNote')).toStrictEqual([]);
            expect(popup.callsOf('updateAnkiNote')).toStrictEqual([]);
            expect(popup.run.panel.statuses[0].finished).toStrictEqual([false]);
            for (const spy of Object.values(popup.ui)) { expect(spy).not.toHaveBeenCalled(); }
        } finally {
            setUiLanguage('ru');
        }
    });

    test.each(/** @type {[string, Parameters<typeof createPopup>[0], string][]} */ ([
        ['addNote throws', {addAnkiNote: async () => { throw new Error('duplicate'); }}, 'duplicate'],
        ['addNote answers null', {addAnkiNote: async () => null}, 'Карточку не удалось добавить'],
        ['updateNote throws', {overwrite: true, updateAnkiNote: async () => { throw new Error('Anki down'); }}, 'Anki down'],
        ['the saved videos cannot be read', {overwrite: true, savedFields: () => [null]}, 'Карточку для обновления не нашли в Anki'],
    ]))('%s → the word and the reason', async (_name, options, reason) => {
        const popup = createPopup(options);
        popup.during.hasField = popup.lookup;
        await popup.save();
        expect(popup.notifications).toStrictEqual([[`Не сохранено: run — ${reason}`]]);
    });

    test('overwrite: the note is found, then its saved videos cannot be read → nothing written, the word and the reason', async () => {
        const popup = createPopup({overwrite: true});
        let reads = 0;
        popup.during.hasField = popup.lookup;
        popup.api.getAnkiNotesInfoByIds = async () => (++reads === 1 ? [noteInfo(77, {Front: 'x', Sentence: 'x', flib_media: 'y'})] : [null]);
        await popup.save();
        expect(reads).toBe(2);
        expect(popup.callsOf('updateAnkiNote')).toStrictEqual([]);
        expect(popup.notifications).toStrictEqual([['Не сохранено: run — Не удалось прочитать сохранённые видео — ничего не изменено']]);
    });

    test('the failure of one word is neither replaced nor hidden by the next word', async () => {
        const popup = createPopup({transcode: boom});
        popup.walk.panel = makeSelectionPanel({films: [], youtube: [{key: '5', ref: 'aaaaaaaaaaa', startMs: 1000, endMs: 2000, text: 'we walk', words: ['walk']}]});
        popup.during.createNote = popup.lookup;
        await popup.save();
        const opened = vi.fn();
        const closed = vi.fn();
        Object.assign(popup.anki, {_errorNotification: {close: closed, open: opened, setContent: vi.fn()}});
        delete (/** @type {*} */ (popup.anki)._hideErrorNotification);
        Object.assign(popup.anki, {_errorNotificationEventListeners: {removeAllEventListeners: vi.fn()}});
        await popup.save();
        // «walk» closed the ordinary error notification; the one about «run» is another one.
        expect(closed).toHaveBeenCalled();
        expect(opened).not.toHaveBeenCalled();
        expect(popup.notifications).toStrictEqual([['Не сохранено: run — Не удалось перекодировать клип в WebM']]);
    });

    test('the note was added, a later step failed → the word is named, «Не сохранено» is not said', async () => {
        const popup = createPopup();
        popup.anki._forceSync = true;
        popup.api.forceSync = async () => { throw new Error('sync failed'); };
        popup.during.transcode = popup.lookup;
        await popup.save();
        expect(popup.notifications).toStrictEqual([['run: sync failed']]);
    });

    test('the word stays on screen (×) → the ordinary notification, as before', async () => {
        const popup = createPopup({transcode: boom});
        popup.during.transcode = popup.events.close;
        await popup.save();
        expect(popup.notifications).toStrictEqual([['Не удалось перекодировать клип в WebM']]);
        expect(popup.run.button.disabled).toBe(false);
    });

    test('markup in the word or in the reason stays text', async () => {
        const popup = createPopup({addAnkiNote: async () => { throw new Error('<img src=x> {word}'); }});
        /** @type {{headwords: {term: string}[]}} */ (/** @type {unknown} */ (popup.run.dictionaryEntries[0])).headwords[0].term = '<b>run</b> {reason}';
        popup.during.hasField = popup.lookup;
        await popup.save();
        expect(popup.notifications).toStrictEqual([['Не сохранено: <b>run</b> {reason} — <img src=x> {word}']]);
    });
});

describe('a save with ticked videos: what it keeps', () => {
    test.each(/** @type {[string, boolean][]} */ ([['saved', false], ['failed', true]]))('%s: afterwards nothing holds a Blob or the panel', async (_name, fails) => {
        const popup = createPopup({transcode: fails ? async () => { throw new Error('boom'); } : void 0});
        const take = vi.spyOn(popup.anki, '_takeGatewaySnapshot');
        popup.during.transcode = popup.lookup;
        await popup.save();
        // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment -- mock results are `any`
        const snapshot = /** @type {import('gateway-anki-media').GatewaySaveSnapshot} */ (take.mock.results[0].value);
        expect(snapshot.panel).toBeNull();
        expect(snapshot.selection).toStrictEqual({films: [], youtube: []});
        expect(findBlobs(snapshot)).toStrictEqual([]);
        expect(findBlobs([...popup.anki._gatewaySaves, ...popup.anki._savingNotes])).toStrictEqual([]);
        expect(popup.anki._gatewaySaves.size).toBe(0);
        expect(popup.anki._savingNotes.size).toBe(0);
    });

    test('a save that ends before its film is needed stops waiting for it', async () => {
        const popup = createPopup();
        popup.api.flibAnkiModelHasField = async () => false;
        await popup.save();
        const [{signal}] = /** @type {[{signal: AbortSignal}]} */ (/** @type {unknown} */ (popup.run.panel.getSelectedGatewayMedia.mock.calls[0]));
        expect(signal.aborted).toBe(true);
    });

    test('a throwing capture aborts its waits and leaves no claim', async () => {
        const popup = createPopup();
        /** @type {?AbortSignal} */
        let signal = null;
        popup.run.panel.getSelectedGatewayMedia.mockImplementationOnce(/** @type {*} */ ((/** @type {{signal: AbortSignal}} */ options) => {
            ({signal} = options);
            throw new Error('capture boom');
        }));
        await popup.save();
        expect(popup.notifications).toStrictEqual([['capture boom']]);
        expect(/** @type {?AbortSignal} */ (signal)?.aborted).toBe(true);
        expect(popup.anki._gatewaySaves.size).toBe(0);
        expect(popup.anki._savingNotes.size).toBe(0);
    });

    test.each(['createNote', 'hasField', 'transcode', 'store'])('the page unloads during %s → the worker is aborted, nothing is added', async (stage) => {
        /** @type {AbortSignal[]} */
        const signals = [];
        const popup = createPopup({transcode: async (_blob, {signal}) => {
            signals.push(/** @type {AbortSignal} */ (signal));
            if (signal?.aborted) { throw new DOMException('aborted', 'AbortError'); }
            return WEBM;
        }});
        popup.during[/** @type {SaveStage} */ (stage)] = () => { popup.anki._onPageHide(); };
        await popup.save();
        expect(signals.every((signal) => signal.aborted)).toBe(true);
        expect(popup.callsOf('addAnkiNote')).toStrictEqual([]);
        expect(popup.anki._gatewaySaves.size).toBe(0);
        // The page came back from the back/forward cache: a new save works.
        await popup.save();
        expect(popup.callsOf('addAnkiNote')).toHaveLength(1);
    });
});

describe('the capture of an entry of type phrase (the phrase window)', () => {
    test('it needs only the entry and its panel; released the same way', () => {
        const popup = createPopup();
        popup.run.entry.dataset.type = 'phrase';
        Object.assign(popup.display, {dictionaryEntries: []});
        const snapshot = /** @type {import('gateway-anki-media').GatewaySaveSnapshot} */ (popup.anki._takeGatewaySnapshot(popup.run.entry));
        expect(snapshot.selection.films).toHaveLength(1);
        expect(snapshot.selection.youtube).toHaveLength(1);
        popup.anki._releaseGatewaySnapshot(snapshot);
        expect(findBlobs(snapshot)).toStrictEqual([]);
        expect(popup.anki._gatewaySaves.size).toBe(0);
    });
});

/*
 * Pinned on 6831d7b9 + fa08ffd2 (before «a pressed save finishes»): a save without ticked videos makes byte-identical calls in every
 * mode, the new lookup included. It must stay so.
 */
describe('a save without ticked videos: the same calls as before', () => {
    const NOTE = {...FOUND_NOTES[0], tags: ['first tag', ...EXTRA_TAGS]};
    const UPDATE = ['updateAnkiNote', [{...NOTE, id: 77, fields: {Front: 'saved 77', Sentence: 'first sentence'}}]];

    test.each(['none', 'no panel'])('add, %s', async (kind) => {
        const popup = createPopup({selection: 'none'});
        if (kind === 'no panel') { popup.anki._videoExamplesPanels.clear(); }
        await popup.save();
        expect(popup.calls).toStrictEqual([['addAnkiNote', [NOTE]]]);
        expect(popup.notifications).toStrictEqual([]);
        expect(popup.run.panel.beginSaveStatus).not.toHaveBeenCalled();
    });

    test('add with enrichment, suspend and sync', async () => {
        const popup = createPopup({selection: 'none'});
        popup.display.options = {anki: {enable: true}, flibService: {enrichCards: true}};
        Object.assign(popup.anki, {_suspendNewCards: true, _forceSync: true});
        await popup.save();
        expect(popup.calls.map(([name]) => name)).toStrictEqual(['flibGatewayStatus', 'addAnkiNote', 'suspendAnkiCardsForNote', 'forceSync', 'flibEnrichNote']);
    });

    test('add, a new lookup during createNote: added, with the tags and options current at that moment', async () => {
        const popup = createPopup({selection: 'none'});
        popup.during.createNote = popup.lookup;
        await popup.save();
        expect(popup.calls).toStrictEqual([
            ['flibGatewayStatus', []],
            ['addAnkiNote', [{...NOTE, tags: ['first tag', ...NEXT_EXTRA_TAGS, 'flib_enriched']}]],
            ['suspendAnkiCardsForNote', [123]],
            ['forceSync', []],
            ['flibEnrichNote', popup.callsOf('flibEnrichNote')[0]],
        ]);
        expect(popup.notifications).toStrictEqual([]);
    });

    test('overwrite', async () => {
        const popup = createPopup({selection: 'none', overwrite: true});
        await popup.save();
        expect(popup.calls).toStrictEqual([['getAnkiNoteInfo', [FOUND_NOTES, false]], ['getAnkiNotesInfoByIds', [[77]]], UPDATE]);
    });

    test.each(/** @type {[SaveStage, string[]][]} */ ([
        ['createNote', []],
        ['findNotes', ['getAnkiNoteInfo', 'getAnkiNotesInfoByIds']],
        ['readField', ['getAnkiNoteInfo', 'getAnkiNotesInfoByIds']],
    ]))('overwrite, a new lookup during %s: refused as before', async (stage, names) => {
        const popup = createPopup({selection: 'none', overwrite: true});
        popup.during[stage] = popup.lookup;
        await popup.save();
        expect(popup.calls.map(([name]) => name)).toStrictEqual(names);
        expect(popup.notifications).toStrictEqual([['Выдача сменилась во время сохранения — карточка не обновлена']]);
    });

    test('add fails after a new lookup: the notification as before', async () => {
        const popup = createPopup({selection: 'none', addAnkiNote: async () => { throw new Error('duplicate'); }});
        popup.during.createNote = popup.lookup;
        await popup.save();
        expect(popup.notifications).toStrictEqual([['duplicate']]);
    });
});
/* eslint-enable no-underscore-dangle */
