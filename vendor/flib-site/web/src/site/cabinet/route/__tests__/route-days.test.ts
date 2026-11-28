// route-days.test.ts — чтение `GET /api/me/route/days` календарём (спека
// 2026-11-17 §4.12 «Чтения», M8, R2-L4, §7 случай 32; план B10c): не больше
// одного запроса в полёте на вкладку, никогда не шире месяца, месяцы в кэше до
// смены ревизии, `429 busy` — повтор по Retry-After.
import { describe, it, expect } from 'vitest'
import { DaysLoader } from '../route-days'
import type { ApiResult } from '../route-api'
import type { DaysEntry } from '../calendar-model'

type Reply = ApiResult<{ days: DaysEntry[] }>
const ok = (days: DaysEntry[]): Reply => ({ ok: true, status: 200, data: { days } })
const busy = (ra = 2): Reply => ({ ok: false, status: 429, code: 'busy', retryAfterSec: ra, cls: 'rate', body: { error: 'busy' } })

function harness(reply: (from: string, n: number) => Promise<Reply> | Reply) {
  const calls: Array<{ from: string; to: string }> = []
  const slept: number[] = []
  let inflight = 0
  let maxInflight = 0
  let n = 0
  const loader = new DaysLoader({
    fetchDays: async (from, to) => {
      calls.push({ from, to }); inflight++; maxInflight = Math.max(maxInflight, inflight)
      try { return await reply(from, ++n) } finally { inflight-- }
    },
    sleep: async ms => { slept.push(ms) },
  })
  return { loader, calls, slept, max: () => maxInflight }
}
const tick = () => new Promise(r => setTimeout(r, 0))
async function settle(l: DaysLoader) { for (let i = 0; i < 50 && l.busy(); i++) await new Promise(r => setTimeout(r, 2)) }

describe('DaysLoader', () => {
  it('диапазон — ровно месяц (≤ 31 день)', async () => {
    const h = harness(() => ok([]))
    h.loader.setEpoch('r:1')
    h.loader.want('2026-02')
    await settle(h.loader)
    expect(h.calls).toEqual([{ from: '2026-02-01', to: '2026-02-28' }])
  })

  it('быстрое листание трёх месяцев — не больше одного запроса одновременно', async () => {
    const h = harness(async () => { await new Promise(r => setTimeout(r, 5)); return ok([]) })
    h.loader.setEpoch('r:1')
    h.loader.want('2026-11'); h.loader.want('2026-10'); h.loader.want('2026-09')
    await settle(h.loader)
    expect(h.max()).toBe(1)
    expect(h.loader.months.has('2026-09')).toBe(true)
  })

  it('месяц в кэше — второго запроса нет; смена ревизии кэш сбрасывает', async () => {
    const h = harness(() => ok([{ date: '2026-11-10', clips: [] }]))
    h.loader.setEpoch('r:1')
    h.loader.want('2026-11'); await settle(h.loader)
    h.loader.want('2026-11'); await settle(h.loader)
    expect(h.calls).toHaveLength(1)
    h.loader.setEpoch('r:2')
    expect(h.loader.months.size).toBe(0)
    h.loader.want('2026-11'); await settle(h.loader)
    expect(h.calls).toHaveLength(2)
  })

  it('429 busy — повтор по Retry-After, без параллельных запросов', async () => {
    const h = harness((_f, n) => (n === 1 ? busy(3) : ok([])))
    h.loader.setEpoch('r:1')
    h.loader.want('2026-11'); await settle(h.loader)
    expect(h.slept).toEqual([3000])
    expect(h.calls).toHaveLength(2)
    expect(h.max()).toBe(1)
    expect(h.loader.months.get('2026-11')).toEqual([])
  })

  it('ответ, пришедший после смены ревизии, в кэш не ложится', async () => {
    let release: (r: Reply) => void = () => {}
    const h = harness((_f, n) => (n === 1 ? new Promise<Reply>(r => { release = r }) : ok([])))
    h.loader.setEpoch('r:1')
    h.loader.want('2026-11'); await tick()
    h.loader.setEpoch('r:2')
    release(ok([{ date: '2026-11-03', clips: [] }]))
    await settle(h.loader)
    expect(h.loader.months.get('2026-11')).toEqual([])
    expect(h.max()).toBe(1)
  })

  it('отказ без 429 — месяц не кэшируется и перечитывается сам: 2, 4, 8 … ≤ 60 с, один запрос в полёте (ревью 3b, L5)', async () => {
    const timers: Array<{ ms: number; fn: () => void }> = []
    let now = 0
    const fail = { ok: false, status: 502, code: 'gateway_unavailable', retryAfterSec: null, cls: 'temporary', body: null } as Reply
    let n = 0
    let inflight = 0
    let max = 0
    const loader = new DaysLoader({
      fetchDays: async () => { n++; inflight++; max = Math.max(max, inflight); try { return n <= 7 ? fail : ok([]) } finally { inflight-- } },
      sleep: async () => {},
      now: () => now,
      setTimer: (fn, ms) => { timers.push({ ms, fn }); return timers.length },
    })
    loader.subscribe(() => undefined)
    loader.setEpoch('r:1')
    loader.want('2026-11'); await settle(loader)
    expect(n).toBe(1)
    expect(loader.failedUntil('2026-11')).toBe(2000)
    // повторный переход до срока повтора запроса не делает
    loader.want('2026-11'); await settle(loader)
    expect(n).toBe(1)
    const delays: number[] = []
    for (let i = 0; i < 7; i++) {
      const t = timers.shift()!
      delays.push(t.ms)
      now += t.ms - 1 // таймер сработал на миллисекунду раньше часов — повтор всё равно идёт
      t.fn(); await settle(loader)
    }
    expect(delays).toEqual([2000, 4000, 8000, 16000, 32000, 60000, 60000])
    expect(loader.months.has('2026-11')).toBe(true)
    expect(loader.failedUntil('2026-11')).toBeNull()
    expect(max).toBe(1)
  })

  it('отказ, затем смена ревизии — месяц читается сразу, не ждёт повтора прежней эпохи', async () => {
    let n = 0
    const loader = new DaysLoader({
      fetchDays: async () => (++n === 1 ? { ok: false, status: 503, code: 'route_timeout', retryAfterSec: 30, cls: 'temporary', body: null } : ok([])),
      sleep: async () => {}, now: () => 0, setTimer: () => 1,
    })
    loader.subscribe(() => undefined)
    loader.setEpoch('r:1')
    loader.want('2026-11'); await settle(loader)
    expect(loader.failedUntil('2026-11')).toBe(30000)
    loader.setEpoch('r:2')
    await settle(loader)
    expect(n).toBe(2)
    expect(loader.months.has('2026-11')).toBe(true)
    expect(loader.failedUntil('2026-11')).toBeNull()
  })

  it('отказ с Retry-After — повтор через Retry-After', async () => {
    const timers: number[] = []
    const loader = new DaysLoader({
      fetchDays: async () => ({ ok: false, status: 503, code: 'route_timeout', retryAfterSec: 7, cls: 'temporary', body: null }),
      sleep: async () => {}, now: () => 0, setTimer: (_fn, ms) => { timers.push(ms); return 1 },
    })
    loader.subscribe(() => undefined)
    loader.setEpoch('r:1')
    loader.want('2026-11'); await settle(loader)
    expect(timers).toEqual([7000])
  })
})

