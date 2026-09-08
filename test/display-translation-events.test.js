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

import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {EventDispatcher} from '../ext/js/core/event-dispatcher.js';
import {DisplayTranslation} from '../ext/js/display/display-translation.js';
import {setupDomTest} from './fixtures/dom-test.js';

// prepare() подписывается на chrome.storage.onChanged и читает стартовое
// состояние колонки — без заглушки настоящий prepare() в юнит-тесте не
// поднять, а именно он и проверяется (подписки на события Display).
vi.stubGlobal('chrome', {
    storage: {
        local: {
            /** @returns {Promise<Record<string, unknown>>} */
            get: () => Promise.resolve({}),
            /** @returns {Promise<void>} */
            set: () => Promise.resolve(),
        },
        onChanged: {
            addListener: () => {},
        },
    },
});

/**
 * Статья, где переводу не с чем сопоставиться (сирота) — ни одного
 * определения-хозяина в массиве вовсе.
 * @param {string} headword
 * @param {number} translationId
 * @returns {import('dictionary').TermDictionaryEntry}
 */
function makeOrphanEntry(headword, translationId) {
    return /** @type {import('dictionary').TermDictionaryEntry} */ (/** @type {unknown} */ ({
        type: 'term',
        headwords: [{term: headword}],
        definitions: [
            {dictionary: 'ru', sequences: [-1], id: translationId, entries: [`перевод ${headword}`]},
        ],
    }));
}

/** @returns {HTMLElement} */
function makeEntryElement() {
    const li = document.createElement('li');
    li.className = 'dictionary-entry';
    const list = document.createElement('ol');
    list.className = 'definition-list';
    li.appendChild(list);
    return li;
}

/**
 * Минимальный Display: НАСТОЯЩИЙ EventDispatcher плюс те три-четыре члена,
 * которые читает DisplayTranslation.
 *
 * ⚠️ Именно диспетчер, а не объект с заглушкой `on()`: подписки, которые
 * ставит `prepare()` (`contentClear` в первую очередь), иначе остаются вне
 * теста — а «имитация contentClear» руками через `_revealed.clear()`
 * проверяет сам Set, но не то, что его кто-то чистит.
 * @augments EventDispatcher<import('display').Events>
 */
class FakeDisplay extends EventDispatcher {
    /**
     * @param {{resultOutputMode: string, url: string, onEvent: (type: string, lemmas: string[]) => void}} details
     */
    constructor({resultOutputMode, url, onEvent}) {
        super();
        /** @type {string} */
        this.resultOutputMode = resultOutputMode;
        /** @type {string} */
        this.url = url;
        /** @type {{api: {flibRecordEvent: (type: string, lemmas: string[]) => Promise<boolean>}}} */
        this.application = {
            api: {
                flibRecordEvent: (type, lemmas) => {
                    onEvent(type, lemmas);
                    return Promise.resolve(true);
                },
            },
        };
        /** @type {{createTermDefinitionContent: (definition: import('dictionary').TermDefinition) => HTMLElement}} */
        this.displayGenerator = {
            createTermDefinitionContent: (definition) => {
                const ul = document.createElement('ul');
                ul.className = 'gloss-list translation-gloss';
                const [first] = definition.entries;
                ul.textContent = typeof first === 'string' ? first : '';
                return ul;
            },
        };
    }

    /** @returns {import('settings').ProfileOptions} */
    getOptions() {
        return /** @type {import('settings').ProfileOptions} */ (/** @type {unknown} */ ({
            general: {resultOutputMode: this.resultOutputMode},
            flibTranslation: {translationDictionary: 'ru', hostDictionary: 'en'},
        }));
    }

    /** @returns {import('settings').OptionsContext} */
    getOptionsContext() {
        return /** @type {import('settings').OptionsContext} */ ({url: this.url, depth: 0});
    }
}

/**
 * @typedef {{
 *   display: FakeDisplay,
 *   addEntry: (element: HTMLElement, dictionaryEntry: import('dictionary').TermDictionaryEntry) => void,
 *   setStrict: (value: boolean) => void,
 *   open: () => void,
 *   render: () => void,
 *   contentClear: () => void,
 *   onContentUpdateEntry: (details: {dictionaryEntry: import('dictionary').TermDictionaryEntry, element: HTMLElement, index: number}) => void,
 *   ensureButton: (label: string) => void,
 * }} Harness
 */

