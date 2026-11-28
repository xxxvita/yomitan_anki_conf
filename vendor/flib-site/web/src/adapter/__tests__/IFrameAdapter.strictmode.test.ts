// IFrameAdapter.strictmode.test.ts [ID:P-A-dev]
// StrictMode double-mount безопасность: cancelled-до-резолва монтаж не должен
// создавать YT.Player, а живой монтаж не должен делить DOM-узел с отменённым.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createIFrameAdapter } from '../IFrameAdapter'

function installYTMock() {
  const calls: { el: unknown; cfg: any }[] = []
  ;(globalThis as any).YT = {
    Player: vi.fn(function (this: any, el: any, cfg: any) {
      calls.push({ el, cfg })
      const target: HTMLElement = typeof el === 'string' ? document.getElementById(el)! : el
      const iframe = document.createElement('iframe')
      target.replaceWith(iframe)               // реальный YT: заменяет переданный элемент iframe-ом
      this._iframe = iframe
      this._t = 0; this._rate = 1; this._muted = false; this._vol = 100; this._state = 2
      this.getCurrentTime = () => this._t
      this.getDuration = () => 120
      this.getPlayerState = () => this._state
      this.getPlaybackRate = () => this._rate
      this.getAvailablePlaybackRates = () => [1]
      this.isMuted = () => this._muted
      this.getVolume = () => this._vol
      this.getVideoLoadedFraction = () => 0.5
      this.seekTo = (t: number) => { this._t = t }
      this.playVideo = () => { this._state = 1 }
      this.pauseVideo = () => { this._state = 2 }
      this.setPlaybackRate = (r: number) => { this._rate = r }
      this.mute = () => { this._muted = true }
      this.unMute = () => { this._muted = false }
      this.setVolume = (v: number) => { this._vol = v }
      this.destroy = () => { this._iframe.remove(); this.__destroyed = true }  // реальный YT: destroy() сносит iframe
      setTimeout(() => cfg.events.onReady({ target: this }), 0)
    }),
    PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 },
  }
  return calls
}

describe('IFrameAdapter — StrictMode double-mount safety [ID:P-A-dev]', () => {
  beforeEach(() => {
    document.body.innerHTML = '<div id="yt-player"></div>'
  })

  it('mount#1 отменён ДО резолва API: создан РОВНО ОДИН YT.Player, destroy отменённого не трогает живой iframe', async () => {
    const calls = installYTMock()
    const cancelled1 = () => true          // StrictMode cleanup уже случился к моменту резолва
    const p1 = createIFrameAdapter('yt-player', 'abc', {}, cancelled1)
    const p2 = createIFrameAdapter('yt-player', 'abc', {}, () => false)

    const [a1, a2] = await Promise.all([p1, p2])

    expect(calls.length).toBe(1)           // ни один лишний YT.Player не создан

    a1.destroy()                            // destroy отменённого — no-op
    const host = document.getElementById('yt-player')!
    expect(host.querySelector('iframe')).not.toBeNull()  // живой iframe цел

    expect(a2.duration()).toBe(120)         // живой плеер функционален
  })

  it('полный mount/unmount/mount: host переживает, второй плеер создаётся на новом child', async () => {
    const calls = installYTMock()
    const a1 = await createIFrameAdapter('yt-player', 'abc', {}, () => false)
    expect(calls.length).toBe(1)

    a1.destroy()
    const host = document.getElementById('yt-player')!
    expect(host.isConnected).toBe(true)                  // host не снесён
    expect(host.querySelector('iframe')).toBeNull()      // первый iframe снесён вместе с плеером

    const a2 = await createIFrameAdapter('yt-player', 'abc', {}, () => false)
    expect(calls.length).toBe(2)
    expect(host.querySelector('iframe')).not.toBeNull()
    expect(a2.duration()).toBe(120)
  })

  it('регресс: обычный одиночный монтаж без isCancelled работает как раньше', async () => {
    const calls = installYTMock()
    const a = await createIFrameAdapter('yt-player', 'abc', {})
    expect(calls.length).toBe(1)
    expect(a.duration()).toBe(120)
    expect(typeof a.destroy).toBe('function')
  })
})
