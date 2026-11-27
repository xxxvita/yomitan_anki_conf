// PlayerPage.routeCarry3b.test.tsx — переносы ревью партии 3а (второй круг) в
// плеер: R2-L6 «Повторить» после неудачной проверки маршрута, R2-L7 W7 (после
// ЧУЖОГО коммита пометки `replaced` нет). Стенд — из PlayerPage.routeFixRound1.
// (исходный заголовок стенда:) PlayerPage.routeFixRound1.test.tsx — ревью партии 3а, правки первого круга
// (плеер): H1 возврат «← К маршруту» после частичного просмотра (Web Locks есть),
// C1 замена из плеера по свежему состоянию, L1 конфликты обмена, L6 карточка
// конца не закрывает оценку, L8 стражи R7 (локальный сброс отчёта) и R58
// (выгрузка перед «Следующий ролик →»). Порт проб `review-b3a/probes/zz-b3a-spa`
// и `zz-b3a-player`.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, fireEvent, act, waitFor, screen, within } from '@testing-library/react'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'

const h = vi.hoisted(() => ({ cues: [] as { start: number; end: number; text_en: string; text_ru: string }[], adapter: null as any }))
vi.mock('../../player/hooks/useSubtitles', () => ({
  useSubtitles: () => ({ cues: h.cues, activeIndex: 0, status: 'ok', retrying: false, source: 'daemon_align' }),
}))
vi.mock('../../adapter/IFrameAdapter', () => ({
  createIFrameAdapter: async () => {
    const { makeFakeAdapter } = await import('../../adapter/__tests__/fake')
    h.adapter = makeFakeAdapter({ duration: 120, t: 0 })
    return h.adapter
  },
}))

import { PlayerPage } from '../PlayerPage'
import { RoutePageCabinet } from '../../site/cabinet/route/RoutePageCabinet'
import { __resetSessionForTests, __setSessionForTests } from '../../site/session'
import { __resetRouteStateForTests } from '../../site/cabinet/route/use-route-state'
import { __resetRouteOutboxForTests, getRouteOutbox } from '../../site/cabinet/route/outbox'
import { __resetRouteRuntimeForTests } from '../../site/cabinet/route/route-lifecycle'

const V = 'abc123XYZ_1'
const RP = `youtube::${V}`
const V2 = 'zzz999YYY_2'
const RP2 = `youtube::${V2}`
const ROUTE = '11111111-1111-4111-8111-111111111111'
function marker(on: boolean) {
  document.head.querySelectorAll('meta[name="flib-route"]').forEach(m => m.remove())
  if (!on) return
  const m = document.createElement('meta'); m.setAttribute('name', 'flib-route'); m.setAttribute('content', '1'); document.head.appendChild(m)
}
function Loc() { const l = useLocation(); return <div data-testid="location">{l.pathname + l.search}</div> }
const later = (ms: number, st: number, b: unknown, hd: Record<string, string> = {}) => new Promise<Response>(res => setTimeout(() => res(new Response(JSON.stringify(b), { status: st, headers: { 'Content-Type': 'application/json', ...hd } })), ms))
const pause = (ms: number) => act(async () => { await new Promise(r => setTimeout(r, ms)) })

let today = ''
let queued = new Set<string>()
let calls: Array<{ url: string; method: string; body: any; at: number }> = []
let seq = 0
let stateOverride: ((n: number) => unknown) | null = null
let exchangeReply: () => Promise<Response>
let afterCommit: unknown = null
let stateGets = 0
const row = (pid: string, v: string, over: Record<string, unknown> = {}) => ({ puzzle_id: pid, kind: 'youtube', video_id: v, title: 'T ' + v, delivered: true, played: false, queued_played: queued.has(pid), new_words: 0, words: [], duration_sec: 120, ...over })
const baseState = (over: Record<string, unknown> = {}) => ({
  started: true, route_id: ROUTE, revision: 4, snapshot_date: today, started_at: null, goal_label: 'g',
  params: { daily_listening_budget_min: 20, daily_new_words: 15 },
  day: { date: today, clips: [row(RP, V), { delivered: false, new_words: 0, duration_sec: 100 }] },
  next_clip: {}, current_puzzle_id: RP, replace_available: true, stop_reason: null, active_exchange: null, ...over,
})

