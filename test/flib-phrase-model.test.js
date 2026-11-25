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

import {readFileSync} from 'node:fs';
import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {Backend} from '../ext/js/background/backend.js';
import {ensurePhraseModel, isAnkiClosedError, PhraseModelPreparer, requirePhraseServer} from '../ext/js/background/flib-phrase-model.js';
import {AnkiConnect} from '../ext/js/comm/anki-connect.js';
import {API} from '../ext/js/comm/api.js';
import {parseJson} from '../ext/js/core/json.js';

/* eslint-disable no-underscore-dangle, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */

const CORE = 'http://127.0.0.1:8777';
const DIRECT = 'http://127.0.0.1:8765';
const REVISION = '38b6cd5861e4785f';

const MODELS_TEXT = readFileSync(new URL('../ext/data/flib-anki-models.json', import.meta.url), 'utf8');
/** @type {import('flib-anki-models').FlibAnkiModelsFile} */
const MODELS = parseJson(MODELS_TEXT);
const MODEL = /** @type {import('flib-anki-models').FlibAnkiModel} */ (MODELS.models.find(({name}) => name === 'Phrases'));
const NEW_CARD = {Front: MODEL.cardTemplates[0].Front, Back: MODEL.cardTemplates[0].Back};
const OLD_FIELDS = MODEL.fields.filter((name) => name !== 'flib_media');

/**
 * @typedef {object} FakeType
 * @property {string[]} fields
 * @property {Record<string, {Front: string, Back: string}>} templates
 * @property {string} css
 */

/**
 * @param {string} name
 * @returns {FakeType}
 */
function previousType(name) {
    /** @type {{css: string, fields: string[], templates: Record<string, {Front: string, Back: string}>}} */
    const {css, fields, templates} = parseJson(readFileSync(new URL(`../dev/data/anki-models/history/${name}.json`, import.meta.url), 'utf8'));
    return {fields, templates, css};
}

const OLD = previousType('Phrases-f324acde9');
const OLDER = previousType('Phrases-b93676dce');
/** @type {FakeType} */
const NEW = {fields: MODEL.fields, templates: {'Card 1': NEW_CARD}, css: MODEL.css};
const BASIC_CARD = {Front: '{{Front}}', Back: '{{FrontSide}}\n\n<hr id=answer>\n\n{{Back}}'};
const BASIC_CSS = '.card {\n    font-family: arial;\n    font-size: 20px;\n}\n';
/**
 * What Core makes with Anki closed. Anki ids of note types are timestamps, so its «Basic, id = 1» is hardly ever there: empty.
 * @type {FakeType}
 */
const CORE_EMPTY = {fields: OLD_FIELDS, templates: {'Card 1': {Front: '', Back: ''}}, css: ''};
/** @type {FakeType} */
const CORE_BASIC = {fields: OLD_FIELDS, templates: {'Card 1': BASIC_CARD}, css: BASIC_CSS};

/** The template of a Core type while the rest of it is written. */
const BRIDGE = {Front: '{{Front}}<!-- flibooster -->', Back: '{{FrontSide}}'};

/** Names that Anki 26.05 takes without such a field. */
const SPECIAL = new Set(['FrontSide', 'Tags', 'Type', 'Deck', 'Subdeck', 'Card', 'CardFlag', 'CardID', '']);

/**
 * What Anki trims: U+0085 too, and not U+FEFF.
 * @param {string} text
 * @returns {string}
 */
const trim = (text) => text.replaceAll(/^(?:(?!\uFEFF)[\s\u0085])+|(?:(?!\uFEFF)[\s\u0085])+$/g, '');

/**
 * The names in a template, as Anki 26.05 reads it: not in comments; `{{=<% %>=}}` at the start changes the braces.
 * @param {string} side
 * @returns {string[]}
 */
