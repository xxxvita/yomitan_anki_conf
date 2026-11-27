// web/src/player/hooks/__tests__/useWorkspace.pause.test.ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useWorkspace } from '../useWorkspace'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

const cues = [{ start: 2, end: 4 }]

describe('pause-at-end', () => {
  it('does NOT trigger outside an active loop', () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => { result.current.setPauseAtEnd(1) }) // луп выключен
    act(() => { a._setTime(4.5); result.current._boundaryTickForTest() })
    expect(a._seekCount).toBe(0) // early-return
  })

  it('restart order: pause → seek(A) → countdown → play', () => {
    vi.useFakeTimers()
    const a = makeFakeAdapter({ t: 2.5 }) // внутри [2,4] → setABLoop без rewind
    const calls: string[] = []
    a._spy = (m: string) => calls.push(m)
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => { result.current.setABLoop(2, 4); result.current.setPauseAtEnd(1) })
    calls.length = 0 // очистить spy после setup
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() })
    expect(calls.indexOf('pause')).toBe(0)                                   // pause первым
    expect(calls.indexOf('seek:2')).toBeGreaterThan(calls.indexOf('pause')) // seek(A) после pause
    expect(calls).not.toContain('play')                                     // play ещё нет — идёт отсчёт
    act(() => { vi.advanceTimersByTime(1000) })
    expect(calls).toContain('play')                                         // play ПОСЛЕ отсчёта
    vi.useRealTimers()
  })

  it('pauseAtEnd=0 restarts immediately, restartingRef prevents double-fire on frozen poll (M2)', () => {
    const a = makeFakeAdapter({ t: 2.5 })
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => { result.current.setABLoop(2, 4); result.current.setPauseAtEnd(0) })
    act(() => { a._setTime(4.5) }) // seek(A) НЕ отражается в poll (замёрзло за B)
    act(() => { result.current._boundaryTickForTest(); result.current._boundaryTickForTest() })
    expect(a._seekCount).toBe(1) // без restartingRef было бы 2
  })

  it('countdownSecs = round(pauseAtEnd); 1.4 → 1 tick', () => {
    vi.useFakeTimers()
    const a = makeFakeAdapter({ t: 2.5 })
    const calls: string[] = []; a._spy = (m: string) => calls.push(m)
    const { result } = renderHook(() => useWorkspace(a, cues))
    act(() => { result.current.setABLoop(2, 4); result.current.setPauseAtEnd(1.4) }) // round → 1
    calls.length = 0
    act(() => { a._setTime(4.01); result.current._boundaryTickForTest() })
    expect(result.current.countdownValue).toBe(1)
    act(() => { vi.advanceTimersByTime(1000) })
    expect(calls).toContain('play')
    vi.useRealTimers()
  })
})
