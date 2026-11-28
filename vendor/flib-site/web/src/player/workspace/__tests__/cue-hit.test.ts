// WEB-SEAM (T6): lifted verbatim from desktop canon
// (anki_conf-shadowing-fix/.../VideoPlayerPanel/utils/cue-hit.test.ts) — pure
// unit test of the T1-lifted findCueIndexAtTime helper (workspace/cue-hit.ts).
// Not previously ported to web (T1 lifted the helper, not this test file);
// added now since resolveMovedExercise's body-move snap depends on it and the
// back-to-back-cue case (item #2 of the T6 test checklist) was uncovered.
import { describe, it, expect } from 'vitest';
import { findCueIndexAtTime } from '../cue-hit';

// Spans are in EFFECTIVE timeline coordinates (per-cue shift + global offset
// already applied by the caller) — the same coordinates the workspace bar
// renders, so a drop lands on the cue the user visually targeted.
const spans = [
  { start: 1.0, end: 3.0 },
  { start: 4.0, end: 6.5 },
  { start: 6.5, end: 8.0 }, // back-to-back with previous
];

describe('findCueIndexAtTime', () => {
  it('hits a cue when t is strictly inside', () => {
    expect(findCueIndexAtTime(2.0, spans)).toBe(0);
    expect(findCueIndexAtTime(5.0, spans)).toBe(1);
  });

  it('start boundary is inclusive, end boundary is exclusive', () => {
    expect(findCueIndexAtTime(1.0, spans)).toBe(0);
    expect(findCueIndexAtTime(3.0, spans)).toBe(-1); // gap after cue 0
    // back-to-back: 6.5 belongs to the NEXT cue, not the previous
    expect(findCueIndexAtTime(6.5, spans)).toBe(2);
  });

  it('returns -1 in gaps, before the first and after the last cue', () => {
    expect(findCueIndexAtTime(0.5, spans)).toBe(-1);
    expect(findCueIndexAtTime(3.5, spans)).toBe(-1);
    expect(findCueIndexAtTime(9.0, spans)).toBe(-1);
  });

  it('returns -1 for an empty span list', () => {
    expect(findCueIndexAtTime(2.0, [])).toBe(-1);
  });

  it('first match wins on overlapping spans', () => {
    const overlapping = [
      { start: 1.0, end: 5.0 },
      { start: 4.0, end: 6.0 },
    ];
    expect(findCueIndexAtTime(4.5, overlapping)).toBe(0);
  });

  it('ignores degenerate spans (end <= start)', () => {
    const withDegenerate = [
      { start: 2.0, end: 2.0 },
      { start: 2.0, end: 4.0 },
    ];
    expect(findCueIndexAtTime(2.0, withDegenerate)).toBe(1);
  });
});
