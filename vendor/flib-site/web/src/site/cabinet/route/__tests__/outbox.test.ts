// outbox.test.ts — очередь событий маршрута `flib:route-outbox` (спека §4.8,
// план B6): каждая строка таблицы ответов, деление пачки, потолки, порядок
// вытеснения, работа без localStorage и без Web Locks, две вкладки на одном
// хранилище, keepalive на pagehide, выгрузка перед «Выходом» и стирание пяти
// ключей, ведро реплик (M3).
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { RouteOutbox, type OutboxDeps } from '../outbox'
import { ROUTE_LOGOUT_KEYS, ROUTE_LOGOUT_PREFIXES, ROUTE_OUTBOX_KEY } from '../route-storage'

// Пять ключей маршрута дословно (спека §6.2, план B6): не из модуля, иначе
// урезанный список в модуле проверял бы сам себя.
const FIVE_KEYS = ['flib:route-outbox', 'flib:route-ratings', 'flib:route-watched', 'flib:route-lesson', 'flib:examples-cache']
// UNLOAD_KEYS — запасные ключи выгрузки двух страниц: «Выход» стирает их по префиксу (R-M2).
const UNLOAD_KEYS = ['flib:route-outbox-unload:pA', 'flib:route-outbox-unload:pB']
import { SITE_LINE_CREDIT_CAP } from '../line-credit'
import { FakeBFF, MemStorage, SharedLock, ROUTE_A, ROUTE_B, ev, json, ok200, played } from './outbox-fakes'

