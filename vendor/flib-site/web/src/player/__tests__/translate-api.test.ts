// translate-api.test.ts — клиент BFF-ручки: статус → вариант union (образец examples-api).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { translateWindow, TRANSLATE_DEFAULT_RETRY_SEC, TRANSLATE_MAX_RETRY_SEC } from '../translate-api'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// fakeRes — минимальный Response-подобный объект (status + json + headers.get).
function fakeRes(status: number, body: unknown, headers: Record<string, string> = {}) {
  return {
    status,
    json: async () => {
      if (body === undefined) throw new Error('no body')
      return body
    },
    headers: { get: (k: string) => headers[k] ?? null },
  }
}

function stubFetch(res: unknown) {
  vi.stubGlobal('fetch', vi.fn().mockResolvedValue(res))
}

describe('translateWindow', () => {
  it('posts video_id/from_ms/to_ms to the BFF endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(fakeRes(200, { cues: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await translateWindow('dQw4w9WgXcQ', 1000, 2000)
    expect(fetchMock).toHaveBeenCalledWith('/api/youtube/subtitles/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ video_id: 'dQw4w9WgXcQ', from_ms: 1000, to_ms: 2000 }),
    })
  })

  it('200 with cues → ok + source from X-Subtitle-Source', async () => {
    stubFetch(fakeRes(200, { cues: [{ en: 'Hi', ru: 'Привет', start: 1, end: 2 }] }, { 'X-Subtitle-Source': 'composite' }))
    const r = await translateWindow('vid00000001', 0, 1000)
    expect(r).toEqual({ status: 'ok', cues: [{ en: 'Hi', ru: 'Привет', start: 1, end: 2 }], source: 'composite' })
  })

  it('200 cues:[] → empty', async () => {
    stubFetch(fakeRes(200, { cues: [] }))
    expect(await translateWindow('vid00000001', 0, 1000)).toEqual({ status: 'empty' })
  })

  it('200 malformed (cues not array / missing) → error (Fable LOW-f)', async () => {
    stubFetch(fakeRes(200, { cues: 'nope' }))
    expect((await translateWindow('vid00000001', 0, 1000)).status).toBe('error')
    stubFetch(fakeRes(200, {}))
    expect((await translateWindow('vid00000001', 0, 1000)).status).toBe('error')
  })

  it('404 → not_in_corpus', async () => {
    stubFetch(fakeRes(404, { error: 'not_in_corpus' }))
    expect(await translateWindow('vid00000001', 0, 1000)).toEqual({ status: 'not_in_corpus' })
  })

  it('403 → forbidden', async () => {
    stubFetch(fakeRes(403, { error: 'forbidden' }))
    expect(await translateWindow('vid00000001', 0, 1000)).toEqual({ status: 'forbidden' })
  })

  it('429 → busy with retry from header, kind 429', async () => {
    stubFetch(fakeRes(429, { error: 'rate_limited' }, { 'Retry-After': '7' }))
    expect(await translateWindow('vid00000001', 0, 1000)).toEqual({ status: 'busy', retryAfterSec: 7, kind: '429' })
  })

  it('503 → busy, kind 503, DEFAULT retry when neither header nor body carries it', async () => {
    stubFetch(fakeRes(503, { error: 'daemon_unavailable' }))
    expect(await translateWindow('vid00000001', 0, 1000)).toEqual({ status: 'busy', retryAfterSec: TRANSLATE_DEFAULT_RETRY_SEC, kind: '503' })
  })

  it('429 with body retry_after_sec (BFF gate reject shape) → busy from body key', async () => {
    stubFetch(fakeRes(429, { error: 'rate_limited', retry_after_sec: 5 }))
    expect(await translateWindow('vid00000001', 0, 1000)).toEqual({ status: 'busy', retryAfterSec: 5, kind: '429' })
  })

  it('503 with body retry_after_seconds → busy, kind 503', async () => {
    stubFetch(fakeRes(503, { error: 'saturated', retry_after_seconds: 12 }))
    expect(await translateWindow('vid00000001', 0, 1000)).toEqual({ status: 'busy', retryAfterSec: 12, kind: '503' })
  })

  it('caps an absurd gateway Retry-After (Fable LOW-2: setTimeout overflow / mount-long disable)', async () => {
    stubFetch(fakeRes(503, { error: 'saturated' }, { 'Retry-After': '99999999' }))
    const r = await translateWindow('vid00000001', 0, 1000)
    expect(r).toEqual({ status: 'busy', retryAfterSec: TRANSLATE_MAX_RETRY_SEC, kind: '503' })
  })

  it('400 → error (client bug, not shown)', async () => {
    stubFetch(fakeRes(400, { error: 'bad_request' }))
    expect(await translateWindow('vid00000001', 0, 1000)).toEqual({ status: 'error' })
  })

  it('502 / other → error', async () => {
    stubFetch(fakeRes(502, { error: 'bad_gateway' }))
    expect(await translateWindow('vid00000001', 0, 1000)).toEqual({ status: 'error' })
  })

  it('network throw → error (no throw escapes)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    expect(await translateWindow('vid00000001', 0, 1000)).toEqual({ status: 'error' })
  })
})
