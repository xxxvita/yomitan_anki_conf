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
import {isExtensionPageSender, redactOptionsFull, redactProfileOptions, targetTouchesFlibSecret} from '../ext/js/background/flib-options-redaction.js';
import {ExtensionError} from '../ext/js/core/extension-error.js';

/* eslint-disable no-underscore-dangle */

// eslint-disable-next-line jsdoc/no-undefined-types
/** @typedef {chrome.runtime.MessageSender} Sender */

const FAKE_KEY = `tpk_${'a'.repeat(32)}`;
const EXT_BASE = 'chrome-extension://abcdefghijklmnop/';

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
        expect(isExtensionPageSender(/** @type {Sender} */ ({url: `${EXT_BASE}popup.html`, tab: {id: 1}}), EXT_BASE)).toBe(true);
        expect(isExtensionPageSender({url: `${EXT_BASE}settings.html`}, EXT_BASE)).toBe(true);
        expect(isExtensionPageSender({url: 'moz-extension://uuid-1/popup.html'}, 'moz-extension://uuid-1/')).toBe(true);
        expect(isExtensionPageSender({url: 'https://example.com/'}, EXT_BASE)).toBe(false);
        expect(isExtensionPageSender({url: 'chrome-extension://otherextension/popup.html'}, EXT_BASE)).toBe(false);
        expect(isExtensionPageSender({url: `https://evil.example/?${EXT_BASE}`}, EXT_BASE)).toBe(false);
        expect(isExtensionPageSender({}, EXT_BASE)).toBe(false);
        expect(isExtensionPageSender(void 0, EXT_BASE)).toBe(false);
        expect(isExtensionPageSender({url: `${EXT_BASE}popup.html`}, '')).toBe(false);
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
            _canSenderReadFlibSecrets: canSenderReadFlibSecrets,
        };
    }

    const contentScript = /** @type {Sender} */ ({url: 'https://example.com/page', tab: {id: 3}, frameId: 0});
    const popupFrame = /** @type {Sender} */ ({url: `${EXT_BASE}popup.html`, tab: {id: 3}, frameId: 2});

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
    ])('key %j → hasKey %s, never echoes the key', (personalKey, hasKey) => {
        const ctx = {_getProfileOptions: () => profileOptions(personalKey)};
        const status = /** @type {import('flib-gateway-examples').GatewayStatus} */ (onApiFlibGatewayStatus.call(ctx, void 0, /** @type {Sender} */ ({})));
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
        const id = jobs.start(['run'], 3);
        expect(run).toHaveBeenCalledWith(['run'], expect.objectContaining({perWord: 3, budgetMs: 240000}));
        expect(jobs.poll(id)).toEqual({done: false, phase: null});
        /** @type {(phase: string) => void} */ (/** @type {unknown} */ (onPhase))('running');
        expect(jobs.poll(id)).toEqual({done: false, phase: 'running'});
        d.resolve({results: []});
        await Promise.resolve();
        await Promise.resolve();
        expect(jobs.poll(id)).toEqual({done: true, result: {results: []}});
        expect(() => jobs.poll(id)).toThrow('flib_job_not_found');
    });

    test('a failed job rethrows its coded error on poll', async () => {
        const run = vi.fn(async () => { throw flibError('flib_job_timeout'); });
        const jobs = new FlibWordExamplesJobs({run: asRun(run), now: () => 0});
        const id = jobs.start(['run'], 3);
        await new Promise((r) => { setTimeout(r, 0); });
        let caught = null;
        try {
            jobs.poll(id);
        } catch (e) {
            caught = e;
        }
        expect(/** @type {ExtensionError} */ (caught).data).toMatchObject({code: 'flib_job_timeout'});
    });

    test('unknown id (service worker restarted) → flib_job_not_found', () => {
        const jobs = new FlibWordExamplesJobs({run: asRun(vi.fn()), now: () => 0});
        let caught = null;
        try {
            jobs.poll('nope');
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
        const id = jobs.start(['run'], 3);
        expect(jobs.cancel(id)).toBe(true);
        expect(/** @type {AbortSignal} */ (/** @type {unknown} */ (signal)).aborted).toBe(true);
        expect(jobs.cancel(id)).toBe(false);
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
        const id = jobs.start(['run'], 3);
        t = 31000;
        jobs.start(['walk'], 3);
        expect(signals[0].aborted).toBe(true);
        expect(signals[1].aborted).toBe(false);
        expect(() => jobs.poll(id)).toThrow('flib_job_not_found');
    });

    test('too many concurrent jobs is refused with a code', () => {
        const run = vi.fn(() => deferred().promise);
        const jobs = new FlibWordExamplesJobs({run: asRun(run), now: () => 0, maxJobs: 2});
        jobs.start(['a'], 3);
        jobs.start(['b'], 3);
        let caught = null;
        try {
            jobs.start(['c'], 3);
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
            _canSenderReadFlibSecrets: canSenderReadFlibSecrets,
            _getSetting: getSetting,
            _getModifySettingObject: getModifySettingObject,
            _modifySettings: vi.fn(async () => []),
            _saveOptions: vi.fn(async () => {}),
            _optionsUtil: {validate: vi.fn()},
        };
    }
    const contentScript = /** @type {Sender} */ ({url: 'https://example.com/page'});
    const settingsPage = /** @type {Sender} */ ({url: `${EXT_BASE}settings.html`});
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
            jobs.start(['run'], 3);
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
            const id = jobs.start(['run'], 3);
            t = 45000;
            expect(jobs.poll(id)).toEqual({done: false, phase: null});
            expect(jobs.cancel(id)).toBe(true);
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
        const id = jobs.start(['run'], 2);
        await vi.waitFor(() => { expect(signals.length).toBe(1); });
        expect(signals[0].aborted).toBe(false);
        expect(jobs.cancel(id)).toBe(true);
        expect(signals[0].aborted).toBe(true);
        expect(() => jobs.poll(id)).toThrow(ExtensionError);
        jobs._sweep();
    });

    test('each request timeout is capped by both the per-request ceiling and the remaining job budget', async () => {
        const big = setup();
        const bigId = big.jobs.start(['run'], 2);
        await vi.waitFor(() => { expect(big.timeouts.length).toBe(1); });
        expect(big.timeouts[0]).toBe(15000);
        big.jobs.cancel(bigId);

        const small = setup(5000);
        const smallId = small.jobs.start(['run'], 2);
        await vi.waitFor(() => { expect(small.timeouts.length).toBe(1); });
        expect(small.timeouts[0]).toBeLessThanOrEqual(5000);
        small.jobs.cancel(smallId);
    });
});

/* eslint-enable no-underscore-dangle */
