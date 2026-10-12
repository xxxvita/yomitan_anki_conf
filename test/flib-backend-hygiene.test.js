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

import {describe, expect, test, vi} from 'vitest';
import {Backend} from '../ext/js/background/backend.js';
import {FlibWordExamplesJobs} from '../ext/js/background/flib-word-examples-jobs.js';
import {FlibGatewayClient} from '../ext/js/comm/flib-gateway-client.js';
import {API} from '../ext/js/comm/api.js';
import {isExtensionPageSender, redactOptionsFull, redactProfileOptions, targetTouchesFlibSecret} from '../ext/js/background/flib-options-redaction.js';
import {ExtensionError} from '../ext/js/core/extension-error.js';

/* eslint-disable no-underscore-dangle */

// eslint-disable-next-line jsdoc/no-undefined-types
/** @typedef {chrome.runtime.MessageSender} Sender */

const FAKE_KEY = `tpk_${'a'.repeat(32)}`;
const EXT_ID = 'abcdefghijklmnop';
/** Owner key of a job: tab 3, frame 2 (the popup iframe). */
const OWNER = '3:2';
const EXT_BASE = `chrome-extension://${EXT_ID}/`;

/**
 * @param {string} personalKey
 * @returns {import('settings').ProfileOptions}
 */
function profileOptions(personalKey) {
    return /** @type {import('settings').ProfileOptions} */ (/** @type {unknown} */ ({
        general: {enable: true},
        flibService: {gatewayUrl: '', personalKey},
    }));
}

/**
 * @param {string} personalKey
 * @returns {import('settings').Options}
 */
function optionsFull(personalKey) {
    return /** @type {import('settings').Options} */ (/** @type {unknown} */ ({
        version: 1,
        profileCurrent: 0,
        profiles: [
            {name: 'A', conditionGroups: [], options: profileOptions(personalKey)},
            {name: 'B', conditionGroups: [], options: profileOptions(personalKey)},
        ],
        global: {},
    }));
}

