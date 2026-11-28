// web/src/player/hooks/__tests__/useWorkspace.actuators.test.ts
// T0 — coordinator actuators (paritet desktop useWorkspace :320-549): inbound
// onLoopBoundary/shouldPauseAtBoundary gate on reachBoundary, resumeFromBoundary,
// countdownThenPlay, IM9 restoreWorkspace/deactivateWorkspace/getWorkspaceSnapshot.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { createElement, StrictMode } from 'react'
import { renderHook, act } from '@testing-library/react'
import { useWorkspace } from '../useWorkspace'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

const cues = [{ start: 2, end: 4 }]

afterEach(() => {
  vi.useRealTimers()
})

describe('reachBoundary + shouldPauseAtBoundary (grading-gate parity with desktop :320-371)', () => {
  it('boundary reached with shouldPauseAtBoundary=true: pauses, calls onLoopBoundary once, clamps to rangeEnd-0.1, and does NOT seek(A)', () => {
    const a = makeFakeAdapter({ t: 2.5 }) // внутри [2,4] → setABLoop без rewind-seek
    const calls: string[] = []
    a._spy = (m) => calls.push(m)
    const onLoopBoundary = vi.fn()
    const shouldPauseAtBoundary = () => true
    const { result } = renderHook(() =>
      useWorkspace(a, cues, '', false, onLoopBoundary, shouldPauseAtBoundary),
    )
    act(() => { result.current.setABLoop(2, 4) })
    calls.length = 0
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() })

    expect(onLoopBoundary).toHaveBeenCalledTimes(1)
    expect(calls[0]).toBe('pause') // pause happens before the gate decides
    expect(calls).toContain('seek:3.9') // clamp = max(rangeStart, rangeEnd-0.1) = max(2, 3.9)
    expect(calls).not.toContain('seek:2') // NO seek(A) — this is the parity-critical assertion
    expect(calls).not.toContain('play') // parked — hands off to the coordinator, no play either
    expect(result.current.looping).toBe(true) // native !looping guard would otherwise re-fire — untouched
  })

  it('shouldPauseAtBoundary=false (native path, unchanged): seeks to A, no parking', () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const calls: string[] = []
    a._spy = (m) => calls.push(m)
    const onLoopBoundary = vi.fn()
    const { result } = renderHook(() =>
      useWorkspace(a, cues, '', false, onLoopBoundary, () => false),
    )
    act(() => { result.current.setABLoop(2, 4); result.current.setPauseAtEnd(0) })
    calls.length = 0
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() })

    expect(onLoopBoundary).toHaveBeenCalledTimes(1) // still fires — archive happens either way
    expect(calls).toContain('seek:2') // native restart path unchanged
    expect(calls).toContain('play')
  })

  it('failsafe releases the park after exactly 15000ms if the coordinator never resumes: seeks to rangeStart and plays', () => {
    vi.useFakeTimers()
    const a = makeFakeAdapter({ t: 2.5 })
    const calls: string[] = []
    a._spy = (m) => calls.push(m)
    const { result } = renderHook(() =>
      useWorkspace(a, cues, '', false, undefined, () => true),
    )
    act(() => { result.current.setABLoop(2, 4) })
    calls.length = 0
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() })
    expect(calls).not.toContain('play')

    act(() => { vi.advanceTimersByTime(14999) })
    expect(calls).not.toContain('seek:2')
    expect(calls).not.toContain('play') // not yet — must be exactly 15000, not "roughly"

    act(() => { vi.advanceTimersByTime(1) }) // total 15000ms
    expect(calls).toContain('seek:2')
    expect(calls).toContain('play')
  })
})

