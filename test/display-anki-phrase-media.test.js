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

/* eslint-disable no-underscore-dangle, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */

import {afterAll, afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {log} from '../ext/js/core/log.js';
import {ClipTranscodeError, flibMediaFileName} from '../ext/js/display/clip-transcode-util.js';
import {getUiLanguage, setUiLanguage, translate} from '../ext/js/i18n/ui-language.js';
import {setupDomTest} from './fixtures/dom-test.js';
import {codeError, defer, format, makeRig, SERVER, settle} from './fixtures/phrase-window-rig.js';

const {window, teardown} = await setupDomTest();
afterAll(() => teardown(global));
// jsdom has no media pipeline; keep its "Not implemented" noise out of the log.
window.HTMLMediaElement.prototype.pause = () => {};
window.HTMLMediaElement.prototype.load = () => {};

const OTHER_SERVER = 'http://127.0.0.1:8777';
const REVISION = '38b6cd5861e4785f';
const NOTICE_KEY = `flibPhrasesCustomisedNotice:${SERVER}`;
const WEBM = new Uint8Array([0x1a, 0x45, 0xdf, 0xa3, 9, 9]);
const WEBM_BASE64 = 'GkXfowkJ';
const WEBM_NAME = await flibMediaFileName(WEBM);
const REFS = ['dQw4w9WgXcQ', 'aaaaaaaaaa1'];

/** Everything that a save with videos may ask of the background. */
const SAVE_CALLS = new Set(['flibPhrasePrepare', 'flibPhraseFind', 'flibAnkiModelHasField', 'flibStoreAnkiMedia', 'flibPhraseAdd', 'flibPhraseUpdateMedia', 'addAnkiNote', 'updateAnkiNote']);
/** @type {Record<string, string>} */
const SHORT = {flibPhrasePrepare: 'prepare', flibPhraseFind: 'find', flibAnkiModelHasField: 'hasField', flibStoreAnkiMedia: 'store', flibPhraseAdd: 'add', flibPhraseUpdateMedia: 'update'};

const CARD = {
    Front: 'I love it',
    Expression: 'I love it',
    EnglishWord: 'I love it',
    ExpressionTranslate: '',
    Audio_front: '',
    Audio_expression: '',
};
const TAGS = ['flib_phrase', 'webpage_bbc_com', 'flib_enriched'];

/** @type {import('flib-gateway').ExamplesBatchItem[]} */
const YOUTUBE_ITEMS = REFS.map((ref, i) => (
    {source: 'youtube', ref, start_ms: 4200 + i, end_ms: 6900 + i, text_en: 'You know I love it', text_ru: null, thumbnail_url: null, title: null, channel: null, fragment: null, known_share: null}
));

/**
 * Until it is so: the hashes of the files are made outside the event loop, where no timer can be advanced.
 * @param {() => boolean} condition
 */
async function until(condition) {
    const start = Date.now();
    while (!condition() && Date.now() - start < 4000) {
        await new Promise((resolve) => { setImmediate(resolve); });
    }
    expect(condition()).toBe(true);
}

/** @type {Map<string, unknown>} */
const storage = new Map();

/** @typedef {'none'|'youtube'|'film'|'both'} Ticked */

/**
 * @param {HTMLInputElement} checkbox
 */
function toggle(checkbox) {
    checkbox.checked = !checkbox.checked;
    checkbox.dispatchEvent(new window.Event('change'));
}

// eslint-disable-next-line jsdoc/require-returns -- the inferred shape is what the tests use
/**
 * The phrase window with the real examples panel under it, mounted as a press on «Примеры» mounts it.
 * A ticked film is added to what the real panel captures: jsdom loads no video.
 * @param {{ticked?: Ticked, notes?: number[], transcode?: () => Promise<Uint8Array>, details?: Parameters<typeof makeRig>[0]}} [options]
 */
async function openMediaRig({ticked = 'youtube', notes = [], transcode = async () => WEBM, details} = {}) {
    const rig = makeRig(details);
    /** @type {[noteId: number, html: string][]} */
    const updated = [];
    const transcoder = vi.fn(transcode);
    const state = {videoHidden: false, revision: REVISION};
    Object.assign(rig.answers, {
        flibPhrasePrepare: () => ({server: rig.state.server, videoHidden: state.videoHidden, modelRevision: state.revision}),
        flibAnkiModelHasField: () => true,
        flibStoreAnkiMedia: (/** @type {string} */ fileName) => ({fileName}),
        flibPhraseUpdateMedia: (/** @type {{noteId: number, html: string}} */ {noteId, html}) => {
            updated.push([noteId, html]);
            return {};
        },
    });
    rig.anki._flibMediaDeps = {
        probeEncoderSupport: async () => ({vp9Supported: true, vp8Supported: true, opusSupported: true}),
        transcodeClipToWebm: transcoder,
    };
    rig.anki._gatewayExamplesLoader = /** @type {any} */ ({
        loadBatch: async () => ({items: YOUTUBE_ITEMS, emptyReason: null, knownSource: null, partial: false}),
        loadFilms: async () => ({clips: [], emptyReason: null}),
    });
    for (const id of notes) { rig.notes.push({id, deckName: 'My deck', front: 'I love it', englishWord: 'I love it'}); }
    rig.open('I love it');
    await settle();

    /**
     * @param {boolean} film
     * @returns {Promise<import('../ext/js/display/gateway-examples-panel.js').GatewayExamplesPanel>}
     */
    const mount = async (film) => {
        const entry = rig.ui.entry();
        rig.anki._mountGatewayExamplesPanel(entry, 'I love it', 'phrase', -1, {target: {text: 'I love it', mode: 'quote'}, initialRank: 'plain'});
        const panel = /** @type {import('../ext/js/display/gateway-examples-panel.js').GatewayExamplesPanel} */ (rig.anki._videoExamplesPanels.get(entry));
        await panel.whenIdle();
        if (film) {
            const capture = panel.getSelectedGatewayMedia.bind(panel);
            panel.getSelectedGatewayMedia = (options) => ({
                ...capture(options),
                films: [{clipId: 'c1',
                    media: {
                        clipId: 'c1',
                        blob: new Blob(['mp4'], {type: 'video/mp4'}),
                        leadTrimSec: 0.5,
                        trimDurationSec: 3,
                        videoWidth: 640,
                        videoHeight: 360,
                        durationSec: 5,
                        vttText: 'WEBVTT\n\n00:00:00.000 --> 00:00:01.000\nI <c.hl>love</c> it\n\n',
                        title: 'Heat',
                        year: 1995,
                        imdbUrl: 'https://www.imdb.com/title/tt0113277/',
                    }}],
            });
            // Only to see that the film is unticked too.
            panel._selectedFilm.add('c1');
            panel._updateFooter();
        }
        return panel;
    };
    const panel = await mount(ticked === 'film' || ticked === 'both');
    const checkboxes = /** @type {HTMLInputElement[]} */ ([...panel.root.querySelectorAll('.ve-gw-yt-card input[type=checkbox]')]);
    if (ticked === 'youtube' || ticked === 'both') { toggle(checkboxes[0]); }
    /** @type {HTMLButtonElement} */
    const footer = /** @type {any} */ (panel.root.querySelector('.fc-xp-save'));
    rig.calls.length = 0;

    const press = {
        button: rig.press,
        footer: () => {
            footer.dispatchEvent(new window.MouseEvent('mousedown', {bubbles: true}));
            footer.focus();
            footer.click();
        },
    };
    const sequence = () => rig.sent(SAVE_CALLS).map(([name]) => SHORT[name] ?? name);
    const saved = async () => {
        await until(() => rig.anki._savingNotes.size === 0);
        await settle();
    };
    // eslint-disable-next-line jsdoc/require-returns -- the inferred shape is what the tests use
    /**
     * The next request of this kind waits.
     * @param {string} step
     */
    const hold = (step) => {
        const gate = defer();
        const reached = defer();
        const answer = rig.answers[step];
        rig.answers[step] = async (...args) => {
            rig.answers[step] = answer;
            reached.resolve(null);
            await gate.promise;
            return await answer(...args);
        };
        return {gate, reached: reached.promise};
    };
    return {
        ...rig,
        rig,
        panel,
        footer,
        checkboxes,
        mount,
        pressOn: press,
        sequence,
        saved,
        hold,
        updated,
        transcoder,
        media: state,
        ticks: () => [panel._selectedYouTube.size, panel._selectedFilm.size],
        status: () => panel.root.querySelector('.ve-gw-save-status')?.textContent,
        notices: () => [...document.querySelectorAll('#notifications .footer-notification-body')].map(({textContent}) => textContent),
    };
}

/**
 * @param {Ticked} ticked
 * @returns {(html: string) => void}
 */
function expectHtml(ticked) {
    return (html) => {
        expect(html.includes('flib-yt-player')).toBe(ticked !== 'film');
        expect(html.includes(REFS[0])).toBe(ticked !== 'film');
        expect(html).not.toContain(REFS[1]);
        expect(html.includes(`src="${WEBM_NAME}"`)).toBe(ticked !== 'youtube');
    };
}

const language = getUiLanguage();
beforeEach(() => {
    vi.useFakeTimers({toFake: ['setTimeout', 'clearTimeout']});
    storage.clear();
    vi.stubGlobal('chrome', {
        runtime: {getURL: (/** @type {string} */ path) => `chrome-extension://x${path}`},
        storage: {
            local: {
                get: vi.fn(async (/** @type {string[]} */ keys) => Object.fromEntries(keys.filter((key) => storage.has(key)).map((key) => [key, storage.get(key)]))),
                set: vi.fn(async (/** @type {Record<string, unknown>} */ items) => { for (const [key, value] of Object.entries(items)) { storage.set(key, value); } }),
            },
        },
    });
    vi.spyOn(log, 'log').mockImplementation(() => {});
    vi.spyOn(log, 'warn').mockImplementation(() => {});
    vi.spyOn(log, 'error').mockImplementation(() => {});
    setUiLanguage('ru');
});
afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    setUiLanguage(language);
    document.body.replaceChildren();
});

