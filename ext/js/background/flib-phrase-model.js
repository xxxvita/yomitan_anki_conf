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

import {ANKI_ROUTE_SWITCHED_CODE} from '../comm/anki-route.js';
import {createFlibError} from '../comm/flib-gateway-client.js';
import {ExtensionError} from '../core/extension-error.js';
import {FLIB_MEDIA_FIELD_NAME} from '../data/flib-anki-media.js';
import {FLIB_PHRASES_MODEL, FLIB_PRODUCT_DECK, getModelRevision, hashModelContent, hashModelCss} from '../data/flib-anki-models.js';

/*
 * The Phrases note type before a phrase is saved: created when it is missing, brought to the new version when all of
 * it is ours, given only the `flib_media` field when the user has changed anything in it. Whenever it is not certain
 * that a template is ours, it is the user's.
 *
 * ⚠️ Nothing here trusts a write: AnkiConnect answers the same to a write that it skipped (a card template with
 * another name, an empty side), so every write is read back.
 * ⚠️ The whole run belongs to one address: a type must not be judged by what another Anki has. The view is pinned to
 * it and sends nothing elsewhere; the address is also compared around every request (see {@link createRun}).
 */

/** An Anki that hangs must not hold the next press. Of one request. */
export const PHRASE_REQUEST_TIMEOUT_MS = 15_000;

/**
 * A template that Anki accepts whatever the type has besides «Front», and that nobody writes by hand: an interrupted
 * run is finished by the next one because {@link isCoreType} knows it.
 */
const BRIDGE_TEMPLATE = Object.freeze({Front: '{{Front}}<!-- flibooster -->', Back: '{{FrontSide}}'});

/** Names that Anki accepts in a template without such a field. */
const SPECIAL_NAMES = new Set(['FrontSide', 'Tags', 'Type', 'Deck', 'Subdeck', 'Card', 'CardFlag', 'CardID']);

/**
 * A comment, that Anki does not look into, or the content of a tag, up to the first `}}`. ⚠️ In one pass, from left to
 * right, as Anki reads: a tag may hold `<!--` (`{{<!--:Front}}`), and without a comment its sides must not become a tag.
 */
const TOKEN_PATTERN = /<!--[\s\S]*?-->|\{\{([\s\S]*?)\}\}/g;
/** `{{=<% %>=}}` at the start of a template: the tags are `<%…%>`, and `{{…}}` is text. */
const LEGACY_DELIMITERS = '{{=<%';
/** A name that Anki and this code certainly read in the same way: they trim different characters, for one thing. */
const PLAIN_NAME_PATTERN = /^[\p{L}\p{M}\p{N}][\p{L}\p{M}\p{N} _-]*$/u;

/**
 * @typedef {import('flib-phrase-model').Run} Run
 * @typedef {{front: string, back: string, css: string}} Hashes
 * @typedef {{fields: string[], templates: import('anki-connect').ModelTemplates, template: {Front: string, Back: string}|undefined, css: string, hashes: ?Hashes}} InstalledModel
 */

/**
 * @param {unknown} error An error of AnkiConnect.
 * @returns {?('anki_closed'|'anki_route_switched')} Nobody answered (502 is what Core says for a closed Anki to a
 *   request of `withoutFallback()`; «collection is not available» is an Anki whose profile is not open yet), or the
 *   request was stopped because the address is another one now.
 */
export function getAnkiRouteErrorCode(error) {
    if (!(error instanceof ExtensionError)) { return null; }
    const {code, networkFailure, status, apiError} = /** @type {{code?: unknown, networkFailure?: unknown, status?: unknown, apiError?: unknown}} */ (error.data ?? {});
    if (code === ANKI_ROUTE_SWITCHED_CODE) { return ANKI_ROUTE_SWITCHED_CODE; }
    const noCollection = typeof apiError === 'string' && apiError.includes('collection is not available');
    return networkFailure === true || status === 502 || noCollection ? 'anki_closed' : null;
}

/**
 * @param {unknown} error An error of AnkiConnect.
 * @returns {boolean}
 */
export function isAnkiClosedError(error) {
    return getAnkiRouteErrorCode(error) === 'anki_closed';
}

/**
 * What was prepared or found at one address says nothing about another one.
 *
 * ⚠️ For callers: this alone does not keep a request at the address, the client awaits before it sends. Send through
 * `withoutFallback(server)`; check here at the start and after the last read.
 * @param {{server: ?string}} anki
 * @param {string} server The address that {@link PhraseModelPreparer.prepare} returned.
 * @throws {Error} anki_route_switched; anki_closed — the client has no address at all.
 */
