export interface TimeSpan { startTime: number; endTime: number; }

/**
 * Resolve overlap between an existing-exercise list and a new exercise:
 * every exercise that overlaps `newEx` is shrunk away from it (an exercise
 * starting before newEx has its end clamped to newEx.startTime; one starting
 * at/after newEx has its start clamped to newEx.endTime). Non-overlapping
 * exercises pass through untouched. An exercise shrunk to <= 0 duration is
 * dropped. Pure — returns a new array.
 */
export function resolveExerciseOverlap<T extends TimeSpan>(existing: T[], newEx: TimeSpan): T[] {
  const overlaps = (a: TimeSpan, b: TimeSpan) => a.startTime < b.endTime && b.startTime < a.endTime;
  const out: T[] = [];
  for (const e of existing) {
    if (!overlaps(e, newEx)) { out.push(e); continue; }
    const shrunk: T = e.startTime < newEx.startTime
      ? { ...e, endTime: newEx.startTime }
      : { ...e, startTime: newEx.endTime };
    if (shrunk.endTime - shrunk.startTime > 0) out.push(shrunk);
    // else: shrunk to degenerate → dropped
  }
  return out;
}
