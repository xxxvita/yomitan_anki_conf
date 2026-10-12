> UPDATE 2026-10-12: §2.A (swap of the desktop app's `dict_base.db`) is DONE (2026-10-05, memory 3032).
> Later, unrelated work (gateway examples, tpk\_ key, Anki two routes) → `HANDOFF-2026-10-12-gateway-examples.md`.
> This file stays the source of truth for the DICTIONARY PIPELINE topic only.

# HANDOFF 2026-10-05 (dictionary pipeline: anki_conf data → Flib-club extension) — fresh pair built, one pending action: swap the desktop app's dictionary DB

Role: orchestrator. I dispatch implementer/reviewer subagents, never write production code myself.
Canon in play: P8 (spec + ≥5 edge cases shown to the owner BEFORE code → tests first → adversarial
audit → apply HIGH/CRIT), D1–D4 (recall rakes first; enumerate state by grep, never infer; a field
with no reader = hole; hand the reviewer the load-bearing claim verbatim). The owner's standing rule:
an independent Opus review after every code commit. Talk to the owner in Russian; artifacts and
commit messages in English.

> Supersedes `HANDOFF-2026-09-08-russian-translation-column.md` (that branch is fully merged into
> `main`). Ignore `docs/HANDOFF.md` — untracked, not written by this work, not ours to touch.

---

## 0. TL;DR — where we are

The extension's EN/RU dictionary pair is now built **by this repo, from anki_conf's DATA files, with
one command** (`npm run build:dictionaries`), not by anki*conf's code. Overnight 2026-10-04/05 the
LLM reviewer of anki_conf's \_authored* articles was run to completion (786 approved), the approved
set was exported into a NEW dict_base file, and a fresh pair was built from it
(`builds/dictionaries/2125428-2008035-f45589d9b800/`, 162 479 Russian articles, contract-verified).
**One action is pending:** replace the running desktop app's `dict_base.db` with the exported file —
blocked only on the owner closing the app (it holds the DB open). The new file is already staged
next to it as `dict_base.db.new`. Everything else that remains is anki_conf-side work (see §2.B).

---

## 1. Proven conclusions / decisions

### 1.1 How a translation reaches the extension (VERIFIED by reading anki_conf code + journal queries)

anki*conf's translator (`cmd/lexicon-dict-enrich`) writes LLM translations into a **journal**
`~/dict-enrich-20260828/enrich.db` (table `enrich_log`: one row per translated \_node* of an English
article; `author_log`: LLM-_authored_ articles for expressions that have no English dictionary
article at all). The journal is NOT the dictionary. anki_conf moves it into the dictionary only via a
manual `lexicon-dict-enrich -export`, and its own pair builder reads Russian ONLY from `dict_base.db`.
⚠️ So "the pair matches dict_base.db" does NOT mean "the pair is fresh" — freshness must be checked
against the journal (my error 247: I once called a month-old pair "current" this way).

### 1.2 DECIDED: our own builder, independent of anki_conf's code (owner, 2026-10-04)

- `npm run build:dictionaries` (code in `dev/dictionary-pair/*.js`, CLI `dev/bin/build-dictionaries.js`,
  docs `docs/development/dictionary-pair.md`) reads `dict_base.db` (English: `wty-en-en` +
  `flibooster-en`) and the journal `enrich_log` (Russian), writes
  `builds/dictionaries/<revision>/{wty-en-en.zip, flibooster-en-ru.zip, build.json}`.
  Flags: `--dict <db>`, `--journal <db>`, `--verify <dir>`. Not part of `npm test` (CI has no data).
  Also wired into `scripts/build-all.sh` (opt-out `--no-dictionaries`).
- The Go "journal → Russian article" transform (17 steps) was PORTED to JS. Rejected alternative:
  calling anki_conf's Go binaries at build time (code dependency + unmerged branch).
  Drift guard: `npm run check:dictionary-parity -- --reference <export.db>`, the reference produced by
  anki_conf's own Go `lexicon-dict-enrich -export` into a scratch file. Parity on 2026-10-04:
  161 032 / 161 032 Russian articles identical. ⚠️ Parity proves equivalence on CURRENT data only;
  the U+0085/U+FEFF whitespace rule and UTF-8 sort are held by unit tests. Re-run parity whenever
  anki_conf changes its enrich code.
- **revision** (the `index.json.revision` both zips share, which the extension requires to be
  identical) = `<total rows>-<max rowid>-<12 hex of sha256 over the canonical row serialisation>`:
  content-derived, NOT file-mtime-derived. Same data → same revision → `up-to-date`.
- The journal is read from a snapshot (`VACUUM INTO` a temp dir `flib-dict-snapshot-*` under
  `$TMPDIR`, ~167 MB, RAM on this machine) with `busy_timeout 5000`; a stale-snapshot sweep by owner
  PID runs at start. ⚠️ Do NOT wrap the read in one long `BEGIN`: the journal is a rollback journal and
  that would block anki_conf's writer past its 5 s busy timeout and crash a live translation run.
- **Stale authored translations (owner decision 2026-10-05: do not retranslate everything):** the
  1 112 legacy journal rows (`dict_rowid = 0`) translate the OLD text of authored articles. When an
  authored article's text changed (or it disappeared / got shorter / got longer), the builder SKIPS
  that article's Russian and COUNTS it, writing two worklists next to `build.json`:
  `stale-authored-translations.txt` and `untranslated-authored.txt` (one expression per line).
  Every other integrity error (anything involving a `wty-en-en` host) stays fatal.
  ⚠️ anki_conf's Go `-export` still THROWS on these cases (deliberate divergence, documented).
  Known limit (MED-1, documented): the "expression removed" branch checks that the DB has any
  `flibooster-en` rows, not that this expression was authored.

### 1.3 Overnight review of authored articles — RESULT (VERIFIED by journal query 2026-10-05)

`author_log` counts now: **786 approved** (`status='done' ∧ review_status='ok' ∧ review_of=attempt`;
was 106 before the night), **0** unreviewed, **98** `manual` (rejected by the reviewer in all 3
versions — never exported), **48** hopeless (`failed` with fix/reject: 39 where the model returns no
article — e.g. `report in`, `bank in`, `charge with`, which the reviewer judged not to be real
expressions — and 9 with no corpus examples to write from).

- Re-authoring DOES use the reviewer's note (`authorrun.go:76` `ReviewNote` → prompt at
  `authorprompt.go:76`); verified all rejected rows had a note. Re-written articles passed far more
  often (round 1 final: 265 ok / 165 fix; first pass, snapshot at batch 143 of 162: 292 ok / 373 fix).
