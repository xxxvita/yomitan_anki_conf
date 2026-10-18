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

/**
 * The remote pair manifest, `<FLIB_DICTIONARIES_BASE_URL>latest.json`, schema 1.
 * Contract (docs/deploy/provisioning-dictionary.md):
 * - `schema` is exactly the number 1; any other value is rejected (a breaking change bumps it).
 * - `revision` is the one build fingerprint both zips carry in their index.json `revision`.
 *   Entries have no revision of their own: the pair is released and installed as a unit.
 * - `published_at` is an ISO-8601 timestamp (informational, must parse).
 * - `dictionaries` lists exactly the pair titles (FLIB_DICTIONARY_TITLES), each once.
 * Unknown extra keys are ignored.
 */
export type RemoteManifest = {
    schema: 1;
    revision: string;
    published_at: string;
    dictionaries: RemoteManifestEntry[];
};

export type RemoteManifestEntry = {
    /** Must equal the zip's index.json `title`. */
    title: string;
    /** Bare zip file name (`[A-Za-z0-9._-]+\.zip`); equals the last path segment of `url`. */
    file: string;
    /** Absolute https URL on the base URL's host, under the base URL's path. */
    url: string;
    /** Exact zip size in bytes. */
    size: number;
    /** Lower-case hex SHA-256 of the zip bytes. */
    sha256: string;
};

/** The subset of `import('dictionary-importer').Summary` the provisioning logic reads. */
export type InstalledDictionary = {
    title: string;
    revision: string;
    /** `false` = the import never finished (see DictionaryImporter); absent = pre-field import, treated as complete. */
    importSuccess?: boolean;
};

/** `skip`: present at the manifest revision; `import`: absent; `replace`: outdated or half-imported. */
export type PlanAction = 'skip' | 'import' | 'replace';

export type PlanReason = 'current' | 'missing' | 'outdated' | 'incomplete';

export type PlanItem = {
    entry: RemoteManifestEntry;
    action: PlanAction;
    reason: PlanReason;
};

export type PairCheck = {ok: true} | {ok: false, message: string};

export type ValidationResult = {ok: true, manifest: RemoteManifest} | {ok: false, error: string};

/** Per-profile dictionary settings captured before a replace, keyed by profile id. */
export type ProfilesDictionarySettings = import('settings-controller').ProfilesDictionarySettings;

export type ProvisioningStatus =
    | {state: 'checking'}
    | {state: 'downloading', index: number, count: number, title: string, loaded: number, total: number}
    | {state: 'removing', index: number, count: number, title: string}
    | {state: 'importing', index: number, count: number, title: string}
    | {state: 'installed'}
    | {state: 'up-to-date'}
    | {state: 'busy'}
    | {state: 'unavailable'}
    | {state: 'failed', message: string};

/** What a run ended with. `already-done` = first-run mode found the marker set and did nothing. */
export type ProvisioningOutcome = 'already-done' | 'installed' | 'up-to-date' | 'busy' | 'unavailable' | 'failed';

export type ProvisioningMode = 'first-run' | 'repair';

/**
 * Everything the orchestrator touches outside itself; injected so the flow is unit-testable.
 */
export type ProvisioningDependencies = {
    fetch: (url: string, init?: RequestInit) => Promise<Response>;
    getDictionaryInfo: () => Promise<InstalledDictionary[]>;
    getMarker: () => Promise<boolean>;
    setMarker: (value: boolean) => Promise<void>;
    sha256Hex: (data: ArrayBuffer) => Promise<string>;
    /** Reads the per-profile settings of `title` (for a replace). `null` when no profile has it. */
    captureDictionarySettings: (title: string) => Promise<ProfilesDictionarySettings>;
    /** Deletes the dictionary's rows and its per-profile settings entries. */
    deleteDictionary: (title: string) => Promise<void>;
    /**
     * Imports the verified zip through the dictionary import controller (importDictionaryFromFile,
     * the same _importDictionaries path the URL flow uses); resolves with that flow's errors.
     */
    importFile: (file: File, profilesDictionarySettings: ProfilesDictionarySettings) => Promise<Error[]>;
    /** Runs `callback` holding a cross-tab exclusive lock; resolves `null` (without calling it) if the lock is held elsewhere. */
    withExclusiveLock: <T>(callback: () => Promise<T>) => Promise<T | null>;
    onStatus: (status: ProvisioningStatus) => void;
};
