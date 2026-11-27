// fix-round1-units.test.ts — ревью партии 3а, первый круг: модульные стражи
// правила H1 (отчёт в очереди в момент отправки запроса состояния), события
// «пачка с отчётом принята», вливания записей выгрузки в dropClipPlayed (M1) и
// пометки заменённого ролика в flib:route-watched (L2).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { buildDayModel, heroButtons } from '../day-model'
import { RouteOutbox, type OutboxDeps } from '../outbox'
import { readWatched, removeWatched, writeWatched } from '../../../../player/route-events/route-watched'
import { FakeBFF, MemStorage, SharedLock, ROUTE_A, json, played } from './outbox-fakes'
import { del, pid, st, und } from './route-page-fakes'

describe('H1: отчёт был в локальной очереди при отправке запроса этого состояния', () => {
  it('«открыт» и (при отметке ≥ 0,6) «просмотрен», хотя сейчас очередь пуста и queued_played нет', () => {
    const s = st([del(1), und()])
    const watched = { [pid(1)]: { share: 0.67 } }
    const m = buildDayModel(s, { watched, pendingClipPlayed: new Set(), sentPending: new Set([pid(1)]) })
    expect(m.current?.opened).toBe(true)
    expect(m.current?.watched).toBe(true)
    expect(heroButtons(m)).toEqual({ primary: 'next', secondary: 'watch_again' })
    // контроль: без пробы — «не открыт»
    const c = buildDayModel(s, { watched, pendingClipPlayed: new Set() })
    expect(heroButtons(c)).toEqual({ primary: 'watch', secondary: null })
  })
  it('8 %: «Смотреть снова» + «Следующий ролик»', () => {
    const m = buildDayModel(st([del(1), und()]), { watched: { [pid(1)]: { share: 0.08 } }, pendingClipPlayed: new Set(), sentPending: new Set([pid(1)]) })
    expect(heroButtons(m)).toEqual({ primary: 'watch_again', secondary: 'next' })
  })
})

function mk() {
  const bff = new FakeBFF()
  const storage = new MemStorage()
  const lock = new SharedLock()
  const deps: OutboxDeps = {
    storage, locks: lock, fetch: bff.fetch, now: () => Date.now(),
    setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: h => clearTimeout(h as ReturnType<typeof setTimeout>),
    newId: () => `web:x-${Math.random()}`,
  }
  return { box: new RouteOutbox(deps), bff, storage, lock }
}

describe('onReportsAccepted', () => {
  beforeEach(() => { vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'Date'] }) })
  afterEach(() => { vi.useRealTimers() })
  async function flush(box: RouteOutbox) {
    const p = box.flush({ timeoutMs: 3000 })
    for (let i = 0; i < 200; i++) await vi.advanceTimersByTimeAsync(20)
    return p
  }
  it('200 — сообщает puzzle_id принятых clip_played; отвергнутые и не-отчёты — нет', async () => {
    const { box, bff } = mk()
    const got: string[][] = []
    box.onReportsAccepted(p => got.push(p))
    const a = played(0, { puzzle_id: 'youtube::aaaaaaaaaaa' })
    const b = played(0, { puzzle_id: 'youtube::bbbbbbbbbbb' })
    bff.reply = s => json(200, { accepted: 1, duplicates: 0, rejected: [{ index: s.body.events.findIndex(e => e.event_id === b.event_id), event_id: b.event_id, reason: 'bad_shape' }], evicted_external: 0 })
    box.enqueue(ROUTE_A, a); box.enqueue(ROUTE_A, b)
    await flush(box)
    expect(got).toEqual([['youtube::aaaaaaaaaaa']])
  })
  it('отказ (503) — не сообщает; после «Выхода» — не сообщает', async () => {
    const { box, bff } = mk()
    const got: string[][] = []
    const off = box.onReportsAccepted(p => got.push(p))
    bff.reply = () => json(503, { error: 'gateway_unavailable' })
    box.enqueue(ROUTE_A, played(0))
    await flush(box)
    expect(got).toEqual([])
    off()
    bff.reply = s => json(200, { accepted: s.body.events.length, duplicates: 0, rejected: [], evicted_external: 0 })
    await vi.advanceTimersByTimeAsync(5000)
    await flush(box)
    expect(got).toEqual([])
  })
})

describe('M1: dropClipPlayed вливает записи выгрузки других страниц до фильтра', () => {
  it('отчёт ролика в записи другой страницы выброшен, отчёт другого ролика сохранён, запись стёрта', async () => {
    const { box, storage } = mk()
    const cp = (p: string, id: string) => ({ route_id: ROUTE_A, event: { event_id: id, type: 'clip_played', puzzle_id: p, played_frac: 0.9 } })
    storage.setItem('flib:route-outbox-unload:pOTHER', JSON.stringify({ v: 1, items: [cp('youtube::aaaaaaaaaaa', 'web:u1'), cp('youtube::bbbbbbbbbbb', 'web:u2')] }))
    await box.dropClipPlayed('youtube::aaaaaaaaaaa')
    const items = JSON.parse(storage.getItem('flib:route-outbox')!).items.map((i: { event: { event_id: string } }) => i.event.event_id)
    expect(items).toEqual(['web:u2'])
    expect(storage.getItem('flib:route-outbox-unload:pOTHER')).toBeNull()
  })
})

describe('L2: пометка заменённого ролика в flib:route-watched', () => {
  const R = '11111111-1111-4111-8111-111111111111'
  it('после removeWatched с эпохой отметка этого ролика той же даты не пишется; другого — пишется; другой даты — пишется', () => {
    const s = new MemStorage()
    writeWatched(R, '2026-11-18', 'youtube::a', 0.9, {}, s)
    removeWatched('youtube::a', s, { routeId: R, day: '2026-11-18' })
    expect(readWatched(s)!.items['youtube::a']).toBeUndefined()
    writeWatched(R, '2026-11-18', 'youtube::a', 0.9, {}, s)
    expect(readWatched(s)!.items['youtube::a']).toBeUndefined()
    writeWatched(R, '2026-11-18', 'youtube::b', 0.9, {}, s)
    expect(readWatched(s)!.items['youtube::b']).toBeTruthy()
    writeWatched(R, '2026-11-19', 'youtube::a', 0.9, {}, s)
    expect(readWatched(s)!.items['youtube::a']).toBeTruthy()
  })
  it('пометка без прежнего объекта создаёт объект эпохи; без эпохи — только удаление', () => {
    const s = new MemStorage()
    removeWatched('youtube::a', s, { routeId: R, day: '2026-11-18' })
    expect(readWatched(s)!.replaced).toEqual(['youtube::a'])
    const s2 = new MemStorage()
    writeWatched(R, '2026-11-18', 'youtube::a', 0.9, {}, s2)
    removeWatched('youtube::a', s2)
    writeWatched(R, '2026-11-18', 'youtube::a', 0.9, {}, s2)
    expect(readWatched(s2)!.items['youtube::a']).toBeTruthy()
  })
})
