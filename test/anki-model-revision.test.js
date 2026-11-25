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

import {createHash} from 'node:crypto';
import {readdirSync, readFileSync} from 'node:fs';
import {describe, expect, test} from 'vitest';
import {modelRevision, stampRevMarker, stripRevMarker} from '../dev/anki-models/revision.js';
import {FLIB_PHRASES_MODEL, FLIB_PRODUCT_DECK, hashModelContent, normalizeModelContent} from '../ext/js/data/flib-anki-models.js';
import {parseJson} from '../ext/js/core/json.js';

/**
 * @param {string} name
 * @returns {import('../dev/anki-models/revision.js').SourceModel}
 */
function source(name) {
    return /** @type {import('../dev/anki-models/revision.js').SourceModel} */ (parseJson(readFileSync(new URL(`../dev/data/anki-models/${name}.json`, import.meta.url), 'utf8')));
}

/** @returns {import('flib-anki-models').FlibAnkiModelsFile} */
function generated() {
    return /** @type {import('flib-anki-models').FlibAnkiModelsFile} */ (parseJson(readFileSync(new URL('../ext/data/flib-anki-models.json', import.meta.url), 'utf8')));
}

/**
 * SHA-256 of the text as it is: the normalisation is what the tests check.
 * @param {string} text
 * @returns {string}
 */
const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex');

/**
 * Printed by the Go code of anki_conf (sha256 of normContent, CSS without the marker), not by this repository.
 * @type {Record<string, {revision: string, front: string, back: string, css: string}>}
 */
const HISTORY = {
    'Phrases-b93676dce': {
        revision: '70fe62c12a65050d',
        front: 'a3dfb425b9ef005c67a797e134f9830e936bc399b88490774057371b8c7bf126',
        back: 'f386dfc11ec2f046a5d49dd026bef59198e6d914aca5bcc45957177d2d021844',
        css: 'bd2c4dc7807b346b3b4aa032a346d9a12bb3e296c52e37cf2127360c744f41ba',
    },
    'Phrases-f324acde9': {
        revision: '242a8c70246f3a95',
        front: 'a8544e885f98f1cc7387d3c93aa6e53499b545ee8faf21d1bc89a3bb194045ec',
        back: '6b09344a5489483d2b7ab31d5d4b4fc075b7fc2e927836aab572d58239abbf6c',
        css: 'a2d236429bfa5f31d19dbb82bbf7d4858c00e169df850ff18f46badece6c7a66',
    },
};
/** The new Phrases, from the same Go run. */
const NEW_PHRASES = {
    front: '579c158a24fd285d192d9f75c6f1d90c6e4f751fa8c99d4accda91b4be0326b2',
    back: 'acc42ea8e8d420425143abd1b96bc59a5349dda968011312e3c38ac5b8fbde32',
    css: '165cdc53e221320a15e4ddd4b377c7977e729e098a3e9bb004f5b53812ebe348',
};

describe('modelRevision', () => {
    test.each([
        ['Yomitan Card Type', 'fc38edc91863cf3d'],
        ['ReverseDeck', 'eb902e8263b4dbcf'],
        ['Phrases', '38b6cd5861e4785f'],
        ...Object.entries(HISTORY).map(([name, {revision}]) => /** @type {[string, string]} */ ([`history/${name}`, revision])),
    ])('golden revision of %s matches the Go installer', (name, revision) => {
        expect(modelRevision(source(name))).toBe(revision);
    });

    test('a marker in the CSS does not change the revision', () => {
        const model = source('Phrases');
        expect(modelRevision({...model, css: stampRevMarker(model.css, '0123456789abcdef')})).toBe('38b6cd5861e4785f');
    });
});

describe('stampRevMarker', () => {
    test('marker replaces, never stacks', () => {
        const once = stampRevMarker('a{}', '0123456789abcdef');
        const twice = stampRevMarker(once, 'fedcba9876543210');
        expect(twice).toBe('/* ankimodels-rev:fedcba9876543210 */\na{}');
        expect(stripRevMarker(twice)).toBe('a{}');
    });
});

