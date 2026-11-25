# Phrases: flib_media and cards without a blank (Flibooster, task #437) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** the canonical Phrases note type shows saved videos and supports whole-phrase cards without a blank; the booth and the voice add-on handle such cards.

**Architecture:** only `internal/ankimodels/models/Phrases.json` changes in the note types; the installer needs no change (it appends fields and rewrites templates by content). Booth and `SidesFor` decide «cloze» by the blank in the shown text, not by the model name.

**Tech Stack:** Go, Anki templates (HTML/JS/CSS), TypeScript + vitest (jsdom), Python (pytest).

**Spec:** `/home/xxxvita/Work/yomitan_phrases/src/docs/superpowers/specs/2026-11-25-phrases-video-design.md`, part A.

## Global Constraints

- Worktree `/home/xxxvita/Work/English/services/anki_conf-437`, branch `feat/437-phrases-media`, base `turmalin/main` 6ae2a5d67. Never touch other worktrees.
- Commits: Conventional Commits with `[ID:437]`, last line `Claude-Session: https://claude.ai/code/session_01SB7EQ7SYtfvh46DQa89BsG`; **no Co-Authored-By trailer** (owner rule). Stage by name.
- Never push, open a PR or merge: the controller does it.
- ⚠️ NEVER run the full Go suite or `internal/modules/electron` tests: they launch the owner's real Anki. Run only the packages named in a task, with `-short -count=1`, through `GOTMPDIR=$HOME/Work/.gotmp bwrap --dev-bind / / --tmpfs $HOME/.config/anki-connect-desktop <cmd>`.
- Never contact 127.0.0.1:8765 or 8777. Never start Anki except as described in Task 4.
- `flib_media` is the LAST field. The model JSON contains no `ankimodels-rev` marker.
- Do not change `Yomitan Card Type.json`, `ReverseDeck.json`, `internal/cli`.
- Russian UI strings only where they already live (templates, i18n). EN and RU keys added together.

## Review Focus

