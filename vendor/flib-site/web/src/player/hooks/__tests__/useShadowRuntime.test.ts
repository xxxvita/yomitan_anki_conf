// @vitest-environment jsdom
// T2 — useShadowRuntime composition test: the REAL wiring loop (T0's
// useWorkspace ⇄ the lifted useShadowLoopCoordinator via this hook), driven
// through a fake adapter — not mocked actuators. Covers:
//   - onArm → restoreWorkspace (via the guarded bridge) actually sets the
//     real useWorkspace AB range.
//   - onLoopRestart → recorder rearm (T2-carry a), on BOTH restart paths:
//     native (non-grading) restart AND resumeFromBoundary('restart') (retry
//     verdict on a grading exercise).
// The batch-trap fix itself (guardedRestoreWorkspace) is unit-tested in
// restore-batch-guard.test.ts; this file proves useShadowRuntime actually
// USES that guard for its restoreWorkspace bridge (not re-deriving the whole
// hazard again).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkspace } from '../useWorkspace';
import { useShadowRuntime, type ShadowRuntimeWorkspaceActuators } from '../useShadowRuntime';
import { makeFakeAdapter } from '../../../adapter/__tests__/fake';
import type { Cue as LiveCue } from '../useSubtitles';
import type { ShadowExerciseAnnotation, ShadowState } from '../../workspace/panel-types';

function makeExercise(loopMode: boolean, grading: boolean): ShadowExerciseAnnotation {
  return {
    id: 'ex1', startTime: 5, endTime: 10, anchorMode: 'time-range',
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

function setup(
  evaluate: ReturnType<typeof vi.fn>,
  recorder = { start: vi.fn() },
  log?: (e: { event: string }) => void,
) {
  const adapter = makeFakeAdapter({ t: 5 });
  const wsActuatorsRef: React.MutableRefObject<ShadowRuntimeWorkspaceActuators | null> = { current: null };

  const { result: rt, unmount: unmountRt } = renderHook(() =>
    useShadowRuntime({
      videoId: 'v1',
      liveCues,
      currentTime: adapter.currentTime(),
      getCurrentTime: () => adapter.currentTime(),
      getShadowState: () => ({ active: true } as unknown as ShadowState),
      wsActuatorsRef,
      seek: adapter.seek,
      pauseVideo: adapter.pause,
      evaluate,
      recorder,
      log,
    }),
  );

  const { result: ws } = renderHook(() =>
    useWorkspace(adapter, [{ start: 5, end: 10 }], 'v1', false,
      rt.current.onLoopBoundary, rt.current.shouldPauseAtBoundary, rt.current.onLoopRestart),
  );

  act(() => {
    wsActuatorsRef.current = {
      restoreWorkspace: ws.current.restoreWorkspace,
      resumeFromBoundary: ws.current.resumeFromBoundary,
      deactivateWorkspace: ws.current.deactivateWorkspace,
      countdownThenPlay: ws.current.countdownThenPlay,
      getWorkspaceSnapshot: ws.current.getWorkspaceSnapshot,
    };
  });

  return { adapter, rt, ws, recorder, evaluate, unmountRt };
}

afterEach(() => { vi.useRealTimers(); });

describe('useShadowRuntime — wiring loop: onArm sets the REAL useWorkspace AB range', () => {
  it('restoreWorkspace bridge applies the exercise range to useWorkspace', () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 90 } as never));
    const { rt, ws } = setup(evaluate);
    const ex = makeExercise(true, true);
    act(() => { rt.current.onArm(ex); });
    expect(ws.current.rangeStart).toBe(5);
    expect(ws.current.rangeEnd).toBe(10);
    expect(ws.current.looping).toBe(true);
  });
});

