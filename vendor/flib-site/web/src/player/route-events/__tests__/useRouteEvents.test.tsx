// useRouteEvents.test.tsx — события плеера в маршруте (спека §4.7, §4.8, план B8c):
// без маршрутного режима событий нет; при rc — только clip_rated; пока режим не
// подтверждён — копятся и отбрасываются, если не подтвердился; событие относится
// к ролику, на котором набрано (носитель, граница ролика, «145,101 → 0»);
// clip_played раз на открытие и запись flib:route-watched после очереди.
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { CarrierGate, useRouteEvents, type RouteEventsArgs, type RouteEventsDeps } from '../useRouteEvents'
import type { RouteModeView } from '../route-mode'
import type { DayClipDelivered, RouteState } from '../../../site/cabinet/route/route-api'
import { readWatched } from '../route-watched'
import { clipShare } from '../clip-played'
import { __resetClipListenedForTests, isClipListened } from '../clip-listened'
import type { OutboxItem } from '../../../site/cabinet/route/outbox'

const V = 'abc123XYZ_1'
const PID = `youtube::${V}`
const ROUTE = '11111111-1111-4111-8111-111111111111'

class FakeBox {
  items: Array<{ route_id: string; event: Record<string, unknown>; frac?: number }> = []
  order: string[] = []
  pagehide: OutboxItem[][] = []
  // watchedAtEnqueue — была ли запись отметки ДО постановки отчёта в очередь
  // (порядок записи §4.2: сначала очередь, потом отметка, под одной блокировкой).
  watchedAtEnqueue: boolean[] = []
  enqueue(routeId: string, ev: Record<string, unknown>) { this.items.push({ route_id: routeId, event: ev }); this.order.push(`q:${ev.type}`) }
  async enqueueDurable(routeId: string, ev: Record<string, unknown>, o: { frac?: number; afterWrite?: () => void } = {}) {
    const w = readWatched(localStorage)
    this.watchedAtEnqueue.push(!!w && !!w.items[String(ev.puzzle_id)] && w.seq > this.seqSeen)
    this.items.push({ route_id: routeId, event: ev, frac: o.frac }); this.order.push(`q:${ev.type}`)
    if (o.afterWrite) { o.afterWrite(); this.order.push('watched') }
    this.seqSeen = readWatched(localStorage)?.seq ?? 0
  }
  seqSeen = 0
  onPagehide(extra: OutboxItem[] = []) { this.pagehide.push(extra); this.order.push('pagehide') }
  types() { return this.items.map(i => i.event.type) }
}

const row = (pid = PID, over: Partial<DayClipDelivered> = {}): DayClipDelivered => ({
  puzzle_id: pid, kind: 'youtube', video_id: pid.slice(9), title: 'Title', series_title: 'Series', source: 'youtube', duration_sec: 120,
  delivered: true, played: false, queued_played: false, new_words: 2, words: ['alpha', 'beta'], ...over,
})
function state(rows: DayClipDelivered[]): RouteState {
  return {
    started: true, route_id: ROUTE, revision: 3, snapshot_date: '2026-11-18', started_at: null, goal_label: '',
    params: { daily_listening_budget_min: 20, daily_new_words: 15 }, day: { date: '2026-11-18', clips: rows },
    next_clip: null, current_puzzle_id: rows[rows.length - 1].puzzle_id, replace_available: true, stop_reason: null, active_exchange: null,
  }
}
const confirmed = (pid = PID, st = state([row(pid)])): RouteModeView => ({ kind: 'confirmed', puzzleId: pid, state: st, row: st.day!.clips.find(c => (c as DayClipDelivered).puzzle_id === pid) as DayClipDelivered })

const CUES = [
  { start: 0, end: 4, text_en: 'Hello brave new world', text_ru: '' },
  { start: 4, end: 8, text_en: 'Second line here', text_ru: '' },
  { start: 8, end: 12, text_en: 'Third line now', text_ru: '' },
]

let box: FakeBox
let storage: Storage
function deps(): RouteEventsDeps { return { outbox: box as never, storage, now: () => new Date('2026-11-18T10:00:00Z') } }

function args(over: Partial<RouteEventsArgs> = {}): RouteEventsArgs {
  return {
    videoId: V, routeMode: confirmed(), cues: CUES, subsStatus: 'ok', subsSource: 'daemon_align',
    currentTime: 0, duration: 12, rate: 1, seeking: () => false, deps: deps(), ...over,
  }
}

beforeEach(() => { box = new FakeBox(); localStorage.clear(); storage = localStorage; __resetClipListenedForTests() })

function play(r: { rerender: (a: RouteEventsArgs) => void }, base: RouteEventsArgs, from: number, to: number) {
  for (let t = from; t <= to + 1e-9; t += 0.25) r.rerender({ ...base, currentTime: Math.round(t * 1000) / 1000 })
}

describe('гейт событий', () => {
  it('без маршрутного режима событий нет', () => {
    const base = args({ routeMode: { kind: 'off' } })
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    r.result.current.onWordClick('hello'); r.result.current.onWordsRevealed(0, ['hello']); r.result.current.onLineTranslated(0)
    r.result.current.onSeek(10, 2)
    expect(r.result.current.rate('like')).toBe(false)
    play(r, base, 0, 12)
    r.unmount()
    expect(box.items).toEqual([])
  })

  it('rc — только clip_rated, без clip_played и пословных; subs_source этого открытия', () => {
    const st = state([row('youtube::otherVideo1', { played: true }), row(PID)])
    const base = args({ routeMode: { kind: 'rc', puzzleId: 'youtube::otherVideo1', state: st, row: st.day!.clips[0] as DayClipDelivered }, videoId: 'otherVideo1' })
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    r.result.current.onWordClick('hello'); r.result.current.onWordsRevealed(0, ['hello']); r.result.current.onSeek(10, 2)
    play(r, base, 0, 12)
    expect(r.result.current.rate('dislike', 'content')).toBe(true)
    expect(r.result.current.rate('dislike')).toBe(false)
    r.unmount()
    expect(box.types()).toEqual(['clip_rated'])
    expect(box.items[0].event).toMatchObject({ puzzle_id: 'youtube::otherVideo1', rating: 'dislike', rate_reason: 'content', subs_source: 'server:daemon_align' })
  })

  it('pending: события копятся; подтвердился — уходят, не подтвердился — выброшены', () => {
    const pend: RouteModeView = { kind: 'pending', puzzleId: PID }
    const r = renderHook(p => useRouteEvents(p), { initialProps: args({ routeMode: pend }) })
    r.result.current.onWordClick('hello')
    r.result.current.rate('like')
    expect(box.items).toEqual([])
    r.rerender(args({ routeMode: confirmed() }))
    expect(box.types().sort()).toEqual(['clip_rated', 'hint_requested'])
    box = new FakeBox()
    const r2 = renderHook(p => useRouteEvents(p), { initialProps: args({ routeMode: pend }) })
    r2.result.current.onWordClick('world')
    r2.rerender(args({ routeMode: { kind: 'off' } }))
    r2.unmount()
    expect(box.items).toEqual([])
  })
})

describe('пословные события (таблица §4.8)', () => {
  it('hint_requested / subtitles_shown / line_translated / clip_replayed с правилами полей и дедупом', () => {
    const r = renderHook(p => useRouteEvents(p), { initialProps: args() })
    play(r, args(), 0, 1)
    const api = r.result.current
    api.onWordClick('Brave'); api.onWordClick('brave')
    api.onWordsRevealed(0, ['Hello']); api.onWordsRevealed(0, ['hello']); api.onWordsRevealed(1, ['hello'])
    api.onLineTranslated(1); api.onLineTranslated(1)
    api.onSeek(9.5, 5)     // назад 4,5 с — clip_replayed со словами реплики, куда вернулись
    api.onSeek(6, 5)       // назад 1 с — нет
    api.onSeek(5, 9)       // вперёд — нет
    const ev = box.items.map(i => i.event)
    expect(ev.map(e => e.type)).toEqual(['hint_requested', 'subtitles_shown', 'subtitles_shown', 'line_translated', 'clip_replayed'])
    expect(ev[0]).toMatchObject({ lemmas: ['brave'] })
    expect(ev[1]).toMatchObject({ lemmas: ['hello'], sub_ref: 'c0', subs_kind: 1, subs_lang: 'en' })
    expect(ev[2]).toMatchObject({ sub_ref: 'c1' })
    expect(ev[3].sub_ref).toBeUndefined()
    expect(ev[3].lemmas).toEqual(['second', 'line', 'here'])
    expect(ev[4].lemmas).toEqual(['second', 'line', 'here'])
    for (const e of ev) {
      expect(e.native_track_on).toBeUndefined()
      expect(e.learning_day).toBe('2026-11-18')
      expect(String(e.event_id)).toMatch(/^web:/)
    }
  })
})

describe('clip_played и граница ролика', () => {
  it('конец ролика — clip_played один раз; flib:route-watched пишется ПОСЛЕ очереди, meta = строка ролика', () => {
    const base = args()
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    play(r, base, 0, 11.5)
    r.unmount()
    expect(box.types()).toEqual(['clip_played'])
    expect(box.order).toEqual(['q:clip_played', 'watched'])
    expect(box.watchedAtEnqueue).toEqual([false])
    const ev = box.items[0].event
    expect(ev.subs_report).toBe('partial') // GET прогресса не было → partial (§4.8)
    expect(ev.played_frac).toBe(1)
    const w = readWatched(storage)!
    expect(w).toMatchObject({ route_id: ROUTE, day: '2026-11-18', seq: 1 })
    expect(w.items[PID].share).toBeCloseTo(clipShare(ev))
    expect(w.items[PID].meta).toEqual({ video_id: V, title: 'Title', series_title: 'Series', source: 'youtube', duration_sec: 120, words: ['alpha', 'beta'] })
    expect(isClipListened(PID)).toBe(true)
  })

  it('прогресс 404 и непрерывный счёт — full без played_frac', () => {
    const base = args({ progress: { kind: 'not_found', heardMax: 0 }, progressSettled: true })
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    play(r, base, 0, 11.5)
    r.unmount()
    expect(box.items[0].event.subs_report).toBe('full')
    expect(box.items[0].event.played_frac).toBeUndefined()
  })

  it('«200 той же дорожки» без восстановленного счёта — partial', () => {
    const base = args({ progress: { kind: 'restored', heardMax: 1 }, progressSettled: true, restoreHeard: null })
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    play(r, base, 0, 11.5)
    r.unmount()
    expect(box.items[0].event.subs_report).toBe('partial')
  })

  it('доля нового ролика не наследует прежнюю (145,101 → 0); прежний ролик отдаёт своё', () => {
    const P2 = 'youtube::secondVideo'
    const st = state([row(PID), row(P2)])
    const base = args({ routeMode: confirmed(PID, st), duration: 146 })
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    r.rerender({ ...base, currentTime: 100 })
    r.rerender({ ...base, currentTime: 145.101 })
    // смена ролика: идентификатор новый, время и длительность ещё прежнего носителя
    const next = { ...base, videoId: 'secondVideo', routeMode: confirmed(P2, st) }
    r.rerender({ ...next, currentTime: 145.101 })
    r.rerender({ ...next, currentTime: 145.101 })
    // перемотка из прежнего времени не считается
    r.result.current.onSeek(145.101, 0)
    r.rerender({ ...next, currentTime: 0, duration: 60 })
    r.unmount()
    const played = box.items.filter(i => i.event.type === 'clip_played').map(i => i.event)
    expect(played.map(e => [e.puzzle_id, e.played_frac])).toEqual([[PID, 0.994]])
    expect(box.types()).not.toContain('clip_replayed')
  })

  it('каждая постановка clip_played поднимает seq, share — максимум; другая дата плана отбрасывает объект', () => {
    const base = args()
    const r1 = renderHook(p => useRouteEvents(p), { initialProps: base })
    play(r1, base, 0, 11.5)
    r1.unmount()
    const first = readWatched(storage)!
    const r2 = renderHook(p => useRouteEvents(p), { initialProps: base })
    r2.rerender({ ...base, currentTime: 2 })
    r2.unmount()
    const second = readWatched(storage)!
    expect(second.items[PID].seq).toBe(first.items[PID].seq + 1)
    expect(second.items[PID].share).toBe(first.items[PID].share)
    const st2 = { ...state([row()]), day: { date: '2026-11-19', clips: [row()] } }
    const r3 = renderHook(p => useRouteEvents(p), { initialProps: args({ routeMode: confirmed(PID, st2) }) })
    r3.rerender({ ...args({ routeMode: confirmed(PID, st2) }), currentTime: 3 })
    r3.unmount()
    const third = readWatched(storage)!
    expect(third.day).toBe('2026-11-19')
    expect(Object.keys(third.items)).toEqual([PID])
  })

  it('pagehide — clip_played в очередь и в keepalive', () => {
    const base = args()
    const r = renderHook(p => useRouteEvents(p), { initialProps: base })
    r.rerender({ ...base, currentTime: 5 })
    window.dispatchEvent(new Event('pagehide'))
    expect(box.types()).toEqual(['clip_played'])
    // отчёт уже в очереди (её буфере), когда очередь синхронно пишет и шлёт keepalive
    expect(box.order.indexOf('q:clip_played')).toBeLessThan(box.order.indexOf('pagehide'))
    r.unmount()
    expect(box.types()).toEqual(['clip_played'])
  })
})

describe('CarrierGate', () => {
  it('после смены ролика пара чужая, пока не сменится длительность / время не уйдёт назад / не станет ≤ 1 с', () => {
    const g = new CarrierGate()
    expect(g.own('a', 50, 100)).toBe(true)
    expect(g.own('b', 99, 100)).toBe(false)
    expect(g.own('b', 99.2, 100)).toBe(false)
    expect(g.own('b', 0.5, 100)).toBe(true)
    const g2 = new CarrierGate()
    g2.own('a', 50, 100)
    g2.own('b', 99, 100)
    expect(g2.own('b', 99, 60)).toBe(true)
  })
})
