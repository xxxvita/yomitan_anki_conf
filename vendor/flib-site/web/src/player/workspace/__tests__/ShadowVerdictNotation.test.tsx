// ShadowVerdictNotation.test.tsx — T7c: B1 notation (two aligned rows +
// out-of-grid extras + 3-diagnosis heuristic). New file (additive) — does
// NOT touch ShadowCardLifted.test.tsx's existing V1 attempts-feed contract
// (see task-T7-report.md for why the old WordChip feed was left alone).
import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import {
  buildVerdictNotation,
  ShadowVerdictNotation,
  ShadowVerdictPartial,
} from '../ShadowCardLifted';
import type { WordMark } from '../word-matcher';

describe('buildVerdictNotation — pure grid/extras transform', () => {
  it('ok/wrong/missing marks become columns, one per ref word', () => {
    const marks: WordMark[] = [
      { w: 'hello', kind: 'ok' },
      { w: 'word', kind: 'wrong', expected: 'world' },
      { w: 'skipped', kind: 'missing' },
    ];
    const { columns, extras } = buildVerdictNotation(marks);
    expect(columns).toEqual([
      { ref: 'hello', you: 'hello', kind: 'ok' },
      { ref: 'world', you: 'word', kind: 'wrong' },
      { ref: 'skipped', you: null, kind: 'missing' },
    ]);
    expect(extras).toEqual([]);
  });

  it('ending marks render the expected ref word on top, spoken word below, kind=ending', () => {
    const marks: WordMark[] = [{ w: 'walked', kind: 'ending', expected: 'walk' }];
    const { columns } = buildVerdictNotation(marks);
    expect(columns).toEqual([{ ref: 'walk', you: 'walked', kind: 'ending' }]);
  });

  it('extra words are pulled OUT of columns (not a column of their own)', () => {
    const marks: WordMark[] = [
      { w: 'I', kind: 'ok' },
      { w: 'really', kind: 'extra' },
      { w: 'love', kind: 'ok' },
    ];
    const { columns, extras } = buildVerdictNotation(marks);
    expect(columns).toEqual([
      { ref: 'I', you: 'I', kind: 'ok' },
      { ref: 'love', you: 'love', kind: 'ok' },
    ]);
    expect(extras).toEqual([{ afterColumn: 0, words: ['really'], diagnosis: 'added' }]);
  });

  it('a leading extra (before any column) gets afterColumn = -1', () => {
    const marks: WordMark[] = [
      { w: 'so', kind: 'extra' },
      { w: 'hi', kind: 'ok' },
    ];
    const { extras } = buildVerdictNotation(marks);
    expect(extras).toEqual([{ afterColumn: -1, words: ['so'], diagnosis: 'added' }]);
  });

  it('consecutive extras group into ONE chip (long prefix/tail → "+N")', () => {
    const marks: WordMark[] = [
      { w: 'so', kind: 'extra' },
      { w: 'anyway', kind: 'extra' },
      { w: 'I', kind: 'extra' },
      { w: 'think', kind: 'ok' },
    ];
    const { extras, columns } = buildVerdictNotation(marks);
    expect(columns).toEqual([{ ref: 'think', you: 'think', kind: 'ok' }]);
    expect(extras).toEqual([{ afterColumn: -1, words: ['so', 'anyway', 'I'], diagnosis: 'added' }]);
  });

  it('filler interjections (эээ/мм/uh) are dropped entirely — not even shown as extra', () => {
    const marks: WordMark[] = [
      { w: 'hi', kind: 'ok' },
      { w: 'эээ', kind: 'extra' },
      { w: 'there', kind: 'ok' },
    ];
    const { columns, extras } = buildVerdictNotation(marks);
    expect(columns).toHaveLength(2);
    expect(extras).toEqual([]);
  });

  it('three diagnoses: extra next to a `missing` → misheard', () => {
    const marks: WordMark[] = [
      { w: 'skipped', kind: 'missing' },
      { w: 'skippy', kind: 'extra' },
    ];
    const { extras } = buildVerdictNotation(marks);
    expect(extras[0].diagnosis).toBe('misheard');
  });

  it('three diagnoses: extra next to a `wrong`/`ending` → unknown (never louder than an error)', () => {
    const marksWrong: WordMark[] = [
      { w: 'word', kind: 'wrong', expected: 'world' },
      { w: 'extraWord', kind: 'extra' },
    ];
    expect(buildVerdictNotation(marksWrong).extras[0].diagnosis).toBe('unknown');

    const marksEnding: WordMark[] = [
      { w: 'walked', kind: 'ending', expected: 'walk' },
      { w: 'extraWord', kind: 'extra' },
    ];
    expect(buildVerdictNotation(marksEnding).extras[0].diagnosis).toBe('unknown');
  });

  it('three diagnoses: isolated extra with ok neighbours on both sides → added', () => {
    const marks: WordMark[] = [
      { w: 'I', kind: 'ok' },
      { w: 'really', kind: 'extra' },
      { w: 'love', kind: 'ok' },
    ];
    expect(buildVerdictNotation(marks).extras[0].diagnosis).toBe('added');
  });
});

