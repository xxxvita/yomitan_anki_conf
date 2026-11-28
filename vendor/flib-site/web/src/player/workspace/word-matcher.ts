const CONTRACTIONS: Record<string, string[]> = {
  "i'm": ["i", "am"], "i've": ["i", "have"], "i'll": ["i", "will"], "i'd": ["i", "would"],
  "you're": ["you", "are"], "you've": ["you", "have"], "you'll": ["you", "will"], "you'd": ["you", "would"],
  "he's": ["he", "is"], "he'll": ["he", "will"], "he'd": ["he", "would"],
  "she's": ["she", "is"], "she'll": ["she", "will"], "she'd": ["she", "would"],
  "it's": ["it", "is"], "it'll": ["it", "will"],
  "we're": ["we", "are"], "we've": ["we", "have"], "we'll": ["we", "will"], "we'd": ["we", "would"],
  "they're": ["they", "are"], "they've": ["they", "have"], "they'll": ["they", "will"], "they'd": ["they", "would"],
  "that's": ["that", "is"], "there's": ["there", "is"], "here's": ["here", "is"],
  "what's": ["what", "is"], "who's": ["who", "is"], "where's": ["where", "is"],
  "isn't": ["is", "not"], "aren't": ["are", "not"], "wasn't": ["was", "not"], "weren't": ["were", "not"],
  "don't": ["do", "not"], "doesn't": ["does", "not"], "didn't": ["did", "not"],
  "won't": ["will", "not"], "wouldn't": ["would", "not"], "shouldn't": ["should", "not"],
  "couldn't": ["could", "not"], "can't": ["can", "not"], "haven't": ["have", "not"],
  "hasn't": ["has", "not"], "hadn't": ["had", "not"],
  "let's": ["let", "us"],
};

function normalize(text: string): string {
  // \w in JS regex is ASCII-only ([A-Za-z0-9_]). Use Unicode property escapes
  // so Cyrillic, Greek, etc. words survive normalisation.
  return text.toLowerCase().replace(/[^\p{L}\p{N}'-]/gu, '');
}

function expandContractions(word: string): string[] {
  const lower = word.toLowerCase();
  if (CONTRACTIONS[lower]) return CONTRACTIONS[lower];
  // Strip punctuation but keep any-script letters and digits (Cyrillic etc.).
  return [lower.replace(/[^\p{L}\p{N}]/gu, '')];
}

function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1),
      );
    }
  }
  return dp[m][n];
}

function fuzzyMatch(a: string, b: string): boolean {
  if (a === b) return true;
  if (a.length > 3 && b.length > 3 && levenshtein(a, b) <= 1) return true;
  return false;
}

export interface WordMatchResult {
  words: { word: string; match: boolean }[];
  matchPct: number;
}

export function matchWords(spoken: string, reference: string): WordMatchResult {
  const spokenExpanded = spoken.split(/\s+/).filter(Boolean).flatMap(w => expandContractions(w)).map(normalize).filter(Boolean);
  const refExpanded = reference.split(/\s+/).filter(Boolean).flatMap(w => expandContractions(w)).map(normalize).filter(Boolean);

  const results: { word: string; match: boolean }[] = [];
  const used = new Set<number>();

  for (const rw of refExpanded) {
    let found = false;
    for (let i = 0; i < spokenExpanded.length; i++) {
      if (used.has(i)) continue;
      if (fuzzyMatch(spokenExpanded[i], rw)) {
        used.add(i);
        found = true;
        break;
      }
    }
    results.push({ word: rw, match: found });
  }

  const matched = results.filter(r => r.match).length;
  const matchPct = refExpanded.length > 0 ? Math.round((matched / refExpanded.length) * 100) : 0;
  return { words: results, matchPct };
}

// ── 4-kinds detailed matcher ──────────────────────────────────────────
//
// Position-aware diff between spoken and reference, producing one mark per
// alignment slot. Based on Needleman-Wunsch alignment with simple costs:
//   exact match  → +2 (kind=ok)
//   fuzzy match  → 0  (kind=wrong, close-but-not-exact substitution)
//   gap (ref-only spot)    → -1 (kind=missing)
//   gap (spoken-only spot) → -1 (kind=extra)
//
// Convention for `w` and `expected`:
//   ok       — w = ref word              (no expected)
//   wrong    — w = SPOKEN word,           expected = REF word
//   ending   — w = SPOKEN word,           expected = REF word (T7a: grammatical
//              ending mismatch on an otherwise-correct stem — see
//              classifySubstitution below; scored at ENDING_WEIGHT, not 0)
//   missing  — w = REF word               (no expected — the missing word IS the expected)
//   extra    — w = SPOKEN word            (no expected — there is no ref counterpart)

