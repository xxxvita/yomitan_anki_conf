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

import {translate, translatePlural} from '../i18n/ui-language.js';
import {log} from '../core/log.js';
import {createFlibKeyHelp} from './flib-key-help.js';
import {
    buildYouTubeThumbUrl,
    computeClipWindow,
    describeEmptyReason,
    describeGatewayError,
    describeKnowledgeError,
    describeUnderstandableEmpty,
    formatSourceTitle,
    formatTimeRange,
    getGatewayErrorCode,
    getGatewayErrorDetails,
    isCoreFallbackError,
    isSafeImdbUrl,
    sanitizeYouTubeItems,
    subsToCues,
    truncateAtWordBoundary,
} from './gateway-examples-util.js';
import {buildHighlightMatcher, highlightCueParts} from './example-highlight-forms.js';
import {attachSubtitleTrack, buildHighlightedVtt} from './example-subtitle-track.js';
import {GatewayClipWaitError} from './gateway-anki-media.js';
import {appendHighlightedParts} from './video-examples-modal.js';
import {appendCheckIcon} from './video-examples-panel.js';

/** How long «Сохранено» stays in the save status line. */
const SAVE_STATUS_DONE_MS = 2000;
/** `/v1/examples` (and the film job) take at most 80 code points: a quote target is cut to this for them (M2). */
const PLAIN_QUERY_MAX_CODE_POINTS = 80;
/** «Понятные»: at most this many already shown video ids are excluded (global constraints). */
const UNDERSTANDABLE_EXCLUDE_MAX = 1000;

/** @typedef {'loading'|'ready'|'empty'|'error'} SectionState */
/** @typedef {'youtube'|'films'} SectionName */

/**
 * @typedef {object} SectionElements
 * @property {HTMLElement} root
 * @property {HTMLElement} message
 * @property {HTMLElement} list
 * @property {?HTMLElement} tools Строка инструментов (только YouTube).
 */

/**
 * @typedef {object} FilmCard
 * @property {import('flib-gateway-examples').FilmClip} clip
 * @property {HTMLElement} root
 * @property {HTMLElement} media
 * @property {HTMLElement} meta
 * @property {'idle'|'loading'|'ready'|'failed'} state
 * @property {?HTMLVideoElement} video
 * @property {?(() => void)} disposeSubtitles Отписка дорожки субтитров от fullscreenchange.
 * @property {boolean} retryable Загрузка сорвалась у нас (не «failed» от сервера) — можно повторить.
 * @property {HTMLInputElement} checkbox «Сохранить в карточку»; доступен только у готового клипа.
 * @property {?Blob} blob MP4 шлюза (не обрезан) — вход перекодирования при сохранении; null после destroy().
 * @property {?import('flib-gateway').ClipInfo} info lead_trim_sec и source клипа.
 * @property {?{videoWidth: number, videoHeight: number, durationSec: number}} mediaMeta Из loadedmetadata.
 * @property {boolean} mediaError Видео не смогло прочитать даже метаданные.
 * @property {Set<() => void>} listeners Ожидающие готовности клипа (waitForFilmClipMedia).
 */

/**
 * @typedef {object} YouTubeCard
 * @property {string} key From a monotonic per-panel counter: unique across the plain and the known sets.
 * @property {HTMLElement} root
 * @property {HTMLInputElement} checkbox
 * @property {string} ref
 * @property {?number} startMs
 * @property {?string} textEn
 */

/**
 * A «понятный ролик» card: no Anki checkbox, never part of the selection.
 * @typedef {object} UnderstandableCard
 * @property {string} ref
 * @property {HTMLElement} root
 */

/**
 * What the YouTube section searches. Default: the card word as a lemma, ordinary list first.
 * @typedef {object} GatewayPanelSearch
 * @property {import('flib-gateway').ExamplesBatchTarget} target
 * @property {'plain'|'known'} initialRank 'known' — the first YouTube load is the known-words batch (phrase window).
 * @property {boolean} [truncated] The target was cut to 200 code points: the header says so.
 */

/**
 * @typedef {object} PlainYouTubeResult
 * @property {import('flib-gateway').ExampleItem[]} items
 * @property {?string} emptyReason
 */

/**
 * @typedef {object} GatewayPanelHooks
 * @property {() => void} onCancel
 * @property {() => void} onRetry
 * @property {(item: import('flib-gateway').ExampleItem, words: string[]) => void} onYouTubeOpen
 * @property {() => void} [onCoreFallback] Открыть примеры через anki_conf вместо шлюза (review M5).
 * @property {() => void} [onSaveSelected] Кнопка «В Anki · N видео» внизу панели: сохранить слово с отмеченным.
 */

/**
 * Known-words empty reasons that a repeat would not change: such an answer is cached like a list (K3).
 * `budget_exhausted` (the server ran out of time) and `quota_exhausted` (refills) are not final.
 */
const KNOWN_FINAL_EMPTY_REASONS = new Set(['bad_target', 'not_in_dictionary', 'not_in_corpus', 'no_usable_examples']);

/** Коды ошибок шлюза, после которых поможет другой ключ. Частые запросы (429) сюда не входят: там надо просто подождать. */
const KEY_HELP_CODES = new Set(['flib_key_missing', 'flib_key_invalid', 'flib_forbidden', 'examples_forbidden', 'examples_quota_exhausted']);

/**
 * @param {?string} code
 * @returns {code is string}
 */
function needsKeyHelp(code) {
    return code !== null && (KEY_HELP_CODES.has(code) || code.startsWith('demo_'));
}

/**
 * Ключ уже есть и работает (лимит, доступ, демо): бесплатный предлагать незачем.
 * @param {string} code
 * @returns {'need'|'limit'}
 */
function keyHelpVariant(code) {
    return code === 'flib_key_missing' || code === 'flib_key_invalid' ? 'need' : 'limit';
}

/**
 * Панель примеров со шлюза Flib: две независимые секции — «YouTube» и
 * «Фильмы». Ошибка одной не прячет другую.
 *
 * Совместима с местом VideoExamplesPanel в DisplayAnki (root, isTerminal,
 * destroy, setDensity, getSelectedClipIds — у шлюза всегда пуст: это путь
 * Core). Выбор для Anki — чекбоксы на карточках (ничего не отмечено заранее),
 * см. getSelectedGatewayMedia / waitForFilmClipMedia и
 * docs/gateway-clips-to-anki-spec.md.
 *
 * ⚠️ Байты клипа (до 25 МБ base64) грузятся лениво — по появлению карточки
 * в области видимости или по щелчку — и строго по одному. Все blob-URL
 * отзываются в destroy(); пришедшие после destroy() не создаются вовсе.
 */
