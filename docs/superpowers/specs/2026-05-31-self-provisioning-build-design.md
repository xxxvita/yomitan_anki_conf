# Self-provisioning build: bundled default settings + auto-imported dictionary

Date: 2026-05-31
Status: Approved (design)
Area: `ext/js/data/options-util.js`, `ext/js/pages/welcome-main.js` (+ welcome controller/HTML), build pipeline, new `ext/data/provisioning/**`

## Problem

Yomitan options are stored per-browser in `chrome.storage.local`; on a fresh install
they are generated from the JSON schema defaults (`OptionsUtil.getDefault()`). For the
turmalin/FLIBOOSTER deployment — where the target machine's Anki is already provisioned
with the matching deck/model — a freshly installed Yomitan starts unconfigured: Anki
card formats are empty (the grey "+" incident), and no dictionary is imported, so
lookups return nothing. We want a build that comes up already configured: settings
seeded and the dictionary imported, with no manual setup.

This deployment ships our own fork build to every browser (chrome/firefox/edge from one
`npm run build`), so all targets share the same options schema version — one settings
file is valid everywhere. (The earlier v76 Firefox export came from a different, newer
store-installed Yomitan and is out of scope.)

## Goals

- A build that, on **fresh install only**, seeds Yomitan options from a bundled file
  and imports a bundled dictionary, then behaves normally forever after.
- Zero effect on normal/upstream builds: the feature is inert unless provisioning
  assets are present in the package.
- Never clobber a user's settings or re-import after the first successful run.

## Non-goals

- No re-provisioning on extension update or on manual welcome-page reopen.
- No shipping of a pre-populated IndexedDB (not possible); the dictionary is imported
  on first run from a bundled zip.
- No Anki deck/model creation (the deployment provisions Anki separately).
- No cross-version downgrade handling; the bundled options are produced from the
  current build's schema version.

## Activation gate

The feature is driven entirely by the presence of provisioning assets under
`ext/data/provisioning/`:

