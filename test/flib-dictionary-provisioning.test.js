/*
 * Copyright (C) 2025  Yomitan Authors
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

import {createHash} from 'node:crypto';
import {describe, expect, test, vi} from 'vitest';
import {
    FLIB_DICTIONARIES_BASE_URL,
    FLIB_DICTIONARIES_MANIFEST_URL,
    FLIB_DICTIONARY_TITLES,
    FLIB_MAX_ZIP_SIZE,
    FLIB_RETRY_DELAY_MS,
    checkInstalledPair,
    computeProvisioningPlan,
    provisionFlibDictionaries,
    shouldForceWelcome,
    validateRemoteManifest,
} from '../ext/js/data/flib-dictionary-provisioning.js';

const REVISION = '100-200-abcdef012345';
const OLD_REVISION = '90-190-0123456789ab';
const [HOST, TRANSLATION] = FLIB_DICTIONARY_TITLES;

/**
 * @param {string} text
 * @returns {Uint8Array}
 */
function bytes(text) {
    return new TextEncoder().encode(text);
}

/**
 * @param {Uint8Array} data
 * @returns {string}
 */
function sha256(data) {
    return createHash('sha256').update(data).digest('hex');
}

/** @type {Record<string, Uint8Array>} */
const ZIP_BYTES = {
    [HOST]: bytes('host-zip-bytes'),
    [TRANSLATION]: bytes('translation-zip-bytes-longer'),
};

/**
 * @param {string} title
 * @returns {import('flib-dictionary-provisioning').RemoteManifestEntry}
 */
function entry(title) {
    const data = ZIP_BYTES[title];
    return {
        title,
        file: `${title}.zip`,
        url: `${FLIB_DICTIONARIES_BASE_URL}${REVISION}/${title}.zip`,
        size: data.byteLength,
        sha256: sha256(data),
    };
}

/**
 * @returns {import('flib-dictionary-provisioning').RemoteManifest}
 */
function manifest() {
    return {
        schema: 1,
        revision: REVISION,
        published_at: '2026-10-18T10:00:00Z',
        dictionaries: [entry(HOST), entry(TRANSLATION)],
    };
}

/**
 * @param {unknown} value
 * @returns {string}
 * @throws {Error} When the value unexpectedly validates.
 */
function validationError(value) {
    const result = validateRemoteManifest(value);
    if (result.ok) { throw new Error('expected a validation error'); }
    return result.error;
}

