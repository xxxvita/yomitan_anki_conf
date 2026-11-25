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

/* eslint-disable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */

import {readFileSync} from 'node:fs';
import {vi} from 'vitest';
import {ExtensionError} from '../../ext/js/core/extension-error.js';
import {DisplayAnki} from '../../ext/js/display/display-anki.js';
import {DisplayNotification} from '../../ext/js/display/display-notification.js';

/** The address of Anki in the window's background. */
export const SERVER = 'http://127.0.0.1:8765';

const TEMPLATES_HTML = readFileSync(new URL('../../ext/templates-display.html', import.meta.url), 'utf8');

/** How long the text must rest before Anki is asked. */
export const DEBOUNCE = 400;

/**
 * @param {string} name
 * @returns {HTMLElement}
 */
function instantiate(name) {
    const templates = new DOMParser().parseFromString(TEMPLATES_HTML, 'text/html');
    const template = /** @type {HTMLTemplateElement} */ (templates.querySelector(`#${name}-template`));
    return /** @type {HTMLElement} */ (document.importNode(/** @type {HTMLElement} */ (template.content.firstElementChild), true));
}

/**
 * @param {string} code
 * @returns {ExtensionError} As it arrives from the background.
 */
export function codeError(code) {
    const error = new ExtensionError(code);
    error.data = {code, status: null, detail: 'DETAIL'};
    return error;
}

/**
 * @template T
 * @returns {{promise: Promise<T>, resolve: (value: T) => void, reject: (error: Error) => void}}
 */
export function defer() {
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
export function format(change = {}) {
    return /** @type {*} */ ({type: 'term', name: 'Слово', deck: 'My deck', model: 'Yomitan Card Type', icon: 'big-circle', fields: {Expression: {value: '{expression}', overwriteMode: 'coalesce'}}, ...change});
}

/** Everything that a phrase window may ask of the background while it saves. */
export const PHRASE_CALLS = new Set(['flibPhrasePrepare', 'flibPhraseFind', 'flibPhraseAdd']);

/** @returns {Promise<void>} */
export async function settle() {
    for (let i = 0; i < 40; ++i) { await Promise.resolve(); }
}

// eslint-disable-next-line jsdoc/require-returns -- the inferred shape is what the tests use
/**
 * The real DisplayAnki with the real phrase entry template; the background keeps its notes as Anki would.
 * @param {{cardFormats?: import('settings').AnkiCardFormat[], enable?: boolean, connected?: boolean, tags?: string[], enrichCards?: boolean}} [details]
 */
export function makeRig({cardFormats = [format()], enable = true, connected = true, tags = ['flib_phrase'], enrichCards = false} = {}) {
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
        flibService: {enrichCards},
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
        pageType: 'popup',
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
export async function openRig(query, details) {
    const rig = makeRig(details);
    rig.open(query);
    await settle();
    return rig;
}

/* eslint-enable @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