// ТЗ №7 п.1 — the ЭТАЛОН (top) row must show the RAW subtitle word, not the
// normalized/expanded scoring token. Marks now optionally carry `display` (raw
// word) and `refWordIdx` (raw-word group). buildVerdictNotation uses `display`
// for the ref cell and MERGES consecutive columns sharing a refWordIdx so a
// contraction's two scoring tokens (let/us) render as one "Let's" column.
describe('buildVerdictNotation — T7 raw ЭТАЛОН row + contraction merge', () => {
  it('a ref mark with `display` uses the RAW word for the ЭТАЛОН row (case preserved)', () => {
    const marks: WordMark[] = [{ w: 'hello', kind: 'missing', display: 'Hello' }];
    expect(buildVerdictNotation(marks).columns).toEqual([{ ref: 'Hello', you: null, kind: 'missing' }]);
  });

  it('a wrong mark shows the RAW ref word on top (display), spoken below', () => {
    const marks: WordMark[] = [{ w: 'hallo', kind: 'wrong', expected: 'hello', display: 'Hello' }];
    expect(buildVerdictNotation(marks).columns).toEqual([{ ref: 'Hello', you: 'hallo', kind: 'wrong' }]);
  });

  it('contraction halves (same refWordIdx, all ok) merge into ONE column showing the raw contraction', () => {
    const marks: WordMark[] = [
      { w: 'let', kind: 'ok', display: "Let's", refWordIdx: 0 },
      { w: 'us', kind: 'ok', display: "Let's", refWordIdx: 0 },
      { w: 'learn', kind: 'ok' },
    ];
    expect(buildVerdictNotation(marks).columns).toEqual([
      { ref: "Let's", you: "Let's", kind: 'ok' },
      { ref: 'learn', you: 'learn', kind: 'ok' },
    ]);
  });

  it('a partially-matched contraction merges to the WORST kind but keeps the raw ЭТАЛОН', () => {
    const marks: WordMark[] = [
      { w: 'let', kind: 'ok', display: "Let's", refWordIdx: 0 },
      { w: 'us', kind: 'missing', display: "Let's", refWordIdx: 0 },
    ];
    expect(buildVerdictNotation(marks).columns).toEqual([{ ref: "Let's", you: 'let', kind: 'missing' }]);
  });

  it('an extra BETWEEN the two halves breaks the merge (they stay two columns) — extra still surfaced', () => {
    const marks: WordMark[] = [
      { w: 'let', kind: 'ok', display: "Let's", refWordIdx: 0 },
      { w: 'xxx', kind: 'extra' },
      { w: 'us', kind: 'ok', display: "Let's", refWordIdx: 0 },
    ];
    const { columns, extras } = buildVerdictNotation(marks);
    expect(columns).toHaveLength(2);
    expect(extras).toHaveLength(1);
  });

  it('hand-built marks WITHOUT display/refWordIdx render EXACTLY as before (back-compat)', () => {
    const marks: WordMark[] = [{ w: 'hello', kind: 'ok' }, { w: 'world', kind: 'ok' }];
    expect(buildVerdictNotation(marks).columns).toEqual([
      { ref: 'hello', you: 'hello', kind: 'ok' },
      { ref: 'world', you: 'world', kind: 'ok' },
    ]);
  });
});

describe('ShadowVerdictNotation — RTL render', () => {
  it('renders one column per ref word (ЭТАЛОН/ВЫ two-row unit) plus an out-of-grid extra', () => {
    const marks: WordMark[] = [
      { w: 'I', kind: 'ok' },
      { w: 'really', kind: 'extra' },
      { w: 'love', kind: 'ok' },
      { w: 'skipped', kind: 'missing' },
    ];
    const { getAllByTestId, getByTestId } = render(<ShadowVerdictNotation marks={marks} />);
    // 3 columns: I / love / skipped(empty slot)
    expect(getAllByTestId('shadow-verdict-col')).toHaveLength(3);
    // extra rendered as its OWN node, outside any column
    const extra = getByTestId('shadow-verdict-extra');
    expect(extra.textContent).toContain('really');
    expect(extra.getAttribute('data-diagnosis')).toBe('added');
  });

  it('missing renders an empty slot glyph, NOT a strikethrough word (consilium finding #1)', () => {
    const marks: WordMark[] = [{ w: 'skipped', kind: 'missing' }];
    const { getByTestId } = render(<ShadowVerdictNotation marks={marks} />);
    const col = getByTestId('shadow-verdict-col');
    expect(col.textContent).toContain('skipped'); // ref row still shows the word
    expect(col.textContent).toContain('····'); // empty slot glyph on the "you" row
    expect(col.querySelector('[style*="line-through"]')).toBeNull();
  });

  it('kind is exposed via data-kind for CSS/inspection (ok/wrong/ending/missing)', () => {
    const marks: WordMark[] = [
      { w: 'walked', kind: 'ending', expected: 'walk' },
    ];
    const { getByTestId } = render(<ShadowVerdictNotation marks={marks} />);
    expect(getByTestId('shadow-verdict-col').getAttribute('data-kind')).toBe('ending');
  });
});

describe('ShadowVerdictPartial — freeze-glyphs partial state', () => {
  it('renders the raw partial text with no word-level colouring (plain node, single text child)', () => {
    const { getByTestId } = render(<ShadowVerdictPartial text="I would li" />);
    const node = getByTestId('shadow-verdict-partial');
    expect(node.textContent).toBe('I would li');
    // No nested coloured spans — this is intentionally NOT a diff render.
    expect(node.querySelectorAll('span').length).toBe(0);
  });
});
