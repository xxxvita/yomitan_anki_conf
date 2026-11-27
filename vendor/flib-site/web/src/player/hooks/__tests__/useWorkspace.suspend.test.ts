// web/src/player/hooks/__tests__/useWorkspace.suspend.test.ts
// T2-review fix: enforcementSuspended gate on the boundary rAF-driver — desktop
// canon (useWorkspace.ts:384 on the desktop side): hiding the workspace panel is a
// visibility flip ONLY, not a loop-stop. Z/Exit must freeze the boundary driver
// (no seek, looping untouched) while the panel is hidden, and let it resume
// exactly where it left off when the panel reopens.
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkspace } from '../useWorkspace'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

const cues = [{ start: 2, end: 4 }]

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe('useWorkspace enforcementSuspended (T2-review: Z/Exit visibility-flip gate)', () => {
  it('suspended: crossing B does not seek and looping stays ON (frozen, not stopped)', () => {
    const a = makeFakeAdapter({ t: 2.5 }) // внутри [2,4] → setABLoop без rewind-seek
    const { result } = renderHook(
      ({ suspended }) => useWorkspace(a, cues, '', suspended),
      { initialProps: { suspended: true } },
    )
    act(() => { result.current.setABLoop(2, 4) })
    expect(result.current.looping).toBe(true)
    expect(a._seekCount).toBe(0)

    // Playhead crosses B while the panel is hidden (suspended=true).
    act(() => { a._setTime(4.5); result.current._boundaryTickForTest() })
    expect(a._seekCount).toBe(0) // no restart-seek — enforcement suspended
    expect(result.current.looping).toBe(true) // still ON — desktop canon: NOT stopped
  })

  it('resuming (suspended true→false) reawakens enforcement: next tick past B seeks to A', () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const { result, rerender } = renderHook(
      ({ suspended }) => useWorkspace(a, cues, '', suspended),
      { initialProps: { suspended: true } },
    )
    act(() => { result.current.setABLoop(2, 4) })
    act(() => { a._setTime(4.5); result.current._boundaryTickForTest() })
    expect(a._seekCount).toBe(0) // still frozen

    rerender({ suspended: false }) // panel reopens
    act(() => { result.current._boundaryTickForTest() }) // same overshoot, now unsuspended
    expect(a._seekCount).toBe(1) // enforcement woke up and restarted the loop
    expect(result.current.looping).toBe(true) // restart never touches `looping`
  })

  it('default (enforcementSuspended omitted) preserves prior always-on behaviour', () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const { result } = renderHook(() => useWorkspace(a, cues)) // no 4th arg
    act(() => { result.current.setABLoop(2, 4) })
    act(() => { a._setTime(4.5); result.current._boundaryTickForTest() })
    expect(a._seekCount).toBe(1) // unsuspended by default — old behaviour intact
  })

  // Minor (T2-review re-review): the 'ended' safety-net (fix A1, for subs
  // longer than the video) must respect the same enforcementSuspended gate as
  // the rAF-driver — otherwise a hidden panel still seeks past B via 'ended'
  // when the loop's B is at/after the video's actual end.
  it('suspended: emitting `ended` while looping does not seek (respects the enforcementSuspended gate)', () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const { result } = renderHook(
      ({ suspended }) => useWorkspace(a, cues, '', suspended),
      { initialProps: { suspended: true } },
    )
    act(() => { result.current.setABLoop(2, 4) })
    expect(a._seekCount).toBe(0)

    act(() => { a._emit('state', 'ended') })
    expect(a._seekCount).toBe(0) // suspended — 'ended' must not restart the loop
    expect(result.current.looping).toBe(true) // still ON — suspend freezes, doesn't stop
  })

  // T3-review gap (mirror of the test above): guards fix A1 against a future
  // "always return" refactor of the 'ended' handler — when NOT suspended
  // (false, or the 4th arg omitted entirely), an active loop must still react
  // to 'ended' and restart via reachBoundary (seek count grows).
  it('not suspended: emitting `ended` while looping DOES seek (fix A1 still fires)', () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const { result } = renderHook(
      ({ suspended }) => useWorkspace(a, cues, '', suspended),
      { initialProps: { suspended: false } },
    )
    act(() => { result.current.setABLoop(2, 4) })
    expect(a._seekCount).toBe(0)

    act(() => { a._emit('state', 'ended') })
    expect(a._seekCount).toBe(1) // not suspended — 'ended' restarts the loop from A
    expect(result.current.looping).toBe(true)
  })

  it('suspended omitted (default false): emitting `ended` while looping DOES seek', () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const { result } = renderHook(() => useWorkspace(a, cues)) // no 4th arg at all
    act(() => { result.current.setABLoop(2, 4) })
    expect(a._seekCount).toBe(0)

    act(() => { a._emit('state', 'ended') })
    expect(a._seekCount).toBe(1) // default (omitted) suspended=false — 'ended' still restarts
    expect(result.current.looping).toBe(true)
  })
})

