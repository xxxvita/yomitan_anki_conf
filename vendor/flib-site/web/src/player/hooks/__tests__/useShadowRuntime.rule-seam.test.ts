// @vitest-environment jsdom
// useShadowRuntime.rule-seam.test.ts — D2 seam (task T-RULE): proves
// `onRuleDecision` fires with the correct matrix cell (audit/18) on every
// native A-B loop-boundary exit, WITHOUT changing what actually happens to
// the loop (advance/restart/hold stays entirely the coordinator's call,
// unwrapped/unchanged — see useShadowLoopCoordinator.ts). Mirrors the wiring
// pattern + fake adapter already established in useShadowRuntime.test.ts;
// kept in its own file so this task doesn't touch that green suite.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkspace } from '../useWorkspace';
import { useShadowRuntime, type ShadowRuntimeWorkspaceActuators } from '../useShadowRuntime';
import type { RuleDecision } from '../../workspace/loop-rule';
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

function setup(evaluate: ReturnType<typeof vi.fn>, onRuleDecision?: (d: RuleDecision, exId: string) => void) {
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
      onRuleDecision,
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

  return { adapter, rt, ws };
}

afterEach(() => { vi.useRealTimers(); });

describe('useShadowRuntime — D2 seam: onRuleDecision fires on A-B loop-boundary exit', () => {
  it('ON+ON (loop + grading, retry verdict): decision fires with cell ON+ON, and coordinator restart is unaffected', async () => {
    const decisions: { decision: RuleDecision; exId: string }[] = [];
    const evaluate = vi.fn(async () => ({ decision: 'retry', score: 10 } as never));
    const { rt, ws, adapter } = setup(evaluate, (decision, exId) => decisions.push({ decision, exId }));
    const ex = makeExercise(true, true);
    act(() => { rt.current.onArm(ex); });
    expect(ws.current.looping).toBe(true);

    await act(async () => {
      adapter._setTime(10.01);
      ws.current._boundaryTickForTest();
      await Promise.resolve(); await Promise.resolve();
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0].exId).toBe('ex1');
    expect(decisions[0].decision.cell).toBe('ON+ON');
    expect(decisions[0].decision.advanceThreshold).toBe(80);
    expect(decisions[0].decision.form).toBe('playhead-range');
    // Unchanged coordinator behaviour: retry verdict on a looping exercise
    // still restarts the loop (seek(A)+play) exactly as without the seam.
    expect(ws.current.looping).toBe(true);
  });

  it('ON+OFF (loop, no grading): decision fires with cell ON+OFF on the native restart, movement unaffected', () => {
    const decisions: { decision: RuleDecision; exId: string }[] = [];
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 90 } as never));
    const { rt, ws, adapter } = setup(evaluate, (decision, exId) => decisions.push({ decision, exId }));
    const ex = makeExercise(true, false); // loopMode:true, NOT grading → native restart path
    act(() => { rt.current.onArm(ex); });
    expect(ws.current.looping).toBe(true);

    act(() => { adapter._setTime(10.01); ws.current._boundaryTickForTest(); });

    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision.cell).toBe('ON+OFF');
    expect(decisions[0].decision.advanceThreshold).toBeUndefined();
    // Unchanged: non-grading loop still takes the native restart path.
    expect(ws.current.looping).toBe(true);
  });

  it('advance (pass verdict, nothing ahead): decision still fires once for the exit that led to it, and advance is unaffected', async () => {
    const decisions: { decision: RuleDecision; exId: string }[] = [];
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const { rt, ws, adapter } = setup(evaluate, (decision, exId) => decisions.push({ decision, exId }));
    const ex = makeExercise(true, true);
    act(() => { rt.current.onArm(ex); });

    await act(async () => {
      adapter._setTime(10.01);
      ws.current._boundaryTickForTest();
      await Promise.resolve(); await Promise.resolve();
    });

    expect(decisions).toHaveLength(1);
    expect(decisions[0].decision.cell).toBe('ON+ON');
    // Unchanged: pass verdict + nothing ahead still snaps the loop and ends
    // the run (advance/endRun) exactly as without the seam.
    expect(ws.current.looping).toBe(false);
  });

  it('no armed exercise (ambient/unrelated loop boundary): onRuleDecision is NOT called', () => {
    const decisions: { decision: RuleDecision; exId: string }[] = [];
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 90 } as never));
    const { ws, adapter } = setup(evaluate, (decision, exId) => decisions.push({ decision, exId }));
    // No onArm at all — an ambient AB loop set directly on the workspace,
    // unrelated to any shadow exercise (mirrors useShadowRuntime.test.ts's
    // "pre-existing wide active loop" scenario after a run ends).
    act(() => { ws.current.setABLoop(0, 100); });
    expect(ws.current.looping).toBe(true);

    act(() => { adapter._setTime(100.01); ws.current._boundaryTickForTest(); });

    expect(decisions).toHaveLength(0);
  });
});
