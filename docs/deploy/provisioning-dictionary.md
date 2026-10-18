# Flib dictionary pair: remote provisioning

The extension installs the Flib-club EN–EN + EN–RU dictionary pair (`wty-en-en` +
`flibooster-en-ru`) itself, from a manifest we publish. Nothing is bundled into the build and
nothing is copied into an unpacked extension any more (the old
`data/provisioning/dictionaries/wty-en-en.zip` path is gone, see commit 54500dad for why the
bundled variant was dropped).

Code: `ext/js/data/flib-dictionary-provisioning.js` (contract, validation, plan, orchestrator),
`ext/js/pages/common/provisioning-controller.js` (page wiring, Russian status texts). Types:
`types/ext/flib-dictionary-provisioning.d.ts`.

## Where it is published

The base URL is the single constant `FLIB_DICTIONARIES_BASE_URL`:

```
https://pub-5cf47e052a1b41d0ad8c4ddf5fc03c1e.r2.dev/dictionaries/
```

The manifest is `<base>latest.json`. Every zip URL must be https, on the same host, under the
same `/dictionaries/` path.

## Manifest contract (schema 1)

```json
{
  "schema": 1,
  "revision": "<rev>",
  "published_at": "2026-10-18T10:00:00Z",
  "dictionaries": [
    {
      "title": "wty-en-en",
      "file": "wty-en-en.zip",
      "url": "https://…/dictionaries/<rev>/wty-en-en.zip",
      "size": 123456789,
      "sha256": "<64 hex>"
    },
    {
      "title": "flibooster-en-ru",
      "file": "flibooster-en-ru.zip",
      "url": "https://…/dictionaries/<rev>/flibooster-en-ru.zip",
      "size": 40000000,
      "sha256": "<64 hex>"
    }
  ]
}
```

| Field                   | Rule (violations make the whole manifest invalid)                                    |
| ----------------------- | ------------------------------------------------------------------------------------ |
| `schema`                | the number `1`; a breaking change bumps it and old extensions refuse the manifest    |
| `revision`              | non-empty, no whitespace, ≤ 200 chars; equals `index.json.revision` of **both** zips |
| `published_at`          | ISO-8601 string that `Date.parse` accepts (informational)                            |
| `dictionaries`          | exactly the titles `wty-en-en` and `flibooster-en-ru`, each once                     |
| `dictionaries[].title`  | equals the zip's `index.json.title`                                                  |
| `dictionaries[].file`   | bare `*.zip` name; equals the last path segment of `url`                             |
| `dictionaries[].url`    | absolute https, base host, under `/dictionaries/`, no credentials/query/fragment     |
| `dictionaries[].size`   | exact byte size of the zip                                                           |
| `dictionaries[].sha256` | lower-case hex SHA-256 of the zip                                                    |

Entries have no revision of their own: the pair is released and installed as a unit. Unknown
keys are ignored. The title allow-list is deliberate: a "replace" deletes the installed
dictionary by title, so a manifest must not be able to name a user's other dictionaries.

The zips keep **no** `isUpdatable`/`indexUrl`/`downloadUrl` (pair-builder.js `indexJson`,
task doc §5.5): upstream per-dictionary auto-update would replace one half and break the pair.
Updates go through this manifest only.

## Publishing a new revision

1. `npm run build:dictionaries` → `<out>/<revision>/{wty-en-en.zip, flibooster-en-ru.zip, build.json}`.
2. Upload both zips under `dictionaries/<revision>/`.
3. Compute `size` (`stat -c %s`) and `sha256` (`sha256sum`) of each uploaded file.
4. Upload `latest.json` **last** (after both zips are reachable), with `Cache-Control: no-cache`.

## What the extension does

Every run (welcome or settings) is two-phase, so the installed pair never ends up half new,
half old:

- **Phase A — download, nothing changes.** For every title not installed at the manifest
  revision (or half-imported): download (`cache: 'no-cache'`, aborted after 60 s without data,
  `size` capped at 512 MB) and check the exact size and SHA-256. Every planned zip must pass
  before phase B starts; any failure ends the run with the installed dictionaries untouched and
  the marker unchanged.
