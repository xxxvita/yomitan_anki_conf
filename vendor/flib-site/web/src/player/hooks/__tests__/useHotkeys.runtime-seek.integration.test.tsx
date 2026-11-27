// useHotkeys.runtime-seek.integration.test.tsx
// @vitest-environment jsdom
//
// S3-5 — proves the ACTUAL WIRING (not the runtime logic itself, which
// useShadowRuntime.shadow-key.integration.test.ts already covers via a direct
// `rt.current.seek(20)` call): a real `useHotkeys` mounted with `seek:
// runtime.seek` (observedSeek) fires ArrowRight and that keypress alone —
// through the same document-level listener PlayerPage wires up — releases an
// armed ephemeral exercise when the target lands outside its [start,end).
// This is the "carry T4/F3" forward-escape becoming live for a real keyboard
// user, not just at the hook-internals level.
//
// A second case proves the S3-5 transparency requirement AT the wired level:
// an ordinary user (no ephemeral arm) gets byte-identical behavior — the
// arrow key still reaches adapter.seek with the same target, no extra
// side-effects fire.
import { describe, it, expect, vi } from 'vitest'
import { useRef, useLayoutEffect, type MutableRefObject } from 'react'
import { render, fireEvent, act } from '@testing-library/react'
import { useShadowRuntime, type ShadowRuntime, type ShadowRuntimeWorkspaceActuators } from '../useShadowRuntime'
import { useWorkspace } from '../useWorkspace'
import { useHotkeys } from '../useHotkeys'
import { makeFakeAdapter, type FakeAdapter } from '../../../adapter/__tests__/fake'
import type { Cue as LiveCue } from '../useSubtitles'
import type { ShadowState } from '../../workspace/panel-types'

const SHADOW_STATE: ShadowState = {
  active: true, recording: false, wsConnected: false, listeningPaused: false,
  partialText: '', committedSegments: [], attempts: [], currentLoopIndex: 0,
  loopMode: true, advanceEnabled: false, advanceThreshold: 80,
  mode: 'subtitle', customText: '', documentPath: '', bind: 'off', saveAudio: false,
  engines: { asr: 'whisper-local', check: 'llm-local', ocr: 'llm-local' },
}

// Grading-эфемерный (loopMode:false) — armedLoopingRef=false в координаторе, так
// его onLeave (useShadowLoopCoordinator.ts:427 `if (armedLoopingRef.current)`)
// пропускает insideRegion/justPastEnd-гейт (тот читает ЖИВОЙ getCurrentTime(),
// который poll-lag НЕ подвинул до seek-таргета) и снимает арм безусловно. Это
// ТОТ ЖЕ грейдинг-путь, что useShadowRuntime.shadow-key.integration.test.ts
// использует для форвард-escape (см. GRADING_STATE там же) — петлевой (loopMode:
// true) арм для ЭТОЙ проверки не годится, insideRegion держал бы арм живым, пока
// getCurrentTime() физически не догонит seek.
const GRADING_STATE: ShadowState = { ...SHADOW_STATE, loopMode: false, advanceEnabled: true }

const liveCues: LiveCue[] = [{ start: 5, end: 10, text_en: 'hello', text_ru: 'привет' }]

function Harness({ adapter, rtRef, state = SHADOW_STATE }: {
  adapter: FakeAdapter
  rtRef: MutableRefObject<ShadowRuntime | null>
  state?: ShadowState
}) {
  const wsActuatorsRef: MutableRefObject<ShadowRuntimeWorkspaceActuators | null> = useRef(null)
  const rt = useShadowRuntime({
    videoId: 'v1',
    liveCues,
    currentTime: adapter.currentTime(),
    getCurrentTime: () => adapter.currentTime(),
    getShadowState: () => state,
    wsActuatorsRef,
    seek: adapter.seek,
    pauseVideo: adapter.pause,
    evaluate: vi.fn() as never,
  })
  const ws = useWorkspace(adapter, [{ start: 5, end: 10 }], 'v1', false,
    rt.onLoopBoundary, rt.shouldPauseAtBoundary, rt.onLoopRestart)
  useLayoutEffect(() => {
    wsActuatorsRef.current = {
      restoreWorkspace: ws.restoreWorkspace,
      resumeFromBoundary: ws.resumeFromBoundary,
      deactivateWorkspace: ws.deactivateWorkspace,
      countdownThenPlay: ws.countdownThenPlay,
      getWorkspaceSnapshot: ws.getWorkspaceSnapshot,
    }
  })
  // S3-5: THE wiring under test — useHotkeys gets `runtime.seek`, exactly like
  // PlayerPage now does (pages/PlayerPage.tsx `seek: runtime.seek`).
  useHotkeys({ adapter, ws, cues: liveCues, activeIndex: 0, seek: rt.seek })
  rtRef.current = rt
  return <input data-testid="text-input" />
}

describe('S3-5 wiring — useHotkeys(seek: runtime.seek) + real useShadowRuntime', () => {
  it('ArrowRight past an armed ephemeral range releases the arm (forward-escape is live through the real keyboard route)', () => {
    const adapter = makeFakeAdapter({ t: 7 }) // inside cue [5,10]
    const adapterSeek = vi.spyOn(adapter, 'seek')
    const rtRef: MutableRefObject<ShadowRuntime | null> = { current: null }
    render(<Harness adapter={adapter} rtRef={rtRef} state={GRADING_STATE} />)

    act(() => { rtRef.current!.armRange(5, 10) })
    const ex = rtRef.current!.getEphemeralArm()
    expect(ex).not.toBeNull()
    expect(rtRef.current!.armedSegmentId()).toBe(ex!.id)

    // t=7, ArrowRight → target 12, OUTSIDE [5,10) → this is a real DOM keydown,
    // routed by useHotkeys through `seek` (runtime.seek/observedSeek) — NOT a
    // direct call into the runtime's own `seek` like the lower-level
    // integration test does.
    fireEvent.keyDown(document, { key: 'ArrowRight' })

    expect(rtRef.current!.getEphemeralArm()).toBeNull()
    expect(rtRef.current!.armedSegmentId()).toBeNull()
    expect(adapterSeek).toHaveBeenCalledWith(12)
  })

  it('transparency: ArrowRight with NO ephemeral arm behaves exactly like a plain adapter.seek (ordinary user, no side effects)', () => {
    const adapter = makeFakeAdapter({ t: 7 })
    const adapterSeek = vi.spyOn(adapter, 'seek')
    const rtRef: MutableRefObject<ShadowRuntime | null> = { current: null }
    render(<Harness adapter={adapter} rtRef={rtRef} />)

    expect(rtRef.current!.getEphemeralArm()).toBeNull() // no arm — ordinary user

    fireEvent.keyDown(document, { key: 'ArrowRight' })

    // The seek still reaches the adapter with the exact same target an
    // unwrapped adapter.seek(12) call would have used — observedSeek's early
    // return (ephemeralArmRef.current === null) makes it a pure passthrough.
    expect(adapterSeek).toHaveBeenCalledTimes(1)
    expect(adapterSeek).toHaveBeenCalledWith(12)
    expect(rtRef.current!.getEphemeralArm()).toBeNull()
    expect(rtRef.current!.armedSegmentId()).toBeNull()
    expect(rtRef.current!.isHeld()).toBe(false)
  })
})