function references(side) {
    const legacy = trim(side).startsWith('{{=<% %>=}}');
    const pattern = legacy ? /<!--[\s\S]*?-->|<%([\s\S]*?)%>/g : /<!--[\s\S]*?-->|\{\{([\s\S]*?)\}\}/g;
    return [...side.matchAll(pattern)]
        .map((match) => match[1])
        .filter((content) => typeof content === 'string' && !content.startsWith('=<%'))
        .map((content) => trim(/** @type {string} */ (trim(content.replace(/^\{+/, '')).replace(/^[#^/]/, '').split(':')
            .at(-1))));
}

/**
 * AnkiConnect with an open Anki. What it does was checked against Anki 26.05 (python library, a scratch collection).
 */
class FakeAnki {
    /**
     * @param {?FakeType} type
     * @param {string} [name]
     */
    constructor(type, name = 'Phrases') {
        /** @type {Map<string, FakeType>} */
        this.types = new Map([['Basic', {fields: ['Front', 'Back'], templates: {'Card 1': BASIC_CARD}, css: BASIC_CSS}]]);
        if (type !== null) { this.types.set(name, structuredClone(type)); }
        /** @type {string[]} */
        this.decks = ['Default'];
    }

    /** @returns {FakeType|undefined} */
    get phrases() { return this.types.get('Phrases'); }

    /**
     * @param {string} action
     * @param {Record<string, any>} params
     * @returns {unknown}
     * @throws {Error}
     */
    run(action, params) {
        switch (action) {
            case 'version': return 6;
            case 'modelNames': return [...this.types.keys()];
            case 'modelFieldNames': return [...this._get(params.modelName).fields];
            case 'modelTemplates': return structuredClone(this._get(params.modelName).templates);
            case 'modelStyling': return {css: this._get(params.modelName).css};
            case 'createDeck':
                if (!this.decks.includes(params.deck)) { this.decks.push(params.deck); }
                return 5;
            case 'createModel': {
                if (this.types.has(params.modelName)) { throw new Error('Model name already exists'); }
                const templates = Object.fromEntries(params.cardTemplates.map((/** @type {*} */ {Name, Front, Back}) => [Name, {Front, Back}]));
                this._save(params.modelName, {fields: [...params.inOrderFields], templates, css: params.css});
                return {id: 1};
            }
            case 'modelFieldAdd': {
                const type = this._copy(params.modelName);
                if (!type.fields.includes(params.fieldName)) { type.fields.push(params.fieldName); }
                if (typeof params.index === 'number') {
                    type.fields.splice(type.fields.indexOf(params.fieldName), 1);
                    type.fields.splice(params.index, 0, params.fieldName);
                }
                return this._save(params.modelName, type);
            }
            case 'updateModelTemplates': {
                const type = this._copy(params.model.name);
                for (const [name, template] of Object.entries(type.templates)) {
                    const {Front = '', Back = ''} = params.model.templates[name] ?? {};
                    if (Front !== '') { template.Front = Front; }
                    if (Back !== '') { template.Back = Back; }
                }
                return this._save(params.model.name, type);
            }
            case 'updateModelStyling':
                return this._save(params.model.name, {...this._copy(params.model.name), css: params.model.css});
            default:
                throw new Error('unsupported action');
        }
    }

    /**
     * @param {string} name
     * @returns {FakeType}
     * @throws {Error}
     */
    _get(name) {
        const type = this.types.get(name);
        if (typeof type === 'undefined') { throw new Error(`model was not found: ${name}`); }
        return type;
    }

    /**
     * @param {string} name
     * @returns {FakeType}
     */
    _copy(name) { return structuredClone(this._get(name)); }

    /**
     * Anki checks EVERY template of the type on every save of it, also of one field or of the CSS.
     * @param {string} name
     * @param {FakeType} type
     * @returns {null}
     * @throws {Error}
     */
    _save(name, type) {
        for (const {Front, Back} of Object.values(type.templates)) {
            if (references(Front).filter((field) => !SPECIAL.has(field)).length === 0) { throw new Error('Expected to find a field replacement on the front of the card template.'); }
            for (const field of [...references(Front), ...references(Back)]) {
                if (!SPECIAL.has(field) && !/^c\+?\d+$/.test(field) && !type.fields.includes(field)) { throw new Error(`Field '${field}' not found.`); }
            }
        }
        const fronts = Object.values(type.templates).map(({Front}) => Front);
        if (new Set(fronts).size < fronts.length) { throw new Error('The front of two card templates is the same.'); }
        this.types.set(name, type);
        return null;
    }
}

/**
 * @typedef {object} Sent
 * @property {string} server
 * @property {string} action
 * @property {Record<string, any>} params
 * @property {number} number of the request, from 0
 * @property {?AbortSignal} signal
 */

const WRITES = new Set(['createDeck', 'createModel', 'modelFieldAdd', 'updateModelTemplates', 'updateModelStyling']);

/** @type {Record<string, FakeAnki>} */
let servers = {};
/** @type {Sent[]} */
let sent = [];
/**
 * What a server answers instead of Anki; undefined — Anki answers. May throw: the network.
 * @type {(request: Sent, run: () => unknown) => (Response|Promise<Response>|undefined)}
 */
let answer = (_request, _run) => void 0;

/** @type {typeof fetch} */
const fakeFetch = async (input, init = {}) => {
    if (input === 'chrome-extension://x/data/flib-anki-models.json') { return new Response(MODELS_TEXT); }
    /** @type {{action: string, params: Record<string, any>}} */
    const {action, params} = parseJson(typeof init.body === 'string' ? init.body : '{}');
    // Rule: no request of the preparation may reach the fallback of Core.
    expect(init.headers).toStrictEqual({'Content-Type': 'application/json', 'X-Anki-No-Fallback': '1'});
    /** @type {Sent} */
    const request = {server: /** @type {string} */ (input), action, params, number: sent.length, signal: init.signal ?? null};
    sent.push(request);
    const run = () => servers[request.server].run(action, params);
    const answered = await answer(request, run);
    if (typeof answered !== 'undefined') { return answered; }
    if (!(request.server in servers)) { throw new TypeError('Failed to fetch'); }
    try {
        return new Response(JSON.stringify(run()));
    } catch (e) {
        return new Response(JSON.stringify({result: null, error: /** @type {Error} */ (e).message}));
    }
};

beforeEach(() => {
    servers = {};
    sent = [];
    answer = () => void 0;
    vi.stubGlobal('fetch', fakeFetch);
});
afterEach(() => { vi.unstubAllGlobals(); });

/**
 * @param {string} [server]
 * @returns {AnkiConnect}
 */
function makeAnki(server = DIRECT) {
    const anki = new AnkiConnect();
    anki.enabled = true;
    anki.server = server;
    return anki;
}

/**
 * @param {?FakeType} type
 * @param {string} [name]
 * @returns {FakeAnki} The Anki at DIRECT.
 */
function install(type, name) {
    servers[DIRECT] = new FakeAnki(type, name);
    return servers[DIRECT];
}

/** @returns {Promise<{videoHidden: boolean}>} With a client of its own, as after a restart of the worker. */
function ensure() { return ensurePhraseModel(makeAnki(), MODEL); }

/** @returns {string[]} */
function writes() { return sent.filter(({action}) => WRITES.has(action)).map(({action}) => action); }

/**
 * @param {Promise<unknown>} promise
 * @returns {Promise<{code: unknown, detail: unknown, data: Record<string, unknown>}>}
 */
async function rejected(promise) {
    try {
        await promise;
    } catch (e) {
        const {data} = /** @type {{data: Record<string, unknown>}} */ (e);
        return {code: data?.code, detail: data?.detail, data};
    }
    throw new Error('expected a rejection');
}

/**
 * @param {FakeType} base
 * @param {Partial<FakeType>} change
 * @returns {FakeType}
 */
const withChange = (base, change) => ({...structuredClone(base), ...change});

/**
 * @param {FakeType} base
 * @param {{Front?: string, Back?: string}} change
 * @returns {FakeType}
 */
const withCard = (base, change) => withChange(base, {templates: {'Card 1': {...base.templates['Card 1'], ...change}}});

/** @type {(text: string) => string} */
const crlf = (text) => text.replaceAll('\r\n', '\n').replaceAll('\n', '\r\n');

const FIELD = 'modelFieldAdd';
const TEMPLATES = 'updateModelTemplates';
const CSS = 'updateModelStyling';

/**
 * Types that become the new one: name, installed, writes in order.
 * @type {[name: string, type: ?FakeType, expected: string[]][]}
 */
const KNOWN = [
    ['missing', null, ['createDeck', 'createModel']],
    ['f324acde9', OLD, [FIELD, TEMPLATES, CSS]],
    ['b93676dce', OLDER, [FIELD, TEMPLATES, CSS]],
    ['f324acde9 with the marker of Flibooster', withChange(OLD, {css: `/* ankimodels-rev:242a8c70246f3a95 */\n${OLD.css}`}), [FIELD, TEMPLATES, CSS]],
    ['f324acde9 with Windows line breaks', {fields: OLD.fields, templates: {'Card 1': {Front: crlf(OLD.templates['Card 1'].Front), Back: crlf(OLD.templates['Card 1'].Back)}}, css: crlf(OLD.css)}, [FIELD, TEMPLATES, CSS]],
    ['sides and CSS of different known versions', {fields: OLD.fields, templates: {'Card 1': {Front: OLDER.templates['Card 1'].Front, Back: OLD.templates['Card 1'].Back}}, css: OLDER.css}, [FIELD, TEMPLATES, CSS]],
    ['the field only', withChange(OLD, {fields: MODEL.fields}), [TEMPLATES, CSS]],
    ['the field and the front', withCard(withChange(OLD, {fields: MODEL.fields}), {Front: NEW_CARD.Front}), [TEMPLATES, CSS]],
    ['the field and the back', withCard(withChange(OLD, {fields: MODEL.fields}), {Back: NEW_CARD.Back}), [TEMPLATES, CSS]],
    ['all but the CSS', withChange(NEW, {css: OLD.css}), [CSS]],
    ['all but the templates', withChange(OLD, {fields: MODEL.fields, css: NEW.css}), [TEMPLATES]],
    ['new', NEW, []],
    ['new, CSS without the marker', withChange(NEW, {css: MODEL.css.slice(MODEL.css.indexOf('\n') + 1)}), []],
    ['new, the field is not last', withChange(NEW, {fields: ['Front', 'flib_media', ...MODEL.fields.slice(1, -1)]}), []],
    ['new, with a field of the user', withChange(NEW, {fields: [...MODEL.fields, 'Моё']}), []],
    ['f324acde9 with a field of the user', withChange(OLD, {fields: [...OLD.fields, 'Моё']}), [FIELD, TEMPLATES, CSS]],
    ['f324acde9 with a second template of the user', withChange(OLD, {templates: {'Card 1': OLD.templates['Card 1'], 'Моя': {Front: '{{Expression}}', Back: '{{Front}}'}}}), [FIELD, TEMPLATES, CSS]],
    ['a second template of the user comes first', withChange(OLD, {templates: {'Моя': {Front: '{{Expression}}', Back: '{{Front}}'}, 'Card 1': OLD.templates['Card 1']}}), [FIELD, TEMPLATES, CSS]],
    ['Core with Anki closed: empty', CORE_EMPTY, [TEMPLATES, FIELD, CSS, TEMPLATES]],
    ['Core with Anki closed: a copy of Basic', CORE_BASIC, [TEMPLATES, FIELD, CSS, TEMPLATES]],
    ['Core with Anki closed: a copy of a translated Basic', withCard(CORE_BASIC, {Front: '{{Вопрос}}', Back: '{{FrontSide}}<hr id=answer>{{Ответ}}'}), [TEMPLATES, FIELD, CSS, TEMPLATES]],
    ...['Back', '背面', 'Ön yüz', 'पृष्ठ', 'Rückseite 2', 'text_1-2', '2'].map((name) => /** @type {[string, FakeType, string[]]} */ ([`Core with Anki closed: a copy of Basic with the field ${name}`, withCard(CORE_BASIC, {Front: '{{Front}}', Back: `{{FrontSide}}<hr>{{${name}}}`}), [TEMPLATES, FIELD, CSS, TEMPLATES]])),
    ['Core with Anki closed: a copy of Basic with comments', withCard(CORE_BASIC, {Front: '<!-- a -->{{Front}}', Back: '{{FrontSide}}<!-- b -->{{Back}}<!-- {{c}} -->'}), [TEMPLATES, FIELD, CSS, TEMPLATES]],
    ['Core with Anki closed: the new fields', withChange(CORE_EMPTY, {fields: MODEL.fields}), [TEMPLATES, CSS, TEMPLATES]],
    ['Core with Anki closed: a copy of Basic, the new fields', withChange(CORE_BASIC, {fields: MODEL.fields}), [TEMPLATES, CSS, TEMPLATES]],
    ['Core with Anki closed: the new CSS is there already', withCard(withChange(CORE_EMPTY, {fields: MODEL.fields, css: NEW.css}), BRIDGE), [TEMPLATES]],
    ['Core with Anki closed: stopped before the field', withCard(CORE_BASIC, BRIDGE), [FIELD, CSS, TEMPLATES]],
    ['Core with Anki closed: stopped after the field', withCard(withChange(CORE_BASIC, {fields: MODEL.fields}), BRIDGE), [CSS, TEMPLATES]],
    ['Core with Anki closed: white space', withCard(CORE_EMPTY, {Front: ' \n', Back: '\r\n'}), [TEMPLATES, FIELD, CSS, TEMPLATES]],
    ['Core with Anki closed: a section of a field that is not there', withCard(CORE_BASIC, {Front: '{{Front}}', Back: '{{FrontSide}}{{#Extra}}!{{/Extra}}'}), [TEMPLATES, FIELD, CSS, TEMPLATES]],
    ['Core with Anki closed: a filter of a field that is not there', withCard(CORE_BASIC, {Front: '{{Front}}{{ type:nc: Back }}', Back: '{{FrontSide}}'}), [TEMPLATES, FIELD, CSS, TEMPLATES]],
    ['Core with Anki closed: a field in another letter case', withCard(CORE_BASIC, {Front: '{{front}}', Back: '{{FrontSide}}'}), [TEMPLATES, FIELD, CSS, TEMPLATES]],
    ['Core with Anki closed, and a second template of the user', withChange(CORE_EMPTY, {templates: {'Card 1': {Front: '', Back: ''}, 'Card 2': {Front: '{{Front}}', Back: 'x'}}}), [TEMPLATES, FIELD, CSS, TEMPLATES]],
    ['Core with Anki closed: a copy of Basic, and a second template of the user', withChange(CORE_BASIC, {templates: {'Card 2': {Front: '{{Front}}<i>', Back: '{{Expression}}'}, 'Card 1': BASIC_CARD}}), [TEMPLATES, FIELD, CSS, TEMPLATES]],
];

/**
 * Types of the user: nothing but the field is added.
 * @type {[name: string, type: FakeType][]}
 */
const CUSTOMISED = [
    ['front', withCard(OLD, {Front: `${OLD.templates['Card 1'].Front}<p>мой`})],
    ['back', withCard(OLD, {Back: `${OLD.templates['Card 1'].Back}<p>мой`})],
    ['CSS', withChange(OLD, {css: `${OLD.css}\n.card { color: red; }`})],
    ['CSS that keeps the marker of the new version', withChange(OLD, {css: `${MODEL.css}\n.card { color: red; }`})],
    ['front and back swapped', withCard(OLD, {Front: OLD.templates['Card 1'].Back, Back: OLD.templates['Card 1'].Front})],
    ['a renamed card template', withChange(OLD, {templates: {'Карточка 1': OLD.templates['Card 1']}})],
    ['a renamed card template, another letter case', withChange(OLD, {templates: {'card 1': OLD.templates['Card 1']}})],
    ['a renamed card template of the Core type', withChange(CORE_BASIC, {templates: {Моя: {Front: '{{Front}}', Back: '{{FrontSide}}'}}})],
    ['a plain template that shows the phrase', withCard(OLD, {Front: '{{Front}}', Back: '{{Front}}<hr>{{Expression}}'})],
    ['a plain template that shows the word on the front only', withCard(OLD, {Front: '{{Front}} {{hint:EnglishWord}}', Back: '{{FrontSide}}'})],
    ['a plain template with a section', withCard(OLD, {Front: '{{Front}}', Back: '{{FrontSide}}{{#Expression}}!{{/Expression}}'})],
    ['a plain template that shows the translation', withCard(OLD, {Front: '{{Front}}', Back: '{{ExpressionTranslate}}'})],
    ['a plain template that plays the audio', withCard(OLD, {Front: '{{Front}}', Back: '{{FrontSide}}{{Audio_front}}'})],
    ['a plain type with one more field', withCard(withChange(CORE_BASIC, {fields: [...OLD_FIELDS, 'Моё']}), {Front: '{{Front}}', Back: '{{Моё}}'})],
    ['a plain type with the fields in another order', withCard(withChange(CORE_BASIC, {fields: [...OLD_FIELDS].reverse()}), {Front: '{{Front}}', Back: '{{FrontSide}}'})],
    ['own HTML with Front only', withCard(CORE_BASIC, {Front: '<div class=my>{{Front}}</div>', Back: '{{FrontSide}}<hr><p>мой текст</p>'})],
    ['Front only and a script of the user', withCard(CORE_BASIC, {Front: '<h1>{{Front}}</h1><script>my()</script>', Back: '{{FrontSide}}'})],
    ['{{Front}} / {{FrontSide}} with an own CSS', withCard(CORE_BASIC, {Front: '{{Front}}', Back: '{{FrontSide}}'})],
    ['{{Front}} / {{FrontSide}} without a CSS', withCard(CORE_EMPTY, {Front: '{{Front}}', Back: '{{FrontSide}}'})],
    ['{{Front}} only, an empty back', withCard(CORE_EMPTY, {Front: '{{Front}}', Back: ''})],
    ['Front only, a field that is not there is in a comment', withCard(CORE_BASIC, {Front: '<!-- {{Word}}\n{{Other}} -->{{Front}}', Back: '{{FrontSide}}'})],
    ['Front only, the names of Anki', withCard(CORE_BASIC, {Front: '{{Front}} {{Tags}} {{Type}} {{Deck}} {{#Subdeck}}{{Subdeck}}{{/Subdeck}} {{Card}} {{CardFlag}} {{CardID}}', Back: '{{ FrontSide }}{{tts-voices:}}{{text:Front}}{{}}{{tts en_US voices=A:Front}}'})],
    ['Front only, the old braces of Anki', withCard(CORE_BASIC, {Front: '{{=<% %>=}}<% Front %> {{Word}}', Back: '{{=<% %>=}}<% FrontSide %>'})],
    ['our template before the field, the back is not', withCard(CORE_BASIC, {Front: BRIDGE.Front, Back: '{{FrontSide}} мой'})],
    ['our template before the field, the front is not', withCard(CORE_BASIC, {Front: `${BRIDGE.Front}!`, Back: BRIDGE.Back})],
    ['Front only, a comment between two braces', withCard(CORE_BASIC, {Front: '{{Front}} MINE {<!-- -->{ braces }}', Back: 'MINE'})],
    ['Front only, a comment between two braces of the back', withCard(CORE_BASIC, {Front: '{{Front}}', Back: '{<!---->{Word}<!-- x -->} {{<!-- -->Word}<!-- -->}'})],
    ['Front only, the start of a comment in a tag', withCard(CORE_BASIC, {Front: '{{<!--:Front}} x --> Foo}}', Back: '{{<!--:FrontSide}}<!-- y -->--> {{<!--:FrontSide}}a-->Foo}}'})],
    ['Front only, a tag in a tag', withCard(CORE_BASIC, {Front: '{{Front}}{{: {{Foo:}}', Back: '{{FrontSide}}{{x:{{Foo:}} {{{Front}}}'})],
    ['Front only, a space that only Anki knows', withCard(CORE_BASIC, {Front: '{{Front\u0085}} MINE', Back: '{{\u0085FrontSide}}'})],
    ['Front only, a section of an odd cloze', withCard(CORE_BASIC, {Front: '{{Front}} MINE {{#c+1}}x{{/c+1}}', Back: '{{^c+12}}y{{/c+12}}'})],
    ['Front only, the old braces after a space that only Anki knows', withCard(CORE_BASIC, {Front: '\u0085{{=<% %>=}}<% Front %>{{Word}}', Back: ' \n\u0085 {{=<% %>=}}<% FrontSide %> {{Word}}'})],
    ['Front only, sections of clozes', withCard(CORE_EMPTY, {Front: '{{Front}}{{#c1}}x{{/c1}}{{^c12}}y{{/c12}}', Back: 'мой'})],
];

describe('ensurePhraseModel: the state of the type', () => {
    test.each(KNOWN)('%s → the new type', async (_name, type, expected) => {
        const anki = install(type);
        expect(await ensure()).toStrictEqual({videoHidden: false});
        expect(writes()).toStrictEqual(expected);
        const {fields, templates, css} = /** @type {FakeType} */ (anki.phrases);
        expect(templates['Card 1']).toStrictEqual(NEW_CARD);
        if (type === null || expected.includes(CSS)) { expect(css).toBe(MODEL.css); }
        if (type === null) {
            expect(anki.phrases).toStrictEqual(NEW);
            expect(anki.decks).toStrictEqual(['Default', 'Flibooster']);
            return;
        }
        expect(fields).toStrictEqual(type.fields.includes('flib_media') ? type.fields : [...type.fields, 'flib_media']);
        expect(Object.keys(templates)).toStrictEqual(Object.keys(type.templates));
        for (const [name, template] of Object.entries(type.templates)) {
            if (name !== 'Card 1') { expect(templates[name]).toStrictEqual(template); }
        }
        expect(anki.decks).toStrictEqual(['Default']);
    });

    test.each(KNOWN)('%s: the second time nothing is written', async (_name, type) => {
        install(type);
        await ensure();
        sent = [];
        expect(await ensure()).toStrictEqual({videoHidden: false});
        expect(sent.map(({action}) => action)).toStrictEqual(['version', 'modelNames', 'modelFieldNames', 'modelTemplates', 'modelStyling']);
    });

    test('what is judged is read again right before the first overwrite; everything written is read back', async () => {
        install(OLD);
        await ensure();
        expect(sent.map(({action}) => action)).toStrictEqual([
            'version',
            'modelNames',
            'modelFieldNames',
            'modelTemplates',
            'modelStyling',
            FIELD,
            'modelTemplates',
            'modelStyling',
            TEMPLATES,
            CSS,
            'modelFieldNames',
            'modelTemplates',
            'modelStyling',
        ]);
        sent = [];
        install(null);
        await ensure();
        expect(sent.map(({action}) => action)).toStrictEqual([
            'version', 'modelNames', 'createDeck', 'createModel', 'modelFieldNames', 'modelTemplates', 'modelStyling',
        ]);
    });

    test('the field: last; the templates: only «Card 1»; the CSS: with the marker', async () => {
        install(OLD);
        await ensure();
        expect(sent.filter(({action}) => WRITES.has(action)).map(({params}) => params)).toStrictEqual([
            {modelName: 'Phrases', fieldName: 'flib_media', index: 6},
            {model: {name: 'Phrases', templates: {'Card 1': NEW_CARD}}},
            {model: {name: 'Phrases', css: MODEL.css}},
        ]);
        expect(MODEL.css.startsWith(`/* ankimodels-rev:${REVISION} */\n`)).toBe(true);
    });

    test('Anki takes no field for the type that Core made: a template that Anki accepts comes first', async () => {
        for (const type of [CORE_EMPTY, CORE_BASIC]) {
            const anki = install(type);
            expect(() => anki.run('modelFieldAdd', {modelName: 'Phrases', fieldName: 'flib_media', index: 6})).toThrow();
            sent = [];
            await ensure();
            const bridge = /** @type {Sent} */ (sent.find(({action}) => action === TEMPLATES));
            expect(bridge.params).toStrictEqual({model: {name: 'Phrases', templates: {'Card 1': BRIDGE}}});
        }
    });

    test.each(CUSTOMISED)('customised (%s): only the field, last', async (_name, type) => {
        const anki = install(type);
        expect(await ensure()).toStrictEqual({videoHidden: true});
        expect(writes()).toStrictEqual([FIELD]);
        expect(anki.phrases).toStrictEqual(withChange(type, {fields: [...type.fields, 'flib_media']}));
        sent = [];
        expect(await ensure()).toStrictEqual({videoHidden: true});
        expect(writes()).toStrictEqual([]);
    });

    test.each(/** @type {[string, FakeType, boolean][]} */ ([
        ['new front, the rest is old', withCard(OLD, {Front: NEW_CARD.Front, Back: `${OLD.templates['Card 1'].Back}<p>мой`}), true],
        ['new templates, the CSS of the user', withChange(NEW, {css: `${MODEL.css}\n.card { color: red; }`}), false],
        ['old templates, the CSS of the user', withChange(OLD, {css: '.mine {}'}), true],
        ['new CSS, the front of the user', withCard(NEW, {Front: `${NEW_CARD.Front}<p>мой`}), false],
        ['new CSS, the back of the user', withCard(NEW, {Back: `${NEW_CARD.Back}<p>мой`}), false],
        ['a text that looks like the marker in the front', withCard(OLD, {Front: `${OLD.templates['Card 1'].Front}\n/* ankimodels-rev:0123456789abcdef */\n`}), true],
        ['a rule that the marker hides', withChange(OLD, {css: `${OLD.css.trimEnd()}\n/* ankim/* ankimodels-rev:x */odels-rev:y .my{color:red} */\n`}), true],
        ['a marker that is not one', withChange(OLD, {css: `/* ankimodels-rev:my own */\n${OLD.css}`}), true],
    ]))('customised, partly ours (%s): nothing but the field', async (_name, type, videoHidden) => {
        const anki = install(type);
        expect(await ensure()).toStrictEqual({videoHidden});
        expect(writes()).toStrictEqual(type.fields.includes('flib_media') ? [] : [FIELD]);
        expect(anki.phrases?.css).toBe(type.css);
        expect(anki.phrases?.templates).toStrictEqual(type.templates);
    });

    test.each(/** @type {[string, string, boolean][]} */ ([
        ['{{flib_media}}', '', false],
        ['', '{{ flib_media }}', false],
        ['<!-- flib --><p>{{flib_media}}</p><!-- media -->', '', false],
        ['', '{{hint:flib_media}}', false],
        ['', '{{furigana: kana : flib_media}}', false],
        ['', '{{{flib_media}}}', false],
        ['{{#flib_media}}{{flib_media}}{{/flib_media}}', '', false],
        ['{{#flib_media}}x{{/flib_media}}', '{{^flib_media}}y{{/flib_media}}', true],
        ['{{ # flib_media}}x{{ / flib_media}}', '{{ ^flib_media}}y{{/flib_media}}', true],
        ['{{!flib_media}}', '{{ ! flib_media }}', true],
        ['<!-- {{flib_media}} -->', '<!--\n{{flib_media}}\n-->', true],
        ['<!-- a -->{{Expression}}<!-- {{flib_media}} -->', '', true],
        ['{{type:flib_media}}', '{{text:flib_media}}', true],
        ['{{type:nc:flib_media}}', '{{ text : hint:flib_media}}', true],
        ['{{Flib_Media}}', '{{flib_media2}}', true],
        ['{{flib_media:Expression}}', 'flib_media', true],
        ['{flib_media}', '{{flib_\nmedia}}', true],
        ['{{a{b:flib_media}}', '', false],
        ['{<!-- -->{flib_media}}', '{{flib<!-- -->_media}}', true],
        ['', '', true],
    ]))('whether the own template shows the videos: front %j, back %j → hidden %j', async (front, back, videoHidden) => {
        const template = {Front: `{{Front}}${front}`, Back: `{{EnglishWord}}${back}`};
        // What Anki itself would refuse may come with an imported deck.
        const own = withChange(OLD, {fields: MODEL.fields, templates: {'Card 1': template}});
        install(own);
        expect(await ensure()).toStrictEqual({videoHidden});
        // «Card 1» decides while it is there.
        install(withChange(own, {templates: {'Моя': NEW_CARD, 'Card 1': template, 'Ещё': NEW_CARD}}));
        expect(await ensure()).toStrictEqual({videoHidden});
        // Renamed: any template of the type.
        install(withChange(own, {templates: {Моя: OLD.templates['Card 1'], Карточка: template}}));
        expect(await ensure()).toStrictEqual({videoHidden});
        expect(writes()).toStrictEqual([]);
    });

    test('a renamed «Card 1» with the new back: the videos are seen', async () => {
        install(withChange(OLD, {templates: {'Карточка 1': {Front: OLD.templates['Card 1'].Front, Back: NEW_CARD.Back}}, fields: MODEL.fields}));
        expect(await ensure()).toStrictEqual({videoHidden: false});
    });

    test('a marker of Flibooster anywhere on a line of its own is not an edit', async () => {
        install(withChange(OLD, {css: `\r\n/* ankimodels-rev:242a8c70246f3a95 */\r\n${crlf(OLD.css)}`}));
        expect(await ensure()).toStrictEqual({videoHidden: false});
    });

    test.each([
        ['another type of the user named Phrases', {fields: ['Front', 'Back'], templates: {'Card 1': BASIC_CARD}, css: BASIC_CSS}, 'Expression, EnglishWord, ExpressionTranslate, Audio_front, Audio_expression'],
        ['the old type, a renamed field', withChange(OLD, {fields: OLD_FIELDS.map((name) => (name === 'EnglishWord' ? 'Слово' : name))}), 'EnglishWord'],
        ['the new type, a removed field', withChange(NEW, {fields: MODEL.fields.filter((name) => name !== 'Audio_front')}), 'Audio_front'],
        ['the new type, another letter case', withChange(NEW, {fields: MODEL.fields.map((name) => (name === 'Expression' ? 'expression' : name))}), 'Expression'],
        ['a Core type without a field', withChange(CORE_EMPTY, {fields: OLD_FIELDS.slice(0, -1)}), 'Audio_expression'],
        ['a customised type that has the videos', withCard(withChange(NEW, {fields: MODEL.fields.slice(1)}), {Front: '{{Expression}}'}), 'Front'],
    ])('our field is missing (%s) → anki_model_outdated with its name, nothing is written', async (_name, type, missing) => {
        const anki = install(type);
        const {code, detail} = await rejected(ensure());
        expect([code, detail]).toStrictEqual(['anki_model_outdated', `Phrases: ${missing}`]);
        expect(writes()).toStrictEqual([]);
        expect(anki.phrases).toStrictEqual(type);
    });

    test.each(['Flib_Media', 'FLIB_MEDIA'])('the field in another letter case (%s) → anki_model_outdated, nothing is read further or written', async (field) => {
        for (const type of [OLD, NEW, CUSTOMISED[0][1], CORE_EMPTY]) {
            install(withChange(type, {fields: [...OLD_FIELDS, field]}));
            sent = [];
            expect((await rejected(ensure())).code).toBe('anki_model_outdated');
            expect(sent.map(({action}) => action)).toStrictEqual(['version', 'modelNames', 'modelFieldNames']);
        }
    });

    test('a type «phrases» is not a missing type: no «Phrases+» beside it', async () => {
        const anki = install(OLD, 'phrases');
        expect((await rejected(ensure())).code).toBe('anki_model_outdated');
        expect(writes()).toStrictEqual([]);
        expect([...anki.types.keys()]).toStrictEqual(['Basic', 'phrases']);
    });

    test('a type made by another program after the list was read: handled as an installed one', async () => {
        const anki = install(null);
        answer = ({action}) => {
            if (action === 'createModel') { anki.types.set('Phrases', structuredClone(OLD)); }
            return void 0;
        };
        expect(await ensure()).toStrictEqual({videoHidden: false});
        expect(anki.phrases).toStrictEqual(NEW);
        answer = ({action}) => {
            if (action === 'createModel') { anki.types.set('Phrases', structuredClone(CUSTOMISED[2][1])); }
            return void 0;
        };
        anki.types.delete('Phrases');
        expect(await ensure()).toStrictEqual({videoHidden: true});
        expect(anki.phrases?.css).toBe(CUSTOMISED[2][1].css);
    });
});

describe('ensurePhraseModel: the user edits the type meanwhile', () => {
    test.each(/** @type {[string, (type: FakeType) => void][]} */ ([
        ['the front', (type) => { type.templates['Card 1'].Front += '<p>мой'; }],
        ['the back', (type) => { type.templates['Card 1'].Back += '<p>мой'; }],
        ['the CSS', (type) => { type.css += '\n.mine{}'; }],
        ['the name of the template', (type) => { type.templates = {Моя: type.templates['Card 1']}; }],
    ]))('%s → an error, what he wrote stays; the next time it is his type', async (what, edit) => {
        for (const type of [OLD, withChange(OLD, {fields: MODEL.fields}), withChange(NEW, {css: OLD.css})]) {
            const anki = install(type);
            /** @type {?FakeType} */
            let edited = null;
            answer = ({action, number}, run) => {
                // Right after the last of the first reads; its answer is the old one.
                if (action !== 'modelStyling' || number > 4) { return void 0; }
                const response = new Response(JSON.stringify(run()));
                edit(/** @type {FakeType} */ (anki.phrases));
                edited = structuredClone(/** @type {FakeType} */ (anki.phrases));
                return response;
            };
            sent = [];
            expect((await rejected(ensure())).code, what).toBe('anki_model_failed');
            expect(anki.phrases?.templates).toStrictEqual(/** @type {FakeType} */ (/** @type {unknown} */ (edited)).templates);
            expect(anki.phrases?.css).toBe(/** @type {FakeType} */ (/** @type {unknown} */ (edited)).css);
            expect(writes().filter((action) => action !== FIELD)).toStrictEqual([]);
            answer = () => void 0;
            sent = [];
            await ensure();
            expect(writes().filter((action) => action !== FIELD)).toStrictEqual([]);
        }
    });

    test('a Core type that he filled in meanwhile', async () => {
        for (const type of [CORE_EMPTY, withCard(CORE_EMPTY, BRIDGE)]) {
            const anki = install(type);
            answer = ({action, number}, run) => {
                if (action !== 'modelStyling' || number > 4) { return void 0; }
                const response = new Response(JSON.stringify(run()));
                /** @type {FakeType} */ (anki.phrases).templates = {'Card 1': {Front: '{{Front}} мой', Back: '{{Expression}}'}};
                return response;
            };
            sent = [];
            expect((await rejected(ensure())).code).toBe('anki_model_failed');
            expect(anki.phrases?.templates).toStrictEqual({'Card 1': {Front: '{{Front}} мой', Back: '{{Expression}}'}});
        }
    });
});

describe('ensurePhraseModel: read-back', () => {
    test.each([FIELD, TEMPLATES, CSS])('%s says yes and does nothing → a visible error', async (ignored) => {
        for (const type of [OLD, CORE_EMPTY, withChange(CORE_EMPTY, {fields: MODEL.fields}), withChange(OLD, {fields: MODEL.fields})]) {
            if (ignored === FIELD && type.fields.includes('flib_media')) { continue; }
            install(type);
            // The template before the field of a Core type is not ignored.
            answer = ({action, params}) => (action === ignored && params.model?.templates?.['Card 1'].Front !== BRIDGE.Front ? new Response('null') : void 0);
            // Without the field Anki itself refuses the new templates.
            expect((await rejected(ensure())).code).toBe(ignored === FIELD ? 'anki_model_failed' : 'anki_model_outdated');
        }
    });

    test('customised: the field is not there after the write → anki_model_outdated', async () => {
        install(CUSTOMISED[0][1]);
        answer = ({action}) => (action === FIELD ? new Response('null') : void 0);
        expect((await rejected(ensure())).code).toBe('anki_model_outdated');
    });

    test('customised: the field appears in another letter case → anki_model_outdated', async () => {
        const anki = install(CUSTOMISED[0][1]);
        answer = ({action}) => {
            if (action !== FIELD) { return void 0; }
            anki.phrases?.fields.push('Flib_Media');
            return new Response('null');
        };
        expect((await rejected(ensure())).code).toBe('anki_model_outdated');
    });

    test.each([
        ['a template renamed by then', (/** @type {FakeType} */ type) => { type.templates = {Моя: type.templates['Card 1']}; }],
        ['a front that is not ours', (/** @type {FakeType} */ type) => { type.templates['Card 1'].Front += 'x'; }],
        ['a back that is not ours', (/** @type {FakeType} */ type) => { type.templates['Card 1'].Back += 'x'; }],
        ['a CSS that is not ours', (/** @type {FakeType} */ type) => { type.css += 'x'; }],
        ['no field', (/** @type {FakeType} */ type) => { type.fields = type.fields.filter((name) => name !== 'flib_media'); }],
        ['no other field', (/** @type {FakeType} */ type) => { type.fields = type.fields.filter((name) => name !== 'EnglishWord'); }],
    ])('%s → anki_model_outdated, for a created and for an updated type', async (_name, change) => {
        for (const type of [null, OLD, withChange(NEW, {css: OLD.css})]) {
            const anki = install(type);
            let written = false;
            answer = ({action}) => {
                if (action === 'createModel' || action === CSS) { written = true; }
                if (written && action === 'modelFieldNames') { change(/** @type {FakeType} */ (anki.phrases)); }
                return void 0;
            };
            expect((await rejected(ensure())).code).toBe('anki_model_outdated');
        }
    });
});

describe('ensurePhraseModel: failures', () => {
    const CLOSED = () => new Response('AnkiConnect error: dial tcp 127.0.0.1:8765', {status: 502});

    /** @type {[name: string, fail: (run: () => unknown) => Response, code: string][]} */
    const FAILURES = [
        ['the connection fails', () => { throw new TypeError('Failed to fetch'); }, 'anki_closed'],
        ['done, but the connection is lost', (run) => { run(); throw new TypeError('Failed to fetch'); }, 'anki_closed'],
        ['502 of Core', CLOSED, 'anki_closed'],
        ['another HTTP error', () => new Response('', {status: 500}), 'anki_model_failed'],
        ['Anki without a collection (a profile is being chosen)', () => new Response('{"result":null,"error":"collection is not available"}'), 'anki_closed'],
        ['an error of AnkiConnect', () => new Response('{"result":null,"error":"boom"}'), 'anki_model_failed'],
        ['not JSON', () => new Response('<html>'), 'anki_model_failed'],
        ['an answer of another shape', () => new Response('{"x":1}'), 'anki_model_failed'],
    ];

    const STATES = KNOWN.filter(([name]) => ['missing', 'f324acde9', 'the field only', 'all but the CSS', 'Core with Anki closed: empty', 'Core with Anki closed: a copy of Basic'].includes(name));

    test.each(STATES.flatMap(([state, type]) => FAILURES.map(([name, fail, code]) => /** @type {const} */ ([state, name, type, fail, code]))))('%s, %s at every step: a visible error, then success', async (_state, name, type, fail, code) => {
        install(type);
        await ensure();
        const total = sent.length;
        expect(total).toBeGreaterThan(5);
        for (let step = 0; step < total; ++step) {
            const anki = install(type);
            sent = [];
            answer = ({number}, run) => (number === step ? fail(run) : void 0);
            /** @type {?string} */
            let action = null;
            const outcome = await ensure().then(() => null, (/** @type {{data: {code: string}}} */ {data}) => data.code);
            action = sent[step].action;
            // These answers are not read: what they did is seen by the read-back.
            if (name === 'an answer of another shape' && ['version', 'createDeck', 'createModel'].includes(action)) {
                if (action === 'version') {
                    expect(outcome).toBe('anki_model_failed');
                } else {
                    expect(outcome, action).toBe(action === 'createModel' ? 'anki_model_failed' : null);
                }
            } else {
                expect(outcome, action).toBe(code);
            }
            // Nothing is sent after a failure.
            if (outcome !== null && action !== 'createModel') { expect(sent.length, action).toBe(step + 1); }
            answer = () => void 0;
            expect(await ensure(), action).toStrictEqual({videoHidden: false});
            expect(anki.phrases, action).toStrictEqual(NEW);
            expect(anki.decks.includes('Flibooster')).toBe(type === null && !(name === 'an answer of another shape' && action === 'createDeck'));
        }
    });

    test.each(CUSTOMISED)('customised (%s), a failure at every step: the error, then only the field', async (_name, type) => {
        install(type);
        await ensure();
        const total = sent.length;
        for (let step = 0; step < total; ++step) {
            for (const [name, fail, code] of FAILURES.slice(0, 3)) {
                const anki = install(type);
                sent = [];
                answer = ({number}, run) => (number === step ? fail(run) : void 0);
                expect((await rejected(ensure())).code, name).toBe(code);
                answer = () => void 0;
                expect(await ensure()).toStrictEqual({videoHidden: true});
                expect(anki.phrases).toStrictEqual(withChange(type, {fields: [...type.fields, 'flib_media']}));
            }
        }
    });

    test('the error has the reason and nothing of the request', async () => {
        install(OLD);
        answer = ({action}) => (action === TEMPLATES ? new Response('{"result":null,"error":"boom"}') : void 0);
        const {data} = await rejected(ensure());
        expect(data).toStrictEqual({detail: 'Anki error: boom', code: 'anki_model_failed', status: null});
    });

    test.each([
        ['no field on the front', {Front: 'нет полей', Back: '{{Expression}}'}],
        ['a blank front, a back of the user', {Front: '', Back: '<p>мой {{FrontSide}}'}],
        ['a blank front, plain text on the back', {Front: ' ', Back: 'x'}],
        ['a comment of other template languages', {Front: '{{Front}}{{!Gone}}', Back: '{{ ! note }}'}],
        ['the change of the delimiters in the middle', {Front: '{{Front}}{{=x}}', Back: 'x'}],
        ['names that are not names for sure', {Front: '{{Front}}', Back: '{{Word!}}{{a+b}}{{_x}}{{-x}}{{a.b}}{{"x"}}{{x\u200B}}{{*}}{{a\u00A0b}}{{\u0085Word\u0085}}'}],
        ['the change of the delimiters after a text', {Front: '{{Front}}', Back: 'x{{=<% %>=}}{{Word}}'}],
        ['the change of the delimiters in a comment', {Front: '{{Front}}', Back: '<!-- {{=<% %>=}} -->{{Word}}'}],
        ['a field that is gone beside ours', {Front: '{{Front}}', Back: '{{Expression}}{{Gone}}'}],
    ])('a template of the user that Anki refuses (%s): it refuses the field too → anki_model_failed, nothing is changed', async (_name, card) => {
        const type = withCard(OLD, card);
        const anki = install(type);
        expect((await rejected(ensure())).code).toBe('anki_model_failed');
        expect(anki.phrases).toStrictEqual(type);
        expect(writes()).toStrictEqual([FIELD]);
    });

    test('a request that hangs at any step: an error in time, the next time works', async () => {
        for (const type of [null, OLD, CORE_EMPTY, CUSTOMISED[0][1]]) {
            install(type);
            sent = [];
            await ensure();
            const total = sent.length;
            for (let step = 0; step < total; ++step) {
                install(type);
                sent = [];
                answer = ({number}) => (number === step ? new Promise(() => {}) : void 0);
                const {code, detail} = await rejected(ensurePhraseModel(makeAnki(), MODEL, {timeoutMs: 5}));
                expect([code, detail]).toStrictEqual(['anki_model_failed', 'No answer in 5 ms']);
                expect(sent).toHaveLength(step + 1);
                answer = () => void 0;
                expect(await ensure()).toStrictEqual({videoHidden: type === CUSTOMISED[0][1]});
            }
        }
    });

    test('the limit of a request is 15 s, not of the run; the request is aborted, the timers are gone', async () => {
        // Hashes are not timers: they need real turns of the event loop.
        vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
        const advance = async (/** @type {Promise<unknown>} */ promise, /** @type {number} */ step) => {
            let done = false;
            const finish = () => { done = true; };
            promise.then(finish, finish);
            let time = 0;
            while (!done) {
                await vi.advanceTimersByTimeAsync(step);
                await new Promise((resolve) => { setImmediate(resolve); });
                time += step;
            }
            return time;
        };
        try {
            install(OLD);
            // The check of the version and the request behind it are within one limit.
            answer = () => new Promise((resolve) => {
                setTimeout(() => { resolve(/** @type {*} */ (void 0)); }, 7000);
            });
            const run = ensure();
            expect(await advance(run, 1000)).toBeGreaterThan(7000 * 12);
            expect(await run).toStrictEqual({videoHidden: false});
            expect(sent.map(({signal}) => signal?.aborted)).toStrictEqual(sent.map(() => false));
            expect(vi.getTimerCount()).toBe(0);
            sent = [];
            answer = () => new Promise(() => {});
            const hung = rejected(ensure());
            const time = await advance(hung, 1000);
            expect(time).toBeGreaterThanOrEqual(15_000);
            expect(time).toBeLessThan(18_000);
            expect((await hung).detail).toBe('No answer in 15000 ms');
            expect(sent.map(({signal}) => signal?.aborted)).toStrictEqual([true]);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    test('a client without an address: closed, no request', async () => {
        for (const server of [null, '']) {
            const anki = makeAnki();
            anki.server = /** @type {*} */ (server);
            expect((await rejected(ensurePhraseModel(anki, MODEL))).code).toBe('anki_closed');
        }
        expect(sent).toStrictEqual([]);
    });

    test('AnkiConnect is off: an error, no request', async () => {
        install(null);
        const anki = makeAnki();
        anki.enabled = false;
        expect((await rejected(ensurePhraseModel(anki, MODEL))).code).toBe('anki_model_failed');
        expect(sent).toStrictEqual([]);
    });

    test.each([['missing', null], ['old', OLD], ['customised', CUSTOMISED[0][1]], ['new', NEW], ['Core', CORE_EMPTY]])('AnkiConnect is switched off at every step (%s): an error, nothing more is sent', async (_name, type) => {
        install(type);
        await ensure();
        const total = sent.length;
        for (let step = 0; step < total; ++step) {
            install(type);
            sent = [];
            const anki = makeAnki();
            answer = ({number}) => {
                if (number === step) { anki.enabled = false; }
                return void 0;
            };
            expect((await rejected(ensurePhraseModel(anki, MODEL))).code).toBe('anki_model_failed');
            // The version check and the action behind it are one call.
            expect(sent.length).toBe(step === 0 ? 2 : step + 1);
        }
    });

    test.each([['missing', null], ['old', OLD], ['customised', CUSTOMISED[0][1]], ['Core', CORE_EMPTY]])('another server is set at every step (%s): anki_route_switched, nothing is written there', async (_name, type) => {
        install(type);
        await ensure();
        const total = sent.length;
        for (let step = 0; step < total; ++step) {
            install(type);
            servers[CORE] = new FakeAnki(OLD);
            sent = [];
            const anki = makeAnki();
            answer = ({number}) => {
                if (number === step) { anki.server = CORE; }
                return void 0;
            };
            expect((await rejected(ensurePhraseModel(anki, MODEL))).code).toBe('anki_route_switched');
            expect(servers[CORE].phrases).toStrictEqual(OLD);
            expect(sent.filter(({server, action}) => server === CORE && WRITES.has(action))).toStrictEqual([]);
        }
    });
});

describe('PhraseModelPreparer', () => {
    /**
     * @param {AnkiConnect} [anki]
     * @returns {PhraseModelPreparer}
     */
    const makePreparer = (anki = makeAnki()) => new PhraseModelPreparer({anki, loadModels: async () => MODELS});

    const PREPARED = {server: DIRECT, videoHidden: false, modelRevision: REVISION};

    test('the address, the state and the revision; the second time there is no request', async () => {
        const anki = install(OLD);
        const preparer = makePreparer();
        expect(await preparer.prepare()).toStrictEqual(PREPARED);
        expect(anki.phrases).toStrictEqual(NEW);
        sent = [];
        expect(await preparer.prepare()).toStrictEqual(PREPARED);
        expect(sent).toStrictEqual([]);
    });

    test('customised is remembered too', async () => {
        install(CUSTOMISED[1][1]);
        const preparer = makePreparer();
        expect(await preparer.prepare()).toStrictEqual({...PREPARED, videoHidden: true});
        sent = [];
        expect(await preparer.prepare()).toStrictEqual({...PREPARED, videoHidden: true});
        expect(sent).toStrictEqual([]);
    });

    test('two parallel calls are one run; the next worker checks again', async () => {
        install(OLD);
        const preparer = makePreparer();
        const [a, b] = await Promise.all([preparer.prepare(), preparer.prepare()]);
        expect([a, b]).toStrictEqual([PREPARED, PREPARED]);
        expect(writes()).toStrictEqual([FIELD, TEMPLATES, CSS]);
        sent = [];
        await makePreparer().prepare();
        expect(sent.map(({action}) => action)).toContain('modelTemplates');
        expect(writes()).toStrictEqual([]);
    });

    test('two parallel calls share a failure; it is not remembered', async () => {
        install(OLD);
        const preparer = makePreparer();
        answer = ({action}) => (action === TEMPLATES ? new Response('', {status: 502}) : void 0);
        const results = await Promise.allSettled([preparer.prepare(), preparer.prepare()]);
        expect(results.map((result) => result.status === 'rejected' && result.reason.data.code)).toStrictEqual(['anki_closed', 'anki_closed']);
        expect(writes()).toStrictEqual([FIELD, TEMPLATES]);
        answer = () => void 0;
        expect(await preparer.prepare()).toStrictEqual(PREPARED);
    });

    test('a failed load of the models → anki_model_failed, the next call loads again; a file without Phrases', async () => {
        install(OLD);
        const loadModels = vi.fn(async () => MODELS);
        loadModels.mockRejectedValueOnce(new Error('Failed to fetch /data/flib-anki-models.json: 404'));
        loadModels.mockResolvedValueOnce({source: '', models: MODELS.models.filter(({name}) => name !== 'Phrases')});
        const preparer = new PhraseModelPreparer({anki: makeAnki(), loadModels});
        expect((await rejected(preparer.prepare())).code).toBe('anki_model_failed');
        expect((await rejected(preparer.prepare())).code).toBe('anki_model_failed');
        expect(sent).toStrictEqual([]);
        expect(await preparer.prepare()).toStrictEqual(PREPARED);
    });

    test('profile switch after the memo: forget() → the next prepare works there', async () => {
        install(OLD);
        const preparer = makePreparer();
        await preparer.prepare();
        const other = install(OLDER);
        // Not yet known: the memo answers (and the add fails).
        expect(await preparer.prepare()).toStrictEqual(PREPARED);
        expect(other.phrases).toStrictEqual(OLDER);
        preparer.forget();
        expect(await preparer.prepare()).toStrictEqual(PREPARED);
        expect(other.phrases).toStrictEqual(NEW);
        // No type at all in the third profile.
        const third = install(null);
        preparer.forget();
        expect(await preparer.prepare()).toStrictEqual(PREPARED);
        expect(third.phrases).toStrictEqual(NEW);
    });

    test('forget() during a run: its result is not remembered; a new call waits for it and checks again', async () => {
        install(OLD);
        const preparer = makePreparer();
        /** @type {() => void} */
        let release = () => {};
        const gate = new Promise((resolve) => {
            release = () => { resolve(void 0); };
        });
        answer = async ({action, number}) => {
            if (number < 6 && action === 'modelStyling') { await gate; }
            return /** @type {*} */ (void 0);
        };
        const first = preparer.prepare();
        await vi.waitFor(() => { expect(sent.at(-1)?.action).toBe('modelStyling'); });
        preparer.forget();
        const second = preparer.prepare();
        const third = preparer.prepare();
        await new Promise((resolve) => { setTimeout(resolve, 5); });
        expect(sent.at(-1)?.action).toBe('modelStyling');
        release();
        expect(await Promise.all([first, second, third])).toStrictEqual([PREPARED, PREPARED, PREPARED]);
        expect(sent.filter(({action}) => action === 'modelNames').length).toBe(2);
        expect(writes()).toStrictEqual([FIELD, TEMPLATES, CSS]);
        sent = [];
        await preparer.prepare();
        expect(sent).toStrictEqual([]);
    });

    test('forget() during a run that fails: the new call still works', async () => {
        install(OLD);
        const preparer = makePreparer();
        answer = ({action}) => (action === FIELD && writes().length === 1 ? new Response('', {status: 500}) : void 0);
        const first = rejected(preparer.prepare());
        preparer.forget();
        const second = preparer.prepare();
        expect((await first).code).toBe('anki_model_failed');
        expect(await second).toStrictEqual(PREPARED);
    });

    test('forget() during a run, no other call: nothing is remembered', async () => {
        install(OLD);
        const preparer = makePreparer();
        const first = preparer.prepare();
        preparer.forget();
        await first;
        sent = [];
        await preparer.prepare();
        expect(sent.map(({action}) => action)).toContain('modelNames');
    });

    test('a hung run does not hold the next one, also for another address', async () => {
        install(OLD);
        servers[CORE] = new FakeAnki(NEW);
        answer = ({server}) => (server === DIRECT ? new Promise(() => {}) : void 0);
        const anki = makeAnki();
        const preparer = new PhraseModelPreparer({anki, loadModels: async () => MODELS, timeoutMs: 5});
        const hung = rejected(preparer.prepare());
        anki.server = CORE;
        expect(await preparer.prepare()).toStrictEqual({...PREPARED, server: CORE});
        // It is about the first address, and that is not the current one any more.
        expect((await hung).code).toBe('anki_route_switched');
        anki.server = DIRECT;
        expect((await rejected(preparer.prepare())).code).toBe('anki_model_failed');
        answer = () => void 0;
        expect(await preparer.prepare()).toStrictEqual(PREPARED);
    });

    test('the models do not load in time → anki_model_failed, the next call loads again', async () => {
        install(NEW);
        const loadModels = vi.fn(async () => MODELS);
        loadModels.mockImplementationOnce(() => new Promise(() => {}));
        const preparer = new PhraseModelPreparer({anki: makeAnki(), loadModels, timeoutMs: 5});
        expect((await rejected(preparer.prepare())).code).toBe('anki_model_failed');
        expect(await preparer.prepare()).toStrictEqual(PREPARED);
    });

    test('a client without an address: closed', async () => {
        const anki = makeAnki();
        anki.server = /** @type {*} */ (null);
        expect((await rejected(makePreparer(anki).prepare())).code).toBe('anki_closed');
    });

    test('every server has its own memo', async () => {
        install(OLD);
        servers[CORE] = new FakeAnki(CUSTOMISED[0][1]);
        const anki = makeAnki();
        const preparer = makePreparer(anki);
        expect(await preparer.prepare()).toStrictEqual(PREPARED);
        anki.server = CORE;
        expect(await preparer.prepare()).toStrictEqual({...PREPARED, server: CORE, videoHidden: true});
        sent = [];
        anki.server = DIRECT;
        expect(await preparer.prepare()).toStrictEqual(PREPARED);
        expect(sent).toStrictEqual([]);
    });

    test('a call for another server does not get the run of the first one', async () => {
        install(OLD);
        servers[CORE] = new FakeAnki(CUSTOMISED[0][1]);
        const anki = makeAnki();
        const preparer = makePreparer(anki);
        const first = rejected(preparer.prepare());
        anki.server = CORE;
        const second = preparer.prepare();
        expect((await first).code).toBe('anki_route_switched');
        expect(await second).toStrictEqual({...PREPARED, server: CORE, videoHidden: true});
        expect(servers[DIRECT].phrases).toStrictEqual(OLD);
    });

    test('AnkiConnect is off: an error, also with a memo', async () => {
        install(NEW);
        const anki = makeAnki();
        const preparer = makePreparer(anki);
        await preparer.prepare();
        anki.enabled = false;
        sent = [];
        expect((await rejected(preparer.prepare())).code).toBe('anki_model_failed');
        expect(sent).toStrictEqual([]);
        anki.enabled = true;
        expect(await preparer.prepare()).toStrictEqual(PREPARED);
    });

    describe('the route switches', () => {
        /**
         * Core stops at request `step`; DIRECT answers from then on.
         * @param {number} step
         * @returns {AnkiConnect}
         */
        function makeSwitching(step) {
            const anki = makeAnki(CORE);
            anki.networkFailureHandler = async () => {
                anki.server = DIRECT;
                return {server: DIRECT, switchedMessage: 'route switched'};
            };
            answer = ({server, number}) => {
                if (server === CORE && number >= step) { throw new TypeError('Failed to fetch'); }
                return void 0;
            };
            return anki;
        }

        test.each([
            ['missing', null],
            ['old', OLD],
            ['new', NEW],
            ['customised', CUSTOMISED[0][1]],
            ['Core', CORE_BASIC],
        ])('at every step (%s): anki_route_switched, the other Anki is not touched, nothing is remembered', async (_name, first) => {
            install(first);
            await ensure();
            const total = sent.length;
            const actions = sent.map(({action}) => action);
            for (let step = 0; step < total; ++step) {
                // The other Anki is in a state that would be written: by its own templates, or by those of the first.
                for (const second of [null, OLD, CUSTOMISED[2][1], withChange(NEW, {css: OLD.css})]) {
                    servers = {[CORE]: new FakeAnki(first), [DIRECT]: new FakeAnki(second)};
                    sent = [];
                    const preparer = makePreparer(makeSwitching(step));
                    const {data} = await rejected(preparer.prepare());
                    expect(data, `${actions[step]} ${String(data.detail)}`).toMatchObject({code: 'anki_route_switched', status: null});
                    expect(Object.keys(data).filter((key) => !['code', 'detail', 'status'].includes(key))).toStrictEqual([]);
                    expect(servers[DIRECT].phrases).toStrictEqual(second === null ? void 0 : second);
                    expect(sent.filter(({server}) => server === DIRECT)).toStrictEqual([]);
                    // The next press of the user: the new route from the beginning.
                    sent = [];
                    expect(await preparer.prepare()).toStrictEqual({...PREPARED, videoHidden: second === CUSTOMISED[2][1]});
                    expect(sent.map(({action}) => action)).toContain('modelNames');
                }
            }
        });

        test('Anki closes and the route goes to another address: switched, the next time closed', async () => {
            servers = {[CORE]: new FakeAnki(OLD)};
            for (let step = 0; step < 13; ++step) {
                servers = {[CORE]: new FakeAnki(OLD)};
                sent = [];
                const preparer = makePreparer(makeSwitching(step));
                expect((await rejected(preparer.prepare())).code).toBe('anki_route_switched');
                expect(sent).toHaveLength(step + 1);
                expect((await rejected(preparer.prepare())).code).toBe('anki_closed');
            }
        });

        test('502 while the address of the options changes: anki_route_switched', async () => {
            servers = {[CORE]: new FakeAnki(OLD)};
            const anki = makeAnki(CORE);
            answer = ({action}) => {
                if (action !== 'modelTemplates') { return void 0; }
                anki.server = DIRECT;
                return new Response('', {status: 502});
            };
            expect((await rejected(makePreparer(anki).prepare())).code).toBe('anki_route_switched');
        });

        test('during the last read-back: nothing is remembered for either address', async () => {
            servers = {[CORE]: new FakeAnki(OLD), [DIRECT]: new FakeAnki(NEW)};
            const anki = makeAnki(CORE);
            const preparer = makePreparer(anki);
            answer = ({number}) => {
                if (number === 12) { anki.server = DIRECT; }
                return void 0;
            };
            expect((await rejected(preparer.prepare())).code).toBe('anki_route_switched');
            expect(sent.length).toBe(13);
            expect(sent[12].action).toBe('modelStyling');
            for (const server of [DIRECT, CORE]) {
                anki.server = server;
                sent = [];
                expect(await preparer.prepare()).toStrictEqual({...PREPARED, server});
                expect(sent.map(({action}) => action)).toContain('modelStyling');
            }
        });

        test('while a template is compared, not during a request: nothing more is written, nothing is remembered', async () => {
            // Hashes of the new version, of what is installed, of what is read back: three of each.
            for (let hash = 0; hash < 9; ++hash) {
                servers = {[CORE]: new FakeAnki(OLD), [DIRECT]: new FakeAnki(OLD)};
                sent = [];
                const anki = makeAnki(CORE);
                const preparer = makePreparer(anki);
                let number = 0;
                const digest = crypto.subtle.digest.bind(crypto.subtle);
                const spy = vi.spyOn(crypto.subtle, 'digest').mockImplementation(async (algorithm, data) => {
                    const result = await digest(algorithm, data);
                    if (number++ === hash) { anki.server = DIRECT; }
                    return result;
                });
                expect((await rejected(preparer.prepare())).code, String(hash)).toBe('anki_route_switched');
                spy.mockRestore();
                expect(sent.filter(({server}) => server === DIRECT)).toStrictEqual([]);
                expect(writes()).toStrictEqual(hash < 6 ? [] : [FIELD, TEMPLATES, CSS]);
                anki.server = CORE;
                sent = [];
                await preparer.prepare();
                expect(sent.map(({action}) => action)).toContain('modelNames');
            }
        });

        test('after any number of microtasks, for good or for a moment: no request goes to the other Anki', async () => {
            for (const back of [false, true]) {
                for (let offset = 0; offset < 250; ++offset) {
                    servers = {[CORE]: new FakeAnki(OLD), [DIRECT]: new FakeAnki(OLD)};
                    sent = [];
                    const anki = makeAnki(CORE);
                    const outcome = makePreparer(anki).prepare().then(({server}) => server, (/** @type {{data: {code: string}}} */ {data}) => data.code);
                    for (let i = 0; i < offset; ++i) { await Promise.resolve(); }
                    anki.server = DIRECT;
                    if (back) {
                        await Promise.resolve();
                        anki.server = CORE;
                    }
                    expect(['anki_route_switched', CORE]).toContain(await outcome);
                    expect(sent.filter(({server}) => server !== CORE)).toStrictEqual([]);
                }
            }
        });

        test('A → B → A during a read, then A → B during the version check that it causes: the write does not go to B', async () => {
            servers = {[CORE]: new FakeAnki(OLD), [DIRECT]: new FakeAnki(OLD)};
            const anki = makeAnki(CORE);
            let versions = 0;
            answer = ({action}) => {
                if (action === 'modelStyling') {
                    anki.server = DIRECT;
                    anki.server = CORE;
                }
                if (action === 'version' && ++versions > 1) { anki.server = DIRECT; }
                return void 0;
            };
            await makePreparer(anki).prepare().catch(() => {});
            expect(sent.filter(({server}) => server !== CORE)).toStrictEqual([]);
            expect(versions).toBe(1);
        });

        test('right after the call, with a memo: anki_route_switched', async () => {
            install(NEW);
            const anki = makeAnki();
            const preparer = makePreparer(anki);
            await preparer.prepare();
            const again = rejected(preparer.prepare());
            anki.server = CORE;
            expect((await again).code).toBe('anki_route_switched');
        });

        test('the server of the options changes while the models load: anki_route_switched', async () => {
            install(OLD);
            servers[CORE] = new FakeAnki(OLD);
            const anki = makeAnki(CORE);
            const preparer = new PhraseModelPreparer({
                anki,
                loadModels: async () => {
                    anki.server = DIRECT;
                    return MODELS;
                },
            });
            expect((await rejected(preparer.prepare())).code).toBe('anki_route_switched');
            expect(sent).toStrictEqual([]);
        });
    });
});

describe('requirePhraseServer', () => {
    test('the server of the preparation is the current one', () => {
        const anki = makeAnki();
        expect(requirePhraseServer(anki, DIRECT)).toBe(void 0);
        expect(requirePhraseServer(anki.withoutFallback(), DIRECT)).toBe(void 0);
    });

    test.each([CORE, `${DIRECT}/`, '', null, void 0, 5])('%j is not the current one → anki_route_switched', (server) => {
        const anki = makeAnki();
        expect(() => { requirePhraseServer(anki, /** @type {*} */ (server)); }).toThrow(expect.objectContaining({data: expect.objectContaining({code: 'anki_route_switched'})}));
    });

    test('a switch is seen at once; without an address Anki is closed', () => {
        const anki = makeAnki();
        anki.server = CORE;
        expect(() => { requirePhraseServer(anki, DIRECT); }).toThrow('anki_route_switched');
        anki.server = /** @type {*} */ (null);
        expect(() => { requirePhraseServer(anki, /** @type {*} */ (null)); }).toThrow('anki_closed');
        expect(() => { requirePhraseServer(anki, DIRECT); }).toThrow('anki_closed');
        anki.server = '';
        expect(() => { requirePhraseServer(anki, ''); }).toThrow('anki_closed');
    });
});

describe('isAnkiClosedError', () => {
    test.each([
        ['the connection', async () => { throw new TypeError('Failed to fetch'); }, true],
        ['502', async () => new Response('', {status: 502}), true],
        ['500', async () => new Response('', {status: 500}), false],
        ['a profile is being chosen', async () => new Response('{"result":null,"error":"collection is not available"}'), true],
        ['an error of AnkiConnect', async () => new Response('{"result":null,"error":"502"}'), false],
    ])('%s', async (_name, respond, expected) => {
        vi.stubGlobal('fetch', respond);
        const error = await makeAnki().withoutFallback().addNote(/** @type {*} */ ({}))
            .then(() => null, (/** @type {unknown} */ e) => e);
        expect(isAnkiClosedError(error)).toBe(expected);
    });

    test('a lost connection after which the address is another one is not', async () => {
        const anki = makeAnki();
        anki.networkFailureHandler = async () => {
            anki.server = CORE;
            return {server: CORE, switchedMessage: null};
        };
        const error = await anki.withoutFallback().getDeckNames().then(() => null, (/** @type {unknown} */ e) => e);
        expect(isAnkiClosedError(error)).toBe(false);
    });

    test.each([null, void 0, 'x', new Error('x'), {data: {status: 502}}])('%j is not', (value) => {
        expect(isAnkiClosedError(value)).toBe(false);
    });
});

describe('flibPhrasePrepare', () => {
    const PAGE = {id: 'x', url: 'chrome-extension://x/popup.html'};

    /**
     * @returns {{api: (sender: object) => API, backend: Backend}}
     */
    function wire() {
        vi.stubGlobal('chrome', {storage: {local: {}}, runtime: {id: 'x', getURL: (/** @type {string} */ path) => `chrome-extension://x${path}`}, offscreen: {}});
        const backend = new Backend(/** @type {*} */ ({getUrl: (/** @type {string} */ path) => path}));
        backend._anki.enabled = true;
        backend._anki.server = DIRECT;
        const api = (/** @type {object} */ sender) => new API(/** @type {*} */ ({
            sendMessage: (/** @type {import('api').ApiMessageAny} */ message, /** @type {(response: unknown) => void} */ callback) => {
                if (!backend._onMessage(message, /** @type {*} */ (sender), callback)) { callback(void 0); }
            },
            getLastError: () => null,
        }));
        return {api, backend};
    }

    test('API → a real Backend → AnkiConnect; one worker, one memo', async () => {
        const anki = install(OLD);
        const {api, backend} = wire();
        const results = await Promise.all([api(PAGE).flibPhrasePrepare(), api(PAGE).flibPhrasePrepare()]);
        const prepared = {server: DIRECT, videoHidden: false, modelRevision: REVISION};
        expect(results).toStrictEqual([prepared, prepared]);
        expect(anki.phrases).toStrictEqual(NEW);
        expect(writes()).toStrictEqual([FIELD, TEMPLATES, CSS]);
        sent = [];
        expect(await api(PAGE).flibPhrasePrepare()).toStrictEqual(prepared);
        expect(sent).toStrictEqual([]);
        backend._getFlibPhraseModelPreparer().forget();
        await api(PAGE).flibPhrasePrepare();
        expect(sent.map(({action}) => action)).toContain('modelNames');
    });

    test('the code of a failure reaches the page', async () => {
        install(OLD);
        answer = () => new Response('', {status: 502});
        expect((await rejected(wire().api(PAGE).flibPhrasePrepare())).code).toBe('anki_closed');
    });

    test.each([
        ['a content script', {id: 'x', url: 'https://example.com/', tab: {id: 1}, frameId: 0}],
        ['another extension', {id: 'y', url: 'chrome-extension://x/popup.html'}],
        ['nobody', {}],
    ])('%s is refused', async (_name, sender) => {
        install(OLD);
        expect((await rejected(wire().api(sender).flibPhrasePrepare())).code).toBe('flib_secret_forbidden');
        expect(sent).toStrictEqual([]);
    });
});
/* eslint-enable no-underscore-dangle, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