// --- ревью 3b, второй круг: R1-L1 (какие отказы повторять и до каких пор), R1-L4 ---

type RR = ApiResult<{ days: DaysEntry[] }>
type RE = Extract<RR, { ok: false }>
const errR = (status: number, code: string | null, ra: number | null, cls: 'temporary' | 'refused' | 'rate' | 'other'): RE =>
  ({ ok: false, status, code, retryAfterSec: ra, cls, body: code ? { error: code } : null })
function vclock() {
  let now = 0
  let id = 0
  const timers = new Map<number, { at: number; fn: () => void }>()
  return {
    now: () => now,
    setTimer: (fn: () => void, ms: number) => { const h = ++id; timers.set(h, { at: now + ms, fn }); return h },
    clearTimer: (h: unknown) => { timers.delete(h as number) },
    pending: () => timers.size,
    async advance(ms: number) {
      const end = now + ms
      for (;;) {
        for (let i = 0; i < 30; i++) await Promise.resolve()
        const due = [...timers.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0]
        if (!due) break
        now = due[1].at
        timers.delete(due[0])
        due[1].fn()
      }
      now = end
      for (let i = 0; i < 30; i++) await Promise.resolve()
    },
  }
}
function vsetup(reply: (from: string, n: number) => RR, onAuth?: () => void) {
  const c = vclock()
  const calls: Array<{ from: string; at: number }> = []
  let n = 0
  const l = new DaysLoader({
    fetchDays: async from => { calls.push({ from, at: c.now() }); return reply(from, ++n) },
    sleep: ms => new Promise<void>(r => { c.setTimer(r, ms) }),
    now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer, onAuth,
  })
  return { l, c, calls }
}

