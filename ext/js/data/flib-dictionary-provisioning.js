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

import {translate} from '../i18n/ui-language.js';
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
 * chrome.storage.local key, value `true` | `'in-progress'` (absent = never installed).
 * - `true`: the last completed run left every manifest title fully imported at the manifest revision.
 * - `'in-progress'`: written right before a run's first destructive step (phase B) and replaced by
 *   `true` only after the post-import check, so a tab closed mid-import or a failed phase B keeps it
 *   (the welcome page then repairs, subject to FLIB_RETRY_AFTER_KEY).
 * Readers: Backend._isProvisioningPending (shouldForceWelcome), provisionFlibDictionaries('first-run').
 */
export const FLIB_PROVISIONED_MARKER_KEY = 'flibDictionariesProvisioned';

/**
 * chrome.storage.local key, epoch ms: do not force the welcome page before this time. Written as
 * now + FLIB_RETRY_DELAY_MS on every recorded failure (`unavailable`, failed phase A, failed
 * phase B or post-import check); removed on success. Ignored by the settings repair button.
 * Reader: Backend._isProvisioningPending (shouldForceWelcome).
 */
export const FLIB_RETRY_AFTER_KEY = 'flibDictionariesRetryAfter';

export const FLIB_RETRY_DELAY_MS = 24 * 60 * 60 * 1000;

/**
 * chrome.storage.local key: `{[title]: ProfilesDictionarySettings}` — the per-profile settings of a
 * dictionary captured right before the provisioning replace deletes it. Survives a failed or
 * interrupted import, so the next import of that title (replace or plain) restores the user's
 * enabled/priority/alias instead of defaults. Writer and reader: DictionaryImportController.
 * _prepareProvisionedImport overwrites it with the CURRENT entry while the title is installed and
 * complete, and reads it only when the title is absent or half-imported; _importDictionaryFromZip
 * removes it as soon as the title's settings are applied (also after non-fatal importer errors).
 */
export const FLIB_SETTINGS_SNAPSHOT_KEY = 'flibDictionarySettingsSnapshot';

/** Upper bound on a manifest `size`, checked before the download buffer is allocated. */
export const FLIB_MAX_ZIP_SIZE = 512 * 1024 * 1024;

/** @type {Set<string>} */
const FLIB_DICTIONARY_TITLE_SET = new Set(FLIB_DICTIONARY_TITLES);

const MANIFEST_TIMEOUT_MS = 20000;
const DOWNLOAD_IDLE_TIMEOUT_MS = 60000;
const IMPORT_ERROR_TEXT_LIMIT = 200;
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
    if (typeof size !== 'number' || !Number.isSafeInteger(size) || size <= 0 || size > FLIB_MAX_ZIP_SIZE) { return `${where}.size must be a positive integer of at most ${FLIB_MAX_ZIP_SIZE} bytes`; }
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
        if (rows.length === 0) { return {ok: false, message: translate('provision.notInstalled', {title})}; }
        if (rows.some((row) => row.importSuccess === false)) { return {ok: false, message: translate('provision.importIncomplete', {title})}; }
    }
    const mismatched = manifest.dictionaries.some(({title}) => rowsFor(installed, title).some((row) => row.revision !== manifest.revision));
    if (mismatched) {
        const found = manifest.dictionaries.map(({title}) => `${title} — rev.${rowsFor(installed, title).map((row) => row.revision).join('/')}`).join(', ');
        return {ok: false, message: translate('provision.versionMismatch', {found, revision: manifest.revision})};
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
 * Downloads one zip into a single buffer of the manifest size (no chunk list plus a second
 * copy for hashing), checks its exact size and SHA-256, and wraps it in a File for the import
 * controller. A stalled connection is aborted after DOWNLOAD_IDLE_TIMEOUT_MS without data, so
 * a hung download cannot hold the cross-tab lock forever.
 * @param {import('flib-dictionary-provisioning').RemoteManifestEntry} entry
 * @param {import('flib-dictionary-provisioning').ProvisioningDependencies} deps
 * @param {(loaded: number) => void} onProgress
 * @returns {Promise<File>}
 * @throws {Error} With a user-facing (Russian) message.
 */
async function downloadVerifiedZip(entry, deps, onProgress) {
    const controller = new AbortController();
    /** @type {?ReturnType<typeof setTimeout>} */
    let idleTimer = null;
    const armIdleTimer = () => {
        if (idleTimer !== null) { clearTimeout(idleTimer); }
        idleTimer = setTimeout(() => { controller.abort(); }, DOWNLOAD_IDLE_TIMEOUT_MS);
    };
    const stalledError = () => new Error(translate('provision.stalled', {file: entry.file}));
    const sizeError = () => new Error(translate('provision.sizeMismatch', {file: entry.file}));

    const data = new Uint8Array(entry.size);
    let loaded = 0;
    try {
        armIdleTimer();
        /** @type {Response} */
        let response;
        try {
            response = await deps.fetch(entry.url, {cache: 'no-cache', signal: controller.signal});
        } catch (e) {
            log.warn(toError(e));
            throw controller.signal.aborted ? stalledError() : new Error(translate('provision.noConnection', {file: entry.file}));
        }
        if (!response.ok) { throw new Error(translate('provision.httpError', {status: response.status, file: entry.file})); }

        if (response.body !== null) {
            const reader = response.body.getReader();
            while (true) {
                /** @type {ReadableStreamReadResult<Uint8Array>} */
                let chunk;
                try {
                    chunk = await reader.read();
                } catch (e) {
                    log.warn(toError(e));
                    throw controller.signal.aborted ? stalledError() : new Error(translate('provision.broken', {file: entry.file}));
                }
                if (chunk.done) { break; }
                armIdleTimer();
                const {value} = chunk;
                if (loaded + value.byteLength > entry.size) {
                    void reader.cancel();
                    throw sizeError();
                }
                data.set(value, loaded);
                loaded += value.byteLength;
                onProgress(loaded);
            }
        } else {
            const whole = new Uint8Array(await response.arrayBuffer());
            if (whole.byteLength > entry.size) { throw sizeError(); }
            data.set(whole);
            loaded = whole.byteLength;
        }
    } finally {
        if (idleTimer !== null) { clearTimeout(idleTimer); }
    }
    if (loaded !== entry.size) { throw sizeError(); }

    if (data.byteLength > FLIB_MAX_ZIP_SIZE) { throw sizeError(); }
    const digest = await deps.sha256Hex(data.buffer);
    if (digest !== entry.sha256) { throw new Error(translate('provision.checksum', {file: entry.file})); }
    return new File([data], entry.file, {type: 'application/zip'});
}

/**
 * @param {import('flib-dictionary-provisioning').ProvisioningDependencies} deps
 * @returns {Promise<import('flib-dictionary-provisioning').MarkerValue|null>}
 */
async function readMarker(deps) {
    try {
        return await deps.getMarker();
    } catch (e) {
        log.warn(toError(e));
        return null;
    }
}

/**
 * Pushes the next forced welcome page a day out. Best effort: a storage failure only means
 * the welcome page may open on the next start again.
 * @param {import('flib-dictionary-provisioning').ProvisioningDependencies} deps
 */
async function deferRetry(deps) {
    try {
        await deps.setRetryAfter(deps.now() + FLIB_RETRY_DELAY_MS);
    } catch (e) {
        log.warn(toError(e));
    }
}

/**
 * The importer's own (English) texts stay in parentheses; the lead is Russian.
 * @param {string} title
 * @param {Error[]} errors
 * @returns {string}
 */
function describeImportErrors(title, errors) {
    const joined = [...new Set(errors.map((error) => error.message))].join('; ');
    const raw = joined.length > IMPORT_ERROR_TEXT_LIMIT ? `${joined.slice(0, IMPORT_ERROR_TEXT_LIMIT)}…` : joined;
    return raw.length > 0 ? translate('provision.importErrorDetail', {title, reason: raw}) : translate('provision.importError', {title});
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
        await deferRetry(deps);
        report({state: 'unavailable'});
        return 'unavailable';
    }

    const work = computeProvisioningPlan(manifest, installed).filter(({action}) => action !== 'skip');
    if (work.length === 0) {
        await deps.setMarker(true);
        await deps.setRetryAfter(null);
        report({state: 'up-to-date'});
        return 'up-to-date';
    }
    const count = work.length;

    // Phase A: download and verify EVERY planned zip before touching the installed pair, so a
    // failing second download cannot leave a new first half next to an old second half
    // (strict pairing needs both at one revision). Each File owns its bytes; the download
    // buffer is local to downloadVerifiedZip and dropped as soon as the File exists.
    /** @type {(File|null)[]} */
    const files = [];
    try {
        for (let i = 0; i < count; ++i) {
            const {entry} = work[i];
            const index = i + 1;
            let lastPercent = -1;
            const onProgress = (/** @type {number} */ loaded) => {
                const percent = Math.floor(loaded / entry.size * 100);
                if (percent === lastPercent) { return; }
                lastPercent = percent;
                report({state: 'downloading', index, count, title: entry.title, loaded, total: entry.size});
            };
            onProgress(0);
            files.push(await downloadVerifiedZip(entry, deps, onProgress));
        }
    } catch (e) {
        await deferRetry(deps);
        throw e;
    }

    // Phase B: destructive. The marker says 'in-progress' until the post-import check passes.
    // A tab closed mid-install records no failure (no retryAfter), so the welcome page reopens on
    // the next start and repairs; a failed phase B defers that by a day, because a deterministic
    // failure (e.g. a zip whose revision differs from the manifest) would otherwise re-download
    // the whole pair on every start.
    await deps.setMarker('in-progress');
    try {
        for (let i = 0; i < count; ++i) {
            const {entry: {title}, action} = work[i];
            const file = files[i];
            files[i] = null;
            if (file === null) { throw new Error(translate('provision.noFile', {title})); }
            const replace = action === 'replace';
            report({state: 'importing', index: i + 1, count, title, replace});
            const errors = await deps.importFile(file, title, replace);
            if (errors.length > 0) { throw new Error(describeImportErrors(title, errors)); }
        }
    } catch (e) {
        await deferRetry(deps);
        throw e;
    }

    const check = checkInstalledPair(manifest, await deps.getDictionaryInfo());
    if (!check.ok) {
        await deferRetry(deps);
        report({state: 'failed', message: check.message});
        return 'failed';
    }
    await deps.setMarker(true);
    await deps.setRetryAfter(null);
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
        if (mode === 'first-run' && await readMarker(deps) === true) { return 'already-done'; }
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

/**
 * Whether the backend should open the welcome page on startup. Pure: the backend passes the
 * raw chrome.storage.local values. Never once installed (marker `true`); otherwise (never
 * installed, or `'in-progress'`) unless a recorded failure set `retryAfter` into the future —
 * then not before that time, so an unreachable manifest or a deterministic import failure does
 * not reopen the page (and re-download the pair) on every browser start. A tab closed
 * mid-install records no failure, so it still reopens on the next start. A `retryAfter` more than
 * one FLIB_RETRY_DELAY_MS ahead cannot have been written by us at the current clock (clock moved
 * back) and counts as absent.
 * @param {unknown} marker
 * @param {unknown} retryAfter Epoch ms.
 * @param {number} now Epoch ms.
 * @returns {boolean}
 */
export function shouldForceWelcome(marker, retryAfter, now) {
    if (marker === true) { return false; }
    if (typeof retryAfter !== 'number' || !Number.isFinite(retryAfter)) { return true; }
    if (retryAfter > now + FLIB_RETRY_DELAY_MS) { return true; }
    return now >= retryAfter;
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