function mk(o: { storage?: Storage | null; lock?: SharedLock | null; bff?: FakeBFF } = {}) {
  const bff = o.bff ?? new FakeBFF()
  const storage = o.storage === undefined ? new MemStorage() : o.storage
  const deps: OutboxDeps = {
    storage,
    locks: o.lock === undefined ? new SharedLock() : o.lock,
    fetch: bff.fetch,
    now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms),
    clearTimer: h => clearTimeout(h as ReturnType<typeof setTimeout>),
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

function stored(s: Storage | null): Array<{ route_id: string; event: Record<string, unknown> }> {
  const raw = s?.getItem(ROUTE_OUTBOX_KEY)
  return raw ? JSON.parse(raw).items : []
}

beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
afterEach(() => { vi.useRealTimers() })

describe('ответы BFF (таблица §4.8)', () => {
  it('200: принятые, дубли и отказы удаляются; сопоставление по event_id, а не по позиции', async () => {
    const { box, bff, storage } = mk()
    const a = ev('hint_requested', { lemmas: ['cat'] }), b = ev('line_translated', { lemmas: ['dog'] }), c = ev('clip_rated', { rating: 'like' })
    box.enqueue(ROUTE_A, a); box.enqueue(ROUTE_A, b); box.enqueue(ROUTE_A, c)
    // отказ с неверным index, но верным event_id — удаляется именно b
    bff.reply = () => json(200, { accepted: 2, duplicates: 0, rejected: [{ index: 0, event_id: b.event_id, reason: 'bad_shape' }], evicted_external: 0 })
    expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('sent')
    expect(stored(storage)).toEqual([])
    // clip_rated — первым в пачке
    expect(bff.sent[0].body.events[0].event_id).toBe(c.event_id)
  })

  it('200 full_regressed: событие пересобирается как partial с долей и уходит снова', async () => {
    const { box, bff, storage } = mk()
    const full = played(3, { subs_report: 'full' }); delete (full as Record<string, unknown>).played_frac
    box.enqueue(ROUTE_A, full, { frac: 0.75 })
    let first = true
    bff.reply = s => {
      if (first) { first = false; return ok200(s, [{ event_id: full.event_id, reason: 'full_regressed' }]) }
      return ok200(s)
    }
    await settle(box.flush({ timeoutMs: 5000 }))
    expect(bff.sent.length).toBe(2)
    const again = bff.sent[1].body.events[0]
    expect(again.subs_report).toBe('partial')
    expect(again.played_frac).toBe(0.75)
    expect(again.event_id).not.toBe(full.event_id)
    expect(again.subs_heard).toEqual(full.subs_heard)
    expect(stored(storage)).toEqual([])
  })

  it('отказ сопоставляется по event_id, даже когда index указывает на другое событие', async () => {
    const { box, bff, storage } = mk()
    const rating = ev('clip_rated', { rating: 'like' })
    const full = played(2, { subs_report: 'full' }); delete (full as Record<string, unknown>).played_frac
    box.enqueue(ROUTE_A, rating)
    box.enqueue(ROUTE_A, full, { frac: 0.5 })
    let first = true
    bff.reply = s => {
      if (!first) return ok200(s)
      first = false
      const wrongIndex = s.body.events.findIndex(e => e.event_id === rating.event_id)
      return json(200, { accepted: 1, duplicates: 0, rejected: [{ index: wrongIndex, event_id: full.event_id, reason: 'full_regressed' }], evicted_external: 0 })
    }
    await settle(box.flush({ timeoutMs: 5000 }))
    const resent = bff.sent.slice(1).flatMap(s => s.body.events)
    expect(resent.length).toBe(1)
    expect(resent[0]).toMatchObject({ type: 'clip_played', subs_report: 'partial', played_frac: 0.5 })
    expect(stored(storage)).toEqual([])
  })

  it('400 пачки: делится пополам; одиночное негодное событие выбрасывается и не блокирует очередь', async () => {
    const { box, bff, storage } = mk()
    const bad = ev('hint_requested', { lemmas: ['bad'] })
    const good = [ev('hint_requested', { lemmas: ['a'] }), ev('hint_requested', { lemmas: ['b'] }), ev('hint_requested', { lemmas: ['c'] })]
    box.enqueue(ROUTE_A, good[0]); box.enqueue(ROUTE_A, bad); box.enqueue(ROUTE_A, good[1]); box.enqueue(ROUTE_A, good[2])
    bff.reply = s => s.body.events.some(e => e.event_id === bad.event_id) ? json(400, { error: 'bad_request', field: 'events' }) : ok200(s)
    expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('sent')
    const accepted = bff.sent.filter(s => !s.body.events.some(e => e.event_id === bad.event_id)).flatMap(s => s.body.events.map(e => e.event_id))
    expect(accepted.sort()).toEqual(good.map(g => g.event_id).sort())
    expect(stored(storage)).toEqual([])
    // следующее событие уходит как обычно
    box.enqueue(ROUTE_A, ev('clip_rated', { rating: 'like' }))
    await vi.advanceTimersByTimeAsync(0)
    expect(await settle(box.flush({ timeoutMs: 5000 }))).not.toBe('refused')
    expect(stored(storage)).toEqual([])
  })

  it('413 одиночного события — выброшено', async () => {
    const { box, bff, storage } = mk()
    box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['x'] }))
    bff.reply = () => json(413, { error: 'body_too_large' })
    expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('sent')
    expect(stored(storage)).toEqual([])
  })

  it('409 stale_route / route_not_started: удаляются события этой эпохи, другой — остаются', async () => {
    for (const code of ['stale_route', 'route_not_started']) {
      const { box, bff, storage } = mk()
      box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['a'] }))
      box.enqueue(ROUTE_B, ev('hint_requested', { lemmas: ['b'] }))
      bff.reply = s => s.body.route_id === ROUTE_A ? json(409, { error: code }) : json(503, { error: 'gateway_unavailable' })
      await settle(box.flush({ timeoutMs: 5000 }))
      const left = stored(storage)
      expect(left.map(i => i.route_id)).toEqual([ROUTE_B])
    }
  })

  it('429 queue_full: пословные старше часа выброшены, прочее держится; до коммита обмена не шлём', async () => {
    const { box, bff, storage } = mk()
    const old = ev('hint_requested', { lemmas: ['old'], client_ts: new Date(Date.now() - 2 * 3600_000).toISOString() })
    const oldPlayed = played(2, { client_ts: new Date(Date.now() - 2 * 3600_000).toISOString() })
    const fresh = ev('hint_requested', { lemmas: ['new'] })
    box.enqueue(ROUTE_A, old); box.enqueue(ROUTE_A, oldPlayed); box.enqueue(ROUTE_A, fresh)
    bff.reply = () => json(429, { error: 'queue_full' }, { 'Retry-After': '1' })
    expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('refused')
    expect(stored(storage).map(i => i.event.event_id).sort()).toEqual([oldPlayed.event_id, fresh.event_id].sort())
    const before = bff.sent.length
    await vi.advanceTimersByTimeAsync(60_000)
    expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('refused')
    expect(bff.sent.length).toBe(before)
    box.onExchangeCommitted()
    bff.reply = s => ok200(s)
    expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('sent')
    expect(stored(storage)).toEqual([])
  })

  it('429 busy / route_banned / rate_limited: ждём Retry-After', async () => {
    for (const code of ['busy', 'route_banned', 'rate_limited']) {
      const { box, bff } = mk()
      box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['a'] }))
      bff.reply = () => json(429, { error: code }, { 'Retry-After': '30' })
      expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('refused')
      const n = bff.sent.length
      bff.reply = s => ok200(s)
      await vi.advanceTimersByTimeAsync(29_000)
      expect(await settle(box.flush({ timeoutMs: 1000 }))).toBe('refused')
      expect(bff.sent.length).toBe(n)
      await vi.advanceTimersByTimeAsync(2_000)
      expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('sent')
    }
  })

  it('503 / 502 / 502 gateway_refused / сеть: паузы 2, 4, 8 … 60 с', async () => {
    const { box, bff } = mk()
    box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['a'] }))
    const replies: Array<() => Response | Promise<Response>> = [
      () => json(503, { error: 'gateway_busy' }),
      () => json(502, { error: 'gateway_refused' }),
      () => new Response('<html>', { status: 502 }),
      () => Promise.reject(new TypeError('network')),
    ]
    let i = 0
    bff.reply = () => replies[Math.min(i++, replies.length - 1)]()
    expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('refused')
    for (const wait of [2000, 4000, 8000]) {
      const n = bff.sent.length
      await vi.advanceTimersByTimeAsync(wait - 100)
      expect(await settle(box.flush({ timeoutMs: 1000 }))).toBe('refused')
      expect(bff.sent.length).toBe(n)
      await vi.advanceTimersByTimeAsync(200)
      await settle(box.flush({ timeoutMs: 1000 }))
      expect(bff.sent.length).toBe(n + 1)
    }
  })

  it('401 / 403: остановиться — сами больше не шлём', async () => {
    for (const status of [401, 403]) {
      const { box, bff } = mk()
      const stop = box.start()
      box.enqueue(ROUTE_A, ev('clip_rated', { rating: 'like' }))
      bff.reply = () => json(status, { error: 'session_invalid' })
      await vi.advanceTimersByTimeAsync(100)
      const n = bff.sent.length
      expect(n).toBe(1)
      box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['z'] }))
      await vi.advanceTimersByTimeAsync(120_000)
      expect(bff.sent.length).toBe(n)
      stop()
    }
  })
})

