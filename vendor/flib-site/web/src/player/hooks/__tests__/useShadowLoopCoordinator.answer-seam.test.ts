// @vitest-environment jsdom
// T-ANS — behavioural tests: FakeAnswerSource wired into the coordinator's
// `finalizeLoop` slot via `finalizeLoopFromAnswerSource` (answer-source.ts),
// on a MOCK adapter (same pattern as useShadowLoopCoordinator.test.ts — this
// file does NOT touch a real useWorkspace). Covers the answer-seam contract
// (docs/superpowers/specs/2026-07-06-shadowing-answer-seam-contract.md):
//   1. each of the 5 outcomes → correct matrix reaction (final → advance-
//      eligible scoring path; no-response/error/non-final/timeout → "порог
//      не достигнут": restart-loop on ON+ON, hold-and-wait on OFF+ON).
//   2. timeout at EXACTLY budgetMs=3000 (fake-timers: 2999ms still waiting,
//      3000ms resolves) — the coordinator is not blocked past it.
//   3. non-final never reaches the scoring `evaluate` fn (no false 0%,
//      no painted-committed — the "не красим committed" flag for T7).
//   4. verdictHold invariant: no outcome ever leaves evalInFlight stuck true
//      without a decisive event (advance/restart/hold).
//   5. FakeAnswerSource forces each outcome deterministically (exercised via
//      setForced/forceOnce, unit-tested standalone in answer-source.test.ts).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useShadowLoopCoordinator,
  type UseShadowLoopCoordinatorArgs,
  type WorkspaceSnapshot,
  type ShadowRtEvent,
} from '../useShadowLoopCoordinator';
import type { ShadowExerciseAnnotation, ShadowState } from '../../workspace/panel-types';
import {
  FakeAnswerSource,
  finalizeLoopFromAnswerSource,
  DEFAULT_ANSWER_BUDGET_MS,
  type AnswerOutcome,
} from '../../workspace/answer-source';

function makeExercise(loopMode: boolean): ShadowExerciseAnnotation {
  return {
    id: 'ex1', startTime: 5, endTime: 10, anchorMode: 'time-range',
    settings: {
      loopMode, advanceEnabled: true, advanceThreshold: 80,
      mode: 'subtitle', saveAudio: false,
      engines: { asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' },
      pauseAtEnd: 0,
    },
    createdAt: '2026-07-06T00:00:00Z', updatedAt: '2026-07-06T00:00:00Z',
  };
}

const SNAP: WorkspaceSnapshot = {
  rangeStart: 0, rangeEnd: 100, viewStart: 0, viewEnd: 100,
  looping: false, pauseAtEnd: 0, active: false,
};

let resume: ReturnType<typeof vi.fn>;
let evaluate: ReturnType<typeof vi.fn>;
let events: ShadowRtEvent[];
let liveTime: number;

function buildArgs(
  ex: ShadowExerciseAnnotation,
  currentTime: number,
  answerSource: FakeAnswerSource,
): UseShadowLoopCoordinatorArgs {
  return {
    currentTime,
    getCurrentTime: () => liveTime,
    getExercises: () => [ex],
    getShadowState: () => ({ active: true } as unknown as ShadowState),
    getWorkspaceSnapshot: () => SNAP,
    restoreWorkspace: vi.fn(),
    resumeFromBoundary: resume,
    deactivateWorkspace: vi.fn(),
    seek: vi.fn(),
    countdownThenPlay: vi.fn(),
    pauseVideo: vi.fn(),
    // Legacy attempt-buffer stub — irrelevant once finalizeLoop is wired
    // (startEval never reads it on that branch), still called unconditionally.
    archiveShadowLoop: () => null,
    evaluate,
    // Answer-seam (T-ANS): the slot under test.
    finalizeLoop: finalizeLoopFromAnswerSource(answerSource, () => ex.id, DEFAULT_ANSWER_BUDGET_MS),
    targetTextForExercise: () => 'hello world',
    evalIdForExercise: (e) => e.id,
    log: (e) => events.push(e),
  };
}

beforeEach(() => {
  resume = vi.fn();
  events = [];
  evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
});

describe('answer-seam — final outcome scores normally (ON+ON, looping+grading)', () => {
  it('final text → evaluate is called with it → pass ≥ threshold → advance', async () => {
    const ex = makeExercise(true);
    const src = new FakeAnswerSource({ canonicalText: 'hello world' });
    liveTime = 10;
    const { result } = renderHook(() => useShadowLoopCoordinator(buildArgs(ex, 6, src)));
    await act(async () => { result.current.onArm(ex); });
    await act(async () => {
      result.current.onLoopBoundary();
      await Promise.resolve(); await Promise.resolve();
    });

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[0][0]).toMatchObject({ answer: 'hello world', target: 'hello world' });
    expect(resume).toHaveBeenCalledWith('advance');
    expect(events.some(e => e.event === 'advance')).toBe(true);
    expect(result.current.isEvalInFlight()).toBe(false); // verdictHold invariant: not stuck
  });

  it('final text with a low score → evaluate called → retry → restart (loop repeats, shown result)', async () => {
    evaluate = vi.fn(async () => ({ decision: 'retry', score: 10 } as never));
    const ex = makeExercise(true);
    const src = new FakeAnswerSource({ canonicalText: 'wrong answer' });
    liveTime = 10;
    const { result } = renderHook(() => useShadowLoopCoordinator(buildArgs(ex, 6, src)));
    await act(async () => { result.current.onArm(ex); });
    await act(async () => {
      result.current.onLoopBoundary();
      await Promise.resolve(); await Promise.resolve();
    });

    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith('restart');
    expect(events.some(e => e.event === 'restart')).toBe(true);
    expect(result.current.armedSegmentId()).toBe('ex1'); // still armed — loop repeats
    expect(result.current.isEvalInFlight()).toBe(false);
  });
});

