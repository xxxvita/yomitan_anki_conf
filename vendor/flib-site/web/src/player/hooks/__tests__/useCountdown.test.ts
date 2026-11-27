// web/src/player/hooks/__tests__/useCountdown.test.ts
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCountdown } from '../useCountdown'

describe('useCountdown', () => {
  it('counts down N..1 then fires onComplete and nulls value', () => {
    vi.useFakeTimers()
    const done = vi.fn()
    const { result } = renderHook(() => useCountdown())
    act(() => result.current.start(2, done))
    expect(result.current.value).toBe(2)
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.value).toBe(1)
    expect(done).not.toHaveBeenCalled()
    act(() => vi.advanceTimersByTime(1000))
    expect(result.current.value).toBeNull()
    expect(done).toHaveBeenCalledTimes(1)
    vi.useRealTimers()
  })
  it('cancel aborts without firing onComplete', () => {
    vi.useFakeTimers()
    const done = vi.fn()
    const { result } = renderHook(() => useCountdown())
    act(() => result.current.start(3, done))
    act(() => result.current.cancel())
    expect(result.current.value).toBeNull()
    act(() => vi.advanceTimersByTime(5000))
    expect(done).not.toHaveBeenCalled()
    vi.useRealTimers()
  })
})
