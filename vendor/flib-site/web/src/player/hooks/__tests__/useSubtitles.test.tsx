// [ID:P-subs-503]: gateway для незакэшированных видео при невозможности
// достать субтитры (весь egress-пул на cooldown) отдаёт 503 + Retry-After —
// НЕ 404 (постоянное "нет субтитров") и НЕ 200-пустой. Хук поллит короткие
// retry_after внутри сессии и честно сдаётся на длинных/после исчерпания
// SUBS_POLL_WINDOW. Видео — non-blocking (играет независимо), эти тесты
// также проверяют, что хук не трогает playback.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useSubtitles, SUBS_POLL_WINDOW } from '../useSubtitles'
import { makeFakeAdapter } from '../../../adapter/__tests__/fake'

function mockResponse(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
    headers: { get: (name: string) => headers[name] ?? null },
  } as unknown as Response
}

describe('useSubtitles — 503/Retry-After', () => {
  beforeEach(() => { vi.useFakeTimers() })
  afterEach(() => { vi.useRealTimers(); vi.unstubAllGlobals() })

  it('short retry_after (≤ cap): polls and delivers cues on the retry', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(mockResponse(503, { retry_after_seconds: 5 }, { 'Retry-After': '5' }))
      .mockResolvedValueOnce(mockResponse(200, {
        video_id: 'v1', source_language: 'en',
        cues: [{ start: 0, end: 1, text_en: 'hi', text_ru: '' }],
      }))
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSubtitles('v1', null))

    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status).toBe('unavailable')
    expect(result.current.retrying).toBe(true) // короткий retry — хук ещё поллит
    expect(fetchMock).toHaveBeenCalledTimes(1)

    await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
    expect(result.current.status).toBe('ok')
    expect(result.current.retrying).toBe(false)
    expect(result.current.cues).toHaveLength(1)
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('long retry_after (> cap): status unavailable, gives up (no infinite poll)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      mockResponse(503, { retry_after_seconds: 3600 }, { 'Retry-After': '3600' }),
    )
    vi.stubGlobal('fetch', fetchMock)

    const { result } = renderHook(() => useSubtitles('v2', null))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status).toBe('unavailable')
    expect(result.current.retrying).toBe(false) // честно сдались, не поллим часовой retry_after

    // Даже подождав дольше SUBS_POLL_WINDOW — новых попыток не было.
    await act(async () => { await vi.advanceTimersByTimeAsync((SUBS_POLL_WINDOW + 60) * 1000) })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('videoId change mid-poll cancels the pending retry timer (no leak/race)', async () => {
    const fetchMock = vi.fn()
      // v1: короткий 503 — планирует retry через 5с
      .mockResolvedValueOnce(mockResponse(503, { retry_after_seconds: 5 }, {}))
      // v2 (после смены videoId, до того как таймер v1 успел выстрелить): сразу 200
      .mockResolvedValueOnce(mockResponse(200, { video_id: 'v2', source_language: 'en', cues: [] }))
    vi.stubGlobal('fetch', fetchMock)

    const { result, rerender } = renderHook(
      ({ id }: { id: string }) => useSubtitles(id, null),
      { initialProps: { id: 'v1' } },
    )
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status).toBe('unavailable')
    expect(fetchMock).toHaveBeenCalledTimes(1)

    rerender({ id: 'v2' }) // сменили видео ДО того, как 5с-таймер v1 сработал
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(fetchMock).toHaveBeenCalledTimes(2) // v1-initial + v2-initial, НЕ v1's отложенный retry
    expect(result.current.status).toBe('ok')

    // Ждём дольше 5с — если бы таймер v1 не был отменён на смене videoId,
    // был бы третий вызов fetch (и/или гонка перезаписала бы состояние v2).
    await act(async () => { await vi.advanceTimersByTimeAsync(6000) })
    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(result.current.status).toBe('ok')
  })

  it('503 with NO parseable Retry-After (no header, no body key) → gives up, does NOT poll (Fable HIGH-3: null≠default)', async () => {
    const fetchMock = vi.fn().mockResolvedValue(mockResponse(503, { error: 'saturated' }, {}))
    vi.stubGlobal('fetch', fetchMock)
    const { result } = renderHook(() => useSubtitles('v5', null))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status).toBe('unavailable')
    expect(result.current.retrying).toBe(false) // parseRetryAfterSec → null → «не знаем когда» → не поллим
    await act(async () => { await vi.advanceTimersByTimeAsync((SUBS_POLL_WINDOW + 60) * 1000) })
    expect(fetchMock).toHaveBeenCalledTimes(1) // ни одной повторной попытки
  })

  it('404 still reports no_subtitles (regression — distinct from unavailable)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse(404, { error: 'no_subtitles' })))
    const { result } = renderHook(() => useSubtitles('v3', null))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(result.current.status).toBe('no_subtitles')
    expect(result.current.retrying).toBe(false)
  })

  it('does not touch playback regardless of subtitle status (video stays non-blocking)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      mockResponse(503, { retry_after_seconds: 3600 }, {}),
    ))
    const adapter = makeFakeAdapter({ t: 0 })
    const spy = vi.fn()
    adapter._spy = spy
    renderHook(() => useSubtitles('v4', adapter))
    await act(async () => { await vi.advanceTimersByTimeAsync(0) })
    expect(spy).not.toHaveBeenCalledWith('play')
    expect(spy).not.toHaveBeenCalledWith('pause')
  })
})

// План B8a: метка источника EN-дорожки (X-Subtitle-Source, её пробрасывает BFF)
// доступна плееру — из неё subs_source событий маршрута (`server:<источник>`).
describe('useSubtitles — X-Subtitle-Source', () => {
  afterEach(() => { vi.unstubAllGlobals() })

  it('отдаёт источник дорожки; без заголовка — null', async () => {
    const body = { video_id: 'v1', source_language: 'en', cues: [{ start: 0, end: 1, text_en: 'hi', text_ru: '' }] }
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(mockResponse(200, body, { 'X-Subtitle-Source': 'daemon_align' })))
    const a = renderHook(() => useSubtitles('v1', null))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(a.result.current.source).toBe('daemon_align')
    vi.stubGlobal('fetch', vi.fn().mockResolvedValueOnce(mockResponse(200, body)))
    const b = renderHook(() => useSubtitles('v2', null))
    await act(async () => { await Promise.resolve(); await Promise.resolve() })
    expect(b.result.current.source).toBeNull()
  })
})
