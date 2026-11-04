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
import {isFlibHost} from '../data/flib-host.js';
import {createIcon} from './flib-icons.js';
import {extractGlossTranslation, pairGlosses, wrapGlossItem} from './gloss-pairing.js';
import {ensurePopupToolbar} from './popup-toolbar.js';
import {isStrictPairingAvailable, pairDefinitions} from './translation-pairing.js';

/** Минимальная ширина колонки, ниже которой рисуем стопкой, а не рядом. */
export const MIN_COLUMN_WIDTH = 240;

/**
 * Ширина попапа, не достающаяся колонкам: поля статьи, номер значения,
 * зазор между колонками. Из макета: (ширина − 70) / 2 ≥ 240.
 */
export const LAYOUT_GUTTER = 70;

/** Ключ состояния колонки в chrome.storage.local. */
export const COLUMN_OPEN_KEY = 'flibTranslationColumnOpen';

/**
 * Подсказка кнопки колонки.
 *
 * ⚠️ Выводится из ТОЙ ЖЕ подписи, что стоит на кнопке
 * (`options.flibTranslation.buttonLabel`), а не пишется рядом константой:
 * подпись настраиваемая, и зашитая подсказка разъехалась бы с ней при первой
 * же смене значения.
 * @param {string} label
 * @returns {string}
 */
export function translationButtonTitle(label) {
    return `${label}: колонка перевода. Остаётся включённой во всех вкладках`;
}

/**
 * ⚠️ Для попапа фразы лемма берётся из ПОЛЯ на момент добавления, а не из
 * исходного выделения: пользователю разрешено править текст выражения перед
 * добавлением, и переход кнопки view->add завязан именно на правку.
 * @param {{headword: string, expressionField: ?string}} details
 * @returns {?string}
 */
export function pickAddedLemma({headword, expressionField}) {
    const fromField = typeof expressionField === 'string' ? expressionField.trim() : '';
    if (fromField.length > 0) {
        return fromField;
    }
    const fromHeadword = headword.trim();
    return fromHeadword.length > 0 ? fromHeadword : null;
}

/**
 * ⚠️ Решение принимается по ДОСТИГНУТОЙ ширине, которую вернул фронтенд.
 * Дисплей живёт в iframe: его window.innerWidth — ширина попапа, и считать по
 * нему значило бы всегда получать stack.
 * @param {{achievedWidth: number, valid: boolean, minColumnWidth: number}} details
 * @returns {'columns'|'stack'}
 */
export function chooseLayout({achievedWidth, valid, minColumnWidth}) {
    if (!valid) {
        return 'stack';
    }
    return (achievedWidth - LAYOUT_GUTTER) / 2 >= minColumnWidth ? 'columns' : 'stack';
}

/**
 * ⚠️ Блюр ставится на ВНУТРЕННИЙ узел, а не на кнопку: иначе размывается и её
 * фокусное кольцо, и клавиатурный пользователь не видит, где находится.
 * Радиус в em, потому что размер шрифта попапа — настройка.
 *
 * ⚠️ inert нужен потому, что статья может содержать <details>, чей <summary>
 * иначе ловит фокус по Tab внутри скрытого поддерева.
 * @param {import('./translation-pairing.js').TranslationRow} row
 * @param {{blurred: boolean, revealed: boolean, headword: string, content: Node}} details
 * @returns {HTMLElement}
 */
export function createTranslationCell(row, {blurred, revealed, headword, content}) {
    if (row.translation === null) {
        const empty = document.createElement('span');
        empty.className = 'translation-cell translation-cell-empty';
        empty.setAttribute('aria-hidden', 'true');
        // ⚠️ «для этой статьи», а не «для этой части речи»: штамп соответствия
        // части речи не гарантирует, и обещать его в интерфейсе нельзя.
        empty.title = 'для этой статьи перевода пока нет';
        empty.textContent = '—';
        return empty;
    }
    if (!blurred || revealed) {
        const open = document.createElement('div');
        open.className = 'translation-cell';
        open.appendChild(content);
        return open;
    }
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'translation-cell translation-cell-blurred';
    button.setAttribute('aria-label', `Показать перевод: ${headword}`);
    button.title = 'Сначала подумайте, потом щёлкните';
    const inner = document.createElement('div');
    inner.className = 'is-blurred';
    inner.setAttribute('aria-hidden', 'true');
    inner.setAttribute('inert', '');
    inner.appendChild(content);
    button.appendChild(inner);
    return button;
}

/**
 * Ширина боковой полосы навигации, если она стоит слева или справа и видна.
 * @returns {number}
 */