describe('validateRemoteManifest', () => {
    test('accepts a well-formed manifest', () => {
        const result = validateRemoteManifest(manifest());
        expect(result.ok).toBe(true);
    });
    test('the manifest URL is derived from the single base constant', () => {
        expect(FLIB_DICTIONARIES_MANIFEST_URL).toBe(`${FLIB_DICTIONARIES_BASE_URL}latest.json`);
        expect(FLIB_DICTIONARIES_BASE_URL.startsWith('https://')).toBe(true);
        expect(FLIB_DICTIONARIES_BASE_URL.endsWith('/')).toBe(true);
    });
    test.each([null, [], 'x', 1])('rejects a non-object %j', (value) => {
        expect(validationError(value)).toMatch(/object/);
    });
    test.each([2, '1', null])('rejects schema %j', (schema) => {
        expect(validationError({...manifest(), schema})).toMatch(/schema/);
    });
    test.each(['', '   ', 5, null, 'has space'])('rejects revision %j', (revision) => {
        expect(validationError({...manifest(), revision})).toMatch(/revision/);
    });
    test.each(['', 'yesterday', 7])('rejects published_at %j', (value) => {
        expect(validationError({...manifest(), published_at: value})).toMatch(/published_at/);
    });
    test.each([null, {}, []])('rejects dictionaries %j', (dictionaries) => {
        expect(validationError({...manifest(), dictionaries})).toMatch(/dictionaries/);
    });
    test('rejects an empty title', () => {
        const m = manifest();
        m.dictionaries[0] = {...m.dictionaries[0], title: ''};
        expect(validationError(m)).toMatch(/title/);
    });
    test('rejects a title outside the pair (it could delete a user dictionary)', () => {
        const m = manifest();
        m.dictionaries[0] = {...m.dictionaries[0], title: 'JMdict'};
        expect(validationError(m)).toMatch(/JMdict/);
    });
    test('rejects a duplicated title', () => {
        const m = manifest();
        m.dictionaries[1] = {...m.dictionaries[0]};
        expect(validationError(m)).toMatch(/duplicate|twice/i);
    });
    test('rejects a manifest missing half of the pair', () => {
        const m = manifest();
        m.dictionaries.pop();
        expect(validationError(m)).toMatch(new RegExp(TRANSLATION));
    });
    test.each([
        ['http', `http://${new URL(FLIB_DICTIONARIES_BASE_URL).host}/dictionaries/x/wty-en-en.zip`],
        ['foreign host', 'https://evil.example.com/dictionaries/x/wty-en-en.zip'],
        ['outside the base path', `https://${new URL(FLIB_DICTIONARIES_BASE_URL).host}/other/wty-en-en.zip`],
        ['credentials', `https://user:pw@${new URL(FLIB_DICTIONARIES_BASE_URL).host}/dictionaries/x/wty-en-en.zip`],
        ['relative', '/dictionaries/x/wty-en-en.zip'],
        ['file mismatch', `${FLIB_DICTIONARIES_BASE_URL}x/other.zip`],
    ])('rejects url (%s)', (_name, url) => {
        const m = manifest();
        m.dictionaries[0] = {...m.dictionaries[0], url};
        expect(validationError(m)).toMatch(/url/);
    });
    test.each(['../x.zip', 'a.tar', '', 'a/b.zip'])('rejects file %j', (file) => {
        const m = manifest();
        m.dictionaries[0] = {...m.dictionaries[0], file};
        expect(validationError(m)).toMatch(/file/);
    });
    test.each([0, -1, 1.5, '10', Number.NaN])('rejects size %j', (size) => {
        /** @type {Record<string, unknown>} */
        const m = manifest();
        m.dictionaries = [{...manifest().dictionaries[0], size}];
        expect(validationError(m)).toMatch(/size/);
    });
    test.each(['abc', 'A'.repeat(64), 'g'.repeat(64)])('rejects sha256 %j', (value) => {
        const m = manifest();
        m.dictionaries[0] = {...m.dictionaries[0], sha256: value};
        expect(validationError(m)).toMatch(/sha256/);
    });
    test('ignores unknown extra keys', () => {
        expect(validateRemoteManifest({...manifest(), extra: true}).ok).toBe(true);
    });
});

describe('computeProvisioningPlan', () => {
    /**
     * @param {import('flib-dictionary-provisioning').InstalledDictionary[]} installed
     * @returns {string[]}
     */
    const plan = (installed) => computeProvisioningPlan(manifest(), installed).map(({entry: e, action, reason}) => `${e.title}:${action}:${reason}`);

    test('imports everything when nothing is installed', () => {
        expect(plan([])).toEqual([`${HOST}:import:missing`, `${TRANSLATION}:import:missing`]);
    });
    test('skips a title installed at the manifest revision', () => {
        expect(plan([{title: HOST, revision: REVISION, importSuccess: true}])).toEqual([`${HOST}:skip:current`, `${TRANSLATION}:import:missing`]);
    });
    test('treats a pre-field import (no importSuccess) as complete', () => {
        expect(plan([{title: HOST, revision: REVISION}, {title: TRANSLATION, revision: REVISION}])).toEqual([`${HOST}:skip:current`, `${TRANSLATION}:skip:current`]);
    });
    test('replaces a title installed at another revision', () => {
        expect(plan([{title: HOST, revision: OLD_REVISION, importSuccess: true}, {title: TRANSLATION, revision: REVISION, importSuccess: true}]))
            .toEqual([`${HOST}:replace:outdated`, `${TRANSLATION}:skip:current`]);
    });
    test('replaces a half-imported title even at the manifest revision', () => {
        expect(plan([{title: HOST, revision: REVISION, importSuccess: false}])).toEqual([`${HOST}:replace:incomplete`, `${TRANSLATION}:import:missing`]);
    });
    test('ignores unrelated dictionaries', () => {
        expect(plan([{title: 'JMdict', revision: 'x', importSuccess: false}])).toEqual([`${HOST}:import:missing`, `${TRANSLATION}:import:missing`]);
    });
});