describe('useShadowRuntime — onLoopRestart → recorder rearm (T2-carry a)', () => {
  it('native restart (non-grading loop) rearms the recorder', () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 90 } as never));
    const { rt, ws, adapter, recorder } = setup(evaluate);
    const ex = makeExercise(true, false); // loopMode:true, NOT grading → native restart path
    act(() => { rt.current.onArm(ex); });
    expect(ws.current.looping).toBe(true);

    recorder.start.mockClear();
    act(() => { adapter._setTime(10.01); ws.current._boundaryTickForTest(); });
    // Non-grading → useWorkspace takes the native seek(A)+play restart path,
    // firing onLoopRestart synchronously (pauseAtEnd:0 → immediate resume()).
    expect(recorder.start).toHaveBeenCalledTimes(1);
  });

  it('resumeFromBoundary("restart") (grading retry verdict) rearms the recorder', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'retry', score: 10 } as never));
    const { rt, ws, adapter, recorder } = setup(evaluate);
    const ex = makeExercise(true, true); // loopMode:true + grading → parks, coordinator decides
    act(() => { rt.current.onArm(ex); });
    expect(ws.current.looping).toBe(true);

    recorder.start.mockClear();
    await act(async () => {
      adapter._setTime(10.01);
      ws.current._boundaryTickForTest(); // parks at B, coordinator.onLoopBoundary fires, eval starts
      await Promise.resolve(); await Promise.resolve();
    });
    // retry verdict on a looping exercise → coordinator calls
    // resumeFromBoundary('restart') → useWorkspace seeks(A)+plays → onLoopRestart.
    expect(recorder.start).toHaveBeenCalledTimes(1);
  });

  it('advance (pass verdict) does NOT rearm the recorder (no restart happens)', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const { rt, ws, adapter, recorder } = setup(evaluate);
    const ex = makeExercise(true, true);
    act(() => { rt.current.onArm(ex); });

    recorder.start.mockClear();
    await act(async () => {
      adapter._setTime(10.01);
      ws.current._boundaryTickForTest();
      await Promise.resolve(); await Promise.resolve();
    });
    expect(recorder.start).not.toHaveBeenCalled();
  });
});

describe('useShadowRuntime — full-stack batch-trap (T2-carry b), end to end', () => {
  it('a run that started with a pre-existing wide active loop restores it after advance+endRun, and its border re-enforces (not stuck)', async () => {
    vi.useFakeTimers(); // installed before the guarded restore's setTimeout(0) is scheduled
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const events: { event: string }[] = [];
    const { rt, ws, adapter } = setup(evaluate, { start: vi.fn() }, (e) => events.push(e));

    // Pre-existing wide loop the run "started with" (captured as the
    // coordinator's pre-run snapshot on the FIRST onArm below).
    act(() => { ws.current.setABLoop(0, 100); });
    expect(ws.current.looping).toBe(true);

    const ex = makeExercise(true, true); // grading + looping
    act(() => { rt.current.onArm(ex); }); // snapshot = {rangeStart:0,rangeEnd:100,looping:true,active:true}
    expect(ws.current.rangeStart).toBe(5); // armed onto the exercise's own AB now

    await act(async () => {
      adapter._setTime(10.01);
      ws.current._boundaryTickForTest(); // parks, coordinator evaluates
      await Promise.resolve(); await Promise.resolve();
    });
    // pass + nothing ahead → advance + endRun(complete): resumeFromBoundary
    // ('advance') THEN (same synchronous coordinator call) restoreWorkspace
    // with the pre-run snapshot (looping:true, since ct=10.01 is inside [0,100)).
    expect(events.some(e => e.event === 'complete')).toBe(true);
    expect(ws.current.looping).toBe(false); // NOT yet — the restore is deferred (guarded)

    act(() => { vi.advanceTimersByTime(0); });
    expect(ws.current.looping).toBe(true); // restored: the wide [0,100] loop is back
    expect(ws.current.rangeStart).toBe(0);
    expect(ws.current.rangeEnd).toBe(100);

    // Drive the RESTORED loop's own border — if boundarySuppressRef had stuck
    // true (the un-guarded hazard), this would silently no-op forever.
    const loopBoundaryCountBefore = events.filter(e => e.event === 'loop-boundary').length;
    act(() => { adapter._setTime(100.01); ws.current._boundaryTickForTest(); });
    expect(events.filter(e => e.event === 'loop-boundary').length).toBe(loopBoundaryCountBefore + 1);
  });
});