export type WordKind = 'ok' | 'wrong' | 'missing' | 'extra' | 'ending';

export interface WordMark {
  w: string;
  kind: WordKind;
  expected?: string;
  /**
   * ТЗ №7 п.1 — RAW reference word for the ЭТАЛОН render row, present only on
   * ref-derived marks (ok/missing/wrong/ending) and ONLY when it differs from
   * the normalized scoring token `w`/`expected` (a capitalized word, a
   * contraction, or a word that carried edge punctuation). The matcher
   * normalises + expands contractions ("Let's"→let/us) for SCORING; `display`
   * carries the untouched subtitle form so the notation shows "Let's", not
   * "let us". Absent ⇒ the normalized token already IS the raw form.
   */
  display?: string;
  /**
   * ТЗ №7 п.1 — raw-word group index, present only on marks whose ref word
   * expanded to MORE THAN ONE scoring token (a contraction). Both halves of
   * "Let's" (let/us) share one `refWordIdx` so buildVerdictNotation can
   * re-collapse them into a SINGLE render column showing the raw contraction.
   * Single-token ref words never carry it (nothing to merge).
   */
  refWordIdx?: number;
}

export interface DetailedMatchResult {
  marks: WordMark[];
  matchPct: number;
  /**
   * T7b (semi-global/fitting): ref words past the point the fitting
   * alignment decided to stop matching, ONLY populated when
   * `{mode:'fitting', committed:false}` and the alignment forgave an
   * un-said reference tail (see alignWords doc). These are NOT `missing`
   * marks — they are neutral "not said yet" words, deliberately excluded
   * from `marks`/`matchPct` so a still-in-progress partial utterance isn't
   * penalised for words the speaker hasn't reached yet. Absent (undefined)
   * in the default global mode and whenever `committed:true` — in both of
   * those cases an unconsumed ref tail is scored as real `missing` marks
   * instead (see alignWords/matchWordsDetailed).
   */
  freeRefSuffix?: string[];
}

/**
 * T7a (owner decision, audit/23 I5): weight applied to an `ending`-kind mark
 * inside matchPct's scoreSum. 0.75, not 1 (a real mismatch, if smaller than a
 * full miss) and not 0 (the stem WAS said correctly) — "прощаем грамматику,
 * фокус на корне". This single constant is the one advance-gate lever the
 * owner tuned; changing it moves the advance threshold for every ending-only
 * miss (see the "T7a — ending weight moves the advance threshold" test).
 */
const ENDING_WEIGHT = 0.75;

/**
 * T7a (audit/23 I5 fix) — deterministic (NOT LLM) classifier for a
 * fuzzy-matched substitution pair: is this a grammatical-ending mismatch on
 * an otherwise-identical stem, or a genuinely different word?
 *
 * STRICT rule (I5's fix over the earlier "last letter differs" heuristic,
 * which produced false positives on walk/wall, cat/cap, on/one):
 *   - one of the two words must be a STRICT PREFIX of the other
 *     (`long.startsWith(short)`, so equal-length pairs never qualify —
 *     kills walk/wall, cat/cap outright);
 *   - the shared stem (`short`'s full length) must be >= 3 chars (kills
 *     a/an [stem 1] and on/one [stem 2] — too short to trust as "same word,
 *     different ending", could just as easily be two different words);
 *   - the tail being added/dropped must be 1..3 chars (a longer suffix
 *     stops looking like an inflection and starts looking like a different
 *     word or a genuinely unrelated near-miss, e.g. extraordinary/
 *     extraordinarily fails the STRICT-PREFIX test itself — the two words
 *     diverge at position 13, "y" vs "i", well before the tail — so it
 *     never even reaches the stem/tail-length checks).
 *
 * Symmetric in (spoken, ref) — classification depends only on which string
 * is textually shorter, not on which role each argument plays.
 */
function classifySubstitution(spoken: string, ref: string): 'ending' | 'wrong' {
  const [short, long] = spoken.length <= ref.length ? [spoken, ref] : [ref, spoken];
  if (long.length > short.length && short.length >= 3 && long.startsWith(short)) {
    const tailLen = long.length - short.length;
    if (tailLen >= 1 && tailLen <= 3) return 'ending';
  }
  return 'wrong';
}

function tokenizeForMatch(text: string): string[] {
  return text.split(/\s+/).filter(Boolean)
    .flatMap(w => expandContractions(w))
    .map(normalize)
    .filter(Boolean);
}