/**
 * DisplayTranslation, поднятый через НАСТОЯЩИЕ конструктор и `prepare()` над
 * минимальным Display. Приватные поля трогает ТОЛЬКО эта функция — тесты
 * используют обёртку без подчёркиваний, чтобы не тащить eslint-disable в
 * каждую строку теста.
 * @param {(type: string, lemmas: string[]) => void} onEvent
 * @param {{resultOutputMode?: string, url?: string}} [overrides]
 * @returns {Harness}
 */
function makeHarness(onEvent, overrides) {
    const display = new FakeDisplay({
        resultOutputMode: overrides?.resultOutputMode ?? 'group',
        url: overrides?.url ?? 'https://flib.club/b/1',
        onEvent,
    });
    const instance = new DisplayTranslation(/** @type {*} */ (display));
    instance.prepare();

    return {
        display,
        addEntry: (element, dictionaryEntry) => {
            // eslint-disable-next-line no-underscore-dangle
            instance._entries.set(element, dictionaryEntry);
        },
        setStrict: (value) => {
            // eslint-disable-next-line no-underscore-dangle
            instance._strict = value;
        },
        open: () => {
            // eslint-disable-next-line no-underscore-dangle
            instance._open = true;
        },
        render: () => {
            // eslint-disable-next-line no-underscore-dangle
            instance._renderColumns();
        },
        contentClear: () => {
            display.trigger('contentClear', {});
        },
        onContentUpdateEntry: (details) => {
            display.trigger('contentUpdateEntry', /** @type {*} */ (details));
        },
        ensureButton: (label) => {
            // eslint-disable-next-line no-underscore-dangle
            instance._ensureButton(label);
        },
    };
}

