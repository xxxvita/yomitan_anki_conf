// outbox-round2.test.ts — правки по повторному ревью партии 2 (prb-batch2-rereview.md):
//   R-M2 — запасной ключ выгрузки: свой ключ у каждой страницы, чужие записи не
//          переписываются никогда; вкладке нечего сохранить — она не пишет и не
//          стирает НИЧЕГО; «Выход» стирает все записи по префиксу;
//   R-L2 — записи закрытых вкладок вливает и открытая вкладка, и выгрузка перед «Выходом»;
//   R-L1 — 64 КиБ keepalive браузера — сумма тел в полёте: запросы одной выгрузки
//          делят один бюджет;
//   R-L8 — стражи X2, X7, X14–X17, X23.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RouteOutbox, KEEPALIVE_MAX_BYTES, type OutboxDeps, type OutboxLocks } from '../outbox'
import { KeepaliveBudget } from '../keepalive-budget'
import { ROUTE_OUTBOX_KEY, ROUTE_OUTBOX_UNLOAD_PREFIX, eraseRouteStorage } from '../route-storage'
import { FakeBFF, MemStorage, SharedLock, ROUTE_A, ROUTE_B, ev, json, played } from './outbox-fakes'

class NeverLock implements OutboxLocks {
  request<T>(): Promise<T> { return new Promise<T>(() => {}) }
}

// ManualLock — блокировка, которую тест выдаёт сам (grant()).
class ManualLock implements OutboxLocks {
  private q: Array<() => void> = []
  request<T>(_n: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((res, rej) => { this.q.push(() => { fn().then(res, rej) }) })
  }
  pending(): number { return this.q.length }
  grant(): void { this.q.shift()?.() }
}

// TabStorage — вид одной вкладки на общее хранилище: считает свои записи и
// стирания, умеет вклиниться другой вкладкой сразу после своего getItem.
class TabStorage implements Storage {
  writes: string[] = []
  afterGet: ((k: string) => void) | null = null
  constructor(private m: MemStorage) {}
  get length(): number { return this.m.length }
  clear(): void { this.m.clear() }
  key(i: number): string | null { return this.m.key(i) }
  getItem(k: string): string | null {
    const v = this.m.getItem(k)
    const hook = this.afterGet
    if (hook) { this.afterGet = null; hook(k) }
    return v
  }
  removeItem(k: string): void { this.writes.push(`-${k}`); this.m.removeItem(k) }
  setItem(k: string, v: string): void { this.writes.push(`+${k}`); this.m.setItem(k, v) }
}

function mk(o: { storage?: Storage; lock?: OutboxLocks | null; bff?: FakeBFF; keepalive?: KeepaliveBudget } = {}) {
  const bff = o.bff ?? new FakeBFF()
  const storage = o.storage ?? new MemStorage()
  const deps: OutboxDeps = {
    storage, locks: o.lock === undefined ? new SharedLock() : o.lock, fetch: bff.fetch,
    now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: h => clearTimeout(h as ReturnType<typeof setTimeout>),
    newId: () => `web:rebuilt-${Math.random().toString(16).slice(2)}`,
    ...(o.keepalive ? { keepalive: o.keepalive } : {}),
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

const allKeys = (s: Storage) => Array.from({ length: s.length }, (_, i) => s.key(i)!)
const unloadKeys = (s: Storage) => allKeys(s).filter(k => k.startsWith(ROUTE_OUTBOX_UNLOAD_PREFIX))
const persistedIn = (s: Storage, keys: string[], id: string) => keys.some(k => (s.getItem(k) ?? '').includes(id))
const stored = (s: Storage) => { const raw = s.getItem(ROUTE_OUTBOX_KEY); return raw ? (JSON.parse(raw).items as Array<{ event: Record<string, unknown> }>) : [] }
const hidden = (on: boolean) => Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => on ? 'hidden' : 'visible' })

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
afterEach(() => { hidden(false); vi.useRealTimers() })

describe('R-M2 — свой ключ выгрузки у каждой страницы', () => {
  it('вкладке нечего сохранить: на hidden и pagehide она не пишет и не стирает НИЧЕГО', () => {
    const mem = new MemStorage()
    const a = mk({ storage: mem, lock: new NeverLock() })
    const w = ev('hint_requested', { lemmas: ['mine'] })
    a.box.enqueue(ROUTE_A, w)
    a.box.onHidden()
    const before = allKeys(mem).map(k => `${k}=${mem.getItem(k)}`).sort()
    const tb = new TabStorage(mem)
    const b = mk({ storage: tb, lock: new NeverLock() })
    b.box.onHidden()
    b.box.onPagehide()
    expect(tb.writes).toEqual([])
    expect(allKeys(mem).map(k => `${k}=${mem.getItem(k)}`).sort()).toEqual(before)
  })

  it('две вкладки выгружаются в одно мгновение: запись первой не теряется (её запись вклинивается в чтение второй)', async () => {
    const mem = new MemStorage()
    const a = mk({ storage: mem, lock: new NeverLock() })
    const tb = new TabStorage(mem)
    const b = mk({ storage: tb, lock: new NeverLock() })
    const wa = ev('hint_requested', { lemmas: ['alpha'] })
    const wb = ev('hint_requested', { lemmas: ['beta'] })
    a.box.enqueue(ROUTE_A, wa)
    b.box.enqueue(ROUTE_A, wb)
    // Чтение второй вкладки — и в тот же миг первая пишет свою запись.
    tb.afterGet = () => a.box.onHidden()
    b.box.onHidden()
    expect(persistedIn(mem, unloadKeys(mem), wa.event_id)).toBe(true)
    expect(persistedIn(mem, unloadKeys(mem), wb.event_id)).toBe(true)
    // Следующая загрузка отправляет оба.
    const bff = new FakeBFF()
    const next = mk({ storage: mem, bff })
    next.box.start()
    await settle(next.box.flush({ timeoutMs: 5000 }))
    expect(bff.ids().sort()).toEqual([wa.event_id, wb.event_id].sort())
    expect(unloadKeys(mem)).toEqual([])
    next.box.stop()
  })

  it('выгрузка пишет только свой ключ; вкладка, вернувшаяся из фона, стирает только свой', () => {
    const mem = new MemStorage()
    const a = mk({ storage: mem, lock: new NeverLock() })
    a.box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['a'] }))
    a.box.onHidden()
    const ta = new TabStorage(mem)
    const b = mk({ storage: ta, lock: new NeverLock() })
    b.box.start()
    b.box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['b'] }))
    hidden(true)
    document.dispatchEvent(new Event('visibilitychange'))
    const own = ta.writes.map(w => w.slice(1))
    expect(own.length).toBe(1)
    expect(own[0].startsWith(ROUTE_OUTBOX_UNLOAD_PREFIX)).toBe(true)
    expect(unloadKeys(mem).length).toBe(2)
    hidden(false)
    document.dispatchEvent(new Event('visibilitychange'))
    expect(ta.writes.map(w => w.slice(1)).every(k => k === own[0])).toBe(true)
    expect(unloadKeys(mem).length).toBe(1)
    b.box.stop()
  })

  it('следующая загрузка шлёт записи выгруженных страниц сразу, не дожидаясь такта', async () => {
    const mem = new MemStorage()
    const dead = mk({ storage: mem, lock: new NeverLock() })
    const w = ev('hint_requested', { lemmas: ['late'] })
    dead.box.enqueue(ROUTE_A, w)
    dead.box.onHidden()
    const bff = new FakeBFF()
    const next = mk({ storage: mem, bff })
    next.box.start()
    await vi.advanceTimersByTimeAsync(100)
    expect(bff.ids()).toEqual([w.event_id])
    next.box.stop()
  })

  it('страница переписала свою запись, пока её вливала другая: новая запись не стирается и уходит позже', async () => {
    const mem = new MemStorage()
    const owner = mk({ storage: mem, lock: new NeverLock() })
    const w1 = ev('hint_requested', { lemmas: ['first'] })
    owner.box.enqueue(ROUTE_A, w1)
    owner.box.onHidden()
    const ownerKey = unloadKeys(mem)[0]
    const w2 = ev('hint_requested', { lemmas: ['second'] })
    const tm = new TabStorage(mem)
    const bff = new FakeBFF()
    const merger = mk({ storage: tm, bff })
    // Вливающая вкладка прочла запись — и в тот же миг владелец (жив, снова ушёл в фон) её переписал.
    const hook = (k: string) => {
      if (k !== ownerKey) { tm.afterGet = hook; return }
      owner.box.enqueue(ROUTE_A, w2); owner.box.onHidden()
    }
    tm.afterGet = hook
    merger.box.start()
    await settle(merger.box.flush({ timeoutMs: 5000 }))
    expect(bff.ids()).toContain(w1.event_id)
    expect(persistedIn(mem, unloadKeys(mem), w2.event_id) || bff.ids().includes(w2.event_id)).toBe(true)
    await settle(merger.box.flush({ timeoutMs: 5000 }))
    expect(bff.ids()).toContain(w2.event_id)
    merger.box.stop()
  })

  it('«Выход» стирает записи всех страниц по префиксу, чужие ключи не трогает', () => {
    const mem = new MemStorage()
    for (const n of ['x1', 'x2', 'x3']) mem.setItem(`${ROUTE_OUTBOX_UNLOAD_PREFIX}${n}`, '{"v":1,"items":[]}')
    mem.setItem('flib:route-listened', '{"v":1}')
    mem.setItem('flib:subMode', 'l2')
    eraseRouteStorage(mem)
    expect(unloadKeys(mem)).toEqual([])
    expect(mem.getItem('flib:route-listened')).not.toBeNull()
    expect(mem.getItem('flib:subMode')).toBe('l2')
  })

  it('стирание под блокировкой после «Выхода» тоже снимает записи, появившиеся между двумя стираниями', async () => {
    const mem = new MemStorage()
    const lock = new SharedLock()
    const a = mk({ storage: mem, lock })
    a.box.eraseAfterLogout()
    mem.setItem(`${ROUTE_OUTBOX_UNLOAD_PREFIX}late`, '{"v":1,"items":[]}')
    await vi.advanceTimersByTimeAsync(10)
    expect(unloadKeys(mem)).toEqual([])
  })
})

