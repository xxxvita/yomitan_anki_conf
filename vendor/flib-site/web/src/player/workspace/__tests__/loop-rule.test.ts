// loop-rule.test.ts — D2 seam (task T-RULE): checkRuleOnLoopExit pure
// function, one test per matrix cell (audit/18) + the typeof-threshold
// guard + the form-stub contract. Does NOT re-test reduceLoopOutcome's
// advance/restart decision (loop-outcome.ts owns that, unchanged) — only
// the CLASSIFICATION this seam exposes.
import { describe, it, expect } from 'vitest';
import { checkRuleOnLoopExit, DEFAULT_SHADOW_FORM, type LoopRuleCtx } from '../loop-rule';

describe('checkRuleOnLoopExit — loop×auto-advance matrix (audit/18)', () => {
  it('ON+ON: loop on, advance on with a numeric threshold', () => {
    const ctx: LoopRuleCtx = { loopMode: true, advanceEnabled: true, advanceThreshold: 80 };
    expect(checkRuleOnLoopExit(ctx)).toEqual({
      cell: 'ON+ON',
      advanceThreshold: 80,
      form: DEFAULT_SHADOW_FORM,
    });
  });

  it('ON+OFF: loop on, advance disabled', () => {
    const ctx: LoopRuleCtx = { loopMode: true, advanceEnabled: false };
    expect(checkRuleOnLoopExit(ctx)).toEqual({
      cell: 'ON+OFF',
      advanceThreshold: undefined,
      form: DEFAULT_SHADOW_FORM,
    });
  });

  it('ON+OFF: loop on, advance "enabled" but no numeric threshold set (typeof guard)', () => {
    // Mirrors the coordinator's own armedGradingRef predicate
    // (advanceEnabled === true && typeof advanceThreshold === 'number') —
    // enabled-but-no-threshold must NOT count as grading-on.
    const ctx: LoopRuleCtx = { loopMode: true, advanceEnabled: true, advanceThreshold: undefined };
    expect(checkRuleOnLoopExit(ctx).cell).toBe('ON+OFF');
    expect(checkRuleOnLoopExit(ctx).advanceThreshold).toBeUndefined();
  });

  it('OFF+ON: loop off, advance on with a numeric threshold', () => {
    const ctx: LoopRuleCtx = { loopMode: false, advanceEnabled: true, advanceThreshold: 75 };
    expect(checkRuleOnLoopExit(ctx)).toEqual({
      cell: 'OFF+ON',
      advanceThreshold: 75,
      form: DEFAULT_SHADOW_FORM,
    });
  });

  it('OFF+OFF: loop off, advance disabled', () => {
    const ctx: LoopRuleCtx = { loopMode: false, advanceEnabled: false };
    expect(checkRuleOnLoopExit(ctx)).toEqual({
      cell: 'OFF+OFF',
      advanceThreshold: undefined,
      form: DEFAULT_SHADOW_FORM,
    });
  });

  it('form stub: always returns the default, independent of the matrix cell (T4 will replace this)', () => {
    const cells: LoopRuleCtx[] = [
      { loopMode: true, advanceEnabled: true, advanceThreshold: 90 },
      { loopMode: true, advanceEnabled: false },
      { loopMode: false, advanceEnabled: true, advanceThreshold: 50 },
      { loopMode: false, advanceEnabled: false },
    ];
    for (const ctx of cells) {
      expect(checkRuleOnLoopExit(ctx).form).toBe('playhead-range');
    }
  });
});
