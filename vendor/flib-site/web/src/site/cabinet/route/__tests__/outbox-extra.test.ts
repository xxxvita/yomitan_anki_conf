// outbox-extra.test.ts — origin дополнительных роликов в очереди (спека extra-video §9),
// playerExtraUrl и routeApi.extra.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RouteOutbox, shortClipPlayed, type OutboxDeps, type OutboxLocks } from '../outbox'
import { ROUTE_OUTBOX_KEY } from '../route-storage'
import { playerExtraUrl } from '../day-model'
import { routeApi } from '../route-api'
import { FakeBFF, MemStorage, SharedLock, ROUTE_A, ev, played, json } from './outbox-fakes'

class NeverLock implements OutboxLocks {
  request<T>(): Promise<T> { return new Promise<T>(() => {}) }
}

function mk(o: { storage?: MemStorage; lock?: OutboxLocks; bff?: FakeBFF } = {}) {
  const bff = o.bff ?? new FakeBFF()
  const storage = o.storage ?? new MemStorage()
  const deps: OutboxDeps = {
    storage, locks: o.lock ?? new SharedLock(), fetch: bff.fetch,
    now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: h => clearTimeout(h as ReturnType<typeof setTimeout>),
    newId: () => `web:rebuilt-${Math.random().toString(16).slice(2)}`,
  }
  return { box: new RouteOutbox(deps), bff, storage }
}
async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false
  void p.then(() => { done = true }, () => { done = true })
  await vi.advanceTimersByTimeAsync(0)
  for (let i = 0; i < 20000 && !done; i++) await vi.advanceTimersByTimeAsync(50)
  return p
}
const stored = (s: Storage) => { const raw = s.getItem(ROUTE_OUTBOX_KEY); return raw ? (JSON.parse(raw).items as Array<{ event: Record<string, unknown> }>) : [] }

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
afterEach(() => { vi.useRealTimers() })

describe('shortClipPlayed', () => {
  it('копирует origin more; у дневного отчёта origin нет', () => {
    const withO = shortClipPlayed({ route_id: ROUTE_A, event: played(3, { origin: 'more' }), frac: 0.5 })!
    expect(withO.origin).toBe('more')
    const plain = shortClipPlayed({ route_id: ROUTE_A, event: played(3), frac: 0.5 })!
    expect('origin' in plain).toBe(false)
  })
  it('чужое значение origin не копируется', () => {
    const o = shortClipPlayed({ route_id: ROUTE_A, event: played(3, { origin: 'x' }), frac: 0.5 })!
    expect('origin' in o).toBe(false)
  })
})

