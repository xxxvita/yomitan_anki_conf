# Dictionary pair builder

`npm run build:dictionaries` builds the two dictionaries the extension pairs
(`wty-en-en.zip` and `flibooster-en-ru.zip`). It reads anki_conf's data files and
never runs anki_conf's code. The pair contract is in
[docs/tasks/2026-09-08-dictionary-pair-for-flib-club-extension.md](../tasks/2026-09-08-dictionary-pair-for-flib-club-extension.md).

## Sources

Both sources are opened only as `file:<path>?mode=ro`, with a 5 s busy
timeout. A path that does not exist is an error: the builder never creates an
empty database in its place.

The journal may be written by a live translation run, and it uses a rollback
journal. So the builder first copies it with `VACUUM INTO` into a temporary
file and reads that copy. The copy takes about 0.2 s and gives one consistent
state. The builder never holds one long read transaction, because that would
block the writer's commits for longer than its busy timeout.

The copy lives in `flib-dict-snapshot-*` under the system temp dir (RAM on
tmpfs, about 167 MB) and is removed on success, on an exception, and on
SIGINT/SIGTERM (exit code 130/143; the signal is handled once the current
synchronous step finishes). SIGKILL cannot be caught, so every start removes
snapshot dirs whose owner PID (`owner.pid`) is no longer alive; a snapshot of a
concurrently running build is never touched.

| Source              | Flag        | Environment           | Default (only valid on the owner's machine)                |
| ------------------- | ----------- | --------------------- | ---------------------------------------------------------- |
| `dict_base.db`      | `--dict`    | `FLIB_DICT_BASE_DB`   | `~/.config/anki-connect-desktop/data/yomitan/dict_base.db` |
| `enrich.db` journal | `--journal` | `FLIB_ENRICH_JOURNAL` | `~/dict-enrich-20260828/enrich.db`                         |

What is read:

- **English side**: every `terms` row of `wty-en-en` and `flibooster-en`. The
  authored `flibooster-en` rows are taken as data and merged into the English zip.
  Each row's `sequence` is its `rowid`.
- **Russian side**: built from the journal (`enrich_log`, `meta`) and the English
  rows by a port of anki_conf's `lexicon-dict-enrich -export` transform
  (`dev/dictionary-pair/enrich-transform.js`). The `flibooster-en-ru` rows already
  in `dict_base.db` are a stale export, and the builder ignores them.

## Output

The output goes to `builds/dictionaries/<revision>/`, which holds
`wty-en-en.zip`, `flibooster-en-ru.zip` and `build.json`. `build.json` records
row counts, the sha256 of each zip, the transform statistics and the guard
results.

- **The revision comes from content**: `<rows in the pair>-<max English rowid>-<first 12 hex of sha256>`.
  The sha256 covers `TOOL_VERSION` plus every bank row of both dictionaries, in
  zip order. File dates play no part in it.
  - With the same data you get the same revision. A rerun then reports
    `up-to-date`, after checking that the new zips are byte-identical to the
    existing ones.
  - Change one translation and you get a new directory.
  - Bump `TOOL_VERSION` in `dev/dictionary-pair/pair-builder.js` whenever the
    artefact format changes.
- **The zips are deterministic**: entry dates are fixed at 1980-01-01 UTC, entry
  order is fixed and deflate runs at level 6.
- **Checks run before anything is written**:
  - the pair guards (G1–G11);
  - then a re-read of the finished zips: 8-element rows, titles, identical
    revisions, `sequenced` on the English zip only, no `isUpdatable`/`indexUrl`/`downloadUrl`,
    every Russian stamp hosted, and no stamp on a deinflection-only row.

## Parity check: run it whenever anki_conf changes its enrich code

The transform is a literal port of anki_conf's Go code (`cmd/lexicon-dict-enrich/`:
`export.go`, `glossary.go`, `apply.go`, `source.go`, `journal.go`,
`languages.go`). Two implementations drift silently. The guard against that is
to compare our Russian rows with a reference export made by the Go code from the
**same** sources.

1. Build the Go exporter outside the anki_conf tree:

   ```bash
   T=$(mktemp -d)
   git -C <anki_conf> archive main | tar -x -C "$T"
   (cd "$T" && go build -o "$T/lexicon-dict-enrich" ./cmd/lexicon-dict-enrich)
   ```

2. Run the export into a **new** file. It needs about 1.8 GB, because it copies
   `dict_base.db`.

   - It opens `dict_base.db` with `mode=ro&immutable=1` and the journal with
     `mode=ro`.
   - It writes only to the `-export` path.
   - Run it from `cmd/lexicon-dict-enrich/`. The tool's translation mode reads
     tables relative to that directory; export does not, but the habit is safer.

   ```bash
   cd "$T/cmd/lexicon-dict-enrich"
   "$T/lexicon-dict-enrich" -export "$T/reference.db" -export-revision ref \
     -dict <dict_base.db> -work <directory containing enrich.db>
   echo "exit $?"
   ```

   Check the exit code and the summary line `выкладка "flibooster-en-ru" → …:
статей N, …`. A failed export can leave a copy of `dict_base.db` that still
   holds the stale `flibooster-en-ru` rows (44 530 on 2026-10-04). Parity against
   it then fails with a misleading cause.

3. Compare:

   ```bash
   npm run check:dictionary-parity -- --reference "$T/reference.db" \
     --dict <dict_base.db> --journal <enrich.db>
   ```

The comparison covers `expression`, `reading`, `sequence`, the parsed glossary,
`definitionTags`, `rules`, `termTags`, `score` and the row order. JSON key order
and escaping are not compared, because Go and JS legitimately differ there. Exit
code 1 means at least one mismatch, and the report groups the mismatches by
class.

The journal can be written by a live translation run. Make the reference export
and the check from the same journal state: no run in between.

Result on 2026-10-04: 161 032 of 161 032 Russian articles identical, in the same
order (1 901 skipped as incomplete and 58 unchanged, the same as Go).

Parity proves the port equivalent **on the current data only**. Edge rules
that the live data does not exercise are held by the unit tests in
`test/dictionary-pair/`, not by parity:

- U+0085 and U+FEFF whitespace;
- byte-wise UTF-8 ordering.

Mutating either rule leaves live parity green.

Known gaps:

- **No G6 allowlist.** A new English dictionary added in anki_conf silently
  stays out of the pair.
- **Invalid UTF-8 inside TEXT.** Go replaces each bad byte with U+FFFD, while
  V8 replaces maximal subparts.
- **JSON keys that differ only by case** (`Content`, `Tag`) are matched as Go
  does, but duplicates are approximated. No such keys exist in the live data.
