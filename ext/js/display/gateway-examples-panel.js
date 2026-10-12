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

import {log} from '../core/log.js';
import {
    buildYouTubeThumbUrl,
    computeClipWindow,
    describeEmptyReason,
    describeGatewayError,
    formatSourceTitle,
    formatTimeRange,
    getGatewayErrorCode,
    isCoreFallbackError,
    isSafeImdbUrl,
    sanitizeYouTubeItems,
    subsToCues,
} from './gateway-examples-util.js';
import {buildHighlightMatcher, highlightCueParts} from './example-highlight-forms.js';
import {attachSubtitleTrack, buildHighlightedVtt} from './example-subtitle-track.js';
import {GatewayClipWaitError} from './gateway-anki-media.js';
import {appendHighlightedParts} from './video-examples-modal.js';
import {appendCheckIcon} from './video-examples-panel.js';

/** @typedef {'loading'|'ready'|'empty'|'error'} SectionState */
/** @typedef {'youtube'|'films'} SectionName */

/**
 * @typedef {object} SectionElements
 * @property {HTMLElement} root
 * @property {HTMLElement} message
 * @property {HTMLElement} list
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
 * @property {string} key Position in the section (unique per panel).
 * @property {string} ref
 * @property {?number} startMs
 * @property {?string} textEn
 */

