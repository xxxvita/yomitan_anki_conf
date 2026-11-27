// PlayerPage.shadow.integration.test.tsx — T5: proves the shadowing V1 wiring
// assembled in PlayerPage (pill toggle → useShadowV1 → ShadowCard overlay →
// WorkspacePanel → WorkspacePanelThemed's YOU track) actually works end to
// end, not just "props are typed correctly" (tsc already guarantees that).
//
// Three seams are faked (jsdom has none of these):
//   1. createIFrameAdapter → fake adapter with a FIXED currentTime (same
//      pattern as PlayerPage.test.tsx's mockAdapterHolder).
//   2. global fetch → branches on URL: /api/youtube/subtitles resolves real
//      cues (needed so referenceText/activeIndex are non-empty — the idle
//      "Скоро"-toast smoke test in PlayerPage.test.tsx never needed cues,
//      this one does), /api/stt resolves a canned transcript.
//   3. ShadowRecorder (shadow-recorder.ts) → fake start()/stop() returning a
//      fixed non-empty PCM16 chunk (no getUserMedia in jsdom) — same DI seam
//      useShadowV1.test.ts uses via `deps.createRecorder`, but PlayerPage
//      wires useShadowV1 with NO deps override, so here the module itself is
//      mocked instead (module-level DI, one level lower).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, act, within, renderHook } from '@testing-library/react'
import { MemoryRouter, useNavigate } from 'react-router-dom'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, StrictMode } from 'react'
import { PlayerPage } from '../PlayerPage'
import { useVideoPlayerStore } from '../../player/workspace/video-player-store'
import { useShadowV1 } from '../../player/hooks/useShadowV1'
import { makeFakeAdapter } from '../../adapter/__tests__/fake'
import { useWorkspace, type WorkspaceApi, type WorkspaceSnapshot } from '../../player/hooks/useWorkspace'
// Срез C [ID:P-C]: attempts localStorage record shape, read back directly in
// the new tests below (not just via the panel-shaped forPanel projection).
import type { ShadowAttemptStored } from '../../player/workspace/shadow-attempts'
// S3-2: the assembled runtime seam is exercised via a harness that mirrors
// PlayerPage's exact wiring (no DOM affordance drives the runtime yet — the S
// key is S3-6, autostart later), plus wrap-real spies proving PlayerPage itself
// mounts the runtime and forwards its callbacks into useWorkspace.
import { useShadowRuntime, type ShadowRuntimeWorkspaceActuators } from '../../player/hooks/useShadowRuntime'
import { useShadowState } from '../../player/hooks/useShadowState'
import { FakeAnswerSource } from '../../player/workspace/answer-source'
import { matchWordsDetailed } from '../../player/workspace/word-matcher'
import type { CoordinatorEvaluate } from '../../player/hooks/useShadowLoopCoordinator'
import type { EvaluationDecision } from '../../player/components/AwaitingEvaluationOverlay'
import type { ShadowExerciseAnnotation } from '../../player/workspace/panel-types'

// Cue [0,2) covers the fake adapter's fixed t=1 → activeIndex=0, referenceText
// = 'hello world' (same fixture text useShadowV1.test.ts already uses, kept
// consistent on purpose).
const CUES = [
  { start: 0, end: 2, text_en: 'hello world', text_ru: 'привет мир' },
  { start: 2, end: 4, text_en: 'second cue', text_ru: 'вторая реплика' },
]

const mockAdapterHolder = vi.hoisted(() => ({ adapter: null as any }))
// T5-review finding #1/#3: tracks real ShadowRecorder.stop() calls so tests
// can prove a collapse-while-recording actually stopped the mic (privacy fix),
// not merely hid the ShadowCard behind the `!timelineCollapsed` gate.
const shadowRecorderStopHolder = vi.hoisted(() => ({ count: 0 }))
// S3-2-fix CRIT: tracks real ShadowRecorder.start() calls so the new mic-gate
// regression test can prove getUserMedia is NOT reached on an ordinary native
// A-B loop restart while shadowing is inactive (and IS reached once active).
const shadowRecorderStartHolder = vi.hoisted(() => ({ count: 0 }))

vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    mockAdapterHolder.adapter = makeFakeAdapter({ duration: 120, t: 1 })
    return mockAdapterHolder.adapter
  },
}))

// Module-level DI: real ShadowRecorder needs getUserMedia/AudioWorklet, none
// of which exist in jsdom. Fake mirrors the ShadowRecorderLike surface
// useShadowV1 actually calls (start/stop) — see T3's useShadowV1.test.ts for
// the equivalent hook-level fake; this one lives one seam lower because
// PlayerPage instantiates useShadowV1 with no deps override.
vi.mock('../../player/workspace/shadow-recorder', () => ({
  ShadowRecorder: class {
    start() {
      shadowRecorderStartHolder.count += 1
      return Promise.resolve()
    }
    stop() {
      shadowRecorderStopHolder.count += 1
      const buf = new ArrayBuffer(4)
      new Int16Array(buf).set([120, -120])
      return [buf]
    }
  },
}))

// S3-2: wrap-real spies. useWorkspace + useShadowRuntime keep their REAL
// behaviour (async importActual pass-through) — the wrappers only record what
// PlayerPage handed each hook, so the wiring assertions below observe
// production wiring without altering it. The harness (bottom of file) also
// routes through these wrappers harmlessly; each test renders exactly one
// consumer so `lastArgs`/`lastReturn` is unambiguous per test.
const wsWrap = vi.hoisted(() => ({ lastArgs: null as unknown[] | null, lastReturn: null as WorkspaceApi | null }))
const rtWrap = vi.hoisted(() => ({ lastArgs: null as any, lastReturn: null as any }))
// S3-2-fix CRIT: exposes the REAL useShadowState() return PlayerPage itself
// uses, so the mic-gate test can flip `active` through the exact same setter
// PlayerPage would eventually wire an arm-trigger to (S3-6) — without this,
// the test would have no way to reach PlayerPage's own ShadowState from the
// outside and would be forced to call runtime.onLoopRestart() directly
// (the thing the review explicitly asked NOT to do).
const ssWrap = vi.hoisted(() => ({ lastReturn: null as { getShadowState: () => any; setShadowState: (p: any) => void } | null }))
// S3-4: wrap-real spy on WorkspacePanel itself (component, not a hook) — same
// wrap-real idiom as useWorkspace/useShadowRuntime above, applied to a
// component: records the props PlayerPage actually handed it, then renders
// the REAL component unmodified. Lets the wiring test assert (a) identity —
// the exact runtime.annotations.updateShadowExercise/deleteShadowExercise
// function references reached WorkspacePanel, not lookalikes — and (b) call
// those captured functions to prove they really mutate the shared annotations
// state (a re-render then updates rtWrap.lastReturn.annotations for readback).
const wpWrap = vi.hoisted(() => ({ lastProps: null as any }))
// Срез A fix-wave: capture-мок useShadowMicStream. В тестах реалтайм ВЫКЛ
// (VITE_SHADOW_REALTIME не задан) ⇒ настоящий хук — no-op (мик не открывается),
// поэтому замена stub'ом, который лишь ЗАХВАТЫВАЕТ onAnalyser, поведение-нейтральна
// для всех прочих тестов (micAnalyser остаётся null, пока тест сам не позовёт
// захваченный колбэк). Нужно, чтобы M-7c (rec-таймер) и M-2-интеграция могли
// инъектировать/закрыть AnalyserNode детерминированно, без getUserMedia в jsdom.
const micStreamHolder = vi.hoisted(() => ({ onAnalyser: null as ((a: AnalyserNode | null) => void) | null }))

vi.mock('../../player/hooks/useWorkspace', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useWorkspace')>()
  return {
    ...actual,
    useWorkspace: (...args: unknown[]) => {
      wsWrap.lastArgs = args
      const r = (actual.useWorkspace as (...a: unknown[]) => WorkspaceApi)(...args)
      wsWrap.lastReturn = r
      return r
    },
  }
})

vi.mock('../../player/hooks/useShadowState', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useShadowState')>()
  return {
    ...actual,
    useShadowState: (...args: unknown[]) => {
      const r = (actual.useShadowState as (...a: unknown[]) => any)(...args)
      ssWrap.lastReturn = r
      return r
    },
  }
})

vi.mock('../../player/hooks/useShadowRuntime', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useShadowRuntime')>()
  return {
    ...actual,
    useShadowRuntime: (args: any) => {
      const r = actual.useShadowRuntime(args)
      rtWrap.lastArgs = args
      rtWrap.lastReturn = r
      return r
    },
  }
})

vi.mock('../../player/hooks/useShadowMicStream', () => ({
  useShadowMicStream: (opts: { onAnalyser: (a: AnalyserNode | null) => void }) => {
    micStreamHolder.onAnalyser = opts.onAnalyser
  },
}))

vi.mock('../../player/workspace/WorkspacePanel', async (importActual) => {
  const actual = await importActual<typeof import('../../player/workspace/WorkspacePanel')>()
  return {
    ...actual,
    WorkspacePanel: (props: any) => {
      wpWrap.lastProps = props
      return <actual.WorkspacePanel {...props} />
    },
  }
})

beforeEach(() => {
  localStorage.clear()
  // Э6 (Shadowing-гейт): пилюля «Шадоуинг» теперь disabled без flib:access —
  // сидим доступ, чтобы клики/армы этого теста (не про гейт) доходили до onToggleShadow.
  localStorage.setItem('flib:access', JSON.stringify({ shadowing: true, keyPrefix: 'tpk_test', checkedAt: new Date().toISOString() }))
  shadowRecorderStopHolder.count = 0
  shadowRecorderStartHolder.count = 0
  wsWrap.lastArgs = null
  wsWrap.lastReturn = null
  rtWrap.lastArgs = null
  rtWrap.lastReturn = null
  ssWrap.lastReturn = null
  wpWrap.lastProps = null
  micStreamHolder.onAnalyser = null
  vi.stubGlobal('fetch', vi.fn((url: unknown) => {
    const u = String(url)
    if (u.includes('/api/youtube/subtitles')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ video_id: 'abc123XYZ_1', source_language: 'en', cues: CUES }),
      } as Response)
    }
    if (u.includes('/api/stt')) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ text: 'hello world' }),
      } as Response)
    }
    return Promise.reject(new Error(`unmocked fetch: ${u}`))
  }))
})

async function waitTwoAnimationFrames() {
  await act(async () => {
    await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(() => r(null))))
  })
}

