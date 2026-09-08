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

import {afterEach, beforeEach, describe, expect, test} from 'vitest';
import {Display} from '../ext/js/display/display.js';
import {setupDomTest} from './fixtures/dom-test.js';

/**
 * Голый Display с ровно тем состоянием, которое читает
 * `_getDictionaryEntryVisibleDefinitionIndex`: настоящий конструктор тянет
 * Application/CrossFrameAPI и в юнит-тесте не нужен.
 * @param {{dictionary: string}[]} definitions
 * @param {HTMLElement} entryNode
 * @param {?{top: number, bottom: number}} [scrollRect] Окно прокрутки; по
 *   умолчанию (null) — вырожденное нулевое, как во всех тестах фолбэка.
 * @returns {Display}
 */
function makeDisplay(definitions, entryNode, scrollRect = null) {
    const rect = scrollRect ?? {top: 0, bottom: 0};
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const display = /** @type {Display} */ (Object.create(Display.prototype));
    // eslint-disable-next-line no-underscore-dangle
    display._windowScroll = /** @type {*} */ ({getRect: () => rect});
    // eslint-disable-next-line no-underscore-dangle
    display._dictionaryEntries = /** @type {*} */ ([{type: 'term', definitions}]);
    // eslint-disable-next-line no-underscore-dangle
    display._dictionaryEntryNodes = [entryNode];
    return display;
}

/**
 * Достраивает `display` до состояния, в котором отрабатывает НАСТОЯЩИЙ
 * `_focusEntry`: только так проверяется, к какому именно узлу навигация
 * скроллит. Возвращает журнал вызовов прокрутки.
 * @param {Display} display
 * @param {{top: number, bottom: number}} scrollRect
 * @returns {number[]} y-координаты, к которым прокручивали
 */
function enableFocusEntry(display, scrollRect) {
    /** @type {number[]} */
    const scrolledTo = [];
    const body = document.createElement('div');
    /** @type {*} */ (body).getBoundingClientRect = () => ({top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0});
    /* eslint-disable no-underscore-dangle */
    display._index = 0;
    display._options = null;
    display._searchHeader = null;
    display._aboveStickyHeader = null;
    display._contentScrollBodyElement = body;
    display._windowScroll = /** @type {*} */ ({
        x: 0,
        y: 0,
        getRect: () => scrollRect,
        stop: () => {},
        /**
         * @param {number} _x
         * @param {number} y
         */
        animate: (_x, y) => { scrolledTo.push(y); },
        /** @param {number} y */
        toY: (y) => { scrolledTo.push(y); },
    });
    /* eslint-enable no-underscore-dangle */
    return scrolledTo;
}

/**
 * Список определений в том виде, в каком его оставляет колонка перевода:
 * узлы удалённых русских строк отсутствуют, строка-сирота дописана в конец и
 * `data-index` не имеет вовсе.
 *
 * ⚠️ `top`/`bottom` подставляются ЯВНО: jsdom на любой
 * `getBoundingClientRect()` отдаёт сплошные нули, и без подмены каждый узел
 * попадает в ветку `continue` (нулевой прямоугольник ни с чем не пересекается)
 * — то есть ветка «определение на экране» не исполняется вообще ни одним
 * тестом. Именно она работает в живом браузере всякий раз, когда хоть одно
 * определение видно.
 * @param {{index: ?number, top?: number, bottom?: number}[]} items
 * @returns {HTMLElement}
 */
function makeEntryNode(items) {
    const entry = document.createElement('div');
    entry.className = 'entry';
    /** @type {*} */ (entry).getBoundingClientRect = () => ({top: 0, bottom: 0, left: 0, right: 0, width: 0, height: 0});
    const list = document.createElement('ol');
    list.className = 'definition-list';
    for (const {index, top, bottom} of items) {
        const li = document.createElement('li');
        li.className = index === null ? 'definition-item translation-orphan' : 'definition-item';
        if (index !== null) { li.dataset.index = `${index}`; }
        if (typeof top === 'number' && typeof bottom === 'number') {
            /** @type {*} */ (li).getBoundingClientRect = () => ({
                top,
                bottom,
                left: 0,
                right: 100,
                width: 100,
                height: bottom - top,
            });
        }
        list.appendChild(li);
    }
    entry.appendChild(list);
    return entry;
}

