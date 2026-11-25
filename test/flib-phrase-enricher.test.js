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
import {Backend} from '../ext/js/background/backend.js';
import {FlibPhraseEnricher} from '../ext/js/background/flib-phrase-enricher.js';
import {AnkiConnect} from '../ext/js/comm/anki-connect.js';
import {API} from '../ext/js/comm/api.js';
import {createFlibError} from '../ext/js/comm/flib-gateway-client.js';
import {parseJson} from '../ext/js/core/json.js';
import {phraseSpeechTexts} from '../ext/js/data/flib-phrase-note.js';

/* eslint-disable no-underscore-dangle, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */

const CORE = 'http://127.0.0.1:8777';
const DIRECT = 'http://127.0.0.1:8765';
const ID = 1000;
const TIMEOUT = 2000;
const EXPRESSION = 'They live in a flat.';
const FRONT = 'They ... ... ... in a flat.';
const EXPRESSION_FILE = `tts_phr_exp_${ID}.mp3`;
const FRONT_FILE = `tts_phr_front_${ID}.mp3`;
const EXPRESSION_SOUND = `[sound:${EXPRESSION_FILE}]`;
const FRONT_SOUND = `[sound:${FRONT_FILE}]`;
const TRANSLATION = 'Они живут в квартире.';
const DONE = {status: 'done'};
const SKIPPED = {status: 'skipped'};
/** One run with everything to do. */
const ALL_ACTIONS = [
    'notesInfo',
    'storeMediaFile',
    'notesInfo',
    'updateNoteFields',
    'notesInfo',
    'storeMediaFile',
    'notesInfo',
    'updateNoteFields',
    'notesInfo',
    'notesInfo',
    'updateNoteFields',
];

/**
 * @param {string} code
 * @returns {{status: string, code: string}}
 */
const failed = (code) => ({status: 'failed', code});

/**
 * @typedef {object} FakeNote
 * @property {string} modelName
 * @property {Record<string, string>} fields
 * @property {string[]} tags
 */

/** AnkiConnect with an open Anki. */
class FakeAnki {
    constructor() {
        /** @type {Map<number, FakeNote>} */
        this.notes = new Map();
        /** @type {Map<string, string>} */
        this.media = new Map();
        this.put(ID);
    }

    /**
     * @param {number} id
     * @param {Record<string, string>} [fields]
     * @param {string} [modelName]
     */
    put(id, fields = {}, modelName = 'Phrases') {
        this.notes.set(id, {
            modelName,
            fields: {Front: 'They _____ in a flat.', Expression: EXPRESSION, EnglishWord: 'live', ExpressionTranslate: '', Audio_front: '', Audio_expression: '', flib_media: 'videos', ...fields},
            tags: ['yomitan', 'flib_enriched'],
        });
    }

    /**
     * @param {number} [id]
     * @returns {FakeNote}
     */
    note(id = ID) { return /** @type {FakeNote} */ (this.notes.get(id)); }

    /**
     * @param {string} action
     * @param {Record<string, any>} params
     * @returns {unknown}
     * @throws {Error}
     */
    run(action, params) {
        switch (action) {
            case 'version': return 6;
            case 'notesInfo': return params.notes.map((/** @type {number} */ id) => {
                const note = this.notes.get(id);
                if (typeof note === 'undefined') { return {}; }
                return {noteId: id, modelName: note.modelName, tags: note.tags, cards: [id], fields: Object.fromEntries(Object.entries(note.fields).map(([name, value], order) => [name, {value, order}]))};
            });
            case 'updateNoteFields': {
                const note = this.notes.get(params.note.id);
                if (typeof note === 'undefined') { throw new Error(`Note was not found: ${params.note.id}`); }
                for (const [name, value] of Object.entries(params.note.fields)) {
                    if (Object.hasOwn(note.fields, name)) { note.fields[name] = /** @type {string} */ (value).normalize('NFC'); }
                }
                return null;
            }
            case 'storeMediaFile':
                this.media.set(params.filename, params.data);
                return params.filename;
            default:
                throw new Error('unsupported action');
        }
    }
}

/**
 * @typedef {object} Sent
 * @property {string} server
 * @property {string} action
 * @property {Record<string, any>} params
 * @property {number} number of the request without the version checks, from 0; -1 — a version check.
 * @property {boolean} noFallback
 */

const WRITES = new Set(['updateNoteFields', 'storeMediaFile']);

/** @type {Record<string, FakeAnki>} */
let servers = {};
/** @type {Sent[]} Requests to Anki. */
let sent = [];
/** @type {{path: string, body: any}[]} Requests to the gateway, only in the tests of the API. */
let gatewaySent = [];
/**
 * What a server answers instead of Anki; undefined — Anki answers. May throw: the network.
 * @type {(request: Sent) => (Response|Promise<Response>|Promise<undefined>|undefined)}
 */
let answer = (_request) => void 0;

/** @type {typeof fetch} */
const fakeFetch = async (input, init = {}) => {
    const url = /** @type {string} */ (input);
    /** @type {any} */
    const body = parseJson(typeof init.body === 'string' ? init.body : '{}');
    if (!url.startsWith('http://127.0.0.1')) {
        gatewaySent.push({path: new URL(url).pathname, body});
        if (url.includes('/v1/text-to-speech/')) { return new Response('mp3'); }
        return new Response(JSON.stringify({choices: [{message: {content: JSON.stringify({tr: TRANSLATION})}}]}));
    }
    const {action, params} = body;
    /** @type {Sent} */
    const request = {
        server: url,
        action,
        params,
        number: action === 'version' ? -1 : sent.filter(({number}) => number >= 0).length,
        noFallback: /** @type {Record<string, string>} */ (init.headers)['X-Anki-No-Fallback'] === '1',
    };
    sent.push(request);
    const answered = await answer(request);
    if (typeof answered !== 'undefined') { return answered; }
    if (!(url in servers)) { throw new TypeError('Failed to fetch'); }
    try {
        return new Response(JSON.stringify(servers[url].run(action, params)));
    } catch (e) {
        return new Response(JSON.stringify({result: null, error: /** @type {Error} */ (e).message}));
    }
};

