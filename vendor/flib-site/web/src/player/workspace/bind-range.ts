/** Cues whose [startTime,endTime] interval intersects the open range (a,b). */
export function cuesIntersectingRange<T extends { startTime: number; endTime: number }>(
  cues: T[], a: number, b: number,
): T[] {
  return cues.filter(c => c.endTime > a && c.startTime < b);
}
