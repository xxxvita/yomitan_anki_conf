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

import {readFileSync} from 'node:fs';
import {afterAll, afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {ExtensionError} from '../ext/js/core/extension-error.js';
import {log} from '../ext/js/core/log.js';
import {DisplayAnki} from '../ext/js/display/display-anki.js';
import {DisplayNotification} from '../ext/js/display/display-notification.js';
import {createPhraseCard, createPhraseSaveError, getPhraseCardFormatIndex} from '../ext/js/display/phrase-save-util.js';
import {getUiLanguage, setUiLanguage, translate} from '../ext/js/i18n/ui-language.js';
import {setupDomTest} from './fixtures/dom-test.js';

const {window, teardown} = await setupDomTest();
afterAll(() => teardown(global));

const SERVER = 'http://127.0.0.1:8765';
const TEMPLATES = new window.DOMParser().parseFromString(readFileSync(new URL('../ext/templates-display.html', import.meta.url), 'utf8'), 'text/html');
const DEBOUNCE = 400;

/**
 * @param {string} name
 * @returns {HTMLElement}
 */
function instantiate(name) {
    const template = /** @type {HTMLTemplateElement} */ (TEMPLATES.querySelector(`#${name}-template`));
    return /** @type {HTMLElement} */ (document.importNode(/** @type {HTMLElement} */ (template.content.firstElementChild), true));
}

/**
 * @param {string} code
 * @returns {ExtensionError} As it arrives from the background.
 */
function codeError(code) {
    const error = new ExtensionError(code);
    error.data = {code, status: null, detail: 'DETAIL'};
    return error;
}

/**
 * @template T
 * @returns {{promise: Promise<T>, resolve: (value: T) => void, reject: (error: Error) => void}}
 */
function defer() {
    /** @type {(value: T) => void} */
    let resolve = () => {};
    /** @type {(error: Error) => void} */
    let reject = () => {};
    /** @type {Promise<T>} */
    const promise = new Promise((resolve2, reject2) => {
        resolve = resolve2;
        reject = reject2;
    });
    return {promise, resolve, reject};
}

/**
 * @param {Partial<{type: string, deck: string, model: string, name: string, icon: string, fields: object}>} [change]
 * @returns {import('settings').AnkiCardFormat}
 */
function format(change = {}) {
    return /** @type {*} */ ({type: 'term', name: 'Слово', deck: 'My deck', model: 'Yomitan Card Type', icon: 'big-circle', fields: {Expression: {value: '{expression}', overwriteMode: 'coalesce'}}, ...change});
}

/** Everything that a phrase window may ask of the background while it saves. */
const PHRASE_CALLS = new Set(['flibPhrasePrepare', 'flibPhraseFind', 'flibPhraseAdd']);

/** @returns {Promise<void>} */
async function settle() {
    for (let i = 0; i < 40; ++i) { await Promise.resolve(); }
}

// eslint-disable-next-line jsdoc/require-returns -- the inferred shape is what the tests use
/**
 * The real DisplayAnki with the real phrase entry template; the background keeps its notes as Anki would.
 * @param {{cardFormats?: import('settings').AnkiCardFormat[], enable?: boolean, connected?: boolean, tags?: string[]}} [details]
 */
function makeRig({cardFormats = [format()], enable = true, connected = true, tags = ['flib_phrase']} = {}) {
    document.body.innerHTML = '<div id="popup-menus"></div><div id="dictionary-entries"></div><div id="notifications"></div>';
    const container = /** @type {HTMLElement} */ (document.querySelector('#dictionary-entries'));
    const notifications = /** @type {HTMLElement} */ (document.querySelector('#notifications'));
    /** @type {[name: string, args: any[]][]} */
    const calls = [];
    /** @type {{id: number, deckName: string, front: string, englishWord: string}[]} */
    const notes = [];
    const state = {connected, server: SERVER};
    /** @type {Record<string, (...args: any[]) => unknown>} */
    const answers = {
        isAnkiConnected: () => state.connected,
        getAnkiRoute: () => ({mode: 'direct', ankiServer: state.server, coreBase: null, checkedAt: 0}),
        flibPhrasePrepare: () => ({server: state.server, videoHidden: true, modelRevision: '38b6cd5861e4785f'}),
        flibPhraseFind: ({deckName, front, englishWord}) => ({
            noteIds: notes.filter((note) => note.deckName === deckName && note.front === front && note.englishWord === englishWord).map(({id}) => id),
        }),
        flibPhraseAdd: ({deckName, fields}) => {
            const id = 1000 + notes.length;
            notes.push({id, deckName, front: fields.Front, englishWord: fields.EnglishWord});
            return {noteId: id, existed: false};
        },
        getDictionaryInfo: () => [],
        getDefaultAnkiFieldTemplates: () => '',
    };
    const api = /** @type {*} */ (new Proxy({}, {
        get: (_target, property) => async (/** @type {any[]} */ ...args) => {
            const name = String(property);
            calls.push([name, args]);
            if (!Object.hasOwn(answers, name)) { throw new Error(`unexpected call: ${name}`); }
            return await answers[name](...args);
        },
    }));
    /** @type {Map<string, (details: any) => void>} */
    const handlers = new Map();
    const options = {
        general: {resultOutputMode: 'group', glossaryLayoutMode: 'default', compactTags: false},
        dictionaries: [],
        anki: {
            enable,
            tags,
            targetTags: [],
            userTags: ['vocab'],
            duplicateScope: 'collection',
            duplicateScopeCheckAllModels: false,
            duplicateBehavior: 'new',
            suspendNewCards: true,
            checkForDuplicates: true,
            displayTagsAndFlags: 'never',
            cardFormats,
            noteGuiMode: 'browse',
            screenshot: {format: 'png', quality: 92},
            downloadTimeout: 0,
            forceSync: true,
            fieldTemplates: '',
        },
        scanning: {length: 10},
        flibService: {enrichCards: true},
    };
    /** @type {Record<string, (arg?: unknown) => void>} */
    const hotkeys = {};
    const display = {
        hotkeyHandler: {registerActions: (/** @type {[string, (arg?: unknown) => void][]} */ actions) => { Object.assign(hotkeys, Object.fromEntries(actions)); }},
        _hotkeyHelpController: {setupNode: vi.fn(), getHotkeyLabel: () => null, setHotkeyLabel: vi.fn()},
        on: (/** @type {string} */ name, /** @type {(details: any) => void} */ callback) => { handlers.set(name, callback); },
        application: {api},
        displayGenerator: {
            instantiateTemplate: instantiate,
            createAnkiNoteErrorsNotificationContent: (/** @type {Error[]} */ errors) => {
                const content = document.createElement('ul');
                for (const {message} of errors) { content.append(Object.assign(document.createElement('li'), {className: 'anki-note-error-message', textContent: message})); }
                return content;
            },
        },
        createNotification: () => {
            const node = document.createElement('div');
            node.innerHTML = '<div class="footer-notification-body"></div><button class="footer-notification-close-button"></button>';
            return new DisplayNotification(notifications, node);
        },
        getOptions: () => options,
        getOptionsContext: () => ({url: 'https://www.bbc.com/'}),
        getElementDictionaryEntryIndex: () => 0,
        history: {state: null},
        query: '',
        fullQuery: '',
        queryOffset: 0,
        contentType: 'phrase',
        depth: 0,
        dictionaryEntries: [],
        /** @type {HTMLElement[]} */
        dictionaryEntryNodes: [],
        selectedIndex: 0,
        progressIndicatorVisible: {setOverride: vi.fn(() => 'token'), clearOverride: vi.fn()},
        frameVisible: true,
        invokeContentOrigin: vi.fn(async () => {}),
    };
    const anki = new DisplayAnki(/** @type {*} */ (display), /** @type {*} */ (null));
    anki.prepare();
    handlers.get('optionsUpdated')?.({options});
    calls.length = 0;

    /**
     * What Display#_onStateChanged does.
     * @param {?string} query null — another kind of content.
     */
    const open = (query) => {
        handlers.get('contentClear')?.({});
        display.dictionaryEntryNodes = [];
        container.textContent = '';
        display.contentType = query === null ? 'clear' : 'phrase';
        display.query = query ?? '';
        display.fullQuery = query ?? '';
        handlers.get('contentUpdateStart')?.({});
        if (query !== null) {
            const entry = instantiate('phrase-entry');
            /** @type {HTMLTextAreaElement} */ (entry.querySelector('.phrase-expression-input')).value = query;
            display.dictionaryEntryNodes = [entry];
            container.append(entry);
        }
        handlers.get('contentUpdateComplete')?.({});
    };
    const entry = () => display.dictionaryEntryNodes[0];
    const one = (/** @type {string} */ selector) => /** @type {any} */ (entry().querySelector(selector));
    const ui = {
        entry,
        /** @returns {HTMLTextAreaElement} */
        english: () => one('.phrase-expression-input'),
        /** @returns {HTMLTextAreaElement} */
        translation: () => one('.phrase-translate-input'),
        /** @returns {HTMLButtonElement} */
        save: () => one('.action-button[data-action=save-note]'),
        /** @returns {HTMLButtonElement|null} */
        view: () => one('.action-button[data-action=view-note]'),
        /** @returns {string|undefined} */
        kind: () => one('.action-button-container')?.dataset.fcState,
    };
    /**
     * What is seen on the single place for the button.
     * @returns {string}
     */
    const button = () => {
        const save = ui.save();
        const view = ui.view();
        const visible = [save, view].filter((node) => node !== null && !node.hidden);
        if (visible.length !== 1) { return `${visible.length} buttons`; }
        if (visible[0] === view) { return `open ${view?.dataset.noteIds}`; }
        return `${save.querySelector('.fc-label')?.textContent}${save.disabled ? ' (disabled)' : ''}`;
    };
    /**
     * @param {HTMLTextAreaElement} field
     * @param {string} value
     */
    const type = (field, value) => {
        field.value = value;
        field.dispatchEvent(new window.Event('input', {bubbles: true}));
    };
    /**
     * As a browser does it: the event is on the document.
     * @param {number} start
     * @param {number} end
     */
    const select = (start, end) => {
        ui.english().focus();
        ui.english().setSelectionRange(start, end);
        document.dispatchEvent(new window.Event('selectionchange'));
    };
    /**
     * @param {string} part
     * @param {number} [from]
     */
    const selectPart = (part, from = 0) => {
        const start = ui.english().value.indexOf(part, from);
        select(start, start + part.length);
    };
    /** A press with the mouse: the focus moves to the button, the field loses its selection. */
    const press = () => {
        const save = ui.save();
        save.dispatchEvent(new window.MouseEvent('mousedown', {bubbles: true}));
        save.focus();
        save.click();
    };
    const sent = (/** @type {Set<string>} */ names = PHRASE_CALLS) => calls.filter(([name]) => names.has(name));
    const argsOf = (/** @type {string} */ name) => calls.filter(([other]) => other === name).map(([, args]) => args[0]);
    const errors = () => [...notifications.querySelectorAll('.anki-note-error-message')].map(({textContent}) => textContent);
    /** @param {number} [time] */
    const wait = async (time = DEBOUNCE) => {
        await vi.advanceTimersByTimeAsync(time);
        await settle();
    };
    return {anki, display, options, answers, state, notes, calls, hotkeys, open, ui, button, type, select, selectPart, press, sent, argsOf, errors, wait, update: () => { handlers.get('optionsUpdated')?.({options}); }};
}

// eslint-disable-next-line jsdoc/require-returns -- the inferred shape is what the tests use
/**
 * @param {string} query
 * @param {Parameters<typeof makeRig>[0]} [details]
 */
async function openRig(query, details) {
    const rig = makeRig(details);
    rig.open(query);
    await settle();
    return rig;
}

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

    test('nobody answers: no button, an edit does not bring it back; once Anki is there, it does', async () => {
        const rig = await openRig('I love it', {connected: false});
        expect(rig.button()).toBe('0 buttons');
        expect(rig.ui.save().disabled).toBe(true);
        rig.type(rig.ui.english(), 'I hate it');
        rig.selectPart('hate');
        expect(rig.button()).toBe('0 buttons');
        await rig.wait();
        expect(rig.button()).toBe('0 buttons');
        expect(rig.sent()).toStrictEqual([]);
        rig.state.connected = true;
        rig.type(rig.ui.english(), 'I hated it');
        await rig.wait();
        expect(rig.button()).toBe('В Anki');
        expect(rig.argsOf('flibPhraseFind').map(({front}) => front)).toStrictEqual(['I hated it']);
    });

    test('an edit before the answer does not lose it', async () => {
        const rig = makeRig();
        const answer = defer();
        rig.answers.isAnkiConnected = () => answer.promise;
        rig.open('I love it');
        rig.type(rig.ui.english(), 'I hate it');
        answer.resolve(false);
        await settle();
        expect(rig.button()).toBe('0 buttons');
    });

    test('a failed check: nobody answers', async () => {
        const rig = makeRig();
        rig.answers.isAnkiConnected = () => { throw new Error('x'); };
        rig.open('I love it');
        await settle();
        expect(rig.button()).toBe('0 buttons');
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
    const error = /** @type {ExtensionError} */ (createPhraseSaveError(codeError('anki_closed'), 'D'));
    expect(error.data).toStrictEqual({code: 'anki_closed', status: null, detail: 'DETAIL'});
});

test('getPhraseCardFormatIndex', () => {
    expect(getPhraseCardFormatIndex([format({type: 'kanji'}), format(), format()])).toBe(1);
    expect(getPhraseCardFormatIndex([])).toBe(0);
});

/* eslint-enable no-underscore-dangle, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