describe('R-L2 — записи закрытых вкладок вливает и открытая вкладка', () => {
  it('открытая вкладка с пустой очередью подхватывает запись закрытой на следующем такте', async () => {
    const mem = new MemStorage()
    const lock = new SharedLock()
    const bff = new FakeBFF()
    const open = mk({ storage: mem, lock, bff })
    open.box.start()
    await vi.advanceTimersByTimeAsync(10)
    const dead = mk({ storage: mem, lock: new NeverLock(), bff: new FakeBFF() })
    const w = ev('hint_requested', { lemmas: ['late'] })
    dead.box.enqueue(ROUTE_A, w)
    dead.box.onHidden() // закрытая вкладка: запись есть, keepalive не было
    await vi.advanceTimersByTimeAsync(10_500) // такт отправки, без явной выгрузки
    expect(bff.ids()).toEqual([w.event_id])
    expect(unloadKeys(mem)).toEqual([])
    open.box.stop()
  })

  it('выгрузка перед «Выходом» отправляет и записи закрытых вкладок', async () => {
    const mem = new MemStorage()
    const bff = new FakeBFF()
    const me = mk({ storage: mem, bff })
    const dead = mk({ storage: mem, lock: new NeverLock(), bff: new FakeBFF() })
    const w = ev('hint_requested', { lemmas: ['late'] })
    dead.box.enqueue(ROUTE_A, w)
    dead.box.onHidden()
    await settle(me.box.logoutFlush())
    expect(bff.ids()).toEqual([w.event_id])
  })
})