/**
 * ТЗ №7 п.1 — strip ONLY edge punctuation for the raw display form, preserving
 * case and word-internal apostrophes/hyphens ("Let's"→"Let's", "quiz…"→"quiz",
 * "Hello,"→"Hello"). Unicode-aware so Cyrillic/Greek survive.
 */
function stripEdgePunct(w: string): string {
  return w.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');
}

interface RefTokenInfo {
  /** normalized+expanded scoring tokens — IDENTICAL sequence to tokenizeForMatch */
  tokens: string[];
  /** rawOf[i] = raw subtitle word the i-th scoring token came from */
  rawOf: string[];
  /** idxOf[i] = raw-word index (groups a contraction's expanded tokens) */
  idxOf: number[];
  /** multi[i] = true iff that raw word expanded to >1 scoring token (contraction) */
  multi: boolean[];
}

/**
 * ТЗ №7 п.1 — tokenize the REFERENCE while keeping, per scoring token, the raw
 * subtitle word it came from. The `tokens` array is byte-identical to
 * tokenizeForMatch(text) (same expand→normalize→filter pipeline, just walked
 * per-word so the raw provenance survives) — so SCORING is unchanged.
 */
function tokenizeRef(text: string): RefTokenInfo {
  const rawWords = text.split(/\s+/).filter(Boolean);
  const tokens: string[] = [];
  const rawOf: string[] = [];
  const idxOf: number[] = [];
  const multi: boolean[] = [];
  rawWords.forEach((rw, rawIdx) => {
    const expanded = expandContractions(rw).map(normalize).filter(Boolean);
    const display = stripEdgePunct(rw);
    const isMulti = expanded.length > 1;
    expanded.forEach(tok => {
      tokens.push(tok);
      rawOf.push(display);
      idxOf.push(rawIdx);
      multi.push(isMulti);
    });
  });
  return { tokens, rawOf, idxOf, multi };
}

/**
 * ТЗ №7 п.1 — the display/refWordIdx pair for the ref token at index `i`.
 * `display` is set only when the raw form differs from the normalized token
 * (case/punct) OR the word is a contraction (multi); `refWordIdx` only for
 * contractions (single-token words never merge).
 */
function refDisplayFor(info: RefTokenInfo, i: number): { display?: string; refWordIdx?: number } {
  const raw = info.rawOf[i];
  const isMulti = info.multi[i];
  const out: { display?: string; refWordIdx?: number } = {};
  if (isMulti || raw !== info.tokens[i]) out.display = raw;
  if (isMulti) out.refWordIdx = info.idxOf[i];
  return out;
}

// Sub-cost for substituting ref[i] with spoken[j]. Higher score is better
// (algorithm maximises the sum). The score must be designed so the algorithm
// prefers the human-readable alignment when there are multiple optimal paths.
//
// Key constraint: a double-gap (one del + one ins) costs -2. So:
//   * for similar-enough words → sub score should be ≥ -1 (prefer sub over
//     two gaps, keeping the spoken word aligned with its expected ref word)
//   * for very-different words → sub score should be ≤ -3 (prefer two gaps
//     over a meaningless substitution that pairs unrelated words)
//
// Thresholds chosen empirically; see word-matcher-detailed.test.ts for the
// canonical shadowing case that drives this calibration.
function subScore(refWord: string, spokenWord: string): number {
  if (refWord === spokenWord) return 2;
  const lev = levenshtein(refWord, spokenWord);
  const maxLen = Math.max(refWord.length, spokenWord.length);
  // Single edit on long words → very close (typo) → prefer sub strongly.
  if (lev === 1 && maxLen >= 3) return 0;
  // 2 edits on a 4+ char word, or distance ≤ 50% of longer word → still
  // close enough to call a substitution rather than a delete + insert.
  if (lev <= 2 && maxLen >= 4) return 0;
  if (lev * 2 <= maxLen) return 0;
  // Otherwise treat as truly different — discourage pairing.
  return -3;
}

const GAP_COST = -1;

interface Op {
  type: 'match' | 'del' | 'ins';
  refIdx?: number;
  spokenIdx?: number;
  exact?: boolean;
}