beforeEach(() => {
  __resetSessionForTests(); __resetRouteStateForTests(); __resetRouteOutboxForTests(); __resetRouteRuntimeForTests()
  localStorage.clear(); localStorage.setItem('flib:subMode', 'l2')
  h.cues = [{ start: 0, end: 2, text_en: 'Hello brave world', text_ru: 'Привет' }]
  h.adapter = null; queued = new Set(); calls = []; seq = 0; stateOverride = null; afterCommit = null; stateGets = 0
  const d = new Date(); today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
  exchangeReply = () => later(5, 202, { job_id: '33333333-3333-4333-8333-333333333333', base_revision: 4 })
  vi.stubGlobal('fetch', vi.fn((url: string, init: RequestInit = {}) => {
    const u = String(url)
    const method = (init.method ?? 'GET').toUpperCase()
    const body = typeof init.body === 'string' ? (() => { try { return JSON.parse(init.body as string) } catch { return init.body } })() : null
    calls.push({ url: u, method, body, at: ++seq })
    if (u.startsWith('/api/me/route/state')) {
      stateGets++
      // queued_played решается в момент ПРИХОДА запроса состояния (как у шлюза)
      const s = stateOverride ? stateOverride(stateGets) : (afterCommitApplied ? afterCommitApplied : baseState())
      return later(40, 200, s)
    }
    if (u === '/api/me/route/events') {
      for (const e of body.events) if (e.type === 'clip_played') queued.add(e.puzzle_id)
      return later(40, 200, { accepted: body.events.length, duplicates: 0, rejected: [], evicted_external: 0 })
    }
    if (u === '/api/me/route/exchange') return exchangeReply()
    if (u.startsWith('/api/me/route/jobs/')) { if (afterCommit) { afterCommitApplied = afterCommit; afterCommit = null } return later(5, 200, { status: 'done', committed: true, committed_revision: 5, cancel_reason: null, error_code: null }) }
    if (u.startsWith('/api/me/route/progress')) return later(5, method === 'GET' ? 404 : 200, method === 'GET' ? { error: 'not_found' } : { ok: true })
    if (u.startsWith('/api/feedback/video')) return Promise.resolve(new Response(null, { status: 204 }))
    if (u.startsWith('/api/me/route/')) return later(5, 404, { error: 'not_found' })
    return Promise.reject(new Error('no net'))
  }))
})
let afterCommitApplied: unknown = null
afterEach(() => { marker(false); vi.unstubAllGlobals(); __resetRouteOutboxForTests(); __resetSessionForTests(); __resetRouteRuntimeForTests(); afterCommitApplied = null })

function mountSpa(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <div className="cab">
        <Routes>
          <Route path="/player" element={<PlayerPage />} />
          <Route path="/app/route" element={<RoutePageCabinet />} />
          <Route path="*" element={<div data-testid="elsewhere" />} />
        </Routes>
      </div>
      <Loc />
    </MemoryRouter>,
  )
}
const routeOn = () => { marker(true); __setSessionForTests({ cabinet: true, authenticated: true, state: 'active', keyPrefix: 'tpk_abcd', routeAllowed: true }) }
const openDislike = async () => {
  const bar = await screen.findByTestId('video-vote-bar')
  fireEvent.click(within(bar).getByRole('button', { name: 'Не понравилось' }))
  return bar
}