describe("resumeFromBoundary('advance') — desktop :493-522 parity", () => {
  it('turns looping off and plays forward from B (no seek to A)', () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const calls: string[] = []
    a._spy = (m) => calls.push(m)
    const { result } = renderHook(() =>
      useWorkspace(a, cues, '', false, undefined, () => true),
    )
    act(() => { result.current.setABLoop(2, 4) })
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() }) // parks on B
    calls.length = 0

    act(() => { result.current.resumeFromBoundary('advance') })
    expect(result.current.looping).toBe(false)
    expect(calls).toContain('play')
    expect(calls).not.toContain('seek:2') // advance must NOT seek back to A
  })

  it('boundarySuppressRef blocks an immediate re-fire in the async looping-flip window', () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const onLoopBoundary = vi.fn()
    const { result } = renderHook(() =>
      useWorkspace(a, cues, '', false, onLoopBoundary, () => true),
    )
    act(() => { result.current.setABLoop(2, 4) })
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() }) // parks
    expect(onLoopBoundary).toHaveBeenCalledTimes(1)

    // Same act-batch: resumeFromBoundary flips looping via setState (not yet committed
    // to stateRef when the synchronous test shim below runs) — without boundarySuppressRef
    // this would look like a fresh, still-looping boundary hit and refire onLoopBoundary.
    act(() => {
      result.current.resumeFromBoundary('advance')
      result.current._boundaryTickForTest()
    })
    expect(onLoopBoundary).toHaveBeenCalledTimes(1) // NOT called a second time
    expect(result.current.looping).toBe(false) // flip did commit by the time the batch flushed
  })

  it('does not set the suppress guard when looping was already off (LOW-fix parity: guard would otherwise never release)', () => {
    // FIX4b (fix-wave review): the old assert only checked `looping === false`,
    // which is trivially true here regardless of whether the suppress guard got
    // set (this call never flips `looping`, so it stays false either way — a
    // no-op assertion). boundarySuppressRef is a private ref with no public
    // getter, so we assert through its one observable consequence instead: if
    // resumeFromBoundary('advance') wrongly set boundarySuppressRef=true here
    // (looping was ALREADY false, so the `if (!looping) boundarySuppressRef.
    // current = false` effect never re-fires afterwards — nothing transitions
    // `looping` again to clear it), the guard would stay stuck true FOREVER and
    // silently swallow every future boundary hit (reachBoundary's very first
    // check is `if (boundarySuppressRef.current) return`). Proof: set up a real
    // AB loop afterwards and drive it to the boundary — it must still fire.
    const a = makeFakeAdapter({ t: 2.5 })
    const onLoopBoundary = vi.fn()
    const { result } = renderHook(() => useWorkspace(a, cues, '', false, onLoopBoundary, () => true))
    // No AB loop ever configured — looping stays false throughout this call.
    act(() => { result.current.resumeFromBoundary('advance') })
    expect(result.current.looping).toBe(false)

    // Now actually loop and drive to the boundary — if the guard were stuck
    // true, reachBoundary would silently no-op and onLoopBoundary would never fire.
    act(() => { result.current.setABLoop(2, 4) })
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() })
    expect(onLoopBoundary).toHaveBeenCalledTimes(1) // boundary still enforced, guard not stuck
  })
})

describe('FIX1 (fix-wave review) — park-failsafe re-arms the boundary monitor for short loops', () => {
  it('short loop (B−A <= REARM_MARGIN=0.25s): after the 15000ms park-failsafe degrades to a native restart, the NEXT tick reaching B fires the boundary again (monitor was re-armed, not permanently silenced)', () => {
    vi.useFakeTimers()
    const a = makeFakeAdapter({ t: 2.0 })
    const onLoopBoundary = vi.fn()
    // shouldPauseAtBoundary=true throughout — every hit degrades through the park path,
    // exactly the scenario that used to wedge the monitor forever on a short loop.
    const { result } = renderHook(() =>
      useWorkspace(a, cues, '', false, onLoopBoundary, () => true),
    )
    act(() => { result.current.setABLoop(2, 2.2) }) // B-A = 0.2s <= REARM_MARGIN
    // Sit just under B so the driver's predictive lookahead crosses it on the very
    // next real rAF tick (fake timers advance requestAnimationFrame in this repo,
    // but NOT performance.now() — dtMs floors to 1ms/tick, so `cur` must already be
    // within lookaheadFrames*1ms*rate = 0.002s of the boundary for predictBoundaryCross
    // to fire; this is a test-harness constant, unrelated to the bug/fix under test).
    act(() => { a._setTime(2.199) })
    act(() => { vi.advanceTimersByTime(500) })
    expect(onLoopBoundary).toHaveBeenCalledTimes(1) // first hit: parks (grading-gate)

    // Coordinator never resumes → 15000ms park-failsafe degrades to a native restart
    // (seek(A) + play). Without FIX1 (monitor re-arm here), monitorRef stays
    // `{armed:false,lastBoundary:2.2}` forever — cur(2.19) never satisfies the
    // fallback re-arm test `cur < boundary-0.25` (1.95) — so the boundary can never
    // fire again on this loop.
    act(() => { vi.advanceTimersByTime(15000) })
    act(() => { vi.advanceTimersByTime(500) }) // let a few more driver ticks run post-failsafe

    expect(onLoopBoundary).toHaveBeenCalledTimes(2) // boundary fired again — monitor re-armed
  })
})