describe('isExtensionPageSender', () => {
    test('extension pages (popup iframe, settings) are trusted; content scripts and unknown are not', () => {
        expect(isExtensionPageSender(/** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}popup.html`, tab: {id: 1}}), EXT_BASE, EXT_ID)).toBe(true);
        expect(isExtensionPageSender({id: EXT_ID, url: `${EXT_BASE}settings.html`}, EXT_BASE, EXT_ID)).toBe(true);
        expect(isExtensionPageSender({id: 'uuid-id', url: 'moz-extension://uuid-1/popup.html'}, 'moz-extension://uuid-1/', 'uuid-id')).toBe(true);
        expect(isExtensionPageSender({id: EXT_ID, url: 'https://example.com/'}, EXT_BASE, EXT_ID)).toBe(false);
        expect(isExtensionPageSender({id: EXT_ID, url: 'chrome-extension://otherextension/popup.html'}, EXT_BASE, EXT_ID)).toBe(false);
        expect(isExtensionPageSender({id: EXT_ID, url: `https://evil.example/?${EXT_BASE}`}, EXT_BASE, EXT_ID)).toBe(false);
        expect(isExtensionPageSender({}, EXT_BASE, EXT_ID)).toBe(false);
        expect(isExtensionPageSender(void 0, EXT_BASE, EXT_ID)).toBe(false);
        expect(isExtensionPageSender({id: EXT_ID, url: `${EXT_BASE}popup.html`}, '', EXT_ID)).toBe(false);
    });

    test('C1 hardening: sender.id must be this extension (another extension, or no id → untrusted)', () => {
        expect(isExtensionPageSender({id: 'otherextension', url: `${EXT_BASE}settings.html`}, EXT_BASE, EXT_ID)).toBe(false);
        expect(isExtensionPageSender({url: `${EXT_BASE}settings.html`}, EXT_BASE, EXT_ID)).toBe(false);
        expect(isExtensionPageSender({id: EXT_ID, url: `${EXT_BASE}settings.html`}, EXT_BASE, '')).toBe(false);
    });
});

describe('redaction', () => {
    test('profile options: key blanked on a copy, original untouched', () => {
        const original = profileOptions(FAKE_KEY);
        const redacted = redactProfileOptions(original);
        expect(redacted.flibService.personalKey).toBe('');
        expect(redacted.flibService.gatewayUrl).toBe('');
        expect(redacted.general).toBe(original.general);
        expect(original.flibService.personalKey).toBe(FAKE_KEY);
    });

    test('full options: every profile blanked, original untouched', () => {
        const original = optionsFull(FAKE_KEY);
        const redacted = redactOptionsFull(original);
        expect(redacted.profiles.map((p) => p.options.flibService.personalKey)).toEqual(['', '']);
        expect(original.profiles.map((p) => p.options.flibService.personalKey)).toEqual([FAKE_KEY, FAKE_KEY]);
        expect(redacted.profileCurrent).toBe(0);
    });

    test('options without flibService pass through', () => {
        const options = /** @type {import('settings').ProfileOptions} */ (/** @type {unknown} */ ({general: {}}));
        expect(redactProfileOptions(options)).toBe(options);
    });
});

describe('Backend optionsGet / optionsGetFull redaction (M1)', () => {
    /* eslint-disable @typescript-eslint/unbound-method */
    const onApiOptionsGet = Backend.prototype._onApiOptionsGet;
    const onApiOptionsGetFull = Backend.prototype._onApiOptionsGetFull;
    const canSenderReadFlibSecrets = Backend.prototype._canSenderReadFlibSecrets;
    /* eslint-enable @typescript-eslint/unbound-method */

    /**
     * @returns {object} Backend-shaped context with only what the handlers touch.
     */
    function makeContext() {
        return {
            _getProfileOptions: () => profileOptions(FAKE_KEY),
            _getOptionsFull: () => optionsFull(FAKE_KEY),
            _getExtensionBaseUrl: () => EXT_BASE,
            _getExtensionId: () => EXT_ID,
            _canSenderReadFlibSecrets: canSenderReadFlibSecrets,
        };
    }

    const contentScript = /** @type {Sender} */ ({id: EXT_ID, url: 'https://example.com/page', tab: {id: 3}, frameId: 0});
    const popupFrame = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}popup.html`, tab: {id: 3}, frameId: 2});

    test('content script sender gets a blank key', () => {
        const ctx = makeContext();
        const options = /** @type {import('settings').ProfileOptions} */ (onApiOptionsGet.call(ctx, {optionsContext: {current: true}}, contentScript));
        expect(options.flibService.personalKey).toBe('');
        const full = /** @type {import('settings').Options} */ (onApiOptionsGetFull.call(ctx, void 0, contentScript));
        expect(full.profiles[0].options.flibService.personalKey).toBe('');
    });

    test('extension page sender (popup iframe) keeps the key', () => {
        const ctx = makeContext();
        const options = /** @type {import('settings').ProfileOptions} */ (onApiOptionsGet.call(ctx, {optionsContext: {current: true}}, popupFrame));
        expect(options.flibService.personalKey).toBe(FAKE_KEY);
        const full = /** @type {import('settings').Options} */ (onApiOptionsGetFull.call(ctx, void 0, popupFrame));
        expect(full.profiles[1].options.flibService.personalKey).toBe(FAKE_KEY);
    });

    test('an internal call with an empty sender is treated as untrusted', () => {
        const ctx = makeContext();
        const full = /** @type {import('settings').Options} */ (onApiOptionsGetFull.call(ctx, void 0, /** @type {Sender} */ ({})));
        expect(full.profiles[0].options.flibService.personalKey).toBe('');
    });
});

describe('Backend flibGatewayStatus', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const onApiFlibGatewayStatus = Backend.prototype._onApiFlibGatewayStatus;

    test.each([
        [FAKE_KEY, true],
        [` ${FAKE_KEY}\n`, true],
        ['', false],
        ['tpk_NOTHEX', false],
        [`tpk_${'A'.repeat(32)}`, false],
    ])('stored key %j → hasKey %s, never echoes the key', async (personalKey, hasKey) => {
        const ctx = {_getFlibSecrets: async () => ({personalKey, gatewayUrl: ''}), _requireFlibPageSender: () => {}};
        const status = /** @type {import('flib-gateway-examples').GatewayStatus} */ (await onApiFlibGatewayStatus.call(ctx, void 0, /** @type {Sender} */ ({})));
        expect(status.hasKey).toBe(hasKey);
        expect(status.base).toBe('https://cache.flib.club');
        expect(JSON.stringify(status)).not.toContain('tpk_');
    });
});

/**
 * @param {string} code
 * @returns {ExtensionError}
 */
function flibError(code) {
    const error = new ExtensionError(code);
    error.data = {code, status: null};
    return error;
}

/**
 * @param {unknown} mock
 * @returns {(words: string[], options: import('flib-gateway').WordExamplesJobOptions) => Promise<import('flib-gateway').WordExamplesResult>}
 */
function asRun(mock) {
    return /** @type {(words: string[], options: import('flib-gateway').WordExamplesJobOptions) => Promise<import('flib-gateway').WordExamplesResult>} */ (mock);
}

describe('FlibWordExamplesJobs (M3: start + poll instead of one long message)', () => {
    /**
     * @returns {{promise: Promise<import('flib-gateway').WordExamplesResult>, resolve: (v: import('flib-gateway').WordExamplesResult) => void, reject: (e: unknown) => void}}
     */
    function deferred() {
        /** @type {(v: import('flib-gateway').WordExamplesResult) => void} */
        let resolve = () => {};
        /** @type {(e: unknown) => void} */
        let reject = () => {};
        /** @type {Promise<import('flib-gateway').WordExamplesResult>} */
        const promise = new Promise((res, rej) => {
            resolve = res;
            reject = rej;
        });
        return {promise, resolve, reject};
    }

    test('start returns at once; poll reports phase, then the result exactly once', async () => {
        const d = deferred();
        /** @type {?(phase: string) => void} */
        let onPhase = null;
        const run = vi.fn((/** @type {string[]} */ _words, /** @type {import('flib-gateway').WordExamplesJobOptions} */ options) => {
            onPhase = options.onPhase ?? null;
            return d.promise;
        });
        const jobs = new FlibWordExamplesJobs({run: asRun(run), now: () => 0});
        const id = jobs.start(['run'], 3, OWNER);
        expect(run).toHaveBeenCalledWith(['run'], expect.objectContaining({perWord: 3, budgetMs: 240000}));
        expect(jobs.poll(id, OWNER)).toEqual({done: false, phase: null});
        /** @type {(phase: string) => void} */ (/** @type {unknown} */ (onPhase))('running');
        expect(jobs.poll(id, OWNER)).toEqual({done: false, phase: 'running'});
        d.resolve({results: []});
        await Promise.resolve();
        await Promise.resolve();
        expect(jobs.poll(id, OWNER)).toEqual({done: true, result: {results: []}});
        expect(() => jobs.poll(id, OWNER)).toThrow('flib_job_not_found');
    });

    test('a failed job rethrows its coded error on poll', async () => {
        const run = vi.fn(async () => { throw flibError('flib_job_timeout'); });
        const jobs = new FlibWordExamplesJobs({run: asRun(run), now: () => 0});
        const id = jobs.start(['run'], 3, OWNER);
        await new Promise((r) => { setTimeout(r, 0); });
        let caught = null;
        try {
            jobs.poll(id, OWNER);
        } catch (e) {
            caught = e;
        }
        expect(/** @type {ExtensionError} */ (caught).data).toMatchObject({code: 'flib_job_timeout'});
    });

    test('unknown id (service worker restarted) → flib_job_not_found', () => {
        const jobs = new FlibWordExamplesJobs({run: asRun(vi.fn()), now: () => 0});
        let caught = null;
        try {
            jobs.poll('nope', OWNER);
        } catch (e) {
            caught = e;
        }
        expect(/** @type {ExtensionError} */ (caught).data).toMatchObject({code: 'flib_job_not_found'});
    });

    test('cancel aborts the running job', () => {
        /** @type {?AbortSignal} */
        let signal = null;
        const run = vi.fn((/** @type {string[]} */ _w, /** @type {import('flib-gateway').WordExamplesJobOptions} */ options) => {
            signal = options.signal ?? null;
            return deferred().promise;
        });
        const jobs = new FlibWordExamplesJobs({run: asRun(run), now: () => 0});
        const id = jobs.start(['run'], 3, OWNER);
        expect(jobs.cancel(id, OWNER)).toBe(true);
        expect(/** @type {AbortSignal} */ (/** @type {unknown} */ (signal)).aborted).toBe(true);
        expect(jobs.cancel(id, OWNER)).toBe(false);
    });

    test('a job nobody polls any more (popup closed) is aborted and dropped', () => {
        let t = 0;
        /** @type {AbortSignal[]} */
        const signals = [];
        const run = vi.fn((/** @type {string[]} */ _w, /** @type {import('flib-gateway').WordExamplesJobOptions} */ options) => {
            if (typeof options.signal !== 'undefined') { signals.push(options.signal); }
            return deferred().promise;
        });
        const jobs = new FlibWordExamplesJobs({run: asRun(run), now: () => t, abandonMs: 30000});
        const id = jobs.start(['run'], 3, OWNER);
        t = 31000;
        jobs.start(['walk'], 3, OWNER);
        expect(signals[0].aborted).toBe(true);
        expect(signals[1].aborted).toBe(false);
        expect(() => jobs.poll(id, OWNER)).toThrow('flib_job_not_found');
    });

    test('too many concurrent jobs is refused with a code', () => {
        const run = vi.fn(() => deferred().promise);
        const jobs = new FlibWordExamplesJobs({run: asRun(run), now: () => 0, maxJobs: 2});
        jobs.start(['a'], 3, OWNER);
        jobs.start(['b'], 3, OWNER);
        let caught = null;
        try {
            jobs.start(['c'], 3, OWNER);
        } catch (e) {
            caught = e;
        }
        expect(/** @type {ExtensionError} */ (caught).data).toMatchObject({code: 'flib_too_many_jobs'});
    });
});


describe('targetTouchesFlibSecret', () => {
    test.each([
        [{scope: 'profile', path: 'flibService.personalKey'}, true],
        [{scope: 'profile', path: 'flibService'}, true],
        [{scope: 'profile', path: ''}, true],
        [{scope: 'global', path: 'profiles[0].options.flibService.personalKey'}, true],
        [{scope: 'global', path: 'profiles[0].options'}, true],
        [{scope: 'global', path: 'profiles[1]'}, true],
        [{scope: 'global', path: 'profiles'}, true],
        [{scope: 'global', path: ''}, true],
        [{scope: 'global', path1: 'profiles[0]', path2: 'profiles[1]'}, true],
        [{scope: 'global', path: 'profiles[0].options.general.enable'}, false],
        [{scope: 'global', path: 'profileCurrent'}, false],
        [{scope: 'profile', path: 'general.enable'}, false],
        [{scope: 'profile', path: 'clipboard.enableBackgroundMonitor'}, false],
    ])('%j → %s', (target, expected) => {
        expect(targetTouchesFlibSecret(target)).toBe(expected);
    });
});

describe('Backend getSettings / modifySettings / setAllSettings guard the key', () => {
    /* eslint-disable @typescript-eslint/unbound-method */
    const onApiGetSettings = Backend.prototype._onApiGetSettings;
    const onApiModifySettings = Backend.prototype._onApiModifySettings;
    const onApiSetAllSettings = Backend.prototype._onApiSetAllSettings;
    const canSenderReadFlibSecrets = Backend.prototype._canSenderReadFlibSecrets;
    const getSetting = Backend.prototype._getSetting;
    const getModifySettingObject = Backend.prototype._getModifySettingObject;
    /* eslint-enable @typescript-eslint/unbound-method */

    /**
     * @returns {{_modifySettings: import('vitest').Mock, _saveOptions: import('vitest').Mock, _optionsUtil: {validate: import('vitest').Mock}}&Record<string, unknown>}
     */
    function makeContext() {
        return {
            _getProfileOptions: () => profileOptions(FAKE_KEY),
            _getOptionsFull: () => optionsFull(FAKE_KEY),
            _getExtensionBaseUrl: () => EXT_BASE,
            _getExtensionId: () => EXT_ID,
            _canSenderReadFlibSecrets: canSenderReadFlibSecrets,
            _getSetting: getSetting,
            _getModifySettingObject: getModifySettingObject,
            _modifySettings: vi.fn(async () => []),
            _saveOptions: vi.fn(async () => {}),
            _optionsUtil: {validate: vi.fn()},
        };
    }
    const contentScript = /** @type {Sender} */ ({id: EXT_ID, url: 'https://example.com/page'});
    const settingsPage = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}settings.html`});
    /** @type {import('settings-modifications').ScopedRead} */
    const keyRead = {scope: 'profile', optionsContext: {current: true}, path: 'flibService.personalKey'};

    test('getSettings: the key path errors for a content script, ordinary paths still work', () => {
        const ctx = makeContext();
        const results = /** @type {import('core').Response<unknown>[]} */ (onApiGetSettings.call(ctx, {targets: [keyRead, {...keyRead, path: 'general.enable'}]}, contentScript));
        expect(JSON.stringify(results)).not.toContain(FAKE_KEY);
        expect(results[0]).toHaveProperty('error');
        expect(results[1]).toEqual({result: true});
    });

    test('getSettings: a settings page reads the key', () => {
        const results = /** @type {import('core').Response<unknown>[]} */ (onApiGetSettings.call(makeContext(), {targets: [keyRead]}, settingsPage));
        expect(results[0]).toEqual({result: FAKE_KEY});
    });

    test('modifySettings: a content script cannot touch the key; scalars pass', async () => {
        const ctx = makeContext();
        /** @type {import('settings-modifications').ScopedModificationSet} */
        const wipe = {scope: 'profile', optionsContext: {current: true}, action: 'set', path: 'flibService.personalKey', value: ''};
        await expect(onApiModifySettings.call(ctx, {targets: [wipe], source: 'x'}, contentScript)).rejects.toThrow('flib_secret_forbidden');
        expect(ctx._modifySettings).not.toHaveBeenCalled();
        await onApiModifySettings.call(ctx, {targets: [{...wipe, path: 'general.enable', value: false}], source: 'x'}, contentScript);
        expect(ctx._modifySettings).toHaveBeenCalledTimes(1);
        await onApiModifySettings.call(ctx, {targets: [wipe], source: 'x'}, settingsPage);
        expect(ctx._modifySettings).toHaveBeenCalledTimes(2);
    });

    test('setAllSettings: only extension pages', async () => {
        const ctx = makeContext();
        await expect(onApiSetAllSettings.call(ctx, {value: optionsFull(''), source: 'x'}, contentScript)).rejects.toThrow('flib_secret_forbidden');
        expect(ctx._saveOptions).not.toHaveBeenCalled();
        await onApiSetAllSettings.call(ctx, {value: optionsFull(FAKE_KEY), source: 'x'}, settingsPage);
        expect(ctx._saveOptions).toHaveBeenCalledTimes(1);
    });
});

