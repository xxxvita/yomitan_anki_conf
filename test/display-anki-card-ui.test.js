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

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {EventListenerCollection} from '../ext/js/core/event-listener-collection.js';
import {USER_TAGS_OPTIONS_SOURCE} from '../ext/js/data/flib-option-sources.js';
import {DisplayAnki} from '../ext/js/display/display-anki.js';
import {setupDomTest} from './fixtures/dom-test.js';

const P = DisplayAnki.prototype;

/**
 * Статья с одним форматом карточки: save-note и (если есть заметки) view-note.
 * @param {number[]} noteIds
 * @returns {{entry: HTMLElement, container: HTMLElement}}
 */
function makeEntry(noteIds) {
    const entry = document.createElement('div');
    entry.className = 'entry';
    const header = document.createElement('div');
    header.className = 'entry-header';
    const actions = document.createElement('div');
    actions.className = 'note-actions-container';
    const container = document.createElement('div');
    container.className = 'action-button-container';
    container.dataset.cardFormatIndex = '0';
    const save = document.createElement('button');
    save.className = 'action-button';
    save.dataset.action = 'save-note';
    save.dataset.cardFormatIndex = '0';
    container.appendChild(save);
    if (noteIds.length > 0) {
        const view = document.createElement('button');
        view.className = 'action-button';
        view.dataset.action = 'view-note';
        view.dataset.noteIds = noteIds.join(' ');
        container.appendChild(view);
    }
    actions.appendChild(container);
    header.appendChild(actions);
    entry.appendChild(header);
    document.body.appendChild(entry);
    return {entry, container};
}

/**
 * @param {HTMLElement} entry
 * @param {{ankiError?: ?Error, canAdd?: boolean, duplicateBehavior?: string}} details
 * @returns {{_savingNotes: Map<HTMLElement, Set<number>>, _lastSaved: WeakMap<HTMLElement, {replaced: boolean, tags: string[]}>, _recheckAnki: import('vitest').Mock} & Record<string, unknown>}
 */
function makeContext(entry, {ankiError = null, canAdd = true, duplicateBehavior = 'new'} = {}) {
    return {
        _getEntry: () => entry,
        _dictionaryEntryDetails: [{noteMap: new Map([[0, {ankiError, canAdd, noteIds: [], noteInfos: []}]])}],
        _savingNotes: new Map(),
        _duplicateBehavior: duplicateBehavior,
        _cardFormats: [{name: 'Expression', deck: 'D', model: 'M'}],
        _eventListeners: new EventListenerCollection(),
        _ankiOffOpen: new WeakSet(),
        _lastSaved: new WeakMap(),
        _getNodeNoteIds: P._getNodeNoteIds,
        _setButtonContent: P._setButtonContent,
        _ensureAnkiMoreButton: P._ensureAnkiMoreButton,
        _ensureAnkiOffButton: P._ensureAnkiOffButton,
        _renderAnkiStatus: P._renderAnkiStatus,
        _recheckAnki: vi.fn(),
    };
}