export class GatewayExamplesPanel {
    /**
     * @param {HTMLElement} entry
     * @param {string} word
     * @param {GatewayPanelHooks} hooks
     * @param {{loader: import('./gateway-examples-loader.js').GatewayExamplesLoader, api?: ?import('../comm/api.js').API, highlightForms?: string[], density?: 'compact'|'large', canFallbackToCore?: () => boolean, search?: GatewayPanelSearch}} options
     *   highlightForms — заглавные статьи: склоняются вместе со словом для подсветки.
     *   search — что ищет YouTube (по умолчанию слово как лемма, сначала обычный список).
     */
    constructor(entry, word, hooks, {loader, api, highlightForms, density, canFallbackToCore, search}) {
        /** @type {string} */
        this._word = word;
        const target = search?.target ?? {text: word, mode: 'lemma'};
        /** @type {Required<GatewayPanelSearch>} */
        this._search = {
            target: {text: target.text, mode: target.mode === 'quote' ? 'quote' : 'lemma'},
            initialRank: search?.initialRank === 'known' ? 'known' : 'plain',
            truncated: search?.truncated === true,
        };
        /** @type {string} Query of `/v1/examples` and of the film job: a quote is cut to 80 code points (M2). */
        this._plainQuery = this._search.target.mode === 'quote' ?
            truncateAtWordBoundary(this._search.target.text, PLAIN_QUERY_MAX_CODE_POINTS) :
            this._search.target.text;
        /** @type {GatewayPanelHooks} */
        this._hooks = hooks;
        /** @type {import('./gateway-examples-loader.js').GatewayExamplesLoader} */
        this._loader = loader;
        /** @type {string[]} Склоняемые источники подсветки: слово, заглавные, лемма шлюза. */
        this._highlightTerms = [word, ...(Array.isArray(highlightForms) ? highlightForms : [])];
        /** @type {string[]} matched_forms шлюза — подсвечиваются как есть. */
        this._highlightExact = [];
        /** @type {string[]} Формы для highlightCueParts (см. example-highlight-forms.js). */
        this._words = buildHighlightMatcher({terms: this._highlightTerms});
        /**
         * Строки YouTube — перекрасить, когда придут лемма/формы. `root` — карточка строки: entries of replaced
         * cards are dropped (_forgetYouTubeTexts), so the list stays as long as the cards that still exist.
         * @type {{el: HTMLElement, text: string, root: HTMLElement}[]}
         */
        this._youTubeTexts = [];
        /** @type {AbortController} */
        this._abort = new AbortController();
        /** @type {boolean} */
        this._destroyed = false;
        /** @type {?('user'|'content')} */
        this._destroyReason = null;
        /** @type {Set<string>} */
        this._blobUrls = new Set();
        /** @type {Set<Promise<void>>} */
        this._pending = new Set();
        /** @type {Promise<void>} Очередь загрузки клипов: строго по одному. */
        this._loadChain = Promise.resolve();
        /** @type {FilmCard[]} */
        this._filmCards = [];
        /** @type {YouTubeCard[]} The VISIBLE YouTube set (plain or known): selection, save and the tab count use it. */
        this._youTubeCards = [];
        /** @type {number} Source of YouTubeCard.key — never reused, so keys stay unique across both sets (C2). */
        this._youTubeKeySeq = 0;
        /** @type {?YouTubeCard[]} The ordinary list; null — not loaded (a phrase opened straight in the known mode). */
        this._plainCards = null;
        /** @type {?YouTubeCard[]} The last known-words list; null — not asked yet. */
        this._knownCards = null;
        /**
         * Which set is on screen; 'known' = the button is pressed. A phrase opened in the known mode starts as 'known'
         * (spec item 8), so the toolbar compares with what the panel is showing or loading (K1).
         * @type {'plain'|'known'}
         */
        this._youTubeView = this._search.initialRank;
        /**
         * The known list is a final answer (route or none, not partial, not pending): pressing again shows it with
         * no request (K3 — every request may spend the examples quota).
         */
        this._knownComplete = false;
        /** @type {?string} The note that goes with the cached known list (the «none» text); null — none. */
        this._knownCachedNote = null;
        /** @type {?string} A final empty known answer (K3): pressing again shows this text with no request. */
        this._knownEmptyText = null;
        /** A known-words or restoring request is in flight (spec item 11). */
        this._knownBusy = false;
        /** @type {?{state: SectionState, message: string, code: ?string}} Ordinary section state hidden by a known list. */
        this._plainSectionToRestore = null;
        /** @type {{state: SectionState, message: string, code: ?string}} Last YouTube _setSection call. */
        this._youTubeSection = {state: 'loading', message: '', code: null};
        /** @type {?HTMLButtonElement} «С учётом моих знаний». */
        this._knownButton = null;
        /** @type {?HTMLElement} Known-words results and errors (never the section message). */
        this._knownNote = null;
        /** @type {?HTMLElement} «Понятные» cards, above the ordinary list; the known toggle never touches it. */
        this._undList = null;
        /** @type {UnderstandableCard[]} «Понятные» cards, newest first; counted in the YouTube tab. */
        this._undCards = [];
        /** @type {?AbortController} The running «Понятные» job (one per press); null — none. */
        this._undController = null;
        /** @type {?HTMLButtonElement} «Понятные». */
        this._undButton = null;
        /** @type {?HTMLElement} «Понятные» progress, results and errors. */
        this._undNote = null;
        /** @type {Set<string>} Refs of every YouTube card shown in this panel (plain, known, «понятные»): the exclude list. */
        this._shownYouTubeRefs = new Set();
        /** @type {Set<string>} clipId отмеченных клипов. */
        this._selectedFilm = new Set();
        /** @type {Set<string>} YouTubeCard.key отмеченных роликов. */
        this._selectedYouTube = new Set();
        /** @type {Record<SectionName, SectionState>} */
        this._sectionState = {youtube: 'loading', films: 'loading'};
        /** @type {?IntersectionObserver} */
        this._observer = null;
        /** @type {() => boolean} Проверяется в момент ошибки: маршрут мог смениться. */
        this._canFallbackToCore = canFallbackToCore ?? (() => false);
        /** @type {?import('../comm/api.js').API} */
        this._api = api ?? null;
        /** @type {?HTMLButtonElement} */
        this._coreFallbackButton = null;
        /** @type {{text: string}[]} Busy saves (beginSaveStatus), least recently updated first. */
        this._saveStatuses = [];
        /** @type {?ReturnType<typeof setTimeout>} Hides «Сохранено». */
        this._saveStatusTimer = null;
        /** @type {?HTMLElement} Built in _buildRoot. */
        this._saveStatusEl = null;
        /** @type {SectionName} Открытая вкладка. */
        this._tab = 'youtube';
        /** Пользователь сам выбрал вкладку — больше не переключаем за него. */
        this._tabTouched = false;
        /** @type {Partial<Record<SectionName, HTMLButtonElement>>} */
        this._tabButtons = {};
        /** @type {?{root: HTMLElement, text: HTMLElement, button: HTMLButtonElement}} */
        this._footer = null;

        /** @type {HTMLElement} */
        this._root = this._buildRoot(density === 'large' ? 'large' : 'compact');
        /** @type {SectionElements} */
        this._youtube = this._buildSection('youtube', 'YouTube');
        /** @type {SectionElements} */
        this._films = this._buildSection('films', translate('video.films'));
        this._root.appendChild(this._youtube.root);
        this._root.appendChild(this._films.root);
        /**
         *
         */
        this._footer = this._buildFooter();
        this._root.appendChild(this._footer.root);
        this._setTab('youtube', false);
        this._updateFooter();
        entry.appendChild(this._root);
    }

    // Карточка Flib-club (макет, ExamplesPanel): вкладки, низ панели

    /**
     * @param {SectionName} name
     * @param {boolean} byUser
     */
    _setTab(name, byUser) {
        this._tab = name;
        if (byUser) { this._tabTouched = true; }
        for (const [section, elements] of /** @type {[SectionName, SectionElements][]} */ ([['youtube', this._youtube], ['films', this._films]])) {
            const active = section === name;
            elements.root.hidden = !active;
            this._tabButtons[section]?.setAttribute('aria-selected', active ? 'true' : 'false');
        }
    }

    /** Счётчики во вкладках и автопереход на «Фильмы», если на YouTube пусто. */
    _syncTabs() {
        const counts = {youtube: this._youTubeCards.length + this._undCards.length, films: this._filmCards.length};
        for (const name of /** @type {SectionName[]} */ (['youtube', 'films'])) {
            const badge = this._tabButtons[name]?.querySelector('.fc-tab-n');
            if (!(badge instanceof HTMLElement)) { continue; }
            const state = this._sectionState[name];
            // «!» у ошибки: «0» читался бы как «ничего нет», и ошибка (а с ней ссылка
            // за ключом) терялась бы во вкладке.
            /** @type {Record<SectionState, string>} */
            const text = {ready: `${counts[name]}`, loading: '…', error: '!', empty: '0'};
            badge.textContent = text[state];
            badge.title = state === 'error' ? translate('video.tabError') : '';
        }
        // ⚠️ Только «пусто», не «ошибка»: при ошибке ключа во вкладке YouTube
        // стоит ссылка за ключом — уводить с неё нельзя.
        const youtubeDone = this._sectionState.youtube === 'empty';
        if (!this._tabTouched && this._tab === 'youtube' && youtubeDone && this._sectionState.films !== 'empty') {
            // Пусто на YouTube — к фильмам, в том числе к их ошибке: её надо увидеть.
            this._setTab('films', false);
        }
    }

    /** @returns {{root: HTMLElement, text: HTMLElement, button: HTMLButtonElement}} */
    _buildFooter() {
        const root = document.createElement('div');
        root.className = 'fc-xp-foot';
        const text = document.createElement('span');
        text.className = 'fc-xp-foot-text';
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'fc-btn fc-btn-acc fc-xp-save';
        button.addEventListener('click', () => { this._hooks.onSaveSelected?.(); });
        root.append(text, button);
        return {root, text, button};
    }

    /** Текст и кнопка внизу по числу отмеченных примеров. */
    _updateFooter() {
        if (this._footer === null) { return; }
        const count = this._selectedFilm.size + this._selectedYouTube.size;
        const {text, button} = this._footer;
        // No save hook = a phrase (display-anki mounts it so): its clips cannot
        // go into Anki yet, so the footer must not promise that.
        if (typeof this._hooks.onSaveSelected !== 'function') {
            text.textContent = translate('video.phraseViewOnly');
            button.hidden = true;
            return;
        }
        if (count === 0) {
            text.textContent = translate('video.markHintWord');
            button.hidden = true;
            return;
        }
        text.textContent = translatePlural('video.selectedSummary', count);
        button.hidden = false;
        button.textContent = translatePlural('video.saveButton', count);
    }

    /** @returns {HTMLElement} */
    get root() { return this._root; }

    /** @returns {'plain'|'known'} The YouTube view on screen (or being loaded first): what the in-panel toggle shows. */
    get rank() { return this._youTubeView; }

    /**
     * The phrase toolbar asked for `rank` on this live panel (K1): press or un-press the in-panel toggle through the
     * same logic as a click, with no remount — the stored lists, the film job and «Понятные» cards stay.
     * While a known request is in flight the press is ignored like a second click (spec item 11).
     * @param {'plain'|'known'} rank
     * @returns {boolean} true — the panel serves the press (already on `rank`, or switching); false — it cannot
     *   switch now (destroyed, or its first YouTube load still runs): the caller remounts.
     */
    showRank(rank) {
        if (this._destroyed) { return false; }
        if (rank === this._youTubeView) { return true; }
        if (this._sectionState.youtube === 'loading') { return false; }
        this._onKnownPress();
        return true;
    }

    /**
     * Запускает обе секции; промис завершается, когда обе отработали.
     * Никогда не отклоняется — ошибки показываются в секциях.
     * @returns {Promise<void>}
     */
    start() {
        return this._track(Promise.all([this._runYouTube(), this._runFilms()]).then(() => {}));
    }