describe('checkInstalledPair', () => {
    test('ok when both titles are complete at the manifest revision', () => {
        expect(checkInstalledPair(manifest(), [{title: HOST, revision: REVISION, importSuccess: true}, {title: TRANSLATION, revision: REVISION}])).toEqual({ok: true});
    });
    test('reports a missing title', () => {
        const result = checkInstalledPair(manifest(), [{title: HOST, revision: REVISION}]);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.message).toMatch(new RegExp(TRANSLATION));
    });
    test('reports an unfinished import', () => {
        const result = checkInstalledPair(manifest(), [{title: HOST, revision: REVISION, importSuccess: false}, {title: TRANSLATION, revision: REVISION}]);
        expect(!result.ok && result.message).toMatch(/не завершён/);
    });
    test('reports mismatched revisions naming both', () => {
        const result = checkInstalledPair(manifest(), [{title: HOST, revision: OLD_REVISION}, {title: TRANSLATION, revision: REVISION}]);
        expect(result.ok).toBe(false);
        expect(!result.ok && result.message).toMatch(/не совпадают/);
        expect(!result.ok && result.message).toContain(OLD_REVISION);
        expect(!result.ok && result.message).toContain(REVISION);
    });
});

/**
 * @typedef {object} FakeOptions
 * @property {unknown} [manifestBody]
 * @property {number} [manifestStatus]
 * @property {boolean} [offline]
 * @property {import('flib-dictionary-provisioning').InstalledDictionary[]} [installed]
 * @property {import('flib-dictionary-provisioning').MarkerValue|null} [marker]
 * @property {number|null} [retryAfter]
 * @property {Record<string, Uint8Array>} [zipBytes] Bytes served per title.
 * @property {Record<string, number>} [zipStatus]
 * @property {Record<string, string>} [importedRevision] Revision the import "finds" in the zip, per title.
 * @property {Record<string, Error[]>} [importErrors]
 * @property {boolean} [lockBusy]
 * @property {boolean} [dictionaryInfoThrows]
 * @property {boolean} [getMarkerThrows]
 * @property {boolean} [stall] Zip requests never answer (until aborted).
 */

const NOW = 1_800_000_000_000;

/**
 * @param {FakeOptions} options
 * @returns {{deps: import('flib-dictionary-provisioning').ProvisioningDependencies, calls: string[], statuses: import('flib-dictionary-provisioning').ProvisioningStatus[], imports: {file: File, replaceTitle: ?string}[], readonly marker: import('flib-dictionary-provisioning').MarkerValue|null, readonly retryAfter: number|null, readonly installed: import('flib-dictionary-provisioning').InstalledDictionary[]}}
 */
