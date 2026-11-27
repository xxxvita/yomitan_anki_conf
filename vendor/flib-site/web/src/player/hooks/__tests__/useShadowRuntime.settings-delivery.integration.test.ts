// @vitest-environment jsdom
// useShadowRuntime.settings-delivery.integration.test.ts — Срез B (§2/§4).
// End-to-end proof (REAL useShadowRuntime + REAL useWorkspace + REAL
// useShadowLoopCoordinator, nothing mocked — same rig as
// useShadowRuntime.customtext.integration.test.ts) that PlayerPage's
// `persistArmedSettings` delivery ACTUALLY reaches the coordinator's advance
// gate:
//   • EPHEMERAL: an in-place threshold change mid-loop flips the boundary
//     decision advance↔retry on the NEXT boundary. The coordinator re-reads
//     settings at :465 via `getExercises().find(id) ?? ex` — an ephemeral-N id
//     is NOT in the store, so it falls back to `ex` (the SAME object
//     persistArmedSettings mutated). Disable the in-place Object.assign and this
//     test goes red (the whole point of the in-place channel).
//   • PERSISTED: a fresh-spread threshold change does NOT wipe settings.customText
//     in the real annotations store (CRIT-1 — updateShadowExercise shallow-merges).
import { describe, it, expect, vi, afterEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useWorkspace } from '../useWorkspace';
import { useShadowRuntime, type ShadowRuntimeWorkspaceActuators } from '../useShadowRuntime';
import { makeFakeAdapter } from '../../../adapter/__tests__/fake';
import { persistArmedSettings, type ArmedSettingsSink } from '../../workspace/shadow-settings-delivery';
import type { Cue as LiveCue } from '../useSubtitles';
import type { ShadowState } from '../../workspace/panel-types';

// Grading + LOOPING state — advanceThreshold 80 is the seed the ephemeral arm
// inherits (armRange copies state → ephemeral.settings, useShadowRuntime.ts:948).
const GRADING_STATE: ShadowState = {
  active: true, recording: false, wsConnected: false, listeningPaused: false,
  partialText: '', committedSegments: [], attempts: [], currentLoopIndex: 0,
  loopMode: true, advanceEnabled: true, advanceThreshold: 80,
  mode: 'subtitle', customText: '', documentPath: '', bind: 'off', saveAudio: false,
  engines: { asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' },
};

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

  // The delivery sink PlayerPage builds from the runtime (identical shape).
  const sink: ArmedSettingsSink = {
    armedSegmentId: () => rt.current.armedSegmentId(),
    getEphemeralArm: () => rt.current.getEphemeralArm(),
    getExercises: () => rt.current.annotations.shadowExercises,
    updateShadowExercise: (id, p) => rt.current.annotations.updateShadowExercise(id, p),
  };

  return { adapter, rt, ws, sink };
}

afterEach(() => { vi.useRealTimers(); });

async function driveBoundary(adapter: ReturnType<typeof makeFakeAdapter>, ws: ReturnType<typeof useWorkspace>) {
  await act(async () => {
    adapter._setTime(10.01);
    ws._boundaryTickForTest();
    await Promise.resolve(); await Promise.resolve();
  });
}

describe('Срез B integration — EPHEMERAL threshold mid-loop reaches the REAL advance-gate', () => {
  it('CONTROL: score 60 with the SEEDED threshold 80 → below → RESTART (still armed, not advanced)', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'retry', score: 60 } as never));
    const { rt, ws, adapter } = setup(evaluate);

    act(() => { rt.current.armRange(5, 10); });
    expect(ws.current.looping).toBe(true);
    const armedId = rt.current.armedSegmentId();
    expect(armedId).not.toBeNull();

    await driveBoundary(adapter, ws.current);

    expect(evaluate).toHaveBeenCalledTimes(1);
    // 60 < 80 → restart → the ephemeral arm survives (loop repeats).
    expect(rt.current.armedSegmentId()).toBe(armedId);
  });

  it('score 60 after LOWERING the threshold to 50 IN-PLACE mid-loop → advance (arm cleared on advance)', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 60 } as never));
    const { rt, ws, adapter, sink } = setup(evaluate);

    act(() => { rt.current.armRange(5, 10); });
    expect(rt.current.getEphemeralArm()!.settings.advanceThreshold).toBe(80);

    // PlayerPage's exact delivery (channel b): in-place mutate the held object.
    act(() => { persistArmedSettings(sink, { advanceThreshold: 50 }); });
    // In-place: the same object the coordinator captured now reads 50.
    expect(rt.current.getEphemeralArm()!.settings.advanceThreshold).toBe(50);

    await driveBoundary(adapter, ws.current);

    expect(evaluate).toHaveBeenCalledTimes(1);
    // 60 >= 50 → advance → single ephemeral arm → endRun clears it.
    expect(rt.current.armedSegmentId()).toBeNull();
  });

  it('turning advanceEnabled OFF in-place mid-loop → no advance even at score 100 (RESTART, still armed)', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 100 } as never));
    const { rt, ws, adapter, sink } = setup(evaluate);

    act(() => { rt.current.armRange(5, 10); });
    const armedId = rt.current.armedSegmentId();
    act(() => { persistArmedSettings(sink, { advanceEnabled: false }); });
    expect(rt.current.getEphemeralArm()!.settings.advanceEnabled).toBe(false);

    await driveBoundary(adapter, ws.current);

    // advanceEnabled false → reduceLoopOutcome never advances → restart, arm survives.
    expect(rt.current.armedSegmentId()).toBe(armedId);
  });
});

describe('Срез B integration — PERSISTED fresh-spread does not wipe customText (CRIT-1)', () => {
  function makePersistedPayload() {
    return {
      startTime: 5, endTime: 10, anchorMode: 'time-range' as const,
      settings: {
        loopMode: true, advanceEnabled: true, advanceThreshold: 80,
        mode: 'custom' as const, customText: 'my persisted phrase', saveAudio: false,
        engines: { asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' },
      },
    };
  }

  it('changing threshold on a persisted armed exercise preserves settings.customText in the real store', async () => {
    const evaluate = vi.fn(async () => ({ decision: 'pass', score: 90 } as never));
    const { rt, sink } = setup(evaluate);

    act(() => { rt.current.annotations.addShadowExercise(makePersistedPayload()); });
    const id = rt.current.annotations.shadowExercises[0].id;
    const ex = rt.current.annotations.shadowExercises.find(e => e.id === id)!;
    act(() => { rt.current.onArm(ex); });
    expect(rt.current.armedSegmentId()).toBe(id);

    // Delivery channel c: fresh-spread threshold change through updateShadowExercise.
    act(() => { persistArmedSettings(sink, { advanceThreshold: 65 }); });

    const after = rt.current.annotations.shadowExercises.find(e => e.id === id)!;
    expect(after.settings.advanceThreshold).toBe(65);
    // CRIT-1: a bare {settings:{advanceThreshold}} would have wiped these.
    expect(after.settings.customText).toBe('my persisted phrase');
    expect(after.settings.mode).toBe('custom');
    expect(after.settings.engines).toEqual({ asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' });
  });
});
