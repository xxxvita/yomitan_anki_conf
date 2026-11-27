// region-clamp.ts — shared pure clamp for percentage-space regions rendered
// over the workspace bar (Ф3 mute regions + Ф1 selection overlay).
//
// WEB-SEAM: both call sites used to clamp independently to -2..104 (a leftover
// desktop exercise-sves margin, see cue-clamp.ts history). fb#6 final review
// caught a live regression: a mute region straddling the left edge rendered
// (and stayed clickable, pointerEvents:'auto') ~16px left of the bar, past
// the T1 clip container (.player-page{overflow-x:clip} clips at X0−16, the
// old -2% left math sat at X0−15.7 — visibly and interactively outside).
// Clamping to the true visible frame [0,100] (matching the already-fixed
// AUD-combo, WorkspacePanelThemed.tsx ~1850) removes the leak. A region that
// ends up with zero (or negative) width after clamping is fully off-view —
// callers must not render it.
export interface ClampedRegion {
  left: number;
  width: number;
}

export function clampRegionPct(leftRawPct: number, rightRawPct: number): ClampedRegion | null {
  const left = Math.max(0, leftRawPct);
  const right = Math.min(100, rightRawPct);
  const width = Math.max(0, right - left);
  if (width <= 0) return null;
  return { left, width };
}