// I-2: persist must not resurrect a loop out of a "hidden panel" (suspended) state.
// A hidden settings panel means "the loop isn't needed for the next session" — the
// in-memory `looping` flag stays true (Z/Exit visibility-flip, not a stop), but the
// value written to localStorage must be forced false so a later restore doesn't
// silently re-enable an active loop the user can no longer see/control.
describe('useWorkspace persist respects enforcementSuspended (I-2)', () => {
  it('debounced persist: suspended=true + active loop → looping:false in localStorage', () => {
    vi.useFakeTimers()
    const a = makeFakeAdapter({ duration: 600, t: 0 })
    const { result, rerender } = renderHook(
      ({ suspended }) => useWorkspace(a, cues, 'vidSuspendPersist', suspended),
      { initialProps: { suspended: false } },
    )
    act(() => { result.current.setABLoop(2, 4) })
    expect(result.current.looping).toBe(true)

    rerender({ suspended: true }) // panel hidden
    act(() => { vi.advanceTimersByTime(400) })

    const saved = JSON.parse(localStorage.getItem('flib:ws:vidSuspendPersist') as string)
    expect(saved.looping).toBe(false) // forced off despite in-memory looping still true
    expect(result.current.looping).toBe(true) // in-memory state untouched (visibility-flip, not stop)
  })

  it('flush-on-unmount: suspended=true + active loop → looping:false in localStorage', () => {
    vi.useFakeTimers()
    const a = makeFakeAdapter({ duration: 600, t: 0 })
    const { result, rerender, unmount } = renderHook(
      ({ suspended }) => useWorkspace(a, cues, 'vidSuspendFlush', suspended),
      { initialProps: { suspended: false } },
    )
    act(() => { result.current.setABLoop(2, 4) })
    rerender({ suspended: true }) // panel hidden, immediately unmount — no debounce flush
    unmount()

    const saved = JSON.parse(localStorage.getItem('flib:ws:vidSuspendFlush') as string)
    expect(saved.looping).toBe(false)
  })

  it('regression: suspended=false + active loop persists looping:true as before', () => {
    vi.useFakeTimers()
    const a = makeFakeAdapter({ duration: 600, t: 0 })
    const { result, unmount } = renderHook(
      () => useWorkspace(a, cues, 'vidNotSuspended', false),
    )
    act(() => { result.current.setABLoop(2, 4) })
    act(() => { vi.advanceTimersByTime(400) })

    const saved = JSON.parse(localStorage.getItem('flib:ws:vidNotSuspended') as string)
    expect(saved.looping).toBe(true)

    unmount()
    const savedAfterUnmount = JSON.parse(localStorage.getItem('flib:ws:vidNotSuspended') as string)
    expect(savedAfterUnmount.looping).toBe(true)
  })
})