describe('DisplayAnki — кнопка Anki карточки Flib-club', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => { env = await setupDomTest(); });
    afterEach(async () => { await env.teardown(global); });

    test('заметок нет — «В Anki», строки состояния нет', () => {
        const {entry, container} = makeEntry([]);
        P._applyCardFormatUi.call(makeContext(entry), 0, 0);
        expect(container.dataset.fcState).toBe('add');
        expect(container.querySelector('[data-action=save-note] .fc-label')?.textContent).toBe('В Anki');
        expect(entry.querySelector('.fc-anki-status')).toBeNull();
    });

    test('две заметки — «Открыть в Anki» со счётчиком, «▾» и «Уже в Anki · 2 карточки»', () => {
        const {entry, container} = makeEntry([1, 2]);
        P._applyCardFormatUi.call(makeContext(entry), 0, 0);
        expect(container.dataset.fcState).toBe('open');
        expect(container.querySelector('[data-action=view-note] .fc-badge')?.textContent).toBe('2');
        expect(/** @type {HTMLElement} */ (container.querySelector('.fc-anki-more')).hidden).toBe(false);
        expect(entry.querySelector('.fc-anki-status')?.textContent).toBe('Уже в Anki · 2 карточки с этим словом');
    });

    test('повторный вызов не плодит ярлыки, «▾» и строки состояния', () => {
        const {entry, container} = makeEntry([1]);
        const context = makeContext(entry);
        P._applyCardFormatUi.call(context, 0, 0);
        P._applyCardFormatUi.call(context, 0, 0);
        expect(container.querySelectorAll('.fc-label')).toHaveLength(2);
        expect(container.querySelectorAll('.fc-anki-more')).toHaveLength(1);
        expect(entry.querySelectorAll('.fc-anki-status')).toHaveLength(1);
    });

    test('Anki не запущена — кнопка-предупреждение; щелчок раскрывает подсказку с «Проверить снова»', () => {
        const {entry, container} = makeEntry([]);
        const context = makeContext(entry, {ankiError: new Error('Anki not connected')});
        P._applyCardFormatUi.call(context, 0, 0);
        expect(container.dataset.fcState).toBe('off');
        const off = /** @type {HTMLButtonElement} */ (container.querySelector('.fc-anki-off'));
        expect(off.getAttribute('aria-expanded')).toBe('false');
        off.click();
        expect(off.getAttribute('aria-expanded')).toBe('true');
        const retry = /** @type {HTMLButtonElement} */ (entry.querySelector('.fc-anki-callout button'));
        retry.click();
        expect(context._recheckAnki).toHaveBeenCalledTimes(1);
        off.click();
        expect(entry.querySelector('.fc-anki-callout')).toBeNull();
    });

    test('идёт сохранение — крутилка и «Сохраняю…»', () => {
        const {entry, container} = makeEntry([]);
        const context = makeContext(entry);
        context._savingNotes.set(entry, new Set([0]));
        P._applyCardFormatUi.call(context, 0, 0);
        expect(container.dataset.fcState).toBe('saving');
        expect(container.querySelector('.fc-spin')).not.toBeNull();
        expect(container.querySelector('.fc-label')?.textContent).toBe('Сохраняю…');
    });

    test('после сохранения — «Сохранено в Anki» с тегами вместо «Уже в Anki»', () => {
        const {entry} = makeEntry([1]);
        const context = makeContext(entry);
        context._lastSaved.set(entry, {replaced: false, tags: ['vocab', 'bbc.com']});
        P._applyCardFormatUi.call(context, 0, 0);
        const status = /** @type {HTMLElement} */ (entry.querySelector('.fc-anki-status'));
        expect(status.classList.contains('fc-ok')).toBe(true);
        expect(status.textContent).toBe('Сохранено в Anki·vocabbbc.com');
    });
});

describe('DisplayAnki — новый тег', () => {
    test('тег пишется в anki.userTags профиля и сразу отмечен', async () => {
        const modifySettings = vi.fn(() => Promise.resolve([]));
        // В настройках уже лежит тег, созданный в другой вкладке: он не должен потеряться.
        const optionsGet = vi.fn(() => Promise.resolve({anki: {userTags: ['vocab', 'from_other_tab']}}));
        const context = {
            _userTags: ['vocab'],
            _activeUserTags: new Set(),
            _pendingUserTags: new Set(),
            _renderUserTagToggleBar: vi.fn(),
            _showErrorNotification: vi.fn(),
            _display: {application: {api: {modifySettings, optionsGet}}, getOptionsContext: () => ({current: true})},
        };
        await P._createUserTag.call(context, 'my_news');
        expect(context._activeUserTags.has('my_news')).toBe(true);
        expect(modifySettings).toHaveBeenCalledWith([{action: 'set', path: 'anki.userTags', value: ['vocab', 'from_other_tab', 'my_news'], scope: 'profile', optionsContext: {current: true}}], USER_TAGS_OPTIONS_SOURCE);
        // Запись подтверждена — тег больше не «в пути», список совпадает с настройками.
        expect(context._pendingUserTags.has('my_news')).toBe(false);
        expect(context._userTags).toEqual(['vocab', 'from_other_tab', 'my_news']);
    });

    test('запись не удалась — тег убран из списка и снят, ошибка показана', async () => {
        const context = {
            _userTags: ['vocab'],
            _activeUserTags: new Set(),
            _pendingUserTags: new Set(),
            _renderUserTagToggleBar: vi.fn(),
            _showErrorNotification: vi.fn(),
            _display: {application: {api: {optionsGet: vi.fn(() => Promise.reject(new Error('down'))), modifySettings: vi.fn()}}, getOptionsContext: () => ({})},
        };
        await P._createUserTag.call(context, 'x');
        expect(context._userTags).toEqual(['vocab']);
        expect(context._activeUserTags.has('x')).toBe(false);
        expect(context._pendingUserTags.size).toBe(0);
        expect(context._showErrorNotification).toHaveBeenCalledTimes(1);
    });

    test('уже существующий тег — только отмечается, настройки не трогаются', async () => {
        const modifySettings = vi.fn();
        const context = {
            _userTags: ['vocab'],
            _activeUserTags: new Set(),
            _renderUserTagToggleBar: vi.fn(),
            _display: {application: {api: {modifySettings}}, getOptionsContext: () => ({})},
        };
        await P._createUserTag.call(context, 'vocab');
        expect(context._activeUserTags.has('vocab')).toBe(true);
        expect(modifySettings).not.toHaveBeenCalled();
    });
});

