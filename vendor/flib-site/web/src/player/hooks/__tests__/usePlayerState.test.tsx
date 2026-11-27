import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { usePlayerState } from '../usePlayerState'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

describe('usePlayerState', () => {
  it('reflects adapter getters on mount (sync)', () => {
    const a = makeFakeAdapter({ t: 0 })
    const { result } = renderHook(() => usePlayerState(a))
    expect(result.current.duration).toBe(a.duration())
    expect(result.current.volume).toBe(100)
  })
  it('polls currentTime on ~250ms interval', () => {
    vi.useFakeTimers()
    const a = makeFakeAdapter({ t: 0 })
    const { result } = renderHook(() => usePlayerState(a))
    act(() => { a._setTime(12) ; vi.advanceTimersByTime(300) })
    expect(result.current.currentTime).toBe(12)
    vi.useRealTimers()
  })
})
