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
import {log} from '../ext/js/core/log.js';

/* eslint-disable no-underscore-dangle, @typescript-eslint/unbound-method */

// eslint-disable-next-line jsdoc/no-undefined-types
/** @typedef {chrome.runtime.MessageSender} Sender */
const EXT_ID = 'abcdefghijklmnop';
const EXT_BASE = `chrome-extension://${EXT_ID}/`;
const tabA = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}popup.html`, tab: {id: 1}, frameId: 2});
const tabB = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}popup.html`, tab: {id: 7}, frameId: 2});
const contentScript = /** @type {Sender} */ ({id: EXT_ID, url: 'https://example.com/', tab: {id: 1}, frameId: 0});

/** @typedef {{_flibUnderstandableJobs: Map<string, string>, _flibUnderstandableWatchdogs: Map<string, unknown>}} Ctx */

/** @type {Array<'_onApiFlibGatewayExamplesBatch'|'_onApiFlibGatewayUnderstandableStart'|'_onApiFlibGatewayUnderstandablePoll'|'_onApiFlibGatewayUnderstandableCancel'>} */
const HANDLERS = ['_onApiFlibGatewayExamplesBatch', '_onApiFlibGatewayUnderstandableStart', '_onApiFlibGatewayUnderstandablePoll', '_onApiFlibGatewayUnderstandableCancel'];

/**
 * @param {{status?: string}} [options]
 * @returns {{context: Ctx, gateway: Record<string, import('vitest').Mock>}}
 */
function makeContext({status = 'done'} = {}) {
    const gateway = {
        examplesBatch: vi.fn(async () => ({known_source: 'none', partial: false, results: []})),
        understandableStart: vi.fn(async () => ({jobId: 'job-1', pollAfterMs: 1500})),
        understandablePoll: vi.fn(async () => ({status, partial: false, errorCode: null, results: null})),
        understandableCancel: vi.fn(async () => {}),
    };
    let counter = 0;
    gateway.understandableStart.mockImplementation(async () => ({jobId: `job-${++counter}`, pollAfterMs: 1500}));
    const context = {
        _flibGateway: gateway,
        _flibUnderstandableJobs: /** @type {Map<string, string>} */ (new Map()),
        _flibUnderstandableWatchdogs: /** @type {Map<string, unknown>} */ (new Map()),
        _flibUnderstandablePolling: /** @type {Map<string, number>} */ (new Map()),
        _trackFlibUnderstandableJob: Backend.prototype._trackFlibUnderstandableJob,
        _armFlibUnderstandableWatchdog: Backend.prototype._armFlibUnderstandableWatchdog,
        _forgetFlibUnderstandableJob: Backend.prototype._forgetFlibUnderstandableJob,
        _getExtensionBaseUrl: () => EXT_BASE,
        _getExtensionId: () => EXT_ID,
        _canSenderReadFlibSecrets: Backend.prototype._canSenderReadFlibSecrets,
        _requireFlibPageSender: Backend.prototype._requireFlibPageSender,
        _getFlibJobOwner: Backend.prototype._getFlibJobOwner,
    };
    return {context, gateway};
}

const targets = [{text: 'give up', mode: /** @type {const} */ ('quote')}];

// Every started job arms a 15 s watchdog (K4): fake timers keep them out of the real clock.
beforeEach(() => { vi.useFakeTimers(); });
afterEach(() => { vi.useRealTimers(); });

/**
 * @param {Ctx} context
 * @param {string} name
 * @param {unknown} params
 * @param {Sender} sender
 * @returns {Promise<{status: string}>}
 */
async function call(context, name, params, sender) {
    return /** @type {{status: string}} */ (await /** @type {any} */ (Backend.prototype)[name].call(context, params, sender));
}

