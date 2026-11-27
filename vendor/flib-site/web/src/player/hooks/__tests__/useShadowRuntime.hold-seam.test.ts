// @vitest-environment jsdom
// useShadowRuntime.hold-seam.test.ts — T3 (hold-render + B4-резюм + class-3
// lifecycle, audit/24). Mirrors the wiring pattern established in
// useShadowRuntime.rule-seam.test.ts / .answer-seam.test.ts — real
// useWorkspace + fake adapter, not mocked actuators.
//
// Covers task-T3-brief.md's numbered test list:
//   1. loop OFF+fail (G5, OFF+ON matrix) → holding=true, arm alive, no timer.
//   2. resumeFromHold() during hold → resumeFromBoundary('advance') + arm
//      cleared + heldRef=false.
//   3. resumeFromHold() without hold → no-op.
//   4. class-3: re-score(pass) clears heldRef (no phantom resume);
//      onArm/onLeave/setArmedGrading(false) all clear heldRef too.
//   5. advance/restart resolve without any fake-timer advance (verbatim —
//      worktree has no timed post-verdict hold).
//   6. carry T-ANS/F3: an outcome for a superseded exercise (re-armed while
//      the previous eval was still pending, un-aborted) does not populate
//      `verdictOutcome`.
import { describe, it, expect, vi, afterEach } from 'vitest';
import React from 'react';
import { renderHook, act, render, screen } from '@testing-library/react';
import { useWorkspace } from '../useWorkspace';
import { useShadowRuntime, type ShadowRuntimeWorkspaceActuators } from '../useShadowRuntime';
import { makeFakeAdapter } from '../../../adapter/__tests__/fake';
import type { Cue as LiveCue } from '../useSubtitles';
import type { ShadowExerciseAnnotation, ShadowState } from '../../workspace/panel-types';
import { FakeAnswerSource, type AnswerOutcome, type AnswerSource } from '../../workspace/answer-source';
import { ShadowHoldOverlay } from '../../components/ShadowHoldOverlay';

function makeExercise(loopMode: boolean, grading: boolean, id = 'ex1'): ShadowExerciseAnnotation {
  return {
    id, startTime: 5, endTime: 10, anchorMode: 'time-range',
    settings: {
      loopMode, advanceEnabled: grading, advanceThreshold: grading ? 80 : undefined as unknown as number,
      mode: 'subtitle', saveAudio: false,
      engines: { asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' },
      pauseAtEnd: 0,
    },
    createdAt: '2026-07-06T00:00:00Z', updatedAt: '2026-07-06T00:00:00Z',
  };
}

const liveCues: LiveCue[] = [{ start: 5, end: 10, text_en: 'hello world', text_ru: 'привет мир' }];

function setup(opts: {
  evaluate: ReturnType<typeof vi.fn>;
  answerSource?: AnswerSource;
}) {
  const adapter = makeFakeAdapter({ t: 5 });
  const wsActuatorsRef: React.MutableRefObject<ShadowRuntimeWorkspaceActuators | null> = { current: null };
  const resumeSpy = vi.fn();

  const { result: rt, rerender } = renderHook(() =>
    useShadowRuntime({
      videoId: 'v1',
      liveCues,
      currentTime: adapter.currentTime(),
      getCurrentTime: () => adapter.currentTime(),
      getShadowState: () => ({ active: true } as unknown as ShadowState),
      wsActuatorsRef,
      seek: adapter.seek,
      pauseVideo: adapter.pause,
      evaluate: opts.evaluate,
      answerSource: opts.answerSource,
    }),
  );

  const { result: ws } = renderHook(() =>
    useWorkspace(adapter, [{ start: 5, end: 10 }], 'v1', false,
      rt.current.onLoopBoundary, rt.current.shouldPauseAtBoundary, rt.current.onLoopRestart),
  );

  act(() => {
    wsActuatorsRef.current = {
      restoreWorkspace: ws.current.restoreWorkspace,
      resumeFromBoundary: (action) => { resumeSpy(action); ws.current.resumeFromBoundary(action); },
      deactivateWorkspace: ws.current.deactivateWorkspace,
      countdownThenPlay: ws.current.countdownThenPlay,
      getWorkspaceSnapshot: ws.current.getWorkspaceSnapshot,
    };
  });

  return { adapter, rt, ws, rerender, resumeSpy };
}

/** OFF+ON (non-looping+grading, G5) — arm ex1, drive the playhead past
 *  endTime, and let a forced non-final outcome resolve into a `hold`. */
async function armAndHold(
  evaluate: ReturnType<typeof vi.fn>,
  forced: AnswerOutcome = { status: 'no-response', reason: 'no-audio' },
) {
  const src = new FakeAnswerSource();
  src.setForced(forced);
  const rig = setup({ evaluate, answerSource: src });
  const ex = makeExercise(false, true);
  act(() => { rig.rt.current.onArm(ex); });
  rig.adapter._setTime(10.05);
  await act(async () => {
    rig.rerender();
    await Promise.resolve(); await Promise.resolve();
  });
  return { ...rig, ex, src };
}

afterEach(() => { vi.useRealTimers(); });

describe('useShadowRuntime — T3 item 1: hold-render mirrors the worktree hold-emit', () => {
  it('loop OFF+fail (G5) → holding=true, arm alive, no timer needed (mirrors worktree apply() else-branch)', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never)); // never reached (non-final path)
    const { rt, ws } = await armAndHold(evaluate);

    expect(rt.current.holding).toBe(true);
    expect(rt.current.isHeld()).toBe(true);
    expect(rt.current.armedSegmentId()).toBe('ex1'); // arm survives the hold
    expect(ws.current.looping).toBe(false); // OFF — never looped
    expect(evaluate).not.toHaveBeenCalled(); // non-final never reaches server evaluate
  });
});

