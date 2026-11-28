// IFrameAdapter.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createIFrameAdapter } from '../IFrameAdapter'

function installYTMock() {
  // P-yt-title-tooltip: реальный iframe-элемент с проставленным title (как это
  // делает YouTube), чтобы проверить, что адаптер его снимает.
  const iframe = document.createElement('iframe')
  iframe.setAttribute('title', 'Show Clip - A View from the Bridge')
  const player = {
    _t: 0, _rate: 1, _muted: false, _vol: 100, _state: 2,
    getIframe() { return iframe },
    getCurrentTime() { return this._t },
    getDuration() { return 120 },
    getPlayerState() { return this._state },
    getPlaybackRate() { return this._rate },
    getAvailablePlaybackRates() { return [0.25, 0.5, 1, 1.5, 2] },
    isMuted() { return this._muted },
    getVolume() { return this._vol },
    getVideoLoadedFraction() { return 0.5 },
    seekTo(t: number) { this._t = t },
    playVideo() { this._state = 1 },
    pauseVideo() { this._state = 2 },
    setPlaybackRate(r: number) { this._rate = r },
    mute() { this._muted = true },
    unMute() { this._muted = false },
    setVolume(v: number) { this._vol = v },
    destroy() { (this as any).__destroyed = true },
  }
  ;(globalThis as any).YT = {
    Player: vi.fn(function (this: any, _el: string, cfg: any) {
      Object.assign(this, player)
      setTimeout(() => cfg.events.onReady({ target: this }), 0)
      ;(globalThis as any).__ytPlayer = this
    }),
    PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3 },
  }
}

describe('IFrameAdapter', () => {
  beforeEach(() => { installYTMock() })

  it('resolves on ready and reports duration', async () => {
    const a = await createIFrameAdapter('yt', 'abc123', {})
    expect(a.duration()).toBe(120)
  })

  it('setRate snaps to available rates', async () => {
    const a = await createIFrameAdapter('yt', 'abc123', {})
    a.setRate(0.3)                       // не существует на YT
    expect(a.getAvailableRates()).toContain(a.rate())
    expect([0.25, 0.5]).toContain(a.rate()) // снап к ближайшему валидному
  })

  it('seek opens the in-flight window (true right after seek, closes by time) — H5', async () => {
    let clock = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => clock)
    const a = await createIFrameAdapter('yt', 'abc123', {})
    a.seek(42)
    expect(a.isOurSeekInFlight()).toBe(true)          // окно ОТКРЫТО сразу после seek
    expect((globalThis as any).__ytPlayer._t).toBe(42) // seekTo применился на плеере
    clock = 1000 + 500                                 // > SEEK_INFLIGHT_MS (400)
    expect(a.isOurSeekInFlight()).toBe(false)          // окно закрылось по времени
    vi.restoreAllMocks()
  })

  it('destroy() clears the poll interval and player — H4', async () => {
    const clearSpy = vi.spyOn(globalThis, 'clearInterval')
    const a = await createIFrameAdapter('yt', 'abc123', {})
    a.destroy()
    expect(clearSpy).toHaveBeenCalled()
    expect((globalThis as any).__ytPlayer.__destroyed).toBe(true)
  })

  it('exposes muted/volume/buffering/loadedFraction', async () => {
    const a = await createIFrameAdapter('yt', 'abc123', {})
    a.mute(); expect(a.muted()).toBe(true)
    a.setVolume(30); expect(a.volume()).toBe(30)
    expect(typeof a.buffering()).toBe('boolean')
    expect(a.loadedFraction()).toBeCloseTo(0.5, 2)
  })

  it('passes width/height 100% so the iframe fills the stage — T1', async () => {
    await createIFrameAdapter('yt', 'abc123', {})
    const cfg = (globalThis as any).YT.Player.mock.calls[0][1]
    expect(cfg.width).toBe('100%')
    expect(cfg.height).toBe('100%')
  })

  // P-yt-title-tooltip: overlay pointer-events:none → курсор на iframe → браузер
  // показывает нативный тултип из title=названия ролика на каждом наведении.
  it('снимает title с iframe на ready (иначе браузерный тултип названия на каждом hover)', async () => {
    await createIFrameAdapter('yt', 'abc123', {})
    const iframe = (globalThis as any).__ytPlayer.getIframe()
    expect(iframe.hasAttribute('title')).toBe(false)
  })

  it('наблюдатель снимает title, если YouTube проставит его повторно', async () => {
    const a = await createIFrameAdapter('yt', 'abc123', {})
    const iframe = (globalThis as any).__ytPlayer.getIframe()
    // YT «переставил» title (смена ролика / ре-билд).
    iframe.setAttribute('title', 'Другой ролик')
    // MutationObserver в jsdom — микротаск; ждём его прогон.
    await new Promise(r => setTimeout(r, 0))
    expect(iframe.hasAttribute('title')).toBe(false)
    a.destroy()
  })

  it('destroy отключает наблюдатель title (после destroy title больше не чистится)', async () => {
    const a = await createIFrameAdapter('yt', 'abc123', {})
    const iframe = (globalThis as any).__ytPlayer.getIframe()
    a.destroy()
    iframe.setAttribute('title', 'после destroy')
    await new Promise(r => setTimeout(r, 0))
    // Наблюдатель отключён — title остаётся (никто не чистит, но и не течёт).
    expect(iframe.getAttribute('title')).toBe('после destroy')
  })
})