describe('flib examples batch / understandable backend', () => {
    test('a content-script sender is forbidden for all four, with zero gateway calls', async () => {
        const {context, gateway} = makeContext();
        const params = {targets, limit: 5, rank: 'plain', excludeVideoIds: [], jobId: 'job-1'};
        for (const name of HANDLERS) {
            await expect(call(context, name, params, contentScript)).rejects.toMatchObject({message: 'flib_secret_forbidden'});
        }
        for (const mock of Object.values(gateway)) { expect(mock).not.toHaveBeenCalled(); }
    });

    test('batch delegates its args exactly', async () => {
        const {context, gateway} = makeContext();
        const response = await call(context, '_onApiFlibGatewayExamplesBatch', {targets, limit: 5, rank: 'known'}, tabA);
        expect(gateway.examplesBatch).toHaveBeenCalledWith({targets, limit: 5, rank: 'known'});
        expect(response).toStrictEqual({known_source: 'none', partial: false, results: []});
    });

    test('start delegates and records the owner', async () => {
        const {context, gateway} = makeContext();
        const result = await call(context, '_onApiFlibGatewayUnderstandableStart', {targets, limit: 5, excludeVideoIds: ['aaaaaaaaaaa']}, tabA);
        expect(gateway.understandableStart).toHaveBeenCalledWith({targets, limit: 5, excludeVideoIds: ['aaaaaaaaaaa']});
        expect(result).toStrictEqual({jobId: 'job-1', pollAfterMs: 1500});
        expect(context._flibUnderstandableJobs.get('job-1')).toBe('1:2');
    });

    test('keeps at most 50 jobs, oldest dropped (and DELETEd: nobody can poll it any more)', async () => {
        const {context, gateway} = makeContext();
        for (let i = 0; i < 51; ++i) {
            const sender = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}popup.html`, tab: {id: 100 + i}, frameId: 0});
            await call(context, '_onApiFlibGatewayUnderstandableStart', {targets, limit: 5, excludeVideoIds: []}, sender);
        }
        expect(context._flibUnderstandableJobs.size).toBe(50);
        expect(context._flibUnderstandableJobs.has('job-1')).toBe(false);
        expect(context._flibUnderstandableJobs.has('job-51')).toBe(true);
        expect(context._flibUnderstandableWatchdogs.has('job-1')).toBe(false);
        expect(gateway.understandableCancel).toHaveBeenCalledWith('job-1');
        expect(gateway.understandableCancel).toHaveBeenCalledTimes(1);
    });

    test('poll from another tab looks like a missing job, no gateway call', async () => {
        const {context, gateway} = makeContext();
        await call(context, '_onApiFlibGatewayUnderstandableStart', {targets, limit: 5, excludeVideoIds: []}, tabA);
        await expect(call(context, '_onApiFlibGatewayUnderstandablePoll', {jobId: 'job-1'}, tabB)).rejects.toMatchObject({message: 'flib_job_not_found'});
        expect(gateway.understandablePoll).not.toHaveBeenCalled();
    });

    test('poll of an unknown id throws flib_job_not_found', async () => {
        const {context, gateway} = makeContext();
        await expect(call(context, '_onApiFlibGatewayUnderstandablePoll', {jobId: 'nope'}, tabA)).rejects.toMatchObject({message: 'flib_job_not_found'});
        expect(gateway.understandablePoll).not.toHaveBeenCalled();
    });

    test('poll running keeps the entry; done removes it', async () => {
        const running = makeContext({status: 'running'});
        await call(running.context, '_onApiFlibGatewayUnderstandableStart', {targets, limit: 5, excludeVideoIds: []}, tabA);
        await call(running.context, '_onApiFlibGatewayUnderstandablePoll', {jobId: 'job-1'}, tabA);
        expect(running.context._flibUnderstandableJobs.has('job-1')).toBe(true);

        for (const status of ['done', 'failed', 'cancelled', 'expired']) {
            const {context} = makeContext({status});
            await call(context, '_onApiFlibGatewayUnderstandableStart', {targets, limit: 5, excludeVideoIds: []}, tabA);
            const job = await call(context, '_onApiFlibGatewayUnderstandablePoll', {jobId: 'job-1'}, tabA);
            expect(job.status).toBe(status);
            await expect(call(context, '_onApiFlibGatewayUnderstandablePoll', {jobId: 'job-1'}, tabA)).rejects.toMatchObject({message: 'flib_job_not_found'});
        }
    });

    test('cancel from the owner calls the gateway and removes the entry', async () => {
        const {context, gateway} = makeContext();
        await call(context, '_onApiFlibGatewayUnderstandableStart', {targets, limit: 5, excludeVideoIds: []}, tabA);
        await call(context, '_onApiFlibGatewayUnderstandableCancel', {jobId: 'job-1'}, tabA);
        expect(gateway.understandableCancel).toHaveBeenCalledWith('job-1');
        expect(context._flibUnderstandableJobs.has('job-1')).toBe(false);
    });

    test('cancel from another owner or of an unknown job returns silently, no gateway call', async () => {
        const {context, gateway} = makeContext();
        await call(context, '_onApiFlibGatewayUnderstandableStart', {targets, limit: 5, excludeVideoIds: []}, tabA);
        await expect(call(context, '_onApiFlibGatewayUnderstandableCancel', {jobId: 'job-1'}, tabB)).resolves.toBeUndefined();
        await expect(call(context, '_onApiFlibGatewayUnderstandableCancel', {jobId: 'zzz'}, tabA)).resolves.toBeUndefined();
        expect(gateway.understandableCancel).not.toHaveBeenCalled();
        expect(context._flibUnderstandableJobs.has('job-1')).toBe(true);
    });
});

describe('K4: «Понятные» job lifecycle in the background', () => {
    const startParams = {targets, limit: 5, excludeVideoIds: []};

    test('a job not polled for 15 s is DELETEd at the gateway and forgotten', async () => {
        const {context, gateway} = makeContext({status: 'running'});
        await call(context, '_onApiFlibGatewayUnderstandableStart', startParams, tabA);
        await vi.advanceTimersByTimeAsync(14999);
        expect(gateway.understandableCancel).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(gateway.understandableCancel).toHaveBeenCalledWith('job-1');
        expect(context._flibUnderstandableJobs.has('job-1')).toBe(false);
        expect(context._flibUnderstandableWatchdogs.size).toBe(0);
        await expect(call(context, '_onApiFlibGatewayUnderstandablePoll', {jobId: 'job-1'}, tabA)).rejects.toMatchObject({message: 'flib_job_not_found'});
    });

    test('each poll refreshes the watchdog', async () => {
        const {context, gateway} = makeContext({status: 'running'});
        await call(context, '_onApiFlibGatewayUnderstandableStart', startParams, tabA);
        await vi.advanceTimersByTimeAsync(10000);
        await call(context, '_onApiFlibGatewayUnderstandablePoll', {jobId: 'job-1'}, tabA);
        await vi.advanceTimersByTimeAsync(10000);
        expect(gateway.understandableCancel).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(5000);
        expect(gateway.understandableCancel).toHaveBeenCalledTimes(1);
    });

    test('a terminal poll clears the watchdog', async () => {
        const {context, gateway} = makeContext({status: 'done'});
        await call(context, '_onApiFlibGatewayUnderstandableStart', startParams, tabA);
        await call(context, '_onApiFlibGatewayUnderstandablePoll', {jobId: 'job-1'}, tabA);
        expect(context._flibUnderstandableWatchdogs.size).toBe(0);
        await vi.advanceTimersByTimeAsync(60000);
        expect(gateway.understandableCancel).not.toHaveBeenCalled();
    });

    test('a cancel by the owner clears the watchdog: exactly one DELETE', async () => {
        const {context, gateway} = makeContext({status: 'running'});
        await call(context, '_onApiFlibGatewayUnderstandableStart', startParams, tabA);
        await call(context, '_onApiFlibGatewayUnderstandableCancel', {jobId: 'job-1'}, tabA);
        await vi.advanceTimersByTimeAsync(60000);
        expect(gateway.understandableCancel).toHaveBeenCalledTimes(1);
        expect(context._flibUnderstandableWatchdogs.size).toBe(0);
    });

    test('one open job per owner: a new start DELETEs the owner\'s previous job first; another owner\'s job stays', async () => {
        const {context, gateway} = makeContext({status: 'running'});
        /** @type {string[]} */
        const order = [];
        gateway.understandableCancel.mockImplementation(async (/** @type {string} */ id) => { order.push(`cancel ${id}`); });
        let counter = 0;
        gateway.understandableStart.mockImplementation(async () => {
            order.push('start');
            return {jobId: `job-${++counter}`, pollAfterMs: 1500};
        });
        await call(context, '_onApiFlibGatewayUnderstandableStart', startParams, tabB);
        await call(context, '_onApiFlibGatewayUnderstandableStart', startParams, tabA);
        await call(context, '_onApiFlibGatewayUnderstandableStart', startParams, tabA);
        expect(order).toEqual(['start', 'start', 'cancel job-2', 'start']);
        expect([...context._flibUnderstandableJobs.keys()].sort()).toEqual(['job-1', 'job-3']);
        expect(context._flibUnderstandableWatchdogs.has('job-2')).toBe(false);
        await vi.advanceTimersByTimeAsync(15000);
        // Only the two live jobs' watchdogs fire — job-2 was cancelled once, not twice.
        expect(gateway.understandableCancel.mock.calls.map((c) => c[0]).sort()).toEqual(['job-1', 'job-2', 'job-3']);
    });

    test('polish: a slow poll (18 s) does not let the watchdog DELETE the job; it is re-armed after a non-terminal poll', async () => {
        const {context, gateway} = makeContext({status: 'running'});
        await call(context, '_onApiFlibGatewayUnderstandableStart', startParams, tabA);
        gateway.understandablePoll.mockImplementation(() => new Promise((resolve) => {
            setTimeout(() => resolve({status: 'running', partial: false, errorCode: null, results: null}), 18000);
        }));
        const pending = call(context, '_onApiFlibGatewayUnderstandablePoll', {jobId: 'job-1'}, tabA);
        await vi.advanceTimersByTimeAsync(18000);
        await pending;
        expect(gateway.understandableCancel).not.toHaveBeenCalled();
        expect(context._flibUnderstandableJobs.has('job-1')).toBe(true);
        expect(context._flibUnderstandableWatchdogs.has('job-1')).toBe(true);
        await vi.advanceTimersByTimeAsync(14999);
        expect(gateway.understandableCancel).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        expect(gateway.understandableCancel).toHaveBeenCalledWith('job-1');
    });

    test('polish: a never-settling DELETE of the replaced job delays the new start by at most the 2 s cap', async () => {
        const {context, gateway} = makeContext({status: 'running'});
        await call(context, '_onApiFlibGatewayUnderstandableStart', startParams, tabA);
        gateway.understandableCancel.mockImplementation(() => new Promise(() => {}));
        let started = false;
        const pending = call(context, '_onApiFlibGatewayUnderstandableStart', startParams, tabA).then((r) => {
            started = true;
            return r;
        });
        await vi.advanceTimersByTimeAsync(1999);
        expect(started).toBe(false);
        await vi.advanceTimersByTimeAsync(1);
        expect(await pending).toStrictEqual({jobId: 'job-2', pollAfterMs: 1500});
    });

    test('a failing DELETE of the previous job does not block the new start', async () => {
        const logSpy = vi.spyOn(log, 'log').mockImplementation(() => {});
        const {context, gateway} = makeContext({status: 'running'});
        await call(context, '_onApiFlibGatewayUnderstandableStart', startParams, tabA);
        gateway.understandableCancel.mockImplementationOnce(async () => { throw new Error('flib_network'); });
        const result = await call(context, '_onApiFlibGatewayUnderstandableStart', startParams, tabA);
        expect(result).toStrictEqual({jobId: 'job-2', pollAfterMs: 1500});
        expect([...context._flibUnderstandableJobs.keys()]).toEqual(['job-2']);
        expect(logSpy).toHaveBeenCalledTimes(1);
        logSpy.mockRestore();
    });
});

/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */
