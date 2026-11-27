// carry-batch3a.test.ts — перенос из ревью партии 2 в партию 3а:
//   • R2-L3: resume() не снимает удержание `queue_full` и не обходит Retry-After;
//   • R2-L4: очередь вкладки и PUT progress делят ОДИН бюджет keepalive;
//   • L13: сторож удаления и шаг замены пишут `flib:route-watched` под блокировкой
//     очереди, которую берёт ВЫЗЫВАЮЩИЙ (страница маршрута);
//   • R2-L1: общий запрос состояния не переживает смену вошедшего ключа.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RouteOutbox, getRouteOutbox, __resetRouteOutboxForTests, type OutboxDeps } from '../outbox'
import { pageKeepalive } from '../keepalive-budget'
import { progressBrowserDeps } from '../../../../player/route-events/progress'
import { FakeBFF, MemStorage, SharedLock, ROUTE_A, ev, json, played } from './outbox-fakes'
import { __resetRouteStateForTests, fetchRouteState } from '../use-route-state'
import { __resetSessionForTests, __setSessionForTests } from '../../../session'

function mk(o: { bff?: FakeBFF; lock?: SharedLock } = {}) {
  const bff = o.bff ?? new FakeBFF()
  const storage = new MemStorage()
  const lock = o.lock ?? new SharedLock()
  const deps: OutboxDeps = {
    storage, locks: lock, fetch: bff.fetch, now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: h => clearTimeout(h as ReturnType<typeof setTimeout>),
    newId: () => `web:rebuilt-${Math.random().toString(16).slice(2)}`,
  }
  return { box: new RouteOutbox(deps), bff, storage, lock }
}

async function settle<T>(p: Promise<T>): Promise<T> {
  let done = false
  void p.then(() => { done = true }, () => { done = true })
  await vi.advanceTimersByTimeAsync(0)
  for (let i = 0; i < 20000 && !done; i++) await vi.advanceTimersByTimeAsync(50)
  return p
}

describe('R2-L3: resume() не обходит удержание и Retry-After', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
  afterEach(() => { vi.useRealTimers() })

  it('queue_full: десять resume() за 200 с — ни одной новой пачки до коммита обмена', async () => {
    const { box, bff } = mk()
    box.start()
    bff.reply = () => json(429, { error: 'queue_full' }, { 'Retry-After': '1' })
    box.enqueue(ROUTE_A, played(0))
    await settle(box.flush({ timeoutMs: 3000 }))
    const posts = bff.sent.length
    expect(posts).toBe(1)
    for (let i = 0; i < 10; i++) { box.resume(); await vi.advanceTimersByTimeAsync(20_000) }
    expect(bff.sent.length).toBe(posts)
    // положительный контроль: коммит обмена снимает удержание — пачка уходит
    bff.reply = s => json(200, { accepted: s.body.events.length, duplicates: 0, rejected: [], evicted_external: 0 })
    box.onExchangeCommitted()
    await vi.advanceTimersByTimeAsync(11_000)
    expect(bff.sent.length).toBeGreaterThan(posts)
  })

  it('Retry-After 600: resume() каждые 20 с — ни одной пачки до конца ожидания, после — пачка', async () => {
    const { box, bff } = mk()
    box.start()
    bff.reply = () => json(429, { error: 'rate_limited' }, { 'Retry-After': '600' })
    box.enqueue(ROUTE_A, played(0))
    await settle(box.flush({ timeoutMs: 3000 }))
    const posts = bff.sent.length
    expect(posts).toBe(1)
    bff.reply = s => json(200, { accepted: s.body.events.length, duplicates: 0, rejected: [], evicted_external: 0 })
    for (let i = 0; i < 10; i++) { box.resume(); await vi.advanceTimersByTimeAsync(20_000) }
    expect(bff.sent.length).toBe(posts)
    await vi.advanceTimersByTimeAsync(420_000)
    box.resume()
    await vi.advanceTimersByTimeAsync(1000)
    expect(bff.sent.length).toBeGreaterThan(posts)
  })
})

