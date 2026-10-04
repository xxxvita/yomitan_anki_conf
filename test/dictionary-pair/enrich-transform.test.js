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

import {describe, expect, test} from 'vitest';
import {applyTranslations, buildRussianRows, extractTranslatable} from '../../dev/dictionary-pair/enrich-transform.js';
import {parseJson} from '../../dev/json.js';
import {addJournal, addTerm, createDictDb, createJournalDb, etymologyPath, sensePath, stampFingerprint, wtyArticle} from './fixture-db.js';

/**
 * @param {number} code
 * @returns {string}
 */
const u = (code) => String.fromCodePoint(code);

/**
 * Статья, в которой встречаются все формы узлов: преамбула с этимологией и
 * деревом праформ, пример внутри значения, под-значение без маркера, узел без
 * тега, плоская строка верхнего уровня и легаси-массив.
 */
const FULL_ARTICLE = [
    {
        type: 'structured-content',
        content: [
            {
                tag: 'div',
                data: {content: 'preamble'},
                content: [{
                    tag: 'details',
                    data: {content: 'details-entry-Etymology'},
                    content: [
                        {tag: 'summary', data: {content: 'summary-entry'}, content: 'Etymology'},
                        {tag: 'div', data: {content: 'Etymology-content'}, content: ['From Old English.', {tag: 'div', content: 'Etymology tree\nProto-Germanic'}]},
                    ],
                }],
            },
            {
                tag: 'ol',
                data: {content: 'glosses'},
                content: [
                    {
                        tag: 'li',
                        content: [
                            {tag: 'div', content: ['To sleep.', {tag: 'details', data: {content: 'details-entry-examples'}, content: [{tag: 'summary', data: {content: 'summary-entry'}, content: '1 example'}, 'I dream.']}]},
                            {tag: 'ul', content: [{tag: 'li', content: 'A sub-sense.'}]},
                        ],
                    },
                    {content: 'Tagless.'},
                ],
            },
            {tag: 'div', data: {content: 'backlink'}, content: 'Wiktionary'},
        ],
    },
    'Plain\tgloss.',
    ['take', ['past']],
    {type: 'image', path: 'x.png'},
];

describe('extractTranslatable — грамматика node_path и маркеры', () => {
    test('пути, тексты и роды узлов совпадают с обходчиком Go', () => {
        const nodes = extractTranslatable(JSON.stringify(FULL_ARTICLE));
        expect(nodes).toStrictEqual([
            {path: 'i0/0/div:preamble/0/details:details-entry-Etymology/1/div:Etymology-content/0', text: 'From Old English.', kind: 'etymology'},
            {path: 'i0/0/div:preamble/0/details:details-entry-Etymology/1/div:Etymology-content/1/div', text: 'Etymology tree Proto-Germanic', kind: 'etymology'},
            {path: 'i0/1/ol:glosses/0/li/0/div/0', text: 'To sleep.', kind: 'gloss'},
            {path: 'i0/1/ol:glosses/0/li/1/ul/0/li', text: 'A sub-sense.', kind: 'gloss'},
            {path: 'i0/1/ol:glosses/1/?', text: 'Tagless.', kind: 'gloss'},
            {path: 'i1', text: 'Plain gloss.', kind: 'gloss'},
        ]);
    });

    test('статья только из легаси-массивов (деинфлексия) не даёт ни одного узла', () => {
        expect(extractTranslatable(JSON.stringify([['take', ['past']], ['take', ['past participle']]]))).toStrictEqual([]);
    });

    test('неизвестная форма элемента верхнего уровня — ошибка, а не пропуск', () => {
        expect(() => extractTranslatable('[42]')).toThrow(/неизвестная форма/);
        expect(() => extractTranslatable('{"a":1}')).toThrow();
    });

    test('нестроковый tag — ошибка, как у encoding/json', () => {
        expect(() => extractTranslatable(JSON.stringify([{content: [{tag: 5, content: 'x'}]}]))).toThrow();
    });
});

