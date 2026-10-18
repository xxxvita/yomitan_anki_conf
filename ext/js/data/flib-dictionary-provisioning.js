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

import {createTimeoutSignal} from '../core/abort-signal-util.js';
import {parseJson} from '../core/json.js';
import {log} from '../core/log.js';
import {toError} from '../core/to-error.js';

/**
 * Pair-level installation of the Flib-club EN–EN + EN–RU dictionary pair from OUR remote
 * manifest (contract: types/ext/flib-dictionary-provisioning.d.ts and
 * docs/deploy/provisioning-dictionary.md).
 *
 * ⚠️ The zips deliberately carry no isUpdatable/indexUrl/downloadUrl (pair-builder.js indexJson,
 * task doc §5.5): upstream per-dictionary updates would replace one half and break the pair.
 * Every install/update goes through this module, for both titles at one revision.
 *
 * No DOM here: the backend imports the marker key, the pages inject the side effects.
 */

/** The ONLY place the dictionary host is named. Ends with a slash. */
export const FLIB_DICTIONARIES_BASE_URL = 'https://pub-5cf47e052a1b41d0ad8c4ddf5fc03c1e.r2.dev/dictionaries/';

export const FLIB_DICTIONARIES_MANIFEST_URL = `${FLIB_DICTIONARIES_BASE_URL}latest.json`;

/**
 * The pair titles, as dev/dictionary-pair/pair-builder.js writes them into index.json
 * (HOST_TITLE = SOURCE_DICTIONARY, TRANSLATION_DICTIONARY in enrich-transform.js) and as
 * options-util `_updateVersion78` seeds flibTranslation.{hostDictionary,translationDictionary}.
 * A manifest naming anything else is rejected: a `replace` deletes by title, so an unchecked
 * title could delete an unrelated user dictionary.
 */
export const FLIB_DICTIONARY_TITLES = /** @type {const} */ (['wty-en-en', 'flibooster-en-ru']);

/**
 * chrome.storage.local key. `true` ⇔ the last completed run left every manifest title installed
 * at the manifest revision. Removed right before a run's first destructive step, so a tab closed
 * mid-import leaves it unset and the backend reopens the welcome page, which repairs the pair.
 * Readers: Backend._isProvisioningPending, provisionFlibDictionaries('first-run').
 */
export const FLIB_PROVISIONED_MARKER_KEY = 'flibDictionariesProvisioned';

/** @type {Set<string>} */
const FLIB_DICTIONARY_TITLE_SET = new Set(FLIB_DICTIONARY_TITLES);

const MANIFEST_TIMEOUT_MS = 20000;
const REVISION_PATTERN = /^\S{1,200}$/;
const FILE_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._-]*\.zip$/;
const SHA256_PATTERN = /^[0-9a-f]{64}$/;

/**
 * @param {unknown} value
 * @returns {value is Record<string, unknown>}
 */
function isObject(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * @param {unknown} value
 * @param {string} where
 * @returns {string|null} Error text, or null when valid.
 */
function validateEntry(value, where) {
    if (!isObject(value)) { return `${where} must be an object`; }
    const {title, file, url, size, sha256} = value;
    if (typeof title !== 'string' || title.trim().length === 0) { return `${where}.title must be a non-empty string`; }
    if (!FLIB_DICTIONARY_TITLE_SET.has(title)) {
        return `${where}.title "${title}" is not one of ${FLIB_DICTIONARY_TITLES.join(', ')}`;
    }
    if (typeof file !== 'string' || !FILE_PATTERN.test(file)) { return `${where}.file must be a bare *.zip file name`; }
    if (typeof url !== 'string') { return `${where}.url must be a string`; }
    /** @type {URL} */
    let parsed;
    try {
        parsed = new URL(url);
    } catch (e) {
        return `${where}.url must be an absolute URL`;
    }
    const base = new URL(FLIB_DICTIONARIES_BASE_URL);
    if (parsed.protocol !== 'https:') { return `${where}.url must use https`; }
    if (parsed.username !== '' || parsed.password !== '') { return `${where}.url must not carry credentials`; }
    if (parsed.host !== base.host) { return `${where}.url must be on ${base.host}`; }
    if (!parsed.pathname.startsWith(base.pathname)) { return `${where}.url must be under ${base.pathname}`; }
    if (parsed.search !== '' || parsed.hash !== '') { return `${where}.url must have no query or fragment`; }
    if (parsed.pathname.split('/').at(-1) !== file) { return `${where}.url must end with the file name ${file}`; }
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0) { return `${where}.size must be a positive integer`; }
    if (typeof sha256 !== 'string' || !SHA256_PATTERN.test(sha256)) { return `${where}.sha256 must be 64 lower-case hex digits`; }
    return null;
}

