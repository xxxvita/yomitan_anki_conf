import { describe, expect, it } from 'vitest';
import { matchWordsDetailed } from '../word-matcher';

// matchWordsDetailed produces 4-kinds diff: ok / wrong / missing / extra.
// Convention (matches the mockup design contract):
//   ok        — w = ref word, no expected
//   wrong     — w = SPOKEN word (what user said), expected = REF word (what was wanted)
//   missing   — w = REF word (line-through), no expected
//   extra     — w = SPOKEN word (extra, said but not in ref), no expected
//
// matchPct = round(okCount / refLength * 100). Reference length is the
// post-tokenisation length (contractions are expanded before scoring).

describe('matchWordsDetailed — exact match', () => {
  it('all words match exactly → all ok, 100%', () => {
    const r = matchWordsDetailed(
      'I would like coffee please',
      'I would like coffee please',
    );
    expect(r.marks.map(m => m.kind)).toEqual(['ok','ok','ok','ok','ok']);
    expect(r.matchPct).toBe(100);
  });

  it('punctuation in either side is ignored', () => {
    const r = matchWordsDetailed(
      'i would, like coffee...',
      'I would like coffee.',
    );
    expect(r.marks.every(m => m.kind === 'ok')).toBe(true);
    expect(r.matchPct).toBe(100);
  });

  it('case is ignored', () => {
    const r = matchWordsDetailed('HELLO WORLD', 'hello world');
    expect(r.marks.map(m => m.kind)).toEqual(['ok','ok']);
  });
});

describe('matchWordsDetailed — substitution (wrong)', () => {
  it('one wrong word: "love" vs "like" → wrong with expected', () => {
    const r = matchWordsDetailed('I love coffee', 'I like coffee');
    expect(r.marks.length).toBe(3);
    expect(r.marks[0]).toMatchObject({ kind: 'ok' });
    expect(r.marks[1]).toMatchObject({ kind: 'wrong', w: 'love', expected: 'like' });
    expect(r.marks[2]).toMatchObject({ kind: 'ok' });
  });

  it('typo "extraordinary" for "extraordinarily" → wrong (within levenshtein-1 of ref length-aware)', () => {
    const r = matchWordsDetailed('extraordinary please', 'extraordinarily please');
    expect(r.marks[0].kind).toBe('wrong');
    expect(r.marks[0].w).toBe('extraordinary');
    expect(r.marks[0].expected).toBe('extraordinarily');
  });
});

describe('matchWordsDetailed — deletion (missing)', () => {
  it('user skipped a word → missing for the dropped ref word', () => {
    const r = matchWordsDetailed('I coffee', 'I want coffee');
    expect(r.marks.length).toBe(3);
    expect(r.marks[0]).toMatchObject({ kind: 'ok' });
    expect(r.marks[1]).toMatchObject({ kind: 'missing', w: 'want' });
    expect(r.marks[2]).toMatchObject({ kind: 'ok' });
  });

  it('empty spoken text → all ref words are missing, 0%', () => {
    const r = matchWordsDetailed('', 'hello world');
    expect(r.marks).toEqual([
      { w: 'hello', kind: 'missing' },
      { w: 'world', kind: 'missing' },
    ]);
    expect(r.matchPct).toBe(0);
  });
});

describe('matchWordsDetailed — insertion (extra)', () => {
  it('user added a word not in ref → extra mark inline', () => {
    const r = matchWordsDetailed('I really love coffee', 'I love coffee');
    expect(r.marks.length).toBe(4);
    expect(r.marks[0]).toMatchObject({ kind: 'ok' });
    expect(r.marks[1]).toMatchObject({ kind: 'extra', w: 'really' });
    expect(r.marks[2]).toMatchObject({ kind: 'ok' });
    expect(r.marks[3]).toMatchObject({ kind: 'ok' });
  });

  it('extras do not count toward matchPct (denominator = refLength)', () => {
    const r = matchWordsDetailed('I love really coffee', 'I love coffee');
    // 3 ref words, all matched → 100%
    expect(r.matchPct).toBe(100);
  });
});