describe('R-L1 — общий бюджет keepalive одной выгрузки', () => {
  it('пословные первого вызова оставляют место; отчёт второго вызова, не влезающий целиком, уходит короткой формой; сумма ≤ квоты', () => {
    const budget = new KeepaliveBudget()
    const bff = new FakeBFF()
    const hang = bff.fetch
    // keepalive в полёте не завершается до конца выгрузки.
    bff.fetch = async (url, init) => init.keepalive ? (void hang(url, init), new Promise<Response>(() => {})) : hang(url, init)
    const { box } = mk({ lock: new NeverLock(), bff, keepalive: budget })
    const pad = 'x'.repeat(900)
    for (let i = 0; i < 70; i++) box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: [`w${i}`], pad }))
    box.onPagehide()
    const first = bff.keepalive.reduce((a, k) => a + new TextEncoder().encode(String(k.init.body)).length, 0)
    expect(first).toBeGreaterThan(0)
    expect(first).toBeLessThanOrEqual(KEEPALIVE_MAX_BYTES - 4096)
    const rep = played(60, { subs_report: 'full', subs_unheard: [] })
    void box.enqueueDurable(ROUTE_A, rep, { frac: 0.9 })
    box.onPagehide()
    const total = bff.keepalive.reduce((a, k) => a + new TextEncoder().encode(String(k.init.body)).length, 0)
    expect(total).toBeLessThanOrEqual(budget.quota)
    const second = bff.keepalive.slice(1).flatMap(k => k.body.events)
    expect(second.find(e => e.event_id === `${rep.event_id}:s`)).toBeTruthy()
  })

  it('PUT прогресса без места в бюджете не отправляется (браузер всё равно его бы отверг)', () => {
    const budget = new KeepaliveBudget()
    const calls: string[] = []
    const f = (url: string) => { calls.push(url); return new Promise<Response>(() => {}) }
    expect(budget.send(f, '/a', { method: 'POST', body: 'y'.repeat(budget.quota - 100) })).toBe(true)
    expect(budget.send(f, '/b', { method: 'PUT', body: 'z'.repeat(200) })).toBe(false)
    expect(calls).toEqual(['/a'])
  })

  it('место возвращается, когда запрос завершился', async () => {
    const budget = new KeepaliveBudget()
    let done: (r: Response) => void = () => {}
    const f = () => new Promise<Response>(r => { done = r })
    budget.send(f, '/a', { body: 'y'.repeat(budget.quota - 10) })
    expect(budget.room()).toBe(10)
    done(json(200, {}))
    await vi.advanceTimersByTimeAsync(0)
    expect(budget.room()).toBe(budget.quota)
  })
})

