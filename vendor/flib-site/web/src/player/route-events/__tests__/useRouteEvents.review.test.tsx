// useRouteEvents.review.test.tsx — правки по ревью партии 2: M1 (восстановленный
// счёт отстаёт от heard_max → partial), M2 (смена ролика на месте настоящей
// последовательностью режима), L7 (переполнение наблюдений), и стражи M4:
// доля — максимум, учебный день прижат к snapshot_date, накопленные наблюдения
// проигрываются, отметки «прослушан» нет, пока режим не подтверждён, порог
// перемотки 1,5 с, копирование из русской строки и мимо оверлеев.
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRouteEvents, type RouteEventsArgs, type RouteEventsDeps } from '../useRouteEvents'
import type { RouteModeView } from '../route-mode'
import type { DayClipDelivered, RouteState } from '../../../site/cabinet/route/route-api'
import { __resetClipListenedForTests, isClipListened } from '../clip-listened'

const ROUTE = '11111111-1111-4111-8111-111111111111'
const A = 'youtube::aaaaaaaaaaa'
const B = 'youtube::bbbbbbbbbbb'
const row = (pid: string, over: Partial<DayClipDelivered> = {}): DayClipDelivered => ({ puzzle_id: pid, kind: 'youtube', video_id: pid.slice(9), title: 'Title ' + pid, delivered: true, played: false, queued_played: false, new_words: 1, words: ['alpha'], ...over })
const state = (rows: DayClipDelivered[], over: Partial<RouteState> = {}): RouteState => ({ started: true, route_id: ROUTE, revision: 3, snapshot_date: '2026-11-18', started_at: null, goal_label: '', params: { daily_listening_budget_min: 20, daily_new_words: 15 }, day: { date: '2026-11-18', clips: rows }, next_clip: null, current_puzzle_id: rows[rows.length - 1].puzzle_id, replace_available: true, stop_reason: null, active_exchange: null, ...over })
const confirmed = (pid: string, st: RouteState): RouteModeView => ({ kind: 'confirmed', puzzleId: pid, state: st, row: st.day!.clips.find(c => (c as DayClipDelivered).puzzle_id === pid) as DayClipDelivered })

class Box {
  items: Array<{ route: string; ev: Record<string, unknown> }> = []
  enqueue(r: string, ev: Record<string, unknown>) { this.items.push({ route: r, ev }) }
  async enqueueDurable(r: string, ev: Record<string, unknown>, o: { afterWrite?: () => void } = {}) { this.items.push({ route: r, ev }); o.afterWrite?.() }
  onPagehide() {}
  evs() { return this.items.map(i => i.ev) }
}
let box: Box
let now = new Date('2026-11-18T10:00:00Z')
const deps = (): RouteEventsDeps => ({ outbox: box as never, storage: localStorage, now: () => now })
const mkCues = (n: number, len = 4) => Array.from({ length: n }, (_, i) => ({ start: i * len, end: (i + 1) * len, text_en: `line ${'abcdefghijklmnopqrstuvwxyz'[i % 26]}${'abcdefghijklmnopqrstuvwxyz'[(i / 26 | 0) % 26]} here`, text_ru: 'строка' }))

beforeEach(() => { box = new Box(); localStorage.clear(); __resetClipListenedForTests(); now = new Date('2026-11-18T10:00:00Z') })

function base(over: Partial<RouteEventsArgs> = {}): RouteEventsArgs {
  return { videoId: 'aaaaaaaaaaa', routeMode: confirmed(A, state([row(A)])), cues: mkCues(3), subsStatus: 'ok', subsSource: 'daemon_align', currentTime: 0, duration: 12, rate: 1, seeking: () => false, progress: { kind: 'not_found', heardMax: 0 }, progressSettled: true, deps: deps(), ...over }
}

