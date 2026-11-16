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

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {DisplayAnki} from '../ext/js/display/display-anki.js';
import {pickAddedLemma} from '../ext/js/display/display-translation.js';
import {setUiLanguage} from '../ext/js/i18n/ui-language.js';
import {setupDomTest} from './fixtures/dom-test.js';

describe('pickAddedLemma', () => {
    test('обычная статья — заголовочное слово', () => {
        expect(pickAddedLemma({headword: 'figure out', expressionField: null})).toBe('figure out');
    });
    test('попап фразы — то, что в поле на момент добавления, а не выделение', () => {
        expect(pickAddedLemma({headword: 'take it easy!!', expressionField: 'take it easy'})).toBe('take it easy');
    });
    test('пустое поле фразы откатывается к заголовку', () => {
        expect(pickAddedLemma({headword: 'give up', expressionField: '   '})).toBe('give up');
    });
    test('ничего пригодного — null', () => {
        expect(pickAddedLemma({headword: '  ', expressionField: null})).toBe(null);
    });
});

// Same technique as test/popup-size-target.test.js: pull the method off the
// prototype and invoke it with `.call(context, ...)` against a plain object
// carrying only the fields/methods it actually touches, instead of standing
// up a full DisplayAnki (Display/AnkiNoteBuilder/PopupMenu dependency graph).
// eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
const saveAnkiNote = DisplayAnki.prototype._saveAnkiNote;
// eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
const savePhraseNote = DisplayAnki.prototype._savePhraseNote;
// eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
const addNewAnkiNote = DisplayAnki.prototype._addNewAnkiNote;

/**
 * @param {{overwrite?: boolean, addNoteOutcome?: 'success'|'error', headword?: string, addSetsOverwriteFlag?: boolean, realAddNoteId?: ?string, decision?: {action: string, cards: {reverse: boolean, phrases: boolean}}, entry?: ?HTMLElement, flibEnrichNote?: import('vitest').Mock, getOptions?: () => unknown, flibGatewayStatus?: import('vitest').Mock, modelName?: string, ankiRoute?: ?{mode: string}, getAnkiRoute?: import('vitest').Mock, addAnkiNote?: import('vitest').Mock}} [options]
 *   `realAddNoteId` — подставить НАСТОЯЩИЙ `_addNewAnkiNote` вместо заглушки
 *   и заставить `api.addAnkiNote` вернуть это значение (`null` — «дубликат
 *   предотвращён»).
 * @returns {{context: object, recordEvent: import('vitest').Mock, cardFormatIndex: number}}
 */