const PRESSES = /** @type {('button'|'footer')[]} */ (['button', 'footer']);
const SOME = /** @type {Ticked[]} */ (['youtube', 'film', 'both']);
/** @type {Record<string, string[]>} */
const MEDIA_STEPS = {youtube: ['hasField'], film: ['hasField', 'store'], both: ['hasField', 'store']};
/** @type {[press: 'button'|'footer', ticked: Ticked][]} */
const PRESSES_AND_TICKED = PRESSES.flatMap((press) => SOME.map((ticked) => /** @type {[press: 'button'|'footer', ticked: Ticked]} */ ([press, ticked])));

describe('a new note', () => {
    test('a panel with nothing ticked: the same calls as without one', async () => {
        const r = await openMediaRig({ticked: 'none'});
        r.pressOn.button();
        await r.saved();
        expect(r.calls).toStrictEqual([
            ['flibPhrasePrepare', []],
            ['flibPhraseFind', [{server: SERVER, deckName: 'My deck', front: 'I love it', englishWord: 'I love it'}]],
            ['flibPhraseAdd', [{server: SERVER, deckName: 'My deck', fields: {...CARD, flib_media: ''}, tags: TAGS}]],
        ]);
        expect(r.status()).toBe('');
        expect(r.transcoder).not.toHaveBeenCalled();
    });

    test.each(PRESSES_AND_TICKED)('%s, ticked: %s → prepare, find, the media, add', async (press, ticked) => {
        const r = await openMediaRig({ticked});
        expect(r.footer.hidden).toBe(false);
        r.pressOn[press]();
        await r.saved();
        expect(r.sequence()).toStrictEqual(['prepare', 'find', ...MEDIA_STEPS[ticked], 'add']);
        const [{fields, ...rest}] = r.argsOf('flibPhraseAdd');
        expect(rest).toStrictEqual({server: SERVER, deckName: 'My deck', tags: TAGS});
        const {flib_media: html, ...others} = fields;
        expect(others).toStrictEqual(CARD);
        expectHtml(ticked)(html);
        expect(r.calls.filter(([name]) => name === 'flibAnkiModelHasField')).toStrictEqual([['flibAnkiModelHasField', ['Phrases', 'flib_media', true, SERVER]]]);
        expect(r.calls.filter(([name]) => name === 'flibStoreAnkiMedia')).toStrictEqual(ticked === 'youtube' ? [] : [['flibStoreAnkiMedia', [WEBM_NAME, WEBM_BASE64, true, SERVER]]]);
        expect(r.button()).toBe('open 1000');
        expect(r.errors()).toStrictEqual([]);
        expect(r.ticks()).toStrictEqual([0, 0]);
        expect(r.checkboxes[0].checked).toBe(false);
        expect(r.footer.hidden).toBe(true);
        expect(r.status()).toBe('Сохранено');
        expect(r.anki._gatewaySaves.size).toBe(0);
    });

    test.each([[[], ['hasField', 'store', 'add'], 1], [[5], ['hasField', 'store', 'update'], 0]])('audio and translation: of a new note only (notes: %j)', async (notes, sequence, count) => {
        const r = await openMediaRig({ticked: 'both', notes, details: {enrichCards: true}});
        r.answers.flibGatewayStatus = () => ({hasKey: true, base: ''});
        r.answers.flibPhraseEnrich = () => ({audio: {status: 'done'}, translation: {status: 'done'}, speechCode: null});
        const {gate} = r.hold('flibPhrasePrepare');
        r.pressOn.footer();
        await settle();
        // The settings of the press are the ones that were taken with the ticks.
        Object.assign(r.options, {flibService: {enrichCards: false}});
        r.update();
        gate.resolve(null);
        await r.saved();
        expect(r.sequence()).toStrictEqual(['prepare', 'find', ...sequence]);
        expect(r.argsOf('flibPhraseEnrich')).toStrictEqual(Array.from({length: count}, () => ({server: SERVER, noteId: 1000, expression: 'I love it', front: null, useCache: true})));
        expect(r.status()).toBe('Сохранено');
        // Above the panel of the videos.
        const line = r.ui.entry().querySelector(':scope>.fc-enrich-status');
        expect(line === null).toBe(count === 0);
        if (line !== null) { expect(line.nextElementSibling).toBe(r.panel.root); }
    });

    test('nothing of the save waits for audio and translation: the notices neither', async () => {
        const r = await openMediaRig({details: {enrichCards: true}});
        r.media.videoHidden = true;
        r.answers.flibGatewayStatus = () => ({hasKey: true, base: ''});
        r.answers.flibPhraseEnrich = () => new Promise(() => {});
        const {gate} = r.hold('flibPhraseAdd');
        r.pressOn.footer();
        await until(() => r.argsOf('flibPhraseAdd').length > 0);
        r.pressOn.footer();
        expect(r.notices()).toStrictEqual([translate('anki.stillSaving')]);
        gate.resolve(null);
        await r.saved();
        await r.wait(200);
        expect(r.argsOf('flibPhraseEnrich')).toHaveLength(1);
        expect(r.notices()).toStrictEqual([translate('anki.phraseVideoHidden')]);
        expect(r.status()).toBe('Сохранено');
        expect(r.ticks()).toStrictEqual([0, 0]);
        expect(r.button()).toBe('open 1000');
    });

    test('the address that was prepared, whatever the route says', async () => {
        const r = await openMediaRig({ticked: 'both'});
        r.state.server = OTHER_SERVER;
        r.pressOn.footer();
        await r.saved();
        expect(r.calls.find(([name]) => name === 'flibAnkiModelHasField')?.[1].at(-1)).toBe(OTHER_SERVER);
        expect(r.calls.find(([name]) => name === 'flibStoreAnkiMedia')?.[1].at(-1)).toBe(OTHER_SERVER);
        expect(r.argsOf('flibPhraseAdd')[0].server).toBe(OTHER_SERVER);
    });

    test('the selection of the press, also when the footer is pressed', async () => {
        const r = await openMediaRig();
        r.selectPart('love');
        // The browser drops the selection between the press and the click, without a focusout.
        r.footer.dispatchEvent(new window.MouseEvent('mousedown', {bubbles: true}));
        r.ui.english().setSelectionRange(0, 0);
        Object.defineProperty(document, 'activeElement', {value: r.footer, configurable: true});
        r.footer.click();
        Reflect.deleteProperty(document, 'activeElement');
        await r.saved();
        expect(r.argsOf('flibPhraseAdd')[0].fields).toMatchObject({Front: 'I _____ it', EnglishWord: 'love'});
    });

    test('everything is of the moment of the press: texts, tags, deck, ticks', async () => {
        const r = await openMediaRig();
        r.type(r.ui.translation(), 'Мне это нравится');
        const {gate} = r.hold('flibPhrasePrepare');
        r.pressOn.footer();
        await settle();
        r.type(r.ui.english(), 'I hate it');
        r.type(r.ui.translation(), 'другое');
        r.options.anki.tags = ['other'];
        r.options.anki.cardFormats = [format({deck: 'Other deck'})];
        r.update();
        toggle(r.checkboxes[0]);
        toggle(r.checkboxes[1]);
        gate.resolve(null);
        await r.saved();
        const [{fields, deckName, tags}] = r.argsOf('flibPhraseAdd');
        expect({deckName, tags}).toStrictEqual({deckName: 'My deck', tags: TAGS});
        expect(fields).toMatchObject({...CARD, ExpressionTranslate: 'Мне это нравится'});
        expectHtml('youtube')(fields.flib_media);
        // What was ticked meanwhile is not in the note: it stays ticked.
        expect(r.checkboxes.map(({checked}) => checked)).toStrictEqual([false, true]);
        expect(r.ticks()).toStrictEqual([1, 0]);
    });

    test('progress in the panel: the film, its file, the card; the tooltip of the button stays', async () => {
        const gate = defer();
        const r = await openMediaRig({ticked: 'both',
            transcode: async () => {
                await gate.promise;
                return WEBM;
            }});
        const {gate: storeGate, reached: storing} = r.hold('flibStoreAnkiMedia');
        const {gate: addGate, reached} = r.hold('flibPhraseAdd');
        r.pressOn.footer();
        expect(r.status()).toBe('Готовлю видео…');
        await until(() => r.transcoder.mock.calls.length > 0);
        expect(r.status()).toBe('Готовлю видео…');
        expect(r.button()).toBe('Сохраняю… (disabled)');
        r.selectPart('love');
        gate.resolve(null);
        await storing;
        expect(r.status()).toBe('Сохраняю видео в Anki…');
        storeGate.resolve(null);
        await reached;
        expect(r.status()).toBe('Сохраняю карточку в Anki…');
        addGate.resolve(null);
        await r.saved();
        expect(r.ui.save().title).toBe('В Anki, пропуск: love');
        expect(r.status()).toBe('Сохранено');
    });

    test('YouTube only: no word about preparing', async () => {
        const r = await openMediaRig();
        const {gate} = r.hold('flibPhrasePrepare');
        r.pressOn.footer();
        expect(r.status()).toBe('Сохраняю в Anki…');
        gate.resolve(null);
        await r.saved();
    });
});

describe('the note is there already', () => {
    test.each(SOME)('the button is «Открыть», the footer with %s → only the media of the first note', async (ticked) => {
        const r = await openMediaRig({ticked, notes: [5, 7]});
        expect(r.button()).toBe('open 5 7');
        r.pressOn.footer();
        await r.saved();
        expect(r.sequence()).toStrictEqual(['prepare', 'find', ...MEDIA_STEPS[ticked], 'update']);
        const [{html, ...rest}] = r.argsOf('flibPhraseUpdateMedia');
        expect(rest).toStrictEqual({server: SERVER, noteId: 5, deckName: 'My deck'});
        expectHtml(ticked)(html);
        expect(r.button()).toBe('open 5 7');
        expect(r.ticks()).toStrictEqual([0, 0]);
        expect(r.status()).toBe('Сохранено');
        expect(r.errors()).toStrictEqual([]);
    });

    test('«В Anki» with ticks, and Anki has it: the same', async () => {
        const r = await openMediaRig();
        r.rig.notes.push({id: 5, deckName: 'My deck', front: 'I love it', englishWord: 'I love it'});
        r.pressOn.button();
        await r.saved();
        expect(r.sequence()).toStrictEqual(['prepare', 'find', 'hasField', 'update']);
        expect(r.updated.map(([id]) => id)).toStrictEqual([5]);
        expect(r.button()).toBe('open 5');
        expect(r.ticks()).toStrictEqual([0, 0]);
    });

    test('«В Anki» without ticks, and Anki has it: nothing is written', async () => {
        const r = await openMediaRig({ticked: 'none'});
        r.rig.notes.push({id: 5, deckName: 'My deck', front: 'I love it', englishWord: 'I love it'});
        r.pressOn.button();
        await r.saved();
        expect(r.sequence()).toStrictEqual(['prepare', 'find']);
    });

    test.each(PRESSES)('%s: it appears between find and add → its media is updated', async (press) => {
        const r = await openMediaRig({ticked: 'both'});
        r.answers.flibPhraseAdd = () => ({noteId: 12, existed: true});
        r.pressOn[press]();
        await r.saved();
        expect(r.sequence()).toStrictEqual(['prepare', 'find', 'hasField', 'store', 'add', 'update']);
        const [{html, ...rest}] = r.argsOf('flibPhraseUpdateMedia');
        expect(rest).toStrictEqual({server: SERVER, noteId: 12, deckName: 'My deck'});
        expectHtml('both')(html);
        expect(html).toBe(r.argsOf('flibPhraseAdd')[0].fields.flib_media);
        expect(r.button()).toBe('open 12');
        expect(r.ticks()).toStrictEqual([0, 0]);
    });

    test('it was deleted in Anki since: the footer adds it', async () => {
        const r = await openMediaRig({notes: [5]});
        r.rig.notes.length = 0;
        r.pressOn.footer();
        await r.saved();
        expect(r.sequence()).toStrictEqual(['prepare', 'find', 'hasField', 'add']);
        expect(r.button()).toBe('open 1000');
    });

    test('saved, then ticked again: the second press updates the first note', async () => {
        const r = await openMediaRig();
        r.pressOn.footer();
        await r.saved();
        toggle(r.checkboxes[1]);
        r.pressOn.footer();
        await r.saved();
        expect(r.argsOf('flibPhraseAdd')).toHaveLength(1);
        expect(r.updated.map(([id, html]) => [id, html.includes(REFS[1]), html.includes(REFS[0])])).toStrictEqual([[1000, true, false]]);
    });

    test('the phrase edited after the save: a new note again', async () => {
        const r = await openMediaRig();
        r.pressOn.footer();
        await r.saved();
        r.type(r.ui.english(), 'I hate it');
        toggle(r.checkboxes[1]);
        r.pressOn.footer();
        await r.saved();
        expect(r.argsOf('flibPhraseAdd').map(({fields}) => [fields.Front, fields.flib_media.includes(REFS[1])])).toStrictEqual([['I love it', false], ['I hate it', true]]);
        expect(r.updated).toStrictEqual([]);
    });
});