beforeEach(() => {
    servers = {[DIRECT]: new FakeAnki()};
    sent = [];
    gatewaySent = [];
    answer = () => void 0;
    vi.stubGlobal('fetch', fakeFetch);
});

afterEach(() => {
    // Rules: no request of a phrase may reach the fallback of Core, and nothing touches the tags.
    for (const {action, noFallback} of sent) { expect([action, noFallback]).toStrictEqual([action, true]); }
    for (const anki of Object.values(servers)) {
        for (const {tags} of anki.notes.values()) { expect(tags).toStrictEqual(['yomitan', 'flib_enriched']); }
    }
    expect(sent.filter(({action}) => /tag/i.test(action))).toStrictEqual([]);
    vi.unstubAllGlobals();
    vi.useRealTimers();
});

/** @returns {FakeAnki} */
const anki = () => servers[DIRECT];

/** @returns {Record<string, string>} What the enrichment may fill. */
const filled = () => {
    const {Audio_expression: expression, Audio_front: front, ExpressionTranslate: translation} = anki().note().fields;
    return {expression, front, translation};
};

/** @returns {string[]} Without the version checks. */
const actions = () => sent.filter(({number}) => number >= 0).map(({action}) => action);

/** @returns {string[]} */
const writes = () => actions().filter((action) => WRITES.has(action));

/** @returns {AnkiConnect} */
function makeClient() {
    const client = new AnkiConnect();
    client.enabled = true;
    client.server = DIRECT;
    return client;
}

/**
 * @param {number} ms
 * @returns {Promise<void>}
 */
const sleep = (ms) => new Promise((resolve) => { setTimeout(resolve, ms); });

/** The answers of the servers need real turns of the event loop. */
function useFakeTimers() {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval']});
}

/**
 * @param {() => boolean} condition
 * @returns {Promise<void>}
 */
async function until(condition) {
    while (!condition()) {
        await new Promise((resolve) => { setImmediate(resolve); });
    }
}

/**
 * As the gateway: hangs until it is aborted.
 * @param {{signal: AbortSignal}} options
 * @returns {Promise<never>}
 */
const hang = ({signal}) => new Promise((_resolve, reject) => {
    if (signal.aborted) { reject(createFlibError('flib_aborted')); }
    signal.addEventListener('abort', () => { reject(createFlibError('flib_aborted')); });
});

/**
 * @typedef {object} Overrides
 * @property {(text: string, options: {signal: AbortSignal}) => unknown} [speech] Returns nothing: a sound.
 * @property {(sentence: string, options: {signal: AbortSignal}) => unknown} [translate] Returns the translation.
 * @property {Map<string, string>} [cache]
 * @property {AnkiConnect} [client]
 * @property {number} [budgetMs]
 * @property {number} [timeoutMs]
 * @property {() => void} [keepAlive]
 * @property {number} [keepAliveMs]
 */

/**
 * One worker.
 * @param {Overrides} [overrides]
 * @returns {{enricher: FlibPhraseEnricher, client: AnkiConnect, spoken: string[], translated: string[], cache: Map<string, string>, sentenceCache: {read: import('vitest').Mock<(key: string) => Promise<?string>>, write: import('vitest').Mock<(key: string, value: string) => Promise<void>>}}}
 */
function makeWorker({speech = () => {}, translate = () => TRANSLATION, cache = new Map(), client = makeClient(), timeoutMs = TIMEOUT, ...rest} = {}) {
    /** @type {string[]} */
    const spoken = [];
    /** @type {string[]} */
    const translated = [];
    const gateway = {
        synthesizeSpeech: async (/** @type {string} */ text, /** @type {{signal: AbortSignal}} */ options) => {
            spoken.push(text);
            await speech(text, options);
            return {base64: `sound of ${text}`, cached: false};
        },
        translateSentence: async (/** @type {string} */ sentence, /** @type {{signal: AbortSignal}} */ options) => {
            translated.push(sentence);
            return {translation: await translate(sentence, options)};
        },
    };
    const sentenceCache = {
        read: vi.fn(async (/** @type {string} */ key) => cache.get(key) ?? null),
        write: vi.fn(async (/** @type {string} */ key, /** @type {string} */ value) => { cache.set(key, value); }),
    };
    const enricher = new FlibPhraseEnricher({anki: client, gateway: /** @type {*} */ (gateway), cache: /** @type {*} */ (sentenceCache), retryDelayMs: 0, timeoutMs, ...rest});
    return {enricher, client, spoken, translated, cache, sentenceCache};
}

/**
 * @param {Record<string, unknown>} [change]
 * @returns {any}
 */
const params = (change = {}) => ({server: DIRECT, noteId: ID, expression: EXPRESSION, front: FRONT, useCache: true, ...change});

/**
 * @param {ReturnType<typeof makeWorker>} worker
 * @param {Record<string, unknown>} [change]
 * @param {boolean} [cacheAllowed]
 * @returns {Promise<import('flib-gateway').PhraseEnrichReport>}
 */
const enrich = (worker, change = {}, cacheAllowed = true) => worker.enricher.enrich(params(change), {cacheAllowed});

/**
 * @param {string} code
 * @returns {() => never}
 */
const throws = (code) => () => { throw createFlibError(code); };