function createSaveAnkiNoteContext({overwrite = false, addNoteOutcome = 'success', headword = 'figure out', addSetsOverwriteFlag = false, realAddNoteId, decision, entry = null, flibEnrichNote = vi.fn(async () => ({})), getOptions = () => null, flibGatewayStatus = vi.fn(), modelName = 'Yomitan Card Type', ankiRoute = null, getAnkiRoute = vi.fn(async () => ({mode: 'direct'})), addAnkiNote = vi.fn().mockResolvedValue(realAddNoteId ?? null)} = {}) {
    const recordEvent = vi.fn().mockResolvedValue(true);
    const useRealAdd = typeof realAddNoteId !== 'undefined';
    const cardFormatIndex = 0;
    const dictionaryEntry = /** @type {import('dictionary').DictionaryEntry} */ (/** @type {unknown} */ ({
        type: 'term',
        headwords: [{term: headword}],
    }));
    const button = /** @type {HTMLButtonElement} */ (/** @type {unknown} */ ({
        disabled: false,
        dataset: overwrite ? {overwrite: '1'} : {},
    }));
    const context = {
        _display: {
            getOptions,
            dictionaryEntries: [dictionaryEntry],
            progressIndicatorVisible: {
                setOverride: vi.fn(() => 'token'),
                clearOverride: vi.fn(),
            },
            application: {
                api: {
                    flibRecordEvent: recordEvent,
                    flibEnrichNote,
                    flibGatewayStatus,
                    getAnkiRoute,
                    addAnkiNote,
                },
            },
        },
        _dictionaryEntryDetails: [
            {noteMap: new Map([[cardFormatIndex, {requirements: []}]])},
        ],
        // Read by the stray `setTimeout` that re-enables the button; not
        // under test here, just needs to exist so that callback doesn't throw.
        _duplicateBehavior: 'prevent',
        _saveButtonFind: vi.fn(() => button),
        _hideErrorNotification: vi.fn(),
        _showErrorNotification: vi.fn(),
        _createNote: vi.fn().mockResolvedValue({note: {fields: {}, tags: [], modelName}, errors: [], requirements: []}),
        _getAddNoteRequirementsError: vi.fn(() => null),
        _applyExtraTagsToNote: vi.fn(),
        // null entry short-circuits the video-examples data-field hook —
        // irrelevant to the event under test.
        _getEntry: vi.fn(() => entry),
        // Оформление кнопки карточки Flib-club к событию отношения не имеет.
        _applyCardFormatUi: vi.fn(),
        _lastSaved: new WeakMap(),
        _savingNotes: new Map(),
        _videoExamplesPanels: new Map(),
        _hasNotes: vi.fn(() => false),
        // eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
        _takeGatewaySnapshot: DisplayAnki.prototype._takeGatewaySnapshot,
        _collectExtraTags: vi.fn(() => []),
        _applySelectedClipsToNote: vi.fn(async () => null),
        // eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
        _saveAnkiNoteClaimed: DisplayAnki.prototype._saveAnkiNoteClaimed,
        _decideEnrichment: typeof decision === 'undefined' ?
            // eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
            DisplayAnki.prototype._decideEnrichment :
            async () => decision,
        _ankiRoute: ankiRoute,
        // eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
        _startEnrichment: DisplayAnki.prototype._startEnrichment,
        // eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
        _renderEnrichStatus: DisplayAnki.prototype._renderEnrichStatus,
        // eslint-disable-next-line no-underscore-dangle, @typescript-eslint/unbound-method
        _renderNoKeyStatus: DisplayAnki.prototype._renderNoKeyStatus,
        _getOverwrittenNote: vi.fn().mockResolvedValue({fields: {}, tags: []}),
        _updateAnkiNote: vi.fn(async (_note, allErrors) => {
            if (addNoteOutcome === 'error') { allErrors.push(new Error('overwrite failed')); }
        }),
        // ⚠️ addSetsOverwriteFlag mirrors what the real _addNewAnkiNote does
        // via _updateSaveButtonForDuplicateBehavior on a successful add under
        // duplicateBehavior='overwrite': it sets button.dataset.overwrite AFTER
        // the add itself succeeded, priming the button for next time. This is
        // exactly the write the guard must not read.
        _addNewAnkiNote: useRealAdd ?
addNewAnkiNote :
vi.fn(async (_note, allErrors) => {
    if (addNoteOutcome === 'error') { allErrors.push(new Error('add failed')); }
    if (addSetsOverwriteFlag) { button.dataset.overwrite = 'true'; }
}),
        // Ниже — только для настоящего _addNewAnkiNote.
        _suspendNewCards: false,
        _forceSync: false,
        _getCardFormatIndex: vi.fn(() => cardFormatIndex),
        _updateSaveButtonForDuplicateBehavior: vi.fn(),
        _updateViewNoteButton: vi.fn(),
    };
    return {context, recordEvent, cardFormatIndex};
}

