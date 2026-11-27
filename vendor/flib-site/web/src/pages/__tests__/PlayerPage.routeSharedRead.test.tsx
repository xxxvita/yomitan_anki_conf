// PlayerPage.routeSharedRead.test.tsx — перенос из повторного ревью партии 2
// (R2-L1): первый GET состояния (ключ A) ещё в полёте, «Выход» в другой вкладке,
// вход ключом B; затем GET A отвечает состоянием A. Перепроверка режима под B
// обязана сделать СВОЙ запрос, а не присоединиться к запросу A: иначе плеер
// подтверждает маршрут A под ключом B (события с route_id A, прогресс под B).
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({ cues: [] as { start: number; end: number; text_en: string; text_ru: string }[] }))
vi.mock('../../player/hooks/useSubtitles', () => ({
  useSubtitles: () => ({ cues: h.cues, activeIndex: 0, status: 'ok', retrying: false, source: 'daemon_align' }),
}))

import { PlayerPage } from '../PlayerPage'
import { __resetSessionForTests, __setSessionForTests } from '../../site/session'
import { __resetRouteStateForTests } from '../../site/cabinet/route/use-route-state'
import { __resetRouteOutboxForTests } from '../../site/cabinet/route/outbox'
import { __resetRouteRuntimeForTests, startRouteRuntime } from '../../site/cabinet/route/route-lifecycle'
import { ROUTE_OUTBOX_KEY } from '../../site/cabinet/route/route-storage'

const V = 'abc123XYZ_1'
const RP = `youtube::${V}`
const ROUTE_A = '11111111-1111-4111-8111-111111111111'
const ROUTE_B = '22222222-2222-4222-8222-222222222222'
const ROW = { puzzle_id: RP, kind: 'youtube', video_id: V, title: 'clip of A', delivered: true, played: true, queued_played: false, new_words: 0, words: [] }
const mkState = (route: string, clips: unknown[]) => ({
  started: true, route_id: route, revision: 4, snapshot_date: '2026-11-18', started_at: null, goal_label: 'g',
  params: { daily_listening_budget_min: 20, daily_new_words: 15 },
  day: { date: '2026-11-18', clips }, next_clip: null, current_puzzle_id: clips.length ? RP : null,
  replace_available: false, stop_reason: null, active_exchange: null,
})
function marker(on: boolean) {
  document.head.querySelectorAll('meta[name="flib-route"]').forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta'); m.setAttribute('name', 'flib-route'); m.setAttribute('content', '1'); document.head.appendChild(m)
}

let releaseA: (() => void) | null = null
let stateGets = 0
let calls: Array<{ url: string; body: string }> = []
let laterState: unknown = null

beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests(); __resetRouteRuntimeForTests()
  localStorage.clear(); localStorage.setItem('flib:subMode', 'l2')
  h.cues = [{ start: 0, end: 2, text_en: 'Hello brave world', text_ru: 'Привет' }]
  stateGets = 0; calls = []; releaseA = null; laterState = mkState(ROUTE_B, [])
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => {
    const u = String(url)
    const json = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'Content-Type': 'application/json' } })
    if (u.startsWith('/api/me/route/state')) {
      stateGets++
      if (stateGets === 1) return new Promise<Response>(res => { releaseA = () => res(json(mkState(ROUTE_A, [ROW]))) })
      return Promise.resolve(json(laterState))
    }
    if (u.startsWith('/api/me/route/')) {
      calls.push({ url: u, body: typeof init.body === 'string' ? init.body : '' })
      if (u === '/api/me/route/events') { const n = JSON.parse(String(init.body)).events.length; return Promise.resolve(json({ accepted: n, duplicates: 0, rejected: [], evicted_external: 0 })) }
      return Promise.resolve(new Response('{"error":"not_found"}', { status: 404 }))
    }
    return Promise.reject(new Error('no net'))
  }))
})
afterEach(() => { marker(false); vi.unstubAllGlobals(); __resetRouteOutboxForTests(); __resetSessionForTests() })

const pause = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const routesSeen = () => {
  const sent = calls.filter(c => c.url === '/api/me/route/events').map(c => JSON.parse(c.body).route_id as string)
  const raw = localStorage.getItem(ROUTE_OUTBOX_KEY)
  const stored = raw ? (JSON.parse(raw).items as Array<{ route_id: string }>).map(i => i.route_id) : []
  return [...new Set([...sent, ...stored])]
}

describe('PlayerPage — общий GET состояния и смена ключа (R2-L1)', () => {
  it('ответ A, пришедший после входа ключом B, не подтверждает маршрут A под B', async () => {
    marker(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_one0' })
    startRouteRuntime()
    const { container, unmount } = render(<MemoryRouter initialEntries={[`/player?v=${V}&rp=${encodeURIComponent(RP)}`]}><PlayerPage /></MemoryRouter>)
    await waitFor(() => expect(stateGets).toBe(1))
    act(() => { __setSessionForTests({ cabinet: true, authenticated: false, reason: 'logout' }) })
    await pause(10)
    act(() => { __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_two0' }) })
    await pause(30)
    await act(async () => { releaseA!(); await new Promise(r => setTimeout(r, 60)) })
    await waitFor(() => expect(container.querySelector('.sub-word')).toBeTruthy())
    expect(stateGets).toBeGreaterThanOrEqual(2)
    fireEvent.click(container.querySelectorAll('.sub-word')[1])
    await pause(2300)
    expect(routesSeen()).not.toContain(ROUTE_A)
    expect(calls.filter(c => c.url.startsWith('/api/me/route/progress'))).toEqual([])
    unmount()
  }, 30000)

  it('контроль: у B этот ролик текущий — режим подтверждён, события под route_id B', async () => {
    laterState = mkState(ROUTE_B, [ROW])
    marker(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_one0' })
    startRouteRuntime()
    const { container, unmount } = render(<MemoryRouter initialEntries={[`/player?v=${V}&rp=${encodeURIComponent(RP)}`]}><PlayerPage /></MemoryRouter>)
    await waitFor(() => expect(stateGets).toBe(1))
    act(() => { __setSessionForTests({ cabinet: true, authenticated: false, reason: 'logout' }) })
    await pause(10)
    act(() => { __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_two0' }) })
    await pause(30)
    await act(async () => { releaseA!(); await new Promise(r => setTimeout(r, 60)) })
    await waitFor(() => expect(container.querySelector('.sub-word')).toBeTruthy())
    fireEvent.click(container.querySelectorAll('.sub-word')[1])
    await pause(2300)
    expect(routesSeen()).toEqual([ROUTE_B])
    unmount()
  }, 30000)
})
