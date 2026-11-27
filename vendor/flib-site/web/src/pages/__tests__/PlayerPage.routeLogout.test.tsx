// PlayerPage.routeLogout.test.tsx — ревью партии 2, C1: «Выход» в ДРУГОЙ вкладке,
// а в этой открыт плеер маршрута. После сообщения logout плеер не рождает событий
// и не воскрешает ни одного ключа маршрута (ни flib:route-outbox, ни
// flib:route-watched, ни запасного ключа выгрузки) — ни кликом, ни уходом со страницы.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

// allKeys — ключи хранилища через length/key(i): Object.keys(localStorage) в этой
// среде (jsdom + Node с собственным localStorage) ключей не перечисляет.
const allKeys = () => Array.from({ length: localStorage.length }, (_, i) => localStorage.key(i)!)
const h = vi.hoisted(() => ({ cues: [] as { start: number; end: number; text_en: string; text_ru: string }[] }))
vi.mock('../../player/hooks/useSubtitles', () => ({
  useSubtitles: () => ({ cues: h.cues, activeIndex: 0, status: 'ok', retrying: false, source: 'daemon_align' }),
}))

import { PlayerPage } from '../PlayerPage'
import { __resetSessionForTests, __setSessionForTests } from '../../site/session'
import { __resetRouteStateForTests } from '../../site/cabinet/route/use-route-state'
import { __resetRouteOutboxForTests } from '../../site/cabinet/route/outbox'
import { __resetRouteRuntimeForTests, startRouteRuntime } from '../../site/cabinet/route/route-lifecycle'
import { eraseRouteStorage } from '../../site/cabinet/route/route-storage'

const V = 'abc123XYZ_1'
const RP = `youtube::${V}`
const ROUTE = '11111111-1111-4111-8111-111111111111'
const STATE = {
  started: true, route_id: ROUTE, revision: 4, snapshot_date: '2026-11-18', started_at: null, goal_label: 'g',
  params: { daily_listening_budget_min: 20, daily_new_words: 15 },
  day: { date: '2026-11-18', clips: [{ puzzle_id: RP, kind: 'youtube', video_id: V, title: 'Secret clip title', delivered: true, played: true, queued_played: false, new_words: 1, words: ['alpha'] }] },
  next_clip: null, current_puzzle_id: RP, replace_available: false, stop_reason: null, active_exchange: null,
}
function marker(on: boolean) {
  document.head.querySelectorAll('meta[name="flib-route"]').forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta'); m.setAttribute('name', 'flib-route'); m.setAttribute('content', '1'); document.head.appendChild(m)
}
let posts = 0
beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests(); __resetRouteRuntimeForTests()
  localStorage.clear(); localStorage.setItem('flib:subMode', 'l2')
  h.cues = [{ start: 0, end: 2, text_en: 'Hello brave world', text_ru: 'Привет' }]
  posts = 0
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const u = String(url)
    if (u.startsWith('/api/me/route/state')) return Promise.resolve(new Response(JSON.stringify(STATE), { status: 200, headers: { 'Content-Type': 'application/json' } }))
    if (u === '/api/me/route/events') { posts++; return Promise.resolve(new Response(JSON.stringify({ error: 'session_invalid' }), { status: 401, headers: { 'Content-Type': 'application/json' } })) }
    return Promise.reject(new Error('no net'))
  }))
})
afterEach(() => { marker(false); vi.unstubAllGlobals(); __resetRouteOutboxForTests(); __resetSessionForTests() })

const routeKeys = () => allKeys().filter(k => (k.startsWith('flib:route') || k === 'flib:examples-cache') && k !== 'flib:route-listened')

describe('C1 — «Выход» в другой вкладке при открытом плеере', () => {
  it('после logout плеер не рождает событий и не воскрешает ключи', async () => {
    marker(true)
    __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
    startRouteRuntime()
    const { container, queryByTestId, unmount } = render(<MemoryRouter initialEntries={[`/player?v=${V}&rp=${encodeURIComponent(RP)}`]}><PlayerPage /></MemoryRouter>)
    await waitFor(() => expect(container.querySelector('.sub-word')).toBeTruthy())
    await act(async () => { await new Promise(r => setTimeout(r, 30)) })
    // вкладка A: «Выход» удался — стёрла ключи и разослала logout
    eraseRouteStorage(localStorage)
    act(() => { __setSessionForTests({ cabinet: true, authenticated: false, reason: 'logout' }) })
    expect(routeKeys()).toEqual([])
    fireEvent.click(container.querySelectorAll('.sub-word')[1])
    const like = queryByTestId('video-vote-bar')?.querySelector('button')
    if (like) fireEvent.click(like)
    window.dispatchEvent(new Event('pagehide'))
    await act(async () => { await new Promise(r => setTimeout(r, 2300)) })
    unmount()
    await act(async () => { await new Promise(r => setTimeout(r, 300)) })
    expect(routeKeys()).toEqual([])
    expect(posts).toBe(0)
  }, 20000)
})
