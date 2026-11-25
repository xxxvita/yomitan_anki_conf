/*
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

import type * as Anki from './anki';
import type * as AnkiNoteBuilder from './anki-note-builder';
import type * as AnkiTemplates from './anki-templates';
import type {ApiParams, FlibPhrasePrepared} from './api';
import type * as Core from './core';
import type {PhraseNoteFields} from '../../ext/js/data/flib-phrase-note';
import type * as Settings from './settings';

export type LogData = {
    ankiNoteData: AnkiTemplates.NoteData | undefined;
    ankiNoteDataException: Error | undefined;
    ankiNotes: AnkiNoteLogData[];
};

export type AnkiNoteLogData = {
    cardFormatIndex: number;
    note: Anki.Note | undefined;
    errors?: Error[];
    requirements?: AnkiNoteBuilder.Requirement[];
};

export type DictionaryEntryDetails = {
    noteMap: Map<number, DictionaryEntryNoteDetails>;
};

export type DictionaryEntryNoteDetails = {
    cardFormat: Settings.AnkiCardFormat;
    note: Anki.Note;
    errors: Error[];
    requirements: AnkiNoteBuilder.Requirement[];
    canAdd: boolean;
    valid: boolean;
    /**
     * Anki IDs of duplicate notes. May contain INVALID_NOTE_ID for notes whose ID could not be found.
     */
    noteIds: Anki.NoteId[] | null;
    noteInfos?: (Anki.NoteInfo | null)[];
    ankiError: Error | null;
};

export type CreateNoteResult = {
    note: Anki.Note;
    errors: Error[];
    requirements: AnkiNoteBuilder.Requirement[];
};

export type RGB = {
    red: number;
    green: number;
    blue: number;
};

/** What a phrase window would save. */
export type PhraseCard = {
    deckName: string;
    /** The deck, Front and EnglishWord: the same card. '' — nothing to save. */
    key: string;
    /** The tooltip of the button. */
    title: string;
    /** The text of the blank; null — a whole phrase, or nothing to save. */
    blank: string | null;
    /** As it was typed; for the notice of a save whose window is gone. */
    translation: string;
} & (
    /** `speech`: what is read aloud, the output of `phraseSpeechTexts`. */
    {fields: PhraseNoteFields, speech: {expression: string, front: string | null}, problem: null} |
    /** Why there is nothing to save, for the user. */
    {fields: null, speech: null, problem: string}
);

/** A phrase card as it was when «В Anki» was pressed. */
export type PhraseSave = {
    deckName: string;
    fields: PhraseNoteFields;
    tags: string[];
    /** `flib_media` of the ticked videos, their files are stored at this address of Anki; null — nothing ticked. */
    createMediaHtml: ((server: string) => Promise<string>) | null;
    /** The notes of the card that are in Anki, known before they are written; `null` — nothing is known. */
    onFound: (noteIds: number[] | null) => void;
    /** The note is about to be written. */
    onWrite: () => void;
};

export type PhraseSaveResult = {
    /** The added note, or those of the same card that were there already. */
    noteIds: number[];
    /** It was added, it is the only one. */
    added: boolean;
    /** Videos were saved into the first of them. */
    videoSaved: boolean;
    prepared: FlibPhrasePrepared;
};

/** `flibPhraseEnrich` of a note that is not added yet, as of the press. */
export type PhraseEnrichment = Omit<ApiParams<'flibPhraseEnrich'>, 'server' | 'noteId'>;

/** The line about audio and translation of an added note. */
export type PhraseEnrichmentLine = {
    /** `PhraseCard.key` of the note: with another card in the window the line is not shown. */
    key: string;
    line: HTMLElement | null;
};

/** The phrase on screen and its Anki button; written and read in `DisplayAnki`. */
export type PhraseWindow = {
    entry: HTMLElement;
    /** Of the buttons. */
    container: HTMLElement;
    saveButton: HTMLButtonElement;
    expressionInput: HTMLTextAreaElement;
    translationInput: HTMLTextAreaElement;
    /** Of the buttons and of the claim in `_savingNotes`. */
    cardFormatIndex: number;
    /** «Пропуск: …» under the fields. */
    blankLine: Element | null;
    /** Tooltip of `saveButton`. */
    title: string;
    /** `PhraseCard.blank`, for `blankLine`. */
    blank: string | null;
    /** `null` — not asked yet; only `false` is asked again. */
    connected: boolean | null;
    /** The question that is going on. */
    connecting: Promise<boolean> | null;
    /** `PhraseCard.key` of the card that the button is about; `null` — not read yet. */
    key: string | null;
    /** The notes of that card, as far as it is known. */
    noteIds: number[];
    /** Of that card; another one as soon as an answer asked for before is out of date. */
    token: Core.TokenObject | null;
    /** Resolved when the save that is going on ends; `null` — there is none. */
    saving: Promise<void> | null;
    /** Of the last added note; `null` — no note was added. */
    enrichment: PhraseEnrichmentLine | null;
};