describe('DisplayTranslation — раскрытие колонки и событие translation_opened', () => {
    /** @type {{teardown: (g: unknown) => unknown}} */
    let env;
    /** @type {Harness} */
    let harness;
    /** @type {[string, string[]][]} */
    let calls;

    beforeEach(async () => {
        env = await setupDomTest();
        calls = [];
        harness = makeHarness((type, lemmas) => { calls.push([type, lemmas]); });
    });

    afterEach(async () => {
        await env.teardown(global);
    });

    test('открытие колонки — ноль событий; клик по ячейке в том же прогоне — ровно одно', () => {
        const el = makeEntryElement();
        harness.addEntry(el, makeOrphanEntry('give up', 1));

        // «Нажатие Ru» само по себе не должно фиксировать ничего.
        harness.open();
        harness.render();
        expect(calls.length).toBe(0);

        const button = /** @type {?HTMLButtonElement} */ (el.querySelector('.translation-cell-blurred'));
        expect(button).not.toBe(null);
        (/** @type {HTMLButtonElement} */ (button)).click();
        expect(calls.length).toBe(1);
    });

    test('клик по ячейке даёт РОВНО одно событие с леммой этой статьи', () => {
        const el = makeEntryElement();
        harness.addEntry(el, makeOrphanEntry('give up', 1));
        harness.open();
        harness.render();

        const button = /** @type {HTMLButtonElement} */ (el.querySelector('.translation-cell-blurred'));
        button.click();

        expect(calls).toEqual([['translation_opened', ['give up']]]);
    });

    test('две статьи одного слова — два независимых события со своими леммами', () => {
        const elBook = makeEntryElement();
        const elGive = makeEntryElement();
        harness.addEntry(elBook, makeOrphanEntry('book up', 1));
        harness.addEntry(elGive, makeOrphanEntry('give up', 2));
        harness.open();
        harness.render();

        /** @type {HTMLButtonElement} */ (elBook.querySelector('.translation-cell-blurred')).click();
        /** @type {HTMLButtonElement} */ (elGive.querySelector('.translation-cell-blurred')).click();

        expect(calls).toEqual([
            ['translation_opened', ['book up']],
            ['translation_opened', ['give up']],
        ]);
    });

    test('повторный рендер событие заново не шлёт', () => {
        const el = makeEntryElement();
        harness.addEntry(el, makeOrphanEntry('give up', 1));
        harness.open();
        harness.render();
        /** @type {HTMLButtonElement} */ (el.querySelector('.translation-cell-blurred')).click();
        expect(calls.length).toBe(1);

        harness.render();
        harness.render();
        expect(calls.length).toBe(1);
    });

    test('раскрытая ячейка остаётся открытой до contentClear', () => {
        const el = makeEntryElement();
        harness.addEntry(el, makeOrphanEntry('give up', 1));
        harness.open();
        harness.render();
        /** @type {HTMLButtonElement} */ (el.querySelector('.translation-cell-blurred')).click();

        expect(el.querySelector('.translation-cell-blurred')).toBe(null);
        expect(el.querySelector('.translation-cell')).not.toBe(null);
    });

    test('сброс раскрытых ячеек на новой выдаче возвращает блюр', () => {
        const el = makeEntryElement();
        harness.addEntry(el, makeOrphanEntry('give up', 1));
        harness.open();
        harness.render();
        /** @type {HTMLButtonElement} */ (el.querySelector('.translation-cell-blurred')).click();
        expect(el.querySelector('.translation-cell-blurred')).toBe(null);

        // ⚠️ Настоящий contentClear, а не ручная чистка Set: событие идёт
        // через тот же EventDispatcher, на который подписался prepare(). Без
        // этого подписка остаётся вне теста, и её удаление проходит
        // незамеченным — а последствие в браузере видно сразу: повторно
        // найденное слово рисует перевод уже открытым, без клика.
        harness.contentClear();
        // Новая выдача заново регистрирует статью — contentClear чистит и
        // список статей тоже.
        harness.addEntry(el, makeOrphanEntry('give up', 1));
        harness.render();

        expect(el.querySelector('.translation-cell-blurred')).not.toBe(null);
    });

    test('раскрыта РОВНО одна ячейка: повторный рендер помнит, какая именно', () => {
        // ⚠️ Что тут закрывается: до сих пор ни один тест не читал _revealed
        // при РЕНДЕРЕ — все проверки шли сразу после клика, где ячейку
        // подменяет _reveal. `const revealed = false` в _buildCell не ронял
        // ни одного теста. Две строки перевода в ОДНОЙ статье заодно ловят
        // ключ по заголовку вместо id определения: заголовок у них общий, и
        // такой ключ раскрыл бы обе разом.
        const el = makeEntryElement();
        const dictionaryEntry = /** @type {import('dictionary').TermDictionaryEntry} */ (/** @type {unknown} */ ({
            type: 'term',
            headwords: [{term: 'give up'}],
            definitions: [
                {dictionary: 'ru', sequences: [-1], id: 1, entries: ['сдаться']},
                {dictionary: 'ru', sequences: [-1], id: 2, entries: ['бросить']},
            ],
        }));
        harness.addEntry(el, dictionaryEntry);
        harness.open();
        harness.render();

        const first = /** @type {HTMLButtonElement} */ (el.querySelector('.translation-cell[data-definition-id="1"]'));
        expect(first.tagName).toBe('BUTTON');
        first.click();

        // Ререндер выдачи (закрыли/открыли панель примеров, пришло
        // обновление) — состояние раскрытия обязано пережить его.
        harness.render();

        const revealed = /** @type {HTMLElement} */ (el.querySelector('.translation-cell[data-definition-id="1"]'));
        const stillBlurred = /** @type {HTMLElement} */ (el.querySelector('.translation-cell[data-definition-id="2"]'));
        expect(revealed.tagName).not.toBe('BUTTON');
        expect(revealed.classList.contains('translation-cell-blurred')).toBe(false);
        expect(stillBlurred.tagName).toBe('BUTTON');
        expect(stillBlurred.classList.contains('translation-cell-blurred')).toBe(true);
    });

    test('вне flib.club ячейка не заблюрена и событий нет', () => {
        // ⚠️ A24. `isFlibHost` протестирован, `createTranslationCell({blurred:
        // false})` протестирован, а СТРОКА, которая их соединяет, — нет:
        // `const blurred = true` в _renderColumns не ронял ничего, потому что
        // весь остальной харнесс зашит на адрес flib.club. Последствие —
        // блюр на любом сайте плюс событие, которое бэкенд всё равно
        // отвергнет.
        harness = makeHarness((type, lemmas) => { calls.push([type, lemmas]); }, {url: 'https://example.com/read/1'});
        const el = makeEntryElement();
        harness.addEntry(el, makeOrphanEntry('give up', 1));
        harness.open();
        harness.render();

        expect(el.querySelector('.translation-cell-blurred')).toBe(null);
        const cell = /** @type {HTMLElement} */ (el.querySelector('.translation-cell'));
        expect(cell).not.toBe(null);
        expect(cell.tagName).not.toBe('BUTTON');
        expect(cell.textContent).toContain('перевод give up');
        expect(calls.length).toBe(0);
    });

    test('EN и RU одной статьи — потомки одного .definition-item', () => {
        const el = makeEntryElement();
        const list = /** @type {HTMLElement} */ (el.querySelector('.definition-list'));
        const item = document.createElement('li');
        item.className = 'definition-item';
        item.dataset.index = '0';
        item.dataset.dictionary = 'en';
        const inner = document.createElement('div');
        inner.className = 'definition-item-inner';
        const content = document.createElement('div');
        content.className = 'definition-item-content';
        const gloss = document.createElement('ul');
        gloss.className = 'gloss-list';
        gloss.textContent = 'give up (en)';
        content.appendChild(gloss);
        inner.appendChild(content);
        item.appendChild(inner);
        list.appendChild(item);

        const dictionaryEntry = /** @type {import('dictionary').TermDictionaryEntry} */ (/** @type {unknown} */ ({
            type: 'term',
            headwords: [{term: 'give up'}],
            definitions: [
                {dictionary: 'en', sequences: [42], id: 10, entries: ['give up (en)']},
                {dictionary: 'ru', sequences: [42], id: 11, entries: ['сдаться']},
            ],
        }));

        harness.setStrict(true);
        harness.onContentUpdateEntry({dictionaryEntry, element: el, index: 0});
        harness.open();
        harness.render();

        expect(item.querySelector('.gloss-list')).not.toBe(null);
        expect(item.querySelector('.translation-cell')).not.toBe(null);
    });

    test('строки словаря переводов убраны из обычного потока, а английские на месте', () => {
        const el = makeEntryElement();
        const list = /** @type {HTMLElement} */ (el.querySelector('.definition-list'));

        /**
         * @param {string} index
         * @param {string} dictionary
         * @returns {HTMLElement}
         */
        const item = (index, dictionary) => {
            const li = document.createElement('li');
            li.className = 'definition-item';
            li.dataset.index = index;
            li.dataset.dictionary = dictionary;
            const inner = document.createElement('div');
            inner.className = 'definition-item-inner';
            li.appendChild(inner);
            list.appendChild(li);
            return li;
        };
        const enItem = item('0', 'en');
        item('1', 'ru');
        const otherEnItem = item('2', 'en2');

        const dictionaryEntry = /** @type {import('dictionary').TermDictionaryEntry} */ (/** @type {unknown} */ ({
            type: 'term',
            headwords: [{term: 'x'}],
            definitions: [
                {dictionary: 'en', sequences: [-1], id: 1, entries: []},
                {dictionary: 'ru', sequences: [-1], id: 2, entries: []},
                {dictionary: 'en2', sequences: [-1], id: 3, entries: []},
            ],
        }));

        // Гейт снят намеренно: скрытие обязано срабатывать независимо от
        // того, раскрыта ли колонка (Ru не нажимался вовсе).
        harness.onContentUpdateEntry({dictionaryEntry, element: el, index: 0});

        expect(list.querySelectorAll('.definition-item[data-dictionary="ru"]').length).toBe(0);
        expect(list.querySelectorAll('.definition-item').length).toBe(2);
        expect(list.contains(enItem)).toBe(true);
        expect(list.contains(otherEnItem)).toBe(true);
    });

    test('вне resultOutputMode="group" уборка не срабатывает — колонки нет, и перевод не теряется', () => {
        harness = makeHarness((type, lemmas) => { calls.push([type, lemmas]); }, {resultOutputMode: 'merge'});
        const el = makeEntryElement();
        const list = /** @type {HTMLElement} */ (el.querySelector('.definition-list'));
        const ruItem = document.createElement('li');
        ruItem.className = 'definition-item';
        ruItem.dataset.index = '0';
        ruItem.dataset.dictionary = 'ru';
        list.appendChild(ruItem);

        const dictionaryEntry = /** @type {import('dictionary').TermDictionaryEntry} */ (/** @type {unknown} */ ({
            type: 'term',
            headwords: [{term: 'x'}],
            definitions: [{dictionary: 'ru', sequences: [-1], id: 1, entries: []}],
        }));

        // ⚠️ split/merge не сливают статьи в одну сущность — колонки, которая
        // вернула бы спрятанный перевод, не будет никогда. Уборка обязана
        // молчать здесь, иначе перевод терялся бы без возможности его вернуть.
        harness.onContentUpdateEntry({dictionaryEntry, element: el, index: 0});

        expect(list.contains(ruItem)).toBe(true);
        expect(list.querySelectorAll('.definition-item[data-dictionary="ru"]').length).toBe(1);
    });

    test('счётчики data-count/data-definition-count пересчитаны по факту после уборки', () => {
        const el = makeEntryElement();
        el.dataset.definitionCount = '3';
        const list = /** @type {HTMLElement} */ (el.querySelector('.definition-list'));
        list.dataset.count = '3';

        /**
         * @param {string} index
         * @param {string} dictionary
         */
        const item = (index, dictionary) => {
            const li = document.createElement('li');
            li.className = 'definition-item';
            li.dataset.index = index;
            li.dataset.dictionary = dictionary;
            list.appendChild(li);
        };
        item('0', 'en');
        item('1', 'ru');
        item('2', 'en2');

        const dictionaryEntry = /** @type {import('dictionary').TermDictionaryEntry} */ (/** @type {unknown} */ ({
            type: 'term',
            headwords: [{term: 'x'}],
            definitions: [
                {dictionary: 'en', sequences: [-1], id: 1, entries: []},
                {dictionary: 'ru', sequences: [-1], id: 2, entries: []},
                {dictionary: 'en2', sequences: [-1], id: 3, entries: []},
            ],
        }));

        harness.onContentUpdateEntry({dictionaryEntry, element: el, index: 0});

        expect(list.dataset.count).toBe('2');
        expect(el.dataset.definitionCount).toBe('2');
    });

    test('статья целиком из словаря переводов: счётчик уходит в 0, а после открытия колонки и сироты — снова в 1', () => {
        const el = makeEntryElement();
        el.dataset.definitionCount = '1';
        const list = /** @type {HTMLElement} */ (el.querySelector('.definition-list'));
        list.dataset.count = '1';
        const ruItem = document.createElement('li');
        ruItem.className = 'definition-item';
        ruItem.dataset.index = '0';
        ruItem.dataset.dictionary = 'ru';
        list.appendChild(ruItem);

        const dictionaryEntry = makeOrphanEntry('give up', 1);
        harness.onContentUpdateEntry({dictionaryEntry, element: el, index: 0});

        // Уборка сняла единственное определение статьи — секция должна была
        // бы скрыться (data-definition-count='0' скрывает её целиком), иначе
        // список рисуется пустым.
        expect(list.dataset.count).toBe('0');
        expect(el.dataset.definitionCount).toBe('0');

        harness.open();
        harness.render();

        // Строка-сирота дорисована в ТУ ЖЕ секцию — счётчик ВИДИМОСТИ обязан
        // снова показывать 1, иначе секция осталась бы скрытой навсегда через
        // устаревший data-definition-count='0' вместе с самой сиротой.
        expect(el.dataset.definitionCount).toBe('1');
        // ⚠️ А счётчик НУМЕРАЦИИ остаётся 0: настоящих определений у статьи
        // нет, и нумеровать одну сироту нечем и незачем.
        expect(list.dataset.count).toBe('0');
    });

    test('сирота не переводит список определений в нумерованный вид', () => {
        // ⚠️ Дефект, который тут ловится: сирота считалась в
        // .definition-list[data-count], один английский пункт + одна сирота
        // давали 2, CSS переключал список с list-style:none на decimal — и
        // раскладка прыгала на КАЖДОЕ нажатие Ru, хотя настоящее определение
        // по-прежнему одно.
        const el = makeEntryElement();
        const list = /** @type {HTMLElement} */ (el.querySelector('.definition-list'));
        const enItem = document.createElement('li');
        enItem.className = 'definition-item';
        enItem.dataset.index = '0';
        enItem.dataset.dictionary = 'en';
        const enInner = document.createElement('div');
        enInner.className = 'definition-item-inner';
        enItem.appendChild(enInner);
        list.appendChild(enItem);

        const dictionaryEntry = /** @type {import('dictionary').TermDictionaryEntry} */ (/** @type {unknown} */ ({
            type: 'term',
            headwords: [{term: 'give up'}],
            definitions: [
                {dictionary: 'en', sequences: [-1], id: 1, entries: ['give up (en)']},
                {dictionary: 'ru', sequences: [-1], id: 2, entries: ['сдаться']},
            ],
        }));

        harness.onContentUpdateEntry({dictionaryEntry, element: el, index: 0});
        harness.open();
        harness.render();

        // Сирота действительно дорисована — иначе тест был бы зелёным впустую.
        expect(list.querySelectorAll('.translation-orphan').length).toBe(1);
        expect(list.querySelectorAll('.definition-item').length).toBe(2);
        // Нумерация считает только настоящие определения.
        expect(list.dataset.count).toBe('1');
        // Видимость секции считает всё, включая сироту.
        expect(el.dataset.definitionCount).toBe('2');
    });

    test('сироты не размножаются при повторных рендерах (явная проверка, не по числу событий)', () => {
        const el = makeEntryElement();
        harness.addEntry(el, makeOrphanEntry('give up', 1));
        harness.open();
        harness.render();
        harness.render();
        harness.render();

        expect(el.querySelectorAll('.translation-orphan').length).toBe(1);
    });

    test('подсказка кнопки выведена из настраиваемой подписи и следует за ней', () => {
        // ⚠️ Дефект, который тут ловится: title был зашитой строкой, стоящей
        // строкой выше textContent, взятого из options.flibTranslation
        // .buttonLabel. Стоило сменить подпись — и подсказка противоречила
        // самой кнопке.
        const entries = document.createElement('div');
        entries.id = 'dictionary-entries';
        document.body.appendChild(entries);

        harness.ensureButton('Перевод');
        const button = /** @type {HTMLButtonElement} */ (
            document.querySelector('.translation-toolbar-button')
        );
        expect(button).not.toBe(null);
        expect(button.textContent).toBe('Перевод');
        expect(button.title).toContain('Перевод');

        // Кнопка ПЕРЕИСПОЛЬЗУЕТСЯ, а не пересоздаётся: смена подписи обязана
        // тянуть за собой и подсказку, иначе разъезд просто переезжает сюда.
        harness.ensureButton('РУС');
        expect(document.querySelectorAll('.translation-toolbar-button').length).toBe(1);
        expect(button.textContent).toBe('РУС');
        expect(button.title).toContain('РУС');
        expect(button.title).not.toContain('Перевод');
    });

    test('после клика фокус переходит на замену ячейки, а не теряется на body', () => {
        const el = makeEntryElement();
        document.body.appendChild(el);
        harness.addEntry(el, makeOrphanEntry('give up', 1));
        harness.open();
        harness.render();

        const button = /** @type {HTMLButtonElement} */ (el.querySelector('.translation-cell-blurred'));
        button.click();

        const newCell = el.querySelector('.translation-cell');
        expect(newCell).not.toBe(null);
        expect(document.activeElement).toBe(newCell);
    });
});