/**
 * @typedef {object} GatewayPanelHooks
 * @property {() => void} onCancel
 * @property {() => void} onRetry
 * @property {(item: import('flib-gateway').ExampleItem, words: string[]) => void} onYouTubeOpen
 * @property {() => void} [onCoreFallback] Открыть примеры через anki_conf вместо шлюза (review M5).
 */

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
     * @param {{loader: import('./gateway-examples-loader.js').GatewayExamplesLoader, highlightForms?: string[], density?: 'compact'|'large', canFallbackToCore?: () => boolean}} options
     *   highlightForms — заглавные статьи: склоняются вместе со словом для подсветки.
     */
    constructor(entry, word, hooks, {loader, highlightForms, density, canFallbackToCore}) {
        /** @type {string} */
        this._word = word;
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
        /** @type {{el: HTMLElement, text: string}[]} Строки YouTube — перекрасить, когда придут лемма/формы. */
        this._youTubeTexts = [];
        /** @type {AbortController} */
        this._abort = new AbortController();
        /** @type {boolean} */
        this._destroyed = false;
        /** @type {Set<string>} */
        this._blobUrls = new Set();
        /** @type {Set<Promise<void>>} */
        this._pending = new Set();
        /** @type {Promise<void>} Очередь загрузки клипов: строго по одному. */
        this._loadChain = Promise.resolve();
        /** @type {FilmCard[]} */
        this._filmCards = [];
        /** @type {YouTubeCard[]} */
        this._youTubeCards = [];
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
        /** @type {?HTMLButtonElement} */
        this._coreFallbackButton = null;

        /** @type {HTMLElement} */
        this._root = this._buildRoot(density === 'large' ? 'large' : 'compact');
        /** @type {SectionElements} */
        this._youtube = this._buildSection('youtube', 'YouTube');
        /** @type {SectionElements} */
        this._films = this._buildSection('films', 'Фильмы');
        this._root.appendChild(this._youtube.root);
        this._root.appendChild(this._films.root);
        entry.appendChild(this._root);
    }

    /** @returns {HTMLElement} */
    get root() { return this._root; }

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
                .map((c) => ({ref: c.ref, startMs: c.startMs, text: c.textEn, words: [...this._words]})),
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

    /** Убрать из DOM, остановить загрузки, отозвать blob-URL. */
    destroy() {
        if (this._destroyed) { return; }
        this._destroyed = true;
        this._abort.abort();
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
        button.textContent = 'Показать через anki_conf';
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

        const header = document.createElement('div');
        header.className = 'entry-video-examples-header';
        const top = document.createElement('div');
        top.className = 'entry-video-examples-header-top';

        const title = document.createElement('span');
        title.className = 'entry-video-examples-title';
        title.textContent = 'Примеры';
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
        refreshBtn.title = 'Искать заново';
        refreshBtn.setAttribute('aria-label', 'Искать заново');
        refreshBtn.textContent = '↻';
        refreshBtn.addEventListener('click', () => { this._hooks.onRetry(); });
        top.appendChild(refreshBtn);

        const closeBtn = document.createElement('button');
        closeBtn.type = 'button';
        closeBtn.className = 'entry-video-examples-icon-btn entry-video-examples-icon-close';
        closeBtn.title = 'Закрыть';
        closeBtn.setAttribute('aria-label', 'Закрыть');
        closeBtn.textContent = '×';
        closeBtn.addEventListener('click', () => { this._hooks.onCancel(); });
        top.appendChild(closeBtn);

        header.appendChild(top);
        root.appendChild(header);
        return root;
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
        const list = document.createElement('div');
        list.className = name === 'youtube' ? 've-gw-section-list ve-gw-yt-list' : 've-gw-section-list ve-gw-film-list';
        root.appendChild(list);
        return {root, message, list};
    }

    /**
     * @param {SectionName} name
     * @param {SectionState} state
     * @param {string} message
     */
    _setSection(name, state, message) {
        const section = name === 'youtube' ? this._youtube : this._films;
        this._sectionState[name] = state;
        section.root.dataset.state = state;
        section.message.textContent = message;
        section.message.hidden = message.length === 0;
    }

    /** @returns {Promise<void>} */
    async _runYouTube() {
        this._setSection('youtube', 'loading', 'Загрузка…');
        try {
            const result = await this._loader.loadYouTube(this._word);
            if (this._destroyed) { return; }
            const items = sanitizeYouTubeItems(result.items);
            if (items.length === 0) {
                this._setSection('youtube', 'empty', describeEmptyReason(result.items.length > 0 ? 'no_usable_examples' : result.emptyReason, 'youtube'));
                return;
            }
            for (const item of items) { this._youtube.list.appendChild(this._buildYouTubeCard(item)); }
            this._setSection('youtube', 'ready', '');
        } catch (e) {
            if (this._destroyed) { return; }
            const code = getGatewayErrorCode(e);
            log.log(`[gateway-examples] YouTube failed: ${code ?? String(e)}`);
            this._setSection('youtube', 'error', describeGatewayError(code, 'youtube'));
            this._offerCoreFallback(code);
        }
    }

    /** @returns {Promise<void>} */
    async _runFilms() {
        this._setSection('films', 'loading', 'Ищем нарезки… (обычно до минуты, иногда дольше)');
        try {
            const result = await this._loader.loadFilms(this._word, {
                signal: this._abort.signal,
                onPhase: (phase) => {
                    if (this._destroyed) { return; }
                    this._setSection('films', 'loading', phase === 'cutting' ? 'Нарезаем фрагменты…' : 'Ищем нарезки… (обычно до минуты, иногда дольше)');
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
            this._setSection('films', 'error', describeGatewayError(code, 'films'));
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
     * @param {import('flib-gateway').ExampleItem} item
     * @returns {HTMLElement}
     */
    _buildYouTubeCard(item) {
        const card = document.createElement('div');
        card.className = 've-gw-yt-card';
        card.tabIndex = 0;
        card.setAttribute('role', 'button');
        card.dataset.ref = item.ref;

        /** @type {YouTubeCard} */
        // Index, not ref+start: two identical items must stay two independent checkboxes.
        const ytCard = {key: String(this._youTubeCards.length), ref: item.ref, startMs: item.start_ms, textEn: item.text_en};
        this._youTubeCards.push(ytCard);
        const {label} = this._createSelectCheckbox('inline', (checked) => {
            if (checked) {
                this._selectedYouTube.add(ytCard.key);
            } else {
                this._selectedYouTube.delete(ytCard.key);
            }
            card.classList.toggle('ve-gw-selected', checked);
        });
        card.appendChild(label);

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
        card.appendChild(thumb);

        const text = document.createElement('div');
        text.className = 've-gw-yt-text';
        appendHighlightedParts(text, highlightCueParts(item.text_en ?? '', this._words));
        this._youTubeTexts.push({el: text, text: item.text_en ?? ''});
        card.appendChild(text);

        const open = () => { this._hooks.onYouTubeOpen(item, this._words); };
        card.addEventListener('click', open);
        card.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                open();
            }
        });
        return card;
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
            media.setAttribute('aria-label', 'Загрузить фрагмент');
            this._setCardState(card, 'idle', 'Нажмите, чтобы загрузить фрагмент');
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
            this._setCardState(card, 'idle', 'Нажмите, чтобы загрузить фрагмент');
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
        label.title = 'Сохранить в карточку Anki';
        const input = document.createElement('input');
        input.type = 'checkbox';
        input.checked = false;
        input.setAttribute('aria-label', 'Сохранить в карточку Anki');
        const box = document.createElement('span');
        box.className = 'entry-video-examples-check-box';
        appendCheckIcon(box);
        label.appendChild(input);
        label.appendChild(box);
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
                title = typeof source.season === 'number' && typeof source.episode === 'number' ? `${name}, сезон ${source.season}, серия ${source.episode}` : name;
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
        this._setCardState(card, 'loading', 'В очереди…');
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
                    this._setCardState(card, 'loading', stage === 'cutting' ? 'Нарезаем…' : 'Загружаем видео…');
                },
            });
        } catch (e) {
            if (this._destroyed) { return; }
            const code = getGatewayErrorCode(e);
            // Нарезку сервер провалил — повторять бессмысленно; остальное (сеть, таймаут…) — можно.
            card.retryable = code !== 'flib_clip_failed';
            this._setCardState(card, 'failed', card.retryable ? `${describeGatewayError(code, 'films')} — нажмите, чтобы повторить` : describeGatewayError(code, 'films'));
            if (card.retryable) { card.media.setAttribute('aria-label', 'Повторить загрузку фрагмента'); }
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