/**
 * Strictly validates a parsed remote manifest. Never throws.
 * @param {unknown} value
 * @returns {import('flib-dictionary-provisioning').ValidationResult}
 */
export function validateRemoteManifest(value) {
    if (!isObject(value)) { return {ok: false, error: 'manifest must be a JSON object'}; }
    const {schema, revision, published_at: publishedAt, dictionaries} = value;
    if (schema !== 1) { return {ok: false, error: `unsupported schema ${JSON.stringify(schema)} (expected 1)`}; }
    if (typeof revision !== 'string' || !REVISION_PATTERN.test(revision)) { return {ok: false, error: 'revision must be a non-empty string without whitespace'}; }
    if (typeof publishedAt !== 'string' || Number.isNaN(Date.parse(publishedAt))) { return {ok: false, error: 'published_at must be an ISO-8601 timestamp'}; }
    if (!Array.isArray(dictionaries) || dictionaries.length === 0) { return {ok: false, error: 'dictionaries must be a non-empty array'}; }
    /** @type {Set<string>} */
    const titles = new Set();
    for (let i = 0; i < dictionaries.length; ++i) {
        /** @type {unknown} */
        const item = dictionaries[i];
        const error = validateEntry(item, `dictionaries[${i}]`);
        if (error !== null) { return {ok: false, error}; }
        const {title} = /** @type {import('flib-dictionary-provisioning').RemoteManifestEntry} */ (item);
        if (titles.has(title)) { return {ok: false, error: `dictionaries[${i}].title "${title}" is listed twice (duplicate)`}; }
        titles.add(title);
    }
    for (const title of FLIB_DICTIONARY_TITLES) {
        if (!titles.has(title)) { return {ok: false, error: `dictionaries is missing "${title}"`}; }
    }
    return {ok: true, manifest: /** @type {import('flib-dictionary-provisioning').RemoteManifest} */ (value)};
}

/**
 * @param {import('flib-dictionary-provisioning').InstalledDictionary[]} installed
 * @param {string} title
 * @returns {import('flib-dictionary-provisioning').InstalledDictionary[]}
 */
function rowsFor(installed, title) {
    return installed.filter((row) => row.title === title);
}

/**
 * Decides, per manifest entry, what to do. An interrupted import leaves its `dictionaries`
 * row with `importSuccess: false` (DictionaryImporter writes the summary before the data
 * and flips the flag only at the end), so such a row is replaced even at the right revision.
 * @param {import('flib-dictionary-provisioning').RemoteManifest} manifest
 * @param {import('flib-dictionary-provisioning').InstalledDictionary[]} installed
 * @returns {import('flib-dictionary-provisioning').PlanItem[]}
 */
export function computeProvisioningPlan(manifest, installed) {
    return manifest.dictionaries.map((entry) => {
        const rows = rowsFor(installed, entry.title);
        if (rows.length === 0) { return {entry, action: 'import', reason: 'missing'}; }
        if (rows.some((row) => row.importSuccess === false)) { return {entry, action: 'replace', reason: 'incomplete'}; }
        if (rows.some((row) => row.revision !== manifest.revision)) { return {entry, action: 'replace', reason: 'outdated'}; }
        return {entry, action: 'skip', reason: 'current'};
    });
}

/**
 * Whether every manifest title is installed, fully imported, at the manifest revision.
 * The message is user-facing (Russian).
 * @param {import('flib-dictionary-provisioning').RemoteManifest} manifest
 * @param {import('flib-dictionary-provisioning').InstalledDictionary[]} installed
 * @returns {import('flib-dictionary-provisioning').PairCheck}
 */
