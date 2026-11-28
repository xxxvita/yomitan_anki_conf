// PlayerPage.routeProgress.test.tsx — проводка прогресса в события (ревью партии 2,
// M4: правило full держится на том, что PlayerPage передаёт НАСТОЯЩИЙ ответ GET):
// 200 той же дорожки → restored + heard из state; 404 → not_found без restoreHeard;
// до ответа — progressSettled:false.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, waitFor } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'

const h = vi.hoisted(() => ({
  cues: [] as { start: number; end: number; text_en: string; text_ru: string }[],
  args: [] as Array<Record<string, unknown>>,
}))
vi.mock('../../player/hooks/useSubtitles', () => ({
  useSubtitles: () => ({ cues: h.cues, activeIndex: 0, status: 'ok', retrying: false, source: null }),
}))
vi.mock('../../player/route-events/useRouteEvents', async (orig) => {
  const real = await orig<typeof import('../../player/route-events/useRouteEvents')>()
  return {
    ...real,
    useRouteEvents: (a: Record<string, unknown>) => {
      h.args.push(a)
      return { onWordsRevealed: () => {}, onWordClick: () => {}, onLineTranslated: () => {}, onSeek: () => {}, rate: () => false, counter: () => null, subsSource: 'server' }
    },
  }
})

import { PlayerPage } from '../PlayerPage'
import { __resetSessionForTests, __setSessionForTests } from '../../site/session'
import { __resetRouteStateForTests } from '../../site/cabinet/route/use-route-state'
import { trackKeyOf } from '../../player/route-events/progress'

const V = 'abc123XYZ_1'
const RP = `youtube::${V}`
const STATE = {
  started: true, route_id: '11111111-1111-4111-8111-111111111111', revision: 4, snapshot_date: '2026-11-18', started_at: null, goal_label: 'g',
  params: { daily_listening_budget_min: 20, daily_new_words: 15 },
  day: { date: '2026-11-18', clips: [{ puzzle_id: RP, kind: 'youtube', video_id: V, delivered: true, played: true, queued_played: false, new_words: 0, words: [] }] },
  next_clip: null, current_puzzle_id: RP, replace_available: false, stop_reason: null, active_exchange: null,
}
function marker(on: boolean) {
  document.head.querySelectorAll('meta[name="flib-route"]').forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta'); m.setAttribute('name', 'flib-route'); m.setAttribute('content', '1'); document.head.appendChild(m)
}
const json = (st: number, b: unknown) => Promise.resolve(new Response(JSON.stringify(b), { status: st, headers: { 'Content-Type': 'application/json' } }))

function stub(progress: () => Promise<Response>) {
  vi.stubGlobal('fetch', vi.fn((url: string) => {
    const u = String(url)
    if (u.startsWith('/api/me/route/state')) return json(200, STATE)
    if (u.startsWith('/api/me/route/progress')) return progress()
    return Promise.reject(new Error('no net'))
  }))
}

beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); localStorage.clear()
  h.cues = [{ start: 0, end: 2, text_en: 'Hello brave world', text_ru: '' }, { start: 2, end: 4, text_en: 'Second', text_ru: '' }]
  h.args = []
  marker(true)
  __setSessionForTests({ cabinet: true, authenticated: true, state: 'active' })
})
afterEach(() => { marker(false); vi.unstubAllGlobals() })

const last = () => h.args[h.args.length - 1]

describe('PlayerPage — прогресс → правило full', () => {
  it('200 той же дорожки: restored с heard_max и heard из state', async () => {
    stub(() => json(200, { track_key: trackKeyOf(h.cues), position_ms: 0, heard_max: 1, state: { v: 1, heard: [0], replays: {} } }))
    render(<MemoryRouter initialEntries={[`/player?v=${V}&rp=${encodeURIComponent(RP)}`]}><PlayerPage /></MemoryRouter>)
    await waitFor(() => expect(last().progressSettled).toBe(true))
    expect(last().progress).toEqual({ kind: 'restored', heardMax: 1 })
    expect(last().restoreHeard).toEqual([0])
    // до ответа GET settled был false
    expect(h.args.some(a => a.progressSettled === false)).toBe(true)
  })

  it('404: not_found, без restoreHeard', async () => {
    stub(() => json(404, { error: 'not_found' }))
    render(<MemoryRouter initialEntries={[`/player?v=${V}&rp=${encodeURIComponent(RP)}`]}><PlayerPage /></MemoryRouter>)
    await waitFor(() => expect(last().progressSettled).toBe(true))
    expect(last().progress).toEqual({ kind: 'not_found', heardMax: 0 })
    expect(last().restoreHeard).toBeNull()
  })

  it('GET не удался: failed', async () => {
    stub(() => json(502, { error: 'gateway_unavailable' }))
    render(<MemoryRouter initialEntries={[`/player?v=${V}&rp=${encodeURIComponent(RP)}`]}><PlayerPage /></MemoryRouter>)
    await waitFor(() => expect(last().progressSettled).toBe(true))
    expect(last().progress).toEqual({ kind: 'failed', heardMax: 0 })
  })
})