describe('useShadowRuntime — T3 item 2/3: resumeFromHold (B4-резюм seam for T4)', () => {
  it('during a hold: resumeFromBoundary("advance") fires, arm clears, heldRef=false', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const { rt, resumeSpy } = await armAndHold(evaluate);
    expect(rt.current.holding).toBe(true);

    act(() => { rt.current.resumeFromHold(); });

    expect(resumeSpy).toHaveBeenCalledWith('advance');
    expect(rt.current.holding).toBe(false);
    expect(rt.current.isHeld()).toBe(false);
    // Mirror of the coordinator's own advance-branch cleanup (via reused
    // onLeave, not a duplicated internal-ref reset) — nothing ahead → the
    // run ends, arm clears.
    expect(rt.current.armedSegmentId()).toBeNull();
  });

  it('without an active hold: resumeFromHold() is a no-op', () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const { rt, resumeSpy } = setup({ evaluate });
    const ex = makeExercise(false, true);
    act(() => { rt.current.onArm(ex); }); // armed, but no eval ran — not held
    expect(rt.current.holding).toBe(false);

    act(() => { rt.current.resumeFromHold(); });

    expect(resumeSpy).not.toHaveBeenCalled();
    expect(rt.current.armedSegmentId()).toBe('ex1'); // untouched
  });
});

