// task #1068 (#26) — smooth playhead.
//
// The React `currentTime` prop updates only on the <video> `timeupdate` event,
// which fires ~4×/sec, so the timeline playhead jumps in ~250ms steps. To move
// it smoothly we drive its position from a rAF loop reading the live
// videoEl.currentTime and write it into a CSS custom property — this helper is
// the shared pure math, mirroring the inline `playPct = clamp(timeToPct(t))`.

/** Playhead position as a percentage [0,100] of the visible window
 *  [viewStart, viewStart+viewLen]. Mirrors timeToPct() + the [0,100] clamp.
 *  Returns 0 for a non-positive view length (degenerate/unmeasured view). */
export function playheadLeftPct(time: number, viewStart: number, viewLen: number): number {
  if (!(viewLen > 0)) return 0;
  const pct = ((time - viewStart) / viewLen) * 100;
  return Math.max(0, Math.min(100, pct));
}
