// web/src/player/hooks/__tests__/useWorkspace.init.test.ts
// T2: детерминированная A/B-инициализация (B=max(1%·dur, 5s), cap dur) +
// персист/restore per-video via localStorage. Канон формулы — desktop
// workspace-init.ts:89-98 (computeDefaultParams) / :62-82 (computeRestoreParams).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkspace } from '../useWorkspace'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

const cues = [{ start: 0, end: 2 }, { start: 2, end: 4 }]

afterEach(() => {
  localStorage.clear()
  vi.useRealTimers()
})

describe('useWorkspace default A/B init formula', () => {
  it('duration 300 → rangeEnd 5 (1% floor of 5s)', () => {
    const a = makeFakeAdapter({ duration: 300 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    expect(result.current.rangeStart).toBe(0)
    expect(result.current.rangeEnd).toBe(5)
    expect(result.current.viewEnd).toBe(300)
    expect(result.current.looping).toBe(false)
  })

  it('duration 1200 → rangeEnd 12 (1% of duration, above the 5s floor)', () => {
    const a = makeFakeAdapter({ duration: 1200 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    expect(result.current.rangeStart).toBe(0)
    expect(result.current.rangeEnd).toBe(12)
    expect(result.current.viewEnd).toBe(1200)
  })

  it('duration 600 → rangeEnd 6 (1% of duration)', () => {
    const a = makeFakeAdapter({ duration: 600 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    expect(result.current.rangeStart).toBe(0)
    expect(result.current.rangeEnd).toBe(6)
    expect(result.current.viewStart).toBe(0)
    expect(result.current.viewEnd).toBe(600)
    expect(result.current.looping).toBe(false)
  })

  // T2-review finding #3: without the Math.min(dur, ...) cap, a video shorter than
  // the 5s floor would seed rangeEnd/viewEnd PAST the actual duration.
  it('duration 3 (shorter than the 5s floor) → rangeEnd/viewEnd capped at 3, not 5', () => {
    const a = makeFakeAdapter({ duration: 3 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    expect(result.current.rangeStart).toBe(0)
    expect(result.current.rangeEnd).toBe(3)
    expect(result.current.viewEnd).toBe(3)
  })
})

describe('useWorkspace restore-priority (per-video localStorage)', () => {
  it('a saved workspace wins over the default seed', () => {
    localStorage.setItem('flib:ws:vid', JSON.stringify({
      rangeStart: 10, rangeEnd: 20, viewStart: 5, viewEnd: 40, looping: true, pauseAtEnd: 1,
    }))
    const a = makeFakeAdapter({ duration: 600 })
    const { result } = renderHook(() => useWorkspace(a, cues, 'vid'))
    expect(result.current.rangeStart).toBe(10)
    expect(result.current.rangeEnd).toBe(20) // NOT the 6 default
    expect(result.current.viewStart).toBe(5)
    expect(result.current.viewEnd).toBe(40)
    expect(result.current.looping).toBe(true)
    expect(result.current.pauseAtEnd).toBe(1)
  })

  it('restore does not seek the playhead', () => {
    localStorage.setItem('flib:ws:vid', JSON.stringify({
      rangeStart: 10, rangeEnd: 20, viewStart: 5, viewEnd: 40, looping: true, pauseAtEnd: 1,
    }))
    const a = makeFakeAdapter({ duration: 600, t: 0 })
    renderHook(() => useWorkspace(a, cues, 'vid'))
    expect(a._seekCount).toBe(0)
  })

  it('no videoId (empty string) → seeds default, no storage I/O', () => {
    const a = makeFakeAdapter({ duration: 600 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    expect(result.current.rangeEnd).toBe(6)
    expect(result.current.looping).toBe(false)
  })
})

describe('useWorkspace restore validation (T2 review finding #1)', () => {
  // Repro: `{"looping":true}` alone used to pass the old
  // `saved && typeof saved === 'object'` gate → setRangeStart(undefined) →
  // Math.min(dur, undefined) === NaN leaking into seek/zoom math.
  it('a saved entry missing required numeric fields falls back to the default seed (no NaN leak)', () => {
    localStorage.setItem('flib:ws:vid', JSON.stringify({ looping: true }))
    const a = makeFakeAdapter({ duration: 500 })
    const { result } = renderHook(() => useWorkspace(a, cues, 'vid'))
    expect(result.current.rangeStart).toBe(0)
    expect(result.current.rangeEnd).toBe(5) // default formula, NOT NaN
    expect(Number.isNaN(result.current.rangeStart)).toBe(false)
    expect(Number.isNaN(result.current.rangeEnd)).toBe(false)
    expect(result.current.viewStart).toBe(0)
    expect(result.current.viewEnd).toBe(500)
    expect(result.current.looping).toBe(false)
  })

  it('a saved entry with a non-numeric field (e.g. a string) also falls back to the default seed', () => {
    localStorage.setItem('flib:ws:vid2', JSON.stringify({
      rangeStart: 10, rangeEnd: 'twenty', viewStart: 5, viewEnd: 40, looping: true, pauseAtEnd: 1,
    }))
    const a = makeFakeAdapter({ duration: 500 })
    const { result } = renderHook(() => useWorkspace(a, cues, 'vid2'))
    expect(result.current.rangeEnd).toBe(5)
    expect(Number.isNaN(result.current.rangeEnd)).toBe(false)
    expect(result.current.looping).toBe(false)
  })

  it('a fully valid saved entry still restores as before (no regression)', () => {
    localStorage.setItem('flib:ws:vid3', JSON.stringify({
      rangeStart: 10, rangeEnd: 20, viewStart: 5, viewEnd: 40, looping: true, pauseAtEnd: 1,
    }))
    const a = makeFakeAdapter({ duration: 600 })
    const { result } = renderHook(() => useWorkspace(a, cues, 'vid3'))
    expect(result.current.rangeStart).toBe(10)
    expect(result.current.rangeEnd).toBe(20)
    expect(result.current.viewStart).toBe(5)
    expect(result.current.viewEnd).toBe(40)
    expect(result.current.looping).toBe(true)
    expect(result.current.pauseAtEnd).toBe(1)
  })

  // Minor M3 (final review): the old guard only checked finiteness of the four
  // required fields, not their span direction. An inverted/degenerate saved
  // span (viewEnd<=viewStart, rangeEnd<rangeStart, or a negative rangeStart)
  // passed the finiteness check and got applied verbatim, handing the timeline
  // a backwards view/range. Falls through to the default seed instead.
  it('M3: a saved entry with an inverted view span (viewEnd<=viewStart) falls back to the default seed', () => {
    localStorage.setItem('flib:ws:vidM3a', JSON.stringify({
      rangeStart: 10, rangeEnd: 20, viewStart: 40, viewEnd: 40, looping: true, pauseAtEnd: 1,
    }))
    const a = makeFakeAdapter({ duration: 500 })
    const { result } = renderHook(() => useWorkspace(a, cues, 'vidM3a'))
    expect(result.current.rangeStart).toBe(0)
    expect(result.current.rangeEnd).toBe(5) // default formula, not the saved 10/20
    expect(result.current.viewStart).toBe(0)
    expect(result.current.viewEnd).toBe(500)
    expect(result.current.looping).toBe(false)
  })

  it('M3: a saved entry with an inverted range span (rangeEnd<rangeStart) falls back to the default seed', () => {
    localStorage.setItem('flib:ws:vidM3b', JSON.stringify({
      rangeStart: 20, rangeEnd: 10, viewStart: 5, viewEnd: 40, looping: true, pauseAtEnd: 1,
    }))
    const a = makeFakeAdapter({ duration: 500 })
    const { result } = renderHook(() => useWorkspace(a, cues, 'vidM3b'))
    expect(result.current.rangeStart).toBe(0)
    expect(result.current.rangeEnd).toBe(5)
    expect(result.current.looping).toBe(false)
  })

  it('M3: a saved entry with a negative rangeStart falls back to the default seed', () => {
    localStorage.setItem('flib:ws:vidM3c', JSON.stringify({
      rangeStart: -5, rangeEnd: 10, viewStart: 5, viewEnd: 40, looping: true, pauseAtEnd: 1,
    }))
    const a = makeFakeAdapter({ duration: 500 })
    const { result } = renderHook(() => useWorkspace(a, cues, 'vidM3c'))
    expect(result.current.rangeStart).toBe(0)
    expect(result.current.rangeEnd).toBe(5)
    expect(result.current.looping).toBe(false)
  })

  it('M3: a saved entry with rangeEnd === rangeStart (zero-length, non-inverted) still restores (boundary is inclusive)', () => {
    localStorage.setItem('flib:ws:vidM3d', JSON.stringify({
      rangeStart: 10, rangeEnd: 10, viewStart: 5, viewEnd: 40, looping: false, pauseAtEnd: 0,
    }))
    const a = makeFakeAdapter({ duration: 500 })
    const { result } = renderHook(() => useWorkspace(a, cues, 'vidM3d'))
    expect(result.current.rangeStart).toBe(10)
    expect(result.current.rangeEnd).toBe(10)
  })

  // Minor M2 (final review, pre-existing): only viewEnd was clamped to the
  // current duration on restore — a saved viewStart from a longer/earlier
  // video could sail straight past a since-shrunk duration untouched,
  // handing the timeline a view window starting after the clip's own end.
  it('M2: a saved viewStart at/past a shrunk duration falls back to the default seed', () => {
    localStorage.setItem('flib:ws:vidM2', JSON.stringify({
      rangeStart: 10, rangeEnd: 20, viewStart: 50, viewEnd: 60, looping: true, pauseAtEnd: 1,
    }))
    const a = makeFakeAdapter({ duration: 40 })
    const { result } = renderHook(() => useWorkspace(a, cues, 'vidM2'))
    // Default seed formula: rangeEnd = max(1%*dur, 5s) capped at dur; view = [0, dur].
    expect(result.current.rangeStart).toBe(0)
    expect(result.current.rangeEnd).toBe(5)
    expect(result.current.viewStart).toBe(0)
    expect(result.current.viewEnd).toBe(40)
    expect(result.current.looping).toBe(false)
  })
})

describe('useWorkspace flush-on-switch (T2 review finding #2)', () => {
  it('unmounting before the 400ms debounce fires still persists the latest edit', () => {
    vi.useFakeTimers()
    const a = makeFakeAdapter({ duration: 600, t: 0 })
    const { result, unmount } = renderHook(() => useWorkspace(a, cues, 'vidFlushA'))
    act(() => { result.current.setABLoop(3, 9) })
    // do NOT advance timers by 400ms — unmount immediately
    unmount()

    const raw = localStorage.getItem('flib:ws:vidFlushA')
    expect(raw).toBeTruthy()
    const saved = JSON.parse(raw as string)
    expect(saved.rangeEnd).toBe(9)
    expect(saved.looping).toBe(true)
  })

  it('switching to a new video before the debounce fires persists the outgoing video state', () => {
    vi.useFakeTimers()
    const a1 = makeFakeAdapter({ duration: 600, t: 0 })
    const { result, rerender } = renderHook(
      ({ adapter, videoId }) => useWorkspace(adapter, cues, videoId),
      { initialProps: { adapter: a1 as ReturnType<typeof makeFakeAdapter> | null, videoId: 'vidFlushB' } },
    )
    act(() => { result.current.setABLoop(3, 9) })
    // no vi.advanceTimersByTime(400) here — switch video immediately
    const a2 = makeFakeAdapter({ duration: 600, t: 0 })
    act(() => { rerender({ adapter: a2, videoId: 'vidFlushC' }) })

    const raw = localStorage.getItem('flib:ws:vidFlushB')
    expect(raw).toBeTruthy()
    const saved = JSON.parse(raw as string)
    expect(saved.rangeEnd).toBe(9)
    expect(saved.looping).toBe(true)
  })
})

describe('useWorkspace default seed resets pauseAtEnd (Minor M1)', () => {
  // Minor M1 (final review): the desktop computeDefaultParams canon seeds
  // pauseAtEnd:0 for a fresh video, but the web default-seed branch never
  // touched pauseAtEndState — only the restore branch did. An in-place
  // videoId switch (same hook instance, new adapter) to a video with no
  // saved session would leak the PREVIOUS video's pauseAtEnd forward.
  it('switching to a new video with no saved session resets a leaked pauseAtEnd back to 0', () => {
    const a1 = makeFakeAdapter({ duration: 600, t: 0 })
    const { result, rerender } = renderHook(
      ({ adapter, videoId }) => useWorkspace(adapter, cues, videoId),
      { initialProps: { adapter: a1 as ReturnType<typeof makeFakeAdapter> | null, videoId: 'vidPauseA' } },
    )
    act(() => { result.current.setPauseAtEnd(2) })
    expect(result.current.pauseAtEnd).toBe(2)

    const a2 = makeFakeAdapter({ duration: 600, t: 0 })
    act(() => { rerender({ adapter: a2, videoId: 'vidPauseB' }) })

    expect(result.current.pauseAtEnd).toBe(0)
  })
})

describe('useWorkspace persist cycle (per-video localStorage, 400ms debounce)', () => {
  it('persists after setABLoop + 400ms, and a remount restores it', () => {
    vi.useFakeTimers()
    const a = makeFakeAdapter({ duration: 600, t: 0 })
    const { result, unmount } = renderHook(() => useWorkspace(a, cues, 'vid'))
    act(() => { result.current.setABLoop(3, 9) })
    act(() => { vi.advanceTimersByTime(400) })

    const raw = localStorage.getItem('flib:ws:vid')
    expect(raw).toBeTruthy()
    const saved = JSON.parse(raw as string)
    expect(saved.rangeEnd).toBe(9)
    expect(saved.looping).toBe(true)

    unmount()
    const b = makeFakeAdapter({ duration: 600, t: 0 })
    const { result: result2 } = renderHook(() => useWorkspace(b, cues, 'vid'))
    expect(result2.current.rangeStart).toBe(3)
    expect(result2.current.rangeEnd).toBe(9)
    expect(result2.current.looping).toBe(true)
  })
})