describe('matchWordsDetailed — mixed (real shadowing case)', () => {
  it('canonical mockup case: I would love a strong cappuccino please vs full ref', () => {
    const r = matchWordsDetailed(
      'I would love a strong cappuccino please',
      'I would like an extraordinarily strong cappuccino please',
    );
    // Expected (per mockup data):
    //   ok would→would   wrong(love→like)   wrong(a→an)   missing(extraordinarily)
    //   ok strong   ok cappuccino   ok please
    const kinds = r.marks.map(m => m.kind);
    expect(kinds).toEqual(['ok','ok','wrong','wrong','missing','ok','ok','ok']);
    const wrong1 = r.marks[2];
    expect(wrong1).toMatchObject({ kind: 'wrong', w: 'love', expected: 'like' });
    const wrong2 = r.marks[3];
    expect(wrong2).toMatchObject({ kind: 'wrong', w: 'a', expected: 'an' });
    const miss = r.marks[4];
    expect(miss).toMatchObject({ kind: 'missing', w: 'extraordinarily' });
    // 5 ok of 8 ref words → 62%
    expect(r.matchPct).toBe(63);
  });

  // T7a (SANCTIONED REVISION, audit/23 I5 + task-T7-brief.md §T7a): under the
  // strict classifySubstitution rule (strict prefix + shared stem >= 3 +
  // tail 1..3), "хотел" is a strict prefix of "хотела" (stem 5, tail "а" =
  // 1 char) — a grammatical-ending mismatch, not a different word. This
  // REPLACES the pre-T7 expectation of `kind: 'wrong'` with `kind: 'ending'`
  // — the ONLY existing expectation this task's brief authorizes changing.
  // matchPct is recomputed too: 4 ok + 1 ending(*0.75) over 5 ref words =
  // round(4.75/5*100) = 95 (was implicitly 80 under the old all-or-nothing
  // wrong scoring, though the pre-T7 test never asserted matchPct here).
  it('Russian: хотела vs хотел → ending (T7a strict-prefix rule, stem>=3, tail 1..3)', () => {
    const r = matchWordsDetailed('Я бы хотела крепкий кофе', 'Я бы хотел крепкий кофе');
    expect(r.marks[2]).toMatchObject({ kind: 'ending', w: 'хотела', expected: 'хотел' });
    expect(r.marks[0].kind).toBe('ok');
    expect(r.marks[1].kind).toBe('ok');
    expect(r.marks[3].kind).toBe('ok');
    expect(r.marks[4].kind).toBe('ok');
    expect(r.matchPct).toBe(95);
  });
});

// T7a — classifySubstitution edge cases (exercised only through pairs the
// aligner actually routes into the fuzzy-substitution branch — i.e.
// levenshtein-close enough per subScore; see word-matcher.ts's own doc on
// why dissimilar "close" pairs like ferrary/fairy never reach this
// classifier at all, audit/23 I5(б), out of scope for this task).
describe('matchWordsDetailed — T7a ending vs wrong (strict rule)', () => {
  it('appear/appears → ending (stem 6 >= 3, tail "s" = 1)', () => {
    const r = matchWordsDetailed('please appears now', 'please appear now');
    expect(r.marks[1]).toMatchObject({ kind: 'ending', w: 'appears', expected: 'appear' });
  });

  it('walk/walked → ending (stem 4 >= 3, tail "ed" = 2)', () => {
    const r = matchWordsDetailed('I walked fast', 'I walk fast');
    expect(r.marks[1]).toMatchObject({ kind: 'ending', w: 'walked', expected: 'walk' });
  });

  it('walk/wall → wrong (equal length, not a prefix — NOT a false ending)', () => {
    const r = matchWordsDetailed('the wall is high', 'the walk is high');
    expect(r.marks[1]).toMatchObject({ kind: 'wrong', w: 'wall', expected: 'walk' });
  });

  it('cat/cap → wrong (equal length, not a prefix)', () => {
    const r = matchWordsDetailed('a cap sat', 'a cat sat');
    expect(r.marks[1]).toMatchObject({ kind: 'wrong', w: 'cap', expected: 'cat' });
  });

  it('on/one → wrong (stem 2 < 3 threshold, even though "one" starts with "on")', () => {
    const r = matchWordsDetailed('sit one it', 'sit on it');
    expect(r.marks[1]).toMatchObject({ kind: 'wrong', w: 'one', expected: 'on' });
  });

  it('a/an → wrong (stem 1 < 3 threshold) — preserved, unchanged canon case', () => {
    const r = matchWordsDetailed('I would like an strong cappuccino', 'I would like a strong cappuccino');
    expect(r.marks.some(m => m.kind === 'ending')).toBe(false);
    expect(r.marks.find(m => m.w === 'an')).toMatchObject({ kind: 'wrong', expected: 'a' });
  });

  it('extraordinary/extraordinarily → wrong (diverge before the tail — not a strict prefix)', () => {
    const r = matchWordsDetailed('extraordinary please', 'extraordinarily please');
    expect(r.marks[0]).toMatchObject({ kind: 'wrong', w: 'extraordinary', expected: 'extraordinarily' });
  });

  it('canonical mockup case (love/like, a/an, missing extraordinarily) — matchPct canon UNCHANGED at 63 (no ending in this sentence)', () => {
    const r = matchWordsDetailed(
      'I would love a strong cappuccino please',
      'I would like an extraordinarily strong cappuccino please',
    );
    const kinds = r.marks.map(m => m.kind);
    expect(kinds).toEqual(['ok', 'ok', 'wrong', 'wrong', 'missing', 'ok', 'ok', 'ok']);
    expect(r.matchPct).toBe(63);
  });

  it('matchPct weights a lone ending at 0.75, not 0 (wrong) or 1 (ok)', () => {
    // ref: "I walk fast today" (4 words) vs spoken "I walked fast today":
    // 3 ok + 1 ending → scoreSum = 3 + 0.75 = 3.75 → round(3.75/4*100) = 94.
    const r = matchWordsDetailed('I walked fast today', 'I walk fast today');
    expect(r.marks.map(m => m.kind)).toEqual(['ok', 'ending', 'ok', 'ok']);
    expect(r.matchPct).toBe(94);
  });

  // [C2 — critical connection, task-T7-brief.md] the 0.75 weight directly
  // moves the advance-gate pass/fail line for an otherwise-perfect,
  // one-ending reply. Fixed here as an explicit expectation so a future
  // change to ENDING_WEIGHT is caught immediately by this test, not
  // silently by a live advance-gate regression.
  it('ENDING_WEIGHT=0.75 crosses a 90%% threshold but not a 95%% one for a single-ending reply', () => {
    const r = matchWordsDetailed('I walked fast today', 'I walk fast today');
    expect(r.matchPct).toBe(94);
    expect(r.matchPct >= 90).toBe(true); // passes an advance-gate set at 90%
    expect(r.matchPct >= 95).toBe(false); // fails an advance-gate set at 95%
  });
});