export function requirePhraseServer(anki, server) {
    if (anki.server === null || anki.server === '') { throw createFlibError('anki_closed'); }
    if (anki.server !== server) { throw createFlibError(ANKI_ROUTE_SWITCHED_CODE); }
}

/**
 * @template [T=unknown]
 * @param {(signal: AbortSignal) => Promise<T>} task The signal is for its requests: `anki.withSignal(signal)`.
 * @param {number} timeoutMs
 * @returns {Promise<T>}
 * @throws {Error} «No answer in … ms». ⚠️ What was sent may be done by Anki all the same.
 */
export async function withPhraseTimeout(task, timeoutMs) {
    const controller = new AbortController();
    /** @type {?import('core').Timeout} */
    let timer = null;
    /** @type {Promise<never>} */
    const timeout = new Promise((_resolve, reject) => {
        timer = setTimeout(() => {
            reject(new Error(`No answer in ${timeoutMs} ms`));
            controller.abort();
        }, timeoutMs);
    });
    try {
        return await Promise.race([task(controller.signal), timeout]);
    } finally {
        if (timer !== null) { clearTimeout(timer); }
    }
}

/**
 * @param {unknown} error
 * @param {boolean} routeSwitched The address changed during the request.
 * @returns {Error} With a code and without the request: the error of AnkiConnect carries its parameters.
 */
function createRequestError(error, routeSwitched) {
    const detail = error instanceof Error ? error.message : String(error);
    const code = routeSwitched ? ANKI_ROUTE_SWITCHED_CODE : (getAnkiRouteErrorCode(error) ?? 'anki_model_failed');
    return createFlibError(code, null, {detail});
}

/**
 * @param {string} detail
 * @returns {Error}
 */
function createOutdatedError(detail) {
    return createFlibError('anki_model_outdated', null, {detail});
}

/**
 * @param {{enabled: boolean}} anki
 * @throws {Error}
 */
function requireEnabled(anki) {
    if (!anki.enabled) { throw createFlibError('anki_model_failed', null, {detail: 'AnkiConnect not enabled'}); }
}

/**
 * Requests of one run. Before and after each of them AnkiConnect must be on (off, the client answers with an empty
 * list or a write that did not happen) and the address must be the one of the beginning.
 * @param {import('../comm/anki-connect.js').AnkiConnect} anki Pinned to the address.
 * @param {number} timeoutMs
 * @returns {Run}
 */
function createRun(anki, timeoutMs) {
    const server = anki.server ?? '';
    const check = () => {
        requireEnabled(anki);
        requirePhraseServer(anki, server);
    };
    return async (request) => {
        check();
        let result;
        try {
            result = await withPhraseTimeout((signal) => request(anki.withSignal(signal)), timeoutMs);
        } catch (e) {
            throw createRequestError(e, anki.server !== server);
        }
        check();
        return result;
    };
}

/**
 * @param {{Front: string, Back: string}} template
 * @param {string} css
 * @returns {Promise<Hashes>}
 */
async function hashModel({Front, Back}, css) {
    const [front, back, cssHash] = await Promise.all([hashModelContent(Front), hashModelContent(Back), hashModelCss(css)]);
    return {front, back, css: cssHash};
}

/**
 * ⚠️ Anki tells field names apart without letter case, its templates do not: `{{flib_media}}` never shows `Flib_Media`.
 * @param {Run} run
 * @param {import('flib-anki-models').FlibAnkiModel} model
 * @returns {Promise<string[]>}
 * @throws {Error} anki_model_outdated: a phrase cannot be written into this type, whoever made it.
 */
async function readFields(run, {name: modelName, fields: ours}) {
    const fields = await run((anki) => anki.getModelFieldNames(modelName));
    const other = fields.find((name) => name !== FLIB_MEDIA_FIELD_NAME && name.toLowerCase() === FLIB_MEDIA_FIELD_NAME);
    if (typeof other !== 'undefined') { throw createOutdatedError(`${modelName}.${other}`); }
    const missing = ours.filter((name) => name !== FLIB_MEDIA_FIELD_NAME && !fields.includes(name));
    if (missing.length > 0) { throw createOutdatedError(`${modelName}: ${missing.join(', ')}`); }
    return fields;
}

/**
 * @param {Run} run
 * @param {import('flib-anki-models').FlibAnkiModel} model
 * @returns {Promise<{templates: import('anki-connect').ModelTemplates, template: {Front: string, Back: string}|undefined, css: string}>} `template` is our card template, if the type has it.
 */