- **Phase B — destructive.** The marker becomes `'in-progress'`, then per title the verified
  bytes go to the import controller (`importDictionaryFromFile`; a `blob:` URL would be blocked
  by the CSP `connect-src *`). For a replace, the controller itself snapshots the title's
  per-profile settings, deletes the old dictionary and re-imports with the snapshot, all inside
  its own busy section (a busy controller refuses before deleting anything). After the last
  import the pair is re-read; only a complete pair at the manifest revision sets the marker to
  `true`.

Where it runs:

- **Welcome page (first run).** Skipped when the marker is `true`. Status: «Загружаю словари
  Flib… (1 из 2)» with a progress bar, then «Словари установлены»; errors show the reason and
  «Повторить».
- **Settings → Dictionaries → «Установить / обновить словари Flib».** The same flow, ignoring
  the marker and `flibDictionariesRetryAfter`.
- **When the backend opens the welcome page by itself** (even with `showGuide` off, at most once
  per browser session): never when the marker is `true`; otherwise (no marker or `'in-progress'`)
  unless `flibDictionariesRetryAfter` is in the future (`shouldForceWelcome`). Every recorded
  failure sets it to now + 24 h, so a deterministic failure does not re-download the pair on
  every start; a tab closed mid-install records nothing and reopens on the next start.
- **Manifest unreachable** (404, invalid JSON/contract, offline, IndexedDB unavailable, e.g.
  Firefox private mode): «Словари временно недоступны, попробуйте позже» + retry. Nothing
  changes; `flibDictionariesRetryAfter` = now + 24 h, so a user who never got the pair is not
  shown the welcome page on every browser start. The same deferral follows a failed phase A.
- **Interrupted import** (tab closed): Yomitan writes the `dictionaries` summary row with
  `importSuccess: false` before the data and flips it to `true` at the end
  (`DictionaryImporter.importDictionary`), so the next run sees the flag and replaces that title.
  The marker stays `'in-progress'`, so the backend reopens the welcome page on the next browser
  start and the repair happens without user action.
- **Failure in phase B** (import errors, shown as «ошибка импорта <title> (<importer text>)»;
  or a revision mismatch after import «версии словарей не совпадают…»): the marker stays
  `'in-progress'` and `flibDictionariesRetryAfter` = now + 24 h.

## State

| Key / store                                                                    | Written by                                                                                                                  | Read by                                                                                             |
| ------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `chrome.storage.local.flibDictionariesProvisioned` (`true` \| `'in-progress'`) | orchestrator: `'in-progress'` before phase B; `true` after a verified complete pair (or an all-current plan)                | `Backend._isProvisioningPending` → `shouldForceWelcome`; orchestrator `first-run` (skips on `true`) |
| `chrome.storage.local.flibDictionariesRetryAfter` (epoch ms)                   | orchestrator: now + 24 h on every recorded failure (`unavailable`, phase A, phase B, post-import check); removed on success | `Backend._isProvisioningPending` → `shouldForceWelcome`                                             |
| IndexedDB `dictionaries` rows (`title`, `revision`, `importSuccess`)           | `DictionaryImporter` via the import controller; deleted by the controller's replace path                                    | plan + post-import check via `api.getDictionaryInfo()`                                              |
| profile `options.dictionaries[]` entries                                       | import controller: `_addDictionarySettings`; `_removeDictionaryForReplace` (filter by name)                                 | snapshot taken in `_removeDictionaryForReplace`, passed to `_addDictionarySettings`                 |

The legacy `provisioningDone` key (bundled-zip era) is no longer read or written.

## Verifying

```bash
curl -s https://pub-5cf47e052a1b41d0ad8c4ddf5fc03c1e.r2.dev/dictionaries/latest.json | jq .
```

Fresh profile → welcome page shows the Flib dictionaries block with progress → «Словари
установлены»; Settings → Dictionaries lists both titles at the same `rev.`.
