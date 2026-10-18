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

- **Welcome page (first run).** Unless the `flibDictionariesProvisioned` marker is set: fetch
  and validate the manifest, then for every title not installed at the manifest revision:
  download → check size and SHA-256 → (replace only) capture its per-profile settings and delete
  the old one → import the verified bytes through the import controller (`importDictionaryFromFile`; a `blob:` URL would be blocked by the CSP `connect-src *`). Status: «Загружаю
  словари Flib… (1 из 2)» with a progress bar, then «Словари установлены»; errors show the
  reason and «Повторить».
- **Settings → Dictionaries → «Установить / обновить словари Flib».** The same flow, ignoring
  the marker: outdated or half-imported titles are deleted and re-imported with their
  enabled/priority/alias settings kept.
- **Manifest unreachable** (404, invalid JSON/contract, offline, IndexedDB unavailable, e.g.
  Firefox private mode): «Словари временно недоступны, попробуйте позже» + retry. Nothing changes.
- **Interrupted import** (tab closed): Yomitan writes the `dictionaries` summary row with
  `importSuccess: false` before the data and flips it to `true` at the end
  (`DictionaryImporter.importDictionary`), so the next run sees the flag and replaces that title.
  The marker is removed before a run's first delete/import, so the backend reopens the welcome
  page on the next browser start and the repair happens without user action.
- **Revision mismatch after import** (a zip whose `index.json.revision` differs from the
  manifest, or the two titles disagree): reported as a failure «версии словарей не совпадают…»;
  the marker stays unset.

## State

| Key / store                                                          | Written by                                                                                  | Read by                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `chrome.storage.local.flibDictionariesProvisioned` (`true`)          | orchestrator: set after a verified complete pair; removed before the first destructive step | `Backend._isProvisioningPending` (opens welcome), orchestrator `first-run` (skips) |
| IndexedDB `dictionaries` rows (`title`, `revision`, `importSuccess`) | `DictionaryImporter` via the import flow; deleted via `DictionaryWorker.deleteDictionary`   | plan + post-import check via `api.getDictionaryInfo()`                             |
| profile `options.dictionaries[]` entries                             | import controller `_addDictionarySettings`; provisioning delete (filter by name)            | captured before a replace and passed back as `profilesDictionarySettings`          |

The legacy `provisioningDone` key (bundled-zip era) is no longer read or written.

## Verifying

```bash
curl -s https://pub-5cf47e052a1b41d0ad8c4ddf5fc03c1e.r2.dev/dictionaries/latest.json | jq .
```

Fresh profile → welcome page shows the Flib dictionaries block with progress → «Словари
установлены»; Settings → Dictionaries lists both titles at the same `rev.`.