describe('the steps', () => {
    test('audio of the phrase and of the front, translation: the fields, the files, the requests', async () => {
        const worker = makeWorker();
        expect(await enrich(worker)).toStrictEqual({audio: DONE, translation: DONE, speechCode: null});
        expect(filled()).toStrictEqual({expression: EXPRESSION_SOUND, front: FRONT_SOUND, translation: TRANSLATION});
        expect([...anki().media]).toStrictEqual([[EXPRESSION_FILE, `sound of ${EXPRESSION}`], [FRONT_FILE, `sound of ${FRONT}`]]);
        expect(worker.spoken).toStrictEqual([EXPRESSION, FRONT]);
        expect(worker.translated).toStrictEqual([EXPRESSION]);
        expect(actions()).toStrictEqual(ALL_ACTIONS);
        expect(sent.filter(({action}) => action === 'updateNoteFields').map(({params: {note}}) => note)).toStrictEqual([
            {id: ID, fields: {Audio_expression: EXPRESSION_SOUND}},
            {id: ID, fields: {Audio_front: FRONT_SOUND}},
            {id: ID, fields: {ExpressionTranslate: TRANSLATION}},
        ]);
    });

    test('the texts of a phrase with a blank are what is spoken', async () => {
        const worker = makeWorker();
        const {expression, front} = phraseSpeechTexts({value: EXPRESSION, blank: {start: 5, end: 9}});
        await enrich(worker, {expression, front});
        expect(worker.spoken).toStrictEqual([EXPRESSION, FRONT]);
    });

    test('no blank: the front is not spoken and not written', async () => {
        const worker = makeWorker();
        expect(await enrich(worker, {front: null})).toStrictEqual({audio: DONE, translation: DONE, speechCode: null});
        expect(worker.spoken).toStrictEqual([EXPRESSION]);
        expect(filled()).toStrictEqual({expression: EXPRESSION_SOUND, front: '', translation: TRANSLATION});
        expect([...anki().media.keys()]).toStrictEqual([EXPRESSION_FILE]);
    });

    test('the note type in another letter case is the same type', async () => {
        anki().note().modelName = 'phrases';
        expect(await enrich(makeWorker())).toStrictEqual({audio: DONE, translation: DONE, speechCode: null});
    });

    test('the second call finds everything there: nothing is written, nothing is paid', async () => {
        const worker = makeWorker();
        await enrich(worker);
        sent = [];
        expect(await enrich(worker)).toStrictEqual({audio: SKIPPED, translation: SKIPPED, speechCode: null});
        expect(worker.spoken).toHaveLength(2);
        expect(worker.translated).toHaveLength(1);
        expect(writes()).toStrictEqual([]);
    });
});

describe('one failed step does not stop the other', () => {
    test.each(/** @type {[name: string, overrides: Overrides, report: object, fields: object][]} */ ([
        ['speech quota', {speech: throws('tts_quota_exhausted')}, {audio: failed('tts_quota_exhausted'), translation: DONE, speechCode: 'tts_quota_exhausted'}, {expression: '', front: '', translation: TRANSLATION}],
        ['translation quota', {translate: throws('llm_quota_exhausted')}, {audio: DONE, translation: failed('llm_quota_exhausted'), speechCode: null}, {expression: EXPRESSION_SOUND, front: FRONT_SOUND, translation: ''}],
        ['both', {speech: throws('tts_failed'), translate: throws('llm_bad_answer')}, {audio: failed('tts_failed'), translation: failed('llm_bad_answer'), speechCode: 'tts_failed'}, {expression: '', front: '', translation: ''}],
        ['the first clip', {speech: (text) => (text === EXPRESSION ? throws('tts_quota_exhausted')() : void 0)}, {audio: failed('tts_quota_exhausted'), translation: DONE, speechCode: 'tts_quota_exhausted'}, {expression: '', front: FRONT_SOUND, translation: TRANSLATION}],
        ['the second clip', {speech: (text) => (text === FRONT ? throws('tts_failed')() : void 0)}, {audio: failed('tts_failed'), translation: DONE, speechCode: 'tts_failed'}, {expression: EXPRESSION_SOUND, front: '', translation: TRANSLATION}],
        ['clips for different reasons: the first one', {speech: (text) => { throw createFlibError(text === EXPRESSION ? 'tts_failed' : 'tts_quota_exhausted'); }}, {audio: failed('tts_failed'), translation: DONE, speechCode: 'tts_failed'}, {expression: '', front: '', translation: TRANSLATION}],
    ]))('%s', async (_name, overrides, report, fields) => {
        expect(await enrich(makeWorker(overrides))).toStrictEqual(report);
        expect(filled()).toStrictEqual(fields);
    });

    test('a file that was not stored: no field, the code as of a speech error', async () => {
        answer = ({action, params: {filename}}) => (action === 'storeMediaFile' && filename === EXPRESSION_FILE ? new Response(JSON.stringify({result: null, error: 'disk full'})) : void 0);
        expect(await enrich(makeWorker())).toStrictEqual({audio: failed('anki_note_failed'), translation: DONE, speechCode: 'anki_note_failed'});
        expect(filled()).toStrictEqual({expression: '', front: FRONT_SOUND, translation: TRANSLATION});
    });

    test.each([['another name', '"tts_phr_exp_1000-1.mp3"'], ['null', 'null']])('stored under %s: no field points to a wrong file', async (_name, result) => {
        answer = ({action}) => (action === 'storeMediaFile' ? new Response(result) : void 0);
        expect(await enrich(makeWorker())).toStrictEqual({audio: failed('flib_media_not_stored'), translation: DONE, speechCode: 'flib_media_not_stored'});
        expect(filled()).toStrictEqual({expression: '', front: '', translation: TRANSLATION});
    });

    test('a field that was not written is not a speech error', async () => {
        answer = ({action, params: {note}}) => (action === 'updateNoteFields' && 'Audio_front' in note.fields ? new Response('', {status: 500}) : void 0);
        expect(await enrich(makeWorker())).toStrictEqual({audio: failed('anki_note_failed'), translation: DONE, speechCode: null});
        expect(filled()).toStrictEqual({expression: EXPRESSION_SOUND, front: '', translation: TRANSLATION});
    });
});