describe('DisplayAnki#_saveAnkiNote — событие word_added_to_dict', () => {
    test('успешное добавление, без перезаписи — ровно одно событие с заголовком статьи', async () => {
        const {context, recordEvent, cardFormatIndex} = createSaveAnkiNoteContext({headword: 'figure out'});

        await saveAnkiNote.call(context, 0, cardFormatIndex);

        expect(recordEvent).toHaveBeenCalledTimes(1);
        expect(recordEvent).toHaveBeenCalledWith('word_added_to_dict', ['figure out']);
    });

    test('добавление с ошибкой (allErrors непуст) — ноль событий', async () => {
        const {context, recordEvent, cardFormatIndex} = createSaveAnkiNoteContext({addNoteOutcome: 'error'});

        await saveAnkiNote.call(context, 0, cardFormatIndex);

        expect(recordEvent).not.toHaveBeenCalled();
    });

    test('успешная перезапись (button.dataset.overwrite установлен) — ноль событий', async () => {
        const {context, recordEvent, cardFormatIndex} = createSaveAnkiNoteContext({overwrite: true});

        await saveAnkiNote.call(context, 0, cardFormatIndex);

        expect(recordEvent).not.toHaveBeenCalled();
    });

    // ⚠️ Пробел, который тут закрывается: guard «событие только при пустом
    // allErrors» на пути ТЕРМИНА держится на том, что _addNewAnkiNote кладёт
    // туда `new Error('Note could not be added')`, когда api.addAnkiNote
    // вернул null (duplicateBehavior='prevent', дубликат предотвращён).
    // Удаление этого push оставляло suite зелёным — и клик «дубликат
    // предотвращён» отправлял бы word_added_to_dict, то есть ложь об
    // обучении. У пути ФРАЗЫ такой тест был, у термина — нет.
    test('дубликат предотвращён (addAnkiNote вернул null) — ноль событий', async () => {
        const {context, recordEvent, cardFormatIndex} = createSaveAnkiNoteContext({realAddNoteId: null});

        await saveAnkiNote.call(context, 0, cardFormatIndex);

        expect(recordEvent).not.toHaveBeenCalled();
    });

    test('настоящий _addNewAnkiNote с реальным id — событие ровно одно', async () => {
        // Обратная сторона: с тем же настоящим _addNewAnkiNote успешное
        // добавление обязано событие дать — иначе тест выше был бы зелёным
        // просто потому, что путь не работает вовсе.
        const {context, recordEvent, cardFormatIndex} = createSaveAnkiNoteContext({realAddNoteId: 'note-42', headword: 'figure out'});

        await saveAnkiNote.call(context, 0, cardFormatIndex);

        expect(recordEvent).toHaveBeenCalledTimes(1);
        expect(recordEvent).toHaveBeenCalledWith('word_added_to_dict', ['figure out']);
    });

    // Regression for the finding: duplicateBehavior='overwrite' makes
    // _addNewAnkiNote itself flip button.dataset.overwrite to 'true' on a
    // successful FRESH add (priming the button for the next click). The
    // branch decision (add vs overwrite) must be taken from a flag captured
    // BEFORE the add, or this successful add — the common case in that mode —
    // would silently lose its event.
    test('успешное добавление, флаг overwrite выставляется add\'ом уже ПОСЛЕ решения (duplicateBehavior=overwrite) — событие всё равно ровно одно', async () => {
        const {context, recordEvent, cardFormatIndex} = createSaveAnkiNoteContext({
            overwrite: false,
            addSetsOverwriteFlag: true,
            headword: 'figure out',
        });

        await saveAnkiNote.call(context, 0, cardFormatIndex);

        expect(recordEvent).toHaveBeenCalledTimes(1);
        expect(recordEvent).toHaveBeenCalledWith('word_added_to_dict', ['figure out']);
    });
});

