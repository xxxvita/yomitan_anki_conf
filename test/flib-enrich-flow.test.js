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
import {ExtensionError} from '../ext/js/core/extension-error.js';
import {FLIB_ENRICHED_TAG, decideEnrichment, enrichCardsFromOptions, markNoteForEnrichment, shouldShowNoKeyHint, startEnrichment} from '../ext/js/display/flib-enrich-flow.js';

/**
 * @param {string} modelName
 * @returns {import('anki').Note}
 */
const note = (modelName) => /** @type {import('anki').Note} */ (/** @type {unknown} */ ({modelName, tags: ['yomitan', 'news'], fields: {}}));
const REPORT = {enrich: {status: 'done'}, audio: {status: 'done'}, reverse: {status: 'done'}, phrases: {status: 'done'}, speechCode: null};

describe('decideEnrichment', () => {
    const on = {enrichCards: true, hasKey: true};
    test('option off → none', () => {
        expect(decideEnrichment(note('Yomitan Card Type'), {...on, enrichCards: false})).toBe('none');
    });
    test('other model → none', () => {
        expect(decideEnrichment(note('Basic'), on)).toBe('none');
    });
    test('key present → enrich', () => {
        expect(decideEnrichment(note('Yomitan Card Type'), on)).toBe('enrich');
    });
    test('no key → no-key candidate (the route is checked after the add)', () => {
        expect(decideEnrichment(note('Yomitan Card Type'), {...on, hasKey: false})).toBe('no-key');
    });
    test('status call threw (null) → none', () => {
        expect(decideEnrichment(note('Yomitan Card Type'), {...on, hasKey: null})).toBe('none');
    });
    test('model name is case- and space-insensitive', () => {
        expect(decideEnrichment(note(' yomitan card type '), on)).toBe('enrich');
    });
});

describe('shouldShowNoKeyHint', () => {
    test('only a confirmed direct route shows the hint', () => {
        expect(shouldShowNoKeyHint('direct')).toBe(true);
    });
    test.each(['core', 'none', 'disabled', null, void 0])('route %s → no hint', (routeMode) => {
        expect(shouldShowNoKeyHint(routeMode)).toBe(false);
    });
});

describe('enrichCardsFromOptions', () => {
    test('enrichCardsFromOptions reads only the given options', () => {
        expect(enrichCardsFromOptions({createReverseCard: false, createPhrasesCard: true})).toStrictEqual({reverse: false, phrases: true});
        expect(enrichCardsFromOptions(void 0)).toStrictEqual({reverse: true, phrases: true});
    });
});

describe('markNoteForEnrichment', () => {
    test('tag added before addNote, once', () => {
        const n = note('Yomitan Card Type');
        markNoteForEnrichment(n);
        markNoteForEnrichment(n);
        expect(n.tags).toStrictEqual(['yomitan', 'news', FLIB_ENRICHED_TAG]);
    });
});

describe('startEnrichment', () => {
    test('renders pending, then the report; user tags exclude the marker', async () => {
        const api = {flibEnrichNote: vi.fn(async () => REPORT)};
        /** @type {unknown[]} */
        const states = [];
        await startEnrichment({api: /** @type {*} */ (api), noteId: 5, tags: ['yomitan', FLIB_ENRICHED_TAG, 'news'], cards: {reverse: false, phrases: true}, isCurrent: () => true, render: (s) => { states.push(s); }});
        expect(api.flibEnrichNote).toHaveBeenCalledWith(5, ['yomitan', 'news'], {reverse: false, phrases: true});
        expect(states).toStrictEqual(['pending', REPORT]);
    });

    test('report after content change is dropped', async () => {
        const api = {flibEnrichNote: vi.fn(async () => REPORT)};
        /** @type {unknown[]} */
        const states = [];
        let current = true;
        const pending = startEnrichment({api: /** @type {*} */ (api), noteId: 5, tags: [], cards: {reverse: true, phrases: true}, isCurrent: () => current, render: (s) => { states.push(s); }});
        current = false;
        await pending;
        expect(states).toStrictEqual(['pending']);
    });

    test('call failed entirely → a failed report with the error code', async () => {
        const error = new ExtensionError('flib_secret_forbidden');
        error.data = {code: 'flib_secret_forbidden'};
        const api = {flibEnrichNote: vi.fn(async () => { throw error; })};
        /** @type {unknown[]} */
        const states = [];
        await startEnrichment({api: /** @type {*} */ (api), noteId: 5, tags: [], cards: {reverse: true, phrases: true}, isCurrent: () => true, render: (s) => { states.push(s); }});
        const failed = {status: 'failed', code: 'flib_secret_forbidden'};
        expect(states[1]).toStrictEqual({enrich: failed, audio: failed, reverse: failed, phrases: failed, speechCode: null});
    });
});
