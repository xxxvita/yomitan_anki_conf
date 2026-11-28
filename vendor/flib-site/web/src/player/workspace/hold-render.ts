// hold-render.ts — T3 seam: pure helper for stale-outcome filtering
// (carry T-ANS/F3). Context: task-T3-brief.md item 1 + docs/superpowers/
// specs/2026-07-06-shadowing-wholelift-tz-v3.md §6.4.
//
// `finalizeLoopFromAnswerSource`'s own `onOutcome` gate (answer-source.ts)
// only drops an outcome that arrives after ITS OWN eval's AbortSignal fired
// (coordinator eval-timeout / unmount) — see that file's FIX F3 doc. It does
// NOT catch a DIFFERENT staleness: the coordinator's `onArm` has no
// evalInFlightRef guard against arming a NEW, DIFFERENT exercise while a
// PREVIOUS exercise's eval promise is still pending un-aborted
// (useShadowLoopCoordinator.ts onArm :336 only special-cases a re-arm of the
// SAME id). When that happens, the stale eval's `onOutcome` still fires
// later (its own signal was never aborted), but by then `armedSegmentId()`
// already points at the NEW exercise — this filter is what catches that
// case at the render boundary, one layer up from the answer-seam contract.
import type { AnswerOutcomeEvent } from './answer-source';

/**
 * Returns `event` unchanged when it belongs to the exercise currently
 * armed/held (`currentExerciseId`), or `null` when it's stale (belongs to an
 * exercise the loop has already moved on from). A render layer (T3's
 * ShadowHoldOverlay / T7's eventual verdict card) must call this BEFORE
 * showing anything derived from the outcome — never render a verdict for an
 * exercise that isn't the one currently on screen.
 */
export function filterAnswerOutcomeForRender(
  event: AnswerOutcomeEvent,
  currentExerciseId: string | null,
): AnswerOutcomeEvent | null {
  return currentExerciseId != null && event.exerciseId === currentExerciseId ? event : null;
}
