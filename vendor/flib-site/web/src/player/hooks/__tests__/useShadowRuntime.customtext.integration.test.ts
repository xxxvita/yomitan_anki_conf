// @vitest-environment jsdom
// useShadowRuntime.customtext.integration.test.ts — T5 (D1 + BL1-delivery):
// end-to-end proof that setCustomText's in-place mutation actually reaches
// the REAL coordinator's advance-gate (useShadowLoopCoordinator, NOT mocked —
// same rig as useShadowRuntime.test.ts) for the EPHEMERAL and PERSISTED
// paths, even when a live subtitle covers the exact same time range ("текст
// важнее субтитра" — task-T5-brief.md §3). Verifies:
//   - the `evaluate` fake receives customText as `target`, not the cue text;
//   - PERSISTED: the identity trick (§4 variant a, no coordinator getter) —
//     mutate the object annotations.shadowExercises already holds (the SAME
//     reference the coordinator captured into armedExerciseRef at onArm time)
//     THEN persist immutably via updateShadowExercise — survives a real
//     loop-boundary eval AND durably lands in the annotations store.
//   - clear (mode:'subtitle') reverts target to the subtitle text in both
//     paths.
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkspace } from '../useWorkspace';
import { useShadowRuntime, type ShadowRuntimeWorkspaceActuators } from '../useShadowRuntime';
import { makeFakeAdapter } from '../../../adapter/__tests__/fake';
import type { Cue as LiveCue } from '../useSubtitles';
import type { ShadowState } from '../../workspace/panel-types';

// Grading + LOOPING state (loop-boundary path via _boundaryTickForTest — same
// convention useShadowRuntime.test.ts uses to drive the coordinator's real
// eval without needing G5's reactive-currentTime dance).
const GRADING_STATE: ShadowState = {
  active: true, recording: false, wsConnected: false, listeningPaused: false,
  partialText: '', committedSegments: [], attempts: [], currentLoopIndex: 0,
  loopMode: true, advanceEnabled: true, advanceThreshold: 80,
  mode: 'subtitle', customText: '', documentPath: '', bind: 'off', saveAudio: false,
  engines: { asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' },
};

// Live subtitle covering the EXACT same [5,10] range the exercises below are
// armed over — proves customText wins over it, not merely "there was no
// subtitle to lose to".
const liveCues: LiveCue[] = [{ start: 5, end: 10, text_en: 'the subtitle text', text_ru: 'текст субтитра' }];

function setup(evaluate: ReturnType<typeof vi.fn>) {
  const adapter = makeFakeAdapter({ t: 5 });
  const wsActuatorsRef: React.MutableRefObject<ShadowRuntimeWorkspaceActuators | null> = { current: null };

  const { result: rt } = renderHook(() =>
    useShadowRuntime({
      videoId: 'v1',
      liveCues,
      currentTime: adapter.currentTime(),
      getCurrentTime: () => adapter.currentTime(),
      getShadowState: () => GRADING_STATE,
      setShadowState: vi.fn(),
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

  return { adapter, rt, ws };
}

afterEach(() => { vi.useRealTimers(); });

async function driveBoundary(adapter: ReturnType<typeof makeFakeAdapter>, ws: ReturnType<typeof useWorkspace>) {
  await act(async () => {
    adapter._setTime(10.01);
    ws._boundaryTickForTest();
    await Promise.resolve(); await Promise.resolve();
  });
}

describe('T5 integration — EPHEMERAL: customText reaches the REAL advance-gate, wins over a live subtitle', () => {
  it('evaluate receives customText as target, not the cue text, even though a subtitle covers the same range', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 90 } as never));
    const { rt, ws, adapter } = setup(evaluate);

    act(() => { rt.current.armRange(5, 10); });
    expect(ws.current.looping).toBe(true);

    act(() => { rt.current.setCustomText('my custom answer'); });
    expect(rt.current.getEphemeralArm()!.settings.customText).toBe('my custom answer');
    expect(rt.current.getEphemeralArm()!.settings.mode).toBe('custom');

    await driveBoundary(adapter, ws.current);

    expect(evaluate).toHaveBeenCalledTimes(1);
    const [req] = evaluate.mock.calls[0] as unknown as [{ target: string }, AbortSignal];
    expect(req.target).toBe('my custom answer'); // NOT 'the subtitle text'
  });

  it('clear (null) reverts the target back to the subtitle text', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 90 } as never));
    const { rt, ws, adapter } = setup(evaluate);

    act(() => { rt.current.armRange(5, 10); });
    act(() => { rt.current.setCustomText('temporary text'); });
    act(() => { rt.current.setCustomText(null); });
    expect(rt.current.getEphemeralArm()!.settings.mode).toBe('subtitle');

    await driveBoundary(adapter, ws.current);

    const [req] = evaluate.mock.calls[0] as unknown as [{ target: string }, AbortSignal];
    expect(req.target).toBe('the subtitle text');
  });
});

