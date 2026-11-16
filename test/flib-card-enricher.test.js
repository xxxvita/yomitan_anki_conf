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

/* eslint-disable jsdoc/require-returns */
import {readFileSync} from 'node:fs';
import {describe, expect, test, vi} from 'vitest';
import {FlibCardEnricher} from '../ext/js/background/flib-card-enricher.js';
import {ExtensionError} from '../ext/js/core/extension-error.js';
import {parseJson} from '../ext/js/core/json.js';

/**
 * @param {string} code
 * @returns {ExtensionError}
 */
function flibError(code) {
    const error = new ExtensionError(code);
    error.data = {code, status: null};
    return error;
}

const ENRICH_ANSWER = JSON.stringify({tr: 'жить', pos: 'verb', items: [{h: 'I <b>live</b> here', t: 'Я живу здесь', c: 'место'}], syn: ['reside,verb,проживать'], eu: '', eut: '', tc: 'Они живут'});
const PHRASES_ANSWER = JSON.stringify({sentence: 'They live in a flat.', translation: 'Они живут в квартире.', phrase_or_idiom: null, target_form: 'live'});

/**
 * In-memory Anki: notes with fields and tags, media, decks, models.
 * @param {{word?: string, model?: string, fields?: Record<string, string>}} [base]
 */
function makeAnki(base = {}) {
    const {word = 'live', model = 'Yomitan Card Type', fields = {}} = base;
    /** @type {Map<number, {modelName: string, deckName: string, fields: Record<string, string>, tags: string[]}>} */
    const notes = new Map();
    notes.set(100, {modelName: model, deckName: 'Default', fields: {Word: word, Example: 'They live here.', Translate: '', Audio: '', ExampleLLM: '', Audio_Translate: '', ...fields}, tags: ['flib_enriched']});
    /** @type {Map<string, string>} */
    const media = new Map();
    let nextId = 200;
    return {
        notes,
        media,
        getModelNames: vi.fn(async () => ['Yomitan Card Type', 'ReverseDeck', 'Phrases']),
        getModelFieldNames: vi.fn(async (/** @type {string} */ name) => ({'Yomitan Card Type': ['Word', 'Example', 'Translate', 'Audio', 'ExampleLLM', 'Audio_Translate'], 'ReverseDeck': ['Front', 'Back', 'ExampleLLM', 'EnglishWords', 'Audio', 'data'], 'Phrases': ['Front', 'Expression', 'EnglishWord', 'ExpressionTranslate', 'Audio_front', 'Audio_expression']})[name] ?? []),
        modelFieldAdd: vi.fn(async () => {}),
        createModel: vi.fn(async () => {}),
        createDeck: vi.fn(async () => 1),
        notesInfo: vi.fn(async (/** @type {number[]} */ ids) => ids.map((id) => {
            const note = notes.get(id);
            return typeof note === 'undefined' ? {} : {noteId: id, modelName: note.modelName, tags: [...note.tags], fields: Object.fromEntries(Object.entries(note.fields).map(([k, v]) => [k, {value: v, order: 0}])), cards: [id + 1]};
        })),
        findCards: vi.fn(async (/** @type {string} */ query) => {
            const id = Number(/nid:(\d+)/.exec(query)?.[1]);
            return notes.has(id) ? [id + 1] : [];
        }),
        cardsInfo: vi.fn(async (/** @type {number[]} */ ids) => ids.map((cardId) => ({cardId, deckName: notes.get(cardId - 1)?.deckName ?? ''}))),
        findNotes: vi.fn(async (/** @type {string} */ query) => {
            const tag = /tag:(\S+?)"?$/.exec(query.replaceAll('"', ''))?.[1] ?? '';
            return [...notes.entries()].filter(([, n]) => n.tags.includes(tag)).map(([id]) => id);
        }),
        addNote: vi.fn(async (/** @type {{deckName: string, modelName: string, fields: Record<string, string>, tags: string[]}} */ note) => {
            const id = nextId++;
            notes.set(id, {modelName: note.modelName, deckName: note.deckName, fields: {...note.fields}, tags: [...note.tags]});
            return id;
        }),
        updateNoteFields: vi.fn(async (/** @type {{id: number, fields: Record<string, string>}} */ {id, fields: update}) => {
            const note = notes.get(id);
            if (typeof note === 'undefined') { throw new Error('note was not found'); }
            Object.assign(note.fields, update);
            return null;
        }),
        storeMediaFile: vi.fn(async (/** @type {string} */ name, /** @type {string} */ data) => { media.set(name, data); return name; }),
        removeTags: vi.fn(async () => {}),
    };
}