describe('ext/data/flib-anki-models.json', () => {
    test('generated data matches sources', () => {
        const file = generated();
        expect(FLIB_PRODUCT_DECK).toBe('Flibooster');
        expect(file.source).toBe('anki_conf 3a31a19b3');
        expect(file.models.map(({name}) => name)).toStrictEqual(['Phrases', 'ReverseDeck', 'Yomitan Card Type']);
        for (const model of file.models) {
            const src = source(model.name);
            expect(model.fields).toStrictEqual(src.fields);
            expect(model.isCloze).toBe(false);
            expect(model.css).toBe(stampRevMarker(src.css, modelRevision(src)));
            expect(model.cardTemplates).toStrictEqual(Object.keys(src.templates).sort().map((templateName) => ({Name: templateName, Front: src.templates[templateName].Front, Back: src.templates[templateName].Back})));
        }
    });

    test('the new Phrases: the last field is for the videos', () => {
        const phrases = generated().models.find(({name}) => name === FLIB_PHRASES_MODEL);
        expect(phrases?.fields).toStrictEqual(['Front', 'Expression', 'EnglishWord', 'ExpressionTranslate', 'Audio_front', 'Audio_expression', 'flib_media']);
        expect(phrases?.cardTemplates.map(({Name}) => Name)).toStrictEqual(['Card 1']);
        expect(phrases?.cardTemplates[0].Back).toContain('{{flib_media}}');
        expect(phrases?.cardTemplates[0].Front).not.toContain('flib_media');
    });

    test('only Phrases has previous revisions: every file of the history, as Go hashes it', () => {
        const history = Object.values(HISTORY);
        for (const {name, previous} of generated().models) {
            expect(previous).toStrictEqual(name === 'Phrases' ? {front: history.map(({front}) => front), back: history.map(({back}) => back), css: history.map(({css}) => css)} : void 0);
        }
        const files = readdirSync(new URL('../dev/data/anki-models/history/', import.meta.url)).sort();
        expect(files).toStrictEqual(Object.keys(HISTORY).map((name) => `${name}.json`));
    });

    test.each(Object.entries(HISTORY))('%s is the file that was hashed', (name, {front, back, css}) => {
        const model = source(`history/${name}`);
        expect(model.name).toBe('Phrases');
        expect(Object.keys(model.templates)).toStrictEqual(['Card 1']);
        const {Front, Back} = model.templates['Card 1'];
        expect([Front, Back, model.css].map((text) => sha256(text.replaceAll('\r\n', '\n').trim()))).toStrictEqual([front, back, css]);
    });

    test('a template of the new revision is told from the previous ones by its hash', async () => {
        const phrases = /** @type {import('flib-anki-models').FlibAnkiModel} */ (generated().models.find(({name}) => name === 'Phrases'));
        const [{Front, Back}] = phrases.cardTemplates;
        expect({front: await hashModelContent(Front), back: await hashModelContent(Back), css: await hashModelContent(phrases.css)}).toStrictEqual(NEW_PHRASES);
        expect(phrases.previous?.front).not.toContain(NEW_PHRASES.front);
        expect(phrases.previous?.back).not.toContain(NEW_PHRASES.back);
        expect(phrases.previous?.css).not.toContain(NEW_PHRASES.css);
    });

    test('an installed previous revision is recognised: stamped by Flibooster, with Windows line breaks', async () => {
        const previous = generated().models.find(({name}) => name === 'Phrases')?.previous;
        for (const name of Object.keys(HISTORY)) {
            const model = source(`history/${name}`);
            const {Front, Back} = model.templates['Card 1'];
            const crlf = (/** @type {string} */ text) => text.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');
            for (const convert of [(/** @type {string} */ text) => text, crlf]) {
                expect(previous?.front).toContain(await hashModelContent(convert(Front)));
                expect(previous?.back).toContain(await hashModelContent(convert(Back)));
                expect(previous?.css).toContain(await hashModelContent(convert(model.css)));
                expect(previous?.css).toContain(await hashModelContent(convert(stampRevMarker(model.css, modelRevision(model)))));
            }
        }
    });
});

describe('hashModelContent', () => {
    const CSS = '.a {}\n.b {}\n\n.c {}';

    test.each([
        ['as it is', CSS],
        ['CRLF', '.a {}\r\n.b {}\r\n\r\n.c {}'],
        ['CR', '.a {}\r.b {}\r\r.c {}'],
        ['mixed line breaks', '.a {}\r.b {}\r\n\n.c {}'],
        ['spaces around', `\r\n \t${CSS}\n\n`],
        ['a marker', `/* ankimodels-rev:0123456789abcdef */\n${CSS}`],
        ['a marker before CRLF', `/* ankimodels-rev:0123456789abcdef */\r\n${CSS}`],
        ['a marker before CR', `/* ankimodels-rev:0123456789abcdef */\r${CSS}`],
        ['a marker in the middle', `.a {}\n/*ankimodels-rev:x*/ \t\n${CSS.slice(6)}`],
        ['a marker in the middle, CR', `.a {}\r/*ankimodels-rev:x*/\r${CSS.slice(6)}`],
        ['a malformed marker', `/* \tankimodels-rev:a*b  */${CSS}`],
        ['two markers', `/* ankimodels-rev:1 */\n/* ankimodels-rev:2 */\n${CSS}`],
        ['a marker made by removing another', `/* ankimodels-/* ankimodels-rev:1 */rev:2 */\n${CSS}`],
    ])('%s', async (_name, css) => {
        expect(normalizeModelContent(css)).toBe(CSS);
        expect(await hashModelContent(css)).toBe(sha256(CSS));
    });

    test.each([
        ['another comment', `/* ankimodels */\n${CSS}`],
        ['a comment over two lines', `/* ankimodels-rev:1\n */\n${CSS}`],
        ['a space inside', CSS.replace('.a ', '.a  ')],
        ['a line less', CSS.replace('\n\n', '\n')],
        ['nothing', ''],
    ])('not the same: %s', async (_name, css) => {
        expect(normalizeModelContent(css)).toBe(css);
        expect(await hashModelContent(css)).toBe(sha256(css));
    });

    test('Cyrillic is hashed as UTF-8', async () => {
        expect(await hashModelContent('да')).toBe('cdc5ed90cb4b9a7540b24d1c45c23c851930c98b07b6885667114c9f95fb0a12');
    });

    test('the marker is the one of Flibooster', () => {
        for (const css of ['/* ankimodels-rev:1 */ /* ankimodels-rev:2 */x', 'a/*ankimodels-rev:*/b', '/*  ankimodels-rev:a/*b */c', '/* ankimodels-rev:1 *//* other */', '/* ankimodels-rev:1']) {
            expect(normalizeModelContent(css)).toBe(stripRevMarker(css).trim());
        }
    });
});