describe('R-L8 — стражи новых строк очереди', () => {
  it('X2: резерв реплик, ждавший блокировку, после «Выхода» ничего не выдаёт и ключа не создаёт', async () => {
    const mem = new MemStorage()
    const lock = new ManualLock()
    const { box } = mk({ storage: mem, lock })
    const r = box.reserveLineCredit(10)
    expect(lock.pending()).toBe(1)
    box.forget()
    lock.grant()
    expect(await r).toBe(0)
    expect(mem.getItem(ROUTE_OUTBOX_KEY)).toBeNull()
  })

  it('X5: вливание, ждавшее блокировку при запуске, после «Выхода» не пишет очередь', async () => {
    const mem = new MemStorage()
    const dead = mk({ storage: mem, lock: new NeverLock() })
    dead.box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['late'] }))
    dead.box.onHidden()
    const lock = new ManualLock()
    const { box } = mk({ storage: mem, lock })
    box.start()
    expect(lock.pending()).toBe(1)
    box.forget() // «Выход» в другой вкладке пришёл раньше блокировки
    lock.grant()
    await vi.advanceTimersByTimeAsync(10)
    expect(mem.getItem(ROUTE_OUTBOX_KEY)).toBeNull()
  })

  it('X7: события буфера, поставленные до «Выхода», не уходят после нового входа', async () => {
    const { box, bff } = mk({ lock: null })
    box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['before'] }))
    box.forget()
    box.resume()
    const after = ev('clip_rated', { rating: 'like' })
    box.enqueue(ROUTE_A, after)
    await settle(box.flush({ timeoutMs: 3000 }))
    expect(bff.ids()).toEqual([after.event_id])
  })

  it('X23: keepalive несёт события одной эпохи под её route_id', () => {
    const { box, bff } = mk({ lock: new NeverLock() })
    const a = ev('hint_requested', { lemmas: ['a'] })
    const b = ev('hint_requested', { lemmas: ['b'] })
    box.enqueue(ROUTE_A, a)
    box.enqueue(ROUTE_B, b)
    box.onPagehide()
    for (const k of bff.keepalive) {
      if (k.body.route_id === ROUTE_A) expect(k.body.events.map(e => e.event_id)).not.toContain(b.event_id)
      if (k.body.route_id === ROUTE_B) expect(k.body.events.map(e => e.event_id)).not.toContain(a.event_id)
    }
    expect(bff.keepalive.length).toBeGreaterThan(0)
  })

  it('X14: второй вызов выгрузки не повторяет уже отправленное keepalive', () => {
    const { box, bff } = mk({ lock: new NeverLock() })
    const w = ev('hint_requested', { lemmas: ['once'] })
    box.enqueue(ROUTE_A, w)
    box.onPagehide()
    box.onPagehide()
    expect(bff.keepalive.flatMap(k => k.body.events.map(e => e.event_id))).toEqual([w.event_id])
  })

  it('X15, X16: реплики отчёта, ушедшего keepalive, списываются из ведра следующей загрузкой', async () => {
    const mem = new MemStorage()
    const dead = mk({ storage: mem, lock: new NeverLock() })
    void dead.box.enqueueDurable(ROUTE_A, played(300), { frac: 0.5 })
    dead.box.onPagehide()
    expect(dead.bff.keepalive.flatMap(k => k.body.events).some(e => Array.isArray(e.subs_heard))).toBe(true)
    const bff = new FakeBFF()
    bff.reply = () => new Promise<Response>(() => {})
    const next = mk({ storage: mem, bff })
    next.box.start()
    await vi.advanceTimersByTimeAsync(10)
    next.box.stop()
    // 1500 − 300 (keepalive, списано при вливании) − 300 (обычная пачка с тем же
    // отчётом в полёте; ведро сайта консервативно и платит за двойника дважды).
    const fresh = mk({ storage: mem, lock: null, bff: new FakeBFF() })
    expect(await fresh.box.reserveLineCredit(1500)).toBe(900)
  })

  it('X17: вкладка, вернувшаяся из bfcache (pageshow), убирает свою запись', () => {
    const mem = new MemStorage()
    const { box } = mk({ storage: mem, lock: new NeverLock() })
    box.start()
    box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['a'] }))
    window.dispatchEvent(new Event('pagehide'))
    expect(unloadKeys(mem).length).toBe(1)
    window.dispatchEvent(new Event('pageshow'))
    expect(unloadKeys(mem)).toEqual([])
    box.stop()
  })

  it('R-M3: resume() во время идущей отправки — повтор после неё (снимок active пришёл до конца цикла)', async () => {
    const bff = new FakeBFF()
    bff.reply = () => json(403, { error: 'key_expired' })
    const storage = new MemStorage()
    let box: RouteOutbox | null = null
    const deps: OutboxDeps = {
      storage, locks: null, fetch: bff.fetch, now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: h => clearTimeout(h as ReturnType<typeof setTimeout>),
      newId: () => 'web:x',
      // Слушатель сессии ответил сразу, пока цикл отправки ещё не закончился.
      onAuthRefused: () => { bff.reply = () => json(200, { accepted: 1, duplicates: 0, rejected: [], evicted_external: 0 }); box!.resume() },
    }
    box = new RouteOutbox(deps)
    box.start()
    const e = ev('clip_rated', { rating: 'like' })
    box.enqueue(ROUTE_A, e)
    await vi.advanceTimersByTimeAsync(100)
    expect(bff.sent.length).toBe(2)
    expect(stored(storage)).toEqual([])
    box.stop()
  })

  it('стор отказов: очередь, остановленная 401/403, перечитывает сессию — не чаще раза в минуту', async () => {
    const bff = new FakeBFF()
    bff.reply = () => json(403, { error: 'key_expired' })
    let rereads = 0
    const storage = new MemStorage()
    const deps: OutboxDeps = {
      storage, locks: null, fetch: bff.fetch, now: () => Date.now(),
      setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: h => clearTimeout(h as ReturnType<typeof setTimeout>),
      newId: () => 'web:x', onAuthRefused: () => { rereads++ },
    }
    const box = new RouteOutbox(deps)
    box.enqueue(ROUTE_A, ev('clip_rated', { rating: 'like' }))
    await settle(box.flush({ timeoutMs: 1000 }))
    expect(rereads).toBe(1)
    box.resume()
    await settle(box.flush({ timeoutMs: 1000 }))
    expect(rereads).toBe(1)
    await vi.advanceTimersByTimeAsync(61_000)
    box.resume()
    await settle(box.flush({ timeoutMs: 1000 }))
    expect(rereads).toBe(2)
    expect(stored(storage).length).toBe(1)
  })
})