const watched = () => JSON.parse(localStorage.getItem('flib:route-watched') ?? 'null')
async function openRp() {
  routeOn()
  mountSpa(`/player?v=${V}&rp=${encodeURIComponent(RP)}`)
  await waitFor(() => expect(stateGets).toBeGreaterThan(0))
  await waitFor(() => expect(h.adapter).toBeTruthy())
  await pause(80)
}
async function dislikeWithTick() {
  const bar = await openDislike()
  fireEvent.click(within(bar).getByLabelText('Не интересно'))
  fireEvent.click(within(bar).getByRole('button', { name: 'Отправить' }))
}
const ratedEvents = () => calls.filter(c => c.url === '/api/me/route/events').flatMap(c => c.body.events).filter((e: any) => e.type === 'clip_rated')

describe('R2-L6: «Не удалось проверить маршрут» — кнопка «Повторить» повторяет только проверку и замену', () => {
  it('чтение 503 → «Повторить» (шлюз вернулся) → замена уходит с той же причиной; оценка одна', async () => {
    await openRp()
    let fail = true
    const f = (globalThis.fetch as unknown as { getMockImplementation: () => (u: string, i?: RequestInit) => Promise<Response> }).getMockImplementation()
    vi.stubGlobal('fetch', vi.fn((u: string, i?: RequestInit) => (fail && String(u).startsWith('/api/me/route/state')) ? later(5, 503, { error: 'gateway_unavailable' }, { 'Retry-After': '1' }) : f(u, i)))
    __resetRouteStateForTests()
    afterCommit = baseState({ revision: 5, current_puzzle_id: RP2, day: { date: today, clips: [row(RP2, V2)] } })
    await dislikeWithTick()
    await waitFor(() => expect(document.querySelector('.vvb-route-status')?.textContent).toBe('Не удалось проверить маршрут. Попробуйте ещё раз'), { timeout: 3000 })
    expect(calls.filter(c => c.url === '/api/me/route/exchange').length).toBe(0)
    fail = false
    fireEvent.click(screen.getByRole('button', { name: 'Повторить' }))
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(V2), { timeout: 5000 })
    const ex = calls.filter(c => c.url === '/api/me/route/exchange')
    expect(ex.length).toBe(1)
    expect(ex[0].body).toMatchObject({ want: 'replace', replace_puzzle_id: RP, replace_reason: 'content' })
    await act(async () => { await getRouteOutbox().flush({ timeoutMs: 3000 }) })
    expect(ratedEvents().length).toBe(1)
  }, 20000)

  it('контроль: без неудачного чтения кнопки «Повторить» нет', async () => {
    await openRp()
    exchangeReply = () => later(5, 409, { error: 'stale_revision', revision: 9 })
    await dislikeWithTick()
    await waitFor(() => expect(document.querySelector('.vvb-route-status')?.textContent).toBe('День изменился, пока шла замена, — замена не выполнена'), { timeout: 3000 })
    expect(screen.queryByRole('button', { name: 'Повторить' })).toBeNull()
  }, 20000)
})

describe('R2-L7 W7: после ЧУЖОГО коммита плеер ролик заменённым не помечает', () => {
  it('409 exchange_in_progress, чужой обмен закоммичен — `replaced` без этого ролика', async () => {
    await openRp()
    exchangeReply = () => later(5, 409, { error: 'exchange_in_progress', job_id: '44444444-4444-4444-8444-444444444444', revision: 4 })
    afterCommit = baseState({ revision: 5, current_puzzle_id: RP2, day: { date: today, clips: [row(RP, V), row(RP2, V2)] } })
    await dislikeWithTick()
    await waitFor(() => expect(document.querySelector('.vvb-route-status')?.textContent).toBe('День изменился, пока шла замена, — замена не выполнена'), { timeout: 6000 })
    await pause(100)
    expect(watched()?.replaced ?? []).not.toContain(RP)
  }, 15000)

  it('контроль: своя замена закоммичена — пометка есть', async () => {
    await openRp()
    afterCommit = baseState({ revision: 5, current_puzzle_id: RP2, day: { date: today, clips: [row(RP2, V2)] } })
    await dislikeWithTick()
    await waitFor(() => expect(screen.getByTestId('location').textContent).toContain(V2), { timeout: 5000 })
    expect(watched()?.replaced ?? []).toContain(RP)
  }, 15000)
})