describe('the translation', () => {
    test.each([
        ['markup', 'Он <b>сказал</b>: «да» & ушёл', 'Он сказал: «да»  ушёл'],
        ['quotes', 'Он сказал "да"', 'Он сказал &quot;да&quot;'],
        ['a directive of Anki', 'Звук [sound:x.mp3] тут', 'Звук sound:x.mp3] тут'],
        ['MathJax', String.raw`Итог \(x\)`, 'Итог (x)'],
        ['lines', ' Раз\nдва ', 'Раз<br>два'],
        ['control characters', 'Р\u0000а​з', 'Раз'],
    ])('cleaned before it is written: %s', async (_name, translation, expected) => {
        expect((await enrich(makeWorker({translate: () => translation}))).translation).toStrictEqual(DONE);
        expect(filled().translation).toBe(expected);
    });

    test('nothing left after the cleaning: a bad answer, nothing is written', async () => {
        expect((await enrich(makeWorker({translate: () => '<br>'}))).translation).toStrictEqual(failed('llm_bad_answer'));
        expect(filled().translation).toBe('');
        expect(writes()).toHaveLength(4);
    });

    test('a translation that is there already stays, nothing is paid', async () => {
        anki().note().fields.ExpressionTranslate = 'моё';
        const worker = makeWorker();
        expect(await enrich(worker)).toStrictEqual({audio: DONE, translation: SKIPPED, speechCode: null});
        expect(filled().translation).toBe('моё');
        expect(worker.translated).toStrictEqual([]);
        expect(worker.sentenceCache.read).not.toHaveBeenCalled();
    });

    test('typed in Anki during the request: it stays', async () => {
        const worker = makeWorker({translate: () => {
            anki().note().fields.ExpressionTranslate = 'моё';
            return TRANSLATION;
        }});
        expect(await enrich(worker)).toStrictEqual({audio: DONE, translation: SKIPPED, speechCode: null});
        expect(filled().translation).toBe('моё');
    });

    test('only spaces are no translation', async () => {
        anki().note().fields.ExpressionTranslate = ' \n';
        expect((await enrich(makeWorker())).translation).toStrictEqual(DONE);
        expect(filled().translation).toBe(TRANSLATION);
    });

    test('what is sent is the normalised key: NFC, single spaces, no edges', async () => {
        const worker = makeWorker();
        await enrich(worker, {expression: '  Un  café\n here '});
        expect(worker.translated).toStrictEqual(['Un café here']);
        expect([...worker.cache.keys()]).toStrictEqual(['Un café here']);
    });

    test('1000 characters of the key are spoken and translated', async () => {
        const text = 'a'.repeat(1000);
        const worker = makeWorker();
        expect(await enrich(worker, {expression: ` ${text} `, front: null})).toStrictEqual({audio: DONE, translation: DONE, speechCode: null});
        expect(worker.translated).toStrictEqual([text]);
        expect(worker.spoken).toHaveLength(1);
    });

    test.each([
        ['1001 characters', {expression: 'a'.repeat(1001)}],
        ['the longest phrase, its longest front', {expression: 'a'.repeat(5000), front: 'a'.repeat(5011)}],
        // NFC makes two characters of each «क़»: a phrase of 5000 characters, as it is saved.
        ['a phrase that NFC lengthened', phraseSpeechTexts({value: `a${'\u0958'.repeat(4999)}`, blank: null})],
        ['the longest message', {expression: 'a'.repeat(15000), front: 'a'.repeat(15011)}],
        ['at another address: nothing would be sent there either', {expression: 'a'.repeat(1001), server: CORE}],
    ])('%s: neither spoken nor translated, with the reason, no requests', async (_name, change) => {
        const worker = makeWorker();
        const skipped = {status: 'skipped', code: 'flib_sentence_too_long'};
        expect(await enrich(worker, change)).toStrictEqual({audio: skipped, translation: skipped, speechCode: null});
        expect([...sent, ...worker.spoken, ...worker.translated]).toStrictEqual([]);
        expect(worker.sentenceCache.read).not.toHaveBeenCalled();
        expect(filled()).toStrictEqual({expression: '', front: '', translation: ''});
    });

    test('a transient failure is repeated once, others are not', async () => {
        let calls = 0;
        const once = makeWorker({translate: () => {
            if (++calls === 1) { throw createFlibError('flib_service_unavailable'); }
            return TRANSLATION;
        }});
        expect((await enrich(once)).translation).toStrictEqual(DONE);
        for (const [code, count] of /** @type {const} */ ([['flib_service_unavailable', 2], ['flib_timeout', 1], ['llm_quota_exhausted', 1], ['flib_key_invalid', 1], ['llm_bad_answer', 1]])) {
            anki().put(ID);
            const worker = makeWorker({translate: throws(code)});
            expect((await enrich(worker)).translation).toStrictEqual(failed(code));
            expect(worker.translated).toHaveLength(count);
        }
    });
});

describe('the cache of translations', () => {
    test('allowed: a hit is written without a request, cleaned too', async () => {
        const worker = makeWorker({cache: new Map([[EXPRESSION, 'Из <i>кеша</i>']])});
        expect((await enrich(worker)).translation).toStrictEqual(DONE);
        expect(filled().translation).toBe('Из кеша');
        expect(worker.translated).toStrictEqual([]);
        expect(worker.sentenceCache.write).not.toHaveBeenCalled();
    });

    test('allowed: a miss is kept as «?» keeps it, uncleaned', async () => {
        const worker = makeWorker({translate: () => 'Так "вот"'});
        await enrich(worker);
        expect([...worker.cache]).toStrictEqual([[EXPRESSION, 'Так "вот"']]);
    });

    test('not allowed: neither read nor written, whatever the page asks', async () => {
        const worker = makeWorker({cache: new Map([[EXPRESSION, 'Из кеша']])});
        expect((await enrich(worker, {useCache: true}, false)).translation).toStrictEqual(DONE);
        expect(filled().translation).toBe(TRANSLATION);
        expect(worker.sentenceCache.read).not.toHaveBeenCalled();
        expect(worker.sentenceCache.write).not.toHaveBeenCalled();
    });

    test.each(['<br>', '<b></b>', ' \u200B '])('a translation of which nothing is left (%j) is not kept: the next call asks again', async (translation) => {
        let calls = 0;
        const worker = makeWorker({translate: () => (++calls === 1 ? translation : TRANSLATION)});
        expect((await enrich(worker)).translation).toStrictEqual(failed('llm_bad_answer'));
        expect(worker.sentenceCache.write).not.toHaveBeenCalled();
        expect((await enrich(worker)).translation).toStrictEqual(DONE);
        expect(filled().translation).toBe(TRANSLATION);
    });

    test('a failed translation is not kept', async () => {
        const worker = makeWorker({translate: throws('llm_bad_answer')});
        await enrich(worker);
        expect(worker.sentenceCache.write).not.toHaveBeenCalled();
    });
});

