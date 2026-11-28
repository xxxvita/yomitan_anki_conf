// PlayerPage.routeEvents.test.tsx — подключение событий маршрута в плеере (план
// B8c): в маршрутном режиме клик по слову даёт hint_requested, «Нравится» —
// clip_rated с subs_source этого открытия; у гостя и при выключенном маршруте
// событий нет.
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
import { __resetRouteOutboxForTests, getRouteOutbox } from '../../site/cabinet/route/outbox'

const V = 'abc123XYZ_1'
const RP = `youtube::${V}`
const ROUTE = '11111111-1111-4111-8111-111111111111'

function setRouteMarker(on: boolean): void {
  document.head.querySelectorAll('meta[name="flib-route"]').forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta')
  m.setAttribute('name', 'flib-route'); m.setAttribute('content', '1')
  document.head.appendChild(m)
}

const STATE = {
  started: true, route_id: ROUTE, revision: 4, snapshot_date: '2026-11-18', started_at: null, goal_label: 'g',
  params: { daily_listening_budget_min: 20, daily_new_words: 15 },
  day: { date: '2026-11-18', clips: [{ puzzle_id: RP, kind: 'youtube', video_id: V, delivered: true, played: true, queued_played: false, new_words: 0, words: [] }] },
  next_clip: null, current_puzzle_id: RP, replace_available: false, stop_reason: null, active_exchange: null,
}

let sent: Array<{ route_id: string; events: Array<Record<string, unknown>> }> = []

function stub() {
  sent = []
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => {
    const u = String(url)
    if (u.startsWith('/api/me/route/state')) return Promise.resolve(new Response(JSON.stringify(STATE), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    if (u === '/api/me/route/events') {
      const b = JSON.parse(String(init.body))
      sent.push(b)
      return Promise.resolve(new Response(JSON.stringify({ accepted: b.events.length, duplicates: 0, rejected: [], evicted_external: 0 }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    }
    return Promise.reject(new Error('no net'))
  }))
}

beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests()
  localStorage.clear()
  localStorage.setItem('flib:subMode', 'l2')
  h.cues = [{ start: 0, end: 2, text_en: 'Hello brave world', text_ru: 'Привет' }]
})
afterEach(() => { setRouteMarker(false); vi.unstubAllGlobals() })

async function events(): Promise<Array<Record<string, unknown>>> {
  await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
  return sent.flatMap(b => b.events)
}

describe('PlayerPage — события маршрута', () => {
  it('маршрутный режим: клик по слову → hint_requested; «Нравится» → clip_rated с subs_source открытия', async () => {
    setRouteMarker(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    stub()
    const { container, getByTestId } = render(<MemoryRouter initialEntries={[`/player?v=${V}&rp=${encodeURIComponent(RP)}`]}><PlayerPage /></MemoryRouter>)
    await waitFor(() => expect(container.querySelector('.sub-word')).toBeTruthy())
    await act(async () => { await new Promise(r => setTimeout(r, 20)) })
    fireEvent.click(container.querySelectorAll('.sub-word')[1])
    const likeBtn = getByTestId('video-vote-bar').querySelector('button')!
    fireEvent.click(likeBtn)
    const evs = await events()
    const kinds = evs.map(e => e.type).sort()
    expect(kinds).toEqual(['clip_rated', 'hint_requested'])
    expect(evs.find(e => e.type === 'hint_requested')).toMatchObject({ puzzle_id: RP, lemmas: ['brave'] })
    expect(evs.find(e => e.type === 'clip_rated')).toMatchObject({ puzzle_id: RP, rating: 'like', subs_source: 'server:daemon_align' })
    expect(sent.every(b => b.route_id === ROUTE)).toBe(true)
  })

  it('гость и выключенный маршрут — событий нет', async () => {
    for (const marker of [true, false]) {
      setRouteMarker(marker)
      __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
      stub()
      const q = marker ? `v=${V}` : `v=${V}&rp=${encodeURIComponent(RP)}`
      const { container, getByTestId, unmount } = render(<MemoryRouter initialEntries={[`/player?${q}`]}><PlayerPage /></MemoryRouter>)
      await waitFor(() => expect(container.querySelector('.sub-word')).toBeTruthy())
      fireEvent.click(container.querySelectorAll('.sub-word')[1])
      fireEvent.click(getByTestId('video-vote-bar').querySelector('button')!)
      expect(await events()).toEqual([])
      expect(localStorage.getItem('flib:route-outbox')).toBeNull()
      unmount()
    }
  })
})