describe('DisplayAnki#_saveAnkiNote — обогащение и подсказка про ключ', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => {
        env = await setupDomTest();
        setUiLanguage('ru');
    });
    afterEach(async () => { await env.teardown(global); });

    /** @returns {HTMLElement} */
    function makeEntry() {
        const entry = document.createElement('div');
        const header = document.createElement('div');
        header.className = 'entry-header';
        entry.appendChild(header);
        document.body.appendChild(entry);
        return entry;
    }

    /**
     * @param {object} context
     * @returns {import('vitest').Mock}
     */
    function addMock(context) {
        // eslint-disable-next-line no-underscore-dangle
        return /** @type {*} */ (context)._display.application.api.addAnkiNote;
    }

    /**
     * @param {object} context
     * @returns {string[]}
     */
    function addedTags(context) {
        const call = /** @type {[{tags: string[]}]} */ (/** @type {unknown} */ (addMock(context).mock.calls[0]));
        return call[0].tags;
    }

    const cardsOn = {reverse: true, phrases: true};

    test('no key: note added without flib_enriched, no flibEnrichNote, hint rendered', async () => {
        const entry = makeEntry();
        const flibEnrichNote = vi.fn(async () => ({}));
        const {context, cardFormatIndex} = createSaveAnkiNoteContext({realAddNoteId: 'note-1', decision: {action: 'no-key', cards: cardsOn}, entry, flibEnrichNote});

        await saveAnkiNote.call(context, 0, cardFormatIndex);

        expect(addedTags(context)).not.toContain('flib_enriched');
        expect(flibEnrichNote).not.toHaveBeenCalled();
        expect(entry.querySelectorAll('.fc-enrich-status[data-state=warn]')).toHaveLength(1);
    });

    test('no key, but the add failed: no hint', async () => {
        const entry = makeEntry();
        const {context, cardFormatIndex} = createSaveAnkiNoteContext({realAddNoteId: null, decision: {action: 'no-key', cards: cardsOn}, entry});

        await saveAnkiNote.call(context, 0, cardFormatIndex);

        expect(entry.querySelector('.fc-enrich-status')).toBeNull();
    });

    test('enrich: flags reach flibEnrichNote', async () => {
        const flibEnrichNote = vi.fn(async () => ({enrich: {status: 'done'}, audio: {status: 'done'}, reverse: {status: 'skipped'}, phrases: {status: 'done'}, speechCode: null}));
        const cards = {reverse: false, phrases: true};
        const {context, cardFormatIndex} = createSaveAnkiNoteContext({realAddNoteId: 'note-1', decision: {action: 'enrich', cards}, entry: makeEntry(), flibEnrichNote});

        await saveAnkiNote.call(context, 0, cardFormatIndex);
        await vi.waitFor(() => { expect(flibEnrichNote).toHaveBeenCalledTimes(1); });

        expect(flibEnrichNote).toHaveBeenCalledWith('note-1', [], cards);
        expect(addedTags(context)).toContain('flib_enriched');
    });

    test('status call throws: save succeeds, event recorded, no hint', async () => {
        const entry = makeEntry();
        const flibEnrichNote = vi.fn(async () => ({}));
        const flibGatewayStatus = vi.fn(async () => { throw new Error('boom'); });
        const {context, recordEvent, cardFormatIndex} = createSaveAnkiNoteContext({
            realAddNoteId: 'note-1',
            entry,
            flibEnrichNote,
            flibGatewayStatus,
            getOptions: () => ({flibService: {enrichCards: true}}),
        });

        await saveAnkiNote.call(context, 0, cardFormatIndex);

        expect(flibGatewayStatus).toHaveBeenCalledTimes(1);
        expect(addMock(context)).toHaveBeenCalledTimes(1);
        expect(addedTags(context)).not.toContain('flib_enriched');
        expect(recordEvent).toHaveBeenCalledWith('word_added_to_dict', ['figure out']);
        expect(flibEnrichNote).not.toHaveBeenCalled();
        expect(entry.querySelector('.fc-enrich-status')).toBeNull();
    });

    describe('real _decideEnrichment', () => {
        const optionsOn = (extra = {}) => () => ({flibService: {enrichCards: true, ...extra}});

        test('key missing, direct route: hint, no tag, no enrichment', async () => {
            const entry = makeEntry();
            const flibEnrichNote = vi.fn(async () => ({}));
            const flibGatewayStatus = vi.fn(async () => ({hasKey: false}));
            const {context, cardFormatIndex} = createSaveAnkiNoteContext({realAddNoteId: 'note-1', entry, flibEnrichNote, flibGatewayStatus, getOptions: optionsOn()});
            await saveAnkiNote.call(context, 0, cardFormatIndex);
            expect(entry.querySelectorAll('.fc-enrich-status[data-state=warn]')).toHaveLength(1);
            expect(addedTags(context)).not.toContain('flib_enriched');
            expect(flibEnrichNote).not.toHaveBeenCalled();
        });

        test('key present, reverse off: flags reach flibEnrichNote', async () => {
            const flibEnrichNote = vi.fn(async () => ({enrich: {status: 'done'}, audio: {status: 'done'}, reverse: {status: 'skipped'}, phrases: {status: 'done'}, speechCode: null}));
            const flibGatewayStatus = vi.fn(async () => ({hasKey: true}));
            const {context, cardFormatIndex} = createSaveAnkiNoteContext({realAddNoteId: 'note-1', entry: makeEntry(), flibEnrichNote, flibGatewayStatus, getOptions: optionsOn({createReverseCard: false})});
            await saveAnkiNote.call(context, 0, cardFormatIndex);
            await vi.waitFor(() => { expect(flibEnrichNote).toHaveBeenCalledTimes(1); });
            expect(flibEnrichNote).toHaveBeenCalledWith('note-1', [], {reverse: false, phrases: true});
            expect(addedTags(context)).toContain('flib_enriched');
        });

        test('core route with no key: no hint, no tag', async () => {
            const entry = makeEntry();
            const flibEnrichNote = vi.fn(async () => ({}));
            const flibGatewayStatus = vi.fn(async () => ({hasKey: false}));
            const {context, cardFormatIndex} = createSaveAnkiNoteContext({realAddNoteId: 'note-1', entry, flibEnrichNote, flibGatewayStatus, getOptions: optionsOn(), getAnkiRoute: vi.fn(async () => ({mode: 'core'}))});
            await saveAnkiNote.call(context, 0, cardFormatIndex);
            expect(entry.querySelector('.fc-enrich-status')).toBeNull();
            expect(addedTags(context)).not.toContain('flib_enriched');
            expect(flibEnrichNote).not.toHaveBeenCalled();
        });

        test('cached route none, fresh route core: no hint, no tag', async () => {
            const entry = makeEntry();
            const getAnkiRoute = vi.fn(async () => ({mode: 'core'}));
            const {context, cardFormatIndex} = createSaveAnkiNoteContext({realAddNoteId: 'note-1', entry, flibGatewayStatus: vi.fn(async () => ({hasKey: false})), getOptions: optionsOn(), ankiRoute: {mode: 'none'}, getAnkiRoute});
            await saveAnkiNote.call(context, 0, cardFormatIndex);
            expect(getAnkiRoute).toHaveBeenCalledWith(true);
            expect(entry.querySelector('.fc-enrich-status')).toBeNull();
            expect(addedTags(context)).not.toContain('flib_enriched');
        });

        test('cached route core, fresh route direct: hint', async () => {
            const entry = makeEntry();
            const {context, cardFormatIndex} = createSaveAnkiNoteContext({realAddNoteId: 'note-1', entry, flibGatewayStatus: vi.fn(async () => ({hasKey: false})), getOptions: optionsOn(), ankiRoute: {mode: 'core'}, getAnkiRoute: vi.fn(async () => ({mode: 'direct'}))});
            await saveAnkiNote.call(context, 0, cardFormatIndex);
            expect(entry.querySelectorAll('.fc-enrich-status[data-state=warn]')).toHaveLength(1);
        });

        test('getAnkiRoute throws: no hint, the save succeeds', async () => {
            const entry = makeEntry();
            const {context, cardFormatIndex} = createSaveAnkiNoteContext({realAddNoteId: 'note-1', entry, flibGatewayStatus: vi.fn(async () => ({hasKey: false})), getOptions: optionsOn(), getAnkiRoute: vi.fn(async () => { throw new Error('boom'); })});
            await saveAnkiNote.call(context, 0, cardFormatIndex);
            expect(entry.querySelector('.fc-enrich-status')).toBeNull();
            expect(addMock(context)).toHaveBeenCalledTimes(1);
        });

        test('key present: getAnkiRoute is not called', async () => {
            const getAnkiRoute = vi.fn(async () => ({mode: 'direct'}));
            const flibEnrichNote = vi.fn(async () => ({enrich: {status: 'done'}, audio: {status: 'done'}, reverse: {status: 'done'}, phrases: {status: 'done'}, speechCode: null}));
            const {context, cardFormatIndex} = createSaveAnkiNoteContext({realAddNoteId: 'note-1', entry: makeEntry(), flibEnrichNote, flibGatewayStatus: vi.fn(async () => ({hasKey: true})), getOptions: optionsOn(), getAnkiRoute});
            await saveAnkiNote.call(context, 0, cardFormatIndex);
            await vi.waitFor(() => { expect(flibEnrichNote).toHaveBeenCalledTimes(1); });
            expect(getAnkiRoute).not.toHaveBeenCalled();
        });

        test('status call throws (hasKey null): getAnkiRoute is not called', async () => {
            const getAnkiRoute = vi.fn(async () => ({mode: 'direct'}));
            const entry = makeEntry();
            const {context, cardFormatIndex} = createSaveAnkiNoteContext({realAddNoteId: 'note-1', entry, flibGatewayStatus: vi.fn(async () => { throw new Error('down'); }), getOptions: optionsOn(), getAnkiRoute});
            await saveAnkiNote.call(context, 0, cardFormatIndex);
            expect(getAnkiRoute).not.toHaveBeenCalled();
            expect(entry.querySelector('.fc-enrich-status')).toBeNull();
        });

        test('the route probe runs AFTER addAnkiNote, never before', async () => {
            const order = /** @type {string[]} */ ([]);
            const getAnkiRoute = vi.fn(async () => {
                order.push('route');
                return {mode: 'direct'};
            });
            const addAnkiNote = vi.fn(async () => {
                order.push('add');
                return 'note-1';
            });
            const {context, cardFormatIndex} = createSaveAnkiNoteContext({realAddNoteId: 'note-1', entry: makeEntry(), flibGatewayStatus: vi.fn(async () => ({hasKey: false})), getOptions: optionsOn(), getAnkiRoute, addAnkiNote});
            await saveAnkiNote.call(context, 0, cardFormatIndex);
            expect(order).toStrictEqual(['add', 'route']);
        });

        test('the add fails: no route probe at all', async () => {
            const getAnkiRoute = vi.fn(async () => ({mode: 'direct'}));
            const {context, cardFormatIndex} = createSaveAnkiNoteContext({realAddNoteId: 'note-1', entry: makeEntry(), flibGatewayStatus: vi.fn(async () => ({hasKey: false})), getOptions: optionsOn(), getAnkiRoute, addAnkiNote: vi.fn().mockRejectedValue(new Error('anki down'))});
            await saveAnkiNote.call(context, 0, cardFormatIndex);
            expect(getAnkiRoute).not.toHaveBeenCalled();
        });

        test.each([
            ['another model', {modelName: 'Basic', getOptions: optionsOn()}],
            ['enrichCards off', {getOptions: () => ({flibService: {enrichCards: false}})}],
            ['null flibService', {getOptions: () => ({flibService: null})}],
        ])('%s: the status call is not made and the save succeeds', async (_name, extra) => {
            const flibGatewayStatus = vi.fn(async () => ({hasKey: true}));
            const {context, cardFormatIndex} = createSaveAnkiNoteContext({realAddNoteId: 'note-1', entry: makeEntry(), flibGatewayStatus, ...extra});
            await saveAnkiNote.call(context, 0, cardFormatIndex);
            expect(flibGatewayStatus).not.toHaveBeenCalled();
            expect(addMock(context)).toHaveBeenCalledTimes(1);
        });
    });
});