describe('the note', () => {
    test.each(/** @type {[name: string, change: (note: FakeNote) => void, code: string][]} */ ([
        ['of another type', (note) => { note.modelName = 'Basic'; }, 'anki_note_gone'],
        ['deleted', () => { anki().notes.delete(ID); }, 'anki_note_gone'],
    ]))('%s: nothing is paid, nothing is written', async (_name, change, code) => {
        change(anki().note());
        const worker = makeWorker();
        expect(await enrich(worker)).toStrictEqual({audio: failed(code), translation: failed(code), speechCode: null});
        expect([...worker.spoken, ...worker.translated, ...writes()]).toStrictEqual([]);
    });

    test.each(['deleted', 'of another type'])('%s while the gateway works: no field is written', async (name) => {
        const change = () => {
            anki().note().modelName = 'Basic';
            if (name === 'deleted') { anki().notes.delete(ID); }
        };
        const speaking = makeWorker({speech: change});
        expect(await enrich(speaking)).toStrictEqual({audio: failed('anki_note_gone'), translation: failed('anki_note_gone'), speechCode: null});
        expect(speaking.spoken).toStrictEqual([EXPRESSION]);
        expect(speaking.translated).toStrictEqual([]);
        anki().put(ID);
        const translating = makeWorker({translate: () => {
            change();
            return TRANSLATION;
        }});
        expect(await enrich(translating)).toStrictEqual({audio: DONE, translation: failed('anki_note_gone'), speechCode: null});
        expect(actions().filter((action) => action === 'updateNoteFields')).toHaveLength(2);
    });

    test.each([
        ['ExpressionTranslate', {audio: DONE, translation: failed('anki_model_outdated'), speechCode: null}, [EXPRESSION, FRONT], 0],
        ['Audio_front', {audio: failed('anki_model_outdated'), translation: DONE, speechCode: null}, [EXPRESSION], 1],
        ['Audio_expression', {audio: failed('anki_model_outdated'), translation: DONE, speechCode: null}, [FRONT], 1],
    ])('without the field %s (also in another letter case): nothing is paid for it', async (name, report, spoken, translations) => {
        const {fields} = anki().note();
        delete fields[name];
        fields[name.toUpperCase()] = '';
        const worker = makeWorker();
        expect(await enrich(worker)).toStrictEqual(report);
        expect(worker.spoken).toStrictEqual(spoken);
        expect(worker.translated).toHaveLength(translations);
        expect(fields[name.toUpperCase()]).toBe('');
    });

    test('audio of the user stays', async () => {
        anki().note().fields.Audio_expression = '[sound:mine.mp3]';
        const worker = makeWorker();
        expect(await enrich(worker)).toStrictEqual({audio: DONE, translation: DONE, speechCode: null});
        expect(worker.spoken).toStrictEqual([FRONT]);
        expect(filled().expression).toBe('[sound:mine.mp3]');
        anki().note().fields.Audio_front = '';
        anki().note().fields.Audio_expression = '';
        const racing = makeWorker({speech: () => {
            anki().note().fields.Audio_front = '[sound:mine.mp3]';
        }});
        expect((await enrich(racing)).audio).toStrictEqual(DONE);
        expect(filled()).toMatchObject({expression: EXPRESSION_SOUND, front: '[sound:mine.mp3]'});
    });
});

describe('Anki', () => {
    /** @type {[name: string, respond: () => Response, code: string][]} */
    const FAILURES = [
        ['502 of Core: Anki is closed', () => new Response('', {status: 502}), 'anki_closed'],
        ['nobody at the address', () => { throw new TypeError('Failed to fetch'); }, 'anki_closed'],
        ['a profile is being chosen', () => new Response(JSON.stringify({result: null, error: 'collection is not available'})), 'anki_closed'],
        ['500', () => new Response('', {status: 500}), 'anki_note_failed'],
        ['an error of AnkiConnect', () => new Response(JSON.stringify({result: null, error: 'boom'})), 'anki_note_failed'],
    ];

    test.each(FAILURES)('from each request on: %s', async (_name, respond, code) => {
        for (let from = 0; from < ALL_ACTIONS.length; ++from) {
            servers[DIRECT] = new FakeAnki();
            sent = [];
            answer = ({number}) => (number >= from ? respond() : void 0);
            const worker = makeWorker();
            const report = await enrich(worker);
            expect([from, report]).toStrictEqual([from, {
                audio: from < 8 ? failed(code) : DONE,
                translation: failed(code),
                // A clip that was made but not stored.
                speechCode: from === 1 || from === 5 ? code : null,
            }]);
            // Nothing is paid once Anki does not answer.
            expect(worker.spoken).toStrictEqual([EXPRESSION, FRONT].slice(0, from === 0 ? 0 : (from < 5 ? 1 : 2)));
            expect(worker.translated).toHaveLength(from < 9 ? 0 : 1);
            expect(Object.values(filled()).filter((value) => value !== '')).toHaveLength(from < 4 ? 0 : (from < 8 ? 1 : 2));
        }
    });

    test('a paid translation is kept for the next time when Anki closes before it is written', async () => {
        answer = ({number}) => (number >= 9 ? new Response('', {status: 502}) : void 0);
        const worker = makeWorker();
        expect((await enrich(worker)).translation).toStrictEqual(failed('anki_closed'));
        answer = () => void 0;
        expect(await enrich(worker)).toStrictEqual({audio: SKIPPED, translation: DONE, speechCode: null});
        expect(worker.translated).toHaveLength(1);
    });

    test('closed from the start', async () => {
        servers = {};
        const worker = makeWorker();
        expect(await enrich(worker)).toStrictEqual({audio: failed('anki_closed'), translation: failed('anki_closed'), speechCode: null});
        expect([...worker.spoken, ...worker.translated]).toStrictEqual([]);
    });

    test('one request fails: the rest is done', async () => {
        answer = ({number}) => (number === 0 ? new Response('', {status: 500}) : void 0);
        expect(await enrich(makeWorker())).toStrictEqual({audio: failed('anki_note_failed'), translation: DONE, speechCode: null});
        expect(filled()).toStrictEqual({expression: '', front: FRONT_SOUND, translation: TRANSLATION});
    });

    test('hangs: every request has a limit', async () => {
        answer = /** @type {*} */ (() => new Promise(() => {}));
        expect(await enrich(makeWorker({timeoutMs: 5}))).toStrictEqual({audio: failed('anki_note_failed'), translation: failed('anki_note_failed'), speechCode: null});
    });

    test.each([['another one', CORE], ['', ''], ['undefined', void 0]])('the server is not the current one (%s): nothing is sent', async (_name, server) => {
        const worker = makeWorker();
        expect(await enrich(worker, {server})).toStrictEqual({audio: failed('anki_route_switched'), translation: failed('anki_route_switched'), speechCode: null});
        expect([...sent, ...worker.spoken, ...worker.translated]).toStrictEqual([]);
    });

    test.each(/** @type {[server: any][]} */ ([[null], ['']]))('the client has no address (%j)', async (server) => {
        const worker = makeWorker();
        worker.client.server = server;
        expect(await enrich(worker)).toStrictEqual({audio: failed('anki_closed'), translation: failed('anki_closed'), speechCode: null});
        expect([...sent, ...worker.spoken, ...worker.translated]).toStrictEqual([]);
    });

    test('off, also in the middle: an error, not «done»', async () => {
        const off = makeWorker();
        off.client.enabled = false;
        expect(await enrich(off)).toStrictEqual({audio: failed('anki_note_failed'), translation: failed('anki_note_failed'), speechCode: null});
        expect(off.spoken).toStrictEqual([]);
        const middle = makeWorker({translate: () => {
            middle.client.enabled = false;
            return TRANSLATION;
        }});
        expect(await enrich(middle)).toStrictEqual({audio: DONE, translation: failed('anki_note_failed'), speechCode: null});
    });

    test('the route switches at each request: nothing goes to the other Anki, which has a note with this id', async () => {
        for (let at = 0; at < ALL_ACTIONS.length; ++at) {
            servers = {[DIRECT]: new FakeAnki(), [CORE]: new FakeAnki()};
            sent = [];
            const worker = makeWorker();
            answer = ({number}) => {
                if (number === at) { worker.client.server = CORE; }
                return void 0;
            };
            const report = await enrich(worker);
            expect(sent.filter(({server}) => server === CORE)).toStrictEqual([]);
            // The last request was sent before the switch.
            expect([at, report.translation]).toStrictEqual([at, at === ALL_ACTIONS.length - 1 ? DONE : failed('anki_route_switched')]);
            expect(report.audio).toStrictEqual(at < 7 ? failed('anki_route_switched') : DONE);
        }
    });
});

