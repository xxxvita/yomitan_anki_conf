// outbox-unload.test.ts — правки по ревью партии 2 (prb-batch2-review.md):
//   C1 — «Выход» в другой вкладке: очередь закрыта до следующего входа;
//   C2 — выгрузка страницы: запись синхронно, без блокировки (браузер не выдаёт
//        Web Lock странице, которую выгружает), короткий отчёт в keepalive;
//   L2, L4, CSRF, 404. Стенд блокировки здесь — NeverLock: во время pagehide
//   блокировка НЕ выдаётся никогда (так ведёт себя Chromium, замер ревьюера).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RouteOutbox, type OutboxDeps, type OutboxLocks } from '../outbox'
import { ROUTE_OUTBOX_KEY, eraseRouteStorage } from '../route-storage'
import { FakeBFF, MemStorage, SharedLock, ROUTE_A, ev, json, ok200, played } from './outbox-fakes'

// NeverLock — Web Lock, который не выдаётся (страница выгружается).
class NeverLock implements OutboxLocks {
  request<T>(): Promise<T> { return new Promise<T>(() => {}) }
}

function mk(o: { storage?: Storage; lock?: OutboxLocks | null; bff?: FakeBFF } = {}) {
  const bff = o.bff ?? new FakeBFF()
  const storage = o.storage ?? new MemStorage()
  const deps: OutboxDeps = {
    storage, locks: o.lock === undefined ? new SharedLock() : o.lock, fetch: bff.fetch,
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

const routeKeys = (s: Storage) => Array.from({ length: s.length }, (_, i) => s.key(i)!).filter(k => k.startsWith('flib:route') || k === 'flib:examples-cache').filter(k => k !== 'flib:route-listened')
// persisted — event_id лежит хоть в одном ключе хранилища (очередь или запасной ключ выгрузки).
const persisted = (s: Storage, id: string) => routeKeys(s).some(k => (s.getItem(k) ?? '').includes(id))
const stored = (s: Storage) => { const raw = s.getItem(ROUTE_OUTBOX_KEY); return raw ? (JSON.parse(raw).items as Array<{ event: Record<string, unknown> }>) : [] }

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
afterEach(() => { vi.useRealTimers() })

describe('C1 — «Выход» в другой вкладке', () => {
  it('после forget() очередь закрыта: ни постановка, ни pagehide, ни afterWrite не пишут ключей; resume() открывает', async () => {
    const storage = new MemStorage()
    const lock = new SharedLock()
    const a = mk({ storage, lock })
    const b = mk({ storage, lock })
    b.box.start()
    b.box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['cat'] }))
    await vi.advanceTimersByTimeAsync(2100)
    await settle(a.box.logoutFlush())
    a.box.eraseAfterLogout()
    b.box.forget() // вкладка B узнала о «Выходе» по каналу
    expect(routeKeys(storage)).toEqual([])
    b.box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['secret'] }))
    let wrote = false
    await b.box.enqueueDurable(ROUTE_A, played(3), { afterWrite: () => { wrote = true; storage.setItem('flib:route-watched', '{"v":1}') } })
    b.box.onPagehide()
    document.dispatchEvent(new Event('visibilitychange'))
    expect(await b.box.reserveLineCredit(10)).toBe(0)
    await vi.advanceTimersByTimeAsync(15_000)
    expect(wrote).toBe(false)
    expect(routeKeys(storage)).toEqual([])
    expect(b.bff.keepalive.length).toBe(0)
    // новый вход — очередь снова принимает события
    b.box.resume()
    const r = ev('clip_rated', { rating: 'like' })
    b.box.enqueue(ROUTE_A, r)
    await vi.advanceTimersByTimeAsync(10)
    expect(persisted(storage, r.event_id)).toBe(true)
  })

  it('стирание повторяется под блокировкой: ответ пачки другой вкладки, пришедший после стирания, ключ не воскрешает', async () => {
    const storage = new MemStorage()
    const lock = new SharedLock()
    const a = mk({ storage, lock })
    const b = mk({ storage, lock })
    let release: () => void = () => {}
    b.bff.reply = s => new Promise<Response>(res => { release = () => res(ok200(s)) })
    b.box.enqueue(ROUTE_A, ev('clip_rated', { rating: 'like' }))
    const p = b.box.flush({ timeoutMs: 60_000 })
    await vi.advanceTimersByTimeAsync(10)
    a.box.eraseAfterLogout()
    release()
    await settle(p)
    await vi.advanceTimersByTimeAsync(10)
    expect(storage.getItem(ROUTE_OUTBOX_KEY)).toBeNull()
  })
})