describe('DisplayAnki — карточка фразы (этап 6а)', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => { env = await setupDomTest(); });
    afterEach(async () => { await env.teardown(global); });

    test('«В Anki · N видео» на фразе: не путь карточки слова, а понятная ошибка', () => {
        const {entry, container} = makeEntry([5]);
        entry.dataset.type = 'phrase';
        container.classList.add('fc-anki');
        container.dataset.fcState = 'open';
        const context = {
            _showErrorNotification: vi.fn(),
            _saveWithMode: vi.fn(),
            _saveAnkiNote: vi.fn(),
        };
        P._saveEntryWithSelection.call(context, entry);
        expect(context._saveWithMode).not.toHaveBeenCalled();
        expect(context._saveAnkiNote).not.toHaveBeenCalled();
        expect(context._showErrorNotification).toHaveBeenCalledTimes(1);
    });

    test('оформление фразы: заметка есть — «Открыть в Anki», нет — «В Anki», заблокирована — disabled', () => {
        const {entry, container} = makeEntry([7]);
        entry.dataset.type = 'phrase';
        const context = {_getEntry: () => entry, _getNodeNoteIds: P._getNodeNoteIds, _setButtonContent: P._setButtonContent};
        P._applyPhraseCardUi.call(context, 0, false);
        expect(container.dataset.fcState).toBe('open');
        const view = /** @type {HTMLButtonElement} */ (container.querySelector('[data-action=view-note]'));
        view.hidden = true;
        P._applyPhraseCardUi.call(context, 0, false);
        expect(container.dataset.fcState).toBe('add');
        /** @type {HTMLButtonElement} */ (container.querySelector('[data-action=save-note]')).disabled = true;
        P._applyPhraseCardUi.call(context, 0, false);
        expect(container.dataset.fcState).toBe('disabled');
        P._applyPhraseCardUi.call(context, 0, true);
        expect(container.dataset.fcState).toBe('saving');
        expect(container.querySelector('[data-action=save-note] .fc-label')?.textContent).toBe('Сохраняю…');
    });
});

describe('новая выдача закрывает окна «Отметьте знакомые слова»', () => {
    test('_onContentClear закрывает окна фраз без возврата фокуса; окно буфера обмена остаётся', () => {
        const clipboard = {close: vi.fn()};
        const phrase = {close: vi.fn()};
        const context = {
            _eventListeners: new EventListenerCollection(),
            _hideErrorNotification: vi.fn(),
            _videoExamplesOrchestrator: null,
            _videoExamplesPanels: new Map(),
            _videoExamplesModal: null,
            _hideVideoExamplesDensityToggleIfEmpty: vi.fn(),
            _clipboardTestWordsPanel: clipboard,
            _phraseTestWordsPanels: new Map([[{}, phrase]]),
        };
        P._onContentClear.call(context);
        expect(clipboard.close).not.toHaveBeenCalled();
        expect(phrase.close).toHaveBeenCalledWith(false);
        expect(context._phraseTestWordsPanels.size).toBe(0);
    });

    test('панели проверки ещё нет — без ошибок', () => {
        const context = {
            _eventListeners: new EventListenerCollection(),
            _hideErrorNotification: vi.fn(),
            _videoExamplesOrchestrator: null,
            _videoExamplesPanels: new Map(),
            _videoExamplesModal: null,
            _hideVideoExamplesDensityToggleIfEmpty: vi.fn(),
            _clipboardTestWordsPanel: null,
            _phraseTestWordsPanels: new Map(),
        };
        expect(() => P._onContentClear.call(context)).not.toThrow();
    });
});
/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */
