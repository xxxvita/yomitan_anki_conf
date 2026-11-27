// WEB-SEAM (T6): lifted verbatim from desktop canon
// (anki_conf-shadowing-fix/.../components/workspace/exercise-move.test.ts) —
// pure unit test of the T1-lifted resolveMovedExercise helper
// (workspace/exercise-move.ts), no rendering involved. No behavioural changes.
import { describe, it, expect } from 'vitest';
import { resolveMovedExercise } from '../exercise-move';

const cues = [
  { startTime: 10, endTime: 13 },
  { startTime: 15, endTime: 18 },
];

const noneOccupied = new Set<number>();

describe('resolveMovedExercise', () => {
  it('snaps to a cue when the moved midpoint lands inside it', () => {
    // moved box 14.5..17.5 → midpoint 16 → inside cue #1 → exact cue range
    expect(resolveMovedExercise(14.5, 17.5, cues, noneOccupied)).toEqual({
      startTime: 15, endTime: 18, anchorMode: 'subtitle', subIndex: 1,
    });
  });

  it('stays time-range when the midpoint lands in a gap', () => {
    // box 12.5..15.5 → midpoint 14 → between cues
    expect(resolveMovedExercise(12.5, 15.5, cues, noneOccupied)).toEqual({
      startTime: 12.5, endTime: 15.5, anchorMode: 'time-range', subIndex: undefined,
    });
  });

  it('does NOT snap onto a cue already owned by another exercise', () => {
    const occupied = new Set([1]);
    expect(resolveMovedExercise(14.5, 17.5, cues, occupied)).toEqual({
      startTime: 14.5, endTime: 17.5, anchorMode: 'time-range', subIndex: undefined,
    });
  });

  it('stays time-range with no cues at all', () => {
    expect(resolveMovedExercise(3, 6, [], noneOccupied)).toEqual({
      startTime: 3, endTime: 6, anchorMode: 'time-range', subIndex: undefined,
    });
  });

  it('midpoint exactly on a cue start counts as inside that cue', () => {
    // box 13.5..16.5 → midpoint 15 → [15,18) inclusive start
    expect(resolveMovedExercise(13.5, 16.5, cues, noneOccupied)).toEqual({
      startTime: 15, endTime: 18, anchorMode: 'subtitle', subIndex: 1,
    });
  });
});
