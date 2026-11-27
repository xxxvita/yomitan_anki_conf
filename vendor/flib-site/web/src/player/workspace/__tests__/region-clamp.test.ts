import { describe, it, expect } from 'vitest';
import { clampRegionPct } from '../region-clamp';

describe('clampRegionPct — visible-frame clamp for mute regions / selection overlay (fb#6 final review)', () => {
  it('clamps a left-straddling region to 0 without distorting the right edge', () => {
    // Old math: Math.max(-2, l) let a region sit at -2% == ~16px left of the
    // bar (past the T1 clip container) while staying pointerEvents:auto.
    const r = clampRegionPct(-15.7, 30);
    expect(r).not.toBeNull();
    expect(r!.left).toBe(0);
    expect(r!.width).toBe(30);
  });

  it('caps the right edge at 100 for an over-wide region', () => {
    const r = clampRegionPct(60, 104);
    expect(r).not.toBeNull();
    expect(r!.left).toBe(60);
    expect(r!.width).toBe(40); // right=min(100,104)=100 → 100-60
  });

  it('returns null when fully off-screen to the left', () => {
    expect(clampRegionPct(-30, -5)).toBeNull();
  });

  it('returns null when fully off-screen to the right', () => {
    expect(clampRegionPct(105, 120)).toBeNull();
  });

  it('returns null for a degenerate straddle where both clamped edges collapse to the same boundary', () => {
    // Both raw edges land left of view (old math would still have produced a
    // sliver: left=max(-2,-30)=-2, right=min(104,-1)=-1, width=1 -> rendered
    // off-view). New math must cull it entirely.
    expect(clampRegionPct(-30, -1)).toBeNull();
  });

  it('keeps a fully in-view region untouched', () => {
    const r = clampRegionPct(20, 45);
    expect(r).toEqual({ left: 20, width: 25 });
  });
});