describe('очередь и origin', () => {
  it('pendingClipPlayed не считает origin-отчёт, но считает обычный с тем же id', async () => {
    const { box } = mk()
    await box.enqueueDurable(ROUTE_A, played(2, { origin: 'more', puzzle_id: 'youtube::aaaaaaaaaaa' }))
    expect(box.pendingClipPlayed().has('youtube::aaaaaaaaaaa')).toBe(false)
    await box.enqueueDurable(ROUTE_A, played(2, { puzzle_id: 'youtube::aaaaaaaaaaa' }))
    expect(box.pendingClipPlayed().has('youtube::aaaaaaaaaaa')).toBe(true)
    box.forget()
  })
  it('dropClipPlayed оставляет origin-отчёт и выбрасывает обычный', async () => {
    const { box, storage } = mk()
    const pid = 'youtube::bbbbbbbbbbb'
    const o = played(2, { origin: 'more', puzzle_id: pid })
    const plain = played(2, { puzzle_id: pid })
    await box.enqueueDurable(ROUTE_A, o)
    await box.enqueueDurable(ROUTE_A, plain)
    await box.dropClipPlayed(pid)
    const left = stored(storage).map(i => i.event.event_id)
    expect(left).toContain(o.event_id)
    expect(left).not.toContain(plain.event_id)
    box.forget()
  })
  it('origin переживает запись на диск и чтение: другая очередь на том же хранилище отправляет его', async () => {
    const storage = new MemStorage()
    const a = mk({ storage })
    const o = played(2, { origin: 'more' })
    await a.box.enqueueDurable(ROUTE_A, o)
    expect(stored(storage).find(i => i.event.event_id === o.event_id)!.event.origin).toBe('more')
    a.box.forget()
    const b = mk({ storage })
    await settle(b.box.flush({ timeoutMs: 5000 }))
    const sent = b.bff.sent.flatMap(s => s.body.events).find(e => e.event_id === o.event_id)
    expect(sent).toBeTruthy()
    expect(sent!.origin).toBe('more')
    b.box.forget()
  })
  it('запись выгрузки закрытой страницы вливается с origin', async () => {
    const storage = new MemStorage()
    const dead = mk({ storage, lock: new NeverLock() })
    dead.box.start()
    const o = played(2, { origin: 'more' })
    void dead.box.enqueueDurable(ROUTE_A, o, { frac: 0.5 })
    window.dispatchEvent(new Event('pagehide'))
    dead.box.stop()
    const next = mk({ storage })
    next.box.start()
    await vi.advanceTimersByTimeAsync(10)
    await settle(next.box.flush({ timeoutMs: 5000 }))
    const sent = next.bff.sent.flatMap(s => s.body.events).find(e => e.event_id === o.event_id)
    expect(sent!.origin).toBe('more')
    next.box.stop()
  })
  it('keepalive при pagehide: короткая форма с origin у origin-отчёта и без него у дневного того же ролика', () => {
    const storage = new MemStorage()
    const { box, bff } = mk({ storage, lock: new NeverLock() })
    box.start()
    const pid = 'youtube::dddddddddddd'
    const big = (extra: Record<string, unknown>) => {
      const e = played(1200, { subs_report: 'full', subs_unheard: [], puzzle_id: pid, ...extra })
      delete (e as Record<string, unknown>).played_frac
      return e
    }
    const withO = big({ origin: 'more' })
    const day = big({})
    void box.enqueueDurable(ROUTE_A, withO, { frac: 0.6 })
    void box.enqueueDurable(ROUTE_A, day, { frac: 0.7 })
    window.dispatchEvent(new Event('pagehide'))
    const sent = bff.keepalive.flatMap(k => k.body.events)
    const so = sent.find(e => e.event_id === `${withO.event_id}:s`)
    const sd = sent.find(e => e.event_id === `${day.event_id}:s`)
    expect(so).toBeTruthy()
    expect(so!.origin).toBe('more')
    expect(sd).toBeTruthy()
    expect('origin' in sd!).toBe(false)
    box.stop()
  })
  it('413: деление пачки до одиночных событий сохраняет origin', async () => {
    const { box, bff } = mk()
    bff.reply = s => s.body.events.length > 1
      ? json(413, { error: 'too_large' })
      : json(200, { accepted: 1, duplicates: 0, rejected: [], evicted_external: 0 })
    const a = played(2, { origin: 'more', puzzle_id: 'youtube::eeeeeeeeeee' })
    const b = played(2, { puzzle_id: 'youtube::fffffffffff' })
    await box.enqueueDurable(ROUTE_A, a)
    await box.enqueueDurable(ROUTE_A, b)
    await settle(box.flush({ timeoutMs: 5000 }))
    const singles = bff.sent.filter(s => s.body.events.length === 1).flatMap(s => s.body.events)
    expect(singles.find(e => e.event_id === a.event_id)!.origin).toBe('more')
    expect('origin' in singles.find(e => e.event_id === b.event_id)!).toBe(false)
    box.forget()
  })
  it('full_regressed: пересобранный partial сохраняет origin', async () => {
    const { box, bff } = mk()
    const o = played(2, { origin: 'more', subs_report: 'full' })
    let first = true
    bff.reply = s => {
      if (!first) return json(200, { accepted: s.body.events.length, duplicates: 0, rejected: [], evicted_external: 0 })
      first = false
      return json(200, { accepted: 0, duplicates: 0, rejected: s.body.events.map((e, index) => ({ index, event_id: e.event_id, reason: 'full_regressed' })), evicted_external: 0 })
    }
    await box.enqueueDurable(ROUTE_A, o, { frac: 0.4 })
    await settle(box.flush({ timeoutMs: 5000 }))
    const rebuilt = bff.sent.flatMap(s => s.body.events).find(e => e.subs_report === 'partial' && e.event_id !== o.event_id)
    expect(rebuilt).toBeTruthy()
    expect(rebuilt!.origin).toBe('more')
    box.forget()
  })
  it('onReportsAccepted получает puzzle_id origin-отчёта', async () => {
    const { box } = mk()
    const got: string[][] = []
    box.onReportsAccepted(ids => got.push(ids))
    await box.enqueueDurable(ROUTE_A, played(2, { origin: 'more', puzzle_id: 'youtube::ccccccccccc' }))
    await settle(box.flush({ timeoutMs: 5000 }))
    expect(got.flat()).toContain('youtube::ccccccccccc')
    box.forget()
  })
  it('прочие события с origin очередь не ломают', async () => {
    const { box } = mk()
    await box.enqueueDurable(ROUTE_A, ev('hint_requested', { origin: 'more' }))
    expect(box.pendingClipPlayed().size).toBe(0)
    box.forget()
  })
})

describe('playerExtraUrl', () => {
  it('кодирует оба id', () => {
    expect(playerExtraUrl('abc DEF', 'youtube::a b')).toBe('/player?v=abc%20DEF&back=route&rx=youtube%3A%3Aa%20b')
  })
})

describe('routeApi.extra / extraJob', () => {
  it('POST с CSRF и {for_date}', async () => {
    vi.useRealTimers()
    const fetch = vi.fn(async (_u: string, _i: RequestInit) => json(202, { job_id: 'j1' }))
    const r = await routeApi.extra('2026-11-24', { fetch })
    expect(r.ok && r.data.job_id).toBe('j1')
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/me/route/extra')
    expect(init.method).toBe('POST')
    expect(JSON.parse(String(init.body))).toEqual({ for_date: '2026-11-24' })
    expect((init.headers as Record<string, string>)['X-Flib-Request']).toBe('1')
  })
  it('extraJob — GET extra-jobs/{id}', async () => {
    vi.useRealTimers()
    const fetch = vi.fn(async (_u: string, _i: RequestInit) => json(200, { status: 'done', outcome: 'clip' }))
    const r = await routeApi.extraJob('a/b', { fetch })
    expect(r.ok && r.data.outcome).toBe('clip')
    expect(fetch.mock.calls[0][0]).toBe('/api/me/route/extra-jobs/a%2Fb')
  })
})
