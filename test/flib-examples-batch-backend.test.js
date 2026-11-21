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

/* eslint-disable no-underscore-dangle, @typescript-eslint/unbound-method */

// eslint-disable-next-line jsdoc/no-undefined-types
/** @typedef {chrome.runtime.MessageSender} Sender */
const EXT_ID = 'abcdefghijklmnop';
const EXT_BASE = `chrome-extension://${EXT_ID}/`;
const tabA = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}popup.html`, tab: {id: 1}, frameId: 2});
const tabB = /** @type {Sender} */ ({id: EXT_ID, url: `${EXT_BASE}popup.html`, tab: {id: 7}, frameId: 2});
const contentScript = /** @type {Sender} */ ({id: EXT_ID, url: 'https://example.com/', tab: {id: 1}, frameId: 0});

/** @typedef {{_flibUnderstandableJobs: Map<string, string>}} Ctx */

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
        _getExtensionBaseUrl: () => EXT_BASE,
        _getExtensionId: () => EXT_ID,
        _canSenderReadFlibSecrets: Backend.prototype._canSenderReadFlibSecrets,
        _requireFlibPageSender: Backend.prototype._requireFlibPageSender,
        _getFlibJobOwner: Backend.prototype._getFlibJobOwner,
    };
    return {context, gateway};
}

const targets = [{text: 'give up', mode: /** @type {const} */ ('quote')}];

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

    test('keeps at most 50 jobs, oldest dropped', async () => {
        const {context} = makeContext();
        for (let i = 0; i < 51; ++i) {
            await call(context, '_onApiFlibGatewayUnderstandableStart', {targets, limit: 5, excludeVideoIds: []}, tabA);
        }
        expect(context._flibUnderstandableJobs.size).toBe(50);
        expect(context._flibUnderstandableJobs.has('job-1')).toBe(false);
        expect(context._flibUnderstandableJobs.has('job-51')).toBe(true);
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

/* eslint-enable no-underscore-dangle, @typescript-eslint/unbound-method */