describe('failures: nothing is written, the ticks stay, the next press saves', () => {
    /** @type {[name: string, step: string, answer: () => unknown, message: string, sequence: string[], notes: number[]][]} */
    const FAILURES = [
        ['Anki is closed before prepare', 'flibPhrasePrepare', () => { throw codeError('anki_closed'); }, 'anki.closedForPhrase', ['prepare'], []],
        ['the type cannot be prepared', 'flibPhrasePrepare', () => { throw codeError('anki_model_failed'); }, 'anki.phraseModelFailed', ['prepare'], []],
        ['find fails', 'flibPhraseFind', () => { throw codeError('anki_note_failed'); }, 'anki.phraseNoteFailed', ['prepare', 'find'], []],
        ['Anki is closed before the field check', 'flibAnkiModelHasField', () => { throw codeError('anki_closed'); }, 'anki.closedForPhrase', ['prepare', 'find', 'hasField'], []],
        ['Anki is closed before the field check, the note is there', 'flibAnkiModelHasField', () => { throw codeError('anki_closed'); }, 'anki.closedForPhrase', ['prepare', 'find', 'hasField'], [5]],
        ['the address changed before the field check', 'flibAnkiModelHasField', () => { throw codeError('anki_route_switched'); }, 'route.switched', ['prepare', 'find', 'hasField'], []],
        ['AnkiConnect is off', 'flibAnkiModelHasField', () => { throw codeError('flib_anki_unavailable'); }, 'media.ankiUnavailable', ['prepare', 'find', 'hasField'], []],
        ['no such field', 'flibAnkiModelHasField', () => false, 'anki.phraseModelOutdated', ['prepare', 'find', 'hasField'], []],
        ['Anki does not answer the field check', 'flibAnkiModelHasField', () => { throw codeError('anki_note_failed'); }, 'anki.phraseNoteFailed', ['prepare', 'find', 'hasField'], []],
        ['Anki does not answer the file', 'flibStoreAnkiMedia', () => { throw codeError('anki_note_failed'); }, 'anki.phraseNoteFailed', ['prepare', 'find', 'hasField', 'store'], []],
        ['Anki is closed before the file', 'flibStoreAnkiMedia', () => { throw codeError('anki_closed'); }, 'anki.closedForPhrase', ['prepare', 'find', 'hasField', 'store'], []],
        ['Anki is closed before the file, the note is there', 'flibStoreAnkiMedia', () => { throw codeError('anki_closed'); }, 'anki.closedForPhrase', ['prepare', 'find', 'hasField', 'store'], [5]],
        ['the address changed before the file', 'flibStoreAnkiMedia', () => { throw codeError('anki_route_switched'); }, 'route.switched', ['prepare', 'find', 'hasField', 'store'], []],
        ['the file is not stored', 'flibStoreAnkiMedia', () => { throw codeError('flib_media_not_stored'); }, 'media.notStored', ['prepare', 'find', 'hasField', 'store'], []],
        ['add fails', 'flibPhraseAdd', () => { throw codeError('anki_note_failed'); }, 'anki.phraseNoteFailed', ['prepare', 'find', 'hasField', 'store', 'add'], []],
        ['the deck cannot be made', 'flibPhraseAdd', () => { throw codeError('anki_deck_failed'); }, 'anki.phraseDeckFailed', ['prepare', 'find', 'hasField', 'store', 'add'], []],
        ['the note cannot be read', 'flibPhraseUpdateMedia', () => { throw codeError('anki_note_failed'); }, 'anki.phraseNoteFailed', ['prepare', 'find', 'hasField', 'store', 'update'], [5]],
        ['the note is gone', 'flibPhraseUpdateMedia', () => { throw codeError('anki_note_gone'); }, 'anki.phraseNoteGone', ['prepare', 'find', 'hasField', 'store', 'update'], [5]],
    ];
    test.each(FAILURES)('%s', async (_name, step, answer, key, sequence, notes) => {
        const r = await openMediaRig({ticked: 'both', notes});
        r.type(r.ui.translation(), 'люблю');
        r.media.videoHidden = true;
        const before = r.button();
        const works = r.answers[step];
        r.answers[step] = answer;
        r.pressOn.footer();
        await r.saved();
        expect(r.errors()).toStrictEqual([translate(key, {deck: 'My deck'})]);
        expect(r.sequence()).toStrictEqual(sequence);
        expect(r.rig.notes).toHaveLength(notes.length);
        expect(r.updated).toStrictEqual([]);
        expect(r.ticks()).toStrictEqual([1, 1]);
        expect(r.checkboxes[0].checked).toBe(true);
        expect(r.footer.hidden).toBe(false);
        expect(r.status()).toBe('');
        expect(r.ui.translation().value).toBe('люблю');
        expect(r.button()).toBe(before);
        expect(r.anki._gatewaySaves.size).toBe(0);
        expect(r.display.progressIndicatorVisible.clearOverride).toHaveBeenCalledTimes(1);
        expect(storage.size).toBe(0);
        r.media.videoHidden = false;
        r.answers[step] = works;
        r.pressOn.footer();
        await r.saved();
        await r.wait(200);
        expect(r.errors()).toStrictEqual([]);
        expect(r.ticks()).toStrictEqual([0, 0]);
        expect(r.rig.notes).toHaveLength(1);
        expect(r.updated).toHaveLength(notes.length);
    });

    /** @type {[name: string, step: string, answer: () => unknown, button: string][]} */
    const FOUND_THEN_FAILED = [
        ['Anki is closed before the field check', 'flibAnkiModelHasField', () => { throw codeError('anki_closed'); }, 'open 5'],
        ['no such field', 'flibAnkiModelHasField', () => false, 'open 5'],
        ['the file is not stored', 'flibStoreAnkiMedia', () => { throw codeError('flib_media_not_stored'); }, 'open 5'],
        ['its media cannot be written', 'flibPhraseUpdateMedia', () => { throw codeError('anki_note_failed'); }, 'open 5'],
        ['the type is outdated twice', 'flibPhraseUpdateMedia', () => { throw codeError('anki_model_outdated'); }, 'open 5'],
        // What was found is not there, or it is another collection.
        ['the note is gone', 'flibPhraseUpdateMedia', () => { throw codeError('anki_note_gone'); }, 'В Anki'],
        ['the address changed before the field check', 'flibAnkiModelHasField', () => { throw codeError('anki_route_switched'); }, 'В Anki'],
        ['the address changed before the file', 'flibStoreAnkiMedia', () => { throw codeError('anki_route_switched'); }, 'В Anki'],
        ['the address changed before the update', 'flibPhraseUpdateMedia', () => { throw codeError('anki_route_switched'); }, 'В Anki'],
    ];
    test.each(FOUND_THEN_FAILED)('the press found the note, then: %s', async (_name, step, answer, button) => {
        const r = await openMediaRig({ticked: 'both'});
        r.rig.notes.push({id: 5, deckName: 'My deck', front: 'I love it', englishWord: 'I love it'});
        expect(r.button()).toBe('В Anki');
        r.answers[step] = answer;
        r.pressOn.button();
        await r.saved();
        expect(r.errors()).toHaveLength(1);
        expect(r.button()).toBe(button);
        expect(r.ticks()).toStrictEqual([1, 1]);
        expect(r.argsOf('flibPhraseFind')).toHaveLength(1);
        expect(r.argsOf('flibPhraseAdd')).toHaveLength(0);
    });

    test('a short text, which no find without a press looks for: the same', async () => {
        const r = await openMediaRig();
        r.type(r.ui.english(), 'ok');
        r.rig.notes.push({id: 5, deckName: 'My deck', front: 'ok', englishWord: 'ok'});
        r.answers.flibAnkiModelHasField = () => false;
        r.pressOn.footer();
        await r.saved();
        expect(r.button()).toBe('open 5');
    });

    test('it appeared between find and add, then its media fails: the button opens it', async () => {
        const r = await openMediaRig();
        r.answers.flibPhraseAdd = () => ({noteId: 12, existed: true});
        r.answers.flibPhraseUpdateMedia = () => { throw codeError('anki_note_failed'); };
        r.pressOn.button();
        await r.saved();
        expect(r.button()).toBe('open 12');
    });

    test('found at one address, outdated, the find at another one fails: nothing is known', async () => {
        const r = await openMediaRig();
        r.rig.notes.push({id: 5, deckName: 'My deck', front: 'I love it', englishWord: 'I love it'});
        r.answers.flibPhraseUpdateMedia = () => {
            r.state.server = OTHER_SERVER;
            r.answers.flibPhraseFind = () => { throw codeError('anki_note_failed'); };
            throw codeError('anki_model_outdated');
        };
        r.pressOn.button();
        await r.saved();
        expect(r.sequence()).toStrictEqual(['prepare', 'find', 'hasField', 'update', 'prepare', 'find']);
        expect(r.button()).toBe('В Anki');
    });

    test('another phrase by then: its button is not touched', async () => {
        const r = await openMediaRig();
        r.rig.notes.push({id: 5, deckName: 'My deck', front: 'I love it', englishWord: 'I love it'});
        const {gate, reached} = r.hold('flibAnkiModelHasField');
        r.pressOn.button();
        await reached;
        r.type(r.ui.english(), 'I hate it');
        gate.reject(codeError('anki_closed'));
        await r.saved();
        expect(r.button()).toBe('В Anki');
    });

    test('a film cannot be converted: nothing is stored', async () => {
        const r = await openMediaRig({ticked: 'both', transcode: async () => { throw new ClipTranscodeError('timeout', 'x'); }});
        r.pressOn.footer();
        await r.saved();
        expect(r.sequence()).toStrictEqual(['prepare', 'find', 'hasField']);
        expect(r.errors()).toStrictEqual([translate('media.transcodeTimeout')]);
        expect(r.ticks()).toStrictEqual([1, 1]);
    });

    test('the ticks cannot be read at a press about another card: it is looked for all the same', async () => {
        const r = await openMediaRig();
        r.rig.notes.push({id: 5, deckName: 'Other deck', front: 'I love it', englishWord: 'I love it'});
        r.panel.getSelectedGatewayMedia = () => { throw new Error('broken'); };
        r.options.anki.cardFormats = [format({deck: 'Other deck'})];
        r.update();
        r.pressOn.button();
        await r.saved();
        expect(r.errors()).toStrictEqual(['broken']);
        expect(r.sequence()).toStrictEqual(['find']);
        expect(r.button()).toBe('open 5');
    });

    test('the ticks cannot be read: an error, nothing is asked, the next press works', async () => {
        const r = await openMediaRig();
        const capture = r.panel.getSelectedGatewayMedia;
        r.panel.getSelectedGatewayMedia = () => { throw new Error('broken'); };
        r.pressOn.footer();
        await r.saved();
        expect(r.calls).toStrictEqual([]);
        expect(r.errors()).toStrictEqual(['broken']);
        expect(r.button()).toBe('В Anki');
        r.panel.getSelectedGatewayMedia = capture;
        r.pressOn.footer();
        await r.saved();
        expect(r.button()).toBe('open 1000');
    });

    test.each([[[]], [[5]]])('nothing valid is left of the ticks (notes: %j): an error, not a card without videos', async (notes) => {
        const r = await openMediaRig({notes});
        const capture = r.panel.getSelectedGatewayMedia.bind(r.panel);
        r.panel.getSelectedGatewayMedia = (options) => {
            const selection = capture(options);
            return {...selection, youtube: selection.youtube.map((item) => ({...item, ref: 'not a ref'}))};
        };
        r.pressOn.footer();
        await r.saved();
        expect(r.sequence()).toStrictEqual(['prepare', 'find', 'hasField']);
        expect(r.errors()).toStrictEqual([translate('media.badData')]);
        expect(r.rig.notes).toHaveLength(notes.length);
        expect(r.updated).toStrictEqual([]);
        expect(r.ticks()).toStrictEqual([1, 0]);
        expect(r.status()).toBe('');
        expect(r.anki._gatewaySaves.size).toBe(0);
    });

    test('the status of the panel cannot be shown: an error, nothing is held, the next press saves', async () => {
        const r = await openMediaRig();
        const begin = r.panel.beginSaveStatus;
        r.panel.beginSaveStatus = () => { throw new Error('broken'); };
        r.pressOn.footer();
        await r.saved();
        expect(r.calls).toStrictEqual([]);
        expect(r.errors()).toStrictEqual(['broken']);
        expect(r.anki._gatewaySaves.size).toBe(0);
        expect(r.display.progressIndicatorVisible.clearOverride).toHaveBeenCalledTimes(1);
        expect(r.ticks()).toStrictEqual([1, 0]);
        expect(r.button()).toBe('В Anki');
        r.panel.beginSaveStatus = begin;
        r.pressOn.footer();
        await r.saved();
        expect(r.ticks()).toStrictEqual([0, 0]);
        expect(r.button()).toBe('open 1000');
    });

    test('nothing to save: the reason, the ticks stay', async () => {
        const r = await openMediaRig();
        r.type(r.ui.english(), 'привет');
        r.pressOn.footer();
        await r.saved();
        expect(r.sequence()).toStrictEqual([]);
        expect(r.errors()).toStrictEqual([translate('anki.phraseNoLatin')]);
        expect(r.ticks()).toStrictEqual([1, 0]);
        expect(r.anki._gatewaySaves.size).toBe(0);
    });
});