// T7b — semi-global (fitting) alignment: committed vs partial tail
// forgiveness (audit/23 I6 fix). The matcher stays pure — these are direct
// unit calls with the new 3rd `opts` param; every OTHER test in this file
// calls matchWordsDetailed with exactly 2 args and must be completely
// unaffected (opts defaults to `{}` → mode:'global', same as before T7).
describe('matchWordsDetailed — T7b fitting/committed', () => {
  it('fitting forgives a leading speech prefix that would otherwise fuzzy-steal the first ref word', () => {
    // "wan" is levenshtein-1 from "want" (both len>=3) — under plain global
    // alignment this prefix noise is a live temptation for the aligner to
    // fuzzy-pair against ref[0]. Fitting's dp[0][j]=0 makes skipping BOTH
    // prefix tokens as `extra` strictly cheaper than paying for a
    // substitution that then leaves the REAL "want" stranded.
    const r = matchWordsDetailed('wan i want coffee please', 'want coffee please', { mode: 'fitting', committed: true });
    const kinds = r.marks.map(m => m.kind);
    expect(kinds.filter(k => k === 'ok')).toHaveLength(3); // want, coffee, please all ok
    expect(kinds.filter(k => k === 'extra')).toHaveLength(2); // wan, i
    expect(r.matchPct).toBe(100);
  });

  it('partial (committed:false): an un-said ref tail is forgiven as freeRefSuffix, NOT scored as missing', () => {
    const r = matchWordsDetailed('I would like a', 'I would like a strong cappuccino please', {
      mode: 'fitting',
      committed: false,
    });
    expect(r.marks.some(m => m.kind === 'missing')).toBe(false);
    expect(r.freeRefSuffix).toEqual(['strong', 'cappuccino', 'please']);
    // Only the 4 said-so-far ref words are scored — not penalised for the
    // 3 words the speaker simply hasn't reached yet.
    expect(r.matchPct).toBe(100);
  });

  it('committed:true on the SAME partial text scores the un-said tail as real missing (no forgiveness)', () => {
    const r = matchWordsDetailed('I would like a', 'I would like a strong cappuccino please', {
      mode: 'fitting',
      committed: true,
    });
    expect(r.freeRefSuffix).toBeUndefined();
    const missing = r.marks.filter(m => m.kind === 'missing').map(m => m.w);
    expect(missing).toEqual(['strong', 'cappuccino', 'please']);
    expect(r.matchPct).toBe(57); // 4 ok / 7 ref = round(57.14) = 57
  });

  it('global mode (default, no opts) never populates freeRefSuffix even with a dropped tail', () => {
    const r = matchWordsDetailed('I would like a', 'I would like a strong cappuccino please');
    expect(r.freeRefSuffix).toBeUndefined();
    expect(r.marks.filter(m => m.kind === 'missing')).toHaveLength(3);
  });
});

