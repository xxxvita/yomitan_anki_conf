// @vitest-environment jsdom
// T2 — useShadowLoopCoordinator on a MOCK adapter (task-T2-brief.md, required
// test item 2): arm → restoreWorkspace sets AB; outcome advance →
// resumeFromBoundary('advance'); outcome restart → resumeFromBoundary
// ('restart'); epoch guard (stale eval from a superseded loop iteration is
// dropped); mounted guard (unmount during in-flight eval must not resume on
// a dead hook). Pattern lifted from desktop's
// useShadowLoopCoordinator.reentry.test.ts / .noloop-no-seekback.test.ts
// (mock UseShadowLoopCoordinatorArgs — this file does NOT touch a real
// useWorkspace; that composition is covered separately in
// useShadowRuntime.test.ts).
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import {
  useShadowLoopCoordinator,
  type UseShadowLoopCoordinatorArgs,
  type WorkspaceSnapshot,
  type ShadowRtEvent,
} from '../useShadowLoopCoordinator';
import type { ShadowExerciseAnnotation, ShadowState } from '../../workspace/panel-types';
import type { EvaluationDecision } from '../../components/AwaitingEvaluationOverlay';

function makeExercise(
  id: string, startTime: number, endTime: number, loopMode: boolean,
): ShadowExerciseAnnotation {
  return {
    id, startTime, endTime, anchorMode: 'time-range',
    settings: {
      loopMode, advanceEnabled: true, advanceThreshold: 80,
      mode: 'subtitle', saveAudio: false,
      engines: { asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' },
      pauseAtEnd: 0,
    },
    createdAt: '2026-07-06T00:00:00Z', updatedAt: '2026-07-06T00:00:00Z',
  };
}

const IDLE_SNAP: WorkspaceSnapshot = {
  rangeStart: 0, rangeEnd: 100, viewStart: 0, viewEnd: 100,
  looping: false, pauseAtEnd: 0, active: false,
};

let ct: number;
let restoreCalls: Array<Parameters<UseShadowLoopCoordinatorArgs['restoreWorkspace']>[0]>;
let resume: ReturnType<typeof vi.fn>;
let countdown: ReturnType<typeof vi.fn>;
let deactivate: ReturnType<typeof vi.fn>;
let events: ShadowRtEvent[];
let snap: WorkspaceSnapshot;

function buildArgs(
  ex: ShadowExerciseAnnotation,
  evaluate: UseShadowLoopCoordinatorArgs['evaluate'],
): UseShadowLoopCoordinatorArgs {
  return {
    currentTime: ct,
    getCurrentTime: () => ct,
    getExercises: () => [ex],
    getShadowState: () => ({ active: true } as unknown as ShadowState),
    getWorkspaceSnapshot: () => snap,
    restoreWorkspace: (p) => { restoreCalls.push(p); },
    resumeFromBoundary: resume,
    deactivateWorkspace: deactivate,
    seek: vi.fn(),
    countdownThenPlay: countdown,
    pauseVideo: vi.fn(),
    archiveShadowLoop: () => ({ text: 'hello', matchPct: 0 }),
    evaluate,
    targetTextForExercise: () => 'hello world',
    evalIdForExercise: (e) => e.id,
    log: (e) => events.push(e),
  };
}

beforeEach(() => {
  ct = 0;
  restoreCalls = [];
  resume = vi.fn();
  countdown = vi.fn();
  deactivate = vi.fn();
  events = [];
  snap = IDLE_SNAP;
});

describe('useShadowLoopCoordinator — onArm sets AB via restoreWorkspace', () => {
  it('onArm calls restoreWorkspace with the exercise range + trustExtent + countdownThenPlay on FIRST arm', () => {
    const ex = makeExercise('ex1', 5, 10, true);
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 90 } as never));
    const { result } = renderHook(() => useShadowLoopCoordinator(buildArgs(ex, evaluate)));

    ct = 5;
    act(() => { result.current.onArm(ex); });

    expect(restoreCalls.length).toBe(1);
    expect(restoreCalls[0].rangeStart).toBe(5);
    expect(restoreCalls[0].rangeEnd).toBe(10);
    expect(restoreCalls[0].looping).toBe(true); // loopMode:true
    expect(restoreCalls[0].trustExtent).toBe(true);
    expect(countdown).toHaveBeenCalledTimes(1); // first arm → отсчёт
    expect(result.current.armedSegmentId()).toBe('ex1');
  });

  it('re-arm of the SAME exercise (jsdom re-entry artefact) does NOT re-countdown', () => {
    const ex = makeExercise('ex1', 5, 10, true);
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 90 } as never));
    const { result } = renderHook(() => useShadowLoopCoordinator(buildArgs(ex, evaluate)));
    ct = 5;
    act(() => { result.current.onArm(ex); });
    act(() => { result.current.onArm(ex); }); // same id → re-arm, not first arm
    expect(countdown).toHaveBeenCalledTimes(1);
  });
});