describe('the type became outdated', () => {
    const outdatedOnce = (/** @type {Awaited<ReturnType<typeof openMediaRig>>} */ r, /** @type {string} */ step, /** @type {() => void} */ change = () => {}) => {
        const answer = r.answers[step];
        r.answers[step] = () => {
            r.answers[step] = answer;
            change();
            throw codeError('anki_model_outdated');
        };
    };

    test('add: prepared once more, added once more, the film is not prepared again', async () => {
        const r = await openMediaRig({ticked: 'both'});
        outdatedOnce(r, 'flibPhraseAdd');
        r.pressOn.footer();
        await r.saved();
        expect(r.sequence()).toStrictEqual(['prepare', 'find', 'hasField', 'store', 'add', 'prepare', 'add']);
        const [first, second] = r.argsOf('flibPhraseAdd');
        expect(second).toStrictEqual(first);
        expect(r.transcoder).toHaveBeenCalledTimes(1);
        expect(r.ticks()).toStrictEqual([0, 0]);
    });

    test('update: the same', async () => {
        const r = await openMediaRig({notes: [5]});
        outdatedOnce(r, 'flibPhraseUpdateMedia');
        r.pressOn.footer();
        await r.saved();
        expect(r.sequence()).toStrictEqual(['prepare', 'find', 'hasField', 'update', 'prepare', 'update']);
        expect(r.updated.map(([id]) => id)).toStrictEqual([5]);
    });

    test('update after existed: the note is not added again', async () => {
        const r = await openMediaRig();
        r.answers.flibPhraseAdd = () => ({noteId: 12, existed: true});
        outdatedOnce(r, 'flibPhraseUpdateMedia');
        r.pressOn.footer();
        await r.saved();
        expect(r.sequence()).toStrictEqual(['prepare', 'find', 'hasField', 'add', 'update', 'prepare', 'update']);
        expect(r.updated.map(([id]) => id)).toStrictEqual([12]);
        expect(r.button()).toBe('open 12');
    });

    test('at another address: it is another collection, its notes and files are its own', async () => {
        const r = await openMediaRig({ticked: 'both', notes: [5]});
        outdatedOnce(r, 'flibPhraseUpdateMedia', () => {
            r.state.server = OTHER_SERVER;
            r.rig.notes.splice(0, 1, {id: 9, deckName: 'My deck', front: 'I love it', englishWord: 'I love it'});
        });
        r.pressOn.footer();
        await r.saved();
        expect(r.sequence()).toStrictEqual(['prepare', 'find', 'hasField', 'store', 'update', 'prepare', 'find', 'hasField', 'store', 'update']);
        expect(r.argsOf('flibPhraseFind').map(({server}) => server)).toStrictEqual([SERVER, OTHER_SERVER]);
        expect(r.calls.filter(([name]) => name === 'flibStoreAnkiMedia').map(([, args]) => args.at(-1))).toStrictEqual([SERVER, OTHER_SERVER]);
        expect(r.argsOf('flibPhraseUpdateMedia').map(({server, noteId}) => [server, noteId])).toStrictEqual([[SERVER, 5], [OTHER_SERVER, 9]]);
        expect(r.button()).toBe('open 9');
    });

    test('at another address, where there is no such note: added', async () => {
        const r = await openMediaRig({notes: [5]});
        outdatedOnce(r, 'flibPhraseUpdateMedia', () => {
            r.state.server = OTHER_SERVER;
            r.rig.notes.length = 0;
        });
        r.pressOn.footer();
        await r.saved();
        expect(r.sequence()).toStrictEqual(['prepare', 'find', 'hasField', 'update', 'prepare', 'find', 'hasField', 'add']);
        expect(r.argsOf('flibPhraseAdd')[0].server).toBe(OTHER_SERVER);
    });

    test.each(/** @type {[step: string, notes: number[], sequence: string[]][]} */ ([
        ['flibPhraseAdd', [], ['prepare', 'find', 'hasField', 'add', 'prepare', 'add']],
        ['flibPhraseUpdateMedia', [5], ['prepare', 'find', 'hasField', 'update', 'prepare', 'update']],
    ]))('%s, twice: an error, no third time, the ticks stay', async (step, notes, sequence) => {
        const r = await openMediaRig({notes});
        r.answers[step] = () => { throw codeError('anki_model_outdated'); };
        r.pressOn.footer();
        await r.saved();
        expect(r.sequence()).toStrictEqual(sequence);
        expect(r.errors()).toStrictEqual([translate('anki.phraseModelOutdated')]);
        expect(r.ticks()).toStrictEqual([1, 0]);
    });
});