- ⚠️ The 3-strike rule counts only reviewer verdicts; the 48 hopeless never reach the reviewer, so the
  chain would loop on them until round 12 burning model calls. I stopped it manually.
- Throughput bottleneck is corpus lookup in `corpus.db` (65 GB on disk), NOT the model:
  15 workers ≈ 210 articles/h vs ~190/h at 5. A model subprocess (`claude -p`) is ~250 MB RSS
  (the owner had feared 3 GB; measured).

### 1.4 Export of approved authored articles (VERIFIED)

`~/dict-enrich-20260828/export/dict_base-authored-20261005.db` (1 595 400 192 bytes): `flibooster-en`
874 rows / 786 expressions (one row per part of speech), `flibooster-en-ru` 44 530 (unchanged —
see §2.B), `wty-en-en` 1 962 075. journal_mode `delete`, no `-wal/-shm/-journal`. sha256 of the live
`dict_base.db` (`66ae2782c7d1…`) and of the journal were identical before and after the export.
Command (run from `~/Work/English/services/anki_conf/cmd/lexicon-dict-enrich`):
`~/dict-enrich-20260828/lexicon-dict-enrich -export-authored <OUT> -dict ~/.config/anki-connect-desktop/data/yomitan/dict_base.db -work ~/dict-enrich-20260828`
⚠️ `-export-authored` COPIES `-dict` into the output and rewrites only `flibooster-en`. The review
scripts pass `-dict …/dict_base.db.en-only-backup`, which has NO Russian — using that here would
have produced a DB without the app's 44 530 Russian rows (my error 248, caught by a Fable review).

### 1.5 The fresh pair (VERIFIED independently with jq/comm, not from the builder's report)

`builds/dictionaries/2125428-2008035-f45589d9b800/` built with `--dict <export file>`:

- `flibooster-en-ru.zip`: 162 479 rows, sha256 `8eec4d1d5e3de3a2331de2e6e6fcdaf35e5a9ceea335fcb10181af4464fab604`;
  every Russian stamp unique, > 0, has an English host, none on a deinflection-only English row.