describe('DaysLoader: отказы (R1-L1)', () => {
  for (const [name, r] of [
    ['502 gateway_refused', errR(502, 'gateway_refused', null, 'refused')],
    ['401 no_session', errR(401, 'no_session', null, 'other')],
    ['403 key_expired', errR(403, 'key_expired', null, 'other')],
    ['403 route_forbidden', errR(403, 'route_forbidden', null, 'other')],
    ['404 not_found', errR(404, 'not_found', null, 'other')],
    ['400 bad_request', errR(400, 'bad_request', null, 'other')],
  ] as Array<[string, RE]>) {
    it(`${name} — не повторяется (один запрос за час)`, async () => {
      const h = vsetup(() => r)
      const un = h.l.subscribe(() => undefined)
      h.l.setEpoch('r:1'); h.l.want('2026-11')
      await h.c.advance(3600_000)
      expect(h.calls).toHaveLength(1)
      expect(h.l.failure('2026-11')?.kind).toBe(r.cls === 'refused' ? 'refused' : 'stopped')
      un()
    })
  }

  it('401 и 403 — сессия перечитывается (§3.3)', async () => {
    let auth = 0
    for (const r of [errR(401, 'no_session', null, 'other'), errR(403, 'key_expired', null, 'other')]) {
      const h = vsetup(() => r, () => { auth++ })
      const un = h.l.subscribe(() => undefined)
      h.l.setEpoch('r:1'); h.l.want('2026-11')
      await h.c.advance(10)
      un()
    }
    expect(auth).toBe(2)
  })

  it('503, сеть, 502 без кода — повторяются; Retry-After больше 60 с соблюдается целиком', async () => {
    for (const r of [errR(503, 'route_timeout', 120, 'temporary'), errR(0, null, null, 'temporary'), errR(502, null, null, 'temporary')]) {
      const h = vsetup((_f, n) => (n === 1 ? r : ok([])))
      const un = h.l.subscribe(() => undefined)
      h.l.setEpoch('r:1'); h.l.want('2026-11')
      await h.c.advance(10)
      expect(h.l.failure('2026-11')?.kind).toBe('temporary')
      await h.c.advance(r.retryAfterSec ? 119_000 : 1000)
      expect(h.calls).toHaveLength(1)
      await h.c.advance(r.retryAfterSec ? 1_000 : 1000)
      expect(h.calls).toHaveLength(2)
      expect(h.l.months.has('2026-11')).toBe(true)
      un()
    }
  })

  it('429 после исчерпания повторов — следующий через Retry-After целиком', async () => {
    const h = vsetup((_f, n) => (n <= 6 ? errR(429, 'busy', 90, 'rate') : ok([])))
    const un = h.l.subscribe(() => undefined)
    h.l.setEpoch('r:1'); h.l.want('2026-11')
    await h.c.advance(5 * 90_000 + 10)
    expect(h.calls).toHaveLength(6)
    expect(h.l.failure('2026-11')?.kind).toBe('temporary')
    await h.c.advance(90_000)
    expect(h.l.months.has('2026-11')).toBe(true)
    un()
  })

  it('календарь ушёл (нет подписчиков) — таймеры повтора сняты, запросов нет; вернулся — читает снова', async () => {
    const h = vsetup((_f, n) => (n <= 2 ? errR(503, 'x', null, 'temporary') : ok([])))
    const un = h.l.subscribe(() => undefined)
    h.l.setEpoch('r:1'); h.l.want('2026-11')
    await h.c.advance(10)
    un()
    expect(h.c.pending()).toBe(0)
    await h.c.advance(3600_000)
    expect(h.calls).toHaveLength(1)
    const un2 = h.l.subscribe(() => undefined)
    h.l.want('2026-11')
    await h.c.advance(10)
    expect(h.calls).toHaveLength(2)
    un2()
  })

  it('отказ пришёл, когда календаря уже нет, — вернувшийся календарь читает месяц', async () => {
    let release: (r: RR) => void = () => {}
    let n = 0
    const c = vclock()
    const l = new DaysLoader({
      fetchDays: () => (++n === 1 ? new Promise<RR>(r => { release = r }) : Promise.resolve(ok([]))),
      sleep: async () => {}, now: c.now, setTimer: c.setTimer, clearTimer: c.clearTimer,
    })
    const un = l.subscribe(() => undefined)
    l.setEpoch('r:1'); l.want('2026-11')
    await c.advance(10)
    un()
    release(errR(503, 'x', null, 'temporary'))
    await c.advance(10)
    expect(c.pending()).toBe(0)
    const un2 = l.subscribe(() => undefined)
    l.want('2026-11')
    await c.advance(10)
    expect(n).toBe(2)
    expect(l.months.has('2026-11')).toBe(true)
    un2()
  })

  it('окончательный отказ сбрасывается, когда календарь вернулся', async () => {
    const h = vsetup((_f, n) => (n === 1 ? errR(502, 'gateway_refused', null, 'refused') : ok([])))
    const un = h.l.subscribe(() => undefined)
    h.l.setEpoch('r:1'); h.l.want('2026-11')
    await h.c.advance(10)
    un()
    const un2 = h.l.subscribe(() => undefined)
    h.l.want('2026-11')
    await h.c.advance(10)
    expect(h.l.months.has('2026-11')).toBe(true)
    un2()
  })
})

describe('DaysLoader: месяц выбранного прошлого дня (R1-L4)', () => {
  it('два места «нужен месяц» — вид календаря и выбранный день — читаются оба, по одному', async () => {
    const h = vsetup(() => ok([]))
    const un = h.l.subscribe(() => undefined)
    h.l.setEpoch('r:1')
    h.l.want('2026-11')
    h.l.want('2026-10', 'sel')
    await h.c.advance(10)
    expect(h.calls.map(c => c.from).sort()).toEqual(['2026-10-01', '2026-11-01'])
    h.l.setEpoch('r:2')
    await h.c.advance(10)
    expect(h.calls).toHaveLength(4)
    h.l.want(null, 'sel')
    h.l.setEpoch('r:3')
    await h.c.advance(10)
    expect(h.calls).toHaveLength(5)
    un()
  })
})