describe('useShadowRuntime — T3 item 4: class-3 lifecycle clears a stale heldRef', () => {
  it('re-score that resolves PASS after a hold clears heldRef — a later resumeFromHold() is a no-op (no phantom resume)', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const { rt, adapter, rerender, src, resumeSpy } = await armAndHold(evaluate);
    expect(rt.current.holding).toBe(true);

    // Re-score: the user's second attempt now succeeds. segEndHandledRef was
    // reset to false by the hold (useShadowLoopCoordinator.ts apply()'s hold
    // branch), so re-entering the tail region re-fires G5.
    src.setForced({ status: 'final', text: 'hello world' });
    adapter._setTime(10.06);
    await act(async () => {
      rerender();
      await Promise.resolve(); await Promise.resolve();
    });

    expect(rt.current.holding).toBe(false); // cleared at 'eval-start', not resurrected by the pass/advance
    expect(rt.current.isHeld()).toBe(false);

    resumeSpy.mockClear();
    act(() => { rt.current.resumeFromHold(); }); // simulates a late/racy S-press (T4)
    expect(resumeSpy).not.toHaveBeenCalled(); // no phantom resume
  });

  it('onArm (a newly armed, DIFFERENT exercise) clears any surviving hold', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const { rt } = await armAndHold(evaluate);
    expect(rt.current.holding).toBe(true);

    const ex2 = makeExercise(false, true, 'ex2');
    act(() => { rt.current.onArm(ex2); });

    expect(rt.current.holding).toBe(false);
    expect(rt.current.isHeld()).toBe(false);
  });

  it('onLeave (matching the held exerciseId) clears the hold', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const { rt } = await armAndHold(evaluate);
    expect(rt.current.holding).toBe(true);

    act(() => { rt.current.onLeave('ex1'); });

    expect(rt.current.holding).toBe(false);
    expect(rt.current.isHeld()).toBe(false);
  });

  it('setArmedGrading(false) while held releases the hold (auto-advance OFF must not leave a phantom hold)', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const { rt } = await armAndHold(evaluate);
    expect(rt.current.holding).toBe(true);

    act(() => { rt.current.setArmedGrading(false); });

    expect(rt.current.holding).toBe(false);
    expect(rt.current.isHeld()).toBe(false);
  });
});

describe('useShadowRuntime — T3 item 5: advance/restart resolve without any timed hold', () => {
  it('ON+ON pass verdict advances immediately — no vi.useFakeTimers() anywhere in this test', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const src = new FakeAnswerSource({ canonicalText: 'hello world' });
    const { rt, ws, adapter } = setup({ evaluate, answerSource: src });
    const ex = makeExercise(true, true); // ON+ON — looping + grading
    act(() => { rt.current.onArm(ex); });
    expect(ws.current.looping).toBe(true);

    await act(async () => {
      adapter._setTime(10.01);
      ws.current._boundaryTickForTest();
      await Promise.resolve(); await Promise.resolve();
    });

    expect(ws.current.looping).toBe(false); // advanced — resolved on plain microtask flush
    expect(rt.current.holding).toBe(false); // advance path never holds
  });
});

