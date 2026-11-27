// useMuteRegions.test.ts — A7: regions on videoId, localStorage persist, applyRange toggle-vs-create.
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useMuteRegions } from '../useMuteRegions'

const KEY = (videoId: string) => `flib:mute-regions:${videoId}`

beforeEach(() => { localStorage.clear() })

describe('useMuteRegions', () => {
  it('addRegion creates one region, muted:true, aud-only', () => {
    const { result } = renderHook(() => useMuteRegions('vid1'))
    act(() => { result.current.addRegion(10, 20) })
    expect(result.current.muteRegions).toHaveLength(1)
    const r = result.current.muteRegions[0]
    expect(r.muted).toBe(true)
    expect(r.tracks).toEqual({ you: false, aud: true })
    expect(r.t1).toBe(10)
    expect(r.t2).toBe(20)
  })

  it('persists to localStorage and a new hook instance for the same videoId reads it back', () => {
    const first = renderHook(() => useMuteRegions('vid1'))
    act(() => { first.result.current.addRegion(5, 8) })
    first.unmount()

    const second = renderHook(() => useMuteRegions('vid1'))
    expect(second.result.current.muteRegions).toHaveLength(1)
    expect(second.result.current.muteRegions[0]).toMatchObject({ t1: 5, t2: 8, muted: true })
  })

  it('applyRange twice on the same [10,20] toggles the same region (length stays 1)', () => {
    const { result } = renderHook(() => useMuteRegions('vid1'))
    act(() => { result.current.applyRange(10, 20) })
    expect(result.current.muteRegions).toHaveLength(1)
    expect(result.current.muteRegions[0].muted).toBe(true)

    act(() => { result.current.applyRange(10, 20) })
    expect(result.current.muteRegions).toHaveLength(1) // same region, not a duplicate
    expect(result.current.muteRegions[0].muted).toBe(false) // second M flips it off

    act(() => { result.current.applyRange(10, 20) })
    expect(result.current.muteRegions).toHaveLength(1)
    expect(result.current.muteRegions[0].muted).toBe(true) // third M flips back on
  })

  it('applyRange ignores a degenerate [A,B] (no valid range)', () => {
    const { result } = renderHook(() => useMuteRegions('vid1'))
    act(() => { result.current.applyRange(10, 10.01) })
    expect(result.current.muteRegions).toHaveLength(0)
  })

  it('toggleRegion flips muted in state and persists the flip', () => {
    const { result } = renderHook(() => useMuteRegions('vid1'))
    act(() => { result.current.addRegion(1, 2) })
    const id = result.current.muteRegions[0].id
    act(() => { result.current.toggleRegion(id) })
    expect(result.current.muteRegions[0].muted).toBe(false)

    const raw = JSON.parse(localStorage.getItem(KEY('vid1'))!)
    expect(raw[0].muted).toBe(false)
  })

  it('deleteRegion removes the region from state and localStorage', () => {
    const { result } = renderHook(() => useMuteRegions('vid1'))
    act(() => { result.current.addRegion(1, 2) })
    const id = result.current.muteRegions[0].id
    act(() => { result.current.deleteRegion(id) })
    expect(result.current.muteRegions).toHaveLength(0)

    const raw = JSON.parse(localStorage.getItem(KEY('vid1'))!)
    expect(raw).toHaveLength(0)
  })

  it('swapping videoId re-reads regions scoped to the new id', () => {
    const a = renderHook(() => useMuteRegions('vid1'))
    act(() => { a.result.current.addRegion(1, 2) })

    const b = renderHook(({ videoId }: { videoId: string }) => useMuteRegions(videoId), {
      initialProps: { videoId: 'vid1' },
    })
    expect(b.result.current.muteRegions).toHaveLength(1)
    act(() => { b.rerender({ videoId: 'vid2' }) })
    expect(b.result.current.muteRegions).toHaveLength(0) // fresh id, nothing persisted yet
  })
})
