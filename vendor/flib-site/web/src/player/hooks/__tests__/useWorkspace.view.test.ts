// web/src/player/hooks/__tests__/useWorkspace.view.test.ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkspace } from '../useWorkspace'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

const cues = [{ start: 0, end: 2 }, { start: 2, end: 4 }]

describe('useWorkspace VIEW/zoom', () => {
  it('V1 REGRESSION: no view until duration is ready, inits on adapter "ready" event (not stale reactive deps)', () => {
    const a = makeFakeAdapter({ duration: 0 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    expect(result.current.viewEnd).toBe(0) // duration unknown → no view yet

    act(() => {
      a._setDuration(600)
      a._emit('ready')
    })
    expect(result.current.viewStart).toBe(0)
    expect(result.current.viewEnd).toBe(600)
  })

  it('default view is the whole clip (Fit) when duration is already known at mount', () => {
    const a = makeFakeAdapter({ duration: 600 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    expect(result.current.viewStart).toBe(0)
    expect(result.current.viewEnd).toBe(600)
  })

  it('default view is the whole clip when shorter than 60s', () => {
    const a = makeFakeAdapter({ duration: 30 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    expect(result.current.viewStart).toBe(0)
    expect(result.current.viewEnd).toBe(30)
  })

  it('setView clamps into [0, duration] with the min-span rule', () => {
    const a = makeFakeAdapter({ duration: 600 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setView(-5, 5000))
    expect(result.current.viewStart).toBe(0)
    expect(result.current.viewEnd).toBe(600)
  })

  it('W1a: pan at viewStart=0 preserves length (wheel-zoom bug) — length is fixed from the request, only position clamps', () => {
    const a = makeFakeAdapter({ duration: 600 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setView(0, 60)) // view [0,60], length 60
    act(() => result.current.setView(-6, 54)) // pan 6s left past the boundary
    expect(result.current.viewStart).toBe(0)
    expect(result.current.viewEnd).toBe(60) // length preserved, NOT [0,54]
  })

  it('W1a: pan at the right boundary preserves length symmetrically', () => {
    const a = makeFakeAdapter({ duration: 600 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setView(540, 600)) // view [540,600], length 60
    act(() => result.current.setView(546, 606)) // pan 6s right past the boundary
    expect(result.current.viewEnd).toBe(600)
    expect(result.current.viewStart).toBe(540) // length preserved, NOT [546,600]
  })

  it('zoom(factor, anchorT) keeps anchorT at the same fractional position', () => {
    const a = makeFakeAdapter({ duration: 600 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    // starting view is [0, 600] (T2: Fit the whole clip by default)
    act(() => result.current.zoom(0.5, 30))
    expect(result.current.viewStart).toBe(15)
    expect(result.current.viewEnd).toBe(315)
  })

  it('fitToRange() = [A - 15%span, B + 15%span] clamped', () => {
    const a = makeFakeAdapter({ duration: 600 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setABLoop(10, 20)) // span=10, pad=1.5
    act(() => result.current.fitToRange())
    expect(result.current.viewStart).toBeCloseTo(8.5)
    expect(result.current.viewEnd).toBeCloseTo(21.5)
  })

  it('V3 REGRESSION: adapter "ready" fires synchronously before subscription (sync emit inside IFrameAdapter\'s constructor-time resolve) — duration still 0 on mount, view must init off a later "state" event instead', () => {
    const a = makeFakeAdapter({ duration: 0 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    expect(result.current.viewEnd).toBe(0) // ready already missed, duration unknown at mount

    act(() => {
      a._setDuration(600)
      a._emit('state', 'playing') // no 'ready' this time — only a 'state' event arrives
    })
    expect(result.current.viewStart).toBe(0)
    expect(result.current.viewEnd).toBe(600)
  })

  it('V2: setRange is side-effect-free — no seek, no forced looping', () => {
    const a = makeFakeAdapter({ duration: 600 })
    a._spy = vi.fn()
    const { result } = renderHook(() => useWorkspace(a, cues))
    expect(result.current.looping).toBe(false)

    act(() => result.current.setRange(2, 5))
    expect(result.current.rangeStart).toBe(2)
    expect(result.current.rangeEnd).toBe(5)
    expect(result.current.looping).toBe(false)
    expect(a._seekCount).toBe(0)
  })
})

describe('useWorkspace setRange clamps to [0,dur] with gap (A3/A6)', () => {
  it('clamps drag past the left edge to 0', () => {
    const a = makeFakeAdapter({ duration: 100 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setRange(-5, 40))
    expect(result.current.rangeStart).toBe(0)
    expect(result.current.rangeEnd).toBe(40)
  })

  it('clamps rubber-band end past duration to dur (subs longer than clip)', () => {
    const a = makeFakeAdapter({ duration: 100 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setRange(90, 500))
    expect(result.current.rangeStart).toBe(90)
    expect(result.current.rangeEnd).toBe(100)
    act(() => result.current.fitToRange())
    expect(result.current.viewEnd).toBeGreaterThan(result.current.viewStart)
  })

  it('un-inverts an inverted rubber-band range (a>b) into ascending, in-bounds', () => {
    const a = makeFakeAdapter({ duration: 100 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setRange(80, 20))
    expect(result.current.rangeStart).toBeGreaterThanOrEqual(0)
    expect(result.current.rangeEnd).toBeLessThanOrEqual(100)
    expect(result.current.rangeEnd).toBeGreaterThanOrEqual(result.current.rangeStart + 0.1)
  })

  it('enforces a 0.1s minimum gap on a zero-length set', () => {
    const a = makeFakeAdapter({ duration: 100 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setRange(50, 50))
    expect(result.current.rangeEnd - result.current.rangeStart).toBeCloseTo(0.2, 5)
  })

  it('M-A: clamps a cue entirely past the end of the video (a,b>dur) instead of inverting', () => {
    const a = makeFakeAdapter({ duration: 100 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => result.current.setRange(150, 155))
    expect(result.current.rangeStart).toBeCloseTo(99.9, 5)
    expect(result.current.rangeEnd).toBe(100)
  })
})