describe('пачка, потолок, вытеснение', () => {
  it('пачка — одной эпохи, не больше 100 событий; clip_played и clip_rated первыми', async () => {
    const { box, bff } = mk()
    for (let i = 0; i < 150; i++) box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: [`w${i}`] }))
    const p = played(1)
    box.enqueue(ROUTE_A, p)
    box.enqueue(ROUTE_B, ev('hint_requested', { lemmas: ['other'] }))
    await settle(box.flush({ timeoutMs: 20_000 }))
    expect(bff.sent[0].body.events.length).toBe(100)
    expect(bff.sent[0].body.events[0].event_id).toBe(p.event_id)
    for (const s of bff.sent) expect(new Set(s.body.events.map(() => s.body.route_id)).size).toBe(1)
    expect(bff.sent.map(s => s.body.route_id)).toEqual([ROUTE_A, ROUTE_A, ROUTE_B])
  })

  it('пачка не больше 512 КиБ', async () => {
    const { box, bff } = mk()
    const big = 'x'.repeat(100 * 1024)
    for (let i = 0; i < 8; i++) box.enqueue(ROUTE_A, played(0, { blob: big }))
    await settle(box.flush({ timeoutMs: 20_000 }))
    for (const s of bff.sent) expect(new TextEncoder().encode(JSON.stringify(s.body)).length).toBeLessThanOrEqual(512 * 1024)
    expect(bff.sent.length).toBeGreaterThan(1)
  })

  it('потолок 1000 событий: первыми вытесняются старшие пословные, clip_played — последними', async () => {
    const { box, storage } = mk()
    const p = played(1)
    box.enqueue(ROUTE_A, p)
    const words = Array.from({ length: 1005 }, (_, i) => ev('hint_requested', { lemmas: [`w${i}`] }))
    for (const w of words) box.enqueue(ROUTE_A, w)
    await vi.advanceTimersByTimeAsync(2500)
    const left = stored(storage)
    expect(left.length).toBe(1000)
    expect(left.some(i => i.event.event_id === p.event_id)).toBe(true)
    expect(left.some(i => i.event.event_id === words[0].event_id)).toBe(false)
    expect(left.some(i => i.event.event_id === words[1004].event_id)).toBe(true)
  })

  it('потолок 1 МиБ', async () => {
    const { box, storage } = mk()
    for (let i = 0; i < 30; i++) box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['a'], pad: 'y'.repeat(50 * 1024) }))
    await vi.advanceTimersByTimeAsync(2500)
    expect(storage!.getItem(ROUTE_OUTBOX_KEY)!.length).toBeLessThanOrEqual(1 << 20)
  })
})