describe('answer-seam — non-final outcomes on ON+ON (looping+grading): "порог не достигнут" → restart', () => {
  const nonFinal: [string, AnswerOutcome][] = [
    ['no-response(no-connection)', { status: 'no-response', reason: 'no-connection' }],
    ['no-response(no-audio)', { status: 'no-response', reason: 'no-audio' }],
    ['error', { status: 'error', reason: 'gateway 502' }],
    ['non-final', { status: 'non-final', partial: 'hel' }],
  ];

  for (const [label, outcome] of nonFinal) {
    it(`${label} → evaluate NEVER called, loop restarts (shown result = restart, not stuck)`, async () => {
      const ex = makeExercise(true); // ON+ON
      const src = new FakeAnswerSource();
      src.setForced(outcome);
      liveTime = 10;
      const { result } = renderHook(() => useShadowLoopCoordinator(buildArgs(ex, 6, src)));
      await act(async () => { result.current.onArm(ex); });
      await act(async () => {
        result.current.onLoopBoundary();
        await Promise.resolve(); await Promise.resolve();
      });

      // "не красим committed" (T7 flag): no score was ever computed for a
      // non-final outcome — scoring is never invoked.
      expect(evaluate).not.toHaveBeenCalled();
      expect(resume).toHaveBeenCalledWith('restart');
      expect(events.some(e => e.event === 'restart')).toBe(true);
      expect(events.some(e => e.event === 'advance')).toBe(false);
      expect(result.current.armedSegmentId()).toBe('ex1'); // loop kept armed
      expect(result.current.isEvalInFlight()).toBe(false); // verdictHold: not stuck
    });
  }
});