    /**
     * Дождаться всех начатых загрузок (для тестов и отладки).
     * @returns {Promise<void>}
     */
    async whenIdle() {
        while (this._pending.size > 0) {
            await Promise.allSettled(this._pending);
        }
    }

    /** @returns {string[]} Путь Core (data-поле): у шлюза его нет. */
    getSelectedClipIds() { return []; }

    /** @returns {AbortSignal} Прерывается в destroy(): сохранение, начатое по этой панели, отменяется. */
    get signal() { return this._abort.signal; }

    /**
     * Отмеченные примеры в порядке показа.
     * @returns {import('gateway-anki-media').GatewaySelectedMedia}
     */
    getSelectedGatewayMedia() {
        return {
            films: this._filmCards.filter((c) => this._selectedFilm.has(c.clip.clipId)).map((c) => ({clipId: c.clip.clipId})),
            youtube: this._youTubeCards
                .filter((c) => this._selectedYouTube.has(c.key))
                .map((c) => ({key: c.key, ref: c.ref, startMs: c.startMs, text: c.textEn, words: [...this._words]})),
        };
    }

    /**
     * Untick exactly the given items (the selection a save started with) after that save succeeded, so a second «+»
     * does not add the same clip again. Items ticked since (not in `selection`) stay ticked; unknown ids are ignored.
     * The selection sets, the checkboxes and the `ve-gw-selected` class change together. No-op once destroyed.
     * @param {import('gateway-anki-media').GatewaySelectedMedia} selection
     */
    clearSelection({films, youtube}) {
        if (this._destroyed) { return; }
        for (const {clipId} of films) {
            if (!this._selectedFilm.delete(clipId)) { continue; }
            const card = this._filmCards.find((c) => c.clip.clipId === clipId);
            if (typeof card === 'undefined') { continue; }
            card.checkbox.checked = false;
            card.root.classList.remove('ve-gw-selected');
        }
        for (const {key} of youtube) {
            if (!this._selectedYouTube.delete(key)) { continue; }
            const card = this._youTubeCards.find((c) => c.key === key);
            if (typeof card === 'undefined') { continue; }
            card.checkbox.checked = false;
            card.root.classList.remove('ve-gw-selected');
        }
        this._updateFooter();
    }

    /**
     * A visible status line for one Anki save of the ticked examples (several card formats may save at once). The
     * line shows the most recently updated busy save; when the last one ends with a saved note it shows «Сохранено»
     * for {@link SAVE_STATUS_DONE_MS}. Text only (textContent). Inert after destroy().
     * @returns {import('gateway-anki-media').GatewaySaveStatus}
     */
    beginSaveStatus() {
        if (this._destroyed) { return {update: () => {}, finish: () => {}}; }
        /** @type {{text: string}} */
        const slot = {text: ''};
        this._saveStatuses.push(slot);
        let done = false;
        return {
            update: (text) => {
                if (done || this._destroyed) { return; }
                slot.text = text;
                // Most recently updated first in line.
                this._saveStatuses = [...this._saveStatuses.filter((s) => s !== slot), slot];
                this._renderSaveStatus();
            },
            finish: (saved) => {
                if (done) { return; }
                done = true;
                this._saveStatuses = this._saveStatuses.filter((s) => s !== slot);
                if (this._destroyed) { return; }
                if (saved && !this._saveStatuses.some((s) => s.text.length > 0)) {
                    this._showSaveStatus('done', translate('video.saved'));
                    this._saveStatusTimer = setTimeout(() => {
                        this._saveStatusTimer = null;
                        this._renderSaveStatus();
                    }, SAVE_STATUS_DONE_MS);
                    return;
                }
                this._renderSaveStatus();
            },
        };
    }

    /**
     * Всё, что нужно для сохранения клипа, когда он загружен и у видео есть
     * метаданные (edge case 1). Незагруженный клип ставится в очередь загрузки.
     * @param {string} clipId
     * @param {import('gateway-anki-media').WaitForFilmOptions} options
     * @returns {Promise<import('gateway-anki-media').GatewayFilmMedia>}
     * @throws {GatewayClipWaitError}
     */
    waitForFilmClipMedia(clipId, {timeoutMs, signal}) {
        return new Promise((resolve, reject) => {
            const card = this._filmCards.find((c) => c.clip.clipId === clipId);
            if (this._destroyed) {
                reject(new GatewayClipWaitError('aborted', 'Gateway panel destroyed'));
                return;
            }
            if (typeof card === 'undefined') {
                reject(new GatewayClipWaitError('missing', `Unknown clip ${clipId}`));
                return;
            }
            /** @type {?ReturnType<typeof setTimeout>} */
            let timer = null;
            const onAbort = () => {
                finish(() => { reject(new GatewayClipWaitError('aborted', 'Clip wait aborted')); });
            };
            /**
             * @param {() => void} settle
             */
            const finish = (settle) => {
                card.listeners.delete(check);
                if (timer !== null) { clearTimeout(timer); }
                timer = null;
                signal?.removeEventListener('abort', onAbort);
                settle();
            };
            const check = () => {
                if (this._destroyed || (card.blob === null && card.state === 'ready')) {
                    finish(() => { reject(new GatewayClipWaitError('aborted', 'Gateway panel destroyed')); });
                    return;
                }
                const media = this._getFilmMedia(card);
                if (media !== null) {
                    finish(() => { resolve(media); });
                    return;
                }
                if (card.mediaError || (card.state === 'failed' && !card.retryable)) {
                    finish(() => { reject(new GatewayClipWaitError('failed', 'Clip failed to load')); });
                }
            };
            if (signal?.aborted === true) {
                reject(new GatewayClipWaitError('aborted', 'Clip wait aborted'));
                return;
            }
            card.listeners.add(check);
            signal?.addEventListener('abort', onAbort, {once: true});
            timer = setTimeout(() => {
                finish(() => { reject(new GatewayClipWaitError('timeout', `Clip ${clipId} not ready in ${timeoutMs} ms`)); });
            }, timeoutMs);
            check();
            if (!card.listeners.has(check)) { return; }
            // Ещё не грузился (не попадал в область видимости) или сорвался у нас — загрузить.
            if (card.state === 'idle' || (card.state === 'failed' && card.retryable)) { this._activateCard(card); }
        });
    }

    /** @param {'compact'|'large'} density */
    setDensity(density) {
        if (density === 'compact' || density === 'large') { this._root.dataset.density = density; }
    }

    /**
     * Повторное Ex по «тупиковой» панели перезапускает её: обе секции
     * кончились ошибкой или пустотой.
     * @returns {boolean}
     */
    isTerminal() {
        const done = (/** @type {SectionState} */ state) => state === 'error' || state === 'empty';
        return done(this._sectionState.youtube) && done(this._sectionState.films);
    }

    /** @returns {?('user'|'content')} Почему панель уничтожена; null — жива. */
    get destroyReason() { return this._destroyReason; }

    /**
     * Убрать из DOM, остановить загрузки, отозвать blob-URL.
     * @param {'user'|'content'} [reason] 'user' — закрыл/перезапустил сам (сохранение сообщит об отмене);
     *   'content' — новый поиск/выгрузка (отмена молча).
     */
    destroy(reason = 'content') {
        if (this._destroyed) { return; }
        this._destroyed = true;
        this._destroyReason = reason;
        this._abort.abort();
        // The loader cancels the running «Понятные» job once (H1); nothing it answers later reaches the DOM.
        this._undController?.abort();
        this._undController = null;
        this._youTubeTexts = [];
        if (this._saveStatusTimer !== null) {
            clearTimeout(this._saveStatusTimer);
            this._saveStatusTimer = null;
        }
        this._saveStatuses = [];
        if (this._observer !== null) {
            this._observer.disconnect();
            this._observer = null;
        }
        for (const card of this._filmCards) {
            card.disposeSubtitles?.();
            card.disposeSubtitles = null;
            if (card.video === null) { continue; }
            try {
                card.video.pause();
                card.video.removeAttribute('src');
                card.video.load();
            } catch (e) {
                // Элемент уже отцеплен — не важно.
            }
        }
        for (const url of this._blobUrls) { URL.revokeObjectURL(url); }
        this._blobUrls.clear();
        this._selectedFilm.clear();
        this._selectedYouTube.clear();
        for (const card of this._filmCards) {
            card.blob = null;
            card.info = null;
            this._notifyCard(card);
            card.listeners.clear();
        }
        if (this._root.parentNode !== null) { this._root.parentNode.removeChild(this._root); }
    }

    // Private

    /**
     * @template T
     * @param {Promise<T>} promise
     * @returns {Promise<T>}
     */
    _track(promise) {
        /** @type {Promise<void>} */
        const settled = promise.then(() => {}, () => {});
        this._pending.add(settled);
        void settled.then(() => { this._pending.delete(settled); });
        return promise;
    }

