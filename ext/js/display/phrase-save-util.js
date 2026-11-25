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

/*
 * The card of a phrase window, as its button saves it and tells about it (display-anki.js).
 */

import {ExtensionError} from '../core/extension-error.js';
import {FLIB_PRODUCT_DECK} from '../data/flib-anki-models.js';
import {buildPhraseNoteFields, getPhraseProblem, PHRASE_MAX_LENGTH, pickPhraseBlank} from '../data/flib-phrase-note.js';
import {translate} from '../i18n/ui-language.js';
import {getGatewayErrorCode} from './gateway-examples-util.js';

/** @type {Readonly<Record<'empty'|'no-latin'|'too-long', string>>} */
const PROBLEM_TEXT = Object.freeze({
    'empty': 'anki.phraseEmpty',
    'no-latin': 'anki.phraseNoLatin',
    'too-long': 'anki.phraseTooLong',
});

/** @type {Readonly<Record<string, string>>} */
const ERROR_TEXT = Object.freeze({
    anki_closed: 'anki.closedForPhrase',
    anki_deck_failed: 'anki.phraseDeckFailed',
    anki_model_failed: 'anki.phraseModelFailed',
    anki_model_outdated: 'anki.phraseModelOutdated',
    anki_note_failed: 'anki.phraseNoteFailed',
    anki_note_gone: 'anki.phraseNoteGone',
    anki_route_switched: 'route.switched',
    flib_bad_request: 'anki.phraseBadRequest',
});

/** `chrome.storage.local`, one key per address of Anki: the model revision whose «видео не видно» notice was shown. */
const VIDEO_HIDDEN_NOTICE_KEY_PREFIX = 'flibPhrasesCustomisedNotice:';

/**
 * @param {import('settings').AnkiCardFormat[]} cardFormats
 * @returns {number} The index of the format the window saves with; without a format of terms the first one.
 */
export function getPhraseCardFormatIndex(cardFormats) {
    return Math.max(0, cardFormats.findIndex(({type}) => type === 'term'));
}

/**
 * @param {import('settings').AnkiCardFormat[]} cardFormats
 * @returns {string}
 */
function getPhraseDeckName(cardFormats) {
    const deck = cardFormats.find(({type}) => type === 'term')?.deck ?? '';
    return deck.trim() === '' ? FLIB_PRODUCT_DECK : deck;
}

/**
 * @param {{value: string, selectionStart: number, selectionEnd: number}} field The English field, see `PhraseSelectionMemory`.
 * @param {string} translation
 * @param {import('settings').AnkiCardFormat[]} cardFormats
 * @returns {import('display-anki').PhraseCard}
 */
export function createPhraseCard(field, translation, cardFormats) {
    const deckName = getPhraseDeckName(cardFormats);
    const blank = pickPhraseBlank(field);
    const fields = buildPhraseNoteFields({value: field.value, blank, translation, mediaHtml: ''});
    if (fields === null) {
        const problem = translate(PROBLEM_TEXT[getPhraseProblem(field.value) ?? 'empty'], {max: PHRASE_MAX_LENGTH});
        return {deckName, key: '', fields: null, title: problem, problem};
    }
    const {Front, EnglishWord} = fields;
    const title = blank === null ? translate('anki.phraseWillWhole') : translate('anki.phraseWillBlank', {text: EnglishWord});
    return {deckName, key: JSON.stringify([deckName, Front, EnglishWord]), fields, title, problem: null};
}

/**
 * @param {unknown} error
 * @returns {boolean} The type must be prepared again.
 */
export function isPhraseModelOutdated(error) {
    return getGatewayErrorCode(error) === 'anki_model_outdated';
}

/**
 * @param {Error} error Of a phrase request.
 * @param {string} deckName
 * @returns {Error} With a text for the user.
 */
export function createPhraseSaveError(error, deckName) {
    const code = getGatewayErrorCode(error);
    if (code === null || !Object.hasOwn(ERROR_TEXT, code)) { return error; }
    const result = new ExtensionError(translate(ERROR_TEXT[code], {deck: deckName}));
    // For the log link of the notice: the code and its detail, the request is never there.
    result.data = /** @type {{data?: unknown}} */ (error).data;
    return result;
}

/**
 * @param {import('api').FlibPhrasePrepared} prepared
 * @returns {Promise<boolean>} The notice that the cards do not show the videos was shown for this Anki and revision.
 */
export async function wasPhraseVideoHiddenNoticeShown({server, modelRevision}) {
    const key = VIDEO_HIDDEN_NOTICE_KEY_PREFIX + server;
    const stored = await chrome.storage.local.get([key]);
    return stored[key] === modelRevision;
}

/**
 * @param {import('api').FlibPhrasePrepared} prepared
 */
export async function rememberPhraseVideoHiddenNotice({server, modelRevision}) {
    await chrome.storage.local.set({[VIDEO_HIDDEN_NOTICE_KEY_PREFIX + server]: modelRevision});
}
