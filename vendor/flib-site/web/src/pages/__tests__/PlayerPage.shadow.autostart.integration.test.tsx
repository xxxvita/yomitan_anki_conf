// PlayerPage.shadow.autostart.integration.test.tsx — Срез E [ID:P-E]: proves the
// useShadowAutoStart wiring assembled in PlayerPage actually drives the REAL
// runtime/coordinator by the playhead, end-to-end (not just "props typed
// right"). Autostart watches persisted shadow exercises: playhead entering a
// region arms+activates; a playhead-exit tears down through the GATED
// runtime.onLeave (loop-transient-safe), NOT ungated runtime.deactivate; a
// manual close inside the region suppresses re-arm until the playhead leaves.
//
// Faked seams (jsdom has none): IFrameAdapter → fake adapter with _setTime;
// fetch → canned subtitles; useShadowMicStream → no-op (realtime is off in
// tests anyway). Wrap-real spies on useShadowRuntime/useShadowState/useWorkspace/
// useShadowAutoStart keep the REAL hooks running while recording what PlayerPage
// handed each — so the boundary/carry-2a tests invoke PlayerPage's OWN captured
// autostart callbacks against the real coordinator (prod wiring, not a lookalike).
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, fireEvent, waitFor, act, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { StrictMode } from 'react'
import { PlayerPage } from '../PlayerPage'
import type { WorkspaceApi } from '../../player/hooks/useWorkspace'
import type { ShadowExerciseAnnotation } from '../../player/workspace/panel-types'

const CUES = [
  { start: 0, end: 2, text_en: 'hello world', text_ru: 'привет мир' },
  { start: 2, end: 4, text_en: 'second cue', text_ru: 'вторая реплика' },
]

const VIDEO_ID = 'abc123XYZ_1'
const EXERCISE_KEY = `flib:shadow-exercises:${VIDEO_ID}`

const mockAdapterHolder = vi.hoisted(() => ({ adapter: null as any }))
const rtWrap = vi.hoisted(() => ({ lastReturn: null as any }))
const ssWrap = vi.hoisted(() => ({ lastReturn: null as { getShadowState: () => any; setShadowState: (p: any) => void } | null }))
const wsWrap = vi.hoisted(() => ({ lastReturn: null as WorkspaceApi | null }))
// Срез E: captures the EXACT args PlayerPage handed useShadowAutoStart, so the
// boundary/carry-2a tests can invoke its real onArm/onLeave/deactivate against
// the mounted coordinator — proving prod wiring, not a re-implemented harness.
const asWrap = vi.hoisted(() => ({ lastArgs: null as any }))

vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    // t:1 → inside a seeded exercise region [0,2); duration long enough that a
    // seek to 10 (real-exit test) is well past every region.
    mockAdapterHolder.adapter = makeFakeAdapter({ duration: 120, t: 1 })
    return mockAdapterHolder.adapter
  },
}))

vi.mock('../../player/hooks/useShadowMicStream', () => ({
  useShadowMicStream: () => {},
}))

vi.mock('../../player/hooks/useShadowRuntime', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useShadowRuntime')>()
  return {
    ...actual,
    useShadowRuntime: (args: any) => {
      const r = actual.useShadowRuntime(args)
      rtWrap.lastReturn = r
      return r
    },
  }
})

vi.mock('../../player/hooks/useShadowState', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useShadowState')>()
  return {
    ...actual,
    useShadowState: (...a: unknown[]) => {
      const r = (actual.useShadowState as (...x: unknown[]) => any)(...a)
      ssWrap.lastReturn = r
      return r
    },
  }
})

vi.mock('../../player/hooks/useWorkspace', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useWorkspace')>()
  return {
    ...actual,
    useWorkspace: (...a: unknown[]) => {
      const r = (actual.useWorkspace as (...x: unknown[]) => WorkspaceApi)(...a)
      wsWrap.lastReturn = r
      return r
    },
  }
})