    /**
     * Review M5: шлюз отказал по ключу/доступу/квоте/сервису, а anki_conf
     * запущен — одна кнопка на панель, открывающая примеры через Core.
     * @param {?string} code
     */
    _offerCoreFallback(code) {
        if (this._coreFallbackButton !== null || this._destroyed) { return; }
        const {onCoreFallback} = this._hooks;
        if (typeof onCoreFallback !== 'function' || !isCoreFallbackError(code) || !this._canFallbackToCore()) { return; }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 've-gw-core-fallback';
        button.textContent = translate('video.showViaCore');
        button.addEventListener('click', () => { onCoreFallback(); });
        this._coreFallbackButton = button;
        const header = this._root.querySelector('.entry-video-examples-header');
        (header ?? this._root).appendChild(button);
    }

    /**
     * @param {'compact'|'large'} density
     * @returns {HTMLElement}
     */
    _buildRoot(density) {
        const root = document.createElement('div');
        root.className = 'entry-video-examples ve-gw';
        root.dataset.source = 'gateway';
        root.dataset.state = 'ready';
        root.dataset.density = density;
        // The phrase toolbar lights the button of the view on screen (flib-card.css); _showYouTubeSet keeps it (K1).
        root.dataset.examplesRank = this._youTubeView;

        const header = document.createElement('div');
        header.className = 'entry-video-examples-header';
        const top = document.createElement('div');
        top.className = 'entry-video-examples-header-top';

        const title = document.createElement('span');
        title.className = 'entry-video-examples-title';
        title.textContent = translate('examples.button');
        top.appendChild(title);

        const wordPill = document.createElement('span');
        wordPill.className = 'entry-video-examples-word-pill';
        const wordText = document.createElement('span');
        wordText.className = 'entry-video-examples-word-text';
        wordText.textContent = this._word;
        wordPill.appendChild(wordText);
        top.appendChild(wordPill);

        const spacer = document.createElement('span');
        spacer.className = 'entry-video-examples-header-spacer';
        top.appendChild(spacer);

        const refreshBtn = document.createElement('button');
        refreshBtn.type = 'button';
        refreshBtn.className = 'entry-video-examples-icon-btn entry-video-examples-icon-refresh';
        refreshBtn.title = translate('video.searchAgain');
        refreshBtn.setAttribute('aria-label', translate('video.searchAgain'));
        refreshBtn.textContent = '↻';
        refreshBtn.addEventListener('click', () => { this._hooks.onRetry(); });
        top.appendChild(refreshBtn);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'entry-video-examples-icon-btn entry-video-examples-icon-close';
        closeBtn.title = translate('common.close');
        closeBtn.setAttribute('aria-label', translate('common.close'));
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => { this._hooks.onCancel(); });
        top.appendChild(closeBtn);

        header.appendChild(top);

        if (this._search.truncated) {
            const truncated = document.createElement('div');
            truncated.className = 've-gw-truncated-note';
            truncated.textContent = translate('video.truncatedQuery');
            header.appendChild(truncated);
        }

        const tabs = document.createElement('div');
        tabs.className = 'fc-tabs';
        tabs.setAttribute('role', 'tablist');
        for (const [name, label] of /** @type {[SectionName, string][]} */ ([['youtube', 'YouTube'], ['films', translate('video.films')]])) {
            const tab = document.createElement('button');
            tab.type = 'button';
            tab.className = 'fc-tab';
            tab.setAttribute('role', 'tab');
            tab.dataset.tab = name;
            const count = document.createElement('span');
            count.className = 'fc-tab-n';
            count.textContent = '…';
            tab.append(label, count);
            tab.addEventListener('click', () => { this._setTab(name, true); });
            tabs.appendChild(tab);
            this._tabButtons[name] = tab;
        }
        header.appendChild(tabs);

        // Save progress of the ticked examples: in the header, next to what was ticked, shared by all card formats.
        const saveStatus = document.createElement('div');
        saveStatus.className = 've-gw-save-status';
        // ⚠️ Always rendered, never `hidden`: a live region shown in the same tick as its text is often not announced.
        // role="status" already implies aria-live="polite". Idle = empty; CSS reserves one line so cards do not jump.
        saveStatus.setAttribute('role', 'status');
        header.appendChild(saveStatus);
        this._saveStatusEl = saveStatus;