describe('useShadowLoopCoordinator — outcome routes resumeFromBoundary correctly', () => {
  it('pass (score ≥ threshold) on a LOOPING grading exercise → resumeFromBoundary("advance")', async () => {
    const ex = makeExercise('ex1', 5, 10, true);
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 90 } as never));
    const { result } = renderHook(() => useShadowLoopCoordinator(buildArgs(ex, evaluate)));
    ct = 5;
    act(() => { result.current.onArm(ex); });
    ct = 10;
    await act(async () => {
      result.current.onLoopBoundary();
      await Promise.resolve(); await Promise.resolve();
    });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith('advance');
    expect(events.some(e => e.event === 'advance')).toBe(true);
  });

  it('retry (score < threshold) on a LOOPING grading exercise → resumeFromBoundary("restart")', async () => {
    const ex = makeExercise('ex1', 5, 10, true);
    const evaluate = vi.fn(async () => ({ decision: 'retry', score: 10 } as never));
    const { result } = renderHook(() => useShadowLoopCoordinator(buildArgs(ex, evaluate)));
    ct = 5;
    act(() => { result.current.onArm(ex); });
    ct = 10;
    await act(async () => {
      result.current.onLoopBoundary();
      await Promise.resolve(); await Promise.resolve();
    });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenCalledWith('restart');
    expect(events.some(e => e.event === 'restart')).toBe(true);
    // Still armed on the same exercise — a restart does not end the run.
    expect(result.current.armedSegmentId()).toBe('ex1');
  });

  it('advance on the LAST exercise (nothing ahead) → endRun(complete) restores the pre-run snapshot', async () => {
    snap = { rangeStart: 0, rangeEnd: 2, viewStart: 0, viewEnd: 100, looping: false, pauseAtEnd: 0, active: true };
    const ex = makeExercise('ex1', 5, 10, true);
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 90 } as never));
    const { result } = renderHook(() => useShadowLoopCoordinator(buildArgs(ex, evaluate)));
    ct = 5;
    act(() => { result.current.onArm(ex); });
    restoreCalls = []; // drop the onArm restoreWorkspace call — only care about endRun's
    ct = 10;
    await act(async () => {
      result.current.onLoopBoundary();
      await Promise.resolve(); await Promise.resolve();
    });
    expect(events.some(e => e.event === 'complete')).toBe(true);
    // active:true snapshot → restoreWorkspace (not deactivateWorkspace).
    expect(restoreCalls.length).toBe(1);
    expect(deactivate).not.toHaveBeenCalled();
    expect(result.current.armedSegmentId()).toBeNull();
  });
});

describe('useShadowLoopCoordinator — epoch guard (Ф2 loopSeqRef)', () => {
  it('a stale eval from a superseded loop iteration is dropped — resume called exactly once', async () => {
    const ex = makeExercise('ex1', 5, 10, true);
    // Two in-flight evals: the FIRST resolves LAST (after the second one),
    // simulating a late-arriving stale finalize from a previous iteration.
    const resolvers: Array<(v: EvaluationDecision) => void> = [];
    const evaluate = vi.fn(() => new Promise<EvaluationDecision>((res) => { resolvers.push(res); }));
    const { result } = renderHook(() => useShadowLoopCoordinator(buildArgs(ex, evaluate)));
    ct = 5;
    act(() => { result.current.onArm(ex); });

    // First boundary hit → eval #1 starts (epoch 1).
    ct = 10;
    act(() => { result.current.onLoopBoundary(); });
    expect(resolvers.length).toBe(1);

    // Resolve eval #1 as a RETRY → resume('restart'), re-armed same exercise, epoch bumps.
    await act(async () => { resolvers[0]({ decision: 'retry', score: 10, source: 'standard' }); await Promise.resolve(); await Promise.resolve(); });
    expect(resume).toHaveBeenCalledTimes(1);
    expect(resume).toHaveBeenLastCalledWith('restart');

    // Second boundary hit → eval #2 starts (epoch 2).
    ct = 10;
    act(() => { result.current.onLoopBoundary(); });
    expect(resolvers.length).toBe(2);
    await act(async () => { resolvers[1]({ decision: 'pass', score: 95, source: 'standard' }); await Promise.resolve(); await Promise.resolve(); });
    expect(resume).toHaveBeenCalledTimes(2);
    expect(resume).toHaveBeenLastCalledWith('advance');
  });
});

describe('useShadowLoopCoordinator — mounted guard', () => {
  it('unmounting while an eval is in flight: the eventual resolution does NOT call resume on the dead hook', async () => {
    const ex = makeExercise('ex1', 5, 10, true);
    let resolveEval!: (v: EvaluationDecision) => void;
    const evaluate = vi.fn(() => new Promise<EvaluationDecision>((res) => { resolveEval = res; }));
    const { result, unmount } = renderHook(() => useShadowLoopCoordinator(buildArgs(ex, evaluate)));
    ct = 5;
    act(() => { result.current.onArm(ex); });
    ct = 10;
    act(() => { result.current.onLoopBoundary(); });
    expect(result.current.isEvalInFlight()).toBe(true);

    unmount();
    await act(async () => {
      resolveEval({ decision: 'pass', score: 95, source: 'standard' });
      await Promise.resolve(); await Promise.resolve();
    });
    expect(resume).not.toHaveBeenCalled();
    expect(deactivate).not.toHaveBeenCalled();
  });
});
