// VideoControlsBar.muteIntent.test.tsx — T4-ревью regression (Important, blocking).
// Prior bug: mute-btn wrote adapter.mute()/unmute() directly, bypassing manualMuted
// (PlayerPage intent) and the useMuteDriver `appliedRef` (assume-sole-writer driver).
// Symptoms fixed here: (A) panel-mute + bar click got stuck "sound plays while panel
// shows muted" (want never changed, driver did an early edge-triggered return);
// (B) bar-unmute inside an active region did nothing to the region (want stayed true,
// this is actually correct desktop canon — asserted explicitly below); (C) a manual
// mute set via the bar was silently dropped at a region boundary.
// Fix: the bar now only calls onToggleMute (flips manualMuted in the parent) — the
// driver (useMuteDriver) remains the SOLE writer into adapter.mute()/unmute().
import { describe, it, expect, vi } from 'vitest'
import { useState } from 'react'
import { render, fireEvent, act } from '@testing-library/react'
import { VideoControlsBar } from '../VideoControlsBar'
import { useMuteDriver } from '../../hooks/useMuteRegions'
import { makeFakeAdapter, type FakeAdapter } from '../../../adapter/__tests__/fake'
import type { MuteRegion } from '../../workspace/mute-regions'
import type { PlayerState } from '../../hooks/usePlayerState'

const st = (o: Partial<PlayerState> = {}): PlayerState => ({ paused: true, muted: false, volume: 100, rate: 1, buffering: false, duration: 100, currentTime: 0, ...o })

const region = (t1: number, t2: number): MuteRegion => ({
  id: 'r1', t1, t2, tracks: { you: false, aud: true }, muted: true, cueIndex: -1,
})

// Harness mirrors the real PlayerPage wiring: manualMuted lives in the parent (useState),
// useMuteDriver reconciles it against regions into the adapter, and VideoControlsBar
// only ever calls onToggleMute — never adapter.mute()/unmute() directly.
function Harness({ adapter, regions, driverRef }: {
  adapter: FakeAdapter
  regions: MuteRegion[]
  driverRef: { current: { _tickForTest: () => void } | null }
}) {
  const [manualMuted, setManualMuted] = useState(false)
  driverRef.current = useMuteDriver(adapter, regions, manualMuted)
  return (
    <VideoControlsBar
      adapter={adapter}
      state={st({ muted: adapter.muted() })}
      ws={{ onUserSeek: () => {} }}
      onToggleMute={() => setManualMuted(m => !m)}
    />
  )
}

describe('VideoControlsBar mute-btn — manualMuted intent (T4 fix)', () => {
  it('component-level: click calls onToggleMute, never adapter.mute()/unmute() directly', () => {
    const a = makeFakeAdapter({ t: 0 })
    const mute = vi.spyOn(a, 'mute')
    const unmute = vi.spyOn(a, 'unmute')
    const onToggleMute = vi.fn()
    const { getByTestId } = render(
      <VideoControlsBar adapter={a} state={st({ muted: false })} ws={{ onUserSeek: vi.fn() }} onToggleMute={onToggleMute} />
    )
    fireEvent.click(getByTestId('mute-btn'))
    expect(onToggleMute).toHaveBeenCalledTimes(1)
    expect(mute).not.toHaveBeenCalled()
    expect(unmute).not.toHaveBeenCalled()
  })

  it('A: panel-muted (manual=true) then bar click → unmutes via driver, no stuck state, no flapping on repeat tick', () => {
    const a = makeFakeAdapter({ t: 0 })
    const driverRef: { current: { _tickForTest: () => void } | null } = { current: null }
    const { getByTestId } = render(<Harness adapter={a} regions={[]} driverRef={driverRef} />)
    // simulate prior panel mute: toggle manualMuted true, tick converges adapter
    act(() => fireEvent.click(getByTestId('mute-btn')))
    act(() => driverRef.current!._tickForTest())
    expect(a.muted()).toBe(true)
    // bar click now flips manualMuted back to false — must actually unmute, not get stuck
    act(() => fireEvent.click(getByTestId('mute-btn')))
    act(() => driverRef.current!._tickForTest())
    expect(a.muted()).toBe(false)
    // repeat tick with no change must not flap (edge-triggered)
    act(() => driverRef.current!._tickForTest())
    expect(a.muted()).toBe(false)
  })

  it('B: inside an active mute region, bar click does NOT unmute the region (want = manual || regionAud — desktop canon)', () => {
    const a = makeFakeAdapter({ t: 15 }) // inside region(10,20)
    const driverRef: { current: { _tickForTest: () => void } | null } = { current: null }
    const { getByTestId } = render(<Harness adapter={a} regions={[region(10, 20)]} driverRef={driverRef} />)
    act(() => driverRef.current!._tickForTest()) // region alone already mutes
    expect(a.muted()).toBe(true)
    act(() => fireEvent.click(getByTestId('mute-btn'))) // toggles manualMuted false→true
    act(() => driverRef.current!._tickForTest())
    // want = manualMuted(true) || regionAud(true) = true → region still wins, stays muted
    expect(a.muted()).toBe(true)
  })

  it('C: manual mute set via the bar is not silently dropped when crossing a region boundary', () => {
    const a = makeFakeAdapter({ t: 25 }) // outside region(10,20)
    const driverRef: { current: { _tickForTest: () => void } | null } = { current: null }
    const { getByTestId } = render(<Harness adapter={a} regions={[region(10, 20)]} driverRef={driverRef} />)
    act(() => fireEvent.click(getByTestId('mute-btn'))) // manualMuted: false → true
    act(() => driverRef.current!._tickForTest())
    expect(a.muted()).toBe(true)
    // move into the region, then back out — manual intent must persist throughout
    act(() => { a._setTime(15); driverRef.current!._tickForTest() })
    expect(a.muted()).toBe(true)
    act(() => { a._setTime(30); driverRef.current!._tickForTest() })
    expect(a.muted()).toBe(true) // manual still wins, not dropped at the boundary
  })
})