        root.appendChild(header);
        return root;
    }

    /** Show the most recently updated busy save, or nothing. Cancels a pending «Сохранено». */
    _renderSaveStatus() {
        const busy = this._saveStatuses.filter((s) => s.text.length > 0);
        const latest = busy.length > 0 ? busy[busy.length - 1] : null;
        if (latest === null) {
            this._showSaveStatus(null, '');
        } else {
            this._showSaveStatus('busy', latest.text);
        }
    }

    /**
     * @param {?('busy'|'done')} state null — idle (empty).
     * @param {string} text
     */
    _showSaveStatus(state, text) {
        if (this._saveStatusTimer !== null) {
            clearTimeout(this._saveStatusTimer);
            this._saveStatusTimer = null;
        }
        const el = this._saveStatusEl;
        if (el === null) { return; }
        el.textContent = text;
        if (state === null) {
            delete el.dataset.state;
        } else {
            el.dataset.state = state;
        }
    }

    /**
     * @param {SectionName} name
     * @param {string} titleText
     * @returns {SectionElements}
     */
    _buildSection(name, titleText) {
        const root = document.createElement('section');
        root.className = 've-gw-section';
        root.dataset.section = name;
        root.dataset.state = 'loading';
        const title = document.createElement('div');
        title.className = 've-gw-section-title';
        title.textContent = titleText;
        root.appendChild(title);
        const message = document.createElement('div');
        message.className = 've-gw-section-message';
        message.setAttribute('aria-live', 'polite');
        root.appendChild(message);
        /** @type {?HTMLElement} */
        let tools = null;
        if (name === 'youtube') {
            // ⚠️ Не в .ve-gw-section-title: тот скрыт (display: none) в flib-card.css.
            tools = this._buildYouTubeTools();
            root.appendChild(tools);
            const note = document.createElement('div');
            note.className = 've-gw-known-note';
            // ⚠️ Always rendered, never `hidden` (see .ve-gw-save-status): role="status" implies aria-live="polite".
            note.setAttribute('role', 'status');
            root.appendChild(note);
            this._knownNote = note;
            const undNote = document.createElement('div');
            undNote.className = 've-gw-und-note';
            // Always rendered, like the known note: role="status" implies aria-live="polite".
            undNote.setAttribute('role', 'status');
            root.appendChild(undNote);
            this._undNote = undNote;
            const undList = document.createElement('div');
            undList.className = 've-gw-und-list';
            root.appendChild(undList);
            this._undList = undList;
        }
        const list = document.createElement('div');
        list.className = name === 'youtube' ? 've-gw-section-list ve-gw-yt-list' : 've-gw-section-list ve-gw-film-list';
        root.appendChild(list);
        return {root, message, list, tools};
    }

    /**
     * Ряд инструментов YouTube: «С учётом моих знаний» и «Понятные».
     * @returns {HTMLElement}
     */
    _buildYouTubeTools() {
        const tools = document.createElement('div');
        tools.className = 've-gw-section-tools scan-disable';
        tools.hidden = true;
        const known = document.createElement('button');
        known.type = 'button';
        known.className = 'fc-btn ve-gw-known';
        known.setAttribute('aria-pressed', this._youTubeView === 'known' ? 'true' : 'false');
        known.textContent = translate('video.known');
        known.addEventListener('click', () => { this._onKnownPress(); });
        this._knownButton = known;
        const understandable = document.createElement('button');
        understandable.type = 'button';
        understandable.className = 'fc-btn ve-gw-understandable';
        understandable.textContent = translate('video.understandable');
        understandable.title = translate(this._search.target.mode === 'quote' ? 'video.undTitlePhrase' : 'video.undTitle');
        understandable.addEventListener('click', () => { this._onUnderstandablePress(); });
        this._undButton = understandable;
        tools.append(known, understandable);
        return tools;
    }

    /**
     * @param {SectionName} name
     * @param {SectionState} state
     * @param {string} message
     * @param {?string} [code] Код ошибки шлюза: для ключевых — блок помощи с ключом.
     */
    _setSection(name, state, message, code = null) {
        const section = name === 'youtube' ? this._youtube : this._films;
        this._sectionState[name] = state;
        if (name === 'youtube') { this._youTubeSection = {state, message, code}; }
        section.root.dataset.state = state;
        section.message.textContent = message;
        section.message.hidden = message.length === 0;
        // Ready, empty and error keep the tools: the known-words button helps exactly there too (C2).
        if (section.tools !== null) { section.tools.hidden = state === 'loading'; }
        for (const old of section.root.querySelectorAll(':scope>.fc-xp-help')) { old.remove(); }
        if (state === 'error' && needsKeyHelp(code)) {
            const help = createFlibKeyHelp({api: this._api, variant: keyHelpVariant(code), onSaved: () => { this._hooks.onRetry(); }});
            section.message.after(help);
        }
        this._syncTabs();
    }

    /** @returns {Promise<void>} */
    async _runYouTube() {
        this._setSection('youtube', 'loading', translate('video.loading'));
        if (this._search.initialRank === 'known') {
            // Phrase «С учётом моих знаний»: no ordinary request first (spec item 8).
            await this._runKnownTask(() => this._requestKnown());
            return;
        }
        try {
            const result = await this._fetchPlainYouTube();
            if (this._destroyed) { return; }
            this._applyPlainResult(result);
        } catch (e) {
            if (this._destroyed) { return; }
            const {code, status, retryAfterSec} = getGatewayErrorDetails(e);
            log.log(`[gateway-examples] YouTube failed: ${code ?? String(e)}`);
            // K5: the phrase «Примеры» ask the batch: its 429/503/5xx get the same texts as the knowledge buttons
            // (with «через N с»). The anki_conf offer stays — it is the ordinary examples button.
            const text = this._search.target.mode === 'quote' ? describeKnowledgeError(code, status, retryAfterSec) : describeGatewayError(code, 'youtube');
            this._setSection('youtube', 'error', text, code);
            this._offerCoreFallback(code);
        }
    }

    /**
     * The ordinary YouTube list. A quote target asks the plain batch first; when the batch axis is off (404) it
     * falls back to `/v1/examples` with the 80-code-point cut. A lemma asks `/v1/examples` as before.
     * @returns {Promise<PlainYouTubeResult>}
     */
    async _fetchPlainYouTube() {
        const {target} = this._search;
        if (target.mode === 'quote') {
            try {
                const result = await this._loader.loadBatch(target, 'plain');
                const emptyReason = result.items.length === 0 && result.partial && result.emptyReason === null ? 'budget_exhausted' : result.emptyReason;
                return {items: result.items, emptyReason};
            } catch (e) {
                if (getGatewayErrorCode(e) !== 'flib_axis_off') { throw e; }
            }
            if (this._destroyed) { return {items: [], emptyReason: null}; }
        }
        return await this._loader.loadYouTube(this._plainQuery);
    }

    /**
     * Show an ordinary answer: it becomes the plain set and the section reflects it (this IS the plain path).
     * @param {PlainYouTubeResult} result
     */
    _applyPlainResult(result) {
        const items = sanitizeYouTubeItems(result.items);
        this._forgetYouTubeTexts(this._plainCards);
        this._plainCards = items.map((item) => this._buildYouTubeCard(item, null));
        this._plainSectionToRestore = null;
        this._showYouTubeSet('plain');
        if (items.length === 0 && this._undCards.length > 0) {
            // K7: «Понятные» cards fill the section — no «0» and no «нет примеров» above found videos.
            this._setSection('youtube', 'ready', '');
            return;
        }
        if (items.length === 0) {
            this._setSection('youtube', 'empty', describeEmptyReason(result.items.length > 0 ? 'no_usable_examples' : result.emptyReason, 'youtube'));
            return;
        }
        this._setSection('youtube', 'ready', '');
    }

    /**
     * Put one set on screen. The hidden set is unticked (controller ruling, C2) — a save never takes cards the user
     * cannot see; the tab count follows the visible set.
     * @param {'plain'|'known'} view
     */
    _showYouTubeSet(view) {
        const visible = (view === 'known' ? this._knownCards : this._plainCards) ?? [];
        const hidden = (view === 'known' ? this._plainCards : this._knownCards) ?? [];
        this._untickCards(hidden);
        this._youTubeView = view;
        this._root.dataset.examplesRank = view;
        this._youTubeCards = visible;
        for (const card of visible) { this._shownYouTubeRefs.add(card.ref); }
        this._youtube.list.replaceChildren(...visible.map((card) => card.root));
        this._knownButton?.setAttribute('aria-pressed', view === 'known' ? 'true' : 'false');
        this._updateFooter();
        this._syncTabs();
    }

    /**
     * @param {?YouTubeCard[]} cards
     */
    _untickCards(cards) {
        if (cards === null) { return; }
        for (const card of cards) {
            this._selectedYouTube.delete(card.key);
            card.checkbox.checked = false;
            card.root.classList.remove('ve-gw-selected');
        }
    }

    /** «С учётом моих знаний»: press → known list, press again → the stored ordinary list (spec item 2). */
    _onKnownPress() {
        if (this._destroyed || this._knownBusy) { return; }
        if (this._youTubeView === 'known') {
            this._setKnownNote(null);
            if (this._plainCards === null) {
                // Opened straight in the known mode: the ordinary list was never asked — this press asks it (M5).
                void this._track(this._runKnownTask(() => this._restorePlainByRequest()));
                return;
            }
            this._showYouTubeSet('plain');
            const restore = this._plainSectionToRestore;
            this._plainSectionToRestore = null;
            // «Понятные» cards on screen: the ordinary empty/error message stays cleared (they fill the section).
            if (restore !== null && this._undCards.length === 0) { this._setSection('youtube', restore.state, restore.message, restore.code); }
            return;
        }
        if (this._knownEmptyText !== null) {
            this._setKnownNote(this._knownEmptyText);
            return;
        }
        if (this._knownCards !== null && this._knownComplete) {
            this._showKnownCards();
            this._setKnownNote(this._knownCachedNote);
            return;
        }
        void this._track(this._runKnownTask(() => this._requestKnown()));
    }

    /** «Попробовать ещё раз» after the server ran out of time: a new known request. */
    _onKnownRetry() {
        if (this._destroyed || this._knownBusy) { return; }
        void this._track(this._runKnownTask(() => this._requestKnown()));
    }

    /**
     * Busy guard (spec item 11): while it runs the button is aria-busy and further presses are ignored.
     * @param {() => Promise<void>} task
     * @returns {Promise<void>}
     */
    async _runKnownTask(task) {
        this._knownBusy = true;
        this._knownButton?.setAttribute('aria-busy', 'true');
        try {
            await task();
        } finally {
            this._knownBusy = false;
            if (!this._destroyed) { this._knownButton?.removeAttribute('aria-busy'); }
        }
    }

    /**
     * One known-words batch call. Results and errors go to the note; only the very first load of a panel opened
     * in the known mode (the section is still loading) uses the section. Never offers anki_conf (H4).
     * @returns {Promise<void>}
     */
    async _requestKnown() {
        const initial = this._sectionState.youtube === 'loading';
        if (!initial) { this._setKnownNote(null); }
        /** @type {import('flib-gateway-examples').BatchSectionResult} */
        let result;
        try {
            result = await this._loader.loadBatch(this._search.target, 'known');
        } catch (e) {
            if (this._destroyed) { return; }
            const {code, status, retryAfterSec} = getGatewayErrorDetails(e);
            log.log(`[gateway-examples] known-words examples failed: ${code ?? String(e)}`);
            const text = describeKnowledgeError(code, status, retryAfterSec);
            if (initial) {
                this._setSection('youtube', 'error', text, code);
            } else {
                this._setKnownNote(text, {code});
            }
            return;
        }
        if (this._destroyed) { return; }
        const timedOut = result.partial || result.emptyReason === 'budget_exhausted';
        if (result.items.length === 0) {
            const text = describeEmptyReason(result.emptyReason ?? (timedOut ? 'budget_exhausted' : null), 'youtube');
            if (!timedOut && result.emptyReason !== null && KNOWN_FINAL_EMPTY_REASONS.has(result.emptyReason)) { this._knownEmptyText = text; }
            if (initial) {
                this._setSection('youtube', 'empty', text);
                if (timedOut) { this._setKnownNote('', {retry: true}); }
            } else {
                this._setKnownNote(text, {retry: timedOut});
            }
            return;
        }
        // known_share is only meaningful for a route-ranked answer (spec: no «понятно» for none/pending).
        const ranked = result.knownSource === 'route';
        this._untickCards(this._knownCards);
        this._forgetYouTubeTexts(this._knownCards);
        this._knownCards = result.items.map((item) => this._buildYouTubeCard(item, ranked ? item.known_share : null));
        // K3: route and none are answers; pending (known words still loading) and a partial answer are asked again.
        this._knownComplete = !timedOut && result.knownSource !== 'pending';
        this._knownCachedNote = result.knownSource === 'none' ? translate('video.knownNone') : null;
        this._showKnownCards();
        if (timedOut) {
            this._setKnownNote(translate('gateway.serverTooSlow'), {retry: true});
        } else if (result.knownSource === 'pending') {
            this._setKnownNote(translate('video.knownPending'));
        } else {
            this._setKnownNote(this._knownCachedNote);
        }
    }

    /**
     * Show the known set. If the ordinary section was empty or failed, it is marked ready while the known list is
     * on screen and restored on the way back.
     */
    _showKnownCards() {
        this._showYouTubeSet('known');
        const current = this._youTubeSection;
        if (current.state === 'ready') { return; }
        if (current.state !== 'loading') { this._plainSectionToRestore = current; }
        this._setSection('youtube', 'ready', '');
    }

    /**
     * M5: un-pressing with no ordinary list stored asks for it (allowed: it is a press). A failure stays in the note
     * and the known list stays on screen.
     * @returns {Promise<void>}
     */
    async _restorePlainByRequest() {
        /** @type {PlainYouTubeResult} */
        let result;
        try {
            result = await this._fetchPlainYouTube();
        } catch (e) {
            if (this._destroyed) { return; }
            const {code, status, retryAfterSec} = getGatewayErrorDetails(e);
            log.log(`[gateway-examples] YouTube failed: ${code ?? String(e)}`);
            this._setKnownNote(describeKnowledgeError(code, status, retryAfterSec), {code});
            return;
        }
        if (this._destroyed) { return; }
        this._applyPlainResult(result);
    }

    /**
     * The note under the tools: text only (textContent), an optional retry button and, for key/quota/demo codes,
     * the key help (M7). null clears it.
     * @param {?string} text
     * @param {{retry?: boolean, code?: ?string}} [options]
     */
    _setKnownNote(text, {retry = false, code = null} = {}) {
        const note = this._knownNote;
        if (note === null || this._destroyed) { return; }
        note.replaceChildren();
        if (text === null) { return; }
        if (text.length > 0) {
            const textEl = document.createElement('span');
            textEl.className = 've-gw-known-note-text';
            textEl.textContent = text;
            note.appendChild(textEl);
        }
        if (retry) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'fc-btn ve-gw-known-retry';
            button.textContent = translate('video.knownRetry');
            button.addEventListener('click', () => { this._onKnownRetry(); });
            note.appendChild(button);
        }
        if (needsKeyHelp(code)) {
            note.appendChild(createFlibKeyHelp({api: this._api, variant: keyHelpVariant(code), onSaved: () => { this._hooks.onRetry(); }}));
        }
    }

    /**
     * Cards replaced for good (a new known answer): their lines no longer need re-highlighting.
     * @param {?YouTubeCard[]} cards
     */
    _forgetYouTubeTexts(cards) {
        if (cards === null || cards.length === 0) { return; }
        const roots = new Set(cards.map((card) => card.root));
        this._youTubeTexts = this._youTubeTexts.filter((entry) => !roots.has(entry.root));
    }

    /**
     * «Понятные» (spec item 3): one job per press for the panel's target, excluding every video already shown here.
     * The loader runs start/poll/cancel (H1); the press owns an AbortController that «Отменить» and destroy() abort.
     */
    _onUnderstandablePress() {
        if (this._destroyed || this._undController !== null) { return; }
        const controller = new AbortController();
        this._undController = controller;
        this._undButton?.setAttribute('aria-busy', 'true');
        this._setUndNote(translate('video.undSearching'), {cancel: true});
        void this._track(this._runUnderstandable(controller));
    }

    /** «Отменить»: abort the job (the loader DELETEs it) and clear the note at once; a new press may start. */
    _onUnderstandableCancel() {
        const controller = this._undController;
        if (controller === null || this._destroyed) { return; }
        this._undController = null;
        controller.abort();
        this._undButton?.removeAttribute('aria-busy');
        this._setUndNote(null);
    }

    /**
     * @param {AbortController} controller
     * @returns {Promise<void>}
     */
    async _runUnderstandable(controller) {
        const {signal} = controller;
        try {
            const excludeVideoIds = [...this._shownYouTubeRefs].slice(-UNDERSTANDABLE_EXCLUDE_MAX);
            /** @type {import('flib-gateway-examples').UnderstandableRunResult} */
            let result;
            try {
                result = await this._loader.runUnderstandable({target: this._search.target, excludeVideoIds}, {signal});
            } catch (e) {
                if (this._destroyed || signal.aborted) { return; }
                const {code, status, retryAfterSec} = getGatewayErrorDetails(e);
                log.log(`[gateway-examples] understandable videos failed: ${code ?? String(e)}`);
                this._showUnderstandableError(code, status, retryAfterSec);
                return;
            }
            if (this._destroyed || signal.aborted) { return; }
            this._applyUnderstandable(result);
        } finally {
            if (this._undController === controller) {
                this._undController = null;
                if (!this._destroyed) { this._undButton?.removeAttribute('aria-busy'); }
            }
        }
    }

    /**
     * @param {?string} code
     * @param {?number} status
     * @param {?number} retryAfterSec
     */
    _showUnderstandableError(code, status, retryAfterSec) {
        if (code === 'understandable_demo_forbidden') {
            this._setUndNote(translate('video.undFullKey'), {keyHelp: 'limit'});
            return;
        }
        // K6: a paid key without the route permission gets the same refusal — not the «buy a full key» advice
        // (the non-buy help variant: keyHelpVariant() would map it to 'limit' = buy).
        if (code === 'route_forbidden') {
            this._setUndNote(translate('video.undNoAccess'), {keyHelp: 'need'});
            return;
        }
        if (code === 'route_profile_missing') {
            this._setUndNote(translate('video.undRouteMissing'));
            return;
        }
        if (code === 'flib_job_not_found') {
            this._setUndNote(translate('video.undInterrupted'));
            return;
        }
        this._setUndNote(describeKnowledgeError(code, status, retryAfterSec), {keyHelp: needsKeyHelp(code) ? keyHelpVariant(code) : null});
    }

    /**
     * @param {import('flib-gateway-examples').UnderstandableRunResult} result
     */
    _applyUnderstandable(result) {
        if (result.status === 'cancelled') {
            this._setUndNote(translate('video.undInterrupted'));
            return;
        }
        if (result.status !== 'done') {
            // timeout (75 s, already cancelled), failed, expired.
            this._setUndNote(translate('gateway.serverTooSlow'));
            return;
        }
        if (result.items.length === 0) {
            this._setUndNote(describeUnderstandableEmpty(result.emptyReason, result.partial, this._search.target.mode));
            return;
        }
        this._setUndNote(null);
        const cards = result.items.map((item) => this._buildUnderstandableCard(item));
        for (const card of cards) { this._shownYouTubeRefs.add(card.ref); }
        this._undCards = [...cards, ...this._undCards];
        this._undList?.prepend(...cards.map((card) => card.root));
        // The cards fill the section: an ordinary empty/error message would sit above found videos.
        if (this._youTubeSection.state === 'empty' || this._youTubeSection.state === 'error') {
            this._setSection('youtube', 'ready', '');
        } else {
            this._syncTabs();
        }
    }

    /**
     * Thumbnail, «понятно N% ролика», duration, title and the first line with the target. Server text via
     * textContent only. A click plays the video from the first hit to its end (H2: end_ms null; no hit → from the
     * start, and never the title as a subtitle).
     * @param {import('flib-gateway').UnderstandableItem} item
     * @returns {UnderstandableCard}
     */
    _buildUnderstandableCard(item) {
        const root = document.createElement('div');
        root.className = 've-gw-yt-card ve-gw-und-card';
        root.tabIndex = 0;
        root.setAttribute('role', 'button');
        root.dataset.ref = item.video_id;
        const hit = item.target_hits.length > 0 ? item.target_hits[0] : null;

        const thumb = document.createElement('div');
        thumb.className = 've-gw-yt-thumb';
        const thumbUrl = buildYouTubeThumbUrl(item.video_id);
        if (thumbUrl !== null) {
            const img = document.createElement('img');
            img.src = thumbUrl;
            img.alt = '';
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            thumb.appendChild(img);
        }
        const duration = typeof item.duration_s === 'number' ? formatTimeRange(item.duration_s * 1000, null) : '';
        if (duration.length > 0) {
            const timeEl = document.createElement('span');
            timeEl.className = 've-gw-yt-time';
            timeEl.textContent = duration;
            thumb.appendChild(timeEl);
        }
        if (typeof item.coverage === 'number' && Number.isFinite(item.coverage)) {
            const badge = document.createElement('span');
            badge.className = 've-gw-known-badge ve-gw-und-badge';
            badge.textContent = translate('video.undCoverage', {percent: Math.round(Math.min(1, Math.max(0, item.coverage)) * 100)});
            thumb.appendChild(badge);
        }
        root.appendChild(thumb);

        const body = document.createElement('div');
        body.className = 've-gw-und-body';
        if (typeof item.title === 'string' && item.title.length > 0) {
            const title = document.createElement('div');
            title.className = 've-gw-und-title';
            title.textContent = item.title;
            body.appendChild(title);
        }
        const hitText = hit !== null && typeof hit.text_en === 'string' && hit.text_en.length > 0 ? hit.text_en : null;
        if (hitText !== null) {
            const text = document.createElement('div');
            text.className = 've-gw-yt-text';
            appendHighlightedParts(text, highlightCueParts(hitText, this._words));
            this._youTubeTexts.push({el: text, text: hitText, root});
            body.appendChild(text);
        }
        root.appendChild(body);

        /** @type {import('flib-gateway').ExampleItem} */
        const openItem = {
            source: 'youtube',
            ref: item.video_id,
            start_ms: hit !== null && Number.isFinite(hit.from_ms) ? hit.from_ms : 0,
            end_ms: null,
            text_en: hitText,
            text_ru: null,
            thumbnail_url: null,
        };
        const open = () => { this._hooks.onYouTubeOpen(openItem, this._words); };
        root.addEventListener('click', open);
        root.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
            }
        });
        return {ref: item.video_id, root};
    }

    /**
     * The «Понятные» note: text (textContent), optionally «Отменить» or the key help. null clears it.
     * @param {?string} text
     * @param {{cancel?: boolean, keyHelp?: ?('need'|'limit')}} [options]
     */
    _setUndNote(text, {cancel = false, keyHelp = null} = {}) {
        const note = this._undNote;
        if (note === null || this._destroyed) { return; }
        note.replaceChildren();
        if (text === null) { return; }
        const textEl = document.createElement('span');
        textEl.className = 've-gw-und-note-text';
        textEl.textContent = text;
        note.appendChild(textEl);
        if (cancel) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'fc-btn ve-gw-und-cancel';
            button.textContent = translate('video.undCancel');
            button.addEventListener('click', () => { this._onUnderstandableCancel(); });
            note.appendChild(button);
        }
        if (keyHelp !== null) {
            note.appendChild(createFlibKeyHelp({api: this._api, variant: keyHelp, onSaved: () => { this._hooks.onRetry(); }}));
        }
    }

    /** @returns {Promise<void>} */
    async _runFilms() {
        this._setSection('films', 'loading', translate('video.searching'));
        try {
            const result = await this._loader.loadFilms(this._plainQuery, {
                signal: this._abort.signal,
                onPhase: (phase) => {
                    if (this._destroyed) { return; }
                    this._setSection('films', 'loading', phase === 'cutting' ? translate('video.cuttingClips') : translate('video.searching'));
                },
            });
            if (this._destroyed) { return; }
            this._extendHighlight(result.lemma, result.matchedForms);
            if (result.clips.length === 0) {
                this._setSection('films', 'empty', describeEmptyReason(result.emptyReason, 'films'));
                return;
            }
            for (const clip of result.clips) {
                const card = this._buildFilmCard(clip);
                this._filmCards.push(card);
                this._films.list.appendChild(card.root);
            }
            this._setSection('films', 'ready', '');
            this._observeFilmCards();
        } catch (e) {
            if (this._destroyed) { return; }
            const code = getGatewayErrorCode(e);
            log.log(`[gateway-examples] films failed: ${code ?? String(e)}`);
            this._setSection('films', 'error', describeGatewayError(code, 'films'), code);
            this._offerCoreFallback(code);
        }
    }

    /**
     * Задание word_examples вернуло лемму и найденные формы: добавить их к
     * подсветке и перекрасить уже показанные строки YouTube (секции грузятся
     * параллельно, YouTube обычно раньше).
     * @param {?string | undefined} lemma
     * @param {string[] | undefined} matchedForms
     */
    _extendHighlight(lemma, matchedForms) {
        const extraTerms = typeof lemma === 'string' && lemma.length > 0 ? [lemma] : [];
        const extraExact = Array.isArray(matchedForms) ? matchedForms : [];
        if (extraTerms.length === 0 && extraExact.length === 0) { return; }
        this._highlightTerms = [...this._highlightTerms, ...extraTerms];
        this._highlightExact = [...this._highlightExact, ...extraExact];
        this._words = buildHighlightMatcher({terms: this._highlightTerms, forms: this._highlightExact});
        for (const {el, text} of this._youTubeTexts) {
            el.replaceChildren();
            appendHighlightedParts(el, highlightCueParts(text, this._words));
        }
    }

    /**
     * Build one YouTube card; the caller puts it into the plain or the known set.
     * @param {import('flib-gateway').ExampleItem} item
     * @param {?number} knownShare 0..1 → a «понятно N%» badge; null — none.
     * @returns {YouTubeCard}
     */
    _buildYouTubeCard(item, knownShare) {
        const card = document.createElement('div');
        card.className = 've-gw-yt-card';
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.dataset.ref = item.ref;

        // A counter, not ref+start: two identical items must stay two independent checkboxes; never the set's
        // length either — the plain and the known sets live side by side (C2).
        const key = String(this._youTubeKeySeq++);
        const {label, input: checkbox} = this._createSelectCheckbox('inline', (checked) => {
            if (checked) {
                this._selectedYouTube.add(key);
            } else {
                this._selectedYouTube.delete(key);
            }
            card.classList.toggle('ve-gw-selected', checked);
            this._updateFooter();
        });
        card.appendChild(label);
        /** @type {YouTubeCard} */
        const ytCard = {key, root: card, checkbox, ref: item.ref, startMs: item.start_ms, textEn: item.text_en};

        const thumbUrl = buildYouTubeThumbUrl(item.ref);
        const thumb = document.createElement('div');
        thumb.className = 've-gw-yt-thumb';
        if (thumbUrl !== null) {
            const img = document.createElement('img');
            img.src = thumbUrl;
            img.alt = '';
            img.loading = 'lazy';
            img.referrerPolicy = 'no-referrer';
            thumb.appendChild(img);
        }
        const time = formatTimeRange(item.start_ms, item.end_ms);
        if (time.length > 0) {
            const timeEl = document.createElement('span');
            timeEl.className = 've-gw-yt-time';
            timeEl.textContent = time;
            thumb.appendChild(timeEl);
        }
        if (typeof knownShare === 'number' && Number.isFinite(knownShare)) {
            const badge = document.createElement('span');
            badge.className = 've-gw-known-badge';
            badge.textContent = translate('video.knownBadge', {percent: Math.round(Math.min(1, Math.max(0, knownShare)) * 100)});
            thumb.appendChild(badge);
        }
        card.appendChild(thumb);

        const text = document.createElement('div');
        text.className = 've-gw-yt-text';
        appendHighlightedParts(text, highlightCueParts(item.text_en ?? '', this._words));
        this._youTubeTexts.push({el: text, text: item.text_en ?? '', root: card});
        card.appendChild(text);

        const open = () => { this._hooks.onYouTubeOpen(item, this._words); };
        card.addEventListener('click', open);
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
            }
        });
        return ytCard;
    }

    /**
     * @param {import('flib-gateway-examples').FilmClip} clip
     * @returns {FilmCard}
     */
    _buildFilmCard(clip) {
        const root = document.createElement('div');
        root.className = 've-gw-film-card';
        root.dataset.clipId = clip.clipId;

        const media = document.createElement('div');
        media.className = 've-gw-film-media';
        root.appendChild(media);

        const subtitle = document.createElement('div');
        subtitle.className = 've-gw-film-subtitle';
        const text = clip.subs.map((s) => (typeof s === 'object' && s !== null && typeof s.text === 'string' ? s.text.trim() : '')).filter((t) => t.length > 0).join(' ');
        appendHighlightedParts(subtitle, highlightCueParts(text, this._words));
        root.appendChild(subtitle);

        const meta = document.createElement('div');
        meta.className = 've-gw-film-meta';
        if (typeof clip.year === 'number') { this._appendMetaItem(meta, 've-gw-film-year', String(clip.year)); }
        if (typeof clip.cefr === 'string' && clip.cefr.length > 0) { this._appendMetaItem(meta, 've-gw-film-cefr', clip.cefr); }
        root.appendChild(meta);

        const {label, input: checkbox} = this._createSelectCheckbox('floating', (checked) => {
            if (checked) {
                this._selectedFilm.add(clip.clipId);
            } else {
                this._selectedFilm.delete(clip.clipId);
            }
            root.classList.toggle('ve-gw-selected', checked);
            this._updateFooter();
        });
        checkbox.disabled = true;
        root.appendChild(label);

        /** @type {FilmCard} */
        const card = {
            clip,
            root,
            media,
            meta,
            state: 'idle',
            video: null,
            disposeSubtitles: null,
            retryable: false,
            checkbox,
            blob: null,
            info: null,
            mediaMeta: null,
            mediaError: false,
            listeners: new Set(),
        };
        if (clip.status === 'failed') {
            this._setCardState(card, 'failed', describeGatewayError('flib_clip_failed', 'films'));
        } else {
            // L4: плитка — кнопка и для клавиатуры (Enter/Space), пока видео не встало.
            media.setAttribute('role', 'button');
            media.tabIndex = 0;
            media.setAttribute('aria-label', translate('video.loadClip'));
            this._setCardState(card, 'idle', translate('video.clickToLoad'));
            media.addEventListener('click', () => { this._activateCard(card); });
            media.addEventListener('keydown', (e) => {
                if (e.key !== 'Enter' && e.key !== ' ') { return; }
                if (e.target !== media) { return; }
                e.preventDefault();
                this._activateCard(card);
            });
        }
        return card;
    }

    /**
     * Щелчок/Enter по плитке: загрузить, или повторить сорвавшуюся загрузку (L4).
     * @param {FilmCard} card
     */
    _activateCard(card) {
        if (card.state === 'failed' && card.retryable) {
            card.retryable = false;
            this._setCardState(card, 'idle', translate('video.clickToLoad'));
        }
        this._enqueueLoad(card);
    }

    /**
     * Чекбокс «в карточку» в стиле панели Core (VideoExamplesPanel#_maybeAddCheckbox).
     * Щелчки и клавиши не доходят до карточки (у YouTube она сама кнопка).
     * @param {'inline'|'floating'} placement
     * @param {(checked: boolean) => void} onChange
     * @returns {{label: HTMLLabelElement, input: HTMLInputElement}}
     */
    _createSelectCheckbox(placement, onChange) {
        const label = document.createElement('label');
        label.className = `entry-video-examples-check entry-video-examples-check-${placement} ve-gw-check`;
        label.title = translate('check.save');
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = false;
        input.setAttribute('aria-label', translate('check.save'));
        const box = document.createElement('span');
        box.className = 'entry-video-examples-check-box';
        appendCheckIcon(box);
        // Подпись видна (макет): «Сохранить / Уйдёт в карточку Anki»; текст по
        // состоянию выбирает CSS (flib-card.css .fc-check-text) из data-атрибутов,
        // чтобы не дублировать логику disabled/checked здесь.
        const text = document.createElement('span');
        text.className = 'fc-check-text';
        text.setAttribute('aria-hidden', 'true');
        text.dataset.labelIdle = translate('check.save');
        text.dataset.labelChecked = translate('check.saving');
        text.dataset.labelDisabled = translate('check.pending');
        label.appendChild(input);
        label.appendChild(box);
        label.appendChild(text);
        input.addEventListener('change', () => { onChange(input.checked); });
        label.addEventListener('click', (e) => { e.stopPropagation(); });
        label.addEventListener('keydown', (e) => { e.stopPropagation(); });
        return {label, input};
    }

    /**
     * @param {FilmCard} card
     */
    _notifyCard(card) {
        // Deleting the current entry while iterating a Set is safe: a waiter may remove itself.
        for (const listener of card.listeners) { listener(); }
    }

    /**
     * @param {FilmCard} card
     * @returns {?import('gateway-anki-media').GatewayFilmMedia} null — ещё не готов.
     */
    _getFilmMedia(card) {
        const {blob, info, mediaMeta, clip} = card;
        if (this._destroyed || blob === null || info === null || mediaMeta === null) { return null; }
        const source = info.source;
        /** @type {?string} */
        let title = null;
        if (typeof source === 'object' && source !== null) {
            const name = typeof source.title === 'string' && source.title.length > 0 ? source.title : (typeof source.title_ru === 'string' && source.title_ru.length > 0 ? source.title_ru : null);
            if (name !== null) {
                title = typeof source.season === 'number' && typeof source.episode === 'number' ? `${name}${translate('video.seasonEpisode', {season: source.season, episode: source.episode})}` : name;
            }
        }
        const sourceYear = typeof source?.year === 'number' ? source.year : null;
        return {
            clipId: clip.clipId,
            blob,
            leadTrimSec: info.lead_trim_sec,
            trimDurationSec: clip.trimDurationSec,
            videoWidth: mediaMeta.videoWidth,
            videoHeight: mediaMeta.videoHeight,
            durationSec: mediaMeta.durationSec,
            // rel_ms отсчитаны от начала окна — ровно шкала сохранённого (обрезанного) клипа.
            vttText: buildHighlightedVtt(subsToCues(clip.subs, 0), this._words),
            title,
            year: sourceYear ?? clip.year,
            imdbUrl: typeof source?.imdb_url === 'string' ? source.imdb_url : null,
        };
    }

    /**
     * @param {HTMLElement} meta
     * @param {string} className
     * @param {string} text
     * @returns {HTMLElement}
     */
    _appendMetaItem(meta, className, text) {
        const el = document.createElement('span');
        el.className = className;
        el.textContent = text;
        meta.appendChild(el);
        return el;
    }

    /**
     * @param {FilmCard} card
     * @param {FilmCard['state']} state
     * @param {string} message
     */
    _setCardState(card, state, message) {
        card.state = state;
        card.root.dataset.state = state;
        card.checkbox.disabled = state !== 'ready';
        if (state !== 'ready' && this._selectedFilm.delete(card.clip.clipId)) {
            card.checkbox.checked = false;
            card.root.classList.remove('ve-gw-selected');
        }
        if (state === 'ready') {
            // Видео со своими контролами — плитка больше не кнопка.
            card.media.removeAttribute('role');
            card.media.removeAttribute('tabindex');
            card.media.removeAttribute('aria-label');
        } else {
            const status = document.createElement('div');
            status.className = 've-gw-film-status';
            status.textContent = message;
            card.media.replaceChildren(status);
        }
        this._notifyCard(card);
    }

    /** Ленивая загрузка по появлению карточки в области видимости. */
    _observeFilmCards() {
        if (typeof IntersectionObserver !== 'function') { return; }
        this._observer = new IntersectionObserver((entries) => {
            for (const entry of entries) {
                if (!entry.isIntersecting) { continue; }
                const card = this._filmCards.find((c) => c.media === entry.target);
                if (typeof card === 'undefined') { continue; }
                this._observer?.unobserve(entry.target);
                this._enqueueLoad(card);
            }
        });
        for (const card of this._filmCards) {
            if (card.state === 'idle') { this._observer.observe(card.media); }
        }
    }

    /**
     * @param {FilmCard} card
     */
    _enqueueLoad(card) {
        if (this._destroyed || card.state !== 'idle') { return; }
        this._setCardState(card, 'loading', translate('video.queued'));
        this._observer?.unobserve(card.media);
        const next = this._loadChain.then(() => this._loadCard(card));
        this._loadChain = next.catch(() => {});
        void this._track(next);
    }

    /**
     * @param {FilmCard} card
     * @returns {Promise<void>}
     */
    async _loadCard(card) {
        if (this._destroyed) { return; }
        /** @type {import('flib-gateway-examples').ClipMedia} */
        let media;
        try {
            media = await this._loader.loadClipMedia(card.clip, {
                signal: this._abort.signal,
                onStage: (stage) => {
                    if (this._destroyed) { return; }
                    this._setCardState(card, 'loading', stage === 'cutting' ? translate('video.cutting') : translate('video.downloading'));
                },
            });
        } catch (e) {
            if (this._destroyed) { return; }
            const code = getGatewayErrorCode(e);
            // Нарезку сервер провалил — повторять бессмысленно; остальное (сеть, таймаут…) — можно.
            card.retryable = code !== 'flib_clip_failed';
            this._setCardState(card, 'failed', card.retryable ? translate('video.failedRetry', {reason: describeGatewayError(code, 'films')}) : describeGatewayError(code, 'films'));
            if (card.retryable) { card.media.setAttribute('aria-label', translate('video.retryClip')); }
            return;
        }
        // ⚠️ Панель закрыли, пока шла загрузка: blob-URL не создаём — отзывать будет некому.
        if (this._destroyed) { return; }
        const url = URL.createObjectURL(media.blob);
        this._blobUrls.add(url);
        card.blob = media.blob;
        card.info = media.info;
        this._mountVideo(card, media.info, url);
        this._renderSource(card, media.info.source);
    }

    /**
     * Файл клипа НЕ обрезан: играем окно [lead_trim_sec, +trim_duration_sec).
     * @param {FilmCard} card
     * @param {import('flib-gateway').ClipInfo} info
     * @param {string} url
     */
    _mountVideo(card, info, url) {
        const {start, end} = computeClipWindow(info, card.clip.trimDurationSec);
        const fileCues = subsToCues(card.clip.subs, start);
        const cues = fileCues.map((c) => ({...c, parts: highlightCueParts(c.text, this._words)}));

        const wrap = document.createElement('div');
        wrap.className = 've-gw-film-video-wrap';
        const video = document.createElement('video');
        video.className = 've-gw-film-video';
        video.controls = true;
        video.preload = 'metadata';
        video.playsInline = true;
        video.src = url;
        wrap.appendChild(video);
        const cueEl = document.createElement('div');
        cueEl.className = 'entry-video-examples-modal-cue ve-gw-film-cue';
        wrap.appendChild(cueEl);

        /** @type {string} */
        let shownKey = '';
        const renderCue = () => {
            const t = video.currentTime;
            const active = cues.find((c) => t >= c.start && t < c.end);
            const key = typeof active === 'undefined' ? '' : `${active.start}`;
            if (key === shownKey) { return; }
            shownKey = key;
            cueEl.replaceChildren();
            if (typeof active === 'undefined') {
                cueEl.classList.remove('on');
                return;
            }
            appendHighlightedParts(cueEl, active.parts);
            cueEl.classList.add('on');
        };
        const seekToStart = () => {
            try {
                video.currentTime = start;
            } catch (e) {
                // Метаданных ещё нет — повторим на loadedmetadata.
            }
        };
        video.addEventListener('loadedmetadata', seekToStart);
        video.addEventListener('loadedmetadata', () => {
            card.mediaMeta = {videoWidth: video.videoWidth, videoHeight: video.videoHeight, durationSec: video.duration};
            this._notifyCard(card);
        });
        video.addEventListener('error', () => {
            card.mediaError = true;
            this._notifyCard(card);
        });
        video.addEventListener('play', () => {
            const t = video.currentTime;
            if (t < start - 0.25 || (end !== null && t >= end - 0.05)) { seekToStart(); }
        });
        video.addEventListener('timeupdate', () => {
            if (end !== null && video.currentTime >= end) { video.pause(); }
            renderCue();
        });
        video.addEventListener('seeked', renderCue);

        // Нативный fullscreen показывает только <video> — оверлей там не виден.
        // Те же реплики (время файла, с lead_trim) идут дорожкой VTT, она
        // включается только в fullscreen; blob-URL отзывается в destroy().
        const subtitles = attachSubtitleTrack(video, {cues: fileCues, words: this._words, overlay: cueEl});
        if (subtitles !== null) {
            this._blobUrls.add(subtitles.url);
            card.disposeSubtitles = subtitles.dispose;
        }

        card.video = video;
        card.media.replaceChildren(wrap);
        this._setCardState(card, 'ready', '');
    }

    /**
     * @param {FilmCard} card
     * @param {import('flib-gateway').ClipSource | undefined} source
     */
    _renderSource(card, source) {
        const title = formatSourceTitle(source);
        if (title !== null) {
            const el = document.createElement('div');
            el.className = 've-gw-film-title';
            el.textContent = title;
            card.root.insertBefore(el, card.meta);
        }
        if (typeof source !== 'undefined' && isSafeImdbUrl(source.imdb_url)) {
            const link = document.createElement('a');
            link.className = 've-gw-imdb';
            link.href = source.imdb_url;
            link.target = '_blank';
            link.rel = 'noopener noreferrer';
            link.textContent = 'IMDb';
            card.meta.appendChild(link);
        }
    }
}