describe('matchWordsDetailed — contractions', () => {
  it('expand "I\'m" → "I am" before alignment, both sides', () => {
    const r = matchWordsDetailed("I'm happy", 'I am happy');
    expect(r.marks.map(m => m.kind)).toEqual(['ok','ok','ok']);
    expect(r.matchPct).toBe(100);
  });

  it('"don\'t" expansion makes a missing-not visible if user said only "do"', () => {
    const r = matchWordsDetailed('I do worry', "I don't worry");
    // ref expands to: i / do / not / worry  (4 words)
    // spoken: i / do / worry (3 words)
    // expected: ok ok missing(not) ok
    expect(r.marks.map(m => m.kind)).toEqual(['ok','ok','missing','ok']);
    expect(r.marks[2].w).toBe('not');
  });
});

// ТЗ №7 п.1 — RAW reference token for the ЭТАЛОН render row. The word-matcher
// NORMALISES (lowercase, punct-strip) and EXPANDS contractions ("Let's"→let/us)
// before scoring — correct for the diff, WRONG for display: the B1 top row was
// showing "let us" instead of the raw subtitle "Let's". Fix: each ref-derived
// mark now carries a `display` (raw subtitle word) + `refWordIdx` (raw-word
// group, so a contraction's two scoring tokens can re-collapse into ONE render
// column). Scoring (w/expected/kind/matchPct) is UNCHANGED — display is additive.
describe('matchWordsDetailed — T7 raw display (нормализация только в скоринге)', () => {
  it('capitalized ref word keeps raw form in `display`; scoring token stays normalized', () => {
    const r = matchWordsDetailed('Hello world', 'Hello world');
    expect(r.marks[0]).toMatchObject({ w: 'hello', kind: 'ok', display: 'Hello' });
    // lowercase raw == normalized token → no display noise
    expect(r.marks[1]).toMatchObject({ w: 'world', kind: 'ok' });
    expect(r.marks[1].display).toBeUndefined();
    expect(r.marks[1].refWordIdx).toBeUndefined();
  });

  it('contraction ref word ("Let\'s") — RAW form preserved, both halves share refWordIdx (for merge), scoring unchanged', () => {
    const r = matchWordsDetailed("Let's learn", "Let's learn");
    // scoring: expanded to let/us/learn, all ok, 100% — byte-identical to before
    expect(r.marks.map(m => m.kind)).toEqual(['ok', 'ok', 'ok']);
    expect(r.matchPct).toBe(100);
    // both contraction halves carry the RAW "Let's" + the SAME refWordIdx
    expect(r.marks[0]).toMatchObject({ w: 'let', display: "Let's", refWordIdx: 0 });
    expect(r.marks[1]).toMatchObject({ w: 'us', display: "Let's", refWordIdx: 0 });
    // the next raw word is a distinct group (no display: lowercase raw == token)
    expect(r.marks[2].w).toBe('learn');
    expect(r.marks[2].refWordIdx).toBeUndefined();
  });

  it('missing capitalized ref word surfaces its raw display too', () => {
    const r = matchWordsDetailed('', 'Quiz');
    expect(r.marks[0]).toMatchObject({ w: 'quiz', kind: 'missing', display: 'Quiz' });
  });

  it('a substitution against a capitalized ref word carries the raw ref in `display` (spoken stays in `w`)', () => {
    const r = matchWordsDetailed('Hallo', 'Hello');
    expect(r.marks[0]).toMatchObject({ kind: 'wrong', w: 'hallo', expected: 'hello', display: 'Hello' });
  });

  it('trailing punctuation on a ref word is stripped from `display`, not shown', () => {
    // Ref "quiz." — normalize already drops the dot for scoring; display strips
    // edge punctuation too so the ЭТАЛОН row shows a clean "Quiz", not "Quiz.".
    const r = matchWordsDetailed('', 'Quiz.');
    expect(r.marks[0].display).toBe('Quiz');
  });
});