describe('applyTranslations', () => {
    test('заменяет ровно переводимые листья, пример и дерево праформ остаются', () => {
        const tr = new Map([
            ['i0/1/ol:glosses/0/li/0/div/0', 'Спать.'],
            ['i1', 'Простая.'],
        ]);
        const out = parseJson(applyTranslations(JSON.stringify(FULL_ARTICLE), tr));
        // Строки 'To sleep.' и 'Plain\tgloss.' встречаются в статье ровно по разу.
        const expected = parseJson(JSON.stringify(FULL_ARTICLE).replace('"To sleep."', '"Спать."').replace('"Plain\\tgloss."', '"Простая."'));
        expect(expected).not.toStrictEqual(FULL_ARTICLE);
        expect(out).toStrictEqual(expected);
    });

    test('путь, не найденный в статье, — ошибка рассинхрона', () => {
        expect(() => applyTranslations(JSON.stringify(FULL_ARTICLE), new Map([['i0/9/ol:glosses/0/li/0/div/0', 'x']]))).toThrow(/рассинхрон/);
    });

    test('путь примера (под чужим маркером) не применяется', () => {
        const examplePath = 'i0/1/ol:glosses/0/li/0/div/1/details:details-entry-examples/1';
        expect(() => applyTranslations(JSON.stringify(FULL_ARTICLE), new Map([[examplePath, 'x']]))).toThrow(/рассинхрон/);
    });
});

/**
 * @returns {{dict: import('node:sqlite').DatabaseSync, journal: import('node:sqlite').DatabaseSync}}
 */
function createSources() {
    return {dict: createDictDb(), journal: createJournalDb()};
}

/**
 * Полностью переведённая статья по настоящему адресу.
 * @param {import('node:sqlite').DatabaseSync} dict
 * @param {import('node:sqlite').DatabaseSync} journal
 * @param {string} expression
 * @param {string[]} senses
 * @param {string[]} translations
 * @returns {number}
 */
function addTranslatedArticle(dict, journal, expression, senses, translations) {
    const rowid = addTerm(dict, {dictionary: 'wty-en-en', expression, glossary: wtyArticle({senses}), definitionTags: 'v', rules: 'v'});
    for (const [index, sense] of senses.entries()) {
        addJournal(journal, {expression, dictRowid: rowid, nodePath: sensePath(index), source: sense, translation: translations[index]});
    }
    return rowid;
}