describe('C2 — выгрузка страницы', () => {
  it('блокировка не выдаётся: отчёт и слово из буфера записаны синхронно, отметка просмотра записана, keepalive несёт отчёт', () => {
    const storage = new MemStorage()
    const { box, bff } = mk({ storage, lock: new NeverLock() })
    box.start()
    const word = ev('hint_requested', { lemmas: ['late'] })
    box.enqueue(ROUTE_A, word)
    const cp = played(5, { puzzle_id: 'youtube::AAAAAAAAAAA' })
    let watched = false
    void box.enqueueDurable(ROUTE_A, cp, { frac: 0.8, afterWrite: () => { watched = true } })
    expect(box.pendingClipPlayed().has('youtube::AAAAAAAAAAA')).toBe(true)
    window.dispatchEvent(new Event('pagehide'))
    // страница умирает сразу после обработчика: всё должно лежать в хранилище СИНХРОННО
    expect(persisted(storage, cp.event_id)).toBe(true)
    expect(persisted(storage, word.event_id)).toBe(true)
    expect(watched).toBe(true)
    expect(bff.keepalive.flatMap(k => k.body.events.map(e => e.event_id))).toContain(cp.event_id)
    box.stop()
  })

  it('следующая загрузка вливает запасной ключ в очередь под блокировкой, без дублей', async () => {
    const storage = new MemStorage()
    const dead = mk({ storage, lock: new NeverLock() })
    dead.box.start()
    const w = ev('hint_requested', { lemmas: ['late'] })
    const cp = played(5)
    dead.box.enqueue(ROUTE_A, w)
    void dead.box.enqueueDurable(ROUTE_A, cp, { frac: 0.8 })
    window.dispatchEvent(new Event('pagehide'))
    dead.box.stop()
    const bff = new FakeBFF()
    const next = mk({ storage, bff })
    next.box.start()
    await vi.advanceTimersByTimeAsync(10)
    await settle(next.box.flush({ timeoutMs: 5000 }))
    expect(bff.ids().sort()).toEqual([cp.event_id, w.event_id].sort())
    expect(routeKeys(storage).filter(k => k !== ROUTE_OUTBOX_KEY)).toEqual([])
    expect(stored(storage)).toEqual([])
    next.box.stop()
  })

  it('отчёт, который не помещается в 60 КиБ: keepalive несёт короткий partial с played_frac, полный остаётся в хранилище', () => {
    const storage = new MemStorage()
    const { box, bff } = mk({ storage, lock: new NeverLock() })
    box.start()
    const big = played(1200, { subs_report: 'full', subs_unheard: [] })
    delete (big as Record<string, unknown>).played_frac
    void box.enqueueDurable(ROUTE_A, big, { frac: 0.66 })
    window.dispatchEvent(new Event('pagehide'))
    const sent = bff.keepalive.flatMap(k => k.body.events)
    const short = sent.find(e => e.type === 'clip_played')
    expect(short).toBeTruthy()
    expect(short!.subs_report).toBe('partial')
    expect(short!.played_frac).toBe(0.66)
    expect(short!.subs_heard).toBeUndefined()
    expect(short!.subs_unheard).toBeUndefined()
    expect(String(short!.event_id)).toMatch(/^[A-Za-z0-9._:-]{1,128}$/)
    expect(persisted(storage, big.event_id)).toBe(true)
    box.stop()
  })

  it('очередь остановлена (403): pagehide не шлёт keepalive, но буфер записан', async () => {
    const storage = new MemStorage()
    const { box, bff } = mk({ storage, lock: null })
    bff.reply = () => json(403, { error: 'key_expired' })
    box.enqueue(ROUTE_A, ev('clip_rated', { rating: 'like' }))
    await settle(box.flush({ timeoutMs: 1000 }))
    const x = ev('hint_requested', { lemmas: ['x'] })
    box.enqueue(ROUTE_A, x)
    box.onPagehide()
    expect(bff.keepalive.length).toBe(0)
    expect(persisted(storage, x.event_id)).toBe(true)
  })

  it('visibilitychange:hidden записывает синхронно; вкладка вернулась — дублей нет', async () => {
    const storage = new MemStorage()
    const lock = new SharedLock()
    const { box, bff } = mk({ storage, lock })
    box.start()
    const w = ev('hint_requested', { lemmas: ['late'] })
    box.enqueue(ROUTE_A, w)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'hidden' })
    document.dispatchEvent(new Event('visibilitychange'))
    expect(persisted(storage, w.event_id)).toBe(true)
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => 'visible' })
    document.dispatchEvent(new Event('visibilitychange'))
    await settle(box.flush({ timeoutMs: 5000 }))
    expect(bff.ids()).toEqual([w.event_id])
    expect(routeKeys(storage).filter(k => k.startsWith('flib:route-outbox-unload'))).toEqual([])
    const again = mk({ storage, bff })
    again.box.start()
    await settle(again.box.flush({ timeoutMs: 5000 }))
    expect(bff.ids()).toEqual([w.event_id])
    box.stop(); again.box.stop()
  })
})

describe('стражи мутантов после правок', () => {
  it('событие, поставленное после «Выхода», не уходит и после нового входа', async () => {
    const storage = new MemStorage()
    const { box, bff } = mk({ storage })
    box.forget()
    const a = ev('hint_requested', { lemmas: ['old'] })
    const b = played(2)
    box.enqueue(ROUTE_A, a)
    await box.enqueueDurable(ROUTE_A, b)
    box.resume()
    const c = ev('clip_rated', { rating: 'like' })
    box.enqueue(ROUTE_A, c)
    await settle(box.flush({ timeoutMs: 2000 }))
    expect(bff.ids()).toEqual([c.event_id])
  })

  it('keepalive на выгрузке считается с ведром реплик: отчёт без места в ведре не уходит, пословные уходят', async () => {
    const storage = new MemStorage()
    const { box, bff } = mk({ storage, lock: null })
    expect(await box.reserveLineCredit(1500)).toBe(1500)
    const w = ev('hint_requested', { lemmas: ['a'] })
    const p = played(20)
    box.enqueue(ROUTE_A, w)
    void box.enqueueDurable(ROUTE_A, p)
    box.onPagehide()
    const ids = bff.keepalive.flatMap(k => k.body.events.map(e => String(e.event_id)))
    expect(ids).toContain(w.event_id)
    expect(ids.some(id => id.startsWith(p.event_id))).toBe(false)
  })

  it('после «Выхода» (ключи ещё не стёрты другой вкладкой) pagehide не шлёт keepalive', async () => {
    const storage = new MemStorage()
    const { box, bff } = mk({ storage })
    await box.enqueueDurable(ROUTE_A, ev('clip_rated', { rating: 'like' }))
    box.forget()
    box.onPagehide()
    expect(bff.keepalive.length).toBe(0)
  })

  it('вливание не дублирует событие, которое уже есть в очереди', async () => {
    const storage = new MemStorage()
    const dead = mk({ storage, lock: new NeverLock() })
    dead.box.start()
    const cp = played(2)
    void dead.box.enqueueDurable(ROUTE_A, cp, { frac: 0.5 })
    window.dispatchEvent(new Event('pagehide'))
    dead.box.stop()
    storage.setItem(ROUTE_OUTBOX_KEY, JSON.stringify({ v: 2, items: [{ route_id: ROUTE_A, event: cp }] }))
    const bff = new FakeBFF()
    bff.reply = () => new Promise<Response>(() => {})
    const next = mk({ storage, bff })
    next.box.start()
    await vi.advanceTimersByTimeAsync(10)
    expect(stored(storage).filter(i => i.event.event_id === cp.event_id).length).toBe(1)
    next.box.stop()
  })

  it('pendingClipPlayed видит отчёт выгруженной страницы до вливания', () => {
    const storage = new MemStorage()
    const dead = mk({ storage, lock: new NeverLock() })
    dead.box.start()
    void dead.box.enqueueDurable(ROUTE_A, played(2, { puzzle_id: 'youtube::DDDDDDDDDDD' }), { frac: 0.5 })
    window.dispatchEvent(new Event('pagehide'))
    dead.box.stop()
    const next = mk({ storage, lock: new NeverLock() })
    expect(next.box.pendingClipPlayed().has('youtube::DDDDDDDDDDD')).toBe(true)
  })

  it('пачки долгой выгрузки идут с паузой ≥ 1 с', async () => {
    const { box, bff } = mk()
    const times: number[] = []
    bff.reply = s => { times.push(Date.now()); return ok200(s) }
    for (let i = 0; i < 150; i++) box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: [`w${i}`] }))
    await settle(box.flush({ timeoutMs: 20_000 }))
    expect(times.length).toBe(2)
    expect(times[1] - times[0]).toBeGreaterThanOrEqual(1000)
  })
})

describe('мелочи ревью', () => {
  it('L2: 200 с телом не JSON не удаляет пачку', async () => {
    const storage = new MemStorage()
    const { box, bff } = mk({ storage })
    const e = ev('clip_rated', { rating: 'like' })
    box.enqueue(ROUTE_A, e)
    bff.reply = () => new Response('<html>ok</html>', { status: 200, headers: { 'Content-Type': 'text/html' } })
    await settle(box.flush({ timeoutMs: 1000 }))
    expect(stored(storage).map(i => i.event.event_id)).toEqual([e.event_id])
  })

  it('POST событий несёт X-Flib-Request', async () => {
    const { box, bff } = mk()
    box.enqueue(ROUTE_A, ev('clip_rated', { rating: 'like' }))
    await settle(box.flush({ timeoutMs: 1000 }))
    expect((bff.sent[0].init.headers as Record<string, string>)['X-Flib-Request']).toBe('1')
  })

  it('404 на события останавливает очередь', async () => {
    const { box, bff } = mk()
    box.start()
    box.enqueue(ROUTE_A, ev('clip_rated', { rating: 'like' }))
    bff.reply = () => json(404, { error: 'not_found' })
    await vi.advanceTimersByTimeAsync(100)
    box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['a'] }))
    await vi.advanceTimersByTimeAsync(60_000)
    expect(bff.sent.length).toBe(1)
    box.stop()
  })

  it('L4: online не снимает Retry-After; pagehide внутри окна Retry-After не шлёт keepalive', async () => {
    const storage = new MemStorage()
    const { box, bff } = mk({ storage })
    box.start()
    box.enqueue(ROUTE_A, ev('clip_rated', { rating: 'like' }))
    bff.reply = () => json(429, { error: 'route_banned' }, { 'Retry-After': '600' })
    await vi.advanceTimersByTimeAsync(100)
    expect(bff.sent.length).toBe(1)
    window.dispatchEvent(new Event('online'))
    await vi.advanceTimersByTimeAsync(30_000)
    expect(bff.sent.length).toBe(1)
    box.onPagehide()
    expect(bff.keepalive.length).toBe(0)
    box.stop()
  })

})

void eraseRouteStorage