describe('the budget', () => {
    test.each([
        ['the request', hang],
        // The body: the client has no code for its failure.
        ['the sound itself', (/** @type {{signal: AbortSignal}} */ options) => hang(options).catch(() => { throw createFlibError('flib_service_unavailable'); })],
    ])('a hanging speech (%s): the rest is flib_timeout, nothing more is paid', async (_name, hangs) => {
        useFakeTimers();
        const worker = makeWorker({speech: (_text, options) => hangs(options), budgetMs: 300});
        const promise = enrich(worker);
        await until(() => worker.spoken.length > 0);
        await vi.advanceTimersByTimeAsync(300);
        expect(await promise).toStrictEqual({audio: failed('flib_timeout'), translation: failed('flib_timeout'), speechCode: 'flib_timeout'});
        expect(worker.spoken).toStrictEqual([EXPRESSION]);
        expect(worker.translated).toStrictEqual([]);
        expect(actions()).toStrictEqual(['notesInfo']);
    });

    test('the server of speech is unavailable before the end: its own code', async () => {
        const worker = makeWorker({speech: throws('flib_service_unavailable')});
        expect(await enrich(worker)).toStrictEqual({audio: failed('flib_service_unavailable'), translation: DONE, speechCode: 'flib_service_unavailable'});
    });

    test('a clip that Anki did not store after the end is not a timeout', async () => {
        useFakeTimers();
        answer = ({action}) => (action === 'storeMediaFile' ? new Response('"other.mp3"') : void 0);
        const worker = makeWorker({speech: () => sleep(400), budgetMs: 300});
        const promise = enrich(worker);
        await until(() => worker.spoken.length > 0);
        await vi.advanceTimersByTimeAsync(400);
        expect(await promise).toStrictEqual({audio: failed('flib_media_not_stored'), translation: failed('flib_timeout'), speechCode: 'flib_media_not_stored'});
    });

    test('a hanging translation: the audio is done', async () => {
        useFakeTimers();
        const worker = makeWorker({translate: (_text, options) => hang(options), budgetMs: 300});
        const promise = enrich(worker);
        await until(() => worker.translated.length > 0);
        await vi.advanceTimersByTimeAsync(300);
        expect(await promise).toStrictEqual({audio: DONE, translation: failed('flib_timeout'), speechCode: null});
        expect(worker.sentenceCache.write).not.toHaveBeenCalled();
    });

    test('spent by a slow second clip: the clip is kept, the translation is not started', async () => {
        useFakeTimers();
        const worker = makeWorker({speech: (text) => (text === FRONT ? sleep(400) : void 0), budgetMs: 300});
        const promise = enrich(worker);
        await until(() => worker.spoken.length > 1);
        await vi.advanceTimersByTimeAsync(400);
        expect(await promise).toStrictEqual({audio: DONE, translation: failed('flib_timeout'), speechCode: null});
        expect(worker.translated).toStrictEqual([]);
        expect(filled().front).toBe(FRONT_SOUND);
    });

    test('a transient failure after the end is not repeated', async () => {
        useFakeTimers();
        const worker = makeWorker({translate: async () => {
            await sleep(400);
            throw createFlibError('flib_service_unavailable');
        },
        budgetMs: 300});
        const promise = enrich(worker);
        await until(() => worker.translated.length > 0);
        await vi.advanceTimersByTimeAsync(400);
        expect((await promise).translation).toStrictEqual(failed('flib_service_unavailable'));
        expect(worker.translated).toHaveLength(1);
    });

    test('no timer is left', async () => {
        useFakeTimers();
        const worker = makeWorker({keepAlive: () => {}});
        await enrich(worker);
        expect(vi.getTimerCount()).toBe(0);
    });

    test('90 seconds by default', async () => {
        useFakeTimers();
        const worker = makeWorker({speech: (_text, options) => hang(options)});
        const promise = enrich(worker);
        let settled = false;
        void promise.then(() => { settled = true; });
        await until(() => worker.spoken.length > 0);
        await vi.advanceTimersByTimeAsync(89_999);
        expect(settled).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect((await promise).audio).toStrictEqual(failed('flib_timeout'));
    });
});

