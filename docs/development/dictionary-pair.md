# Dictionary pair builder

`npm run build:dictionaries` builds the two dictionaries the extension pairs
(`wty-en-en.zip` and `flibooster-en-ru.zip`). It reads anki_conf's `dict_base.db`
and never runs anki_conf's code. The pair contract is in
[docs/tasks/2026-09-08-dictionary-pair-for-flib-club-extension.md](../tasks/2026-09-08-dictionary-pair-for-flib-club-extension.md).

```bash
npm run build:dictionaries -- --dict <dict_base.db>          # → builds/dictionaries/<revision>/
FLIB_DICT_BASE_DB=<dict_base.db> npm run build:dictionaries  # the same
npm run build:dictionaries -- --verify builds/dictionaries/<revision>
npm run build:dictionaries -- --help
```

## The source path is required

| Source         | Flag     | Environment         | Default  |
| -------------- | -------- | ------------------- | -------- |
| `dict_base.db` | `--dict` | `FLIB_DICT_BASE_DB` | **none** |

The flag wins over the environment variable; an empty value counts as unset.
With neither, the builder fails before it opens anything.

There is no default path on purpose (owner decision, 2026-11-16). The desktop
app's live `dict_base.db` can be **older** than the dictionary already published
to R2 (on 2026-11-16: live rev 2026.10.24, published rev 2026.11.01). A build
from a silent default, published afterwards, would roll users back. Always name
the database you mean to build from.

`--verify` reads only the built directory and needs no `--dict`.

## Attribution

Both `index.json` files carry `attribution` and `url`, because both dictionaries
contain Wiktionary text under CC BY-SA 4.0. The text is in `pair-builder.js`, and
`--verify` rejects a pair without it. The settings page shows these fields in the
dictionary details, and `ext/legal.html` and `README.md` state the same source.

`index.json` is not part of the revision hash, so a change to it must raise
`TOOL_VERSION`. Otherwise the same revision would describe different bytes.

## What is read

Both sides of the pair come from one snapshot of `dict_base.db`:

- **English side**: every `terms` row of `wty-en-en` and `flibooster-en`. The
  authored `flibooster-en` rows are taken as data and merged into the English
  zip. Each row's `sequence` is its `rowid`.
- **Russian side**: every `terms` row of `flibooster-en-ru`, as it is: anki_conf
  declared the live `dict_base.db` the canonical source (2026-10-18), and these
  rows are its final exported Russian text. They are mapped to bank rows by the
  same code as the English rows; the stamp is the row's own `sequence` column
  (the English host's `rowid`). No transform runs.
- **Orphans**: Russian rows whose stamp matches no English row (91 on
  2026-10-18) are kept. The extension shows them as unpaired translations
  (`translation-pairing.js`). Guard G1 and acceptance check П3 therefore do not
  apply; the orphans are counted instead. G3 and G9 still fail the build when
  a stamp lands on a wrong or deinflection-only English row.

The earlier mode that rebuilt the Russian side from the `enrich.db` translation
journal (`--ru-source journal`) and its Go parity check were removed on
2026-11-16; `dict_base.db` is the only source.

## Opening the source

The database is opened only as `file:<path>?mode=ro`, with a 5 s busy timeout.
A path that does not exist is an error: the builder never creates an empty
database in its place.

The builder reads a snapshot made with SQLite's online backup (`node:sqlite`
`backup()`, 1000 pages per step). The desktop app may hold the live file open,
and the file uses a rollback journal: one long read transaction (the build
takes about 90 s) would block its commits. The backup holds a shared lock only
for each step and restarts if someone writes in between, so the snapshot is one
consistent state. The snapshot is a full copy (about 1.9 GB for the live
database): on a machine where `/tmp` is tmpfs, point `TMPDIR` at a disk
directory, for example `TMPDIR=$PWD/builds/.tmp`. `scripts/build-all.sh` does
that by default (an explicit `TMPDIR` wins).