/**
 * T7b (audit/23 I6 fix — axes were tangled in an earlier draft; this is the
 * corrected, unambiguous version) — alignment mode. Axis convention: `i`
 * walks the REFERENCE (rows, 0..R), `j` walks the SPOKEN text (columns,
 * 0..S) — same as the dp/ptr tables below.
 *   - `'global'` (default): plain Needleman-Wunsch, both ends anchored —
 *     unmatched ref at either end always costs GAP_COST*count (the
 *     behaviour this function has always had; every existing caller that
 *     doesn't pass `opts` gets this, unchanged).
 *   - `'fitting'`: semi-global. `dp[0][j] = 0` for every `j` — an
 *     arbitrarily long PREFIX of spoken text costs nothing (the speaker's
 *     false start / filler run before they reach the reference's first
 *     word is free, so the aligner is never tempted to fuzzy-pair the
 *     reference's first word against unrelated prefix noise just because a
 *     substitution is "cheaper" than two gaps — see subScore's doc).
 *     Whether an unconsumed REFERENCE TAIL is also forgiven depends on
 *     `committed`:
 *       - `committed: false` (partial/in-progress utterance): backtrack
 *         starts from the BEST-SCORING ROW of the LAST COLUMN
 *         (`argmax_i dp[i][n]`), not necessarily row `m`. Whatever ref
 *         rows are above that row (`ref[i*..m)`) were never reached by the
 *         alignment at all — reported back to the caller as `freeSuffixFrom
 *         = i*` so it can surface them as a neutral "not said yet" tail
 *         instead of penalising a still-in-progress attempt.
 *       - `committed: true` (this is the FINAL word for this attempt): tail
 *         forgiveness is OFF — backtrack starts from row `m` like `global`.
 *         An unconsumed ref tail on a committed attempt is a REAL miss (the
 *         speaker never said it); forgiving it here would hide `missing`
 *         marks and inflate the advance-gate (exactly the I6 finding).
 */
export interface AlignOptions {
  mode?: 'global' | 'fitting';
  committed?: boolean;
}

interface AlignResult {
  ops: Op[];
  /** Index into `ref` where the alignment stopped (== ref.length unless
   *  fitting+partial forgave a tail — see AlignOptions doc). */
  freeSuffixFrom: number;
}

function alignWords(ref: string[], spoken: string[], opts: AlignOptions = {}): AlignResult {
  const mode = opts.mode ?? 'global';
  const committed = opts.committed ?? true;
  const m = ref.length, n = spoken.length;
  if (m === 0 && n === 0) return { ops: [], freeSuffixFrom: 0 };

  // dp[i][j] = best score for aligning ref[0..i] vs spoken[0..j]
  // ptr[i][j] = which predecessor produced dp[i][j] ('M' diag, 'D' up=del, 'I' left=ins)
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  const ptr: string[][] = Array.from({ length: m + 1 }, () => new Array<string>(n + 1).fill(''));

  for (let i = 1; i <= m; i++) { dp[i][0] = i * GAP_COST; ptr[i][0] = 'D'; }
  for (let j = 1; j <= n; j++) {
    // Fitting: forgive an arbitrarily long spoken PREFIX (row 0 stays at 0
    // instead of accruing GAP_COST per column) — see AlignOptions doc.
    dp[0][j] = mode === 'fitting' ? 0 : j * GAP_COST;
    ptr[0][j] = 'I';
  }

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const diag = dp[i - 1][j - 1] + subScore(ref[i - 1], spoken[j - 1]);
      const up   = dp[i - 1][j]     + GAP_COST;
      const left = dp[i][j - 1]     + GAP_COST;
      let best = diag, p = 'M';
      if (up   > best) { best = up;   p = 'D'; }
      if (left > best) { best = left; p = 'I'; }
      dp[i][j] = best;
      ptr[i][j] = p;
    }
  }

  // Fitting + partial: pick the best row in the LAST column instead of
  // always row `m` — that row's index is where the un-said ref tail begins
  // (freeSuffixFrom). Global mode, or a committed attempt, always starts
  // from (m, n) — no tail forgiveness (see AlignOptions doc).
  let startI = m;
  if (mode === 'fitting' && !committed) {
    startI = 0;
    let best = dp[0][n];
    for (let i = 1; i <= m; i++) {
      if (dp[i][n] > best) { best = dp[i][n]; startI = i; }
    }
  }

  // Backtrack from (startI, n) to (0, 0).
  const ops: Op[] = [];
  let i = startI, j = n;
  while (i > 0 || j > 0) {
    const p = ptr[i][j] || (i > 0 ? 'D' : 'I');
    if (p === 'M') {
      ops.unshift({
        type: 'match',
        refIdx: i - 1,
        spokenIdx: j - 1,
        exact: ref[i - 1] === spoken[j - 1],
      });
      i--; j--;
    } else if (p === 'D') {
      ops.unshift({ type: 'del', refIdx: i - 1 });
      i--;
    } else {
      ops.unshift({ type: 'ins', spokenIdx: j - 1 });
      j--;
    }
  }
  return { ops, freeSuffixFrom: startI };
}