function getSideSidebarWidth() {
    const location = document.documentElement.dataset.popupActionBarLocation;
    if (location !== 'left' && location !== 'right') { return 0; }
    const sidebar = document.getElementById('content-sidebar');
    if (sidebar === null || getComputedStyle(sidebar).display === 'none') { return 0; }
    return Math.ceil(sidebar.getBoundingClientRect().width);
}

/**
 * Подпись переключателя + дорожка с бегунком (flib-card.css .fc-switch-track).
 * @param {HTMLElement} button
 * @param {string} label
 */
function setSwitchLabel(button, label) {
    const track = document.createElement('span');
    track.className = 'fc-switch-track';
    track.setAttribute('aria-hidden', 'true');
    button.replaceChildren(label, track);
}

export class DisplayTranslation {
    /**
     * @param {import('./display.js').Display} display
     */
    constructor(display) {
        /** @type {import('./display.js').Display} */
        this._display = display;
        /** @type {boolean} */
        this._open = false;
        /**
         * Раскрытые ячейки: `${translation.id}` — ячейка на всю статью,
         * `${translation.id}:${i}` — ячейка i-го значения.
         * @type {Set<string>}
         */
        this._revealed = new Set();
        /**
         * Переводы, о раскрытии которых уже сообщено: событие одно на перевод,
         * сколько бы его значений ни раскрыли.
         * @type {Set<number>}
         */
        this._reported = new Set();
        /** @type {'columns'|'stack'} */
        this._layout = 'stack';
        /** @type {boolean} */
        this._strict = false;
        /** @type {?HTMLButtonElement} */
        this._button = null;
        /** «Перевод ⚠» — русского словаря нет. @type {?HTMLButtonElement} */
        this._missingButton = null;
        /** @type {?HTMLElement} */
        this._missingCallout = null;
        /** @type {Map<HTMLElement, import('dictionary').TermDictionaryEntry>} */
        this._entries = new Map();
        // ⚠️ Токен-поколение для _applyState (по образцу
        // _updateDictionaryEntryDetailsToken в display-anki.js): метод асинхронный
        // и зовётся из трёх источников (contentUpdateComplete, storage.onChanged,
        // _toggle) — без токена два перекрывшихся вызова могут завершиться в
        // обратном порядке и оставить this._layout от устаревшего ответа.
        /** @type {?import('core').TokenObject} */
        this._applyStateToken = null;
        // ⚠️ Тот же класс гонки, но на уровень выше: _onContentUpdateComplete
        // сам не имеет поколения. Путь terms делает ДВА await api.getDictionaryInfo
        // (внутри _shouldShowButton и здесь), путь kanji/phrase выходит из
        // _shouldShowButton почти сразу — обработчик terms может дорезолвиться
        // ПОСЛЕ обработчика kanji, который уже спрятал кнопку и освободил
        // размер, и заново показать Ru/захватить размер на kanji-выдаче.
        /** @type {?import('core').TokenObject} */
        this._contentUpdateToken = null;
    }

    /** @returns {boolean} */
    get isOpen() {
        return this._open;
    }