// S3-7: this block used to prove the V1 push-to-record assembly (pill →
// useShadowV1 → V1 ShadowCard → record/stop → YOU track). V1 is retired (owner
// CONCERN #1). The tests below are the runtime-contract replacements: the card
// shows by RUNTIME-active (S-key arm, S3-6b activate-on-arm) and its feed is the
// runtime verdict (B1 notation), not a V1 attempts feed.
// S3-7-fix: the V1 pill is no longer just inert — it is HIDDEN entirely
// (WorkspacePanelThemed gates it on `onToggleShadow`, never passed by
// PlayerPage — see WorkspacePanel.tsx/WorkspacePanelThemed.tsx). Tests below
// updated from "click does nothing" to "control is absent".
describe('PlayerPage — shadowing card assembly (S3-7 runtime; replaces the T5 V1 assembly)', () => {
  it('S3-7: the card shows by RUNTIME-active (S-arm), NOT the retired V1 pill; Close disarms and unmounts it', async () => {
    const { getByTestId, queryByTestId, queryByTitle } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames() // activeIndex → cue #0 [0,2) at fixed t=1
    expect(queryByTestId('shadow-card')).toBeNull()

    // Срез A (п.1): the pill is revived — present (title reflects inactive).
    expect(queryByTitle('Старт Шадоуинг')).toBeTruthy()

    // Runtime arm (S on the active cue) flips shadowState.active → card mounts
    // (escape the fresh-video default AB seed first, see the S3-6 tests below).
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    act(() => { fireEvent.keyDown(document, { key: 's', code: 'KeyS' }) })
    expect(queryByTestId('shadow-card')).toBeTruthy()

    // Close disarms the runtime → active re-syncs false → card unmounts. Move
    // the playhead out of the armed range first so the coordinator's
    // loop-transient guard lets a plain onLeave through (same real "user
    // left" case the S3-6b test exercises). The DEFAULT in-range case (no
    // seek-away) is covered separately below (S3-7-fix test) — this one
    // intentionally keeps the seek-away shape to prove that path still works
    // too, now via runtime.deactivate() instead of raw onLeave.
    mockAdapterHolder.adapter._setTime(10)
    fireEvent.click(getByTestId('shadow-close'))
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeNull() })
    // Срез A: after deactivate the pill is back to its inactive "Старт" title.
    expect(queryByTitle('Старт Шадоуинг')).toBeTruthy()
  })

  it('S3-7-fix (blocker): Close(×) during an ACTIVE loop with the playhead INSIDE the armed range reliably closes the card — the default case, no seek-away trick', async () => {
    const { getByTestId, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames() // activeIndex → cue #0 [0,2) at fixed t=1

    // Escape the fresh-video default AB seed, then S-arm cue #0 [0,2). Fixed
    // adapter time stays at t=1 throughout — INSIDE the armed range.
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    act(() => { fireEvent.keyDown(document, { key: 's', code: 'KeyS' }) })
    expect(queryByTestId('shadow-card')).toBeTruthy()
    expect(rtWrap.lastReturn.armedSegmentId()).not.toBeNull()

    // ShadowState.loopMode defaults true (INITIAL_SHADOW_STATE) — this is an
    // ACTIVE loop. NO mockAdapterHolder.adapter._setTime(...) escape here —
    // that trick (used in the test above and in the old T1 assembly test)
    // masked this exact bug: pre-fix, `runtime.onLeave(id)` alone hits the
    // coordinator's own loop-transient gate (armedLoopingRef && insideRegion,
    // useShadowLoopCoordinator.ts ~:427-440) whenever the playhead is inside
    // the armed range — which, with loopMode defaulting true, is the NORMAL
    // case — and silently no-ops. × did nothing; the card stayed mounted.
    fireEvent.click(getByTestId('shadow-close'))

    // Post-fix: runtime.deactivate() (ungated composition over the
    // coordinator's existing setArmedLooping+onLeave actuators, coordinator
    // itself untouched) unarms regardless of playhead position; PlayerPage's
    // onClose additionally stops the loop and forces `active` false on this
    // same render (belt-and-suspenders, see PlayerPage.tsx's onClose doc).
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeNull() })
    expect(rtWrap.lastReturn.armedSegmentId()).toBeNull()
    expect(ssWrap.lastReturn!.getShadowState().active).toBe(false)
    expect(wsWrap.lastReturn!.looping).toBe(false)

    // The catch-all effect (no deps — re-syncs `active` off armedSegmentId
    // after EVERY render) must NOT reactivate the card now that nothing is
    // armed: force a couple more render passes and re-check.
    await waitTwoAnimationFrames()
    expect(queryByTestId('shadow-card')).toBeNull()
    expect(ssWrap.lastReturn!.getShadowState().active).toBe(false)
  })

  it('S3-7: an S-arm boundary renders the runtime verdict IN the card as B1 notation (replaces the V1 record→result feed)', async () => {
    const { getByTestId, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()

    // Non-looping arm so a below-threshold verdict parks (loopMode is a plain
    // ShadowState setting, unrelated to activate-on-arm).
    act(() => { ssWrap.lastReturn!.setShadowState({ loopMode: false }) })
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    act(() => { fireEvent.keyDown(document, { key: 's', code: 'KeyS' }) })
    expect(queryByTestId('shadow-card')).toBeTruthy()
    // No V1 push-to-record surface on the runtime card.
    expect(queryByTestId('shadow-record')).toBeNull()

    // Drive the boundary the coordinator exposes (native ws.looping is false).
    await act(async () => { rtWrap.lastReturn!.onLoopBoundary() })
    await waitFor(() => { expect(rtWrap.lastReturn!.verdictOutcome).not.toBeNull() })

    // Срез A: the FULL ShadowCard renders the verdict as its attempts-feed
    // word-diff (`shadow-diff`, WordChip row synthesized from the runtime
    // verdict's lastMarks) — NOT the RuntimeShadowCard's `shadow-verdict-notation`
    // (that stripped card is retired). The B1 notation still renders in the
    // VIDEO hold-overlay (ShadowHoldOverlay) off the same verdictOutcome — this
    // scopes the query to the CARD to prove the card itself shows the verdict.
    await waitFor(() => {
      expect(within(getByTestId('shadow-card')).queryByTestId('shadow-diff')).toBeTruthy()
    })
  })

  it('regression smoke: loop pill / mute AUD toggle / subtitle-mode buttons still render (no throw from the new wiring)', async () => {
    const { getByTitle, container } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    expect(getByTitle('A-B повтор: вкл')).toBeTruthy()
    expect(container.querySelector('[data-testid="sub-mode-en"]')).toBeTruthy()
    expect(container.querySelector('[data-testid="aud-track-toggle"]')).toBeTruthy()
  })

  it('S3-7: collapsing the timeline unmounts the runtime card — a PURE visibility flip (arm intact), with NO V1 mic to stop (phase (i) is mic-less)', async () => {
    const { getByTitle, getByTestId, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()

    // Runtime arm mounts the card.
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    act(() => { fireEvent.keyDown(document, { key: 's', code: 'KeyS' }) })
    expect(queryByTestId('shadow-card')).toBeTruthy()

    // Collapse the timeline panel (Exit, title 'Закрыть').
    fireEvent.click(getByTitle('Закрыть'))

    // The card is gone (gated on !timelineCollapsed) — but this is now a PURE
    // visibility flip. The old V1 privacy behaviour (deactivate() + stop the
    // mic on collapse) is gone because there is no mic in phase (i): the
    // runtime recorder slot is a no-op, so nothing ever started or stopped.
    expect(queryByTestId('shadow-card')).toBeNull()
    expect(shadowRecorderStartHolder.count).toBe(0)
    expect(shadowRecorderStopHolder.count).toBe(0)

    // Reopen — the arm is INTACT (collapse did not deactivate it), so the card
    // comes back with its runtime state. This is the behavioural change from V1
    // (which reset on collapse): runtime arm survives a visibility flip.
    fireEvent.click(getByTestId('timeline-reopen'))
    expect(queryByTestId('shadow-card')).toBeTruthy()
  })

  it('Диктант/Пазлы pills are unaffected — still real "Скоро" stubs', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    fireEvent.click(getByTitle('Старт Диктант'))
    expect(getByTestId('mini-toast').textContent).toBe('Скоро')
  })
})