Snapshots live in `flib-dict-snapshot-*` under the system temp dir and are
removed on success and on an exception. Ctrl-C or SIGKILL in the middle of a
build leaves the snapshot behind; the next run removes it (a start deletes
snapshot dirs whose owner PID in `owner.pid` is no longer alive). To remove it
by hand, **only when no build is running** (a concurrent run's live snapshot
matches the same pattern): `rm -rf "${TMPDIR:-/tmp}"/flib-dict-snapshot-*`. The
builder uses Node's `os.tmpdir()`, which honours `$TMPDIR`.

## Output

The output goes to `builds/dictionaries/<revision>/`, which holds
`wty-en-en.zip`, `flibooster-en-ru.zip` and `build.json`.

`build.json` is published, so it records the source file by **name only**
(`sources.dict.path` is `dict_base.db`), never by absolute path; the revision
does not depend on the path. Fields:

| Field                                                             | Read by                                        |
| ----------------------------------------------------------------- | ---------------------------------------------- |
| `tool`, `revision`, `host.*`, `translation.{rows,bytes,sha256,…}` | CLI report, release checksums                  |
| `ruSource` (always `"dict"`)                                      | `--verify` (orphans allowed only for `dict`)   |
| `sources.dict` (name, bytes, mtime)                               | owner (provenance)                             |
| `translation.sourceRows`                                          | row-count check: must equal `translation.rows` |
| `translation.sourceRevision`                                      | owner: which anki_conf export was packed       |
| `translation.pairedStamps`, `translation.orphanStamps`            | CLI summary line, `--verify`, owner            |
| `guards`, `artifactVerification`, `startedAt`, `finishedAt`       | owner                                          |

**Row-count check**: the build fails unless the Russian rows built, the rows
re-read from the finished zip and `count(*)` of `flibooster-en-ru` in the
snapshot are all equal. Result on 2026-10-18: 219 715 = 219 715, revision
`2182664-2143344-42770b71cea5`, `wty-en-en.zip` 118 179 238 B,
`flibooster-en-ru.zip` 44 112 682 B, 91 orphans, about 91 s and 5.2 GB peak RSS.

Publishing a build to R2 is described in [releasing.md](releasing.md#dictionaries).

- **The revision comes from content**: `<rows in the pair>-<max English rowid>-<first 12 hex of sha256>`.
  The sha256 covers `TOOL_VERSION` plus every bank row of both dictionaries, in
  zip order. File dates play no part in it.
  - With the same data you get the same revision. A rerun then reports
    `up-to-date`, after checking that the new zips are byte-identical to the
    existing ones, and replaces `build.json`.
  - Change one translation and you get a new directory.
  - Russian rows are sorted (expression byte-wise, then stamp), so the order
    of rows in `dict_base.db` does not matter.
  - Bump `TOOL_VERSION` in `dev/dictionary-pair/pair-builder.js` whenever the
    artefact format changes.
- **The zips are deterministic**: entry dates are fixed at 1980-01-01 UTC, entry
  order is fixed and deflate runs at level 6.
- **Checks run before anything is written**:
  - the pair guards (G2–G9 on the Russian rows, G5h on the English glossaries);
  - then a re-read of the finished zips: 8-element rows, titles, identical
    revisions, `sequenced` on the English zip only, no `isUpdatable`/`indexUrl`/`downloadUrl`,
    every Russian stamp hosted except the counted orphans, and no stamp on a
    deinflection-only row.

## `--verify` and directories from the removed journal mode

`--verify <dir>` re-runs the acceptance checks on the zips and also requires
`host.rows`, `translation.rows` and `translation.orphanStamps` to match the
directory's `build.json`. Orphans are allowed only when `build.json` says
`"ruSource": "dict"`. A directory built by the removed journal mode (no
`build.json`, no `ruSource` or `"journal"`) is checked strictly, as before.

Such a directory also holds two expression lists
(`stale-authored-translations.txt`, `untranslated-authored.txt`). If a rebuild
produces the same revision there, it removes them: the new `build.json` does not
describe them.

## Known gaps

- **No G6 allowlist.** A new English dictionary added in anki_conf silently
  stays out of the pair.