/**
 * T7b: options threaded straight through to `alignWords` (see its doc for
 * the full mode/committed contract). Omitted (`{}`) — the default every
 * existing caller gets — behaves EXACTLY as before this task (plain global
 * NW, no tail forgiveness, no `freeRefSuffix`).
 */
export function matchWordsDetailed(
  spoken: string,
  reference: string,
  opts: AlignOptions = {},
): DetailedMatchResult {
  const refInfo = tokenizeRef(reference);
  const refTokens = refInfo.tokens;
  const spokenTokens = tokenizeForMatch(spoken);

  // With empty reference there is no diff to show — by convention return an
  // empty marks list with 0%. (Putting orphan "extra" marks would clutter UI
  // with no anchor.)
  if (refTokens.length === 0) {
    return { marks: [], matchPct: 0 };
  }

  const { ops, freeSuffixFrom } = alignWords(refTokens, spokenTokens, opts);
  const marks: WordMark[] = [];
  let okCount = 0;
  let endingCount = 0;

  for (const op of ops) {
    if (op.type === 'match') {
      const refWord = refTokens[op.refIdx!];
      const spokenWord = spokenTokens[op.spokenIdx!];
      const disp = refDisplayFor(refInfo, op.refIdx!); // ТЗ №7 п.1 raw ref form
      if (op.exact) {
        marks.push({ w: refWord, kind: 'ok', ...disp });
        okCount++;
      } else {
        // Close-but-not-exact substitution: show what the user said + what
        // was expected so they can self-correct. T7a: distinguish a
        // grammatical-ending mismatch (stem intact) from a genuinely
        // different word via classifySubstitution.
        const kind = classifySubstitution(spokenWord, refWord);
        marks.push({ w: spokenWord, kind, expected: refWord, ...disp });
        if (kind === 'ending') endingCount++;
      }
    } else if (op.type === 'del') {
      marks.push({ w: refTokens[op.refIdx!], kind: 'missing', ...refDisplayFor(refInfo, op.refIdx!) });
    } else {
      marks.push({ w: spokenTokens[op.spokenIdx!], kind: 'extra' });
    }
  }

  // T7b: a fitting+partial alignment may have stopped short of the full ref
  // (freeSuffixFrom < refTokens.length) — that tail was never scored (it's
  // "not said yet", not a miss) and must not appear in `marks` nor count
  // toward matchPct's denominator. In every other case (global, or
  // committed) freeSuffixFrom === refTokens.length and this is a no-op.
  const freeRefSuffix = freeSuffixFrom < refTokens.length ? refTokens.slice(freeSuffixFrom) : undefined;
  const scoredRefLength = freeRefSuffix ? freeSuffixFrom : refTokens.length;

  // T7a (owner decision, weight 0.75): an `ending` mark counts as partial
  // credit, not a full miss — see ENDING_WEIGHT's doc.
  const scoreSum = okCount + ENDING_WEIGHT * endingCount;
  const matchPct = scoredRefLength > 0 ? Math.round((scoreSum / scoredRefLength) * 100) : 0;
  return freeRefSuffix ? { marks, matchPct, freeRefSuffix } : { marks, matchPct };
}

export interface PuzzleToken {
  text: string;
  type: 'word' | 'punct';
  original: string;
  line: number;
}

export function tokenizeCueText(text: string, level: 'easy' | 'medium' = 'easy'): PuzzleToken[] {
  const lines = text.split(/<br\s*\/?>/i);
  const tokens: PuzzleToken[] = [];
  lines.forEach((rawLine, lineIdx) => {
    const clean = rawLine.replace(/<[^>]*>/g, ' ').trim();
    if (!clean) return;
    if (level === 'easy') {
      clean.split(/\s+/).filter(Boolean).forEach(w => {
        tokens.push({ text: w, type: 'word', original: w, line: lineIdx });
      });
    } else {
      const re = /([a-zA-Z'-]+)|([^\s\w])/g;
      let m: RegExpExecArray | null;
      while ((m = re.exec(clean)) !== null) {
        if (m[1]) tokens.push({ text: m[1], type: 'word', original: m[1], line: lineIdx });
        else if (m[2]) tokens.push({ text: m[2], type: 'punct', original: m[2], line: lineIdx });
      }
    }
  });
  return tokens;
}

export function puzzleChipDisplay(token: { text: string; type: string }, positionIndex: number): string {
  if (token.type === 'punct') return token.text;
  const lower = token.text.toLowerCase();
  if (lower === 'i') return 'I';
  if (positionIndex === 0) return token.text.charAt(0).toUpperCase() + token.text.slice(1);
  return lower;
}

export function normalizeDrillWord(w: string): string {
  return w.toLowerCase().replace(/[^\w'-]/g, '');
}
