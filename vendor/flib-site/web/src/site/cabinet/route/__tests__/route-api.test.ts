// route-api.test.ts — клиент /api/me/route/* (план B7): автоповтор по коду
// (§4.3), CSRF на меняющих запросах, таймаут обмена и быстрого старта 100 с,
// общий запрос состояния вкладки и повтор `429 busy` без параллельных запросов,
// проба для сторожа `flib:route-watched` снимается в момент отправки.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { apiCall, classifyError, routeApi, type ApiDeps } from '../route-api'
import { __resetRouteStateForTests, fetchRouteState } from '../use-route-state'
import { forDate } from '../learning-day'

function resp(status: number, body: unknown, headers: Record<string, string> = {}): Response {
  return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } })
}

describe('classifyError (§4.3: по коду, а не по статусу)', () => {
  const rows: Array<[number, string | null, string]> = [
    [502, 'gateway_unavailable', 'temporary'],
    [502, null, 'temporary'],                // тело не JSON / без error (туннель, край)
    [503, null, 'temporary'],
    [503, 'gateway_busy', 'temporary'],
    [503, 'route_unavailable', 'temporary'],
    [503, 'route_timeout', 'temporary'],
    [503, 'daemon_unavailable', 'temporary'],
    [502, 'gateway_refused', 'refused'],
    [502, 'brand_new_code', 'refused'],      // разобранный, но незнакомый
    [429, 'busy', 'rate'],
    [429, 'route_banned', 'rate'],
    [0, null, 'temporary'],
    [409, 'stale_revision', 'other'],
    [400, 'goal_empty', 'other'],
  ]
  for (const [st, code, want] of rows) it(`${st} ${code} → ${want}`, () => expect(classifyError(st, code)).toBe(want))
})

describe('apiCall', () => {
  it('502 text/html — без кода, временный; JSON-код берётся из code раньше error', async () => {
    const deps: ApiDeps = { fetch: async () => new Response('<html>bad gateway</html>', { status: 502, headers: { 'Content-Type': 'text/html' } }) }
    const r = await apiCall('GET', '/api/me/route/state', { deps })
    expect(r.ok).toBe(false)
    if (!r.ok) { expect(r.code).toBeNull(); expect(r.cls).toBe('temporary') }
    const r2 = await apiCall('GET', '/x', { deps: { fetch: async () => resp(502, { code: 'gateway_refused', error: 'Human text' }) } })
    if (!r2.ok) { expect(r2.code).toBe('gateway_refused'); expect(r2.cls).toBe('refused') }
  })

  it('Retry-After из заголовка; меняющие запросы несут X-Flib-Request, GET — нет', async () => {
    const seen: RequestInit[] = []
    const deps: ApiDeps = { fetch: async (_u, init) => { seen.push(init); return resp(503, { error: 'gateway_busy' }, { 'Retry-After': '9' }) } }
    const r = await routeApi.exchange({ expected_revision: 1, want: 'next', for_date: '2026-11-18' }, deps)
    if (!r.ok) expect(r.retryAfterSec).toBe(9)
    await routeApi.state(deps)
    expect((seen[0].headers as Record<string, string>)['X-Flib-Request']).toBe('1')
    expect((seen[1].headers as Record<string, string>)['X-Flib-Request']).toBeUndefined()
  })

  it('таймаут браузера на обмен и быстрый старт — 100 с, прочие — 30 с', async () => {
    vi.useFakeTimers()
    try {
      const hang: ApiDeps = { fetch: (_u, init) => new Promise<Response>((_res, rej) => { init.signal?.addEventListener('abort', () => rej(new DOMException('a', 'AbortError'))) }) }
      let done = false
      const p = routeApi.exchange({ expected_revision: 1, want: 'next', for_date: '2026-11-18' }, hang).then(r => { done = true; return r })
      await vi.advanceTimersByTimeAsync(99_000)
      expect(done).toBe(false)
      await vi.advanceTimersByTimeAsync(1_500)
      expect((await p).status).toBe(0)
      let done2 = false
      void routeApi.quickStart({}, hang).then(() => { done2 = true })
      await vi.advanceTimersByTimeAsync(99_000)
      expect(done2).toBe(false)
      let done3 = false
      void routeApi.state(hang).then(() => { done3 = true })
      await vi.advanceTimersByTimeAsync(30_500)
      expect(done3).toBe(true)
    } finally {
      vi.useRealTimers()
    }
  })
})

describe('fetchRouteState — один общий запрос вкладки', () => {
  beforeEach(() => __resetRouteStateForTests())
  afterEach(() => vi.useRealTimers())

  it('два одновременных читателя — один запрос', async () => {
    let n = 0
    let release: () => void = () => {}
    const deps: ApiDeps = { fetch: () => { n++; return new Promise<Response>(r => { release = () => r(resp(200, { started: false })) }) } }
    const a = fetchRouteState({ api: deps, probe: () => ({ watchedSeq: 0, pendingClipPlayed: new Set() }) })
    const b = fetchRouteState({ api: deps, probe: () => ({ watchedSeq: 0, pendingClipPlayed: new Set() }) })
    release()
    const [ra, rb] = await Promise.all([a, b])
    expect(n).toBe(1)
    expect(ra).toBe(rb)
  })

  it('429 busy — повтор по Retry-After, без параллельных; проба — на отправке ответившего запроса', async () => {
    const times: number[] = []
    let inFlight = 0, maxInFlight = 0
    let k = 0
    let seq = 10
    const deps: ApiDeps = {
      fetch: async () => {
        inFlight++; maxInFlight = Math.max(maxInFlight, inFlight)
        times.push(k)
        const r = k++ < 2 ? resp(429, { error: 'busy' }, { 'Retry-After': '3' }) : resp(200, { started: true, revision: 1 })
        inFlight--
        return r
      },
    }
    const slept: number[] = []
    const out = await fetchRouteState({
      api: deps,
      probe: () => ({ watchedSeq: seq++, pendingClipPlayed: new Set([`p${seq}`]) }),
      sleep: async ms => { slept.push(ms) },
    })
    expect(out.result.ok).toBe(true)
    expect(slept).toEqual([3000, 3000])
    expect(maxInFlight).toBe(1)
    expect(out.sent.watchedSeq).toBe(12)
  })
})

describe('forDate (§4.5: прижатие с двух сторон)', () => {
  it('учебный день до 04:00 — вчерашний', () => {
    expect(forDate(null, new Date(2026, 10, 18, 3, 30))).toBe('2026-11-17')
    expect(forDate(null, new Date(2026, 10, 18, 4, 0))).toBe('2026-11-18')
  })
  it('не раньше snapshot_date', () => {
    expect(forDate('2026-11-20', new Date(2026, 10, 18, 12))).toBe('2026-11-20')
  })
  it('не позже UTC-сегодня + 2 дня', () => {
    const now = new Date(Date.UTC(2026, 10, 18, 12))
    const fake = { ...now, getHours: () => 12, getMinutes: () => 0, getFullYear: () => 2027, getMonth: () => 0, getDate: () => 5, toISOString: () => now.toISOString() } as unknown as Date
    expect(forDate(null, fake)).toBe('2026-11-20')
  })
})