describe('answer-seam — non-final outcomes on OFF+ON (non-looping+grading, G5): "стоять-ждать" → hold', () => {
  // 'timeout' is deliberately NOT in this immediate-resolution list —
  // FakeAnswerSource honours the budget for real (see class doc) and only
  // resolves after budgetMs elapses; its OFF+ON hold behaviour is covered
  // with fake-timers in the describe block below instead.
  const nonFinal: [string, AnswerOutcome][] = [
    ['no-response', { status: 'no-response', reason: 'no-connection' }],
    ['error', { status: 'error', reason: 'boom' }],
    ['non-final', { status: 'non-final', partial: 'hel' }],
  ];

  for (const [label, outcome] of nonFinal) {
    it(`${label} → HOLD (resume NOT called, arm survives, shown result = hold)`, async () => {
      const ex = makeExercise(false); // OFF (no loop)
      const src = new FakeAnswerSource();
      src.setForced(outcome);
      liveTime = 6;
      const { result, rerender } = renderHook(
        ({ t }: { t: number }) => useShadowLoopCoordinator(buildArgs(ex, t, src)),
        { initialProps: { t: 6 } },
      );
      await act(async () => { result.current.onArm(ex); });
      liveTime = 10.05;
      await act(async () => { rerender({ t: 10.05 }); }); // G5 sees playhead past endTime
      await act(async () => { await Promise.resolve(); await Promise.resolve(); });

      expect(evaluate).not.toHaveBeenCalled();
      expect(resume).not.toHaveBeenCalled(); // HOLD: no seek, no advance
      expect(events.some(e => e.event === 'hold')).toBe(true);
      expect(events.some(e => e.event === 'restart')).toBe(false);
      expect(events.some(e => e.event === 'advance')).toBe(false);
      expect(result.current.armedSegmentId()).toBe('ex1'); // still armed, UI can show "нет ответа"
      expect(result.current.isEvalInFlight()).toBe(false); // verdictHold: not stuck
    });
  }
});

describe('answer-seam — timeout honours the fixed 3000ms budget exactly (fake-timers)', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('at 2999ms the loop is still waiting; at 3000ms it resolves to a decisive event', async () => {
    const ex = makeExercise(true); // ON+ON: non-final ⇒ restart
    const src = new FakeAnswerSource();
    src.setForced({ status: 'timeout', partial: 'hel' });
    liveTime = 10;
    const { result } = renderHook(() => useShadowLoopCoordinator(buildArgs(ex, 6, src)));
    await act(async () => { result.current.onArm(ex); });

    await act(async () => { result.current.onLoopBoundary(); });
    expect(result.current.isEvalInFlight()).toBe(true); // eval in flight, waiting on the budget

    await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
    expect(result.current.isEvalInFlight()).toBe(true); // NOT resolved yet at budgetMs-1
    expect(events.some(e => e.event === 'restart')).toBe(false);
    expect(resume).not.toHaveBeenCalled();

    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); // exactly 3000ms total
    expect(events.some(e => e.event === 'restart')).toBe(true); // now resolved → shown result
    expect(resume).toHaveBeenCalledWith('restart');
    expect(result.current.isEvalInFlight()).toBe(false); // coordinator not blocked past the budget
  });

  it('OFF+ON (non-looping+grading, G5): timeout at 3000ms → HOLD, not stuck', async () => {
    const ex = makeExercise(false); // OFF (no loop)
    const src = new FakeAnswerSource();
    src.setForced({ status: 'timeout', partial: 'hel' });
    liveTime = 6;
    const { result, rerender } = renderHook(
      ({ t }: { t: number }) => useShadowLoopCoordinator(buildArgs(ex, t, src)),
      { initialProps: { t: 6 } },
    );
    await act(async () => { result.current.onArm(ex); });
    liveTime = 10.05;
    await act(async () => { rerender({ t: 10.05 }); }); // G5 sees playhead past endTime
    expect(result.current.isEvalInFlight()).toBe(true);

    await act(async () => { await vi.advanceTimersByTimeAsync(2999); });
    expect(result.current.isEvalInFlight()).toBe(true); // not resolved yet
    expect(events.some(e => e.event === 'hold')).toBe(false);

    await act(async () => { await vi.advanceTimersByTimeAsync(1); }); // exactly 3000ms total
    expect(evaluate).not.toHaveBeenCalled();
    expect(resume).not.toHaveBeenCalled();
    expect(events.some(e => e.event === 'hold')).toBe(true);
    expect(result.current.armedSegmentId()).toBe('ex1');
    expect(result.current.isEvalInFlight()).toBe(false); // verdictHold: not stuck
  });
});