describe('R2-L4: один бюджет keepalive на страницу', () => {
  let hang: Array<() => void> = []
  beforeEach(() => { hang = []; __resetRouteOutboxForTests(); localStorage.clear() })
  afterEach(() => { for (const h of hang) h(); vi.unstubAllGlobals(); __resetRouteOutboxForTests() })

  function occupy(bytesLeft: number): void {
    // занять бюджет страницы зависшим запросом, оставив bytesLeft байт
    const n = pageKeepalive.room() - bytesLeft
    const body = 'x'.repeat(n)
    pageKeepalive.send(() => new Promise<Response>(res => { hang.push(() => res(json(200, {}))) }), '/x', { body })
    expect(pageKeepalive.room()).toBe(bytesLeft)
  }

  it('очередь вкладки берёт место из pageKeepalive: при занятом бюджете keepalive не уходит', () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => { if (init.keepalive) calls.push(String(url)); return new Promise(() => {}) }))
    const box = getRouteOutbox()
    // положительный контроль: свободный бюджет — keepalive уходит
    box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['alpha'] }))
    box.onPagehide()
    expect(calls).toEqual(['/api/me/route/events'])
    calls.length = 0
    __resetRouteOutboxForTests(); localStorage.clear()
    occupy(100)
    const box2 = getRouteOutbox()
    box2.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['beta'] }))
    box2.onPagehide()
    expect(calls).toEqual([])
  })

  it('PUT progress на выгрузке — из того же бюджета: занят — не отправляется, свободен — уходит', () => {
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => { if (init.keepalive) calls.push(String(url)); return new Promise(() => {}) }))
    const body = { track_key: 'yt-en:1', position_ms: 1000, heard_total: 1, state: { v: 1, heard: [0], replays: {} } }
    occupy(10)
    progressBrowserDeps.putKeepalive('youtube::aaaaaaaaaaa', body)
    expect(calls).toEqual([])
    for (const h of hang) h()
    hang = []
  })

  it('контроль: свободный бюджет — PUT progress уходит keepalive', async () => {
    await new Promise(r => setTimeout(r, 0))
    const calls: string[] = []
    vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => { if (init.keepalive) calls.push(String(url)); return Promise.resolve(json(200, {})) }))
    progressBrowserDeps.putKeepalive('youtube::aaaaaaaaaaa', { track_key: 'yt-en:1', position_ms: 1, heard_total: 0, state: { v: 1, heard: [], replays: {} } })
    expect(calls).toEqual(['/api/me/route/progress?puzzle_id=youtube%3A%3Aaaaaaaaaaaa'])
  })
})

describe('L13: запись flib:route-watched под блокировкой очереди (вызывающий берёт её)', () => {
  it('locked(fn) выполняет fn под блокировкой очереди', async () => {
    const { box, lock } = mk()
    let heldInside = false
    await box.locked(() => { heldInside = lock.held })
    expect(heldInside).toBe(true)
  })
  it('dropClipPlayed: afterDrop выполняется под ТОЙ ЖЕ блокировкой, что и выбрасывание отчёта', async () => {
    const { box, lock, storage } = mk()
    box.enqueue(ROUTE_A, played(0, { puzzle_id: 'youtube::target00001' }))
    box.enqueue(ROUTE_A, played(0, { puzzle_id: 'youtube::other000001' }))
    await box.locked(() => {})
    let heldInside = false
    let reportGoneInside = false
    await box.dropClipPlayed('youtube::target00001', {
      afterDrop: () => {
        heldInside = lock.held
        const raw = storage.getItem('flib:route-outbox') ?? ''
        reportGoneInside = !raw.includes('target00001') && raw.includes('other000001')
      },
    })
    expect(heldInside).toBe(true)
    expect(reportGoneInside).toBe(true)
  })
  it('после «Выхода» locked(fn) ничего не выполняет (стёртый ключ не воскресает)', async () => {
    const { box } = mk()
    box.forget()
    let ran = false
    await box.locked(() => { ran = true })
    expect(ran).toBe(false)
  })
})

describe('R2-L1: общий запрос состояния не переживает смену ключа', () => {
  beforeEach(() => { __resetRouteStateForTests(); __resetSessionForTests() })
  afterEach(() => { __resetSessionForTests() })
  const probe = () => ({ watchedSeq: 0, pendingClipPlayed: new Set<string>() })

  it('GET под ключом A в полёте → выход → вход ключом B: новое чтение — свой GET, а не ответ A', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_one0' })
    let releaseA: (() => void) | null = null
    let n = 0
    const fetch = vi.fn(async () => {
      n++
      if (n === 1) {
        await new Promise<void>(r => { releaseA = r })
        return json(200, { started: true, route_id: 'route-of-A', revision: 1 })
      }
      return json(200, { started: true, route_id: 'route-of-B', revision: 1 })
    })
    const a = fetchRouteState({ api: { fetch }, probe })
    __setSessionForTests({ authenticated: false, reason: 'logout' })
    __setSessionForTests({ authenticated: true, state: 'active', keyPrefix: 'tpk_two0' })
    const b = fetchRouteState({ api: { fetch }, probe })
    releaseA!()
    const [ra, rb] = await Promise.all([a, b])
    expect(fetch).toHaveBeenCalledTimes(2)
    expect(ra.result.ok && ra.result.data.route_id).toBe('route-of-A')
    expect(rb.result.ok && rb.result.data.route_id).toBe('route-of-B')
  })

  it('контроль: та же вкладка без смены ключа — один общий GET', async () => {
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_one0' })
    const fetch = vi.fn(async () => json(200, { started: false, revision: 0 }))
    const [x, y] = await Promise.all([fetchRouteState({ api: { fetch }, probe }), fetchRouteState({ api: { fetch }, probe })])
    expect(fetch).toHaveBeenCalledTimes(1)
    expect(x).toBe(y)
  })
})
