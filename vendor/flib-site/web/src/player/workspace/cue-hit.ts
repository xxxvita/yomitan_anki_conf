/**
 * Index of the first span containing time `t` ([start, end) — start inclusive,
 * end exclusive so back-to-back cues resolve to the later one), or -1.
 *
 * Spans must be in the SAME coordinate space as `t`. For workspace-bar drops
 * that is the effective timeline space (per-cue shift + global offset applied),
 * so the hit matches the cue ribbon the user visually dropped onto.
 */
export function findCueIndexAtTime(
  t: number,
  spans: Array<{ start: number; end: number }>,
): number {
  for (let i = 0; i < spans.length; i++) {
    const s = spans[i];
    if (s.end <= s.start) continue; // degenerate — never a hit target
    if (t >= s.start && t < s.end) return i;
  }
  return -1;
}
