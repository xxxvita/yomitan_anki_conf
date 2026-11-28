/**
 * Map a [0,1] fraction across the timeline view window to a time (seconds).
 * Pure helper — no React dependency, easy to unit-test.
 */
export function dropTimeFromFraction(fraction: number, viewStart: number, viewEnd: number): number {
  const f = Math.min(1, Math.max(0, fraction));
  return viewStart + f * (viewEnd - viewStart);
}
