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
import {FLIB_ENRICHED_TAG, markNoteForEnrichment, shouldEnrichNote, startEnrichment} from '../ext/js/display/flib-enrich-flow.js';

/**
 * @param {string} modelName
 * @returns {import('anki').Note}
 */
const note = (modelName) => /** @type {import('anki').Note} */ (/** @type {unknown} */ ({modelName, tags: ['yomitan', 'news'], fields: {}}));
const REPORT = {enrich: {status: 'done'}, audio: {status: 'done'}, reverse: {status: 'done'}, phrases: {status: 'done'}, speechCode: null};

describe('shouldEnrichNote', () => {
    test('disabled sends nothing', () => {
        expect(shouldEnrichNote(note('Yomitan Card Type'), {enrichCards: false, hasKey: true})).toBe(false);
    });
    test('no key sends nothing', () => {
        expect(shouldEnrichNote(note('Yomitan Card Type'), {enrichCards: true, hasKey: false})).toBe(false);
    });
    test('other model sends nothing', () => {
        expect(shouldEnrichNote(note('Basic'), {enrichCards: true, hasKey: true})).toBe(false);
    });
    test('Yomitan Card Type with a key and the option on', () => {
        expect(shouldEnrichNote(note(' yomitan card type '), {enrichCards: true, hasKey: true})).toBe(true);
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
        await startEnrichment({api: /** @type {*} */ (api), noteId: 5, tags: ['yomitan', FLIB_ENRICHED_TAG, 'news'], isCurrent: () => true, render: (s) => { states.push(s); }});
        expect(api.flibEnrichNote).toHaveBeenCalledWith(5, ['yomitan', 'news']);
        expect(states).toStrictEqual(['pending', REPORT]);
    });

    test('report after content change is dropped', async () => {
        const api = {flibEnrichNote: vi.fn(async () => REPORT)};
        /** @type {unknown[]} */
        const states = [];
        let current = true;
        const pending = startEnrichment({api: /** @type {*} */ (api), noteId: 5, tags: [], isCurrent: () => current, render: (s) => { states.push(s); }});
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
        await startEnrichment({api: /** @type {*} */ (api), noteId: 5, tags: [], isCurrent: () => true, render: (s) => { states.push(s); }});
        const failed = {status: 'failed', code: 'flib_secret_forbidden'};
        expect(states[1]).toStrictEqual({enrich: failed, audio: failed, reverse: failed, phrases: failed, speechCode: null});
    });
});