// WEB-SEAM (documented, not a gap): WorkspacePanelThemed (lifted, "НЕ
// трогаем") only wires onSelectYouRecording/setYouTrackRecordingId for
// DUB-kind recordings (per-cluster TrackCombo, WorkspacePanelThemed.tsx
// ~2135-2151) — plain 'auto' shadow recordings render a bare, non-interactive
// waveform (pointerEvents:'none', no onClick, see the `rec-wave-<id>` block
// at ~1984-1997). V1 shadowing only ever produces 'auto' recordings, so there
// is no real DOM click path for "click a shadow recording → store setter" to
// exercise honestly without either (a) fabricating a click on a handler-less
// node (would pass regardless of wiring — a false-positive test) or (b)
// editing the forbidden WorkspacePanelThemed.tsx to add one. Instead this
// proves the actual prop PlayerPage wires (`onSelectYouRecording={shadow.
// selectRecording}`, PlayerPage.tsx) really reaches the shared store — via
// the same real hook + real singleton store PlayerPage uses, exercised
// through the public API (renderHook), not a DOM affordance that does not
// exist for this recording kind. Store-write itself already has direct
// hook-level coverage (useShadowV1.test.ts:223, unchanged, still green).
describe('PlayerPage — shadow recording→store select wiring (T5, no DOM affordance for auto-kind, see comment)', () => {
  it('shadow.selectRecording (the exact function PlayerPage assigns to onSelectYouRecording) writes into the shared video-player-store', async () => {
    const adapter = makeFakeAdapter({ t: 1 })
    // FIX3 (fix-wave review): this used to be `as unknown as WorkspaceApi`, which
    // masks tsc from ever catching a missing WorkspaceApi field (it did — the T0
    // coordinator actuators below were absent). Direct typing (no `as unknown`
    // detour) means a future WorkspaceApi field added without a stub here fails
    // typecheck instead of silently compiling.
    const ws: WorkspaceApi = {
      rangeStart: 0, rangeEnd: 0, looping: false, pauseAtEnd: 0, countdownValue: null,
      viewStart: 0, viewEnd: 10,
      setABLoop: vi.fn(), toggleABLoop: vi.fn(), onPlayCommand: vi.fn(), onUserSeek: vi.fn(),
      setPauseAtEnd: vi.fn(), stopLoop: vi.fn(), setView: vi.fn(), zoom: vi.fn(),
      fitToRange: vi.fn(), setRange: vi.fn(), _boundaryTickForTest: vi.fn(),
      countdownThenPlay: vi.fn(), resumeFromBoundary: vi.fn(),
      restoreWorkspace: vi.fn(), deactivateWorkspace: vi.fn(),
      getWorkspaceSnapshot: vi.fn((): WorkspaceSnapshot => ({
        rangeStart: 0, rangeEnd: 0, viewStart: 0, viewEnd: 10, looping: false,
        pauseAtEnd: 0, active: false,
      })),
    }

    const { renderHook } = await import('@testing-library/react')
    const { result: shadowResult } = renderHook(() => useShadowV1(adapter, 'vidZ', CUES, 0, ws))
    const { result: storeResult } = renderHook(() => useVideoPlayerStore(s => s.youTrackRecordingId))
    expect(storeResult.current).toBeNull()

    act(() => { shadowResult.current.selectRecording('rec-integration-1') })

    const { result: storeResultAfter } = renderHook(() => useVideoPlayerStore(s => s.youTrackRecordingId))
    expect(storeResultAfter.current).toBe('rec-integration-1')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// S3-2: runtime mounted alongside V1 — PlayerPage wiring (wrap-real spies)
// ─────────────────────────────────────────────────────────────────────────────
describe('PlayerPage — shadow runtime mounted alongside V1 (S3-2 wiring)', () => {
  it('mounts useShadowRuntime with the plumbing args, forwards its 3 loop-callbacks to useWorkspace, and populates wsActuatorsRef via layout effect', async () => {
    render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()

    // (a) runtime is really mounted with the S3-2 plumbing args.
    const rt = rtWrap.lastArgs
    expect(rt).toBeTruthy()
    expect(rt.videoId).toBe('abc123XYZ_1')
    expect(Array.isArray(rt.liveCues)).toBe(true)
    expect(rt.answerBudgetMs).toBe(3000)
    expect(rt.answerSource).toBeInstanceOf(FakeAnswerSource)
    expect(typeof rt.evaluate).toBe('function')
    expect(rt.recorder && typeof rt.recorder.start).toBe('function')
    expect(typeof rt.getShadowState).toBe('function')
    expect(typeof rt.setShadowState).toBe('function')
    expect(typeof rt.getCurrentTime).toBe('function')
    expect(typeof rt.pauseVideo).toBe('function')
    expect(typeof rt.seek).toBe('function')

    // (b) wsActuatorsRef was populated (useLayoutEffect ran AFTER useWorkspace)
    // with all five actuators the coordinator calls.
    expect(rt.wsActuatorsRef).toBeTruthy()
    expect(rt.wsActuatorsRef.current).toBeTruthy()
    for (const k of ['restoreWorkspace', 'resumeFromBoundary', 'deactivateWorkspace', 'countdownThenPlay', 'getWorkspaceSnapshot']) {
      expect(typeof rt.wsActuatorsRef.current[k]).toBe('function')
    }

    // (c) useWorkspace received the loop-callbacks at positions 4/5/6.
    // Positions 4 (onLoopBoundary) and 6 (onLoopRestart) are now handed STABLE
    // WRAPPERS (useCallback) — position 4 flips `analyzing` on an armed boundary
    // then delegates to runtime.onLoopBoundary; position 6 increments the ab_loop
    // telemetry tracker (noteRestart) then delegates to runtime.onLoopRestart
    // (runtime FIRST — recorder re-arm must not depend on telemetry). Both are
    // functions but NOT the raw runtime identities. Position 5 stays raw.
    const wa = wsWrap.lastArgs!
    expect(typeof wa[4]).toBe('function')
    expect(wa[4]).not.toBe(rtWrap.lastReturn.onLoopBoundary)
    expect(wa[5]).toBe(rtWrap.lastReturn.shouldPauseAtBoundary)
    expect(typeof wa[6]).toBe('function')
    expect(wa[6]).not.toBe(rtWrap.lastReturn.onLoopRestart)
  })

  it('Срез A: the revived pill mounts no card until armed and there is NO V1 record surface anywhere; the runtime S-arm mounts the (record-less, hands-free) card', async () => {
    const { getByTitle, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    expect(queryByTestId('shadow-card')).toBeNull()

    // Срез A (п.1): pill present (revived), but nothing armed yet → no card,
    // and no V1 record button anywhere.
    expect(getByTitle('Старт Шадоуинг')).toBeTruthy()
    expect(queryByTestId('shadow-card')).toBeNull()
    expect(queryByTestId('shadow-record')).toBeNull()

    // Runtime S-arm mounts the card — hands-free (п.5): still no V1 record
    // surface, and the rec-strip's Стоп is present instead.
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    act(() => { fireEvent.keyDown(document, { key: 's', code: 'KeyS' }) })
    expect(queryByTestId('shadow-card')).toBeTruthy()
    expect(queryByTestId('shadow-record')).toBeNull()
    expect(queryByTestId('shadow-stop')).toBeTruthy()
  })

  // S3-2-fix CRIT regression, UPDATED by S3-6b: originally this proved the
  // active-gate on PlayerPage's recorder adapter kept the mic closed while
  // inactive but let it OPEN once active (the runtime's recorder slot held a
  // real `ShadowRecorder` back then). S3-6b replaces that slot with a NO-OP
  // (`shadowRecorderAdapter` body, PlayerPage.tsx) — real mic/streaming is now
  // phase (ii) (S3-10) — so the correct invariant today is stronger: this
  // path NEVER opens the mic, regardless of `active`. The gate itself is kept
  // in the source (harmless, moot, see the S3-6b comment) rather than
  // removed, so this test still drives BOTH the inactive and the active
  // branch of it to prove neither one reaches `ShadowRecorder`.
  //
  // This drives the REAL useWorkspace driver (setABLoop + the real
  // _boundaryTickForTest reachBoundary path — the same test-seam
  // useWorkspace.actuators.test.ts uses), not runtime.onLoopRestart() called
  // directly, so it actually reproduces "an ordinary user spins a native A-B
  // loop" rather than poking the runtime's internal callback in isolation.
  it('S3-6b: an ordinary native A-B loop restart never opens the real mic through the runtime recorder slot — neither inactive nor active (phase (i) no-op)', async () => {
    render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    await waitFor(() => { expect(wsWrap.lastReturn).toBeTruthy() })
    await waitFor(() => { expect(ssWrap.lastReturn).toBeTruthy() })

    // Ordinary user: sets a plain A-B loop over cue #0 [0,2). V1 shadowing
    // pill is NEVER clicked and ShadowState.active starts false (useShadowState
    // INITIAL_SHADOW_STATE) — nothing in current production sets it true, this
    // is exactly "shadowing not in use".
    expect(ssWrap.lastReturn!.getShadowState().active).toBe(false)
    act(() => {
      wsWrap.lastReturn!.setABLoop(0, 2)
      wsWrap.lastReturn!.setPauseAtEnd(0) // 0 → resume() fires synchronously, no countdown wait
    })

    // Drive the boundary through the REAL driver (native path: nothing armed
    // ⇒ coordinator.shouldPauseAtBoundary() is false ⇒ useWorkspace takes the
    // seek(A)+resume() native branch, which calls onLoopRestart — same as any
    // ordinary A-B loop iteration on this codebase today).
    act(() => {
      mockAdapterHolder.adapter._setTime(2.01)
      wsWrap.lastReturn!._boundaryTickForTest()
    })

    expect(shadowRecorderStartHolder.count).toBe(0) // mic never opened while inactive

    // Release the driver's restartingRef guard (useWorkspace.ts:352-365) the
    // same way a real player would: currentTime actually lands back near A
    // once the seek(A) from the restart above is reflected, so the rAF
    // boundary-driver's clearMargin check fires and re-arms the monitor for
    // the next loop iteration.
    act(() => { mockAdapterHolder.adapter._setTime(0) })
    await waitTwoAnimationFrames()

    // Now flip ShadowState.active true directly (isolates THIS gate from the
    // S3-6b activate-on-arm wiring, which is covered by its own describe
    // block below) and restart the loop again — S3-6b: the no-op recorder
    // must swallow this too, mic still never opens.
    act(() => { ssWrap.lastReturn!.setShadowState({ active: true }) })
    act(() => {
      mockAdapterHolder.adapter._setTime(2.01)
      wsWrap.lastReturn!._boundaryTickForTest()
    })

    expect(shadowRecorderStartHolder.count).toBe(0) // S3-6b: still 0 — no-op even while active
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// S3-2: assembled runtime seam driven end-to-end (harness mirrors PlayerPage's
// exact wiring). Proves the MOUNTED flow: arm → boundary → FakeAnswerSource →
// stub evaluate → verdict → hold/advance matrix, with the ws actuators actually
// invoked through the forward-ref. No DOM affordance drives the runtime in
// PlayerPage yet (S key = S3-6), so this is the honest way to exercise the seam.
// ─────────────────────────────────────────────────────────────────────────────
const HARNESS_CUES = [
  { start: 0, end: 2, text_en: 'hello world', text_ru: 'привет мир' },
  { start: 2, end: 4, text_en: 'second cue', text_ru: 'вторая реплика' },
]

interface HarnessApi {
  runtime: ReturnType<typeof useShadowRuntime>
  ws: WorkspaceApi
  setShadowState: (patch: Record<string, unknown>) => void
  answerSource: FakeAnswerSource
  recorderStart: ReturnType<typeof vi.fn>
  actuator: { restore: unknown[]; resume: string[]; deactivate: number; countdown: number[] }
}

function ShadowSeamHarness({ apiRef }: { apiRef: { current: HarnessApi | null } }) {
  const [adapter] = useState(() => makeFakeAdapter({ t: 1, duration: 120 }))
  const { getShadowState, setShadowState } = useShadowState()
  const wsActuatorsRef = useRef<ShadowRuntimeWorkspaceActuators | null>(null)
  const answerSource = useMemo(() => new FakeAnswerSource({ canonicalText: 'hello world' }), [])
  const recorderStart = useMemo(() => vi.fn(), [])
  const actuator = useMemo(() => ({ restore: [] as unknown[], resume: [] as string[], deactivate: 0, countdown: [] as number[] }), [])
  const evaluate = useCallback<CoordinatorEvaluate>((req) => {
    const { matchPct } = matchWordsDetailed(req.answer, req.target)
    const d: EvaluationDecision = { decision: matchPct >= 80 ? 'pass' : 'retry', score: matchPct, source: 'stub' }
    return Promise.resolve(d)
  }, [])
  const runtime = useShadowRuntime({
    videoId: 'vidH',
    liveCues: HARNESS_CUES,
    currentTime: 1,
    getCurrentTime: () => adapter.currentTime(),
    pauseVideo: () => adapter.pause(),
    seek: (t) => adapter.seek(t),
    getShadowState,
    setShadowState,
    wsActuatorsRef,
    answerSource,
    answerBudgetMs: 3000,
    evaluate,
    recorder: { start: () => { recorderStart() } },
  })
  const ws = useWorkspace(
    adapter, HARNESS_CUES, 'vidH', false,
    runtime.onLoopBoundary, runtime.shouldPauseAtBoundary, runtime.onLoopRestart,
  )
  useLayoutEffect(() => {
    // Same fill as PlayerPage, but with call-through observer spies so the test
    // can assert which actuators the coordinator drove (behaviour is identical —
    // the real ws method runs after each spy records).
    wsActuatorsRef.current = {
      restoreWorkspace: (p) => { actuator.restore.push(p); ws.restoreWorkspace(p) },
      resumeFromBoundary: (a) => { actuator.resume.push(a); ws.resumeFromBoundary(a) },
      deactivateWorkspace: () => { actuator.deactivate++; ws.deactivateWorkspace() },
      countdownThenPlay: (s) => { actuator.countdown.push(s ?? -1); ws.countdownThenPlay(s) },
      getWorkspaceSnapshot: () => ws.getWorkspaceSnapshot(),
    }
  })
  useEffect(() => {
    apiRef.current = { runtime, ws, setShadowState, answerSource, recorderStart, actuator }
  })
  return null
}

describe('S3-2 — assembled runtime seam (harness mirrors PlayerPage wiring)', () => {
  it('arm → boundary → FakeAnswerSource(final) → stub evaluate → PASS → advance (ws.resumeFromBoundary("advance") invoked, verdict is final)', async () => {
    const apiRef: { current: HarnessApi | null } = { current: null }
    render(<ShadowSeamHarness apiRef={apiRef} />)
    await waitFor(() => { expect(apiRef.current).toBeTruthy() })

    // shadow active (coordinator.onLoopBoundary only evals while active) + arm.
    act(() => { apiRef.current!.setShadowState({ active: true }) })
    act(() => { apiRef.current!.runtime.armRange(0, 2) })
    // arm ran through the forward-ref actuators (proves wsActuatorsRef is live).
    expect(apiRef.current!.actuator.restore.length).toBeGreaterThan(0)

    await act(async () => { apiRef.current!.runtime.onLoopBoundary() })

    // FakeAnswerSource was consulted exactly once for this boundary.
    await waitFor(() => { expect(apiRef.current!.answerSource.calls.length).toBe(1) })
    // canonical 'hello world' === target → matchPct 100 → advance branch resumes.
    await waitFor(() => { expect(apiRef.current!.actuator.resume).toContain('advance') })
    // verdict survived to render state as a final outcome (T3 hold-render seam).
    expect(apiRef.current!.runtime.verdictOutcome?.outcome.status).toBe('final')
  })

  it('arm (loop OFF, auto-advance ON) → boundary → no answer → HOLD (runtime.isHeld) — no advance', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const apiRef: { current: HarnessApi | null } = { current: null }
      render(<ShadowSeamHarness apiRef={apiRef} />)
      await waitFor(() => { expect(apiRef.current).toBeTruthy() })

      act(() => { apiRef.current!.setShadowState({ active: true, loopMode: false }) })
      apiRef.current!.answerSource.forceOnce({ status: 'no-response', reason: 'no-audio' })
      act(() => { apiRef.current!.runtime.armRange(0, 2) })

      await act(async () => { apiRef.current!.runtime.onLoopBoundary() })

      // null answer → fail → loop OFF ⇒ HOLD (park at B, wait for user), not advance.
      await waitFor(() => { expect(apiRef.current!.runtime.isHeld()).toBe(true) })
      expect(apiRef.current!.actuator.resume).not.toContain('advance')
    } finally {
      warn.mockRestore()
    }
  })

  it('onLoopRestart re-arms the recorder (recorder.start invoked — T2a rearm-half)', async () => {
    const apiRef: { current: HarnessApi | null } = { current: null }
    render(<ShadowSeamHarness apiRef={apiRef} />)
    await waitFor(() => { expect(apiRef.current).toBeTruthy() })

    act(() => { apiRef.current!.runtime.onLoopRestart() })
    expect(apiRef.current!.recorderStart).toHaveBeenCalledTimes(1)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// S3-4: shadowExercises/onExercise* forwarded from runtime.annotations through
// WorkspacePanel → WorkspacePanelThemed (wiring-map §A #5). Uses the wpWrap
// component spy above to prove REAL identity (not lookalike stubs) and that
// calling the forwarded callbacks really mutates the shared annotations state.
// ─────────────────────────────────────────────────────────────────────────────
const EXERCISE_KEY = 'flib:shadow-exercises:abc123XYZ_1'

function seedExercise(overrides: Partial<ShadowExerciseAnnotation> = {}): ShadowExerciseAnnotation {
  const ex: ShadowExerciseAnnotation = {
    id: 'ex-seed-1',
    startTime: 0,
    endTime: 2,
    anchorMode: 'time-range',
    settings: {
      loopMode: false,
      advanceEnabled: false,
      advanceThreshold: 80,
      mode: 'subtitle',
      saveAudio: false,
      engines: { asr: 'x', check: 'y', ocr: 'z' },
    },
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  }
  localStorage.setItem(EXERCISE_KEY, JSON.stringify([ex]))
  return ex
}

describe('PlayerPage — shadowExercises/onExercise* forwarding (S3-4)', () => {
  it('DORMANT: an ordinary user (no persisted exercises) sees no exercise block, and the real (empty) array reaches WorkspacePanel', async () => {
    // beforeEach already ran localStorage.clear() — no EXERCISE_KEY entry, so
    // runtime.annotations.shadowExercises loads as [] (annotation-store.ts:35,
    // "no key at all = empty, not corrupt").
    const { container } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()

    expect(container.querySelector('[data-shadow-exercise]')).toBeNull()
    await waitFor(() => { expect(wpWrap.lastProps).toBeTruthy() })
    expect(wpWrap.lastProps.shadowExercises).toEqual([])
  })

  it('a persisted exercise reaches the DOM through the real WorkspacePanel→Themed chain (no exercise-block regression)', async () => {
    seedExercise()
    const { container } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()

    await waitFor(() => { expect(container.querySelector('[data-shadow-exercise]')).toBeTruthy() })
  })

  it('onExerciseDelete/onExerciseUpdate handed to WorkspacePanel are the REAL runtime.annotations functions (identity), and calling them mutates the shared state', async () => {
    seedExercise()
    render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    await waitFor(() => { expect(wpWrap.lastProps).toBeTruthy() })
    await waitFor(() => { expect(rtWrap.lastReturn).toBeTruthy() })

    // Identity — not a wrapper/stand-in, the SAME function useAnnotations gave
    // the runtime.
    expect(wpWrap.lastProps.onExerciseDelete).toBe(rtWrap.lastReturn.annotations.deleteShadowExercise)
    expect(wpWrap.lastProps.onExerciseUpdate).toBe(rtWrap.lastReturn.annotations.updateShadowExercise)
    expect(typeof wpWrap.lastProps.onExerciseClick).toBe('function') // S3-4: select-only hook, arm deferred to S3-6

    // Calling the captured onExerciseUpdate really mutates shared annotations
    // state (re-render then refreshes rtWrap.lastReturn via the wrap-real spy).
    act(() => { wpWrap.lastProps.onExerciseUpdate('ex-seed-1', { startTime: 10, endTime: 12 }) })
    await waitFor(() => {
      const ex = rtWrap.lastReturn!.annotations.shadowExercises.find((e: ShadowExerciseAnnotation) => e.id === 'ex-seed-1')
      expect(ex?.startTime).toBe(10)
      expect(ex?.endTime).toBe(12)
    })

    // Calling the captured onExerciseDelete really removes it.
    act(() => { wpWrap.lastProps.onExerciseDelete('ex-seed-1') })
    await waitFor(() => {
      expect(rtWrap.lastReturn!.annotations.shadowExercises.find((e: ShadowExerciseAnnotation) => e.id === 'ex-seed-1')).toBeUndefined()
    })
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// S3-6: клавиша S → runtime.handleShadowKey (arm-путь) — the coordinator runs
// LIVE for the first time (S-арм → петля → фейк-вердикт → hold → оверлей).
// PlayerPage.tsx passes `onShadowKey: onShadowKeyActivateOnArm` (S3-6b wrapper
// around runtime.handleShadowKey) into useHotkeys — useHotkeys' own S-binding/
// isTypingTarget-guard (T4) is unchanged and already covered at the hook
// level (useHotkeys.test.tsx:252-289); these tests prove the WIRING at the
// assembled-PlayerPage level: a real document keydown reaches the REAL
// runtime, arms an ephemeral exercise, and — since S3-6b — reactively flips
// ShadowState.active true (activate-on-arm). The mic stays closed regardless
// (S3-6b: the runtime's recorder slot is a no-op in phase (i) — real
// mic/streaming is phase (ii) S3-10); the coordinator itself is NOT touched
// by either S3-6 or S3-6b.
// ─────────────────────────────────────────────────────────────────────────────
describe('PlayerPage — S key wired to runtime.handleShadowKey (S3-6)', () => {
  it('S on the active subtitle arms an ephemeral exercise via the REAL keyboard wiring (not a direct runtime call), and drives the real useWorkspace AB range', async () => {
    render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames() // activeIndex resolves to cue #0 [0,2) at fixed t=1

    // useWorkspace seeds a fresh video with a default AB of [0, max(5, 1%dur)]
    // (useWorkspace.ts:489, "A=0, B=max(1%·dur,5s)") — at t=1 that default
    // range would itself satisfy handleShadowKey's branch 4 ("playhead INSIDE
    // an active A-B" — arms the WHOLE default seed, not the cue). Clearing it
    // first isolates branch 5 ("outside A-B, ON a subtitle" — arms the cue),
    // which is what this test (and the brief's "S на субтитре → arm") means.
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })

    expect(rtWrap.lastReturn!.getEphemeralArm()).toBeNull() // nothing armed yet

    act(() => { fireEvent.keyDown(document, { key: 's', code: 'KeyS' }) })

    const ex = rtWrap.lastReturn!.getEphemeralArm()
    expect(ex).not.toBeNull()
    expect(ex!.startTime).toBe(0)
    expect(ex!.endTime).toBe(2)
    expect(ex!.anchorMode).toBe('time-range')

    // onArm really drove the wsActuatorsRef → real useWorkspace AB range,
    // proving the S keypress reached all the way through
    // handleShadowKey→armRange→coordinator.onArm→restoreWorkspace, not just
    // an isolated ephemeral-ref write.
    await waitFor(() => {
      expect(wsWrap.lastReturn!.rangeStart).toBe(0)
      expect(wsWrap.lastReturn!.rangeEnd).toBe(2)
    })
  })

  it('S3-6b: after a real S-arm, ShadowState.active reactively flips TRUE (activate-on-arm) — but the real ShadowRecorder.start() (mic) is still never invoked (phase (i) no-op recorder, not the old active-gate)', async () => {
    render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    await waitFor(() => { expect(ssWrap.lastReturn).toBeTruthy() })

    expect(ssWrap.lastReturn!.getShadowState().active).toBe(false) // ordinary user, nothing set it
    act(() => { wsWrap.lastReturn!.setRange(0, 0) }) // escape the fresh-video default AB seed, see test above

    act(() => { fireEvent.keyDown(document, { key: 's', code: 'KeyS' }) })
    const ex = rtWrap.lastReturn!.getEphemeralArm()
    expect(ex).not.toBeNull() // arm really happened

    // S3-6b: activate-on-arm — the real S-keypress (NOT a manual
    // setShadowState call from the test) reactively flips `active` true,
    // because onShadowKeyActivateOnArm (PlayerPage.tsx) re-checks
    // runtime.armedSegmentId() synchronously right after handleShadowKey().
    expect(ssWrap.lastReturn!.getShadowState().active).toBe(true)
    expect(shadowRecorderStartHolder.count).toBe(0) // real mic still never opened

    // Even the natural "next loop restart" after an arm does not reach the
    // mic, and NOT because active is false anymore (S3-6b flips it true) —
    // it's because shadowRecorderAdapter's body (S3-6b, PlayerPage.tsx) is
    // now an unconditional no-op regardless of `active` (real mic/streaming
    // is phase (ii), S3-10).
    act(() => { rtWrap.lastReturn!.onLoopRestart() })
    expect(shadowRecorderStartHolder.count).toBe(0)

    // S3-6b item 5 — разарм → active=false: simulate the runtime tearing
    // down the SAME arm the way natural playhead-exit/advance/complete would
    // (coordinator.onLeave, exposed as runtime.onLeave) — NOT via the S key,
    // proving the catch-all sync effect (PlayerPage.tsx, no deps array) picks
    // up a disarm it did not itself cause, not just the S-key-driven path.
    // The armed exercise defaulted to loopMode:true (INITIAL_SHADOW_STATE) at
    // arm-time, so the coordinator's own onLeave has a loop-transient guard
    // (useShadowLoopCoordinator.ts onLeave: `insideRegion || justPastEnd`)
    // that no-ops a leave call while the LIVE playhead is still genuinely
    // inside [startTime,endTime) — exactly the real-world "spurious leave
    // during a loop restart" case it exists to ignore. Move the fake
    // adapter's clock well past the armed range first (a real user seeking
    // away), so this onLeave call is the genuine "user left" case the guard
    // is supposed to let through.
    mockAdapterHolder.adapter._setTime(10)
    act(() => { rtWrap.lastReturn!.onLeave(ex!.id) })
    expect(rtWrap.lastReturn!.armedSegmentId()).toBeNull() // the coordinator really tore the arm down
    await waitFor(() => { expect(ssWrap.lastReturn!.getShadowState().active).toBe(false) })
  })

  it('fake-demo end-to-end: S-arm → boundary → FakeAnswerSource → stub-evaluate verdict → HOLD (runtime.holding=true, overlay testids render) — real runtime+useWorkspace, mic still never opened', async () => {
    const { queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames() // activeIndex → cue #0 [0,2)

    // `loopMode:false` is a plain ShadowState setting unrelated to
    // activate-on-arm (S3-6b only owns `active`) — required to reach the
    // HOLD branch instead of a plain loop-restart (reduceLoopOutcome: loop ON
    // + fail → 'restart', loop OFF + fail → 'hold'). S3-6b: `active` is
    // DELIBERATELY NOT set here anymore (the old S3-2/S3-6 version of this
    // test flipped it manually) — this is exactly the "БЕЗ ручной установки
    // active" proof the brief asks for; the real S-keypress below must flip
    // it on its own via onShadowKeyActivateOnArm (PlayerPage.tsx).
    act(() => { ssWrap.lastReturn!.setShadowState({ loopMode: false }) })
    act(() => { wsWrap.lastReturn!.setRange(0, 0) }) // escape the fresh-video default AB seed, see test above

    // The actual S keypress — same real document-level wiring as the tests
    // above, arms cue #0 as a non-looping, auto-advance-threshold exercise.
    act(() => { fireEvent.keyDown(document, { key: 's', code: 'KeyS' }) })
    const ex = rtWrap.lastReturn!.getEphemeralArm()
    expect(ex).not.toBeNull()

    // S3-6b: activate-on-arm reactively flipped `active` true off the real
    // S-keypress alone — this is the "играбельность" the coordinator's own
    // active-gate (useShadowLoopCoordinator.ts :661/665/686) requires before
    // the boundary below will actually grade anything.
    expect(ssWrap.lastReturn!.getShadowState().active).toBe(true)

    // Drive the boundary the coordinator itself exposes (onLoopBoundary) —
    // same idiom the S3-2 harness suite above uses ("boundary-tick"); native
    // ws.looping is false here (loopMode:false), so useWorkspace's own
    // reachBoundary()/`_boundaryTickForTest()` would no-op by design (G5's
    // non-looping currentTime-effect is the real driver in production) —
    // calling the coordinator's public onLoopBoundary directly is the
    // documented, deterministic way to exercise this without a real 250ms
    // usePlayerState poll tick.
    await act(async () => { rtWrap.lastReturn!.onLoopBoundary() })

    // FakeAnswerSource (the REAL instance PlayerPage constructed — S3-2
    // wiring proof already established `rt.answerSource` identity above) was
    // actually consulted once for this boundary.
    const answerSource = rtWrap.lastArgs!.answerSource
    await waitFor(() => { expect(answerSource.calls.length).toBe(1) })

    // Default canonical answer ('the quick brown fox') vs the cue's target
    // ('hello world') scores far below the 80% advance threshold → 'retry' →
    // loop OFF ⇒ HOLD, not advance/restart.
    await waitFor(() => { expect(rtWrap.lastReturn!.holding).toBe(true) })
    expect(rtWrap.lastReturn!.verdictOutcome).not.toBeNull()

    // T3 hold-overlay testids actually render (PlayerPage.tsx mounts
    // ShadowHoldOverlay with holding/verdictOutcome straight off the
    // runtime) — the "оверлей показался бы" the brief asks for.
    expect(queryByTestId('shadow-hold-state')).toBeTruthy()
    // ТЗ №6 п.6 [ID:P-tz6]: карта ВИДИМА (armed && !collapsed) → over-video
    // вердикт-слот СКРЫТ (карта сама рисует persistent-B1 — не дублируем «серой
    // дрянью вне карты»). Разбор теперь в карте (shadow-diff), не в слоте.
    expect(queryByTestId('shadow-verdict-slot')).toBeNull()
    expect(queryByTestId('shadow-diff')).toBeTruthy()

    // S3-2-CRIT held throughout the whole fake-demo: no loop-restart ever
    // occurred (outcome was hold, not restart) — the real mic was never
    // opened running this end-to-end fake-phase demo.
    expect(shadowRecorderStartHolder.count).toBe(0)
  })

  it('S while typing (isTypingTarget) does NOT arm — useHotkeys\' own guard (T4) still holds through the new onShadowKey wiring', async () => {
    render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()

    const input = document.createElement('input')
    document.body.appendChild(input)
    input.focus()
    try {
      expect(document.activeElement).toBe(input)
      act(() => { fireEvent.keyDown(document, { key: 's', code: 'KeyS' }) })
      expect(rtWrap.lastReturn!.getEphemeralArm()).toBeNull()
    } finally {
      input.blur()
      document.body.removeChild(input)
    }
  })

  it('regression: Space/ArrowLeft/ArrowRight/B/M/Z still fire without throwing and without accidentally arming shadow (onShadowKey wiring is additive, not a takeover)', async () => {
    const { getByTitle } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()

    // Baseline: AB loop off for the active cue (pre-existing regression-smoke
    // assertion in this file, T5).
    expect(getByTitle('A-B повтор: вкл')).toBeTruthy()

    // B — toggles the AB loop for the active cue (unrelated to S/onShadowKey).
    act(() => { fireEvent.keyDown(document, { key: 'b', code: 'KeyB' }) })
    expect(getByTitle('A-B повтор: выкл')).toBeTruthy()
    act(() => { fireEvent.keyDown(document, { key: 'b', code: 'KeyB' }) }) // toggle back

    // Space/arrows/M/Z must not throw and must not arm shadow themselves —
    // only S (via onShadowKey) is wired to handleShadowKey. (F is deliberately
    // excluded here: real fullscreen requires the Fullscreen API jsdom doesn't
    // implement — F's regression coverage already lives at the hook level,
    // useHotkeys.test.tsx:189-240, with a mocked onToggleFullscreen; that
    // coverage is untouched by S3-6.)
    act(() => { fireEvent.keyDown(document, { key: ' ', code: 'Space' }) })
    act(() => { fireEvent.keyDown(document, { key: 'ArrowLeft', code: 'ArrowLeft' }) })
    act(() => { fireEvent.keyDown(document, { key: 'ArrowRight', code: 'ArrowRight' }) })
    act(() => { fireEvent.keyDown(document, { key: 'm', code: 'KeyM' }) })
    act(() => { fireEvent.keyDown(document, { key: 'z', code: 'KeyZ' }) })

    expect(rtWrap.lastReturn!.getEphemeralArm()).toBeNull() // none of the above arm shadow
    // App still renders/functions (Z toggled the timeline panel closed —
    // same testid the pre-existing T5 collapse test asserts on — proving Z
    // still works end-to-end, not just "didn't throw").
    expect(queryByTestIdFallback()).toBeTruthy()

    function queryByTestIdFallback() {
      // Z above collapsed the timeline panel; its reopen affordance is the
      // concrete, pre-existing proof (T5 test above) that Z's real effect
      // still fires through the unchanged useHotkeys wiring.
      return document.querySelector('[data-testid="timeline-reopen"]')
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Срез A — оживлённая проводка полной ShadowCard (пилюля/R/bind/customText/фазы/
// hands-free/deactivate). Все через РЕАЛЬНЫЙ DOM (клик по пилюле/кнопкам карты,
// keydown R) + реальный runtime/useAnnotations — не моки того, что тестируем.
// ─────────────────────────────────────────────────────────────────────────────
async function armViaPill(getByTitle: (t: string) => HTMLElement) {
  // пилюля неактивна → 'Старт Шадоуинг'; клик = arm-путь S (на активном cue).
  act(() => { fireEvent.click(getByTitle('Старт Шадоуинг')) })
}

describe('PlayerPage — Срез A: пилюля/R/bind/customText/фазы/hands-free', () => {
  it('п.1: клик пилюли на активном cue армит (тот же путь, что S) → active=true, карта монтируется, пилюля → «Стоп Шадоуинг»', async () => {
    const { getByTitle, queryByTitle, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { wsWrap.lastReturn!.setRange(0, 0) }) // escape default AB seed → branch 5 (cue)

    expect(queryByTestId('shadow-card')).toBeNull()
    await armViaPill(getByTitle)

    expect(rtWrap.lastReturn!.getEphemeralArm()).not.toBeNull()
    expect(ssWrap.lastReturn!.getShadowState().active).toBe(true)
    expect(queryByTestId('shadow-card')).toBeTruthy()
    expect(queryByTitle('Стоп Шадоуинг')).toBeTruthy() // title reflects active
  })

  it('п.1: клик активной пилюли («Стоп Шадоуинг») → deactivateShadow: карта уходит, active=false, петля остановлена', async () => {
    const { getByTitle, queryByTitle, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle)
    expect(queryByTestId('shadow-card')).toBeTruthy()

    // Клик активной пилюли (playhead t=1 внутри арма, loopMode default true) —
    // deactivateShadow ungated (runtime.deactivate = setArmedLooping(false)+onLeave).
    act(() => { fireEvent.click(getByTitle('Стоп Шадоуинг')) })
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeNull() })
    expect(rtWrap.lastReturn!.armedSegmentId()).toBeNull()
    expect(ssWrap.lastReturn!.getShadowState().active).toBe(false)
    expect(wsWrap.lastReturn!.looping).toBe(false)
    expect(queryByTitle('Старт Шадоуинг')).toBeTruthy()
  })

  it('edge: клик пилюли ВНЕ cue (нет активного субтитра, AB очищен) → no-op — арм не появился, карта не смонтировалась', async () => {
    const { getByTitle, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    // Уводим playhead в дыру без cue (cues покрывают только [0,4)) + чистим AB.
    act(() => { mockAdapterHolder.adapter._setTime(50) })
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })

    act(() => { fireEvent.click(getByTitle('Старт Шадоуинг')) })

    expect(rtWrap.lastReturn!.getEphemeralArm()).toBeNull() // вне cue/AB = no-op
    expect(ssWrap.lastReturn!.getShadowState().active).toBe(false)
    expect(queryByTestId('shadow-card')).toBeNull()
    expect(shadowRecorderStartHolder.count).toBe(0) // мик не открылся
  })

  it('edge: двойной toggle пилюли (два раздельных клика) — состояние консистентно (арм→разарм, чисто)', async () => {
    const { getByTitle, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })

    act(() => { fireEvent.click(getByTitle('Старт Шадоуинг')) }) // arm
    expect(queryByTestId('shadow-card')).toBeTruthy()
    act(() => { fireEvent.click(getByTitle('Стоп Шадоуинг')) }) // deactivate

    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeNull() })
    expect(rtWrap.lastReturn!.armedSegmentId()).toBeNull()
    expect(ssWrap.lastReturn!.getShadowState().active).toBe(false)
    expect(getByTitle('Старт Шадоуинг')).toBeTruthy()
  })

  it('п.7: клавиша R = тот же toggle, что пилюля (арм → разарм)', async () => {
    const { queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })

    act(() => { fireEvent.keyDown(document, { key: 'r', code: 'KeyR' }) }) // R → arm
    expect(queryByTestId('shadow-card')).toBeTruthy()
    expect(ssWrap.lastReturn!.getShadowState().active).toBe(true)

    act(() => { fireEvent.keyDown(document, { key: 'r', code: 'KeyR' }) }) // R → deactivate
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeNull() })
    expect(rtWrap.lastReturn!.armedSegmentId()).toBeNull()
    expect(ssWrap.lastReturn!.getShadowState().active).toBe(false)
  })

  it('п.2 [M-4]: bind «сейчас» на playhead ВНУТРИ cue → SUBTITLE-anchor (десктоп-канон делегирует, НЕ пишет time-range); «выкл» удаляет', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle) // карта смонтирована
    expect(rtWrap.lastReturn!.annotations.shadowExercises).toEqual([])

    // «сейчас» → bindShadowExerciseAtTime(currentTime=1). t=1 ВНУТРИ cue#0 [0,2)
    // ⇒ M-4/канон: cue-hit → делегирование bindShadowExerciseToCue → SUBTITLE-anchor
    // (ровно отрезок cue), а НЕ time-range на голом времени.
    act(() => { fireEvent.click(getByTestId('shadow-bind-now')) })
    await waitFor(() => {
      const list = rtWrap.lastReturn!.annotations.shadowExercises
      expect(list.length).toBe(1)
      expect(list[0].anchorMode).toBe('subtitle')
      expect(list[0].subIndex).toBe(0)
      expect(list[0].startTime).toBe(0)
      expect(list[0].endTime).toBe(2)
    })

    // «выкл» → удаляет перекрывающее playhead упражнение.
    act(() => { fireEvent.click(getByTestId('shadow-bind-off')) })
    await waitFor(() => { expect(rtWrap.lastReturn!.annotations.shadowExercises).toEqual([]) })
  })

  it('п.2: bind «к субтитру» на одиночном cue → subtitle-anchored упражнение с subIndex активного cue', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle)

    act(() => { fireEvent.click(getByTestId('shadow-bind-sub')) })
    await waitFor(() => {
      const list = rtWrap.lastReturn!.annotations.shadowExercises
      expect(list.length).toBe(1)
      expect(list[0].anchorMode).toBe('subtitle')
      expect(list[0].subIndex).toBe(0) // активный cue #0
      expect(list[0].startTime).toBe(0)
      expect(list[0].endTime).toBe(2)
    })
  })

  it('п.3: customText из right-click меню карты → runtime.setCustomText → dual-write в ShadowState (customText+mode)', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle)

    act(() => { fireEvent.contextMenu(getByTestId('shadow-card')) })
    act(() => { fireEvent.click(getByTestId('shadow-menu-set-customtext')) })
    act(() => { fireEvent.change(getByTestId('shadow-customtext-input'), { target: { value: 'my own text' } }) })
    act(() => { fireEvent.click(getByTestId('shadow-customtext-save')) })

    expect(ssWrap.lastReturn!.getShadowState().customText).toBe('my own text')
    expect(ssWrap.lastReturn!.getShadowState().mode).toBe('custom')
  })

  it('п.4: армленная граница (analyzing-обёртка onLoopBoundary) → карта показывает «Анализ»; приход вердикта сбрасывает analyzing и показывает диф', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { ssWrap.lastReturn!.setShadowState({ loopMode: false }) }) // fail → hold, карта живёт
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle)

    // Гоним границу через ОБЁРТКУ, что PlayerPage отдал useWorkspace (wa[4]) —
    // именно она ставит analyzing=true синхронно на армленной границе.
    act(() => { (wsWrap.lastArgs![4] as () => void)() })
    // Синхронно после обёртки: analyzing=true → фаза 'transcribing' → бейдж «Анализ».
    expect(within(getByTestId('shadow-card')).getByText('Анализ')).toBeTruthy()

    // Вердикт пришёл → analyzing сброшен (эффект по verdictOutcome) → карта
    // показывает диф (shadow-diff, WordChip из lastMarks).
    await waitFor(() => { expect(rtWrap.lastReturn!.verdictOutcome).not.toBeNull() })
    await waitFor(() => {
      expect(within(getByTestId('shadow-card')).queryByTestId('shadow-diff')).toBeTruthy()
    })
  })

  it('п.4 [аудит H1]: на петле ≥2 окно «Анализ» открывается СНОВА — clear предыдущего verdictOutcome (non-null→null) на границе НЕ убивает analyzing в том же коммите', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    // loopMode default TRUE — fail-вердикт даёт 'restart' (петля продолжается,
    // арм цел) — это и есть повторная петля, где H1 воспроизводился.
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle)

    // Петля 1: граница → вердикт (fail → restart), verdictOutcome non-null.
    act(() => { (wsWrap.lastArgs![4] as () => void)() })
    await waitFor(() => { expect(rtWrap.lastReturn!.verdictOutcome).not.toBeNull() })

    // Петля 2: граница. handleLog('loop-boundary') обнуляет verdictOutcome
    // (non-null→null) в ТОМ ЖЕ коммите — до H1-фикса безусловный reset-эффект
    // убивал analyzing мгновенно и бейдж «Анализ» не показывался вовсе.
    act(() => { (wsWrap.lastArgs![4] as () => void)() })
    expect(within(getByTestId('shadow-card')).getByText('Анализ')).toBeTruthy()

    // Дренаж второго eval (чистый unmount без висящих промисов).
    await waitFor(() => { expect(rtWrap.lastReturn!.verdictOutcome).not.toBeNull() })
  })

  it('ТЗ №6 п.2 [ID:P-tz6]: армленная граница при advanceEnabled=false ВСЁ РАВНО грейдит (eval стартует — оцениваем всегда)', async () => {
    // Прежний M2-контракт (advanceEnabled=false → grading off → нет eval) ОТМЕНЁН
    // владельцем: оцениваем и показываем B1 при любом положении автоперехода
    // (setArmedGrading(true) на арме через пилюлю). advanceEnabled управляет только
    // advance/restart. Убери setArmedGrading(true) из onShadowKeyActivateOnArm →
    // grading=false → eval не стартует → isEvalInFlight false (red).
    const { getByTitle } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { ssWrap.lastReturn!.setShadowState({ advanceEnabled: false }) }) // автопереход OFF
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle) // setArmedGrading(true) на арме

    act(() => { (wsWrap.lastArgs![4] as () => void)() })
    // Грейдинговая граница несмотря на выключенный автопереход → eval стартует.
    expect(rtWrap.lastReturn!.isEvalInFlight()).toBe(true)
    // Дренаж eval (иначе act-предупреждения о висящем промисе).
    await waitFor(() => { expect(rtWrap.lastReturn!.verdictOutcome).not.toBeNull() })
  })

  it('edge (п.9): deactivate ВО ВРЕМЯ eval → active НЕ падает в false (нет флика), карта остаётся', async () => {
    const { getByTitle, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { ssWrap.lastReturn!.setShadowState({ loopMode: false }) })
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle)

    // Граница → startEval выставляет evalInFlight СИНХРОННО (до резолва finalizeLoop).
    act(() => { (wsWrap.lastArgs![4] as () => void)() })
    expect(rtWrap.lastReturn!.isEvalInFlight()).toBe(true)

    // Клик «Стоп» во время eval: runtime.deactivate() = no-op (eval owns segment) →
    // armedSegmentId цел → deactivateShadow ставит active=armed(≠null)=true → нет флика.
    act(() => { fireEvent.click(getByTitle('Стоп Шадоуинг')) })
    expect(ssWrap.lastReturn!.getShadowState().active).toBe(true)
    expect(queryByTestId('shadow-card')).toBeTruthy()

    // Дренаж eval (иначе act-предупреждения о висящем промисе).
    await waitFor(() => { expect(rtWrap.lastReturn!.verdictOutcome).not.toBeNull() })
  })

  it('edge: collapse таймлайна при активном арме → карта скрыта, арм цел; reopen → карта назад + пилюля рефлектит active', async () => {
    const { getByTitle, getByTestId, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle)
    expect(queryByTestId('shadow-card')).toBeTruthy()

    act(() => { fireEvent.click(getByTitle('Закрыть')) }) // collapse
    expect(queryByTestId('shadow-card')).toBeNull() // карта скрыта (арм цел)
    expect(rtWrap.lastReturn!.armedSegmentId()).not.toBeNull()

    act(() => { fireEvent.click(getByTestId('timeline-reopen')) }) // reopen
    expect(queryByTestId('shadow-card')).toBeTruthy()
    expect(getByTitle('Стоп Шадоуинг')).toBeTruthy() // пилюля рефлектит active
  })

  it('dormant: обычный юзер (без взаимодействия) — ноль shadow-эффектов (нет карты, мик закрыт), пилюля видима но неактивна', async () => {
    const { getByTitle, container, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()

    expect(queryByTestId('shadow-card')).toBeNull()
    expect(getByTitle('Старт Шадоуинг')).toBeTruthy() // пилюля — осознанное добавление
    expect(ssWrap.lastReturn!.getShadowState().active).toBe(false)
    expect(shadowRecorderStartHolder.count).toBe(0) // мик не открывался
    expect(container.querySelector('[data-shadow-exercise]')).toBeNull()
  })

  // ═══════════════ H-1: реальный matchPct в бейдж ленты ═══════════════
  it('H-1: бейдж последней попытки показывает ВЫЧИСЛЕННЫЙ matchPct (не 0%) — известная пара spoken/target', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { ssWrap.lastReturn!.setShadowState({ loopMode: false }) }) // fail → hold, карта живёт
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle) // арм cue#0 → target 'hello world'

    // Форсим финальный ответ 'hello there' против target 'hello world'.
    // matchWordsDetailed('hello there','hello world').matchPct = 50 (hello ok,
    // there/world → missing+extra) — ИЗВЕСТНОЕ ненулевое значение.
    const answerSource = rtWrap.lastArgs!.answerSource
    answerSource.forceOnce({ status: 'final', text: 'hello there' })
    const expectedPct = matchWordsDetailed('hello there', 'hello world').matchPct
    expect(expectedPct).not.toBe(0) // sanity: пара реально даёт ненулевой процент

    act(() => { (wsWrap.lastArgs![4] as () => void)() }) // граница → eval
    await waitFor(() => { expect(rtWrap.lastReturn!.verdictOutcome).not.toBeNull() })

    // Бейдж ленты показывает ВЫЧИСЛЕННЫЙ процент. До H-1-фикса в карту уходил
    // lastMatchPct:null ⇒ синтез `lastMatchPct ?? 0` рисовал «0%».
    await waitFor(() => {
      expect(within(getByTestId('shadow-card')).getByText(`${expectedPct}%`)).toBeTruthy()
    })
    expect(within(getByTestId('shadow-card')).queryByText('0%')).toBeNull()
  })

  // ═══════════ H1 [фикс-волна C+D]: пустой финал не вырезает реальную попытку ═══════════
  it('H1: ПУСТОЙ финал ПОСЛЕ реальной попытки не рисует фантомный 0% и не прячет реальную строку ленты', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    // loopMode default TRUE → fail-вердикт даёт restart (арм цел между петлями),
    // так что можно прогнать петлю 2 на ТОМ ЖЕ армленном отрезке.
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle) // арм cue#0 → target 'hello world'

    const answerSource = rtWrap.lastArgs!.answerSource
    const pct = matchWordsDetailed('hello there', 'hello world').matchPct // 50
    expect(pct).not.toBe(0)

    // Петля 1: реальный финал 'hello there' → записан (pct%), лента показывает его.
    answerSource.forceOnce({ status: 'final', text: 'hello there' })
    act(() => { (wsWrap.lastArgs![4] as () => void)() })
    await waitFor(() => { expect(readAttemptsA().length).toBe(1) })
    await waitFor(() => {
      expect(within(getByTestId('shadow-card')).getByText(`${pct}%`)).toBeTruthy()
    })

    // Петля 2: ПУСТОЙ финал '' («тишина/таймаут»). Аккумулятор его НЕ пишет
    // (shadow-attempts-accumulate: !text.trim() → return). До H1-фикса
    // shadowCardData синтезировал latest-строку из matchWordsDetailed('',target)
    // (all-missed marks → hasLatest=true) ⇒ ShadowCardLifted historyScored=
    // scored.slice(0,-1) ВЫРЕЗАЛ реальную попытку и рисовал фантомный 0%.
    answerSource.forceOnce({ status: 'final', text: '' })
    act(() => { (wsWrap.lastArgs![4] as () => void)() })
    await waitFor(() => { expect(rtWrap.lastReturn!.verdictOutcome).not.toBeNull() })

    // Реальная попытка на месте, фантома 0% нет, лишней записи нет.
    const card = getByTestId('shadow-card')
    expect(within(card).getByText(`${pct}%`)).toBeTruthy()
    expect(within(card).queryByText('0%')).toBeNull()
    expect(readAttemptsA().length).toBe(1)
  })

  // ═══════════════ M-1: честный display-target «ОЖИДАЕТСЯ» ═══════════════
  it('M-1: custom-режим ДО первого вердикта — «ОЖИДАЕТСЯ» показывает customText, а не активный cue', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle)

    // customText через dual-write (mode:'custom'), НИ ОДНОГО вердикта ещё нет.
    act(() => { ssWrap.lastReturn!.setShadowState({ customText: 'my own reference', mode: 'custom' }) })

    const card = getByTestId('shadow-card')
    // Панель «ОЖИДАЕТСЯ» показывает customText, а не 'hello world' (активный cue).
    expect(within(card).getByText('my own reference')).toBeTruthy()
    expect(within(card).queryByText('hello world')).toBeNull()
  })

  it('M-1: A-B арм на 2 cue → «ОЖИДАЕТСЯ» показывает текст ОБОИХ cue (не одного активного)', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()

    // A-B луп поверх ОБОИХ cue [0,4) + playhead t=1 внутри → пилюля армит весь A-B.
    act(() => { wsWrap.lastReturn!.setABLoop(0, 4) })
    await armViaPill(getByTitle)
    const ex = rtWrap.lastReturn!.getEphemeralArm()
    expect(ex).not.toBeNull()
    expect(ex!.startTime).toBe(0)
    expect(ex!.endTime).toBe(4)

    // display-target = cuesIntersectingRange([0,4)) = оба cue, склеены.
    const card = getByTestId('shadow-card')
    expect(within(card).getByText('hello world second cue')).toBeTruthy()
  })

  // ═══════════════ M-4 / M-7a: onAnchorDrop → bindShadowExerciseAtTime (канон) ═══════════════
  it('M-4/M-7a: drop якоря в cue → SUBTITLE-anchor (реальный persist через onAnchorDrop-проводку)', async () => {
    const bar = { left: 200, top: 800, right: 1200, bottom: 900, width: 1000, height: 100 }
    const rect = { ...bar, x: bar.left, y: bar.top, toJSON: () => bar } as DOMRect
    const grbcSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-workspace-bar') ? rect : ({ ...rect, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect)
    })
    try {
      const { getByTitle, getByTestId } = render(
        <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
      )
      await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
      await waitTwoAnimationFrames()
      act(() => { wsWrap.lastReturn!.setRange(0, 0) })
      await armViaPill(getByTitle)
      act(() => { wsWrap.lastReturn!.setView(0, 4) }) // VIEW-окно [0,4]

      const grip = within(getByTestId('shadow-card')).getByTestId('shadow-bind-anchor-grip')
      await waitFor(() => { expect(rtWrap.lastReturn).toBeTruthy() })
      // frac=(450-200)/1000=0.25 → dropTime=0+0.25*4=1.0 → ВНУТРИ cue#0 [0,2).
      act(() => { fireEvent.pointerDown(grip, { clientX: 200, clientY: 850, pointerId: 1 }) })
      act(() => { fireEvent.pointerUp(grip, { clientX: 450, clientY: 850, pointerId: 1 }) })

      await waitFor(() => {
        const list = rtWrap.lastReturn!.annotations.shadowExercises
        expect(list.length).toBe(1)
        expect(list[0].anchorMode).toBe('subtitle') // cue-hit делегирует
        expect(list[0].subIndex).toBe(0)
      })
    } finally { grbcSpy.mockRestore() }
  })

  it('M-4/M-7a: drop якоря в ДЫРУ (нет cue) → time-range с мин-длиной 5с (endTime=start+5)', async () => {
    const bar = { left: 200, top: 800, right: 1200, bottom: 900, width: 1000, height: 100 }
    const rect = { ...bar, x: bar.left, y: bar.top, toJSON: () => bar } as DOMRect
    const grbcSpy = vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-workspace-bar') ? rect : ({ ...rect, left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 } as DOMRect)
    })
    try {
      const { getByTitle, getByTestId } = render(
        <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
      )
      await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
      await waitTwoAnimationFrames()
      act(() => { wsWrap.lastReturn!.setRange(0, 0) })
      await armViaPill(getByTitle)
      act(() => { wsWrap.lastReturn!.setView(10, 20) }) // VIEW-окно в дыре (cues только [0,4))

      const grip = within(getByTestId('shadow-card')).getByTestId('shadow-bind-anchor-grip')
      await waitFor(() => { expect(rtWrap.lastReturn).toBeTruthy() })
      // frac=0.5 → dropTime=10+0.5*10=15 → нет cue, нет nextCue → time-range,
      // endTime = max(fallback, start+5) = start+5 = 20 (мин-длина 5с).
      act(() => { fireEvent.pointerDown(grip, { clientX: 200, clientY: 850, pointerId: 1 }) })
      act(() => { fireEvent.pointerUp(grip, { clientX: 700, clientY: 850, pointerId: 1 }) })

      await waitFor(() => {
        const list = rtWrap.lastReturn!.annotations.shadowExercises
        expect(list.length).toBe(1)
        expect(list[0].anchorMode).toBe('time-range')
        expect(list[0].startTime).toBe(15)
        expect(list[0].endTime).toBe(20) // клампнуто к start+5
      })
    } finally { grbcSpy.mockRestore() }
  })

  // ═══════════════ M-5: гейт «к субтитру» по активности лупа ═══════════════
  it('M-5: «к субтитру» при ВЫКЛЮЧЕННОМ лупе (залежавшийся range) → одиночный cue (subtitle-anchor), НЕ time-range', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { ssWrap.lastReturn!.setShadowState({ loopMode: false }) }) // арм без включения лупа
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle) // ephemeral-арм cue#0 (луп НЕ включён)

    // Залежавшийся многоcue-range БЕЗ активного лупа: rangeEnd>rangeStart, но
    // ws.looping=false. До M-5 это ошибочно уходило в time-range всего диапазона.
    act(() => { wsWrap.lastReturn!.setRange(0, 4) })
    expect(wsWrap.lastReturn!.looping).toBe(false)

    act(() => { fireEvent.click(getByTestId('shadow-bind-sub')) })
    await waitFor(() => {
      const list = rtWrap.lastReturn!.annotations.shadowExercises
      expect(list.length).toBe(1)
      expect(list[0].anchorMode).toBe('subtitle') // одиночный активный cue, НЕ range
      expect(list[0].subIndex).toBe(0)
    })
  })

  // ═══════════════ M-7b: сброс залипшего analyzing на разарме ═══════════════
  it('M-7b: залипший «Анализ» (stale-вердикт) сбрасывается на разарме и НЕ протекает в следующий арм', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const { getByTitle, getByTestId, queryByTestId } = render(
        <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
      )
      await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
      await waitTwoAnimationFrames()
      act(() => { ssWrap.lastReturn!.setShadowState({ loopMode: false }) }) // fail → hold, карта живёт
      act(() => { wsWrap.lastReturn!.setRange(0, 0) })
      await armViaPill(getByTitle) // арм cue#0 [0,2]

      // Граница на cue#0 → analyzing=true (eval#1 в полёте).
      act(() => { (wsWrap.lastArgs![4] as () => void)() })
      expect(rtWrap.lastReturn!.isEvalInFlight()).toBe(true)
      expect(within(getByTestId('shadow-card')).getByText('Анализ')).toBeTruthy()

      // Супер-арм cue#1 [2,4] мид-eval → исход eval#1 (cue#0) становится STALE
      // ⇒ verdictOutcome остаётся null ⇒ эффект-по-verdictOutcome НЕ сбрасывает
      // analyzing. Флаг «Анализ» ЗАЛИПАЕТ true.
      act(() => { mockAdapterHolder.adapter._setTime(3) })
      act(() => { rtWrap.lastReturn!.armRange(2, 4) })
      // Дренаж eval#1 (stale) — verdictOutcome должен остаться null.
      await waitFor(() => { expect(rtWrap.lastReturn!.isEvalInFlight()).toBe(false) })
      expect(rtWrap.lastReturn!.verdictOutcome).toBeNull()
      expect(within(getByTestId('shadow-card')).getByText('Анализ')).toBeTruthy() // залип

      // Разарм cue#1 (playhead t=3 внутри, eval НЕ в полёте) → deactivateShadow:
      // реальный разарм ⇒ setAnalyzing(false) (стр.347) + active→false (стр.306).
      act(() => { fireEvent.click(getByTitle('Стоп Шадоуинг')) })
      await waitFor(() => { expect(queryByTestId('shadow-card')).toBeNull() })
      expect(rtWrap.lastReturn!.armedSegmentId()).toBeNull()

      // Следующий арм cue#0 → карта НЕ должна показывать «Анализ» (analyzing сброшен).
      act(() => { mockAdapterHolder.adapter._setTime(1) })
      act(() => { wsWrap.lastReturn!.setRange(0, 0) })
      await armViaPill(getByTitle)
      expect(within(getByTestId('shadow-card')).queryByText('Анализ')).toBeNull()
    } finally { warn.mockRestore() }
  })

  // ═══════════════ M-7c: rec-таймер (интервал + сброс на закрытии мика) ═══════════════
  it('M-7c: rec-таймер тикает посекундно пока мик открыт (3с → «0:03») и обнуляется на закрытии мика', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle)
    // Уводим bindTC в '—' (bind:'off'), иначе subStart-таймкод cue#0 (0:00)
    // коллизирует с rec-таймером «0:00» при запросе по тексту.
    act(() => { ssWrap.lastReturn!.setShadowState({ bind: 'off' }) })
    expect(micStreamHolder.onAnalyser).toBeTruthy() // capture-мок захватил колбэк

    // getContext('2d') в jsdom → null ⇒ Oscillograph рано выходит, rAF-петли нет.
    const fakeAnalyser = { frequencyBinCount: 8, getByteFrequencyData: () => {} } as unknown as AnalyserNode

    vi.useFakeTimers()
    try {
      // Открываем мик → фаза 'recording', создаётся setInterval (уже под fake timers).
      act(() => { micStreamHolder.onAnalyser!(fakeAnalyser) })
      const card = getByTestId('shadow-card')
      expect(within(card).getByText('0:00')).toBeTruthy() // старт таймера

      act(() => { vi.advanceTimersByTime(3000) }) // 3 тика
      expect(within(getByTestId('shadow-card')).getByText('0:03')).toBeTruthy()

      // Закрытие мика → эффект-cleanup: clearInterval + setRecElapsed(0), фаза → idle.
      act(() => { micStreamHolder.onAnalyser!(null) })
      // Дальнейшее продвижение времени не наращивает счётчик (интервал снят).
      act(() => { vi.advanceTimersByTime(5000) })
      expect(within(getByTestId('shadow-card')).queryByText('0:03')).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Fix-wave среза B [ID:P-B-fix] — HIGH-1 (loop-канон setLoopModeLive), M1 (шов
// settingsRow-хендлеров), HIGH-2 (textarea без мод-флипа). ВСЕ через РЕАЛЬНЫЙ
// PlayerPage (real useWorkspace+useShadowRuntime+useShadowLoopCoordinator), чтобы
// мутация исходного хендлера ловилась. Паттерн монтажа/арма — как выше (armViaPill).
// ─────────────────────────────────────────────────────────────────────────────
describe('PlayerPage fix-wave B — loop-канон + шов хендлеров (HIGH-1/M1/HIGH-2)', () => {
  // Смонтировать PlayerPage, засеять ShadowState (ДО арма — armRange копирует
  // state → ephemeral.settings) и заармить cue#0 [0,2) через пилюлю.
  async function mountAndArm(getByTitle: (t: string) => HTMLElement, preState: Record<string, unknown> = {}) {
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    await waitFor(() => { expect(ssWrap.lastReturn).toBeTruthy() })
    await waitFor(() => { expect(wsWrap.lastReturn).toBeTruthy() })
    if (Object.keys(preState).length) act(() => { ssWrap.lastReturn!.setShadowState(preState) })
    act(() => { wsWrap.lastReturn!.setRange(0, 0) }) // escape default AB seed → arm cue
    await armViaPill(getByTitle)
    expect(rtWrap.lastReturn!.armedSegmentId()).not.toBeNull()
  }

  it('HIGH-1(a): chip OFF на АРМЛЕННОЙ no-grade петле реально снимает ws-петлю (ws.looping true→false)', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    // advanceEnabled:false → no-grade; loopMode:true (дефолт) → петлевой арм.
    await mountAndArm(getByTitle, { advanceEnabled: false })
    // Армленный петлевой отрезок → useWorkspace крутит реальную петлю.
    expect(wsWrap.lastReturn!.looping).toBe(true)

    // Chip OFF (settings.loopMode=true → onLoopModeChange(false)). ТЗ №3 п.4:
    // settings-row живёт в баре (training-inline-panel), не в карте.
    act(() => { fireEvent.click(within(getByTestId('training-inline-panel')).getByTestId('shadow-loop-toggle')) })

    // ФИКС: ws.stopLoop() снял реальную петлю (раньше крутилась вечно).
    await waitFor(() => { expect(wsWrap.lastReturn!.looping).toBe(false) })
    // armedLoopingRef синкнут (петлевой↔непетлевой гарды консистентны).
  })

  it('HIGH-1(b): chip ON на АРМЛЕННОМ непетлевом grading-отрезке запускает реальную петлю → граница ГРЕЙДИТ (verdict), а не молчит', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    // loopMode:false; advanceEnabled:true + threshold 80 (дефолт) → grading НЕпетлевой.
    await mountAndArm(getByTitle, { loopMode: false })
    // Непетлевой grading → useWorkspace паркуется у B, реальной петли НЕТ.
    expect(wsWrap.lastReturn!.looping).toBe(false)

    // Chip ON (settings.loopMode=false → onLoopModeChange(true)). ТЗ №3 п.4: бар.
    act(() => { fireEvent.click(within(getByTestId('training-inline-panel')).getByTestId('shadow-loop-toggle')) })
    // ФИКС: ws.setABLoop завёл реальную петлю (раньше оставалась false, а
    // setArmedLooping(true) блокировал G5 → конец отрезка без оценки вовсе).
    await waitFor(() => { expect(wsWrap.lastReturn!.looping).toBe(true) })

    // Гоним реальную ws-границу → onLoopBoundary (петлевой grading) запускает eval.
    await act(async () => {
      mockAdapterHolder.adapter._setTime(2.01)
      wsWrap.lastReturn!._boundaryTickForTest()
      await Promise.resolve(); await Promise.resolve()
    })
    // Оценка ДОЕХАЛА (без ws.setABLoop петля бы не крутилась И G5 блокирован → verdict null).
    await waitFor(() => { expect(rtWrap.lastReturn!.verdictOutcome).not.toBeNull() })
  })

  it('M1(slider): смена порога через DOM доставляется в АРМЛЕННЫЙ эфемерный отрезок (in-place, канал b)', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await mountAndArm(getByTitle) // дефолт: grading, threshold 80
    expect(rtWrap.lastReturn!.getEphemeralArm()!.settings.advanceThreshold).toBe(80)

    // Двигаем слайдер в DOM → onAdvanceThresholdChange(55).
    act(() => {
      fireEvent.change(within(getByTestId('training-inline-panel')).getByTestId('shadow-advance-slider'), { target: { value: '55' } })
    })

    // deliverArmedSettings (канал b) мутировал held-объект in-place → координатор
    // перечитает 55 на границе (:465/:494). Убери deliverArmedSettings из
    // onAdvanceThresholdChange → останется 80 (red).
    expect(rtWrap.lastReturn!.getEphemeralArm()!.settings.advanceThreshold).toBe(55)
  })

  it('ТЗ №6 п.2 [ID:P-tz6]: выключение АВТОПЕРЕХОД НЕ трогает grading (shouldPauseAtBoundary остаётся true — оцениваем всегда)', async () => {
    // Прежний M1-контракт (тумблер → setArmedGrading) ОТМЕНЁН владельцем: оценка
    // НЕ зависит от автоперехода. grading вкл на арме (setArmedGrading(true)) и
    // тумблер его больше не меняет — B1 показывается при любом положении тумблера.
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await mountAndArm(getByTitle) // арм через пилюлю → setArmedGrading(true)
    // Grading-отрезок → координатор паркуется на границе для оценки.
    expect(rtWrap.lastReturn!.shouldPauseAtBoundary()).toBe(true)

    // Тумблер OFF в DOM → onAdvanceEnabledChange(false). ТЗ №6 п.2: grading НЕ трогаем.
    act(() => { fireEvent.click(within(getByTestId('training-inline-panel')).getByTestId('shadow-advance-toggle')) })

    // ИНВАРИАНТ ТЗ №6 п.2: grading остаётся ВКЛ — граница всё ещё паркуется и
    // оценивает (B1 покажется). Верни setArmedGrading(false) в onAdvanceEnabledChange
    // → станет false (red).
    expect(rtWrap.lastReturn!.shouldPauseAtBoundary()).toBe(true)
  })

  it('HIGH-2: очистка textarea в custom-режиме НЕ выкидывает из custom (поле остаётся, mode=custom); меню Clear → subtitle (контракт цел)', async () => {
    const { getByTitle, getByTestId, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await mountAndArm(getByTitle)

    // Входим в custom-режим ЧИПОМ (единственный легитимный вход/выход mode). ТЗ №3 п.4: чип в баре.
    act(() => { fireEvent.click(within(getByTestId('training-inline-panel')).getByTestId('shadow-mode-toggle')) })
    await waitFor(() => { expect(queryByTestId('shadow-custom-textarea')).toBeTruthy() })
    expect(ssWrap.lastReturn!.getShadowState().mode).toBe('custom')

    // Печать → onCustomTextInput (канал a БЕЗ мод-флипа).
    act(() => { fireEvent.change(getByTestId('shadow-custom-textarea'), { target: { value: 'abc' } }) })
    await waitFor(() => { expect((getByTestId('shadow-custom-textarea') as HTMLTextAreaElement).value).toBe('abc') })
    expect(ssWrap.lastReturn!.getShadowState().mode).toBe('custom')

    // СТИРАЕМ весь текст → БЕЗ фикса runtime.setCustomText('') флипнул бы mode→subtitle
    // и гейт mode==='custom' синхронно размонтировал бы textarea из-под курсора.
    act(() => { fireEvent.change(getByTestId('shadow-custom-textarea'), { target: { value: '' } }) })
    // ФИКС: textarea ОСТАЁТСЯ, mode держится custom (мод меняет только чип).
    expect(queryByTestId('shadow-custom-textarea')).toBeTruthy()
    expect(ssWrap.lastReturn!.getShadowState().mode).toBe('custom')

    // Существующий контракт цел: right-click-меню «Clear» (=runtime.setCustomText(null))
    // ЛЕГИТИМНО флипает mode→subtitle → textarea уходит.
    act(() => { fireEvent.contextMenu(getByTestId('shadow-card')) })
    act(() => { fireEvent.click(getByTestId('shadow-menu-clear-customtext')) })
    await waitFor(() => { expect(queryByTestId('shadow-custom-textarea')).toBeNull() })
    expect(ssWrap.lastReturn!.getShadowState().mode).toBe('subtitle')
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Срез C [ID:P-C] — история попыток из runtime-вердиктов. Аккумулятор-эффект
// (PlayerPage.tsx) пишет ОДНУ запись на КАЖДЫЙ финальный verdictOutcome через
// useShadowAttempts.add() (тот же localStorage-контракт flib:shadow:<videoId>,
// что и V1 — useShadowV1.ts:98/:362). Дедуп по object-identity verdictOutcome
// (AnswerOutcomeEvent не несёт seq — answer-source.ts:203-206 — координатор
// минтит НОВЫЙ объект на каждый setVerdictOutcome).
// ─────────────────────────────────────────────────────────────────────────────
const ATTEMPTS_KEY_A = 'flib:shadow:abc123XYZ_1'
function readAttemptsA(): ShadowAttemptStored[] {
  const raw = localStorage.getItem(ATTEMPTS_KEY_A)
  return raw ? (JSON.parse(raw) as ShadowAttemptStored[]) : []
}

// Nav harness for the videoId-swap test: useNavigate needs Router context
// distinct from PlayerPage itself (a sibling, not inside it) — navigating
// pushes a NEW entry onto the SAME MemoryRouter history, so PlayerPage stays
// mounted (no remount/key change) and only its own useSearchParams()-derived
// `videoId` changes — the honest way to prove useShadowAttempts(videoId) is
// wired to the LIVE reactive value, not frozen at first mount.
function SwapHarness() {
  const navigate = useNavigate()
  return (
    <>
      <button data-testid="nav-swap-b" onClick={() => navigate('/player?v=videoB')}>swap</button>
      <PlayerPage />
    </>
  )
}

describe('PlayerPage — Срез C: история попыток (useShadowAttempts reuse) [ID:P-C]', () => {
  it('final(status=final, непустой текст) → ОДНА запись с честными 8 полями snake_case; cue_index = cue НА МОМЕНТ АРМА, audio-границы 0/0 (записей на вебе нет)', async () => {
    const { getByTitle } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames() // activeIndex → cue #0 [0,2) at fixed t=1
    act(() => { ssWrap.lastReturn!.setShadowState({ loopMode: false }) }) // hold, не advance/disarm
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle) // арм cue#0 → target 'hello world'

    const answerSource = rtWrap.lastArgs!.answerSource
    answerSource.forceOnce({ status: 'final', text: 'hello there' })
    const beforeMs = Date.now()
    act(() => { (wsWrap.lastArgs![4] as () => void)() }) // граница → eval
    await waitFor(() => { expect(rtWrap.lastReturn!.verdictOutcome).not.toBeNull() })

    await waitFor(() => { expect(readAttemptsA().length).toBe(1) })
    const a = readAttemptsA()[0]
    const expected = matchWordsDetailed('hello there', 'hello world')
    expect(a.cue_index).toBe(0) // cue#0 — армили на activeIndex=0
    expect(a.text).toBe('hello there')
    expect(a.match_pct).toBe(Math.round(expected.matchPct))
    expect(a.marks).toEqual(expected.marks)
    expect(a.audio_start_sec).toBe(0) // нет записей на вебе — 0/0 фикс
    expect(a.audio_end_sec).toBe(0)
    expect(typeof a.id).toBe('string')
    expect(a.id.length).toBeGreaterThan(0)
    expect(Date.parse(a.created_at)).toBeGreaterThanOrEqual(beforeMs)
    expect(Object.keys(a).sort()).toEqual(
      ['audio_end_sec', 'audio_start_sec', 'created_at', 'cue_index', 'id', 'marks', 'match_pct', 'text'].sort(),
    )
  })

  it('два final подряд на ОДНОМ армленном отрезке (loop-restart, петля 2) → ДВЕ записи с ОДНИМ cue_index, не перезапись', async () => {
    const { getByTitle } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    // loopMode default TRUE + дефолтный FakeAnswerSource ('the quick brown fox'
    // vs target 'hello world', низкий матч) → 'restart' (тот же паттерн, что
    // аудит-H1 тест выше, :1195-1218): петля продолжается на ТОМ ЖЕ армленном
    // отрезке (armedSegmentId НЕ проходит через null между итерациями) — это
    // конкретный, детерминированно воспроизводимый в jsdom случай «advance/
    // следующая итерация → новый вердикт» из ТЗ; кросс-cue advance (Срез E
    // автостарт ещё не подключён в PlayerPage) здесь не эмулируется.
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle)

    act(() => { (wsWrap.lastArgs![4] as () => void)() }) // петля 1 → final #1
    await waitFor(() => { expect(readAttemptsA().length).toBe(1) })

    act(() => { (wsWrap.lastArgs![4] as () => void)() }) // петля 2 → final #2
    await waitFor(() => { expect(readAttemptsA().length).toBe(2) })

    const [first, second] = readAttemptsA()
    expect(first.id).not.toBe(second.id) // не перезапись — два разных id
    expect(first.cue_index).toBe(0)
    expect(second.cue_index).toBe(0) // тот же арм — тот же cue_index
  })

  it('H2 [фикс-волна]: арм A-B с playhead ВНЕ cue (activeIndex=-1) → cue_index скламплен на первый пересекающий cue, запись НЕ теряется', async () => {
    const { getByTitle } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { ssWrap.lastReturn!.setShadowState({ loopMode: false }) }) // hold, не advance/disarm
    // Playhead t=5 — ЗА последним cue [2,4) ⇒ activeIndex=-1 (пауза без субтитра).
    act(() => { mockAdapterHolder.adapter._setTime(5) })
    await waitTwoAnimationFrames() // дать activeIndex перечитать t=5 → -1
    // A-B [0,10] охватывает playhead t=5 И оба cue [0,4) ⇒ S армит time-range [0,10]
    // (handleShadowKey branch 4: playhead внутри активного A-B).
    act(() => { wsWrap.lastReturn!.setABLoop(0, 10) })
    await armViaPill(getByTitle)
    expect(rtWrap.lastReturn!.armedSegmentId()).not.toBeNull()

    rtWrap.lastArgs!.answerSource.forceOnce({ status: 'final', text: 'hello there' })
    act(() => { (wsWrap.lastArgs![4] as () => void)() })
    await waitFor(() => { expect(readAttemptsA().length).toBe(1) })

    // H2: cue_index скламплен на ПЕРВЫЙ пересекающий армленный отрезок cue (index 0),
    // НЕ activeIndex=-1 — иначе toPanel/merge (a.cue_index<0 continue) выкинули бы
    // запись из ленты навсегда (невидима для пользователя).
    const a = readAttemptsA()[0]
    expect(a.cue_index).toBe(0)
    expect(a.cue_index).toBeGreaterThanOrEqual(0)
  })

  it('final с ПУСТЫМ текстом → НЕ пишет запись (десктоп-канон finalizeLoopRow, useShadow.ts:564-577: тишина/таймаут не создают ложный 0%-ряд)', async () => {
    const { getByTitle } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { ssWrap.lastReturn!.setShadowState({ loopMode: false }) })
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle)

    rtWrap.lastArgs!.answerSource.forceOnce({ status: 'final', text: '' })
    act(() => { (wsWrap.lastArgs![4] as () => void)() })
    await waitFor(() => { expect(rtWrap.lastReturn!.verdictOutcome).not.toBeNull() })

    expect(readAttemptsA().length).toBe(0)
    expect(localStorage.getItem(ATTEMPTS_KEY_A)).toBeNull() // add() never called ⇒ localStorage untouched
  })

  it('StrictMode-двойной эффект аккумулятора НЕ дублирует запись (дедуп по object-identity verdictOutcome)', async () => {
    const { getByTitle } = render(
      <StrictMode>
        <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
      </StrictMode>,
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { ssWrap.lastReturn!.setShadowState({ loopMode: false }) })
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle)

    rtWrap.lastArgs!.answerSource.forceOnce({ status: 'final', text: 'hello there' })
    act(() => { (wsWrap.lastArgs![4] as () => void)() })
    await waitFor(() => { expect(rtWrap.lastReturn!.verdictOutcome).not.toBeNull() })

    await waitFor(() => { expect(readAttemptsA().length).toBe(1) })
    // Дать React ещё пару проходов (двойной StrictMode-инвок эффектов уже
    // случился синхронно в этом же коммите) — количество записей не растёт.
    await waitTwoAnimationFrames()
    expect(readAttemptsA().length).toBe(1)
  })

  it('дормант: обычный юзер (без арма/вердиктов) — localStorage НЕ создаётся', async () => {
    render(<MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>)
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    expect(localStorage.getItem(ATTEMPTS_KEY_A)).toBeNull()
  })

  it('строки истории НЕ кликабельны (нет recordingId — recordings=[] на вебе) — parity-компромисс, зафиксирован тестом', async () => {
    const { getByTitle, getByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><PlayerPage /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { ssWrap.lastReturn!.setShadowState({ loopMode: false }) })
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle)
    rtWrap.lastArgs!.answerSource.forceOnce({ status: 'final', text: 'hello there' })
    act(() => { (wsWrap.lastArgs![4] as () => void)() })
    await waitFor(() => { expect(readAttemptsA().length).toBe(1) })

    const row = within(getByTestId('shadow-card')).getByTestId('shadow-diff')
    expect(row.style.cursor).toBe('default') // recordings=[] ⇒ row.recordingId всегда null

    // video-player-store — module-level singleton (video-player-store.ts),
    // не сбрасывается между тестами файла (другой describe выше пишет в него
    // 'rec-integration-1') — явный сброс, чтобы этот тест не зависел от
    // порядка выполнения соседних it(). Два отдельных renderHook (не один
    // селектор с объектным литералом — GUARD в video-player-store.ts:
    // useSyncExternalStore требует Object.is-стабильный селектор).
    const { result: idResult } = renderHook(() => useVideoPlayerStore(s => s.youTrackRecordingId))
    const { result: setResult } = renderHook(() => useVideoPlayerStore(s => s.setYouTrackRecordingId))
    act(() => { setResult.current(null) })
    expect(idResult.current).toBeNull()
    fireEvent.click(row)
    expect(idResult.current).toBeNull() // клик — no-op, никакая запись не выбирается
  })

  it('Срез C (интеграц-подтверждение): смена videoId в URL — useShadowAttempts(videoId) реактивно переключается на НОВЫЙ бакет, старый бакет цел', async () => {
    const { getByTitle, getByTestId, queryByTestId } = render(
      <MemoryRouter initialEntries={['/player?v=abc123XYZ_1']}><SwapHarness /></MemoryRouter>
    )
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    act(() => { ssWrap.lastReturn!.setShadowState({ loopMode: false }) })
    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle)
    rtWrap.lastArgs!.answerSource.forceOnce({ status: 'final', text: 'hello there' })
    act(() => { (wsWrap.lastArgs![4] as () => void)() })
    await waitFor(() => { expect(readAttemptsA().length).toBe(1) }) // бакет 'abc123XYZ_1'

    // Разарм ДО навигации (иначе пилюля осталась бы «Стоп Шадоуинг» — hold
    // после ниже-порогового вердикта при loopMode:false, тот же M-7b-паттерн).
    act(() => { fireEvent.click(getByTitle('Стоп Шадоуинг')) })
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeNull() })

    // Навигация ВНУТРИ того же смонтированного PlayerPage (нет ремаунта/key-
    // смены) — useSearchParams() отдаёт новый videoId на следующем рендере.
    act(() => { fireEvent.click(getByTestId('nav-swap-b')) })
    await waitTwoAnimationFrames()

    act(() => { wsWrap.lastReturn!.setRange(0, 0) })
    await armViaPill(getByTitle) // арм НА НОВОМ videoId (та же фикстур-разметка cues)
    rtWrap.lastArgs!.answerSource.forceOnce({ status: 'final', text: 'second video answer' })
    act(() => { (wsWrap.lastArgs![4] as () => void)() })

    const readB = () => {
      const raw = localStorage.getItem('flib:shadow:videoB')
      return raw ? (JSON.parse(raw) as ShadowAttemptStored[]) : []
    }
    await waitFor(() => { expect(readB().length).toBe(1) }) // свежая лента для videoB
    // Старый бакет ('abc123XYZ_1') НЕ пострадал от переключения — ни лишней
    // записи, ни потери прежней (сброс живого `live`-состояния — только
    // in-memory, персистированный бакет videoA цел).
    expect(readAttemptsA().length).toBe(1)
  })
})