function createFakes(options = {}) {
    /** @type {string[]} */
    const calls = [];
    /** @type {import('flib-dictionary-provisioning').ProvisioningStatus[]} */
    const statuses = [];
    let installed = [...(options.installed ?? [])];
    /** @type {import('flib-dictionary-provisioning').MarkerValue|null} */
    let marker = options.marker ?? null;
    /** @type {number|null} */
    let retryAfter = options.retryAfter ?? null;
    /** @type {{file: File, replaceTitle: ?string}[]} */
    const imports = [];
    const zipBytes = options.zipBytes ?? ZIP_BYTES;

    /** @type {import('flib-dictionary-provisioning').ProvisioningDependencies} */
    const deps = {
        fetch: async (url, init) => {
            calls.push(`fetch:${url}`);
            if (options.offline) { throw new TypeError('NetworkError when attempting to fetch resource.'); }
            if (options.stall && url !== FLIB_DICTIONARIES_MANIFEST_URL) {
                return await new Promise((_resolve, reject) => {
                    init?.signal?.addEventListener('abort', () => { reject(new DOMException('aborted', 'AbortError')); });
                });
            }
            if (url === FLIB_DICTIONARIES_MANIFEST_URL) {
                const body = options.manifestBody ?? manifest();
                return new Response(typeof body === 'string' ? body : JSON.stringify(body), {status: options.manifestStatus ?? 200});
            }
            for (const title of FLIB_DICTIONARY_TITLES) {
                if (url === entry(title).url) {
                    calls.push(`fetch-cache:${init?.cache}`);
                    const status = options.zipStatus?.[title] ?? 200;
                    return new Response(status === 200 ? zipBytes[title] : null, {status});
                }
            }
            return new Response(null, {status: 404});
        },
        getDictionaryInfo: async () => {
            calls.push('getDictionaryInfo');
            if (options.dictionaryInfoThrows) { throw new Error('A mutation operation was attempted on a database that did not allow mutations.'); }
            return installed.map((x) => ({...x}));
        },
        getMarker: async () => {
            calls.push('getMarker');
            if (options.getMarkerThrows) { throw new Error('storage broken'); }
            return marker;
        },
        setMarker: async (value) => {
            calls.push(`setMarker:${value}`);
            marker = value;
        },
        setRetryAfter: async (value) => {
            calls.push(`setRetryAfter:${value}`);
            retryAfter = value;
        },
        now: () => NOW,
        sha256Hex: async (data) => sha256(new Uint8Array(data)),
        importFile: async (file, replaceTitle) => {
            const title = file.name.replace(/\.zip$/, '');
            calls.push(`import:${title}:${replaceTitle === null ? 'new' : 'replace'}`);
            imports.push({file, replaceTitle});
            if (replaceTitle !== null) { installed = installed.filter((x) => x.title !== replaceTitle); }
            const errors = options.importErrors?.[title];
            if (errors) { return errors; }
            installed.push({title, revision: options.importedRevision?.[title] ?? REVISION, importSuccess: true});
            return [];
        },
        withExclusiveLock: async (callback) => {
            if (options.lockBusy) { return null; }
            return await callback();
        },
        onStatus: (status) => { statuses.push(status); },
    };
    return {
        deps,
        calls,
        statuses,
        imports,
        get marker() { return marker; },
        get retryAfter() { return retryAfter; },
        get installed() { return installed; },
    };
}

/**
 * @param {string[]} calls
 * @returns {string[]}
 */
const destructive = (calls) => calls.filter((c) => c.startsWith('import:'));

/**
 * @param {ReturnType<typeof createFakes>} f
 * @returns {string|false}
 */
const failedMessage = (f) => {
    const last = f.statuses.at(-1);
    return last?.state === 'failed' && last.message;
};

describe('shouldForceWelcome', () => {
    test.each([
        ['in-progress always forces', 'in-progress', NOW + 1000, true],
        ['done never forces', true, null, false],
        ['no marker, no retryAfter forces', null, null, true],
        ['no marker, retryAfter in the future does not force', null, NOW + 1, false],
        ['no marker, retryAfter reached forces', null, NOW, true],
        ['garbage marker counts as unset', 'yes', null, true],
        ['garbage retryAfter counts as unset', null, 'tomorrow', true],
    ])('%s', (_name, marker, retryAfter, expected) => {
        expect(shouldForceWelcome(marker, retryAfter, NOW)).toBe(expected);
    });
});