/**
 * @param {{enrich?: () => Promise<string>, phrases?: () => Promise<string>, findForm?: () => Promise<string>, speech?: (text: string) => Promise<{base64: string, cached: boolean}>}} [overrides]
 */
function makeGateway(overrides = {}) {
    /** @type {string[]} */
    const spoken = [];
    return {
        spoken,
        chatJson: vi.fn(async (/** @type {{messages: {content: string}[]}} */ body) => {
            const system = body.messages[0].content;
            if (system.startsWith('Role: EN→RU')) { return await (overrides.enrich ?? (async () => ENRICH_ANSWER))(); }
            if (system.startsWith('Ты — генератор')) { return await (overrides.phrases ?? (async () => PHRASES_ANSWER))(); }
            return await (overrides.findForm ?? (async () => '{"form": ""}'))();
        }),
        synthesizeSpeech: vi.fn(async (/** @type {string} */ text) => {
            spoken.push(text);
            return await (overrides.speech ?? (async () => ({base64: 'QUJD', cached: false})))(text);
        }),
    };
}

/** @type {import('../ext/js/data/flib-enrich.js').FlibEnrichPrompts} */
const PROMPTS = parseJson(readFileSync(new URL('../ext/data/flib-enrich-prompts.json', import.meta.url), 'utf8'));
const MODELS = async () => ({source: 'test', models: [{name: 'ReverseDeck', fields: ['Front'], css: '', isCloze: false, cardTemplates: []}]});

/**
 * @param {ReturnType<typeof makeAnki>} anki
 * @param {ReturnType<typeof makeGateway>} gateway
 * @param {number} [budgetMs]
 * @returns {FlibCardEnricher}
 */
function makeEnricher(anki, gateway, budgetMs = 90_000) {
    return new FlibCardEnricher({anki: /** @type {*} */ (anki), gateway: /** @type {*} */ (gateway), loadModels: MODELS, loadPrompts: async () => PROMPTS, budgetMs, retryDelayMs: 0});
}

/**
 * @param {ReturnType<typeof makeAnki>} anki
 * @param {string} model
 */
function derived(anki, model) {
    return [...anki.notes.entries()].filter(([, n]) => n.modelName === model);
}

