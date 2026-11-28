// NativeVideoAdapter.test.ts [ID:P-hybrid] — контракт Track B на фейковом
// HTMLVideoElement (jsdom): маппинг DOM-событий → PlayerEvent (паритет с
// IFrameAdapter.test.ts/unplayable.test.ts), поллинг /api/video/{id}
// (202→200, 404→unplayable сразу, таймаут NATIVE_POLL_MAX_MS→unplayable),
// video 'error' → unplayable native-error, destroy() teardown.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { createNativeVideoAdapter } from '../NativeVideoAdapter'

function mountHost(): string {
  const host = document.createElement('div')
  host.id = 'native-host'
  document.body.appendChild(host)
  return host.id
}

function fakeResponse(status: number, cancel = vi.fn().mockResolvedValue(undefined)) {
  return { status, body: { cancel } }
}

function videoEl(): HTMLVideoElement {
  const el = document.querySelector('#native-host video')
  if (!el) throw new Error('adapter did not mount a <video> element')
  return el as HTMLVideoElement
}

describe('NativeVideoAdapter [ID:P-hybrid]', () => {
  beforeEach(() => {
    document.body.innerHTML = ''
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('mounts a <video playsinline> into the host element', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(202)))
    mountHost()
    await createNativeVideoAdapter('native-host', 'vid00000001', {})
    const v = videoEl()
    expect(v.tagName).toBe('VIDEO')
    expect(v.playsInline).toBe(true)
  })

  it('warming (202): adapter starts in "buffering" state/getter, no <video>.src yet', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(202)))
    mountHost()
    const a = await createNativeVideoAdapter('native-host', 'vid00000001', {})
    expect(a.buffering()).toBe(true)
    expect(videoEl().getAttribute('src')).toBeFalsy()
  })

  it('202 → 200 transition: stops polling and assigns <video>.src to /api/video/{id}', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(fakeResponse(202))
      .mockResolvedValueOnce(fakeResponse(200))
    vi.stubGlobal('fetch', fetchMock)
    mountHost()
    await createNativeVideoAdapter('native-host', 'vid00000001', {})
    await vi.advanceTimersByTimeAsync(0) // первый fetch отложен на следующий тик (см. NativeVideoAdapter.ts)

    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000) // второй тик поллинга
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(videoEl().getAttribute('src')).toBe('/api/video/vid00000001')

    // Файл готов → дальше НЕ поллим (третий тик не должен добавить вызов).
    await vi.advanceTimersByTimeAsync(3000)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('404 (флаг выключен) → сразу emit unplayable {reason:"native-error"}, poll не повторяется', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeResponse(404))
    vi.stubGlobal('fetch', fetchMock)
    mountHost()
    const a = await createNativeVideoAdapter('native-host', 'vid00000001', {})
    const cb = vi.fn()
    a.on('unplayable', cb)
    await vi.advanceTimersByTimeAsync(0)

    expect(cb).toHaveBeenCalledWith({ reason: 'native-error' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    await vi.advanceTimersByTimeAsync(3000)
    expect(fetchMock).toHaveBeenCalledTimes(1) // не повторяет poll после 404
  })

  it('прогрев дольше NATIVE_POLL_MAX_MS (10 мин) → unplayable native-error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(202)))
    mountHost()
    const a = await createNativeVideoAdapter('native-host', 'vid00000001', {})
    const cb = vi.fn()
    a.on('unplayable', cb)

    await vi.advanceTimersByTimeAsync(10 * 60 * 1000 + 3000)
    expect(cb).toHaveBeenCalledWith({ reason: 'native-error' })
  })

  it('транзиентная ошибка сети во время поллинга — повторяет попытку, не сдаётся сразу', async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error('network down'))
      .mockResolvedValueOnce(fakeResponse(200))
    vi.stubGlobal('fetch', fetchMock)
    mountHost()
    const a = await createNativeVideoAdapter('native-host', 'vid00000001', {})
    const cb = vi.fn()
    a.on('unplayable', cb)

    await vi.advanceTimersByTimeAsync(0)
    expect(cb).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(3000)
    expect(videoEl().getAttribute('src')).toBe('/api/video/vid00000001')
  })

  it('<video> "error" событие → emit unplayable {reason:"native-error"}', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(202)))
    mountHost()
    const a = await createNativeVideoAdapter('native-host', 'vid00000001', {})
    const cb = vi.fn()
    a.on('unplayable', cb)
    videoEl().dispatchEvent(new Event('error'))
    expect(cb).toHaveBeenCalledWith({ reason: 'native-error' })
  })

  it('маппинг DOM-событий → state: playing/pause/waiting/ended', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(202)))
    mountHost()
    const a = await createNativeVideoAdapter('native-host', 'vid00000001', {})
    const cb = vi.fn()
    a.on('state', cb)
    const v = videoEl()

    v.dispatchEvent(new Event('playing'))
    expect(cb).toHaveBeenLastCalledWith('playing')
    v.dispatchEvent(new Event('pause'))
    expect(cb).toHaveBeenLastCalledWith('paused')
    v.dispatchEvent(new Event('waiting'))
    expect(cb).toHaveBeenLastCalledWith('buffering')
    v.dispatchEvent(new Event('ended'))
    expect(cb).toHaveBeenLastCalledWith('ended')
  })

  it('ready: emit("ready") на loadedmetadata', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(202)))
    mountHost()
    const a = await createNativeVideoAdapter('native-host', 'vid00000001', {})
    const cb = vi.fn()
    a.on('ready', cb)
    videoEl().dispatchEvent(new Event('loadedmetadata'))
    expect(cb).toHaveBeenCalledTimes(1)
  })

  it('seek(): устанавливает currentTime и isOurSeekInFlight() истинно СРАЗУ после вызова', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(202)))
    mountHost()
    const a = await createNativeVideoAdapter('native-host', 'vid00000001', {})
    a.seek(42)
    expect(videoEl().currentTime).toBe(42)
    expect(a.isOurSeekInFlight()).toBe(true)
  })

  it('mute/setVolume: масштаб 0..100 конвертируется в video.volume 0..1', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(202)))
    mountHost()
    const a = await createNativeVideoAdapter('native-host', 'vid00000001', {})
    a.setVolume(50)
    expect(videoEl().volume).toBeCloseTo(0.5)
    expect(a.volume()).toBe(50)
    a.mute()
    expect(videoEl().muted).toBe(true)
    expect(a.muted()).toBe(true)
    a.unmute()
    expect(a.muted()).toBe(false)
  })

  it('destroy(): снимает src, убирает <video> из DOM, дальнейшие события не долетают до подписчиков', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(202)))
    mountHost()
    const a = await createNativeVideoAdapter('native-host', 'vid00000001', {})
    const cb = vi.fn()
    a.on('unplayable', cb)
    const v = videoEl()

    a.destroy()

    expect(v.parentNode).toBeNull()
    expect(v.getAttribute('src')).toBeFalsy()
    v.dispatchEvent(new Event('error'))
    expect(cb).not.toHaveBeenCalled()

    // Поллинг тоже обязан остановиться — фоновые fetch после destroy() не идут.
    const fetchMock = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>)
    const callsBefore = fetchMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(10000)
    expect(fetchMock.mock.calls.length).toBe(callsBefore)
  })

  it('isCancelled(): возвращает no-op адаптер, не трогает DOM/сеть (StrictMode double-mount)', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    mountHost()
    const a = await createNativeVideoAdapter('native-host', 'vid00000001', {}, () => true)
    expect(document.querySelector('#native-host video')).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
    expect(a.currentTime()).toBe(0)
    expect(() => a.destroy()).not.toThrow()
  })
})

describe('NativeVideoAdapter cueStart (ссылка ?t=)', () => {
  beforeEach(() => { document.body.innerHTML = ''; vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  async function open(opts: { cueStart?: number; startSeconds?: number }, duration: number) {
    document.body.innerHTML = ''
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(200)))
    mountHost()
    await createNativeVideoAdapter('native-host', 'vid00000001', opts)
    await vi.advanceTimersByTimeAsync(0)
    const v = videoEl()
    Object.defineProperty(v, 'duration', { value: duration, configurable: true })
    v.currentTime = 0
    v.dispatchEvent(new Event('loadedmetadata'))
    return v
  }

  it('cueStart < duration → currentTime', async () => {
    expect((await open({ cueStart: 60 }, 120)).currentTime).toBe(60)
  })
  it('cueStart ≥ duration → игнорируется (0)', async () => {
    expect((await open({ cueStart: 120 }, 120)).currentTime).toBe(0)
    expect((await open({ cueStart: 500 }, 120)).currentTime).toBe(0)
  })
  it('startSeconds побеждает cueStart', async () => {
    expect((await open({ startSeconds: 10, cueStart: 60 }, 120)).currentTime).toBe(10)
  })

  it('duration NaN (неизвестна) → cue применяется', async () => {
    expect((await open({ cueStart: 60 }, NaN)).currentTime).toBe(60)
  })
  it('duration Infinity (поток) → cue применяется', async () => {
    expect((await open({ cueStart: 60 }, Infinity)).currentTime).toBe(60)
  })

  async function openNoMeta(opts: { cueStart?: number }) {
    document.body.innerHTML = ''
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(fakeResponse(200)))
    mountHost()
    const a = await createNativeVideoAdapter('native-host', 'vid00000001', opts)
    await vi.advanceTimersByTimeAsync(0)
    const v = videoEl()
    Object.defineProperty(v, 'duration', { value: 120, configurable: true })
    return { a, v }
  }
  it('seek до loadedmetadata отменяет cue: перемотка пользователя главнее', async () => {
    const { a, v } = await openNoMeta({ cueStart: 60 })
    a.seek(5)
    expect(v.currentTime).toBe(5)           // сам seek не потерян
    v.dispatchEvent(new Event('loadedmetadata'))
    expect(v.currentTime).toBe(5)           // cue его не перезаписал
  })
  it('listener once: повторный loadedmetadata не возвращает на cue', async () => {
    const { v } = await openNoMeta({ cueStart: 60 })
    v.dispatchEvent(new Event('loadedmetadata'))
    expect(v.currentTime).toBe(60)
    v.currentTime = 7
    v.dispatchEvent(new Event('loadedmetadata'))
    expect(v.currentTime).toBe(7)
  })
})