export function checkInstalledPair(manifest, installed) {
    for (const {title} of manifest.dictionaries) {
        const rows = rowsFor(installed, title);
        if (rows.length === 0) { return {ok: false, message: `словарь ${title} не установлен`}; }
        if (rows.some((row) => row.importSuccess === false)) { return {ok: false, message: `импорт словаря ${title} не завершён`}; }
    }
    const mismatched = manifest.dictionaries.some(({title}) => rowsFor(installed, title).some((row) => row.revision !== manifest.revision));
    if (mismatched) {
        const found = manifest.dictionaries.map(({title}) => `${title} — rev.${rowsFor(installed, title).map((row) => row.revision).join('/')}`).join(', ');
        return {ok: false, message: `версии словарей не совпадают: ${found} (ожидалась rev.${manifest.revision})`};
    }
    return {ok: true};
}

/**
 * @param {import('flib-dictionary-provisioning').ProvisioningDependencies} deps
 * @returns {Promise<import('flib-dictionary-provisioning').RemoteManifest>}
 * @throws {Error} On any network, HTTP, JSON or validation failure.
 */
async function fetchManifest(deps) {
    const response = await deps.fetch(FLIB_DICTIONARIES_MANIFEST_URL, {cache: 'no-cache', signal: createTimeoutSignal(MANIFEST_TIMEOUT_MS)});
    if (!response.ok) { throw new Error(`manifest HTTP ${response.status}`); }
    const result = validateRemoteManifest(parseJson(await response.text()));
    if (!result.ok) { throw new Error(`invalid manifest: ${result.error}`); }
    return result.manifest;
}

/**
 * Downloads one zip and checks its exact size and SHA-256 against the manifest.
 * @param {import('flib-dictionary-provisioning').RemoteManifestEntry} entry
 * @param {import('flib-dictionary-provisioning').ProvisioningDependencies} deps
 * @param {(loaded: number) => void} onProgress
 * @returns {Promise<Blob>}
 * @throws {Error} With a user-facing (Russian) message.
 */
async function downloadVerifiedZip(entry, deps, onProgress) {
    /** @type {Response} */
    let response;
    try {
        response = await deps.fetch(entry.url);
    } catch (e) {
        log.warn(toError(e));
        throw new Error(`нет связи с сервером словарей (${entry.file})`);
    }
    if (!response.ok) { throw new Error(`сервер словарей ответил ${response.status} на ${entry.file}`); }

    /** @type {Uint8Array[]} */
    const chunks = [];
    let loaded = 0;
    const sizeError = () => new Error(`размер ${entry.file} не совпадает с манифестом`);
    if (response.body !== null) {
        const reader = response.body.getReader();
        while (true) {
            const {done, value} = await reader.read();
            if (done) { break; }
            loaded += value.byteLength;
            if (loaded > entry.size) {
                void reader.cancel();
                throw sizeError();
            }
            chunks.push(value);
            onProgress(loaded);
        }
    } else {
        const data = new Uint8Array(await response.arrayBuffer());
        chunks.push(data);
        loaded = data.byteLength;
    }
    if (loaded !== entry.size) { throw sizeError(); }

    const blob = new Blob(chunks, {type: 'application/zip'});
    const digest = await deps.sha256Hex(await blob.arrayBuffer());
    if (digest !== entry.sha256) { throw new Error(`контрольная сумма ${entry.file} не совпадает с манифестом`); }
    return blob;
}

/**
 * @param {import('flib-dictionary-provisioning').ProvisioningDependencies} deps
 * @returns {Promise<boolean>}
 */
async function readMarker(deps) {
    try {
        return await deps.getMarker();
    } catch (e) {
        log.warn(toError(e));
        return false;
    }
}

/**
 * @param {Error[]} errors
 * @returns {string}
 */
function joinErrors(errors) {
    return [...new Set(errors.map((error) => error.message))].join('; ');
}

/**
 * @param {import('flib-dictionary-provisioning').ProvisioningDependencies} deps
 * @param {(status: import('flib-dictionary-provisioning').ProvisioningStatus) => void} report
 * @returns {Promise<import('flib-dictionary-provisioning').ProvisioningOutcome>}
 */
