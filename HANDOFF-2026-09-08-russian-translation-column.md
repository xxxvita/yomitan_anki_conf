# HANDOFF 2026-09-08 (RU translation column + event queue) — 9 of 10 tasks complete and review-clean, Task 10 not started

Role: **orchestrator** running `superpowers:subagent-driven-development`. I dispatch one implementer
subagent per task, then an independent reviewer per commit, then fix rounds until the review is
clean. I never write production code myself — controller fixes skip review and pollute controller
context. Canon in play: P8 (spec → adversarial self-check → fix), TDD per task.

User's standing instructions for this run (do not silently drop them):

1. after **every** commit — independent review by an **Opus** agent;
2. at the very end — **adversarial review by Fable** agents;
3. talk to the user in Russian; artifacts (this file, code comments, commit messages) stay in
   their natural language — commit messages are **English**, matching this repo's history.

---

## 0. TL;DR — where we are

The plan `docs/superpowers/plans/2026-09-07-russian-translation-column.md` (10 tasks) is being
executed in an isolated git worktree. **Tasks 1-9 are complete, committed and ledger-confirmed
review-clean.** Task 9 (column + blur + `translation_opened` event) needed three fix rounds; its
third scoped re-review returned clean (all findings closed, no new Critical/Important) and is
recorded in the ledger. Task 10 (`word_added_to_dict` hook into the Anki add path) is
**not started** — it is the only remaining implementation work. After Task 10: final whole-branch review on the most capable model,
then the Fable adversarial pass, then `superpowers:finishing-a-development-branch`.

⚠️ This plan deliberately covers **only** the RU column and the event queue. Chunk search (spec §4),
dictionary delivery (spec §3.5) and the anki_conf-side export tooling (spec §12) are **separate
plans that do not exist yet**.

---

## 1. Proven conclusions / decisions

### 1.1 State verified by command at handoff time

| fact                                  | value                                                                                      | how verified                                |
| ------------------------------------- | ------------------------------------------------------------------------------------------ | ------------------------------------------- |
| worktree path                         | `/home/xxxvita/Work/yomitan_phrases/src/.claude/worktrees/feat-russian-translation-column` | `pwd`                                       |
| branch                                | `worktree-feat-russian-translation-column`                                                 | `git branch --show-current`                 |
| HEAD                                  | `b1614590`                                                                                 | `git rev-parse --short HEAD`                |
| working tree                          | clean, nothing uncommitted                                                                 | `git status --short` (empty)                |
| commits on top of the plan commit     | 17 (9 `feat`, 8 `fix`)                                                                     | `git log --oneline c8ca281a..HEAD \| wc -l` |
| code delta                            | 36 files changed, 3543 insertions, 132 deletions, 20 new files                             | `git diff --shortstat c8ca281a..HEAD`       |
| tasks ledger-confirmed complete       | 9 (Tasks 1-9)                                                                              | `grep -c 'complete (commits' <ledger>`      |
| controller rulings recorded           | 24                                                                                         | `grep -c 'Ruling:' <ledger>`                |
| deferred minor findings               | 63                                                                                         | `grep -c 'minor (deferred' <ledger>`        |
| parked findings (loop stopped at cap) | 2, both Task 8                                                                             | `grep -c 'minor (parked' <ledger>`          |

`PROVEN` Baseline before any of this work: `npm run test:fast` = 4116 tests passed, 46 skipped
(measured on commit `c8ca281a`, before Task 1).

`PROVEN` Current state at `b1614590`, from an independent `npm run test:fast` run by the
controller (exit 0): `Test Files 57 passed (57)`, `Tests 4222 passed | 46 skipped (4268)`.
That is +106 passing tests over the 4116 baseline. The number matches what the Task 9 implementer
reported, so implementer and controller runs agree.

### 1.2 The one defect in the plan that no per-task review would have caught

`PROVEN` (read in `ext/js/display/display-generator.js:152`) `createTermEntry` builds a
`.definition-item` DOM node for **every** definition of an entry, RU definitions included. So the
Russian translation is **already rendered as an ordinary, fully visible row** in the definition
list before the column exists.

Consequence, if left alone: the user simply does **not** press `Ru` and reads the translation in
plain text below — no blur, no `translation_opened` event. The blur, the IndexedDB event queue and
the whole accounting mechanism become decorative.

`DECIDED` (controller ruling, Task 9): definitions belonging to the translation dictionary are
**always removed from the normal definition flow** — independent of column open/closed state,
independent of host, independent of pairing strictness. They exist only as the right-hand cell.

