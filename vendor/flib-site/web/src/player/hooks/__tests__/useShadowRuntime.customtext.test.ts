// @vitest-environment jsdom
// useShadowRuntime.customtext.test.ts — T5 (D1 + BL1-delivery): dispatch-logic
// tests for `setCustomText`, ISOLATED via a FAKE coordinator (same idiom as
// useShadowRuntime.shadow-key.test.ts — deterministic control of armedId,
// independent of the real coordinator's own boundary/eval machinery, which is
// covered separately in useShadowLoopCoordinator.test.ts and exercised
// end-to-end for T5 in useShadowRuntime.customtext.integration.test.ts).
//
// Covers the THREE dispatch branches inside setCustomText itself:
//   1. MANUAL (no exercise armed at all) — state dual-write only.
//   2. EPHEMERAL — in-place mutation of ephemeralArmRef.current.settings,
//      gated by the T4-carry caveat (armedSegmentId() === ephemeralArmRef
//      .current.id).
//   3. Clear (text: null) — mode:'subtitle' everywhere it touched.
// The PERSISTED branch's in-place-mutation identity claim (§4 variant a) is
// NOT provable with a fake coordinator (there's nothing real to mutate
// against) — that's the integration file's job.
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import type React from 'react';
import { useShadowRuntime, type ShadowRuntimeWorkspaceActuators } from '../useShadowRuntime';
import type { ShadowExerciseAnnotation, ShadowState } from '../../workspace/panel-types';
import type { Cue as LiveCue } from '../useSubtitles';

// ── FAKE-координатор (lifted idiom from useShadowRuntime.shadow-key.test.ts) ──
const h = vi.hoisted(() => ({
  armedId: null as string | null,
}));

vi.mock('../useShadowLoopCoordinator', () => ({
  useShadowLoopCoordinator: () => ({
    shouldPauseAtBoundary: () => false,
    onArm: (ex: ShadowExerciseAnnotation) => { h.armedId = ex.id; },
    onLeave: (id: string) => { if (h.armedId === id) h.armedId = null; },
    onLoopBoundary: () => {},
    armedSegmentId: () => h.armedId,
    setArmedLooping: () => {},
    setArmedGrading: () => {},
    isEvalInFlight: () => false,
  }),
}));

const SHADOW_STATE: ShadowState = {
  active: true, recording: false, wsConnected: false, listeningPaused: false,
  partialText: '', committedSegments: [], attempts: [], currentLoopIndex: 0,
  loopMode: true, advanceEnabled: false, advanceThreshold: 80,
  mode: 'subtitle', customText: '', documentPath: '', bind: 'off', saveAudio: false,
  engines: { asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' },
};

const liveCues: LiveCue[] = [{ start: 5, end: 10, text_en: 'hello', text_ru: 'привет' }];

function setup() {
  const snapshot = { rangeStart: 5, rangeEnd: 10, viewStart: 0, viewEnd: 60, looping: true, pauseAtEnd: 0, active: true };
  const wsActuatorsRef: React.MutableRefObject<ShadowRuntimeWorkspaceActuators | null> = { current: null };
  wsActuatorsRef.current = {
    restoreWorkspace: vi.fn(),
    resumeFromBoundary: vi.fn(),
    deactivateWorkspace: vi.fn(),
    countdownThenPlay: vi.fn(),
    getWorkspaceSnapshot: () => snapshot,
  };
  const setShadowState = vi.fn();

  const { result } = renderHook(() =>
    useShadowRuntime({
      videoId: 'v1',
      liveCues,
      currentTime: 7,
      getCurrentTime: () => 7,
      getShadowState: () => SHADOW_STATE,
      setShadowState,
      wsActuatorsRef,
      seek: vi.fn(),
      pauseVideo: vi.fn(),
      evaluate: vi.fn(),
    }),
  );
  return { rt: result, setShadowState };
}

beforeEach(() => { h.armedId = null; });

describe('T5 setCustomText — MANUAL path (no exercise armed)', () => {
  it('ALWAYS dual-writes {customText, mode:"custom"} to ShadowState via setShadowState', () => {
    const { rt, setShadowState } = setup();
    act(() => rt.current.setCustomText('manual answer'));
    expect(setShadowState).toHaveBeenCalledWith({ customText: 'manual answer', mode: 'custom' });
  });

  it('clear (null) writes mode:"subtitle" + empty customText', () => {
    const { rt, setShadowState } = setup();
    act(() => rt.current.setCustomText(null));
    expect(setShadowState).toHaveBeenCalledWith({ customText: '', mode: 'subtitle' });
  });

  it('whitespace-only text is treated as clear (mode:"subtitle")', () => {
    const { rt, setShadowState } = setup();
    act(() => rt.current.setCustomText('   '));
    expect(setShadowState).toHaveBeenCalledWith({ customText: '', mode: 'subtitle' });
  });

  it('no exercise armed at all → nothing else touched (no throw), state dual-write is the only effect', () => {
    const { rt, setShadowState } = setup();
    expect(() => act(() => rt.current.setCustomText('x'))).not.toThrow();
    expect(setShadowState).toHaveBeenCalledTimes(1);
  });
});

describe('T5 setCustomText — EPHEMERAL path (T4 object-identity)', () => {
  it('mutates ephemeralArmRef.current.settings IN PLACE (mode:"custom" + customText) when it is the one actually armed', () => {
    const { rt, setShadowState } = setup();
    act(() => rt.current.armRange(5, 10));
    const ex = rt.current.getEphemeralArm()!;
    expect(h.armedId).toBe(ex.id); // fake coordinator armed the SAME id (object-identity precondition)

    act(() => rt.current.setCustomText('ephemeral answer'));

    // Same object reference — in-place mutation, not a replacement.
    expect(rt.current.getEphemeralArm()).toBe(ex);
    expect(ex.settings.customText).toBe('ephemeral answer');
    expect(ex.settings.mode).toBe('custom');
    // ALWAYS-branch still fires alongside the ephemeral mutation.
    expect(setShadowState).toHaveBeenCalledWith({ customText: 'ephemeral answer', mode: 'custom' });
  });

  it('clear (null) resets the ephemeral object to mode:"subtitle" in place', () => {
    const { rt } = setup();
    act(() => rt.current.armRange(5, 10));
    const ex = rt.current.getEphemeralArm()!;
    act(() => rt.current.setCustomText('temp'));
    expect(ex.settings.mode).toBe('custom');
    act(() => rt.current.setCustomText(null));
    expect(ex.settings.mode).toBe('subtitle');
    expect(ex.settings.customText).toBeUndefined();
  });

  it('CAVEAT (T4-carry): does NOT mutate the ephemeral object when armedSegmentId() has diverged (dead-object window) — ALWAYS-branch still fires', () => {
    const { rt, setShadowState } = setup();
    act(() => rt.current.armRange(5, 10));
    const ex = rt.current.getEphemeralArm()!;
    expect(ex.settings.customText).toBe(''); // seeded from SHADOW_STATE.customText

    // Simulate the coordinator having moved on (re-armed something else /
    // advanced) while ephemeralArmRef/getEphemeralArm() has not yet been
    // reconciled — armedSegmentId() no longer matches this ephemeral's id.
    h.armedId = 'someone-else';

    act(() => rt.current.setCustomText('should not land'));

    // Dead object: untouched.
    expect(ex.settings.customText).toBe('');
    expect(ex.settings.mode).toBe('subtitle');
    // The manual/state dual-write is unconditional — still happened.
    expect(setShadowState).toHaveBeenCalledWith({ customText: 'should not land', mode: 'custom' });
  });
});
