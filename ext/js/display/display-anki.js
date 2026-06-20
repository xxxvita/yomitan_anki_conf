/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2021-2022  Yomichan Authors
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

import {EventListenerCollection} from '../core/event-listener-collection.js';
import {ExtensionError} from '../core/extension-error.js';
import {log} from '../core/log.js';
import {toError} from '../core/to-error.js';
import {deferPromise} from '../core/utilities.js';
import {AnkiNoteBuilder} from '../data/anki-note-builder.js';
import {getDynamicTemplates} from '../data/anki-template-util.js';
import {INVALID_NOTE_ID, isNoteDataValid} from '../data/anki-util.js';
import {createPhraseNoteFields} from '../data/phrase-note-fields.js';
import {computeAutoTags} from '../data/url-tags.js';
import {parseVideosFromData, serializeVideosForData} from '../data/video-examples-data-field.js';
import {findFieldKeyCaseInsensitive, VIDEO_EXAMPLES_FIELD_NAME} from '../data/video-examples-bootstrap.js';
import {PopupMenu} from '../dom/popup-menu.js';
import {querySelectorNotNull} from '../dom/query-selector.js';
import {TemplateRendererProxy} from '../templates/template-renderer-proxy.js';
import {TestWordsController} from './test-words-panel.js';
import {VideoExamplesModal} from './video-examples-modal.js';
import {VideoExamplesOrchestrator} from './video-examples-orchestrator.js';
import {VideoExamplesPanel} from './video-examples-panel.js';

export class DisplayAnki {
    /**
     * @param {import('./display.js').Display} display
     * @param {import('./display-audio.js').DisplayAudio} displayAudio
     */
    constructor(display, displayAudio) {
        /** @type {import('./display.js').Display} */
        this._display = display;
        /** @type {import('./display-audio.js').DisplayAudio} */
        this._displayAudio = displayAudio;
        /** @type {?string} */
        this._ankiFieldTemplates = null;
        /** @type {?string} */
        this._ankiFieldTemplatesDefault = null;
        /** @type {AnkiNoteBuilder} */
        this._ankiNoteBuilder = new AnkiNoteBuilder(display.application.api, new TemplateRendererProxy());
        /** @type {?import('./display-notification.js').DisplayNotification} */
        this._errorNotification = null;
        /** @type {?EventListenerCollection} */
        this._errorNotificationEventListeners = null;
        /** @type {?import('./display-notification.js').DisplayNotification} */
        this._tagsNotification = null;
        /** @type {?import('./display-notification.js').DisplayNotification} */
        this._flagsNotification = null;
        /** @type {?Promise<void>} */
        this._updateSaveButtonsPromise = null;
        /** @type {?import('core').TokenObject} */
        this._updateDictionaryEntryDetailsToken = null;
        /** @type {?import('core').TokenObject} */
        this._updatePhraseEntryDetailsToken = null;
        /** @type {EventListenerCollection} */
        this._eventListeners = new EventListenerCollection();
        /** @type {?import('display-anki').DictionaryEntryDetails[]} */
        this._dictionaryEntryDetails = null;
        /** @type {?import('anki-templates-internal').Context} */
        this._noteContext = null;
        /** @type {boolean} */
        this._checkForDuplicates = false;
        /** @type {boolean} */
        this._suspendNewCards = false;
        /** @type {boolean} */
        this._compactTags = false;
        /** @type {import('settings').ResultOutputMode} */
        this._resultOutputMode = 'split';
        /** @type {import('settings').GlossaryLayoutMode} */
        this._glossaryLayoutMode = 'default';
        /** @type {import('settings').AnkiDisplayTagsAndFlags} */
        this._displayTagsAndFlags = 'never';
        /** @type {import('settings').AnkiDuplicateScope} */
        this._duplicateScope = 'collection';
        /** @type {boolean} */
        this._duplicateScopeCheckAllModels = false;
        /** @type {import('settings').AnkiDuplicateBehavior} */
        this._duplicateBehavior = 'new';
        /** @type {import('settings').AnkiScreenshotFormat} */
        this._screenshotFormat = 'png';
        /** @type {number} */
        this._screenshotQuality = 100;
        /** @type {number} */
        this._scanLength = 10;
        /** @type {import('settings').AnkiNoteGuiMode} */
        this._noteGuiMode = 'browse';
        /** @type {?number} */
        this._audioDownloadIdleTimeout = null;
        /** @type {string[]} */
        this._noteTags = [];
        /** @type {string[]} */
        this._targetTags = [];
        /** @type {string[]} */
        this._userTags = [];
        /** @type {Set<string>} */
        this._activeUserTags = new Set();
        /** @type {?HTMLElement} */
        this._popupToolbar = null;
        /** @type {?HTMLElement} */
        this._popupToolbarTagsContainer = null;
        /** @type {?HTMLElement} */
        this._popupToolbarActionsContainer = null;
        /** @type {?TestWordsController} */
        this._clipboardTestWordsPanel = null;
        /** @type {?VideoExamplesOrchestrator} */
        this._videoExamplesOrchestrator = null;
        /** @type {Map<HTMLElement, VideoExamplesPanel>} */
        this._videoExamplesPanels = new Map();
        /** @type {?VideoExamplesModal} */
        this._videoExamplesModal = null;
        /** @type {string} */
        this._confServer = '';
        /** @type {'compact'|'large'} */
        this._videoExamplesDensity = this._loadVideoExamplesDensity();
        /** @type {?HTMLElement} */
        this._videoExamplesDensityToggle = null;
        /** @type {import('settings').AnkiCardFormat[]} */
        this._cardFormats = [];
        /** @type {import('settings').DictionariesOptions} */
        this._dictionaries = [];
        /** @type {HTMLElement} */
        this._menuContainer = querySelectorNotNull(document, '#popup-menus');
        /** @type {(event: MouseEvent) => void} */
        this._onShowTagsBind = this._onShowTags.bind(this);
        /** @type {(event: MouseEvent) => void} */
        this._onShowFlagsBind = this._onShowFlags.bind(this);
        /** @type {(event: MouseEvent) => void} */
        this._onNoteSaveBind = this._onNoteSave.bind(this);
        /** @type {(event: MouseEvent) => void} */
        this._onViewNotesButtonClickBind = this._onViewNotesButtonClick.bind(this);
        /** @type {(event: MouseEvent) => void} */
        this._onViewNotesButtonContextMenuBind = this._onViewNotesButtonContextMenu.bind(this);
        /** @type {(event: import('popup-menu').MenuCloseEvent) => void} */
        this._onViewNotesButtonMenuCloseBind = this._onViewNotesButtonMenuClose.bind(this);
        /** @type {(event: MouseEvent) => void} */
        this._onShowExamplesBind = this._onShowExamples.bind(this);
        /** @type {boolean} */
        this._forceSync = false;
    }

    /** */
    prepare() {
        this._noteContext = this._getNoteContext();
        /* eslint-disable @stylistic/no-multi-spaces */
        this._display.hotkeyHandler.registerActions([
            ['addNote',     this._hotkeySaveAnkiNoteForSelectedEntry.bind(this)],
            ['viewNotes',   this._hotkeyViewNotesForSelectedEntry.bind(this)],
        ]);
        /* eslint-enable @stylistic/no-multi-spaces */
        this._display.on('optionsUpdated', this._onOptionsUpdated.bind(this));
        this._display.on('contentClear', this._onContentClear.bind(this));
        this._display.on('contentUpdateStart', this._onContentUpdateStart.bind(this));
        this._display.on('contentUpdateComplete', this._onContentUpdateComplete.bind(this));
        this._display.on('logDictionaryEntryData', this._onLogDictionaryEntryData.bind(this));

        this._videoExamplesOrchestrator = new VideoExamplesOrchestrator(this._display.application.api);
        this._videoExamplesModal = new VideoExamplesModal();
        this._ensureVideoExamplesDragHandle();

        // Delegate Ex-button clicks at the #dictionary-entries container so we
        // only attach one listener regardless of how many entries are rendered
        // (and re-rendered by Yomitan when the user navigates). The buttons
        // themselves are baked into the entry templates and ride along on
        // every re-render for free. Raw addEventListener (not _eventListeners)
        // — that collection is wiped on every contentClear, but #dictionary-
        // entries lives for the whole popup-iframe lifetime and we want the
        // delegation to survive content swaps.
        const entriesContainer = document.getElementById('dictionary-entries');
        if (entriesContainer !== null) {
            entriesContainer.addEventListener('click', this._onShowExamplesBind);
        }
    }

    /**
     * @param {import('dictionary').DictionaryEntry} dictionaryEntry
     * @returns {Promise<import('display-anki').LogData>}
     */
    async getLogData(dictionaryEntry) {
        // Anki note data
        let ankiNoteData;
        let ankiNoteDataException;
        try {
            if (this._noteContext === null) { throw new Error('Note context not initialized'); }
            ankiNoteData = await this._ankiNoteBuilder.getRenderingData({
                dictionaryEntry,
                cardFormat: this._cardFormats[0],
                context: this._noteContext,
                resultOutputMode: this._resultOutputMode,
                glossaryLayoutMode: this._glossaryLayoutMode,
                compactTags: this._compactTags,
                marker: 'test',
                dictionaryStylesMap: this._ankiNoteBuilder.getDictionaryStylesMap(this._dictionaries),
            });
        } catch (e) {
            ankiNoteDataException = e;
        }

        // Anki notes
        /** @type {import('display-anki').AnkiNoteLogData[]} */
        const ankiNotes = [];
        for (const [cardFormatIndex] of this._cardFormats.entries()) {
            let note;
            let errors;
            let requirements;
            try {
                ({note: note, errors, requirements} = await this._createNote(dictionaryEntry, cardFormatIndex, []));
            } catch (e) {
                errors = [toError(e)];
            }
            /** @type {import('display-anki').AnkiNoteLogData} */
            const entry = {cardFormatIndex, note};
            if (Array.isArray(errors) && errors.length > 0) {
                entry.errors = errors;
            }
            if (Array.isArray(requirements) && requirements.length > 0) {
                entry.requirements = requirements;
            }
            ankiNotes.push(entry);
        }

        return {
            ankiNoteData,
            ankiNoteDataException: toError(ankiNoteDataException),
            ankiNotes,
        };
    }

    // Private

    /**
     * @param {import('display').EventArgument<'optionsUpdated'>} details
     */
    _onOptionsUpdated({options}) {
        const {
            general: {
                resultOutputMode,
                glossaryLayoutMode,
                compactTags,
            },
            dictionaries,
            anki: {
                tags,
                targetTags,
                userTags,
                duplicateScope,
                duplicateScopeCheckAllModels,
                duplicateBehavior,
                suspendNewCards,
                checkForDuplicates,
                displayTagsAndFlags,
                cardFormats,
                noteGuiMode,
                screenshot: {format, quality},
                downloadTimeout,
                forceSync,
                confServer,
            },
            scanning: {length: scanLength},
        } = options;

        this._checkForDuplicates = checkForDuplicates;
        this._suspendNewCards = suspendNewCards;
        this._compactTags = compactTags;
        this._resultOutputMode = resultOutputMode;
        this._glossaryLayoutMode = glossaryLayoutMode;
        this._displayTagsAndFlags = displayTagsAndFlags;
        this._duplicateScope = duplicateScope;
        this._duplicateScopeCheckAllModels = duplicateScopeCheckAllModels;
        this._duplicateBehavior = duplicateBehavior;
        this._screenshotFormat = format;
        this._screenshotQuality = quality;
        this._scanLength = scanLength;
        this._noteGuiMode = noteGuiMode;
        this._noteTags = [...tags];
        this._targetTags = [...targetTags];
        this._userTags = userTags.map((s) => s.trim()).filter((s) => s.length > 0);
        this._confServer = typeof confServer === 'string' ? confServer : '';
        const previousActiveUserTags = [...this._activeUserTags];
        for (const tag of previousActiveUserTags) {
            if (!this._userTags.includes(tag)) { this._activeUserTags.delete(tag); }
        }
        // Order matters: clipboard bar is rendered first so it sits at the very
        // top of #dictionary-entries; the user-tag toggle bar drops just below.
        this._renderClipboardTestWordsBar();
        this._renderUserTagToggleBar();
        this._audioDownloadIdleTimeout = (Number.isFinite(downloadTimeout) && downloadTimeout > 0 ? downloadTimeout : null);
        this._cardFormats = cardFormats;
        this._dictionaries = dictionaries;
        this._forceSync = forceSync;

        void this._updateAnkiFieldTemplates(options);
    }

    /** */
    _onContentClear() {
        this._updateDictionaryEntryDetailsToken = null;
        this._updatePhraseEntryDetailsToken = null;
        this._dictionaryEntryDetails = null;
        this._hideErrorNotification(false);
        this._eventListeners.removeAllEventListeners();
        // Abort any in-flight clip jobs — the entries that requested them are
        // about to be replaced with new lookup results.
        if (this._videoExamplesOrchestrator !== null) {
            this._videoExamplesOrchestrator.cancelAll();
        }
        for (const panel of this._videoExamplesPanels.values()) { panel.destroy(); }
        this._videoExamplesPanels.clear();
        if (this._videoExamplesModal !== null) { this._videoExamplesModal.close(); }
        this._hideVideoExamplesDensityToggleIfEmpty();
    }