- A phrase typed with curly quotes, a trailing «…» or a missing final period: the typed answer still matches.
- A legacy note without a blank (EnglishWord = one word, Expression = sentence): readable card, no answer box, back still shows the word and the sentence.
- A field with `&lt;img src=x onerror=…&gt;`: shown as text, nothing runs, front and back.
- `__` inside a media file name or in Expression: must not turn a no-blank card into a blank one or vice versa (only Front's text counts).
- Night mode and a 360 px window with a player in `flib_media`.

### Task 1: the note type

**Files:** Modify `internal/ankimodels/models/Phrases.json`, `internal/ankimodels/embed_test.go`. Create `electron/renderer/anki-templates/__tests__/phrases-template.test.ts` (jsdom; reads the JSON by path, writes the rendered template into a document, runs its inline scripts).

**Produces:** fields `Front, Expression, EnglishWord, ExpressionTranslate, Audio_front, Audio_expression, flib_media`; template still named `Card 1`.

- [ ] **Step 1: failing Go test** `TestPhrasesHasFlibMedia`: last field is `flib_media`; Front contains neither `flib_media` nor `flib-media`; Back contains `<div class="flib-media">{{flib_media}}</div>` exactly once, a direct child of `.sheet`, right after the closed `.hero`, before the first divider; the `.flib-media …` rules of Phrases CSS equal, byte for byte, the rules of `Yomitan Card Type` from `.flib-media {` to `.flib-media .flib-yt b {…}`. Share the placement helper with `TestYomitanCardTypeHasFlibMedia`.
- [ ] **Step 2: failing template tests** (vitest). Render = substitute `{{Field}}` (and `{{#X}}…{{/X}}`) the way Anki does, then run scripts:
  - blank card: Front `I <blank> it` shows `.blank`, eyebrow `вспомни пропущенное слово`, `#answerInput` visible; answer `love` ok.
  - no-blank card (Front `I love it`, EnglishWord and Expression `I love it`): eyebrow `прочитай вслух и вспомни перевод`; `.answer-row`, `.helpers`, `#answerList` hidden; `#VoiceInput` present; `.phrase` text `I love it`; no focus stolen.
  - legacy no-blank (Front=Expression=`She books a table`, EnglishWord=`book`): front as no-blank; back eyebrow `пропущенное слово`, `.prompt` = `book`, sentence shown with the word highlighted.
  - back of a whole-phrase card: eyebrow `фраза`, the phrase text occurs once, translation visible, no `<b>` highlight; equality survives `&nbsp;`, double spaces and entities; `Well` vs `Well.` is NOT equal.
  - typing: EnglishWord `Well, I don't know.` accepts `well, i don't know.`, `well i don't know`, `Well, I don’t know`; still accepts `well` and `i don't know` (as today); rejects `i know`. EnglishWord `R&amp;D` accepts `r&d`. EnglishWord `a<br>b` accepts `a` and `b`.
  - injection: Front `&lt;img src=x onerror=window.__x=1&gt; _____` → no `img`, `window.__x` undefined, text shown literally; same for EnglishWord and Expression on the back; EnglishWord `amp` with Expression `R&amp;D amp` highlights only the word, entity intact.
  - back highlight position: Front `I _____ love`, Expression `I love love`, EnglishWord `love` → only the first `love`; Front `I love _____` → only the second.
- [ ] **Step 3:** run both, see them fail.
- [ ] **Step 4:** implement in the JSON (keep one-line style of the file). Front: build the blank with DOM nodes from `textContent.split(/_{2,}/)`; class `no-blank` on `.front-typing` when there is no `/_{2,}/` in the text; typing engine: tokens as today plus the whole line without `, . ; : ! ? …`; compare `val` raw and stripped; read `#ew-data` lines as decoded text (split on `<br>` in HTML, then `textContent`). Back: `{{Front}}` in a hidden node for the highlight position; text-node highlighting.
- [ ] **Step 5:** `go test ./internal/ankimodels ./internal/cli -short -count=1` and the vitest file pass; existing `anki_bootstrap_*` tests pass unchanged.
- [ ] **Step 6:** commit `feat(anki): Phrases shows saved videos and whole-phrase cards [ID:437]`.

### Task 2: the voice add-on

**Files:** Modify `integration/anki_addon/voice_input.py` (`_expected_from_note`), `integration/anki_addon/answer_checker.py` (`check_answer`). Test: new `integration/anki_addon/test_answer_punctuation.py`; goldens `integration/anki_addon/testdata/card_adapters_char.golden.json` must not change.

- [ ] **Step 1: failing tests.** `_expected_from_note('Phrases', …)`: EnglishWord `Don&#39;t worry` → `["Don't worry"]`; `R&amp;D` → `R&D`; `a<br>b` → `['a','b']`; `&lt;b&gt;` is not treated as a tag (tags first, then unescape). Same for the non-ReverseDeck `expected_answer_field`. ReverseDeck path unchanged. `check_answer`: expected `Well, I know.` accepts `well I know`, `well, i know`, `so well i know yes` (substring as today); rejects `I know`; expected `it's` accepts `its`? — NO: apostrophes and hyphens are not removed. Everything accepted before is still accepted (table of 20 old pairs, positive and negative); empty after stripping (expected `…`) is never a match. Word boundaries stay as today.
- [ ] **Step 2:** run, fail. **Step 3:** implement: `html.unescape` after tag removal (nbsp → space); in `check_answer` a second comparison where `, . ; : ! ? …` become spaces, spaces collapse, in both strings; `normalize_text` itself is unchanged (commands use it).
- [ ] **Step 4:** `python -m pytest integration/anki_addon -q -k "answer or card_adapters or en_expression or voice_input_llm"` passes; compare failures with the base commit if any.
- [ ] **Step 5:** commit `fix(addon): expected answers are decoded and compared without punctuation [ID:437]`.

### Task 3: booth and sides

**Files:** Modify `electron/renderer/components/panels/AnkiBooth/card-direction.ts`, `BoothWall.tsx`, `electron/renderer/i18n/{ru,en}.ts`, `internal/modules/pronunciation/sides.go`. Tests: `__tests__/card-direction.test.ts`, BoothWall tests, `sides_test.go`.

**Produces:** `isClozeCard(noteModel?: string, prompt?: string): boolean` (true only for `Phrases` with `/_{2,}/` in prompt); `isWholePhraseCard(noteModel?, prompt?)` (Phrases, non-empty prompt, no blank); `askLabelKey(noteModel, fallback, prompt?)`, `askLabel(noteModel, fallback, lang, tr, prompt?)`; i18n `booth.v2.ask.readPhrase` ru «прочитайте фразу вслух», en «read the phrase aloud».

- [ ] **Step 1: failing tests**: cloze true/false by prompt; label keys for both; hover dictionary (`BoothHoverText`) only for cloze; direction label `booth.v2.dir.en` for both kinds of Phrases; preview uses `preview.prompt`; a Phrases card whose prompt is empty keeps the old cloze label. Snapshot `card-adapters.char.test.ts.snap` unchanged. Go: Phrases with a blank → RU = Front as today (existing test unchanged: Front without a blank there is Russian «взаимный» — keep it green: RU = ExpressionTranslate only when plain Front == plain Expression); whole phrase → RU = ExpressionTranslate text; empty translation → RU "".
- [ ] **Step 2:** fail. **Step 3:** implement; find every caller of `isClozeCard`/`askLabel` (`git grep`). **Step 4:** vitest of AnkiBooth, `npx tsc --noEmit -p electron` as the repo does, `go test ./internal/modules/pronunciation -short -count=1` + `go vet` on it.
- [ ] **Step 5:** commit `feat(booth): a whole phrase is read aloud, not recalled [ID:437]`.

### Task 4: docs and live check

- [ ] Update `deploy/anki-bootstrap/README.md` (Phrases answer field is EnglishWord; `--update` overwrites templates and appends fields; `flib_media`), `docs/ref/card-enrichment-and-pos.md` (Phrases fields, whole-phrase cards written by the extension, tag `flib_enriched`). Commit `docs(anki): Phrases fields [ID:437]`.
- [ ] Controller: isolated Anki (memory 4507: own `ANKI_SINGLE_INSTANCE_KEY`, `anki -b <tmp>`, xvfb, CDP; never 8765): import the old model with a note, run `anki-bootstrap install --update` against an isolated AnkiConnect port if available, else apply fields/templates through `anki.collection`; screenshots day/night, 360 and 1280 px: blank, whole phrase, legacy, player, clip + old list; editor opens the note.
- [ ] Whole-branch review (Opus, adversarial, spec part A + Review Focus), one fix wave, PR to `x2-2/turmalin`. **Merge only on the owner's word.**
