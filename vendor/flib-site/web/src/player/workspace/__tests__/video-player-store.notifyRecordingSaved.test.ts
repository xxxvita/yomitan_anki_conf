// video-player-store.notifyRecordingSaved.test.ts — T-A (A2): notifyRecordingSaved
// no-op exists on the web store, does not throw, and is a STABLE reference across
// snapshot() calls (see the GUARD comment in video-player-store.ts — an unstable
// selector result here would trip React's nested-update limit once wired by T2).
import { describe, it, expect } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useVideoPlayerStore } from '../video-player-store'

describe('useVideoPlayerStore notifyRecordingSaved (A2 WEB-CUT)', () => {
  it('is a function and calling it does not throw', () => {
    const { result } = renderHook(() => useVideoPlayerStore(s => s.notifyRecordingSaved))
    expect(typeof result.current).toBe('function')
    expect(() => result.current()).not.toThrow()
  })

  it('is a stable reference across rerenders', () => {
    const { result, rerender } = renderHook(() => useVideoPlayerStore(s => s.notifyRecordingSaved))
    const first = result.current
    rerender()
    expect(result.current).toBe(first)
  })
})
