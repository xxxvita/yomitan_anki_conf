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

import {describe, expect, test} from 'vitest';
import {parseKeyAccess, usageShare} from '../ext/js/data/flib-key-access.js';
import {parseJson} from '../ext/js/core/json.js';

/**
 * The gateway's own example (docs/client-spec.md), all sections present.
 * @returns {{el_limits: Record<string, unknown>} & Record<string, unknown>}
 */
function fullBody() {
    return {
        key_prefix: 'tpk_1a2b',
        demo: false,
        key_expires_at: '2026-12-31T00:00:00Z',
        capabilities: [
            {capability: 'examples', active_now: true, in_window_now: true, valid_from: '2026-06-01', valid_to: '2079-06-06', permanent: true, usable_now: true},
            {capability: 'route', active_now: false, in_window_now: false, valid_from: '2026-01-01', valid_to: '2026-05-31', permanent: false, usable_now: false},
        ],
        el_limits: {
            stt: {used_min: 2, limit_min: 73.2, remaining_min: 71.2, used: 120, limit: 4392, remaining: 4272, unit: 'seconds', exempt: false},
            tts: {used_min: 12, limit_min: 25, remaining_min: 13, used: 12000, limit: 25000, remaining: 13000, unit: 'chars', exempt: false},
            gpt: {used_usd: 0.37, limit_usd: 1, remaining_usd: 0.63, used_microusd: 370000, limit_microusd: 1000000, remaining_microusd: 630000, exempt: false},
            resets_at: '2026-12-01T00:00:00Z',
            minutes_nominal: true,
        },
    };
}

/**
 * @returns {Record<string, unknown>}
 */
function gptBody() {
    return /** @type {Record<string, unknown>} */ (fullBody().el_limits.gpt);
}

/**
 * @param {Record<string, unknown>} patch
 * @returns {import('flib-gateway').KeyAccess}
 * @throws {Error}
 */
function parseWith(patch) {
    const result = parseKeyAccess({...fullBody(), ...patch});
    if (result === null) { throw new Error('expected a parsed body'); }
    return result;
}

/**
 * @param {string} axis
 * @param {unknown} value
 * @returns {import('flib-gateway').KeyAccess}
 */
function parseAxis(axis, value) {
    return parseWith({el_limits: {...fullBody().el_limits, [axis]: value}});
}

