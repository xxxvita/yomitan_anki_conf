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
tmpfs, about 167 MB) and is removed on success and on an exception. Ctrl-C or
SIGKILL in the middle of a build leaves the journal snapshot behind; the next
run removes it (a start deletes snapshot dirs whose owner PID in `owner.pid` is
no longer alive). To remove it by hand, **only when no build or parity check is
running** (a concurrent run's live snapshot matches the same pattern):
`rm -rf "${TMPDIR:-/tmp}"/flib-dict-snapshot-*`. The builder uses Node's
`os.tmpdir()`, which honours `$TMPDIR`.

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
`wty-en-en.zip`, `flibooster-en-ru.zip`, `build.json` and two expression lists.
`build.json` records row counts, the sha256 of each zip, the transform
statistics, the guard results and the counts of both lists.

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

### Candidate lists for retranslation

The two lists are **candidates for retranslation**: UTF-8, one expression per
line, each line ends in `\n`, byte-wise UTF-8 order, no duplicates. An empty
list is an empty file, never a missing one.

| File                              | `build.json` field                  | Holds                                                                                         |
| --------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------- |
| `stale-authored-translations.txt` | `staleAuthoredTranslations.skipped` | authored expressions whose Russian was skipped as stale (see below)                           |
| `untranslated-authored.txt`       | `untranslatedAuthored.expressions`  | `flibooster-en` expressions with no `done` journal row at any address (new authored articles) |

The CLI prints both counts and file paths. The lists are not part of the
revision: a journal change that does not change the Russian rows (a removed
authored expression) leaves the revision unchanged, and an `up-to-date` rerun
replaces the lists and `build.json` in the existing directory.

Not in either list:

- an authored article whose legacy translation is only partial (a node
  `failed`): counted in `transform.skipped`, as before;
- an authored article rewritten into a pure redirect or deinflection (no
  translatable nodes): counted in `transform.noNodes`, not as stale.

**The path to retranslate authored articles is not designed yet (TBD).** The
lists cannot be fed to `lexicon-dict-enrich -list` as they are. To be solved:

1. `-list` defaults to `-source-dict wty-en-en` (`source.go:36`) and filters its
   queries by it (`source.go:183`), so `flibooster-en` articles are not translated.
2. With `-source-dict flibooster-en` it stops at `CheckFingerprint`: the journal's
   fingerprint is that of `wty-en-en`.
3. If journal rows ever appear with a real `flibooster-en` rowid, this builder
   fails fatally with "адрес … принадлежит словарю flibooster-en"
   (`enrich-transform.js`, the rowid branch of `buildRussianRows`).
4. The stale legacy rows stay in the journal, so the "got shorter" rule below
   would keep firing forever after a retranslation, unless those rows are
   removed or superseded.

### Stale authored translations: a deliberate divergence from Go

Owner decision, 2026-10-05: an LLM reviewer rewrites and rejects authored
`flibooster-en` articles. Their Russian translations are journal rows with
`dict_rowid = 0` (legacy), so a rewritten article no longer matches them.
**They are not retranslated wholesale (token cost); they are skipped and
listed as candidates for a selective retranslation (path TBD, see above).**

In the legacy branch only, the whole journal article is skipped (no Russian
row at all, never a half-translated one) and listed, in four cases:

| Case                                                         | Condition we check                                         | Go `-export`                                                                                                            | This builder                   |
| ------------------------------------------------------------ | ---------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Text changed: a `done` node's `source` differs from the text | resolved host is `flibooster-en`                           | throws (unless an earlier node lacks a translation: then a silent `Skipped++`)                                          | skip + list                    |
| Got shorter: a `done` path no longer exists in the article   | resolved host is `flibooster-en`                           | throws in `ApplyTranslations` only if the article is complete and changed; otherwise a silent `Skipped++`/`Unchanged++` | skip + list                    |
| Got longer: a translatable node has no journal row at all    | resolved host is `flibooster-en`                           | silent `Skipped++` (incomplete article)                                                                                 | skip + list (not in `skipped`) |
| Expression gone from `dict_base.db`                          | `dict_base.db` has **any** `flibooster-en` row (see below) | throws ("нет в словаре")                                                                                                | skip + list                    |

Limitation of the last case: no host row is left to look at, so the check is
per database, not per expression. A legacy row that once resolved to a
`wty-en-en` article whose expression later vanished would be listed as stale
instead of failing. The risk is close to zero today: all 458 legacy expressions
are authored, and Go writes the real `dict_rowid` for `wty-en-en` articles.
With no `flibooster-en` rows at all, it is the wrong base, and the build fails
as before.

Everything else stays fatal, in particular a text mismatch against a
`wty-en-en` host, whether addressed by rowid or resolved from a legacy row:
that means the English dictionary itself diverged from the journal.
anki_conf has been told (docs/tasks/2026-10-04-anki-conf-dictionary-publishing.md, §5).

Parity is unaffected on inputs without such rows: no row the old builder
emitted is dropped, and the zips are byte-identical (pinned by a unit test).
Once authored articles change, Go's export fails in the first, second and
fourth cases, and the parity check has no reference until anki_conf adopts
the same rule.

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