describe('the worker is kept alive', () => {
    test('during the work, not after', async () => {
        const keepAlive = vi.fn();
        await enrich(makeWorker({keepAlive,
            keepAliveMs: 5,
            translate: async () => {
                await sleep(40);
                return TRANSLATION;
            }}));
        const {length} = keepAlive.mock.calls;
        expect(length).toBeGreaterThan(0);
        await sleep(20);
        expect(keepAlive.mock.calls).toHaveLength(length);
    });

    test('every 20 seconds by default', async () => {
        useFakeTimers();
        const keepAlive = vi.fn();
        const worker = makeWorker({keepAlive, speech: (_text, options) => hang(options)});
        const promise = enrich(worker);
        await until(() => worker.spoken.length > 0);
        await vi.advanceTimersByTimeAsync(40_000);
        expect(keepAlive).toHaveBeenCalledTimes(2);
        await vi.advanceTimersByTimeAsync(50_000);
        await promise;
    });
});

describe('parallel calls', () => {
    test('for the same note: one run, the same report', async () => {
        const worker = makeWorker();
        const [a, b] = await Promise.all([enrich(worker), enrich(worker, {front: null})]);
        expect(b).toBe(a);
        expect(worker.spoken).toStrictEqual([EXPRESSION, FRONT]);
        expect(worker.translated).toHaveLength(1);
        expect(actions()).toStrictEqual(ALL_ACTIONS);
    });

    test('the second call changes nothing of the first, the cache included', async () => {
        const worker = makeWorker();
        const [a, b] = await Promise.all([enrich(worker), enrich(worker, {}, false)]);
        expect(b).toBe(a);
        expect(worker.sentenceCache.read).toHaveBeenCalledTimes(1);
    });

    test('for different notes: each has its own', async () => {
        anki().put(ID + 1);
        const worker = makeWorker();
        await Promise.all([enrich(worker), enrich(worker, {noteId: ID + 1})]);
        expect(anki().note(ID + 1).fields).toMatchObject({Audio_expression: `[sound:tts_phr_exp_${ID + 1}.mp3]`, Audio_front: `[sound:tts_phr_front_${ID + 1}.mp3]`, ExpressionTranslate: TRANSLATION});
        expect(worker.spoken).toHaveLength(4);
    });

    test('for another address: not the run of this one', async () => {
        const worker = makeWorker();
        const [a, b] = await Promise.all([enrich(worker), enrich(worker, {server: CORE})]);
        expect(a.audio).toStrictEqual(DONE);
        expect(b.audio).toStrictEqual(failed('anki_route_switched'));
    });

    test('the next call after the end is a new run', async () => {
        const worker = makeWorker({translate: throws('llm_bad_answer')});
        await enrich(worker);
        await enrich(worker);
        expect(worker.translated).toHaveLength(2);
    });
});

describe('the parameters', () => {
    test.each(/** @type {[change: Record<string, unknown>][]} */ ([
        [{noteId: 0}],
        [{noteId: 1.5}],
        [{noteId: '1000'}],
        [{noteId: void 0}],
        [{expression: ''}],
        [{expression: ' '}],
        [{expression: null}],
        [{expression: ['x']}],
        [{expression: 'x'.repeat(15001)}],
        [{front: ''}],
        [{front: void 0}],
        [{front: 5}],
        [{front: 'x'.repeat(15012)}],
    ]).map(([change]) => [JSON.stringify(change).slice(0, 40), change]))('%s is refused', async (_name, change) => {
        const worker = makeWorker();
        await expect(enrich(worker, change)).rejects.toMatchObject({data: {code: 'flib_bad_request'}});
        expect([...sent, ...worker.spoken, ...worker.translated]).toStrictEqual([]);
    });

    test.each([[void 0], [null], [[]], ['x']])('%j instead of them is refused', async (value) => {
        await expect(makeWorker().enricher.enrich(/** @type {*} */ (value), {cacheAllowed: true})).rejects.toMatchObject({data: {code: 'flib_bad_request'}});
    });
});

