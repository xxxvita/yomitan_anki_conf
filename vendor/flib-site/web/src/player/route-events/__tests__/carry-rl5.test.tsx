// carry-rl5.test.tsx — перенос из ревью партии 2 (R-L5): правило M1 считает
// РАЗЛИЧНЫЕ индексы сохранённого `state`, попадающие в дорожку, а не длину
// массива (спека §4.8, таблица subs_report: «различных услышанных sub_ref меньше
// присланного heard_max»). Чужое или испорченное `state` с повторами и
// индексами вне дорожки не должно давать `full`.
import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook } from '@testing-library/react'
import { useRouteEvents, type RouteEventsArgs, type RouteEventsDeps } from '../useRouteEvents'
import type { RouteModeView } from '../route-mode'
import type { DayClipDelivered, RouteState } from '../../../site/cabinet/route/route-api'
import { __resetClipListenedForTests } from '../clip-listened'

const ROUTE = '11111111-1111-4111-8111-111111111111'
const A = 'youtube::aaaaaaaaaaa'
const row = (pid: string): DayClipDelivered => ({ puzzle_id: pid, kind: 'youtube', video_id: pid.slice(9), title: 't', delivered: true, played: false, queued_played: false, new_words: 0, words: [] })
const state = (rows: DayClipDelivered[]): RouteState => ({ started: true, route_id: ROUTE, revision: 3, snapshot_date: '2026-11-18', started_at: null, goal_label: '', params: { daily_listening_budget_min: 20, daily_new_words: 15 }, day: { date: '2026-11-18', clips: rows }, next_clip: null, current_puzzle_id: rows[0].puzzle_id, replace_available: true, stop_reason: null, active_exchange: null })
const confirmed = (pid: string, st: RouteState): RouteModeView => ({ kind: 'confirmed', puzzleId: pid, state: st, row: st.day!.clips[0] as DayClipDelivered })

class Box {
  items: Array<Record<string, unknown>> = []
  enqueue(_r: string, ev: Record<string, unknown>) { this.items.push(ev) }
  async enqueueDurable(_r: string, ev: Record<string, unknown>, o: { afterWrite?: () => void } = {}) { this.items.push(ev); o.afterWrite?.() }
  onPagehide() {}
}
let box: Box
const deps = (): RouteEventsDeps => ({ outbox: box as never, storage: localStorage, now: () => new Date('2026-11-18T10:00:00Z') })
const mkCues = (n: number, len = 4) => Array.from({ length: n }, (_, i) => ({ start: i * len, end: (i + 1) * len, text_en: `line ${'abcdefghijklmnopqrstuvwxyz'[i % 26]} here`, text_ru: 'строка' }))

beforeEach(() => { box = new Box(); localStorage.clear(); __resetClipListenedForTests() })

function run(restoreHeard: number[], heardMax: number): string {
  const cues = mkCues(20)
  const b: RouteEventsArgs = {
    videoId: 'aaaaaaaaaaa', routeMode: confirmed(A, state([row(A)])), cues, subsStatus: 'ok', subsSource: 'daemon_align',
    currentTime: 40, duration: 80, rate: 1, seeking: () => false, progress: { kind: 'restored', heardMax }, progressSettled: true,
    restoreHeard, deps: deps(),
  }
  const r = renderHook(p => useRouteEvents(p), { initialProps: b })
  for (let t = 40; t <= 80; t += 0.25) r.rerender({ ...b, currentTime: t })
  r.unmount()
  return String(box.items.find(e => e.type === 'clip_played')!.subs_report)
}

describe('M1 — различные индексы сохранённого состояния (R-L5)', () => {
  it('повторы индексов не добирают до heard_max: 10 записей, 6 различных, отметка 10 → partial', () => {
    expect(run([0, 1, 2, 3, 4, 5, 5, 5, 5, 5], 10)).toBe('partial')
  })
  it('индексы вне дорожки не считаются: 6 своих + 4 за концом, отметка 10 → partial', () => {
    expect(run([0, 1, 2, 3, 4, 5, 50, 51, 52, 53], 10)).toBe('partial')
  })
  it('контроль: 10 различных индексов дорожки, отметка 10 → full', () => {
    expect(run([0, 1, 2, 3, 4, 5, 6, 7, 8, 9], 10)).toBe('full')
  })
})