    /** Подписки и стартовое состояние. */
    prepare() {
        this._display.on('contentClear', () => {
            this._revealed.clear();
            this._reported.clear();
            this._entries.clear();
        });
        // ⚠️ contentUpdateEntry (display.js:2417) даёт {dictionaryEntry, element,
        // index} — узел и его статью, без сопоставления по порядковому номеру.
        this._display.on('contentUpdateEntry', (details) => {
            this._onContentUpdateEntry(details);
        });
        this._display.on('contentUpdateComplete', () => {
            void this._onContentUpdateComplete();
        });
        // ⚠️ Состояние меняется в ЛЮБОЙ вкладке: без подписки вкладка, чей
        // Display уже подготовлен, не узнает о нажатии Ru в соседней (ТЗ A21).
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area !== 'local' || !Object.hasOwn(changes, COLUMN_OPEN_KEY)) {
                return;
            }
            this._open = changes[COLUMN_OPEN_KEY].newValue === true;
            void this._applyState();
        });
        void this._loadOpenState();
        // Словарь поставили / удалили, пока окно открыто: «Перевод ⚠» и кнопка
        // «Перевод» должны поменяться местами без нового поиска.
        this._display.application.on('databaseUpdated', () => { void this._onContentUpdateComplete(); });
    }

    /** @returns {Promise<void>} */
    async _loadOpenState() {
        try {
            const stored = await chrome.storage.local.get([COLUMN_OPEN_KEY]);
            this._open = stored[COLUMN_OPEN_KEY] === true;
        } catch (e) {
            this._open = false;
        }
    }

    /**
     * Кнопка показывается, только когда пара словарей пригодна к работе.
     * @returns {Promise<boolean>}
     */
    async _shouldShowButton() {
        const options = this._display.getOptions();
        if (options === null) {
            return false;
        }
        // ⚠️ В режимах split/merge словари не сливаются в одну статью, и хозяина
        // для перевода не найти никогда — кнопки быть не должно.
        if (options.general.resultOutputMode !== 'group') {
            return false;
        }
        // ⚠️ Только term-выдача сливает статьи в одну сущность с хозяином и
        // переводом; на kanji/phrase/unloaded переводить нечего — тот же гейт
        // по типу контента, что у CheckWords (display-anki.js:1561-1562).
        if (this._display.contentType !== 'terms') {
            return false;
        }
        const info = await this._display.application.api.getDictionaryInfo();
        return info.some((d) => d.title === options.flibTranslation.translationDictionary);
    }

    /**
     * Английский словарь пары стоит, а русского нет — на term-выдаче в group.
     * @returns {Promise<boolean>}
     */
    async _isTranslationMissing() {
        const options = this._display.getOptions();
        if (options === null || options.general.resultOutputMode !== 'group' || this._display.contentType !== 'terms') {
            return false;
        }
        const info = await this._display.application.api.getDictionaryInfo();
        const {translationDictionary, hostDictionary} = options.flibTranslation;
        return info.some((d) => d.title === hostDictionary) && !info.some((d) => d.title === translationDictionary);
    }

    /**
     * Недоступный переключатель «Перевод ⚠» и подсказка под панелью.
     * @param {boolean} missing
     */
    _setMissingState(missing) {
        if (!missing) {
            if (this._missingButton !== null) { this._missingButton.hidden = true; }
            this._missingCallout?.remove();
            this._missingCallout = null;
            return;
        }
        const toolbar = ensurePopupToolbar();
        if (toolbar === null) { return; }
        toolbar.actions.hidden = false;
        toolbar.bar.hidden = false;
        if (this._missingButton === null) {
            const button = document.createElement('button');
            button.type = 'button';
            button.className = 'fc-switch fc-switch-missing';
            // Не aria-disabled: кнопка работает — раскрывает подсказку.
            button.setAttribute('aria-expanded', 'false');
            button.setAttribute('aria-controls', 'fc-noru');
            button.setAttribute('aria-label', 'Перевод: русский словарь не установлен');
            button.title = 'Русский словарь не установлен';
            const label = this._display.getOptions()?.flibTranslation.buttonLabel ?? 'Перевод';
            button.append(label, createIcon('alert'));
            button.addEventListener('click', () => {
                if (this._missingCallout !== null) {
                    this._missingCallout.remove();
                    this._missingCallout = null;
                    button.setAttribute('aria-expanded', 'false');
                } else {
                    this._showMissingCallout(toolbar.bar, button);
                }
            });
            toolbar.actions.appendChild(button);
            this._missingButton = button;
        }
        this._missingButton.hidden = false;
    }

    /**
     * @param {HTMLElement} bar
     * @param {HTMLButtonElement} button
     */
    _showMissingCallout(bar, button) {
        const callout = document.createElement('div');
        callout.className = 'fc-noru';
        callout.id = 'fc-noru';
        callout.setAttribute('role', 'status');
        const text = document.createElement('div');
        text.className = 'fc-callout-text';
        const title = document.createElement('b');
        title.textContent = 'Русский словарь не установлен';
        text.append(title, 'Перевод значений появится после установки. Английские определения работают как обычно.');
        const actions = document.createElement('div');
        actions.className = 'fc-noru-actions';
        const install = document.createElement('a');
        install.className = 'fc-btn fc-btn-acc';
        install.href = '/settings.html#flib-dictionaries-provisioning';
        install.target = '_blank';
        install.rel = 'noopener';
        install.textContent = 'Установить';
        const later = document.createElement('button');
        later.type = 'button';
        later.className = 'fc-btn';
        later.textContent = 'Не сейчас';
        later.addEventListener('click', () => {
            callout.remove();
            this._missingCallout = null;
            button.setAttribute('aria-expanded', 'false');
            button.focus();
        });
        actions.append(install, later);
        callout.append(createIcon('alert'), text, actions);
        bar.after(callout);
        this._missingCallout = callout;
        button.setAttribute('aria-expanded', 'true');
    }

    /**
     * ⚠️ Токен-поколение (тот же приём, что в _applyState): проверка
     * `this._display.contentType` внутри `_shouldShowButton` идёт ДО await
     * `api.getDictionaryInfo()`, а значит могла устареть к моменту, когда тот
     * резолвится. Без этой проверки отставший вызов от предыдущей (terms)
     * выдачи мог дорезолвиться после того, как более свежий вызов (kanji) уже
     * спрятал кнопку и освободил размер — и заново их показать/захватить.
     * @returns {Promise<void>}
     */
    async _onContentUpdateComplete() {
        /** @type {import('core').TokenObject} */
        const token = {};
        this._contentUpdateToken = token;
        const options = this._display.getOptions();
        if (options === null) {
            return;
        }
        const shouldShow = await this._shouldShowButton();
        if (this._contentUpdateToken !== token) {
            return;
        }
        if (!shouldShow) {
            await this._removeButton();
            // Карточка Flib-club: нет русского словаря при английском — показать
            // это, а не молча прятать «Перевод» (макет, NoRuCallout).
            const missing = await this._isTranslationMissing();
            if (this._contentUpdateToken !== token) { return; }
            this._setMissingState(missing);
            return;
        }
        this._setMissingState(false);
        const info = await this._display.application.api.getDictionaryInfo();
        if (this._contentUpdateToken !== token) {
            return;
        }
        this._strict = isStrictPairingAvailable(info, options.flibTranslation);
        if (!this._strict) {
            log.warn(new Error('flib: dictionary build fingerprints differ, translations shown unpaired'));
        }
        this._ensureButton(options.flibTranslation.buttonLabel);
        await this._applyState();
    }

    /**
     * ⚠️ Размер ПЕРЕЗАПРАШИВАЕТСЯ на каждой выдаче: popup._show() сбрасывает
     * размер фрейма при каждом показе (popup.js:737), поэтому «раз раздвинули и
     * держится» — неверная посылка.
     * @returns {Promise<void>}
     */
    async _applyState() {
        const options = this._display.getOptions();
        if (options === null || this._button === null) {
            return;
        }
        /** @type {import('core').TokenObject} */
        const token = {};
        this._applyStateToken = token;
        this._button.setAttribute('aria-checked', this._open ? 'true' : 'false');
        if (!this._open) {
            await this._display.invokeContentOrigin('frontendReleasePopupSize', {owner: 'translation-column'}).catch(() => {});
            if (this._applyStateToken !== token) {
                return;
            }
            this._layout = 'stack';
            this._renderColumns();
            return;
        }
        const base = options.general.popupWidth;
        // ⚠️ Боковая полоса навигации (слева/справа) съедает ширину фрейма: её
        // добавляем к запросу и вычитаем из достигнутой ширины, иначе колонки
        // выбирались бы там, где на каждую остаётся меньше MIN_COLUMN_WIDTH.
        const sidebar = getSideSidebarWidth();
        const achieved = await this._display.invokeContentOrigin('frontendRequestPopupSize', {
            owner: 'translation-column',
            minWidth: base * 2 + sidebar,
            minHeight: 0,
        }).catch(() => ({width: 0, height: 0, valid: false}));
        if (this._applyStateToken !== token) {
            return;
        }
        this._layout = chooseLayout({
            achievedWidth: achieved.width - sidebar,
            valid: achieved.valid,
            minColumnWidth: MIN_COLUMN_WIDTH,
        });
        this._renderColumns();
    }

    /**
     * ⚠️ Живёт в правом слоте ОБЩЕЙ панели (`.popup-toolbar-actions`,
     * popup-toolbar.js), а не в собственном баре: у DisplayAnki уже была своя
     * панель над #dictionary-entries (теги + CheckWords + плотность видео), и
     * отдельный `insertBefore(bar, entries)` здесь ставил ВТОРУЮ строку рядом
     * с первой при любом обычном поиске термина — не край, а обычный случай.
     * Слот `.popup-toolbar-actions` для этого и предназначен (margin-left:
     * auto, «right slot» — display-anki.js:1422-1426).
     *
     * ⚠️ Снимает hidden и со слота, и с бара сама: оба создаются скрытыми
     * (popup-toolbar.js), а видимость слота сегодня совпадает с видимостью
     * CheckWords только потому, что тот тоже показывается на terms
     * (display-anki.js:1561-1563). Полагаться на это молча — значит, что
     * кнопка Ru пропадёт, если CheckWords когда-нибудь загейтят отдельной
     * опцией; вместо этого сама открываю то, что использую.
     * @param {string} label
     */
    _ensureButton(label) {
        const toolbar = ensurePopupToolbar();
        if (toolbar === null) {
            return;
        }
        toolbar.actions.hidden = false;
        toolbar.bar.hidden = false;
        if (this._button !== null) {
            setSwitchLabel(this._button, label);
            // ⚠️ Подсказка обновляется вместе с подписью и здесь тоже: кнопка
            // переиспользуется, и обновление только textContent оставило бы
            // подсказку от предыдущего значения настройки.
            this._button.title = translationButtonTitle(label);
            this._button.hidden = false;
            return;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'translation-toolbar-button fc-switch';
        button.dataset.action = 'show-translation';
        // Переключатель макета: состояние читается как «включено», а не «нажато».
        button.setAttribute('role', 'switch');
        button.setAttribute('aria-checked', 'false');
        button.title = translationButtonTitle(label);
        setSwitchLabel(button, label);
        button.addEventListener('click', () => {
            void this._toggle();
        });
        toolbar.actions.appendChild(button);
        this._button = button;
    }

    /**
     * Прячет кнопку (элемент переиспользуется, не пересоздаётся) и, если
     * колонка была раскрыта, освобождает требование к ширине попапа.
     *
     * ⚠️ Порядок обязателен: релиз ДО того, как кнопка станет недоступна.
     * Иначе (отключили словарь переводов, переключили resultOutputMode,
     * ушли на kanji/phrase) кнопка исчезает, а frontendReleasePopupSize
     * никогда не зовётся — требование остаётся висеть в PopupSizeRegistry
     * фронтенда, попап остаётся раздутым, а UI для отката больше нет.
     * `_applyState` тут не спасает: он выходит по `this._button === null`
     * ещё до попытки релиза.
     * @returns {Promise<void>}
     */
    async _removeButton() {
        // ⚠️ Инвалидирует токен _applyState: если рядом ещё летит запрос
        // размера (например, только что нажали Ru, а сюда уже пришёл
        // следующий contentUpdateComplete с kanji-выдачей), его отложенный
        // ответ не должен переписать this._layout после того, как кнопка
        // спрятана и требование освобождено.
        this._applyStateToken = null;
        if (this._open) {
            await this._display.invokeContentOrigin('frontendReleasePopupSize', {owner: 'translation-column'}).catch(() => {});
        }
        this._layout = 'stack';
        if (this._button !== null) {
            this._button.hidden = true;
        }
    }

    /** @returns {Promise<void>} */
    async _toggle() {
        // ⚠️ Нажатие Ru события НЕ шлёт: одно нажатие пометило бы «не знал»
        // разом все статьи слова.
        this._open = !this._open;
        try {
            await chrome.storage.local.set({[COLUMN_OPEN_KEY]: this._open});
        } catch (e) {
            // Приватное окно или очищенное хранилище — состояние живёт в памяти.
        }
        await this._applyState();
    }

    /**
     * @param {import('display').EventArgument<'contentUpdateEntry'>} details
     */
    _onContentUpdateEntry({dictionaryEntry, element}) {
        if (dictionaryEntry.type !== 'term') {
            return;
        }
        const entryNode = /** @type {HTMLElement} */ (element);
        this._entries.set(entryNode, dictionaryEntry);
        // ⚠️ Срабатывает БЕЗУСЛОВНО — до и независимо от того, раскрыта ли
        // колонка, доступен ли строгий паринг, стоит ли flib.club: перевод
        // существует ТОЛЬКО как правая ячейка колонки. Если оставить его
        // определение в обычном списке, пользователь читает перевод, даже не
        // нажимая Ru и не кликая по ячейке, и весь блюр с учётом событий не
        // имеет смысла (задача 9, найденная дыра плана).
        this._hideTranslationSourceDefinitions(entryNode);
    }

    /**
     * Убирает определения словаря переводов из обычного потока `.definition-list`.
     * Отбирает строго по `data-dictionary` (его ставит `display-generator.js`
     * на узел `.definition-item`), а не позиционно — иначе рискуем задеть
     * английскую статью, вставленную рядом.
     *
     * ⚠️ Гейт по `resultOutputMode === 'group'` — тому же условию, что решает,
     * может ли колонка вообще существовать (`_shouldShowButton`). Вне group
     * статьи не сливаются в одну сущность, хозяина для перевода не найти
     * никогда, и колонки, которая вернула бы спрятанный перевод, не будет —
     * убрать его отсюда значило бы потерять насовсем. «Установлен ли словарь
     * переводов» в предикат не добавляю: узел с `data-dictionary` равным его
     * имени физически не появится, если такого словаря нет, так что для
     * ЭТОЙ проверки условие уже верно неявно — дублировать асинхронный
     * `api.getDictionaryInfo()` здесь значило бы либо гонять его на каждую
     * статью синхронно (нечем), либо отложить уборку до его ответа и
     * вернуть окно «перевод виден до первого обновления», которого раньше
     * не было.
     * @param {HTMLElement} entryNode
     */
    _hideTranslationSourceDefinitions(entryNode) {
        const options = this._display.getOptions();
        if (options === null || options.general.resultOutputMode !== 'group') {
            return;
        }
        // ⚠️ Уборка РВЁТ позиционное соответствие «i-й узел = definitions[i]»:
        // после неё узлов меньше, чем определений, и считать, что удалённые
        // всегда стоят в хвосте, нельзя — порядок определений задаёт
        // `_sortTermDictionaryEntryDefinitions` (translator.js) по
        // `frequencyOrder` и `dictionaryIndex`, то есть по порядку словарей в
        // настройках, и русская строка может стоять первой. Единственный, кто
        // на это соответствие опирался, — навигация Alt+стрелка в
        // `display.js` (`_getDictionaryEntryVisibleDefinitionIndex`); она
        // переведена на `data-index` узла. Если появится второй такой
        // читатель — он обязан делать то же самое.
        const {translationDictionary} = options.flibTranslation;
        let removedAny = false;
        for (const item of entryNode.querySelectorAll('.definition-item')) {
            if (/** @type {HTMLElement} */ (item).dataset.dictionary === translationDictionary) {
                item.remove();
                removedAny = true;
            }
        }
        if (removedAny) {
            this._syncDefinitionCounts(entryNode);
        }
    }

    /**
     * Пересчитывает `data-count`/`data-definition-count` по РЕАЛЬНОМУ
     * содержимому списка: оба атрибута проставлены один раз в
     * `display-generator.js` ДО того, как эта колонка вообще существует, и
     * протухают в двух местах — сразу после уборки (список рисует пустой
     * `<ol>`, а не скрывает секцию: `data-definition-count='0'` только
     * скрывает её) и снова после появления строки-сироты (иначе секция могла
     * остаться скрытой, если ВСЕ определения статьи были из словаря
     * переводов, а строка-сирота дорисовывается в ту же самую секцию).
     *
     * ⚠️ Счётчика ДВА, и считают они РАЗНОЕ — потому что читают их разные
     * правила стиля:
     *
     * - `.definition-list[data-count]` управляет НУМЕРАЦИЕЙ (`display.css`:
     *   при `0`/`1` — `list-style-type: none`, иначе `decimal`). Строки-сироты
     *   в него не входят: иначе статья с одним английским определением и одной
     *   сиротой давала бы `2`, список перескакивал в нумерованный вид, и
     *   раскладка прыгала на КАЖДОЕ нажатие `Ru` — при том, что настоящее
     *   определение по-прежнему одно.
     * - `.entry[data-definition-count='0']` ПРЯЧЕТ секцию определений целиком.
     *   Сюда сироты входить обязаны: у статьи, все определения которой были из
     *   словаря переводов, после уборки не остаётся ни одного `.definition-item`
     *   кроме дорисованной сироты, и исключение её из этого счётчика скрыло бы
     *   секцию вместе с самой сиротой.
     * @param {HTMLElement} entryNode
     */
    _syncDefinitionCounts(entryNode) {
        const list = /** @type {?HTMLElement} */ (entryNode.querySelector('.definition-list'));
        if (list === null) {
            return;
        }
        const total = list.querySelectorAll('.definition-item').length;
        const withoutOrphans = list.querySelectorAll('.definition-item:not(.translation-orphan)').length;
        list.dataset.count = `${withoutOrphans}`;
        entryNode.dataset.definitionCount = `${total}`;
    }

    /**
     * ⚠️ Ряд = статья: правая ячейка живёт в ОДНОМ узле со своим определением.
     * Отдельная колонка-сиблинг дала бы второй скролл и разъезд по вертикали.
     */
    _renderColumns() {
        const options = this._display.getOptions();
        if (options === null) { return; }
        const blurred = options.flibTranslation.blur === true || isFlibHost(this._display.getOptionsContext().url ?? '');
        const columns = this._open && this._layout === 'columns';

        for (const [entryNode, dictionaryEntry] of this._entries) {
            // ⚠️ Снимаем ВСЁ своё, включая строки-сироты: иначе каждый рендер
            // добавлял бы ещё одну, и список рос бы с каждым нажатием.
            for (const stale of entryNode.querySelectorAll('.translation-cell, .translation-orphan')) {
                stale.remove();
            }
            for (const node of entryNode.querySelectorAll('[data-translation-layout]')) {
                delete (/** @type {HTMLElement} */ (node)).dataset.translationLayout;
            }

            if (this._open) {
                const rows = pairDefinitions(dictionaryEntry, {
                    translationDictionary: options.flibTranslation.translationDictionary,
                    hostDictionary: options.flibTranslation.hostDictionary,
                    strict: this._strict,
                });
                const headword = dictionaryEntry.headwords[0]?.term ?? '';
                for (const row of rows) {
                    if (row.hostIndex === null) {
                        this._appendOrphanRow(entryNode, row, headword, blurred, columns);
                        continue;
                    }
                    const item = entryNode.querySelector(`.definition-item[data-index="${row.hostIndex}"]`);
                    const inner = /** @type {?HTMLElement} */ (item?.querySelector('.definition-item-inner') ?? null);
                    if (inner === null) { continue; }
                    const layout = columns ? 'columns' : 'stack';
                    if (this._renderGlossCells(/** @type {HTMLElement} */ (item), row, headword, blurred, layout)) {
                        inner.dataset.translationLayout = 'gloss';
                        continue;
                    }
                    inner.dataset.translationLayout = layout;
                    inner.appendChild(this._buildCell(row, headword, blurred));
                }
            }

            // ⚠️ Вне ветки `_open` тоже нужен: строка-сирота, добавленная выше,
            // меняет число `.definition-item` в этой же секции, а закрытие
            // колонки снова убирает её — счётчики обязаны отражать текущий
            // DOM после ЛЮБОГО прохода, не только уборки при рендере статьи.
            this._syncDefinitionCounts(entryNode);
        }
    }

    /**
     * Перевод напротив каждого значения (gloss-pairing.js). false — значения не
     * сопоставить один к одному, и вызывающий ставит ячейку на всю статью.
     *
     * ⚠️ Без перевода (`row.translation === null`) прочерк ставится у КАЖДОГО
     * значения: иначе в колонке было бы непонятно, к какому из них он относится.
     * @param {HTMLElement} item `.definition-item` хозяина.
     * @param {import('./translation-pairing.js').TranslationRow} row
     * @param {string} headword
     * @param {boolean} blurred
     * @param {'columns'|'stack'} layout
     * @returns {boolean}
     */
    _renderGlossCells(item, row, headword, blurred, layout) {
        const translation = row.translation;
        if (translation === null) {
            const pairs = pairGlosses(item, item);
            if (pairs === null) { return false; }
            for (const {en} of pairs) {
                en.dataset.translationLayout = layout;
                const empty = createTranslationCell(row, {blurred, revealed: false, headword, content: document.createDocumentFragment()});
                empty.classList.add('scan-disable');
                wrapGlossItem(en).after(empty);
            }
            return true;
        }
        const pairs = pairGlosses(item, this._display.displayGenerator.createTermDefinitionContent(translation));
        if (pairs === null) { return false; }
        for (const [i, {en, ru, withSublist}] of pairs.entries()) {
            en.dataset.translationLayout = layout;
            const key = `${translation.id}:${i}`;
            const content = () => extractGlossTranslation(ru, {withSublist});
            const cell = createTranslationCell(row, {blurred, revealed: this._revealed.has(key), headword, content: content()});
            // ⚠️ scan-disable: ячейка живёт внутри li.gloss-item.click-scannable, и
            // без него клик по русскому тексту запускал бы поиск этого текста.
            cell.classList.add('translation-cell-gloss', 'scan-disable');
            if (cell.tagName === 'BUTTON') {
                // 60+ кнопок у run не должны звучать одинаково для скринридера.
                cell.setAttribute('aria-label', `Показать перевод: ${headword}, значение ${i + 1}`);
            }
            cell.dataset.definitionId = `${translation.id}`;
            cell.dataset.lemma = headword;
            if (cell.tagName === 'BUTTON') {
                cell.addEventListener('click', () => { this._revealCell(translation, key, headword, blurred, cell, content); });
            }
            // ⚠️ Сразу за своим текстом, ДО вложенного списка: иначе ячейка
            // родителя встала бы под его подзначениями.
            wrapGlossItem(en).after(cell);
        }
        return true;
    }

    /**
     * @param {import('./translation-pairing.js').TranslationRow} row
     * @param {string} headword
     * @param {boolean} blurred
     * @returns {HTMLElement}
     */
    _buildCell(row, headword, blurred) {
        const translation = row.translation;
        const content = translation === null ?
            document.createDocumentFragment() :
            this._display.displayGenerator.createTermDefinitionContent(translation);
        const revealed = translation !== null && this._revealed.has(`${translation.id}`);
        const cell = createTranslationCell(row, {blurred, revealed, headword, content});
        if (translation !== null) {
            cell.dataset.definitionId = `${translation.id}`;
            cell.dataset.lemma = headword;
            if (cell.tagName === 'BUTTON') {
                // ⚠️ Замыкание держит саму кнопку (`cell`), а не ищет её заново
                // по id: `_reveal` подменяет узел (`replaceWith`), и искать его
                // в документе к моменту клика значило бы полагаться на то, что
                // разметка вокруг не изменилась между рендером и кликом.
                //
                // ⚠️ ПРОВЕРЕНО, что id перевода уникален в пределах выдачи, и
                // ключ `_revealed` по одному только `TermDefinition.id`
                // корректен: `id` — это первичный ключ строки хранилища
                // (`dictionary-database.js`, `_createTerm`: `id: row.id`), а
                // `translator.js` `_getDictionaryEntries` держит `const ids =
                // new Set()` и на повторной строке НЕ заводит вторую статью, а
                // сливает в уже существующую. Группировка (`group`) статьи
                // только объединяет, не размножая, и кладёт каждую ровно в одну
                // группу. Значит одна строка словаря переводов физически живёт
                // в ОДНОЙ статье выдачи, и раскрытие «book up» не может снять
                // блюр с ячейки «give up» (A16, A32).
                cell.addEventListener('click', () => { this._reveal(translation, headword, blurred, cell); });
            }
        }
        return cell;
    }

    /**
     * ⚠️ Видимая сирота честнее тихой пары не с той частью речи.
     * @param {HTMLElement} entryNode
     * @param {import('./translation-pairing.js').TranslationRow} row
     * @param {string} headword
     * @param {boolean} blurred
     * @param {boolean} columns
     */
    _appendOrphanRow(entryNode, row, headword, blurred, columns) {
        const list = entryNode.querySelector('.definition-list');
        if (list === null || row.translation === null) { return; }
        const item = document.createElement('li');
        item.className = 'definition-item translation-orphan';
        const inner = document.createElement('div');
        inner.className = 'definition-item-inner';
        inner.dataset.translationLayout = columns ? 'columns' : 'stack';
        const left = document.createElement('div');
        left.className = 'definition-item-content';
        const chip = document.createElement('span');
        chip.className = 'translation-orphan-chip';
        chip.textContent = 'только перевод';
        left.append(headword, ' ', chip);
        inner.append(left, this._buildCell(row, headword, blurred));
        item.appendChild(inner);
        list.appendChild(item);
    }

    /**
     * Снимает блюр С ОДНОЙ ячейки и шлёт ровно одно событие.
     *
     * ⚠️ Меняет ТОЛЬКО эту ячейку (`oldCell.replaceWith(newCell)`), а не зовёт
     * `_renderColumns()` целиком: полный ререндер снёс бы именно ту `BUTTON`,
     * на которой стоял фокус клавиатурного пользователя, и Enter увёл бы фокус
     * на `body` без объявления результата скринридером — притом что весь смысл
     * заблюренной ячейки в том, что это НАСТОЯЩАЯ кнопка с целым фокусным
     * кольцом. Фокус переносится на замену явно: `DIV` сам по себе не
     * фокусируется, `tabIndex = -1` делает это возможным программно, не
     * добавляя его в обычный Tab-порядок.
     * @param {import('dictionary').TermDefinition} translation
     * @param {string} lemma
     * @param {boolean} blurred
     * @param {HTMLElement} oldCell
     */
    _reveal(translation, lemma, blurred, oldCell) {
        this._revealCell(
            translation,
            `${translation.id}`,
            lemma,
            blurred,
            oldCell,
            () => this._display.displayGenerator.createTermDefinitionContent(translation),
        );
    }

    /**
     * @param {import('dictionary').TermDefinition} translation
     * @param {string} key Ключ в `_revealed`.
     * @param {string} lemma
     * @param {boolean} blurred
     * @param {HTMLElement} oldCell
     * @param {() => Node} createContent
     */
    _revealCell(translation, key, lemma, blurred, oldCell, createContent) {
        this._revealed.add(key);
        if (!this._reported.has(translation.id)) {
            this._reported.add(translation.id);
            // ⚠️ Результат намеренно игнорируется: поведение интерфейса не должно
            // зависеть от того, записалось ли событие.
            void this._display.application.api.flibRecordEvent('translation_opened', [lemma]);
        }

        const row = /** @type {import('./translation-pairing.js').TranslationRow} */ ({
            hostIndex: null,
            hostDefinition: null,
            translation,
        });
        const newCell = createTranslationCell(row, {blurred, revealed: true, headword: lemma, content: createContent()});
        for (const name of oldCell.classList) {
            if (name !== 'translation-cell-blurred') { newCell.classList.add(name); }
        }
        newCell.dataset.definitionId = `${translation.id}`;
        newCell.dataset.lemma = lemma;
        newCell.tabIndex = -1;
        oldCell.replaceWith(newCell);
        newCell.focus();
    }
}