describe('M1 — восстановленный счёт отстаёт от heard_max', () => {
  it('сохранено 6 реплик, высшая отметка 10 → отчёт partial, а не full с «неуслышанными» 6–9', () => {
    const cues = mkCues(20)
    const b = base({ cues, currentTime: 40, duration: 80, progress: { kind: 'restored', heardMax: 10 }, restoreHeard: [0, 1, 2, 3, 4, 5] })
    const r = renderHook(p => useRouteEvents(p), { initialProps: b })
    for (let t = 40; t <= 80; t += 0.25) r.rerender({ ...b, currentTime: t })
    r.unmount()
    const ev = box.evs().find(e => e.type === 'clip_played')!
    expect(ev.subs_report).toBe('partial')
    expect(typeof ev.played_frac).toBe('number')
  })
  it('сохранено не меньше отметки → full', () => {
    const cues = mkCues(20)
    const b = base({ cues, currentTime: 40, duration: 80, progress: { kind: 'restored', heardMax: 6 }, restoreHeard: [0, 1, 2, 3, 4, 5] })
    const r = renderHook(p => useRouteEvents(p), { initialProps: b })
    for (let t = 40; t <= 80; t += 0.25) r.rerender({ ...b, currentTime: t })
    r.unmount()
    expect(box.evs().find(e => e.type === 'clip_played')!.subs_report).toBe('full')
  })
})

describe('M2 — смена ролика на месте (настоящая последовательность режима)', () => {
  it('confirmed A → (новый v, режим прежний) → pending B → confirmed B: отчёт A уходит с эпохой и строкой A', () => {
    const st = state([row(A), row(B)])
    const b = base({ routeMode: confirmed(A, state([row(A)])) })
    const r = renderHook(p => useRouteEvents(p), { initialProps: b })
    for (let t = 0; t <= 10; t += 0.25) r.rerender({ ...b, currentTime: t })
    r.rerender({ ...b, videoId: 'bbbbbbbbbbb', currentTime: 10 })
    r.rerender({ ...b, videoId: 'bbbbbbbbbbb', routeMode: { kind: 'pending', puzzleId: B }, currentTime: 10 })
    r.rerender({ ...b, videoId: 'bbbbbbbbbbb', routeMode: confirmed(B, st), currentTime: 0, duration: 60 })
    for (let t = 0; t <= 3; t += 0.25) r.rerender({ ...b, videoId: 'bbbbbbbbbbb', routeMode: confirmed(B, st), currentTime: t, duration: 60 })
    r.unmount()
    const played = box.items.filter(i => i.ev.type === 'clip_played')
    expect(played.map(i => [i.ev.puzzle_id, i.ev.played_frac ?? i.ev.subs_report])).toEqual([[A, 'full'], [B, 0.05]])
    expect(played.every(i => i.route === ROUTE)).toBe(true)
    const w = JSON.parse(localStorage.getItem('flib:route-watched')!)
    expect(w.items[A].meta.title).toBe('Title ' + A)
  })
  it('confirmed A → off (видео без rp): отчёт A не теряется', () => {
    const b = base()
    const r = renderHook(p => useRouteEvents(p), { initialProps: b })
    for (let t = 0; t <= 10; t += 0.25) r.rerender({ ...b, currentTime: t })
    r.rerender({ ...b, videoId: 'ccccccccccc', currentTime: 10 })
    r.rerender({ ...b, videoId: 'ccccccccccc', routeMode: { kind: 'off' }, currentTime: 10 })
    r.unmount()
    expect(box.evs().filter(e => e.type === 'clip_played').map(e => e.puzzle_id)).toEqual([A])
  })
  it('pending, не подтвердившийся: события и отчёт выброшены', () => {
    const b = base({ routeMode: { kind: 'pending', puzzleId: A } })
    const r = renderHook(p => useRouteEvents(p), { initialProps: b })
    for (let t = 0; t <= 10; t += 0.25) r.rerender({ ...b, currentTime: t })
    r.result.current.onWordClick('line')
    r.rerender({ ...b, routeMode: { kind: 'off' }, currentTime: 10 })
    r.unmount()
    expect(box.items).toEqual([])
  })
})

describe('стражи (M4)', () => {
  it('доля — максимум достигнутой, а не последнее значение', () => {
    const b = base({ duration: 100 })
    const r = renderHook(p => useRouteEvents(p), { initialProps: b })
    r.rerender({ ...b, currentTime: 30 }); r.rerender({ ...b, currentTime: 80 }); r.rerender({ ...b, currentTime: 10 })
    r.unmount()
    expect(box.evs()[0].played_frac).toBe(0.8)
  })

  it('learning_day — учебный день момента создания, прижатый к snapshot_date', () => {
    now = new Date('2026-11-17T12:00:00')
    const b = base({ routeMode: confirmed(A, state([row(A)], { snapshot_date: '2026-11-18' })) })
    const r = renderHook(p => useRouteEvents(p), { initialProps: b })
    r.rerender({ ...b, currentTime: 1 })
    r.result.current.onWordClick('line')
    expect(box.evs()[0].learning_day).toBe('2026-11-18')
  })

  it('наблюдения до ответа прогресса копятся и проигрываются после него', () => {
    const b = base({ progressSettled: false, progress: null })
    const r = renderHook(p => useRouteEvents(p), { initialProps: b })
    for (let t = 0; t <= 9; t += 0.25) r.rerender({ ...b, currentTime: t })
    r.rerender({ ...b, currentTime: 9, progressSettled: true, progress: { kind: 'not_found', heardMax: 0 } })
    r.unmount()
    const ev = box.evs().find(e => e.type === 'clip_played')!
    expect((ev.subs_heard as unknown[]).length).toBe(2)
    expect(ev.subs_report).toBe('full')
  })

  it('L7: наблюдения переполнились (дорожка пришла поздно) — отчёт не full', () => {
    const cues = mkCues(60, 3)
    const b = base({ cues: [], subsStatus: 'unavailable', duration: 180 })
    const r = renderHook(p => useRouteEvents(p), { initialProps: b })
    for (let t = 0; t <= 150; t += 0.25) r.rerender({ ...b, currentTime: t })
    for (let t = 150; t <= 180; t += 0.25) r.rerender({ ...b, cues, subsStatus: 'ok', currentTime: t })
    r.unmount()
    expect(box.evs().find(e => e.type === 'clip_played')!.subs_report).not.toBe('full')
  })

  it('пока режим не подтверждён, отметки «прослушан» нет', () => {
    const b = base({ routeMode: { kind: 'pending', puzzleId: A } })
    const r = renderHook(p => useRouteEvents(p), { initialProps: b })
    for (let t = 0; t <= 12; t += 0.25) r.rerender({ ...b, currentTime: t })
    expect(isClipListened(A)).toBe(false)
    r.unmount()
  })

  it('перемотка назад: ровно 1,5 с — clip_replayed, меньше — нет', () => {
    const r = renderHook(p => useRouteEvents(p), { initialProps: base() })
    r.rerender({ ...base(), currentTime: 1 })
    r.result.current.onSeek(5.49, 4)
    expect(box.items.length).toBe(0)
    r.result.current.onSeek(5.5, 4)
    expect(box.evs().map(e => e.type)).toEqual(['clip_replayed'])
  })

  it('копирование: из русской строки — слова английской; мимо оверлеев — ничего', () => {
    const b = base()
    const r = renderHook(p => useRouteEvents(p), { initialProps: b })
    r.rerender({ ...b, currentTime: 1 })
    const l1 = document.createElement('div'); l1.setAttribute('data-testid', 'subtitle-l1-overlay'); l1.textContent = 'строка перевода'
    const other = document.createElement('div'); other.textContent = 'line elsewhere'
    document.body.append(l1, other)
    const select = (el: Element) => { const rg = document.createRange(); rg.selectNodeContents(el); const s = window.getSelection()!; s.removeAllRanges(); s.addRange(rg) }
    select(other); document.dispatchEvent(new Event('copy'))
    expect(box.items.length).toBe(0)
    select(l1); document.dispatchEvent(new Event('copy'))
    expect(box.evs()[0]).toMatchObject({ type: 'clipboard_copy', lemmas: ['line', 'aa', 'here'] })
    l1.remove(); other.remove()
    r.unmount()
  })
})