describe('хранилище и блокировка', () => {
  it('без localStorage очередь живёт в памяти вкладки (предупреждение раз за загрузку)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { box, bff } = mk({ storage: null })
    box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['a'] }))
    box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['b'] }))
    expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('sent')
    expect(bff.ids().length).toBe(2)
    expect(warn).toHaveBeenCalledTimes(1)
    warn.mockRestore()
  })

  it('переполненный localStorage: очередь переходит в память и не теряет событий', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const storage = new MemStorage()
    storage.failWrites = true
    const { box, bff } = mk({ storage })
    const e = ev('clip_rated', { rating: 'like' })
    box.enqueue(ROUTE_A, e)
    expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('sent')
    expect(bff.ids()).toEqual([e.event_id])
    warn.mockRestore()
  })

  it('без Web Locks очередь работает', async () => {
    const { box, bff } = mk({ lock: null })
    box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['a'] }))
    expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('sent')
    expect(bff.ids().length).toBe(1)
  })

  it('две вкладки на одном localStorage: ни одно событие не теряется и не уходит дважды', async () => {
    const storage = new MemStorage()
    const lock = new SharedLock()
    const bff = new FakeBFF()
    bff.reply = async s => { await new Promise(r => setTimeout(r, 50)); return ok200(s) }
    const t1 = mk({ storage, lock, bff }).box
    const t2 = mk({ storage, lock, bff }).box
    const all: string[] = []
    for (let i = 0; i < 40; i++) {
      const a = ev(i % 7 === 0 ? 'clip_played' : 'hint_requested', { lemmas: [`a${i}`] })
      const b = ev(i % 5 === 0 ? 'clip_rated' : 'hint_requested', { lemmas: [`b${i}`], rating: 'like' })
      all.push(a.event_id, b.event_id)
      t1.enqueue(ROUTE_A, a); t2.enqueue(ROUTE_A, b)
      if (i % 9 === 0) { void t1.flush({ timeoutMs: 5000 }); void t2.flush({ timeoutMs: 5000 }) }
    }
    for (let k = 0; k < 20; k++) {
      await vi.advanceTimersByTimeAsync(3000)
      await settle(Promise.all([t1.flush({ timeoutMs: 5000 }), t2.flush({ timeoutMs: 5000 })]))
    }
    const ids = bff.ids()
    expect(new Set(ids).size).toBe(ids.length)
    expect([...ids].sort()).toEqual([...all].sort())
    expect(stored(storage)).toEqual([])
  })
})