async function readContent(run, {name, cardTemplates: [{Name: cardName}]}) {
    const templates = await run((anki) => anki.modelTemplates(name));
    const css = await run((anki) => anki.modelStyling(name));
    return {templates, template: Object.hasOwn(templates, cardName) ? templates[cardName] : void 0, css};
}

/**
 * @param {Run} run
 * @param {import('flib-anki-models').FlibAnkiModel} model
 * @returns {Promise<InstalledModel>}
 */
async function readInstalled(run, model) {
    const fields = await readFields(run, model);
    const content = await readContent(run, model);
    return {fields, ...content, hashes: typeof content.template === 'undefined' ? null : await hashModel(content.template, content.css)};
}

/**
 * The names that a side refers to: the last segment of `{{filter:name}}`, `{{#name}}`, `{{^name}}`.
 * @param {string} side
 * @returns {{name: string, filters: string[], isSection: boolean}[]}
 */
function getReferences(side) {
    /** @type {{name: string, filters: string[], isSection: boolean}[]} */
    const result = [];
    for (const [, content] of side.matchAll(TOKEN_PATTERN)) {
        if (typeof content === 'undefined') { continue; }
        const tag = content.replace(/^\{+/, '').trim();
        // The end of a section, a comment, the change of the delimiters.
        if (/^[/!=]/.test(tag)) { continue; }
        const isSection = /^[#^]/.test(tag);
        const segments = (isSection ? tag.slice(1) : tag).split(':').map((segment) => segment.trim());
        result.push({name: segments[segments.length - 1], filters: segments.slice(0, -1), isSection});
    }
    return result;
}

/**
 * Whether Anki certainly refuses the side, and with it every save of the type, for a field that is not there.
 * ⚠️ `true` lets the template be overwritten, so only what cannot be read in another way is a proof.
 * @param {string} side
 * @param {string[]} fields
 * @returns {boolean}
 */
function refersToMissingField(side, fields) {
    if (side.includes(LEGACY_DELIMITERS)) { return false; }
    return getReferences(side).some(({name, isSection}) => (
        PLAIN_NAME_PATTERN.test(name) && !SPECIAL_NAMES.has(name) && !fields.includes(name) && !(isSection && /^c\d+$/.test(name))
    ));
}

/**
 * Whether Flibooster Core made the type while Anki was closed (`actionCreateModel` in its ankistore): exactly our
 * fields, in our order, and the template and the CSS of the note type with id 1 of the collection («Basic»). Anki
 * has had no such id for years, so in fact both sides and the CSS are empty; a copy of «Basic» refers to its fields,
 * that are not there but for «Front». Such a type is of no use in Anki and cannot even be edited there.
 *
 * ⚠️ A template that Anki accepts is therefore the user's, however plain it is, unless it is our bridge. The CSS is
 * not looked at: Anki refuses to save it together with the template.
 * @param {InstalledModel} installed
 * @param {import('flib-anki-models').FlibAnkiModel} model
 * @returns {boolean}
 */
function isCoreType({fields, template}, model) {
    if (typeof template === 'undefined') { return false; }
    const {Front, Back} = template;
    const isOurs = [model.fields, model.fields.filter((name) => name !== FLIB_MEDIA_FIELD_NAME)].some(
        (names) => names.length === fields.length && names.every((name, i) => name === fields[i]),
    );
    if (!isOurs) { return false; }
    if (model.fields.some((name) => name !== 'Front' && (Front.includes(name) || Back.includes(name)))) { return false; }
    return (
        (Front.trim() === '' && Back.trim() === '') ||
        refersToMissingField(Front, fields) ||
        refersToMissingField(Back, fields) ||
        isBridge(template)
    );
}

/**
 * @param {{Front: string, Back: string}|undefined} template
 * @returns {boolean}
 */
function isBridge(template) {
    return template?.Front === BRIDGE_TEMPLATE.Front && template.Back === BRIDGE_TEMPLATE.Back;
}

/**
 * Whether a card of the user's own type shows what is in `flib_media`.
 * @param {InstalledModel} installed
 * @returns {boolean} Of «Card 1»; when it has another name, of any template.
 */
function isVideoHidden({templates, template}) {
    const shown = (typeof template === 'undefined' ? Object.values(templates) : [template]).some(({Front, Back}) => (
        [...getReferences(Front), ...getReferences(Back)].some(({name, filters, isSection}) => (
            // `type:` is an input, `text:` drops the players and the links.
            name === FLIB_MEDIA_FIELD_NAME && !isSection && !filters.includes('type') && !filters.includes('text')
        ))
    ));
    return !shown;
}

/**
 * @param {Run} run
 * @param {import('flib-anki-models').FlibAnkiModel} model
 * @param {Hashes} target
 * @throws {Error} anki_model_outdated
 */
async function verifyInstalled(run, model, target) {
    const {fields, hashes} = await readInstalled(run, model);
    if (!fields.includes(FLIB_MEDIA_FIELD_NAME)) { throw createOutdatedError(`${model.name}: ${FLIB_MEDIA_FIELD_NAME}`); }
    if (hashes === null || hashes.front !== target.front || hashes.back !== target.back) { throw createOutdatedError(`${model.name}: ${model.cardTemplates[0].Name}`); }
    if (hashes.css !== target.css) { throw createOutdatedError(`${model.name}: CSS`); }
}

/**
 * @param {Run} run
 * @param {import('flib-anki-models').FlibAnkiModel} model
 * @returns {Promise<boolean>} false: somebody made the type first.
 */
async function createType(run, model) {
    // The deck first: it is idempotent, and after a failure in between the next run still finds the type missing.
    await run((anki) => anki.createDeck(FLIB_PRODUCT_DECK));
    return await run(async (anki) => {
        try {
            await anki.createModel(model);
            return true;
        } catch (e) {
            if (e instanceof Error && e.message.toLowerCase().includes('already exists')) { return false; }
            throw e;
        }
    });
}

/**
 * @param {import('../comm/anki-connect.js').AnkiConnect} anki Any client: the work goes through its `withoutFallback()`.
 * @param {import('flib-anki-models').FlibAnkiModel} model
 * @param {{timeoutMs?: number}} [options] Of one request.
 * @returns {Promise<{videoHidden: boolean}>} `true`: the type is the user's and its cards do not show `flib_media`.
 * @throws {Error} anki_closed / anki_model_outdated / anki_model_failed / anki_route_switched
 */
export async function ensurePhraseModel(anki, model, {timeoutMs = PHRASE_REQUEST_TIMEOUT_MS} = {}) {
    const run = createRun(anki.withoutFallback(anki.server), timeoutMs);
    const {name, cardTemplates: [{Name: cardName, Front, Back}]} = model;
    const target = await hashModel({Front, Back}, model.css);

    const names = await run((view) => view.getModelNames());
    if (!names.includes(name)) {
        // Anki would make «Phrases+» beside «phrases».
        const other = names.find((value) => value.toLowerCase() === name.toLowerCase());
        if (typeof other !== 'undefined') { throw createOutdatedError(other); }
        if (await createType(run, model)) {
            await verifyInstalled(run, model, target);
            return {videoHidden: false};
        }
    }

    const installed = await readInstalled(run, model);
    const {fields, template, hashes} = installed;
    const hasField = fields.includes(FLIB_MEDIA_FIELD_NAME);
    const addField = () => run((view) => view.modelFieldAdd(name, FLIB_MEDIA_FIELD_NAME, fields.length));
    let isConfirmed = false;
    /** The user may have written something since it was judged: looked at once more right before it is overwritten. */
    const confirm = async () => {
        if (isConfirmed) { return; }
        const now = await readContent(run, model);
        if (now.template?.Front !== template?.Front || now.template?.Back !== template?.Back || now.css !== installed.css) {
            throw createFlibError('anki_model_failed', null, {detail: `${name}: changed meanwhile`});
        }
        isConfirmed = true;
    };
    const updateTemplate = async (/** @type {{Front: string, Back: string}} */ sides) => {
        await confirm();
        await run((view) => view.updateModelTemplates(name, {[cardName]: {...sides}}));
    };
    const updateCss = async () => {
        await confirm();
        await run((view) => view.updateModelStyling(name, model.css));
    };

    const isCore = isCoreType(installed, model);
    /** @type {(key: keyof Hashes) => boolean} */
    const isKnown = (key) => hashes !== null && (hashes[key] === target[key] || (model.previous?.[key] ?? []).includes(hashes[key]));
    if (!isCore && !(isKnown('front') && isKnown('back') && isKnown('css'))) {
        if (!hasField) {
            await addField();
            if (!(await readFields(run, model)).includes(FLIB_MEDIA_FIELD_NAME)) { throw createOutdatedError(`${name}: ${FLIB_MEDIA_FIELD_NAME}`); }
        }
        return {videoHidden: isVideoHidden(installed)};
    }

    const isTemplateNew = hashes !== null && hashes.front === target.front && hashes.back === target.back;
    const isCssNew = hashes !== null && hashes.css === target.css;
    if (hasField && isTemplateNew && isCssNew) { return {videoHidden: false}; }
    // ⚠️ Anki checks the templates on every save of a type, also of a field or of the CSS. Those of Core do not pass,
    // and the new ones do not pass before the field that they name.
    if (isCore && !isBridge(template)) { await updateTemplate(BRIDGE_TEMPLATE); }
    if (!hasField) { await addField(); }
    // ⚠️ The CSS of a Core type is known only by its template, so that template is replaced last.
    if (isCore && !isCssNew) { await updateCss(); }
    if (!isTemplateNew) { await updateTemplate({Front, Back}); }
    if (!isCore && !isCssNew) { await updateCss(); }
    await verifyInstalled(run, model, target);
    return {videoHidden: false};
}

/**
 * {@link ensurePhraseModel} once per worker and address, one run at a time.
 */
export class PhraseModelPreparer {
    /**
     * @param {object} details
     * @param {import('../comm/anki-connect.js').AnkiConnect} details.anki
     * @param {() => Promise<import('flib-anki-models').FlibAnkiModelsFile>} details.loadModels
     * @param {number} [details.timeoutMs] Of one request.
     */
    constructor({anki, loadModels, timeoutMs = PHRASE_REQUEST_TIMEOUT_MS}) {
        /** @type {import('../comm/anki-connect.js').AnkiConnect} */
        this._anki = anki.withoutFallback();
        /** @type {() => Promise<import('flib-anki-models').FlibAnkiModelsFile>} */
        this._loadModels = loadModels;
        /** @type {number} */
        this._timeoutMs = timeoutMs;
        /** @type {Map<string, import('api').FlibPhrasePrepared>} */
        this._prepared = new Map();
        /** @type {number} */
        this._generation = 0;
        /** @type {?{server: string, generation: number, promise: Promise<import('api').FlibPhrasePrepared>}} */
        this._current = null;
    }

    /**
     * Call after every failed write of a phrase: the collection behind the address may be another one by now (the
     * user switched the Anki profile). A run that is going on is not remembered, and the next call does not join it.
     */
    forget() {
        this._generation += 1;
        this._prepared.clear();
    }

    /**
     * @returns {Promise<import('api').FlibPhrasePrepared>}
     * @throws {Error} anki_closed / anki_model_outdated / anki_model_failed / anki_route_switched
     */
    prepare() {
        const server = this._anki.server ?? '';
        const generation = this._generation;
        const previous = this._current;
        if (previous !== null && previous.server === server && previous.generation === generation) { return previous.promise; }
        // Two runs at once would write over each other's halves.
        const turn = previous === null ? Promise.resolve() : previous.promise.then(() => {}, () => {});
        const current = {server, generation, promise: turn.then(() => this._prepare(server, generation))};
        this._current = current;
        const done = () => {
            if (this._current === current) { this._current = null; }
        };
        current.promise.then(done, done);
        return current.promise;
    }

    /**
     * @param {string} server
     * @param {number} generation
     * @returns {Promise<import('api').FlibPhrasePrepared>}
     */
    async _prepare(server, generation) {
        requireEnabled(this._anki);
        const prepared = this._prepared.get(server);
        if (typeof prepared !== 'undefined') {
            requirePhraseServer(this._anki, server);
            return prepared;
        }
        const model = await this._loadModel();
        // Synchronous with the start of the run, which holds on to the address from there.
        requirePhraseServer(this._anki, server);
        const {videoHidden} = await ensurePhraseModel(this._anki, model, {timeoutMs: this._timeoutMs});
        requirePhraseServer(this._anki, server);
        const result = {server, videoHidden, modelRevision: getModelRevision(model.css)};
        if (generation === this._generation) { this._prepared.set(server, result); }
        return result;
    }

    /** @returns {Promise<import('flib-anki-models').FlibAnkiModel>} */
    async _loadModel() {
        let model;
        try {
            const {models} = await withPhraseTimeout(() => this._loadModels(), this._timeoutMs);
            model = models.find(({name}) => name === FLIB_PHRASES_MODEL);
        } catch (e) {
            throw createRequestError(e, false);
        }
        if (typeof model === 'undefined') { throw createFlibError('anki_model_failed', null, {detail: FLIB_PHRASES_MODEL}); }
        return model;
    }
}