describe('FlibWordExamplesJobs timers', () => {
    test('an abandoned job is aborted by the timer even with no further start/poll', () => {
        vi.useFakeTimers();
        try {
            let t = 0;
            /** @type {AbortSignal[]} */
            const signals = [];
            const run = vi.fn((/** @type {string[]} */ _w, /** @type {import('flib-gateway').WordExamplesJobOptions} */ options) => {
                if (typeof options.signal !== 'undefined') { signals.push(options.signal); }
                return new Promise(() => {});
            });
            const jobs = new FlibWordExamplesJobs({run: asRun(run), now: () => t, abandonMs: 30000});
            jobs.start(['run'], 3, OWNER);
            t = 31000;
            vi.advanceTimersByTime(30000);
            expect(signals[0].aborted).toBe(true);
            expect(vi.getTimerCount()).toBe(0);
        } finally {
            vi.useRealTimers();
        }
    });

    test('a late poller keeps its own job (poll refreshes before sweeping)', () => {
        vi.useFakeTimers();
        try {
            let t = 0;
            const jobs = new FlibWordExamplesJobs({run: asRun(vi.fn(() => new Promise(() => {}))), now: () => t, abandonMs: 30000});
            const id = jobs.start(['run'], 3, OWNER);
            t = 45000;
            expect(jobs.poll(id, OWNER)).toEqual({done: false, phase: null});
            expect(jobs.cancel(id, OWNER)).toBe(true);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe('FlibWordExamplesJobs + FlibGatewayClient (merge: job budget meets request timeouts)', () => {
    /**
     * @param {number} [budgetMs]
     * @returns {{jobs: FlibWordExamplesJobs, signals: AbortSignal[], timeouts: number[]}}
     */
    function setup(budgetMs) {
        /** @type {AbortSignal[]} */
        const signals = [];
        /** @type {number[]} */
        const timeouts = [];
        /** @type {typeof fetch} */
        const hangingFetch = (_input, init) => new Promise((_resolve, reject) => {
            const signal = /** @type {AbortSignal} */ (init?.signal);
            signals.push(signal);
            signal.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); }, {once: true});
        });
        const client = new FlibGatewayClient({
            fetch: hangingFetch,
            getBase: () => 'https://gw.test',
            getKey: () => FAKE_KEY,
            requestTimeoutMs: 15000,
            timeoutSignal: (ms) => {
                timeouts.push(ms);
                return new AbortController().signal;
            },
        });
        const jobs = new FlibWordExamplesJobs({run: (words, options) => client.runWordExamplesJob(words, options), budgetMs});
        return {jobs, signals, timeouts};
    }

    test('cancel aborts the in-flight gateway fetch, and poll then reports the job gone', async () => {
        const {jobs, signals} = setup();
        const id = jobs.start(['run'], 2, OWNER);
        await vi.waitFor(() => { expect(signals.length).toBe(1); });
        expect(signals[0].aborted).toBe(false);
        expect(jobs.cancel(id, OWNER)).toBe(true);
        expect(signals[0].aborted).toBe(true);
        expect(() => jobs.poll(id, OWNER)).toThrow(ExtensionError);
        jobs._sweep();
    });

    test('each request timeout is capped by both the per-request ceiling and the remaining job budget', async () => {
        const big = setup();
        const bigId = big.jobs.start(['run'], 2, OWNER);
        await vi.waitFor(() => { expect(big.timeouts.length).toBe(1); });
        expect(big.timeouts[0]).toBe(15000);
        big.jobs.cancel(bigId, OWNER);

        const small = setup(5000);
        const smallId = small.jobs.start(['run'], 2, OWNER);
        await vi.waitFor(() => { expect(small.timeouts.length).toBe(1); });
        expect(small.timeouts[0]).toBeLessThanOrEqual(5000);
        small.jobs.cancel(smallId, OWNER);
    });
});

describe('Backend flibGatewayWordExamplesStart clamps its input (review M2)', () => {
    // eslint-disable-next-line @typescript-eslint/unbound-method
    const onStart = Backend.prototype._onApiFlibGatewayWordExamplesStart;
    const page = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}popup.html`, tab: {id: 3}, frameId: 2});

    /**
     * @returns {{_flibWordExamplesJobs: {start: import('vitest').Mock}} & Record<string, unknown>}
     */
    function makeContext() {
        return {
            _flibWordExamplesJobs: {start: vi.fn(() => 'wej-x')},
            _getExtensionBaseUrl: () => EXT_BASE,
            _getExtensionId: () => EXT_ID,
            // eslint-disable-next-line @typescript-eslint/unbound-method
            _canSenderReadFlibSecrets: Backend.prototype._canSenderReadFlibSecrets,
            // eslint-disable-next-line @typescript-eslint/unbound-method
            _requireFlibPageSender: Backend.prototype._requireFlibPageSender,
            // eslint-disable-next-line @typescript-eslint/unbound-method
            _getFlibJobOwner: Backend.prototype._getFlibJobOwner,
        };
    }

    /**
     * @param {() => unknown} fn
     * @returns {unknown}
     */
    function codeOf(fn) {
        try {
            fn();
        } catch (e) {
            return /** @type {{data?: {code?: unknown}}} */ (e).data?.code;
        }
        return null;
    }

    test.each([[0, 1], [50, 10], [2.7, 2], [Number.NaN, 3], [void 0, 3]])('perWord %s → %s', (perWord, expected) => {
        const ctx = makeContext();
        void onStart.call(ctx, {words: ['run'], perWord: /** @type {number} */ (perWord)}, page);
        expect(ctx._flibWordExamplesJobs.start.mock.calls[0][1]).toBe(expected);
    });

    test('more than 10 words, a non-string, an empty or a >80-code-point word → refused before any job', () => {
        const ctx = makeContext();
        expect(codeOf(() => onStart.call(ctx, {words: Array.from({length: 11}, () => 'w')}, page))).toBe('flib_bad_request');
        expect(codeOf(() => onStart.call(ctx, {words: []}, page))).toBe('flib_bad_request');
        expect(codeOf(() => onStart.call(ctx, {words: /** @type {string[]} */ (/** @type {unknown} */ ([1]))}, page))).toBe('flib_bad_request');
        expect(codeOf(() => onStart.call(ctx, {words: ['  ']}, page))).toBe('flib_bad_request');
        expect(codeOf(() => onStart.call(ctx, {words: ['я'.repeat(81)]}, page))).toBe('flib_word_too_long');
        expect(ctx._flibWordExamplesJobs.start).not.toHaveBeenCalled();
    });
});

describe('legacy single-message word-examples API is gone (review M3)', () => {
    test('no API method and no backend handler', () => {
        expect(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (API.prototype)).flibGatewayWordExamplesJob).toBeUndefined();
        expect(/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (Backend.prototype))._onApiFlibGatewayWordExamplesJob).toBeUndefined();
    });
});

describe('L2: job ids and ownership', () => {
    test('ids are random UUIDs, not a guessable counter', () => {
        const jobs = new FlibWordExamplesJobs({run: asRun(vi.fn(() => new Promise(() => {})))});
        const a = jobs.start(['run'], 3, OWNER);
        const b = jobs.start(['run'], 3, OWNER);
        expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
        expect(a).not.toBe(b);
        jobs.cancel(a, OWNER);
        jobs.cancel(b, OWNER);
    });

    test('poll/cancel from another tab or frame → not found; the owner keeps the job', () => {
        /** @type {?AbortSignal} */
        let jobSignal = null;
        const run = vi.fn((/** @type {string[]} */ _w, /** @type {import('flib-gateway').WordExamplesJobOptions} */ options) => new Promise((_resolve, reject) => {
            jobSignal = options.signal ?? null;
            options.signal?.addEventListener('abort', () => { reject(flibError('flib_aborted')); });
        }));
        const jobs = new FlibWordExamplesJobs({run: asRun(run)});
        const id = jobs.start(['run'], 3, OWNER);
        expect(() => jobs.poll(id, '3:0')).toThrow('flib_job_not_found');
        expect(() => jobs.poll(id, '4:2')).toThrow('flib_job_not_found');
        expect(jobs.cancel(id, '4:2')).toBe(false);
        expect(/** @type {?AbortSignal} */ (jobSignal)?.aborted).toBe(false);
        expect(jobs.poll(id, OWNER)).toEqual({done: false, phase: null});
        expect(jobs.cancel(id, OWNER)).toBe(true);
    });
});

describe('L2: every flibGateway* API is for extension pages only', () => {
    const contentScript = /** @type {Sender} */ ({id: EXT_ID, url: 'https://example.com/', tab: {id: 3}, frameId: 0});
    const popupFrame = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}popup.html`, tab: {id: 3}, frameId: 2});

    /**
     * @returns {{_flibGateway: Record<string, import('vitest').Mock>, _flibWordExamplesJobs: Record<string, import('vitest').Mock>, _getFlibSecrets: import('vitest').Mock} & Record<string, unknown>}
     */
    function makeContext() {
        return {
            _getExtensionBaseUrl: () => EXT_BASE,
            _getExtensionId: () => EXT_ID,
            // eslint-disable-next-line @typescript-eslint/unbound-method
            _canSenderReadFlibSecrets: Backend.prototype._canSenderReadFlibSecrets,
            // eslint-disable-next-line @typescript-eslint/unbound-method
            _requireFlibPageSender: Backend.prototype._requireFlibPageSender,
            // eslint-disable-next-line @typescript-eslint/unbound-method
            _getFlibJobOwner: Backend.prototype._getFlibJobOwner,
            _getFlibSecrets: vi.fn(async () => ({personalKey: FAKE_KEY, gatewayUrl: ''})),
            _flibGateway: {
                getExamples: vi.fn(async () => ({})),
                redeemClipToken: vi.fn(async () => ({})),
                getClip: vi.fn(async () => ({})),
                fetchClipData: vi.fn(async () => ({data: new Uint8Array(0), contentType: 'video/mp4'})),
            },
            _flibWordExamplesJobs: {start: vi.fn(() => 'id'), poll: vi.fn(() => ({done: false, phase: null})), cancel: vi.fn(() => true)},
        };
    }

    /** @type {Array<[string, unknown]>} */
    const calls = [
        ['_onApiFlibGatewayExamples', {word: 'run'}],
        ['_onApiFlibGatewayRedeemClips', {token: 't'}],
        ['_onApiFlibGatewayGetClip', {clipId: 'c1'}],
        ['_onApiFlibGatewayClipData', {clipId: 'c1'}],
        ['_onApiFlibGatewayStatus', void 0],
        ['_onApiFlibGatewayWordExamplesStart', {words: ['run'], perWord: 3}],
        ['_onApiFlibGatewayWordExamplesPoll', {jobId: 'id'}],
        ['_onApiFlibGatewayWordExamplesCancel', {jobId: 'id'}],
    ];

    test.each(calls)('%s: content script → flib_secret_forbidden, nothing reaches the gateway', async (name, params) => {
        const ctx = makeContext();
        const handler = /** @type {(params: unknown, sender: Sender) => unknown} */ (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (Backend.prototype))[name]);
        /** @type {unknown} */
        let code = null;
        try {
            await handler.call(ctx, params, contentScript);
        } catch (e) {
            code = /** @type {{data?: {code?: unknown}}} */ (e).data?.code;
        }
        expect(code).toBe('flib_secret_forbidden');
        for (const fn of Object.values(ctx._flibGateway)) { expect(fn).not.toHaveBeenCalled(); }
        for (const fn of Object.values(ctx._flibWordExamplesJobs)) { expect(fn).not.toHaveBeenCalled(); }
        expect(ctx._getFlibSecrets).not.toHaveBeenCalled();
    });

    test.each(calls)('%s: the popup iframe is allowed', async (name, params) => {
        const ctx = makeContext();
        const handler = /** @type {(params: unknown, sender: Sender) => unknown} */ (/** @type {Record<string, unknown>} */ (/** @type {unknown} */ (Backend.prototype))[name]);
        await expect(Promise.resolve().then(() => handler.call(ctx, params, popupFrame))).resolves.not.toThrow();
    });

    test('start/poll/cancel bind the job to the sender tab and frame', () => {
        const ctx = makeContext();
        void Backend.prototype._onApiFlibGatewayWordExamplesStart.call(ctx, {words: ['run'], perWord: 3}, popupFrame);
        void Backend.prototype._onApiFlibGatewayWordExamplesPoll.call(ctx, {jobId: 'id'}, popupFrame);
        void Backend.prototype._onApiFlibGatewayWordExamplesCancel.call(ctx, {jobId: 'id'}, popupFrame);
        expect(ctx._flibWordExamplesJobs.start.mock.calls[0][2]).toBe('3:2');
        expect(ctx._flibWordExamplesJobs.poll.mock.calls[0][1]).toBe('3:2');
        expect(ctx._flibWordExamplesJobs.cancel.mock.calls[0][1]).toBe('3:2');
    });
});

/* eslint-enable no-underscore-dangle */