describe('the API', () => {
    const KEY = `tpk_${'0'.repeat(32)}`;
    const URL_POPUP = 'chrome-extension://x/popup.html';
    const PAGE = {id: 'x', url: URL_POPUP, tab: {id: 1, incognito: false, url: 'https://example.com/'}};
    const CONTENT = {id: 'x', url: 'https://example.com/', tab: {id: 1, incognito: false}, frameId: 0};

    /**
     * @param {string} [key]
     * @returns {{api: (sender?: object) => API, backend: Backend, cache: Map<string, string>, read: import('vitest').MockInstance, write: import('vitest').MockInstance, keepAlive: import('vitest').Mock}}
     */
    function wire(key = KEY) {
        const keepAlive = vi.fn();
        vi.stubGlobal('chrome', {storage: {local: {}}, runtime: {id: 'x', getURL: (/** @type {string} */ path) => `chrome-extension://x${path}`, getPlatformInfo: keepAlive}, offscreen: {}});
        const backend = new Backend(/** @type {*} */ ({getUrl: (/** @type {string} */ path) => path, sendMessagePromise: async () => {}}));
        backend._anki.enabled = true;
        backend._anki.server = DIRECT;
        vi.spyOn(backend, '_getFlibSecrets').mockResolvedValue({personalKey: key, gatewayUrl: ''});
        /** @type {Map<string, string>} */
        const cache = new Map();
        const read = vi.spyOn(backend, '_readFlibSentenceCache').mockImplementation(async (name) => cache.get(name) ?? null);
        const write = vi.spyOn(backend, '_writeFlibSentenceCache').mockImplementation(async (name, value) => { cache.set(name, value); });
        const api = (/** @type {object} */ sender = PAGE) => new API(/** @type {*} */ ({
            sendMessage: (/** @type {import('api').ApiMessageAny} */ message, /** @type {(response: unknown) => void} */ callback) => {
                if (!backend._onMessage(message, /** @type {*} */ (sender), callback)) { callback(void 0); }
            },
            getLastError: () => null,
        }));
        return {api, backend, cache, read, write, keepAlive};
    }

    test('API → a real Backend → AnkiConnect and the gateway client', async () => {
        const {api, cache, backend} = wire();
        expect(await api().flibPhraseEnrich(params())).toStrictEqual({audio: DONE, translation: DONE, speechCode: null});
        expect(filled()).toStrictEqual({expression: EXPRESSION_SOUND, front: FRONT_SOUND, translation: TRANSLATION});
        expect(anki().media.get(EXPRESSION_FILE)).toBe(btoa('mp3'));
        expect(gatewaySent.map(({path}) => path.replace(/\/[^/]+$/, ''))).toStrictEqual(['/v1/text-to-speech', '/v1/text-to-speech', '/v1/openai/chat']);
        expect(gatewaySent.slice(0, 2).map(({body: {text}}) => text)).toStrictEqual([EXPRESSION, FRONT]);
        expect(gatewaySent[2].body.messages[1].content).toBe(`#DATA ${JSON.stringify({s: EXPRESSION})}`);
        expect([...cache]).toStrictEqual([[EXPRESSION, TRANSLATION]]);
        // One enricher per worker.
        expect(backend._getFlibPhraseEnricher()).toBe(backend._getFlibPhraseEnricher());
    });

    test.each(/** @type {[name: string, key: string, code: string][]} */ ([
        ['no key', '', 'flib_key_missing'],
        ['a bad key', 'nonsense', 'flib_key_invalid'],
    ]))('%s: both steps are skipped with the code, no requests', async (_name, key, code) => {
        const {api, read} = wire(key);
        const skipped = {status: 'skipped', code};
        expect(await api().flibPhraseEnrich(params())).toStrictEqual({audio: skipped, translation: skipped, speechCode: null});
        expect([...sent, ...gatewaySent]).toStrictEqual([]);
        expect(read).not.toHaveBeenCalled();
    });

    test.each(/** @type {[name: string, sender: object, useCache: unknown, allowed: boolean][]} */ ([
        ['a popup on a page', PAGE, true, true],
        ['the page forbids it', PAGE, false, false],
        ['not a boolean', PAGE, 1, false],
        ['incognito', {...PAGE, tab: {...PAGE.tab, incognito: true}}, true, false],
        ['an extension tab', {id: 'x', url: 'chrome-extension://x/search.html', tab: {id: 1, incognito: false, url: 'chrome-extension://x/search.html'}}, true, false],
        ['no tab', {id: 'x', url: URL_POPUP}, true, false],
    ]))('the cache: %s', async (_name, sender, useCache, allowed) => {
        const {api, cache, read, write} = wire();
        cache.set(EXPRESSION, 'Из кеша');
        expect((await api(sender).flibPhraseEnrich(params({useCache}))).translation).toStrictEqual(DONE);
        expect(filled().translation).toBe(allowed ? 'Из кеша' : TRANSLATION);
        expect(read).toHaveBeenCalledTimes(allowed ? 1 : 0);
        expect(write).not.toHaveBeenCalled();
    });

    test.each([
        ['a content script', CONTENT],
        ['another extension', {id: 'y', url: PAGE.url}],
        ['nobody', {}],
    ])('%s is refused', async (_name, sender) => {
        const {api} = wire();
        await expect(api(sender).flibPhraseEnrich(params())).rejects.toMatchObject({message: 'flib_secret_forbidden'});
        expect([...sent, ...gatewaySent]).toStrictEqual([]);
    });

    test('without parameters', async () => {
        const {backend} = wire();
        /** @type {any} */
        const response = await new Promise((resolve) => { backend._onMessage(/** @type {*} */ ({action: 'flibPhraseEnrich'}), /** @type {*} */ (PAGE), resolve); });
        expect(response.error.data.code).toBe('flib_bad_request');
    });

    test('the type is looked at again after a failure in Anki, not after another one', async () => {
        const {api, backend} = wire();
        const forget = vi.spyOn(backend._getFlibPhraseModelPreparer(), 'forget');
        const translate = vi.spyOn(backend._flibGateway, 'translateSentence').mockRejectedValue(createFlibError('llm_quota_exhausted'));
        await api().flibPhraseEnrich(params());
        translate.mockRestore();
        await api().flibPhraseEnrich(params());
        expect(forget).not.toHaveBeenCalled();
        anki().notes.delete(ID);
        expect((await api().flibPhraseEnrich(params())).audio).toStrictEqual(failed('anki_note_gone'));
        expect(forget).toHaveBeenCalledTimes(1);
    });

    test('the worker is kept alive by a call of the extension API', async () => {
        const {api, backend, keepAlive} = wire();
        backend._getFlibPhraseEnricher()._keepAliveMs = 2;
        vi.spyOn(backend._flibGateway, 'translateSentence').mockImplementation(async () => {
            await sleep(20);
            return {translation: TRANSLATION};
        });
        await api().flibPhraseEnrich(params());
        expect(keepAlive).toHaveBeenCalled();
    });

    test('a worker that has just started waits for the address, it is not a switch', async () => {
        const {api, backend} = wire();
        backend._anki.server = CORE;
        vi.spyOn(backend, '_maybeBootstrapVideoExamplesField').mockResolvedValue(void 0);
        const resolver = backend._ankiRouteResolver;
        resolver._fetch = async (input) => {
            await sleep(5);
            if (/** @type {string} */ (input).startsWith(CORE)) { throw new TypeError('Failed to fetch'); }
            return new Response('{"result":6,"error":null}');
        };
        resolver.configure({primary: CORE, apiKey: null, enabled: true});
        void backend._refreshAnkiRoute(true);
        expect((await api().flibPhraseEnrich(params())).audio).toStrictEqual(DONE);
        expect([...new Set(sent.map(({server}) => server))]).toStrictEqual([DIRECT]);
    });
});
/* eslint-enable no-underscore-dangle, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment */
