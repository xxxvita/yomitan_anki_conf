// fix-prc-units.test.tsx — PR-C (до включения флага маршрута):
//   L4  — отчёт страницы со вчерашней датой плана не сбрасывает сегодняшние
//         `flib:route-watched` и `flib:route-lesson` (порт пробы P1 финального ревью);
//   L6  — перечитывание после коммита и по каналу `flib-route` не присоединяется к
//         запросу состояния, ушедшему до коммита;
//   L10 — каждая ступень двух пар охран очереди закреплена отдельно:
//         (1) охрана под блокировкой в enqueueDurable / собственные охраны
//             moveBuffer и runAfterWrites; (3) охрана runAfterWrites / охраны
//             onPagehide и входа enqueueDurable.
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { renderHook, act, waitFor } from '@testing-library/react'
import { RouteOutbox, type OutboxDeps } from '../outbox'
import { __resetRouteStateForTests, broadcastRouteRevision, useRouteState } from '../use-route-state'
import { removeWatched, watchedFor, writeWatched } from '../../../../player/route-events/route-watched'
import { addLessonHeard, readLessonHeard } from '../words-lesson'
import { buildDayModel } from '../day-model'
import { ROUTE_OUTBOX_KEY } from '../route-storage'
import { __setSessionForTests } from '../../../session'
import type { RouteState } from '../route-api'
import { MemStorage, SharedLock, ROUTE_A, ev } from './outbox-fakes'

const R = '11111111-1111-4111-8111-111111111111'
const R2 = '22222222-2222-4222-8222-222222222222'
const TODAY = '2026-11-19'
const YDAY = '2026-11-18'

describe('L4: отчёт со вчерашней датой плана (проба P1)', () => {
  beforeEach(() => { localStorage.clear() })

  it('сегодняшняя строка kept_local и «просмотрен» переживают отчёт страницы со вчерашней датой', () => {
    writeWatched(R, TODAY, 'youtube::AAAAAAAAAAA', 1, { title: 'A' })
    writeWatched(R, TODAY, 'youtube::KKKKKKKKKKK', 1, { title: 'K', video_id: 'KKKKKKKKKKK' })
    const state = {
      started: true, route_id: R, revision: 9, snapshot_date: TODAY, started_at: null, goal_label: '',
      params: { daily_listening_budget_min: 20, daily_new_words: 15 },
      day: { date: TODAY, clips: [{ puzzle_id: 'youtube::AAAAAAAAAAA', kind: 'youtube', video_id: 'AAAAAAAAAAA', delivered: true, played: false, queued_played: true, new_words: 0, words: [] }] },
      next_clip: null, current_puzzle_id: 'youtube::AAAAAAAAAAA', replace_available: true, stop_reason: null, active_exchange: null,
    } as unknown as RouteState
    const before = buildDayModel(state, { watched: watchedFor(R, TODAY), pendingClipPlayed: new Set() })
    expect(before.rows.map(r => r.kind)).toEqual(['kept_local', 'current'])   // положительный контроль
    expect(before.current?.watched).toBe(true)
    expect(before.dayDone).toBe(true)

    writeWatched(R, YDAY, 'youtube::OLDOLDOLDOL', 0.4, { title: 'old' })

    const after = buildDayModel(state, { watched: watchedFor(R, TODAY), pendingClipPlayed: new Set() })
    expect(Object.keys(watchedFor(R, TODAY)).sort()).toEqual(['youtube::AAAAAAAAAAA', 'youtube::KKKKKKKKKKK'])
    expect(after.rows.map(r => r.kind)).toEqual(['kept_local', 'current'])
    expect(after.current?.watched).toBe(true)
    expect(after.dayDone).toBe(true)
  })

  it('контроль: более поздняя дата и другая эпоха начинают объект заново', () => {
    writeWatched(R, YDAY, 'youtube::OLDOLDOLDOL', 1, {})
    writeWatched(R, TODAY, 'youtube::AAAAAAAAAAA', 1, {})
    expect(watchedFor(R, YDAY)).toEqual({})
    expect(Object.keys(watchedFor(R, TODAY))).toEqual(['youtube::AAAAAAAAAAA'])
    writeWatched(R2, YDAY, 'youtube::BBBBBBBBBBB', 1, {})
    expect(Object.keys(watchedFor(R2, YDAY))).toEqual(['youtube::BBBBBBBBBBB'])
    expect(watchedFor(R, TODAY)).toEqual({})
  })

  it('пометка «заменён» со вчерашней датой не сбрасывает сегодняшние отметки', () => {
    writeWatched(R, TODAY, 'youtube::AAAAAAAAAAA', 1, {})
    removeWatched('youtube::OLDOLDOLDOL', localStorage, { routeId: R, day: YDAY })
    expect(Object.keys(watchedFor(R, TODAY))).toEqual(['youtube::AAAAAAAAAAA'])
  })

  it('урок слов: просмотренное слово со вчерашней датой не стирает сегодняшние слова урока', () => {
    addLessonHeard(R, TODAY, 'words::aaaa', 'alpha')
    addLessonHeard(R, YDAY, 'words::bbbb', 'old')
    expect(readLessonHeard(R, TODAY, 'words::aaaa')).toEqual(['alpha'])
    addLessonHeard(R, TODAY, 'words::aaaa', 'beta')          // контроль: та же дата пишется
    expect(readLessonHeard(R, TODAY, 'words::aaaa')).toEqual(['alpha', 'beta'])
  })
})

// --- L6 ----------------------------------------------------------------------------

function resp(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })
}
const probe = () => ({ watchedSeq: 0, pendingClipPlayed: new Set<string>() })

describe('L6: перечитывание по каналу flib-route не присоединяется к старому запросу', () => {
  const chans: Array<{ name: string; onmessage: ((e: MessageEvent) => void) | null }> = []
  beforeEach(() => {
    __resetRouteStateForTests()
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true, demo: false })
    chans.length = 0
    class BC {
      onmessage: ((e: MessageEvent) => void) | null = null
      constructor(public name: string) { chans.push(this) }
      postMessage() {}
      close() {}
    }
    vi.stubGlobal('BroadcastChannel', BC)
  })
  afterEach(() => { vi.unstubAllGlobals() })

  it('запрос, ушедший до коммита, висит; сообщение канала — свой запрос, на экране новая ревизия', async () => {
    let release: (() => void) | null = null
    let n = 0
    const fetch = vi.fn(async () => {
      n++
      if (n === 2) return new Promise<Response>(r => { release = () => r(resp(200, { started: false, revision: 5 })) })
      return resp(200, { started: false, revision: n === 1 ? 5 : 6 })
    })
    const { result } = renderHook(() => useRouteState({ api: { fetch }, probe }))
    await waitFor(() => expect(result.current.read?.result.ok).toBe(true))
    // перечитывание (возврат на вкладку) уходит до коммита и висит
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    // коммит в другой вкладке
    act(() => { chans.find(c => c.name === 'flib-route' && c.onmessage)!.onmessage!({ data: { revision: 6 } } as MessageEvent) })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    await waitFor(() => expect((result.current.read?.result as { data?: { revision: number } }).data?.revision).toBe(6))
    await act(async () => { release!(); await new Promise(r => setTimeout(r, 20)) })
    expect((result.current.read?.result as { data?: { revision: number } }).data?.revision).toBe(6)
  })

  it('сообщение о ревизии, объявленной этой же вкладкой, запрос в полёте не сбрасывает (контроль: чужая — сбрасывает)', async () => {
    let release: (() => void) | null = null
    let n = 0
    const fetch = vi.fn(async () => {
      n++
      if (n === 2) return new Promise<Response>(r => { release = () => r(resp(200, { started: false, revision: 7 })) })
      return resp(200, { started: false, revision: 7 })
    })
    const { result } = renderHook(() => useRouteState({ api: { fetch }, probe }))
    await waitFor(() => expect(result.current.read?.result.ok).toBe(true))
    act(() => { document.dispatchEvent(new Event('visibilitychange')) })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2))
    broadcastRouteRevision(7)
    act(() => { chans.find(c => c.name === 'flib-route' && c.onmessage)!.onmessage!({ data: { revision: 7 } } as MessageEvent) })
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    expect(fetch).toHaveBeenCalledTimes(2)
    act(() => { chans.find(c => c.name === 'flib-route' && c.onmessage)!.onmessage!({ data: { revision: 8 } } as MessageEvent) })
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3))
    await act(async () => { release!(); await new Promise(r => setTimeout(r, 20)) })
  })
})

// --- L10 ---------------------------------------------------------------------------

// HeldLock — блокировка, которую тест держит, пока не отпустит.
class HeldLock extends SharedLock {
  private open: () => void = () => {}
  hold(): void {
    const gate = new Promise<void>(r => { this.open = r })
    void this.request('x', () => gate)
  }
  release(): void { this.open() }
}

function mk(lock: SharedLock = new SharedLock()) {
  const storage = new MemStorage()
  const deps: OutboxDeps = {
    storage, locks: lock,
    fetch: () => Promise.reject(new Error('no net')),
    now: () => Date.now(), setTimer: (fn, ms) => setTimeout(fn, ms), clearTimer: h => clearTimeout(h as ReturnType<typeof setTimeout>),
    newId: () => 'web:x',
  }
  return { box: new RouteOutbox(deps), storage }
}
const tick = () => new Promise(r => setTimeout(r, 5))
type Internals = { buffer: unknown[]; afterWrites: Map<string, () => void>; moveBuffer(): void; runAfterWrites(): void; persistNow(d?: number): void }
const inner = (b: RouteOutbox) => b as unknown as Internals

describe('L10 пара 1: охрана под блокировкой в enqueueDurable — сама по себе', () => {
  it('«Выход» между постановкой и блокировкой: под блокировкой очередь не трогает хранилище вовсе', async () => {
    const lock = new HeldLock()
    const { box, storage } = mk(lock)
    const mv = vi.spyOn(inner(box), 'moveBuffer')
    const aw = vi.spyOn(inner(box), 'runAfterWrites')
    lock.hold()
    const p = box.enqueueDurable(ROUTE_A, ev('clip_played', { played_frac: 1 }), { afterWrite: () => storage.setItem('mark', '1') })
    box.forget()
    box.resume()                                  // новый вход до выдачи блокировки
    lock.release()
    await p
    await tick()
    expect(mv).not.toHaveBeenCalled()
    expect(aw).not.toHaveBeenCalled()
    expect(storage.length).toBe(0)
  })

  it('контроль: без «Выхода» под блокировкой — запись очереди и отметка', async () => {
    const lock = new HeldLock()
    const { box, storage } = mk(lock)
    const mv = vi.spyOn(inner(box), 'moveBuffer')
    lock.hold()
    const p = box.enqueueDurable(ROUTE_A, ev('clip_played', { played_frac: 1 }), { afterWrite: () => storage.setItem('mark', '1') })
    lock.release()
    await p
    expect(mv).toHaveBeenCalledTimes(1)
    expect(storage.getItem('mark')).toBe('1')
    expect(storage.getItem(ROUTE_OUTBOX_KEY)).not.toBeNull()
  })
})

describe('L10 пары 1 и 3: собственные охраны moveBuffer и runAfterWrites — каждая сама по себе', () => {
  it('moveBuffer закрытой очереди не пишет, даже если в буфере что-то есть', () => {
    const { box, storage } = mk()
    box.forget()
    inner(box).buffer.push({ route_id: ROUTE_A, event: ev('clip_played') })
    inner(box).moveBuffer()
    expect(storage.length).toBe(0)
  })

  it('runAfterWrites закрытой очереди отметок не выполняет и забывает их', () => {
    const { box, storage } = mk()
    box.forget()
    inner(box).afterWrites.set('e1', () => storage.setItem('mark', '1'))
    inner(box).runAfterWrites()
    expect(storage.length).toBe(0)
    expect(inner(box).afterWrites.size).toBe(0)
  })

  it('контроль: открытая очередь — moveBuffer пишет, runAfterWrites выполняет', () => {
    const { box, storage } = mk()
    inner(box).buffer.push({ route_id: ROUTE_A, event: ev('clip_played') })
    inner(box).moveBuffer()
    inner(box).afterWrites.set('e1', () => storage.setItem('mark', '1'))
    inner(box).runAfterWrites()
    expect(storage.getItem(ROUTE_OUTBOX_KEY)).not.toBeNull()
    expect(storage.getItem('mark')).toBe('1')
  })
})

describe('L10 пара 3: охраны onPagehide и входа enqueueDurable — каждая сама по себе', () => {
  it('onPagehide закрытой очереди не доходит ни до записи выгрузки, ни до отметок', () => {
    const { box } = mk()
    box.forget()
    const pn = vi.spyOn(inner(box), 'persistNow')
    const aw = vi.spyOn(inner(box), 'runAfterWrites')
    box.onPagehide([{ route_id: ROUTE_A, event: ev('clip_played') }])
    expect(pn).not.toHaveBeenCalled()
    expect(aw).not.toHaveBeenCalled()
    expect(inner(box).buffer).toHaveLength(0)
  })

  it('enqueueDurable закрытой очереди не трогает ни буфер, ни отметки, ни блокировку', async () => {
    const lock = new SharedLock()
    const req = vi.spyOn(lock, 'request')
    const { box } = mk(lock)
    box.forget()
    await box.enqueueDurable(ROUTE_A, ev('clip_played'), { afterWrite: () => undefined })
    expect(inner(box).buffer).toHaveLength(0)
    expect(inner(box).afterWrites.size).toBe(0)
    expect(req).not.toHaveBeenCalled()
  })
})

// L6 на странице маршрута (перечитывание после коммита своего обмена) — в
// fix-prc-day.test.tsx.
