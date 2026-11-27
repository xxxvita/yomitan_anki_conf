// placement-api: записи (PUT, apply) ждут долгий срок, как обмены маршрута; чтения — короткий.
import { describe, it, expect, afterEach, vi } from 'vitest'
import { placementApi } from './placement-api'
import { LONG_TIMEOUT_MS, SHORT_TIMEOUT_MS } from '../route/route-api'

afterEach(() => { vi.useRealTimers() })

/** Сколько мс fetch не отменяют: signal abort ловим таймером. */
async function abortedAt(call: (fetch: (u: string, i: RequestInit) => Promise<Response>) => Promise<unknown>): Promise<'short' | 'long' | 'never'> {
  vi.useFakeTimers()
  let signal: AbortSignal | undefined
  const fetchFn = (_u: string, i: RequestInit) => { signal = i.signal as AbortSignal; return new Promise<Response>(() => {}) }
  void call(fetchFn)
  await vi.advanceTimersByTimeAsync(SHORT_TIMEOUT_MS + 1000)
  if (signal?.aborted) return 'short'
  await vi.advanceTimersByTimeAsync(LONG_TIMEOUT_MS)
  return signal?.aborted ? 'long' : 'never'
}

describe('placementApi: сроки', () => {
  it('PUT и apply — LONG_TIMEOUT_MS', async () => {
    expect(await abortedAt((f) => placementApi.put({ owner: 'o', rev: 0, set: {} }, { fetch: f }))).toBe('long')
    expect(await abortedAt((f) => placementApi.apply({ owner: 'o', run_id: 'r', words: [] }, { fetch: f }))).toBe('long')
  })
  it('чтения — короткий срок', async () => {
    expect(await abortedAt((f) => placementApi.get({ fetch: f }))).toBe('short')
    expect(await abortedAt((f) => placementApi.summary({ fetch: f }))).toBe('short')
  })
})