describe('T5 integration — PERSISTED path (§4 variant a): in-place mutation without touching the coordinator', () => {
  function makePersistedPayload() {
    return {
      startTime: 5, endTime: 10, anchorMode: 'time-range' as const,
      settings: {
        loopMode: true, advanceEnabled: true, advanceThreshold: 80,
        mode: 'subtitle' as const, saveAudio: false,
        engines: { asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' },
      },
    };
  }

  it('setCustomText on a currently-armed PERSISTED exercise reaches the advance-gate (evaluate target) AND durably persists via updateShadowExercise', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 90 } as never));
    const { rt, ws, adapter } = setup(evaluate);

    // addShadowExercise's RETURN VALUE is not reliable inside the same act()
    // call (id/inserted are only committed to state once act() flushes — same
    // quirk useAnnotations.test.ts documents) — read the id back from state.
    act(() => { rt.current.annotations.addShadowExercise(makePersistedPayload()); });
    const id = rt.current.annotations.shadowExercises[0].id;
    expect(id).toBeTruthy();

    // Source the exercise object from the SAME array the coordinator's
    // getExercises() reads (annotations.shadowExercises) — the only sane way
    // any future onArm caller would ever do it either (see setCustomText's
    // own doc for why this makes the identity assumption hold).
    const ex = rt.current.annotations.shadowExercises.find(e => e.id === id)!;
    expect(ex).toBeTruthy();

    act(() => { rt.current.onArm(ex); });
    expect(ws.current.looping).toBe(true);
    expect(rt.current.armedSegmentId()).toBe(id);

    act(() => { rt.current.setCustomText('persisted custom answer'); });

    // In-place: the object we hold (== armedExerciseRef.current inside the
    // coordinator) reflects the mutation immediately, synchronously.
    expect(ex.settings.customText).toBe('persisted custom answer');
    expect(ex.settings.mode).toBe('custom');

    await driveBoundary(adapter, ws.current);

    expect(evaluate).toHaveBeenCalledTimes(1);
    const [req] = evaluate.mock.calls[0] as unknown as [{ target: string }, AbortSignal];
    expect(req.target).toBe('persisted custom answer'); // NOT 'the subtitle text'

    // Durability: updateShadowExercise persisted immutably — a FRESH lookup
    // (post re-render, a NEW object per the store's immutable-replace
    // contract) carries the same value for future re-arms/reloads.
    const persistedNow = rt.current.annotations.shadowExercises.find(e => e.id === id)!;
    expect(persistedNow.settings.customText).toBe('persisted custom answer');
    expect(persistedNow.settings.mode).toBe('custom');
  });

  it('clear (null) on a persisted exercise reverts target to subtitle AND persists mode:"subtitle"', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 90 } as never));
    const { rt, ws, adapter } = setup(evaluate);

    act(() => { rt.current.annotations.addShadowExercise(makePersistedPayload()); });
    const id = rt.current.annotations.shadowExercises[0].id;
    const ex = rt.current.annotations.shadowExercises.find(e => e.id === id)!;
    act(() => { rt.current.onArm(ex); });
    act(() => { rt.current.setCustomText('will be cleared'); });
    act(() => { rt.current.setCustomText(null); });
    expect(ex.settings.mode).toBe('subtitle');

    await driveBoundary(adapter, ws.current);
    const [req] = evaluate.mock.calls[0] as unknown as [{ target: string }, AbortSignal];
    expect(req.target).toBe('the subtitle text');

    const persistedNow = rt.current.annotations.shadowExercises.find(e => e.id === id)!;
    expect(persistedNow.settings.mode).toBe('subtitle');
  });

  it('REGRESSION: a SECOND setCustomText call in the same arm cycle still reaches the advance-gate (found while writing this test — a naive annotations.shadowExercises.find(armedId) re-derive on every call goes stale after the FIRST updateShadowExercise splices in a new object)', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 90 } as never));
    const { rt, ws, adapter } = setup(evaluate);

    act(() => { rt.current.annotations.addShadowExercise(makePersistedPayload()); });
    const id = rt.current.annotations.shadowExercises[0].id;
    const ex = rt.current.annotations.shadowExercises.find(e => e.id === id)!;
    act(() => { rt.current.onArm(ex); });

    act(() => { rt.current.setCustomText('first edit'); });
    expect(ex.settings.customText).toBe('first edit');
    // A second edit, same arm cycle, AFTER the first one has already
    // triggered an updateShadowExercise (which replaced the array entry).
    act(() => { rt.current.setCustomText('second edit'); });
    expect(ex.settings.customText).toBe('second edit'); // still the SAME `ex` reference

    await driveBoundary(adapter, ws.current);
    const [req] = evaluate.mock.calls[0] as unknown as [{ target: string }, AbortSignal];
    expect(req.target).toBe('second edit'); // NOT 'first edit', NOT the subtitle
  });

  it('no exercise is CURRENTLY ARMED (setCustomText called before onArm) → nothing to mutate, does not throw, no persist call for an unarmed exercise', () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 90 } as never));
    const { rt } = setup(evaluate);

    act(() => { rt.current.annotations.addShadowExercise(makePersistedPayload()); });
    const id = rt.current.annotations.shadowExercises[0].id;
    // Deliberately NOT armed (no onArm call) — setCustomText must no-op the
    // persisted branch (armedSegmentId() is null) rather than guessing which
    // exercise the user meant.
    expect(() => act(() => rt.current.setCustomText('orphan text'))).not.toThrow();

    const untouched = rt.current.annotations.shadowExercises.find(e => e.id === id)!;
    expect(untouched.settings.customText).toBeUndefined();
    expect(untouched.settings.mode).toBe('subtitle');
  });
});
