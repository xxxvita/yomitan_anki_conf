// IFrameAdapter.captions.test.ts
// Прод-баг 2026-11-19 (маршрут, первый проход): поверх видео были субтитры
// YouTube — сам iframe показывал свою дорожку (настройка аккаунта зрителя
// «всегда показывать субтитры» или дорожка ролика, включённая по умолчанию:
// у 3G_D9cKSRDA она включается даже в чистом профиле без cc_load_policy),
// хотя на сайте выбран «Скрыть». Сайт показывает СВОИ субтитры, а первый проход
// маршрута держится на скрытом тексте, поэтому субтитры YouTube в embed не нужны
// никогда. Модуль captions YouTube подгружает заново при старте воспроизведения
// (проверено в Chromium: выгрузка только в onReady/onApiChange не помогает),
// поэтому выгружаем его и на каждом PLAYING.
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createIFrameAdapter } from '../IFrameAdapter'

type Cfg = { playerVars: Record<string, unknown>; events: Record<string, (e: unknown) => void> }

function installYTMock(opts: { unloadModule?: ((m: string) => void) | null } = {}) {
  const unloadModule = opts.unloadModule === undefined ? vi.fn() : opts.unloadModule
  const state = { cfg: null as Cfg | null, unloadModule }
  const player: Record<string, unknown> = {
    _state: 2,
    getIframe() { return document.createElement('iframe') },
    getCurrentTime() { return 0 },
    getDuration() { return 60 },
    getPlayerState() { return (this as { _state: number })._state },
    getPlaybackRate() { return 1 },
    getAvailablePlaybackRates() { return [1] },
    isMuted() { return false },
    getVolume() { return 100 },
    seekTo() {},
    playVideo() {},
    pauseVideo() {},
    destroy() {},
  }
  if (unloadModule) player.unloadModule = unloadModule
  ;(globalThis as any).YT = {
    Player: vi.fn(function (this: any, _el: string, cfg: Cfg) {
      Object.assign(this, player)
      state.cfg = cfg
      setTimeout(() => cfg.events.onReady({ target: this }), 0)
    }),
    PlayerState: { UNSTARTED: -1, ENDED: 0, PLAYING: 1, PAUSED: 2, BUFFERING: 3, CUED: 5 },
  }
  return state
}

function unloadedModules(fn: ReturnType<typeof vi.fn>): string[] {
  return fn.mock.calls.map(c => c[0] as string)
}

describe('IFrameAdapter — YouTube captions are never shown in the embed', () => {
  let st: ReturnType<typeof installYTMock>
  beforeEach(() => { st = installYTMock() })

  it('asks the embed not to load captions (cc_load_policy: 0)', async () => {
    await createIFrameAdapter('yt', 'abc123', {})
    expect(st.cfg!.playerVars.cc_load_policy).toBe(0)
  })

  it('unloads the captions module on ready', async () => {
    await createIFrameAdapter('yt', 'abc123', {})
    const um = st.unloadModule as ReturnType<typeof vi.fn>
    expect(unloadedModules(um)).toEqual(expect.arrayContaining(['captions', 'cc']))
  })

  it('unloads it again when YouTube (re)loads a module — onApiChange', async () => {
    await createIFrameAdapter('yt', 'abc123', {})
    const um = st.unloadModule as ReturnType<typeof vi.fn>
    um.mockClear()
    st.cfg!.events.onApiChange({})
    expect(unloadedModules(um)).toEqual(expect.arrayContaining(['captions', 'cc']))
  })

  it('unloads it on EVERY PLAYING (YouTube reloads captions when playback starts), not on other states', async () => {
    await createIFrameAdapter('yt', 'abc123', {})
    const um = st.unloadModule as ReturnType<typeof vi.fn>
    um.mockClear()
    st.cfg!.events.onStateChange({ data: 2 }) // PAUSED
    st.cfg!.events.onStateChange({ data: 3 }) // BUFFERING
    expect(um).not.toHaveBeenCalled()
    st.cfg!.events.onStateChange({ data: 1 }) // PLAYING
    expect(unloadedModules(um)).toEqual(expect.arrayContaining(['captions', 'cc']))
    um.mockClear()
    st.cfg!.events.onStateChange({ data: 1 }) // PLAYING again (seek / loop)
    expect(unloadedModules(um)).toEqual(expect.arrayContaining(['captions', 'cc']))
  })

  it('a throwing unloadModule does not break the adapter (guarded)', async () => {
    st = installYTMock({ unloadModule: vi.fn(() => { throw new Error('no such module') }) })
    const a = await createIFrameAdapter('yt', 'abc123', {})
    expect(a.duration()).toBe(60)
    expect(() => st.cfg!.events.onStateChange({ data: 1 })).not.toThrow()
    expect(() => st.cfg!.events.onApiChange({})).not.toThrow()
  })

  it('a player without unloadModule still works (guarded)', async () => {
    st = installYTMock({ unloadModule: null })
    const a = await createIFrameAdapter('yt', 'abc123', {})
    expect(a.duration()).toBe(60)
    expect(() => st.cfg!.events.onStateChange({ data: 1 })).not.toThrow()
  })
})
