// web/src/lib/__tests__/boundary-monitor.test.ts
import { describe, it, expect } from 'vitest'
import {
  predictBoundaryCross, boundaryMonitorStep, initialMonitorState, nextEntryBoundary,
} from '../boundary-monitor'

describe('predictBoundaryCross', () => {
  it('false when paused/reverse (rate<=0)', () => {
    expect(predictBoundaryCross(1.9, 16, 0, 2.0)).toBe(false)
    expect(predictBoundaryCross(1.9, 16, -1, 2.0)).toBe(false)
  })
  it('fires when playhead will reach boundary within lookahead frames', () => {
    // 16ms * 1x * 2 frames = 0.032s ahead; 1.99 + 0.032 = 2.022 >= 2.0
    expect(predictBoundaryCross(1.99, 16, 1, 2.0)).toBe(true)
  })
  it('false when boundary is far ahead', () => {
    expect(predictBoundaryCross(1.0, 16, 1, 2.0)).toBe(false)
  })
})

describe('boundaryMonitorStep', () => {
  it('null boundary resets to disarmed initial state', () => {
    const r = boundaryMonitorStep({ armed: true, lastBoundary: 2 }, 1.5, 16, 1, null)
    expect(r.fire).toBe(false)
    expect(r.state).toEqual(initialMonitorState)
  })
  it('arms on a new boundary, fires exactly once, then disarms', () => {
    let s = initialMonitorState
    let r = boundaryMonitorStep(s, 1.99, 16, 1, 2.0) // armed on new boundary + predicts cross
    expect(r.fire).toBe(true); s = r.state
    r = boundaryMonitorStep(s, 2.0, 16, 1, 2.0)       // already fired, disarmed → no re-fire
    expect(r.fire).toBe(false)
  })
  it('re-arms after playhead drops below boundary - REARM_MARGIN (loop restart)', () => {
    let s: any = { armed: false, lastBoundary: 2.0 }
    let r = boundaryMonitorStep(s, 1.5, 16, 1, 2.0)   // 1.5 < 2.0 - 0.25 → re-arm
    // 1.5 + 0.032 < 2.0 → no fire yet, but armed
    expect(r.state.armed).toBe(true); s = r.state
    r = boundaryMonitorStep(s, 1.99, 16, 1, 2.0)      // now predicts cross → fire
    expect(r.fire).toBe(true)
  })
})

describe('nextEntryBoundary', () => {
  const ex = [{ startTime: 2, endTime: 4 }, { startTime: 6, endTime: 8 }]
  it('returns null when the playhead is inside an exercise (start inclusive)', () => {
    expect(nextEntryBoundary(ex, 3)).toBeNull()   // внутри [2,4)
    expect(nextEntryBoundary(ex, 2)).toBeNull()   // ровно на старте = вход уже произошёл
  })
  it('returns the nearest exercise start ahead of the playhead', () => {
    expect(nextEntryBoundary(ex, 1)).toBe(2)      // ближайший впереди
    expect(nextEntryBoundary(ex, 5)).toBe(6)      // между упражнениями → следующий старт
  })
  it('returns null when no exercise starts ahead (or list empty)', () => {
    expect(nextEntryBoundary(ex, 9)).toBeNull()
    expect(nextEntryBoundary([], 0)).toBeNull()
  })
})
