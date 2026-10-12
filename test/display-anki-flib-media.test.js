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
import {ClipTranscodeError, flibMediaFileName} from '../ext/js/display/clip-transcode-util.js';
import {DisplayAnki} from '../ext/js/display/display-anki.js';
import {GatewayClipWaitError} from '../ext/js/display/gateway-anki-media.js';

const REF = 'dQw4w9WgXcQ';
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 9, 9]);
const OLD_FIELD = '<div class="flib-clip">old</div>';

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
 * @property {import('vitest').Mock} [waitForFilm]
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
function createContext({overwrite = false, films = ['c1'], youtube = true, hasField = true, transcode, waitForFilm, addAnkiNote, store, userAgent = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36', noteFields} = {}) {
    vi.stubGlobal('navigator', {userAgent});
    /** @type {string[]} */
    const calls = [];
    /** @type {{texts: string[], finished: boolean[], update: import('vitest').Mock, finish: import('vitest').Mock}[]} */
    const statuses = [];
    const entry = /** @type {HTMLElement} */ (/** @type {unknown} */ ({id: 'entry', isConnected: true}));
    const abort = new AbortController();
    const panel = {
        root: {isConnected: true},
        getSelectedClipIds: () => [],
        getSelectedGatewayMedia: vi.fn(() => ({
            films: films.map((clipId) => ({clipId})),
            youtube: youtube ? [{key: '0', ref: REF, startMs: 4200, text: 'we run', words: ['run']}] : [],
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
        waitForFilmClipMedia: waitForFilm ?? vi.fn(async (/** @type {string} */ clipId) => {
            calls.push(`wait:${clipId}`);
            return filmMedia(clipId);
        }),
        signal: abort.signal,
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
        },
        _dictionaryEntryDetails: [{noteMap: new Map([[0, {requirements: []}], [1, {requirements: []}]])}],
        _duplicateBehavior: 'prevent',
        _videoExamplesPanels: new Map([[entry, panel]]),
        _savingNotes: new Map(),
        _saveAnkiNoteClaimed: DisplayAnki.prototype._saveAnkiNoteClaimed,
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
        _describeGatewayCancel: DisplayAnki.prototype._describeGatewayCancel,
        _getOverwrittenNote: DisplayAnki.prototype._getOverwrittenNote,
        _getOverwrittenField: DisplayAnki.prototype._getOverwrittenField,
        _getDictionaryEntryDetails: vi.fn(async () => [{
            noteMap: new Map([[0, {
                noteIds: [77],
                /** @type {{noteId: number, fields: Record<string, {value: string, order: number}>}[]} */
                noteInfos: [{noteId: 77, fields: {Front: {value: 'old front', order: 0}, flib_media: {value: OLD_FIELD, order: 1}}}],
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
    return {context, entry, api, calls, panel, abort, button, buttons, buttonClassList, probe, transcode: transcodeFn, save, statuses};
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

    test('order hasField → wait → transcode → store → addNote; the added note carries the field HTML', async () => {
        const ctx = createContext();
        await ctx.save();
        const name = await flibMediaFileName(WEBM);
        expect(ctx.calls).toStrictEqual(['hasField', 'wait:c1', 'transcode', `store:${name}`, 'addNote']);
        const note = ctx.api.addAnkiNote.mock.calls[0][0];
        expect(note.fields.flib_media).toContain(`src="${name}"`);
        expect(note.fields.flib_media).toContain(`watch?v=${REF}&amp;t=4s`);
        expect(ctx.context._showErrorNotification).not.toHaveBeenCalled();
        expect(ctx.api.flibRecordEvent).toHaveBeenCalledTimes(1);
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

    test('the transcode is tied to the panel signal (edge 3)', async () => {
        const ctx = createContext();
        await ctx.save();
        expect(ctx.transcode.mock.calls[0][1].signal).toBe(ctx.panel.signal);
    });

    test.each([
        [false, 'В типе заметки нет поля flib_media — обновите шаблон в anki_conf'],
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
            const ctx = createContext({waitForFilm: vi.fn(async () => {
                await new Promise((resolve) => { setTimeout(resolve, 5000); });
                throw new GatewayClipWaitError('timeout', 'x');
            })});
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
        expect(shownErrors(ctx)).toStrictEqual(['В типе заметки нет поля flib_media — обновите шаблон в anki_conf']);
    });

    test('edge 1: clip not ready → «Нарезка ещё не загрузилась», no addNote', async () => {
        const ctx = createContext({waitForFilm: vi.fn(async () => { throw new GatewayClipWaitError('timeout', 'x'); })});
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

    test('edge 3: panel destroyed (signal aborted) during transcode → nothing stored, no addNote', async () => {
        const abortRef = {abort: () => {}};
        const transcode = vi.fn(async () => {
            abortRef.abort();
            throw new DOMException('aborted', 'AbortError');
        });
        const ctx = createContext({transcode});
        abortRef.abort = () => { ctx.abort.abort(); };
        await ctx.save();
        expect(ctx.api.flibStoreAnkiMedia).not.toHaveBeenCalled();
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
        // Destroyed panel = new lookup or unload: the cancellation is not reported.
        expect(ctx.context._showErrorNotification).not.toHaveBeenCalled();
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

    test('edge 10: overwrite replaces flib_media with the new selection (even if not in the card format)', async () => {
        const ctx = createContext({overwrite: true});
        await ctx.save();
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
        const updated = /** @type {import('anki').NoteWithId} */ (/** @type {unknown} */ (ctx.api.updateAnkiNote.mock.calls[0][0]));
        expect(updated.id).toBe(77);
        expect(updated.fields.flib_media).toContain('<div class="flib-clip"><video');
        expect(updated.fields.flib_media).not.toBe(OLD_FIELD);
    });

    test('edge 10: overwrite replaces even when the card format would coalesce flib_media', async () => {
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
                /** @type {{noteId: number, fields: Record<string, {value: string, order: number}>}[]} */
                noteInfos: [{noteId: 77, fields: {Front: {value: 'old front', order: 0}, data: {value: '{"videos":["old"]}', order: 1}}}],
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

    test('new lookup during a slow _createNote (panel destroyed, map cleared) → no addNote, no notification', async () => {
        const ctx = createContext();
        /** @type {() => void} */
        let release = () => {};
        const slowNote = {deckName: 'D', modelName: 'Yomitan Card Type', fields: {Front: 'run'}, tags: [], options: {}};
        ctx.context._createNote = vi.fn(() => new Promise((resolve) => {
            release = () => { resolve({note: structuredClone(slowNote), errors: [], requirements: []}); };
        }));
        const saving = ctx.save();
        // _onContentClear: panel.destroy() + _videoExamplesPanels.clear(), while _createNote is pending.
        ctx.abort.abort();
        ctx.context._videoExamplesPanels.clear();
        release();
        await saving;
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
        expect(ctx.api.flibAnkiModelHasField).not.toHaveBeenCalled();
        expect(ctx.context._showErrorNotification).not.toHaveBeenCalled();
        expect(ctx.api.flibRecordEvent).not.toHaveBeenCalled();
        expect(ctx.buttons[0].disabled).toBe(false);
    });

    test('the user closes the panel (×) during the transcode → «Сохранение видео отменено — панель закрыта», «+» re-enabled', async () => {
        /** @type {{close: () => void}} */
        const ref = {close: () => {}};
        const transcode = vi.fn(async () => {
            ref.close();
            throw new DOMException('aborted', 'AbortError');
        });
        const ctx = createContext({transcode});
        ref.close = () => {
            ctx.panel.destroyReason = 'user';
            ctx.abort.abort();
        };
        await ctx.save();
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
        expect(shownErrors(ctx)).toStrictEqual(['Сохранение видео отменено — панель закрыта']);
        expect(ctx.buttons[0].disabled).toBe(false);
    });

    test('the user closes the panel, then a new lookup detaches the entry before the save notices → silent', async () => {
        /** @type {{close: () => void}} */
        const ref = {close: () => {}};
        const ctx = createContext({store: (fileName) => {
            ref.close();
            return {fileName};
        }});
        ref.close = () => {
            ctx.panel.destroyReason = 'user';
            ctx.abort.abort();
            // _onContentClear replaced the entries: the old node is detached.
            /** @type {{isConnected: boolean}} */ (/** @type {unknown} */ (ctx.entry)).isConnected = false;
        };
        await ctx.save();
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
        expect(ctx.context._showErrorNotification).not.toHaveBeenCalled();
        expect(ctx.buttons[0].disabled).toBe(false);
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

    test('M4: abort during the (last) store → no addNote', async () => {
        /** @type {{abort: () => void}} */
        const abortRef = {abort: () => {}};
        const ctx = createContext({store: (fileName) => {
            abortRef.abort();
            return {fileName};
        }});
        abortRef.abort = () => { ctx.abort.abort(); };
        await ctx.save();
        expect(ctx.api.flibStoreAnkiMedia).toHaveBeenCalledTimes(1);
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
    });

    test('M4: abort during hasField with a YouTube-only selection → no addNote', async () => {
        const ctx = createContext({films: []});
        ctx.api.flibAnkiModelHasField.mockImplementation(async () => {
            ctx.abort.abort();
            return true;
        });
        await ctx.save();
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
    });

    test('a save cancelled by panel destroy (new lookup) shows no notification over the new results', async () => {
        const ctx = createContext({waitForFilm: vi.fn(async () => {
            ctx.abort.abort();
            throw new GatewayClipWaitError('aborted', 'destroyed');
        })});
        await ctx.save();
        expect(ctx.api.addAnkiNote).not.toHaveBeenCalled();
        expect(ctx.context._showErrorNotification).not.toHaveBeenCalled();
        expect(ctx.api.flibRecordEvent).not.toHaveBeenCalled();
        expect(ctx.buttons[0].disabled).toBe(false);
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
            films: [{clipId: 'c1'}],
            youtube: [{key: '0', ref: REF, startMs: 4200, text: 'we run', words: ['run']}],
        });
        expect(ctx.statuses).toHaveLength(1);
        expect(ctx.statuses[0].finished).toStrictEqual([true]);
    });

    test('the cleared selection is the snapshot taken at «+», not what is ticked when the save ends', async () => {
        const ctx = createContext({films: ['c1']});
        const snapshotSelection = ctx.panel.getSelectedGatewayMedia();
        ctx.panel.getSelectedGatewayMedia.mockReturnValueOnce(snapshotSelection);
        // Ticked during the save: a later read would include c2.
        ctx.panel.getSelectedGatewayMedia.mockReturnValue({films: [{clipId: 'c1'}, {clipId: 'c2'}], youtube: []});
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

    test('a save cancelled by a destroyed panel → ticks not cleared, status finished without success', async () => {
        const ctx = createContext({waitForFilm: vi.fn(async () => {
            ctx.abort.abort();
            throw new GatewayClipWaitError('aborted', 'destroyed');
        })});
        await ctx.save();
        expect(ctx.panel.clearSelection).not.toHaveBeenCalled();
        expect(ctx.statuses[0].finished).toStrictEqual([false]);
    });

    test('the panel is destroyed DURING addNote (note added) → no clear call, no throw, no notification', async () => {
        const ctx = createContext();
        ctx.api.addAnkiNote.mockImplementation(async () => {
            ctx.panel.destroyReason = 'content';
            ctx.abort.abort();
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
        const selA = {films: [{clipId: 'c1'}], youtube: []};
        const selB = {films: [{clipId: 'c1'}, {clipId: 'c2'}], youtube: []};
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
