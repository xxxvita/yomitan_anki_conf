import type { Cue } from './panel-types';

// Pack cues into vertically-stacked lanes so overlapping cues do not collide.
// Returns a lane index per cue (0 = topmost), or `undefined` when no packing
// is requested. Capped at `maxLanes`; cues that would spill beyond the cap
// share the last lane (visually overlaps but never exceeds panel height).
//
// Density guard: above `denseThreshold` cues we clamp to 2 lanes max — a
// Japanese subtitle track with ~1200 cues would otherwise reduce each cue to
// a single pixel.
export function packCuesIntoLanes(
  cues: Cue[],
  getEffectiveStart: (idx: number, startTime: number) => number,
  getEffectiveEnd: (idx: number, endTime: number) => number,
  offset: number,
  maxLanes = 3,
  denseThreshold = 800,
): number[] {
  const lanes = cues.length > denseThreshold ? Math.min(2, maxLanes) : maxLanes;
  const laneEnds = new Array<number>(lanes).fill(-Infinity);
  const result = new Array<number>(cues.length);
  for (let i = 0; i < cues.length; i++) {
    const s = getEffectiveStart(i, cues[i].startTime) + offset;
    const e = getEffectiveEnd(i, cues[i].endTime) + offset;
    let lane = 0;
    for (let l = 0; l < lanes; l++) {
      if (s >= laneEnds[l]) { lane = l; break; }
      if (l === lanes - 1) { lane = l; break; } // spill into last lane
    }
    result[i] = lane;
    laneEnds[lane] = e;
  }
  return result;
}
