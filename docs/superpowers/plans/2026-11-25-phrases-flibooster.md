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
- `electron/node_modules` is a symlink to `../../anki_conf/electron/node_modules` made by the controller; `.gitignore` does not cover a symlink — NEVER stage it. Never run `npx` that would download; use `./node_modules/.bin/*` inside `electron/`.
- Never contact 127.0.0.1:8765 or 8777. Never start Anki except as described in Task 4.
- `flib_media` is the LAST field. The model JSON contains no `ankimodels-rev` marker.
- Do not change `Yomitan Card Type.json`, `ReverseDeck.json`, `internal/cli`.
- Russian UI strings only where they already live (templates, i18n). EN and RU keys added together.

## Review Focus

- A phrase typed with curly quotes, a trailing «…» or a missing final period: the typed answer still matches.
- A legacy note without a blank (EnglishWord = one word, Expression = sentence): readable card, no answer box, back still shows the word and the sentence; reading the sentence aloud is accepted.
- A field with `&lt;img src=x onerror=…&gt;`: shown as text, nothing runs, front and back.
- `__` inside a media file name or in Expression: must not turn a no-blank card into a blank one or vice versa (only Front's text counts).
- Night mode and a 360 px window with a player in `flib_media`.

### Task 1: the note type

**Files:** Modify `internal/ankimodels/models/Phrases.json`, `internal/ankimodels/embed_test.go`. Create `electron/renderer/anki-templates/__tests__/phrases-template.test.ts` (`// @vitest-environment jsdom`, no `import 'jsdom'`; reads the JSON by path, injects the model CSS as `<style>`, writes the rendered template into the document, re-creates `<script>` nodes so they run; removes `resize` listeners and resets the document between tests).

**Definition used everywhere:** a _whole-phrase front_ = plain Front text is non-empty, has no `_{2,}` and no Cyrillic letter. A Russian Front without a blank keeps today's layout. A _whole-phrase back_ = whole-phrase front AND EnglishWord equals Expression after decoding and collapsing nbsp/whitespace (punctuation kept).

**Produces:** fields `Front, Expression, EnglishWord, ExpressionTranslate, Audio_front, Audio_expression, flib_media`; template still named `Card 1`.

- [ ] **Step 1: failing Go test** `TestPhrasesHasFlibMedia`: last field is `flib_media`; Front contains neither `flib_media` nor `flib-media`; Back contains `<div class="flib-media">{{flib_media}}</div>` exactly once, a direct child of `.sheet`, right after the closed `.hero`, before the first divider; the `.flib-media …` rules of Phrases CSS equal, byte for byte, those of `Yomitan Card Type` (from its comment block to `.flib-media .flib-yt b {…}`); no `{{text:` in either template; no field reference to `flib_media` or `Front` inside HTML comments (Anki renders mustaches there). Share the placement helper with `TestYomitanCardTypeHasFlibMedia`.
- [ ] **Step 2: failing template tests**. Render = substitute `{{Field}}` and `{{#X}}…{{/X}}`. «Hidden» is asserted with `getComputedStyle(el).display === 'none'` (the rules `.answer-row`, `.helpers`, `.answer-list` are `display:flex`, so the attribute alone would not hide them in Anki); «text» is asserted on visible nodes; focus is asserted after a timer tick (the script focuses in `setTimeout(0)`).
  - blank card: Front `I _____ it` shows `.blank`, eyebrow `вспомни пропущенное слово`, `#answerInput` visible and focused; `love` ok; the first hint letter and the order of listed answers are as before the change (whole-line tokens go AFTER all chunks).
  - whole phrase (Front=EnglishWord=Expression `I love it`): class `no-blank` on the outer `.front-typing`; eyebrow `прочитай вслух и вспомни перевод`; `.answer-row`, `.helpers`, `.answer-list` hidden; `#VoiceInput` present and visible; the phrase text visible; `document.activeElement` is body after the tick.
  - legacy without a blank (Front=Expression=`She books a table`, EnglishWord=`book`): front as whole phrase; back eyebrow `пропущенное слово`, `.prompt` = `book`, the sentence shown WITHOUT any `<b>`.
  - Russian Front without a blank (`бежать`): today's layout, input visible.
  - back of a whole-phrase card: eyebrow `фраза`, `.prompt` = the phrase, `#sentence-en` removed from the document, translation and audio visible, no `<b>`; equality survives `&nbsp;`, double spaces, entities; `Well` vs `Well.` is not equal; Front with a blank and EnglishWord==Expression keeps the blank layout.
  - typing: EnglishWord `Well, I don't know.` accepts `well, i don't know.`, `well,i don't know`, `well i don't know`, `Well, I don’t know`; still accepts `well` and `i don't know`; rejects `i know`. `R&amp;D` accepts `r&d`. `a<br>b` accepts `a` and `b`. Punctuation `, . ; : ! ? …` becomes a space, spaces collapse.
  - injection: Front `&lt;img src=x onerror=…&gt; _____` → `querySelector('img') === null` and the text is shown literally, front and back; same for EnglishWord and Expression; EnglishWord `amp` with Expression `R&amp;D amp` highlights only the word, the entity is intact.
  - highlight of a blank card: Front `I _____ love`, Expression `I love love`, EnglishWord `love` → only the first; Front `I love _____` → only the second; when Front does not fit Expression → the first whole-word occurrence (`art` is not found in `party`).
- [ ] **Step 3:** run both, see them fail.
- [ ] **Step 4:** implement in the JSON. Front: blank built with DOM nodes from `textContent.split(/_{2,}/)`; `.no-blank` CSS hides the three blocks; tokens read from decoded text (split on `<br>` in HTML, then text). Back: `<template id="front-data">{{Front}}</template>` read through `.content.textContent` (inert, unlike `display:none`); text-node highlighting. A `[sound:]` in Front would also play on the back — accepted, writers never put one there.
- [ ] **Step 5:** `go test ./internal/ankimodels ./internal/cli -short -count=1` and the vitest file pass; `anki_bootstrap_*` tests unchanged.
- [ ] **Step 6:** commit `feat(anki): Phrases shows saved videos and whole-phrase cards [ID:437]`.

### Task 2: the voice add-on and grading prompts

**Files:** Modify `integration/anki_addon/voice_input.py` (`_expected_from_note` and its two callers at :3540 and :4088), `integration/anki_addon/answer_checker.py` (`check_answer`), the grading template `phrases_word_strict.tmpl`, `internal/modules/chat/prompts/phrases.txt` and its copy `config/prompts/chat/phrases.txt`. Test: new `integration/anki_addon/test_answer_punctuation.py` (package fixture as in `test_front_has_audio.py`); grading tests/goldens only if they pin the edited text.

- [ ] **Step 1: failing tests.**
  - `_expected_from_note('Phrases', …)`: EnglishWord `Don&#39;t worry` → `["Don't worry"]`; `R&amp;D` → `R&D`; `a<br>b` → `['a','b']`; `&lt;b&gt;` stays the text `<b>` (tags removed first, then unescape, nbsp → space), also through `check_answer` (no tag stripping of a decoded expected word on the new path: expected `a < b then c > d` is not satisfied by `a d`). ReverseDeck path unchanged.
  - Legacy note (Front without `_{2,}` in plain text, no Cyrillic; Expression ≠ EnglishWord): expected words = `[EnglishWord, plain Expression]`; a 10-word sentence read aloud is accepted and `is_foreign_speech` is False; the gate synonyms call (:4088) does NOT contain the sentence. Blank card: exactly as today.
  - `check_answer`: first path byte-for-byte as today (table of 20 old pairs). New second path — punctuation `, . ; : ! ? …` → space, spaces collapse, WHOLE TOKENS (`f" {e} " in f" {u} "`): `Well, I know.` accepts `well I know`, `well, i know`, `so well i know yes`; rejects `I know`. Rejects on the new path: `U.S.`/`you see`, `p.m.`/`help me`, `e.g.`/`the girl`, `a.m.`/`a man`, `No.`/`I don't know`, `Go!`/`good`, `Hi!`/`this`, `I.`/`thing`. Apostrophes and hyphens are kept (`it's` ≠ `its`). Empty after stripping never matches on the new path.
  - Prompts: a sentence for the case without a blank («no blank in the prompt: the learner says the whole English phrase; judge it as a whole, ignore punctuation»); blank wording unchanged; both prompt copies identical.
- [ ] **Step 2:** run, fail. **Step 3:** implement; `normalize_text` unchanged (commands use it).
- [ ] **Step 4:** `python -m pytest integration/anki_addon -q -k "answer or card_adapters or en_expression or voice_input_llm or front_has_audio"`, `go test ./integration/anki_addon ./internal/modules/grading -short -count=1` (and the chat package only if it has no Anki launch); compare any failure with the base commit.
- [ ] **Step 5:** commit `fix(addon): expected answers are decoded and compared without punctuation [ID:437]`.

### Task 3: booth and sides

**Files:** Modify `electron/renderer/components/panels/AnkiBooth/card-direction.ts`, `BoothWall.tsx`, `AcquaintanceView` (only if its test shows a duplicate), `electron/renderer/i18n/{ru,en}.ts`, `internal/modules/pronunciation/sides.go`. Tests: `__tests__/card-direction.test.ts` (line 20 is rewritten), `BoothWall.test.tsx` (:116-122 prompt «передача» is rewritten to a blank prompt), `sides_test.go`.

**Produces:** `isClozeCard(noteModel?: string, prompt?: string): boolean` — Phrases with `/_{2,}/` in prompt; `isWholePhraseCard(noteModel?, prompt?)` — Phrases, non-empty prompt, no `_{2,}`, no Cyrillic; `askLabelKey(noteModel, fallback, prompt?)`, `askLabel(noteModel, fallback, lang, tr, prompt?)`; i18n `booth.v2.ask.readPhrase` ru «прочитайте фразу вслух», en «read the phrase aloud». Phrases with an empty prompt or a Russian prompt without a blank keeps today's label and direction (explicit branch, tested).

- [ ] **Step 1: failing tests**: label keys and direction (`BoothWall.tsx:149`) for blank / whole phrase / empty / Russian prompt; `BoothHoverText` only for cloze; preview uses `preview.prompt`; whole phrase: `CardSides omit='en'`, after reveal the phrase text occurs once and the translation once on the wall and in the acquaintance view. Snapshot `card-adapters.char.test.ts.snap` unchanged.
      Go `SidesFor('Phrases')`: no `_{2,}` in plain Front, no Cyrillic, plain EnglishWord == plain Expression (non-empty) → `{EN: phrase, RU: plain ExpressionTranslate}` with Phrase, PhraseRU, Target empty; every other note exactly as today (existing test and the golden with Front «бежать» unchanged); legacy English sentence with EnglishWord=word → as today; Front with a blank and EnglishWord==Expression → as today.
- [ ] **Step 2:** fail. **Step 3:** implement; list every caller of `isClozeCard`/`askLabel` in the report.
- [ ] **Step 4:** vitest of AnkiBooth; `cd electron && ./node_modules/.bin/tsc --noEmit -p tsconfig.renderer.json`, errors equal to base; `go test ./internal/modules/pronunciation -short -count=1`, `go vet` on it.
- [ ] **Step 5:** commit `feat(booth): a whole phrase is read aloud, not recalled [ID:437]`.

### Task 4: docs and live check

- [ ] Update `deploy/anki-bootstrap/README.md` (Phrases answer field is EnglishWord; `--update` overwrites templates and appends fields; `flib_media`), `docs/ref/card-enrichment-and-pos.md` (Phrases fields, whole-phrase cards written by the extension, tag `flib_enriched`; whole-phrase rule; `extract` targets `internal/ankimodels/models`). Commit `docs(anki): Phrases fields [ID:437]`.
- [ ] Controller: isolated Anki (memory 4507: own `ANKI_SINGLE_INSTANCE_KEY`, `anki -b <tmp>`, xvfb, CDP; never 8765): import the old model with a note, run `anki-bootstrap install --update` against an isolated AnkiConnect port if available, else apply fields/templates through `anki.collection`; screenshots day/night, 360 and 1280 px: blank, whole phrase, legacy, player, clip + old list; editor opens the note.
- [ ] Whole-branch review (Opus, adversarial, spec part A + Review Focus), one fix wave, PR to `x2-2/turmalin`. **Merge only on the owner's word.**
