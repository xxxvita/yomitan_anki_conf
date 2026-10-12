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
    const entry = /** @type {HTMLElement} */ (/** @type {unknown} */ ({id: 'entry'}));
    const abort = new AbortController();
    const panel = {
        root: {isConnected: true},
        getSelectedClipIds: () => [],
        getSelectedGatewayMedia: vi.fn(() => ({
            films: films.map((clipId) => ({clipId})),
            youtube: youtube ? [{ref: REF, startMs: 4200, text: 'we run', words: ['run']}] : [],
        })),
        waitForFilmClipMedia: waitForFilm ?? vi.fn(async (/** @type {string} */ clipId) => {
            calls.push(`wait:${clipId}`);
            return filmMedia(clipId);
        }),
        signal: abort.signal,
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
        _dictionaryEntryDetails: [{noteMap: new Map([[0, {requirements: []}]])}],
        _duplicateBehavior: 'prevent',
        _videoExamplesPanels: new Map([[entry, panel]]),
        _flibMediaBusyEntries: new Set(),
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
        _getOverwrittenNote: DisplayAnki.prototype._getOverwrittenNote,
        _getOverwrittenField: DisplayAnki.prototype._getOverwrittenField,
        _getDictionaryEntryDetails: vi.fn(async () => [{
            noteMap: new Map([[0, {
                noteIds: [77],
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
    };
    const save = () => DisplayAnki.prototype._saveAnkiNote.call(context, 0, 0);
    return {context, api, calls, panel, abort, button, buttons, buttonClassList, probe, transcode: transcodeFn, save};
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
        expect(shownErrors(ctx)[0]).toContain('отменено');
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
        expect((/** @type {import('anki').NoteWithId} */ (/** @type {unknown} */ (ctx.api.updateAnkiNote.mock.calls[0][0]))).fields.flib_media).toContain('flib-clip');
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
        expect(ctx.context._flibMediaBusyEntries.size).toBe(0);
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

/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */
