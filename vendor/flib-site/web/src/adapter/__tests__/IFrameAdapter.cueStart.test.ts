// cueStart (ссылка /player?t=): стартовая позиция через playerVars.start, без seekTo/playVideo.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createIFrameAdapter } from '../IFrameAdapter'

function install(duration = 120) {
  const calls: string[] = []
  let cfgSeen: any
  let inst: any
  const player = {
    _t: 0, _st: 5, _dur: duration,
    getCurrentTime() { return this._t }, getDuration() { return this._dur }, getPlayerState() { return this._st },
    cueVideoById(a: any) { calls.push(`cue:${a.videoId}:${a.startSeconds}`) },
    getPlaybackRate() { return 1 }, getAvailablePlaybackRates() { return [1] },
    seekTo(t: number) { calls.push('seekTo'); this._t = t }, playVideo() { calls.push('playVideo') },
    destroy() {},
  }
  ;(globalThis as any).YT = {
    Player: vi.fn(function (this: any, _el: any, cfg: any) {
      cfgSeen = cfg
      Object.assign(this, player)
      inst = this
      setTimeout(() => cfg.events.onReady({ target: this }), 0)
    }),
    PlayerState: { ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  }
  return { calls, cfg: () => cfgSeen, player: () => inst, fire: (data: number) => cfgSeen.events.onStateChange({ data }) }
}

describe('IFrameAdapter cueStart', () => {
  let m: ReturnType<typeof install>
  beforeEach(() => { m = install() })

  it('cueStart → playerVars.start, без seekTo/playVideo; часы на cueStart', async () => {
    const a = await createIFrameAdapter('yt', 'abc', { cueStart: 60 })
    expect(m.cfg().playerVars.start).toBe(60)
    expect(m.calls).toEqual([])
    expect(a.currentTime()).toBe(60)
  })

  it('cueStart > duration: cueVideoById(startSeconds 0), часы на 0, без play', async () => {
    const a = await createIFrameAdapter('yt', 'abc', { cueStart: 5000 })
    expect(m.calls).toEqual(['cue:abc:0'])
    expect(a.currentTime()).toBe(0)
  })

  it('cueStart == duration (граница >=): тоже на 0', async () => {
    const a = await createIFrameAdapter('yt', 'abc', { cueStart: 120 })
    expect(m.calls).toEqual(['cue:abc:0'])
    expect(a.currentTime()).toBe(0)
  })

  it('cueStart = duration-1: остаётся на t, cueVideoById не зовётся', async () => {
    const a = await createIFrameAdapter('yt', 'abc', { cueStart: 119 })
    expect(m.calls).toEqual([])
    expect(a.currentTime()).toBe(119)
  })

  it('длительность 0 при onReady (неизвестна): t остаётся, cueVideoById не зовётся', async () => {
    m = install(0)
    const a = await createIFrameAdapter('yt', 'abc', { cueStart: 5000 })
    expect(m.calls).toEqual([])
    expect(a.currentTime()).toBe(5000)
  })

  it('без cueStart: ключа start в playerVars нет', async () => {
    await createIFrameAdapter('yt', 'abc', {})
    expect('start' in m.cfg().playerVars).toBe(false)
  })

  it('cueStart 0 игнорируется', async () => {
    await createIFrameAdapter('yt', 'abc', { cueStart: 0 })
    expect('start' in m.cfg().playerVars).toBe(false)
  })

  it('оба опта: startSeconds побеждает (seekTo, без start)', async () => {
    await createIFrameAdapter('yt', 'abc', { startSeconds: 12.8, cueStart: 60 })
    expect('start' in m.cfg().playerVars).toBe(false)
    expect(m.calls).toEqual(['seekTo'])
  })
})

describe('IFrameAdapter cueStart: удержание часов', () => {
  let m: ReturnType<typeof install>
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'setTimeout', 'clearTimeout', 'performance'] }); m = install() })
  afterEach(() => { vi.useRealTimers() })
  const POLL = 150
  async function open(opts: any) {
    const p = createIFrameAdapter('yt', 'abc', opts)
    await vi.advanceTimersByTimeAsync(1)
    return p
  }
  const poll = (n = 1) => vi.advanceTimersByTimeAsync(POLL * n)

  it('до PLAYING поллы с сырым временем не двигают часы (t ≥ duration → 0, не 5000)', async () => {
    const a = await open({ cueStart: 5000 })
    m.player()._t = 5000
    await poll(4)
    expect(a.currentTime()).toBe(0)
  })

  it('обычный t: до play часы на t, на play сырое 0 до PLAYING не просачивается', async () => {
    const a = await open({ cueStart: 100 })
    m.player()._t = 100; await poll(2)
    expect(a.currentTime()).toBe(100)
    m.player()._st = 3; m.player()._t = 0   // BUFFERING, сырое 0
    const seen: number[] = []
    for (let i = 0; i < 3; i++) { await poll(); seen.push(a.currentTime()) }
    expect(seen).toEqual([100, 100, 100])
    m.player()._st = 1; m.player()._t = 0   // PLAYING, но время ещё 0
    await poll()
    expect(a.currentTime()).toBe(100)
  })

  it('PLAYING и время ≥ t−1: удержание снято, часы идут по поллам', async () => {
    const a = await open({ cueStart: 100 })
    m.player()._st = 1; m.player()._t = 99.5
    await poll()
    expect(a.currentTime()).toBeCloseTo(99.5, 1)
  })

  it('PLAYING, время < t−1: держим до 1500 мс от первого PLAYING, затем отпускаем', async () => {
    const a = await open({ cueStart: 100 })
    m.player()._st = 1; m.player()._t = 0
    await poll()          // первый PLAYING-полл
    await poll(8)         // ещё 1200 мс
    expect(a.currentTime()).toBe(100)
    await poll(3)         // > 1500 мс
    expect(a.currentTime()).toBeLessThan(1)
  })

  it('PLAYING не достигнут: хоть сколько ждём — держим (даже при времени ≥ t−1)', async () => {
    const a = await open({ cueStart: 100 })
    m.player()._st = 3; m.player()._t = 100
    await poll(30)
    expect(a.currentTime()).toBe(100)
    m.player()._t = 0
    await poll(30)
    expect(a.currentTime()).toBe(100)
  })

  it('наш seek снимает удержание сразу', async () => {
    const a = await open({ cueStart: 100 })
    a.seek(5)
    expect(a.currentTime()).toBe(5)
    m.player()._st = 2; m.player()._t = 7
    await vi.advanceTimersByTimeAsync(500)  // окно seekInFlight 400 мс
    await poll(2)
    expect(a.currentTime()).toBe(7)
  })

  it('без cueStart: поллы кормят шим как раньше', async () => {
    const a = await open({})
    m.player()._t = 42
    await poll()
    expect(a.currentTime()).toBe(42)
  })

  it('L1: PLAYING короче интервала опроса (событие, не полл) всё равно запускает отсчёт 1500 мс', async () => {
    const a = await open({ cueStart: 100 })
    m.player()._st = 1; m.fire(1); m.player()._st = 3   // PLAYING промелькнул между поллами
    m.player()._t = 0
    await poll(3)
    expect(a.currentTime()).toBe(100)
    await poll(9)                                        // > 1500 мс от события
    expect(a.currentTime()).toBeLessThan(1)
  })

  it('L1: ENDED снимает удержание (ролик закончился на t у самого конца)', async () => {
    const a = await open({ cueStart: 100 })
    m.player()._st = 0; m.player()._t = 64.2
    m.fire(0)
    await poll()
    expect(a.currentTime()).toBeCloseTo(64.2, 1)
  })

  it('destroy: поллы остановлены', async () => {
    const a = await open({ cueStart: 100 })
    a.destroy()
    expect(vi.getTimerCount()).toBe(0)
  })
})
