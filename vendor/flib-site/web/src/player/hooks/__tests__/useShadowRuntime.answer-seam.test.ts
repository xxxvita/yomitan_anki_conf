// @vitest-environment jsdom
// T-ANS — useShadowRuntime wiring test: proves the composition layer (not
// just the coordinator in isolation, see useShadowLoopCoordinator.answer-
// seam.test.ts) actually threads `answerSource` through to the coordinator's
// `finalizeLoop` slot with the RIGHT exerciseId (the currently armed
// exercise, read lazily via armedExerciseIdRef — see useShadowRuntime.ts)
// and the fixed 3000ms default budget, and that `onAnswerOutcome` (the
// WEB-SEAM: outcome render → T3/T7 attachment point) actually fires.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkspace } from '../useWorkspace';
import { useShadowRuntime, type ShadowRuntimeWorkspaceActuators } from '../useShadowRuntime';
import { makeFakeAdapter } from '../../../adapter/__tests__/fake';
import type { Cue as LiveCue } from '../useSubtitles';
import type { ShadowExerciseAnnotation, ShadowState } from '../../workspace/panel-types';
import {
  FakeAnswerSource,
  DEFAULT_ANSWER_BUDGET_MS,
  type AnswerOutcomeEvent,
} from '../../workspace/answer-source';

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

function setup(evaluate: ReturnType<typeof vi.fn>, answerSource: FakeAnswerSource, onAnswerOutcome?: (e: AnswerOutcomeEvent) => void) {
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
      answerSource,
      onAnswerOutcome,
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

describe('useShadowRuntime — answer-seam wiring (T-ANS)', () => {
  it('final outcome: answerSource is called with the ARMED exercise id + the fixed 3000ms default budget, and its text reaches `evaluate`', async () => {
    const evaluate: ReturnType<typeof vi.fn> = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const src = new FakeAnswerSource({ canonicalText: 'hello world' });
    const { rt, ws, adapter } = setup(evaluate, src);
    const ex = makeExercise(true, true);
    act(() => { rt.current.onArm(ex); });
    expect(ws.current.looping).toBe(true);

    await act(async () => {
      adapter._setTime(10.01);
      ws.current._boundaryTickForTest();
      await Promise.resolve(); await Promise.resolve();
    });

    expect(src.calls).toEqual([{ exerciseId: 'ex1', budgetMs: DEFAULT_ANSWER_BUDGET_MS }]);
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[0][0]).toMatchObject({ answer: 'hello world' });
  });

  it('non-final outcome: evaluate is never called, and onAnswerOutcome (WEB-SEAM: outcome render → T3/T7) receives the full AnswerOutcome', async () => {
    const evaluate: ReturnType<typeof vi.fn> = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
    const src = new FakeAnswerSource();
    src.setForced({ status: 'no-response', reason: 'no-audio' });
    const seen: AnswerOutcomeEvent[] = [];
    const { rt, ws, adapter } = setup(evaluate, src, (e) => seen.push(e));
    const ex = makeExercise(true, true); // ON+ON — non-final ⇒ restart, loop stays armed
    act(() => { rt.current.onArm(ex); });

    await act(async () => {
      adapter._setTime(10.01);
      ws.current._boundaryTickForTest();
      await Promise.resolve(); await Promise.resolve();
    });

    expect(evaluate).not.toHaveBeenCalled();
    expect(seen).toEqual([{ exerciseId: 'ex1', outcome: { status: 'no-response', reason: 'no-audio' } }]);
    expect(rt.current.armedSegmentId()).toBe('ex1'); // still armed — shown-result loop repeat
  });

  it('with no answerSource supplied, legacy path is preserved (finalizeLoop stays undefined, `evaluate` scores the empty archiveShadowLoop buffer)', async () => {
    const evaluate: ReturnType<typeof vi.fn> = vi.fn(async () => ({ decision: 'pass', score: 95 } as never));
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
    const ex = makeExercise(true, true);
    act(() => { rt.current.onArm(ex); });

    await act(async () => {
      adapter._setTime(10.01);
      ws.current._boundaryTickForTest();
      await Promise.resolve(); await Promise.resolve();
    });

    // Legacy path unchanged: evaluate IS called (archiveShadowLoop stub → '(empty)').
    expect(evaluate).toHaveBeenCalledTimes(1);
    expect(evaluate.mock.calls[0][0]).toMatchObject({ answer: '(empty)' });
  });
});
