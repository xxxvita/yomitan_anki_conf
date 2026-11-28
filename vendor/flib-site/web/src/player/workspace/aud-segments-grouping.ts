// Фаза II (2026-05-27) — aud_segments grouping for the AUD-track combo.
//
// Several segments can cover overlapping time ranges (legitimate
// multi-language case: RU and ES both for [15..30s]). Each overlapping
// CLUSTER renders ONE combo on the timeline so the user picks which
// language to play in that span. Non-overlapping clusters render
// separately.
//
// Bug 15 (2026-05-27) — the same clustering is reused for YOU-track
// dub-recordings via `groupOverlappingByRange` (generic version).
// Avoids the overlap-stacking UX bug where two combos at the same
// left/width hide each other.

import type { AudSegment } from './api-types';

export interface AudSegmentGroup {
  /** Group's outer bounds (min start of any contained seg, max end). */
  start: number;
  end: number;
  segments: AudSegment[];
}

/** Generic overlap clustering for ANY time-ranged item. Greedy
 *  single-pass: sorted-by-start, item joins current cluster while it
 *  starts BEFORE running max-end (10ms tolerance for float jitter).
 *  Degenerate inputs (NaN, end <= start) dropped at the entrance.
 *
 *  Used by both `groupOverlappingSegments` (AUD combo Phase II) and
 *  the YOU-track dub-recording cluster (Bug 15). */
export interface Group<T> {
  start: number;
  end: number;
  items: T[];
}

export function groupOverlappingByRange<T>(
  items: T[],
  getStart: (t: T) => number,
  getEnd: (t: T) => number,
): Group<T>[] {
  const clean = items.filter(it => {
    const s = getStart(it);
    const e = getEnd(it);
    return Number.isFinite(s) && Number.isFinite(e) && e > s;
  });
  if (!clean.length) return [];
  const sorted = [...clean].sort((a, b) => getStart(a) - getStart(b));
  const groups: Group<T>[] = [];
  let cur: Group<T> = {
    start: getStart(sorted[0]),
    end:   getEnd(sorted[0]),
    items: [sorted[0]],
  };
  for (let i = 1; i < sorted.length; i++) {
    const it = sorted[i];
    if (getStart(it) <= cur.end + 0.01) {
      cur.end = Math.max(cur.end, getEnd(it));
      cur.items.push(it);
    } else {
      groups.push(cur);
      cur = { start: getStart(it), end: getEnd(it), items: [it] };
    }
  }
  groups.push(cur);
  return groups;
}

/** AUD segments grouping — thin wrapper around `groupOverlappingByRange`
 *  preserving the original return shape `{start, end, segments}` for
 *  existing callers. */
export function groupOverlappingSegments(segs: AudSegment[]): AudSegmentGroup[] {
  return groupOverlappingByRange(segs, s => s.start_sec, s => s.end_sec)
    .map(g => ({ start: g.start, end: g.end, segments: g.items }));
}
