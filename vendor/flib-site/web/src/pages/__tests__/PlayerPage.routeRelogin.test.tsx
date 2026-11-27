// PlayerPage.routeRelogin.test.tsx — повторное ревью партии 2, R-M1: «Выход» в
// другой вкладке, затем вход ДРУГИМ ключом, плеер всё это время открыт. Режим
// маршрута обязан перепроверяться свежим GET состояния: события под route_id
// прежнего ключа и прогресс чужого ролика под новым ключом недопустимы.
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
import { eraseRouteStorage, ROUTE_OUTBOX_KEY } from '../../site/cabinet/route/route-storage'

const V = 'abc123XYZ_1'
const RP = `youtube::${V}`
const ROUTE1 = '11111111-1111-4111-8111-111111111111'
const ROUTE2 = '22222222-2222-4222-8222-222222222222'
const ROW = { puzzle_id: RP, kind: 'youtube', video_id: V, title: 'clip of user ONE', delivered: true, played: true, queued_played: false, new_words: 1, words: ['alpha'] }
const mkState = (route: string, clips: unknown[]) => ({
  started: true, route_id: route, revision: 4, snapshot_date: '2026-11-18', started_at: null, goal_label: 'g',
  params: { daily_listening_budget_min: 20, daily_new_words: 15 },
  day: { date: '2026-11-18', clips },
  next_clip: null, current_puzzle_id: clips.length ? RP : null, replace_available: false, stop_reason: null, active_exchange: null,
})
function marker(on: boolean) {
  document.head.querySelectorAll('meta[name="flib-route"]').forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta'); m.setAttribute('name', 'flib-route'); m.setAttribute('content', '1'); document.head.appendChild(m)
}

let stateNow: unknown
let stateGets = 0
let calls: Array<{ url: string; method: string; body: string }> = []
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests(); __resetRouteRuntimeForTests()
  localStorage.clear(); localStorage.setItem('flib:subMode', 'l2')
  h.cues = [{ start: 0, end: 2, text_en: 'Hello brave world', text_ru: 'Привет' }]
  stateNow = mkState(ROUTE1, [ROW]); stateGets = 0; calls = []
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => {
    const u = String(url)
    const json = (st: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: st, headers: { 'Content-Type': 'application/json' } }))
    if (u.startsWith('/api/me/route/state')) { stateGets++; return json(200, stateNow) }
    if (u.startsWith('/api/me/route/')) {
      calls.push({ url: u, method: init.method ?? 'GET', body: typeof init.body === 'string' ? init.body : '' })
      if (u === '/api/me/route/events') { const n = JSON.parse(String(init.body)).events.length; return json(200, { accepted: n, duplicates: 0, rejected: [], evicted_external: 0 }) }
      return json(404, { error: 'not_found' })
    }
    return Promise.reject(new Error('no net'))
  }))
})
afterEach(() => { marker(false); vi.unstubAllGlobals(); __resetRouteOutboxForTests(); __resetSessionForTests() })

const pause = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })
const eventRoutes = () => calls.filter(c => c.url === '/api/me/route/events').map(c => JSON.parse(c.body).route_id as string)
const storedRoutes = () => { const raw = localStorage.getItem(ROUTE_OUTBOX_KEY); return raw ? (JSON.parse(raw).items as Array<{ route_id: string }>).map(i => i.route_id) : [] }
// seen — route_id событий, отправленных или лежащих в очереди (пословные ждут такта отправки).
const seen = () => [...new Set([...eventRoutes(), ...storedRoutes()])]

async function relogin(next: unknown): Promise<number> {
  // другая вкладка: «Выход» (стирание ключей + сообщение канала)
  eraseRouteStorage(localStorage)
  act(() => { __setSessionForTests({ cabinet: true, authenticated: false, reason: 'logout' }) })
  await pause(10)
  const gets = stateGets
  calls = []
  // другая вкладка: вход другим ключом
  stateNow = next
  act(() => { __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_two0' }) })
  await pause(60)
  return gets
}

describe('PlayerPage — новый вход при открытом плеере (R-M1)', () => {
  it('вход другим ключом, в чьём маршруте этого ролика нет: режим перепроверен, ни событий прежнего маршрута, ни прогресса', async () => {
    marker(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_one0' })
    startRouteRuntime()
    const { container, unmount } = render(<MemoryRouter initialEntries={[`/player?v=${V}&rp=${encodeURIComponent(RP)}`]}><PlayerPage /></MemoryRouter>)
    await waitFor(() => expect(container.querySelector('.sub-word')).toBeTruthy())
    await pause(30)
    // контроль: до выхода клик по слову даёт событие ROUTE1
    fireEvent.click(container.querySelectorAll('.sub-word')[0])
    await pause(2300)
    expect(seen()).toEqual([ROUTE1])
    const gets = await relogin(mkState(ROUTE2, []))
    expect(stateGets - gets).toBeGreaterThanOrEqual(1)
    fireEvent.click(container.querySelectorAll('.sub-word')[1])
    await pause(2300)
    expect(seen()).toEqual([])
    expect(calls.filter(c => c.url.startsWith('/api/me/route/progress'))).toEqual([])
    unmount()
    await pause(300)
    expect(storedRoutes()).not.toContain(ROUTE1)
    expect(localStorage.getItem('flib:route-watched') ?? '').not.toContain('user ONE')
  }, 30000)

  it('вход другим ключом, у которого этот ролик текущий: события идут под НОВЫМ route_id', async () => {
    marker(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_one0' })
    startRouteRuntime()
    const { container, unmount } = render(<MemoryRouter initialEntries={[`/player?v=${V}&rp=${encodeURIComponent(RP)}`]}><PlayerPage /></MemoryRouter>)
    await waitFor(() => expect(container.querySelector('.sub-word')).toBeTruthy())
    await pause(30)
    await relogin(mkState(ROUTE2, [ROW]))
    fireEvent.click(container.querySelectorAll('.sub-word')[1])
    await pause(2300)
    expect(seen()).toEqual([ROUTE2])
    unmount()
  }, 30000)
})