// T2-fix (audit CONFIRMED part b) — pending guarded-restore cancellation.
// restore-batch-guard.test.ts unit-tests the staleness re-check itself; this
// covers useShadowRuntime's OWN bookkeeping (pendingRestoreCancelRef) that
// wires cancel() into unmount and into every new restoreWorkspace call.
describe('useShadowRuntime — pending restore cancellation (T2-fix)', () => {
  it('cancel on unmount: a deferred restore scheduled before teardown does not apply afterward', async () => {
    vi.useFakeTimers();
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const { rt, ws, adapter, unmountRt } = setup(evaluate);

    act(() => { ws.current.setABLoop(0, 100); });
    expect(ws.current.looping).toBe(true);

    const ex = makeExercise(true, true);
    act(() => { rt.current.onArm(ex); }); // snapshot = {0,100,looping:true,active:true}
    expect(ws.current.rangeStart).toBe(5);

    await act(async () => {
      adapter._setTime(10.01);
      ws.current._boundaryTickForTest(); // parks, coordinator evaluates
      await Promise.resolve(); await Promise.resolve();
    });
    // pass + nothing ahead → advance + endRun(complete): the pre-run
    // snapshot's restore (looping:true) is deferred, not applied yet.
    expect(ws.current.looping).toBe(false);

    act(() => { unmountRt(); }); // tear down the runtime BEFORE the macrotask fires

    act(() => { vi.advanceTimersByTime(0); });
    // Cancelled by unmount — the wide [0,100] loop is NOT resurrected on a
    // workspace whose runtime no longer exists.
    expect(ws.current.looping).toBe(false);
  });

  it('a new onArm within the defer window cancels the previous run\'s pending restore', async () => {
    vi.useFakeTimers();
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const { rt, ws, adapter } = setup(evaluate);

    act(() => { ws.current.setABLoop(0, 100); });
    const ex = makeExercise(true, true);
    act(() => { rt.current.onArm(ex); });
    expect(ws.current.rangeStart).toBe(5);

    await act(async () => {
      adapter._setTime(10.01);
      ws.current._boundaryTickForTest();
      await Promise.resolve(); await Promise.resolve();
    });
    expect(ws.current.looping).toBe(false); // endRun's restore of the wide loop is deferred

    // Before that macrotask fires, a SECOND exercise is armed — supersedes
    // whatever restore was still pending from the first run.
    const ex2: ShadowExerciseAnnotation = { ...ex, id: 'ex2', startTime: 20, endTime: 25 };
    act(() => { rt.current.onArm(ex2); });
    expect(ws.current.rangeStart).toBe(20);
    expect(ws.current.looping).toBe(true);

    act(() => { vi.advanceTimersByTime(0); });
    // The stale restore (which would have reinstated the [0,100] loop) was
    // cancelled — the NEW arm's range/looping is untouched by it.
    expect(ws.current.rangeStart).toBe(20);
    expect(ws.current.rangeEnd).toBe(25);
    expect(ws.current.looping).toBe(true);
  });
});

// T2-fix (audit LIGHT — ref-fill hardening, FIX2): a premature onArm (fired
// before the CALLER has populated wsActuatorsRef) must surface a warning
// instead of a silent optional-chain no-op — the coordinator has already
// mutated its own internal arm-state by the time it reaches these wrappers.
describe('useShadowRuntime — ref-fill hardening warns instead of silently dropping (T2-fix)', () => {
  it('onArm before wsActuatorsRef is populated warns via console.warn', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const evaluate = vi.fn(async () => ({ decision: 'pass', score: 90 } as never));
      const adapter = makeFakeAdapter({ t: 5 });
      const wsActuatorsRef: React.MutableRefObject<ShadowRuntimeWorkspaceActuators | null> = { current: null };
      const { result: rt } = renderHook(() =>
        useShadowRuntime({
          videoId: 'v1',
          liveCues,
          currentTime: adapter.currentTime(),
          getCurrentTime: () => adapter.currentTime(),
          getShadowState: () => ({ active: true } as unknown as ShadowState),
          wsActuatorsRef,
          seek: adapter.seek,
          pauseVideo: adapter.pause,
          evaluate,
        }),
      );
      const ex = makeExercise(true, true);
      // wsActuatorsRef.current is STILL null here — the caller hasn't wired
      // up useWorkspace's actuators yet.
      expect(() => act(() => { rt.current.onArm(ex); })).not.toThrow();
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('restoreWorkspace called before wsActuatorsRef'),
        expect.anything(),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