`DECIDED` (refinement after review) The removal is gated on `resultOutputMode === 'group'` and
nothing else. Rationale, verified in code by the reviewer: a node carrying
`data-dictionary === <translation dictionary>` cannot exist unless that dictionary is installed and
enabled, so an extra "is the dictionary installed" check is redundant and would either need
synchronous access that does not exist or reintroduce a window where the translation is visible.
Rejected alternative: leaving removal fully unconditional — that lost RU definitions entirely in
`split`/`merge` modes, where no column is ever built, with no way to get them back from the UI.

### 1.3 Load-bearing rulings (full list of 24 is in the ledger; these are the ones a re-reader must know)

- **Task 1** — the plan's own test for "the popup shrinks when one of two owners releases" passed
  **by construction of the signature**: `computeAppliedSize` has no "current size" parameter, so the
  old bug was unrepresentable. Required a behavioural test on `_applyPopupSizeTarget` **plus a
  mutation check** (put the defect back, confirm the test goes red). The spec (criterion A22) is the
  binding authority; the plan is only its argument.
- **Task 1** — `_onApiFitPopupForViewport` was a **second** path that resized the popup and wrote the
  original-size slot, bypassing the new registry; the arbiter would have silently undone its growth
  (video-examples modal collapses under itself). Routed through the registry as owner
  `'viewport-fit'`. Rejected: excluding fit's height from the calculation — that restores the
  original "never shrink" defect.
- **Task 3** — `dedupKey` separator was `|`, forgeable via URL or lemma content (two different
  triples collapse to one string; confirmed by running it). Changed to `U+0000`. Severity was Minor,
  **promoted** because Task 4 was about to start persisting these keys in IndexedDB and changing the
  format after release would orphan already-written keys.
- **Task 4** — `_rotate()` deleted the event and its dedup keys in **separate transactions**; a
  worker death between them (MV3 kills the service worker on idle — the exact scenario the on-disk
  dedup exists for) left an **orphaned key that can never be reached again**, because rotation finds
  keys only by walking events. That lemma is muted forever, silently. Fixed with a single
  `readwrite` transaction over `['events','dedup']`. Rejected: merely swapping the delete order —
  narrows the window, does not remove the split.
- **Task 4** — the "failed write leaves no dedup key" test (spec criterion A28) was **vacuous**:
  `events.add` threw synchronously _before_ any `dedup.add` ran, so there was nothing to roll back,
  and a non-atomic implementation passed it identically. Fixed by putting `dedup.add` **before**
  `events.add` inside the same transaction, plus a second test for the opposite direction.
- **Task 6** — the plan told the implementer to duplicate the new defaults into
  `ext/data/provisioning/default-options.json`. `PROVEN` that block is **dead**: the seed is pinned
  at `"version": 75`, `options-util.js:143` runs migrations over it, and `_updateVersion78` assigns
  both branches unconditionally. The plan's stated premise ("otherwise a clean profile gets one
  thing and a migrated profile another") was simply wrong for a newly added branch. Block removed;
  the migration is the single source.