    /**
     * Centralised modal opener used by all three onClipOpen sites (F1
     * collect, F1 retry path, F2 auto-mount). Opens the modal AND asks the
     * page-side Frontend to scroll the popup iframe into view — the modal
     * is `position:fixed; inset:0` inside the iframe, so a popup that
     * extends past the bottom of the browser viewport puts the centered
     * modal off-screen. Fire-and-forget; harmless no-op in popup-window
     * mode where there is no embedded iframe.
     * @param {import('anki-conf').ClipStatus} clip
     */
    _openVideoExamplesModal(clip) {
        if (this._videoExamplesModal === null) { return; }
        this._videoExamplesModal.open(clip);
        // Modal is `position:fixed; inset:0` inside the iframe — centered in
        // iframe's own viewport, not the browser's. Ask parent to grow the
        // popup tall enough for the modal AND shift it up so it doesn't hang
        // below the browser viewport. Page scroll stays put. 720 px ≈ modal
        // dialog max-height (92vh of ~780 popup), enough for the video +
        // controls + subtitle row.
        void this._display.invokeContentOrigin('frontendFitPopupForViewport', {minHeight: 720}).catch(() => {
            // Popup-window mode or detached frontend — silent ignore.
        });
    }

    /** */
    _onContentUpdateStart() {
        this._noteContext = this._getNoteContext();
    }

    /** */
    _onContentUpdateComplete() {
        if (this._display.contentType === 'phrase') {
            void this._updatePhraseEntryDetails();
        } else {
            void this._updateDictionaryEntryDetails();
        }
        this._updateClipboardBarVisibility();
        // Re-route the user tag toggles into the new content's toolbar slot
        // (phrase entry has its own slot inside .phrase-toolbar; everything
        // else uses the shared .popup-toolbar above #dictionary-entries).
        this._renderUserTagToggleBar();
    }

    /**
     * @param {import('display').EventArgument<'logDictionaryEntryData'>} details
     */
    _onLogDictionaryEntryData({dictionaryEntry, promises}) {
        promises.push(this.getLogData(dictionaryEntry));
    }

    /**
     * @param {MouseEvent} e
     * @throws {Error}
     */
    _onNoteSave(e) {
        e.preventDefault();
        const element = /** @type {HTMLElement} */ (e.currentTarget);
        const cardFormatIndex = element.dataset.cardFormatIndex;
        if (!cardFormatIndex || !Number.isInteger(Number.parseInt(cardFormatIndex, 10))) {
            throw new Error(`Invalid note options index: ${cardFormatIndex}`);
        }
        const index = this._display.getElementDictionaryEntryIndex(element);
        void this._saveAnkiNote(index, Number.parseInt(cardFormatIndex, 10));
    }

    /**
     * Delegated handler for the "Ex" video-examples button. P2 skeleton:
     * resolves the entry's headword (or the phrase expression input) and logs
     * it. P3+ wires this to the polling clips client.
     * @param {MouseEvent} e
     */
    _onShowExamples(e) {
        const target = e.target;
        if (!(target instanceof Element)) { return; }
        const button = target.closest('[data-action="show-examples"]');
        if (button === null) { return; }
        e.preventDefault();

        const entry = button.closest('.entry');
        if (entry === null || !(entry instanceof HTMLElement)) { return; }

        let word = '';
        let source = 'unknown';
        let dictionaryEntryIndex = -1;
        if (entry.dataset.type === 'phrase') {
            // Phrase entries don't go through dictionaryEntries[]; the canonical
            // text is whatever the user typed into the expression input.
            const exprInput = entry.querySelector('.phrase-expression-input');
            if (exprInput instanceof HTMLTextAreaElement) {
                word = exprInput.value.trim();
                source = 'phrase';
            }
        } else {
            dictionaryEntryIndex = this._display.getElementDictionaryEntryIndex(/** @type {HTMLElement} */ (button));
            const dictionaryEntry = dictionaryEntryIndex >= 0 ? this._display.dictionaryEntries[dictionaryEntryIndex] : null;
            if (dictionaryEntry !== null) {
                if (dictionaryEntry.type === 'term' && dictionaryEntry.headwords.length > 0) {
                    word = dictionaryEntry.headwords[0].term;
                    source = 'term';
                } else if (dictionaryEntry.type === 'kanji') {
                    word = dictionaryEntry.character;
                    source = 'kanji';
                }
            }
        }

        if (word.length === 0) {
            log.log(`[video-examples] Ex clicked (source=${source}) — empty word, skipping`);
            return;
        }
        if (this._videoExamplesOrchestrator === null) {
            log.log(`[video-examples] Ex clicked (source=${source}) word=${JSON.stringify(word)} — orchestrator is null. Check anki.confServer setting + bootstrap status.`);
            return;
        }
        log.log(`[video-examples] Ex clicked (source=${source}) word=${JSON.stringify(word)} dictionaryEntryIndex=${dictionaryEntryIndex}`);
        this._showVideoExamplesForEntry(/** @type {HTMLElement} */ (entry), word, source, dictionaryEntryIndex).catch((error) => {
            log.error(new Error(`[video-examples] _showVideoExamplesForEntry threw: ${error instanceof Error ? error.message : String(error)}`));
        });
    }

    /**
     * Idempotent: a second Ex-click on the same entry while a panel is already
     * mounted just scrolls the panel into view. Otherwise either:
     *   - F2 replay: if the entry's word already has a saved Anki note carrying
     *     our `data` JSON, mount a read-only panel rendering those clips.
     *   - F1 collect: spin up a panel + orchestrator job to fetch fresh
     *     examples from Core.
     * @param {HTMLElement} entry
     * @param {string} word
     * @param {string} source
     * @param {number} dictionaryEntryIndex Pass -1 for phrase entries (they
     *   don't go through dictionaryEntries[] so F2 is unavailable).
     * @returns {Promise<void>}
     */
    async _showVideoExamplesForEntry(entry, word, source, dictionaryEntryIndex) {
        const orchestrator = this._videoExamplesOrchestrator;
        if (orchestrator === null) { return; }

        const existing = this._videoExamplesPanels.get(entry);
        if (typeof existing !== 'undefined' && existing.root.isConnected) {
            // If the previous attempt ended in error/timeout/expired, the user
            // clicking Ex again means "try again", not "show me what's there".
            // Otherwise (queued/polling/ready/replay) it's just a re-focus.
            if (existing.isTerminal()) {
                orchestrator.cancelEntry(entry);
                this._videoExamplesPanels.delete(entry);
                this._hideVideoExamplesDensityToggleIfEmpty();
                existing.destroy();
                // Fall through to the fresh-mount branch below.
            } else {
                existing.root.scrollIntoView({block: 'nearest', behavior: 'smooth'});
                return;
            }
        }

        // Ask the page-side Frontend to widen the popup iframe so the side
        // panel (~280px column + gutter + breathing room for the still-
        // readable dictionary content) actually fits. Fire-and-forget — the
        // resize lands asynchronously, the panel mounts immediately into
        // whatever width the popup is at that instant, and reflows once the
        // frame grows. No-op if popup is already at/above the target.
        void this._display.invokeContentOrigin('frontendEnsurePopupWidth', {minWidth: 820}).catch(() => {
            // Top-level popup-window mode (separate browser window, not iframe)
            // doesn't implement getFrameSize/setFrameSize — silently ignore.
        });
        // Also grow the popup vertically so all 3 large cards have room to
        // breathe — header + footer + 3 × ~240 px hero cards + gaps ≈ 900 px.
        // Compact density needs much less, but we always go for the larger
        // value so density hot-swap doesn't trigger another reflow.
        // Capped to 96vh by the Frontend handler, so short browser windows
        // still degrade gracefully (scroll inside the panel grid).
        void this._display.invokeContentOrigin('frontendEnsurePopupHeight', {minHeight: 900}).catch(() => {
            // Same fallback as the width call.
        });

        this._ensureVideoExamplesDensityToggle();

        const replayClips = dictionaryEntryIndex >= 0 ? await this._buildReplayClipsForEntry(dictionaryEntryIndex) : null;
        if (replayClips !== null) {
            log.log(`[video-examples] opening REPLAY panel (source=${source}) word=${JSON.stringify(word)} clips=${replayClips.length}`);
            const panel = new VideoExamplesPanel(entry, word, {
                onCancel: () => {
                    this._videoExamplesPanels.delete(entry);
                    this._hideVideoExamplesDensityToggleIfEmpty();
                    panel.destroy();
                },
                onRetry: () => {
                    // Retry on a replay panel currently has no extra meaning;
                    // re-open simply re-reads the same saved data.
                    this._videoExamplesPanels.delete(entry);
                    this._hideVideoExamplesDensityToggleIfEmpty();
                    panel.destroy();
                    void this._showVideoExamplesForEntry(entry, word, source, dictionaryEntryIndex);
                },
                onClipOpen: (clip) => {
                    this._openVideoExamplesModal(clip);
                },
            }, {mode: 'replay', initialClips: replayClips, density: this._videoExamplesDensity});
            this._videoExamplesPanels.set(entry, panel);
            this._setVideoExamplesDragEnabled(true);
            return;
        }

        log.log(`[video-examples] opening COLLECT panel (source=${source}) word=${JSON.stringify(word)}`);

        const panel = new VideoExamplesPanel(entry, word, {
            onCancel: () => {
                orchestrator.cancelEntry(entry);
                this._videoExamplesPanels.delete(entry);
                this._hideVideoExamplesDensityToggleIfEmpty();
                panel.destroy();
            },
            onRetry: () => {
                // Retry == close the panel then re-request. Avoids tangling
                // the orchestrator's state machine with a stale job_id.
                orchestrator.cancelEntry(entry);
                this._videoExamplesPanels.delete(entry);
                this._hideVideoExamplesDensityToggleIfEmpty();
                panel.destroy();
                void this._showVideoExamplesForEntry(entry, word, source, dictionaryEntryIndex);
            },
            onClipOpen: (clip) => { this._openVideoExamplesModal(clip); },
        }, {density: this._videoExamplesDensity});
        this._videoExamplesPanels.set(entry, panel);
        this._setVideoExamplesDragEnabled(true);

        orchestrator.requestExamples(entry, word, {
            onPhase: (phase) => panel.onPhase(phase),
            onWordUpdate: (wordStatus) => panel.onWordUpdate(wordStatus),
            onError: (error) => panel.onError(error),
        });
    }

