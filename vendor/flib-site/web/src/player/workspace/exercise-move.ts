import { findCueIndexAtTime } from './cue-hit';

export interface MovedExercisePatch {
  startTime: number;
  endTime: number;
  anchorMode: 'subtitle' | 'time-range';
  subIndex: number | undefined;
}

/**
 * Resolve where a body-dragged shadowing exercise lands.
 *
 * Midpoint inside a cue → snap to that cue's exact range (subtitle anchor) —
 * «положил на субтитр» must occupy ровно его отрезок. A cue already owned by
 * another exercise is not a snap target (one exercise per subtitle). Otherwise
 * the exercise keeps its dragged position and duration as a time-range.
 *
 * Times are raw player seconds — caller clamps to [0, duration] during drag.
 */
export function resolveMovedExercise(
  startTime: number,
  endTime: number,
  cues: Array<{ startTime: number; endTime: number }>,
  occupiedSubIndexes: ReadonlySet<number>,
): MovedExercisePatch {
  const mid = (startTime + endTime) / 2;
  const hit = findCueIndexAtTime(mid, cues.map(c => ({ start: c.startTime, end: c.endTime })));
  if (hit >= 0 && !occupiedSubIndexes.has(hit)) {
    return {
      startTime: cues[hit].startTime,
      endTime: cues[hit].endTime,
      anchorMode: 'subtitle',
      subIndex: hit,
    };
  }
  return { startTime, endTime, anchorMode: 'time-range', subIndex: undefined };
}