describe('parseKeyAccess', () => {
    test('the full answer', () => {
        expect(parseKeyAccess(fullBody())).toStrictEqual({
            keyPrefix: 'tpk_1a2b',
            expiresAt: '2026-12-31T00:00:00Z',
            demo: false,
            rights: [
                {id: 'examples', usable: true, permanent: true, validFrom: '2026-06-01', validTo: '2079-06-06'},
                {id: 'route', usable: false, permanent: false, validFrom: '2026-01-01', validTo: '2026-05-31'},
            ],
            gpt: {used: 370000, limit: 1000000, unlimited: false},
            tts: {used: 12000, limit: 25000, unlimited: false},
            stt: {used: 120, limit: 4392, unlimited: false},
            resetsAt: '2026-12-01T00:00:00Z',
            gptTokens: null,
            examplesQuota: null,
        });
    });

    test('the smallest body of the contract: everything optional is absent', () => {
        expect(parseKeyAccess({capabilities: []})).toStrictEqual({
            keyPrefix: null,
            expiresAt: null,
            demo: true,
            rights: [],
            gpt: null,
            tts: null,
            stt: null,
            resetsAt: null,
            gptTokens: null,
            examplesQuota: null,
        });
    });

    test('the optional fields the gateway does not send yet', () => {
        const result = parseAxis('gpt', {...gptBody(), input_tokens: 1200, output_tokens: 0});
        expect(result.gptTokens).toStrictEqual({input: 1200, output: 0});
        expect(parseWith({examples_quota: {used: 7, limit: 50}}).examplesQuota).toStrictEqual({used: 7, limit: 50});
        expect(parseWith({examples_quota: {used: 7, limit: null}}).examplesQuota).toStrictEqual({used: 7, limit: null});
    });

    test.each([
        [{input_tokens: 1}], [{output_tokens: 1}], [{input_tokens: '1', output_tokens: 2}], [{input_tokens: -1, output_tokens: 2}],
    ])('half or broken tokens %j → null, the share stays', (tokens) => {
        const result = parseAxis('gpt', {...gptBody(), ...tokens});
        expect(result.gptTokens).toBeNull();
        expect(result.gpt).toStrictEqual({used: 370000, limit: 1000000, unlimited: false});
    });

    test('tokens survive a broken cost', () => {
        const result = parseAxis('gpt', {used_microusd: 'x', limit_microusd: 1, input_tokens: 3, output_tokens: 4});
        expect(result.gpt).toBeNull();
        expect(result.gptTokens).toStrictEqual({input: 3, output: 4});
    });

    test.each([[{used: 7}], [{used: '7', limit: 50}], [{used: -1, limit: 50}], [{used: 1, limit: -50}], [[7, 50]], ['7/50'], [null]])('broken examples_quota %j → null', (value) => {
        expect(parseWith({examples_quota: value}).examplesQuota).toBeNull();
    });

    test.each([
        [null], [void 0], [42], ['x'], [true], [[]], [[{capabilities: []}]], [{}], [{capabilities: null}], [{capabilities: {}}], [{capabilities: 'examples'}], [{error: 'not found'}],
    ])('not this contract: %j → null', (body) => {
        expect(parseKeyAccess(body)).toBeNull();
    });

    test.each([[false, false], [true, true], [void 0, true], [null, true], [0, true], ['false', true], ['', true]])('demo %j → %j', (value, expected) => {
        expect(parseWith({demo: value}).demo).toBe(expected);
    });

    test.each([[void 0], [null]])('key_expires_at %j: the key has no expiry → null', (value) => {
        expect(parseWith({key_expires_at: value}).expiresAt).toBeNull();
    });

    test.each([
        ['garbage'], [''], [42], [true], [{}], [[]], ['2026-13-01T00:00:00Z'], ['2026-02-31T00:00:00Z'], ['2026-12-31T25:00:00Z'], ['31.12.2026'], ['key 1'], ['<b>2026-12-31</b>'],
    ])('key_expires_at %j is present but unreadable → \'\', never null', (value) => {
        expect(parseWith({key_expires_at: value}).expiresAt).toBe('');
    });

    test.each([['2026-12-31T00:00:00Z'], ['2026-12-31T23:59:59.123456789Z'], ['2026-12-31T00:00:00+05:00'], ['2026-12-31'], ['2028-02-29T00:00:00Z']])('key_expires_at %j is kept', (value) => {
        expect(parseWith({key_expires_at: value}).expiresAt).toBe(value);
    });

    test.each([[void 0], [null], [42], [''], [{}], [`tpk_${'a'.repeat(32)}`]])('key_prefix %j → null (a whole key is not a prefix)', (value) => {
        expect(parseWith({key_prefix: value}).keyPrefix).toBeNull();
    });

    test('a capability without a string id is skipped, the rest stay', () => {
        const good = {capability: 'locker', usable_now: true};
        expect(parseWith({capabilities: [null, 1, 'x', [], {}, {capability: 5}, {capability: null}, {capability: ''}, good]}).rights).toStrictEqual([
            {id: 'locker', usable: true, permanent: false, validFrom: null, validTo: null},
        ]);
    });

    test.each([
        [{usable_now: true, active_now: false}, true],
        [{usable_now: false, active_now: true}, false],
        [{active_now: true}, true],
        [{active_now: false}, false],
        [{}, false],
        [{active_now: 'true'}, false],
        [{usable_now: 'true', active_now: true}, false],
        [{usable_now: 1}, false],
    ])('usable of %j → %j', (fields, expected) => {
        expect(parseWith({capabilities: [{capability: 'x', ...fields}]}).rights[0].usable).toBe(expected);
    });

    test.each([
        [{permanent: 'yes', valid_from: 5, valid_to: {}}],
        [{valid_from: 'soon', valid_to: '2026-02-31'}],
        [{valid_from: '', valid_to: '2026-12-31T00:00:00Z'}],
    ])('wrong window fields %j → not permanent, no dates', (fields) => {
        expect(parseWith({capabilities: [{capability: 'x', active_now: true, ...fields}]}).rights).toStrictEqual([
            {id: 'x', usable: true, permanent: false, validFrom: null, validTo: null},
        ]);
    });

    test.each([[void 0], [null], ['x'], [[]], [5]])('el_limits %j → no usage, not zeroes', (value) => {
        expect(parseWith({el_limits: value})).toMatchObject({gpt: null, tts: null, stt: null, resetsAt: null, gptTokens: null});
    });

    test('a section that is absent or not an object → null for it only', () => {
        const limits = fullBody().el_limits;
        delete limits.gpt;
        limits.stt = 'x';
        expect(parseWith({el_limits: limits})).toMatchObject({gpt: null, stt: null, tts: {used: 12000, limit: 25000, unlimited: false}});
    });

    test.each([[void 0], [null], [5], ['soon'], ['']])('resets_at %j → null', (value) => {
        expect(parseAxis('resets_at', value).resetsAt).toBeNull();
    });

    test.each(['tts', 'stt'])('%s: null limit or exempt → unlimited; 0 is a limit', (axis) => {
        expect(parseAxis(axis, {used: 5, limit: null, exempt: false})).toMatchObject({[axis]: {used: 5, limit: null, unlimited: true}});
        expect(parseAxis(axis, {used: 5, limit: 10, exempt: true})).toMatchObject({[axis]: {used: 5, limit: null, unlimited: true}});
        expect(parseAxis(axis, {used: 5, limit: 0})).toMatchObject({[axis]: {used: 5, limit: 0, unlimited: false}});
    });

    test('gpt: the share comes from *_microusd, not from used/limit or dollars', () => {
        expect(parseAxis('gpt', {used: 1, limit: 2, used_usd: 1, limit_usd: 2, used_microusd: 10, limit_microusd: null}).gpt).toStrictEqual({used: 10, limit: null, unlimited: true});
        expect(parseAxis('gpt', {used: 1, limit: 2}).gpt).toBeNull();
        expect(parseAxis('tts', {used_microusd: 1, limit_microusd: 2}).tts).toBeNull();
    });

    test.each([
        [{used: '5', limit: 10}],
        [{used: -1, limit: 10}],
        [{used: null, limit: 10}],
        [{limit: 10}],
        [{used: 5, limit: '10'}],
        [{used: 5, limit: -10}],
        [{used: 5}],
        [{used: 5, limit: true}],
        [{used: 5, limit: 10, exempt: 'true'}],
        [{used: 5, limit: 10, exempt: null}],
        [{used: 5, limit: '10', exempt: true}],
        [{used: Number.NaN, limit: 10}],
        [{used: 5, limit: Number.POSITIVE_INFINITY}],
    ])('broken usage %j → no data', (value) => {
        expect(parseAxis('tts', value).tts).toBeNull();
    });

    test('1e999 in the JSON is infinite → no data', () => {
        const result = parseKeyAccess(parseJson('{"capabilities":[],"el_limits":{"tts":{"used":1e999,"limit":10},"stt":{"used":1,"limit":1e999}}}'));
        expect(result).toMatchObject({tts: null, stt: null});
    });

    test('server text is kept as plain text, unknown fields do not pass', () => {
        const result = parseWith({capabilities: [{capability: '<img src=x onerror=1>', active_now: true, extra: 'x'}], media_traffic: {note: 'x'}, secret: 'x'});
        expect(result.rights[0].id).toBe('<img src=x onerror=1>');
        expect(Object.keys(result.rights[0])).toStrictEqual(['id', 'usable', 'permanent', 'validFrom', 'validTo']);
        expect(Object.keys(result)).not.toContain('secret');
    });
});