- `default-options.json` — committed; the `options` object from a Chrome export at the
  build's schema version (currently 75), with each profile's `dictionaries` array
  **emptied** (dictionary registration is owned by Unit B's import; see below).
- `dictionaries.json` — committed; a manifest: `[{ "file": "wty-en-en.zip", "title": "wty-en-en" }]`.
- `dictionaries/<file>.zip` — **injected at build time** by the turmalin pipeline, NOT
  committed to git (large binary). Added to `.gitignore`.

If `default-options.json` is absent, `OptionsUtil.load()` falls back to `getDefault()`
(upstream behavior). If `dictionaries.json` / the zip is absent, the welcome page skips
dictionary import. A build with none of these assets is byte-for-byte upstream behavior.

## Architecture

Two independent units in two contexts, plus a one-time completion marker.

### Unit A — Settings seed (service-worker / backend context)

`OptionsUtil.load()` (options-util.js ~115-145) currently does, when storage has no
`options`:

```js
options = this.getDefault();
```

Change the fresh-install branch to:

1. `fetch(chrome.runtime.getURL('data/provisioning/default-options.json'))`.
2. On success: parse, run through `this.update(bundledOptions)` (forward-migrate to the
   build's schema version + validate via the existing schema), return it.
3. On any failure (file absent, fetch/parse error): fall back to `getDefault()`.

The migrated, seeded options are then saved by the existing `load()` tail. Because this
branch only runs when storage is empty, a user's later edits are never overwritten.

This logic is extracted into a small, testable helper, e.g.
`loadProvisionedDefaultOptions(fetchImpl, getUrlImpl)` returning `?Options` (null when no
asset / on error), so `load()` stays thin and the fetch/parse/branch is unit-testable
with mocked `fetch`/`getURL`.

### Unit B — Dictionary auto-import (welcome page context)

Dictionary import must run on a normal extension page (MV3 service workers cannot spawn
the `Worker` the importer uses). Yomitan already opens `welcome.html` once per install
(`backend._openWelcomeGuidePageOnce`). The welcome controller (`welcome-main.js` and its
sub-controller) gains a provisioning step:

1. Read `chrome.storage.local['provisioningDone']`. If true → do nothing.
2. `fetch('data/provisioning/dictionaries.json')`. If absent → do nothing.
3. For each manifest entry, check whether the dictionary is already imported via
   `application.api.getDictionaryInfo()` (match on `title`). Drop the ones already present.
4. If nothing remains to import → set the marker and stop.
5. For each not-yet-imported entry: trigger the **existing** import-from-URL path
   (`settingsController.trigger('importDictionaryFromUrl', {url, profilesDictionarySettings: null, onImportDone})`,
   handled by the already-instantiated `DictionaryImportController`). The URL is
   `chrome.runtime.getURL('data/provisioning/dictionaries/<file>')`. This reuses the
   dictionary worker, the status-footer progress UI, error display, and — crucially —
   `_addDictionarySettings`, which **registers** the dictionary (enabled in the current
   profile). Await completion via the `onImportDone` callback.
6. `onImportDone` fires on both success and failure (it runs in the importer's `finally`).
   So after it fires, re-query `getDictionaryInfo()`: if every manifest title is now
   present → set `chrome.storage.local['provisioningDone'] = true`; otherwise leave the
   marker unset and show a "Retry" affordance. (`triggerDatabaseUpdated` is already fired
   by the import path.)

**Why dictionaries are stripped from the seeded options (Unit A):** `_addDictionarySettings`
pushes a fresh dictionary-settings entry unconditionally (no dedupe). If Unit A seeded an
options object that already contained `wty-en-en`, Unit B's import would create a
**duplicate** entry. Therefore the bundle's `default-options.json` has empty `dictionaries`
arrays, and Unit B's import is the sole registrar. (`general.mainDictionary` may still
name the dictionary; it becomes valid once the import re-adds it.) Clean split: Unit A owns
all non-dictionary settings, Unit B owns the dictionary (data + registration). The bundled
zip's internal title must equal the manifest `title` — a build-time data check, not a
runtime branch.

### One-time marker

`chrome.storage.local['provisioningDone']` is the single source of "already provisioned".
Set only after a fully successful dictionary import. On failure it stays unset: the
welcome page shows the error and a "Retry" button (no infinite auto-retry). Settings seed
(Unit A) is independently idempotent via the empty-storage condition, so the marker is
primarily for the dictionary step and to short-circuit Unit B on later welcome reopens.

## Data flow

```
fresh install
  → backend boots → OptionsUtil.load() finds empty storage
      → loadProvisionedDefaultOptions() → default-options.json → update() → save()   [Unit A]
  → backend._openWelcomeGuidePageOnce() opens welcome.html
      → welcome provisioning step: provisioningDone? no
          → dictionaries.json → drop titles already in getDictionaryInfo()
              → trigger 'importDictionaryFromUrl' (reuses worker + progress + register)
          → onImportDone → re-check getDictionaryInfo(): all titles present?
          → yes → provisioningDone = true
  → user immediately has configured Anki formats + working lookups
```

## Edge cases

| #   | Case                                               | Behavior                                                                                                                               |
| --- | -------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | No provisioning assets in build                    | Inert: `getDefault()`, welcome skips import. Upstream behavior.                                                                        |
| 2   | `default-options.json` malformed / fetch fails     | Fall back to `getDefault()`; log a warning.                                                                                            |
| 3   | Bundled options version > build schema             | Avoided by producing the bundle from the current build; a build-time validation step asserts `options.version === buildSchemaVersion`. |
| 4   | Dictionary already in DB (user imported it)        | Skip import, set marker.                                                                                                               |
| 5   | Dictionary import fails / interrupted              | Marker not set; show error + Retry; no auto-retry loop.                                                                                |
| 6   | Extension update (reason !== install)              | No reseed (storage non-empty); welcome not auto-opened; marker already set → Unit B no-op.                                             |
| 7   | User edits settings after first run                | Never overwritten (Unit A only runs on empty storage).                                                                                 |
| 8   | Empty `Reading`/`Kanji` card formats in the bundle | Their "+" is grey by design; optionally cleaned when assembling the bundle (deployment decision, not runtime).                         |

## Testing

- **Unit (vitest):** `loadProvisionedDefaultOptions` — asset present/valid → returns
  parsed options; asset absent (fetch rejects/404) → null; malformed JSON → null. Mock
  `fetch` and `getURL`. (The subsequent `update()`/validate is already covered by the
  existing options-util tests.)
- **Unit (vitest):** the "needs import?" decision — given a manifest + a stubbed
  `getDictionaryInfo` result + marker value, returns the correct list of zips to import
  (empty when marker set, empty when all titles already present).
- **Manual / integration:** clean profile → load unpacked build with provisioning assets
  → confirm welcome imports with progress, options are seeded (Anki "+" active, lookups
  work), and a reload / simulated update does not re-import or reset settings. A build
  with the assets removed behaves like upstream.

## Files touched

- `ext/js/data/options-util.js` — fresh-install branch calls the new
  `loadProvisionedDefaultOptions` helper (new small module or local function).
- `ext/js/pages/welcome-main.js` — wire a first-run provisioning step that reuses the
  already-instantiated `DictionaryImportController` via the `importDictionaryFromUrl`
  event (status-footer progress is reused; no new progress UI needed).
- `ext/js/pages/common/provisioning-controller.js` (new) — thin runner + a pure
  `computeDictionariesToImport(manifest, importedTitles, provisioningDone)` decision
  function (unit-tested).
- `ext/data/provisioning/default-options.json`, `ext/data/provisioning/dictionaries.json`
  — committed provisioning assets.
- `.gitignore` — ignore `ext/data/provisioning/dictionaries/*.zip`.
- Build/deploy docs — note the turmalin pipeline must drop the dictionary zip(s) into
  `ext/data/provisioning/dictionaries/` before packaging, and run the version-assert
  check from edge case #3.

## Build pipeline (turmalin)

Before packaging:

1. Drop the dictionary zip(s) named in `ext/data/provisioning/dictionaries.json` into
   `ext/data/provisioning/dictionaries/` (gitignored).
2. Re-run the bundle/version assert (matches the implementation plan's Task 1 Step 2):
   fail the build if `default-options.json`'s `version` does not equal the build's schema
   version, or if any profile's `dictionaries` array is non-empty.

## Known limitations (follow-ups, non-blocking)

- **Unbounded wait if a concurrent import is in flight.** Unit B awaits the importer's
  `onImportDone` callback. `DictionaryImportController._importDictionaries` early-returns
  (without calling `onImportDone`) when `this._modifying` is already true, so a _concurrent_
  import racing the first-run provisioning would leave that await pending. The provisioning
  call is fire-and-forget (`void`), so the welcome page is unaffected, the marker stays
  unset, and the next launch retries idempotently. On the first-run welcome path no user
  import is in flight, so this is a low-probability edge; hardening (timeout/race or making
  the early-return path resolve the callback) is a follow-up.
- **`isAnkiConnected` warning observability** (carried over from the phrase-popup work) is
  unrelated to provisioning.
