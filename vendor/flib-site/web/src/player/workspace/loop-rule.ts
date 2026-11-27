// loop-rule.ts — D2 seam (task T-RULE): checkRuleOnLoopExit named seam +
// ShadowForm stub. Context: docs/superpowers/specs/2026-07-06-shadowing-
// answer-seam-contract.md §"Связка с D2" + docs/audit/18-live-feedback-
// shadowing-full.md (loop×auto-advance matrix) + docs/audit/25-owner-
// decisions-round3.md (owner decision D2).
//
// ⚠️ This file does NOT reimplement `reduceLoopOutcome` (./loop-outcome.ts).
// That file still OWNS the actual pass/fail → advance/restart decision
// (score-vs-threshold comparison, wait-time math) and the coordinator
// (useShadowLoopCoordinator.ts) still owns when/whether to call it. This
// file answers a narrower, DIFFERENT question: "which cell of the
// loop×auto-advance matrix (audit/18) is active for the exercise that just
// exited A-B" — a CLASSIFICATION of the settings the coordinator already
// resolves on every arm (effectiveShadowSettings), exposed as a named,
// independently-testable seam so a future task (loop+threshold toggle UI +
// live shadowing forms, T4) has one place to plug into instead of
// re-deriving the matrix cell itself or reaching into coordinator internals.
//
// Mirrors, does NOT duplicate: the coordinator's own grading-cell predicate
// (`armedGradingRef.current = resolved.advanceEnabled === true &&
// typeof resolved.advanceThreshold === 'number'`, useShadowLoopCoordinator.ts
// onArm). That predicate is a one-line, stable CLASSIFICATION (not a
// decision with branching movement consequences) — mirroring it here is
// exactly the seam's job. Any future drift between the two would only
// mis-tag which cell this seam THINKS it's observing for logging/future-
// toggle purposes; it cannot change what the coordinator actually does,
// since the coordinator's own logic is untouched and unread by this file.

/** Which branch of the loop×auto-advance matrix (audit/18) is active for the
 *  exercise that just reached the end of its A-B segment. First `ON`/`OFF`
 *  = loopMode; second = "grading" (auto-advance enabled AND a numeric
 *  threshold is set — same predicate the coordinator uses to arm grading,
 *  see file doc above). */
export type LoopMatrixCell = 'ON+ON' | 'ON+OFF' | 'OFF+ON' | 'OFF+OFF';

/** How the current shadowing exercise was launched/armed.
 *
 * STUB (T-RULE): the real discriminator lands in a LATER task (T4), off
 * `ephemeralArmRef`/`anchorMode` (S-key arm → 'hotkey-s'; metadata/playhead
 * autostart → 'playhead-range'). Until T4 lands, `checkRuleOnLoopExit`
 * always returns the default below — no branch of behaviour reads this
 * value yet; it exists purely so T4 has a typed slot to fill in. */
export type ShadowForm = 'hotkey-s' | 'playhead-range';

/** Default form returned by the stub (metadata/playhead-driven autostart is
 *  the only form actually wired today). T4 replaces this with a real read
 *  of ephemeralArmRef/anchorMode. */
export const DEFAULT_SHADOW_FORM: ShadowForm = 'playhead-range';

export interface LoopRuleCtx {
  /** Exercise's resolved loopMode (effectiveShadowSettings output). */
  loopMode: boolean;
  /** Exercise's resolved advanceEnabled (effectiveShadowSettings output). */
  advanceEnabled: boolean;
  /** Exercise's resolved advanceThreshold. `undefined`/non-number = "no
   *  threshold set" — mirrors the coordinator's `typeof` check, NOT the
   *  score-vs-threshold comparison itself (that stays in reduceLoopOutcome). */
  advanceThreshold?: number;
}

export interface RuleDecision {
  /** Which matrix cell (audit/18) applies to THIS exit. */
  cell: LoopMatrixCell;
  /** Echoed straight from ctx — `undefined` when the cell's grading
   *  dimension is OFF (no threshold governs this exit). */
  advanceThreshold?: number;
  /** STUB — see `ShadowForm` doc above; T4 replaces this default. */
  form: ShadowForm;
}

/**
 * checkRuleOnLoopExit — D2 named seam. Pure function: takes the settings
 * snapshot the coordinator already resolves on every A-B exit
 * (effectiveShadowSettings) and EXPOSES which matrix cell (audit/18)
 * applies, plus a stubbed shadowing-form tag. Does NOT decide advance vs.
 * restart (reduceLoopOutcome's job, unchanged) and does not read or mutate
 * any coordinator state — callers pass in already-resolved settings.
 */
export function checkRuleOnLoopExit(ctx: LoopRuleCtx): RuleDecision {
  const gradingOn = ctx.advanceEnabled === true && typeof ctx.advanceThreshold === 'number';
  const cell: LoopMatrixCell = `${ctx.loopMode ? 'ON' : 'OFF'}+${gradingOn ? 'ON' : 'OFF'}`;
  return {
    cell,
    advanceThreshold: gradingOn ? ctx.advanceThreshold : undefined,
    // STUB: form flag from T4 (ephemeralArmRef/anchorMode); default until then.
    form: DEFAULT_SHADOW_FORM,
  };
}