describe('интерфейс для машины обмена и страницы', () => {
  it('flush: empty / sent / refused / timeout', async () => {
    const { box, bff } = mk()
    expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('empty')
    box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['a'] }))
    expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('sent')
    box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['b'] }))
    bff.reply = () => new Promise<Response>(() => {})
    const p = box.flush({ timeoutMs: 5000 })
    await vi.advanceTimersByTimeAsync(5001)
    expect(await p).toBe('timeout')
  })

  it('pendingClipPlayed видит событие в пачке, ещё не получившей ответа', async () => {
    const { box, bff } = mk()
    const p = played(2, { puzzle_id: 'youtube::AAAAAAAAAAA' })
    let release: (r: Response) => void = () => {}
    bff.reply = () => new Promise<Response>(r => { release = r })
    box.enqueue(ROUTE_A, p)
    const f = box.flush({ timeoutMs: 60_000 })
    await vi.advanceTimersByTimeAsync(10)
    expect(bff.sent.length).toBe(1)
    expect(box.pendingClipPlayed().has('youtube::AAAAAAAAAAA')).toBe(true)
    release(ok200(bff.sent[0]))
    await f
    expect(box.pendingClipPlayed().has('youtube::AAAAAAAAAAA')).toBe(false)
  })

  it('dropClipPlayed удаляет несданные clip_played только этого ролика', async () => {
    const { box, storage } = mk()
    const mine = played(1, { puzzle_id: 'youtube::AAAAAAAAAAA' })
    const other = played(1, { puzzle_id: 'youtube::BBBBBBBBBBB' })
    const rating = ev('clip_rated', { puzzle_id: 'youtube::AAAAAAAAAAA', rating: 'dislike', rate_reason: 'content' })
    await box.enqueueDurable(ROUTE_A, mine)
    await box.enqueueDurable(ROUTE_A, other)
    await box.enqueueDurable(ROUTE_A, rating)
    await box.dropClipPlayed('youtube::AAAAAAAAAAA')
    expect(stored(storage).map(i => i.event.event_id).sort()).toEqual([other.event_id, rating.event_id].sort())
  })

  it('enqueueDurable: afterWrite выполняется после записи в очередь под той же блокировкой', async () => {
    const storage = new MemStorage()
    const lock = new SharedLock()
    const { box } = mk({ storage, lock })
    const e = played(1)
    let seen: { inQueue: boolean; held: boolean } | null = null
    await box.enqueueDurable(ROUTE_A, e, {
      afterWrite: () => { seen = { inQueue: stored(storage).some(i => i.event.event_id === e.event_id), held: lock.held } },
    })
    expect(seen).toEqual({ inQueue: true, held: true })
  })

  it('pagehide: keepalive ≤ 60 КиБ, события остаются в очереди (повтор погасит шлюз)', async () => {
    const { box, bff, storage } = mk()
    const stop = box.start()
    for (let i = 0; i < 40; i++) await box.enqueueDurable(ROUTE_A, ev('hint_requested', { lemmas: ['a'], pad: 'z'.repeat(3000) }))
    window.dispatchEvent(new Event('pagehide'))
    expect(bff.keepalive.length).toBe(1)
    expect(new TextEncoder().encode(String(bff.keepalive[0].init.body)).length).toBeLessThanOrEqual(60 * 1024)
    expect(bff.keepalive[0].init.keepalive).toBe(true)
    expect(stored(storage).length).toBe(40)
    stop()
  })

  it('отправка раз в 10 с при непустой очереди; буфер сбрасывается в хранилище не реже раза в 2 с', async () => {
    const { box, bff, storage } = mk()
    const stop = box.start()
    box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['a'] }))
    expect(stored(storage).length).toBe(0)
    await vi.advanceTimersByTimeAsync(2100)
    expect(stored(storage).length).toBe(1)
    expect(bff.sent.length).toBe(0)
    await vi.advanceTimersByTimeAsync(8000)
    expect(bff.sent.length).toBe(1)
    stop()
  })

  it('clip_played уходит сразу', async () => {
    const { box, bff } = mk()
    const stop = box.start()
    box.enqueue(ROUTE_A, played(1))
    await vi.advanceTimersByTimeAsync(50)
    expect(bff.sent.length).toBe(1)
    stop()
  })
})