describe('FIX2 (fix-wave review) — onLoopRestart sim fires on both web restart finishes (desktop :35/:367/:517 parity)', () => {
  it('native reachBoundary restart-finish calls onLoopRestart right after play (pauseAtEnd=0, immediate)', () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const onLoopRestart = vi.fn()
    const { result } = renderHook(() =>
      useWorkspace(a, cues, '', false, undefined, () => false, onLoopRestart),
    )
    act(() => { result.current.setABLoop(2, 4); result.current.setPauseAtEnd(0) })
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() })
    expect(onLoopRestart).toHaveBeenCalledTimes(1)
  })

  it('native reachBoundary restart-finish calls onLoopRestart only AFTER the countdown completes, not before', () => {
    vi.useFakeTimers()
    const a = makeFakeAdapter({ t: 2.5 })
    const onLoopRestart = vi.fn()
    const { result } = renderHook(() =>
      useWorkspace(a, cues, '', false, undefined, () => false, onLoopRestart),
    )
    act(() => { result.current.setABLoop(2, 4); result.current.setPauseAtEnd(1) })
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() })
    expect(onLoopRestart).not.toHaveBeenCalled() // countdown still pending
    act(() => { vi.advanceTimersByTime(1000) })
    expect(onLoopRestart).toHaveBeenCalledTimes(1)
  })

  it("resumeFromBoundary('restart') calls onLoopRestart right after play (pauseAtEnd=0)", () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const onLoopRestart = vi.fn()
    const { result } = renderHook(() =>
      useWorkspace(a, cues, '', false, undefined, () => true, onLoopRestart),
    )
    act(() => { result.current.setABLoop(2, 4); result.current.setPauseAtEnd(0) })
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() }) // parks
    expect(onLoopRestart).not.toHaveBeenCalled() // parked, not restarted yet
    act(() => { result.current.resumeFromBoundary('restart') })
    expect(onLoopRestart).toHaveBeenCalledTimes(1)
  })

  it("resumeFromBoundary('restart') calls onLoopRestart only AFTER its own countdown completes", () => {
    vi.useFakeTimers()
    const a = makeFakeAdapter({ t: 2.5 })
    const onLoopRestart = vi.fn()
    const { result } = renderHook(() =>
      useWorkspace(a, cues, '', false, undefined, () => true, onLoopRestart),
    )
    act(() => { result.current.setABLoop(2, 4); result.current.setPauseAtEnd(1) })
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() }) // parks
    act(() => { result.current.resumeFromBoundary('restart') })
    expect(onLoopRestart).not.toHaveBeenCalled() // countdown pending
    act(() => { vi.advanceTimersByTime(1000) })
    expect(onLoopRestart).toHaveBeenCalledTimes(1)
  })

  it("resumeFromBoundary('advance') does NOT call onLoopRestart — no restart happens on advance", () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const onLoopRestart = vi.fn()
    const { result } = renderHook(() =>
      useWorkspace(a, cues, '', false, undefined, () => true, onLoopRestart),
    )
    act(() => { result.current.setABLoop(2, 4) })
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() }) // parks
    act(() => { result.current.resumeFromBoundary('advance') })
    expect(onLoopRestart).not.toHaveBeenCalled()
  })

  it('countdownThenPlay (first-arm) does NOT call onLoopRestart — desktop :527 parity, rearm is only for repeats', () => {
    const a = makeFakeAdapter({ t: 0 })
    const onLoopRestart = vi.fn()
    const { result } = renderHook(() =>
      useWorkspace(a, cues, '', false, undefined, undefined, onLoopRestart),
    )
    act(() => { result.current.countdownThenPlay(0) })
    expect(onLoopRestart).not.toHaveBeenCalled()
  })
})

describe("resumeFromBoundary('restart') — desktop :508-521 parity", () => {
  it('seeks to rangeStart, counts down pauseAtEnd, then plays', () => {
    vi.useFakeTimers()
    const a = makeFakeAdapter({ t: 2.5 })
    const calls: string[] = []
    a._spy = (m) => calls.push(m)
    const { result } = renderHook(() => useWorkspace(a, cues, '', false, undefined, () => true))
    act(() => { result.current.setABLoop(2, 4); result.current.setPauseAtEnd(1) })
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() }) // parks
    calls.length = 0

    act(() => { result.current.resumeFromBoundary('restart') })
    expect(calls).toContain('seek:2')
    expect(calls).not.toContain('play') // countdown still pending
    expect(result.current.countdownValue).toBe(1)

    act(() => { vi.advanceTimersByTime(1000) })
    expect(calls).toContain('play')
  })

  it('pauseAtEnd=0 restarts immediately without a countdown', () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const calls: string[] = []
    a._spy = (m) => calls.push(m)
    const { result } = renderHook(() => useWorkspace(a, cues, '', false, undefined, () => true))
    act(() => { result.current.setABLoop(2, 4); result.current.setPauseAtEnd(0) })
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() })
    calls.length = 0

    act(() => { result.current.resumeFromBoundary('restart') })
    expect(calls).toContain('seek:2')
    expect(calls).toContain('play')
    expect(result.current.countdownValue).toBeNull()
  })
})

describe('countdownThenPlay — desktop :529-541 parity', () => {
  it('secs<=0 (override) plays immediately, no pause/countdown', () => {
    const a = makeFakeAdapter({ t: 0 })
    const calls: string[] = []
    a._spy = (m) => calls.push(m)
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => { result.current.countdownThenPlay(0) })
    expect(calls).toEqual(['play'])
    expect(result.current.countdownValue).toBeNull()
  })

  it('secs>0 (override) pauses, counts down, then plays', () => {
    vi.useFakeTimers()
    const a = makeFakeAdapter({ t: 0 })
    const calls: string[] = []
    a._spy = (m) => calls.push(m)
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => { result.current.countdownThenPlay(2) })
    expect(calls).toContain('pause')
    expect(calls).not.toContain('play')
    expect(result.current.countdownValue).toBe(2)

    act(() => { vi.advanceTimersByTime(2000) })
    expect(calls).toContain('play')
  })

  it('falls back to the current pauseAtEnd state when no override is given (first-arm staleness workaround)', () => {
    const a = makeFakeAdapter({ t: 0 })
    const calls: string[] = []
    a._spy = (m) => calls.push(m)
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => { result.current.setPauseAtEnd(0) })
    act(() => { result.current.countdownThenPlay() })
    expect(calls).toEqual(['play'])
  })
})

describe('IM9 — getWorkspaceSnapshot / restoreWorkspace / deactivateWorkspace', () => {
  it('getWorkspaceSnapshot().active is synthesized as rangeEnd>rangeStart (WEB-SEAM contract)', () => {
    // duration:0 → the seed effect's init() bails (d<=0), so the workspace stays
    // at its true zero-state (rangeStart===rangeEnd===0) instead of auto-seeding
    // a default B via the "duration known" path exercised elsewhere.
    const a = makeFakeAdapter({ t: 0, duration: 0 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    expect(result.current.getWorkspaceSnapshot().active).toBe(false) // fresh: 0,0

    act(() => { result.current.setABLoop(2, 4) })
    expect(result.current.getWorkspaceSnapshot().active).toBe(true)

    act(() => { result.current.stopLoop() })
    // AB range is still a passive bookmark (rangeEnd>rangeStart) even with looping off —
    // matches the brief's contract literally (activity = range shape, not the loop flag).
    expect(result.current.getWorkspaceSnapshot().active).toBe(true)
  })

  it('restoreWorkspace atomically sets range/view/looping/pauseAtEnd, clamped to duration, WITHOUT seeking', () => {
    const a = makeFakeAdapter({ t: 0, duration: 10 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => {
      result.current.restoreWorkspace({
        rangeStart: 1, rangeEnd: 3, viewStart: 0, viewEnd: 5, looping: true, pauseAtEnd: 1.5,
      })
    })
    expect(result.current.rangeStart).toBe(1)
    expect(result.current.rangeEnd).toBe(3)
    expect(result.current.viewStart).toBe(0)
    expect(result.current.viewEnd).toBe(5)
    expect(result.current.looping).toBe(true)
    expect(result.current.pauseAtEnd).toBe(1.5)
    expect(a._seekCount).toBe(0) // caller seeks the playhead, restoreWorkspace never does
  })

  it('restoreWorkspace does NOT truncate to an arbitrary 60s when live duration is still unknown (self-review fix)', () => {
    // duration:0 → adapter.duration() reports 0 (not yet resolved, e.g. before
    // YouTube 'ready'). A naive `duration || 60` fallback (ported verbatim from
    // desktop, which has a different, always-nonzero `duration` prop source)
    // would silently clamp a real 90s exercise segment down to 60s here.
    const a = makeFakeAdapter({ t: 0, duration: 0 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => {
      result.current.restoreWorkspace({
        rangeStart: 80, rangeEnd: 90, viewStart: 0, viewEnd: 90, looping: false,
      })
    })
    expect(result.current.rangeEnd).toBe(90) // NOT truncated to 60
    expect(result.current.viewEnd).toBe(90)
  })

  it('restoreWorkspace clamps a saved rangeEnd/viewEnd past the (new, shorter) duration', () => {
    const a = makeFakeAdapter({ t: 0, duration: 5 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => {
      result.current.restoreWorkspace({
        rangeStart: 0, rangeEnd: 20, viewStart: 0, viewEnd: 20, looping: false,
      })
    })
    expect(result.current.rangeEnd).toBe(5)
    expect(result.current.viewEnd).toBeLessThanOrEqual(5)
  })

  it('deactivateWorkspace stops the loop and cancels any pending countdown/failsafe, leaving range/view untouched', () => {
    vi.useFakeTimers()
    const a = makeFakeAdapter({ t: 2.5 })
    const calls: string[] = []
    a._spy = (m) => calls.push(m)
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => { result.current.setABLoop(2, 4); result.current.setPauseAtEnd(1) })
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() }) // native restart, countdown pending
    expect(result.current.countdownValue).toBe(1)
    calls.length = 0

    act(() => { result.current.deactivateWorkspace() })
    expect(result.current.looping).toBe(false)
    expect(result.current.countdownValue).toBeNull()
    expect(result.current.rangeStart).toBe(2) // range/view left as-is — nothing to reset
    expect(result.current.rangeEnd).toBe(4)

    act(() => { vi.advanceTimersByTime(20000) }) // killed failsafe/countdown must not fire play() later
    expect(calls).not.toContain('play')
  })
})

describe('StrictMode safety (web/src/main.tsx:21 mounts the app under React.StrictMode)', () => {
  it('double-mount does not double-fire onLoopBoundary and leaves no dangling failsafe after unmount', () => {
    vi.useFakeTimers()
    const a = makeFakeAdapter({ t: 2.5 })
    const calls: string[] = []
    a._spy = (m) => calls.push(m)
    const onLoopBoundary = vi.fn()
    const { result, unmount } = renderHook(
      () => useWorkspace(a, cues, '', false, onLoopBoundary, () => true),
      { wrapper: ({ children }) => createElement(StrictMode, null, children) },
    )
    act(() => { result.current.setABLoop(2, 4) })
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() })
    expect(onLoopBoundary).toHaveBeenCalledTimes(1)

    calls.length = 0 // FIX4a: only care about adapter activity AFTER unmount from here on
    unmount()
    // The 15000ms park-failsafe must have been cleared on unmount (existing
    // unmount-cleanup effect) — advancing timers past it must not throw or
    // touch the (torn-down) adapter again.
    expect(() => { act(() => { vi.advanceTimersByTime(20000) }) }).not.toThrow()
    // FIX4a (fix-wave review): `not.toThrow()` alone is a weak assert — the fake
    // adapter never throws regardless of whether the failsafe fired, so it passed
    // even with a leaked timer. Assert the actual behavioural consequence: zero
    // adapter calls (no spurious seek(rangeStart)/play()) after unmount — proof
    // the park-failsafe timer was really cleared, not merely non-throwing.
    expect(calls).toEqual([])
  })
})