    /**
     * Walk the entry's noteInfos (any cardFormat — first hit wins) and parse
     * its `data` field. Returns `ClipStatus`-shaped objects synthesised from
     * the persisted records so the panel + modal can render them with the
     * same code path used for live polling. Returns `null` if no saved data
     * exists for this entry — the caller falls through to F1 collect.
     * @param {number} dictionaryEntryIndex
     * @returns {Promise<?import('anki-conf').ClipStatus[]>}
     */
    async _buildReplayClipsForEntry(dictionaryEntryIndex) {
        const details = this._dictionaryEntryDetails;
        if (details === null) {
            log.log('[video-examples] F2 replay skipped: _dictionaryEntryDetails is null (not loaded yet)');
            return null;
        }
        if (dictionaryEntryIndex < 0 || dictionaryEntryIndex >= details.length) {
            log.log(`[video-examples] F2 replay skipped: dictionaryEntryIndex=${dictionaryEntryIndex} out of range (len=${details.length})`);
            return null;
        }
        const entryDetails = details[dictionaryEntryIndex];
        if (typeof entryDetails === 'undefined' || typeof entryDetails.noteMap === 'undefined') {
            log.log(`[video-examples] F2 replay skipped: entryDetails[${dictionaryEntryIndex}] missing noteMap`);
            return null;
        }
        const mapSize = entryDetails.noteMap.size;
        log.log(`[video-examples] F2 replay scan: dictionaryEntryIndex=${dictionaryEntryIndex} noteMap.size=${mapSize} fieldName=${JSON.stringify(VIDEO_EXAMPLES_FIELD_NAME)}`);

        // Yomitan only fetches the full notesInfo (with field values) when
        // _isAdditionalInfoEnabled() is true — i.e. when tags/flags display is
        // on or duplicateBehavior=overwrite. Both default to off, so for most
        // users noteInfos is `[]` even though noteIds is populated. The F2
        // path needs the field values to read our `data` JSON, so we top up on
        // demand here: collect all noteIds across all cardFormats with empty
        // noteInfos and fetch them in a single batch.
        /** @type {number[]} */
        const noteIdsToFetch = [];
        /** @type {Set<number>} */
        const seen = new Set();
        for (const noteDetails of entryDetails.noteMap.values()) {
            // Skip only if we actually have a usable noteInfo. Yomitan can give
            // us a non-empty array where every entry is `null` (note found via
            // canAddNotes but the noteId went stale before notesInfo landed) —
            // that array passes the length check but contains no field data,
            // so we still need to top up via the lazy path.
            const ni = noteDetails.noteInfos;
            const hasUsable = Array.isArray(ni) && ni.some((n) => n !== null);
            if (hasUsable) { continue; }
            const ids = Array.isArray(noteDetails.noteIds) ? noteDetails.noteIds : [];
            for (const id of ids) {
                if (typeof id !== 'number' || id <= 0 || seen.has(id)) { continue; }
                seen.add(id);
                noteIdsToFetch.push(id);
            }
        }
        /** @type {Map<number, import('anki').NoteInfo>} */
        const lazyById = new Map();
        if (noteIdsToFetch.length > 0) {
            log.log(`[video-examples] F2 lazy notesInfo fetch: noteIds=${JSON.stringify(noteIdsToFetch)}`);
            try {
                const fetched = await this._display.application.api.getAnkiNotesInfoByIds(noteIdsToFetch);
                for (const ni of fetched) {
                    if (ni !== null && typeof ni.noteId === 'number') { lazyById.set(ni.noteId, ni); }
                }
                log.log(`[video-examples] F2 lazy notesInfo got ${lazyById.size} record(s)`);
            } catch (e) {
                log.log(`[video-examples] F2 lazy notesInfo FAILED: ${e instanceof Error ? e.message : String(e)}`);
            }
        }

        for (const [cardFormatIndex, noteDetails] of entryDetails.noteMap.entries()) {
            const modelName = noteDetails.note?.modelName ?? '(no note)';
            let noteInfos = noteDetails.noteInfos;
            // Top up from the lazy batch if Yomitan returned [].
            if ((!Array.isArray(noteInfos) || noteInfos.length === 0) && Array.isArray(noteDetails.noteIds) && noteDetails.noteIds.length > 0) {
                /** @type {import('anki').NoteInfo[]} */
                const lazyHits = [];
                for (const id of noteDetails.noteIds) {
                    const ni = lazyById.get(id);
                    if (typeof ni !== 'undefined') { lazyHits.push(ni); }
                }
                noteInfos = lazyHits;
            }
            if (!Array.isArray(noteInfos) || noteInfos.length === 0) {
                log.log(`[video-examples] F2 scan cf=${cardFormatIndex} model=${JSON.stringify(modelName)}: no noteInfos available (canAdd=${noteDetails.canAdd}, noteIds=${JSON.stringify(noteDetails.noteIds)}, ankiError=${noteDetails.ankiError?.message ?? 'none'})`);
                continue;
            }
            log.log(`[video-examples] F2 scan cf=${cardFormatIndex} model=${JSON.stringify(modelName)} noteInfos.length=${noteInfos.length}`);
            for (let ii = 0; ii < noteInfos.length; ii++) {
                const info = noteInfos[ii];
                if (info === null) {
                    log.log(`[video-examples] F2 scan cf=${cardFormatIndex} info[${ii}]=null (note not found — not yet saved?)`);
                    continue;
                }
                const fieldsObj = info.fields ?? {};
                const fieldKeys = Object.keys(fieldsObj);
                const actualKey = findFieldKeyCaseInsensitive(fieldsObj, VIDEO_EXAMPLES_FIELD_NAME);
                if (actualKey === null) {
                    log.log(`[video-examples] F2 scan cf=${cardFormatIndex} info[${ii}] noteId=${info.noteId} no "${VIDEO_EXAMPLES_FIELD_NAME}" field (case-insensitive). keys=${JSON.stringify(fieldKeys)}`);
                    continue;
                }
                const field = fieldsObj[actualKey];
                const rawValue = typeof field?.value === 'string' ? field.value : '';
                log.log(`[video-examples] F2 scan cf=${cardFormatIndex} info[${ii}] noteId=${info.noteId} found key=${JSON.stringify(actualKey)} len=${rawValue.length}`);
                const doc = parseVideosFromData(rawValue);
                if (doc === null) {
                    log.log(`[video-examples] F2 scan cf=${cardFormatIndex} info[${ii}]: parseVideosFromData returned null (wrong owner / bad json / not v=1). raw=${JSON.stringify(rawValue.slice(0, 200))}`);
                    continue;
                }
                if (doc.videos.length === 0) {
                    log.log(`[video-examples] F2 scan cf=${cardFormatIndex} info[${ii}]: doc parsed but videos.length=0`);
                    continue;
                }
                log.log(`[video-examples] F2 HIT cf=${cardFormatIndex} info[${ii}]: ${doc.videos.length} clip(s)`);
                return doc.videos.map((v, i) => {
                    /** @type {import('anki-conf').ClipStatus} */
                    const clip = {
                        clip_id: `replay:${v.cache_key}`,
                        order_index: i,
                        clip_url: this._buildClipsFileUrl(v.cache_key, 'mp4'),
                        subtitle_url: v.subtitle_text.length > 0 ? this._buildClipsFileUrl(v.cache_key, 'vtt') : null,
                        subtitle_text: v.subtitle_text,
                        duration_ms: v.duration_ms,
                        recut: v.recut,
                    };
                    if (typeof v.year === 'number') { clip.year = v.year; }
                    if (typeof v.cefr === 'string') { clip.cefr = v.cefr; }
                    if (typeof v.difficulty === 'number') { clip.difficulty = v.difficulty; }
                    return clip;
                });
            }
        }
        log.log(`[video-examples] F2 replay: no clips found for dictionaryEntryIndex=${dictionaryEntryIndex} after full scan`);
        return null;
    }

    /**
     * Proactive F2 mount. After dictionaryEntryDetails is populated, look for
     * any entry whose corresponding Anki notes carry a parseable `data` field
     * (our `_owner`-marked JSON) and mount a read-only replay panel for it —
     * no Ex click required. Skipped silently on every failure mode so an
     * unreachable Anki, missing field, or stale popup never throws.
     * @param {?import('core').TokenObject} token Token snapshot from the calling
     *   `_updateDictionaryEntryDetails` invocation. We bail at every async
     *   boundary if it no longer matches, so a popup re-render mid-fetch
     *   never mounts onto a now-detached entry.
     * @returns {Promise<void>}
     */
    async _tryAutoMountSavedExamples(token) {
        if (this._videoExamplesOrchestrator === null) { return; }
        const details = this._dictionaryEntryDetails;
        if (details === null) { return; }

        // Pass 1: collect every noteId across all entries that we don't yet
        // have a noteInfo for. Deduped — multiple cardFormats may point at
        // the same Anki noteId. Phrase entries land here too; they get filtered
        // later when we can't resolve them to a dictionaryEntry.
        /** @type {number[]} */
        const noteIdsToFetch = [];
        /** @type {Set<number>} */
        const seen = new Set();
        for (const entryDetails of details) {
            if (typeof entryDetails === 'undefined' || typeof entryDetails.noteMap === 'undefined') { continue; }
            for (const noteDetails of entryDetails.noteMap.values()) {
                // Match the `every === null` semantics used in
                // `_buildReplayClipsForEntry`: an array of nulls is not usable.
                const ni = noteDetails.noteInfos;
                const hasUsable = Array.isArray(ni) && ni.some((n) => n !== null);
                if (hasUsable) { continue; }
                const ids = Array.isArray(noteDetails.noteIds) ? noteDetails.noteIds : [];
                for (const id of ids) {
                    if (typeof id !== 'number' || id <= 0 || seen.has(id)) { continue; }
                    seen.add(id);
                    noteIdsToFetch.push(id);
                }
            }
        }
        if (noteIdsToFetch.length === 0) { return; }

        // Single batch lazy fetch. Yomitan default `_isAdditionalInfoEnabled`
        // gives us `noteInfos: []` for every duplicate, so almost always this
        // is where the work actually happens.
        /** @type {(import('anki').NoteInfo | null)[]} */
        let fetched;
        try {
            fetched = await this._display.application.api.getAnkiNotesInfoByIds(noteIdsToFetch);
        } catch (e) {
            log.log(`[video-examples] auto-mount lazy notesInfo failed: ${e instanceof Error ? e.message : String(e)}`);
            return;
        }
        if (this._updateDictionaryEntryDetailsToken !== token) { return; }
        if (this._dictionaryEntryDetails !== details) { return; }

        /** @type {Map<number, import('anki').NoteInfo>} */
        const byId = new Map();
        for (const ni of fetched) {
            if (ni !== null && typeof ni.noteId === 'number') { byId.set(ni.noteId, ni); }
        }
        if (byId.size === 0) { return; }

        // Pass 2: mount a replay panel per entry that has parseable videos.
        let mountedCount = 0;
        for (let i = 0; i < details.length; i++) {
            const entryDetails = details[i];
            if (typeof entryDetails === 'undefined' || typeof entryDetails.noteMap === 'undefined') { continue; }
            const entry = this._getEntry(i);
            if (entry === null) { continue; }
            // A popup re-render between iterations can leave entry detached from
            // the DOM — mounting onto it would create an orphan panel nobody
            // ever sees. Skip and move on; the next contentUpdateComplete will
            // re-fire auto-mount against the fresh entries.
            if (!entry.isConnected) { continue; }
            // Existing-panel policy mirrors `_showVideoExamplesForEntry`: a live
            // non-terminal panel (queued/polling/ready/replay) is left in place
            // — user-driven state outranks proactive UX. A terminal panel
            // (error/timeout/expired) is destroyed so we can show fresh data.
            const existing = this._videoExamplesPanels.get(entry);
            if (typeof existing !== 'undefined' && existing.root.isConnected) {
                if (!existing.isTerminal()) { continue; }
                this._videoExamplesPanels.delete(entry);
                this._hideVideoExamplesDensityToggleIfEmpty();
                existing.destroy();
            }

            /** @type {?import('../data/video-examples-data-field.js').VideoDataEntry[]} */
            let videos = null;
            for (const noteDetails of entryDetails.noteMap.values()) {
                const ids = Array.isArray(noteDetails.noteIds) ? noteDetails.noteIds : [];
                for (const id of ids) {
                    const ni = byId.get(id);
                    if (typeof ni === 'undefined' || ni === null) { continue; }
                    const fieldsObj = ni.fields ?? {};
                    const actualKey = findFieldKeyCaseInsensitive(fieldsObj, VIDEO_EXAMPLES_FIELD_NAME);
                    if (actualKey === null) { continue; }
                    const field = fieldsObj[actualKey];
                    const rawValue = typeof field?.value === 'string' ? field.value : '';
                    const doc = parseVideosFromData(rawValue);
                    if (doc !== null && doc.videos.length > 0) {
                        videos = doc.videos;
                        break;
                    }
                }
                if (videos !== null) { break; }
            }
            if (videos === null) { continue; }

            const dictionaryEntry = this._display.dictionaryEntries[i];
            let word = '';
            if (typeof dictionaryEntry !== 'undefined' && dictionaryEntry !== null) {
                if (dictionaryEntry.type === 'term' && dictionaryEntry.headwords.length > 0) {
                    word = dictionaryEntry.headwords[0].term;
                } else if (dictionaryEntry.type === 'kanji') {
                    word = dictionaryEntry.character;
                }
            }
            if (word.length === 0) { continue; }

            const dictionaryEntryIndex = i;
            const clips = videos.map((v, idx) => {
                /** @type {import('anki-conf').ClipStatus} */
                const clip = {
                    clip_id: `replay:${v.cache_key}`,
                    order_index: idx,
                    clip_url: this._buildClipsFileUrl(v.cache_key, 'mp4'),
                    subtitle_url: v.subtitle_text.length > 0 ? this._buildClipsFileUrl(v.cache_key, 'vtt') : null,
                    subtitle_text: v.subtitle_text,
                    duration_ms: v.duration_ms,
                    recut: v.recut,
                };
                if (typeof v.year === 'number') { clip.year = v.year; }
                if (typeof v.cefr === 'string') { clip.cefr = v.cefr; }
                if (typeof v.difficulty === 'number') { clip.difficulty = v.difficulty; }
                return clip;
            });

            log.log(`[video-examples] auto-mount REPLAY word=${JSON.stringify(word)} clips=${clips.length}`);
            const panel = new VideoExamplesPanel(entry, word, {
                onCancel: () => {
                    this._videoExamplesPanels.delete(entry);
                    this._hideVideoExamplesDensityToggleIfEmpty();
                    panel.destroy();
                },
                onRetry: () => {
                    this._videoExamplesPanels.delete(entry);
                    this._hideVideoExamplesDensityToggleIfEmpty();
                    panel.destroy();
                    void this._showVideoExamplesForEntry(entry, word, 'auto', dictionaryEntryIndex);
                },
                onClipOpen: (clip) => {
                    this._openVideoExamplesModal(clip);
                },
            }, {mode: 'replay', initialClips: clips, density: this._videoExamplesDensity});
            this._videoExamplesPanels.set(entry, panel);
            this._setVideoExamplesDragEnabled(true);
            mountedCount++;
        }

        // Density toggle + popup widen happen once after the mount loop
        // — both are DOM-touching side effects we don't want N times for N
        // panels, and we re-check the token in case a popup re-render landed
        // during the loop (resizing a frame whose Frontend just torn down is
        // wasted work even if .catch suppresses it).
        if (mountedCount > 0 && this._updateDictionaryEntryDetailsToken === token) {
            this._ensureVideoExamplesDensityToggle();
            void this._display.invokeContentOrigin('frontendEnsurePopupWidth', {minWidth: 820}).catch(() => {
                // Detached popup-window mode — silent ignore.
            });
            // Grow vertically too — see _showVideoExamplesForEntry rationale.
            void this._display.invokeContentOrigin('frontendEnsurePopupHeight', {minHeight: 900}).catch(() => {});
        }
    }

    /**
     * Density preference: persisted in localStorage so each Yomitan profile
     * keeps the user's last choice across page reloads.
     * @returns {'compact'|'large'}
     */
    _loadVideoExamplesDensity() {
        try {
            const stored = window.localStorage.getItem('yomitan-video-examples-density');
            if (stored === 'compact' || stored === 'large') { return stored; }
        } catch (e) {
            // localStorage unavailable — fall through to default
        }
        return 'compact';
    }

    /**
     * Persist + propagate density change to every open video-examples panel.
     * @param {'compact'|'large'} density
     */
    _setVideoExamplesDensity(density) {
        if (density !== 'compact' && density !== 'large') { return; }
        if (this._videoExamplesDensity === density) { return; }
        this._videoExamplesDensity = density;
        try {
            window.localStorage.setItem('yomitan-video-examples-density', density);
        } catch (e) {
            // localStorage unavailable — ignore
        }
        for (const panel of this._videoExamplesPanels.values()) {
            panel.setDensity(density);
        }
        this._updateVideoExamplesDensityToggleState();
    }