- `wty-en-en.zip`: 1 962 949 rows (1 962 075 `wty-en-en` + 874 `flibooster-en`), sha256 `f693f4e35c5ed146…`.
- Same revision in both, `sequenced` only on English, no `isUpdatable/indexUrl/downloadUrl`.
- Authored articles WITH Russian: 122 (= 458 legacy − 336 stale). WITHOUT Russian: 755
  (336 stale + 419 never translated) — listed in the two worklists in that dir.
- Russian count grew +1 447 vs the previous pair because a translation window (`run-window.sh`,
  list `next-multi-20260925.txt`) ran 2026-10-05 02:45–02:58, started by someone else (NOT this
  session), adding 2 377 `wty-en-en` translations. Harmless, but it ran concurrently with the review
  chain, which Fable had advised against.
- Previous pair (pre-review, still on disk): `builds/dictionaries/2123663-1962631-ea47cfa48c7a/`.

---

## 2. What remains

### 2.A PENDING — swap the desktop app's dictionary DB (owner said "Делай", 2026-10-05)

State: the app is RUNNING (dev launch from `~/Work/English/services/anki_conf/electron`, process
`core` pid 589420 holds `~/.config/anki-connect-desktop/data/yomitan/dict_base.db` open per `fuser`;
it has a remote-debugging port, possibly used by another agent — do not kill it yourself).
Staged: `…/yomitan/dict_base.db.new` = exact copy of the export (sha256 prefix `2b307c15a812e2e3`).
Steps once the OWNER has closed the app:

1. `fuser …/yomitan/dict_base.db` must print nothing.
2. `mv dict_base.db dict_base.db.bak-20261005 && mv dict_base.db.new dict_base.db` (rename only — never
   `cp` over an open/immutable-opened DB).
