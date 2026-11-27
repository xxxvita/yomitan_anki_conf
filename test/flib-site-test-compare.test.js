/*
 * Copyright (C) 2023-2025  Yomitan Authors
 * Copyright (C) 2020-2022  Yomichan Authors
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
import {compareWithBaseline, settleFlaky} from '../dev/flib-site-test.js';

describe('compareWithBaseline', () => {
    const baseline = {passed: ['a › one', 'a › two'], failed: ['b › broken'], skipped: ['c › later']};

    test('identical results: nothing to report', () => {
        const results = {passed: ['a › one', 'a › two', 'c › later'], failed: ['b › broken'], skipped: []};
        expect(compareWithBaseline(baseline, results)).toStrictEqual({newlyFailing: [], newlyPassing: [], missing: []});
    });

    test('passed on the site, failed here: newlyFailing', () => {
        const results = {passed: ['a › one'], failed: ['a › two', 'b › broken'], skipped: ['c › later']};
        expect(compareWithBaseline(baseline, results).newlyFailing).toStrictEqual(['a › two']);
    });

    test('failed on the site, passed here: newlyPassing, not an error', () => {
        const results = {passed: ['a › one', 'a › two', 'b › broken'], failed: [], skipped: []};
        const diff = compareWithBaseline(baseline, results);
        expect(diff.newlyPassing).toStrictEqual(['b › broken']);
        expect(diff.newlyFailing).toStrictEqual([]);
    });

    test('a baseline test that did not run: missing', () => {
        const results = {passed: ['a › one'], failed: [], skipped: []};
        expect(compareWithBaseline(baseline, results).missing).toStrictEqual(['a › two', 'b › broken', 'c › later']);
    });

    test('a baseline-passed test that is only skipped here is not silently fine', () => {
        const results = {passed: ['a › one'], failed: [], skipped: ['a › two', 'b › broken', 'c › later']};
        expect(compareWithBaseline(baseline, results).missing).toStrictEqual(['a › two']);
    });

    test('tests that are new here are ignored', () => {
        const results = {passed: ['a › one', 'a › two', 'z › extra'], failed: [], skipped: ['c › later']};
        expect(compareWithBaseline(baseline, results).newlyFailing).toStrictEqual([]);
    });
});

describe('settleFlaky', () => {
    const baseline = {passed: ['web/a.test.ts › one', 'web/b.test.ts › two'], failed: [], skipped: []};

    test('a failure that passes on the second run is flaky, not an error', () => {
        const results = {passed: ['web/b.test.ts › two'], failed: ['web/a.test.ts › one'], skipped: []};
        /** @type {string[][]} */
        const calls = [];
        const {diff, flaky} = settleFlaky(baseline, results, (files) => {
            calls.push(files);
            return {passed: ['web/a.test.ts › one'], failed: [], skipped: []};
        });
        expect(calls).toStrictEqual([['a.test.ts']]);
        expect(flaky).toStrictEqual(['web/a.test.ts › one']);
        expect(diff).toStrictEqual({newlyFailing: [], newlyPassing: [], missing: []});
    });

    test('a failure that fails again stays newlyFailing', () => {
        const results = {passed: ['web/b.test.ts › two'], failed: ['web/a.test.ts › one'], skipped: []};
        const {diff, flaky} = settleFlaky(baseline, results, () => ({passed: [], failed: ['web/a.test.ts › one'], skipped: []}));
        expect(flaky).toStrictEqual([]);
        expect(diff.newlyFailing).toStrictEqual(['web/a.test.ts › one']);
    });

    test('no rerun when nothing is wrong', () => {
        const results = {passed: [...baseline.passed], failed: [], skipped: []};
        const {flaky} = settleFlaky(baseline, results, () => { throw new Error('must not rerun'); });
        expect(flaky).toStrictEqual([]);
    });
});