describe('usageShare', () => {
    test.each([
        ['nothing spent', 0, 1000, {spentPercent: 0, leftPercent: 100, underOne: false, exhausted: false}],
        ['0.4 %', 4, 1000, {spentPercent: 0, leftPercent: 100, underOne: true, exhausted: false}],
        ['0.999 %', 999, 100000, {spentPercent: 0, leftPercent: 100, underOne: true, exhausted: false}],
        ['1 %', 10, 1000, {spentPercent: 1, leftPercent: 99, underOne: false, exhausted: false}],
        ['29 % (not 28.999…)', 29, 100, {spentPercent: 29, leftPercent: 71, underOne: false, exhausted: false}],
        ['37 %', 370000, 1000000, {spentPercent: 37, leftPercent: 63, underOne: false, exhausted: false}],
        ['99.6 %', 996, 1000, {spentPercent: 99, leftPercent: 1, underOne: false, exhausted: false}],
        ['all spent', 1000, 1000, {spentPercent: 100, leftPercent: 0, underOne: false, exhausted: true}],
        ['over the limit', 1500, 1000, {spentPercent: 100, leftPercent: 0, underOne: false, exhausted: true}],
        ['limit 0, spent 0', 0, 0, {spentPercent: 100, leftPercent: 0, underOne: false, exhausted: true}],
        ['limit 0, spent 5', 5, 0, {spentPercent: 100, leftPercent: 0, underOne: false, exhausted: true}],
        ['huge numbers do not overflow', 1e307, 1.7e308, {spentPercent: 5, leftPercent: 95, underOne: false, exhausted: false}],
    ])('%s', (_name, used, limit, expected) => {
        expect(usageShare({used, limit, unlimited: false})).toStrictEqual(expected);
    });

    test('unlimited → null: there is no share', () => {
        expect(usageShare({used: 5, limit: null, unlimited: true})).toBeNull();
        expect(usageShare({used: 5, limit: 0, unlimited: true})).toBeNull();
        expect(usageShare({used: 5, limit: null, unlimited: false})).toBeNull();
    });

    test('never 100 % while something is left', () => {
        // (limit - 1) * 100 / limit rounds to exactly 100 here.
        const limit = Number.MAX_SAFE_INTEGER - 1;
        expect(usageShare({used: limit - 1, limit, unlimited: false})).toMatchObject({spentPercent: 99, leftPercent: 1, exhausted: false});
    });
});