describe('buildRussianRows — журнал → русские статьи', () => {
    test('полная статья: строка-копия английской, штамп = rowid, переводы на местах', () => {
        const {dict, journal} = createSources();
        addTerm(dict, {dictionary: 'wty-en-en', expression: 'aaa', glossary: wtyArticle({senses: ['Filler.']})});
        const rowid = addTranslatedArticle(dict, journal, 'dream', ['To sleep.', 'To wish.'], ['Спать.', 'Мечтать.']);
        stampFingerprint(journal, dict);

        const {rows, stats} = buildRussianRows(dict, journal);
        expect(rowid).toBe(2);
        expect(rows).toHaveLength(1);
        const [row] = rows;
        expect(row.sequence).toBe(2);
        expect({...row, glossary: null}).toStrictEqual({
            expression: 'dream', reading: '', definitionTags: 'v', rules: 'v', score: 0, glossary: null, sequence: 2, termTags: '',
        });
        // Примеры внутри значений (`Example N.`) остаются английскими.
        expect(parseJson(row.glossary)).toStrictEqual(wtyArticle({senses: ['Спать.', 'Мечтать.']}));
        expect(stats).toMatchObject({expressions: 1, nodes: 2, skipped: 0, unchanged: 0});
    });

    test('неполная статья пропускается целиком: отказ и непереведённый узел', () => {
        const {dict, journal} = createSources();
        const failed = addTerm(dict, {dictionary: 'wty-en-en', expression: 'failed', glossary: wtyArticle({senses: ['One.', 'Two.']})});
        addJournal(journal, {expression: 'failed', dictRowid: failed, nodePath: sensePath(0), source: 'One.', translation: 'Один.'});
        addJournal(journal, {expression: 'failed', dictRowid: failed, nodePath: sensePath(1), status: 'failed', source: 'Two.'});
        const partial = addTerm(dict, {dictionary: 'wty-en-en', expression: 'partial', glossary: wtyArticle({senses: ['One.', 'Two.']})});
        addJournal(journal, {expression: 'partial', dictRowid: partial, nodePath: sensePath(0), source: 'One.', translation: 'Один.'});
        addTranslatedArticle(dict, journal, 'whole', ['One.'], ['Один.']);
        stampFingerprint(journal, dict);

        const {rows, stats} = buildRussianRows(dict, journal);
        expect(rows.map((row) => row.expression)).toStrictEqual(['whole']);
        expect(stats.skipped).toBe(2);
    });

    test('перевод, совпавший с оригиналом во всех узлах, не выкладывается; частичное совпадение — выкладывается', () => {
        const {dict, journal} = createSources();
        addTranslatedArticle(dict, journal, 'same', ['That will.', 'Also.'], ['That will.', 'Also.']);
        addTranslatedArticle(dict, journal, 'half', ['That will.', 'Also.'], ['That will.', 'Тоже.']);
        stampFingerprint(journal, dict);

        const {rows, stats} = buildRussianRows(dict, journal);
        expect(rows.map((row) => row.expression)).toStrictEqual(['half']);
        expect(stats.unchanged).toBe(1);
    });

    test('этимология с префиксами "Etymology tree" и "PIE word" не требует перевода, прочая — требует', () => {
        const {dict, journal} = createSources();
        const etymology = ['Etymology tree\nProto-Germanic *draumaz', 'PIE word\n*dʰrewgʰ-'];
        const exempt = addTerm(dict, {dictionary: 'wty-en-en', expression: 'exempt', glossary: wtyArticle({senses: ['A dream.'], etymology})});
        addJournal(journal, {expression: 'exempt', dictRowid: exempt, nodePath: sensePath(0, true), source: 'A dream.', translation: 'Сон.'});
        const plain = addTerm(dict, {dictionary: 'wty-en-en', expression: 'plain', glossary: wtyArticle({senses: ['A dream.'], etymology: ['From Old English.']})});
        addJournal(journal, {expression: 'plain', dictRowid: plain, nodePath: sensePath(0, true), source: 'A dream.', translation: 'Сон.'});
        stampFingerprint(journal, dict);

        const {rows, stats} = buildRussianRows(dict, journal);
        expect(rows.map((row) => row.expression)).toStrictEqual(['exempt']);
        expect(stats.skipped).toBe(1);
        // Таблицы праформ едут в русскую статью дословно.
        const glossary = JSON.stringify(parseJson(rows[0].glossary));
        expect(glossary).toContain('Etymology tree\\nProto-Germanic *draumaz');
        expect(glossary).toContain('PIE word\\n*dʰrewgʰ-');
        expect(etymologyPath(0)).toBe('i0/0/div:preamble/0/details:details-entry-Etymology/1/div:Etymology-content/0/div');
    });

    test('легаси-запись (dict_rowid=0) садится на первую НЕ-русскую строку по rowid', () => {
        const {dict, journal} = createSources();
        addTerm(dict, {dictionary: 'wty-en-en', expression: 'filler', glossary: wtyArticle({senses: ['Filler.']})});
        // Устаревшая русская строка того же выражения стоит РАНЬШЕ сочинённой.
        addTerm(dict, {dictionary: 'flibooster-en-ru', expression: 'happen to', glossary: wtyArticle({senses: ['Стало.']}), sequence: 1});
        const first = addTerm(dict, {dictionary: 'flibooster-en', expression: 'happen to', glossary: wtyArticle({senses: ['To occur by chance.']}), definitionTags: 'phrase', rules: 'phrase'});
        addTerm(dict, {dictionary: 'flibooster-en', expression: 'happen to', glossary: wtyArticle({senses: ['Second POS.']}), definitionTags: 'v', rules: 'v'});
        addJournal(journal, {expression: 'happen to', dictRowid: 0, nodePath: sensePath(0), source: 'To occur by chance.', translation: 'Случиться.'});
        stampFingerprint(journal, dict);

        const {rows, legacyExpressions} = buildRussianRows(dict, journal);
        expect(first).toBe(3);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({expression: 'happen to', sequence: 3, definitionTags: 'phrase'});
        expect(legacyExpressions).toStrictEqual(new Set(['happen to']));
    });

    test('легаси-запись без статьи в словаре — фатальная ошибка', () => {
        const {dict, journal} = createSources();
        addTranslatedArticle(dict, journal, 'here', ['One.'], ['Один.']);
        addJournal(journal, {expression: 'ghost', dictRowid: 0, nodePath: sensePath(0), source: 'One.', translation: 'Один.'});
        stampFingerprint(journal, dict);
        expect(() => buildRussianRows(dict, journal)).toThrow(/нет в словаре.*ghost/);
    });

    test('две статьи журнала на одну строку словаря (дубль штампа) — фатальная ошибка', () => {
        const {dict, journal} = createSources();
        addTranslatedArticle(dict, journal, 'twice', ['One.'], ['Один.']);
        addJournal(journal, {expression: 'twice', dictRowid: 0, nodePath: sensePath(0), source: 'One.', translation: 'Раз.'});
        stampFingerprint(journal, dict);
        expect(() => buildRussianRows(dict, journal)).toThrow(/дважды/);
    });

    test('статья-деинфлексия (только массивы) не получает русской строки', () => {
        const {dict, journal} = createSources();
        const rowid = addTerm(dict, {dictionary: 'wty-en-en', expression: 'took', glossary: [['take', ['past']]]});
        addJournal(journal, {expression: 'took', dictRowid: rowid, nodePath: 'i0', source: 'take', translation: 'брать'});
        addTranslatedArticle(dict, journal, 'take', ['To grab.'], ['Брать.']);
        stampFingerprint(journal, dict);
        const {rows} = buildRussianRows(dict, journal);
        expect(rows.map((row) => row.expression)).toStrictEqual(['take']);
    });

    test('U+0085 в статье: журнал хранит Go-очищенный исходник, сверка проходит', () => {
        const {dict, journal} = createSources();
        const rowid = addTerm(dict, {dictionary: 'wty-en-en', expression: 'nel', glossary: wtyArticle({senses: [`To${u(0x85)}sleep.`]})});
        addJournal(journal, {expression: 'nel', dictRowid: rowid, nodePath: sensePath(0), source: 'To sleep.', translation: 'Спать.'});
        stampFingerprint(journal, dict);
        const {rows} = buildRussianRows(dict, journal);
        expect(rows).toHaveLength(1);
    });

    test('U+FEFF в статье: Go его не срезает, сверка с журналом проходит', () => {
        const {dict, journal} = createSources();
        const text = `${u(0xfeff)}To sleep.`;
        const rowid = addTerm(dict, {dictionary: 'wty-en-en', expression: 'bom', glossary: wtyArticle({senses: [text]})});
        addJournal(journal, {expression: 'bom', dictRowid: rowid, nodePath: sensePath(0), source: text, translation: 'Спать.'});
        stampFingerprint(journal, dict);
        const {rows} = buildRussianRows(dict, journal);
        expect(rows).toHaveLength(1);
    });

    test('исходник в журнале не совпал с текстом статьи — фатальная ошибка', () => {
        const {dict, journal} = createSources();
        const rowid = addTerm(dict, {dictionary: 'wty-en-en', expression: 'moved', glossary: wtyArticle({senses: ['New text.']})});
        addJournal(journal, {expression: 'moved', dictRowid: rowid, nodePath: sensePath(0), source: 'Old text.', translation: 'Старое.'});
        stampFingerprint(journal, dict);
        expect(() => buildRussianRows(dict, journal)).toThrow(/словарь пересобрали/);
    });

    test('лишний готовый путь в журнале — фатальная ошибка рассинхрона', () => {
        const {dict, journal} = createSources();
        const rowid = addTranslatedArticle(dict, journal, 'extra', ['One.'], ['Один.']);
        addJournal(journal, {expression: 'extra', dictRowid: rowid, nodePath: sensePath(5), source: 'Gone.', translation: 'Нет.'});
        stampFingerprint(journal, dict);
        expect(() => buildRussianRows(dict, journal)).toThrow(/рассинхрон/);
    });

    test('выборочная сверка адресов журнала ловит перенумерованный словарь', () => {
        const {dict, journal} = createSources();
        const rowid = addTerm(dict, {dictionary: 'wty-en-en', expression: 'real', glossary: wtyArticle({senses: ['One.']})});
        addJournal(journal, {expression: 'other', dictRowid: rowid, nodePath: sensePath(0), source: 'One.', translation: 'Один.'});
        expect(() => buildRussianRows(dict, journal)).toThrow(/протухли/);
    });

    test('адрес журнала указывает на другое слово или чужой словарь — фатальная ошибка', () => {
        const a = createSources();
        // Выборка сверки (100 записей, порядок rowid % 97) целиком уходит на
        // отказы статьи по адресу 1, и битый адрес 2 до неё не доходит —
        // ловить его обязана сама выкладка статьи.
        addTerm(a.dict, {dictionary: 'wty-en-en', expression: 'filler', glossary: wtyArticle({senses: ['One.']})});
        for (let i = 0; i < 100; ++i) {
            addJournal(a.journal, {expression: 'filler', dictRowid: 1, nodePath: `i${i}`, status: 'failed'});
        }
        const rowid = addTerm(a.dict, {dictionary: 'wty-en-en', expression: 'real', glossary: wtyArticle({senses: ['One.']})});
        addJournal(a.journal, {expression: 'a-other', dictRowid: rowid, nodePath: sensePath(0), source: 'One.', translation: 'Один.'});
        expect(() => buildRussianRows(a.dict, a.journal)).toThrow(/описывает слово/);

        const b = createSources();
        const authored = addTerm(b.dict, {dictionary: 'flibooster-en', expression: 'mine', glossary: wtyArticle({senses: ['One.']})});
        addJournal(b.journal, {expression: 'mine', dictRowid: authored, nodePath: sensePath(0), source: 'One.', translation: 'Один.'});
        expect(() => buildRussianRows(b.dict, b.journal)).toThrow(/принадлежит словарю/);
    });

    test('отпечаток журнала не совпал со словарём — фатальная ошибка', () => {
        const {dict, journal} = createSources();
        addTranslatedArticle(dict, journal, 'word', ['One.'], ['Один.']);
        stampFingerprint(journal, dict);
        journal.prepare("UPDATE meta SET value = '999' WHERE key = 'dict_rows'").run();
        expect(() => buildRussianRows(dict, journal)).toThrow(/другого словаря/);
    });

    test('журнал старого ключа (без dict_rowid в PRIMARY KEY) — отказ', () => {
        const dict = createDictDb();
        const journal = createJournalDb();
        journal.exec('DROP TABLE enrich_log; CREATE TABLE enrich_log (expression TEXT, dict_rowid INTEGER, node_path TEXT, kind TEXT, status TEXT, source TEXT, translation TEXT, updated_at INTEGER, PRIMARY KEY (expression, node_path))');
        expect(() => buildRussianRows(dict, journal)).toThrow(/migrate-journal/);
    });

    test('порядок строк — побайтный UTF-8 выражения, затем штамп', () => {
        const {dict, journal} = createSources();
        addTranslatedArticle(dict, journal, u(0xff21), ['One.'], ['Один.']);
        addTranslatedArticle(dict, journal, u(0x1f600), ['One.'], ['Один.']);
        addTranslatedArticle(dict, journal, 'b', ['One.'], ['Один.']);
        stampFingerprint(journal, dict);
        const {rows} = buildRussianRows(dict, journal);
        expect(rows.map((row) => row.expression)).toStrictEqual(['b', u(0xff21), u(0x1f600)]);
    });
});
