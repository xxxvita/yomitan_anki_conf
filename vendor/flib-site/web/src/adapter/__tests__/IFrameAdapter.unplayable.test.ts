// IFrameAdapter.unplayable.test.ts [ID:P-unplayable]
// (а) onError-коды → emit('unplayable', {reason:'embed-error', code}) — ВСЕ
// коды, не только 100/101/150 (различие в тексте — забота UnplayableOverlay,
// не адаптера). (б) бот-стена эвристика: play() → 15с (BOTWALL_CHECK_MS) без PLAYING → emit
// ОДИН раз за жизнь инстанса; PLAYING до истечения таймера — событие не
// летит; повторный play() после подозрения не дублирует событие.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createIFrameAdapter } from '../IFrameAdapter'

function installYTMock() {
  const player = {
    _t: 0, _rate: 1, _muted: false, _vol: 100, _state: -1, // UNSTARTED — как реальный YT перед play()
    getCurrentTime() { return this._t },
    getDuration() { return 120 },
    getPlayerState() { return this._state },
    getPlaybackRate() { return this._rate },
    getAvailablePlaybackRates() { return [0.25, 0.5, 1, 1.5, 2] },
    isMuted() { return this._muted },
    getVolume() { return this._vol },
    getVideoLoadedFraction() { return 0.5 },
    seekTo(t: number) { this._t = t },
    playVideo() { /* НЕ меняем _state сами — тест сам решает, дошло ли до PLAYING */ },
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
      ;(globalThis as any).__ytCfg = cfg
    }),
    // UNSTARTED(-1)/CUED(5) добавлены — реальный YT.PlayerState набор,
    // нужны эвристике бот-стены (см. IFrameAdapter.ts play()).
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  }
}

describe('IFrameAdapter — unplayable [ID:P-unplayable]', () => {
  beforeEach(() => {
    installYTMock()
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('onError → emit unplayable {reason:embed-error, code} for a "bad" code (101, embedding disallowed)', async () => {
    const a = await createIFrameAdapterWithRealTimers()
    const cb = vi.fn()
    a.on('unplayable', cb)
    const cfg = (globalThis as any).__ytCfg
    cfg.events.onError({ data: 101 })
    expect(cb).toHaveBeenCalledWith({ reason: 'embed-error', code: 101 })
  })

  it('onError → emit unplayable also for codes 2/5 (previously unhandled, still surfaced with the code)', async () => {
    const a = await createIFrameAdapterWithRealTimers()
    const cb = vi.fn()
    a.on('unplayable', cb)
    const cfg = (globalThis as any).__ytCfg
    cfg.events.onError({ data: 2 })
    expect(cb).toHaveBeenCalledWith({ reason: 'embed-error', code: 2 })
  })

  it('onError still emits the original error event unchanged', async () => {
    const a = await createIFrameAdapterWithRealTimers()
    const errCb = vi.fn()
    a.on('error', errCb)
    const cfg = (globalThis as any).__ytCfg
    cfg.events.onError({ data: 150 })
    expect(errCb).toHaveBeenCalledWith(150)
  })

  it('play() → 15s pass with no PLAYING state reached → emits botwall-suspect once', async () => {
    const a = await createIFrameAdapterWithRealTimers()
    const cb = vi.fn()
    a.on('unplayable', cb)
    const player = (globalThis as any).__ytPlayer
    player._state = -1 // UNSTARTED — stuck (bot-wall visually blocking playback)

    a.play()
    expect(cb).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(15000)
    expect(cb).toHaveBeenCalledTimes(1)
    expect(cb).toHaveBeenCalledWith({ reason: 'botwall-suspect' })
  })

  it('play() → PLAYING reached before 15s → no botwall-suspect event', async () => {
    const a = await createIFrameAdapterWithRealTimers()
    const cb = vi.fn()
    a.on('unplayable', cb)
    const player = (globalThis as any).__ytPlayer
    const cfg = (globalThis as any).__ytCfg
    player._state = -1

    a.play()
    // Реальный YT дошёл до PLAYING за 2с (обычная задержка сети).
    await vi.advanceTimersByTimeAsync(2000)
    player._state = 1 // PLAYING
    cfg.events.onStateChange({ data: 1 })
    await vi.advanceTimersByTimeAsync(14000) // проходим отметку 15с с момента play()
    expect(cb).not.toHaveBeenCalled()
  })

  it('repeated play() after a suspicion does not duplicate the event', async () => {
    const a = await createIFrameAdapterWithRealTimers()
    const cb = vi.fn()
    a.on('unplayable', cb)
    const player = (globalThis as any).__ytPlayer
    player._state = -1

    a.play()
    await vi.advanceTimersByTimeAsync(15000)
    expect(cb).toHaveBeenCalledTimes(1)

    a.play() // повторный play() после подозрения — таймер больше не заводится
    await vi.advanceTimersByTimeAsync(15000)
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('destroy() clears the pending botwall timer (no late emit after teardown)', async () => {
    const a = await createIFrameAdapterWithRealTimers()
    const cb = vi.fn()
    a.on('unplayable', cb)
    const player = (globalThis as any).__ytPlayer
    player._state = -1

    a.play()
    a.destroy()
    await vi.advanceTimersByTimeAsync(15000)
    expect(cb).not.toHaveBeenCalled()
  })

  // createIFrameAdapter awaits a setTimeout(0) onReady internally — with fake
  // timers active we need to flush that specific timer to resolve the promise
  // before driving the 7s bot-wall timer ourselves.
  async function createIFrameAdapterWithRealTimers() {
    const p = createIFrameAdapter('yt', 'abc123', {})
    await vi.advanceTimersByTimeAsync(0)
    return p
  }
})