- **Task 6** — `redactFlibSecrets` (strips the user's personal key from the settings export) had
  green unit tests but **no test at the call site**: deleting the one wrapper line in
  `backup-controller.js` left all tests green while the key went into the backup file. Minor by
  rubric, **promoted** because it is a security property with no guard, and this repo had already
  produced two "green and dead" defects.
- **Task 8** — the plan asked for a separate `.translation-toolbar`, not knowing `DisplayAnki`
  already creates a `.popup-toolbar` above `#dictionary-entries` with the same `insertBefore`.
  Two stacked bars in the default case, with **non-deterministic order**. Merged into one shared
  helper `ext/js/display/popup-toolbar.js`. Rejected: styling both to match (leaves two bars) and
  `querySelector`-ing the other module's bar (swaps one non-determinism for another).
- **Task 8** — **loop stopped at round 2 of 5 with 2 findings parked.** Findings were converging
  (Important → Minor → Minor) but each round left a narrow residue of the same class, which reads as
  a structural property (visibility lifecycle split across `DisplayAnki` and `DisplayTranslation`)
  rather than a patchable bug. Both residues verified unreachable-or-self-healing before parking.
- **Task 9** — three fix rounds. Round 3 was granted for **two one-line CSS regressions the previous
  round introduced itself** (a fix applied to one layout and not carried to its twin), explicitly
  distinguishing this from Task 8's stop, where the residue was pre-existing.

### 1.4 Where the spec's own numbers came from (do not re-derive from anki_conf prose)

`PROVEN 2026-09-07` by building the artifact (`go run ./cmd/lexicon-chunk-dict --out <dir>` in
`anki_conf_deploy/turmalin_build`, no `--db` needed): every number in
`anki_conf/docs/api/chunks/README.md` is **stale** — it predates the matchset top-up in commit
`7c0e035a` of 2026-08-23.

| quantity                                                             | README claims  | measured                                  |
| -------------------------------------------------------------------- | -------------- | ----------------------------------------- |
| `chunk-dictionary-v1.json` size                                      | ~1.6 MB        | 6 754 188 bytes (6.44 MB), 464 KB gzipped |
| `counts.canonical` (distinct multi-word expressions)                 | 6 764          | 22 690                                    |
| `counts.surfaces` (inflected written forms)                          | 14 468         | 75 152                                    |
| `counts.max_surface_tokens` (contiguous scan window, in tokens)      | "6 today"      | 15                                        |
| `counts.separable` (expressions the daemon searches discontinuously) | 1 103          | 1 130                                     |
| share of 2-token surfaces whose first token ≠ `head`                 | 72 %           | 76 % (3 585 of 4 716)                     |
| vectors in `chunk-scan-vectors-v1.json`                              | "12 sentences" | 22                                        |

The scan vectors themselves are **not** stale: a rebuilt `chunk-scan-vectors-v1.json` is byte-identical
to the committed one, `sha256 abe15c62ebc775bae4779477dfb26d29b4989f9a873aca4c71635ccda17432a4`.

---

## 2. What remains, in order

### 2.1 Task 10 — `word_added_to_dict` (not started)

Brief is generated on demand (script path in §6):
`task-brief docs/superpowers/plans/2026-09-07-russian-translation-column.md 10`
BASE for the review package is `b1614590`.

Substance: a pure `pickAddedLemma({headword, expressionField})` in
`ext/js/display/display-translation.js`, plus two hook sites in `ext/js/display/display-anki.js`.

⚠️ Carry these into the dispatch — they are verified anchors the brief may state loosely:

- normal add: `_saveAnkiNote` at `display-anki.js:1842`; the event goes in the branch where
  `allErrors.length === 0` **and** `!button.dataset.overwrite` — an overwrite is editing an existing
  note, not adding to the dictionary;
- phrase popup: `_savePhraseNote`, the variable holding the field text is **`phraseText`** (not
  `expressionText`, which the plan's prose used), success branch is the `else` that calls
  `_setPhraseButtonState(cardFormatIndex, [noteId])`;
- when `noteId === null` the code pushes an error instead — no event must be sent there, because
  "duplicate prevented" is not "added".

### 2.2 Final whole-branch review

Dispatch on the most capable model with
`superpowers:requesting-code-review/code-reviewer.md`, using
`scripts/review-package <plan> <merge-base> HEAD`. **Point it at the ledger's 63 deferred and 2
parked findings** so it can triage which must be fixed before merge. The candidates I would flag
first are in §5.

### 2.3 Fable adversarial pass

Explicit user requirement. Runs after the final review, on the whole branch.

---

## 3. Current system state

- Isolated worktree, branch `worktree-feat-russian-translation-column`, based on `bef88775`
  (`origin/main` and local `main` were identical at branch time — verified, so the native worktree
  tool's default `fresh` base ref was safe).
- `src` is a **git submodule** of `yomitan_phrases`. `git rev-parse --show-superproject-working-tree`
  returns non-empty, which makes the naive "am I already in a worktree?" check (`GIT_DIR !=
GIT_COMMON`) give a false positive. Check for the submodule explicitly.
- Dependencies installed with `npm ci` **and** `npm run build:libs`. Without the second command
  `ext/lib/*` is absent and both `tsc` and eslint fail on unrelated errors.
- The SDD workspace `.superpowers/sdd/2026-09-07-russian-translation-column/` holds the ledger
  (`progress.md`), per-task briefs, per-task implementer reports and every review diff package.
  It is ignored via `.superpowers/.gitignore` containing `*` — deliberately **not** via the repo's
  `.gitignore`, to avoid polluting the tracked file.
- Task reports named `task-N-report.md` are the implementers' persistent memory across fix rounds.

---

## 4. Access

No secrets are involved in this plan. The settings branch `flibService` introduces
`gatewayUrl` and `personalKey` fields, but both default to `""` and no value exists anywhere yet.

⚠️ `personalKey` is a user credential. `redactFlibSecrets` strips it from the settings export
(`ext/js/pages/settings/backup-controller.js`); **never** write such a value into a handoff, a
memory record, a log or a commit.

Nothing in this work talks to a network service yet: the event queue has a writer and no sender.

---

## 5. Pitfalls / anti-instructions

⚠️ **Do not trust an implementer report's claim that a test proves something.** Three separate
"green and dead" defects surfaced in this run: a test passing by construction of the signature
(Task 1), a vacuous atomicity test (Task 4), and an unguarded security property (Task 6). Ask the
reviewer to establish a test's _discriminating power_ — "would this test go red if the defect came
back?" — every time a test is claimed to guard something.

⚠️ **Do not let a reviewer pre-judge, and do not pre-judge for it.** Never write "don't flag X" or
"treat X as Minor" in a review prompt. In this run, handing the reviewer a neutral fact ("the
implementer thinks two toolbars are acceptable — assess it yourself") produced a correct Important
finding that the implementer's own assessment had dismissed.

⚠️ **Do not run test suites in the background from a subagent.** One implementer stalled twice,
waiting for a background `test:fast` that had died when the machine ran out of memory. Foreground
runs only; a dead background job is indistinguishable from a slow one.

⚠️ **Do not use `pkill -f '<pattern>'` with a bare pattern.** It matches its own command line and
kills the caller. Kill by PID, or bracket the first character: `pkill -f '[c]hrome'`.

⚠️ **`window.innerWidth` inside the popup display is the width of the popup iframe, not the page.**
The first plan revision computed the column layout from it and would have produced "stack" forever
— the column would never have opened. The layout decision is made by `Frontend`, which returns the
achieved size; the display picks columns-vs-stack from that answer.

⚠️ **`sender.tab.url` is unreliable and the codebase already knows it.** `backend.js:2186` says
verbatim it "works around the need to have the tabs permission to access tab.url", and no handler
reads `sender.tab.url`. In Firefox MV3 host permissions are optional, so the field is empty until
the user grants them — a gate built on it alone silently records nothing on the real flib.club.
Always fall back to `backend._getTabUrl(tabId)`.

⚠️ **`display:block` on a flex item is blockified and does not change layout.** The plan's "stack"
fallback relied on it and did nothing. Both layouts are now explicit grids.

⚠️ **`order` is ignored for explicitly placed grid items but honoured in auto-placement.**
`button.expansion-button` carries `order: 1`, which silently reordered the auto-placed grid and put
the translation cell in the wrong track.

⚠️ **A plan's own text is not authority.** Four Important findings in this run were _plan-mandated_
defects. The spec is the binding authority; when a review contradicts the plan, rule on it and
record the ruling — do not dismiss the finding because "the plan said so".

---

## 6. Artifacts

| path                                                                                                            | what                                                                                             |
| --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `docs/superpowers/specs/2026-09-07-russian-translation-and-chunk-search-design.md`                              | the spec (revision 3, 43 acceptance criteria A1-A42, open questions §11) — **binding authority** |
| `docs/superpowers/plans/2026-09-07-russian-translation-column.md`                                               | this plan (revision 2, 10 tasks)                                                                 |
| `.superpowers/sdd/2026-09-07-russian-translation-column/progress.md`                                            | the ledger: task status, 24 rulings, 63 deferred + 2 parked findings                             |
| `.superpowers/sdd/.../task-N-brief.md`                                                                          | per-task requirements handed to implementers                                                     |
| `.superpowers/sdd/.../task-N-report.md`                                                                         | implementer reports incl. fix rounds                                                             |
| `.superpowers/sdd/.../review-<base>..<head>.diff`                                                               | review packages (commit list + stat + full diff)                                                 |
| `~/.claude/plugins/cache/claude-plugins-official/superpowers/6.3.0/skills/subagent-driven-development/scripts/` | `sdd-workspace`, `task-brief`, `review-package`                                                  |

Source of the spec's requirements: `anki_conf_deploy/turmalin_build/docs/tasks/browser-yomitan-russian-dict.md`.

---

## 7. Memory (MCP)

- `2738` — lesson: numbers in `anki_conf/docs/api/chunks/README.md` are stale; rebuild the artifact,
  read `tokenizer_regex` / `split_rules` / `counts.max_surface_tokens` from the artifact, never from
  the prose; the vectors' `note` fields contradict their own `matches`.
- `2740` — fact: dictionary auto-provisioning in this fork is **dead** (`dictionaries.json` is `[]`,
  emptied by commit `54500dad`), the installer copies a zip nobody imports, and
  `_isProvisioningPending` reopens the welcome page on every service-worker wake. Also records the
  owner's decision to download dictionaries from the server instead.
- `2742` — lesson (critical): when porting an algorithm, port the **enabler** before the
  refinements. Porting the daemon's gap rules without the `separable` flag let three false
  discontinuous matches through; a test must assert the _reason_ for rejection, not just the result.

---

## 8. NEXT STEP

Generate the Task 10 brief and dispatch its implementer (model: cheapest tier — the plan text
contains the complete code, so this is transcription plus testing), carrying the verified anchors
from §2.1: `_saveAnkiNote` at `display-anki.js:1842`, the `allErrors.length === 0 &&
!button.dataset.overwrite` condition, and `phraseText` (not `expressionText`) in `_savePhraseNote`.
Record BASE = `b1614590` before dispatching — the review package needs it.
