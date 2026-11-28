import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useAutoHideControls } from '../useAutoHideControls'

describe('useAutoHideControls', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers() })

  it('enabled=false (desktop): stays visible forever, timer never fires', () => {
    const { result } = renderHook(() => useAutoHideControls(false, 3000))
    expect(result.current.visible).toBe(true)
    act(() => { vi.advanceTimersByTime(10_000) })
    expect(result.current.visible).toBe(true)
  })

  it('enabled=true (mobile): auto-hides after the delay with no interaction', () => {
    const { result } = renderHook(() => useAutoHideControls(true, 3000))
    expect(result.current.visible).toBe(true)
    act(() => { vi.advanceTimersByTime(2999) })
    expect(result.current.visible).toBe(true)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.visible).toBe(false)
  })

  it('show() re-shows and resets the hide timer (tap on the video)', () => {
    const { result } = renderHook(() => useAutoHideControls(true, 3000))
    act(() => { vi.advanceTimersByTime(3000) })
    expect(result.current.visible).toBe(false)
    act(() => { result.current.show() })
    expect(result.current.visible).toBe(true)
    act(() => { vi.advanceTimersByTime(2999) })
    expect(result.current.visible).toBe(true)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.visible).toBe(false)
  })

  it('setDragging(true) suppresses auto-hide for the duration of a seek-bar drag', () => {
    const { result } = renderHook(() => useAutoHideControls(true, 3000))
    act(() => { result.current.setDragging(true) })
    act(() => { vi.advanceTimersByTime(10_000) }) // way past the delay
    expect(result.current.visible).toBe(true) // still visible — drag holds it open
  })

  it('setDragging(false) after a drag re-arms the auto-hide timer', () => {
    const { result } = renderHook(() => useAutoHideControls(true, 3000))
    act(() => { result.current.setDragging(true) })
    act(() => { vi.advanceTimersByTime(10_000) })
    act(() => { result.current.setDragging(false) })
    expect(result.current.visible).toBe(true) // drag just ended, still visible
    act(() => { vi.advanceTimersByTime(2999) })
    expect(result.current.visible).toBe(true)
    act(() => { vi.advanceTimersByTime(1) })
    expect(result.current.visible).toBe(false)
  })

  it('a hide fired while dragging is a no-op (defensive: timer scheduled just before drag-start still checks the live ref)', () => {
    const { result } = renderHook(() => useAutoHideControls(true, 3000))
    act(() => { vi.advanceTimersByTime(2999) }) // timer armed, about to fire
    act(() => { result.current.setDragging(true) }) // drag starts a hair before it fires
    act(() => { vi.advanceTimersByTime(1) }) // original timer's tick, if not cleared, would fire here
    expect(result.current.visible).toBe(true)
  })
})