vi.mock('../../player/hooks/useShadowAutoStart', async (importActual) => {
  const actual = await importActual<typeof import('../../player/hooks/useShadowAutoStart')>()
  return {
    ...actual,
    useShadowAutoStart: (args: any) => {
      asWrap.lastArgs = args
      return actual.useShadowAutoStart(args)
    },
  }
})

function seedExercise(overrides: Partial<ShadowExerciseAnnotation> = {}): ShadowExerciseAnnotation {
  const ex: ShadowExerciseAnnotation = {
    id: 'ex-seed-1',
    startTime: 0,
    endTime: 2,
    anchorMode: 'time-range',
    settings: {
      loopMode: true,
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

beforeEach(() => {
  localStorage.clear()
  mockAdapterHolder.adapter = null
  rtWrap.lastReturn = null
  ssWrap.lastReturn = null
  wsWrap.lastReturn = null
  asWrap.lastArgs = null
  vi.stubGlobal('fetch', vi.fn((url: unknown) => {
    const u = String(url)
    if (u.includes('/api/youtube/subtitles')) {
      return Promise.resolve({
        ok: true, status: 200,
        json: async () => ({ video_id: VIDEO_ID, source_language: 'en', cues: CUES }),
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
const sleep = (ms: number) => new Promise(r => setTimeout(r, ms))

function renderPlayer(strict = false) {
  const tree = <MemoryRouter initialEntries={[`/player?v=${VIDEO_ID}`]}><PlayerPage /></MemoryRouter>
  return render(strict ? <StrictMode>{tree}</StrictMode> : tree)
}

describe('Срез E — useShadowAutoStart wired into PlayerPage', () => {
  // ── Dormant: no persisted exercises → the watcher is inert ──────────────
  it('DORMANT: a user with no placed exercises never arms; autostart gets the real (empty) array', async () => {
    renderPlayer()
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()

    // wired with the REAL persisted-exercises array (identity), current time is
    // a number (playerState ticker), shadow inactive.
    expect(asWrap.lastArgs).toBeTruthy()
    expect(asWrap.lastArgs.exercises).toBe(rtWrap.lastReturn.annotations.shadowExercises)
    expect(asWrap.lastArgs.exercises).toEqual([])
    expect(typeof asWrap.lastArgs.currentTime).toBe('number')
    expect(asWrap.lastArgs.shadowActive).toBe(false)

    // Nothing armed, no card, mic never opened (dormant-safe, mic-CRIT S3-2).
    expect(rtWrap.lastReturn.armedSegmentId()).toBeNull()
    expect(ssWrap.lastReturn!.getShadowState().active).toBe(false)
  })

  // ── Persisted arm path: entering a placed region arms the PERSISTED object
  //    via runtime.onArm (exercise.settings), NOT an ephemeral armRange ──────
  it('entering a placed exercise region auto-arms the PERSISTED object (runtime.onArm), not an ephemeral', async () => {
    seedExercise() // looping [0,2]
    renderPlayer()
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })

    // playhead (t=1) is inside [0,2) → autostart arms the persisted exercise.
    await waitFor(() => { expect(rtWrap.lastReturn.armedSegmentId()).toBe('ex-seed-1') })

    // PERSISTED arm (coordinator.armedExerciseRef = the stored object) — NOT an
    // ephemeral armRange (which would set getEphemeralArm() and an 'ephemeral-N'
    // id). This is the whole point of choosing runtime.onArm over armRange.
    expect(rtWrap.lastReturn.getEphemeralArm()).toBeNull()
    expect(rtWrap.lastReturn.armedSegmentId()).toBe('ex-seed-1')

    // activate-on-arm (S3-6b catch-all) flipped active; the AB loop is the
    // exercise's own range.
    await waitFor(() => { expect(ssWrap.lastReturn!.getShadowState().active).toBe(true) })
    expect(wsWrap.lastReturn!.looping).toBe(true)
    expect(wsWrap.lastReturn!.rangeStart).toBe(0)
    expect(wsWrap.lastReturn!.rangeEnd).toBe(2)
  })

  // ── HIGH-1 (фикс-волна final): autostart-arm must SYNC ShadowState from the
  //    persisted exercise.settings (канон useShadow.ts:139-152). Otherwise, after
  //    a page reload (annotations persist, ShadowState resets to INITIAL defaults)
  //    the coordinator grades honestly by ex.settings (thr 60 / customText) while
  //    the UI lies: slider 80%, «ОЖИДАЕТСЯ» shows a subtitle cue. Mutation: strip
  //    the setShadowState sync → slider stays 80, «ОЖИДАЕТСЯ» shows the cue (red). ─
  it('HIGH-1: autostart-arm syncs ShadowState from ex.settings (slider + «ОЖИДАЕТСЯ» honest, not INITIAL defaults)', async () => {
    seedExercise({ settings: {
      loopMode: true, advanceEnabled: true, advanceThreshold: 60,
      mode: 'custom', customText: 'Foo bar', saveAudio: false,
      engines: { asr: 'x', check: 'y', ocr: 'z' },
    } })
    const { getByTestId } = renderPlayer()
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitFor(() => { expect(rtWrap.lastReturn.armedSegmentId()).toBe('ex-seed-1') })
    await waitFor(() => { expect(ssWrap.lastReturn!.getShadowState().active).toBe(true) })

    // State synced from ex.settings — NOT the INITIAL_SHADOW_STATE defaults
    // (advanceThreshold 80, mode 'subtitle').
    await waitFor(() => { expect(ssWrap.lastReturn!.getShadowState().advanceThreshold).toBe(60) })
    expect(ssWrap.lastReturn!.getShadowState().mode).toBe('custom')
    expect(ssWrap.lastReturn!.getShadowState().customText).toBe('Foo bar')

    const card = getByTestId('shadow-card')
    // Slider DOM reflects 60, not the default 80. ТЗ №3 п.4: settings-row в баре.
    expect((within(getByTestId('training-inline-panel')).getByTestId('shadow-advance-slider') as HTMLInputElement).value).toBe('60')
    // «ОЖИДАЕТСЯ» (custom mode) shows the exercise's own customText in the
    // textarea, not a subtitle cue.
    expect((within(card).getByTestId('shadow-custom-textarea') as HTMLTextAreaElement).value).toBe('Foo bar')
    expect(within(card).queryByText('hello world')).toBeNull()
  })

  // ── Loop-boundary survival: the reducer emits 'deactivate' each loop
  //    boundary (t≥endTime for a frame). Exit routed through GATED onLeave keeps
  //    the arm on the justPastEnd transient; the no-op deactivate can't tear it
  //    down. (Fact-check fix: NOT ungated runtime.deactivate.) ────────────────
  it('loop boundary (justPastEnd) → captured onLeave keeps the arm; captured deactivate is a no-op', async () => {
    seedExercise() // looping [0,2]
    renderPlayer()
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitFor(() => { expect(rtWrap.lastReturn.armedSegmentId()).toBe('ex-seed-1') })

    const as = asWrap.lastArgs
    // Playhead momentarily just past endTime (2.3 ∈ [2, 2.5) = LOOP_BOUNDARY_TRANSIENT_S).
    act(() => { mockAdapterHolder.adapter._setTime(2.3) })

    // The no-op deactivate must not touch the arm.
    act(() => { as.deactivate() })
    expect(rtWrap.lastReturn.armedSegmentId()).toBe('ex-seed-1')

    // The gated onLeave hits the coordinator's loop-transient guard (armedLooping
    // && justPastEnd, useShadowLoopCoordinator.ts:427-441) → arm survives, loop
    // intact. If wired to ungated runtime.deactivate this would tear down (red).
    act(() => { as.onLeave('ex-seed-1') })
    expect(rtWrap.lastReturn.armedSegmentId()).toBe('ex-seed-1')
    expect(wsWrap.lastReturn!.looping).toBe(true)
  })

  // ── Genuine playhead-exit: onLeave far outside the region DOES tear down
  //    (proves the gated path isn't a dead no-op). ───────────────────────────
  it('genuine exit (playhead far past region) → captured onLeave tears the arm down', async () => {
    seedExercise() // looping [0,2]
    renderPlayer()
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitFor(() => { expect(rtWrap.lastReturn.armedSegmentId()).toBe('ex-seed-1') })

    const as = asWrap.lastArgs
    act(() => { mockAdapterHolder.adapter._setTime(10) }) // far past [0,2], not a transient
    act(() => { as.onLeave('ex-seed-1') })

    expect(rtWrap.lastReturn.armedSegmentId()).toBeNull()
    await waitFor(() => { expect(ssWrap.lastReturn!.getShadowState().active).toBe(false) })
  })

  // ── carry-2a: the composition onArm mirrors coordinator.onArm's guard —
  //    no re-arm of the SAME id while its eval is in flight (the composition
  //    runtime.onArm clears hold/verdict BEFORE the coordinator's own guard). ──
  it('carry-2a: onArm does NOT re-arm the same id while its eval is in flight', async () => {
    seedExercise({ settings: {
      loopMode: false, advanceEnabled: true, advanceThreshold: 80,
      mode: 'subtitle', saveAudio: false, engines: { asr: 'x', check: 'y', ocr: 'z' },
    } })
    renderPlayer()
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitFor(() => { expect(rtWrap.lastReturn.armedSegmentId()).toBe('ex-seed-1') })

    // Need shadow active so the coordinator grades this boundary (activate-on-arm
    // already flipped it, but assert for clarity).
    await waitFor(() => { expect(ssWrap.lastReturn!.getShadowState().active).toBe(true) })

    // Drive the grading boundary SYNCHRONOUSLY (do NOT await — the answer-seam
    // resolves over real setTimeouts; awaiting would drain the whole eval and
    // clear evalInFlight before we can catch the in-flight window). startEval
    // sets evalInFlight=true synchronously (useShadowLoopCoordinator.ts:466).
    act(() => { rtWrap.lastReturn.onLoopBoundary() })
    expect(rtWrap.lastReturn.isEvalInFlight()).toBe(true)

    const as = asWrap.lastArgs
    const armedEx = rtWrap.lastReturn.annotations.shadowExercises.find((e: ShadowExerciseAnnotation) => e.id === 'ex-seed-1')
    // Re-arm attempt for the SAME id while eval is in flight: the carry-2a guard
    // (isEvalInFlight() && armedSegmentId()===ex.id) returns before touching
    // runtime.onArm — the composition wrapper's clearHold()/setVerdictOutcome(null)
    // never fire mid-eval. The eval stays in flight, the arm undisturbed.
    // (Defense-in-depth: the coordinator's own :336 guard is the second line, so
    // this is an eval-safety assertion, not a strong standalone mutation gate.)
    act(() => { as.onArm(armedEx) })
    expect(rtWrap.lastReturn.isEvalInFlight()).toBe(true)
    expect(rtWrap.lastReturn.armedSegmentId()).toBe('ex-seed-1')

    // MED-4 (фикс-волна E): the ACTUAL damage a broken :501 guard would cause is
    // the composition runtime.onArm's clearHold()/setVerdictOutcome(null) firing
    // MID-eval (they run BEFORE it delegates to coordinator.onArm). Pin that
    // neither the hold nor the verdict churned across the re-arm attempt.
    //
    // TRACE (why removing :501 is NOT red on current code — documented per the
    // review's fallback): with :501 removed, `as.onArm(armedEx)` would fall into
    // runtime.onArm → clearHold()+setVerdictOutcome(null)+coordinator.onArm(ex).
    // But (a) coordinator.onArm's OWN guard (:336, `evalInFlight && armedExercise
    // Ref.id===ex.id`) still returns before re-arming, so armedSegmentId/
    // isEvalInFlight stay put; and (b) at THIS instant (first grading boundary,
    // eval just launched) there is no hold and no verdict yet — those only arise
    // AFTER the eval resolves — so clearHold()/setVerdictOutcome(null) are no-ops
    // here regardless. The composition guard :501 is therefore DEFENSE-IN-DEPTH:
    // it protects a FUTURE state where a live hold/verdict could coexist with an
    // eval window, or a future coordinator without the :336 re-arm guard. Keep it.
    expect(rtWrap.lastReturn.holding).toBe(false)
    expect(rtWrap.lastReturn.verdictOutcome).toBeNull()

    // Drain the async eval so no setTimeout dangles past the test.
    await waitFor(() => { expect(rtWrap.lastReturn.isEvalInFlight()).toBe(false) })
  })

  // ── HIGH-2 (фикс-волна E): deleting the ARMED persisted exercise must DISARM.
  //    onExerciseDelete (timeline ×) / bind-«выкл» call the bare deleteShadow
  //    Exercise; the composition effect detects the armed persisted id vanished
  //    from the store and tears the arm down (ungated runtime.deactivate + sync).
  //    Without it the coordinator holds the arm on the DEAD snapshot via the
  //    loop-transient guard → zombie loop, open mic, card stuck. ─────────────────
  it('HIGH-2: deleting the ARMED persisted exercise disarms it (loop stopped, card hidden)', async () => {
    seedExercise() // looping [0,2]
    const { queryByTestId } = renderPlayer()
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitFor(() => { expect(rtWrap.lastReturn.armedSegmentId()).toBe('ex-seed-1') })
    await waitFor(() => { expect(wsWrap.lastReturn!.looping).toBe(true) })
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeTruthy() })

    // Delete the exercise the user is currently shadowing (× on the timeline lane
    // or bind-«выкл» — both route to runtime.annotations.deleteShadowExercise).
    act(() => { rtWrap.lastReturn.annotations.deleteShadowExercise('ex-seed-1') })

    // Effect fires on the shadowExercises store change → armed persisted id gone
    // → deactivateShadow() → coordinator unarm/endRun + ws.stopLoop + active sync.
    await waitFor(() => { expect(rtWrap.lastReturn.armedSegmentId()).toBeNull() })
    await waitFor(() => { expect(wsWrap.lastReturn!.looping).toBe(false) })
    await waitFor(() => { expect(ssWrap.lastReturn!.getShadowState().active).toBe(false) })
    expect(queryByTestId('shadow-card')).toBeNull()
  })

  // ── HIGH-2 guard: a live EPHEMERAL arm (hands-free S) is NOT killed when some
  //    UNRELATED persisted exercise is deleted. An ephemeral id is NEVER in the
  //    store, so a naive "armed id not in store → teardown" would nuke it on
  //    EVERY store mutation; the getEphemeralArm()!=null guard must skip it. ─────
  it('HIGH-2 guard: deleting a FOREIGN persisted exercise does NOT disarm a live EPHEMERAL arm', async () => {
    // Persisted exercise OUTSIDE the playhead (t=1) so autostart never arms it.
    seedExercise({ id: 'ex-far', startTime: 50, endTime: 52 })
    renderPlayer()
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    expect(rtWrap.lastReturn.armedSegmentId()).toBeNull() // t=1 not in [50,52]

    // Manually create an EPHEMERAL arm (armRange = hands-free S over a ready range).
    act(() => { rtWrap.lastReturn.armRange(1, 1.5) })
    await waitFor(() => { expect(rtWrap.lastReturn.getEphemeralArm()).not.toBeNull() })
    const ephId = rtWrap.lastReturn.armedSegmentId()
    expect(ephId).toMatch(/^ephemeral-/)

    // Delete the UNRELATED persisted exercise → store changes → effect fires. The
    // ephemeral arm's id is never in the store, so getEphemeralArm()!=null skips
    // teardown. Without that guard the ephemeral arm would be torn down here.
    act(() => { rtWrap.lastReturn.annotations.deleteShadowExercise('ex-far') })
    await waitTwoAnimationFrames()

    expect(rtWrap.lastReturn.getEphemeralArm()).not.toBeNull()
    expect(rtWrap.lastReturn.armedSegmentId()).toBe(ephId)
  })

  // ── Suppression: manual close inside a region suppresses re-arm until the
  //    playhead leaves; re-entering after leaving arms again. Wiring proof:
  //    deactivateShadow flips shadowActive false → the reducer suppresses. ─────
  it('manual close inside region suppresses re-arm; leaving + re-entering re-arms', async () => {
    seedExercise() // looping [0,2]
    const { getByTestId, queryByTestId } = renderPlayer()
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitFor(() => { expect(rtWrap.lastReturn.armedSegmentId()).toBe('ex-seed-1') })
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeTruthy() })

    // Manual close (× on the card → deactivateShadow → runtime.deactivate) —
    // arm cleared, active false → reducer sees shadowActive:false while inside →
    // suppression.
    fireEvent.click(getByTestId('shadow-close'))
    await waitFor(() => { expect(rtWrap.lastReturn.armedSegmentId()).toBeNull() })
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeNull() })

    // Still inside the region, playhead nudged (1.5 ∈ [0,2)) → the reducer
    // re-runs but must NOT re-arm (suppressed). Without the manual-close→suppress
    // wiring the card would pop straight back.
    act(() => { mockAdapterHolder.adapter._setTime(1.5) })
    await act(async () => { await sleep(320) }) // let the 250ms playerState poll observe 1.5
    expect(queryByTestId('shadow-card')).toBeNull()
    expect(rtWrap.lastReturn.armedSegmentId()).toBeNull()

    // Leave the region → suppression lifts.
    act(() => { mockAdapterHolder.adapter._setTime(3) })
    await act(async () => { await sleep(320) })
    // Re-enter → auto-arms again (suppression lifted on the way out).
    act(() => { mockAdapterHolder.adapter._setTime(1) })
    await waitFor(() => { expect(rtWrap.lastReturn.armedSegmentId()).toBe('ex-seed-1') }, { timeout: 2000 })
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeTruthy() })
  })

  // ── [P-F-consent] Fake-режим: realtime is OFF in this suite (default env), so
  //    shadowRealtimeEnabled=false → the mic-consent prompt NEVER renders even
  //    when autostart arms. Proves the owner's 2026-07-10 gate is dormant for a
  //    Fake/no-mic user (no prompt, no behavior change). ───────────────────────
  it('Fake-режим: autostart arms but the mic-consent prompt never renders', async () => {
    seedExercise() // looping [0,2], playhead t=1
    const { queryByTestId } = renderPlayer()
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitFor(() => { expect(rtWrap.lastReturn.armedSegmentId()).toBe('ex-seed-1') })
    await waitFor(() => { expect(queryByTestId('shadow-card')).toBeTruthy() })
    // Realtime off → no consent prompt, ever.
    expect(queryByTestId('shadow-mic-consent')).toBeNull()
  })

  // ── StrictMode: the double-mounted effect must not crash a dormant user or
  //    leak an arm. ───────────────────────────────────────────────────────────
  it('StrictMode: dormant user double-mount is inert (no arm, no crash)', async () => {
    renderPlayer(true)
    await waitFor(() => { expect(mockAdapterHolder.adapter).toBeTruthy() })
    await waitTwoAnimationFrames()
    expect(rtWrap.lastReturn.armedSegmentId()).toBeNull()
    expect(asWrap.lastArgs.exercises).toEqual([])
  })
})
