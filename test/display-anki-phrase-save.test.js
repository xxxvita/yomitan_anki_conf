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

/* eslint-disable no-underscore-dangle, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */

import {afterAll, afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {log} from '../ext/js/core/log.js';
import {Display} from '../ext/js/display/display.js';
import {createPhraseCard, createPhraseSaveError, getPhraseCardFormatIndex} from '../ext/js/display/phrase-save-util.js';
import {getUiLanguage, setUiLanguage, translate} from '../ext/js/i18n/ui-language.js';
import {setupDomTest} from './fixtures/dom-test.js';
import {codeError, DEBOUNCE, defer, format, makeRig, openRig, PHRASE_CALLS, SERVER, settle} from './fixtures/phrase-window-rig.js';

const {window, teardown} = await setupDomTest();
afterAll(() => teardown(global));

const language = getUiLanguage();
beforeEach(() => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
    vi.stubGlobal('chrome', {runtime: {getURL: (/** @type {string} */ path) => `chrome-extension://x${path}`}});
    vi.spyOn(log, 'log').mockImplementation(() => {});
    vi.spyOn(log, 'error').mockImplementation(() => {});
    setUiLanguage('ru');
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setUiLanguage(language);
    document.body.replaceChildren();
});

const WHOLE = {
    Front: 'I love it',
    Expression: 'I love it',
    EnglishWord: 'I love it',
    ExpressionTranslate: '',
    flib_media: '',
    Audio_front: '',
    Audio_expression: '',
};

describe('what is saved', () => {
    test('nothing selected: the whole phrase; prepare, find, add', async () => {
        const rig = await openRig('I love it');
        rig.calls.length = 0;
        rig.press();
        await settle();
        expect(rig.sent()).toStrictEqual([
            ['flibPhrasePrepare', []],
            ['flibPhraseFind', [{server: SERVER, deckName: 'My deck', front: 'I love it', englishWord: 'I love it'}]],
            ['flibPhraseAdd', [{server: SERVER, deckName: 'My deck', fields: WHOLE, tags: ['flib_phrase', 'webpage_bbc_com', 'flib_enriched']}]],
        ]);
        expect(rig.button()).toBe('open 1000');
        expect(rig.errors()).toStrictEqual([]);
        // Nothing of the old way, no event, no request to the gateway, no suspend and no sync, as before.
        expect([...new Set(rig.calls.map(([name]) => name))].sort()).toStrictEqual(['flibPhraseAdd', 'flibPhraseFind', 'flibPhrasePrepare']);
    });

    test('a selection kept after the focus moved to the button: the blank', async () => {
        const rig = await openRig('I love it');
        rig.selectPart('love');
        rig.press();
        rig.ui.english().setSelectionRange(0, 0);
        await settle();
        expect(document.activeElement).not.toBe(rig.ui.english());
        expect(rig.argsOf('flibPhraseAdd')[0].fields).toStrictEqual({...WHOLE, Front: 'I _____ it', EnglishWord: 'love'});
    });

    test('the browser drops the selection between the mouse press and the click', async () => {
        const rig = await openRig('I love it');
        rig.selectPart('love');
        const save = rig.ui.save();
        save.dispatchEvent(new window.MouseEvent('mousedown', {bubbles: true}));
        rig.ui.english().setSelectionRange(0, 0);
        // The field lost its focus without a focusout, as a page of a popup does it.
        Object.defineProperty(document, 'activeElement', {value: save, configurable: true});
        save.click();
        Reflect.deleteProperty(document, 'activeElement');
        await settle();
        expect(rig.argsOf('flibPhraseAdd')[0].fields.EnglishWord).toBe('love');
    });

    test('a press with the keyboard: the focus left the field before', async () => {
        const rig = await openRig('I love it');
        rig.selectPart('it');
        rig.ui.save().focus();
        rig.ui.english().setSelectionRange(0, 0);
        rig.ui.save().click();
        await settle();
        expect(rig.argsOf('flibPhraseAdd')[0].fields.Front).toBe('I love _____');
    });

    test('the selected place, not the first equal word', async () => {
        const rig = await openRig('I love what you love');
        rig.selectPart('love', 5);
        rig.press();
        await settle();
        expect(rig.argsOf('flibPhraseAdd')[0].fields).toMatchObject({Front: 'I love what you _____', EnglishWord: 'love', Expression: 'I love what you love'});
    });

    test('edited text and translation; the selection of the text before the edit is forgotten', async () => {
        const rig = await openRig('I love it');
        rig.selectPart('love');
        rig.ui.translation().focus();
        rig.type(rig.ui.english(), '  I hate\nit ');
        rig.type(rig.ui.translation(), ' Ненавижу\nэто ');
        rig.press();
        await settle();
        expect(rig.argsOf('flibPhraseAdd')[0].fields).toStrictEqual({...WHOLE, Front: 'I hate it', Expression: 'I hate it', EnglishWord: 'I hate it', ExpressionTranslate: 'Ненавижу<br>это'});
    });

    test('«?» writes into the translation: saved, and no new find', async () => {
        const rig = await openRig('I love it');
        await rig.wait();
        rig.calls.length = 0;
        rig.type(rig.ui.translation(), 'Мне это нравится');
        await rig.wait();
        expect(rig.calls).toStrictEqual([]);
        rig.press();
        await settle();
        expect(rig.argsOf('flibPhraseAdd')[0].fields.ExpressionTranslate).toBe('Мне это нравится');
    });

    test('tags: of the settings, the site, the pressed ones and flib_enriched, each once', async () => {
        const rig = await openRig('I love it', {tags: ['flib_phrase', 'vocab', 'flib_enriched']});
        rig.anki._activeUserTags.add('vocab');
        rig.press();
        await settle();
        expect(rig.argsOf('flibPhraseAdd')[0].tags).toStrictEqual(['flib_phrase', 'vocab', 'flib_enriched', 'webpage_bbc_com']);
        expect(rig.options.anki.tags).toStrictEqual(['flib_phrase', 'vocab', 'flib_enriched']);
    });

    test('everything is of the moment of the press', async () => {
        const rig = await openRig('I love it');
        rig.selectPart('love');
        rig.type(rig.ui.translation(), 'люблю');
        const prepared = defer();
        const prepare = rig.answers.flibPhrasePrepare;
        rig.answers.flibPhrasePrepare = async () => {
            await prepared.promise;
            return await prepare();
        };
        rig.press();
        await settle();
        rig.type(rig.ui.english(), 'Something else');
        rig.type(rig.ui.translation(), 'другое');
        rig.select(0, 4);
        rig.options.anki.tags = ['other'];
        rig.options.anki.cardFormats = [format({deck: 'Other deck'})];
        rig.anki._activeUserTags.add('vocab');
        rig.update();
        prepared.resolve(null);
        await settle();
        expect(rig.argsOf('flibPhraseAdd')).toStrictEqual([{
            server: SERVER,
            deckName: 'My deck',
            fields: {...WHOLE, Front: 'I _____ it', EnglishWord: 'love', ExpressionTranslate: 'люблю'},
            tags: ['flib_phrase', 'webpage_bbc_com', 'flib_enriched'],
        }]);
    });

    test.each(/** @type {[name: string, formats: import('settings').AnkiCardFormat[], deck: string, index: string][]} */ ([
        ['the first format of terms', [format({type: 'kanji', deck: 'Kanji'}), format({deck: 'First'}), format({deck: 'Second'})], 'First', '1'],
        ['no format of terms', [format({type: 'kanji', deck: 'Kanji'})], 'Flibooster', '0'],
        ['no formats', [], 'Flibooster', '0'],
        ['a format that is not set up', [format({deck: ''}), format({deck: 'Second'})], 'Flibooster', '0'],
        ['a blank deck', [format({deck: '  '})], 'Flibooster', '0'],
    ]))('deck: %s', async (_name, cardFormats, deck, index) => {
        const rig = await openRig('I love it', {cardFormats});
        expect(rig.argsOf('flibPhraseFind').map(({deckName}) => deckName)).toStrictEqual([deck]);
        expect(rig.button()).toBe('В Anki');
        expect(rig.ui.save().dataset.cardFormatIndex).toBe(index);
        rig.press();
        await settle();
        expect(rig.argsOf('flibPhraseAdd').map(({deckName}) => deckName)).toStrictEqual([deck]);
        expect(rig.button()).toBe('open 1000');
        rig.answers.viewNotes = () => 'browse';
        rig.hotkeys.viewNotes(index);
        await settle();
        expect(rig.calls.at(-1)).toStrictEqual(['viewNotes', [[1000], 'browse', false]]);
    });
});