    /**
     * Lazily build the Large/Compact segmented toggle in the shared popup
     * toolbar (left of the CheckWords trigger). One toggle per popup, shown
     * only while at least one video-examples panel is open.
     */
    _ensureVideoExamplesDensityToggle() {
        if (this._videoExamplesDensityToggle !== null) {
            const slot = this._popupToolbarActionsContainer;
            if (slot !== null) { slot.hidden = false; }
            this._updatePopupToolbarVisibility();
            this._updateVideoExamplesDensityToggleState();
            return;
        }
        if (this._ensurePopupToolbar() === null) { return; }
        const slot = this._popupToolbarActionsContainer;
        if (slot === null) { return; }

        const toggle = document.createElement('div');
        toggle.className = 'popup-toolbar-density';
        toggle.setAttribute('role', 'group');
        toggle.setAttribute('aria-label', 'Clip density');

        for (const density of /** @type {const} */ (['large', 'compact'])) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'popup-toolbar-density-seg';
            button.dataset.density = density;
            button.textContent = density === 'compact' ? 'Compact' : 'Large';
            button.addEventListener('click', () => {
                this._setVideoExamplesDensity(density);
            });
            toggle.appendChild(button);
        }

        // Insert before the CheckWords trigger so density is left of Examples
        // button per the user's reference layout.
        slot.insertBefore(toggle, slot.firstChild);
        slot.hidden = false;
        this._videoExamplesDensityToggle = toggle;
        this._updateVideoExamplesDensityToggleState();
        this._updatePopupToolbarVisibility();
    }

    /**
     * Inject a slim drag handle along the top edge of the popup body. The
     * handle is transparent at rest, revealed on hover. `pointerdown` on it
     * forwards iframe-local mouse coords to the parent frame's
     * `frontendBeginPopupDrag`, which then owns the drag (sets iframe
     * `pointer-events: none`, listens for pointermove/pointerup on its own
     * window, updates iframe `top`/`left` directly).
     *
     * Visibility is gated by `<body data-video-examples-drag-enabled>` set
     * in `_setVideoExamplesDragEnabled` — only shown when at least one video
     * panel exists, so we don't add weird affordances to normal lookups.
     */
    _ensureVideoExamplesDragHandle() {
        if (typeof document === 'undefined') { return; }
        if (document.querySelector('.video-examples-drag-handle') !== null) { return; }
        const handle = document.createElement('div');
        handle.className = 'video-examples-drag-handle';
        handle.title = 'Drag to reposition';
        handle.setAttribute('aria-label', 'Drag to reposition popup');
        handle.addEventListener('pointerdown', (e) => {
            // Only main button — secondary opens context menu, etc.
            if (e.button !== 0) { return; }
            e.preventDefault();
            void this._display.invokeContentOrigin('frontendBeginPopupDrag', {
                pointerId: e.pointerId,
                clientX: e.clientX,
                clientY: e.clientY,
            }).catch(() => {
                // Popup-window mode (no embedded iframe) — drag not applicable.
            });
        });
        document.body.appendChild(handle);
    }

    /**
     * Toggle the body-level flag that controls drag-handle visibility.
     * @param {boolean} enabled
     */
    _setVideoExamplesDragEnabled(enabled) {
        if (typeof document === 'undefined') { return; }
        if (enabled) {
            document.body.dataset.videoExamplesDragEnabled = 'true';
        } else {
            delete document.body.dataset.videoExamplesDragEnabled;
        }
    }

    /** */
    _hideVideoExamplesDensityToggleIfEmpty() {
        if (this._videoExamplesPanels.size > 0) { return; }
        if (this._videoExamplesDensityToggle !== null) {
            this._videoExamplesDensityToggle.hidden = true;
        }
        // If actions slot only contains a hidden density toggle and no
        // CheckWords controller, collapse the actions container too.
        if (this._popupToolbarActionsContainer !== null && this._clipboardTestWordsPanel === null) {
            this._popupToolbarActionsContainer.hidden = true;
        }
        this._updatePopupToolbarVisibility();
        // No more video panels in this popup — return the iframe to its
        // pre-expansion size. Yomitan recomputes position from the source
        // word rect on every hover, so position naturally resets; only the
        // size needs explicit restoration.
        void this._display.invokeContentOrigin('frontendRestorePopupSize', void 0).catch(() => {
            // Popup-window mode or detached frontend — silent ignore.
        });
        // Hide the drag handle too — pointless affordance when there's no
        // video panel.
        this._setVideoExamplesDragEnabled(false);
    }

    /** */
    _updateVideoExamplesDensityToggleState() {
        if (this._videoExamplesDensityToggle === null) { return; }
        this._videoExamplesDensityToggle.hidden = false;
        for (const button of this._videoExamplesDensityToggle.querySelectorAll('button')) {
            const isOn = button.dataset.density === this._videoExamplesDensity;
            button.classList.toggle('is-on', isOn);
            button.setAttribute('aria-pressed', isOn ? 'true' : 'false');
        }
    }

    /**
     * @param {string} cacheKey
     * @param {'mp4'|'vtt'} ext
     * @returns {string}
     */
    _buildClipsFileUrl(cacheKey, ext) {
        const base = this._confServer.replace(/\/+$/, '');
        return `${base}/api/v1/lexicon/clips/file/${encodeURIComponent(cacheKey)}.${ext}`;
    }

    /**
     * @param {MouseEvent} e
     */
    _onShowTags(e) {
        e.preventDefault();
        const element = /** @type {HTMLElement} */ (e.currentTarget);
        const tags = element.title;
        this._showTagsNotification(tags);
    }

    /**
     * @param {MouseEvent} e
     */
    _onShowFlags(e) {
        e.preventDefault();
        const element = /** @type {HTMLElement} */ (e.currentTarget);
        const flags = element.title;
        this._showFlagsNotification(flags);
    }

    /**
     * @param {number} index
     * @param {number} cardFormatIndex
     * @returns {?HTMLButtonElement}
     */
    _createSaveButtons(index, cardFormatIndex) {
        const entry = this._getEntry(index);
        if (entry === null) { return null; }

        const container = entry.querySelector('.note-actions-container');
        if (container === null) { return null; }

        // Create button from template
        const singleNoteActionButtons = /** @type {HTMLElement} */ (this._display.displayGenerator.instantiateTemplate('action-button-container'));
        /** @type {HTMLButtonElement} */
        const saveButton = querySelectorNotNull(singleNoteActionButtons, '.action-button');
        /** @type {HTMLElement} */
        const iconSpan = querySelectorNotNull(saveButton, '.action-icon');
        // Set button properties
        const cardFormat = this._cardFormats[cardFormatIndex];
        singleNoteActionButtons.dataset.cardFormatIndex = cardFormatIndex.toString();
        saveButton.title = `Add ${cardFormat.name} note`;
        saveButton.dataset.cardFormatIndex = cardFormatIndex.toString();
        iconSpan.dataset.icon = cardFormat.icon;

        const saveButtonIndex = container.children.length;
        if ([0, 1].includes(saveButtonIndex)) {
            saveButton.dataset.hotkey = `["addNote${saveButtonIndex + 1}","title","Add ${cardFormat.name} note"]`;
            // eslint-disable-next-line no-underscore-dangle
            this._display._hotkeyHelpController.setHotkeyLabel(saveButton, `Add ${cardFormat.name} note ({0})`);
        } else {
            delete saveButton.dataset.hotkey;
        }
        // Add event listeners
        this._eventListeners.addEventListener(saveButton, 'click', this._onNoteSaveBind);

        // Add button to container
        container.appendChild(singleNoteActionButtons);

        return saveButton;
    }


    /**
     * @param {number} index
     * @returns {?HTMLElement}
     */
    _getEntry(index) {
        const entries = this._display.dictionaryEntryNodes;
        return index >= 0 && index < entries.length ? entries[index] : null;
    }

    /**
     * @returns {?import('anki-templates-internal').Context}
     */
    _getNoteContext() {
        const {state} = this._display.history;
        let documentTitle, url, sentence;
        if (typeof state === 'object' && state !== null) {
            ({documentTitle, url, sentence} = state);
        }
        if (typeof documentTitle !== 'string') {
            documentTitle = document.title;
        }
        if (typeof url !== 'string') {
            url = window.location.href;
        }
        const {query, fullQuery, queryOffset} = this._display;
        sentence = this._getValidSentenceData(sentence, fullQuery, queryOffset);
        return {
            url,
            sentence,
            documentTitle,
            query,
            fullQuery,
        };
    }

    /** */
    async _updateDictionaryEntryDetails() {
        if (!this._display.getOptions()?.anki.enable) { return; }
        const {dictionaryEntries} = this._display;
        /** @type {?import('core').TokenObject} */
        const token = {};
        this._updateDictionaryEntryDetailsToken = token;
        if (this._updateSaveButtonsPromise !== null) {
            await this._updateSaveButtonsPromise;
        }
        if (this._updateDictionaryEntryDetailsToken !== token) { return; }

        const {promise, resolve} = /** @type {import('core').DeferredPromiseDetails<void>} */ (deferPromise());
        try {
            this._updateSaveButtonsPromise = promise;
            const dictionaryEntryDetails = await this._getDictionaryEntryDetails(dictionaryEntries);
            if (this._updateDictionaryEntryDetailsToken !== token) { return; }
            this._dictionaryEntryDetails = dictionaryEntryDetails;
            this._updateSaveButtons(dictionaryEntryDetails);
            // eslint-disable-next-line no-underscore-dangle
            this._display._hotkeyHelpController.setupNode(document.documentElement);
            // Fire-and-forget: for any entry whose word already lives in Anki
            // with a parseable `data` payload, auto-mount the F2 replay panel
            // so the user sees their saved clips without having to click Ex.
            // The token guards against a popup re-render landing mid-fetch.
            this._tryAutoMountSavedExamples(token).catch((error) => {
                log.error(new Error(`[video-examples] auto-mount failed: ${error instanceof Error ? error.message : String(error)}`));
            });
        } finally {
            resolve();
            if (this._updateSaveButtonsPromise === promise) {
                this._updateSaveButtonsPromise = null;
            }
        }
    }

    /** */
    async _updatePhraseEntryDetails() {
        if (!this._display.getOptions()?.anki.enable) { return; }

        const phraseText = this._display.query;
        if (!phraseText) { return; }

        const cardFormatIndex = this._cardFormats.findIndex((cardFormat) => cardFormat.type === 'term');
        if (cardFormatIndex < 0) { return; }
        const cardFormat = this._cardFormats[cardFormatIndex];

        const entry = this._getEntry(0);
        if (entry === null) { return; }

        const container = entry.querySelector('.note-actions-container');
        if (container === null) { return; }

        const singleNoteActionButtons = /** @type {HTMLElement} */ (this._display.displayGenerator.instantiateTemplate('action-button-container'));
        /** @type {HTMLButtonElement} */
        const saveButton = querySelectorNotNull(singleNoteActionButtons, '.action-button');
        /** @type {HTMLElement} */
        const iconSpan = querySelectorNotNull(saveButton, '.action-icon');

        singleNoteActionButtons.dataset.cardFormatIndex = cardFormatIndex.toString();
        saveButton.title = `Add phrase as ${cardFormat.name} note`;
        saveButton.dataset.cardFormatIndex = cardFormatIndex.toString();
        iconSpan.dataset.icon = cardFormat.icon;

        this._eventListeners.addEventListener(saveButton, 'click', (/** @type {Event} */ e) => {
            e.preventDefault();
            void this._savePhraseNote(cardFormatIndex);
        });

        container.appendChild(singleNoteActionButtons);

        /** @type {HTMLTextAreaElement | null} */
        const expressionInput = entry.querySelector('.phrase-expression-input');
        if (expressionInput !== null) {
            this._eventListeners.addEventListener(expressionInput, 'input', () => {
                // Invalidate any in-flight on-open detection so its late result
                // can't flip the button back to view-note for the pre-edit text.
                this._updatePhraseEntryDetailsToken = null;
                this._setPhraseButtonState(cardFormatIndex, null);
            });
        }

        const testWordsSlot = entry.querySelector('.phrase-test-words-slot');
        if (testWordsSlot instanceof HTMLElement) {
            const controller = new TestWordsController({
                display: this._display,
                hostElement: testWordsSlot,
                getTextSource: () => (expressionInput !== null ? expressionInput.value : this._display.query),
                triggerLabel: 'Test words',
                modalTitle: 'Mark words you know (phrase)',
            });
            controller.render();
        }

        this._setupPhraseSplitter(entry);

        /** @type {?import('core').TokenObject} */
        const token = {};
        this._updatePhraseEntryDetailsToken = token;

        let isConnected = false;
        try {
            isConnected = await this._display.application.api.isAnkiConnected();
        } catch (e) {
            isConnected = false;
        }
        if (this._updatePhraseEntryDetailsToken !== token) { return; }

        if (!isConnected) {
            saveButton.disabled = true;
            saveButton.hidden = true;
            return;
        }

        const note = this._buildPhraseNote(cardFormatIndex, phraseText, '');
        if (note === null || !isNoteDataValid(note)) {
            saveButton.disabled = true;
            return;
        }

        try {
            const infos = await this._display.application.api.getAnkiNoteInfo([note], false);
            if (this._updatePhraseEntryDetailsToken !== token) { return; }
            const noteIds = infos.length > 0 ? infos[0].noteIds : null;
            this._setPhraseButtonState(cardFormatIndex, noteIds);
        } catch (e) {
            // Detection is best-effort; leave the button in its default add state.
        }
    }

    /**
     * Build a phrase note from the chosen card format and the popup's text inputs.
     * Single source of the phrase-note shape, used both to add the note and to
     * detect a pre-existing duplicate on open.
     * @param {number} cardFormatIndex
     * @param {string} phraseText
     * @param {string} translateText
     * @returns {?import('anki').Note}
     */
    _buildPhraseNote(cardFormatIndex, phraseText, translateText) {
        const cardFormat = this._cardFormats[cardFormatIndex];
        if (!cardFormat) { return null; }
        const {deck: deckName, model: modelName, fields: fieldsSettings} = cardFormat;
        const noteFields = createPhraseNoteFields(fieldsSettings, phraseText, translateText);
        return {
            fields: noteFields,
            tags: [...this._noteTags],
            deckName,
            modelName,
            options: {
                allowDuplicate: true,
                duplicateScope: this._duplicateScope,
                duplicateScopeOptions: {
                    deckName: null,
                    checkChildren: false,
                    checkAllModels: this._duplicateScopeCheckAllModels,
                },
            },
        };
    }

    /**
     * Flip the phrase popup's single action slot between add ("+") and view-note.
     * Passing valid note ids → show the view-note button and hide "+";
     * passing null/empty → hide and clear the view-note button and show "+".
     * @param {number} cardFormatIndex
     * @param {?number[]} noteIds
     */
    _setPhraseButtonState(cardFormatIndex, noteIds) {
        const saveButton = this._saveButtonFind(0, cardFormatIndex);
        const validIds = Array.isArray(noteIds) ? noteIds.filter((id) => id !== INVALID_NOTE_ID) : [];
        if (validIds.length > 0) {
            this._updateViewNoteButton(0, cardFormatIndex, validIds);
            if (saveButton !== null) { saveButton.hidden = true; }
        } else {
            const entry = this._getEntry(0);
            const viewNoteButton = entry === null ?
                null :
                /** @type {HTMLButtonElement | null} */ (entry.querySelector(`[data-card-format-index="${cardFormatIndex}"] .action-button[data-action=view-note]`));
            if (viewNoteButton !== null) {
                viewNoteButton.dataset.noteIds = '';
                viewNoteButton.hidden = true;
            }
            if (saveButton !== null) { saveButton.hidden = false; }
        }
    }

    /**
     * @param {number} cardFormatIndex
     */
    async _savePhraseNote(cardFormatIndex) {
        const entry = this._getEntry(0);
        if (entry === null) { return; }

        /** @type {HTMLTextAreaElement | null} */
        const expressionInput = entry.querySelector('.phrase-expression-input');
        /** @type {HTMLTextAreaElement | null} */
        const translateInput = entry.querySelector('.phrase-translate-input');

        const phraseText = expressionInput !== null ? expressionInput.value.trim() : this._display.query;
        const translateText = translateInput !== null ? translateInput.value.trim() : '';

        if (!phraseText) { return; }

        const note = this._buildPhraseNote(cardFormatIndex, phraseText, translateText);
        if (note === null) { return; }

        this._applyExtraTagsToNote(note);

        /** @type {Error[]} */
        const allErrors = [];
        const progressIndicatorVisible = this._display.progressIndicatorVisible;
        const overrideToken = progressIndicatorVisible.setOverride(true);

        try {
            const noteId = await this._display.application.api.addAnkiNote(note);
            if (noteId === null) {
                allErrors.push(new Error('Note could not be added'));
            } else {
                this._setPhraseButtonState(cardFormatIndex, [noteId]);
            }
        } catch (e) {
            allErrors.push(toError(e));
        } finally {
            progressIndicatorVisible.clearOverride(overrideToken);
        }

        if (allErrors.length > 0) {
            this._showErrorNotification(allErrors);
        } else {
            this._hideErrorNotification(true);
        }
    }

    /**
     * Returns the auto-tags computed from the current host URL plus all toggle tags
     * currently pressed in the user-tag bar. Used by every Anki add/update path.
     * @returns {string[]}
     */
    _collectExtraTags() {
        /** @type {string[]} */
        const result = [];
        const url = this._display.getOptionsContext().url;
        if (typeof url === 'string' && url.length > 0) {
            for (const tag of computeAutoTags(url)) { result.push(tag); }
        }
        for (const tag of this._activeUserTags) { result.push(tag); }
        return result;
    }

    /**
     * Merge `_collectExtraTags()` into `note.tags`, deduping.
     * @param {import('anki').Note} note
     */
    _applyExtraTagsToNote(note) {
        const extras = this._collectExtraTags();
        if (extras.length === 0) { return; }
        const existing = Array.isArray(note.tags) ? note.tags : [];
        const merged = [...existing];
        for (const tag of extras) {
            if (!merged.includes(tag)) { merged.push(tag); }
        }
        note.tags = merged;
    }

    /**
     * Single shared toolbar above #dictionary-entries with two slots:
     *   .popup-toolbar-tags    — user-tag toggles (left)
     *   .popup-toolbar-actions — CheckWords trigger + count (right)
     * Each half hides independently; the toolbar itself collapses when both
     * halves are empty/inactive so it never shows as a hollow border.
     * @returns {?HTMLElement}
     */
    _ensurePopupToolbar() {
        if (this._popupToolbar !== null) { return this._popupToolbar; }
        const entries = document.getElementById('dictionary-entries');
        if (entries === null) { return null; }

        const bar = document.createElement('div');
        bar.className = 'popup-toolbar';
        bar.hidden = true;

        const tagsContainer = document.createElement('div');
        tagsContainer.className = 'popup-toolbar-tags';
        tagsContainer.hidden = true;

        const actionsContainer = document.createElement('div');
        actionsContainer.className = 'popup-toolbar-actions';
        actionsContainer.hidden = true;

        bar.appendChild(tagsContainer);
        bar.appendChild(actionsContainer);

        const parent = entries.parentElement;
        if (parent !== null) { parent.insertBefore(bar, entries); }

        this._popupToolbar = bar;
        this._popupToolbarTagsContainer = tagsContainer;
        this._popupToolbarActionsContainer = actionsContainer;
        return bar;
    }

    /**
     * Route the user-tag toggles into the right slot for the current content
     * mode and (re)render them there. Phrase entries get their own
     * `.phrase-toolbar-tags` slot inside the phrase toolbar — so tags share a
     * single row with the Test-Words button and the Anki "+" action. All
     * other content modes use the shared `.popup-toolbar-tags` slot above
     * #dictionary-entries.
     */
    _renderUserTagToggleBar() {
        const inPhrase = (this._display.contentType === 'phrase');

        let phraseTagsSlot = null;
        if (inPhrase) {
            const phraseEntry = this._getEntry(0);
            const candidate = phraseEntry !== null ? phraseEntry.querySelector('.phrase-toolbar-tags') : null;
            if (candidate instanceof HTMLElement) { phraseTagsSlot = candidate; }
        }

        // Ensure the shared toolbar exists for non-phrase modes (and so the
        // visibility helper has something to inspect).
        this._ensurePopupToolbar();
        const popupTagsSlot = this._popupToolbarTagsContainer;

        // Clear whichever slot we are NOT using this time so leftover chips
        // from the previous content type don't linger.
        const inactive = inPhrase ? popupTagsSlot : phraseTagsSlot;
        if (inactive instanceof HTMLElement) {
            inactive.replaceChildren();
            inactive.hidden = true;
        }

        const target = inPhrase ? phraseTagsSlot : popupTagsSlot;
        if (!(target instanceof HTMLElement)) {
            this._updatePopupToolbarVisibility();
            return;
        }

        target.replaceChildren();
        if (this._userTags.length === 0) {
            target.hidden = true;
            this._updatePopupToolbarVisibility();
            return;
        }

        for (const tag of this._userTags) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'user-tag-toggle';
            button.textContent = tag;
            button.dataset.tag = tag;
            const active = this._activeUserTags.has(tag);
            button.setAttribute('aria-pressed', active ? 'true' : 'false');
            if (active) { button.classList.add('active'); }
            button.addEventListener('click', () => {
                if (this._activeUserTags.has(tag)) {
                    this._activeUserTags.delete(tag);
                    button.setAttribute('aria-pressed', 'false');
                    button.classList.remove('active');
                } else {
                    this._activeUserTags.add(tag);
                    button.setAttribute('aria-pressed', 'true');
                    button.classList.add('active');
                }
            });
            target.appendChild(button);
        }
        target.hidden = false;
        this._updatePopupToolbarVisibility();
    }

    /** Populate (once) the actions slot of the shared toolbar with CheckWords. */
    _renderClipboardTestWordsBar() {
        if (this._clipboardTestWordsPanel !== null) { return; }
        if (this._ensurePopupToolbar() === null) { return; }
        const actions = this._popupToolbarActionsContainer;
        if (actions === null) { return; }

        const controller = new TestWordsController({
            display: this._display,
            hostElement: actions,
            getTextSource: async () => {
                let text = '';
                try {
                    text = await this._display.application.api.clipboardGet();
                } catch (e) {
                    log.error(e);
                    text = '';
                }
                if (typeof text !== 'string') { return ''; }
                if (text.length > 1000) { text = text.slice(0, 1000); }
                return text;
            },
            triggerLabel: 'CheckWords',
            triggerTitle: 'Check the clipboard for new words',
            modalTitle: 'Mark words you know (clipboard)',
        });
        controller.render();
        this._clipboardTestWordsPanel = controller;
    }

    /** Show the CheckWords slot only for term/kanji content (not phrase / unloaded). */
    _updateClipboardBarVisibility() {
        if (this._popupToolbarActionsContainer === null) { return; }
        const type = this._display.contentType;
        this._popupToolbarActionsContainer.hidden = !(type === 'terms' || type === 'kanji');
        this._updatePopupToolbarVisibility();
    }

    /** Hide the whole toolbar when both halves are inactive. */
    _updatePopupToolbarVisibility() {
        if (this._popupToolbar === null) { return; }
        const tagsHidden = this._popupToolbarTagsContainer === null || this._popupToolbarTagsContainer.hidden;
        const actionsHidden = this._popupToolbarActionsContainer === null || this._popupToolbarActionsContainer.hidden;
        this._popupToolbar.hidden = tagsHidden && actionsHidden;
    }

    /**
     * Wire mouse/touch drag on the splitter inside a phrase entry. Ratio is
     * persisted across sessions in localStorage so the user's preferred split
     * sticks per browser profile.
     * @param {HTMLElement} entry
     */
    _setupPhraseSplitter(entry) {
        const split = entry.querySelector('.phrase-split');
        const left = entry.querySelector('.phrase-pane-left');
        const splitter = entry.querySelector('.phrase-splitter');
        if (!(split instanceof HTMLElement) || !(left instanceof HTMLElement) || !(splitter instanceof HTMLElement)) { return; }

        const storageKey = 'yomitan-phrase-split-ratio';
        const clamp = (/** @type {number} */ v) => Math.max(0.15, Math.min(0.85, v));
        let storedRatio = 0.5;
        try {
            const raw = window.localStorage.getItem(storageKey);
            if (raw !== null) {
                const parsed = Number.parseFloat(raw);
                if (Number.isFinite(parsed)) { storedRatio = clamp(parsed); }
            }
        } catch (e) {
            // localStorage unavailable — fall through to default
        }
        left.style.flex = `0 0 ${(storedRatio * 100).toFixed(2)}%`;

        const onPointerMove = (/** @type {PointerEvent} */ ev) => {
            const rect = split.getBoundingClientRect();
            if (rect.width <= 0) { return; }
            const ratio = clamp((ev.clientX - rect.left) / rect.width);
            left.style.flex = `0 0 ${(ratio * 100).toFixed(2)}%`;
        };
        const onPointerUp = (/** @type {PointerEvent} */ ev) => {
            splitter.removeEventListener('pointermove', onPointerMove);
            splitter.removeEventListener('pointerup', onPointerUp);
            splitter.removeEventListener('pointercancel', onPointerUp);
            splitter.classList.remove('dragging');
            if (splitter.hasPointerCapture(ev.pointerId)) {
                splitter.releasePointerCapture(ev.pointerId);
            }
            const rect = split.getBoundingClientRect();
            if (rect.width > 0) {
                const ratio = clamp((ev.clientX - rect.left) / rect.width);
                try {
                    window.localStorage.setItem(storageKey, ratio.toFixed(4));
                } catch (e) {
                    // ignore quota / privacy errors
                }
            }
        };
        splitter.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            splitter.setPointerCapture(ev.pointerId);
            splitter.classList.add('dragging');
            splitter.addEventListener('pointermove', onPointerMove);
            splitter.addEventListener('pointerup', onPointerUp);
            splitter.addEventListener('pointercancel', onPointerUp);
        });
    }

    /**
     * @param {HTMLButtonElement} button
     * @param {number[]} noteIds
     * @throws {Error}
     */
    _updateSaveButtonForDuplicateBehavior(button, noteIds) {
        const behavior = this._duplicateBehavior;
        if (behavior === 'prevent') {
            button.disabled = true;
            button.title = 'Duplicate notes are disabled';

            return;
        }

        const cardFormatIndex = button.dataset.cardFormatIndex;
        if (typeof cardFormatIndex === 'undefined') { throw new Error('Invalid note options index'); }
        const cardFormatIndexNumber = Number.parseInt(cardFormatIndex, 10);
        if (Number.isNaN(cardFormatIndexNumber)) { throw new Error('Invalid note options index'); }
        const cardFormat = this._cardFormats[cardFormatIndexNumber];

        const verb = behavior === 'overwrite' ? 'Overwrite' : 'Add duplicate';
        const iconPrefix = behavior === 'overwrite' ? 'overwrite' : 'add-duplicate';
        const target = `${cardFormat.name} note`;

        if (behavior === 'overwrite') {
            button.dataset.overwrite = 'true';
            if (!noteIds.some((id) => id !== INVALID_NOTE_ID)) {
                button.disabled = true;
            }
        } else {
            delete button.dataset.overwrite;
        }

        const title = `${verb} ${target}`;
        button.setAttribute('title', title);

        // eslint-disable-next-line no-underscore-dangle
        const hotkeyLabel = this._display._hotkeyHelpController.getHotkeyLabel(button);
        if (hotkeyLabel) {
            // eslint-disable-next-line no-underscore-dangle
            this._display._hotkeyHelpController.setHotkeyLabel(button, `${title} ({0})`); // {0} is a placeholder that gets replaced with the actual hotkey combination. For example, "Add expression (Ctrl+1)" or "Overwrite reading (Ctrl+2)"
        }

        const actionIcon = button.querySelector('.action-icon');
        if (actionIcon instanceof HTMLElement) {
            actionIcon.dataset.icon = `${iconPrefix}-${cardFormat.icon}`;
        }
    }

    /**
     * @param {import('display-anki').DictionaryEntryDetails[]} dictionaryEntryDetails
     */
    _updateSaveButtons(dictionaryEntryDetails) {
        const displayTagsAndFlags = this._displayTagsAndFlags;
        for (let entryIndex = 0, entryCount = dictionaryEntryDetails.length; entryIndex < entryCount; ++entryIndex) {
            for (const [cardFormatIndex, {canAdd, noteIds, noteInfos, ankiError}] of dictionaryEntryDetails[entryIndex].noteMap.entries()) {
                const button = this._createSaveButtons(entryIndex, cardFormatIndex);
                if (button !== null) {
                    button.disabled = !canAdd;
                    button.hidden = (ankiError !== null);
                    if (ankiError && ankiError.message !== 'Anki not connected') {
                        log.error(ankiError);
                    }

                    // If entry has noteIds, show the "add duplicate" button.
                    if (Array.isArray(noteIds) && noteIds.length > 0) {
                        this._updateSaveButtonForDuplicateBehavior(button, noteIds);
                    }
                }

                const validNoteIds = noteIds?.filter((id) => id !== INVALID_NOTE_ID) ?? [];

                this._createViewNoteButton(entryIndex, cardFormatIndex, validNoteIds, Array.isArray(noteInfos) ? noteInfos : []);

                if (displayTagsAndFlags !== 'never' && Array.isArray(noteInfos)) {
                    this._setupTagsIndicator(entryIndex, cardFormatIndex, noteInfos);
                    this._setupFlagsIndicator(entryIndex, cardFormatIndex, noteInfos);
                }
            }
        }
    }

    /**
     * @param {number} i
     * @param {number} cardFormatIndex
     * @param {(?import('anki').NoteInfo)[]} noteInfos
     */
    _setupTagsIndicator(i, cardFormatIndex, noteInfos) {
        const entry = this._getEntry(i);
        if (entry === null) { return; }

        const container = entry.querySelector(`[data-card-format-index="${cardFormatIndex}"]`);
        if (container === null) { return; }

        const tagsIndicator = /** @type {HTMLButtonElement} */ (this._display.displayGenerator.instantiateTemplate('note-action-button-view-tags'));
        if (tagsIndicator === null) { return; }

        const displayTags = new Set();
        for (const item of noteInfos) {
            if (item === null) { continue; }
            for (const tag of item.tags) {
                displayTags.add(tag);
            }
        }
        if (this._displayTagsAndFlags === 'non-standard') {
            for (const tag of this._noteTags) {
                displayTags.delete(tag);
            }
        } else if (this._displayTagsAndFlags === 'custom') {
            const tagsToRemove = [];
            for (const tag of displayTags) {
                if (typeof tag === 'string' && !this._targetTags.includes(tag)) {
                    tagsToRemove.push(tag);
                }
            }
            for (const tag of tagsToRemove) {
                displayTags.delete(tag);
            }
        }

        if (displayTags.size > 0) {
            tagsIndicator.disabled = false;
            tagsIndicator.hidden = false;
            tagsIndicator.title = `Card tags: ${[...displayTags].join(', ')}`;
            tagsIndicator.addEventListener('click', this._onShowTagsBind);
            container.appendChild(tagsIndicator);
        }
    }

    /**
     * @param {number} i
     * @param {number} cardFormatIndex
     * @param {(?import('anki').NoteInfo)[]} noteInfos
     */
    _setupFlagsIndicator(i, cardFormatIndex, noteInfos) {
        const entry = this._getEntry(i);
        if (entry === null) { return; }

        const container = entry.querySelector(`[data-card-format-index="${cardFormatIndex}"]`);
        if (container === null) { return; }

        const flagsIndicator = /** @type {HTMLButtonElement} */ (this._display.displayGenerator.instantiateTemplate('note-action-button-view-flags'));
        if (flagsIndicator === null) { return; }

        /** @type {Set<string>} */
        const displayFlags = new Set();
        for (const item of noteInfos) {
            if (item === null) { continue; }
            for (const cardInfo of item.cardsInfo) {
                if (cardInfo.flags !== 0) {
                    displayFlags.add(this._getFlagName(cardInfo.flags));
                }
            }
        }

        if (displayFlags.size > 0) {
            flagsIndicator.disabled = false;
            flagsIndicator.hidden = false;
            flagsIndicator.title = `Card flags: ${[...displayFlags].join(', ')}`;
            /** @type {HTMLElement | null} */
            const flagsIndicatorIcon = flagsIndicator.querySelector('.action-icon');
            if (flagsIndicatorIcon !== null && flagsIndicator instanceof HTMLElement) {
                flagsIndicatorIcon.style.background = this._getFlagColor(displayFlags);
            }
            flagsIndicator.addEventListener('click', this._onShowFlagsBind);
            container.appendChild(flagsIndicator);
        }
    }

    /**
     * @param {string} message
     */
    _showTagsNotification(message) {
        if (this._tagsNotification === null) {
            this._tagsNotification = this._display.createNotification(true);
        }

        this._tagsNotification.setContent(message);
        this._tagsNotification.open();
    }

    /**
     * @param {string} message
     */
    _showFlagsNotification(message) {
        if (this._flagsNotification === null) {
            this._flagsNotification = this._display.createNotification(true);
        }

        this._flagsNotification.setContent(message);
        this._flagsNotification.open();
    }

    /**
     * @param {unknown} cardFormatStringIndex
     */
    _hotkeySaveAnkiNoteForSelectedEntry(cardFormatStringIndex) {
        if (typeof cardFormatStringIndex !== 'string') { return; }
        const cardFormatIndex = Number.parseInt(cardFormatStringIndex, 10);
        if (Number.isNaN(cardFormatIndex)) { return; }
        const index = this._display.selectedIndex;
        const entry = this._getEntry(index);
        if (entry === null) { return; }
        const container = entry.querySelector('.note-actions-container');
        if (container === null) { return; }
        /** @type {HTMLButtonElement | null} */
        const nthButton = container.querySelector(`.action-button[data-action=save-note][data-card-format-index="${cardFormatIndex}"]`);
        if (nthButton === null) { return; }
        void this._saveAnkiNote(index, cardFormatIndex);
    }

    /**
     * @param {number} dictionaryEntryIndex
     * @param {number} cardFormatIndex
     */
    async _saveAnkiNote(dictionaryEntryIndex, cardFormatIndex) {
        const dictionaryEntries = this._display.dictionaryEntries;
        const dictionaryEntryDetails = this._dictionaryEntryDetails;
        if (!(
            dictionaryEntryDetails !== null &&
            dictionaryEntryIndex >= 0 &&
            dictionaryEntryIndex < dictionaryEntries.length &&
            dictionaryEntryIndex < dictionaryEntryDetails.length
        )) {
            return;
        }
        const dictionaryEntry = dictionaryEntries[dictionaryEntryIndex];
        const details = dictionaryEntryDetails[dictionaryEntryIndex].noteMap.get(cardFormatIndex);
        if (typeof details === 'undefined') { return; }

        const {requirements} = details;

        const button = this._saveButtonFind(dictionaryEntryIndex, cardFormatIndex);
        if (button === null || button.disabled) { return; }

        /** @type {Error[]} */
        const allErrors = [];

        button.disabled = true;
        setTimeout(() => {
            if (this._duplicateBehavior !== 'prevent' || allErrors.length > 0) {
                button.disabled = false;
            }
        }, 2500);

        this._hideErrorNotification(true);

        const progressIndicatorVisible = this._display.progressIndicatorVisible;
        const overrideToken = progressIndicatorVisible.setOverride(true);
        try {
            const {note, errors, requirements: outputRequirements} = await this._createNote(dictionaryEntry, cardFormatIndex, requirements);
            allErrors.push(...errors);

            const error = this._getAddNoteRequirementsError(requirements, outputRequirements);
            if (error !== null) { allErrors.push(error); }
            this._applyExtraTagsToNote(note);
            const entry = this._getEntry(dictionaryEntryIndex);
            if (entry !== null) {
                const dataFieldError = await this._applySelectedClipsToNote(note, entry);
                if (dataFieldError !== null) {
                    allErrors.push(dataFieldError);
                    return;
                }
            }
            if (button.dataset.overwrite) {
                const overwrittenNote = await this._getOverwrittenNote(note, dictionaryEntryIndex, cardFormatIndex);
                if (overwrittenNote !== null) { this._applyExtraTagsToNote(overwrittenNote); }
                await this._updateAnkiNote(overwrittenNote, allErrors);
            } else {
                await this._addNewAnkiNote(note, allErrors, button, dictionaryEntryIndex);
            }
        } catch (e) {
            allErrors.push(toError(e));
        } finally {
            progressIndicatorVisible.clearOverride(overrideToken);
        }

        if (allErrors.length > 0) {
            this._showErrorNotification(allErrors);
        } else {
            this._hideErrorNotification(true);
        }
    }

    /**
     * Bridge between the video-examples panel selection and the Anki note we're
     * about to save. Returns:
     *   - `null` when there's nothing to do (no panel for this entry, no
     *     selections, or feature disabled) — caller proceeds normally.
     *   - `Error` when persist failed in a way that should BLOCK the save
     *     (expired job, network down, no clips persisted at all).
     *
     * On success, writes the canonical JSON document into
     * `note.fields.data` — which is the field bootstrapped by P1.
     * @param {import('anki').Note} note
     * @param {HTMLElement} entry
     * @returns {Promise<?Error>}
     */
    async _applySelectedClipsToNote(note, entry) {
        const panel = this._videoExamplesPanels.get(entry);
        if (typeof panel === 'undefined') { return null; }
        const selectedClipIds = panel.getSelectedClipIds();
        if (selectedClipIds.length === 0) { return null; }

        const orchestrator = this._videoExamplesOrchestrator;
        if (orchestrator === null) { return null; }

        const jobId = orchestrator.getJobIdForEntry(entry);
        if (jobId === null) {
            return new Error('Video examples session is no longer available — click Ex to refresh.');
        }

        let persistResult;
        try {
            persistResult = await this._display.application.api.lexiconClipsPersist({
                job_id: jobId,
                clips: selectedClipIds.map((id) => ({clip_id: id})),
            });
        } catch (e) {
            if (e instanceof ExtensionError) {
                const data = /** @type {{status?: unknown}} */ (e.data);
                if (typeof data === 'object' && data !== null && data.status === 404) {
                    return new Error('Video examples session expired — click Ex again to refresh and re-select.');
                }
            }
            return e instanceof Error ? e : new Error(`Couldn't persist video examples: ${String(e)}`);
        }

        if (!Array.isArray(persistResult.persisted) || persistResult.persisted.length === 0) {
            const reasons = Array.isArray(persistResult.failed) ?
                persistResult.failed.map((f) => `${f.clip_id}: ${f.error}`).join('; ') :
                '';
            return new Error(`Couldn't save video examples — ${reasons.length > 0 ? reasons : 'no clips persisted'}.`);
        }

        note.fields[VIDEO_EXAMPLES_FIELD_NAME] = serializeVideosForData(persistResult.persisted, {
            serverOrigin: this._confServer,
            nowIso: new Date().toISOString(),
        });

        if (Array.isArray(persistResult.failed) && persistResult.failed.length > 0) {
            log.warn(new Error(`[video-examples] ${persistResult.failed.length} clip(s) failed to persist: ${persistResult.failed.map((f) => f.error).join(', ')}`));
        }

        return null;
    }

    /**
     * @param {number} dictionaryEntryIndex
     * @param {number} cardFormatIndex
     * @returns {?HTMLButtonElement}
     */
    _saveButtonFind(dictionaryEntryIndex, cardFormatIndex) {
        const entry = this._getEntry(dictionaryEntryIndex);
        if (entry === null) { return null; }
        const container = entry.querySelector('.note-actions-container');
        if (container === null) { return null; }
        const singleNoteActionButtonContainer = container.querySelector(`[data-card-format-index="${cardFormatIndex}"]`);
        if (singleNoteActionButtonContainer === null) { return null; }
        return singleNoteActionButtonContainer.querySelector('.action-button[data-action=save-note]');
    }

    /**
     * @param {import('anki').Note} note
     * @param {number} dictionaryEntryIndex
     * @param {number} cardFormatIndex
     * @returns {Promise<import('anki').NoteWithId | null>}
     */
    async _getOverwrittenNote(note, dictionaryEntryIndex, cardFormatIndex) {
        const dictionaryEntries = this._display.dictionaryEntries;
        const allEntryDetails = await this._getDictionaryEntryDetails(dictionaryEntries);
        const relevantEntryDetails = allEntryDetails[dictionaryEntryIndex];
        const relevantNoteDetails = relevantEntryDetails.noteMap.get(cardFormatIndex);
        if (typeof relevantNoteDetails === 'undefined') { return null; }
        const {noteIds, noteInfos} = relevantNoteDetails;
        if (noteIds === null || typeof noteInfos === 'undefined') { return null; }
        const overwriteId = noteIds.find((id) => id !== INVALID_NOTE_ID);
        if (typeof overwriteId === 'undefined') { return null; }
        const overwriteInfo = noteInfos.find((info) => info !== null && info.noteId === overwriteId);
        if (!overwriteInfo) { return null; }
        const existingFields = overwriteInfo.fields;
        const fieldOptions = this._cardFormats[cardFormatIndex].fields;
        if (!fieldOptions) { return null; }

        const newValues = note.fields;

        /** @type {import('anki').NoteFields} */
        const noteFields = {};
        for (const [field, newValue] of Object.entries(newValues)) {
            const overwriteMode = fieldOptions[field].overwriteMode;
            const existingValue = existingFields[field].value;
            noteFields[field] = this._getOverwrittenField(existingValue, newValue, overwriteMode);
        }
        return {
            ...note,
            fields: noteFields,
            id: overwriteId,
        };
    }

    /**
     * @param {string} existingValue
     * @param {string} newValue
     * @param {import('settings').AnkiNoteFieldOverwriteMode} overwriteMode
     * @returns {string}
     */
    _getOverwrittenField(existingValue, newValue, overwriteMode) {
        switch (overwriteMode) {
            case 'overwrite':
                return newValue;
            case 'skip':
                return existingValue;
            case 'append':
                return existingValue + newValue;
            case 'prepend':
                return newValue + existingValue;
            case 'coalesce':
                return existingValue || newValue;
            case 'coalesce-new':
                return newValue || existingValue;
        }
    }

    /**
     * @param {import('anki').Note} note
     * @param {Error[]} allErrors
     * @param {HTMLButtonElement} button
     * @param {number} dictionaryEntryIndex
     */
    async _addNewAnkiNote(note, allErrors, button, dictionaryEntryIndex) {
        let noteId = null;
        let addNoteOkay = false;
        try {
            noteId = await this._display.application.api.addAnkiNote(note);
            addNoteOkay = true;
        } catch (e) {
            allErrors.length = 0;
            allErrors.push(toError(e));
        }

        if (addNoteOkay) {
            if (noteId === null) {
                allErrors.push(new Error('Note could not be added'));
            } else {
                if (this._suspendNewCards) {
                    try {
                        await this._display.application.api.suspendAnkiCardsForNote(noteId);
                    } catch (e) {
                        allErrors.push(toError(e));
                    }
                }
                const cardFormatIndex = this._getCardFormatIndex(button);

                this._updateSaveButtonForDuplicateBehavior(button, [noteId]);

                this._updateViewNoteButton(dictionaryEntryIndex, cardFormatIndex, [noteId]);

                if (this._forceSync) {
                    try {
                        await this._display.application.api.forceSync();
                    } catch (e) {
                        allErrors.push(toError(e));
                    }
                }
            }
        }
    }

    /**
     * @param {HTMLButtonElement} button
     * @returns {number}
     * @throws {Error}
     */
    _getCardFormatIndex(button) {
        const cardFormatIndex = button.dataset.cardFormatIndex;
        if (typeof cardFormatIndex === 'undefined') { throw new Error('Invalid card format index'); }
        const cardFormatIndexNumber = Number.parseInt(cardFormatIndex, 10);
        if (Number.isNaN(cardFormatIndexNumber)) { throw new Error('Invalid card format index'); }
        return cardFormatIndexNumber;
    }

    /**
     * @param {number} dictionaryEntryIndex
     * @param {number} cardFormatIndex
     * @param {number[]} noteIds
     */
    _updateViewNoteButton(dictionaryEntryIndex, cardFormatIndex, noteIds) {
        const entry = this._getEntry(dictionaryEntryIndex);
        if (entry === null) { return; }
        const singleNoteActions = entry.querySelector(`[data-card-format-index="${cardFormatIndex}"]`);
        if (singleNoteActions === null) { return; }
        /** @type {HTMLButtonElement | null} */
        let viewNoteButton = singleNoteActions.querySelector('.action-button[data-action=view-note]');
        if (viewNoteButton === null) {
            viewNoteButton = this._createViewNoteButton(dictionaryEntryIndex, cardFormatIndex, noteIds, []);
        }
        if (viewNoteButton === null) { return; }
        const newNoteIds = new Set([...this._getNodeNoteIds(viewNoteButton), ...noteIds]);
        viewNoteButton.dataset.noteIds = [...newNoteIds].join(' ');
        this._setViewButtonBadge(viewNoteButton);
        viewNoteButton.hidden = false;
    }

    /**
     * @param {import('anki').NoteWithId | null} noteWithId
     * @param {Error[]} allErrors
     */
    async _updateAnkiNote(noteWithId, allErrors) {
        if (noteWithId === null) { return; }

        try {
            await this._display.application.api.updateAnkiNote(noteWithId);
        } catch (e) {
            allErrors.length = 0;
            allErrors.push(toError(e));
        }
    }

    /**
     * @param {import('anki-note-builder').Requirement[]} requirements
     * @param {import('anki-note-builder').Requirement[]} outputRequirements
     * @returns {?DisplayAnkiError}
     */
    _getAddNoteRequirementsError(requirements, outputRequirements) {
        if (outputRequirements.length === 0) { return null; }

        let count = 0;
        for (const requirement of outputRequirements) {
            const {type} = requirement;
            switch (type) {
                case 'audio':
                case 'clipboardImage':
                    break;
                default:
                    ++count;
                    break;
            }
        }
        if (count === 0) { return null; }

        const error = new DisplayAnkiError('The created card may not have some content');
        error.requirements = requirements;
        error.outputRequirements = outputRequirements;
        return error;
    }

    /**
     * @param {Error[]} errors
     * @param {(DocumentFragment|Node|Error)[]} [displayErrors]
     */
    _showErrorNotification(errors, displayErrors) {
        if (typeof displayErrors === 'undefined') { displayErrors = errors; }

        if (this._errorNotificationEventListeners !== null) {
            this._errorNotificationEventListeners.removeAllEventListeners();
        }

        if (this._errorNotification === null) {
            this._errorNotification = this._display.createNotification(false);
            this._errorNotificationEventListeners = new EventListenerCollection();
        }

        const content = this._display.displayGenerator.createAnkiNoteErrorsNotificationContent(displayErrors);
        for (const node of content.querySelectorAll('.anki-note-error-log-link')) {
            /** @type {EventListenerCollection} */ (this._errorNotificationEventListeners).addEventListener(node, 'click', () => {
                log.log({ankiNoteErrors: errors});
            }, false);
        }

        this._errorNotification.setContent(content);
        this._errorNotification.open();
    }

    /**
     * @param {boolean} animate
     */
    _hideErrorNotification(animate) {
        if (this._errorNotification === null) { return; }
        this._errorNotification.close(animate);
        /** @type {EventListenerCollection} */ (this._errorNotificationEventListeners).removeAllEventListeners();
    }

    /**
     * @param {import('settings').ProfileOptions} options
     */
    async _updateAnkiFieldTemplates(options) {
        this._ankiFieldTemplates = await this._getAnkiFieldTemplates(options);
    }

    /**
     * @param {import('settings').ProfileOptions} options
     * @returns {Promise<string>}
     */
    async _getAnkiFieldTemplates(options) {
        const dictionaryInfo = await this._display.application.api.getDictionaryInfo();
        const staticTemplates = await this._getStaticAnkiFieldTemplates(options);
        const dynamicTemplates = getDynamicTemplates(options, dictionaryInfo);
        return staticTemplates + dynamicTemplates;
    }

    /**
     * @param {import('settings').ProfileOptions} options
     * @returns {Promise<string>}
     */
    async _getStaticAnkiFieldTemplates(options) {
        let templates = options.anki.fieldTemplates;
        if (typeof templates === 'string') { return templates; }

        templates = this._ankiFieldTemplatesDefault;
        if (typeof templates === 'string') { return templates; }

        templates = await this._display.application.api.getDefaultAnkiFieldTemplates();
        this._ankiFieldTemplatesDefault = templates;
        return templates;
    }

    /**
     * Checks whether fetching additional information (e.g. tags and flags, or overwrite) is enabled
     * based on the current instance's display settings and duplicate handling behavior.
     * @returns {boolean} - True if additional info fetching is enabled, false otherwise.
     */
    _isAdditionalInfoEnabled() {
        return this._displayTagsAndFlags !== 'never' || this._duplicateBehavior === 'overwrite';
    }

    /**
     * @param {import('dictionary').DictionaryEntry[]} dictionaryEntries
     * @returns {Promise<import('display-anki').DictionaryEntryDetails[]>}
     */
    async _getDictionaryEntryDetails(dictionaryEntries) {
        const notePromises = [];
        const noteTargets = [];
        for (let i = 0, ii = dictionaryEntries.length; i < ii; ++i) {
            const dictionaryEntry = dictionaryEntries[i];
            const {type} = dictionaryEntry;
            for (const [cardFormatIndex, cardFormat] of this._cardFormats.entries()) {
                if (cardFormat.type !== type) { continue; }
                const notePromise = this._createNote(dictionaryEntry, cardFormatIndex, []);
                notePromises.push(notePromise);
                noteTargets.push({index: i, cardFormatIndex, cardFormat});
            }
        }

        const noteInfoList = (await Promise.all(notePromises));
        const validNotes = [];
        /** @type {(import('anki').NoteInfoWrapper?)[]} */
        const invalidAndPlaceholderNotes = [];
        for (const noteInfo of noteInfoList) {
            const note = noteInfo.note;
            if (note.deckName.length > 0 && note.modelName.length > 0) {
                validNotes.push(note);
                invalidAndPlaceholderNotes.push(null);
            } else {
                invalidAndPlaceholderNotes.push({
                    canAdd: false,
                    valid: false,
                    noteIds: null,
                });
            }
        }

        let infos;
        let ankiError = null;
        try {
            if (this._checkForDuplicates) {
                infos = await this._display.application.api.getAnkiNoteInfo(validNotes, this._isAdditionalInfoEnabled());
            } else {
                const isAnkiConnected = await this._display.application.api.isAnkiConnected();
                infos = this._getAnkiNoteInfoForceValueIfValid(validNotes, isAnkiConnected);
                ankiError = isAnkiConnected ? null : new Error('Anki not connected');
            }
        } catch (e) {
            infos = this._getAnkiNoteInfoForceValueIfValid(validNotes, false);
            ankiError = (e instanceof ExtensionError && e.message.includes('Anki connection failure')) ?
                new Error('Anki not connected') :
                toError(e);
        }

        /** @type {(import('anki').NoteInfoWrapper)[]} */
        const notesDupechecked = [];
        for (const invalidAndPlaceholderNote of invalidAndPlaceholderNotes) {
            if (invalidAndPlaceholderNote !== null) {
                notesDupechecked.push(invalidAndPlaceholderNote);
            } else {
                const info = infos.shift();
                if (typeof info !== 'undefined') {
                    notesDupechecked.push(info);
                }
            }
        }

        /** @type {import('display-anki').DictionaryEntryDetails[]} */
        const results = new Array(dictionaryEntries.length).fill(null).map(() => ({noteMap: new Map()}));

        for (let i = 0, ii = noteInfoList.length; i < ii; ++i) {
            const {note, errors, requirements} = noteInfoList[i];
            const {canAdd, valid, noteIds, noteInfos} = notesDupechecked[i];
            const {cardFormatIndex, cardFormat, index} = noteTargets[i];
            results[index].noteMap.set(cardFormatIndex, {cardFormat, note, errors, requirements, canAdd, valid, noteIds, noteInfos, ankiError});
        }
        return results;
    }

    /**
     * @param {import('anki').Note[]} notes
     * @param {boolean} canAdd
     * @returns {import('anki').NoteInfoWrapper[]}
     */
    _getAnkiNoteInfoForceValueIfValid(notes, canAdd) {
        const results = [];
        for (const note of notes) {
            const valid = isNoteDataValid(note);
            results.push({canAdd: (valid ? canAdd : valid), valid, noteIds: null});
        }
        return results;
    }

    /**
     * @param {import('dictionary').DictionaryEntry} dictionaryEntry
     * @param {number} cardFormatIndex
     * @param {import('anki-note-builder').Requirement[]} requirements
     * @returns {Promise<import('display-anki').CreateNoteResult>}
     */
    async _createNote(dictionaryEntry, cardFormatIndex, requirements) {
        const context = this._noteContext;
        if (context === null) { throw new Error('Note context not initialized'); }
        const cardFormat = this._cardFormats?.[cardFormatIndex];
        if (typeof cardFormat === 'undefined') { throw new Error('Unsupported note type}'); }
        if (!this._ankiFieldTemplates) {
            const options = this._display.getOptions();
            if (options) {
                await this._updateAnkiFieldTemplates(options);
            }
        }
        const template = this._ankiFieldTemplates;
        if (typeof template !== 'string') { throw new Error('Invalid template'); }
        const contentOrigin = this._display.getContentOrigin();
        const details = this._ankiNoteBuilder.getDictionaryEntryDetailsForNote(dictionaryEntry);
        const audioDetails = this._getAnkiNoteMediaAudioDetails(details);
        const optionsContext = this._display.getOptionsContext();
        const dictionaryStylesMap = this._ankiNoteBuilder.getDictionaryStylesMap(this._dictionaries);

        const {note, errors, requirements: outputRequirements} = await this._ankiNoteBuilder.createNote({
            dictionaryEntry,
            cardFormat,
            context,
            template,
            tags: this._noteTags,
            duplicateScope: this._duplicateScope,
            duplicateScopeCheckAllModels: this._duplicateScopeCheckAllModels,
            resultOutputMode: this._resultOutputMode,
            glossaryLayoutMode: this._glossaryLayoutMode,
            compactTags: this._compactTags,
            mediaOptions: {
                audio: audioDetails,
                screenshot: {
                    format: this._screenshotFormat,
                    quality: this._screenshotQuality,
                    contentOrigin,
                },
                textParsing: {
                    optionsContext,
                    scanLength: this._scanLength,
                },
            },
            requirements,
            dictionaryStylesMap,
        });
        return {note, errors, requirements: outputRequirements};
    }

    /**
     * @param {unknown} sentence
     * @param {string} fallback
     * @param {number} fallbackOffset
     * @returns {import('anki-templates-internal').ContextSentence}
     */
    _getValidSentenceData(sentence, fallback, fallbackOffset) {
        let text;
        let offset;
        if (typeof sentence === 'object' && sentence !== null) {
            ({text, offset} = /** @type {import('core').UnknownObject} */ (sentence));
        }
        if (typeof text !== 'string') {
            text = fallback;
            offset = fallbackOffset;
        } else {
            if (typeof offset !== 'number') { offset = 0; }
        }
        return {text, offset};
    }

    /**
     * @param {import('api').InjectAnkiNoteMediaDefinitionDetails} details
     * @returns {?import('anki-note-builder').AudioMediaOptions}
     */
    _getAnkiNoteMediaAudioDetails(details) {
        if (details.type !== 'term') { return null; }
        const {sources, preferredAudioIndex, enableDefaultAudioSources} = this._displayAudio.getAnkiNoteMediaAudioDetails(details.term, details.reading);
        const languageSummary = this._display.getLanguageSummary();
        return {
            sources,
            preferredAudioIndex,
            idleTimeout: this._audioDownloadIdleTimeout,
            languageSummary,
            enableDefaultAudioSources,
        };
    }

    // View note functions

    /**
     * @param {MouseEvent} e
     */
    _onViewNotesButtonClick(e) {
        const element = /** @type {HTMLElement} */ (e.currentTarget);
        e.preventDefault();
        if (e.shiftKey) {
            this._showViewNotesMenu(element);
        } else {
            void this._viewNotes(element);
        }
    }

    /**
     * @param {MouseEvent} e
     */
    _onViewNotesButtonContextMenu(e) {
        const element = /** @type {HTMLElement} */ (e.currentTarget);
        e.preventDefault();
        this._showViewNotesMenu(element);
    }

    /**
     * @param {import('popup-menu').MenuCloseEvent} e
     */
    _onViewNotesButtonMenuClose(e) {
        const {detail: {action, item}} = e;
        switch (action) {
            case 'viewNotes':
                if (item !== null) {
                    void this._viewNotes(item);
                }
                break;
        }
    }

    /**
     * @param {number} index
     * @param {number} cardFormatIndex
     * @param {number[]} noteIds
     * @param {(?import('anki').NoteInfo)[]} noteInfos
     * @returns {?HTMLButtonElement}
     */
    _createViewNoteButton(index, cardFormatIndex, noteIds, noteInfos) {
        if (noteIds.length === 0) { return null; }
        let viewNoteButton = /** @type {HTMLButtonElement} */ (this._display.displayGenerator.instantiateTemplate('note-action-button-view-note'));
        if (viewNoteButton === null) { return null; }
        const disabled = (noteIds.length === 0);
        viewNoteButton.disabled = disabled;
        viewNoteButton.hidden = disabled;
        viewNoteButton.dataset.noteIds = noteIds.join(' ');

        viewNoteButton = this._setViewNoteButtonCardState(noteInfos, viewNoteButton);

        this._setViewButtonBadge(viewNoteButton);

        const entry = this._getEntry(index);
        if (entry === null) { return null; }

        const container = entry.querySelector('.note-actions-container');
        if (container === null) { return null; }
        const singleNoteActionButtonContainer = container.querySelector(`[data-card-format-index="${cardFormatIndex}"]`);
        if (singleNoteActionButtonContainer === null) { return null; }
        singleNoteActionButtonContainer.appendChild(viewNoteButton);

        this._eventListeners.addEventListener(viewNoteButton, 'click', this._onViewNotesButtonClickBind);
        this._eventListeners.addEventListener(viewNoteButton, 'contextmenu', this._onViewNotesButtonContextMenuBind);
        this._eventListeners.addEventListener(viewNoteButton, 'menuClose', this._onViewNotesButtonMenuCloseBind);

        return viewNoteButton;
    }

    /**
     * @param {(?import('anki').NoteInfo)[]} noteInfos
     * @param {HTMLButtonElement} viewNoteButton
     * @returns {HTMLButtonElement}
     */
    _setViewNoteButtonCardState(noteInfos, viewNoteButton) {
        if (this._isAdditionalInfoEnabled() === false || noteInfos.length === 0) { return viewNoteButton; }

        const cardStates = [];
        for (const item of noteInfos) {
            if (item === null) { continue; }
            for (const cardInfo of item.cardsInfo) {
                cardStates.push(cardInfo.cardState);
            }
        }

        const highestState = this._getHighestPriorityCardState(cardStates);
        const dataIcon = /** @type {HTMLElement} */ (viewNoteButton.querySelector('.icon[data-icon^="view-note"]'));
        dataIcon.dataset.icon = highestState !== 'new' ? `view-note-${highestState}` : 'view-note';

        const label = `View added note (${highestState})`;
        viewNoteButton.title = label;
        viewNoteButton.dataset.hotkey = JSON.stringify(['viewNotes', 'title', `${label} ({0})`]);
        return viewNoteButton;
    }

    /**
     * @param {HTMLButtonElement} viewNoteButton
     */
    _setViewButtonBadge(viewNoteButton) {
        /** @type {?HTMLElement} */
        const badge = viewNoteButton.querySelector('.action-button-badge');
        const noteIds = this._getNodeNoteIds(viewNoteButton);
        if (badge !== null) {
            const badgeData = badge.dataset;
            if (noteIds.length > 1) {
                badgeData.icon = 'plus-thick';
                badge.hidden = false;
            } else {
                delete badgeData.icon;
                badge.hidden = true;
            }
        }
    }

    /**
     * @param {HTMLElement} node
     */
    async _viewNotes(node) {
        const noteIds = this._getNodeNoteIds(node);
        if (noteIds.length === 0) { return; }
        try {
            await this._display.application.api.viewNotes(noteIds, this._noteGuiMode, false);
        } catch (e) {
            const displayErrors = (
                toError(e).message === 'Mode not supported' ?
                [this._display.displayGenerator.instantiateTemplateFragment('footer-notification-anki-view-note-error')] :
                void 0
            );
            this._showErrorNotification([toError(e)], displayErrors);
            return;
        }
    }

    /**
     * @param {HTMLElement} node
     */
    _showViewNotesMenu(node) {
        const noteIds = this._getNodeNoteIds(node);
        if (noteIds.length === 0) { return; }

        /** @type {HTMLElement} */
        const menuContainerNode = this._display.displayGenerator.instantiateTemplate('view-note-button-popup-menu');
        /** @type {HTMLElement} */
        const menuBodyNode = querySelectorNotNull(menuContainerNode, '.popup-menu-body');

        for (let i = 0, ii = noteIds.length; i < ii; ++i) {
            const noteId = noteIds[i];
            /** @type {HTMLElement} */
            const item = this._display.displayGenerator.instantiateTemplate('view-note-button-popup-menu-item');
            /** @type {Element} */
            const label = querySelectorNotNull(item, '.popup-menu-item-label');
            label.textContent = `Note ${i + 1}: ${noteId}`;
            item.dataset.menuAction = 'viewNotes';
            item.dataset.noteIds = `${noteId}`;
            menuBodyNode.appendChild(item);
        }

        this._menuContainer.appendChild(menuContainerNode);
        const popupMenu = new PopupMenu(node, menuContainerNode);
        popupMenu.prepare();
    }

    /**
     * @param {HTMLElement} node
     * @returns {number[]}
     */
    _getNodeNoteIds(node) {
        const {noteIds} = node.dataset;
        const results = [];
        if (typeof noteIds === 'string' && noteIds.length > 0) {
            for (const noteId of noteIds.split(' ')) {
                const noteIdInt = Number.parseInt(noteId, 10);
                if (Number.isFinite(noteIdInt)) {
                    results.push(noteIdInt);
                }
            }
        }
        return results;
    }

    /**
     * @param {number} index
     * @returns {?HTMLButtonElement}
     */
    _getViewNoteButton(index) {
        const entry = this._getEntry(index);
        return entry !== null ? entry.querySelector('.action-button[data-action=view-note]') : null;
    }

    /**
     * @param {unknown} cardFormatStringIndex
     */
    _hotkeyViewNotesForSelectedEntry(cardFormatStringIndex) {
        if (typeof cardFormatStringIndex !== 'string') { return; }
        const cardFormatIndex = Number.parseInt(cardFormatStringIndex, 10);
        if (Number.isNaN(cardFormatIndex)) { return; }
        const index = this._display.selectedIndex;
        const entry = this._getEntry(index);
        if (entry === null) { return; }
        const container = entry.querySelector('.note-actions-container');
        if (container === null) { return; }
        /** @type {HTMLButtonElement | null} */
        const nthButton = container.querySelector(`.action-button-container[data-card-format-index="${cardFormatIndex}"] .action-button[data-action=view-note]`);
        if (nthButton === null) { return; }
        void this._viewNotes(nthButton);
    }

    /**
     * @param {number} flag
     * @returns {string}
     */
    _getFlagName(flag) {
        /** @type {Record<number, string>} */
        const flagNamesDict = {
            1: 'Red',
            2: 'Orange',
            3: 'Green',
            4: 'Blue',
            5: 'Pink',
            6: 'Turquoise',
            7: 'Purple',
        };
        if (flag in flagNamesDict) {
            return flagNamesDict[flag];
        }
        return '';
    }

    /**
     * @param {Set<string>} flags
     * @returns {string}
     */
    _getFlagColor(flags) {
        /** @type {Record<string, import('display-anki').RGB>} */
        const flagColorsDict = {
            Red: {red: 248, green: 113, blue: 113},
            Orange: {red: 253, green: 186, blue: 116},
            Green: {red: 134, green: 239, blue: 172},
            Blue: {red: 96, green: 165, blue: 250},
            Pink: {red: 240, green: 171, blue: 252},
            Turquoise: {red: 94, green: 234, blue: 212},
            Purple: {red: 192, green: 132, blue: 252},
        };

        const gradientSliceSize = 100 / flags.size;
        let currentGradientPercent = 0;

        const gradientSlices = [];
        for (const flag of flags) {
            const flagColor = flagColorsDict[flag];
            gradientSlices.push(
                'rgb(' + flagColor.red + ',' + flagColor.green + ',' + flagColor.blue + ') ' + currentGradientPercent + '%',
                'rgb(' + flagColor.red + ',' + flagColor.green + ',' + flagColor.blue + ') ' + (currentGradientPercent + gradientSliceSize) + '%',
            );
            currentGradientPercent += gradientSliceSize;
        }

        return 'linear-gradient(to right,' + gradientSlices.join(',') + ')';
    }

    /**
     * Get the highest priority state from a list of Anki queue states.
     * Source: https://github.com/ankidroid/Anki-Android/wiki/Database-Structure#cards
     *
     * Priority order:
     *   - -3, -2 → "buried"
     *   - -1 → "suspended"
     *   -  2 → "review"
     *   -  1, 3 → "learning"
     *   -  0 → "new" (default fallback)
     * @param {number[]} cardStates Array of queue state integers.
     * @returns {"buried" | "suspended" | "review" | "learning" | "new" } - The highest priority state found.
     */
    _getHighestPriorityCardState(cardStates) {
        if (cardStates.includes(-3) || cardStates.includes(-2)) {
            return 'buried';
        }
        if (cardStates.includes(-1)) {
            return 'suspended';
        }
        if (cardStates.includes(2)) {
            return 'review';
        }
        if (cardStates.includes(1) || cardStates.includes(3)) {
            return 'learning';
        }
        return 'new';
    }
}

class DisplayAnkiError extends Error {
    /**
     * @param {string} message
     */
    constructor(message) {
        super(message);
        /** @type {string} */
        this.name = 'DisplayAnkiError';
        /** @type {?import('anki-note-builder').Requirement[]} */
        this._requirements = null;
        /** @type {?import('anki-note-builder').Requirement[]} */
        this._outputRequirements = null;
    }

    /** @type {?import('anki-note-builder').Requirement[]} */
    get requirements() { return this._requirements; }
    set requirements(value) { this._requirements = value; }

    /** @type {?import('anki-note-builder').Requirement[]} */
    get outputRequirements() { return this._outputRequirements; }
    set outputRequirements(value) { this._outputRequirements = value; }
}
