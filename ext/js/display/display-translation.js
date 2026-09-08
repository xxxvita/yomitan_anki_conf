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
import {ensurePopupToolbar} from './popup-toolbar.js';
import {isStrictPairingAvailable, pairDefinitions} from './translation-pairing.js';

/** Минимальная ширина колонки, ниже которой рисуем стопкой, а не рядом. */
export const MIN_COLUMN_WIDTH = 240;

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
    return `${label} — показать перевод`;
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
    return achievedWidth / 2 >= minColumnWidth ? 'columns' : 'stack';
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
    const inner = document.createElement('div');
    inner.className = 'is-blurred';
    inner.setAttribute('aria-hidden', 'true');
    inner.setAttribute('inert', '');
    inner.appendChild(content);
    button.appendChild(inner);
    return button;
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
        /** @type {Set<number>} */
        this._revealed = new Set();
        /** @type {'columns'|'stack'} */
        this._layout = 'stack';
        /** @type {boolean} */
        this._strict = false;
        /** @type {?HTMLButtonElement} */
        this._button = null;
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
            return;
        }
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
        this._button.setAttribute('aria-pressed', this._open ? 'true' : 'false');
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
        const achieved = await this._display.invokeContentOrigin('frontendRequestPopupSize', {
            owner: 'translation-column',
            minWidth: base * 2,
            minHeight: 0,
        }).catch(() => ({width: 0, height: 0, valid: false}));
        if (this._applyStateToken !== token) {
            return;
        }
        this._layout = chooseLayout({
            achievedWidth: achieved.width,
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
            this._button.textContent = label;
            // ⚠️ Подсказка обновляется вместе с подписью и здесь тоже: кнопка
            // переиспользуется, и обновление только textContent оставило бы
            // подсказку от предыдущего значения настройки.
            this._button.title = translationButtonTitle(label);
            this._button.hidden = false;
            return;
        }
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'translation-toolbar-button';
        button.dataset.action = 'show-translation';
        button.setAttribute('aria-pressed', 'false');
        button.title = translationButtonTitle(label);
        button.textContent = label;
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
        const blurred = isFlibHost(this._display.getOptionsContext().url ?? '');
        const columns = this._open && this._layout === 'columns';

        for (const [entryNode, dictionaryEntry] of this._entries) {
            // ⚠️ Снимаем ВСЁ своё, включая строки-сироты: иначе каждый рендер
            // добавлял бы ещё одну, и список рос бы с каждым нажатием.
            for (const stale of entryNode.querySelectorAll('.translation-cell, .translation-orphan')) {
                stale.remove();
            }
            for (const inner of entryNode.querySelectorAll('.definition-item-inner')) {
                delete (/** @type {HTMLElement} */ (inner)).dataset.translationLayout;
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
                    inner.dataset.translationLayout = columns ? 'columns' : 'stack';
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
        const revealed = translation !== null && this._revealed.has(translation.id);
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
        this._revealed.add(translation.id);
        // ⚠️ Результат намеренно игнорируется: поведение интерфейса не должно
        // зависеть от того, записалось ли событие.
        void this._display.application.api.flibRecordEvent('translation_opened', [lemma]);

        const content = this._display.displayGenerator.createTermDefinitionContent(translation);
        const row = /** @type {import('./translation-pairing.js').TranslationRow} */ ({
            hostIndex: null,
            hostDefinition: null,
            translation,
        });
        const newCell = createTranslationCell(row, {blurred, revealed: true, headword: lemma, content});
        newCell.dataset.definitionId = `${translation.id}`;
        newCell.dataset.lemma = lemma;
        newCell.tabIndex = -1;
        oldCell.replaceWith(newCell);
        newCell.focus();
    }
}