describe('useShadowRuntime — T3 carry T-ANS/F3: stale-outcome filter by exerciseId', () => {
  it('an outcome for a SUPERSEDED exercise (re-armed while its own eval was still pending, never aborted) is dropped from verdictOutcome', async () => {
    // A controllable AnswerSource: awaitAnswerByBoundary never resolves on
    // its own — the test resolves it explicitly, at the exact moment it
    // wants, independent of any timer/budget racing (FakeAnswerSource's
    // hang() would otherwise race the adapter's own 3000ms budget timer).
    const resolvers = new Map<string, (o: AnswerOutcome) => void>();
    const controlled: AnswerSource = {
      awaitAnswerByBoundary(exerciseId) {
        return new Promise<AnswerOutcome>((resolve) => { resolvers.set(exerciseId, resolve); });
      },
    };
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const { rt, adapter, rerender } = setup({ evaluate, answerSource: controlled });

    const ex1 = makeExercise(false, true, 'ex1');
    act(() => { rt.current.onArm(ex1); });
    adapter._setTime(10.05);
    await act(async () => { rerender(); await Promise.resolve(); await Promise.resolve(); });
    // ex1's finalizeLoop is now pending (resolvers has 'ex1', unresolved).
    expect(rt.current.armedSegmentId()).toBe('ex1');

    // A DIFFERENT exercise gets armed before ex1's outcome resolves — the
    // coordinator's onArm has no guard against this for a foreign id (only
    // a re-arm of the SAME id is special-cased — useShadowLoopCoordinator.ts
    // onArm :336/verbatim).
    const ex2 = makeExercise(false, true, 'ex2');
    act(() => { rt.current.onArm(ex2); });
    expect(rt.current.armedSegmentId()).toBe('ex2');

    // ex1's outcome resolves NOW — late, but its own eval was never aborted
    // (nothing in this scenario touched ex1's AbortController), so the
    // answer-seam's own signal.aborted gate (answer-source.ts FIX F3) does
    // NOT catch this — it is specifically THIS hook's exerciseId filter that
    // must.
    await act(async () => {
      resolvers.get('ex1')?.({ status: 'final', text: 'hello world' });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(rt.current.verdictOutcome).toBeNull(); // stale ex1 outcome — dropped, not shown as ex2's verdict
  });
});

describe('useShadowRuntime — T3-fix FIX A [CRIT]: verdictOutcome survives its own eval-start', () => {
  it('a full answerSource cycle (ON+ON, pass verdict) through the HOOK ends with a non-null verdictOutcome carrying the right outcome, and it renders', async () => {
    // Pre-fix, this test would have failed: handleLog's 'eval-start' case
    // used to `setVerdictOutcome(null)` unconditionally — and in the
    // answerSource path, 'eval-start' for THIS attempt is emitted AFTER
    // finalizeLoopFromAnswerSource's `onOutcome` (answer-source.ts :316)
    // already set verdictOutcome for this SAME attempt (see
    // useShadowLoopCoordinator.ts startEval :592-641 — 'eval-start' only
    // fires once the finalizeLoop flush has already resolved). So the
    // verdict was wiped the instant it appeared — verdictOutcome was always
    // null in practice. See the FIX A doc on handleLog in useShadowRuntime.ts.
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const src = new FakeAnswerSource({ canonicalText: 'hello world' });
    const { rt, ws, adapter } = setup({ evaluate, answerSource: src });
    const ex = makeExercise(true, true); // ON+ON — looping + grading
    act(() => { rt.current.onArm(ex); });
    expect(ws.current.looping).toBe(true);

    await act(async () => {
      adapter._setTime(10.01);
      ws.current._boundaryTickForTest();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(rt.current.verdictOutcome).not.toBeNull();
    expect(rt.current.verdictOutcome).toEqual({
      exerciseId: 'ex1',
      outcome: { status: 'final', text: 'hello world' },
    });

    render(
      React.createElement(ShadowHoldOverlay, {
        holding: rt.current.holding,
        evalVisible: rt.current.evalOverlayVisible,
        verdictOutcome: rt.current.verdictOutcome,
      }),
    );
    expect(screen.getByTestId('shadow-verdict-slot').textContent).toBe('final');
  });

  it('the NEXT loop-boundary (a fresh attempt) clears the previous verdict — still not resurrected by eval-start', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const src = new FakeAnswerSource({ canonicalText: 'hello world' });
    const { rt, ws, adapter } = setup({ evaluate, answerSource: src });
    const ex = makeExercise(true, true);
    act(() => { rt.current.onArm(ex); });

    await act(async () => {
      adapter._setTime(10.01);
      ws.current._boundaryTickForTest();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(rt.current.verdictOutcome).not.toBeNull(); // first attempt's verdict is live

    // Re-arm the SAME exercise for a second attempt — onArm's own clear
    // (unchanged by this fix) plus the FIX A 'loop-boundary' clear both
    // guard the same invariant: a NEW attempt starts with no stale verdict.
    act(() => { rt.current.onArm(ex); });
    expect(rt.current.verdictOutcome).toBeNull();
  });
});

// T7 (N2 — "снапшоти target в момент committed"): verdictTargetSnapshot is
// set in the SAME handler as verdictOutcome, off targetTextForExercise(the
// exercise this outcome belongs to) — additive coverage, does not touch any
// assertion above.
describe('useShadowRuntime — T7 (N2): verdictTargetSnapshot pairs 1:1 with verdictOutcome', () => {
  it('a final outcome carries the exercise\'s effective target text as its snapshot', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const src = new FakeAnswerSource({ canonicalText: 'hello world' });
    const { rt, ws, adapter } = setup({ evaluate, answerSource: src });
    const ex = makeExercise(true, true);
    act(() => { rt.current.onArm(ex); });

    await act(async () => {
      adapter._setTime(10.01);
      ws.current._boundaryTickForTest();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });

    expect(rt.current.verdictOutcome).not.toBeNull();
    // liveCues (module scope, `[{start:5,end:10,text_en:'hello world',...}]`)
    // resolves to this exact string via targetTextForExercise's subtitle path
    // (ex has settings.mode:'subtitle', see makeExercise).
    expect(rt.current.verdictTargetSnapshot).toBe('hello world');
  });

  it('verdictTargetSnapshot clears in lockstep with verdictOutcome on the NEXT loop-boundary/onArm', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const src = new FakeAnswerSource({ canonicalText: 'hello world' });
    const { rt, ws, adapter } = setup({ evaluate, answerSource: src });
    const ex = makeExercise(true, true);
    act(() => { rt.current.onArm(ex); });

    await act(async () => {
      adapter._setTime(10.01);
      ws.current._boundaryTickForTest();
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(rt.current.verdictTargetSnapshot).not.toBeNull();

    act(() => { rt.current.onArm(ex); }); // re-arm — a fresh attempt starting
    expect(rt.current.verdictOutcome).toBeNull();
    expect(rt.current.verdictTargetSnapshot).toBeNull();
  });
});

describe('useShadowRuntime — T3-fix FIX B [HIGH]: resumeFromHold no-ops while an eval is in flight', () => {
  it('an S-press landing in the heldRef-stale / evalInFlight window is a no-op; the same call works normally once eval resolves', async () => {
    // Controlled AnswerSource: never resolves on its own — each call's
    // resolver is captured in order so the test can settle it at the exact
    // moment it wants, independent of FakeAnswerSource's own timers.
    const resolvers: Array<(o: AnswerOutcome) => void> = [];
    const controlled: AnswerSource = {
      awaitAnswerByBoundary() {
        return new Promise<AnswerOutcome>((resolve) => { resolvers.push(resolve); });
      },
    };
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const { rt, adapter, rerender, resumeSpy } = setup({ evaluate, answerSource: controlled });
    const ex = makeExercise(false, true); // OFF+ON (G5) — same matrix cell as armAndHold

    act(() => { rt.current.onArm(ex); });
    adapter._setTime(10.05);
    await act(async () => { rerender(); await Promise.resolve(); await Promise.resolve(); });

    // First attempt resolves non-final → HOLD (mirrors armAndHold's default).
    await act(async () => {
      resolvers[0]({ status: 'no-response', reason: 'no-audio' });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(rt.current.holding).toBe(true);
    expect(rt.current.isEvalInFlight()).toBe(false);

    // Second attempt: segEndHandledRef was reset by the hold, so re-driving
    // the playhead past endTime re-fires G5 → startEval sets
    // evalInFlightRef=true SYNCHRONOUSLY (useShadowLoopCoordinator.ts :466).
    // The controlled source's promise is still pending — heldRef is STILL
    // true (only 'eval-start', which hasn't fired yet for this attempt,
    // clears it) — this is the exact window FIX B guards.
    adapter._setTime(10.06);
    act(() => { rerender(); });
    expect(rt.current.isEvalInFlight()).toBe(true); // eval#2 owns the segment now
    expect(rt.current.isHeld()).toBe(true); // stale heldRef from the FIRST hold

    resumeSpy.mockClear();
    act(() => { rt.current.resumeFromHold(); }); // simulated S-press mid-eval#2
    expect(resumeSpy).not.toHaveBeenCalled(); // FIX B: no-op — must not advance mid-eval
    expect(rt.current.holding).toBe(true); // untouched
    expect(rt.current.armedSegmentId()).toBe('ex1'); // untouched

    // Resolve eval#2 (non-final again → a fresh HOLD) — evalInFlight drops,
    // and resumeFromHold on the SAME hook instance now behaves exactly like
    // the pre-existing item-2 test (works normally once eval is no longer
    // in flight).
    await act(async () => {
      resolvers[1]({ status: 'no-response', reason: 'no-audio' });
      await Promise.resolve(); await Promise.resolve(); await Promise.resolve();
    });
    expect(rt.current.isEvalInFlight()).toBe(false);
    expect(rt.current.holding).toBe(true);

    resumeSpy.mockClear();
    act(() => { rt.current.resumeFromHold(); });
    expect(resumeSpy).toHaveBeenCalledWith('advance'); // works as before, once eval is no longer in flight
    expect(rt.current.holding).toBe(false);
  });
});