3. Do NOT touch `dict_base.db.stamp` or `dict_base.db.en-only-backup`. NOT RE-VERIFIED by me — from
   the Fable plan review (anki_conf `base_unpack.go:39-45`): the stamp keys on the app's bundled
   archive, so a replaced DB survives restarts; a FUTURE app build with a new bundled archive would
   re-unpack over it (pre-existing risk, applies to today's file too).
4. Owner starts the app. Expected: the app sees all 786 authored articles (English).
   ⚠️ What the app will NOT get from this swap (already told to the owner): its Russian side stays the
   2026-09-05 export (44 530 articles); the ~118k newer translations exist only in the extension pair.
   And it cannot yet "translate the untranslated authored articles later" — see 2.B.

### 2.B anki_conf-side work (NOT started; documented in `docs/tasks/2026-10-04-anki-conf-dictionary-publishing.md` §5)

Confidence: items 1–2 come from the reviewer of commit `38bd020d` and the Fable plan review, anchored
to anki_conf `source.go:36,183` and `export.go:221-229,266-271,318-327`; NOT re-read by me. Item 3
is in our own code (VERIFIED by that review's mutation runs).

1. Its translator cannot translate authored articles: `-source-dict` defaults to `wty-en-en` and
   queries filter by it; with `-source-dict flibooster-en` it fails `CheckFingerprint` (journal
   fingerprint is `wty-en-en`). Needed so the 755 authored articles in the worklists can be translated.
2. Its Go `-export` throws on stale legacy authored translations — needs the same skip-and-count rule
   (or the stale legacy rows removed, with a backup) before it can refresh the app's Russian.
3. If translations of authored articles ever appear with a real `flibooster-en` `dict_rowid`, OUR
   builder currently throws ("address belongs to flibooster-en", `enrich-transform.js` ~611-613) —
   must be designed together with item 1.
   The owner was offered a concrete task file for anki_conf's agent (with the 336 + 419 lists); no answer yet.

### 2.C Extension-side backlog (owner-confirmed direction: the plugin must work WITHOUT anki_conf)

- Dictionary delivery to users: spec §3.5 pointer → `latest.json` → fingerprint dir with both zips +
  sha256, plus a permanent "download/update dictionaries" button in settings. NOT built. Today the
  only path is manual import of the two zips.
- Event queue (`translation_opened`, `word_added_to_dict` in IndexedDB `flib-events`) is wanted
  (owner: used for the learner's route soon); destination is turmalin_gateway; NO sender and NO
  receiver on the gateway yet. Keep the queue.
- Deferred MED-2: builder peak RSS ~4.8 GB (whole banks held in memory + JSZip copy). Fixable by
  streaming; not urgent.
- Open owner decision: what to do with the 98 `manual` + 48 hopeless authored articles (currently
  simply excluded).

---

## 3. Current system state (VERIFIED 2026-10-05 ~13:10 local)

- `yomitan_phrases/src`: branch `main` at `9815c595`, 61+ commits ahead of `origin/main`, NOT pushed.
  Tree clean except untracked `.claude/` and `docs/HANDOFF.md` (both not ours).
- Old worktree `.claude/worktrees/feat-russian-translation-column` (branch at `ef458e9d`, fully
  merged) still exists. ⚠️ Its presence makes `npm test` in the main checkout fail (eslint scans it)
  — run full tests in a clean `git worktree add` copy, or remove that worktree (owner's call).
- Extension in Chrome is loaded unpacked from `~/Work/yomitan_phrases/src/ext` (ID
  `epejdgdldhcihkikkpalfolmkikdmjpb`); `ext/manifest.json` is gitignored/generated, version 0.3.1.0.
  Popup trigger is hover + **Shift** (provisioned `scanning.inputs`).
- No `lexicon-dict-enrich` process is running. Last chain: `~/dict-enrich-20260828/author-review-parallel-20261005.sh`
  (stopped manually at round 4); logs + `schedule.log` in `~/dict-enrich-20260828/`.
- Journal `enrich_log` = 394 714 rows (was 392 338 on 2026-09-25 + the 02:45 window).

## 4. Access

No secrets involved. `flibService.personalKey` defaults to `""` — never write a value of it anywhere.

## 5. Pitfalls / anti-instructions

- ⚠️ Never `pkill -f`/`pgrep -f`/`ps | grep` with a bare pattern — they match your own shell (hit
  again tonight). Use explicit PIDs or `pgrep -x lexicon-dict-en` (exact comm).
- ⚠️ Stopping a chain: TERM the wrapper bash FIRST, then the `lexicon-dict-enrich` child, else the
  wrapper proceeds to its next step. Work is durable: each reviewer verdict is an autocommit UPDATE;
  restart resumes; reviewed articles are not re-reviewed.
- ⚠️ Never run two reviewers (or two authors) on the same journal — they take the same items, double
  the tokens.
- ⚠️ The chain sleeps 1800 s even when only 1 item is "не разобрано" (unparsed verdict, not a limit);
  killing just that `sleep` child resumes immediately.
- ⚠️ While a review/author chain runs, do not start `run-window.sh` / `limit-guard.sh` (they don't
  see `-author/-review` in their pgrep mask) or the old `author-review-window.sh`/`after-window.sh`
  (they would author ~1 025 NEW expressions).
- ⚠️ Taking a parameter from another script for a DIFFERENT tool mode: re-check it against that
  mode's code (error 248).
- ⚠️ Never claim a test proves something without a mutation showing it goes red; this project has a
  long history of "green and dead" tests.

## 6. Artifacts

- `dev/dictionary-pair/` + `dev/bin/build-dictionaries.js`, `dev/bin/check-dictionary-parity.js`;
  tests `test/dictionary-pair/`.
- `docs/development/dictionary-pair.md` — builder docs, parity procedure, known gaps.
- `docs/tasks/2026-10-04-anki-conf-dictionary-publishing.md` — instructions for anki_conf's agent (later).
- `docs/tasks/2026-09-08-dictionary-pair-for-flib-club-extension.md` — the pair contract.
- `~/dict-enrich-20260828/export/dict_base-authored-20261005.db` — exported dictionary (source of the swap).
- `~/dict-enrich-20260828/{author-written-20261004.txt, author-review-parallel-20261005.sh, mem-guard-all-20261005.sh}` — tonight's list/chain/memory guard.
- Pairs: `builds/dictionaries/2125428-2008035-f45589d9b800/` (current), `…/2123663-1962631-ea47cfa48c7a/` (previous).

## 7. Memory (MCP)

`3025` night result (this handoff's numbers) · `3008` reviewer durability/stop/threads (project
anki_conf) · `3005` builder decision · `2749` popup-size arbiter + rotation decisions · `2748`
"green and dead" test shapes · errors `247` (freshness vs journal), `248` (`-dict` for export).

## 8. NEXT STEP

When the owner says the app is closed: run §2.A steps 1–3 and report; then ask whether to write the
anki_conf task file for §2.B.