describe('provisionFlibDictionaries', () => {
    test('first run with the marker set does nothing', async () => {
        const f = createFakes({marker: true});
        expect(await provisionFlibDictionaries(f.deps, 'first-run')).toBe('already-done');
        expect(f.calls).toEqual(['getMarker']);
    });

    test('first run continues an in-progress install', async () => {
        const f = createFakes({marker: 'in-progress'});
        expect(await provisionFlibDictionaries(f.deps, 'first-run')).toBe('installed');
    });

    test('first run imports the whole pair in manifest order, sets the marker and clears retryAfter', async () => {
        const f = createFakes({retryAfter: NOW - 5});
        expect(await provisionFlibDictionaries(f.deps, 'first-run')).toBe('installed');
        expect(destructive(f.calls)).toEqual([`import:${HOST}:new`, `import:${TRANSLATION}:new`]);
        expect(f.marker).toBe(true);
        expect(f.retryAfter).toBe(null);
        expect(f.statuses.at(-1)).toEqual({state: 'installed'});
        const downloading = f.statuses.filter((s) => s.state === 'downloading');
        expect(downloading.some((s) => s.state === 'downloading' && s.index === 1 && s.count === 2)).toBe(true);
        expect(downloading.some((s) => s.state === 'downloading' && s.index === 2 && s.count === 2)).toBe(true);
        expect(f.imports.map(({file}) => file.name)).toEqual([`${HOST}.zip`, `${TRANSLATION}.zip`]);
        expect(new Uint8Array(await f.imports[0].file.arrayBuffer())).toEqual(ZIP_BYTES[HOST]);
    });

    test('zips are fetched with cache: no-cache', async () => {
        const f = createFakes();
        await provisionFlibDictionaries(f.deps, 'first-run');
        expect(f.calls.filter((c) => c.startsWith('fetch-cache:'))).toEqual(['fetch-cache:no-cache', 'fetch-cache:no-cache']);
    });

    test('two phases: every zip is downloaded and verified before the first import', async () => {
        const f = createFakes({installed: [{title: HOST, revision: OLD_REVISION}, {title: TRANSLATION, revision: OLD_REVISION}], marker: true});
        await provisionFlibDictionaries(f.deps, 'repair');
        const lastDownload = f.calls.lastIndexOf(`fetch:${entry(TRANSLATION).url}`);
        const inProgress = f.calls.indexOf('setMarker:in-progress');
        const firstImport = f.calls.findIndex((c) => c.startsWith('import:'));
        expect(lastDownload).toBeGreaterThan(-1);
        expect(lastDownload).toBeLessThan(inProgress);
        expect(inProgress).toBeLessThan(firstImport);
        expect(f.calls.at(-2)).toBe('setMarker:true');
    });

    test('second download fails → nothing replaced, marker untouched (scenario D)', async () => {
        const f = createFakes({
            installed: [{title: HOST, revision: OLD_REVISION, importSuccess: true}, {title: TRANSLATION, revision: OLD_REVISION, importSuccess: true}],
            marker: true,
            zipStatus: {[TRANSLATION]: 404},
        });
        expect(await provisionFlibDictionaries(f.deps, 'repair')).toBe('failed');
        expect(destructive(f.calls)).toEqual([]);
        expect(f.calls.some((c) => c.startsWith('setMarker'))).toBe(false);
        expect(f.marker).toBe(true);
        expect(f.installed.map((x) => `${x.title}@${x.revision}`)).toEqual([`${HOST}@${OLD_REVISION}`, `${TRANSLATION}@${OLD_REVISION}`]);
    });

    test('repair ignores the marker and retryAfter', async () => {
        const f = createFakes({marker: true, retryAfter: NOW + 1000});
        expect(await provisionFlibDictionaries(f.deps, 'repair')).toBe('installed');
        expect(f.calls).not.toContain('getMarker');
    });

    test('skips a title already at the manifest revision', async () => {
        const f = createFakes({installed: [{title: HOST, revision: REVISION, importSuccess: true}]});
        expect(await provisionFlibDictionaries(f.deps, 'first-run')).toBe('installed');
        expect(destructive(f.calls)).toEqual([`import:${TRANSLATION}:new`]);
        expect(f.statuses.find((s) => s.state === 'downloading')).toMatchObject({index: 1, count: 1, title: TRANSLATION});
    });

    test('everything current: up-to-date, no download, marker set, retryAfter cleared', async () => {
        const f = createFakes({installed: [{title: HOST, revision: REVISION}, {title: TRANSLATION, revision: REVISION}], retryAfter: NOW + 9});
        expect(await provisionFlibDictionaries(f.deps, 'repair')).toBe('up-to-date');
        expect(f.calls.some((c) => c.startsWith('fetch:') && c !== `fetch:${FLIB_DICTIONARIES_MANIFEST_URL}`)).toBe(false);
        expect(f.marker).toBe(true);
        expect(f.retryAfter).toBe(null);
        expect(f.statuses.at(-1)).toEqual({state: 'up-to-date'});
    });

    test('replace hands the title to the controller (which captures settings and deletes inside its busy section)', async () => {
        const f = createFakes({
            marker: true,
            installed: [{title: HOST, revision: OLD_REVISION, importSuccess: true}, {title: TRANSLATION, revision: REVISION, importSuccess: true}],
        });
        expect(await provisionFlibDictionaries(f.deps, 'repair')).toBe('installed');
        expect(f.imports.map(({replaceTitle}) => replaceTitle)).toEqual([HOST]);
        expect(f.statuses.find((s) => s.state === 'importing')).toMatchObject({title: HOST, replace: true});
    });

    test('a half-installed pair (interrupted import) is repaired', async () => {
        const f = createFakes({installed: [{title: HOST, revision: REVISION, importSuccess: false}], marker: 'in-progress'});
        expect(await provisionFlibDictionaries(f.deps, 'first-run')).toBe('installed');
        expect(destructive(f.calls)).toEqual([`import:${HOST}:replace`, `import:${TRANSLATION}:new`]);
        expect(f.marker).toBe(true);
    });

    describe.each([
        ['404', {manifestStatus: 404}],
        ['invalid JSON', {manifestBody: '{not json'}],
        ['offline', {offline: true}],
        ['invalid manifest', {manifestBody: {...manifest(), schema: 9}}],
        ['IndexedDB unavailable', {dictionaryInfoThrows: true}],
    ])('unavailable: %s', (_name, options) => {
        test('quiet status, marker untouched, retryAfter = now + 24 h, nothing imported', async () => {
            const f = createFakes(/** @type {FakeOptions} */ (options));
            expect(await provisionFlibDictionaries(f.deps, 'first-run')).toBe('unavailable');
            expect(f.statuses.at(-1)).toEqual({state: 'unavailable'});
            expect(f.calls.filter((c) => c.startsWith('setMarker'))).toEqual([]);
            expect(f.retryAfter).toBe(NOW + FLIB_RETRY_DELAY_MS);
            expect(destructive(f.calls)).toEqual([]);
        });
    });

    test('unavailable during an in-progress repair keeps the marker in-progress', async () => {
        const f = createFakes({marker: 'in-progress', manifestStatus: 404});
        expect(await provisionFlibDictionaries(f.deps, 'first-run')).toBe('unavailable');
        expect(f.marker).toBe('in-progress');
    });

    test('sha256 mismatch fails before anything destructive and defers the next forced welcome', async () => {
        const f = createFakes({
            installed: [{title: HOST, revision: OLD_REVISION}, {title: TRANSLATION, revision: OLD_REVISION}],
            marker: true,
            zipBytes: {...ZIP_BYTES, [HOST]: bytes('host-zip-bytez')},
        });
        expect(await provisionFlibDictionaries(f.deps, 'repair')).toBe('failed');
        expect(destructive(f.calls)).toEqual([]);
        expect(f.marker).toBe(true);
        expect(f.retryAfter).toBe(NOW + FLIB_RETRY_DELAY_MS);
        expect(failedMessage(f)).toMatch(/контрольн/);
    });

    test('size mismatch fails', async () => {
        const f = createFakes({zipBytes: {...ZIP_BYTES, [HOST]: bytes('short')}});
        expect(await provisionFlibDictionaries(f.deps, 'first-run')).toBe('failed');
        expect(failedMessage(f)).toMatch(/размер/);
    });

    test('an oversized download is cut off and fails', async () => {
        const f = createFakes({zipBytes: {...ZIP_BYTES, [HOST]: bytes('host-zip-bytes-plus-extra')}});
        expect(await provisionFlibDictionaries(f.deps, 'first-run')).toBe('failed');
        expect(destructive(f.calls)).toEqual([]);
    });

    test('a manifest size above the limit is rejected before allocating', () => {
        const m = manifest();
        m.dictionaries[0] = {...m.dictionaries[0], size: FLIB_MAX_ZIP_SIZE + 1};
        expect(validationError(m)).toMatch(/size/);
        m.dictionaries[0] = {...m.dictionaries[0], size: FLIB_MAX_ZIP_SIZE};
        expect(validateRemoteManifest(m).ok).toBe(true);
    });

    test('a stalled zip download is aborted by the idle timeout and fails', async () => {
        vi.useFakeTimers();
        try {
            const f = createFakes({stall: true});
            const run = provisionFlibDictionaries(f.deps, 'first-run');
            await vi.advanceTimersByTimeAsync(61000);
            expect(await run).toBe('failed');
            expect(failedMessage(f)).toMatch(/не отвечает/);
        } finally {
            vi.useRealTimers();
        }
    });

    test('zip HTTP error fails', async () => {
        const f = createFakes({zipStatus: {[HOST]: 500}});
        expect(await provisionFlibDictionaries(f.deps, 'first-run')).toBe('failed');
        expect(f.marker).toBe(null);
    });

    test('import errors fail the run in Russian, stop, and leave the marker in-progress', async () => {
        const f = createFakes({importErrors: {[HOST]: [new Error('Dictionary has an incorrect format')]}});
        expect(await provisionFlibDictionaries(f.deps, 'first-run')).toBe('failed');
        expect(f.calls).not.toContain(`import:${TRANSLATION}:new`);
        expect(f.marker).toBe('in-progress');
        expect(failedMessage(f)).toBe(`ошибка импорта ${HOST} (Dictionary has an incorrect format)`);
    });

    test('a zip whose index revision differs from the manifest is a failure', async () => {
        const f = createFakes({importedRevision: {[TRANSLATION]: OLD_REVISION}});
        expect(await provisionFlibDictionaries(f.deps, 'first-run')).toBe('failed');
        expect(f.marker).toBe('in-progress');
        expect(failedMessage(f)).toMatch(/не совпадают/);
    });

    test('a lock held by another tab reports busy without fetching', async () => {
        const f = createFakes({lockBusy: true});
        expect(await provisionFlibDictionaries(f.deps, 'first-run')).toBe('busy');
        expect(f.calls.some((c) => c.startsWith('fetch:'))).toBe(false);
        expect(f.statuses.at(-1)).toEqual({state: 'busy'});
    });

    test('an unreadable marker counts as unset', async () => {
        const f = createFakes({getMarkerThrows: true});
        expect(await provisionFlibDictionaries(f.deps, 'first-run')).toBe('installed');
    });

    test('never throws, even when onStatus and setMarker throw', async () => {
        const f = createFakes();
        f.deps.onStatus = () => { throw new Error('render failed'); };
        f.deps.setMarker = async () => { throw new Error('quota'); };
        await expect(provisionFlibDictionaries(f.deps, 'first-run')).resolves.toBe('failed');
    });

    test('single-flight: concurrent calls share one run; a later call runs again', async () => {
        const f = createFakes();
        const a = provisionFlibDictionaries(f.deps, 'first-run');
        const b = provisionFlibDictionaries(f.deps, 'repair');
        expect(b).toBe(a);
        expect(await a).toBe('installed');
        expect(f.calls.filter((c) => c === `fetch:${FLIB_DICTIONARIES_MANIFEST_URL}`)).toHaveLength(1);
        expect(await provisionFlibDictionaries(f.deps, 'repair')).toBe('up-to-date');
        expect(f.calls.filter((c) => c === `fetch:${FLIB_DICTIONARIES_MANIFEST_URL}`)).toHaveLength(2);
    });
});