describe('FlibCardEnricher', () => {
    test('all steps done: base fields, ReverseDeck, Phrases, tags, audio', async () => {
        const anki = makeAnki();
        const gateway = makeGateway();
        const report = await makeEnricher(anki, gateway).enrich({noteId: 100, userTags: ['news']});
        expect(report).toStrictEqual({enrich: {status: 'done'}, audio: {status: 'done'}, reverse: {status: 'done'}, phrases: {status: 'done'}, speechCode: null});

        const base = /** @type {{fields: Record<string, string>}} */ (anki.notes.get(100));
        expect(parseJson(base.fields.ExampleLLM)).toMatchObject({tr: 'жить', pos: 'verb'});
        expect(base.fields.Translate).toBe('жить');
        expect(base.fields.Audio).toBe('[sound:tts_live_100.mp3]');

        const [[reverseId, reverse]] = derived(anki, 'ReverseDeck');
        expect(reverse.deckName).toBe('Default');
        expect(reverse.tags).toStrictEqual(['100_reverse', 'flib_enriched', 'news']);
        expect(reverse.fields).toMatchObject({Front: 'жить', Back: '', EnglishWords: 'live<br>reside', Audio: `[sound:tts_rev_${reverseId}.mp3]`});
        expect(parseJson(reverse.fields.data)).toMatchObject({front: 'жить', englishWords: [{word: 'live', partOfSpeech: 'verb', synonyms: ['reside'], audio: [{selected: true, file: 'tts_live_100.mp3'}]}]});
        expect(base.fields.Audio_Translate).toBe(`[sound:tts_rev_${reverseId}.mp3]`);

        const [[phrasesId, phrases]] = derived(anki, 'Phrases');
        expect(phrases.tags).toStrictEqual(['100_phrases', 'flib_enriched', 'news']);
        expect(phrases.fields).toMatchObject({Front: 'They _____ in a flat.', Expression: 'They live in a flat.', EnglishWord: 'live', ExpressionTranslate: 'Они живут в квартире.', Audio_expression: `[sound:tts_phr_exp_${phrasesId}.mp3]`, Audio_front: `[sound:tts_phr_front_${phrasesId}.mp3]`});
        expect(gateway.spoken).toStrictEqual(['live', 'жить', 'They live in a flat.', 'They ... ... ... in a flat.']);
    });

    test('both cards off: base enriched, no derived notes, one chat call', async () => {
        const anki = makeAnki();
        const gateway = makeGateway();
        const report = await makeEnricher(anki, gateway).enrich({noteId: 100, userTags: [], cards: {reverse: false, phrases: false}});
        expect(report).toStrictEqual({enrich: {status: 'done'}, audio: {status: 'done'}, reverse: {status: 'skipped'}, phrases: {status: 'skipped'}, speechCode: null});
        expect(derived(anki, 'ReverseDeck')).toHaveLength(0);
        expect(derived(anki, 'Phrases')).toHaveLength(0);
        expect(gateway.chatJson).toHaveBeenCalledTimes(1);
        const queries = anki.findNotes.mock.calls.map((call) => String(call[0]));
        expect(queries.some((query) => query.includes('_reverse') || query.includes('_phrases'))).toBe(false);
        expect(anki.removeTags).not.toHaveBeenCalled();
    });

    test('both cards off and the budget is spent: they stay skipped, never failed', async () => {
        const anki = makeAnki();
        const gateway = makeGateway({enrich: async () => {
            await new Promise((resolve) => { setTimeout(resolve, 30); });
            return ENRICH_ANSWER;
        }});
        const report = await makeEnricher(anki, gateway, 10).enrich({noteId: 100, userTags: [], cards: {reverse: false, phrases: false}});
        expect(report.reverse).toStrictEqual({status: 'skipped'});
        expect(report.phrases).toStrictEqual({status: 'skipped'});
    });

    test('both cards off and Anki fails: disabled cards stay skipped, base steps fail, tag is released', async () => {
        const anki = makeAnki();
        anki.notesInfo.mockRejectedValueOnce(new ExtensionError('Anki error: busy'));
        const report = await makeEnricher(anki, makeGateway()).enrich({noteId: 100, userTags: [], cards: {reverse: false, phrases: false}});
        expect(report.enrich).toStrictEqual({status: 'failed', code: 'anki_failed'});
        expect(report.audio).toStrictEqual({status: 'failed', code: 'anki_failed'});
        expect(report.reverse).toStrictEqual({status: 'skipped'});
        expect(report.phrases).toStrictEqual({status: 'skipped'});
        expect(anki.removeTags).toHaveBeenCalledWith([100], ['flib_enriched']);
    });

    test('reverse off only: Phrases created, no reverse link, no Audio_Translate', async () => {
        const anki = makeAnki();
        const report = await makeEnricher(anki, makeGateway()).enrich({noteId: 100, userTags: [], cards: {reverse: false}});
        expect(report.reverse).toStrictEqual({status: 'skipped'});
        expect(report.phrases).toStrictEqual({status: 'done'});
        expect(derived(anki, 'ReverseDeck')).toHaveLength(0);
        expect(derived(anki, 'Phrases')).toHaveLength(1);
        expect(anki.notes.get(100)?.fields.Audio_Translate).toBe('');
    });

    test('phrases off only: ReverseDeck created, no phrases/find_form chat call', async () => {
        const anki = makeAnki();
        const gateway = makeGateway();
        const report = await makeEnricher(anki, gateway).enrich({noteId: 100, userTags: [], cards: {phrases: false}});
        expect(report.reverse).toStrictEqual({status: 'done'});
        expect(report.phrases).toStrictEqual({status: 'skipped'});
        expect(derived(anki, 'ReverseDeck')).toHaveLength(1);
        expect(derived(anki, 'Phrases')).toHaveLength(0);
        expect(gateway.chatJson).toHaveBeenCalledTimes(1);
    });

    test('enrichment quota: other steps still run, reverse uses the existing translation', async () => {
        const anki = makeAnki({fields: {Translate: 'жизнь'}});
        const quota = async () => { throw flibError('llm_quota_exhausted'); };
        const gateway = makeGateway({enrich: quota, phrases: quota});
        const report = await makeEnricher(anki, gateway).enrich({noteId: 100, userTags: []});
        expect(report.enrich).toStrictEqual({status: 'failed', code: 'llm_quota_exhausted'});
        expect(report.phrases).toStrictEqual({status: 'failed', code: 'llm_quota_exhausted'});
        expect(report.audio.status).toBe('done');
        expect(report.reverse.status).toBe('done');
        expect(derived(anki, 'ReverseDeck')[0][1].fields.Front).toBe('жизнь');
    });

    test('no translation anywhere → reverse skipped', async () => {
        const anki = makeAnki();
        const gateway = makeGateway({enrich: async () => { throw flibError('llm_bad_answer'); }});
        const report = await makeEnricher(anki, gateway).enrich({noteId: 100, userTags: []});
        expect(report.reverse).toStrictEqual({status: 'skipped'});
        expect(derived(anki, 'ReverseDeck')).toHaveLength(0);
    });

    test('tts quota once: later clips still tried, notes still created', async () => {
        const anki = makeAnki();
        const gateway = makeGateway({speech: async (text) => {
            if (text === 'live') { throw flibError('tts_quota_exhausted'); }
            return {base64: 'QUJD', cached: true};
        }});
        const report = await makeEnricher(anki, gateway).enrich({noteId: 100, userTags: []});
        expect(report.audio).toStrictEqual({status: 'failed', code: 'tts_quota_exhausted'});
        expect(report.speechCode).toBe('tts_quota_exhausted');
        expect(report.reverse.status).toBe('done');
        expect(report.phrases.status).toBe('done');
        expect(gateway.spoken).toHaveLength(4);
    });

    test('anki error in the middle: phrases still created', async () => {
        const anki = makeAnki();
        const gateway = makeGateway();
        const original = anki.addNote.getMockImplementation();
        anki.addNote.mockImplementationOnce(async () => { throw new ExtensionError('Anki error: collection is busy'); });
        anki.addNote.mockImplementation(/** @type {*} */ (original));
        const report = await makeEnricher(anki, gateway).enrich({noteId: 100, userTags: []});
        expect(report.reverse).toStrictEqual({status: 'failed', code: 'anki_failed'});
        expect(report.phrases.status).toBe('done');
    });

    test('phrases bad answer → failed, nothing created', async () => {
        const anki = makeAnki();
        const report = await makeEnricher(anki, makeGateway({phrases: async () => 'no json'})).enrich({noteId: 100, userTags: []});
        expect(report.phrases).toStrictEqual({status: 'failed', code: 'llm_bad_answer'});
        expect(derived(anki, 'Phrases')).toHaveLength(0);
    });

    test('find_form fallback blanks an irregular form; failing that the sentence stays whole', async () => {
        const anki = makeAnki({word: 'go'});
        const gateway = makeGateway({
            phrases: async () => JSON.stringify({sentence: 'They went home.', translation: 'Они ушли домой.', phrase_or_idiom: null, target_form: ''}),
            findForm: async () => '{"form": "went"}',
        });
        await makeEnricher(anki, gateway).enrich({noteId: 100, userTags: []});
        expect(derived(anki, 'Phrases')[0][1].fields.Front).toBe('They _____ home.');
    });

    test('second call for the same note creates nothing (sequential)', async () => {
        const anki = makeAnki();
        const gateway = makeGateway();
        const enricher = makeEnricher(anki, gateway);
        await enricher.enrich({noteId: 100, userTags: []});
        const calls = gateway.chatJson.mock.calls.length;
        const report = await enricher.enrich({noteId: 100, userTags: []});
        expect(report).toStrictEqual({enrich: {status: 'skipped'}, audio: {status: 'skipped'}, reverse: {status: 'skipped'}, phrases: {status: 'skipped'}, speechCode: null});
        expect(derived(anki, 'ReverseDeck')).toHaveLength(1);
        expect(derived(anki, 'Phrases')).toHaveLength(1);
        expect(gateway.chatJson.mock.calls.length).toBe(calls);
    });

    test('second call for the same note creates nothing (parallel)', async () => {
        const anki = makeAnki();
        const enricher = makeEnricher(anki, makeGateway());
        const [a, b] = await Promise.all([enricher.enrich({noteId: 100, userTags: []}), enricher.enrich({noteId: 100, userTags: []})]);
        expect(a).toStrictEqual(b);
        expect(derived(anki, 'ReverseDeck')).toHaveLength(1);
        expect(derived(anki, 'Phrases')).toHaveLength(1);
    });

    test('not Yomitan Card Type → everything skipped, no gateway call', async () => {
        const anki = makeAnki({model: 'Basic'});
        const gateway = makeGateway();
        const report = await makeEnricher(anki, gateway).enrich({noteId: 100, userTags: []});
        expect(report.enrich.status).toBe('skipped');
        expect(gateway.chatJson).not.toHaveBeenCalled();
        expect(gateway.synthesizeSpeech).not.toHaveBeenCalled();
    });

    test('existing native audio → audio skipped and kept', async () => {
        const anki = makeAnki({fields: {Audio: '[sound:native.mp3]'}});
        const report = await makeEnricher(anki, makeGateway()).enrich({noteId: 100, userTags: []});
        expect(report.audio).toStrictEqual({status: 'skipped'});
        expect(anki.notes.get(100)?.fields.Audio).toBe('[sound:native.mp3]');
    });

    test('budget exceeded → remaining steps failed flib_timeout', async () => {
        const anki = makeAnki();
        const gateway = makeGateway({enrich: () => new Promise((resolve) => { setTimeout(() => resolve(ENRICH_ANSWER), 50); })});
        const report = await makeEnricher(anki, gateway, 10).enrich({noteId: 100, userTags: []});
        expect(report.phrases).toStrictEqual({status: 'failed', code: 'flib_timeout'});
    });

    test('model setup failure → derived notes failed with its code, base still enriched', async () => {
        const anki = makeAnki();
        anki.getModelNames.mockResolvedValueOnce([]);
        anki.createModel.mockRejectedValue(new ExtensionError('Anki error: disk full'));
        const report = await makeEnricher(anki, makeGateway()).enrich({noteId: 100, userTags: []});
        expect(report.enrich.status).toBe('done');
        expect(report.reverse).toStrictEqual({status: 'failed', code: 'anki_model_failed'});
        expect(report.phrases).toStrictEqual({status: 'failed', code: 'anki_model_failed'});
    });

    test('a transient gateway failure is retried once', async () => {
        const anki = makeAnki();
        let calls = 0;
        const gateway = makeGateway({enrich: async () => {
            calls += 1;
            if (calls === 1) { throw flibError('flib_service_unavailable'); }
            return ENRICH_ANSWER;
        }});
        expect((await makeEnricher(anki, gateway).enrich({noteId: 100, userTags: []})).enrich.status).toBe('done');
        expect(calls).toBe(2);
    });

    test('nothing happened at all → the flib_enriched tag is removed so Flibooster can enrich', async () => {
        const anki = makeAnki();
        anki.notesInfo.mockRejectedValueOnce(new ExtensionError('Anki error: busy'));
        const report = await makeEnricher(anki, makeGateway()).enrich({noteId: 100, userTags: []});
        expect(report.enrich).toStrictEqual({status: 'failed', code: 'anki_failed'});
        expect(anki.removeTags).toHaveBeenCalledWith([100], ['flib_enriched']);
    });

    test('a partial success keeps the tag', async () => {
        const anki = makeAnki();
        const quota = async () => { throw flibError('llm_quota_exhausted'); };
        await makeEnricher(anki, makeGateway({enrich: quota, phrases: quota})).enrich({noteId: 100, userTags: []});
        expect(anki.removeTags).not.toHaveBeenCalled();
    });

    test('ensureSetup: success is cached, a failure is retried only after the cooldown', async () => {
        const anki = makeAnki();
        let now = 1000;
        const enricher = new FlibCardEnricher({anki: /** @type {*} */ (anki), gateway: /** @type {*} */ (makeGateway()), loadModels: MODELS, loadPrompts: async () => PROMPTS, now: () => now});
        anki.getModelNames.mockRejectedValueOnce(new Error('Anki is not running'));
        expect(await enricher.ensureSetup()).toBe('anki_model_failed');
        now += 10_000;
        expect(await enricher.ensureSetup()).toBe('anki_model_failed');
        expect(anki.getModelNames).toHaveBeenCalledTimes(1);
        now += 30_000;
        expect(await enricher.ensureSetup()).toBeNull();
        expect(await enricher.ensureSetup()).toBeNull();
        expect(anki.getModelNames).toHaveBeenCalledTimes(2);
    });

    test('ensureSetup is single-flight: concurrent calls share one installation (I2)', async () => {
        const anki = makeAnki();
        const enricher = makeEnricher(anki, makeGateway());
        await Promise.all([enricher.ensureSetup(), enricher.ensureSetup(), enricher.ensureSetup()]);
        expect(anki.getModelNames).toHaveBeenCalledTimes(1);
    });

    test('a stale setup failure is retried once by enrich, not served from the cooldown (I2)', async () => {
        const anki = makeAnki();
        const enricher = makeEnricher(anki, makeGateway());
        anki.getModelNames.mockRejectedValueOnce(new Error('Anki is not running'));
        expect(await enricher.ensureSetup()).toBe('anki_model_failed');
        const report = await enricher.enrich({noteId: 100, userTags: []});
        expect(report.reverse.status).toBe('done');
        expect(report.phrases.status).toBe('done');
    });

    test('setup runs once per Anki server: a remembered server is not installed again (I3)', async () => {
        const anki = makeAnki();
        const store = {has: vi.fn(async () => true), remember: vi.fn(async () => {})};
        const enricher = new FlibCardEnricher({anki: /** @type {*} */ (anki), gateway: /** @type {*} */ (makeGateway()), loadModels: MODELS, loadPrompts: async () => PROMPTS, setupStore: store});
        expect(await enricher.ensureSetup()).toBeNull();
        expect(anki.getModelNames).not.toHaveBeenCalled();
    });

    test('a successful setup is remembered for the server (I3)', async () => {
        const anki = makeAnki();
        const store = {has: vi.fn(async () => false), remember: vi.fn(async () => {})};
        const enricher = new FlibCardEnricher({anki: /** @type {*} */ (anki), gateway: /** @type {*} */ (makeGateway()), loadModels: MODELS, loadPrompts: async () => PROMPTS, setupStore: store});
        await enricher.ensureSetup();
        expect(store.remember).toHaveBeenCalledTimes(1);
    });

    test('nothing done and nothing there before → tag removed even when steps were skipped (I4)', async () => {
        const anki = makeAnki({fields: {Audio: '[sound:native.mp3]'}});
        const down = async () => { throw flibError('flib_service_unavailable'); };
        const report = await makeEnricher(anki, makeGateway({enrich: down, phrases: down})).enrich({noteId: 100, userTags: []});
        expect(report.reverse.status).toBe('skipped');
        expect(anki.removeTags).toHaveBeenCalledWith([100], ['flib_enriched']);
    });

    test('an already enriched note keeps its tag on a repeat call (I4)', async () => {
        const anki = makeAnki();
        const enricher = makeEnricher(anki, makeGateway());
        await enricher.enrich({noteId: 100, userTags: []});
        await enricher.enrich({noteId: 100, userTags: []});
        expect(anki.removeTags).not.toHaveBeenCalled();
    });

    test('a client-side timeout is not retried: the gateway may have charged it (I5)', async () => {
        const anki = makeAnki();
        let calls = 0;
        const timeout = async () => {
            calls += 1;
            throw flibError('flib_timeout');
        };
        const gateway = makeGateway({enrich: timeout});
        await makeEnricher(anki, gateway).enrich({noteId: 100, userTags: []});
        expect(calls).toBe(1);
    });

    test('chat requests get the long timeout like Flibooster (I5)', async () => {
        const anki = makeAnki();
        const gateway = makeGateway();
        await makeEnricher(anki, gateway).enrich({noteId: 100, userTags: []});
        expect(gateway.chatJson.mock.calls[0][1]).toMatchObject({timeoutMs: 60_000});
    });

    test('reverse audio is spoken from the plain translation, not escaped html (M4)', async () => {
        const anki = makeAnki();
        const gateway = makeGateway({enrich: async () => JSON.stringify({tr: 'не "так"', items: []})});
        await makeEnricher(anki, gateway).enrich({noteId: 100, userTags: []});
        expect(gateway.spoken).toContain('не "так"');
    });

    test('the worker is kept alive while enriching (M2)', async () => {
        const anki = makeAnki();
        const keepAlive = vi.fn();
        const slow = () => new Promise((resolve) => { setTimeout(() => resolve(ENRICH_ANSWER), 30); });
        const enricher = new FlibCardEnricher({anki: /** @type {*} */ (anki), gateway: /** @type {*} */ (makeGateway({enrich: /** @type {*} */ (slow)})), loadModels: MODELS, loadPrompts: async () => PROMPTS, keepAlive, keepAliveMs: 5});
        await enricher.enrich({noteId: 100, userTags: []});
        expect(keepAlive).toHaveBeenCalled();
    });
});

/* eslint-enable jsdoc/require-returns */