describe('the sequence', () => {
    test('found: nothing is added, the button opens all of them', async () => {
        const rig = await openRig('I love it');
        rig.notes.push({id: 5, deckName: 'My deck', front: 'I love it', englishWord: 'I love it'}, {id: 7, deckName: 'My deck', front: 'I love it', englishWord: 'I love it'});
        rig.press();
        await settle();
        expect(rig.argsOf('flibPhraseAdd')).toStrictEqual([]);
        expect(rig.button()).toBe('open 5 7');
        expect(rig.ui.view()?.querySelector('.fc-badge')?.textContent).toBe('2');
        expect(rig.errors()).toStrictEqual([]);
    });

    test('existed: the same', async () => {
        const rig = await openRig('I love it');
        rig.answers.flibPhraseAdd = () => ({noteId: 12, existed: true});
        rig.press();
        await settle();
        expect(rig.button()).toBe('open 12');
        expect(rig.errors()).toStrictEqual([]);
    });

    test('the type became outdated: prepared once more, added once more, at the new address', async () => {
        const rig = await openRig('I love it');
        rig.calls.length = 0;
        const add = rig.answers.flibPhraseAdd;
        rig.answers.flibPhraseAdd = (params) => {
            if (params.server === SERVER) {
                rig.state.server = 'http://127.0.0.1:8777';
                throw codeError('anki_model_outdated');
            }
            return add(params);
        };
        rig.press();
        await settle();
        expect(rig.sent().map(([name]) => name)).toStrictEqual(['flibPhrasePrepare', 'flibPhraseFind', 'flibPhraseAdd', 'flibPhrasePrepare', 'flibPhraseAdd']);
        expect(rig.argsOf('flibPhraseAdd').map(({server}) => server)).toStrictEqual([SERVER, 'http://127.0.0.1:8777']);
        expect(rig.button()).toBe('open 1000');
        expect(rig.errors()).toStrictEqual([]);
    });

    test('outdated twice: an error, no third time', async () => {
        const rig = await openRig('I love it');
        rig.calls.length = 0;
        rig.answers.flibPhraseAdd = () => { throw codeError('anki_model_outdated'); };
        rig.press();
        await settle();
        expect(rig.argsOf('flibPhraseAdd')).toHaveLength(2);
        expect(rig.argsOf('flibPhrasePrepare')).toHaveLength(2);
        expect(rig.errors()).toStrictEqual([translate('anki.phraseModelOutdated')]);
        expect(rig.button()).toBe('В Anki');
    });

    test('outdated, then the preparation fails: its error', async () => {
        const rig = await openRig('I love it');
        rig.answers.flibPhraseAdd = () => {
            rig.answers.flibPhrasePrepare = () => { throw codeError('anki_closed'); };
            throw codeError('anki_model_outdated');
        };
        rig.press();
        await settle();
        expect(rig.argsOf('flibPhraseAdd')).toHaveLength(1);
        expect(rig.errors()).toStrictEqual(['Откройте Anki, чтобы сохранить фразу']);
    });

    test('nothing is prepared before a press', async () => {
        const rig = await openRig('I love it');
        rig.selectPart('love');
        await rig.wait();
        rig.type(rig.ui.english(), 'I hate it');
        await rig.wait();
        expect(rig.argsOf('flibPhrasePrepare')).toStrictEqual([]);
        expect(rig.argsOf('flibPhraseAdd')).toStrictEqual([]);
    });
});

/** @type {[code: string, message: string][]} */
const ERRORS = [
    ['anki_closed', 'anki.closedForPhrase'],
    ['anki_model_outdated', 'anki.phraseModelOutdated'],
    ['anki_model_failed', 'anki.phraseModelFailed'],
    ['anki_deck_failed', 'anki.phraseDeckFailed'],
    ['anki_route_switched', 'route.switched'],
    ['anki_note_gone', 'anki.phraseNoteGone'],
    ['anki_note_failed', 'anki.phraseNoteFailed'],
    ['flib_bad_request', 'anki.phraseBadRequest'],
];

describe('errors', () => {
    describe.each(['flibPhrasePrepare', 'flibPhraseFind', 'flibPhraseAdd'])('of %s', (step) => {
        test.each(ERRORS)('%s: the message, the texts stay, the next press saves', async (code, key) => {
            const rig = await openRig('I love it');
            rig.selectPart('love');
            rig.type(rig.ui.translation(), 'люблю');
            await rig.wait();
            const answer = rig.answers[step];
            rig.answers[step] = () => { throw codeError(code); };
            rig.press();
            await settle();
            const message = translate(key, {deck: 'My deck'});
            expect(message).not.toBe(key);
            expect(message).not.toContain('{');
            expect(rig.errors()).toStrictEqual([message]);
            expect(rig.ui.english().value).toBe('I love it');
            expect(rig.ui.translation().value).toBe('люблю');
            expect(rig.button()).toBe('В Anki');
            expect(rig.display.progressIndicatorVisible.clearOverride).toHaveBeenCalledTimes(1);
            expect(rig.anki._savingNotes.size).toBe(0);
            rig.answers[step] = answer;
            rig.press();
            await settle();
            await rig.wait(200);
            expect(rig.errors()).toStrictEqual([]);
            expect(rig.notes).toStrictEqual([{id: 1000, deckName: 'My deck', front: 'I _____ it', englishWord: 'love'}]);
            expect(rig.button()).toBe('open 1000');
        });
    });

    test('another error is shown as it is', async () => {
        const rig = await openRig('I love it');
        rig.answers.flibPhrasePrepare = () => { throw new Error('Extension context invalidated'); };
        rig.press();
        await settle();
        expect(rig.errors()).toStrictEqual(['Extension context invalidated']);
        expect(rig.button()).toBe('В Anki');
    });

    test('the words of the owner', () => {
        expect(translate('anki.closedForPhrase')).toBe('Откройте Anki, чтобы сохранить фразу');
        setUiLanguage('en');
        for (const [, key] of ERRORS) { expect(translate(key)).not.toMatch(/[Ѐ-ӿ]/); }
    });

    test.each([
        ['', 'anki.phraseEmpty'],
        ['  … !', 'anki.phraseEmpty'],
        ['привет, мир', 'anki.phraseNoLatin'],
        ['a '.repeat(2501), 'anki.phraseTooLong'],
    ])('%j cannot be saved: a message, nothing is sent', async (text, key) => {
        const rig = await openRig('I love it');
        rig.type(rig.ui.english(), text);
        await rig.wait();
        rig.calls.length = 0;
        const message = translate(key, {max: 5000});
        expect(message).not.toBe(key);
        expect(message).not.toContain('{');
        expect(rig.ui.save().title).toBe(message);
        rig.press();
        await settle();
        expect(rig.calls).toStrictEqual([]);
        expect(rig.errors()).toStrictEqual([message]);
        expect(rig.ui.english().value).toBe(text);
        expect(rig.button()).toBe('В Anki');
        rig.type(rig.ui.english(), 'I hate it');
        rig.press();
        await settle();
        expect(rig.notes.map(({front}) => front)).toStrictEqual(['I hate it']);
    });

    test('a window opened without a text: the button is there', async () => {
        const rig = await openRig('');
        expect(rig.sent()).toStrictEqual([]);
        rig.press();
        await settle();
        expect(rig.errors()).toStrictEqual([translate('anki.phraseEmpty')]);
        rig.type(rig.ui.english(), 'I love it');
        rig.press();
        await settle();
        expect(rig.button()).toBe('open 1000');
    });
});

describe('a press goes on to the end', () => {
    // eslint-disable-next-line jsdoc/require-returns -- the inferred shape is what the tests use
    /**
     * @param {string} step
     * @param {Parameters<typeof makeRig>[0]} [details]
     */
    const pressAndHold = async (step, details) => {
        const rig = await openRig('I love it', details);
        const gate = defer();
        const answer = rig.answers[step];
        rig.answers[step] = async (...args) => {
            rig.answers[step] = answer;
            await gate.promise;
            return await answer(...args);
        };
        rig.press();
        await settle();
        return {rig, gate};
    };
    const STEPS = ['flibPhrasePrepare', 'flibPhraseFind', 'flibPhraseAdd'];

    test.each(STEPS)('during %s: «Сохраняю…», no second press', async (step) => {
        const {rig, gate} = await pressAndHold(step);
        expect(rig.button()).toBe('Сохраняю… (disabled)');
        expect(rig.ui.kind()).toBe('saving');
        rig.press();
        rig.press();
        // Not through the button.
        rig.ui.save().disabled = false;
        rig.ui.save().dispatchEvent(new window.MouseEvent('click', {bubbles: true}));
        rig.hotkeys.addNote('0');
        gate.resolve(null);
        await settle();
        expect(rig.argsOf('flibPhrasePrepare')).toHaveLength(1);
        expect(rig.argsOf('flibPhraseAdd')).toHaveLength(1);
        expect(rig.button()).toBe('open 1000');
        expect(rig.display.progressIndicatorVisible.setOverride).toHaveBeenCalledTimes(1);
        expect(rig.display.progressIndicatorVisible.clearOverride).toHaveBeenCalledWith('token');
    });

    test('the notice «ещё сохраняется» opens for ticked videos and is closed by the end of the save', async () => {
        const {rig, gate} = await pressAndHold('flibPhraseAdd');
        const entry = rig.ui.entry();
        expect(rig.anki._savingNotes.get(entry)).toStrictEqual(new Set([0]));
        rig.anki._videoExamplesPanels.set(entry, /** @type {*} */ ({hasSelection: true, destroy: () => {}}));
        rig.ui.save().disabled = false;
        rig.press();
        expect(document.querySelector('#notifications')?.textContent).toBe(translate('anki.stillSaving'));
        gate.resolve(null);
        await settle();
        await rig.wait(200);
        expect(document.querySelector('#notifications')?.textContent).toBe('');
        expect(rig.anki._savingNotes.size).toBe(0);
    });

    test.each(STEPS)('the result is replaced during %s: saved, nothing is shown, the other button is not touched', async (step) => {
        const {rig, gate} = await pressAndHold(step);
        rig.open('Never mind');
        await settle();
        gate.resolve(null);
        await settle();
        expect(rig.notes.map(({front}) => front)).toStrictEqual(['I love it']);
        expect(rig.button()).toBe('В Anki');
        expect(rig.errors()).toStrictEqual([]);
        expect(rig.anki._savingNotes.size).toBe(0);
        expect(rig.display.progressIndicatorVisible.clearOverride).toHaveBeenCalledTimes(1);
    });

    test.each(STEPS)('the result is replaced during %s, which fails: a notice with the phrase, for good', async (step) => {
        const {rig, gate} = await pressAndHold(step);
        rig.open(null);
        await settle();
        gate.reject(codeError('anki_closed'));
        await settle();
        const expected = [translate('anki.notSavedWord', {word: 'I love it', reason: 'Откройте Anki, чтобы сохранить фразу'})];
        expect(rig.errors()).toStrictEqual(expected);
        rig.open('Never mind');
        await rig.wait();
        expect(rig.errors()).toStrictEqual(expected);
    });

    test.each([
        ['a blank and a translation', [2, 6], '  мой <перевод> & ещё\n', 'I love it — мой <перевод> & ещё (пропуск: love)'],
        ['a blank', [2, 6], ' ', 'I love it (пропуск: love)'],
        ['a translation', [0, 0], 'мой перевод', 'I love it — мой перевод'],
    ])('the notice carries %s of the press, as they were typed', async (_name, [start, end], translation, word) => {
        const rig = await openRig('I love it');
        const gate = defer();
        rig.answers.flibPhrasePrepare = () => gate.promise;
        rig.select(start, end);
        rig.type(rig.ui.translation(), translation);
        rig.press();
        await settle();
        rig.type(rig.ui.translation(), 'другое');
        rig.select(0, 1);
        rig.open('Never mind');
        await settle();
        gate.reject(codeError('anki_closed'));
        await settle();
        expect(rig.errors()).toStrictEqual([translate('anki.notSavedWord', {word, reason: 'Откройте Anki, чтобы сохранить фразу'})]);
    });

    test('the window is hidden when the save fails: the same notice', async () => {
        const {rig, gate} = await pressAndHold('flibPhraseFind');
        rig.display.frameVisible = false;
        gate.reject(codeError('anki_note_failed'));
        await settle();
        rig.open('Never mind');
        await settle();
        expect(rig.errors()).toStrictEqual([translate('anki.notSavedWord', {word: 'I love it', reason: translate('anki.phraseNoteFailed')})]);
    });

    test('back in the history to the same phrase while it is saved: the new button learns about the note', async () => {
        const {rig, gate} = await pressAndHold('flibPhraseAdd');
        rig.open('Never mind');
        rig.open('I love it');
        await settle();
        expect(rig.button()).toBe('В Anki');
        gate.resolve(null);
        await settle();
        expect(rig.button()).toBe('open 1000');
        expect(rig.ui.entry().querySelectorAll('.action-button-container')).toHaveLength(1);
    });

    test('back in the history: a fresh entry, no selection and no state of the old one', async () => {
        const rig = await openRig('I love it');
        rig.selectPart('love');
        rig.press();
        await settle();
        rig.open('Never mind');
        rig.open('I love it');
        await settle();
        expect(rig.button()).toBe('В Anki');
        expect(rig.ui.save().title).toBe(translate('anki.phraseWillWhole'));
        rig.press();
        await settle();
        expect(rig.notes.map(({front}) => front)).toStrictEqual(['I _____ it', 'I love it']);
    });

    test('the text is edited during the save: the button is about the new text', async () => {
        const {rig, gate} = await pressAndHold('flibPhraseAdd');
        rig.type(rig.ui.english(), 'I hate it');
        expect(rig.button()).toBe('Сохраняю… (disabled)');
        gate.resolve(null);
        await settle();
        await rig.wait();
        expect(rig.button()).toBe('В Anki');
        rig.type(rig.ui.english(), 'I love it');
        await rig.wait();
        expect(rig.button()).toBe('open 1000');
    });
});

describe('the state of the button', () => {
    test('on open: what is in Anki, at the address of the route', async () => {
        const rig = makeRig();
        rig.notes.push({id: 3, deckName: 'My deck', front: 'I love it', englishWord: 'I love it'});
        rig.state.server = 'http://127.0.0.1:8777';
        rig.open('I love it');
        expect(rig.button()).toBe('В Anki');
        await settle();
        expect(rig.argsOf('flibPhraseFind')).toStrictEqual([{server: 'http://127.0.0.1:8777', deckName: 'My deck', front: 'I love it', englishWord: 'I love it'}]);
        expect(rig.button()).toBe('open 3');
        expect(rig.ui.kind()).toBe('open');
    });

    test('nobody answered a moment ago (Anki has just been started): the route is looked at again', async () => {
        const rig = makeRig();
        rig.notes.push({id: 3, deckName: 'My deck', front: 'I love it', englishWord: 'I love it'});
        rig.answers.getAnkiRoute = (force) => (force === true ? {mode: 'direct', ankiServer: 'http://127.0.0.1:8765'} : {mode: 'none', ankiServer: 'http://127.0.0.1:8777'});
        rig.open('I love it');
        await settle();
        expect(rig.argsOf('flibPhraseFind')).toMatchObject([{server: 'http://127.0.0.1:8765'}]);
        expect(rig.button()).toBe('open 3');
    });

    test('a failed find says nothing', async () => {
        for (const name of ['getAnkiRoute', 'flibPhraseFind']) {
            const rig = makeRig();
            rig.answers[name] = () => { throw codeError('anki_closed'); };
            rig.open('I love it');
            await settle();
            expect(rig.button()).toBe('В Anki');
            expect(rig.errors()).toStrictEqual([]);
        }
    });

    test('the tooltip says what will be saved', async () => {
        const rig = await openRig('I love it');
        expect(rig.ui.save().title).toBe('В Anki: вся фраза');
        rig.selectPart('ov');
        expect(rig.ui.save().title).toBe('В Anki, пропуск: love');
        rig.select(1, 2);
        expect(rig.ui.save().title).toBe('В Anki: вся фраза');
        rig.type(rig.ui.english(), '');
        expect(rig.ui.save().title).toBe(translate('anki.phraseEmpty'));
        expect(rig.ui.save().dataset.hotkey).toBeUndefined();
    });

    test('text: «В Anki» at once, one find 400 ms after the last key', async () => {
        const rig = makeRig();
        rig.notes.push(
            {id: 3, deckName: 'My deck', front: 'I love it', englishWord: 'I love it'},
            {id: 4, deckName: 'My deck', front: 'I hate it', englishWord: 'I hate it'},
        );
        rig.open('I love it');
        await settle();
        expect(rig.button()).toBe('open 3');
        rig.calls.length = 0;
        rig.type(rig.ui.english(), 'I hate');
        expect(rig.button()).toBe('В Anki');
        expect(rig.ui.view()?.dataset.noteIds).toBe('');
        await rig.wait(DEBOUNCE - 1);
        rig.type(rig.ui.english(), 'I hate it');
        await rig.wait(DEBOUNCE - 1);
        expect(rig.calls).toStrictEqual([]);
        await rig.wait(1);
        expect(rig.argsOf('flibPhraseFind').map(({front}) => front)).toStrictEqual(['I hate it']);
        // Only its own notes, not those of the text before.
        expect(rig.button()).toBe('open 4');
        // The same text again before the answer, or spaces around it: no request.
        rig.type(rig.ui.english(), ' I hate  it ');
        await rig.wait();
        expect(rig.argsOf('flibPhraseFind')).toHaveLength(1);
        expect(rig.button()).toBe('open 4');
    });

    test('selection: «В Anki» at once, a find 400 ms later; a moved cursor is not a selection', async () => {
        const rig = makeRig();
        rig.notes.push(
            {id: 3, deckName: 'My deck', front: 'I love it', englishWord: 'I love it'},
            {id: 4, deckName: 'My deck', front: 'I _____ it', englishWord: 'love'},
            {id: 5, deckName: 'My deck', front: 'I _____ it', englishWord: 'hate'},
        );
        rig.open('I love it');
        await settle();
        rig.calls.length = 0;
        rig.select(4, 4);
        await rig.wait();
        expect(rig.calls).toStrictEqual([]);
        expect(rig.button()).toBe('open 3');
        rig.select(2, 4);
        expect(rig.button()).toBe('В Anki');
        rig.select(2, 6);
        await rig.wait();
        expect(rig.argsOf('flibPhraseFind')).toStrictEqual([{server: SERVER, deckName: 'My deck', front: 'I _____ it', englishWord: 'love'}]);
        expect(rig.button()).toBe('open 4');
        rig.select(0, 0);
        expect(rig.button()).toBe('В Anki');
        await rig.wait();
        expect(rig.button()).toBe('open 3');
    });

    test('the focus leaves the field, another field is selected: the remembered selection holds', async () => {
        const rig = await openRig('I love it');
        rig.selectPart('love');
        await rig.wait();
        rig.calls.length = 0;
        rig.ui.translation().focus();
        document.dispatchEvent(new window.Event('selectionchange'));
        await rig.wait();
        expect(rig.calls).toStrictEqual([]);
        expect(rig.ui.save().title).toBe('В Anki, пропуск: love');
    });

    test('the event may also come from the field itself', async () => {
        const rig = await openRig('I love it');
        rig.ui.english().focus();
        rig.ui.english().setSelectionRange(2, 6);
        rig.ui.english().dispatchEvent(new window.Event('selectionchange', {bubbles: true}));
        expect(rig.ui.save().title).toBe('В Anki, пропуск: love');
    });

    test('the event comes when the focus has left the field', async () => {
        const rig = await openRig('I love it');
        rig.ui.english().focus();
        rig.ui.english().setSelectionRange(2, 6);
        rig.ui.save().focus();
        document.dispatchEvent(new window.Event('selectionchange'));
        expect(rig.ui.save().title).toBe('В Anki, пропуск: love');
    });

    test('a late answer about the text before is ignored', async () => {
        const rig = makeRig();
        const late = defer();
        rig.answers.flibPhraseFind = ({front}) => (front === 'I love it' ? late.promise : {noteIds: []});
        rig.open('I love it');
        await settle();
        rig.type(rig.ui.english(), 'I hate it');
        await rig.wait();
        late.resolve({noteIds: [3]});
        await settle();
        expect(rig.button()).toBe('В Anki');
    });

    test('away and back: the answer to the first question does not count, the second one is asked', async () => {
        const rig = makeRig();
        const late = defer();
        const find = rig.answers.flibPhraseFind;
        rig.answers.flibPhraseFind = () => late.promise;
        rig.open('I love it');
        await settle();
        rig.answers.flibPhraseFind = find;
        rig.type(rig.ui.english(), 'I hate it');
        rig.type(rig.ui.english(), 'I love it');
        late.resolve({noteIds: [3]});
        await settle();
        expect(rig.button()).toBe('В Anki');
        await rig.wait();
        expect(rig.argsOf('flibPhraseFind')).toHaveLength(2);
        expect(rig.button()).toBe('В Anki');
    });

    test('a find started before a save never takes its result back', async () => {
        const rig = makeRig();
        const late = defer();
        const find = rig.answers.flibPhraseFind;
        rig.answers.flibPhraseFind = () => {
            rig.answers.flibPhraseFind = find;
            return late.promise;
        };
        rig.open('I love it');
        await settle();
        rig.press();
        await settle();
        expect(rig.button()).toBe('open 1000');
        late.resolve({noteIds: []});
        await settle();
        expect(rig.button()).toBe('open 1000');
        expect(rig.ui.save().hidden).toBe(true);
    });

    test('a find that answers during a save does not end «Сохраняю…»', async () => {
        const rig = makeRig();
        const late = defer();
        const gate = defer();
        const find = rig.answers.flibPhraseFind;
        rig.answers.flibPhraseFind = () => {
            rig.answers.flibPhraseFind = find;
            return late.promise;
        };
        const add = rig.answers.flibPhraseAdd;
        rig.answers.flibPhraseAdd = async (params) => {
            await gate.promise;
            return add(params);
        };
        rig.open('I love it');
        await settle();
        rig.press();
        await settle();
        late.resolve({noteIds: [3]});
        await settle();
        expect(rig.button()).toBe('Сохраняю… (disabled)');
        gate.resolve(null);
        await settle();
        expect(rig.button()).toBe('open 1000');
    });

    test('no find and no look at the route while a save is going on: it may move the address under the save', async () => {
        const rig = await openRig('I love it');
        const gate = defer();
        const prepare = rig.answers.flibPhrasePrepare;
        rig.answers.flibPhrasePrepare = async () => {
            await gate.promise;
            return await prepare();
        };
        rig.press();
        await settle();
        rig.calls.length = 0;
        rig.type(rig.ui.english(), 'I hate it');
        await rig.wait();
        expect(rig.calls).toStrictEqual([]);
        gate.resolve(null);
        await settle();
        expect(rig.argsOf('flibPhraseFind').map(({front}) => front)).toStrictEqual(['I love it', 'I hate it']);
        expect(rig.button()).toBe('В Anki');
    });

    test('no check of the connection while a save is going on', async () => {
        const rig = makeRig({connected: false});
        rig.answers.isAnkiConnected = () => { throw new Error('x'); };
        const gate = defer();
        rig.answers.flibPhrasePrepare = async () => {
            await gate.promise;
            throw codeError('anki_closed');
        };
        rig.open('I love it');
        rig.press();
        await settle();
        rig.calls.length = 0;
        rig.type(rig.ui.english(), 'I hate it');
        await rig.wait();
        expect(rig.calls).toStrictEqual([]);
        gate.resolve(null);
        await settle();
        expect(rig.argsOf('isAnkiConnected')).toHaveLength(1);
        expect(rig.argsOf('flibPhraseFind')).toStrictEqual([]);
    });

    test('a press during the check of the connection: the find waits for it', async () => {
        const rig = makeRig();
        const answer = defer();
        const gate = defer();
        rig.answers.isAnkiConnected = () => answer.promise;
        rig.answers.flibPhrasePrepare = () => gate.promise;
        rig.open('I love it');
        rig.press();
        await settle();
        answer.resolve(true);
        await settle();
        expect(rig.argsOf('getAnkiRoute')).toHaveLength(1);
        expect(rig.argsOf('flibPhraseFind')).toStrictEqual([]);
        gate.reject(codeError('anki_closed'));
        await settle();
        expect(rig.argsOf('flibPhraseFind')).toHaveLength(1);
    });

    test('the old window: its find and the end of its save do not touch the new button', async () => {
        const rig = makeRig();
        const late = defer();
        const gates = [defer(), defer()];
        rig.answers.flibPhraseFind = ({front}) => (front === 'I love it' && gates.length === 2 ? late.promise : {noteIds: []});
        rig.answers.flibPhrasePrepare = () => /** @type {ReturnType<typeof defer>} */ (gates.shift()).promise;
        const [first] = gates;
        rig.open('I love it');
        await settle();
        rig.press();
        await settle();
        rig.open('Never mind');
        await settle();
        rig.press();
        await settle();
        late.resolve({noteIds: [3]});
        first.reject(codeError('anki_closed'));
        await settle();
        expect(rig.button()).toBe('Сохраняю… (disabled)');
        expect(rig.ui.kind()).toBe('saving');
        expect(rig.ui.view()).toBeNull();
    });

    test('a new result: no listener, no find of the old one', async () => {
        const rig = await openRig('I love it');
        const english = rig.ui.english();
        const save = rig.ui.save();
        rig.type(english, 'I hate it');
        rig.open(null);
        await settle();
        rig.calls.length = 0;
        rig.type(english, 'I like it');
        document.dispatchEvent(new window.Event('selectionchange'));
        save.disabled = false;
        save.click();
        await rig.wait();
        expect(rig.calls).toStrictEqual([]);
    });
});

describe('a press is not lost', () => {
    /**
     * @param {HTMLElement} button
     * @returns {Node[]}
     */
    const contentOf = (button) => [...button.querySelectorAll('.fc-ico, .fc-spin, .fc-label, .fc-badge')];

    test('the content of the button is not touched by a find that found nothing, nor by a selection of the same card', async () => {
        const rig = makeRig();
        rig.open('I love it');
        const before = contentOf(rig.ui.save());
        expect(before).toHaveLength(2);
        await settle();
        expect(rig.argsOf('flibPhraseFind')).toHaveLength(1);
        const same = (/** @type {Node[]} */ nodes) => nodes.length === before.length && nodes.every((node, i) => node === before[i]);
        expect(same(contentOf(rig.ui.save()))).toBe(true);
        rig.select(4, 4);
        document.dispatchEvent(new window.Event('selectionchange'));
        expect(same(contentOf(rig.ui.save()))).toBe(true);
        // Another card, the same «В Anki»: its late find must not take the press either.
        rig.selectPart('love');
        expect(same(contentOf(rig.ui.save()))).toBe(true);
        await rig.wait();
        expect(rig.argsOf('flibPhraseFind')).toHaveLength(2);
        expect(same(contentOf(rig.ui.save()))).toBe(true);
    });

    test('«Открыть в Anki» the same; a new count changes it', async () => {
        const rig = makeRig();
        const card = {deckName: 'My deck', front: 'I love it', englishWord: 'I love it'};
        rig.notes.push({id: 3, ...card});
        rig.open('I love it');
        await settle();
        const view = /** @type {HTMLButtonElement} */ (rig.ui.view());
        const before = contentOf(view);
        document.dispatchEvent(new window.Event('selectionchange'));
        expect(contentOf(view).every((node, i) => node === before[i])).toBe(true);
        rig.notes.push({id: 4, ...card});
        rig.type(rig.ui.english(), 'I');
        rig.type(rig.ui.english(), 'I love it');
        await rig.wait();
        expect(rig.button()).toBe('open 3 4');
        expect(view.querySelector('.fc-badge')?.textContent).toBe('2');
        rig.notes.pop();
        rig.type(rig.ui.english(), 'I');
        rig.type(rig.ui.english(), 'I love it');
        await rig.wait();
        expect(view.querySelector('.fc-badge')).toBeNull();
        expect(view.querySelector('.fc-label')?.textContent).toBe('Открыть в Anki');
    });

    test('the label follows the language', async () => {
        const rig = await openRig('I love it');
        setUiLanguage('en');
        document.dispatchEvent(new window.Event('selectionchange'));
        expect(rig.button()).toBe('To Anki');
        expect(contentOf(rig.ui.save())).toHaveLength(2);
    });

    test('«Сохраняю…» and back: the icon and the label change', async () => {
        const rig = await openRig('I love it');
        const gate = defer();
        rig.answers.flibPhrasePrepare = () => gate.promise;
        rig.press();
        expect(rig.ui.save().querySelector('.fc-spin')).not.toBeNull();
        expect(rig.ui.save().querySelector('.fc-ico')).toBeNull();
        gate.reject(codeError('anki_closed'));
        await settle();
        expect(rig.ui.save().querySelector('.fc-spin')).toBeNull();
        expect(rig.ui.save().querySelector('.fc-ico')).not.toBeNull();
        expect(contentOf(rig.ui.save())).toHaveLength(2);
    });
});

describe('the line «Пропуск: …»', () => {
    const line = (/** @type {Awaited<ReturnType<typeof openRig>>} */ rig) => /** @type {HTMLElement} */ (rig.ui.entry().querySelector('.fc-ph-blank'));

    test('under the fields, always a live region, its text is text', async () => {
        const rig = await openRig('I <b>love</b> it');
        expect(line(rig).previousElementSibling?.className).toBe('phrase-split');
        expect(line(rig).getAttribute('aria-live')).toBe('polite');
        expect(line(rig).hidden).toBe(false);
        expect(line(rig).textContent).toBe('');
        rig.selectPart('love');
        expect(line(rig).textContent).toBe('Пропуск: love');
        expect(line(rig).childElementCount).toBe(0);
        setUiLanguage('en');
        expect(translate('anki.phraseBlankLine', {text: 'x'})).toBe('Blank: x');
    });

    test('follows the selection; empty for a whole phrase and for a phrase that is not saved', async () => {
        const rig = await openRig('I love it so');
        rig.selectPart('ov');
        expect(line(rig).textContent).toBe('Пропуск: love');
        rig.selectPart('love it');
        expect(line(rig).textContent).toBe('Пропуск: love it');
        rig.select(0, 12);
        expect(line(rig).textContent).toBe('');
        rig.selectPart('so');
        expect(line(rig).textContent).toBe('Пропуск: so');
        rig.type(rig.ui.english(), 'привет');
        expect(line(rig).textContent).toBe('');
    });

    test('stays while the focus is elsewhere, as long as a press would make that blank', async () => {
        const rig = await openRig('I love it');
        rig.selectPart('love');
        rig.ui.translation().focus();
        document.dispatchEvent(new window.Event('selectionchange'));
        expect(line(rig).textContent).toBe('Пропуск: love');
        rig.press();
        await settle();
        expect(rig.notes[0].englishWord).toBe('love');
        expect(line(rig).textContent).toBe('Пропуск: love');
    });

    test('the same text is not written again: it would be read out again', async () => {
        const rig = await openRig('I love it');
        rig.selectPart('love');
        const node = line(rig).firstChild;
        document.dispatchEvent(new window.Event('selectionchange'));
        await rig.wait();
        expect(line(rig).firstChild).toBe(node);
    });

    test('a new entry starts without it', async () => {
        const rig = await openRig('I love it');
        rig.selectPart('love');
        rig.open('I love it');
        await settle();
        expect(line(rig).textContent).toBe('');
    });
});

describe('the settings change while the window is open', () => {
    test('another deck: the press saves there, its button opens the note', async () => {
        const rig = await openRig('I love it');
        rig.options.anki.cardFormats = [format({deck: 'Other deck'})];
        rig.update();
        rig.press();
        await settle();
        expect(rig.notes).toStrictEqual([{id: 1000, deckName: 'Other deck', front: 'I love it', englishWord: 'I love it'}]);
        expect(rig.button()).toBe('open 1000');
        rig.calls.length = 0;
        document.dispatchEvent(new window.Event('selectionchange'));
        await rig.wait();
        expect(rig.calls).toStrictEqual([]);
        expect(rig.button()).toBe('open 1000');
    });

    test('a find in the old deck that answers during the save is not believed', async () => {
        const rig = makeRig();
        const late = defer();
        const find = rig.answers.flibPhraseFind;
        rig.answers.flibPhraseFind = (params) => (params.deckName === 'My deck' ? late.promise : find(params));
        rig.open('I love it');
        await settle();
        rig.options.anki.cardFormats = [format({deck: 'Other deck'})];
        rig.update();
        rig.answers.flibPhraseAdd = () => { throw codeError('anki_deck_failed'); };
        rig.press();
        late.resolve({noteIds: [3]});
        await settle();
        expect(rig.button()).toBe('В Anki');
        expect(rig.errors()).toStrictEqual([translate('anki.phraseDeckFailed', {deck: 'Other deck'})]);
        // The press itself asked about the new card: not once more after the save.
        expect(rig.argsOf('flibPhraseFind').map(({deckName}) => deckName)).toStrictEqual(['My deck', 'Other deck']);
    });

    test('Anki is switched off: an error, nothing is sent', async () => {
        const rig = await openRig('I love it');
        rig.options.anki.enable = false;
        rig.update();
        rig.calls.length = 0;
        rig.press();
        await settle();
        expect(rig.sent()).toStrictEqual([]);
        expect(rig.errors()).toStrictEqual([translate('anki.cannotSave')]);
        expect(rig.button()).toBe('В Anki');
        rig.options.anki.enable = true;
        rig.press();
        await settle();
        expect(rig.button()).toBe('open 1000');
    });

    test('the press reads the card: the tooltip and the line are about it', async () => {
        const rig = await openRig('I love it');
        rig.ui.english().focus();
        // The event of the selection comes later than the press.
        rig.ui.english().setSelectionRange(2, 6);
        rig.press();
        expect(rig.ui.save().title).toBe('В Anki, пропуск: love');
        expect(rig.ui.entry().querySelector('.fc-ph-blank')?.textContent).toBe('Пропуск: love');
        await settle();
        expect(rig.button()).toBe('open 1000');
    });
});

describe('short texts', () => {
    test.each([
        ['I', 0, 0],
        ['é ü ñ', 0, 0],
        ['go', 0, 0],
        ['a b!', 0, 1],
    ])('%j: no find in the background, the press finds', async (text, start, end) => {
        const rig = makeRig();
        rig.open(text);
        if (end > start) { rig.select(start, end); }
        await rig.wait();
        expect(rig.argsOf('isAnkiConnected')).toHaveLength(1);
        expect(rig.argsOf('getAnkiRoute')).toHaveLength(1);
        expect(rig.argsOf('flibPhraseFind')).toStrictEqual([]);
        rig.press();
        await settle();
        expect(rig.argsOf('flibPhraseFind')).toHaveLength(1);
        expect(rig.button()).toBe('open 1000');
    });

    test.each([
        ['run', 0, 0],
        ['I do it', 2, 4],
        ['a bcd', 0, 1],
        ['a bcd', 2, 5],
    ])('%j: a find', async (text, start, end) => {
        const rig = makeRig();
        rig.open(text);
        rig.select(start, end);
        await rig.wait();
        expect(rig.argsOf('flibPhraseFind').map(({englishWord}) => englishWord).at(-1)).toBe(end > start ? text.slice(start, end) : text);
    });
});

describe('«Проверить текст»', () => {
    test('in an empty window: enter a phrase, not a word about the clipboard', async () => {
        const rig = await openRig('  ');
        const button = /** @type {HTMLButtonElement} */ (rig.ui.entry().querySelector('.test-words-trigger'));
        button.disabled = false;
        rig.anki._phraseTestWordsPanels.get(/** @type {HTMLElement} */ (button.parentElement))?.setAvailable(true);
        button.click();
        await settle();
        expect(button.textContent).toBe(translate('pos.phraseNoEnglish'));
    });
});

describe('Anki', () => {
    test('off in the settings: no button, no request, as before', async () => {
        const rig = await openRig('I love it', {enable: false});
        expect(rig.ui.save()).toBeNull();
        rig.type(rig.ui.english(), 'I hate it');
        document.dispatchEvent(new window.Event('selectionchange'));
        await rig.wait();
        expect(rig.calls.map(([name]) => name).filter((name) => name !== 'getAnkiRoute')).toStrictEqual([]);
        expect(rig.ui.save()).toBeNull();
    });

    test('nobody answers: the button is there, the press says what to do; once Anki is there, it saves', async () => {
        const rig = makeRig({connected: false});
        rig.answers.flibPhrasePrepare = () => { throw codeError('anki_closed'); };
        rig.open('I love it');
        await settle();
        expect(rig.button()).toBe('В Anki');
        expect(rig.ui.kind()).toBe('add');
        expect(rig.ui.save().disabled).toBe(false);
        expect(rig.sent()).toStrictEqual([]);
        rig.press();
        await settle();
        expect(rig.errors()).toStrictEqual(['Откройте Anki, чтобы сохранить фразу']);
        expect(rig.button()).toBe('В Anki');
        rig.type(rig.ui.english(), 'I hate it');
        rig.selectPart('hate');
        await rig.wait();
        expect(rig.button()).toBe('В Anki');
        expect(rig.argsOf('flibPhraseFind')).toStrictEqual([]);
        rig.state.connected = true;
        rig.answers.flibPhrasePrepare = makeRig().answers.flibPhrasePrepare;
        rig.type(rig.ui.english(), 'I hated it');
        await rig.wait();
        expect(rig.argsOf('flibPhraseFind').map(({front}) => front)).toStrictEqual(['I hated it']);
        rig.press();
        await settle();
        expect(rig.button()).toBe('open 1000');
    });

    test('an edit before the answer does not lose it', async () => {
        const rig = makeRig();
        const answer = defer();
        rig.answers.isAnkiConnected = () => answer.promise;
        rig.open('I love it');
        rig.type(rig.ui.english(), 'I hate it');
        answer.resolve(false);
        await settle();
        expect(rig.button()).toBe('В Anki');
    });

    test('a failed check: nobody answers, no find', async () => {
        const rig = makeRig();
        rig.answers.isAnkiConnected = () => { throw new Error('x'); };
        rig.open('I love it');
        await settle();
        expect(rig.button()).toBe('В Anki');
        expect(rig.argsOf('flibPhraseFind')).toStrictEqual([]);
    });

    test('connected is asked once', async () => {
        const rig = await openRig('I love it');
        rig.type(rig.ui.english(), 'I hate it');
        await rig.wait();
        expect(rig.argsOf('isAnkiConnected')).toHaveLength(1);
        expect(rig.argsOf('flibPhraseFind')).toHaveLength(2);
    });

    test('Core answers with Anki closed: the press says so', async () => {
        const rig = makeRig();
        for (const name of PHRASE_CALLS) {
            rig.answers[name] = () => { throw codeError('anki_closed'); };
        }
        rig.open('I love it');
        await settle();
        expect(rig.button()).toBe('В Anki');
        rig.press();
        await settle();
        expect(rig.errors()).toStrictEqual(['Откройте Anki, чтобы сохранить фразу']);
        expect(rig.argsOf('flibPhraseAdd')).toStrictEqual([]);
    });

    test('the check says no while a press is saving: the save goes on', async () => {
        const rig = makeRig();
        const answer = defer();
        rig.answers.isAnkiConnected = () => answer.promise;
        rig.open('I love it');
        rig.press();
        answer.resolve(false);
        await settle();
        expect(rig.notes).toHaveLength(1);
        expect(rig.button()).toBe('open 1000');
        // It answered the save, whatever the check said.
        rig.type(rig.ui.english(), 'I hate it');
        expect(rig.button()).toBe('В Anki');
    });

    test('one check at a time', async () => {
        const rig = makeRig();
        const answer = defer();
        rig.answers.isAnkiConnected = () => answer.promise;
        rig.open('I love it');
        rig.type(rig.ui.english(), 'I hate it');
        await rig.wait();
        answer.resolve(true);
        await settle();
        expect(rig.argsOf('isAnkiConnected')).toHaveLength(1);
        expect(rig.argsOf('flibPhraseFind').map(({front}) => front)).toStrictEqual(['I hate it']);
    });
});