/**
 * @param {{phraseText?: string, displayQuery?: string, noteId?: ?string, saveButton?: ?{disabled: boolean}}} [options]
 * @returns {{context: object, recordEvent: import('vitest').Mock, addAnkiNote: import('vitest').Mock, applyPhraseCardUi: import('vitest').Mock}}
 */
function createSavePhraseNoteContext({phraseText = 'take it easy', displayQuery = 'take it easy!! (selection)', noteId = 'note-1', saveButton = null} = {}) {
    const recordEvent = vi.fn().mockResolvedValue(true);
    const addAnkiNote = vi.fn().mockResolvedValue(noteId);
    const applyPhraseCardUi = vi.fn();
    const entry = {
        /**
         * @param {string} selector
         * @returns {?{value: string}}
         */
        querySelector: (selector) => {
            if (selector === '.phrase-expression-input') { return {value: phraseText}; }
            if (selector === '.phrase-translate-input') { return {value: 'перевод'}; }
            return null;
        },
    };
    const context = {
        _display: {
            // Deliberately different from phraseText: the lemma-source test
            // fails loudly if the implementation reads this instead.
            query: displayQuery,
            progressIndicatorVisible: {
                setOverride: vi.fn(() => 'token'),
                clearOverride: vi.fn(),
            },
            application: {
                api: {
                    addAnkiNote,
                    flibRecordEvent: recordEvent,
                },
            },
        },
        _getEntry: vi.fn(() => entry),
        _buildPhraseNote: vi.fn(() => ({fields: {}, tags: []})),
        _applyExtraTagsToNote: vi.fn(),
        _setPhraseButtonState: vi.fn(),
        _showErrorNotification: vi.fn(),
        _hideErrorNotification: vi.fn(),
        _saveButtonFind: vi.fn(() => saveButton),
        _applyPhraseCardUi: applyPhraseCardUi,
    };
    return {context, recordEvent, addAnkiNote, applyPhraseCardUi};
}