describe('matchWordsDetailed — edge cases', () => {
  it('empty reference → empty marks, 0%', () => {
    const r = matchWordsDetailed('hello', '');
    expect(r.matchPct).toBe(0);
    // Spoken-only words may surface as "extra"; but with empty ref the result
    // is conventionally empty so attempts list shows no diff.
    expect(r.marks.every(m => m.kind === 'extra' || m.kind === 'ok')).toBe(true);
  });

  it('both empty → empty marks, 0%', () => {
    const r = matchWordsDetailed('', '');
    expect(r.marks).toEqual([]);
    expect(r.matchPct).toBe(0);
  });

  it('extra space tolerant', () => {
    const r = matchWordsDetailed('  hello   world  ', 'hello world');
    expect(r.marks.map(m => m.kind)).toEqual(['ok','ok']);
  });
});

// T7-fix (documentation, NOT a behaviour change) — known limitations of the
// deterministic-heuristic ending detector (classifySubstitution, T7a strict
// prefix rule). These are NOT bugs being fixed here: `classifySubstitution`
// and `matchPct` are untouched by this task. The point is to make each
// tradeoff an EXPLICIT, asserted fact instead of a silent gap nobody pinned
// down — so the next person who hits one of these in the wild finds it
// documented here first, not surprised by it in production.
// Owner note: tightening this (e.g. adding a same-part-of-speech / dictionary
// check to stop "then" from qualifying as an "ending" of "the") is a
// follow-up the owner must decide on, not a fix bundled into this task.
describe('matchWordsDetailed — known false-endings (deterministic-heuristic tradeoff)', () => {
  it('DOCUMENTED FALSE-POSITIVE: "the" vs "then" → classified as \'ending\', not \'wrong\' — different words, but "then" is a strict prefix-superset of "the" (stem 3 >= 3, tail "n" = 1), which is exactly what the T7a rule is built to detect for real inflections (e.g. walk/walked). Cheap detector, no part-of-speech/dictionary awareness — accepted tradeoff, not fixed here.', () => {
    const r = matchWordsDetailed('then cat sat', 'the cat sat');
    expect(r.marks[0]).toMatchObject({ kind: 'ending', w: 'then', expected: 'the' });
    expect(r.matchPct).toBe(92); // 2 ok (cat, sat) + 0.75 ending = 2.75/3 -> round(91.67)
  });

  it('DOCUMENTED FALSE-POSITIVE (Cyrillic): "сто" vs "стол" → classified as \'ending\' — same strict-prefix/stem>=3/tail<=3 shape as the/then above, different real words in Russian ("hundred" vs "table"). Same accepted tradeoff.', () => {
    const r = matchWordsDetailed('стол книг много', 'сто книг много');
    expect(r.marks[0]).toMatchObject({ kind: 'ending', w: 'стол', expected: 'сто' });
    expect(r.matchPct).toBe(92);
  });

  it('DOCUMENTED NON-DETECTION: "go" vs "going" never reaches classifySubstitution at all — subScore()\'s own similarity gate (lev=3 on a 5-char word fails both the lev<=1 and the lev<=2-on-4+-chars branches) rejects the pair as a substitution candidate BEFORE T7a\'s classifier ever runs. The aligner instead renders it as a real word-level miss (missing "go") plus an unrelated addition (extra "going") — a genuine inflection is scored as harshly as two unrelated words would be. This is a known gap in subScore\'s threshold, not in classifySubstitution\'s prefix rule, and is out of this task\'s scope (carry, per brief).', () => {
    const r = matchWordsDetailed('I going home', 'I go home');
    expect(r.marks.map(m => m.kind)).toEqual(['ok', 'extra', 'missing', 'ok']);
    expect(r.marks.find(m => m.kind === 'extra')).toMatchObject({ w: 'going' });
    expect(r.marks.find(m => m.kind === 'missing')).toMatchObject({ w: 'go' });
    expect(r.matchPct).toBe(67); // 2 ok out of 3 ref words (go/home + "I") -> round(2/3*100)
  });

  it('DOCUMENTED NON-DETECTION: "run" vs "running" (lev=4 >= 3) — same subScore-gate miss as go/going above; rendered as missing+extra, never reaches the ending/wrong classifier.', () => {
    const r = matchWordsDetailed('I am running fast', 'I am run fast');
    expect(r.marks.map(m => m.kind)).toEqual(['ok', 'ok', 'extra', 'missing', 'ok']);
    expect(r.marks.find(m => m.kind === 'extra')).toMatchObject({ w: 'running' });
    expect(r.marks.find(m => m.kind === 'missing')).toMatchObject({ w: 'run' });
    expect(r.matchPct).toBe(75); // 3 ok out of 4 ref words -> round(3/4*100)
  });
});
