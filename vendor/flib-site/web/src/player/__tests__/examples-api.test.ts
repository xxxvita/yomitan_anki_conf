// examples-api.test.ts — T1a клиент GET /api/examples
// (docs/contract-2026-07-15-examples-by-word.md).
import { describe, it, expect, vi, afterEach } from 'vitest'
import { fetchExamples } from '../examples-api'

function jsonResponse(status: number, body?: unknown) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

describe('fetchExamples', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
  })

  it('builds the GET URL with word/kind query params, url-encoding the word', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(200, { word: "don't", items: [] }))
    vi.stubGlobal('fetch', fetchMock)
    await fetchExamples("don't stop", 'youtube')
    expect(fetchMock).toHaveBeenCalledWith("/api/examples?word=don't%20stop&kind=youtube")
  })

  it('200 with items → status ok, items passed through', async () => {
    const items = [{ source: 'youtube', ref: 'abc', start_ms: null, end_ms: null, text_en: null, text_ru: null, thumbnail_url: null }]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { word: 'x', items })))
    const result = await fetchExamples('x', 'youtube')
    expect(result).toEqual({ status: 'ok', items })
  })

  it('503 → status not_ready (gateway ручки ещё нет — мягкая деградация, не ошибка)', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(503)))
    const result = await fetchExamples('x', 'any')
    expect(result).toEqual({ status: 'not_ready' })
  })

  it('other non-2xx (e.g. 400/502) → status error with a message', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(502)))
    const result = await fetchExamples('x', 'any')
    expect(result.status).toBe('error')
    if (result.status === 'error') expect(result.message).toContain('502')
  })

  it('malformed body (items not an array) → status error, does not throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse(200, { word: 'x' })))
    const result = await fetchExamples('x', 'any')
    expect(result.status).toBe('error')
  })

  it('network failure (fetch rejects) → status error, does not throw', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')))
    await expect(fetchExamples('x', 'any')).resolves.toEqual({ status: 'error', message: 'Сеть недоступна, попробуйте ещё раз' })
  })
})