describe('DisplayAnki#_savePhraseNote — событие word_added_to_dict', () => {
    const cardFormatIndex = 0;

    test('успех — ровно одно событие, лемма из отредактированного поля, а не из this._display.query', async () => {
        const {context, recordEvent} = createSavePhraseNoteContext({
            phraseText: 'take it easy',
            displayQuery: 'take it easy!! (selection)',
        });

        await savePhraseNote.call(context, cardFormatIndex);

        expect(recordEvent).toHaveBeenCalledTimes(1);
        expect(recordEvent).toHaveBeenCalledWith('word_added_to_dict', ['take it easy']);
    });

    test('noteId === null (дубликат предотвращён) — ноль событий', async () => {
        const {context, recordEvent} = createSavePhraseNoteContext({noteId: null});

        await savePhraseNote.call(context, cardFormatIndex);

        expect(recordEvent).not.toHaveBeenCalled();
    });
    test('кнопка заблокирована (сохранение уже идёт) — второй addAnkiNote не уходит', async () => {
        const {context, addAnkiNote} = createSavePhraseNoteContext({saveButton: {disabled: true}});

        await savePhraseNote.call(context, cardFormatIndex);

        expect(addAnkiNote).not.toHaveBeenCalled();
    });

    test('во время сохранения — «Сохраняю…» и блокировка, после — снова доступна', async () => {
        const saveButton = {disabled: false};
        const {context, addAnkiNote, applyPhraseCardUi} = createSavePhraseNoteContext({saveButton});
        /** @type {boolean[]} */
        const disabledDuringAdd = [];
        addAnkiNote.mockImplementation(async () => {
            disabledDuringAdd.push(saveButton.disabled);
            return 'note-1';
        });

        await savePhraseNote.call(context, cardFormatIndex);

        expect(disabledDuringAdd).toStrictEqual([true]);
        expect(saveButton.disabled).toBe(false);
        expect(applyPhraseCardUi.mock.calls).toStrictEqual([[cardFormatIndex, true], [cardFormatIndex, false]]);
    });
});