async function runLocked(deps, report) {
    report({state: 'checking'});

    /** @type {import('flib-dictionary-provisioning').RemoteManifest} */
    let manifest;
    /** @type {import('flib-dictionary-provisioning').InstalledDictionary[]} */
    let installed;
    try {
        manifest = await fetchManifest(deps);
        installed = await deps.getDictionaryInfo();
    } catch (e) {
        log.warn(toError(e));
        report({state: 'unavailable'});
        return 'unavailable';
    }

    const work = computeProvisioningPlan(manifest, installed).filter(({action}) => action !== 'skip');
    if (work.length === 0) {
        await deps.setMarker(true);
        report({state: 'up-to-date'});
        return 'up-to-date';
    }

    let markerCleared = false;
    const count = work.length;
    for (let i = 0; i < count; ++i) {
        const {entry, action} = work[i];
        const index = i + 1;
        const {title} = entry;

        let lastPercent = -1;
        const onProgress = (/** @type {number} */ loaded) => {
            const percent = Math.floor(loaded / entry.size * 100);
            if (percent === lastPercent) { return; }
            lastPercent = percent;
            report({state: 'downloading', index, count, title, loaded, total: entry.size});
        };
        onProgress(0);
        const blob = await downloadVerifiedZip(entry, deps, onProgress);

        if (!markerCleared) {
            await deps.setMarker(false);
            markerCleared = true;
        }

        /** @type {import('flib-dictionary-provisioning').ProfilesDictionarySettings} */
        let settings = null;
        if (action === 'replace') {
            report({state: 'removing', index, count, title});
            settings = await deps.captureDictionarySettings(title);
            await deps.deleteDictionary(title);
        }

        report({state: 'importing', index, count, title});
        const url = deps.createObjectUrl(blob);
        /** @type {Error[]} */
        let errors;
        try {
            errors = await deps.importFromUrl(url, settings);
        } finally {
            deps.revokeObjectUrl(url);
        }
        if (errors.length > 0) { throw new Error(`импорт ${title}: ${joinErrors(errors)}`); }
    }

    const check = checkInstalledPair(manifest, await deps.getDictionaryInfo());
    if (!check.ok) {
        report({state: 'failed', message: check.message});
        return 'failed';
    }
    await deps.setMarker(true);
    report({state: 'installed'});
    return 'installed';
}

/**
 * @param {import('flib-dictionary-provisioning').ProvisioningDependencies} deps
 * @param {import('flib-dictionary-provisioning').ProvisioningMode} mode
 * @returns {Promise<import('flib-dictionary-provisioning').ProvisioningOutcome>}
 */
async function runGuarded(deps, mode) {
    const report = (/** @type {import('flib-dictionary-provisioning').ProvisioningStatus} */ status) => {
        try {
            deps.onStatus(status);
        } catch (e) {
            log.error(e);
        }
    };
    try {
        if (mode === 'first-run' && await readMarker(deps)) { return 'already-done'; }
        const outcome = await deps.withExclusiveLock(() => runLocked(deps, report));
        if (outcome === null) {
            report({state: 'busy'});
            return 'busy';
        }
        return outcome;
    } catch (e) {
        const error = toError(e);
        log.error(error);
        report({state: 'failed', message: error.message});
        return 'failed';
    }
}

/** @type {?Promise<import('flib-dictionary-provisioning').ProvisioningOutcome>} */
let inFlight = null;

/**
 * Installs or repairs the pair. `first-run` returns at once when the marker is set; `repair`
 * always checks the manifest. Module-level single flight: while a run is in progress on this
 * page, every call (any mode) gets that run's promise. Cross-tab exclusion is
 * `deps.withExclusiveLock`. Never throws, never rejects.
 * @param {import('flib-dictionary-provisioning').ProvisioningDependencies} deps
 * @param {import('flib-dictionary-provisioning').ProvisioningMode} mode
 * @returns {Promise<import('flib-dictionary-provisioning').ProvisioningOutcome>}
 */
export function provisionFlibDictionaries(deps, mode) {
    if (inFlight !== null) { return inFlight; }
    const run = runGuarded(deps, mode).finally(() => { inFlight = null; });
    inFlight = run;
    return run;
}

/**
 * Whether a run is in progress on this page.
 * @returns {boolean}
 */
export function isFlibProvisioningRunning() {
    return inFlight !== null;
}