describe('a press goes on to the end', () => {
    const STEPS = ['flibPhrasePrepare', 'flibPhraseFind', 'flibAnkiModelHasField', 'transcode', 'flibStoreAnkiMedia', 'flibPhraseAdd', 'flibPhraseUpdateMedia'];
    /** @type {Record<string, (r: Awaited<ReturnType<typeof openMediaRig>>) => void>} */
    const EVENTS = {
        'a new phrase': (r) => { r.open('Never mind'); },
        'another kind of content': (r) => { r.open(null); },
        '×': (r) => { /** @type {HTMLButtonElement} */ (r.panel.root.querySelector('.entry-video-examples-icon-close')).click(); },
        '× and a new phrase': (r) => {
            /** @type {HTMLButtonElement} */ (r.panel.root.querySelector('.entry-video-examples-icon-close')).click();
            r.open('Never mind');
        },
    };

    // eslint-disable-next-line jsdoc/require-returns -- the inferred shape is what the tests use
    /**
     * Both videos ticked, the footer is pressed, the save waits in the step.
     * @param {string} step
     */
    const pressAndHold = async (step) => {
        const transcoding = defer();
        const started = defer();
        const r = await openMediaRig({
            ticked: 'both',
            notes: step === 'flibPhraseUpdateMedia' ? [5] : [],
            transcode: async () => {
                started.resolve(null);
                if (step === 'transcode') { await transcoding.promise; }
                return WEBM;
            },
        });
        const {gate, reached} = step === 'transcode' ? {gate: transcoding, reached: started.promise} : r.hold(step);
        r.pressOn.footer();
        await reached;
        return {r, gate};
    };
    /** @type {[step: string, event: string][]} */
    const CASES = STEPS.flatMap((step) => Object.keys(EVENTS).map((event) => /** @type {[step: string, event: string]} */ ([step, event])));

    test.each(CASES)('during %s: %s → saved with the videos', async (step, event) => {
        const {r, gate} = await pressAndHold(step);
        EVENTS[event](r);
        expect(r.panel.destroyReason).not.toBeNull();
        await settle();
        gate.resolve(null);
        await r.saved();
        if (step === 'flibPhraseUpdateMedia') {
            expect(r.updated).toHaveLength(1);
            expectHtml('both')(r.updated[0][1]);
        } else {
            expect(r.argsOf('flibPhraseAdd').map(({fields}) => fields.Front)).toStrictEqual(['I love it']);
            expectHtml('both')(r.argsOf('flibPhraseAdd')[0].fields.flib_media);
        }
        expect(r.errors()).toStrictEqual([]);
        expect(r.anki._gatewaySaves.size).toBe(0);
        if (event === '×') { expect(r.button()).toBe(step === 'flibPhraseUpdateMedia' ? 'open 5' : 'open 1000'); }
        if (event.endsWith('a new phrase')) { expect(r.button()).toBe('В Anki'); }
    });

    test.each(STEPS)('the panel of the next phrase is not touched by the end of a save that was in %s', async (step) => {
        const {r, gate} = await pressAndHold(step);
        r.open('Never mind');
        await settle();
        const next = await r.mount(false);
        const [checkbox] = /** @type {HTMLInputElement[]} */ ([...next.root.querySelectorAll('.ve-gw-yt-card input[type=checkbox]')]);
        toggle(checkbox);
        gate.resolve(null);
        await r.saved();
        expect(checkbox.checked).toBe(true);
        expect(next.hasSelection).toBe(true);
        expect(next.root.querySelector('.ve-gw-save-status')?.textContent).toBe('');
    });

    test.each(STEPS)('×, and a panel opened again in the same window during %s: its ticks stay', async (step) => {
        const {r, gate} = await pressAndHold(step);
        EVENTS['×'](r);
        const next = await r.mount(false);
        const [checkbox] = /** @type {HTMLInputElement[]} */ ([...next.root.querySelectorAll('.ve-gw-yt-card input[type=checkbox]')]);
        toggle(checkbox);
        gate.resolve(null);
        await r.saved();
        expect(checkbox.checked).toBe(true);
        expect(next.hasSelection).toBe(true);
    });

    test.each(STEPS)('a new phrase during %s, which fails: one notice with the phrase', async (step) => {
        const {r, gate} = await pressAndHold(step);
        r.open('Never mind');
        await settle();
        gate.reject(step === 'transcode' ? new ClipTranscodeError('timeout', 'x') : codeError('anki_closed'));
        await r.saved();
        const reason = step === 'transcode' ? translate('media.transcodeTimeout') : 'Откройте Anki, чтобы сохранить фразу';
        expect(r.errors()).toStrictEqual([translate('anki.notSavedWord', {word: 'I love it', reason})]);
        expect(r.rig.notes.map(({id}) => id)).toStrictEqual(step === 'flibPhraseUpdateMedia' ? [5] : []);
    });

    test.each(STEPS)('a second press during %s: the notice, nothing more is sent; closed by the end of the save', async (step) => {
        const {r, gate} = await pressAndHold(step);
        const asked = r.calls.length;
        r.pressOn.footer();
        r.pressOn.footer();
        r.pressOn.button();
        r.ui.save().disabled = false;
        r.ui.save().click();
        expect(r.notices()).toStrictEqual([translate('anki.stillSaving')]);
        expect(r.calls).toHaveLength(asked);
        gate.resolve(null);
        await r.saved();
        await r.wait(200);
        expect(r.notices()).toStrictEqual([]);
        expect(r.argsOf('flibPhrasePrepare')).toHaveLength(1);
        expect(r.argsOf('flibPhraseAdd').length + r.updated.length).toBe(1);
        expect(r.transcoder).toHaveBeenCalledTimes(1);
    });

    test.each(['flibPhrasePrepare', 'flibPhraseFind', 'flibAnkiModelHasField', 'transcode', 'flibStoreAnkiMedia'])('the page is unloaded during %s: nothing is written', async (step) => {
        const {r, gate} = await pressAndHold(step);
        r.anki._onPageHide();
        gate.resolve(null);
        await r.saved();
        expect(r.rig.notes).toStrictEqual([]);
        expect(r.errors()).toStrictEqual([translate('media.aborted')]);
    });

    test('the page is unloaded before the second attempt: no second attempt', async () => {
        const r = await openMediaRig();
        r.answers.flibPhraseAdd = () => {
            r.anki._onPageHide();
            throw codeError('anki_model_outdated');
        };
        r.pressOn.footer();
        await r.saved();
        expect(r.argsOf('flibPhraseAdd')).toHaveLength(1);
        expect(r.errors()).toStrictEqual([translate('media.aborted')]);
    });

    test('nothing ticked: the unload of the page stops nothing', async () => {
        const r = await openMediaRig({ticked: 'none'});
        const {gate} = r.hold('flibPhraseFind');
        r.pressOn.button();
        await settle();
        r.anki._onPageHide();
        gate.resolve(null);
        await r.saved();
        expect(r.rig.notes).toHaveLength(1);
    });
});