describe('_getDictionaryEntryVisibleDefinitionIndex после уборки RU-строк', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    beforeEach(async () => { env = await setupDomTest(); });
    afterEach(async () => { await env.teardown(global); });

    /**
     * @param {Display} display
     * @param {number} sign
     * @returns {?number}
     */
    const visibleIndex = (display, sign) => (
        // eslint-disable-next-line no-underscore-dangle
        display._getDictionaryEntryVisibleDefinitionIndex(0, sign)
    );

    test('удалённая RU-строка НЕ в хвосте: индекс берётся из data-index, а не из позиции', () => {
        // ⚠️ Порядок определений задаёт _sortTermDictionaryEntryDefinitions по
        // frequencyOrder и dictionaryIndex (порядок словарей в настройках), так
        // что русская строка может стоять ПЕРВОЙ. Позиционное сопоставление
        // definitions[i] ↔ nodes[i] после её удаления указывает не на то
        // определение.
        const definitions = [{dictionary: 'ru'}, {dictionary: 'en'}, {dictionary: 'en2'}];
        const display = makeDisplay(definitions, makeEntryNode([{index: 1}, {index: 2}]));

        const index = visibleIndex(display, 1);
        expect(index).not.toBe(null);
        expect(definitions[/** @type {number} */ (index)].dictionary).not.toBe('ru');
        expect(index).toBe(2);
    });

    test('обход снизу вверх тоже не проваливается на удалённую строку', () => {
        const definitions = [{dictionary: 'ru'}, {dictionary: 'en'}, {dictionary: 'en2'}];
        const display = makeDisplay(definitions, makeEntryNode([{index: 1}, {index: 2}]));

        const index = visibleIndex(display, -1);
        expect(definitions[/** @type {number} */ (index)].dictionary).not.toBe('ru');
        expect(index).toBe(1);
    });

    test('строка-сирота (узел без определения) в счёт не идёт', () => {
        const definitions = [{dictionary: 'en'}, {dictionary: 'ru'}];
        const display = makeDisplay(definitions, makeEntryNode([{index: 0}, {index: null}]));

        expect(visibleIndex(display, 1)).toBe(0);
        expect(visibleIndex(display, -1)).toBe(0);
    });

    test('без уборки поведение прежнее', () => {
        const definitions = [{dictionary: 'en'}, {dictionary: 'en2'}, {dictionary: 'en3'}];
        const display = makeDisplay(definitions, makeEntryNode([{index: 0}, {index: 1}, {index: 2}]));

        expect(visibleIndex(display, 1)).toBe(2);
        expect(visibleIndex(display, -1)).toBe(0);
    });

    test('узлов определений нет вовсе — null, как и раньше', () => {
        const display = makeDisplay([{dictionary: 'en'}], makeEntryNode([]));
        expect(visibleIndex(display, 1)).toBe(null);
    });

    test('видимое определение выбирается по ЭКРАНУ, и его индекс — data-index, а не позиция узла', () => {
        // ⚠️ Пробел, который тут закрывается: во всех остальных тестах
        // прямоугольники нулевые, каждый узел уходит в `continue`, и
        // результат приходит из ФОЛБЭКА (последний просмотренный). Ветка
        // «определение на экране» — та самая, что работает в браузере всегда,
        // когда что-то видно, — не исполнялась ни разу.
        const definitions = [{dictionary: 'en'}, {dictionary: 'ru'}, {dictionary: 'en2'}, {dictionary: 'en3'}];
        const entryNode = makeEntryNode([
            {index: 0, top: 0, bottom: 100}, // выше окна прокрутки
            {index: 2, top: 250, bottom: 350}, // ВИДНО целиком
            {index: 3, top: 500, bottom: 600}, // ниже окна прокрутки
        ]);
        const display = makeDisplay(definitions, entryNode, {top: 200, bottom: 400});

        // Позиция видимого узла в списке — 1, его data-index — 2. Ответ обязан
        // быть индексом ОПРЕДЕЛЕНИЯ.
        expect(visibleIndex(display, 1)).toBe(2);
        expect(visibleIndex(display, -1)).toBe(2);
    });

    test('навигация по словарям не залипает на статье с переводом и скроллит к нужному узлу', () => {
        // ⚠️ Дефект, который тут ловится: цель выбиралась по одним лишь
        // `definitions`, где строка словаря переводов НАМЕРЕННО остаётся
        // (§5.4а убирает только узел DOM). Для [en, ru, en2, en3] с видимым
        // `en` выбиралось j=1 (ru), `_focusEntry` узла не находил, откатывался
        // на узел статьи и прокручивал к её началу — и так на каждое
        // повторное нажатие, бесконечно.
        const definitions = [{dictionary: 'en'}, {dictionary: 'ru'}, {dictionary: 'en2'}, {dictionary: 'en3'}];
        const entryNode = makeEntryNode([
            {index: 0, top: 0, bottom: 100},
            {index: 2, top: 300, bottom: 400},
            {index: 3, top: 450, bottom: 550},
        ]);
        const display = makeDisplay(definitions, entryNode, {top: 0, bottom: 150});
        const scrolledTo = enableFocusEntry(display, {top: 0, bottom: 150});

        // eslint-disable-next-line no-underscore-dangle
        expect(display._focusEntryWithDifferentDictionary(1, true)).toBe(true);
        // 300 — верх узла с data-index="2". Ноль означал бы откат на узел
        // статьи (выбрали удалённую RU-строку), 450 — позиционный поиск узла
        // (`definitionNodes[2]` — это узел с data-index="3").
        expect(scrolledTo).toEqual([300]);
    });

    test('_getDictionaryEntryDefinitionNode находит узел по data-index, а не по позиции', () => {
        const display = makeDisplay(
            [{dictionary: 'ru'}, {dictionary: 'en'}, {dictionary: 'en2'}],
            makeEntryNode([{index: 1}, {index: 2}]),
        );
        // eslint-disable-next-line no-underscore-dangle
        const node = display._getDictionaryEntryDefinitionNode(0, 2);
        expect(node?.dataset.index).toBe('2');
        // Удалённое определение узла не имеет — и подменять его соседом нельзя.
        // eslint-disable-next-line no-underscore-dangle
        expect(display._getDictionaryEntryDefinitionNode(0, 0)).toBe(null);
    });
});
