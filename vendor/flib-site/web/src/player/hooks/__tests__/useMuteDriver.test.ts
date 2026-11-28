// useMuteDriver.test.ts — A7: rAF-driven mute reconciliation, edge-triggered.
// Uses `_tickForTest` (reconcile) directly instead of waiting on real rAF frames —
// the mount effect still runs a real rAF loop in the background but assertions
// never depend on its timing.
import { describe, it, expect, vi } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMuteDriver } from '../useMuteRegions'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'
import type { MuteRegion } from '../../workspace/mute-regions'

const region = (t1: number, t2: number, muted = true): MuteRegion => ({
  id: 'r1', t1, t2, tracks: { you: false, aud: true }, muted, cueIndex: -1,
})

describe('useMuteDriver', () => {
  it('outside any region, manual=false → never mutes', () => {
    const a = makeFakeAdapter({ t: 0 })
    const mute = vi.spyOn(a, 'mute')
    const { result } = renderHook(() => useMuteDriver(a, [region(10, 20)], false))
    act(() => result.current._tickForTest())
    expect(mute).not.toHaveBeenCalled()
  })

  it('entering a region mutes once; a second tick with no change does not call mute again (edge-triggered)', () => {
    const a = makeFakeAdapter({ t: 0 })
    const mute = vi.spyOn(a, 'mute')
    const { result } = renderHook(() => useMuteDriver(a, [region(10, 20)], false))
    act(() => { a._setTime(15); result.current._tickForTest() })
    expect(mute).toHaveBeenCalledTimes(1)
    act(() => result.current._tickForTest())
    expect(mute).toHaveBeenCalledTimes(1) // no redundant call
  })

  it('leaving the region unmutes', () => {
    const a = makeFakeAdapter({ t: 15 })
    const mute = vi.spyOn(a, 'mute')
    const unmute = vi.spyOn(a, 'unmute')
    const { result } = renderHook(() => useMuteDriver(a, [region(10, 20)], false))
    act(() => result.current._tickForTest())
    expect(mute).toHaveBeenCalledTimes(1)
    act(() => { a._setTime(25); result.current._tickForTest() })
    expect(unmute).toHaveBeenCalledTimes(1)
  })

  it('manual=true mutes even outside any region', () => {
    const a = makeFakeAdapter({ t: 0 })
    const mute = vi.spyOn(a, 'mute')
    const { result } = renderHook(() => useMuteDriver(a, [], true))
    act(() => result.current._tickForTest())
    expect(mute).toHaveBeenCalledTimes(1)
  })

  it('manual=true stays muted after leaving a region (manual wins over region-exit)', () => {
    const a = makeFakeAdapter({ t: 15 })
    const mute = vi.spyOn(a, 'mute')
    const unmute = vi.spyOn(a, 'unmute')
    const { result, rerender } = renderHook(
      ({ regions, manual }: { regions: MuteRegion[]; manual: boolean }) => useMuteDriver(a, regions, manual),
      { initialProps: { regions: [region(10, 20)], manual: true } },
    )
    act(() => result.current._tickForTest())
    expect(mute).toHaveBeenCalledTimes(1)
    act(() => { a._setTime(25); result.current._tickForTest() }) // outside region, but manual still true
    expect(unmute).not.toHaveBeenCalled()
    void rerender
  })

  it('manual=false inside a region stays muted (region wins over manual=false)', () => {
    const a = makeFakeAdapter({ t: 15 })
    const mute = vi.spyOn(a, 'mute')
    const unmute = vi.spyOn(a, 'unmute')
    const { result, rerender } = renderHook(
      ({ regions, manual }: { regions: MuteRegion[]; manual: boolean }) => useMuteDriver(a, regions, manual),
      { initialProps: { regions: [region(10, 20)], manual: true } },
    )
    act(() => result.current._tickForTest()) // manual=true → muted
    expect(mute).toHaveBeenCalledTimes(1)
    act(() => { rerender({ regions: [region(10, 20)], manual: false }); result.current._tickForTest() })
    // still inside region → want stays true → no unmute call
    expect(unmute).not.toHaveBeenCalled()
  })

  it('seeds appliedRef from adapter.muted() on mount without calling mute/unmute', () => {
    const a = makeFakeAdapter({ t: 0 })
    a.mute() // pre-muted before the hook mounts
    const mute = vi.spyOn(a, 'mute')
    const unmute = vi.spyOn(a, 'unmute')
    const { result } = renderHook(() => useMuteDriver(a, [], false))
    act(() => result.current._tickForTest())
    // want=false, seeded applied=true (adapter was pre-muted) → reconcile calls unmute once to converge
    expect(unmute).toHaveBeenCalledTimes(1)
    expect(mute).not.toHaveBeenCalled()
  })
})