describe('the footer and Anki', () => {
    test('nobody answered, the button is hidden: the footer still says what to do, and saves once Anki is open', async () => {
        const r = await openMediaRig({details: {connected: false}});
        expect(r.button()).toBe('0 buttons');
        const prepare = r.answers.flibPhrasePrepare;
        r.answers.flibPhrasePrepare = () => { throw codeError('anki_closed'); };
        r.pressOn.footer();
        await r.saved();
        expect(r.errors()).toStrictEqual(['Откройте Anki, чтобы сохранить фразу']);
        expect(r.button()).toBe('0 buttons');
        r.answers.flibPhrasePrepare = prepare;
        r.pressOn.footer();
        await r.saved();
        expect(r.button()).toBe('open 1000');
    });

    test('Anki is off in the settings: an error, nothing is sent', async () => {
        const r = await openMediaRig({details: {enable: false}});
        r.pressOn.footer();
        await settle();
        expect(r.sequence()).toStrictEqual([]);
        expect(r.errors()).toStrictEqual([translate('anki.cannotSave')]);
        expect(r.ticks()).toStrictEqual([1, 0]);
    });

    test('a phrase that is no longer on screen', async () => {
        const r = await openMediaRig();
        const old = r.ui.entry();
        r.open('Never mind');
        await settle();
        r.calls.length = 0;
        r.anki._saveEntryWithSelection(old);
        await settle();
        expect(r.sequence()).toStrictEqual([]);
        expect(r.errors()).toStrictEqual([translate('anki.cannotSave')]);
    });
});

