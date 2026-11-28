// clock-shim.test.ts
import { describe, it, expect } from 'vitest'
import { createClockShim } from '../clock-shim'

describe('clock-shim', () => {
  it('first tick anchors (non-zero initial poll must NOT freeze) — C1', () => {
    let wall = 1000
    const shim = createClockShim({ nowMs: () => wall })
    shim.tick(10, 'playing')                 // первый полл = 10s
    expect(shim.isFrozen()).toBe(false)
    wall = 1100
    expect(shim.now()).toBeCloseTo(10.1, 2)
  })

  it('interpolates forward at the current rate — H2', () => {
    let wall = 1000
    const shim = createClockShim({ nowMs: () => wall })
    shim.tick(10, 'playing')
    shim.setRate(2)
    wall = 1100
    expect(shim.now()).toBeCloseTo(10.2, 2)  // 2× → +0.2s за 100ms
  })

  it('hard-resync on seek jumps now() immediately', () => {
    let wall = 1000
    const shim = createClockShim({ nowMs: () => wall })
    shim.tick(10, 'playing')
    shim.resyncHard(55)
    expect(shim.now()).toBeCloseTo(55, 3)
  })

  it('freezes on a single erratic (ad) jump, holds last good time', () => {
    let wall = 1000
    const shim = createClockShim({ nowMs: () => wall, seekInFlight: () => false })
    shim.tick(50, 'playing')
    wall = 1050
    shim.tick(3, 'playing')                  // реклама впрыснула левый currentTime
    expect(shim.isFrozen()).toBe(true)
    expect(shim.now()).toBeGreaterThanOrEqual(50)
  })

  it('re-baselines after N consistent polls (native seek / chapter jump) — H1', () => {
    let wall = 1000
    const shim = createClockShim({ nowMs: () => wall, seekInFlight: () => false, freezeConfirmPolls: 2 })
    shim.tick(50, 'playing')
    wall = 1050; shim.tick(80, 'playing')    // юзер прыгнул нативным баром на 80
    expect(shim.isFrozen()).toBe(true)        // первый дивергентный полл — заморозка
    wall = 1200; shim.tick(80.15, 'playing')  // позиция нормально поехала от 80 → подтверждение
    expect(shim.isFrozen()).toBe(false)
    expect(shim.now()).toBeGreaterThanOrEqual(80)
  })

  it('ignores stale polls while our seek is in flight — H3', () => {
    let wall = 1000
    const shim = createClockShim({ nowMs: () => wall, seekInFlight: () => true })
    shim.tick(50, 'playing')
    shim.resyncHard(3)                        // adapter.seek(3) уже ре-синкнул цель
    shim.tick(50, 'playing')                  // устаревший полл всё ещё отдаёт 50 — игнор
    expect(shim.now()).toBeCloseTo(3, 1)
  })

  it('does not freeze near-zero start (fresh play at t≈0)', () => {
    let wall = 1000
    const shim = createClockShim({ nowMs: () => wall, seekInFlight: () => false })
    shim.tick(0.0, 'playing')
    wall = 1050
    shim.tick(0.05, 'playing')
    expect(shim.isFrozen()).toBe(false)
  })

  it('does NOT interpolate while paused/cued — now() stays put between polls', () => {
    let wall = 1000
    const shim = createClockShim({ nowMs: () => wall })
    shim.tick(0, 'paused')                    // cued/unstarted/paused video at t=0
    wall = 1150                               // 150ms of wall-clock passes (one poll interval)
    expect(shim.now()).toBeCloseTo(0, 3)      // must NOT have crept forward (regression: paused playhead jitter)
    shim.tick(0, 'paused')                    // next poll re-anchors to real 0
    wall = 1300
    expect(shim.now()).toBeCloseTo(0, 3)      // still frozen — no sawtooth
  })

  it('resumes interpolation once state flips to playing', () => {
    let wall = 1000
    const shim = createClockShim({ nowMs: () => wall })
    shim.tick(5, 'paused')                    // paused at 5s
    wall = 1500
    expect(shim.now()).toBeCloseTo(5, 3)      // frozen
    shim.tick(5, 'playing')                   // user hits play
    wall = 1500 + 200                          // +200ms
    expect(shim.now()).toBeCloseTo(5.2, 2)    // now interpolates at rate 1
  })
})