describe('«Выход»', () => {
  it('список стираемых ключей — ровно пять ключей маршрута §6.2 и префикс запасных ключей выгрузки, черновика целей и теста уровня', () => {
    expect([...ROUTE_LOGOUT_KEYS].sort()).toEqual([...FIVE_KEYS].sort())
    expect([...ROUTE_LOGOUT_PREFIXES]).toEqual(['flib:route-outbox-unload:', 'flib:goal-harvest:v1:', 'flib:placement:v1:', 'flib:placement-later:v1:'])
  })

  it('выгрузка ≤ 2 с, затем в localStorage нет ни одного из пяти ключей', async () => {
    const { box, bff, storage } = mk()
    for (const k of [...FIVE_KEYS, ...UNLOAD_KEYS]) storage!.setItem(k, '{"v":1}')
    box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['a'] }))
    bff.reply = () => new Promise<Response>(() => {})
    const p = box.logoutFlush()
    await vi.advanceTimersByTimeAsync(2001)
    await p
    box.eraseAfterLogout()
    for (const k of [...FIVE_KEYS, ...UNLOAD_KEYS]) expect(storage!.getItem(k)).toBeNull()
  })

  it('ответ пачки, пришедший после стирания, ключ не воскрешает', async () => {
    const { box, bff, storage } = mk()
    let release: (r: Response) => void = () => {}
    bff.reply = () => new Promise<Response>(r => { release = r })
    box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['a'] }))
    box.enqueue(ROUTE_A, ev('hint_requested', { lemmas: ['b'] }))
    const f = box.flush({ timeoutMs: 60_000 })
    await vi.advanceTimersByTimeAsync(10)
    box.eraseAfterLogout()
    release(ok200(bff.sent[0], [{ event_id: String(bff.sent[0].body.events[0].event_id), reason: 'full_regressed' }]))
    await f
    await vi.advanceTimersByTimeAsync(5000)
    expect(storage!.getItem(ROUTE_OUTBOX_KEY)).toBeNull()
  })
})

describe('ведро реплик (M3)', () => {
  it('офлайн-выгрузка не тратит больше потолка сайта: отчёт сверх места ждёт пополнения', async () => {
    const { box, bff } = mk()
    const a = played(700), b = played(700), c = played(700)
    box.enqueue(ROUTE_A, a); box.enqueue(ROUTE_A, b); box.enqueue(ROUTE_A, c)
    expect(await settle(box.flush({ timeoutMs: 20_000 }))).toBe('refused')
    const sent = () => bff.ids().filter(id => [a, b, c].some(x => x.event_id === id))
    expect(sent().length).toBe(2)
    const spent = 1400
    expect(spent).toBeLessThanOrEqual(SITE_LINE_CREDIT_CAP)
    // 700 − (1500 − 1400) = 600 реплик при 50/мин — 12 мин
    await vi.advanceTimersByTimeAsync(11 * 60_000)
    expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('refused')
    expect(sent().length).toBe(2)
    await vi.advanceTimersByTimeAsync(61_000)
    expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('sent')
    expect(sent().length).toBe(3)
  })

  it('reserveLineCredit выдаёт не больше, чем есть в общем ведре', async () => {
    const storage = new MemStorage()
    const lock = new SharedLock()
    const t1 = mk({ storage, lock }).box
    const t2 = mk({ storage, lock }).box
    expect(await t1.reserveLineCredit(1000)).toBe(1000)
    expect(await t2.reserveLineCredit(1000)).toBe(500)
    expect(await t1.reserveLineCredit(10)).toBe(0)
  })

  it('отчёт, на который места нет, не мешает пословным событиям уйти', async () => {
    const { box, bff } = mk()
    expect(await box.reserveLineCredit(SITE_LINE_CREDIT_CAP)).toBe(SITE_LINE_CREDIT_CAP)
    const p = played(10), w = ev('hint_requested', { lemmas: ['a'] })
    box.enqueue(ROUTE_A, p); box.enqueue(ROUTE_A, w)
    expect(await settle(box.flush({ timeoutMs: 5000 }))).toBe('refused')
    expect(bff.ids()).toEqual([w.event_id])
  })
})