describe('the template of the user does not show the videos', () => {
    const NOTICE = 'Видео сохранено в поле flib_media, но ваш шаблон Phrases его не показывает';

    // eslint-disable-next-line jsdoc/require-returns -- the inferred shape is what the tests use
    /**
     * @param {Parameters<typeof openMediaRig>[0]} [options]
     * @param {boolean} [videoHidden]
     */
    const saveHidden = async (options, videoHidden = true) => {
        const r = await openMediaRig(options);
        r.media.videoHidden = videoHidden;
        r.pressOn[options?.notes ? 'footer' : 'button']();
        await r.saved();
        return r;
    };

    test.each(/** @type {[string, number[]|undefined][]} */ ([['a new note', void 0], ['a media update', [5]]]))('%s: saved, the notice, remembered for the server and the revision', async (_name, notes) => {
        const r = await saveHidden({notes});
        expect(r.notices()).toStrictEqual([NOTICE]);
        expect(r.errors()).toStrictEqual([]);
        expect([...storage]).toStrictEqual([[NOTICE_KEY, REVISION]]);
        expect(r.ticks()).toStrictEqual([0, 0]);
        expect(r.button()).toBe(notes ? 'open 5' : 'open 1000');
    });

    test('existed', async () => {
        const r = await openMediaRig();
        r.media.videoHidden = true;
        r.answers.flibPhraseAdd = () => ({noteId: 12, existed: true});
        r.pressOn.footer();
        await r.saved();
        expect(r.notices()).toStrictEqual([NOTICE]);
    });

    test('once: not again in this window, not in another one', async () => {
        const r = await saveHidden();
        /** @type {HTMLButtonElement} */ (document.querySelector('#notifications .footer-notification-close-button')).click();
        await r.wait(200);
        expect(r.notices()).toStrictEqual([]);
        toggle(r.checkboxes[1]);
        r.pressOn.footer();
        await r.saved();
        expect(r.updated).toHaveLength(1);
        expect(r.notices()).toStrictEqual([]);
        const other = await saveHidden();
        expect(other.argsOf('flibPhraseAdd')).toHaveLength(1);
        expect(other.notices()).toStrictEqual([]);
        expect(chrome.storage.local.set).toHaveBeenCalledTimes(1);
    });

    test.each([
        ['another revision', `flibPhrasesCustomisedNotice:${SERVER}`, '0123456789abcdef'],
        ['another server', `flibPhrasesCustomisedNotice:${OTHER_SERVER}`, REVISION],
    ])('remembered for %s: shown', async (_name, key, revision) => {
        storage.set(key, revision);
        const r = await saveHidden();
        expect(r.notices()).toStrictEqual([NOTICE]);
        expect(storage.get(NOTICE_KEY)).toBe(REVISION);
    });

    test('a new revision in the same window: shown again', async () => {
        const r = await saveHidden();
        /** @type {HTMLButtonElement} */ (document.querySelector('#notifications .footer-notification-close-button')).click();
        await r.wait(200);
        r.media.revision = '0123456789abcdef';
        toggle(r.checkboxes[1]);
        r.pressOn.footer();
        await r.saved();
        expect(r.notices()).toStrictEqual([NOTICE]);
        expect(storage.get(NOTICE_KEY)).toBe('0123456789abcdef');
    });

    test('remembered only after it was shown', async () => {
        const r = await openMediaRig();
        r.media.videoHidden = true;
        /** @type {unknown[]} */
        const shown = [];
        vi.mocked(chrome.storage.local.set).mockImplementation(async () => { shown.push(r.notices()); });
        r.pressOn.footer();
        await r.saved();
        expect(shown).toStrictEqual([[NOTICE]]);
    });

    test('nothing ticked, or the template shows them: no notice, the storage is not asked', async () => {
        const unticked = await saveHidden({ticked: 'none'});
        expect(unticked.rig.notes).toHaveLength(1);
        expect(unticked.notices()).toStrictEqual([]);
        const shown = await saveHidden({}, false);
        expect(shown.notices()).toStrictEqual([]);
        expect(chrome.storage.local.get).not.toHaveBeenCalled();
        expect(storage.size).toBe(0);
    });

    test('the answer of the second preparation counts', async () => {
        const r = await openMediaRig();
        const add = r.answers.flibPhraseAdd;
        r.answers.flibPhraseAdd = () => {
            r.answers.flibPhraseAdd = add;
            r.media.videoHidden = true;
            throw codeError('anki_model_outdated');
        };
        r.pressOn.footer();
        await r.saved();
        expect(r.notices()).toStrictEqual([NOTICE]);
    });

    test('the window is hidden: nobody would see it, so the next save tells', async () => {
        const r = await openMediaRig();
        r.media.videoHidden = true;
        r.display.frameVisible = false;
        r.pressOn.footer();
        await r.saved();
        expect(r.notices()).toStrictEqual([]);
        expect(storage.size).toBe(0);
        r.display.frameVisible = true;
        toggle(r.checkboxes[1]);
        r.pressOn.footer();
        await r.saved();
        expect(r.notices()).toStrictEqual([NOTICE]);
    });

    test('another phrase by then: shown, and a new result does not close it', async () => {
        const r = await openMediaRig();
        r.media.videoHidden = true;
        const {gate} = r.hold('flibPhraseAdd');
        r.pressOn.footer();
        await until(() => r.argsOf('flibPhraseAdd').length > 0);
        r.open('Never mind');
        gate.resolve(null);
        await r.saved();
        expect(r.notices()).toStrictEqual([NOTICE]);
        r.open('I hate it');
        await settle();
        expect(r.notices()).toStrictEqual([NOTICE]);
    });

    test.each(['get', 'set'])('the storage fails (%s): shown, once in this window, the save is a success', async (method) => {
        vi.mocked(chrome.storage.local[/** @type {'get'|'set'} */ (method)]).mockImplementation(async () => { throw new Error('no storage'); });
        const r = await saveHidden();
        expect(r.notices()).toStrictEqual([NOTICE]);
        expect(r.errors()).toStrictEqual([]);
        expect(r.button()).toBe('open 1000');
        /** @type {HTMLButtonElement} */ (document.querySelector('#notifications .footer-notification-close-button')).click();
        await r.wait(200);
        toggle(r.checkboxes[1]);
        r.pressOn.footer();
        await r.saved();
        expect(r.notices()).toStrictEqual([]);
    });

    test('English', async () => {
        setUiLanguage('en');
        const r = await saveHidden();
        expect(r.notices()).toStrictEqual(['The video was saved to the flib_media field, but your Phrases template does not show it']);
    });
});

/* eslint-enable no-underscore-dangle, @typescript-eslint/no-unsafe-argument, @typescript-eslint/no-unsafe-assignment, @typescript-eslint/unbound-method */
