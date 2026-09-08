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

import {describe, expect, test, vi} from 'vitest';
import {DisplayAnki} from '../ext/js/display/display-anki.js';
import {pickAddedLemma} from '../ext/js/display/display-translation.js';

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
 * @param {{overwrite?: boolean, addNoteOutcome?: 'success'|'error', headword?: string, addSetsOverwriteFlag?: boolean, realAddNoteId?: ?string}} [options]
 *   `realAddNoteId` — подставить НАСТОЯЩИЙ `_addNewAnkiNote` вместо заглушки
 *   и заставить `api.addAnkiNote` вернуть это значение (`null` — «дубликат
 *   предотвращён»).
 * @returns {{context: object, recordEvent: import('vitest').Mock, cardFormatIndex: number}}
 */
function createSaveAnkiNoteContext({overwrite = false, addNoteOutcome = 'success', headword = 'figure out', addSetsOverwriteFlag = false, realAddNoteId} = {}) {
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
            dictionaryEntries: [dictionaryEntry],
            progressIndicatorVisible: {
                setOverride: vi.fn(() => 'token'),
                clearOverride: vi.fn(),
            },
            application: {
                api: {
                    flibRecordEvent: recordEvent,
                    addAnkiNote: vi.fn().mockResolvedValue(realAddNoteId ?? null),
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
        _createNote: vi.fn().mockResolvedValue({note: {fields: {}, tags: []}, errors: [], requirements: []}),
        _getAddNoteRequirementsError: vi.fn(() => null),
        _applyExtraTagsToNote: vi.fn(),
        // null entry short-circuits the video-examples data-field hook —
        // irrelevant to the event under test.
        _getEntry: vi.fn(() => null),
        _applySelectedClipsToNote: vi.fn(),
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

/**
 * @param {{phraseText?: string, displayQuery?: string, noteId?: ?string}} [options]
 * @returns {{context: object, recordEvent: import('vitest').Mock}}
 */
function createSavePhraseNoteContext({phraseText = 'take it easy', displayQuery = 'take it easy!! (selection)', noteId = 'note-1'} = {}) {
    const recordEvent = vi.fn().mockResolvedValue(true);
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
                    addAnkiNote: vi.fn().mockResolvedValue(noteId),
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
    };
    return {context, recordEvent};
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
});
