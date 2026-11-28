import { describe, it, expect, vi } from 'vitest'
import { render, fireEvent } from '@testing-library/react'
import { VideoControlsBar } from '../VideoControlsBar'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'
import type { PlayerState } from '../../hooks/usePlayerState'

const st = (o: Partial<PlayerState> = {}): PlayerState => ({ paused: true, muted: false, volume: 100, rate: 1, buffering: false, duration: 100, currentTime: 0, ...o })

describe('VideoControlsBar', () => {
  it('seek: no seek on move, one seek + onUserSeek(before) on pointer-up (H8)', () => {
    const a = makeFakeAdapter({ t: 0 }); const seekSpy = vi.spyOn(a, 'seek')
    const ws = { onUserSeek: vi.fn() }
    const { getByTestId } = render(<VideoControlsBar adapter={a} state={st()} ws={ws} />)
    const bar = getByTestId('seek-bar')
    bar.setPointerCapture = vi.fn(); bar.releasePointerCapture = vi.fn()
    bar.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 6, right: 100, bottom: 6, x: 0, y: 0, toJSON() {} }) as DOMRect
    fireEvent.pointerDown(bar, { clientX: 10, pointerId: 1 })
    fireEvent.pointerMove(bar, { clientX: 80 })
    expect(seekSpy).not.toHaveBeenCalled()
    fireEvent.pointerUp(bar, { clientX: 80, pointerId: 1 })
    expect(ws.onUserSeek).toHaveBeenCalledWith(80)
    expect(seekSpy).toHaveBeenCalledTimes(1); expect(seekSpy).toHaveBeenCalledWith(80)
  })
  it('mute/volume reflect state and call adapter', () => {
    const a = makeFakeAdapter({ t: 0 }); const setVol = vi.spyOn(a, 'setVolume')
    const { getByTestId } = render(<VideoControlsBar adapter={a} state={st({ muted: false, volume: 50 })} ws={{ onUserSeek: vi.fn() }} />)
    expect((getByTestId('volume') as HTMLInputElement).value).toBe('50')
    fireEvent.change(getByTestId('volume'), { target: { value: '30' } })
    expect(setVol).toHaveBeenCalledWith(30)
  })
  it('fullscreen button calls onFullscreen', () => {
    const a = makeFakeAdapter({ t: 0 }); const onFs = vi.fn()
    const { getByTestId } = render(<VideoControlsBar adapter={a} state={st()} ws={{ onUserSeek: vi.fn() }} onFullscreen={onFs} />)
    fireEvent.click(getByTestId('cb-fs-btn'))
    expect(onFs).toHaveBeenCalledTimes(1)
  })
  it('slim bar: no play/loop buttons (transport row in the panel is the main transport — T4)', () => {
    const a = makeFakeAdapter({ t: 0 })
    const { queryByTestId } = render(<VideoControlsBar adapter={a} state={st()} ws={{ onUserSeek: vi.fn() }} />)
    expect(queryByTestId('play-btn')).toBeNull()
    expect(queryByTestId('loop-btn')).toBeNull()
  })

  // ── S3-5 — маршрут scrub-bar pointer-up через runtime.seek (observedSeek) ──
  it('S3-5: pointer-up calls seek(t) via the seek prop, NOT adapter.seek, when seek is supplied', () => {
    const a = makeFakeAdapter({ t: 0 }); const adapterSeek = vi.spyOn(a, 'seek')
    const seek = vi.fn()
    const ws = { onUserSeek: vi.fn() }
    const { getByTestId } = render(<VideoControlsBar adapter={a} state={st()} ws={ws} seek={seek} />)
    const bar = getByTestId('seek-bar')
    bar.setPointerCapture = vi.fn(); bar.releasePointerCapture = vi.fn()
    bar.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 6, right: 100, bottom: 6, x: 0, y: 0, toJSON() {} }) as DOMRect
    fireEvent.pointerDown(bar, { clientX: 10, pointerId: 1 })
    fireEvent.pointerUp(bar, { clientX: 80, pointerId: 1 })
    expect(seek).toHaveBeenCalledTimes(1); expect(seek).toHaveBeenCalledWith(80)
    expect(adapterSeek).not.toHaveBeenCalled()
  })

  it('S3-5 transparency: without a seek prop, pointer-up still falls back to adapter.seek (byte-identical to pre-S3-5)', () => {
    const a = makeFakeAdapter({ t: 0 }); const adapterSeek = vi.spyOn(a, 'seek')
    const ws = { onUserSeek: vi.fn() }
    const { getByTestId } = render(<VideoControlsBar adapter={a} state={st()} ws={ws} />)
    const bar = getByTestId('seek-bar')
    bar.setPointerCapture = vi.fn(); bar.releasePointerCapture = vi.fn()
    bar.getBoundingClientRect = () => ({ left: 0, width: 100, top: 0, height: 6, right: 100, bottom: 6, x: 0, y: 0, toJSON() {} }) as DOMRect
    fireEvent.pointerDown(bar, { clientX: 10, pointerId: 1 })
    fireEvent.pointerUp(bar, { clientX: 80, pointerId: 1 })
    expect(adapterSeek).toHaveBeenCalledWith(80)
  })
})