describe('audio and translation of a new note', () => {
    const DONE = {audio: {status: 'done'}, translation: {status: 'done'}, speechCode: null};
    const ENRICH_CALLS = new Set([...PHRASE_CALLS, 'flibGatewayStatus', 'flibPhraseEnrich']);
    const PARAMS = {server: SERVER, noteId: 1000, expression: 'I love it', front: null, useCache: true};
    const PENDING = '⟳ Обогащаю карточку…';
    const OK = '✓ озвучка · перевод';

    // eslint-disable-next-line jsdoc/require-returns -- the inferred shape is what the tests use
    /**
     * @param {string} [query]
     * @param {Parameters<typeof makeRig>[0]} [details]
     */
    const openEnrichRig = async (query = 'I love it', details = {}) => {
        const rig = makeRig({enrichCards: true, ...details});
        rig.answers.flibGatewayStatus = () => ({hasKey: true, base: ''});
        rig.answers.flibPhraseEnrich = () => DONE;
        rig.open(query);
        await settle();
        rig.calls.length = 0;
        const nodes = () => [...document.querySelectorAll('.fc-enrich-status')];
        return {
            ...rig,
            rig,
            nodes,
            /** @returns {?string} */
            line: () => {
                expect(nodes().length).toBeLessThan(2);
                return nodes()[0]?.textContent ?? null;
            },
            /** @returns {string[]} */
            names: () => rig.sent(ENRICH_CALLS).map(([name]) => name),
        };
    };
    /**
     * The next such request waits.
     * @param {{answers: Record<string, (...args: any[]) => unknown>}} rig
     * @param {string} name
     * @returns {ReturnType<typeof defer>}
     */
    const hold = (rig, name) => {
        const gate = defer();
        const answer = rig.answers[name];
        rig.answers[name] = async (...args) => {
            rig.answers[name] = answer;
            /** @type {unknown} */
            const value = await gate.promise;
            return value ?? await answer(...args);
        };
        return gate;
    };

    test('on, a key: after the note, the line under the fields, as of a word', async () => {
        const r = await openEnrichRig();
        const gate = hold(r, 'flibPhraseEnrich');
        r.press();
        await settle();
        expect(r.sent(ENRICH_CALLS).slice(2)).toStrictEqual([
            ['flibPhraseAdd', [{server: SERVER, deckName: 'My deck', fields: WHOLE, tags: ['flib_phrase', 'webpage_bbc_com', 'flib_enriched']}]],
            ['flibGatewayStatus', []],
            ['flibPhraseEnrich', [PARAMS]],
        ]);
        expect(r.line()).toBe(PENDING);
        expect(r.nodes()[0].previousElementSibling).toBe(r.ui.entry().querySelector(':scope>.fc-ph-blank'));
        gate.resolve(null);
        await settle();
        expect(r.line()).toBe(OK);
        expect(r.nodes()[0].previousElementSibling).toBe(r.ui.entry().querySelector(':scope>.fc-ph-blank'));
        expect(r.errors()).toStrictEqual([]);
        expect(r.notes).toHaveLength(1);
    });

    test('the strip of «?» stays between the fields and the line', async () => {
        const r = await openEnrichRig();
        const strip = Object.assign(document.createElement('div'), {className: 'fc-phrase-tr'});
        r.ui.entry().querySelector('.fc-ph-blank')?.after(strip);
        r.press();
        await settle();
        expect(r.nodes()[0].previousElementSibling).toBe(strip);
    });

    test('a blank: the front is read with a pause', async () => {
        const r = await openEnrichRig();
        r.selectPart('love');
        r.press();
        await settle();
        expect(r.argsOf('flibPhraseEnrich')).toStrictEqual([{...PARAMS, front: 'I ... ... ... it'}]);
    });

    test('what is read is what was saved: cleaned', async () => {
        const r = await openEnrichRig('  I <b>love</b>\n it [sound:x.mp3] ');
        r.press();
        await settle();
        expect(r.argsOf('flibPhraseEnrich')[0].expression).toBe(r.argsOf('flibPhraseAdd')[0].fields.Expression);
        expect(r.argsOf('flibPhraseEnrich')[0].expression).not.toMatch(/[<>]|\[sound/);
    });

    test('the translation that was written to Anki does not come into the field', async () => {
        const r = await openEnrichRig();
        const input = vi.fn();
        r.ui.translation().addEventListener('input', input);
        r.press();
        await settle();
        expect(r.line()).toBe(OK);
        expect(r.ui.translation().value).toBe('');
        expect(input).not.toHaveBeenCalled();
    });

    test('off: not asked about the key, no line', async () => {
        for (const flibService of [{enrichCards: false}, void 0]) {
            const r = await openEnrichRig();
            Object.assign(r.options, {flibService});
            r.press();
            await settle();
            expect(r.names()).toStrictEqual(['flibPhrasePrepare', 'flibPhraseFind', 'flibPhraseAdd']);
            expect(r.line()).toBeNull();
            expect(r.button()).toBe('open 1000');
        }
    });

    test('no key: the line with the form, whatever the route; nothing is asked of the gateway or of the route', async () => {
        const r = await openEnrichRig();
        r.answers.flibGatewayStatus = () => ({hasKey: false, base: ''});
        r.press();
        await settle();
        expect(r.calls.map(([name]) => name)).toStrictEqual(['flibPhrasePrepare', 'flibPhraseFind', 'flibPhraseAdd', 'flibGatewayStatus']);
        expect(r.nodes()[0].querySelector('.fc-enrich-head')?.textContent).toBe(translate('enrich.phraseNoKey'));
        expect(r.nodes()[0].querySelector('.fc-xp-help')).not.toBeNull();
        expect(r.errors()).toStrictEqual([]);
        expect(r.button()).toBe('open 1000');
    });

    test('the key is saved: the line goes, the note is not enriched again', async () => {
        const r = await openEnrichRig();
        r.answers.flibGatewayStatus = () => ({hasKey: false, base: ''});
        r.answers.flibSecretsSet = () => ({});
        r.press();
        await settle();
        const [node] = r.nodes();
        const input = /** @type {HTMLInputElement} */ (node.querySelector('.fc-xp-key-input'));
        input.value = `tpk_${'0'.repeat(32)}`;
        /** @type {HTMLButtonElement} */ (node.querySelector('.fc-xp-key-form button')).click();
        node.querySelector('form')?.dispatchEvent(new window.Event('submit', {bubbles: true, cancelable: true}));
        await settle();
        expect(r.line()).toBeNull();
        expect(r.names()).not.toContain('flibPhraseEnrich');
    });

    test.each(/** @type {[name: string, change: (rig: any) => void][]} */ ([
        ['found', (rig) => { rig.notes.push({id: 5, deckName: 'My deck', front: 'I love it', englishWord: 'I love it'}); }],
        ['existed', (rig) => { rig.answers.flibPhraseAdd = () => ({noteId: 5, existed: true}); }],
        ['not added', (rig) => { rig.answers.flibPhraseAdd = () => { throw codeError('anki_closed'); }; }],
    ]))('%s: no new note, nothing is asked', async (_name, change) => {
        const r = await openEnrichRig('Never mind');
        r.type(r.ui.english(), 'I love it');
        change(r.rig);
        r.press();
        await settle();
        expect(r.names()).not.toContain('flibGatewayStatus');
        expect(r.names()).not.toContain('flibPhraseEnrich');
        expect(r.line()).toBeNull();
    });

    test('the type became outdated: the address of the second preparation', async () => {
        const r = await openEnrichRig();
        const add = r.answers.flibPhraseAdd;
        r.answers.flibPhraseAdd = () => {
            r.answers.flibPhraseAdd = add;
            r.state.server = 'http://127.0.0.1:8777';
            throw codeError('anki_model_outdated');
        };
        r.press();
        await settle();
        expect(r.argsOf('flibPhraseEnrich')).toStrictEqual([{...PARAMS, server: 'http://127.0.0.1:8777'}]);
    });

    test.each(/** @type {[name: string, report: object, text: string][]} */ ([
        ['the audio', {...DONE, audio: {status: 'failed', code: 'tts_quota_exhausted'}, speechCode: 'tts_quota_exhausted'}, 'enrich.speechQuota'],
        ['the translation', {...DONE, translation: {status: 'failed', code: 'anki_note_gone'}}, 'enrich.ankiNoteGone'],
        ['too long', {audio: {status: 'skipped', code: 'flib_sentence_too_long'}, translation: {status: 'skipped', code: 'flib_sentence_too_long'}, speechCode: null}, 'enrich.phraseTooLong'],
    ]))('a partial failure (%s): the note stays, the reason is in the line only', async (_name, report, key) => {
        const r = await openEnrichRig();
        r.answers.flibPhraseEnrich = () => report;
        r.press();
        await settle();
        expect(/** @type {HTMLElement} */ (r.nodes()[0]).dataset.state).toBe('warn');
        expect(r.line()).toContain(translate('enrich.added'));
        expect(r.line()).toContain(translate(key, {max: 1000}));
        expect(r.button()).toBe('open 1000');
        expect(r.errors()).toStrictEqual([]);
    });

    test.each(/** @type {[name: string, call: string, error: () => Error, key: string][]} */ ([
        ['the key could not be asked about', 'flibGatewayStatus', () => new Error('Extension context invalidated'), 'enrich.phraseUnavailable'],
        ['the background went away', 'flibPhraseEnrich', () => new Error('message port closed'), 'enrich.phraseUnavailable'],
        ['refused', 'flibPhraseEnrich', () => codeError('flib_bad_request'), 'enrich.phraseRefused'],
    ]))('%s: a visible failure, the note stays', async (_name, call, error, key) => {
        const r = await openEnrichRig();
        r.answers[call] = () => { throw error(); };
        r.press();
        await settle();
        expect(r.line()).toBe(`⚠ ${translate('enrich.added')}${translate(key)}`);
        expect(r.button()).toBe('open 1000');
        expect(r.errors()).toStrictEqual([]);
    });

    test.each(['flibGatewayStatus', 'flibPhraseEnrich'])('the save does not wait for %s; the next phrase is saved meanwhile', async (call) => {
        const r = await openEnrichRig();
        const gate = hold(r, call);
        r.press();
        await settle();
        expect(r.button()).toBe('open 1000');
        expect(r.anki._savingNotes.size).toBe(0);
        expect(r.display.progressIndicatorVisible.clearOverride).toHaveBeenCalledTimes(1);
        r.type(r.ui.english(), 'I hate it');
        r.press();
        await settle();
        expect(r.notes.map(({front}) => front)).toStrictEqual(['I love it', 'I hate it']);
        expect(r.button()).toBe('open 1001');
        gate.resolve(null);
        await settle();
        expect(r.argsOf('flibPhraseEnrich').map(({noteId}) => noteId).sort()).toStrictEqual([1000, 1001]);
        expect(r.line()).toBe(OK);
    });

    test('two saves in one window: the line is about the last one', async () => {
        const r = await openEnrichRig();
        const first = hold(r, 'flibPhraseEnrich');
        r.press();
        await settle();
        const second = hold(r, 'flibPhraseEnrich');
        r.type(r.ui.english(), 'I hate it');
        r.press();
        await settle();
        first.resolve({...DONE, audio: {status: 'failed', code: 'anki_closed'}});
        await settle();
        expect(r.line()).toBe(PENDING);
        second.resolve(null);
        await settle();
        expect(r.line()).toBe(OK);
    });

    test('a later note without enrichment takes the old line away; a failed save does not', async () => {
        const r = await openEnrichRig();
        r.press();
        await settle();
        r.options.flibService.enrichCards = false;
        const prepare = r.answers.flibPhrasePrepare;
        r.answers.flibPhrasePrepare = () => { throw codeError('anki_closed'); };
        r.anki._saveEntryWithSelection(r.ui.entry());
        await settle();
        expect(r.errors()).toHaveLength(1);
        expect(r.line()).toBe(OK);
        r.answers.flibPhrasePrepare = prepare;
        r.type(r.ui.english(), 'I hate it');
        r.press();
        await settle();
        expect(r.line()).toBeNull();
        r.type(r.ui.english(), 'I love it');
        expect(r.line()).toBeNull();
    });

    test.each(/** @type {[name: string, change: (r: any) => void][]} */ ([
        ['another text', (r) => { r.type(r.ui.english(), 'I hate it'); }],
        ['nothing to save', (r) => { r.type(r.ui.english(), 'привет'); }],
        ['another blank', (r) => { r.selectPart('love'); }],
    ]))('%s in the window: the line is about another phrase, it goes; with the same card it is back', async (_name, change) => {
        const r = await openEnrichRig();
        r.press();
        await settle();
        expect(r.line()).toBe(OK);
        change(r);
        expect(r.line()).toBeNull();
        await r.wait();
        expect(r.line()).toBeNull();
        r.type(r.ui.english(), 'I love it');
        r.ui.english().setSelectionRange(0, 0);
        document.dispatchEvent(new window.Event('selectionchange'));
        expect(r.line()).toBe(OK);
        expect(r.nodes()[0].previousElementSibling).toBe(r.ui.entry().querySelector(':scope>.fc-ph-blank'));
    });

    test('the same card is read again, the translation is typed: the line stays where it is', async () => {
        const r = await openEnrichRig();
        r.press();
        await settle();
        const [node] = r.nodes();
        const mutations = new window.MutationObserver(() => {});
        mutations.observe(r.ui.entry(), {childList: true});
        r.type(r.ui.translation(), 'люблю');
        document.dispatchEvent(new window.Event('selectionchange'));
        await r.wait();
        expect(r.nodes()).toStrictEqual([node]);
        // Taken out and put back, it would be read out again.
        expect(mutations.takeRecords()).toStrictEqual([]);
    });

    test('a report that comes while another phrase is in the window', async () => {
        const r = await openEnrichRig();
        const gate = hold(r, 'flibPhraseEnrich');
        r.press();
        await settle();
        expect(r.line()).toBe(PENDING);
        r.type(r.ui.english(), 'I hate it');
        expect(r.line()).toBeNull();
        gate.resolve({...DONE, audio: {status: 'failed', code: 'anki_closed'}});
        await settle();
        expect(r.line()).toBeNull();
        r.type(r.ui.english(), 'I love it');
        expect(r.line()).toContain(translate('enrich.ankiClosed'));
    });

    test('the key form of the line keeps what was typed while the line was away', async () => {
        const r = await openEnrichRig();
        r.answers.flibGatewayStatus = () => ({hasKey: false, base: ''});
        r.press();
        await settle();
        /** @type {HTMLInputElement} */ (r.nodes()[0].querySelector('.fc-xp-key-input')).value = 'tpk_';
        r.type(r.ui.english(), 'I hate it');
        r.type(r.ui.english(), 'I love it');
        expect(/** @type {HTMLInputElement} */ (r.nodes()[0].querySelector('.fc-xp-key-input')).value).toBe('tpk_');
    });

    test.each(/** @type {[call: string, to: ?string][]} */ ([
        ['flibPhraseAdd', 'Never mind'],
        ['flibPhraseAdd', null],
        ['flibGatewayStatus', 'Never mind'],
        ['flibGatewayStatus', 'I love it'],
        ['flibPhraseEnrich', 'Never mind'],
        ['flibPhraseEnrich', 'I love it'],
        ['flibPhraseEnrich', null],
    ]))('the result is replaced during %s (by %j): the work goes on, nothing is rendered', async (call, to) => {
        const r = await openEnrichRig();
        const gate = hold(r, call);
        r.press();
        await settle();
        const old = r.ui.entry();
        r.open(to);
        await settle();
        const before = old.innerHTML;
        gate.resolve(null);
        await settle();
        expect(r.argsOf('flibPhraseEnrich')).toStrictEqual([PARAMS]);
        expect(r.line()).toBeNull();
        if (call !== 'flibPhraseAdd') { expect(old.innerHTML).toBe(before); }
        expect(r.errors()).toStrictEqual([]);
    });

    test('the result is replaced and there is no key: nothing is rendered', async () => {
        const r = await openEnrichRig();
        const gate = hold(r, 'flibGatewayStatus');
        r.press();
        await settle();
        r.open('Never mind');
        gate.resolve({hasKey: false, base: ''});
        await settle();
        expect(r.line()).toBeNull();
        expect(r.names()).not.toContain('flibPhraseEnrich');
    });

    test.each(/** @type {[depth: number, pageType: string, useCache: boolean][]} */ ([
        [0, 'popup', true],
        [1, 'popup', false],
        [2, 'popup', false],
        [0, 'search', false],
    ]))('depth %d of a %s: useCache %j', async (depth, pageType, useCache) => {
        const r = await openEnrichRig();
        Object.assign(r.display, {depth, pageType});
        r.press();
        await settle();
        expect(r.argsOf('flibPhraseEnrich')).toStrictEqual([{...PARAMS, useCache}]);
    });

    test('the page type is known to the real Display', () => {
        const display = /** @type {Display} */ (Object.create(Display.prototype));
        display._pageType = 'search';
        expect(display.pageType).toBe('search');
    });

    test.each([[true, false], [false, true]])('everything is of the moment of the press (enrichment %j → %j)', async (before, after) => {
        const r = await openEnrichRig('I love it', {enrichCards: before});
        r.selectPart('love');
        const gate = hold(r, 'flibPhraseFind');
        r.press();
        await settle();
        Object.assign(r.options, {flibService: {enrichCards: after}});
        r.update();
        r.display.depth = 1;
        r.type(r.ui.english(), 'I hate it');
        gate.resolve(null);
        await settle();
        expect(r.argsOf('flibPhraseEnrich')).toStrictEqual(before ? [{...PARAMS, front: 'I ... ... ... it'}] : []);
    });

    test('a hidden window: the line is there when it is shown again', async () => {
        const r = await openEnrichRig();
        r.display.frameVisible = false;
        r.press();
        await settle();
        expect(r.line()).toBe(OK);
    });
});

describe('createPhraseCard', () => {
    const key = (/** @type {string} */ value, /** @type {number} */ start, /** @type {number} */ end, /** @type {string} */ deck) => createPhraseCard({value, selectionStart: start, selectionEnd: end}, '', [format({deck})]).key;

    test('the same card: the deck, Front and EnglishWord', () => {
        const base = key('I love it', 2, 6, 'A');
        expect(key('  I love  it', 4, 7, 'A')).toBe(base);
        expect(key('I love it', 2, 6, 'B')).not.toBe(base);
        expect(key('I hate it', 2, 6, 'A')).not.toBe(base);
        expect(key('I love it', 0, 0, 'A')).not.toBe(base);
        expect(key('love and love', 0, 4, 'A')).not.toBe(key('love and love', 9, 13, 'A'));
        expect(key('', 0, 0, 'A')).toBe('');
    });

    test('the translation is not a part of it', () => {
        const field = {value: 'I love it', selectionStart: 0, selectionEnd: 0};
        expect(createPhraseCard(field, 'люблю', []).key).toBe(createPhraseCard(field, '', []).key);
        expect(createPhraseCard(field, 'люблю', []).fields?.ExpressionTranslate).toBe('люблю');
    });
});

test('createPhraseSaveError keeps the code and the detail for the log', () => {
    const error = /** @type {import('../ext/js/core/extension-error.js').ExtensionError} */ (createPhraseSaveError(codeError('anki_closed'), 'D'));
    expect(error.data).toStrictEqual({code: 'anki_closed', status: null, detail: 'DETAIL'});
});

test('getPhraseCardFormatIndex', () => {
    expect(getPhraseCardFormatIndex([format({type: 'kanji'}), format(), format()])).toBe(1);
    expect(getPhraseCardFormatIndex([])).toBe(0);
});

/* eslint-enable no-underscore-dangle, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
